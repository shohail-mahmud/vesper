//! Lock-free single-producer / single-consumer ring buffer of `f32` samples.
//!
//! Why this file exists
//! --------------------
//! The previous design wrapped a `VecDeque<f32>` in a `Mutex` and the audio
//! callback used `try_lock()`. A *busy* lock (the decode thread pushing) was
//! indistinguishable from an *empty* buffer, so the callback emitted `0.0` and
//! audio visibly stepped down to silence and back — an audible click.
//!
//! This is VLC's model in miniature: the decoder (producer) owns the write
//! position, the audio callback (consumer) owns the read position, and they
//! communicate only through atomics. Neither side ever blocks the other and no
//! allocation happens after construction, so the callback is wait-free on the
//! happy path.
//!
//! Memory model: the producer publishes samples with a `Release` store to `head`
//! after writing the slot; the consumer does an `Acquire` load of `head` before
//! reading slots, which makes those writes visible. The consumer publishes its
//! progress with a `Release` store to `tail`. No `unsafe` is used: slots are
//! `AtomicU32` holding `f32` bit patterns.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub struct SampleRing {
    slots: Box<[AtomicU32]>,
    mask: u64,
    /// Total samples ever written (producer-owned).
    head: AtomicU64,
    /// Total samples ever read (consumer-owned).
    tail: AtomicU64,
    /// Bumped by the producer on `clear()` so the consumer can resync its tail
    /// if it was mid-read when the flush happened.
    flush_seq: AtomicU64,
}

impl SampleRing {
    /// Round the requested capacity up to a power of two (minimum 1024 samples).
    pub fn with_capacity(samples: usize) -> Self {
        let mut cap = samples.max(1024).next_power_of_two() as u64;
        // Never allocate absurd amounts (a 32 s stereo 48 kHz buffer is ~3.1 M samples).
        cap = cap.min(1 << 23);
        let slots = (0..cap)
            .map(|_| AtomicU32::new(0))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        SampleRing {
            slots,
            mask: cap - 1,
            head: AtomicU64::new(0),
            tail: AtomicU64::new(0),
            flush_seq: AtomicU64::new(0),
        }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Samples currently available to read.
    pub fn len(&self) -> usize {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);
        head.saturating_sub(tail).min(self.capacity() as u64) as usize
    }

    /// Used by tests; kept public as part of the ring's small API.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Free space for the producer.
    pub fn space(&self) -> usize {
        self.capacity() - self.len()
    }

    pub fn buffered_seconds(&self, channels: u16, sample_rate: u32) -> f64 {
        let denom = channels.max(1) as f64 * sample_rate.max(8_000) as f64;
        self.len() as f64 / denom
    }

    /// Producer side: append samples, returning how many were actually written
    /// (fewer than `samples.len()` when the ring is nearly full).
    pub fn push_slice(&self, samples: &[f32]) -> usize {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        let used = head.saturating_sub(tail).min(self.capacity() as u64);
        let space = (self.capacity() as u64 - used) as usize;
        let n = samples.len().min(space);
        if n == 0 {
            return 0;
        }
        for (i, sample) in samples[..n].iter().enumerate() {
            let idx = ((head + i as u64) & self.mask) as usize;
            self.slots[idx].store(sample.to_bits(), Ordering::Relaxed);
        }
        // Publish: everything written above is visible to the consumer.
        self.head.store(head + n as u64, Ordering::Release);
        n
    }

    /// Consumer side (audio callback): take one sample. Never blocks, never allocates.
    pub fn pop(&self) -> Option<f32> {
        let seq = self.flush_seq.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        if tail == head {
            // Re-sync if a flush landed between our two loads.
            if self.flush_seq.load(Ordering::Acquire) != seq {
                self.tail.store(self.head.load(Ordering::Acquire), Ordering::Release);
            }
            return None;
        }
        let idx = (tail & self.mask) as usize;
        let bits = self.slots[idx].load(Ordering::Relaxed);
        self.tail.store(tail + 1, Ordering::Release);

        // If the producer flushed while we were reading, jump to the new head so
        // we never replay stale audio after a seek. At most one sample is skipped.
        if self.flush_seq.load(Ordering::Acquire) != seq {
            self.tail
                .store(self.head.load(Ordering::Acquire), Ordering::Release);
        }
        Some(f32::from_bits(bits))
    }

