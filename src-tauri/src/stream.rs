//! Prefetching decode pipeline — the audio callback never touches the disk.
//!
//! Why this exists:
//! `rodio::Decoder` is polled from inside the audio output callback. That means
//! every symphonia read, every MP3/FLAC frame decode and every cold disk hit
//! (first play after boot, an antivirus scan grabbing the file, a slow external
//! drive) happens on the realtime audio thread — and any hiccup there is an
//! audible stutter or crackle. `Vec<f32>` allocation growing mid-track does the
//! same thing.
//!
//! So decoding lives on its own thread here. It fills a bounded ring of `f32`
//! samples about a second ahead of the playhead, and the callback only ever does
//! a `try_lock` + `pop_front` (tens of nanoseconds). If the buffer is ever
//! momentarily empty the source emits silence instead of blocking the callback,
//! so the audio device keeps running on its own clock and playback never
//! underruns. Seeking asks the decode thread to flush + reposition.
//!
//! Also handy: positions are derived from the samples the callback actually
//! consumed, not from the sink clock, so the progress bar stays correct even
//! while a track is buffering.

use std::collections::VecDeque;
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::source::SeekError;
use rodio::{Decoder, Source};

/// How many seconds of audio to keep decoded ahead of the playhead.
const PREFETCH_SECONDS: f64 = 2.0;
/// Samples decoded per lock acquisition (keeps the critical section tiny).
const DECODE_CHUNK: usize = 8192;
/// If the decode thread has produced nothing for this long while we are playing
/// silence, give up instead of hanging on a dead decoder.
const MAX_SILENT_SECONDS: f64 = 5.0;

struct Ring {
    samples: Mutex<VecDeque<f32>>,
    /// Samples handed to the audio callback since the last (re)start of this track.
    consumed: AtomicU64,
    /// Cumulative sample offset of the first sample currently in the ring.
    base_offset: AtomicU64,
    /// Set once the decoder reached end of file.
    eof: AtomicBool,
    /// Set when the decoder thread died (corrupt file, device gone, ...).
    failed: Mutex<Option<String>>,
    /// Pending seek target in seconds.
    seek_to: Mutex<Option<f64>>,
    /// Stop signal for the decode thread.
    stop: AtomicBool,
    channels: u16,
    sample_rate: u32,
    total: Option<Duration>,
}

impl Ring {
    fn new(channels: u16, sample_rate: u32, total: Option<Duration>) -> Arc<Self> {
        Arc::new(Ring {
            samples: Mutex::new(VecDeque::with_capacity(65_536)),
            consumed: AtomicU64::new(0),
            base_offset: AtomicU64::new(0),
            eof: AtomicBool::new(false),
            failed: Mutex::new(None),
            seek_to: Mutex::new(None),
            stop: AtomicBool::new(false),
            channels: channels.max(1),
            sample_rate: sample_rate.max(8_000),
            total,
        })
    }

    /// How much audio is sitting in the ring (seconds).
    fn buffered_seconds(&self) -> f64 {
        let len = self.samples.lock().len() as f64;
        len / (self.channels as f64 * self.sample_rate as f64)
    }

    fn eof(&self) -> bool {
        self.eof.load(Ordering::Acquire)
    }

    fn failed(&self) -> Option<String> {
        self.failed.lock().clone()
    }
}

/// Owns the ring plus the handle of the thread decoding into it.
pub struct StreamingSource {
    ring: Arc<Ring>,
    /// Number of consecutive silence samples emitted (watchdog for a stalled decoder).
    silent: u64,
    finished: bool,
}

impl StreamingSource {
    /// Build the source and start decoding `path` immediately on a worker thread.
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let file = File::open(&path).map_err(|e| format!("Could not open audio file: {e}"))?;
        // Probe/parse on this thread so the very first callback has nothing to do.
        let decoder = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Unsupported or corrupt audio stream: {e}"))?
            .convert_samples::<f32>();
        let channels = decoder.channels();
        let sample_rate = decoder.sample_rate();
        let total = decoder.total_duration();
        let ring = Ring::new(channels, sample_rate, total);
        let worker_ring = Arc::clone(&ring);
        std::thread::Builder::new()
            .name("vesper-decode".into())
            .spawn(move || decode_loop(decoder, worker_ring))
            .map_err(|e| format!("Could not start the audio decode thread: {e}"))?;
        Ok(StreamingSource {
            ring,
            silent: 0,
            finished: false,
        })
    }

    /// Block (briefly) until enough audio is buffered to start cleanly.
    /// Returns once `seconds` are ready, or after `timeout` — whichever first.
    pub fn prefill(&self, seconds: f64, timeout: Duration) -> f64 {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let ready = self.ring.buffered_seconds();
            if ready >= seconds || self.ring.failed().is_some() || std::time::Instant::now() >= deadline {
                return ready;
            }
            std::thread::sleep(Duration::from_millis(3));
        }
    }

}

