use super::*;
const PLAYER: u64 = 9800;
const OTHER: u64 = 5001;
const JOB: &str = "lantern-keeper:rekindle-the-beacon";

fn mark_garden(runtime: &mut RuntimeWorld, actor_id: u64) {
    runtime
        .rpg_claims
        .insert(first_tale_trace_claim_key(actor_id, 1).unwrap());
}

fn put_at(runtime: &mut RuntimeWorld, actor_id: u64, location_id: u64) {
    runtime
        .world
        .actors
        .iter_mut()
        .find(|actor| actor.id == actor_id)
        .unwrap()
        .location_id = location_id;
}

fn advancing(runtime: &RuntimeWorld, actor_id: u64) -> (FirstTaleView, RankedActionOffer) {
    let view = runtime.state_response(Some(actor_id), &AccessContext::default());
    let tale = view.first_tale.unwrap();
    let id = tale
        .advancing_offer_id
        .as_ref()
        .expect("the journey deals a current next step");
    assert!(view
        .action_hand
        .entries
        .iter()
        .any(|entry| entry.offer_ids.contains(id)));
    let offer = view
        .action_offers
        .iter()
        .find(|offer| &offer.offer_id == id)
        .unwrap()
        .clone();
    assert!(action_offer_is_reachable(&offer));
    (tale, offer)
}

fn before_next_request_for_test(
    runtime: &RuntimeWorld,
    actor_id: u64,
    location_id: u64,
) -> RuntimeWorld {
    let mut saved = RuntimeSnapshot::from_runtime(runtime)
        .into_runtime()
        .unwrap();
    put_at(&mut saved, actor_id, location_id);
    saved
}

fn view_for_late_next_request(runtime: &RuntimeWorld, actor_id: u64) -> JourneyNextRequestView {
    runtime
        .first_tale_view(actor_id)
        .unwrap()
        .journey
        .unwrap()
        .next_request
        .unwrap()
}

fn notice_record(runtime: &RuntimeWorld, actor_id: u64, target_id: u64) -> JournalRecord {
    let (action, mutation, _) = runtime
        .plan_notice_actor_action(actor_id, target_id)
        .unwrap();
    let mut record = JournalRecord::new(action, 863001).into_player_card();
    record.bind_offer_kind(NOTICE_ACTOR_OFFER_KIND);
    record.projection_mutations.push(mutation);
    record
}

fn finish(runtime: &mut RuntimeWorld) -> JournalRecord {
    let intent = runtime
        .job_contribution_intent(PLAYER, "work", Some(JOB), Some("rekindle-beacon"), None)
        .unwrap();
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: PLAYER,
            ..CwAction::default()
        },
        863000,
    )
    .into_player_card();
    record.bind_offer_kind("work");
    record
        .projection_mutations
        .push(ProjectionMutation::ResolveJobContribution { intent });
    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    record
}

