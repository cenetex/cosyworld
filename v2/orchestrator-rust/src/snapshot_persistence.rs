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

    fn checkpoint_cursor_is_durable(&self) -> bool {
        let (Some(path), Some(snapshot)) =
            (self.event_store_path.as_deref(), self.snapshot.as_ref())
        else {
            return true;
        };
        let committed_seq = match open_event_store(path)
            .and_then(|conn| current_world_seq(&conn, OFFICIAL_WORLD_ID))
        {
            Ok(committed_seq) => committed_seq,
            Err(_) => return true,
        };
        if committed_seq != 0 && snapshot.next_event_seq > committed_seq.saturating_add(1) {
            error!(
                "refusing to checkpoint CosyWorld snapshot: captured event cursor {} leads the \
                 durable commit point {}; keeping the previous checkpoint",
                snapshot.next_event_seq, committed_seq
            );
            return false;
        }
        let journal_head = match durable_action_journal_head(path) {
            Ok(journal_head) => journal_head,
            Err(error) => {
                error!(
                    "refusing to checkpoint CosyWorld snapshot: could not prove the action-journal \
                     head is durable: {error}"
                );
                return false;
            }
        };
        if snapshot.action_journal_seq > journal_head {
            error!(
                "refusing to checkpoint CosyWorld snapshot: captured action-journal cursor {} \
                 leads the durable journal head {}; keeping the previous checkpoint",
                snapshot.action_journal_seq, journal_head
            );
            return false;
        }
        true
    }

    fn write(self) -> io::Result<()> {
        let cursor_is_durable = self.checkpoint_cursor_is_durable();
        let snapshot_saved = match (self.snapshot_path.as_deref(), self.snapshot.as_ref()) {
            (Some(path), Some(snapshot)) if cursor_is_durable => {
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

const DEFAULT_INCREMENTAL_VACUUM_PAGES: u32 = 512;
const MAX_INCREMENTAL_VACUUM_PAGES: u32 = 8_192;
const MAX_GENERATED_ASSET_SCAN: usize = 20_000;

pub(super) fn retained_world_event_limit() -> usize {
    std::env::var("COSYWORLD_V2_RETAINED_WORLD_EVENTS")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value >= MAX_EVENT_STORE_SCAN)
        .unwrap_or(DEFAULT_RETAINED_WORLD_EVENTS)
}

pub(super) fn incremental_vacuum_page_budget() -> u32 {
    std::env::var("COSYWORLD_V2_INCREMENTAL_VACUUM_PAGES")
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(DEFAULT_INCREMENTAL_VACUUM_PAGES)
        .min(MAX_INCREMENTAL_VACUUM_PAGES)
}

pub(super) fn auto_vacuum_mode_label(mode: u64) -> &'static str {
    match mode {
        1 => "full",
        2 => "incremental",
        _ => "none",
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct PersistenceStorageReport {
    pub(super) event_store_bytes: Option<u64>,
    pub(super) event_store_live_bytes: Option<u64>,
    pub(super) event_store_reusable_bytes: Option<u64>,
    pub(super) event_store_auto_vacuum: Option<&'static str>,
    pub(super) generated_asset_bytes: Option<u64>,
    pub(super) generated_asset_count: Option<u64>,
    pub(super) snapshot_bytes: Option<u64>,
    pub(super) snapshot_temp_bytes: Option<u64>,
}

fn generated_asset_usage(root: &Path) -> Option<(u64, u64)> {
    let mut pending = vec![root.to_path_buf()];
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut visited = 0usize;
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_GENERATED_ASSET_SCAN {
                return Some((bytes, files));
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                pending.push(entry.path());
            } else if let Ok(meta) = entry.metadata() {
                bytes = bytes.saturating_add(meta.len());
                files = files.saturating_add(1);
            }
        }
    }
    Some((bytes, files))
}

pub(super) fn persistence_storage_report(
    event_store_path: Option<&Path>,
    snapshot_path: Option<&Path>,
    generated_asset_dir: Option<&Path>,
) -> PersistenceStorageReport {
    let snapshot_bytes =
        snapshot_path.and_then(|path| fs::metadata(path).ok().map(|meta| meta.len()));
    let snapshot_temp_bytes = snapshot_path.and_then(|path| {
        fs::metadata(snapshot_temp_path(path))
            .ok()
            .map(|meta| meta.len())
    });
    let generated = generated_asset_dir
        .filter(|dir| dir.is_dir())
        .and_then(generated_asset_usage);
    let Some(event_store_path) = event_store_path else {
        return PersistenceStorageReport {
            snapshot_bytes,
            snapshot_temp_bytes,
            generated_asset_bytes: generated.map(|usage| usage.0),
            generated_asset_count: generated.map(|usage| usage.1),
            ..PersistenceStorageReport::default()
        };
    };
    let event_store_bytes = fs::metadata(event_store_path).ok().map(|meta| meta.len());
    let sqlite_stats = open_event_store(event_store_path).ok().and_then(|conn| {
        let page_count = conn
            .query_row("PRAGMA page_count", [], |row| row.get::<_, u64>(0))
            .ok()?;
        let free_pages = conn
            .query_row("PRAGMA freelist_count", [], |row| row.get::<_, u64>(0))
            .ok()?;
        let page_size = conn
            .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
            .ok()?;
        let auto_vacuum = conn
            .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, u64>(0))
            .ok()?;
        Some((
            page_count
                .saturating_sub(free_pages)
                .saturating_mul(page_size),
            free_pages.saturating_mul(page_size),
            auto_vacuum_mode_label(auto_vacuum),
        ))
    });
    PersistenceStorageReport {
        event_store_bytes,
        event_store_live_bytes: sqlite_stats.map(|stats| stats.0),
        event_store_reusable_bytes: sqlite_stats.map(|stats| stats.1),
        event_store_auto_vacuum: sqlite_stats.map(|stats| stats.2),
        generated_asset_bytes: generated.map(|usage| usage.0),
        generated_asset_count: generated.map(|usage| usage.1),
        snapshot_bytes,
        snapshot_temp_bytes,
    }
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
    fn the_storage_report_names_the_auto_vacuum_mode_and_measures_generated_art() {
        let root = std::env::temp_dir().join(format!(
            "cosyworld-storage-report-{}-{}",
            std::process::id(),
            now_millis()
        ));
        let store_path = root.join("events.sqlite");
        let generated = root.join("generated");
        fs::create_dir_all(generated.join("cards")).expect("generated art fixture");
        fs::write(generated.join("cards").join("one.webp"), vec![7u8; 512])
            .expect("write art fixture");
        fs::write(generated.join("loose.webp"), vec![7u8; 256]).expect("write art fixture");
        init_event_store(&store_path).expect("initialize storage-report fixture");

        let report = persistence_storage_report(Some(&store_path), None, Some(&generated));
        assert_eq!(
            report.event_store_auto_vacuum,
            Some("incremental"),
            "a store created by this runtime must be able to return pages",
        );
        assert_eq!(report.generated_asset_bytes, Some(768));
        assert_eq!(
            report.generated_asset_count,
            Some(2),
            "nested art counts too, or the biggest directory reports as empty",
        );
        assert!(report.event_store_bytes.unwrap_or_default() > 0);

        let missing = persistence_storage_report(None, None, Some(&root.join("absent")));
        assert_eq!(missing.generated_asset_bytes, None);
        assert_eq!(missing.event_store_auto_vacuum, None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn auto_vacuum_labels_cover_every_sqlite_mode() {
        assert_eq!(auto_vacuum_mode_label(0), "none");
        assert_eq!(auto_vacuum_mode_label(1), "full");
        assert_eq!(auto_vacuum_mode_label(2), "incremental");
    }

    #[test]
    fn the_incremental_vacuum_budget_stays_bounded() {
        let budget = incremental_vacuum_page_budget();
        assert_eq!(budget, DEFAULT_INCREMENTAL_VACUUM_PAGES);
        assert!(budget <= MAX_INCREMENTAL_VACUUM_PAGES);
    }

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

    #[test]
    fn a_checkpoint_that_leads_the_commit_point_is_refused() {
        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-torn-cursor-snapshot-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let store_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-torn-cursor-store-{}-{}.sqlite",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_file(&snapshot_path);
        let _ = fs::remove_file(&store_path);

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(store_path.clone()));
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.snapshot_writer = Some(Arc::new(SnapshotWriter::spawn().expect("snapshot writer")));
        append_event_store(
            &store_path,
            &[EventView {
                seq: 1,
                type_name: "actor.presence".to_string(),
                success: true,
                location_id: Some(1),
                content: Some("active".to_string()),
                ..EventView::default()
            }],
        )
        .expect("append durable event");

        let mut runtime = RuntimeWorld::seeded();
        runtime.world.next_event_seq = 2;
        runtime.world.tick = 11;
        persist_runtime_now(&state, &runtime);
        let durable = RuntimeWorld::load_snapshot(&snapshot_path).expect("durable snapshot loads");
        assert_eq!(durable.world.tick, 11);

        runtime.world.next_event_seq = 5;
        runtime.world.tick = 22;
        persist_runtime_now(&state, &runtime);
        let kept = RuntimeWorld::load_snapshot(&snapshot_path).expect("previous snapshot survives");
        assert_eq!(kept.world.tick, 11);

        let _ = fs::remove_file(snapshot_path);
        let _ = fs::remove_file(store_path);
    }

    fn fixture_action_journal_record(seed: u64) -> JournalRecord {
        let content_id = 900_000 + seed;
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id: RATI_ACTOR_ID,
                content_id,
                ..CwAction::default()
            },
            seed,
        );
        record
            .content_upserts
            .insert(content_id, format!("checkpoint fixture {seed}"));
        record
    }

    #[test]
    fn a_checkpoint_that_leads_the_action_journal_head_is_refused() {
        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-torn-journal-cursor-snapshot-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let store_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-torn-journal-cursor-store-{}-{}.sqlite",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_file(&snapshot_path);
        let _ = fs::remove_file(&store_path);

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(store_path.clone()));
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.snapshot_writer = Some(Arc::new(SnapshotWriter::spawn().expect("snapshot writer")));
        append_event_store(
            &store_path,
            &[EventView {
                seq: 1,
                type_name: "actor.presence".to_string(),
                success: true,
                location_id: Some(1),
                content: Some("active".to_string()),
                ..EventView::default()
            }],
        )
        .expect("append durable event");
        append_action_journal(&store_path, &fixture_action_journal_record(1))
            .expect("append durable action journal record");

        let mut runtime = RuntimeWorld::seeded();
        runtime.world.next_event_seq = 2;
        runtime.action_journal_seq = 1;
        runtime.world.tick = 11;
        persist_runtime_now(&state, &runtime);
        let durable = RuntimeWorld::load_snapshot(&snapshot_path).expect("durable snapshot loads");
        assert_eq!(durable.world.tick, 11);

        runtime.action_journal_seq = 5;
        runtime.world.tick = 22;
        persist_runtime_now(&state, &runtime);
        let kept = RuntimeWorld::load_snapshot(&snapshot_path).expect("previous snapshot survives");
        assert_eq!(kept.world.tick, 11);
        assert_eq!(kept.action_journal_seq, 1);

        let _ = fs::remove_file(snapshot_path);
        let _ = fs::remove_file(store_path);
    }

    #[test]
    fn an_accepted_checkpoint_cites_only_journal_rows_that_survive_losing_the_wal() {
        let store_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-durable-head-store-{}-{}.sqlite",
            std::process::id(),
            now_millis()
        ));
        let salvaged_path = store_path.with_extension("salvaged.sqlite");
        let _ = fs::remove_file(&store_path);
        let _ = fs::remove_file(&salvaged_path);

        append_action_journal(&store_path, &fixture_action_journal_record(1))
            .expect("seed the store so it exists");
        let keepalive =
            open_event_store_keepalive(&store_path).expect("process-lifetime WAL keepalive");
        for seed in 2..=6 {
            append_action_journal(&store_path, &fixture_action_journal_record(seed))
                .expect("append action journal record");
        }

        let head = durable_action_journal_head(&store_path).expect("durable head");
        assert_eq!(head, 6, "every committed row is reported as the head");

        fs::copy(&store_path, &salvaged_path).expect("salvage the database file alone");
        drop(keepalive);

        let surviving =
            latest_action_journal_seq(&salvaged_path).expect("the salvaged database opens");
        assert!(
            surviving >= head,
            "a head the guard blessed ({head}) must survive losing the WAL, but only {surviving} did"
        );

        let _ = fs::remove_file(store_path);
        let _ = fs::remove_file(salvaged_path);
    }
}
