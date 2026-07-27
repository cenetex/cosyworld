use super::*;

const LANTERN_JOB_ID: &str = "lantern-keeper:rekindle-the-beacon";
const LANTERN_PROGRESS_CLOCK_ID: &str = "lantern-keeper.light";
const LANTERN_DANGER_CLOCK_ID: &str = "lantern-keeper.darkness";
const PREVIOUS_WORLD_BUNDLE_HASH: &str =
    "sha256:b9103b7cf66349cf12db45170c3b8f9cdaaaf1a1fc6aed95a98fb47c553ef62d";
const FINAL_ACTOR_ID: u64 = 9_800;
const COMPANION_ACTOR_ID: u64 = 9_801;

fn projection_record(actor_id: u64, seed: u64, mutation: ProjectionMutation) -> JournalRecord {
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..CwAction::default()
        },
        seed,
    )
    .into_player_card();
    record.projection_mutations.push(mutation);
    record
}

fn apply_projection(
    runtime: &mut RuntimeWorld,
    actor_id: u64,
    seed: u64,
    mutation: ProjectionMutation,
) -> Vec<EventView> {
    let (status, events) =
        runtime.apply_journal_record(&projection_record(actor_id, seed, mutation));
    assert_eq!(status, CW_OK);
    events
}

fn search_feature(
    runtime: &mut RuntimeWorld,
    actor_id: u64,
    seed: u64,
    location_id: u64,
    feature_key: &str,
) -> u64 {
    apply_projection(
        runtime,
        actor_id,
        seed,
        ProjectionMutation::SearchFeature {
            location_id,
            feature_key: feature_key.to_string(),
            feature_name: feature_key.replace('_', " "),
            content: format!("authored evidence at {location_id}"),
            reason: "lantern_keeper_journey".to_string(),
        },
    )
    .into_iter()
    .find(|event| event.type_name == "feature.searched")
    .expect("feature search emits exact evidence")
    .seq
}

fn use_feature(
    runtime: &mut RuntimeWorld,
    actor_id: u64,
    seed: u64,
    location_id: u64,
    feature_key: &str,
    item_id: u64,
) -> u64 {
    apply_projection(
        runtime,
        actor_id,
        seed,
        ProjectionMutation::UseFeature {
            item_id,
            location_id,
            feature_key: feature_key.to_string(),
            content: format!("item {item_id} changed {feature_key}"),
            reason: "lantern_keeper_journey".to_string(),
        },
    )
    .into_iter()
    .find(|event| event.type_name == "item.used")
    .expect("feature use emits exact evidence")
    .seq
}

fn record_lantern_combat_victory(runtime: &mut RuntimeWorld, actor_id: u64) -> u64 {
    let mut outcome = runtime.append_async_job_event(
        "combat.encounter.resolved",
        actor_id,
        Some(8303),
        Some("The Moth-Eaten Knight yields the road.".to_string()),
    );
    outcome.content_id = Some(combat_encounter_id(LANTERN_JOB_ID));
    outcome.location_id = Some(803);
    outcome.location_name = runtime.location_name(803);
    outcome.total = Some(1);
    runtime.replace_projected_event(&outcome);
    let projected = runtime.apply_combat_outcome_projection(
        &CwAction {
            actor_id,
            ..CwAction::default()
        },
        &[outcome.clone()],
    );
    assert!(projected.iter().any(|event| {
        event.type_name == "tag.applied"
            && event.tag_id.as_deref() == Some(combat_resolution_tag_id(LANTERN_JOB_ID, 1).as_str())
    }));
    outcome.seq
}

fn assert_no_lantern_finale(runtime: &RuntimeWorld, actor_id: u64) {
    assert!(runtime
        .job_contribution_intents(actor_id, None, Some(LANTERN_JOB_ID), None, None,)
        .is_empty());
    assert_eq!(runtime.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 0);
    assert_eq!(runtime.job_status(&runtime.jobs[LANTERN_JOB_ID]), "active");
}

