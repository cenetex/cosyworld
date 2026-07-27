use super::*;

const LANTERN_JOB_ID: &str = "lantern-keeper:rekindle-the-beacon";
const LANTERN_PROGRESS_CLOCK_ID: &str = "lantern-keeper.light";
const LANTERN_DANGER_CLOCK_ID: &str = "lantern-keeper.darkness";
const PREVIOUS_WORLD_BUNDLE_HASH: &str =
    "sha256:7c25a5ffcec350dba6f9211c3e2866ad4c9bc77173b415e46e023214242eb1fe";
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
fn lantern_question_projects_two_truthful_suggestions_and_replays_danger_memory() {
    let actor_id = 9_850;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, actor_id, 800, "Road Reader");

    let initial = runtime.state_response(Some(actor_id), &AccessContext::default());
    let initial_question = initial
        .shared_questions
        .iter()
        .find(|question| question.id == LANTERN_JOB_ID)
        .expect("Lantern question is visible before the finale strategy is legal");
    assert!(initial_question.promoted);
    assert_eq!(initial_question.presentation_state, "active");
    assert_eq!(
        (
            initial_question.filled,
            initial_question.segments,
            initial_question.danger_filled,
            initial_question.danger_segments,
        ),
        (0, 6, 0, 6)
    );
    assert!(!initial_question.danger_situation.is_empty());
    assert!(!initial_question.danger_consequence.is_empty());
    assert_eq!(initial_question.suggested_actions.len(), 2);
    assert_eq!(
        initial_question
            .suggested_actions
            .iter()
            .map(|suggestion| suggestion.offer_id.as_str())
            .collect::<Vec<_>>(),
        initial
            .action_hand
            .entries
            .iter()
            .map(|entry| entry.offer_id.as_str())
            .collect::<Vec<_>>()
    );
    assert!(initial_question.suggested_actions.iter().all(|suggestion| {
        !suggestion.label.is_empty()
            && !suggestion.target_label.is_empty()
            && !suggestion.source.is_empty()
            && suggestion.likely_effect.contains("current progress is 0/6")
            && suggestion.likely_effect.contains("danger is 0/6")
    }));

    apply_projection(
        &mut runtime,
        actor_id,
        80_100,
        ProjectionMutation::SetTag {
            tag: RpgTagState {
                id: tired_tag_id(actor_id),
                scope: "actor".to_string(),
                scope_id: actor_id,
                label: "tired".to_string(),
                kind: "condition".to_string(),
                active: true,
                source_event_seq: None,
                expires: Some("after_rest".to_string()),
            },
            reason: "question_preview_fixture".to_string(),
        },
    );
    let tired = runtime.state_response(Some(actor_id), &AccessContext::default());
    let rest = tired
        .action_offers
        .iter()
        .find(|offer| offer.kind == "rest")
        .expect("tired frontier traveler receives Rest");
    assert_eq!(
        runtime.rest_entitlement(actor_id).grade,
        CW_REST_GRADE_HEARTH
    );
    assert_eq!(rest.effect.as_deref(), Some("helps you feel fresh"));
    assert_eq!(rest.risk, None);
    let stale_offer_id = rest.offer_id.clone();
    let before_danger = RuntimeSnapshot::from_runtime(&runtime);
    let danger_record = projection_record(
        actor_id,
        80_101,
        ProjectionMutation::AdvanceClock {
            clock_id: LANTERN_DANGER_CLOCK_ID.to_string(),
            amount: 1,
            reason: "rest".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&danger_record).0, CW_OK);

    let after_danger = runtime.state_response(Some(actor_id), &AccessContext::default());
    let after_question = after_danger
        .shared_questions
        .iter()
        .find(|question| question.id == LANTERN_JOB_ID)
        .expect("Lantern question stays promoted after Rest");
    assert_eq!(after_question.danger_filled, 1);
    assert_eq!(
        after_question.danger_situation,
        "One more road lamp goes out. The dark now reaches the next bend."
    );
    assert!(after_question
        .suggested_actions
        .iter()
        .all(|suggestion| suggestion.likely_effect.contains("danger is 1/6")));
    assert!(!after_danger
        .action_offers
        .iter()
        .any(|offer| offer.offer_id == stale_offer_id));

    let mut replayed = before_danger
        .into_runtime()
        .expect("pre-Rest snapshot reconnects");
    assert_eq!(replayed.apply_journal_record(&danger_record).0, CW_OK);
    assert_eq!(
        serde_json::to_value(
            replayed
                .state_response(Some(actor_id), &AccessContext::default())
                .shared_questions
        )
        .unwrap(),
        serde_json::to_value(after_danger.shared_questions).unwrap()
    );

    let failure_record = projection_record(
        actor_id,
        80_102,
        ProjectionMutation::AdvanceClock {
            clock_id: LANTERN_DANGER_CLOCK_ID.to_string(),
            amount: 5,
            reason: "rest".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&failure_record).0, CW_OK);
    let failed = runtime.state_response(Some(actor_id), &AccessContext::default());
    let memory = failed
        .shared_questions
        .iter()
        .find(|question| question.id == LANTERN_JOB_ID)
        .expect("failed Lantern question leaves a public memory");
    assert_eq!(memory.presentation_state, "completed_memory");
    assert_eq!(memory.resolution, "failed");
    assert!(memory.suggested_actions.is_empty());
    assert!(memory
        .completion_memory
        .as_deref()
        .is_some_and(|text| text.contains("road went fully dark")));
    assert!(memory
        .participant_names
        .iter()
        .any(|name| name == "Road Reader"));
    let reconnected = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .expect("failure memory survives reconnect");
    assert_eq!(
        serde_json::to_value(
            reconnected
                .state_response(Some(actor_id), &AccessContext::default())
                .shared_questions
        )
        .unwrap(),
        serde_json::to_value(failed.shared_questions).unwrap()
    );
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
    assert_eq!(restored_strategy.pack_version, "0.1.8");
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

    let before_finale_view =
        runtime.state_response(Some(FINAL_ACTOR_ID), &AccessContext::default());
    let encountered_front = before_finale_view
        .fronts
        .iter()
        .find(|front| front.id == "lantern-keeper:hollow-light")
        .expect("the Lantern journey reaches its larger trouble before the finale");
    assert_eq!(encountered_front.presentation_state, "active");
    assert_eq!(
        encountered_front.premise,
        "The beacon's shadow has learned Rowan's shape and wants every road lamp to recognize it as keeper."
    );
    assert!(encountered_front.stakes_questions.iter().any(|question| {
        question
            == "Can Rowan be separated from the shadow without extinguishing the keeper's ember?"
    }));

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
    let after_finale_view = runtime.state_response(Some(FINAL_ACTOR_ID), &AccessContext::default());
    let persisted_front = after_finale_view
        .fronts
        .iter()
        .find(|front| front.id == "lantern-keeper:hollow-light")
        .expect("the larger trouble remains visible after the beacon work");
    assert_eq!(persisted_front.status, "active");
    assert_eq!(persisted_front.presentation_state, "persisted");
    assert_eq!(
        persisted_front.outcome_statement,
        "The immediate work is done, but the larger trouble remains unresolved."
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
    let story_receipt = events
        .iter()
        .find_map(semantic_receipts::semantic_story_receipt)
        .expect("finale emits one semantic story receipt");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.type_name == semantic_receipts::STORY_RECEIPT_EVENT_TYPE)
            .count(),
        1,
        "the preferred contribution path emits at most one story receipt"
    );
    assert_eq!(
        story_receipt.narration_key, trace.narration_key,
        "the authored contribution receipt remains preferred over the generic direct-fill receipt"
    );
    assert!(story_receipt
        .text
        .starts_with("Final Lantern Tender rekindles the dark Mothwood beacon."));
    assert!(story_receipt
        .text
        .contains("The beacon burns again and makes the Mothwood road trustworthy after dusk."));
    assert!(story_receipt.text.contains("Progress: 6/6."));
    assert!(story_receipt
        .text
        .contains("The road remembers Final Lantern Tender's work."));
    assert!(story_receipt
        .text
        .contains("Final Lantern Tender earns 2 Orbs."));
    assert!(story_receipt
        .text
        .ends_with("Next: carry the relit road's news back to Mara Wick."));
    assert_eq!(
        semantic_receipts::semantic_story_events(&events)
            .into_iter()
            .filter(|event| event.actor_id == Some(FINAL_ACTOR_ID))
            .map(|event| event.type_name.as_str())
            .collect::<Vec<_>>(),
        vec!["story.receipt"]
    );
    assert_eq!(
        room_memory_entries_chronological(804, &events)
            .into_iter()
            .map(|entry| entry.text)
            .collect::<Vec<_>>(),
        vec![
            "Final Lantern Tender rekindled the Mothwood beacon; the road is trustworthy after dusk."
                .to_string()
        ]
    );

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
    let (replay_status, replay_events) = replayed.apply_journal_record(&final_record);
    assert_eq!(replay_status, CW_OK);
    assert_eq!(
        replay_events
            .iter()
            .find_map(semantic_receipts::semantic_story_receipt),
        Some(story_receipt)
    );
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
    let reconnected_front = reconnected
        .state_response(Some(FINAL_ACTOR_ID), &AccessContext::default())
        .fronts
        .into_iter()
        .find(|front| front.id == "lantern-keeper:hollow-light")
        .expect("persisted larger trouble survives reconnect");
    assert_eq!(reconnected_front.presentation_state, "persisted");
    assert!(reconnected_front
        .outcome_statement
        .contains("remains unresolved"));
}

