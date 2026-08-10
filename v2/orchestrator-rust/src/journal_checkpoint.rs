use super::*;

/// Boot-time checkpoint rejections, surfaced through `/meta.persistence` so a
/// checkpoint that silently converts every boot into a full replay is visible
/// in telemetry rather than only in logs. Rejections only happen during boot,
/// so a process-lifetime record is exact.
static CHECKPOINT_REJECTIONS: StdMutex<(u64, Option<String>)> = StdMutex::new((0, None));

fn is_repeated_projection(
    event: &EventView,
    seen_seqs: &mut BTreeSet<u64>,
    seen_ledger_marks: &mut BTreeSet<(Option<u64>, String)>,
) -> bool {
    let repeated_seq = event.seq > 0 && !seen_seqs.insert(event.seq);
    let repeated_ledger_mark = event.type_name == "ledger.marked"
        && event
            .content
            .as_ref()
            .is_some_and(|content| !seen_ledger_marks.insert((event.actor_id, content.clone())));
    repeated_seq || repeated_ledger_mark
}

impl RuntimeWorld {
    pub(super) fn push_projected_event(&mut self, event: EventView) {
        if self.projected_event_already_logged(&event) {
            return;
        }
        if event.type_name == "message.created" && event.content.is_some() {
            if let Some(location_id) = event.location_id {
                let room_lines = self.recent_room_lines.entry(location_id).or_default();
                room_lines.push(event.clone());
                if room_lines.len() > RECENT_ROOM_LINE_CAPACITY {
                    room_lines.drain(0..room_lines.len() - RECENT_ROOM_LINE_CAPACITY);
                }
            }
        }
        self.event_log.push(event);
        if self.event_log.len() > 512 {
            let excess = self.event_log.len() - 512;
            self.event_log.drain(0..excess);
        }
    }

    fn projected_event_already_logged(&self, event: &EventView) -> bool {
        self.event_log.iter().any(|logged| {
            (event.seq > 0 && logged.seq == event.seq)
                || (event.type_name == "ledger.marked"
                    && logged.type_name == event.type_name
                    && logged.actor_id == event.actor_id
                    && logged.content == event.content)
        })
    }

    pub(super) fn dedupe_projected_events(&mut self) {
        let mut seen_seqs = BTreeSet::new();
        let mut seen_ledger_marks = BTreeSet::new();
        self.event_log
            .retain(|event| !is_repeated_projection(event, &mut seen_seqs, &mut seen_ledger_marks));
        for events in self.recent_room_lines.values_mut() {
            let mut seen_seqs = BTreeSet::new();
            let mut ignored_ledger_marks = BTreeSet::new();
            events.retain(|event| {
                !is_repeated_projection(event, &mut seen_seqs, &mut ignored_ledger_marks)
            });
        }
    }
}

pub(super) fn record_checkpoint_rejection(reason: &str) {
    if let Ok(mut rejections) = CHECKPOINT_REJECTIONS.lock() {
        rejections.0 = rejections.0.saturating_add(1);
        rejections.1 = Some(reason.to_string());
    }
}

pub(super) fn checkpoint_rejection_report() -> (u64, Option<String>) {
    CHECKPOINT_REJECTIONS
        .lock()
        .map(|rejections| rejections.clone())
        .unwrap_or((0, None))
}

macro_rules! replay_journal_continuity {
    ($journal_path:expr, $snapshot_path:expr $(,)?) => {{
        let journal_path = $journal_path;
        match $snapshot_path {
            Some(snapshot_path) => {
                match RuntimeWorld::from_snapshot_and_action_journal(snapshot_path, journal_path) {
                    Ok(runtime) => {
                        info!(
                            "loaded journal checkpoint {} and replayed suffix from {}",
                            snapshot_path.display(),
                            journal_path.display()
                        );
                        Ok(runtime)
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        RuntimeWorld::from_action_journal(journal_path)
                    }
                    Err(error) => {
                        warn!(
                            "journal checkpoint {} is unavailable; attempting full replay from {}: {}",
                            snapshot_path.display(),
                            journal_path.display(),
                            error
                        );
                        $crate::journal_checkpoint::record_checkpoint_rejection(&format!(
                            "{}: {error}",
                            snapshot_path.display()
                        ));
                        RuntimeWorld::from_action_journal(journal_path)
                    }
                }
            }
            None => RuntimeWorld::from_action_journal(journal_path),
        }
    }};
}
pub(super) use replay_journal_continuity;

