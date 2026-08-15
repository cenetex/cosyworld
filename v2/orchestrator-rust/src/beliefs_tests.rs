use super::*;

#[test]
fn beliefs_decay_with_time_before_autonomy() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.world.tick = 1;
    runtime.beliefs.clear();
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == STORY_BUTTON_ITEM_ID {
            item.location_id = MOONLIT_TRAIL_LOCATION_ID;
            item.holder_actor_id = 0;
        }
    }
    runtime.remember_belief(
        RATI_ACTOR_ID,
        BELIEF_KIND_ITEM_LOCATION,
        STORY_BUTTON_ITEM_ID,
        MOONLIT_TRAIL_LOCATION_ID,
        BELIEF_TUNING.firsthand_confidence,
        BELIEF_TUNING.firsthand_salience,
        Some(RATI_ACTOR_ID),
    );
    runtime.world.tick = 25;

    runtime.decay_beliefs();

    let memory_id = RuntimeWorld::belief_id(
        RATI_ACTOR_ID,
        BELIEF_KIND_ITEM_LOCATION,
        STORY_BUTTON_ITEM_ID,
    );
    let memory = runtime
        .beliefs
        .get(&memory_id)
        .expect("aged memory remains above zero");
    assert_eq!(
        memory.confidence,
        BELIEF_TUNING.firsthand_confidence - (2 * BELIEF_TUNING.confidence_decay)
    );
    assert_eq!(
        memory.salience,
        BELIEF_TUNING.firsthand_salience - (2 * BELIEF_TUNING.salience_decay)
    );
    assert_eq!(memory.learned_tick, 25);
}

#[test]
fn beliefs_expire_when_time_decay_exhausts_them() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.world.tick = 1;
    runtime.beliefs.clear();
    runtime.remember_belief(
        RATI_ACTOR_ID,
        BELIEF_KIND_ITEM_LOCATION,
        STORY_BUTTON_ITEM_ID,
        MOONLIT_TRAIL_LOCATION_ID,
        BELIEF_TUNING.minimum_action_confidence,
        BELIEF_TUNING.salience_decay,
        Some(RATI_ACTOR_ID),
    );
    runtime.world.tick = 13;

    runtime.decay_beliefs();

    let memory_id = RuntimeWorld::belief_id(
        RATI_ACTOR_ID,
        BELIEF_KIND_ITEM_LOCATION,
        STORY_BUTTON_ITEM_ID,
    );
    assert!(runtime.beliefs.get(&memory_id).is_none());
}

