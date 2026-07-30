use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, SyncSender},
};

const SNAPSHOT_MIN_INTERVAL_MS_DEFAULT: u64 = 5_000;

pub(super) struct SnapshotWriter {
    sender: SyncSender<SnapshotMessage>,
    regular_write_outstanding: Arc<AtomicBool>,
}

enum SnapshotMessage {
    Write(SnapshotJob),
    WriteAndFlush(SnapshotJob, SyncSender<io::Result<()>>),
}

struct SnapshotJob {
    snapshot_path: Option<PathBuf>,
    snapshot: Option<RuntimeSnapshot>,
    resident_continuity_path: Option<PathBuf>,
    resident_continuity: Option<ResidentContinuitySnapshot>,
    event_store_path: Option<PathBuf>,
    compact_after_snapshot: bool,
    retained_world_event_limit: usize,
    through_event_seq: u64,
}

impl SnapshotWriter {
    pub(super) fn spawn() -> io::Result<Self> {
        let (sender, receiver) = mpsc::sync_channel(1);
        let regular_write_outstanding = Arc::new(AtomicBool::new(false));
        let worker_outstanding = Arc::clone(&regular_write_outstanding);
        std::thread::Builder::new()
            .name("cosyworld-snapshot-writer".to_string())
            .spawn(move || {
                while let Ok(message) = receiver.recv() {
                    match message {
                        SnapshotMessage::Write(job) => {
                            if let Err(error) = job.write() {
                                warn!("failed to persist coalesced CosyWorld snapshot: {error}");
                            }
                            worker_outstanding.store(false, Ordering::Release);
                        }
                        SnapshotMessage::WriteAndFlush(job, result) => {
                            let _ = result.send(job.write());
                        }
                    }
                }
            })
            .map_err(|error| io::Error::other(format!("spawn snapshot writer: {error}")))?;
        Ok(Self {
            sender,
            regular_write_outstanding,
        })
    }

    fn try_claim_regular_write(&self) -> bool {
        self.regular_write_outstanding
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn schedule_claimed(&self, job: SnapshotJob) -> io::Result<()> {
        self.sender
            .send(SnapshotMessage::Write(job))
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "snapshot writer stopped"))
    }

    fn release_regular_write(&self) {
        self.regular_write_outstanding
            .store(false, Ordering::Release);
    }

    fn write_and_flush(&self, job: SnapshotJob) -> io::Result<()> {
        let (result_tx, result_rx) = mpsc::sync_channel(1);
        self.sender
            .send(SnapshotMessage::WriteAndFlush(job, result_tx))
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "snapshot writer stopped"))?;
        result_rx
            .recv()
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "snapshot writer stopped"))?
    }
}

impl SnapshotJob {
    fn capture(state: &AppState, runtime: &RuntimeWorld) -> Self {
        Self {
            snapshot_path: state
                .snapshot_path
                .as_deref()
                .map(PathBuf::as_path)
                .map(PathBuf::from),
            snapshot: state
                .snapshot_path
                .as_ref()
                .map(|_| RuntimeSnapshot::from_runtime(runtime)),
            resident_continuity_path: state
                .resident_continuity_path
                .as_deref()
                .map(PathBuf::as_path)
                .map(PathBuf::from),
            resident_continuity: state
                .resident_continuity_path
                .as_ref()
                .map(|_| ResidentContinuitySnapshot::from_runtime(runtime)),
            event_store_path: state
                .event_store_path
                .as_deref()
                .map(PathBuf::as_path)
                .map(PathBuf::from),
            compact_after_snapshot: persistence_compaction_enabled()
                && !state.canonical_routing.enabled()
                && state.canonical_recovery.is_none(),
            retained_world_event_limit: retained_world_event_limit(),
            through_event_seq: runtime.world.next_event_seq.saturating_sub(1),
        }
    }