fn assert_tag_source(
    runtime: &RuntimeWorld,
    tag_id: &str,
    source_event_seq: u64,
    event_type: &str,
) {
    assert_eq!(
        runtime
            .tags
            .get(tag_id)
            .and_then(|tag| tag.source_event_seq),
        Some(source_event_seq)
    );
    assert!(runtime
        .event_log
        .iter()
        .any(|event| event.seq == source_event_seq && event.type_name == event_type));
}

pub(super) fn install_lantern_finale_evidence(
    runtime: &mut RuntimeWorld,
    final_actor_id: u64,
) -> Vec<u64> {
    create_test_human(runtime, COMPANION_ACTOR_ID, 804, "Tower Companion");
    create_test_human(runtime, 9_802, 800, "Inn Witness");
    create_test_human(runtime, 9_803, 801, "Mothwood Witness");
    create_test_human(runtime, 9_804, 802, "Ruin Witness");
    create_test_human(runtime, 9_805, 803, "Barrow Witness");

    let mut evidence = Vec::new();
    assert_no_lantern_finale(runtime, final_actor_id);

    evidence.push(search_feature(
        runtime,
        9_802,
        81_001,
        800,
        "failing_lantern",
    ));
    assert_no_lantern_finale(runtime, final_actor_id);

    evidence.push(use_feature(
        runtime,
        9_803,
        81_002,
        801,
        "cold_lamp_post",
        8402,
    ));
    assert_no_lantern_finale(runtime, final_actor_id);

    evidence.push(use_feature(
        runtime,
        9_804,
        81_003,
        802,
        "stone_lantern",
        8401,
    ));
    assert_no_lantern_finale(runtime, final_actor_id);

    evidence.push(use_feature(runtime, 9_805, 81_004, 803, "oil_slick", 8403));
    assert_no_lantern_finale(runtime, final_actor_id);

    evidence.push(record_lantern_combat_victory(runtime, 9_805));
    assert_no_lantern_finale(runtime, final_actor_id);

    for (index, item_id) in [8401, 8402, 8403, 8404].into_iter().enumerate() {
        evidence.push(use_feature(
            runtime,
            final_actor_id,
            81_010 + index as u64,
            804,
            "great_lens",
            item_id,
        ));
        if item_id != 8404 {
            assert_no_lantern_finale(runtime, final_actor_id);
        }
    }
    evidence
}

fn runtime_ready_for_lantern_finale() -> (RuntimeWorld, Vec<u64>) {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, FINAL_ACTOR_ID, 804, "Final Lantern Tender");
    let evidence = install_lantern_finale_evidence(&mut runtime, FINAL_ACTOR_ID);
    (runtime, evidence)
}

#[test]
fn lantern_finale_is_absent_and_rejected_before_the_tower() {
    for (index, location_id) in [800, 801, 802, 803].into_iter().enumerate() {
        let actor_id = 9_900 + index as u64;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            location_id,
            &format!("Shortcut Tester {location_id}"),
        );
        assert_no_lantern_finale(&runtime, actor_id);

        let response = runtime.state_response(Some(actor_id), &AccessContext::default());
        assert!(!response.action_offers.iter().any(|offer| {
            matches!(offer.kind.as_str(), "work" | "help")
                && offer
                    .project
                    .as_ref()
                    .is_some_and(|project| project.id == LANTERN_JOB_ID)
        }));

        let strategy = runtime.jobs[LANTERN_JOB_ID]
            .contribution_strategies
            .iter()
            .find(|strategy| strategy.id == "rekindle-beacon")
            .expect("authored finale strategy")
            .clone();
        let forged_intent = JobContributionIntent {
            job_id: LANTERN_JOB_ID.to_string(),
            strategy,
            target: ResolvedContributionTarget {
                kind: "job".to_string(),
                id: LANTERN_JOB_ID.to_string(),
                label: "the dark Mothwood beacon".to_string(),
            },
        };
        let record = projection_record(
            actor_id,
            82_000 + index as u64,
            ProjectionMutation::ResolveJobContribution {
                intent: forged_intent,
            },
        );
        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap();
        assert_eq!(runtime.apply_journal_record(&record).0, CW_ERR_RULE);
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap(),
            before
        );
    }
}

