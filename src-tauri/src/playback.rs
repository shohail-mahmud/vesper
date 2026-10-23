//! Dedicated-thread native audio engine (`rodio` + `symphonia` + 10-band Biquad EQ).
//!
//! Architecture:
//!  • `rodio::OutputStream` wraps OS-specific WASAPI/ALSA handles that are `!Send + !Sync`,
//!    so it cannot sit directly inside `tauri::State<AppState>`.
//!  • A dedicated background audio worker thread owns the `OutputStream` and `Sink`,
//!    receiving `AudioCommand`s over an `mpsc` channel and updating `SharedState`
//!    (`Arc<Mutex<...>>`) for lock-free inspection from any Tauri window, the System
//!    or Windows SMTC media transport controls.
//!  • If no audio device is connected when Vesper starts, startup still succeeds and
//!    the worker automatically attempts to open the default output stream when playback
//!    is requested later.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::{OutputStream, OutputStreamBuilder, Sink, Source};

use crate::eq::{EqSource, SharedEqBank};
use crate::stream::StreamingSource;
use crate::model::{EqSettings, PlaybackStateEvent, PlaybackStatus, RepeatMode};

#[derive(Debug, Clone)]
pub struct QueueItem {
    pub id: String,
    pub path: String,
    pub duration: f64,
}

enum AudioCommand {
    SetQueue {
        items: Vec<QueueItem>,
        start_index: usize,
        shuffle: bool,
        autoplay: bool,
        start_position: f64,
    },
    Play,
    Pause,
    Toggle,
    Stop,
    Seek(f64),
    Next,
    Previous,
    SetVolume {
        volume: f64,
        muted: bool,
    },
    SetSpeed(f64),
    SetEq(EqSettings),
    SetShuffle(bool),
    SetRepeat(RepeatMode),
    Enqueue {
        item: QueueItem,
        play_next: bool,
    },
    RemoveQueueIndex(usize),
    MoveQueueItem {
        from: usize,
        to: usize,
    },
    JumpToIndex(usize),
    Tick,
}

#[derive(Clone)]
pub struct PlaybackService {
    tx: Sender<AudioCommand>,
    shared: Arc<Mutex<PlaybackStateEvent>>,
    eq_bank: Arc<SharedEqBank>,
}

/// True non-deterministic PRNG seeded from system nanosecond clock + atomic counter.
fn random_usize(bound: usize) -> usize {
    static COUNTER: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x517cc1b727220a95);
    let mut z = COUNTER
        .fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed)
        .wrapping_add(nanos);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z = z ^ (z >> 31);
    (z as usize) % bound.max(1)
}

fn shuffle_in_place(items: &mut [QueueItem]) {
    if items.len() < 2 {
        return;
    }
    for i in (1..items.len()).rev() {
        let j = random_usize(i + 1);
        items.swap(i, j);
    }
}

/// Requested output buffer depth, in frames.
///
/// `OutputStreamBuilder::open_default_stream()` asks cpal for
/// `BufferSize::Default`, which WASAPI turns into `hnsBufferDuration = 0` -
/// "let Windows decide". In shared mode that lands on the engine period,
/// typically ~10 ms. Ten milliseconds of tank runs dry the moment a network or
/// GPU driver holds the CPU in a DPC/ISR longer than that, which is the click
/// heard while browsing or scrolling. Everything upstream (4 s prefetch,
/// lock-free ring, in-RAM files) rides out such a stall easily; only the device
/// buffer could not.
///
/// 2048 frames is ~43 ms at 48 kHz and ~46 ms at 44.1 kHz - roughly four times
/// the tolerance, and still far below anything audible as latency for music.
const DEVICE_BUFFER_FRAMES: u32 = 2048;