#[test]
fn legacy_search_and_resident_memories_migrate_into_canonical_beliefs() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Legacy Witness",
    );
    let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
    snapshot.version = 13;
    snapshot.beliefs.clear();
    snapshot.resident_memories.insert(
        "resident_memory:1001:item_location:2005".to_string(),
        LegacyResidentMemoryState {
            id: "resident_memory:1001:item_location:2005".to_string(),
            carrier_actor_id: RATI_ACTOR_ID,
            kind: BELIEF_KIND_ITEM_LOCATION.to_string(),
            subject_id: STORY_BUTTON_ITEM_ID,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            confidence: 201,
            salience: 190,
            observed_tick: 7,
            source_actor_id: Some(WHISKERWIND_ACTOR_ID),
            holder_actor_id: Some(5000),
            learned_tick: 11,
            hops: 2,
        },
    );
    snapshot.search_memories.insert(
        "search_memory:5000:avatar:3:1002".to_string(),
        LegacySearchMemoryState {
            id: "search_memory:5000:avatar:3:1002".to_string(),
            actor_id: 5000,
            kind: "avatar".to_string(),
            location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            subject_id: WHISKERWIND_ACTOR_ID,
            subject_key: WHISKERWIND_ACTOR_ID.to_string(),
            confidence: 188,
            salience: 177,
            found_tick: 5,
            last_used_tick: 9,
            use_count: 3,
        },
    );
    snapshot.search_memories.insert(
        "search_memory:5000:hidden_exit:1:3".to_string(),
        LegacySearchMemoryState {
            id: "search_memory:5000:hidden_exit:1:3".to_string(),
            actor_id: 5000,
            kind: BELIEF_KIND_HIDDEN_EXIT.to_string(),
            location_id: COSY_COTTAGE_LOCATION_ID,
            subject_id: MOONLIT_TRAIL_LOCATION_ID,
            subject_key: "legacy-hidden-door-key-is-not-identity".to_string(),
            confidence: 176,
            salience: 165,
            found_tick: 6,
            last_used_tick: 10,
            use_count: 2,
        },
    );
    snapshot.search_memories.insert(
        "search_memory:5000:seed_exit:3:2".to_string(),
        LegacySearchMemoryState {
            id: "search_memory:5000:seed_exit:3:2".to_string(),
            actor_id: 5000,
            kind: BELIEF_KIND_SEED_EXIT.to_string(),
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            subject_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            subject_key: "legacy-seed-route-key-is-not-identity".to_string(),
            confidence: 164,
            salience: 153,
            found_tick: 8,
            last_used_tick: 12,
            use_count: 4,
        },
    );

    let restored = snapshot.into_runtime().expect("legacy beliefs migrate");
    let resident_belief = restored
        .beliefs
        .get(&RuntimeWorld::belief_id(
            RATI_ACTOR_ID,
            BELIEF_KIND_ITEM_LOCATION,
            STORY_BUTTON_ITEM_ID,
        ))
        .expect("resident memory becomes a belief");
    assert_eq!(resident_belief.holder_actor_id, RATI_ACTOR_ID);
    assert_eq!(resident_belief.related_actor_id, Some(5000));
    assert_eq!(resident_belief.source_actor_id, Some(WHISKERWIND_ACTOR_ID));
    assert_eq!(
        (resident_belief.observed_tick, resident_belief.learned_tick),
        (7, 11)
    );
    assert_eq!(resident_belief.hops, 2);

    let search_belief = restored
        .beliefs
        .get(&RuntimeWorld::belief_id(
            5000,
            BELIEF_KIND_ACTOR_LOCATION,
            WHISKERWIND_ACTOR_ID,
        ))
        .expect("search memory becomes the canonical kind");
    assert_eq!(search_belief.kind, BELIEF_KIND_ACTOR_LOCATION);
    assert_eq!(search_belief.source_actor_id, Some(5000));
    assert_eq!(
        (search_belief.observed_tick, search_belief.learned_tick),
        (5, 9)
    );

    let migrated_exits = [
        (
            BELIEF_KIND_HIDDEN_EXIT,
            COSY_COTTAGE_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
        ),
        (
            BELIEF_KIND_SEED_EXIT,
            MOONLIT_TRAIL_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        ),
    ];
    for (kind, location_id, subject_id) in migrated_exits {
        let belief_id = belief_id(5000, kind, subject_id, location_id, None);
        let migrated = restored
            .beliefs
            .get(&belief_id)
            .expect("legacy exit memory becomes a canonical belief");
        assert_eq!(migrated.id, belief_id);
        assert_eq!(migrated.kind, kind);
        assert_eq!(migrated.location_id, location_id);
        assert_eq!(migrated.subject_id, subject_id);
    }

    let current = serde_json::to_value(RuntimeSnapshot::from_runtime(&restored))
        .expect("current snapshot serializes");
    assert_eq!(current["version"], 20);
    assert!(current.get("beliefs").is_some());
    assert!(current.get("resident_memories").is_none());
    assert!(current.get("search_memories").is_none());
    for (kind, location_id, subject_id) in migrated_exits {
        let belief_id = belief_id(5000, kind, subject_id, location_id, None);
        let reserialized = &current["beliefs"][&belief_id];
        assert_eq!(reserialized["id"], belief_id);
        assert_eq!(reserialized["kind"], kind);
        assert_eq!(reserialized["location_id"], location_id);
        assert_eq!(reserialized["subject_id"], subject_id);
    }
}