#[test]
fn lantern_shortcut_is_rejected_now_but_an_accepted_previous_epoch_record_replays() {
    let actor_id = 9_910;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, actor_id, 802, "Previous Epoch Tender");
    assert!(active_content()
        .manifest
        .persistence_compatibility
        .replay_compatible_bundle_hashes
        .iter()
        .any(|hash| hash == PREVIOUS_WORLD_BUNDLE_HASH));

    let mut previous_strategy = runtime.jobs[LANTERN_JOB_ID]
        .contribution_strategies
        .iter()
        .find(|strategy| strategy.id == "rekindle-beacon")
        .expect("current finale strategy")
        .clone();
    previous_strategy.requirements.clear();
    previous_strategy.baseline_progress = 2;
    previous_strategy.claim_policy = ContributionClaimPolicy::Repeatable;
    previous_strategy.pack_version = "0.1.5".to_string();
    let previous_intent = JobContributionIntent {
        job_id: LANTERN_JOB_ID.to_string(),
        strategy: previous_strategy,
        target: ResolvedContributionTarget {
            kind: "job".to_string(),
            id: LANTERN_JOB_ID.to_string(),
            label: "the dark Mothwood beacon".to_string(),
        },
    };
    let current_epoch_forgery = projection_record(
        actor_id,
        82_100,
        ProjectionMutation::ResolveJobContribution {
            intent: previous_intent,
        },
    );
    let before = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap();
    assert_eq!(
        runtime.apply_journal_record(&current_epoch_forgery).0,
        CW_ERR_RULE
    );
    assert_eq!(
        serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap(),
        before
    );

    let mut accepted_previous_epoch = current_epoch_forgery;
    accepted_previous_epoch.worldpack_bundle_hash = PREVIOUS_WORLD_BUNDLE_HASH.to_string();
    assert_eq!(
        runtime.apply_journal_record(&accepted_previous_epoch).0,
        CW_OK
    );
    assert_eq!(runtime.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 2);
    assert_eq!(runtime.job_status(&runtime.jobs[LANTERN_JOB_ID]), "active");
}

#[test]
fn previous_epoch_snapshot_refreshes_the_finale_contract_and_shared_evidence() {
    let actor_id = 9_911;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, actor_id, 802, "Snapshot Epoch Tender");
    let actor_evidence_id = feature_use_tag_id(actor_id, 801, "cold_lamp_post", 8402);
    runtime.tags.insert(
        actor_evidence_id.clone(),
        RpgTagState {
            id: actor_evidence_id,
            scope: "actor".to_string(),
            scope_id: actor_id,
            label: "used Mothglass Lens".to_string(),
            kind: "memory".to_string(),
            active: true,
            source_event_seq: Some(321),
            expires: None,
        },
    );
    let job = runtime
        .jobs
        .get_mut(LANTERN_JOB_ID)
        .expect("Lantern Keeper job");
    job.location_ids = vec![801, 802, 803, 804];
    let previous_strategy = job
        .contribution_strategies
        .iter_mut()
        .find(|strategy| strategy.id == "rekindle-beacon")
        .expect("previous finale strategy");
    previous_strategy.requirements.clear();
    previous_strategy.baseline_progress = 2;
    previous_strategy.claim_policy = ContributionClaimPolicy::Repeatable;
    previous_strategy.pack_version = "0.1.5".to_string();

    let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
    snapshot.worldpack_bundle_hash = PREVIOUS_WORLD_BUNDLE_HASH.to_string();
    let restored = snapshot
        .into_runtime()
        .expect("previous worldpack snapshot migrates");
    let restored_job = &restored.jobs[LANTERN_JOB_ID];
    assert_eq!(restored_job.location_ids, vec![800, 801, 802, 803, 804]);
    let restored_strategy = restored_job
        .contribution_strategies
        .iter()
        .find(|strategy| strategy.id == "rekindle-beacon")
        .expect("active finale strategy replaces the old snapshot contract");
    assert_eq!(restored_strategy.requirements.len(), 10);
    assert_eq!(restored_strategy.baseline_progress, 6);
    assert_eq!(restored_strategy.pack_version, "0.1.7");
    assert_eq!(
        restored.tags[&room_feature_use_tag_id(801, "cold_lamp_post", 8402)].source_event_seq,
        Some(321)
    );
    assert_no_lantern_finale(&restored, actor_id);
}