/// Open the default output stream with a fixed, deeper device buffer.
///
/// Falls back to the previous behaviour (letting Windows choose the period)
/// whenever the driver rejects a fixed size. A device that says no must never
/// cost the user their sound.
fn open_output_stream(device_lost: &Arc<AtomicBool>) -> Result<OutputStream, String> {
    // rodio 0.21 makes `Sink::connect_new` infallible, so the old
    // "Audio output stream lost" branch has nowhere to fire. The builder's error
    // callback replaces it: if the endpoint dies (Bluetooth headphones switching,
    // a USB DAC unplugged) we raise a flag and the next play reopens the device.
    let make_callback = |flag: Arc<AtomicBool>| {
        move |err: rodio::cpal::StreamError| {
            eprintln!("[vesper] output stream error: {err}");
            flag.store(true, Ordering::Release);
        }
    };

    // Fixed depth first - this is the whole point of the function. The order
    // matters: trying `open_default_stream()` first would succeed with the
    // shallower buffer and silently never apply the fix.
    let fixed = OutputStreamBuilder::from_default_device().and_then(|b| {
        b.with_buffer_size(rodio::cpal::BufferSize::Fixed(DEVICE_BUFFER_FRAMES))
            .with_error_callback(make_callback(Arc::clone(device_lost)))
            .open_stream()
    });

    match fixed {
        Ok(stream) => Ok(stream),
        // Some drivers reject a fixed size outright; let Windows choose again
        // rather than leaving the user without sound.
        Err(_) => OutputStreamBuilder::from_default_device()
            .map(|b| b.with_error_callback(make_callback(Arc::clone(device_lost))).open_stream())
            .unwrap_or_else(|e| Err(e))
            .map_err(|e| format!("{e}")),
    }
}

struct WorkerState {
    stream: Option<OutputStream>,
    /// Set by the output stream's error callback when the endpoint disappears.
    device_lost: Arc<AtomicBool>,
    sink: Option<Sink>,
    queue: Vec<QueueItem>,
    base_queue: Vec<QueueItem>,
    shared: Arc<Mutex<PlaybackStateEvent>>,
    eq_bank: Arc<SharedEqBank>,
}

impl WorkerState {
    fn ensure_device(&mut self) -> Result<&OutputStream, String> {
        if self.device_lost.swap(false, Ordering::AcqRel) {
            // The stream reported a device error: drop it and reopen below.
            self.stream = None;
            self.sink = None;
        }
        if self.stream.is_none() {
            match open_output_stream(&self.device_lost) {
                Ok(stream) => {
                    self.stream = Some(stream);
                    self.shared.lock().device_available = true;
                }
                Err(err) => {
                    let mut st = self.shared.lock();
                    st.device_available = false;
                    let msg = format!("No audio output device available: {err}");
                    st.error = Some(msg.clone());
                    return Err(msg);
                }
            }
        }
        Ok(self.stream.as_ref().unwrap())
    }

    fn effective_volume(&self) -> f32 {
        let st = self.shared.lock();
        if st.muted {
            0.0
        } else {
            st.volume.clamp(0.0, 1.0) as f32
        }
    }

    fn sync_queue_ids(&self) {
        let mut st = self.shared.lock();
        st.queue = self.queue.iter().map(|i| i.id.clone()).collect();
        st.base_queue = self.base_queue.iter().map(|i| i.id.clone()).collect();
    }

    fn rebuild_order(&mut self, current_id: Option<&str>, shuffle: bool) {
        if !shuffle {
            self.queue = self.base_queue.clone();
        } else {
            let mut rest: Vec<QueueItem> = self
                .base_queue
                .iter()
                .filter(|item| Some(item.id.as_str()) != current_id)
                .cloned()
                .collect();
            shuffle_in_place(&mut rest);
            let mut order = Vec::with_capacity(self.base_queue.len());
            if let Some(current) = self
                .base_queue
                .iter()
                .find(|item| Some(item.id.as_str()) == current_id)
            {
                order.push(current.clone());
            }
            order.extend(rest);
            self.queue = order;
        }
        if let Some(id) = current_id {
            if let Some(pos) = self.queue.iter().position(|item| item.id == id) {
                self.shared.lock().index = pos as i64;
            }
        }
        self.sync_queue_ids();
    }

