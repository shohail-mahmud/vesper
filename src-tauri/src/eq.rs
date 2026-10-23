//! Real-time 10-band Audio EQ Cookbook Biquad Equalizer wrapping any `rodio::Source`.
//!
//! Bands: 32 Hz (low-shelf), 64 Hz, 125 Hz, 250 Hz, 500 Hz, 1 kHz, 2 kHz, 4 kHz,
//! 8 kHz (peaking EQ), 16 kHz (high-shelf), plus preamp gain (-12..+12 dB) and
//! soft limiter headroom guard so heavy bass boosts never clip harshly.

use std::f32::consts::PI;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use arc_swap::ArcSwap;
use rodio::Source;

use crate::model::EqSettings;

pub const EQ_FREQUENCIES: [f32; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Copy, Debug)]
pub(crate) struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl Default for BiquadCoeffs {
    fn default() -> Self {
        BiquadCoeffs {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct BiquadState {
    z1: f32,
    z2: f32,
}

impl BiquadState {
    #[inline]
    fn process(&mut self, x: f32, c: &BiquadCoeffs) -> f32 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

fn peaking_eq(sample_rate: f32, freq: f32, db_gain: f32, q: f32) -> BiquadCoeffs {
    if db_gain.abs() < 0.01 || freq >= sample_rate * 0.49 {
        return BiquadCoeffs::default();
    }
    let a = 10.0_f32.powf(db_gain / 40.0);
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let alpha = w0.sin() / (2.0 * q);

    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cos_w0;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * cos_w0;
    let a2 = 1.0 - alpha / a;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

fn low_shelf(sample_rate: f32, freq: f32, db_gain: f32) -> BiquadCoeffs {
    if db_gain.abs() < 0.01 || freq >= sample_rate * 0.49 {
        return BiquadCoeffs::default();
    }
    let a = 10.0_f32.powf(db_gain / 40.0);
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let alpha = w0.sin() / 2.0 * 2.0_f32.sqrt();
    let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

    let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
    let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
    let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
    let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
    let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
    let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

fn high_shelf(sample_rate: f32, freq: f32, db_gain: f32) -> BiquadCoeffs {
    if db_gain.abs() < 0.01 || freq >= sample_rate * 0.49 {
        return BiquadCoeffs::default();
    }
    let a = 10.0_f32.powf(db_gain / 40.0);
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let alpha = w0.sin() / 2.0 * 2.0_f32.sqrt();
    let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

    let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
    let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
    let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
    let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
    let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
    let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

/// Everything the audio callback needs, precomputed. Published as one immutable
/// snapshot so the callback only ever performs an atomic load - it never takes a
/// lock and never runs `sin`/`cos`/`powf`.
pub struct BakedEq {
    pub enabled: bool,
    pub version: u64,
    pub preamp_linear: f32,
    pub coeffs: [BiquadCoeffs; 10],
}

impl BakedEq {
    fn neutral() -> Self {
        BakedEq {
            enabled: false,
            version: 0,
            preamp_linear: 1.0,
            coeffs: [BiquadCoeffs::default(); 10],
        }
    }
}

/// Holds the latest settings plus the sample rate they were baked for, so the
/// coefficient maths happens on whichever thread calls `update()` (the UI thread
/// or the audio worker) and never inside the realtime callback.
pub struct SharedEqBank {
    baked: ArcSwap<BakedEq>,
    settings: parking_lot::Mutex<EqSettings>,
    sample_rate: AtomicU32,
    version: AtomicU64,
}

impl SharedEqBank {
    pub fn new(initial: EqSettings) -> Arc<Self> {
        let bank = Arc::new(SharedEqBank {
            baked: ArcSwap::from_pointee(BakedEq::neutral()),
            settings: parking_lot::Mutex::new(initial),
            sample_rate: AtomicU32::new(44_100),
            version: AtomicU64::new(1),
        });
        bank.rebake();
        bank
    }

    /// Called by the audio worker when a track is opened (not the callback).
    pub fn set_sample_rate(&self, rate: u32) {
        let rate = rate.max(8_000);
        if self.sample_rate.swap(rate, Ordering::AcqRel) != rate {
            self.rebake();
        }
    }

    pub fn update(&self, next: EqSettings) {
        *self.settings.lock() = next;
        self.rebake();
    }

    /// Recompute every coefficient and publish the snapshot atomically.
    fn rebake(&self) {
        let cfg = self.settings.lock().clone();
        let sample_rate = self.sample_rate.load(Ordering::Acquire) as f32;
        let mut coeffs = [BiquadCoeffs::default(); 10];
        if cfg.enabled {
            for (i, &freq) in EQ_FREQUENCIES.iter().enumerate() {
                let gain = cfg.bands[i].clamp(-12.0, 12.0);
                coeffs[i] = match i {
                    0 => low_shelf(sample_rate, freq, gain),
                    9 => high_shelf(sample_rate, freq, gain),
                    _ => peaking_eq(sample_rate, freq, gain, 0.92),
                };
            }
        }
        let version = self.version.fetch_add(1, Ordering::AcqRel) + 1;
        self.baked.store(Arc::new(BakedEq {
            enabled: cfg.enabled,
            version,
            preamp_linear: 10.0_f32.powf(cfg.preamp.clamp(-12.0, 12.0) / 20.0),
            coeffs,
        }));
    }

    /// Read-only snapshot for the audio thread: one atomic load, no allocation.
    fn load(&self) -> arc_swap::Guard<Arc<BakedEq>> {
        self.baked.load()
    }
}

pub struct EqSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    bank: Arc<SharedEqBank>,
    seen_version: u64,
    enabled: bool,
    preamp_linear: f32,
    coeffs: [BiquadCoeffs; 10],
    states: Vec<[BiquadState; 10]>,
    channels: usize,
    channel_idx: usize,
}

impl<S> EqSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(inner: S, bank: Arc<SharedEqBank>) -> Self {
        let channels = (inner.channels() as usize).max(1);
        let sample_rate = (inner.sample_rate() as f32).max(8_000.0);
        let mut src = EqSource {
            inner,
            bank,
            seen_version: 0,
            enabled: false,
            preamp_linear: 1.0,
            coeffs: [BiquadCoeffs::default(); 10],
            states: vec![[BiquadState::default(); 10]; channels],
            channels,
            channel_idx: 0,
        };
        src.bank.set_sample_rate(sample_rate as u32);
        src.sync_params(true);
        src
    }

    /// Publish the newest snapshot into this source. Called once per block, so the
    /// only per-sample cost is the `enabled` check + 10 biquads (no lock, no trig).
    /// `reset_state` zeroes the filter memory so a coefficient jump cannot click.
    #[inline]
    fn sync_params(&mut self, reset_state: bool) {
        let snap = self.bank.load();
        if snap.version == self.seen_version {
            return;
        }
        self.seen_version = snap.version;
        self.enabled = snap.enabled;
        self.preamp_linear = snap.preamp_linear;
        self.coeffs = snap.coeffs;
        if reset_state {
            for ch in &mut self.states {
                *ch = [BiquadState::default(); 10];
            }
        }
    }
}

impl<S> Iterator for EqSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        if self.channel_idx == 0 {
            // Block boundary: pick up any new settings (one atomic load).
            self.sync_params(true);
        }
        let ch = self.channel_idx;
        self.channel_idx = (self.channel_idx + 1) % self.channels;

        if !self.enabled {
            return Some(sample);
        }

        let mut acc = sample * self.preamp_linear;
        let ch_state = &mut self.states[ch];
        for i in 0..10 {
            acc = ch_state[i].process(acc, &self.coeffs[i]);
        }
        // Gentle soft-clip knee above +/-0.95 to prevent digital harshness on bass boost
        let out = if acc.abs() > 0.95 {
            acc.signum() * (0.95 + 0.05 * ((acc.abs() - 0.95) * 4.0).tanh())
        } else {
            acc
        };
        Some(out)
    }
}

impl<S> Source for EqSource<S>
where
    S: Source<Item = f32>,
{
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        for ch in &mut self.states {
            *ch = [BiquadState::default(); 10];
        }
        self.inner.try_seek(pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    #[test]
    fn bypassed_eq_is_bit_exact() {
        let input: Vec<f32> = (0..256).map(|n| (n as f32 * 0.1).sin() * 0.5).collect();
        let buf = SamplesBuffer::new(2, 44_100, input.clone());
        let bank = SharedEqBank::new(EqSettings::default());
        let out: Vec<f32> = EqSource::new(buf, bank).collect();
        assert_eq!(input, out);
    }

    #[test]
    fn bass_boost_increases_low_frequency_energy() {
        let sr = 44_100.0_f32;
        let input: Vec<f32> = (0..4410)
            .map(|n| (2.0 * PI * 64.0 * (n as f32) / sr).sin() * 0.25)
            .collect();
        let mut boosted = EqSettings::default();
        boosted.enabled = true;
        boosted.bands[1] = 9.0; // +9 dB @ 64 Hz

        let buf = SamplesBuffer::new(1, 44_100, input.clone());
        let bank = SharedEqBank::new(boosted);
        let out: Vec<f32> = EqSource::new(buf, bank).collect();

        let rms_in: f32 = (input[1000..].iter().map(|x| x * x).sum::<f32>() / 3410.0).sqrt();
        let rms_out: f32 = (out[1000..].iter().map(|x| x * x).sum::<f32>() / 3410.0).sqrt();
        assert!(rms_out > rms_in * 1.8, "expected boosted RMS: in={rms_in}, out={rms_out}");
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use std::time::Instant;

    fn make_input(n: usize) -> Vec<f32> {
        (0..n).map(|i| ((i as f32) * 0.01).sin() * 0.3).collect()
    }

    fn ns_per_sample(enabled: bool, n: usize) -> f64 {
        let input = make_input(n);
        let mut cfg = EqSettings::default();
        cfg.enabled = enabled;
        if enabled {
            // realistic non-flat curve
            for i in 0..10 {
                cfg.bands[i] = (i as f32) - 5.0;
            }
        }
        let bank = SharedEqBank::new(cfg);
        let buf = SamplesBuffer::new(2, 44_100, input);
        let src = EqSource::new(buf, bank);
        let t = Instant::now();
        let mut acc = 0.0f32;
        let mut count = 0usize;
        for s in src {
            acc += s;
            count += 1;
        }
        let elapsed = t.elapsed().as_nanos() as f64;
        std::hint::black_box(acc);
        elapsed / count as f64
    }

    /// How long does recomputing all 10 biquad coefficient sets take?
    fn coeff_recompute_ns() -> f64 {
        let t = Instant::now();
        let reps = 10_000;
        for _ in 0..reps {
            let sr = 44_100.0f32;
            for (i, f) in EQ_FREQUENCIES.iter().enumerate() {
                let c = match i {
                    0 => low_shelf(sr, *f, 6.0),
                    9 => high_shelf(sr, *f, -3.0),
                    _ => peaking_eq(sr, *f, 4.0, 0.92),
                };
                std::hint::black_box(c);
            }
        }
        t.elapsed().as_nanos() as f64 / reps as f64
    }

    /// Worst case wait for the audio thread when the UI holds the EQ write lock.
    fn lock_wait_ns() -> f64 {
        use std::sync::Arc;
        let bank = SharedEqBank::new(EqSettings::default());
        let bank2 = Arc::clone(&bank);
        let mut worst = 0u128;
        for _ in 0..200 {
            let bank_for_writer = Arc::clone(&bank2);
            let writer = std::thread::spawn(move || {
                let _guard = bank_for_writer.settings.lock();
                std::thread::sleep(std::time::Duration::from_micros(200));
            });
            std::thread::sleep(std::time::Duration::from_micros(50));
            let t = Instant::now();
            let _cfg = bank.settings.lock().clone();
            worst = worst.max(t.elapsed().as_nanos());
            writer.join().unwrap();
        }
        worst as f64
    }

    #[test]
    fn measure_eq_costs() {
        let n = 200_000;
        let off = ns_per_sample(false, n);
        let on = ns_per_sample(true, n);
        let coeff = coeff_recompute_ns();
        let lock = lock_wait_ns();
        // Callback budget: one frame of 44.1 kHz stereo audio is 22.7 microseconds,
        // i.e. 11.3 us per sample, or 11 339 ns.
        let budget_ns = 1e9 / 44_100.0;
        println!("\n=== EQ COST MEASUREMENTS (44.1 kHz) ===");
        println!("EQ bypassed          : {off:8.1} ns/sample  ({:.3}% of frame budget)", off / budget_ns * 100.0);
        println!("EQ enabled (10 bands): {on:8.1} ns/sample  ({:.3}% of frame budget)", on / budget_ns * 100.0);
        println!("Delta from EQ        : {:8.1} ns/sample", on - off);
        println!("Coefficient recompute: {coeff:8.1} ns per settings change (10 filters)");
        println!("Worst lock wait      : {lock:8.1} ns when UI holds the write lock");
        println!("Frame budget         : {budget_ns:8.1} ns/sample");
        println!("======================================\n");
        assert!(on < budget_ns * 0.05, "EQ must stay well under 5% of budget");
    }
}
