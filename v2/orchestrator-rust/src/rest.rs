use super::*;

pub(super) fn declared_item_recovery_profile(
    initial_charges: u8,
    mechanics: Option<&SeedPlayableItemMechanics>,
) -> (u8, u8, u8) {
    let ready_zone = match mechanics.map(|value| value.equipment_profile.as_str()) {
        Some("spell_deck") => CW_CARD_ZONE_SPELL_DECK,
        Some("bracelet" | "weapon_hand" | "container_harness") => CW_CARD_ZONE_EQUIPPED,
        _ => CW_CARD_ZONE_CARRIED,
    };
    let Some(mechanics) = mechanics else {
        return (initial_charges.max(1), CW_ITEM_RECOVERY_NONE, ready_zone);
    };
    let bound_effect = mechanics.magic_effect.as_deref().and_then(|effect_id| {
        active_rules_bundle()
            .resources
            .magic_effects
            .iter()
            .find(|effect| effect.id == effect_id)
    });
    let max_charges = bound_effect
        .map(|effect| effect.uses)
        .unwrap_or(mechanics.uses)
        .max(initial_charges)
        .max(1);
    let recovery_name = bound_effect
        .map(|effect| effect.recovery.as_str())
        .unwrap_or(mechanics.recovery.as_str());
    let recovery = if mechanics.exhaustion == "consume_charge" && recovery_name == "rest" {
        CW_ITEM_RECOVERY_REST
    } else {
        CW_ITEM_RECOVERY_NONE
    };
    (max_charges, recovery, ready_zone)
}

#[cfg(test)]
mod tests {
    use super::super::*;