    /// Ramp the current sink to silence over ~25 ms, then stop it. A hard `stop()`
    /// cuts the waveform mid-cycle and is heard as a click at every track change.
    fn fade_out_and_stop(&mut self, steps: u32) {
        if let Some(sink) = self.sink.take() {
            let start = sink.volume();
            for i in 1..=steps {
                let f = 1.0 - (i as f32 / steps as f32);
                sink.set_volume(start * f);
                std::thread::sleep(Duration::from_millis(4));
            }
            sink.stop();
        }
    }

    /// Fade a freshly appended sink up from silence to the requested volume.
    fn fade_in(&self, sink: &Sink, target: f32, steps: u32) {
        sink.set_volume(0.0);
        for i in 1..=steps {
            let f = i as f32 / steps as f32;
            sink.set_volume(target * f);
            std::thread::sleep(Duration::from_millis(4));
        }
    }

    fn load_and_play(&mut self, index: usize, autoplay: bool, start_pos: f64) {
        let Some(item) = self.queue.get(index).cloned() else {
            self.stop();
            return;
        };

        let path = Path::new(&item.path);
        if !path.exists() {
            let mut st = self.shared.lock();
            st.status = PlaybackStatus::Error;
            st.track_id = Some(item.id.clone());
            st.index = index as i64;
            st.error = Some(format!("File not found: {}", item.path));
            return;
        }

        // Fade the outgoing track instead of cutting it (removes the end-of-track pop).
        self.fade_out_and_stop(6);

        let (volume, speed) = {
            let st = self.shared.lock();
            let vol = if st.muted { 0.0 } else { st.volume.clamp(0.0, 1.0) as f32 };
            (vol, st.speed.clamp(0.5, 2.0) as f32)
        };
        let eq_bank = Arc::clone(&self.eq_bank);

        let handle = match self.ensure_device() {
            Ok(h) => h,
            Err(err) => {
                let mut st = self.shared.lock();
                st.status = if autoplay {
                    PlaybackStatus::Error
                } else {
                    PlaybackStatus::Paused
                };
                st.track_id = Some(item.id.clone());
                st.index = index as i64;
                st.duration = item.duration;
                st.position = start_pos.max(0.0);
                if autoplay {
                    st.error = Some(err);
                }
                return;
            }
        };

        // Decoding happens on its own thread (see `stream.rs`); the audio callback
        // only pops samples from a ring buffer. This is what removes the random
        // crackle/stutter caused by disk reads and symphonia decoding running
        // inside the realtime callback.
        let mut streamed = match StreamingSource::open(path.to_path_buf()) {
            Ok(s) => s,
            Err(err) => {
                let mut st = self.shared.lock();
                st.status = PlaybackStatus::Error;
                st.track_id = Some(item.id.clone());
                st.index = index as i64;
                st.error = Some(err);
                return;
            }
        };

        if start_pos > 0.05 {
            let _ = streamed.try_seek(std::time::Duration::from_secs_f64(start_pos));
        }
        // Wait for half a second of decoded audio so playback starts clean instead
        // of with a burst of silence while the decoder warms up. The generous
        // timeout is fine: this runs on the audio worker thread, never the callback.
        streamed.prefill(0.50, std::time::Duration::from_millis(900));

        let probed_duration = streamed
            .total_duration()
            .map(|d| d.as_secs_f64())
            .filter(|&d| d > 0.0)
            .unwrap_or(item.duration);

        let filtered = EqSource::new(streamed, eq_bank);

        let sink = Sink::connect_new(handle.mixer());

        sink.set_speed(speed);
        sink.append(filtered);
        if autoplay {
            sink.play();
            self.fade_in(&sink, volume, 6);
        } else {
            sink.set_volume(volume);
            sink.pause();
        }

        self.sink = Some(sink);
        let mut st = self.shared.lock();
        st.status = if autoplay {
            PlaybackStatus::Playing
        } else {
            PlaybackStatus::Paused
        };
        st.track_id = Some(item.id);
        st.index = index as i64;
        st.position = start_pos.max(0.0);
        st.duration = probed_duration;
        st.error = None;
    }