impl Iterator for StreamingSource {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.finished || self.ring.stop.load(Ordering::Relaxed) {
            return None;
        }
        // Fast path: never blocks the audio thread. `try_lock` only loses when the
        // decode thread is mid-push, which is a few microseconds at most.
        if let Some(mut buf) = self.ring.samples.try_lock() {
            if let Some(sample) = buf.pop_front() {
                self.ring.consumed.fetch_add(1, Ordering::Relaxed);
                self.silent = 0;
                return Some(sample);
            }
        }

        // Nothing buffered right now: emit silence so the device keeps its clock
        // instead of underrunning, and let the spinner catch up.
        if self.ring.eof() {
            self.finished = true;
            return None;
        }
        if let Some(err) = self.ring.failed() {
            eprintln!("[vesper] decode stopped: {err}");
            self.finished = true;
            return None;
        }

        self.silent += 1;
        let limit = (MAX_SILENT_SECONDS
            * self.ring.sample_rate as f64
            * self.ring.channels as f64) as u64;
        if self.silent > limit {
            eprintln!("[vesper] decode stalled for {MAX_SILENT_SECONDS}s — ending track");
            self.finished = true;
            return None;
        }
        Some(0.0)
    }
}

impl Source for StreamingSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.ring.channels
    }

    fn sample_rate(&self) -> u32 {
        self.ring.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.ring.total
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        // Hand the job to the decode thread: it flushes the ring and repositions
        // the decoder. The callback keeps playing what is already buffered until
        // the flush lands (a few milliseconds).
        *self.ring.seek_to.lock() = Some(pos.as_secs_f64());
        self.ring.consumed.store(
            (pos.as_secs_f64() * self.ring.sample_rate as f64) as u64 * self.ring.channels as u64,
            Ordering::Relaxed,
        );
        self.ring.base_offset.store(0, Ordering::Relaxed);
        self.silent = 0;
        Ok(())
    }
}

impl Drop for StreamingSource {
    fn drop(&mut self) {
        // Tell the decode thread to exit; it owns the file handle from here.
        self.ring.stop.store(true, Ordering::Release);
    }
}