    /// Producer side: drop everything unread (used when seeking / stopping).
    pub fn clear(&self) {
        let head = self.head.load(Ordering::Relaxed);
        self.flush_seq.fetch_add(1, Ordering::Release);
        self.tail.store(head, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn round_trips_values_in_order() {
        let ring = SampleRing::with_capacity(1024);
        let input: Vec<f32> = (0..1000).map(|i| i as f32 * 0.5).collect();
        assert_eq!(ring.push_slice(&input), 1000);
        assert_eq!(ring.len(), 1000);
        let out: Vec<f32> = std::iter::from_fn(|| ring.pop()).collect();
        assert_eq!(out, input);
        assert!(ring.is_empty());
    }

    #[test]
    fn empty_ring_returns_none() {
        let ring = SampleRing::with_capacity(1024);
        assert_eq!(ring.pop(), None);
        assert_eq!(ring.len(), 0);
    }

    #[test]
    fn refuses_to_overwrite_and_reports_written() {
        let ring = SampleRing::with_capacity(1024); // rounds to 1024
        let cap = ring.capacity();
        let big = vec![1.0f32; cap + 500];
        assert_eq!(ring.push_slice(&big), cap);
        assert_eq!(ring.space(), 0);
        assert_eq!(ring.push_slice(&[2.0]), 0, "full ring must not overwrite");
        assert_eq!(ring.pop(), Some(1.0));
    }

    #[test]
    fn wraps_around_many_times() {
        let ring = SampleRing::with_capacity(1024);
        let cap = ring.capacity();
        let mut expected = Vec::new();
        let mut got = Vec::new();
        for round in 0..50u32 {
            let chunk: Vec<f32> = (0..200).map(|i| (round * 200 + i) as f32).collect();
            expected.extend_from_slice(&chunk);
            while ring.push_slice(&chunk) < chunk.len() {}
            while let Some(v) = ring.pop() {
                got.push(v);
            }
        }
        assert!(expected.len() > cap * 9, "must exercise wrap-around");
        assert_eq!(got, expected);
    }

    #[test]
    fn clear_discards_unread_samples() {
        let ring = SampleRing::with_capacity(1024);
        ring.push_slice(&[1.0, 2.0, 3.0]);
        assert_eq!(ring.pop(), Some(1.0));
        ring.clear();
        assert_eq!(ring.pop(), None, "after clear nothing stale is replayed");
        ring.push_slice(&[9.0]);
        assert_eq!(ring.pop(), Some(9.0));
    }

    /// The property that matters: a real producer thread and a real consumer
    /// thread, hammering concurrently, must lose or reorder nothing.
    #[test]
    fn concurrent_producer_consumer_is_lossless() {
        const TOTAL: usize = 400_000;
        let ring = Arc::new(SampleRing::with_capacity(8_192));
        let producer_ring = Arc::clone(&ring);

        let producer = std::thread::spawn(move || {
            let mut written = 0usize;
            while written < TOTAL {
                let chunk: Vec<f32> = (written..(written + 256).min(TOTAL))
                    .map(|i| i as f32)
                    .collect();
                let n = producer_ring.push_slice(&chunk);
                if n == 0 {
                    std::hint::spin_loop();
                }
                written += n;
            }
            written
        });

        let mut received = 0usize;
        let mut expected_next = 0.0f32;
        while received < TOTAL {
            match ring.pop() {
                Some(v) => {
                    assert_eq!(v, expected_next, "sample {received} out of order");
                    expected_next += 1.0;
                    received += 1;
                }
                None => std::hint::spin_loop(),
            }
        }
        assert_eq!(producer.join().unwrap(), TOTAL);
        assert!(ring.pop().is_none());
    }
}