macro_rules! replay_action_journal_after {
    ($runtime:ident, $path:expr, $after_seq:expr) => {
        let records = read_action_journal_after_seq($path, $after_seq)?;
        let mut canonical_natural_features =
            read_canonical_natural_feature_reveals_after_journal_seq($path, $after_seq)?;
        let mut canonical_quest_loot =
            read_canonical_quest_loot_allocations_after_journal_seq($path, $after_seq)?;
        let mut pending_natural_features = Vec::new();
        let mut migrated_bundle_hashes = BTreeSet::new();
        let mut replayed_through_seq = $after_seq;
        for (journal_seq, record) in records {
            let compatibility = persisted_worldpack_replay_compatibility(
                &record.worldpack_bundle_hash,
                "action journal",
            )?;
            if compatibility == WorldpackReplayCompatibility::DeclaredMigration {
                migrated_bundle_hashes.insert(record.worldpack_bundle_hash.clone());
            }
            validate_persisted_content_context_for_replay(
                &record.content_context,
                "action journal",
                compatibility == WorldpackReplayCompatibility::DeclaredMigration,
            )?;
            if !record.rules_profile.is_empty()
                && record.rules_profile != active_content().manifest.rules_profile
            {
                return Err(snapshot_error(format!(
                    "action journal rules profile {} does not match active rules profile {}",
                    record.rules_profile,
                    active_content().manifest.rules_profile
                )));
            }
            if record.active_rules_variants != active_content().manifest.active_rules_variants {
                return Err(snapshot_error(format!(
                    "action journal rules variants {:?} do not match active variants {:?}",
                    record.active_rules_variants,
                    active_content().manifest.active_rules_variants
                )));
            }
            if record.active_rules_extensions != active_content().manifest.active_rules_extensions {
                return Err(snapshot_error(format!(
                    "action journal rules extensions {:?} do not match active extensions {:?}",
                    record.active_rules_extensions,
                    active_content().manifest.active_rules_extensions
                )));
            }
            validate_journal_rule_binding(&record)?;

            let (status, _) = $runtime.apply_journal_record(&record);
            if status != CW_OK {
                return Err(snapshot_error(format!(
                    "action journal record {journal_seq} was rejected during replay with status {status}"
                )));
            }
            replayed_through_seq = journal_seq;
            if let Some(events) = canonical_natural_features.remove(&journal_seq) {
                pending_natural_features.extend(events);
            }
            $runtime.restore_ready_natural_feature_evidence(&mut pending_natural_features)?;
            if let Some(events) = canonical_quest_loot.remove(&journal_seq) {
                for event in events {
                    $runtime.restore_canonical_quest_loot_evidence(&record, &event)?;
                }
            }
        }
        pending_natural_features.extend(canonical_natural_features.into_values().flatten());
        if !canonical_quest_loot.is_empty() {
            return Err(snapshot_error(
                "canonical quest loot evidence has no matching action journal record",
            ));
        }
        if !migrated_bundle_hashes.is_empty() {
            warn!(
                "replayed action journal through declared worldpack migration(s) from [{}] to {}",
                migrated_bundle_hashes
                    .into_iter()
                    .collect::<Vec<_>>()
                    .join(", "),
                active_content().manifest.bundle_hash
            );
        }
        $runtime.action_journal_seq = replayed_through_seq;
        $runtime.recompute_counters();
        $runtime.ensure_seed_topology();
        $runtime.ensure_active_actor_rules_facets();
        $runtime.ensure_seed_rpg_projection();
        $runtime.backfill_generated_avatar_flavor();
        $runtime.ensure_actor_autonomy();
        $runtime.restore_ready_natural_feature_evidence(&mut pending_natural_features)?;
        for event in pending_natural_features {
            $runtime.restore_natural_feature_reveal_evidence(&event)?;
        }
        $runtime.backfill_generated_place_governance();
        $runtime.backfill_settlement_buildings();
        let mint_seed = $runtime.next_seed;
        $runtime.ensure_canonical_identities(mint_seed);
        $runtime.refresh_all_canonical_events();
        $runtime.dedupe_projected_events();
    };
}

impl RuntimeWorld {
    pub(super) fn from_action_journal(path: &Path) -> io::Result<Self> {
        let compaction = read_persistence_compaction_report(path)?;
        if compaction.action_journal_floor_seq > 0 {
            return Err(snapshot_error(format!(
                "action journal was compacted through checkpoint {}; a matching snapshot is required",
                compaction.action_journal_floor_seq
            )));
        }
        let mut runtime = Self::seeded();
        replay_action_journal_after!(runtime, path, 0);
        materialization_retirement::migrate_legacy_receipts(&mut runtime)?;
        Ok(runtime)
    }

    pub(super) fn from_snapshot_and_action_journal(
        snapshot_path: &Path,
        journal_path: &Path,
    ) -> io::Result<Self> {
        let mut runtime = Self::load_snapshot(snapshot_path)?;
        let checkpoint_seq = runtime.action_journal_seq;
        if checkpoint_seq == 0 {
            return Err(snapshot_error(
                "snapshot has no action-journal checkpoint cursor",
            ));
        }
        let compaction = read_persistence_compaction_report(journal_path)?;
        if checkpoint_seq < compaction.action_journal_floor_seq {
            return Err(snapshot_error(format!(
                "snapshot action-journal checkpoint {checkpoint_seq} is behind compacted journal floor {}",
                compaction.action_journal_floor_seq
            )));
        }
        let journal_head = latest_action_journal_seq(journal_path)?;
        if checkpoint_seq > journal_head {
            return Err(snapshot_error(format!(
                "snapshot action-journal checkpoint {checkpoint_seq} is ahead of journal head {journal_head}"
            )));
        }
        replay_action_journal_after!(runtime, journal_path, checkpoint_seq);
        materialization_retirement::migrate_legacy_receipts(&mut runtime)?;
        Ok(runtime)
    }
}

pub(super) fn read_persistence_compaction_report(
    path: &Path,
) -> io::Result<PersistenceCompactionReport> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let stored = conn
        .query_row(
            "SELECT action_journal_floor_seq,
                    canonical_commit_floor_journal_seq,
                    world_event_floor_seq, last_compacted_at_ms,
                    deleted_action_journal_rows,
                    deleted_canonical_commit_rows,
                    deleted_world_event_rows
             FROM persistence_compaction
             WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()
        .map_err(sqlite_error)?;
    let Some((
        action_journal_floor_seq,
        canonical_commit_floor_journal_seq,
        world_event_floor_seq,
        last_compacted_at_ms,
        deleted_action_journal_rows,
        deleted_canonical_commit_rows,
        deleted_world_event_rows,
    )) = stored
    else {
        return Ok(PersistenceCompactionReport::default());
    };
    Ok(PersistenceCompactionReport {
        action_journal_floor_seq: u64::try_from(action_journal_floor_seq)
            .map_err(|_| snapshot_error("action-journal compaction floor is negative"))?,
        canonical_commit_floor_journal_seq: u64::try_from(canonical_commit_floor_journal_seq)
            .map_err(|_| snapshot_error("canonical-commit compaction floor is negative"))?,
        world_event_floor_seq: u64::try_from(world_event_floor_seq)
            .map_err(|_| snapshot_error("world-event compaction floor is negative"))?,
        last_compacted_at_ms: last_compacted_at_ms
            .map(u64::try_from)
            .transpose()
            .map_err(|_| snapshot_error("persistence compaction timestamp is negative"))?,
        deleted_action_journal_rows: u64::try_from(deleted_action_journal_rows)
            .map_err(|_| snapshot_error("deleted action-journal row count is negative"))?,
        deleted_canonical_commit_rows: u64::try_from(deleted_canonical_commit_rows)
            .map_err(|_| snapshot_error("deleted canonical-commit row count is negative"))?,
        deleted_world_event_rows: u64::try_from(deleted_world_event_rows)
            .map_err(|_| snapshot_error("deleted world-event row count is negative"))?,
    })
}