    fn write(self) -> io::Result<()> {
        let snapshot_saved = match (self.snapshot_path.as_deref(), self.snapshot.as_ref()) {
            (Some(path), Some(snapshot)) => {
                write_json_atomically(path, snapshot, snapshot_temp_path(path))?;
                true
            }
            _ => false,
        };
        if snapshot_saved && self.compact_after_snapshot {
            if let (Some(path), Some(snapshot)) =
                (self.event_store_path.as_deref(), self.snapshot.as_ref())
            {
                match journal_checkpoint::compact_event_store_after_snapshot(
                    path,
                    snapshot.action_journal_seq,
                    self.through_event_seq,
                    self.retained_world_event_limit,
                ) {
                    Ok(report)
                        if report.deleted_action_journal_rows > 0
                            || report.deleted_canonical_commit_rows > 0
                            || report.deleted_world_event_rows > 0 =>
                    {
                        info!(
                            "compacted CosyWorld persistence through journal {}, canonical commit {}, and event {}; deleted {} journal row(s), {} canonical commit row(s), and {} event row(s)",
                            report.action_journal_floor_seq,
                            report.canonical_commit_floor_journal_seq,
                            report.world_event_floor_seq,
                            report.deleted_action_journal_rows,
                            report.deleted_canonical_commit_rows,
                            report.deleted_world_event_rows
                        );
                    }
                    Ok(_) => {}
                    Err(error) => warn!(
                        "failed to compact CosyWorld event store {} after snapshot: {}",
                        path.display(),
                        error
                    ),
                }
            }
        }
        if let (Some(path), Some(snapshot)) = (
            self.resident_continuity_path.as_deref(),
            self.resident_continuity.as_ref(),
        ) {
            write_json_atomically(path, snapshot, path.with_extension("json.tmp"))?;
        }
        Ok(())
    }
}

fn write_json_atomically<T: Serialize>(
    path: &Path,
    value: &T,
    temporary_path: PathBuf,
) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&temporary_path, bytes)?;
    fs::rename(temporary_path, path)?;
    Ok(())
}

pub(super) fn snapshot_temp_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

pub(super) fn remove_stale_snapshot_temp(path: &Path) -> io::Result<bool> {
    let temp = snapshot_temp_path(path);
    match fs::remove_file(&temp) {
        Ok(()) => {
            info!(
                "removed stale CosyWorld snapshot temporary file {}",
                temp.display()
            );
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn snapshot_min_interval_ms() -> u64 {
    std::env::var("COSYWORLD_V2_SNAPSHOT_MIN_INTERVAL_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(SNAPSHOT_MIN_INTERVAL_MS_DEFAULT)
}

pub(super) fn persistence_compaction_enabled() -> bool {
    std::env::var("COSYWORLD_V2_PERSISTENCE_COMPACTION")
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off" | "disabled"
            )
        })
        .unwrap_or(true)
}

pub(super) fn retained_world_event_limit() -> usize {
    std::env::var("COSYWORLD_V2_RETAINED_WORLD_EVENTS")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value >= MAX_EVENT_STORE_SCAN)
        .unwrap_or(DEFAULT_RETAINED_WORLD_EVENTS)
}

pub(super) fn persist_runtime(state: &AppState, runtime: &RuntimeWorld) {
    let now = now_millis();
    let last = state.last_snapshot_at_ms.load(AtomicOrdering::Relaxed);
    if last != 0 && now.saturating_sub(last) < snapshot_min_interval_ms() {
        return;
    }
    let Some(writer) = state.snapshot_writer.as_deref() else {
        state
            .last_snapshot_at_ms
            .store(now, AtomicOrdering::Relaxed);
        if let Err(error) = SnapshotJob::capture(state, runtime).write() {
            warn!("failed to persist CosyWorld snapshot: {error}");
        }
        return;
    };
    if !writer.try_claim_regular_write() {
        return;
    }
    if let Err(error) = writer.schedule_claimed(SnapshotJob::capture(state, runtime)) {
        writer.release_regular_write();
        warn!("failed to schedule CosyWorld snapshot: {error}");
        return;
    }
    state
        .last_snapshot_at_ms
        .store(now, AtomicOrdering::Relaxed);
}

pub(super) fn persist_runtime_now(state: &AppState, runtime: &RuntimeWorld) {
    let job = SnapshotJob::capture(state, runtime);
    let result = match state.snapshot_writer.as_deref() {
        Some(writer) => writer.write_and_flush(job),
        None => job.write(),
    };
    if let Err(error) = result {
        warn!("failed to flush CosyWorld snapshot: {error}");
    }
    state
        .last_snapshot_at_ms
        .store(now_millis(), AtomicOrdering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forced_flush_cannot_be_overwritten_by_an_older_coalesced_snapshot() {
        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-ordered-snapshot-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_file(&snapshot_path);
        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.snapshot_writer = Some(Arc::new(SnapshotWriter::spawn().expect("snapshot writer")));
        let mut runtime = RuntimeWorld::seeded();

        persist_runtime(&state, &runtime);
        runtime.world.tick = runtime.world.tick.saturating_add(7);
        persist_runtime_now(&state, &runtime);

        let restored = RuntimeWorld::load_snapshot(&snapshot_path).expect("latest snapshot loads");
        assert_eq!(restored.world.tick, runtime.world.tick);
        let _ = fs::remove_file(snapshot_path);
    }
}