#[test]
fn lantern_journey_evidence_unlocks_one_controller_neutral_finale() {
    let (mut runtime, expected_evidence) = runtime_ready_for_lantern_finale();
    assert_eq!(runtime.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 0);

    assert_tag_source(
        &runtime,
        &room_feature_search_tag_id(800, "failing_lantern"),
        expected_evidence[0],
        "feature.searched",
    );
    for (index, (location_id, feature_key, item_id)) in [
        (801, "cold_lamp_post", 8402),
        (802, "stone_lantern", 8401),
        (803, "oil_slick", 8403),
        (804, "great_lens", 8401),
        (804, "great_lens", 8402),
        (804, "great_lens", 8403),
        (804, "great_lens", 8404),
    ]
    .into_iter()
    .enumerate()
    {
        let evidence_index = if index < 3 { index + 1 } else { index + 2 };
        assert_tag_source(
            &runtime,
            &room_feature_use_tag_id(location_id, feature_key, item_id),
            expected_evidence[evidence_index],
            "item.used",
        );
    }
    assert_tag_source(
        &runtime,
        &combat_resolution_tag_id(LANTERN_JOB_ID, 1),
        expected_evidence[4],
        "combat.encounter.resolved",
    );

    runtime
        .actor_autonomy
        .entry(FINAL_ACTOR_ID)
        .or_default()
        .control_mode = ActorControlMode::DirectInput;
    let direct_strategy_ids = runtime
        .job_contribution_intents(FINAL_ACTOR_ID, None, Some(LANTERN_JOB_ID), None, None)
        .into_iter()
        .map(|intent| intent.strategy.id)
        .collect::<Vec<_>>();
    runtime
        .actor_autonomy
        .entry(FINAL_ACTOR_ID)
        .or_default()
        .control_mode = ActorControlMode::LocalAi;
    let inference_strategy_ids = runtime
        .job_contribution_intents(FINAL_ACTOR_ID, None, Some(LANTERN_JOB_ID), None, None)
        .into_iter()
        .map(|intent| intent.strategy.id)
        .collect::<Vec<_>>();
    assert_eq!(direct_strategy_ids, inference_strategy_ids);
    assert_eq!(
        direct_strategy_ids,
        vec![
            "rekindle-beacon".to_string(),
            "tend-beacon-together".to_string()
        ]
    );

    runtime
        .actor_autonomy
        .entry(FINAL_ACTOR_ID)
        .or_default()
        .control_mode = ActorControlMode::DirectInput;
    let intent = runtime
        .job_contribution_intent(
            FINAL_ACTOR_ID,
            "work",
            Some(LANTERN_JOB_ID),
            Some("rekindle-beacon"),
            None,
        )
        .expect("the complete journey exposes the Tower finale");
    let final_record = projection_record(
        FINAL_ACTOR_ID,
        81_020,
        ProjectionMutation::ResolveJobContribution { intent },
    );
    let before_orbs = runtime.orb_balance(FINAL_ACTOR_ID);
    let before_finale = RuntimeSnapshot::from_runtime(&runtime);
    let (status, events) = runtime.apply_journal_record(&final_record);
    assert_eq!(status, CW_OK);
    assert_eq!(runtime.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 6);
    assert_eq!(
        runtime.job_status(&runtime.jobs[LANTERN_JOB_ID]),
        "completed"
    );
    assert!(runtime
        .tags
        .get("room:804:beacon_rekindled")
        .is_some_and(|tag| tag.active));
    assert_eq!(runtime.orb_balance(FINAL_ACTOR_ID), before_orbs + 2);

    let finale_event = events
        .iter()
        .find(|event| event.type_name == "job.contribution.resolved")
        .expect("finale emits one contribution event");
    assert_eq!(finale_event.location_id, Some(804));
    let trace = finale_event
        .content
        .as_deref()
        .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
        .expect("finale carries an inspectable contribution trace");
    assert_eq!(trace.requirement_source_event_seqs, expected_evidence);
    assert_eq!(trace.total_progress, 6);

    let completed_snapshot = RuntimeSnapshot::from_runtime(&runtime);
    assert_eq!(runtime.apply_journal_record(&final_record).0, CW_ERR_RULE);
    assert_eq!(runtime.orb_balance(FINAL_ACTOR_ID), before_orbs + 2);
    assert_eq!(runtime.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 6);
    assert_eq!(
        runtime.job_status(&runtime.jobs[LANTERN_JOB_ID]),
        "completed"
    );

    let mut replayed = before_finale
        .into_runtime()
        .expect("pre-finale snapshot reconnects");
    assert_eq!(replayed.apply_journal_record(&final_record).0, CW_OK);
    assert_eq!(replayed.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 6);
    assert_eq!(
        replayed.job_status(&replayed.jobs[LANTERN_JOB_ID]),
        "completed"
    );
    assert_eq!(replayed.orb_balance(FINAL_ACTOR_ID), before_orbs + 2);
    assert_eq!(replayed.orb_reward_claims, runtime.orb_reward_claims);
    let reconnected = completed_snapshot
        .into_runtime()
        .expect("completed finale snapshot reconnects");
    assert_eq!(reconnected.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 6);
    assert_eq!(
        reconnected.job_status(&reconnected.jobs[LANTERN_JOB_ID]),
        "completed"
    );
    assert_eq!(reconnected.orb_balance(FINAL_ACTOR_ID), before_orbs + 2);
}