#[test]
fn direct_and_inference_controllers_acquire_equivalent_firsthand_beliefs() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Direct Observer",
    );
    assert!(runtime.actor_control_mode(5000).is_direct_input());
    assert!(runtime.actor_uses_inference(RATI_ACTOR_ID));
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == STORY_BUTTON_ITEM_ID {
            item.location_id = COSY_COTTAGE_LOCATION_ID;
            item.holder_actor_id = 0;
        }
    }
    runtime.beliefs.clear();
    runtime.world.tick = 41;

    runtime.observe_room_for_actor(5000, COSY_COTTAGE_LOCATION_ID);
    runtime.observe_room_for_actor(RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID);

    let direct = runtime
        .beliefs
        .get(&RuntimeWorld::belief_id(
            5000,
            BELIEF_KIND_ITEM_LOCATION,
            STORY_BUTTON_ITEM_ID,
        ))
        .expect("direct controller observes the item");
    let inferred = runtime
        .beliefs
        .get(&RuntimeWorld::belief_id(
            RATI_ACTOR_ID,
            BELIEF_KIND_ITEM_LOCATION,
            STORY_BUTTON_ITEM_ID,
        ))
        .expect("inference controller observes the item");
    assert_eq!(direct.kind, inferred.kind);
    assert_eq!(direct.subject_id, inferred.subject_id);
    assert_eq!(direct.location_id, inferred.location_id);
    assert_eq!(direct.confidence, inferred.confidence);
    assert_eq!(direct.salience, inferred.salience);
    assert_eq!(direct.observed_tick, inferred.observed_tick);
    assert_eq!(direct.learned_tick, inferred.learned_tick);
    assert_eq!(direct.hops, inferred.hops);
    assert_eq!(direct.source_actor_id, Some(direct.holder_actor_id));
    assert_eq!(inferred.source_actor_id, Some(inferred.holder_actor_id));
}

#[test]
fn unified_belief_projection_replays_byte_stably() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Replay Witness",
    );
    runtime.beliefs.clear();
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == STORY_BUTTON_ITEM_ID {
            item.location_id = COSY_COTTAGE_LOCATION_ID;
            item.holder_actor_id = 0;
        }
    }
    runtime = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .expect("test setup normalizes through the snapshot boundary");
    runtime.beliefs.clear();
    let replay_base = RuntimeSnapshot::from_runtime(&runtime);
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        },
        91_332,
    );
    record
        .projection_mutations
        .push(ProjectionMutation::RememberSearchItem {
            item_id: STORY_BUTTON_ITEM_ID,
            location_id: COSY_COTTAGE_LOCATION_ID,
            reason: "belief_replay_test".to_string(),
        });

    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    let expected_choice = runtime
        .actor_by_id(RATI_ACTOR_ID)
        .and_then(|actor| runtime.resident_economy_autonomy_action(actor))
        .expect("belief-driven resident choice");
    let expected = serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
        .expect("expected snapshot serializes");
    let mut replayed = replay_base.into_runtime().expect("replay base restores");
    assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
    let replayed_choice = replayed
        .actor_by_id(RATI_ACTOR_ID)
        .and_then(|actor| replayed.resident_economy_autonomy_action(actor))
        .expect("replayed belief drives the same resident choice");
    let actual = serde_json::to_vec(&RuntimeSnapshot::from_runtime(&replayed))
        .expect("replayed snapshot serializes");
    assert!(
        actual == expected,
        "replayed snapshot bytes differ (actual {}, expected {})",
        actual.len(),
        expected.len()
    );
    assert_eq!(replayed_choice.kind, expected_choice.kind);
    assert_eq!(replayed_choice.actor_id, expected_choice.actor_id);
    assert_eq!(replayed_choice.item_id, expected_choice.item_id);
    assert_eq!(
        replayed_choice.destination_location_id,
        expected_choice.destination_location_id
    );
}

