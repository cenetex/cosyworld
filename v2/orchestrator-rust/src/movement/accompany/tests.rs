use super::*;

const PLAYER: u64 = 5_000;

fn bonded_world(status: &str) -> RuntimeWorld {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        PLAYER,
        COSY_COTTAGE_LOCATION_ID,
        "Accompany Witness",
    );
    complete_guided_story_for_test(&mut runtime, PLAYER);
    for actor in &mut runtime.world.actors[..runtime.world.actor_count] {
        if actor.id == PLAYER || actor.id == RATI_ACTOR_ID {
            actor.location_id = COSY_COTTAGE_LOCATION_ID;
        }
    }
    let (scout, mutation, _) = runtime
        .plan_scout_choice_action(PLAYER, RAIN_SOFT_GARDEN_LOCATION_ID)
        .expect("the garden route can be scouted");
    let mut record = JournalRecord::new(scout, 4_240);
    record.bind_offer_kind("explore_path");
    record.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    assert_eq!(
        runtime.actor_by_id(PLAYER).unwrap().location_id,
        COSY_COTTAGE_LOCATION_ID,
        "scouting reveals the way without taking it"
    );
    runtime.bonds.insert(
        bond_id(PLAYER, RATI_ACTOR_ID),
        BondState {
            id: bond_id(PLAYER, RATI_ACTOR_ID),
            actor_id: PLAYER,
            target_actor_id: RATI_ACTOR_ID,
            statement: "we walk the same road".to_string(),
            strength: 1,
            status: status.to_string(),
            source_event_seq: None,
            updated_event_seq: None,
            dialogue_status: String::new(),
            dialogue_event_seq: None,
        },
    );
    runtime
}

fn accompany_offers(runtime: &RuntimeWorld) -> Vec<RankedActionOffer> {
    let (_, offers) = runtime.legal_action_candidates(Some(PLAYER), &AccessContext::default());
    offers
        .into_iter()
        .filter(|offer| offer.kind == ACCOMPANY_OFFER_KIND)
        .collect()
}

#[test]
fn a_bonded_free_resident_can_travel_one_leg_with_you() {
    let runtime = bonded_world("forming");
    let offers = accompany_offers(&runtime);
    assert!(!offers.is_empty(), "a forming Bond is enough");
    for offer in &offers {
        assert_eq!(accompany_companion_id(&offer.id), Some(RATI_ACTOR_ID));
        let route = offer
            .route
            .as_ref()
            .expect("an accompany offer keeps its route");
        assert!(route.threshold.is_none(), "gated ways are excluded");
        assert_ne!(route.directionality, RouteDirectionality::OneWay);
        let destination = offer.target.as_ref().expect("destination");
        assert_eq!(destination.kind, "location");
        assert!(
            offer.label.starts_with("Travel with Rati to "),
            "{}",
            offer.label
        );
        assert_eq!(offer.verb, "Travel with");
        assert_eq!(action_card_suit(offer).as_deref(), Ok("hustle"));
        assert_eq!(offer.category, "travel");
    }
}

#[test]
fn only_a_certified_companion_is_offered() {
    // No Bond, or a resolved one: nothing.
    let mut runtime = bonded_world("forming");
    runtime.bonds.clear();
    assert!(
        accompany_offers(&runtime).is_empty(),
        "an unbonded resident stays"
    );
    let runtime = bonded_world("resolved");
    assert!(
        accompany_offers(&runtime).is_empty(),
        "a resolved Bond is not a live one"
    );

    // A resident authored to stay put never leaves with you.
    let mut runtime = bonded_world("active");
    runtime
        .actor_autonomy
        .entry(RATI_ACTOR_ID)
        .or_default()
        .control_mode = ActorControlMode::ReactiveAi;
    assert!(
        accompany_offers(&runtime).is_empty(),
        "reactive residents stay put"
    );

    // Not while either of you is mid-journey.
    let mut runtime = bonded_world("active");
    runtime.journeys.insert(
        RATI_ACTOR_ID,
        JourneyState {
            actor_id: RATI_ACTOR_ID,
            pathway_id: "test-pathway".to_string(),
            origin_location_id: COSY_COTTAGE_LOCATION_ID,
            destination_location_id: 700,
            destination_name: "Bethlehem".to_string(),
            path: vec![COSY_COTTAGE_LOCATION_ID, 700],
            current_step: 0,
            explorer: false,
        },
    );
    assert!(
        accompany_offers(&runtime).is_empty(),
        "a travelling resident is busy"
    );

    // A resident never proposes: the proposer must be a player.
    let runtime = bonded_world("active");
    assert!(!runtime.accompany_companion_accepts(RATI_ACTOR_ID, PLAYER));
}