#[test]
fn beacon_return_has_personal_credit_one_settlement_and_live_follow_up() {
    let (mut runtime, _) = crate::lantern_keeper_tests::runtime_ready_for_lantern_finale();
    create_test_human(&mut runtime, OTHER, 804, "Later Visitor");
    mark_garden(&mut runtime, PLAYER);
    mark_garden(&mut runtime, OTHER);
    finish(&mut runtime);
    assert_eq!(
        runtime.first_tale_stage(PLAYER),
        Some(FirstTaleStage::ContinuationReportTravel)
    );
    assert_eq!(
        runtime.first_tale_stage(OTHER),
        Some(FirstTaleStage::ReturnTravel)
    );
    let (_, route) = advancing(&runtime, PLAYER);
    assert!(matches!(route.kind.as_str(), "move" | "explore_path"));
    put_at(&mut runtime, PLAYER, 800);
    let (_, report) = advancing(&runtime, PLAYER);
    assert_eq!(report.kind, NOTICE_ACTOR_OFFER_KIND);
    let mara_record = notice_record(&runtime, PLAYER, 8301);
    let (_, events) = runtime.apply_journal_record(&mara_record);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.type_name == "first_tale.journey_reported")
            .count(),
        1
    );
    assert!(runtime
        .first_tale_resident_memory(8301, PLAYER)
        .unwrap()
        .contains("used"));
    assert_eq!(
        runtime.first_tale_stage(PLAYER),
        Some(FirstTaleStage::ReturnTravel)
    );
    put_at(&mut runtime, PLAYER, 1);
    let (_, offer) = advancing(&runtime, PLAYER);
    assert_eq!(
        offer.target.as_ref().and_then(|target| target.id),
        Some(1001)
    );
    let before = RuntimeSnapshot::from_runtime(&runtime);
    let rati_record = notice_record(&runtime, PLAYER, 1001);
    let before_orbs = runtime.orb_balance(PLAYER);
    let (_, events) = runtime.apply_journal_record(&rati_record);
    let returned = events
        .iter()
        .find(|event| event.type_name == "first_tale.journey_returned")
        .unwrap();
    assert_eq!(
        returned.caused_by_event_seq,
        events
            .iter()
            .find(|event| event.type_name == "notice.actor_observed")
            .map(|event| event.seq)
    );
    assert_eq!(
        journal_beat_views(std::slice::from_ref(returned), 1)
            .first()
            .map(|beat| beat.category),
        Some(JournalBeatCategory::Story)
    );
    let personal = runtime.first_tale_view(PLAYER).unwrap().journey.unwrap();
    assert!(personal.recognition.as_ref().unwrap().contains("used"));
    assert!(personal
        .recognition
        .as_ref()
        .unwrap()
        .contains("helped with"));
    assert_eq!(personal.shared_progress, personal.shared_goal);
    let next = personal.next_request.as_ref().unwrap();
    assert_eq!(runtime.job_status(&runtime.jobs[&next.job_id]), "active");
    let next_id = next.job_id.clone();
    let next_location = next.destination_location_id;
    assert_eq!(runtime.orb_balance(PLAYER), before_orbs);
    let (_, repeated) = runtime.apply_journal_record(&rati_record);
    assert!(repeated
        .iter()
        .all(|event| event.type_name != "first_tale.journey_returned"));
    assert_eq!(runtime.orb_balance(PLAYER), before_orbs);
    let mut replayed = before.into_runtime().unwrap();
    replayed.apply_journal_record(&rati_record);
    assert_eq!(
        replayed.journey_record(PLAYER).recognition,
        personal.recognition
    );
    let helper_id = 9803;
    mark_garden(&mut runtime, helper_id);
    put_at(&mut runtime, helper_id, 800);
    let helper_report = notice_record(&runtime, helper_id, 8301);
    runtime.apply_journal_record(&helper_report);
    put_at(&mut runtime, helper_id, 1);
    let helper_return = notice_record(&runtime, helper_id, 1001);
    runtime.apply_journal_record(&helper_return);
    let helper_view = runtime.first_tale_view(helper_id).unwrap().journey.unwrap();
    assert_eq!(
        helper_view.contributions,
        vec!["used Mothglass Lens at Cold Lamp Post"]
    );
    assert!(helper_view
        .recognition
        .as_ref()
        .unwrap()
        .contains("Cold Lamp Post"));
    assert!(!helper_view
        .recognition
        .as_ref()
        .unwrap()
        .contains("Great Lantern Lens"));
    runtime.event_log.clear();
    let mut restored = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .unwrap();
    assert_eq!(
        restored
            .first_tale_view(PLAYER)
            .unwrap()
            .journey
            .unwrap()
            .recognition,
        personal.recognition
    );
    assert!(restored
        .first_tale_resident_memory(1001, PLAYER)
        .unwrap()
        .contains("Final Lantern Tender"));
    put_at(&mut restored, PLAYER, next_location);
    let (_, next_offer) = advancing(&restored, PLAYER);
    assert_eq!(next_offer.project.unwrap().id, next_id);
    let next_intent = restored
        .job_contribution_intent(PLAYER, "work", Some(&next_id), None, None)
        .unwrap();
    let mut next_record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: PLAYER,
            ..CwAction::default()
        },
        863002,
    )
    .into_player_card();
    next_record.bind_offer_kind("work");
    next_record
        .projection_mutations
        .push(ProjectionMutation::ResolveJobContribution {
            intent: next_intent,
        });
    assert_eq!(restored.apply_journal_record(&next_record).0, CW_OK);
    assert_eq!(
        restored.first_tale_stage(PLAYER),
        Some(FirstTaleStage::JourneyComplete)
    );
    assert!(restored
        .first_tale_view(PLAYER)
        .unwrap()
        .journey
        .unwrap()
        .next_request
        .is_none());
    let mut changed = before_next_request_for_test(&runtime, PLAYER, next_location);
    changed.jobs.get_mut(&next_id).unwrap().status = "completed".to_string();
    let refreshed = changed.first_tale_view(PLAYER).unwrap().journey.unwrap();
    assert!(refreshed
        .next_request
        .is_none_or(|request| request.job_id != next_id));
}