#[test]
fn direct_player_and_inference_actor_share_hearsay_decay_and_thresholds() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Listening Player",
    );
    assert!(runtime.actor_control_mode(5000).is_direct_input());
    assert!(runtime.actor_uses_inference(RATI_ACTOR_ID));
    runtime.beliefs.clear();
    runtime.world.tick = 53;
    runtime.remember_belief(
        RATI_ACTOR_ID,
        BELIEF_KIND_ITEM_LOCATION,
        DEWBRIGHT_BUTTON_ITEM_ID,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        BELIEF_TUNING.firsthand_confidence,
        BELIEF_TUNING.firsthand_salience,
        Some(RATI_ACTOR_ID),
    );

    runtime.exchange_beliefs_at(COSY_COTTAGE_LOCATION_ID);

    let direct_belief_id =
        RuntimeWorld::belief_id(5000, BELIEF_KIND_ITEM_LOCATION, DEWBRIGHT_BUTTON_ITEM_ID);
    let inference_belief_id = RuntimeWorld::belief_id(
        WHISKERWIND_ACTOR_ID,
        BELIEF_KIND_ITEM_LOCATION,
        DEWBRIGHT_BUTTON_ITEM_ID,
    );
    let hearsay = runtime
        .beliefs
        .get(&direct_belief_id)
        .expect("direct player learns the co-located actor's belief")
        .clone();
    let inference_hearsay = runtime
        .beliefs
        .get(&inference_belief_id)
        .expect("inference actor learns the same co-located belief")
        .clone();
    assert_eq!(hearsay.source_actor_id, Some(RATI_ACTOR_ID));
    assert_eq!(hearsay.observed_tick, 53);
    assert_eq!(hearsay.learned_tick, 53);
    assert_eq!(hearsay.hops, 1);
    assert_eq!(
        hearsay.confidence,
        BELIEF_TUNING.firsthand_confidence - BELIEF_TUNING.gossip_confidence_decay
    );
    assert_eq!(
        hearsay.salience,
        BELIEF_TUNING.firsthand_salience - BELIEF_TUNING.gossip_salience_decay
    );
    assert_eq!(inference_hearsay.kind, hearsay.kind);
    assert_eq!(inference_hearsay.subject_id, hearsay.subject_id);
    assert_eq!(inference_hearsay.location_id, hearsay.location_id);
    assert_eq!(inference_hearsay.confidence, hearsay.confidence);
    assert_eq!(inference_hearsay.salience, hearsay.salience);
    assert_eq!(inference_hearsay.observed_tick, hearsay.observed_tick);
    assert_eq!(inference_hearsay.learned_tick, hearsay.learned_tick);
    assert_eq!(inference_hearsay.hops, hearsay.hops);

    let steps_to_threshold = u64::from(
        (hearsay.confidence - BELIEF_TUNING.minimum_action_confidence)
            / BELIEF_TUNING.confidence_decay,
    );
    runtime.world.tick = 53 + steps_to_threshold * BELIEF_TUNING.decay_interval_ticks;
    runtime.decay_beliefs();
    for belief_id in [&direct_belief_id, &inference_belief_id] {
        let belief = runtime
            .beliefs
            .get(belief_id)
            .expect("belief remains at the shared action threshold");
        assert_eq!(belief.confidence, BELIEF_TUNING.minimum_action_confidence);
        assert!(runtime.belief_active(belief));
    }

    runtime.world.tick += BELIEF_TUNING.decay_interval_ticks;
    runtime.decay_beliefs();
    for belief_id in [&direct_belief_id, &inference_belief_id] {
        let belief = runtime
            .beliefs
            .get(belief_id)
            .expect("below-threshold belief remains available as weak context");
        assert!(belief.confidence < BELIEF_TUNING.minimum_action_confidence);
        assert!(!runtime.belief_active(belief));
    }
}
