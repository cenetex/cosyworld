use super::*;

/// Boot-time checkpoint rejections, surfaced through `/meta.persistence` so a
/// checkpoint that silently converts every boot into a full replay is visible
/// in telemetry rather than only in logs. Rejections only happen during boot,
/// so a process-lifetime record is exact.
static CHECKPOINT_REJECTIONS: StdMutex<(u64, Option<String>)> = StdMutex::new((0, None));

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

            let _ = $runtime.apply_journal_record(&record);
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
        Ok(runtime)
    }
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
    fn compacted_journal_requires_a_snapshot_at_or_after_the_retained_floor() {
        std::thread::Builder::new()
            .name("journal-compaction-replay".to_string())
            .stack_size(16 * 1024 * 1024)
            .spawn(run_compacted_journal_requires_snapshot)
            .expect("spawn journal compaction test thread")
            .join()
            .expect("journal compaction test thread");
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
            compact_event_store_after_snapshot(&journal_path, 3, 1_003, MAX_EVENT_STORE_SCAN)
                .expect("compact checkpointed store");
        assert_eq!(compacted.action_journal_floor_seq, 3);
        assert_eq!(compacted.world_event_floor_seq, 4);
        assert_eq!(compacted.deleted_action_journal_rows, 2);
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
        // The preservation assertion above intentionally uses the canonical
        // event type. This compact fixture has no canonical commit binding or
        // typed natural-feature payload, so remove it from hydration before
        // exercising the otherwise independent journal-suffix restore.
        open_event_store(&journal_path)
            .expect("open retained evidence fixture")
            .execute(
                "UPDATE world_events SET event_type = 'message.created' WHERE seq = 1",
                [],
            )
            .expect("exclude untyped fixture from canonical hydration");

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

        append_action_journal(&journal_path, &JournalRecord::new(CwAction::default(), 4))
            .expect("append post-checkpoint suffix");
        let restored =
            RuntimeWorld::from_snapshot_and_action_journal(&snapshot_path, &journal_path)
                .expect("restore checkpoint plus retained suffix");
        assert_eq!(restored.action_journal_seq, 4);

        let report =
            read_persistence_compaction_report(&journal_path).expect("read compaction telemetry");
        assert_eq!(report.action_journal_floor_seq, 3);
        assert_eq!(report.world_event_floor_seq, 4);
        assert_eq!(report.deleted_action_journal_rows, 2);
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