#[test]
fn late_visitor_carries_current_news_and_gets_their_own_request() {
    let (mut runtime, _) = crate::lantern_keeper_tests::runtime_ready_for_lantern_finale();
    finish(&mut runtime);
    create_test_human(&mut runtime, OTHER, 1, "Later Visitor");
    mark_garden(&mut runtime, OTHER);
    assert_eq!(
        runtime.first_tale_stage(OTHER),
        Some(FirstTaleStage::ReturnArrived)
    );
    let (tale, _) = advancing(&runtime, OTHER);
    assert!(tale.journey.unwrap().contributions.is_empty());
    let return_record = notice_record(&runtime, OTHER, 1001);
    runtime.apply_journal_record(&return_record);
    let view = runtime.first_tale_view(OTHER).unwrap().journey.unwrap();
    assert!(view
        .recognition
        .unwrap()
        .contains("welcomes Later Visitor’s road news"));
    assert!(view.contributions.is_empty());
    assert!(view.next_request.is_some());
    assert!(runtime
        .first_tale_resident_memory(1001, OTHER)
        .unwrap()
        .contains("Later Visitor"));
    let next = view_for_late_next_request(&runtime, OTHER);
    put_at(&mut runtime, OTHER, next.destination_location_id);
    let intent = runtime
        .job_contribution_intent(OTHER, "work", Some(&next.job_id), None, None)
        .unwrap();
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: OTHER,
            ..CwAction::default()
        },
        863003,
    )
    .into_player_card();
    record.bind_offer_kind("work");
    record
        .projection_mutations
        .push(ProjectionMutation::ResolveJobContribution { intent });
    runtime.apply_journal_record(&record);
    let restored = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .unwrap();
    assert_eq!(
        restored.first_tale_stage(OTHER),
        Some(FirstTaleStage::JourneyComplete)
    );
}