#[test]
fn both_lantern_clock_fills_are_once_only_snapshot_and_replay_safe_story_beats() {
    std::thread::Builder::new()
        .name("lantern-clock-fill-proof".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_both_lantern_clock_fills_are_once_only)
        .expect("Lantern clock proof thread starts")
        .join()
        .expect("Lantern clock proof thread completes");
}

fn assert_both_lantern_clock_fills_are_once_only() {
    struct FillCase {
        clock_id: &'static str,
        expected_status: &'static str,
        expected_tag_id: &'static str,
        expected_narration_key: &'static str,
        expected_story: &'static str,
    }

    for (index, case) in [
        FillCase {
            clock_id: LANTERN_PROGRESS_CLOCK_ID,
            expected_status: "completed",
            expected_tag_id: "room:804:beacon_rekindled",
            expected_narration_key: "lantern-keeper.light-filled",
            expected_story: "The beacon burns again and makes the Mothwood road trustworthy after dusk. Progress reaches 6/6, and the Lantern Keeper question is complete.",
        },
        FillCase {
            clock_id: LANTERN_DANGER_CLOCK_ID,
            expected_status: "failed",
            expected_tag_id: "room:804:black_beacon",
            expected_narration_key: "lantern-keeper.darkness-filled",
            expected_story: "The borrowed shadows learn every traveler's shape. Danger reaches 6/6, and the Lantern Keeper question fails.",
        },
    ]
    .into_iter()
    .enumerate()
    {
        let actor_id = 9_870 + index as u64;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, actor_id, 804, "Lantern Clock Witness");
        runtime = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("clock witness reconnects before replay proof");
        let before_bytes =
            serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime)).expect("before snapshot");
        let record = projection_record(
            actor_id,
            83_100 + index as u64,
            ProjectionMutation::AdvanceClock {
                clock_id: case.clock_id.to_string(),
                amount: 6,
                reason: "lantern_clock_fill_contract_test".to_string(),
            },
        );

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert_eq!(runtime.clocks[case.clock_id].filled, 6);
        assert_eq!(
            runtime.job_status(&runtime.jobs[LANTERN_JOB_ID]),
            case.expected_status
        );
        assert!(runtime
            .tags
            .get(case.expected_tag_id)
            .is_some_and(|tag| tag.active));
        let consequence_events = events
            .iter()
            .filter(|event| {
                event.type_name == "job.updated"
                    && event.content.as_deref().is_some_and(|content| {
                        content.starts_with(&format!(
                            "{LANTERN_JOB_ID}:{}:",
                            case.expected_status
                        ))
                    })
            })
            .collect::<Vec<_>>();
        assert_eq!(
            consequence_events.len(),
            1,
            "one authoritative status consequence"
        );
        let clock_event = events
            .iter()
            .find(|event| {
                event.type_name == "clock.updated"
                    && event.clock_id.as_deref() == Some(case.clock_id)
                    && event.clock_filled == Some(6)
            })
            .expect("terminal clock update");
        assert_eq!(
            consequence_events[0].caused_by_event_seq,
            Some(clock_event.seq),
            "the consequence is causally linked to its committed fill"
        );
        let story_events = events
            .iter()
            .filter(|event| event.type_name == semantic_receipts::STORY_RECEIPT_EVENT_TYPE)
            .collect::<Vec<_>>();
        assert_eq!(story_events.len(), 1, "one understandable story receipt");
        let story = semantic_receipts::semantic_story_receipt(story_events[0])
            .expect("story receipt parses");
        assert_eq!(story.narration_key, case.expected_narration_key);
        assert!(story.text.contains(case.expected_story), "{}", story.text);
        assert!(story.event_seqs.contains(&clock_event.seq));
        assert!(story
            .event_seqs
            .contains(&consequence_events[0].seq));
        assert_eq!(
            runtime
                .rpg_claims
                .iter()
                .filter(|claim| claim.starts_with(&format!("clock_fill:{}:", case.clock_id)))
                .count(),
            1
        );

        let completed_bytes =
            serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime)).expect("completed snapshot");
        let reconnected = serde_json::from_slice::<RuntimeSnapshot>(&completed_bytes)
            .expect("completed snapshot parses")
            .into_runtime()
            .expect("completed snapshot reconnects");
        assert_eq!(reconnected.clocks[case.clock_id].filled, 6);
        assert_eq!(
            reconnected.job_status(&reconnected.jobs[LANTERN_JOB_ID]),
            case.expected_status
        );
        assert!(reconnected
            .tags
            .get(case.expected_tag_id)
            .is_some_and(|tag| tag.active));
        assert_eq!(
            reconnected
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == semantic_receipts::STORY_RECEIPT_EVENT_TYPE
                        && semantic_receipts::semantic_story_receipt(event)
                            .is_some_and(|receipt| {
                                receipt.narration_key == case.expected_narration_key
                            })
                })
                .count(),
            1,
            "snapshot reconnect preserves one consequence receipt"
        );
        assert_eq!(
            reconnected
                .rpg_claims
                .iter()
                .filter(|claim| claim.starts_with(&format!("clock_fill:{}:", case.clock_id)))
                .count(),
            1,
            "snapshot reconnect preserves the once-only claim"
        );

        let mut replayed = serde_json::from_slice::<RuntimeSnapshot>(&before_bytes)
            .expect("before snapshot parses")
            .into_runtime()
            .expect("before snapshot reconnects");
        let (replay_status, replay_events) = replayed.apply_journal_record(&record);
        assert_eq!(replay_status, CW_OK);
        assert_eq!(
            serde_json::to_value(&replay_events).expect("replay events serialize"),
            serde_json::to_value(&events).expect("first events serialize")
        );
        assert_eq!(
            serde_json::to_vec(&RuntimeSnapshot::from_runtime(&replayed))
                .expect("replayed snapshot"),
            completed_bytes,
            "journal replay restores byte-identical state"
        );

        let (retry_status, retry_events) = runtime.apply_journal_record(&record);
        assert_eq!(retry_status, CW_OK);
        assert!(!retry_events
            .iter()
            .any(|event| event.type_name == "job.updated"));
        assert!(!retry_events
            .iter()
            .any(|event| event.type_name == semantic_receipts::STORY_RECEIPT_EVENT_TYPE));
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == "job.updated"
                        && event.content.as_deref().is_some_and(|content| {
                            content.starts_with(&format!(
                                "{LANTERN_JOB_ID}:{}:",
                                case.expected_status
                            ))
                        })
                })
                .count(),
            1,
            "retry cannot duplicate the authoritative consequence"
        );
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == semantic_receipts::STORY_RECEIPT_EVENT_TYPE
                        && semantic_receipts::semantic_story_receipt(event)
                            .is_some_and(|receipt| {
                                receipt.narration_key == case.expected_narration_key
                            })
                })
                .count(),
            1,
            "retry cannot duplicate the story receipt"
        );
    }
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
    let escalated_front = runtime
        .state_response(Some(FINAL_ACTOR_ID), &AccessContext::default())
        .fronts
        .into_iter()
        .find(|front| front.id == "lantern-keeper:hollow-light")
        .expect("failed beacon work escalates the larger trouble");
    assert_eq!(escalated_front.presentation_state, "escalated");
    assert!(escalated_front
        .outcome_statement
        .starts_with("The larger trouble has escalated."));
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
