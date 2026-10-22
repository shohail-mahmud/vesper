//! Real-time 10-band Audio EQ Cookbook Biquad Equalizer wrapping any `rodio::Source`.
//!
//! Bands: 32 Hz (low-shelf), 64 Hz, 125 Hz, 250 Hz, 500 Hz, 1 kHz, 2 kHz, 4 kHz,
//! 8 kHz (peaking EQ), 16 kHz (high-shelf), plus preamp gain (-12..+12 dB) and
//! soft limiter headroom guard so heavy bass boosts never clip harshly.

use std::f32::consts::PI;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use rodio::Source;

use crate::model::EqSettings;

pub const EQ_FREQUENCIES: [f32; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Copy, Debug)]
struct BiquadCoeffs {
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

#[derive(Default)]
pub struct SharedEqBank {
    version: AtomicU64,
    settings: RwLock<EqSettings>,
}

impl SharedEqBank {
    pub fn new(initial: EqSettings) -> Arc<Self> {
        Arc::new(SharedEqBank {
            version: AtomicU64::new(1),
            settings: RwLock::new(initial),
        })
    }

    pub fn update(&self, next: EqSettings) {
        *self.settings.write() = next;
        self.version.fetch_add(1, Ordering::Release);
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
    sample_rate: f32,
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
            sample_rate,
        };
        src.sync_params();
        src
    }

    fn sync_params(&mut self) {
        let v = self.bank.version.load(Ordering::Acquire);
        if v == self.seen_version {
            return;
        }
        self.seen_version = v;
        let cfg = self.bank.settings.read().clone();
        self.enabled = cfg.enabled;
        self.preamp_linear = 10.0_f32.powf(cfg.preamp.clamp(-12.0, 12.0) / 20.0);
        for (i, &freq) in EQ_FREQUENCIES.iter().enumerate() {
            let gain = cfg.bands[i].clamp(-12.0, 12.0);
            self.coeffs[i] = match i {
                0 => low_shelf(self.sample_rate, freq, gain),
                9 => high_shelf(self.sample_rate, freq, gain),
                _ => peaking_eq(self.sample_rate, freq, gain, 0.92),
            };
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
            self.sync_params();
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
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
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