#[test]
fn failed_beacon_returns_the_changed_road_and_each_helpers_own_work() {
    let (mut runtime, _) = crate::lantern_keeper_tests::runtime_ready_for_lantern_finale();
    mark_garden(&mut runtime, PLAYER);
    create_test_human(&mut runtime, OTHER, 800, "Lamp Reader");
    mark_garden(&mut runtime, OTHER);
    let mut search = runtime.append_async_job_event(
        "feature.searched",
        OTHER,
        None,
        Some("Failing Lantern: the lamps went out".to_string()),
    );
    search.location_id = Some(800);
    runtime.replace_projected_event(&search);
    let key = room_feature_search_tag_id(800, "failing_lantern");
    runtime.tags.get_mut(&key).unwrap().source_event_seq = Some(search.seq);
    runtime.apply_first_tale_journey_projection(
        &CwAction {
            actor_id: OTHER,
            ..CwAction::default()
        },
        &[search],
    );
    runtime.jobs.get_mut(JOB).unwrap().status = "failed".to_string();
    assert_eq!(
        runtime.first_tale_stage(OTHER),
        Some(FirstTaleStage::ContinuationReport)
    );
    let report = notice_record(&runtime, OTHER, 8301);
    runtime.apply_journal_record(&report);
    put_at(&mut runtime, OTHER, 1);
    let returned = notice_record(&runtime, OTHER, 1001);
    runtime.apply_journal_record(&returned);
    let view = runtime.first_tale_view(OTHER).unwrap().journey.unwrap();
    assert!(view.outcome.contains("borrowed shadows"));
    assert_eq!(view.contributions, vec!["searched Failing Lantern"]);
    assert!(view
        .recognition
        .unwrap()
        .contains("searched Failing Lantern"));
    assert_eq!(runtime.journey_record(PLAYER).report_event_seq, None);
}

#[test]
fn accepted_journey_pins_the_first_missing_world_step() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, OTHER, 800, "Road Reader");
    mark_garden(&mut runtime, OTHER);
    runtime.bonds.insert(
        bond_id(OTHER, 8301),
        BondState {
            id: bond_id(OTHER, 8301),
            actor_id: OTHER,
            target_actor_id: 8301,
            statement: "Mara's request is accepted.".to_string(),
            strength: 1,
            status: "active".to_string(),
            source_event_seq: Some(90003),
            updated_event_seq: Some(90003),
            dialogue_status: RELATIONSHIP_DIALOGUE_DELIVERED.to_string(),
            dialogue_event_seq: Some(90003),
        },
    );
    let (view, offer) = advancing(&runtime, OTHER);
    assert_eq!(view.continuation.unwrap().phase, "accepted");
    assert_eq!(offer.kind, "search");
    assert_eq!(
        offer.target.unwrap().label.as_deref(),
        Some("Failing Lantern")
    );
}

#[test]
fn v214_snapshot_keeps_its_beacon_result_and_gains_the_return_steps() {
    let (mut runtime, _) = crate::lantern_keeper_tests::runtime_ready_for_lantern_finale();
    mark_garden(&mut runtime, PLAYER);
    finish(&mut runtime);
    let before_orbs = runtime.orb_balance(PLAYER);
    let mut saved = RuntimeSnapshot::from_runtime(&runtime);
    saved.worldpack_bundle_hash =
        "sha256:2b7ff2061dda0fa732a289999e6ea7924f52dd10a7c077babd63e5aa29b059cc".to_string();
    saved
        .rpg_claims
        .retain(|claim| !claim.starts_with("first_tale:journey"));
    let mut restored = saved
        .into_runtime()
        .expect("the earlier official save has a declared content migration");
    assert_eq!(
        restored.first_tale_stage(PLAYER),
        Some(FirstTaleStage::ContinuationReportTravel)
    );
    assert_eq!(restored.job_status(&restored.jobs[JOB]), "completed");
    assert_eq!(restored.orb_balance(PLAYER), before_orbs);
    put_at(&mut restored, PLAYER, 800);
    let report = notice_record(&restored, PLAYER, 8301);
    let (status, events) = restored.apply_journal_record(&report);
    assert_eq!(status, CW_OK);
    assert!(events
        .iter()
        .any(|event| event.type_name == "first_tale.journey_reported"));
    assert!(restored
        .first_tale_resident_memory(8301, PLAYER)
        .unwrap()
        .contains("Great Lantern Lens"));
}