    fn stop(&mut self) {
        self.fade_out_and_stop(6);
        let mut st = self.shared.lock();
        st.status = PlaybackStatus::Idle;
        st.track_id = None;
        st.position = 0.0;
        st.duration = 0.0;
        st.index = -1;
        st.error = None;
    }

    fn next(&mut self, auto_advance: bool) {
        let (index, repeat) = {
            let st = self.shared.lock();
            (st.index, st.repeat)
        };
        let len = self.queue.len() as i64;
        if len == 0 {
            return;
        }
        if repeat == RepeatMode::One && auto_advance && index >= 0 {
            self.load_and_play(index as usize, true, 0.0);
            return;
        }
        let target = if index + 1 < len {
            Some((index + 1) as usize)
        } else if repeat == RepeatMode::All || (!auto_advance && repeat == RepeatMode::One) {
            Some(0)
        } else {
            None
        };

        if let Some(next_idx) = target {
            self.load_and_play(next_idx, true, 0.0);
        } else {
            if let Some(sink) = self.sink.as_ref() {
                sink.pause();
            }
            let mut st = self.shared.lock();
            st.status = PlaybackStatus::Paused;
            st.position = st.duration;
        }
    }

    fn previous(&mut self) {
        let (index, position) = {
            let st = self.shared.lock();
            (st.index, st.position)
        };
        if position > 3.0 || index <= 0 {
            self.seek(0.0);
            return;
        }
        self.load_and_play((index - 1) as usize, true, 0.0);
    }

    fn seek(&mut self, seconds: f64) {
        let clamped = seconds.max(0.0);
        if let Some(sink) = self.sink.as_ref() {
            if sink.try_seek(Duration::from_secs_f64(clamped)).is_ok() {
                self.shared.lock().position = clamped;
                return;
            }
        }
        self.shared.lock().position = clamped;
    }

    fn tick(&mut self) {
        let finished = match self.sink.as_ref() {
            Some(sink) => {
                let is_playing = matches!(self.shared.lock().status, PlaybackStatus::Playing);
                is_playing && sink.empty()
            }
            None => false,
        };

        if finished {
            self.next(true);
            return;
        }

        if let Some(sink) = self.sink.as_ref() {
            let pos = sink.get_pos().as_secs_f64();
            let mut st = self.shared.lock();
            if matches!(st.status, PlaybackStatus::Playing) {
                st.position = pos;
            }
        }
    }
}

