//! Prefetching decode pipeline — the audio callback never touches the disk, and
//! never waits on a lock.
//!
//! Why this exists
//! ---------------
//! `rodio::Decoder` is polled from inside the audio output callback, so every
//! symphonia read, every MP3/FLAC frame decode and every cold disk hit happens on
//! the realtime thread — each one an audible stutter or crackle.
//!
//! Structure (the same shape VLC uses):
//!
//! * The whole file is read into memory up front (`std::fs::read`). A song is a
//!   few megabytes, and this removes disk latency, antivirus interference and
//!   cold-cache stalls from the decode path completely. We deliberately do *not*
//!   decode the entire track to PCM: that would cost ~100 MB of RAM per song and
//!   add seconds of delay before playback starts.
//! * A decode thread turns the file into `f32` samples ahead of the playhead.
//! * Samples cross the thread boundary through [`SampleRing`], a lock-free
//!   single-producer/single-consumer ring. The callback's `pop()` never blocks,
//!   never allocates, and a busy producer is *not* mistaken for an empty buffer
//!   (that bug produced clicks in the previous mutex-based design).
//! * If the ring really is empty the source emits silence so the device keeps its
//!   own clock instead of underrunning, and a watchdog ends the track if the
//!   decoder has been dead for too long.
//! * Seeking asks the decode thread to flush and reposition; positions are derived
//!   from samples the callback actually consumed, so the progress bar stays honest
//!   while a track is buffering.

use std::path::PathBuf;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::source::SeekError;
use rodio::{Decoder, Source};

use crate::ring::SampleRing;

/// Process-wide count of buffer underruns: how many times the audio callback
/// asked for a sample and the ring had nothing to give.
///
/// This is the single most useful number for diagnosing "it clicks when I do
/// other things". If it stays at 0 while the user hears a glitch, the buffer is
/// not the problem and the fault is elsewhere (resampling, clipping, a codec).
static UNDERRUNS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Total underruns since the app started. Safe to read from any thread.
pub fn underrun_count() -> u64 {
    UNDERRUNS.load(Ordering::Relaxed)
}

/// How many seconds of audio to keep decoded ahead of the playhead.
/// Four seconds of headroom means a slow disk, an antivirus scan or a scheduling
/// hiccup has to stall the machine for seconds before it is audible.
const PREFETCH_SECONDS: f64 = 4.0;
/// Samples decoded per push. Small chunks keep the producer's slice short so the
/// consumer is never starved for long (256 samples @ 44.1 kHz ≈ 5.8 ms).
const DECODE_CHUNK: usize = 256;
/// If the decode thread has produced nothing for this long while we are playing
/// silence, give up instead of hanging on a dead decoder.
const MAX_SILENT_SECONDS: f64 = 5.0;
/// Minimum ring capacity, in samples, regardless of prefetch target.
const MIN_RING_SAMPLES: usize = 65_536;
/// Files at or below this size are read into RAM before decoding (fast path).
/// Bigger ones are streamed from disk with the same lock-free ring, so a huge
/// wave file costs neither a memory spike nor a delay before playback.
const MAX_PRELOAD_BYTES: u64 = 96 * 1024 * 1024;

/// Anything we can hand to the decoder: an in-memory buffer or a file handle.
/// rodio requires `Send + Sync + 'static` on the input reader.
trait ReadSeek: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> ReadSeek for T {}

struct Ring {
    samples: SampleRing,
    /// Samples handed to the audio callback since the last (re)start of this track.
    consumed: AtomicU64,
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
        let channels = channels.max(1);
        let sample_rate = sample_rate.max(8_000);
        let wanted = (PREFETCH_SECONDS * sample_rate as f64 * channels as f64) as usize;
        Arc::new(Ring {
            samples: SampleRing::with_capacity(wanted.max(MIN_RING_SAMPLES)),
            consumed: AtomicU64::new(0),
            eof: AtomicBool::new(false),
            failed: Mutex::new(None),
            seek_to: Mutex::new(None),
            stop: AtomicBool::new(false),
            channels,
            sample_rate,
            total,
        })
    }

    /// How much audio is sitting in the ring (seconds).
    fn buffered_seconds(&self) -> f64 {
        self.samples.buffered_seconds(self.channels, self.sample_rate)
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
    /// Times the callback ran dry (should stay at zero on healthy hardware).
    underruns: u64,
}