#[test]
fn held_road_tool_pins_its_use_with_a_nearby_recipient() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, OTHER, 800, "Lens Tender");
    mark_garden(&mut runtime, OTHER);
    runtime.bonds.insert(
        bond_id(OTHER, 8301),
        BondState {
            id: bond_id(OTHER, 8301),
            actor_id: OTHER,
            target_actor_id: 8301,
            statement: "Mara's road request".to_string(),
            strength: 1,
            status: "active".to_string(),
            source_event_seq: Some(90003),
            updated_event_seq: Some(90003),
            dialogue_status: RELATIONSHIP_DIALOGUE_DELIVERED.to_string(),
            dialogue_event_seq: Some(90003),
        },
    );
    let mut search = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: OTHER,
            ..CwAction::default()
        },
        863004,
    )
    .into_player_card();
    search
        .projection_mutations
        .push(ProjectionMutation::SearchFeature {
            location_id: 800,
            feature_key: "failing_lantern".to_string(),
            feature_name: "Failing Lantern".to_string(),
            content: "The keeper went north.".to_string(),
            reason: "journey_test".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&search).0, CW_OK);
    put_at(&mut runtime, OTHER, 801);
    let item = runtime
        .world
        .items
        .iter_mut()
        .find(|item| item.id == 8402)
        .unwrap();
    item.holder_actor_id = OTHER;
    item.location_id = 0;
    item.zone = CW_CARD_ZONE_CARRIED;
    let (_, offer) = advancing(&runtime, OTHER);
    assert_eq!(offer.id, "use_feature:8402:801:cold_lamp_post");
}

#[test]
fn guard_step_has_a_place_before_the_encounter_starts() {
    let (mut runtime, _) = crate::lantern_keeper_tests::runtime_ready_for_lantern_finale();
    mark_garden(&mut runtime, PLAYER);
    runtime.tags.remove(&combat_resolution_tag_id(JOB, 1));
    assert_eq!(
        runtime.first_tale_journey_destination(PLAYER, FirstTaleStage::ContinuationAccepted),
        Some(803)
    );
}

#[test]
fn tired_keeper_traveler_rests_then_receives_the_final_beacon_card() {
    let (mut runtime, _) = crate::lantern_keeper_tests::runtime_ready_for_lantern_finale();
    mark_garden(&mut runtime, PLAYER);
    runtime.bonds.insert(
        bond_id(PLAYER, 8301),
        BondState {
            id: bond_id(PLAYER, 8301),
            actor_id: PLAYER,
            target_actor_id: 8301,
            statement: "Mara's road request".to_string(),
            strength: 1,
            status: "active".to_string(),
            source_event_seq: Some(90003),
            updated_event_seq: Some(90003),
            dialogue_status: RELATIONSHIP_DIALOGUE_DELIVERED.to_string(),
            dialogue_event_seq: Some(90003),
        },
    );
    runtime.tags.insert(
        tired_tag_id(PLAYER),
        RpgTagState {
            id: tired_tag_id(PLAYER),
            scope: "actor".to_string(),
            scope_id: PLAYER,
            label: "tired".to_string(),
            kind: "condition".to_string(),
            active: true,
            source_event_seq: None,
            expires: Some("after_rest".to_string()),
        },
    );
    let (tale, route) = advancing(&runtime, PLAYER);
    assert_eq!(tale.required_location_id, Some(800));
    assert!(tale
        .journey
        .unwrap()
        .instruction
        .contains("Rest at Wayside Lantern Inn"));
    assert!(matches!(route.kind.as_str(), "move" | "explore_path"));
    put_at(&mut runtime, PLAYER, 800);
    assert_eq!(advancing(&runtime, PLAYER).1.kind, "rest");
    let (action, mutations) = runtime.plan_rest_action(PLAYER).unwrap();
    let mut record = JournalRecord::new(action, 863005).into_player_card();
    record.bind_offer_kind("rest");
    record.projection_mutations = mutations;
    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    assert!(!runtime.tired_tag_active(PLAYER));
    put_at(&mut runtime, PLAYER, 804);
    let (_, work) = advancing(&runtime, PLAYER);
    assert_eq!(work.kind, "work");
    assert_eq!(work.project.unwrap().id, JOB);
}