impl PlaybackService {
    pub fn new(initial_eq: EqSettings) -> Self {
        let eq_bank = SharedEqBank::new(initial_eq.clone());
        let mut initial_state = PlaybackStateEvent::default();
        initial_state.eq = initial_eq;
        let shared = Arc::new(Mutex::new(initial_state));

        let (tx, rx) = mpsc::channel::<AudioCommand>();
        let worker_shared = Arc::clone(&shared);
        let worker_eq = Arc::clone(&eq_bank);

        std::thread::Builder::new()
            .name("vesper-audio".into())
            .spawn(move || {
                let device_lost = Arc::new(AtomicBool::new(false));
                let mut worker = WorkerState {
                    stream: open_output_stream(&device_lost).ok(),
                    device_lost,
                    sink: None,
                    queue: Vec::new(),
                    base_queue: Vec::new(),
                    shared: worker_shared,
                    eq_bank: worker_eq,
                };
                worker.shared.lock().device_available = worker.stream.is_some();

                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        AudioCommand::SetQueue {
                            items,
                            start_index,
                            shuffle,
                            autoplay,
                            start_position,
                        } => {
                            let target_id = items.get(start_index).map(|i| i.id.clone());
                            worker.base_queue = items;
                            worker.shared.lock().shuffle = shuffle;
                            worker.rebuild_order(target_id.as_deref(), shuffle);
                            let resolved_idx = target_id
                                .as_deref()
                                .and_then(|id| worker.queue.iter().position(|i| i.id == id))
                                .unwrap_or(0);
                            worker.load_and_play(resolved_idx, autoplay, start_position);
                        }
                        AudioCommand::Play => {
                            if let Some(sink) = worker.sink.as_ref() {
                                sink.play();
                                worker.shared.lock().status = PlaybackStatus::Playing;
                            } else {
                                let (idx, pos) = {
                                    let st = worker.shared.lock();
                                    (st.index.max(0) as usize, st.position)
                                };
                                if !worker.queue.is_empty() {
                                    worker.load_and_play(idx, true, pos);
                                }
                            }
                        }
                        AudioCommand::Pause => {
                            if let Some(sink) = worker.sink.as_ref() {
                                sink.pause();
                            }
                            worker.shared.lock().status = PlaybackStatus::Paused;
                        }
                        AudioCommand::Toggle => {
                            let playing =
                                matches!(worker.shared.lock().status, PlaybackStatus::Playing);
                            if playing {
                                if let Some(sink) = worker.sink.as_ref() {
                                    sink.pause();
                                }
                                worker.shared.lock().status = PlaybackStatus::Paused;
                            } else if let Some(sink) = worker.sink.as_ref() {
                                sink.play();
                                worker.shared.lock().status = PlaybackStatus::Playing;
                            } else if !worker.queue.is_empty() {
                                let (idx, pos) = {
                                    let st = worker.shared.lock();
                                    (st.index.max(0) as usize, st.position)
                                };
                                worker.load_and_play(idx, true, pos);
                            }
                        }
                        AudioCommand::Stop => worker.stop(),
                        AudioCommand::Seek(sec) => worker.seek(sec),
                        AudioCommand::Next => worker.next(false),
                        AudioCommand::Previous => worker.previous(),
                        AudioCommand::SetVolume { volume, muted } => {
                            {
                                let mut st = worker.shared.lock();
                                st.volume = volume.clamp(0.0, 1.0);
                                st.muted = muted;
                            }
                            let eff = worker.effective_volume();
                            if let Some(sink) = worker.sink.as_ref() {
                                sink.set_volume(eff);
                            }
                        }
                        AudioCommand::SetSpeed(speed) => {
                            let clamped = speed.clamp(0.5, 2.0);
                            worker.shared.lock().speed = clamped;
                            if let Some(sink) = worker.sink.as_ref() {
                                sink.set_speed(clamped as f32);
                            }
                        }
                        AudioCommand::SetEq(eq) => {
                            worker.eq_bank.update(eq.clone());
                            worker.shared.lock().eq = eq;
                        }
                        AudioCommand::SetShuffle(shuffle) => {
                            let current = worker.shared.lock().track_id.clone();
                            worker.shared.lock().shuffle = shuffle;
                            worker.rebuild_order(current.as_deref(), shuffle);
                        }
                        AudioCommand::SetRepeat(repeat) => {
                            worker.shared.lock().repeat = repeat;
                        }
                        AudioCommand::Enqueue { item, play_next } => {
                            let insert_at = if play_next {
                                let idx = worker.shared.lock().index;
                                ((idx + 1).max(0) as usize).min(worker.queue.len())
                            } else {
                                worker.queue.len()
                            };
                            worker.queue.insert(insert_at, item.clone());
                            worker.base_queue.push(item);
                            worker.sync_queue_ids();
                            if worker.queue.len() == 1 {
                                worker.load_and_play(0, true, 0.0);
                            }
                        }
                        AudioCommand::RemoveQueueIndex(idx) => {
                            if idx < worker.queue.len() {
                                let removed = worker.queue.remove(idx);
                                worker.base_queue.retain(|i| i.id != removed.id);
                                let current_idx = worker.shared.lock().index;
                                if idx as i64 == current_idx {
                                    if worker.queue.is_empty() {
                                        worker.stop();
                                    } else {
                                        let next_i = idx.min(worker.queue.len() - 1);
                                        worker.load_and_play(next_i, true, 0.0);
                                    }
                                } else if (idx as i64) < current_idx {
                                    worker.shared.lock().index = current_idx - 1;
                                }
                                worker.sync_queue_ids();
                            }
                        }
                        AudioCommand::MoveQueueItem { from, to } => {
                            if from < worker.queue.len() && to < worker.queue.len() && from != to {
                                let current_id = worker.shared.lock().track_id.clone();
                                let item = worker.queue.remove(from);
                                worker.queue.insert(to, item);
                                if let Some(id) = current_id {
                                    if let Some(pos) = worker.queue.iter().position(|i| i.id == id)
                                    {
                                        worker.shared.lock().index = pos as i64;
                                    }
                                }
                                worker.sync_queue_ids();
                            }
                        }
                        AudioCommand::JumpToIndex(idx) => {
                            if idx < worker.queue.len() {
                                worker.load_and_play(idx, true, 0.0);
                            }
                        }
                        AudioCommand::Tick => worker.tick(),
                    }
                }
            })
            .expect("failed to spawn Vesper audio thread");

        PlaybackService {
            tx,
            shared,
            eq_bank,
        }
    }

    pub fn state(&self) -> PlaybackStateEvent {
        self.shared.lock().clone()
    }

    pub fn set_queue(
        &self,
        items: Vec<QueueItem>,
        start_index: usize,
        shuffle: bool,
        autoplay: bool,
        start_position: f64,
    ) {
        let _ = self.tx.send(AudioCommand::SetQueue {
            items,
            start_index,
            shuffle,
            autoplay,
            start_position,
        });
    }

    pub fn play(&self) {
        let _ = self.tx.send(AudioCommand::Play);
    }

    pub fn pause(&self) {
        let _ = self.tx.send(AudioCommand::Pause);
    }

    pub fn toggle(&self) {
        let _ = self.tx.send(AudioCommand::Toggle);
    }

    pub fn stop(&self) {
        let _ = self.tx.send(AudioCommand::Stop);
    }

    pub fn seek(&self, seconds: f64) {
        let _ = self.tx.send(AudioCommand::Seek(seconds));
    }

    pub fn next(&self) {
        let _ = self.tx.send(AudioCommand::Next);
    }

    pub fn previous(&self) {
        let _ = self.tx.send(AudioCommand::Previous);
    }

    pub fn set_volume(&self, volume: f64, muted: bool) {
        let _ = self.tx.send(AudioCommand::SetVolume { volume, muted });
    }

    pub fn set_speed(&self, speed: f64) {
        let _ = self.tx.send(AudioCommand::SetSpeed(speed));
    }

    pub fn set_eq(&self, eq: EqSettings) {
        self.eq_bank.update(eq.clone());
        let _ = self.tx.send(AudioCommand::SetEq(eq));
    }

    pub fn set_shuffle(&self, shuffle: bool) {
        let _ = self.tx.send(AudioCommand::SetShuffle(shuffle));
    }

    pub fn set_repeat(&self, repeat: RepeatMode) {
        let _ = self.tx.send(AudioCommand::SetRepeat(repeat));
    }

    pub fn enqueue(&self, item: QueueItem, play_next: bool) {
        let _ = self.tx.send(AudioCommand::Enqueue { item, play_next });
    }

    pub fn remove_queue_index(&self, index: usize) {
        let _ = self.tx.send(AudioCommand::RemoveQueueIndex(index));
    }

    pub fn move_queue_item(&self, from: usize, to: usize) {
        let _ = self.tx.send(AudioCommand::MoveQueueItem { from, to });
    }

    pub fn jump_to_index(&self, index: usize) {
        let _ = self.tx.send(AudioCommand::JumpToIndex(index));
    }

    pub fn tick(&self) {
        let _ = self.tx.send(AudioCommand::Tick);
    }
}