    fn rest_replay_actor_record(seed: u64) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            seed,
        );
        record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Rest Replay".to_string(),
                speech_mode: "prose".to_string(),
                title: "Rest Replay Traveler".to_string(),
                description: "A journal fixture for authoritative card refresh.".to_string(),
            },
        );
        record
    }

    fn steady_light_rest_records(seed: u64) -> Vec<JournalRecord> {
        let pickup = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            seed + 1,
        );
        let mut prepare = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            seed + 2,
        );
        prepare
            .projection_mutations
            .push(ProjectionMutation::SetSpellPrepared {
                item_id: 2014,
                prepared: true,
                reason: "rest_replay_fixture".to_string(),
            });
        let cast = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_MAGIC,
                actor_id: 5000,
                target_actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            seed + 3,
        );
        let rest = JournalRecord::new(
            rest_action_from_server_entitlement(
                5000,
                RestActionRequest {
                    requested_grade: CW_REST_GRADE_HEARTH,
                },
                CW_REST_GRADE_HEARTH,
            )
            .expect("server-authorized Hearth rest"),
            seed + 4,
        );
        vec![rest_replay_actor_record(seed), pickup, prepare, cast, rest]
    }

    #[test]
    fn hearth_rest_refreshes_cast_spell_and_replays_with_its_captured_zone() {
        let records = steady_light_rest_records(18_000);
        let rest_record = records.last().expect("rest record");
        assert_eq!(
            rest_record.operation.as_deref(),
            Some("cosyworld.operation/rest")
        );
        assert_eq!(rest_record.resolver.as_deref(), Some("rest_v1"));

        let mut direct = RuntimeWorld::seeded();
        for (index, record) in records.iter().enumerate() {
            let (status, events) = direct.apply_journal_record(record);
            assert_eq!(status, CW_OK, "record {index} remains replayable");
            if index == 3 {
                assert!(events
                    .iter()
                    .any(|event| event.type_name == "magic.spell_cast"));
                let exhausted = direct.item_by_id(2014).expect("spell remains present");
                assert_eq!(exhausted.charges, 0);
                assert_eq!(exhausted.zone, CW_CARD_ZONE_EXHAUSTED);
                assert_eq!(exhausted.recovery_zone, CW_CARD_ZONE_SPELL_DECK);
            } else if index == 4 {
                assert_eq!(
                    events
                        .iter()
                        .filter(|event| event.type_name == "item.refreshed")
                        .count(),
                    1
                );
            }
        }

        let path = std::env::temp_dir().join(format!(
            "cosyworld-rest-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        for record in &records {
            append_action_journal(&path, record).expect("append Rest replay record");
        }
        let mut replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay authoritative Rest journal");
        let _ = fs::remove_file(path);

        let refreshed = replayed.item_by_id(2014).expect("refreshed spell exists");
        assert_eq!(refreshed.charges, 1);
        assert_eq!(refreshed.max_charges, 1);
        assert_eq!(refreshed.zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(refreshed.recovery_zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(
            replayed
                .event_log
                .iter()
                .filter(|event| event.type_name == "item.refreshed")
                .count(),
            1
        );

        let recast = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_MAGIC,
                actor_id: 5000,
                target_actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            18_005,
        );
        let (status, events) = replayed.apply_journal_record(&recast);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "magic.spell_cast"));
    }

    #[test]
    fn legacy_projection_rest_remains_tag_only_and_byte_compatible() {
        let mut records = steady_light_rest_records(18_100);
        records.pop();
        let tired_id = tired_tag_id(5000);
        let mut make_tired = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            18_104,
        );
        make_tired
            .projection_mutations
            .push(ProjectionMutation::SetTag {
                tag: RpgTagState {
                    id: tired_id.clone(),
                    scope: "actor".to_string(),
                    scope_id: 5000,
                    label: "tired".to_string(),
                    kind: "condition".to_string(),
                    active: true,
                    source_event_seq: None,
                    expires: Some("after_rest".to_string()),
                },
                reason: "legacy_rest_fixture".to_string(),
            });
        records.push(make_tired);

        let mut legacy_rest = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            18_105,
        )
        .into_player_card();
        legacy_rest.bind_offer_kind("rest");
        legacy_rest
            .projection_mutations
            .push(ProjectionMutation::ClearTag {
                tag_id: tired_id.clone(),
                reason: "rest".to_string(),
            });
        let serialized =
            serde_json::to_value(&legacy_rest).expect("serialize historical projection Rest");
        assert_eq!(
            serialized["action"]["kind"],
            serde_json::json!(CW_ACTION_NONE)
        );
        assert!(
            serialized["action"].get("rest").is_none(),
            "the appended action-32 payload must not change historical Rest bytes"
        );
        let legacy_rest: JournalRecord =
            serde_json::from_value(serialized).expect("deserialize historical projection Rest");
        assert_eq!(legacy_rest.action.rest, CwRestInput::default());
        records.push(legacy_rest);

        let path = std::env::temp_dir().join(format!(
            "cosyworld-legacy-rest-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        for record in &records {
            append_action_journal(&path, record).expect("append legacy Rest replay record");
        }
        let replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay historical projection Rest");
        let _ = fs::remove_file(path);

        assert!(!replayed.tags.get(&tired_id).is_some_and(|tag| tag.active));
        let spell = replayed.item_by_id(2014).expect("spell remains present");
        assert_eq!(spell.charges, 0);
        assert_eq!(spell.zone, CW_CARD_ZONE_EXHAUSTED);
        assert!(!replayed
            .event_log
            .iter()
            .any(|event| event.type_name == "item.refreshed"));
    }

    #[test]
    fn rest_replay_applies_the_documented_fallback_for_legacy_missing_zone() {
        let seed_runtime = RuntimeWorld::seeded();
        let spell_meta = seed_runtime
            .items
            .get(&2014)
            .cloned()
            .expect("Steady Light metadata exists");
        let legacy_item_id = 91_2014;
        let receipt = MaterializationReceiptState {
            id: "test:legacy-rest-zone".to_string(),
            actor_id: 5000,
            card_id: "item-steady-light".to_string(),
            item_id: legacy_item_id,
            status: "materialized".to_string(),
            source_wallet: Some("test-wallet".to_string()),
            source_event_seq: 1,
        };
        let mut materialize = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                item_id: legacy_item_id,
                ..CwAction::default()
            },
            18_201,
        );
        materialize
            .projection_mutations
            .push(ProjectionMutation::MaterializeItem {
                receipt,
                item: CwItem {
                    id: legacy_item_id,
                    kind: CW_ITEM_KEEPSAKE,
                    charges: 0,
                    max_charges: 1,
                    recovery: CW_ITEM_RECOVERY_REST,
                    recovery_zone: CW_CARD_ZONE_SPELL_DECK,
                    weight_tenths: 1,
                    size_class: CW_ITEM_SIZE_TINY,
                    role: CW_ITEM_ROLE_SPELL,
                    zone: CW_CARD_ZONE_EXHAUSTED,
                    holder_actor_id: 5000,
                    ..CwItem::default()
                },
                meta: spell_meta,
                reason: "legacy_missing_recovery_zone".to_string(),
            });
        let mut legacy_json =
            serde_json::to_value(materialize).expect("serialize transitional legacy item");
        let legacy_item = legacy_json["projection_mutations"][0]["item"]
            .as_object_mut()
            .expect("materialized legacy item");
        for field in ["max_charges", "recovery", "recovery_zone", "reserved2"] {
            legacy_item.remove(field);
            assert!(!legacy_item.contains_key(field));
        }
        let legacy_bytes =
            serde_json::to_vec(&legacy_json).expect("serialize historical materialization bytes");
        let materialize: JournalRecord = serde_json::from_slice(&legacy_bytes)
            .expect("read missing recovery profile as zero-valued legacy state");
        let round_trip_json =
            serde_json::to_value(&materialize).expect("reserialize historical materialization");
        assert_eq!(round_trip_json, legacy_json);
        assert_eq!(
            serde_json::to_vec(&round_trip_json).expect("serialize round-trip JSON"),
            legacy_bytes
        );
        let rest = JournalRecord::new(
            rest_action_from_server_entitlement(
                5000,
                RestActionRequest {
                    requested_grade: CW_REST_GRADE_HEARTH,
                },
                CW_REST_GRADE_HEARTH,
            )
            .expect("server-authorized Hearth rest"),
            18_202,
        );
        let records = [rest_replay_actor_record(18_200), materialize, rest];

        let path = std::env::temp_dir().join(format!(
            "cosyworld-legacy-rest-zone-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        for record in &records {
            append_action_journal(&path, record).expect("append legacy zone record");
        }
        let replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay legacy recovery-zone fallback");
        let _ = fs::remove_file(path);

        let refreshed = replayed
            .item_by_id(legacy_item_id)
            .expect("legacy spell survives replay");
        assert_eq!(refreshed.charges, 1);
        assert_eq!(refreshed.max_charges, 1);
        assert_eq!(refreshed.recovery, CW_ITEM_RECOVERY_REST);
        assert_eq!(refreshed.zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(refreshed.recovery_zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(
            replayed
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == "item.refreshed" && event.item_id == Some(legacy_item_id)
                })
                .count(),
            1
        );
    }

    #[test]
    fn listen_and_rest_move_public_clocks_and_tags() {
        let mut runtime = RuntimeWorld::seeded();
        let mut create = CwAction::default();
        create.kind = CW_ACTION_CREATE_ACTOR;
        create.actor_id = 5000;
        create.location_id = MOONLIT_TRAIL_LOCATION_ID;
        let mut create_record = JournalRecord::new(create, 7084);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Rest Tester".to_string(),
                speech_mode: "prose".to_string(),
                title: "Clock-Touched Listener".to_string(),
                description: "A test avatar checking Listen and Rest projection.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
        let initial_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert_eq!(
            initial_state
                .calling
                .as_ref()
                .map(|calling| calling.statement.as_str()),
            Some(default_calling_statement())
        );
        assert_eq!(initial_state.ledger.unbanked_count, 0);
        if let Some(actor) = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
        {
            actor.stats.wisdom = 32;
        }

        let mut listen = CwAction::default();
        listen.kind = CW_ACTION_ABILITY_CHECK;
        listen.actor_id = 5000;
        listen.ability = LISTEN_ABILITY;
        listen.dc = LISTEN_DC;
        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(listen, 7085));
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some(MOONLIT_PROGRESS_CLOCK_ID)
                && event.clock_filled == Some(1)
        }));
        assert!(events
            .iter()
            .any(|event| event.type_name == "ledger.marked"));
        assert_eq!(
            runtime
                .clocks
                .get(MOONLIT_PROGRESS_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        let listened_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert_eq!(listened_state.ledger.unbanked_count, 2);
        assert!(listened_state
            .ledger
            .unbanked_marks
            .iter()
            .any(|mark| mark.category == "learned_truth"));
        assert!(listened_state
            .ledger
            .unbanked_marks
            .iter()
            .any(|mark| mark.category == "calling"));

        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(listen, 7086));
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "tag.applied" && event.tag_label.as_deref() == Some("tired")
        }));
        assert!(!events
            .iter()
            .any(|event| event.type_name == "ledger.marked"));
        assert_eq!(
            runtime
                .clocks
                .get(MOONLIT_PROGRESS_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        let tired_tag = tired_tag_id(5000);
        assert!(runtime
            .tags
            .get(&tired_tag)
            .map(|tag| tag.active)
            .unwrap_or(false));
        let tired_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(tired_state.tags.iter().any(|tag| tag.label == "tired"));
        assert_eq!(tired_state.ledger.unbanked_count, 0);
        assert_eq!(tired_state.ledger.banked_count, 2);
        assert!(runtime.rest_available(5000));
        assert!(tired_state
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "rest"));

        let mut rest_action = CwAction::default();
        rest_action.kind = CW_ACTION_NONE;
        rest_action.actor_id = 5000;
        let mut rest_record = JournalRecord::new(rest_action, 7087);
        rest_record
            .projection_mutations
            .push(ProjectionMutation::ClearTag {
                tag_id: tired_tag.clone(),
                reason: "rest".to_string(),
            });
        for tag_id in runtime.frontier_travel_since_rest_tag_ids(5000) {
            rest_record
                .projection_mutations
                .push(ProjectionMutation::ClearTag {
                    tag_id,
                    reason: "rest".to_string(),
                });
        }
        rest_record
            .projection_mutations
            .push(ProjectionMutation::AdvanceClock {
                clock_id: MOONLIT_DANGER_CLOCK_ID.to_string(),
                amount: 1,
                reason: "rest".to_string(),
            });
        let (status, events) = runtime.apply_journal_record(&rest_record);
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "tag.cleared" && event.tag_label.as_deref() == Some("tired")
        }));
        assert!(events.iter().any(|event| {
            event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some(MOONLIT_DANGER_CLOCK_ID)
                && event.clock_filled == Some(1)
        }));
        let rested_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(!rested_state.tags.iter().any(|tag| tag.label == "tired"));
        assert!(!rested_state
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "rest"));
        assert_eq!(
            rested_state
                .clocks
                .iter()
                .find(|clock| clock.id == MOONLIT_DANGER_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores RPG projection state");
        assert_eq!(
            restored
                .clocks
                .get(MOONLIT_PROGRESS_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        assert_eq!(
            restored
                .clocks
                .get(MOONLIT_DANGER_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        assert!(!restored
            .tags
            .get(&tired_tag)
            .map(|tag| tag.active)
            .unwrap_or(false));
        let restored_state = restored.state_response(Some(5000), &AccessContext::default());
        assert_eq!(
            restored_state
                .calling
                .as_ref()
                .map(|calling| calling.statement.as_str()),
            Some(default_calling_statement())
        );
        assert_eq!(restored_state.ledger.unbanked_count, 0);
        assert_eq!(restored_state.ledger.banked_count, 2);
    }
}
