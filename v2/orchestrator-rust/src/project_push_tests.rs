use super::*;

#[test]
fn combat_project_requires_declaration_before_dodge_is_available() {
    let mut runtime = RuntimeWorld::seeded();
    let create = CwAction {
        kind: CW_ACTION_CREATE_ACTOR,
        actor_id: 5000,
        location_id: MOONLIT_TRAIL_LOCATION_ID,
        ..CwAction::default()
    };
    let mut create_record = JournalRecord::new(create, 7160);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Guard Worker".to_string(),
            speech_mode: "prose".to_string(),
            title: "Shielded Helper".to_string(),
            description: "A test avatar turning defense into project preparation.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

    let initial = runtime.state_response(Some(5000), &AccessContext::default());
    assert!(initial
        .action_offers
        .iter()
        .any(|offer| offer.kind == "attack" && offer.verb == "Confront"));
    assert!(initial
        .action_offers
        .iter()
        .all(|offer| offer.kind != "defend" && offer.kind != "flee"));
    assert_eq!(
        runtime.project_progress_amount(5000, MOONLIT_TRAIL_LOCATION_ID),
        1
    );
}

#[test]
fn multi_room_project_makes_partial_evidence_useful_and_complete_evidence_best() {
    let mut runtime = RuntimeWorld::seeded();
    runtime
        .clocks
        .get_mut("solar-abyss.drowned-bell")
        .expect("solar project clock")
        .segments = 6;
    let create = CwAction {
        kind: CW_ACTION_CREATE_ACTOR,
        actor_id: 5000,
        location_id: 36,
        ..CwAction::default()
    };
    let mut create_record = JournalRecord::new(create, 7143);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Two-Sided Listener".to_string(),
            speech_mode: "prose".to_string(),
            title: "Bell Mediator".to_string(),
            description: "A test avatar checking multi-room project evidence.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
    assert_eq!(runtime.prepared_project_progress_amount(5000, 36), 3);

    let mut solar_search_record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7144,
    );
    solar_search_record
        .projection_mutations
        .push(ProjectionMutation::SearchFeature {
            location_id: 36,
            feature_key: "sun_bell".to_string(),
            feature_name: "Missing Sun Bell".to_string(),
            content: "The empty bracket hums downward.".to_string(),
            reason: "search_feature".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&solar_search_record).0, CW_OK);
    assert_eq!(
        runtime.project_location_evidence_count(
            5000,
            runtime
                .active_job_for_location(36)
                .expect("solar job remains active")
        ),
        1
    );
    assert_eq!(runtime.prepared_project_progress_amount(5000, 36), 4);
    let partial_state = runtime.state_response(Some(5000), &AccessContext::default());
    let partial_prepare = partial_state
        .action_offers
        .iter()
        .find(|offer| offer.kind == "prepare")
        .and_then(|offer| offer.effect.as_deref())
        .expect("partial prepare effect is exposed");
    assert!(partial_prepare.contains("Next Push advances 4 segments; Push now advances 2"));
    assert!(partial_prepare.contains("Partial evidence: 1/3 locations"));
    assert!(partial_prepare.contains("complete evidence adds 2"));
    assert_eq!(
        partial_state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "prepare")
            .and_then(|offer| offer.progress),
        Some(4)
    );

    runtime
        .listen_attempt_claims
        .insert(listen_attempt_claim_key(5000, DARKEST_OCEAN_LOCATION_ID));
    assert_eq!(
        runtime.project_location_evidence_count(
            5000,
            runtime
                .active_job_for_location(36)
                .expect("solar job remains active")
        ),
        2
    );
    assert_eq!(runtime.prepared_project_progress_amount(5000, 36), 4);
    runtime
        .listen_attempt_claims
        .insert(listen_attempt_claim_key(5000, DARK_ABYSS_LOCATION_ID));
    assert_eq!(
        runtime.project_location_evidence_count(
            5000,
            runtime
                .active_job_for_location(36)
                .expect("solar job remains active")
        ),
        3
    );
    assert_eq!(runtime.prepared_project_progress_amount(5000, 36), 5);
    let complete_state = runtime.state_response(Some(5000), &AccessContext::default());
    let complete_prepare = complete_state
        .action_offers
        .iter()
        .find(|offer| offer.kind == "prepare")
        .and_then(|offer| offer.effect.as_deref())
        .expect("complete prepare effect is exposed");
    assert!(complete_prepare.contains("Next Push advances 5 segments; Push now advances 2"));
    assert!(complete_prepare.contains("Evidence complete: 3/3 locations"));
    assert!(complete_prepare.contains("+2 prepared segments"));
    assert_eq!(
        complete_state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "prepare")
            .and_then(|offer| offer.progress),
        Some(5)
    );
}