const PRUNE_COMPACTED_COMMIT_RANGES_SQL: &str = "DELETE FROM canonical_compacted_commit_ranges
     WHERE world_id = ?1
       AND world_epoch = ?2
       AND last_world_seq < ?3
       AND NOT EXISTS (
           SELECT 1
           FROM world_events
           WHERE world_events.world_id =
                     canonical_compacted_commit_ranges.world_id
             AND world_events.world_epoch =
                     canonical_compacted_commit_ranges.world_epoch
             AND world_events.event_type = 'natural_feature.revealed'
             AND world_events.seq BETWEEN
                     canonical_compacted_commit_ranges.first_world_seq
                 AND canonical_compacted_commit_ranges.last_world_seq
       )";

// Snapshots stay frequent for recovery, while pruning is batched so the
// single SQLite writer is not churned for every tiny suffix. The row bound
// makes a high-traffic burst compact before the time interval elapses.
const PERSISTENCE_COMPACTION_MIN_INTERVAL_MS: u64 = 5 * 60 * 1_000;
const PERSISTENCE_COMPACTION_MAX_JOURNAL_DELTA: u64 = 512;

fn persistence_compaction_due(
    report: &PersistenceCompactionReport,
    checkpoint_seq: u64,
    now_ms: u64,
) -> bool {
    let journal_delta = checkpoint_seq.saturating_sub(report.action_journal_floor_seq);
    journal_delta >= PERSISTENCE_COMPACTION_MAX_JOURNAL_DELTA
        || report
            .last_compacted_at_ms
            .is_none_or(|last_compacted_at_ms| {
                now_ms.saturating_sub(last_compacted_at_ms)
                    >= PERSISTENCE_COMPACTION_MIN_INTERVAL_MS
            })
}

pub(super) fn compact_event_store_after_snapshot(
    path: &Path,
    checkpoint_seq: u64,
    through_event_seq: u64,
    retained_world_events: usize,
) -> io::Result<PersistenceCompactionReport> {
    let report = read_persistence_compaction_report(path)?;
    if !persistence_compaction_due(&report, checkpoint_seq, now_millis()) {
        return Ok(PersistenceCompactionReport::default());
    }
    compact_event_store_after_snapshot_now(
        path,
        checkpoint_seq,
        through_event_seq,
        retained_world_events,
    )
}