#[test]
fn next_request_follows_the_generated_waypoints_to_its_task() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, PLAYER, 2, "Road Returner");
    mark_garden(&mut runtime, PLAYER);
    runtime.save_journey_record(
        PLAYER,
        &JourneyRecord {
            return_event_seq: Some(90004),
            next_job_id: Some("goblin-cave:name-the-price".to_string()),
            ..JourneyRecord::default()
        },
    );
    let (_, scout) = advancing(&runtime, PLAYER);
    assert_eq!(scout.kind, "explore_path");
    assert_eq!(scout.target.as_ref().and_then(|target| target.id), Some(3));
    let (action, mutation, _) = runtime.plan_scout_offer(PLAYER, &scout).unwrap();
    let mut record = JournalRecord::new(action, 863006).into_player_card();
    record.bind_offer_kind("explore_path");
    record.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    // Earlier story shuffles survive old snapshots. The new journey deals
    // its current physical step before the traveler chooses Think here.
    runtime.hand_generations.insert(PLAYER, 8);
    runtime = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .unwrap();
    let next_waypoint = runtime
        .journey_view(PLAYER)
        .unwrap()
        .next_location_id
        .unwrap();
    let (_, travel) = advancing(&runtime, PLAYER);
    assert_eq!(travel.kind, "move");
    assert_eq!(
        travel.target.as_ref().and_then(|target| target.id),
        Some(next_waypoint)
    );
    let mut thinking = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .unwrap();
    let (_, offers) = thinking.legal_action_candidates(Some(PLAYER), &AccessContext::default());
    let expected = thinking.action_hand_after_think_for(PLAYER, &offers, 0);
    let (scene, _) = thinking.story_hand_scene_for_actor(PLAYER);
    thinking.append_story_hand_thought_event(PLAYER, (0, &scene, "location", true, "player_think"));
    thinking = RuntimeSnapshot::from_runtime(&thinking)
        .into_runtime()
        .unwrap();
    let current = thinking.action_hand_for(Some(PLAYER), &offers);
    assert_eq!(
        current
            .entries
            .iter()
            .map(|entry| &entry.card_id)
            .collect::<Vec<_>>(),
        expected
            .entries
            .iter()
            .map(|entry| &entry.card_id)
            .collect::<Vec<_>>()
    );
    assert_ne!(
        current.entries[0].card_id,
        format!("location:{next_waypoint}")
    );
    let action = match runtime
        .plan_move_choice_action(PLAYER, next_waypoint, &AccessContext::default())
        .unwrap()
    {
        MovementPlan::Journey {
            action, mutation, ..
        } => {
            let mut record = JournalRecord::new(action, 863007).into_player_card();
            record.bind_offer_kind("move");
            record.projection_mutations.push(*mutation);
            record
        }
        MovementPlan::Adjacent(action) => JournalRecord::new(action, 863007).into_player_card(),
    };
    assert_eq!(runtime.apply_journal_record(&action).0, CW_OK);
    let (_, next) = advancing(&runtime, PLAYER);
    assert_eq!(next.kind, "explore_path");
    assert_eq!(next.target.as_ref().and_then(|target| target.id), Some(3));
    let (action, mutation, _) = runtime.plan_scout_offer(PLAYER, &next).unwrap();
    let mut reveal = JournalRecord::new(action, 863008).into_player_card();
    reveal.bind_offer_kind("explore_path");
    reveal.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&reveal).0, CW_OK);
    let (_, next) = advancing(&runtime, PLAYER);
    assert_eq!(next.kind, "move");
    assert_eq!(
        next.target.as_ref().and_then(|target| target.id),
        runtime.journey_view(PLAYER).unwrap().next_location_id
    );
}