#[test]
fn single_location_prepare_is_strictly_better_and_suppressed_at_clock_cap() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        MOONLIT_TRAIL_LOCATION_ID,
        "Single-Room Planner",
    );
    let intent = runtime
        .job_contribution_intent(5000, "work", Some(MOONLIT_JOB_ID), None, None)
        .expect("Moonlit project offers Push");
    assert_eq!(runtime.project_push_progress(5000, &intent, false), Some(2));
    assert_eq!(runtime.project_push_progress(5000, &intent, true), Some(3));
    assert!(runtime.prepare_available(5000));

    let initial = runtime.state_response(Some(5000), &AccessContext::default());
    let prepare = initial
        .action_offers
        .iter()
        .find(|offer| offer.kind == "prepare")
        .expect("strictly better Prepare is offered");
    assert_eq!(prepare.progress, Some(3));
    assert!(prepare.effect.as_deref().is_some_and(|effect| {
        effect.contains("Next Push advances 3 segments; Push now advances 2")
            && effect.contains("Evidence: 0/1 location")
    }));
    let push = initial
        .action_offers
        .iter()
        .find(|offer| offer.kind == "work")
        .expect("Push is offered");
    assert_eq!(push.progress, Some(2));
    assert!(push
        .effect
        .as_deref()
        .is_some_and(|effect| effect.contains("Advances 2 segments now (2 base)")));

    runtime
        .listen_attempt_claims
        .insert(listen_attempt_claim_key(5000, MOONLIT_TRAIL_LOCATION_ID));
    assert_eq!(runtime.project_push_progress(5000, &intent, true), Some(4));
    let evidenced = runtime.state_response(Some(5000), &AccessContext::default());
    assert!(evidenced.action_offers.iter().any(|offer| {
        offer.kind == "prepare"
            && offer.progress == Some(4)
            && offer.effect.as_deref().is_some_and(|effect| {
                effect.contains("Evidence complete: 1/1 location")
                    && effect.contains("+1 prepared segment")
            })
    }));

    let clock = runtime
        .clocks
        .get_mut(MOONLIT_PROGRESS_CLOCK_ID)
        .expect("Moonlit project clock");
    clock.filled = clock.segments - 1;
    assert_eq!(runtime.project_push_progress(5000, &intent, false), Some(1));
    assert_eq!(runtime.project_push_progress(5000, &intent, true), Some(1));
    assert!(!runtime.prepare_available(5000));
    let near_complete = runtime.state_response(Some(5000), &AccessContext::default());
    assert!(!near_complete
        .action_offers
        .iter()
        .any(|offer| offer.kind == "prepare"));
    assert!(near_complete.action_offers.iter().any(|offer| {
        offer.kind == "work"
            && offer.progress == Some(1)
            && offer.effect.as_deref().is_some_and(|effect| {
                effect.contains("Advances 1 segment now")
                    && effect.contains("1 of 2 gross segments apply")
                    && effect.contains("Only 1 remain")
            })
    }));
}