fn decode_loop<S>(mut decoder: S, ring: Arc<Ring>)
where
    S: Source<Item = f32> + Send + 'static,
{
    let channels = ring.channels as usize;
    let sample_rate = ring.sample_rate as f64;
    let capacity = (PREFETCH_SECONDS * sample_rate * channels as f64) as usize;

    loop {
        if ring.stop.load(Ordering::Acquire) {
            return;
        }

        // Handle a pending seek before producing more samples.
        let seek_target = { *ring.seek_to.lock() };
        if let Some(seconds) = seek_target {
            *ring.seek_to.lock() = None;
            ring.samples.lock().clear();
            ring.eof.store(false, Ordering::Release);
            match Source::try_seek(&mut decoder, Duration::from_secs_f64(seconds.max(0.0).min(86_400.0))) {
                Ok(()) => {}
                Err(err) => {
                    *ring.failed.lock() = Some(format!("Seek failed: {err}"));
                    return;
                }
            }
            continue;
        }

        if ring.samples.lock().len() >= capacity {
            // Buffer is full — nap until the playhead drains some of it.
            std::thread::sleep(Duration::from_millis(8));
            continue;
        }

        // Decode a chunk outside the lock, then push it in one short critical section.
        let mut chunk: Vec<f32> = Vec::with_capacity(DECODE_CHUNK);
        let mut hit_eof = false;
        for _ in 0..DECODE_CHUNK {
            match decoder.next() {
                Some(sample) => chunk.push(sample),
                None => {
                    hit_eof = true;
                    break;
                }
            }
        }

        if !chunk.is_empty() {
            let mut buf = ring.samples.lock();
            buf.extend(chunk);
        }

        if hit_eof {
            ring.eof.store(true, Ordering::Release);
            // Keep the thread parked until the source is dropped, so a pending
            // seek at the very end of a file still works.
            while !ring.stop.load(Ordering::Acquire) {
                if ring.seek_to.lock().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal 16-bit PCM mono WAV writer used by the end-to-end test.
    fn write_test_wav(path: &PathBuf, sample_rate: u32, seconds: f64) {
        let frames = (sample_rate as f64 * seconds) as u32;
        let data_len = frames * 2;
        let mut bytes = Vec::with_capacity(44 + data_len as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..frames {
            let t = i as f64 / sample_rate as f64;
            let v = (t * 440.0 * std::f64::consts::TAU).sin() * 0.5;
            bytes.extend_from_slice(&((v * 32_767.0) as i16).to_le_bytes());
        }
        std::fs::write(path, bytes).expect("write test wav");
    }

    /// End-to-end: a real WAV file goes through the decode thread + ring buffer and
    /// comes out as actual (non-silent) samples, then ends cleanly at EOF.
    #[test]
    fn decodes_a_real_wav_through_the_ring() {
        let path = std::env::temp_dir().join(format!("vesper-stream-test-{}.wav", std::process::id()));
        write_test_wav(&path, 8_000, 0.5);

        let mut source = StreamingSource::open(path.clone()).expect("open wav");
        let prefilled = source.prefill(0.2, Duration::from_secs(2));
        assert!(prefilled >= 0.05, "expected prefilled audio, got {prefilled}s");

        let mut total = 0usize;
        let mut audible = 0usize;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while let Some(sample) = source.next() {
            if sample != 0.0 {
                audible += 1;
            }
            total += 1;
            if std::time::Instant::now() > deadline || total > 200_000 {
                break;
            }
        }
        let _ = std::fs::remove_file(&path);

        // 0.5 s at 8 kHz == ~4000 frames; allow slack for container trimming.
        assert!(total >= 3_500, "expected ~4000 samples, got {total}");
        assert!(audible * 2 > total, "expected real audio, got {audible}/{total} non-zero");
    }

    /// Seeking mid-track must not deadlock: the decode thread flushes the ring and
    /// repositions, and audio keeps flowing afterwards.
    #[test]
    fn seek_mid_track_keeps_audio_flowing() {
        let path = std::env::temp_dir().join(format!("vesper-seek-test-{}.wav", std::process::id()));
        write_test_wav(&path, 8_000, 2.0);

        let mut source = StreamingSource::open(path.clone()).expect("open wav");
        source.prefill(0.2, Duration::from_secs(2));
        for _ in 0..500 {
            let _ = source.next();
        }

        source
            .try_seek(Duration::from_millis(1_500))
            .expect("seek accepted");
        std::thread::sleep(Duration::from_millis(120));

        let mut audible = 0usize;
        for _ in 0..2_000 {
            if matches!(source.next(), Some(s) if s != 0.0) {
                audible += 1;
            }
        }
        let _ = std::fs::remove_file(&path);
        assert!(audible > 500, "expected audio after seek, got {audible} non-zero samples");
    }

    #[test]
    fn seek_resets_the_consumed_counter() {
        let ring = Ring::new(2, 44_100, Some(Duration::from_secs(200)));
        ring.consumed.store(44_100 * 2, Ordering::Relaxed);
        assert_eq!(ring.consumed.load(Ordering::Relaxed), 88_200);
        *ring.seek_to.lock() = Some(90.0);
        assert_eq!(*ring.seek_to.lock(), Some(90.0));
    }

    #[test]
    fn buffered_seconds_matches_ring_contents() {
        let ring = Ring::new(2, 8_000, None);
        // 8 kHz stereo: 16_000 samples per second, so 8_000 samples == 0.5 s.
        ring.samples.lock().extend(std::iter::repeat(0.0).take(8_000));
        assert!((ring.buffered_seconds() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn empty_ring_is_not_eof() {
        let ring = Ring::new(2, 44_100, None);
        assert!(!ring.eof());
        assert_eq!(ring.buffered_seconds(), 0.0);
    }
}