#[test]
fn avatar_and_location_nouns_resolve_to_one_exact_accompany_action() {
    let mut runtime = bonded_world("active");
    let (_, offers) = runtime.legal_action_candidates(Some(PLAYER), &AccessContext::default());
    let accompany = offers
        .iter()
        .find(|offer| offer.kind == ACCOMPANY_OFFER_KIND)
        .cloned()
        .expect("an accompany offer");
    let destination_id = accompany
        .target
        .as_ref()
        .and_then(|target| target.id)
        .unwrap();
    let (scene_key, _) = runtime.story_hand_scene_for_actor(PLAYER);
    let mut selected = None;
    'draws: for location_generation in 0..offers.len() {
        for avatar_generation in 0..offers.len() {
            runtime.story_hand_states.insert(
                PLAYER,
                StoryHandActorState {
                    location_rotation_after: None,
                    scene_key: scene_key.clone(),
                    slot_generations: [location_generation as u64, 0, avatar_generation as u64],
                    free_think_used: false,
                },
            );
            let hand = runtime.action_hand_for(Some(PLAYER), &offers);
            let place = hand
                .entries
                .iter()
                .find(|entry| entry.entity_kind == "location" && entry.entity_id == destination_id);
            let rati = hand
                .entries
                .iter()
                .find(|entry| entry.entity_kind == "actor" && entry.entity_id == RATI_ACTOR_ID);
            if let (Some(place), Some(rati)) = (place, rati) {
                selected = Some((place.card_id.clone(), rati.card_id.clone()));
                break 'draws;
            }
        }
    }
    let (place_card, rati_card) = selected.expect("Think can deal the place and Rati together");
    let alone = runtime
        .resolved_story_hand_offer(PLAYER, &offers, std::slice::from_ref(&place_card))
        .map(|offer| offer.kind.clone());
    assert_ne!(
        alone.as_deref(),
        Some(ACCOMPANY_OFFER_KIND),
        "a place alone never takes someone along"
    );
    let resolved = runtime
        .resolved_story_hand_offer(PLAYER, &offers, &[place_card, rati_card])
        .expect("place and avatar resolve");
    assert_eq!(resolved.kind, ACCOMPANY_OFFER_KIND);
    assert_eq!(accompany_companion_id(&resolved.id), Some(RATI_ACTOR_ID));
    assert_eq!(
        resolved.target.as_ref().and_then(|target| target.id),
        Some(destination_id)
    );
}

#[test]
fn an_accompanied_leg_moves_both_and_replays_exactly() {
    let runtime = bonded_world("active");
    let offer = accompany_offers(&runtime).remove(0);
    let destination_id = offer.target.as_ref().and_then(|target| target.id).unwrap();
    let action = runtime
        .plan_accompany_action(PLAYER, &offer)
        .expect("Rati agrees");
    let record = JournalRecord::new(action, 4_242);

    let mut live = runtime.clone();
    let (status, events) = live.apply_journal_record(&record);
    assert_eq!(status, CW_OK);
    assert_eq!(
        live.actor_by_id(PLAYER).unwrap().location_id,
        destination_id
    );
    assert_eq!(
        live.actor_by_id(RATI_ACTOR_ID).unwrap().location_id,
        destination_id
    );
    let moved: Vec<_> = events
        .iter()
        .filter(|event| event.type_name == "actor.moved" && event.success)
        .collect();
    assert_eq!(moved.len(), 2);
    assert_eq!(moved[0].actor_id, Some(PLAYER));
    assert_eq!(moved[0].reason, 0);
    assert_eq!(moved[1].actor_id, Some(RATI_ACTOR_ID));
    assert_eq!(moved[1].reason, CW_REASON_ACCOMPANIED);
    assert_eq!(moved[1].target_actor_id, Some(PLAYER));

    // Replaying the same record on the same starting world lands identically.
    let mut replayed = runtime.clone();
    assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
    assert_eq!(
        replayed.actor_by_id(RATI_ACTOR_ID).unwrap().location_id,
        destination_id
    );
    let restored = RuntimeSnapshot::from_runtime(&live)
        .into_runtime()
        .expect("snapshot restores");
    assert_eq!(
        restored.actor_by_id(PLAYER).unwrap().location_id,
        destination_id
    );
    assert_eq!(
        restored.actor_by_id(RATI_ACTOR_ID).unwrap().location_id,
        destination_id
    );
}

#[test]
fn a_lapsed_consent_rejects_the_leg_without_moving_anyone() {
    let runtime = bonded_world("active");
    let offer = accompany_offers(&runtime).remove(0);
    let action = runtime
        .plan_accompany_action(PLAYER, &offer)
        .expect("Rati agrees");
    let record = JournalRecord::new(action, 4_243);

    let mut unbonded = runtime.clone();
    unbonded.bonds.clear();
    assert!(unbonded.plan_accompany_action(PLAYER, &offer).is_none());
    let (status, events) = unbonded.apply_journal_record(&record);
    assert_ne!(status, CW_OK);
    assert!(events
        .iter()
        .all(|event| event.type_name != "actor.moved" || !event.success));
    assert_eq!(
        unbonded.actor_by_id(PLAYER).unwrap().location_id,
        COSY_COTTAGE_LOCATION_ID
    );
    assert_eq!(
        unbonded.actor_by_id(RATI_ACTOR_ID).unwrap().location_id,
        COSY_COTTAGE_LOCATION_ID
    );
}