#[test]
fn legacy_action_zero_project_journal_is_byte_stable_and_new_push_replays_kernel_delta() {
    fn project_runtime() -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .clocks
            .get_mut("solar-abyss.drowned-bell")
            .expect("solar project clock")
            .segments = 6;
        create_test_human(&mut runtime, 5000, 36, "Replay Planner");
        runtime.tags.insert(
            prepared_tag_id(5000, 36),
            RpgTagState {
                id: prepared_tag_id(5000, 36),
                scope: "actor".to_string(),
                scope_id: 5000,
                label: "prepared".to_string(),
                kind: "aspect".to_string(),
                active: true,
                source_event_seq: None,
                expires: Some("after_work".to_string()),
            },
        );
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(5000, 36));
        runtime
    }

    let mut legacy_runtime = project_runtime();
    let intent = legacy_runtime
        .job_contribution_intent(5000, "work", None, None, None)
        .expect("solar project offers Push");
    let mut legacy_record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        411_001,
    )
    .into_player_card();
    legacy_record.version = 11;
    legacy_record
        .projection_mutations
        .push(ProjectionMutation::ResolveJobContribution {
            intent: intent.clone(),
        });
    let legacy_bytes = serde_json::to_vec(&legacy_record).expect("serialize v11 record");
    assert!(!String::from_utf8_lossy(&legacy_bytes).contains("project_push"));
    let legacy_round_trip: JournalRecord =
        serde_json::from_slice(&legacy_bytes).expect("deserialize v11 record");
    assert_eq!(
        serde_json::to_vec(&legacy_round_trip).expect("reserialize v11 record"),
        legacy_bytes
    );
    let (legacy_status, legacy_events) = legacy_runtime.apply_journal_record(&legacy_round_trip);
    assert_eq!(legacy_status, CW_OK);
    assert!(legacy_events.iter().any(|event| {
        event.type_name == "clock.updated"
            && event.clock_id.as_deref() == Some("solar-abyss.drowned-bell")
            && event.clock_delta == Some(3)
    }));
    assert!(!legacy_events
        .iter()
        .any(|event| event.type_name == "project.push.resolved"));
    drop(legacy_runtime);

    let new_record = {
        let runtime = project_runtime();
        let project_push = runtime
            .project_push_input(5000, &intent, true)
            .expect("valid partial-evidence Push input");
        assert_eq!(RuntimeWorld::resolve_project_push(project_push), Some(4));
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PROJECT_PUSH,
                actor_id: 5000,
                project_push,
                ..CwAction::default()
            },
            411_002,
        )
        .into_player_card();
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveJobContribution {
                intent: intent.clone(),
            });
        record
    };
    let new_bytes = serde_json::to_vec(&new_record).expect("serialize v12 Push record");
    assert!(String::from_utf8_lossy(&new_bytes).contains("\"project_push\""));

    for _ in 0..2 {
        let mut runtime = project_runtime();
        let preview_state = runtime.state_response(Some(5000), &AccessContext::default());
        let preview = preview_state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "work")
            .expect("prepared partial-evidence Push preview");
        assert_eq!(preview.progress, Some(4));
        assert!(preview.effect.as_deref().is_some_and(|effect| {
            effect.contains("Advances 4 segments now (2 base + 1 preparation + 1 evidence)")
                && effect.contains("Partial evidence: 1/3 locations")
        }));
        let replay_record: JournalRecord =
            serde_json::from_slice(&new_bytes).expect("deserialize v12 Push record");
        let (status, events) = runtime.apply_journal_record(&replay_record);
        assert_eq!(status, CW_OK);
        let resolved = events
            .iter()
            .find(|event| event.type_name == "project.push.resolved")
            .expect("kernel Push event");
        assert_eq!(resolved.total, preview.progress.map(i16::from));
        assert!(events.iter().any(|event| {
            event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some("solar-abyss.drowned-bell")
                && event.clock_delta == resolved.total
        }));
    }
}
