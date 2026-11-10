use super::*;
use std::sync::{atomic::AtomicBool, mpsc::SyncSender};

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

impl SnapshotWriter {}

impl SnapshotJob {}

pub(super) fn snapshot_temp_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

const MAX_GENERATED_ASSET_SCAN: usize = 20_000;

/// SQLite reports auto_vacuum as 0/1/2, and the mode can only be chosen while
/// the database is empty. A store created before the runtime set INCREMENTAL
/// reports "none", and no amount of incremental vacuuming will ever return a
/// byte from it -- that needs one full VACUUM in a maintenance window. Naming
/// the mode in /meta is what makes that difference visible from outside.
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

/// Generated art is the one store on the volume with no retention at all, so
/// its size belongs in /meta beside the event store rather than behind an ssh
/// session. The walk is bounded because this runs on a request path.
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