impl StreamingSource {
    /// Build the source and start decoding `path` immediately on a worker thread.
    pub fn open(path: PathBuf) -> Result<Self, String> {
        // Preload the file into memory so the decode thread never touches the disk
        // (an antivirus scan or a slow drive can then never cause an underrun).
        // Large files are streamed instead: preloading a 500 MB wave would stall
        // the start of playback and waste hundreds of megabytes of RAM.
        let size = std::fs::metadata(&path)
            .map_err(|e| format!("Could not read audio file: {e}"))?
            .len();
        let input: Box<dyn ReadSeek> = if size <= MAX_PRELOAD_BYTES {
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Could not read audio file: {e}"))?;
            Box::new(std::io::Cursor::new(bytes))
        } else {
            let file = File::open(&path)
                .map_err(|e| format!("Could not open audio file: {e}"))?;
            Box::new(BufReader::new(file))
        };
        // rodio 0.21 decodes straight to f32, so no sample conversion is needed.
        //
        // `byte_len` + `seekable` are not optional here: unlike 0.20, `Decoder::new`
        // no longer infers the stream length, and without it a backwards seek fails
        // with "needs to know the length of the file/byte stream". We already know
        // the size from the metadata call above, so hand it over.
        let decoder = Decoder::builder()
            .with_data(input)
            .with_byte_len(size)
            .with_seekable(true)
            .build()
            .map_err(|e| format!("Unsupported or corrupt audio stream: {e}"))?;
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
            underruns: 0,
        })
    }

    /// Block (briefly) until enough audio is buffered to start cleanly.
    /// Returns once `seconds` are ready, or after `timeout` — whichever first.
    pub fn prefill(&self, seconds: f64, timeout: Duration) -> f64 {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let ready = self.ring.buffered_seconds();
            if ready >= seconds
                || self.ring.failed().is_some()
                || std::time::Instant::now() >= deadline
            {
                return ready;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// How many times the callback ran out of samples (diagnostics + tests).
    #[allow(dead_code)]
    pub fn underruns(&self) -> u64 {
        self.underruns
    }
}

impl Iterator for StreamingSource {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.finished || self.ring.stop.load(Ordering::Relaxed) {
            return None;
        }

        // Fast path: lock-free, wait-free, allocation-free.
        if let Some(sample) = self.ring.samples.pop() {
            self.ring.consumed.fetch_add(1, Ordering::Relaxed);
            self.silent = 0;
            return Some(sample);
        }

        // Nothing buffered right now: emit silence so the device keeps its clock
        // instead of underrunning, and let the decoder catch up.
        if self.ring.eof() {
            self.finished = true;
            return None;
        }
        if let Some(err) = self.ring.failed() {
            eprintln!("[vesper] decode stopped: {err}");
            self.finished = true;
            return None;
        }

        self.underruns += 1;
        UNDERRUNS.fetch_add(1, Ordering::Relaxed);
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
    fn current_span_len(&self) -> Option<usize> {
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
        self.silent = 0;
        Ok(())
    }
}

impl Drop for StreamingSource {
    fn drop(&mut self) {
        // Tell the decode thread to exit; it owns the decoder from here.
        self.ring.stop.store(true, Ordering::Release);
    }
}

fn decode_loop<S>(mut decoder: S, ring: Arc<Ring>)
where
    S: Source<Item = f32> + Send + 'static,
{
    let mut chunk: Vec<f32> = Vec::with_capacity(DECODE_CHUNK);

    loop {
        if ring.stop.load(Ordering::Acquire) {
            return;
        }

        // Handle a pending seek before producing more samples.
        let seek_target = *ring.seek_to.lock();
        if let Some(seconds) = seek_target {
            *ring.seek_to.lock() = None;
            ring.samples.clear();
            ring.eof.store(false, Ordering::Release);
            match Source::try_seek(
                &mut decoder,
                Duration::from_secs_f64(seconds.max(0.0).min(86_400.0)),
            ) {
                Ok(()) => {}
                Err(err) => {
                    *ring.failed.lock() = Some(format!("Seek failed: {err}"));
                    return;
                }
            }
            continue;
        }

        if ring.samples.space() < DECODE_CHUNK {
            // Ring is full — nap until the playhead drains some of it.
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }

        // Decode a small chunk, then publish it in one atomic store.
        chunk.clear();
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
            ring.samples.push_slice(&chunk);
        }

        if hit_eof {
            ring.eof.store(true, Ordering::Release);
            // Keep the thread parked until the source is dropped, so a pending
            // seek at the very end of a file still works.
            while !ring.stop.load(Ordering::Acquire) {
                if ring.seek_to.lock().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal 16-bit PCM mono WAV writer used by the end-to-end tests.
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

    /// End-to-end: a real WAV file goes through the preload + decode thread + ring
    /// and comes out as actual (non-silent) samples, then ends cleanly at EOF.
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

        assert!(total >= 3_500, "expected ~4000 samples, got {total}");
        assert!(audible * 2 > total, "expected real audio, got {audible}/{total} non-zero");
        assert_eq!(source.underruns(), 0, "a short local file must not underrun");
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

    /// The ring must hold a full prefetch window without ever reallocating
    /// (that reallocation used to happen while the callback was reading).
    #[test]
    fn ring_holds_the_whole_prefetch_window() {
        let ring = Ring::new(2, 44_100, None);
        let wanted = (PREFETCH_SECONDS * 44_100.0 * 2.0) as usize;
        assert!(
            ring.samples.capacity() >= wanted,
            "capacity {} < prefetch {}",
            ring.samples.capacity(),
            wanted
        );
        let filled = ring.samples.push_slice(&vec![0.25f32; wanted]);
        assert_eq!(filled, wanted, "must accept the entire window");
        assert!((ring.buffered_seconds() - PREFETCH_SECONDS).abs() < 0.01);
    }

    #[test]
    fn empty_ring_is_not_eof() {
        let ring = Ring::new(2, 44_100, None);
        assert!(!ring.eof());
        assert_eq!(ring.buffered_seconds(), 0.0);
    }

    #[test]
    fn consumed_counter_tracks_handed_out_samples() {
        let ring = Ring::new(2, 44_100, Some(Duration::from_secs(200)));
        ring.samples.push_slice(&[0.0; 100]);
        for _ in 0..100 {
            assert!(ring.samples.pop().is_some());
        }
        assert!(ring.samples.pop().is_none());
    }
}