#[test]
fn lantern_combat_is_evidence_and_danger_resolves_once() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, FINAL_ACTOR_ID, 803, "Barrow Resolver");
    let combat_seq = record_lantern_combat_victory(&mut runtime, FINAL_ACTOR_ID);
    assert_tag_source(
        &runtime,
        &combat_resolution_tag_id(LANTERN_JOB_ID, 1),
        combat_seq,
        "combat.encounter.resolved",
    );
    assert_eq!(runtime.clocks[LANTERN_PROGRESS_CLOCK_ID].filled, 0);
    assert_eq!(
        RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("combat evidence survives reconnect")
            .tags[&combat_resolution_tag_id(LANTERN_JOB_ID, 1)]
            .source_event_seq,
        Some(combat_seq)
    );

    let fail_record = projection_record(
        FINAL_ACTOR_ID,
        83_001,
        ProjectionMutation::AdvanceClock {
            clock_id: LANTERN_DANGER_CLOCK_ID.to_string(),
            amount: 6,
            reason: "test_darkness".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&fail_record).0, CW_OK);
    assert_eq!(runtime.job_status(&runtime.jobs[LANTERN_JOB_ID]), "failed");
    assert!(runtime
        .tags
        .get("room:804:black_beacon")
        .is_some_and(|tag| tag.active));
    let failed_updates = runtime
        .event_log
        .iter()
        .filter(|event| {
            event.type_name == "job.updated"
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains(":failed:"))
        })
        .count();
    assert_eq!(failed_updates, 1);

    let second_fail = projection_record(
        FINAL_ACTOR_ID,
        83_002,
        ProjectionMutation::AdvanceClock {
            clock_id: LANTERN_DANGER_CLOCK_ID.to_string(),
            amount: 6,
            reason: "test_darkness_retry".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&second_fail).0, CW_OK);
    assert_eq!(
        runtime
            .event_log
            .iter()
            .filter(|event| {
                event.type_name == "job.updated"
                    && event
                        .content
                        .as_deref()
                        .is_some_and(|content| content.contains(":failed:"))
            })
            .count(),
        failed_updates
    );
}