fn compact_event_store_after_snapshot_now(
    path: &Path,
    checkpoint_seq: u64,
    through_event_seq: u64,
    retained_world_events: usize,
) -> io::Result<PersistenceCompactionReport> {
    // A command may advance the journal after the worker captured and wrote
    // its snapshot. That snapshot is still a valid boot checkpoint, but it is
    // no longer safe to use as a compaction frontier. Skip the expected race
    // before taking the SQLite write lock; the transaction rechecks below.
    if checkpoint_seq != latest_action_journal_seq(path)? {
        return Ok(PersistenceCompactionReport::default());
    }
    init_event_store(path)?;
    let mut conn = open_event_store(path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let journal_head = tx
        .query_row(
            "SELECT COALESCE(MAX(journal_seq), 0) FROM action_journal",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    let journal_head = u64::try_from(journal_head)
        .map_err(|_| snapshot_error("action journal returned a negative sequence"))?;
    if checkpoint_seq != journal_head {
        return Ok(PersistenceCompactionReport::default());
    }
    if checkpoint_seq > 0 {
        let checkpoint_present = tx
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM action_journal WHERE journal_seq = ?1
                 )",
                params![checkpoint_seq as i64],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sqlite_error)?
            != 0;
        if !checkpoint_present {
            return Err(snapshot_error(format!(
                "snapshot checkpoint {checkpoint_seq} is absent from the action journal"
            )));
        }
    }

    let deleted_action_journal_rows = if checkpoint_seq > 0 {
        tx.execute(
            "DELETE FROM action_journal WHERE journal_seq < ?1",
            params![checkpoint_seq as i64],
        )
        .map_err(sqlite_error)?
    } else {
        0
    };
    let retained_world_events = retained_world_events.max(MAX_EVENT_STORE_SCAN);
    let world_event_floor_seq = tx
        .query_row(
            "SELECT seq
             FROM world_events
             WHERE seq <= ?1
             ORDER BY seq DESC
             LIMIT 1 OFFSET ?2",
            params![
                through_event_seq as i64,
                retained_world_events.saturating_sub(1) as i64
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(sqlite_error)?
        .map(u64::try_from)
        .transpose()
        .map_err(|_| snapshot_error("world-event compaction floor is negative"))?
        .unwrap_or_default();
    let deleted_world_event_rows = if world_event_floor_seq > 0 {
        // Natural-feature reveals remain canonical evidence during hydration.
        // Their count is bounded by the location cap, so retaining them does
        // not reintroduce unbounded event-store growth.
        tx.execute(
            "DELETE FROM world_events
             WHERE seq < ?1
               AND event_type <> 'natural_feature.revealed'",
            params![world_event_floor_seq as i64],
        )
        .map_err(sqlite_error)?
    } else {
        0
    };
    let deleted_canonical_commit_range_rows = if world_event_floor_seq > 0 {
        tx.execute(
            PRUNE_COMPACTED_COMMIT_RANGES_SQL,
            params![
                OFFICIAL_WORLD_ID,
                OFFICIAL_WORLD_EPOCH as i64,
                world_event_floor_seq as i64
            ],
        )
        .map_err(sqlite_error)?
    } else {
        0
    };
    let inserted_canonical_commit_range_rows = if checkpoint_seq > 0 {
        tx.execute(
            "INSERT OR IGNORE INTO canonical_compacted_commit_ranges
                (commit_id, world_id, world_epoch, first_world_seq,
                 last_world_seq, action_journal_seq)
             SELECT commits.commit_id, commits.world_id, commits.world_epoch,
                    commits.first_world_seq, commits.last_world_seq,
                    commits.action_journal_seq
             FROM canonical_commits AS commits
             WHERE commits.action_journal_seq < ?1
               AND EXISTS (
                   SELECT 1
                   FROM world_events AS events
                   WHERE events.world_id = commits.world_id
                     AND events.world_epoch = commits.world_epoch
                     AND events.seq BETWEEN commits.first_world_seq
                                        AND commits.last_world_seq
               )",
            params![checkpoint_seq as i64],
        )
        .map_err(sqlite_error)?
    } else {
        0
    };
    let deleted_canonical_commit_rows = if checkpoint_seq > 0 {
        tx.execute(
            "DELETE FROM canonical_commits WHERE action_journal_seq < ?1",
            params![checkpoint_seq as i64],
        )
        .map_err(sqlite_error)?
    } else {
        0
    };

    if deleted_action_journal_rows == 0
        && deleted_canonical_commit_rows == 0
        && deleted_world_event_rows == 0
        && deleted_canonical_commit_range_rows == 0
        && inserted_canonical_commit_range_rows == 0
    {
        tx.commit().map_err(sqlite_error)?;
        return Ok(PersistenceCompactionReport::default());
    }

    let compacted_at_ms = now_millis();
    let action_journal_floor_seq = if deleted_action_journal_rows > 0 {
        checkpoint_seq
    } else {
        0
    };
    let canonical_commit_floor_journal_seq = if deleted_canonical_commit_rows > 0 {
        checkpoint_seq
    } else {
        0
    };
    let world_event_floor_seq = if deleted_world_event_rows > 0 {
        world_event_floor_seq
    } else {
        0
    };
    tx.execute(
        "INSERT INTO persistence_compaction
            (singleton, action_journal_floor_seq,
             canonical_commit_floor_journal_seq, world_event_floor_seq,
             last_compacted_at_ms, deleted_action_journal_rows,
             deleted_canonical_commit_rows, deleted_world_event_rows)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(singleton) DO UPDATE SET
            action_journal_floor_seq =
                MAX(action_journal_floor_seq, excluded.action_journal_floor_seq),
            canonical_commit_floor_journal_seq =
                MAX(canonical_commit_floor_journal_seq,
                    excluded.canonical_commit_floor_journal_seq),
            world_event_floor_seq =
                MAX(world_event_floor_seq, excluded.world_event_floor_seq),
            last_compacted_at_ms = excluded.last_compacted_at_ms,
            deleted_action_journal_rows =
                deleted_action_journal_rows + excluded.deleted_action_journal_rows,
            deleted_canonical_commit_rows =
                deleted_canonical_commit_rows + excluded.deleted_canonical_commit_rows,
            deleted_world_event_rows =
                deleted_world_event_rows + excluded.deleted_world_event_rows",
        params![
            action_journal_floor_seq as i64,
            canonical_commit_floor_journal_seq as i64,
            world_event_floor_seq as i64,
            compacted_at_ms as i64,
            deleted_action_journal_rows as i64,
            deleted_canonical_commit_rows as i64,
            deleted_world_event_rows as i64,
        ],
    )
    .map_err(sqlite_error)?;
    tx.commit().map_err(sqlite_error)?;
    // Deleted pages are intentional reusable headroom. Vacuuming synchronously
    // here rewrites the volume while the world lock is held and stalls player
    // commands; SQLite will reuse these pages for later journal appends.
    Ok(PersistenceCompactionReport {
        action_journal_floor_seq,
        canonical_commit_floor_journal_seq,
        world_event_floor_seq,
        last_compacted_at_ms: Some(compacted_at_ms),
        deleted_action_journal_rows: deleted_action_journal_rows as u64,
        deleted_canonical_commit_rows: deleted_canonical_commit_rows as u64,
        deleted_world_event_rows: deleted_world_event_rows as u64,
    })
}

pub(super) fn read_canonical_natural_feature_reveals_after_journal_seq(
    path: &Path,
    after_seq: u64,
) -> io::Result<BTreeMap<u64, Vec<EventView>>> {
    read_canonical_events_after_journal_seq(
        path,
        "natural_feature.revealed",
        CW_MAX_LOCATIONS as i64,
        after_seq,
    )
}

pub(super) fn read_canonical_quest_loot_allocations_after_journal_seq(
    path: &Path,
    after_seq: u64,
) -> io::Result<BTreeMap<u64, Vec<EventView>>> {
    read_canonical_events_after_journal_seq(
        path,
        "quest.loot_allocated",
        CW_MAX_ITEMS as i64,
        after_seq,
    )
}

fn read_canonical_events_after_journal_seq(
    path: &Path,
    event_type: &str,
    limit: i64,
    after_seq: u64,
) -> io::Result<BTreeMap<u64, Vec<EventView>>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let mut stmt = conn
        .prepare(
            "WITH canonical_commit_ranges AS (
                 SELECT world_id, world_epoch, first_world_seq,
                        last_world_seq, action_journal_seq
                 FROM canonical_commits
                 UNION ALL
                 SELECT world_id, world_epoch, first_world_seq,
                        last_world_seq, action_journal_seq
                 FROM canonical_compacted_commit_ranges
             )
             SELECT (
                 SELECT commits.action_journal_seq
                 FROM canonical_commit_ranges AS commits
                 WHERE commits.world_id = events.world_id
                   AND commits.world_epoch = events.world_epoch
                   AND events.seq BETWEEN commits.first_world_seq AND commits.last_world_seq
                 ORDER BY (commits.last_world_seq - commits.first_world_seq) ASC,
                          commits.action_journal_seq ASC
                 LIMIT 1
             ), events.payload_json
             FROM world_events AS events
             WHERE events.world_id = ?1
               AND events.world_epoch = ?2
               AND events.event_type = ?3
               AND COALESCE((
                   SELECT commits.action_journal_seq
                   FROM canonical_commit_ranges AS commits
                   WHERE commits.world_id = events.world_id
                     AND commits.world_epoch = events.world_epoch
                     AND events.seq BETWEEN commits.first_world_seq AND commits.last_world_seq
                   ORDER BY (commits.last_world_seq - commits.first_world_seq) ASC,
                            commits.action_journal_seq ASC
                   LIMIT 1
               ), 9223372036854775807) > ?4
             ORDER BY events.seq ASC
             LIMIT ?5",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(
            params![
                OFFICIAL_WORLD_ID,
                OFFICIAL_WORLD_EPOCH as i64,
                event_type,
                after_seq as i64,
                limit
            ],
            |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(sqlite_error)?;
    let mut events_by_journal_seq = BTreeMap::<u64, Vec<EventView>>::new();
    for row in rows {
        let (journal_seq, payload) = row.map_err(sqlite_error)?;
        let journal_seq = journal_seq
            .map(u64::try_from)
            .transpose()
            .map_err(|_| snapshot_error("canonical commit returned a negative journal sequence"))?
            .unwrap_or(u64::MAX);
        let mut event: EventView = serde_json::from_str(&payload)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if content_reference_context_is_empty(&event.content_context) {
            event.refresh_content_context();
        }
        events_by_journal_seq
            .entry(journal_seq)
            .or_default()
            .push(event);
    }
    Ok(events_by_journal_seq)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(label: &str, extension: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cosyworld-{label}-{}-{}.{}",
            std::process::id(),
            now_seed(),
            extension
        ))
    }

    fn valid_fixture_record(seed: u64) -> JournalRecord {
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
    fn compacted_commit_range_pruning_uses_the_event_frontier_index() {
        let journal_path = temp_path("compacted-range-query-plan", "sqlite");
        let _ = fs::remove_file(&journal_path);
        init_event_store(&journal_path).expect("initialize query-plan fixture");
        let conn = open_event_store(&journal_path).expect("open query-plan fixture");
        let query = format!("EXPLAIN QUERY PLAN {PRUNE_COMPACTED_COMMIT_RANGES_SQL}");
        let details = conn
            .prepare(&query)
            .and_then(|mut statement| {
                statement
                    .query_map(
                        params![OFFICIAL_WORLD_ID, OFFICIAL_WORLD_EPOCH as i64, 25_i64],
                        |row| row.get::<_, String>(3),
                    )?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("explain compacted-range pruning");
        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_canonical_compacted_commit_ranges_world_seq")),
            "range pruning must search the frontier index: {details:?}"
        );
        drop(conn);
        let _ = fs::remove_file(journal_path);
    }

    #[test]
    fn persistence_compaction_batches_by_time_or_journal_delta() {
        let recent = PersistenceCompactionReport {
            action_journal_floor_seq: 1_000,
            last_compacted_at_ms: Some(10_000),
            ..PersistenceCompactionReport::default()
        };
        assert!(!persistence_compaction_due(&recent, 1_001, 10_001));
        assert!(persistence_compaction_due(
            &recent,
            1_000 + PERSISTENCE_COMPACTION_MAX_JOURNAL_DELTA,
            10_001
        ));
        assert!(persistence_compaction_due(
            &recent,
            1_001,
            10_000 + PERSISTENCE_COMPACTION_MIN_INTERVAL_MS
        ));
        assert!(persistence_compaction_due(
            &PersistenceCompactionReport::default(),
            0,
            0
        ));
    }

    #[test]
    fn snapshot_checkpoint_preserves_migration_state_and_replays_only_the_suffix() {
        std::thread::Builder::new()
            .name("journal-checkpoint-replay".to_string())
            .stack_size(16 * 1024 * 1024)
            .spawn(run_snapshot_checkpoint_replay)
            .expect("spawn journal checkpoint replay thread")
            .join()
            .expect("journal checkpoint replay thread");
    }

    fn run_snapshot_checkpoint_replay() {
        let journal_path = temp_path("journal-checkpoint", "sqlite");
        let snapshot_path = temp_path("journal-checkpoint", "json");
        let _ = fs::remove_file(&journal_path);
        let _ = fs::remove_file(&snapshot_path);

        let mut create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: 1,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 73_001);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Checkpoint Walker".to_string(),
                speech_mode: "prose".to_string(),
                title: "Journal Cartographer".to_string(),
                description: "A checkpoint replay fixture.".to_string(),
            },
        );
        append_action_journal(&journal_path, &create_record).expect("append checkpoint prefix");

        let mut checkpoint =
            RuntimeWorld::from_action_journal(&journal_path).expect("replay checkpoint prefix");
        assert_eq!(checkpoint.action_journal_seq, 1);
        checkpoint
            .content
            .insert(990_001, "checkpoint-only".to_string());
        checkpoint.pack_mount_state = PackMountState(serde_json::json!({
            "schema_version": 1,
            "next_transaction_seq": 2,
            "frozen": {},
            "history": [{
                "sequence": 1,
                "status": "committed",
                "operation": "soft_unmount",
                "pack_id": "fixture.pack"
            }]
        }));
        checkpoint
            .save_snapshot(&snapshot_path)
            .expect("save journal checkpoint");

        create.kind = CW_ACTION_SAY;
        create.content_id = 990_002;
        let mut suffix_record = JournalRecord::new(create, 73_002);
        suffix_record
            .content_upserts
            .insert(990_002, "suffix line".to_string());
        append_action_journal(&journal_path, &suffix_record).expect("append checkpoint suffix");

        let restored =
            RuntimeWorld::from_snapshot_and_action_journal(&snapshot_path, &journal_path)
                .expect("restore checkpoint plus suffix");
        assert_eq!(restored.action_journal_seq, 2);
        assert_eq!(
            restored.content.get(&990_001).map(String::as_str),
            Some("checkpoint-only")
        );
        assert_eq!(
            restored.content.get(&990_002).map(String::as_str),
            Some("suffix line")
        );
        assert_eq!(restored.pack_mount_state.composition_revision(), 1);

        let mut ahead = RuntimeSnapshot::from_runtime(&restored);
        ahead.action_journal_seq = 3;
        fs::write(
            &snapshot_path,
            serde_json::to_vec_pretty(&ahead).expect("serialize ahead checkpoint"),
        )
        .expect("write ahead checkpoint");
        let error = RuntimeWorld::from_snapshot_and_action_journal(&snapshot_path, &journal_path)
            .expect_err("checkpoint ahead of the journal must fail");
        assert!(error.to_string().contains("ahead of journal head 2"));

        let _ = fs::remove_file(journal_path);
        let _ = fs::remove_file(snapshot_path);
    }

    #[test]
    fn rejected_suffix_record_fails_checkpoint_replay_closed() {
        let journal_path = temp_path("journal-rejected-suffix", "sqlite");
        let snapshot_path = temp_path("journal-rejected-suffix", "json");
        let _ = fs::remove_file(&journal_path);
        let _ = fs::remove_file(&snapshot_path);

        append_action_journal(&journal_path, &valid_fixture_record(73_010))
            .expect("append valid checkpoint record");
        let checkpoint = RuntimeWorld::from_action_journal(&journal_path)
            .expect("valid checkpoint record replays");
        checkpoint
            .save_snapshot(&snapshot_path)
            .expect("save valid checkpoint");
        append_action_journal(
            &journal_path,
            &JournalRecord::new(CwAction::default(), 73_011),
        )
        .expect("append structurally valid rejected suffix");

        let error = RuntimeWorld::from_snapshot_and_action_journal(&snapshot_path, &journal_path)
            .expect_err("rejected suffix must fail replay instead of advancing the cursor");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error
            .to_string()
            .contains("action journal record 2 was rejected during replay with status"));

        let _ = fs::remove_file(journal_path);
        let _ = fs::remove_file(snapshot_path);
    }

    #[test]
    fn durable_restore_dedupes_event_sequences_and_replayed_ledger_claims() {
        std::thread::Builder::new()
            .name("journal-event-dedupe".to_string())
            .stack_size(16 * 1024 * 1024)
            .spawn(run_durable_restore_event_dedupe)
            .expect("spawn journal event dedupe thread")
            .join()
            .expect("journal event dedupe thread");
    }

    fn run_durable_restore_event_dedupe() {
        let journal_path = temp_path("journal-event-dedupe", "sqlite");
        let snapshot_path = temp_path("journal-event-dedupe", "json");
        let _ = fs::remove_file(&journal_path);
        let _ = fs::remove_file(&snapshot_path);

        append_action_journal(&journal_path, &valid_fixture_record(73_100))
            .expect("append durable checkpoint record");
        let mut checkpoint =
            RuntimeWorld::from_action_journal(&journal_path).expect("replay checkpoint");
        checkpoint.action_journal_seq = 1;
        let duplicate_seq = EventView {
            seq: 91_000,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(5000),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            content: Some("one durable line".to_string()),
            ..EventView::default()
        };
        let ledger_mark = EventView {
            seq: 91_001,
            type_name: "ledger.marked".to_string(),
            success: true,
            actor_id: Some(1004),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            content: Some(
                "witness:noticed Mara tuck away Road Bread.:witness:resident_item_claimed:8326:7204:58226"
                    .to_string(),
            ),
            ..EventView::default()
        };
        checkpoint.event_log.extend([
            duplicate_seq.clone(),
            duplicate_seq,
            ledger_mark.clone(),
            EventView {
                seq: 91_002,
                ..ledger_mark.clone()
            },
            EventView {
                seq: 91_003,
                actor_id: Some(1005),
                ..ledger_mark
            },
        ]);
        checkpoint
            .save_snapshot(&snapshot_path)
            .expect("save duplicated checkpoint");

        let restored =
            RuntimeWorld::from_snapshot_and_action_journal(&snapshot_path, &journal_path)
                .expect("restore and normalize duplicated checkpoint");
        let restored_seqs = restored
            .event_log
            .iter()
            .map(|event| event.seq)
            .collect::<BTreeSet<_>>();
        assert_eq!(restored_seqs.len(), restored.event_log.len());
        assert_eq!(
            restored
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == "ledger.marked"
                        && event.actor_id == Some(1004)
                        && event.content.as_deref()
                            == Some(
                                "witness:noticed Mara tuck away Road Bread.:witness:resident_item_claimed:8326:7204:58226",
                            )
                })
                .count(),
            1
        );
        assert!(restored.event_log.iter().any(|event| {
            event.type_name == "ledger.marked"
                && event.actor_id == Some(1005)
                && event.content.as_deref()
                    == Some(
                        "witness:noticed Mara tuck away Road Bread.:witness:resident_item_claimed:8326:7204:58226",
                    )
        }));

        let mut append_guard = restored.clone();
        let retained_len = append_guard.event_log.len();
        let retained_mark = append_guard
            .event_log
            .iter()
            .find(|event| event.type_name == "ledger.marked" && event.actor_id == Some(1004))
            .expect("retained ledger mark")
            .clone();
        append_guard.push_projected_event(EventView {
            seq: 91_010,
            ..retained_mark
        });
        assert_eq!(append_guard.event_log.len(), retained_len);

        let _ = fs::remove_file(journal_path);
        let _ = fs::remove_file(snapshot_path);
    }

    #[test]
    fn compacted_journal_requires_a_snapshot_at_or_after_the_retained_floor() {
        std::thread::Builder::new()
            .name("journal-compaction-replay".to_string())
            .stack_size(16 * 1024 * 1024)
            .spawn(run_compacted_journal_requires_snapshot)
            .expect("spawn journal compaction test thread")
            .join()
            .expect("journal compaction test thread");
    }

    #[test]
    fn stale_snapshot_compaction_is_a_quiet_noop() {
        let journal_path = temp_path("stale-snapshot-compaction", "sqlite");
        let _ = fs::remove_file(&journal_path);
        for seed in 1..=2 {
            append_action_journal(&journal_path, &valid_fixture_record(seed))
                .expect("append journal fixture");
        }

        let compacted =
            compact_event_store_after_snapshot(&journal_path, 1, 0, MAX_EVENT_STORE_SCAN)
                .expect("stale snapshot should skip compaction");
        assert_eq!(compacted.action_journal_floor_seq, 0);
        assert_eq!(compacted.deleted_action_journal_rows, 0);
        assert_eq!(
            latest_action_journal_seq(&journal_path).expect("read retained journal head"),
            2
        );
        assert_eq!(
            read_persistence_compaction_report(&journal_path)
                .expect("read untouched compaction report")
                .action_journal_floor_seq,
            0
        );

        let _ = fs::remove_file(journal_path);
    }

    fn run_compacted_journal_requires_snapshot() {
        let journal_path = temp_path("journal-compaction", "sqlite");
        let snapshot_path = temp_path("journal-compaction", "json");
        let old_snapshot_path = temp_path("journal-compaction-old", "json");
        let _ = fs::remove_file(&journal_path);
        let _ = fs::remove_file(&snapshot_path);
        let _ = fs::remove_file(&old_snapshot_path);

        for seed in 1..=3 {
            append_action_journal(
                &journal_path,
                &JournalRecord::new(CwAction::default(), seed),
            )
            .expect("append journal fixture");
        }
        let conn = open_event_store(&journal_path).expect("open canonical commit fixture");
        for journal_seq in 1_i64..=3 {
            conn.execute(
                "INSERT INTO canonical_commits
                    (commit_id, world_id, world_epoch, first_world_seq,
                     last_world_seq, intent_id, request_hash, owner_id,
                     owner_fencing_epoch, partitions_json,
                     entity_versions_json, claims_json, action_journal_seq,
                     created_at_ms)
                 VALUES (?1, ?2, 1, ?3, ?3, NULL, NULL, 'test-owner',
                         1, '[]', '{}', '[]', ?3, ?3)",
                params![
                    format!("test-commit-{journal_seq}"),
                    OFFICIAL_WORLD_ID,
                    journal_seq
                ],
            )
            .expect("insert canonical commit fixture");
        }
        drop(conn);
        let mut checkpoint = RuntimeWorld::seeded();
        checkpoint.action_journal_seq = 3;
        checkpoint.world.next_event_seq = 1_004;
        checkpoint
            .save_snapshot(&snapshot_path)
            .expect("save compactable checkpoint");

        let mut old_checkpoint = checkpoint.clone();
        old_checkpoint.action_journal_seq = 2;
        old_checkpoint
            .save_snapshot(&old_snapshot_path)
            .expect("save stale checkpoint");

        let events = (1..=1_003)
            .map(|seq| EventView {
                seq,
                type_name: if seq == 1 {
                    "natural_feature.revealed".to_string()
                } else {
                    "message.created".to_string()
                },
                success: true,
                location_id: Some(1),
                ..EventView::default()
            })
            .collect::<Vec<_>>();
        append_event_store(&journal_path, &events).expect("append world-event fixtures");

        let compacted =
            compact_event_store_after_snapshot_now(&journal_path, 3, 1_003, MAX_EVENT_STORE_SCAN)
                .expect("compact checkpointed store");
        assert_eq!(compacted.action_journal_floor_seq, 3);
        assert_eq!(compacted.canonical_commit_floor_journal_seq, 3);
        assert_eq!(compacted.world_event_floor_seq, 4);
        assert_eq!(compacted.deleted_action_journal_rows, 2);
        assert_eq!(compacted.deleted_canonical_commit_rows, 2);
        assert_eq!(compacted.deleted_world_event_rows, 2);

        let conn = open_event_store(&journal_path).expect("open compacted store");
        let journal_seqs = conn
            .prepare("SELECT journal_seq FROM action_journal ORDER BY journal_seq")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, u64>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("read retained journal suffix");
        assert_eq!(journal_seqs, vec![3]);
        let canonical_commit_seqs = conn
            .prepare("SELECT action_journal_seq FROM canonical_commits ORDER BY action_journal_seq")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, u64>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("read retained canonical commit");
        assert_eq!(canonical_commit_seqs, vec![3]);
        let compacted_commit_seqs = conn
            .prepare(
                "SELECT action_journal_seq
                 FROM canonical_compacted_commit_ranges
                 ORDER BY action_journal_seq",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, u64>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("read retained compacted commit range");
        assert_eq!(compacted_commit_seqs, vec![1]);
        assert!(read_event_store_event(&journal_path, 1)
            .expect("read retained canonical evidence")
            .is_some());
        assert!(read_event_store_event(&journal_path, 2)
            .expect("read pruned event")
            .is_none());
        assert!(read_event_store_event(&journal_path, 4)
            .expect("read retained replay floor")
            .is_some());
        drop(conn);
        assert!(
            read_canonical_natural_feature_reveals_after_journal_seq(&journal_path, 3)
                .expect("read compacted canonical evidence")
                .is_empty()
        );

        let full_replay_error =
            RuntimeWorld::from_action_journal(&journal_path).expect_err("snapshot is required");
        assert!(full_replay_error
            .to_string()
            .contains("matching snapshot is required"));
        let stale_snapshot_error =
            RuntimeWorld::from_snapshot_and_action_journal(&old_snapshot_path, &journal_path)
                .expect_err("stale snapshot must not cross compacted floor");
        assert!(stale_snapshot_error
            .to_string()
            .contains("behind compacted journal floor 3"));

        append_action_journal(&journal_path, &valid_fixture_record(4))
            .expect("append post-checkpoint suffix");
        let restored =
            RuntimeWorld::from_snapshot_and_action_journal(&snapshot_path, &journal_path)
                .expect("restore checkpoint plus retained suffix");
        assert_eq!(restored.action_journal_seq, 4);

        let report =
            read_persistence_compaction_report(&journal_path).expect("read compaction telemetry");
        assert_eq!(report.action_journal_floor_seq, 3);
        assert_eq!(report.canonical_commit_floor_journal_seq, 3);
        assert_eq!(report.world_event_floor_seq, 4);
        assert_eq!(report.deleted_action_journal_rows, 2);
        assert_eq!(report.deleted_canonical_commit_rows, 2);
        assert_eq!(report.deleted_world_event_rows, 2);

        let conn = open_event_store(&journal_path).expect("open next canonical commit fixture");
        conn.execute(
            "INSERT INTO canonical_commits
                (commit_id, world_id, world_epoch, first_world_seq,
                 last_world_seq, intent_id, request_hash, owner_id,
                 owner_fencing_epoch, partitions_json,
                 entity_versions_json, claims_json, action_journal_seq,
                 created_at_ms)
             VALUES ('test-commit-4', ?1, 1, 4, 4, NULL, NULL,
                     'test-owner', 1, '[]', '{}', '[]', 4, 4)",
            params![OFFICIAL_WORLD_ID],
        )
        .expect("insert next canonical commit fixture");
        conn.execute(
            "INSERT INTO canonical_compacted_commit_ranges
                (commit_id, world_id, world_epoch, first_world_seq,
                 last_world_seq, action_journal_seq)
             VALUES ('stale-compacted-commit-2', ?1, 1, 2, 2, 2)",
            params![OFFICIAL_WORLD_ID],
        )
        .expect("insert stale compacted commit range fixture");
        drop(conn);
        restored
            .save_snapshot(&snapshot_path)
            .expect("save next compactable checkpoint");

        let next_compaction =
            compact_event_store_after_snapshot_now(&journal_path, 4, 1_003, MAX_EVENT_STORE_SCAN)
                .expect("compact next checkpointed store");
        assert_eq!(next_compaction.action_journal_floor_seq, 4);
        assert_eq!(next_compaction.canonical_commit_floor_journal_seq, 4);
        assert_eq!(next_compaction.deleted_action_journal_rows, 1);
        assert_eq!(next_compaction.deleted_canonical_commit_rows, 1);
        assert_eq!(next_compaction.deleted_world_event_rows, 0);

        let conn = open_event_store(&journal_path).expect("open repeatedly compacted store");
        let retained_commit_seqs = conn
            .prepare("SELECT action_journal_seq FROM canonical_commits ORDER BY action_journal_seq")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, u64>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("read repeatedly retained canonical commit");
        assert_eq!(retained_commit_seqs, vec![4]);
        let retained_compacted_commit_seqs = conn
            .prepare(
                "SELECT action_journal_seq
                 FROM canonical_compacted_commit_ranges
                 ORDER BY action_journal_seq",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, u64>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("read retained compacted commit ranges");
        assert_eq!(retained_compacted_commit_seqs, vec![1]);
        drop(conn);

        let report =
            read_persistence_compaction_report(&journal_path).expect("read cumulative telemetry");
        assert_eq!(report.action_journal_floor_seq, 4);
        assert_eq!(report.canonical_commit_floor_journal_seq, 4);
        assert_eq!(report.deleted_action_journal_rows, 3);
        assert_eq!(report.deleted_canonical_commit_rows, 3);
        assert_eq!(report.deleted_world_event_rows, 2);

        let _ = fs::remove_file(journal_path);
        let _ = fs::remove_file(snapshot_path);
        let _ = fs::remove_file(old_snapshot_path);
    }

    #[test]
    fn stale_snapshot_temporary_file_is_removed_without_touching_snapshot() {
        let snapshot_path = temp_path("stale-snapshot-temp", "json");
        let temp = snapshot_temp_path(&snapshot_path);
        fs::write(&snapshot_path, b"committed").expect("write committed snapshot fixture");
        fs::write(&temp, vec![7_u8; 64 * 1024]).expect("write stale temporary fixture");

        assert!(remove_stale_snapshot_temp(&snapshot_path).expect("remove stale temp"));
        assert!(!temp.exists());
        assert_eq!(
            fs::read(&snapshot_path).expect("committed snapshot remains"),
            b"committed"
        );
        assert!(!remove_stale_snapshot_temp(&snapshot_path).expect("repeat cleanup is harmless"));

        let _ = fs::remove_file(snapshot_path);
    }
}
