use super::*;

fn isolate_story_hand_actor(runtime: &mut RuntimeWorld, actor_id: u64) {
    let location_id = runtime
        .actor_by_id(actor_id)
        .map(|actor| actor.location_id)
        .expect("Story Hand actor exists");
    for actor in runtime.world.actors[..runtime.world.actor_count].iter_mut() {
        if actor.id != actor_id && actor.location_id == location_id {
            actor.location_id = DARK_ABYSS_LOCATION_ID;
        }
    }
}

#[test]
fn story_hand_scene_change_resets_each_slot_generation() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.story_hand_states.insert(
        5000,
        StoryHandActorState {
            scene_key: "safe:1".to_string(),
            slot_generations: [8, 4, 2],
            free_think_used: true,
        },
    );
    runtime.hand_generations.insert(5000, 9);

    let changed = runtime.story_hand_state_for_scene(5000, "safe:2");

    assert_eq!(changed.scene_key, "safe:2");
    assert_eq!(changed.slot_generations, [0; 3]);
    assert!(!changed.free_think_used);
}

fn submission_for_offer(
    offer: &RankedActionOffer,
    path: &str,
    payload: serde_json::Value,
) -> ActionOfferSubmissionRequest {
    ActionOfferSubmissionRequest {
        path: path.to_string(),
        offer_id: offer.offer_id.clone(),
        composition_id: offer.composition_id.clone(),
        kind: offer.kind.clone(),
        rules_action: offer.rules_action.clone(),
        operation: offer.operation.clone(),
        rules_profile: offer.rules_profile.clone(),
        state_revision: offer.state_revision,
        route: offer.route.clone(),
        target: offer.target.clone(),
        cost: offer.cost.clone(),
        payload,
    }
}

fn compact_submission_for_offer(
    offer: &RankedActionOffer,
    path: &str,
    payload: serde_json::Value,
) -> ActionOfferSubmissionRequest {
    ActionOfferSubmissionRequest {
        path: path.to_string(),
        offer_id: offer.offer_id.clone(),
        composition_id: offer.composition_id.clone(),
        kind: offer.kind.clone(),
        rules_action: None,
        operation: None,
        rules_profile: String::new(),
        state_revision: 0,
        route: None,
        target: None,
        cost: None,
        payload,
    }
}

fn live_command_request(actor_id: u64, actor_session: &str, offer_id: String) -> CommandRequest {
    CommandRequest {
        actor_id,
        actor_session: Some(actor_session.to_string()),
        // The command text is deliberately inert: the current certified card
        // identity, not reparsed prose, selects the authoritative action.
        command: "card identity selects this action".to_string(),
        offer_id: Some(offer_id),
        wallet_session: None,
        envelope: None,
    }
}

async fn current_dealt_offer(
    state: &AppState,
    actor_id: u64,
    predicate: impl Fn(&RankedActionOffer) -> bool,
) -> Option<RankedActionOffer> {
    let active_direct_actors = active_actor_ids_for_state(state);
    let runtime = state.inner.lock().await;
    let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
        Some(actor_id),
        &AccessContext::default(),
        Some(&active_direct_actors),
    );
    retain_configured_model_interaction_offers(
        &mut primary_action,
        &mut offers,
        state.ai_config.as_ref().as_ref(),
    );
    let hand = runtime.action_hand_for(Some(actor_id), &offers);
    offers.into_iter().find(|offer| {
        hand.entries
            .iter()
            .any(|entry| entry.offer_id == offer.offer_id)
            && predicate(offer)
    })
}

async fn certified_think_in_slot(
    state: &AppState,
    actor_id: u64,
    actor_session: &str,
    slot: Option<&str>,
) {
    let pass_offer_id = {
        let active_direct_actors = active_actor_ids_for_state(state);
        let runtime = state.inner.lock().await;
        let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
            Some(actor_id),
            &AccessContext::default(),
            Some(&active_direct_actors),
        );
        retain_configured_model_interaction_offers(
            &mut primary_action,
            &mut offers,
            state.ai_config.as_ref().as_ref(),
        );
        let hand = runtime.action_hand_for(Some(actor_id), &offers);
        hand.entries
            .iter()
            .find(|entry| slot.is_none_or(|slot| entry.slot == slot) && entry.think.available)
            .map(|entry| entry.think.offer_id.clone())
            .expect("the chosen Story Hand slot has a replacement")
    };
    let response = command(
        ConnectInfo("127.0.0.1:44272".parse().expect("client address")),
        State(state.clone()),
        Json(live_command_request(actor_id, actor_session, pass_offer_id)),
    )
    .await
    .0;
    assert!(
        response.ok,
        "current Think certificate succeeds: {response:?}"
    );
    assert!(
        response
            .events
            .iter()
            .any(|event| event.type_name == "hand.thought"),
        "Think must rotate through the ordinary hand pipeline: {response:?}"
    );
}

async fn certified_think(state: &AppState, actor_id: u64, actor_session: &str) {
    certified_think_in_slot(state, actor_id, actor_session, None).await;
}

async fn rotate_to_dealt_offer(
    state: &AppState,
    actor_id: u64,
    actor_session: &str,
    predicate: impl Fn(&RankedActionOffer) -> bool,
    card_name: &str,
) -> RankedActionOffer {
    let max_rotations = {
        let active_direct_actors = active_actor_ids_for_state(state);
        let runtime = state.inner.lock().await;
        let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
            Some(actor_id),
            &AccessContext::default(),
            Some(&active_direct_actors),
        );
        retain_configured_model_interaction_offers(
            &mut primary_action,
            &mut offers,
            state.ai_config.as_ref().as_ref(),
        );
        usize::from(runtime.action_hand_for(Some(actor_id), &offers).deck_size).max(1)
    };
    for _ in 0..max_rotations {
        if let Some(offer) = current_dealt_offer(state, actor_id, &predicate).await {
            return offer;
        }
        let desired_slot = {
            let active_direct_actors = active_actor_ids_for_state(state);
            let runtime = state.inner.lock().await;
            let (_, offers) = runtime.legal_action_candidates_with_presence(
                Some(actor_id),
                &AccessContext::default(),
                Some(&active_direct_actors),
            );
            offers
                .iter()
                .find(|offer| predicate(offer))
                .map(story_hand_natural_slot)
                .map(|slot| STORY_HAND_SLOTS[slot].to_string())
        };
        certified_think_in_slot(state, actor_id, actor_session, desired_slot.as_deref()).await;
    }
    let active_direct_actors = active_actor_ids_for_state(state);
    let runtime = state.inner.lock().await;
    let (_, offers) = runtime.legal_action_candidates_with_presence(
        Some(actor_id),
        &AccessContext::default(),
        Some(&active_direct_actors),
    );
    let available = offers
        .iter()
        .map(|offer| format!("{}:{}:{:?}", offer.kind, offer.id, offer.target))
        .collect::<Vec<_>>();
    panic!(
        "{card_name} did not appear within its projected {max_rotations}-card rotation; available: {available:?}"
    );
}

#[test]
fn live_story_button_hand_lifecycle_uses_exact_certificates_and_bounded_think_rotation() {
    std::thread::Builder::new()
        .name("story-button-golden".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build Story Button golden runtime")
                .block_on(live_story_button_hand_lifecycle());
        })
        .expect("spawn Story Button golden thread")
        .join()
        .expect("Story Button golden thread succeeds");
}

async fn live_story_button_hand_lifecycle() {
    let actor_id = 5_000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Story Button Golden Witness",
    );
    isolate_story_hand_actor(&mut runtime, actor_id);
    complete_guided_story_for_test(&mut runtime, actor_id);
    runtime.hide_loose_items_at_location(COSY_COTTAGE_LOCATION_ID);
    runtime.hide_loose_items_at_location(RAIN_SOFT_GARDEN_LOCATION_ID);
    runtime
        .listen_attempt_claims
        .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
    runtime
        .world
        .actors
        .iter_mut()
        .take(runtime.world.actor_count)
        .find(|actor| actor.id == actor_id)
        .expect("golden actor exists")
        .stats
        .strength = 1;
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            HEARTH_TONIC_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
                item.zone = CW_CARD_ZONE_CARRIED;
            }
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = actor_id;
                item.zone = CW_CARD_ZONE_CARRIED;
                item.container_item_id = 0;
                item.weight_tenths = 75;
            }
            WATCH_BELL_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = actor_id;
                item.zone = CW_CARD_ZONE_CARRIED;
                item.container_item_id = 0;
                item.weight_tenths = 75;
            }
            _ => {}
        }
    }
    assert!(runtime.actor_inventory_full(actor_id));
    let target = runtime
        .default_search_target(actor_id)
        .expect("the listened cottage clue exposes Scarf Basket");
    assert_eq!(target.key, SCARF_BASKET_FEATURE_KEY);
    let candidates =
        runtime.search_reveal_candidates_for_feature(COSY_COTTAGE_LOCATION_ID, &target.key);
    assert!(matches!(
        candidates.as_slice(),
        [SearchRevealCandidate::Item {
            item_id: STORY_BUTTON_ITEM_ID
        }]
    ));
    // Keep the golden deterministic even when Think rotates before the search:
    // choose a fixture seed whose bounded projected Think sequence reveals the
    // one available Story Button candidate. The hand itself is never mutated.
    let story_candidate = candidates[0].clone();
    let search_rotation_bound = usize::from(
        runtime
            .action_hand_for(
                Some(actor_id),
                &runtime
                    .legal_action_candidates(Some(actor_id), &AccessContext::default())
                    .1,
            )
            .deck_size,
    )
    .max(1);
    runtime.next_seed = (0u64..100_000)
        .find(|seed| {
            let mut next = *seed;
            // Each certified Think commits one player card and therefore
            // advances `next_seed` exactly once. The rotation helper can make
            // at most one Think per projected card before Search is dealt.
            (0..search_rotation_bound).all(|_| {
                next = next
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                runtime.search_candidate_succeeds(next, actor_id, &story_candidate)
            })
        })
        .expect("a deterministic Story Button reveal seed");

    let state = test_app_state(runtime, None);
    let (actor_session, _) = issue_actor_session(&state, actor_id);

    let search_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "search"
                && offer.target.as_ref().is_some_and(|target| {
                    target.kind == "feature"
                        && target.id == Some(COSY_COTTAGE_LOCATION_ID)
                        && target.label.as_deref() == Some("Scarf Basket")
                })
        },
        "Inspect Scarf Basket",
    )
    .await;
    assert_eq!(search_offer.verb, "Inspect");
    let search = command(
        ConnectInfo("127.0.0.1:44273".parse().expect("client address")),
        State(state.clone()),
        Json(live_command_request(
            actor_id,
            &actor_session,
            search_offer.offer_id.clone(),
        )),
    )
    .await
    .0;
    assert!(search.ok, "exact Inspect card succeeds: {search:?}");
    assert!(search.events.iter().any(|event| {
        event.type_name == "item.found"
            && event.actor_id == Some(actor_id)
            && event.item_id == Some(STORY_BUTTON_ITEM_ID)
    }));

    let pickup_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "pick_up"
                && offer.target.as_ref().and_then(|target| target.id) == Some(STORY_BUTTON_ITEM_ID)
        },
        "Pick Up Story Button",
    )
    .await;
    assert_submit_rejection_preserves_runtime(
        &state,
        &pickup_offer,
        "/actions/pick-up",
        serde_json::json!({
            "actor_id": actor_id,
            "actor_session": actor_session,
            "item_id": STORY_BUTTON_ITEM_ID,
            "target_item_id": WATCH_BELL_ITEM_ID,
        }),
        "full-capacity Pick Up: capacity-legal but noncanonical outgoing item",
        true,
    )
    .await;
    assert_submit_rejection_preserves_runtime(
        &state,
        &pickup_offer,
        "/actions/pick-up",
        serde_json::json!({
            "actor_id": actor_id,
            "actor_session": actor_session,
            "item_id": STORY_BUTTON_ITEM_ID,
        }),
        "full-capacity Pick Up: missing deterministic outgoing item",
        true,
    )
    .await;
    let pickup = submit_action_offer(
        ConnectInfo("127.0.0.1:44274".parse().expect("client address")),
        State(state.clone()),
        Json(compact_submission_for_offer(
            &pickup_offer,
            "/actions/pick-up",
            serde_json::json!({
                "actor_id": actor_id,
                "actor_session": actor_session,
                "item_id": STORY_BUTTON_ITEM_ID,
                "target_item_id": DEWBRIGHT_BUTTON_ITEM_ID,
            }),
        )),
    )
    .await
    .0;
    assert!(pickup.ok, "exact full-capacity pickup succeeds: {pickup:?}");
    assert!(pickup.events.iter().any(|event| {
        event.type_name == "item.picked_up" && event.item_id == Some(STORY_BUTTON_ITEM_ID)
    }));
    {
        let runtime = state.inner.lock().await;
        assert!(runtime
            .item_by_id(STORY_BUTTON_ITEM_ID)
            .is_some_and(|item| item.holder_actor_id == actor_id));
        assert!(runtime
            .item_by_id(DEWBRIGHT_BUTTON_ITEM_ID)
            .is_some_and(|item| {
                item.location_id == COSY_COTTAGE_LOCATION_ID && item.holder_actor_id == 0
            }));
    }

    let use_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "use_feature"
                && offer.target.as_ref().is_some_and(|target| {
                    target.kind == "feature" && target.id == Some(COSY_COTTAGE_LOCATION_ID)
                })
                && offer.id
                    == format!(
                        "use_feature:{STORY_BUTTON_ITEM_ID}:{COSY_COTTAGE_LOCATION_ID}:{SCARF_BASKET_FEATURE_KEY}"
                    )
        },
        "Use Story Button on Scarf Basket",
    )
    .await;
    let used = submit_action_offer(
        ConnectInfo("127.0.0.1:44275".parse().expect("client address")),
        State(state.clone()),
        Json(submission_for_offer(
            &use_offer,
            "/actions/use-item",
            serde_json::json!({
                "actor_id": actor_id,
                "actor_session": actor_session,
                "item_id": STORY_BUTTON_ITEM_ID,
                "location_id": COSY_COTTAGE_LOCATION_ID,
                "feature_key": SCARF_BASKET_FEATURE_KEY,
            }),
        )),
    )
    .await
    .0;
    assert!(used.ok, "exact Story Button feature use succeeds: {used:?}");
    assert!(used.events.iter().any(|event| {
        event.type_name == "item.used"
            && event.actor_id == Some(actor_id)
            && event.item_id == Some(STORY_BUTTON_ITEM_ID)
    }));
    {
        let runtime = state.inner.lock().await;
        assert!(runtime
            .item_by_id(STORY_BUTTON_ITEM_ID)
            .is_some_and(|item| item.holder_actor_id == actor_id));
        assert!(runtime
            .room_feature_views(COSY_COTTAGE_LOCATION_ID, Some(actor_id))
            .iter()
            .flat_map(|feature| feature.uses.iter())
            .any(|use_case| {
                use_case.item_id == STORY_BUTTON_ITEM_ID
                    && use_case.used
                    && use_case.effect.as_deref() == Some("friendship with Rati grows")
            }));
    }

    // The exchange occupies the cottage floor. Scout the adjacent route with
    // its current card, then use the newly dealt exact Move to an empty floor
    // before the exact Drop card.
    let scout_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "explore_path"
                && offer.target.as_ref().and_then(|target| target.id)
                    == Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        },
        "Scout Rain-Soft Garden",
    )
    .await;
    let scouted = submit_action_offer(
        ConnectInfo("127.0.0.1:44278".parse().expect("client address")),
        State(state.clone()),
        Json(submission_for_offer(
            &scout_offer,
            "/actions/explore-path",
            serde_json::json!({
                "actor_id": actor_id,
                "actor_session": actor_session,
                "destination_location_id": RAIN_SOFT_GARDEN_LOCATION_ID,
            }),
        )),
    )
    .await
    .0;
    assert!(scouted.ok, "exact Scout card succeeds: {scouted:?}");
    let move_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "move"
                && offer.target.as_ref().and_then(|target| target.id)
                    == Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        },
        "Move to Rain-Soft Garden",
    )
    .await;
    let moved = submit_action_offer(
        ConnectInfo("127.0.0.1:44279".parse().expect("client address")),
        State(state.clone()),
        Json(submission_for_offer(
            &move_offer,
            "/actions/move",
            serde_json::json!({
                "actor_id": actor_id,
                "actor_session": actor_session,
                "destination_location_id": RAIN_SOFT_GARDEN_LOCATION_ID,
            }),
        )),
    )
    .await
    .0;
    assert!(moved.ok, "exact Move card succeeds: {moved:?}");
    {
        let runtime = state.inner.lock().await;
        assert_eq!(
            runtime.actor_by_id(actor_id).map(|actor| actor.location_id),
            Some(RAIN_SOFT_GARDEN_LOCATION_ID),
            "Move reaches the empty drop floor"
        );
        assert!(runtime.room_floor_empty(RAIN_SOFT_GARDEN_LOCATION_ID));
    }

    let drop_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "drop_item"
                && offer.target.as_ref().and_then(|target| target.id) == Some(STORY_BUTTON_ITEM_ID)
        },
        "Drop Story Button",
    )
    .await;
    let dropped = submit_action_offer(
        ConnectInfo("127.0.0.1:44276".parse().expect("client address")),
        State(state.clone()),
        Json(submission_for_offer(
            &drop_offer,
            "/actions/drop",
            serde_json::json!({
                "actor_id": actor_id,
                "actor_session": actor_session,
                "item_id": STORY_BUTTON_ITEM_ID,
            }),
        )),
    )
    .await
    .0;
    assert!(dropped.ok, "exact Story Button drop succeeds: {dropped:?}");
    {
        let runtime = state.inner.lock().await;
        assert!(runtime
            .item_by_id(STORY_BUTTON_ITEM_ID)
            .is_some_and(|item| {
                item.location_id == RAIN_SOFT_GARDEN_LOCATION_ID && item.holder_actor_id == 0
            }));
    }

    let retake_offer = rotate_to_dealt_offer(
        &state,
        actor_id,
        &actor_session,
        |offer| {
            offer.kind == "pick_up"
                && offer.target.as_ref().and_then(|target| target.id) == Some(STORY_BUTTON_ITEM_ID)
        },
        "Pick Up Story Button again",
    )
    .await;
    let retaken = submit_action_offer(
        ConnectInfo("127.0.0.1:44277".parse().expect("client address")),
        State(state.clone()),
        Json(submission_for_offer(
            &retake_offer,
            "/actions/pick-up",
            serde_json::json!({
                "actor_id": actor_id,
                "actor_session": actor_session,
                "item_id": STORY_BUTTON_ITEM_ID,
            }),
        )),
    )
    .await
    .0;
    assert!(
        retaken.ok,
        "exact Story Button retake succeeds: {retaken:?}"
    );
    let runtime = state.inner.lock().await;
    assert!(runtime
        .item_by_id(STORY_BUTTON_ITEM_ID)
        .is_some_and(|item| item.holder_actor_id == actor_id));
}

async fn assert_submit_rejection_preserves_runtime(
    state: &AppState,
    offer: &RankedActionOffer,
    path: &str,
    payload: serde_json::Value,
    case: &str,
    must_be_dealt: bool,
) {
    if must_be_dealt {
        let actor_id = payload
            .get("actor_id")
            .and_then(serde_json::Value::as_u64)
            .expect("certified payload has an actor id");
        if let Some(session) = payload
            .get("actor_session")
            .and_then(serde_json::Value::as_str)
        {
            assert_eq!(
                actor_for_session(&state.actor_sessions, session),
                Some(actor_id),
                "{case}: the submitting actor session activates the exact hand"
            );
        }
        let active_direct_actors = active_actor_ids_for_state(state);
        let runtime = state.inner.lock().await;
        let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
            Some(actor_id),
            &AccessContext::default(),
            Some(&active_direct_actors),
        );
        retain_configured_model_interaction_offers(
            &mut primary_action,
            &mut offers,
            state.ai_config.as_ref().as_ref(),
        );
        let hand = runtime.action_hand_for(Some(actor_id), &offers);
        assert!(
            hand.entries
                .iter()
                .any(|entry| entry.offer_id == offer.offer_id),
            "{case}: certificate is not in the current hand"
        );
    }
    let (before_snapshot, before_events) = {
        let runtime = state.inner.lock().await;
        (
            serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
                .expect("serialize snapshot before rejected offer submit"),
            serde_json::to_vec(&runtime.event_log)
                .expect("serialize event log before rejected offer submit"),
        )
    };
    let response = submit_action_offer(
        ConnectInfo("127.0.0.1:44271".parse().expect("client address")),
        State(state.clone()),
        Json(submission_for_offer(offer, path, payload)),
    )
    .await
    .0;
    assert!(!response.ok, "{case}: {response:?}");
    assert_eq!(response.status, 400, "{case}: {response:?}");
    assert!(response.events.is_empty(), "{case}: {response:?}");

    let runtime = state.inner.lock().await;
    assert_eq!(
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
            .expect("serialize snapshot after rejected offer submit"),
        before_snapshot,
        "{case}: rejected submit changed the runtime snapshot"
    );
    assert_eq!(
        serde_json::to_vec(&runtime.event_log).expect("serialize event log after rejected submit"),
        before_events,
        "{case}: rejected submit appended an event"
    );
}

async fn assert_missing_and_wrong_fields_reject_without_mutation(
    state: &AppState,
    offer: &RankedActionOffer,
    path: &str,
    payload: &serde_json::Value,
    fields: &[&str],
    matrix: &str,
) {
    for field in fields {
        let mut missing = payload.clone();
        missing
            .as_object_mut()
            .expect("test payload is an object")
            .remove(*field);
        assert_submit_rejection_preserves_runtime(
            state,
            offer,
            path,
            missing,
            &format!("{matrix}: missing {field}"),
            true,
        )
        .await;

        let mut wrong = payload.clone();
        let value = wrong
            .as_object_mut()
            .expect("test payload is an object")
            .get_mut(*field)
            .expect("matrix field is present");
        *value = match value {
            serde_json::Value::Number(number) => serde_json::Value::from(
                number
                    .as_u64()
                    .expect("matrix numeric fields are unsigned")
                    .saturating_add(999_999),
            ),
            serde_json::Value::String(text) => serde_json::Value::String(format!("wrong-{text}")),
            other => panic!("unsupported matrix field value {other:?}"),
        };
        assert_submit_rejection_preserves_runtime(
            state,
            offer,
            path,
            wrong,
            &format!("{matrix}: wrong {field}"),
            true,
        )
        .await;
    }
}

#[tokio::test]
async fn action_submit_rejects_malicious_certified_offer_payload_matrix_without_mutation() {
    let actor_id = 5000;

    // A current offer is still unusable when it is not one of the Story Hand cards
    // dealt to the actor.  Use three exact pickup choices so one is certainly
    // outside the initial hand.
    let mut undealt_runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut undealt_runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Undealt Certificate Witness",
    );
    for item in &mut undealt_runtime.world.items[..undealt_runtime.world.item_count] {
        if [
            HEARTH_TONIC_ITEM_ID,
            DEWBRIGHT_BUTTON_ITEM_ID,
            STORY_BUTTON_ITEM_ID,
        ]
        .contains(&item.id)
        {
            item.holder_actor_id = 0;
            item.location_id = COSY_COTTAGE_LOCATION_ID;
            item.zone = CW_CARD_ZONE_WORLD;
            item.container_item_id = 0;
        }
    }
    let (_, undealt_offers) =
        undealt_runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
    let undealt_hand = undealt_runtime.action_hand_for(Some(actor_id), &undealt_offers);
    let undealt_offer = undealt_offers
        .iter()
        .find(|offer| {
            offer.kind == "pick_up"
                && !undealt_hand
                    .entries
                    .iter()
                    .any(|entry| entry.offer_id == offer.offer_id)
        })
        .expect("a current pickup certificate remains undealt")
        .clone();
    let undealt_item_id = undealt_offer
        .target
        .as_ref()
        .and_then(|target| target.id)
        .expect("pickup offer binds an item");
    let undealt_state = test_app_state(undealt_runtime, None);
    let (undealt_session, _) = issue_actor_session(&undealt_state, actor_id);
    assert_submit_rejection_preserves_runtime(
        &undealt_state,
        &undealt_offer,
        "/actions/pick-up",
        serde_json::json!({
            "actor_id": actor_id,
            "actor_session": undealt_session,
            "item_id": undealt_item_id,
        }),
        "current but undealt offer",
        false,
    )
    .await;

    // Item Use and feature Use have different exact target encodings.  Cover
    // both so a client cannot omit or substitute either side of their binding.
    let mut use_runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut use_runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Use Certificate Witness",
    );
    for actor in &mut use_runtime.world.actors[..use_runtime.world.actor_count] {
        if actor.id == actor_id {
            actor.damage = 1;
        }
    }
    for item in &mut use_runtime.world.items[..use_runtime.world.item_count] {
        if matches!(item.id, HEARTH_TONIC_ITEM_ID | STORY_BUTTON_ITEM_ID) {
            item.location_id = 0;
            item.holder_actor_id = actor_id;
            item.zone = CW_CARD_ZONE_CARRIED;
            item.container_item_id = 0;
            item.held_since_tick = use_runtime.world.tick;
        }
    }
    let mut item_use_runtime = use_runtime.clone();
    let item_use_offer = item_use_runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "use_item"
                && offer.id == format!("use_item:{HEARTH_TONIC_ITEM_ID}:{actor_id}")
        })
        .expect("the exact item Use card is dealt");
    let item_use_state = test_app_state(item_use_runtime, None);
    let (item_use_session, _) = issue_actor_session(&item_use_state, actor_id);
    assert_missing_and_wrong_fields_reject_without_mutation(
        &item_use_state,
        &item_use_offer,
        "/actions/use-item",
        &serde_json::json!({
            "actor_id": actor_id,
            "actor_session": item_use_session,
            "item_id": HEARTH_TONIC_ITEM_ID,
            "target_actor_id": actor_id,
        }),
        &["item_id", "target_actor_id"],
        "item Use",
    )
    .await;

    let feature_use_offer = use_runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "use_feature"
                && offer.id.starts_with(&format!(
                    "use_feature:{STORY_BUTTON_ITEM_ID}:{COSY_COTTAGE_LOCATION_ID}:"
                ))
        })
        .expect("the exact feature Use card is dealt");
    let feature_key = feature_use_offer
        .id
        .rsplit(':')
        .next()
        .expect("feature offer stores its exact feature key")
        .to_string();
    let feature_use_state = test_app_state(use_runtime, None);
    let (feature_use_session, _) = issue_actor_session(&feature_use_state, actor_id);
    assert_missing_and_wrong_fields_reject_without_mutation(
        &feature_use_state,
        &feature_use_offer,
        "/actions/use-item",
        &serde_json::json!({
            "actor_id": actor_id,
            "actor_session": feature_use_session,
            "item_id": STORY_BUTTON_ITEM_ID,
            "location_id": COSY_COTTAGE_LOCATION_ID,
            "feature_key": feature_key,
        }),
        &["item_id", "location_id", "feature_key"],
        "feature Use",
    )
    .await;

    // Cast binds both its prepared spell card and the exact actor target.
    let mut cast_runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut cast_runtime,
        actor_id,
        MOONLIT_TRAIL_LOCATION_ID,
        "Cast Certificate Witness",
    );
    let spell = cast_runtime
        .world
        .items
        .iter_mut()
        .take(cast_runtime.world.item_count)
        .find(|item| item.id == 2014)
        .expect("playable spell exists");
    spell.holder_actor_id = actor_id;
    spell.location_id = 0;
    spell.zone = CW_CARD_ZONE_SPELL_DECK;
    spell.container_item_id = 0;
    assert!(!cast_runtime
        .set_spell_prepared(actor_id, 2014, true, "test")
        .is_empty());
    complete_guided_story_for_test(&mut cast_runtime, actor_id);
    let cast_offer = cast_runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "cast_spell"
        })
        .expect("the exact Cast card is dealt");
    let cast_state = test_app_state(cast_runtime, None);
    let (cast_session, _) = issue_actor_session(&cast_state, actor_id);
    assert_missing_and_wrong_fields_reject_without_mutation(
        &cast_state,
        &cast_offer,
        "/actions/cast-spell",
        &serde_json::json!({
            "actor_id": actor_id,
            "actor_session": cast_session,
            "item_id": 2014,
            "target_actor_id": actor_id,
        }),
        &["item_id", "target_actor_id"],
        "Cast",
    )
    .await;

    // Gift and Trade carry distinct exact tuples; all tuple members must be
    // supplied from the dealt certificate.
    let mut transfer_runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut transfer_runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Transfer Certificate Witness",
    );
    create_test_human(
        &mut transfer_runtime,
        5001,
        COSY_COTTAGE_LOCATION_ID,
        "Transfer Target Witness",
    );
    for item in &mut transfer_runtime.world.items[..transfer_runtime.world.item_count] {
        match item.id {
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = actor_id;
                item.zone = CW_CARD_ZONE_CARRIED;
            }
            WATCH_BELL_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5001;
                item.zone = CW_CARD_ZONE_CARRIED;
            }
            _ => {}
        }
    }
    transfer_runtime.record_economy_disclosure(actor_id, 5001);
    transfer_runtime
        .actor_autonomy
        .entry(actor_id)
        .or_default()
        .control_mode = ActorControlMode::DirectInput;
    transfer_runtime
        .actor_autonomy
        .entry(5001)
        .or_default()
        .control_mode = ActorControlMode::DirectInput;
    let mut gift_runtime = transfer_runtime.clone();
    let gift_offer = gift_runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "give_item"
                && offer.id == format!("give_item:{STORY_BUTTON_ITEM_ID}:5001")
        })
        .expect("the exact Give card is dealt");
    let gift_state = test_app_state(gift_runtime, None);
    let (gift_session, _) = issue_actor_session(&gift_state, actor_id);
    // The counterparty needs an active direct session for the same visibility
    // context used by the endpoint's authoritative certificate validation.
    let (gift_target_session, _) = issue_actor_session(&gift_state, 5001);
    assert_eq!(
        actor_for_session(&gift_state.actor_sessions, &gift_target_session),
        Some(5001),
        "the direct counterparty is present for certificate validation"
    );
    assert_missing_and_wrong_fields_reject_without_mutation(
        &gift_state,
        &gift_offer,
        "/actions/give-item",
        &serde_json::json!({
            "actor_id": actor_id,
            "actor_session": gift_session,
            "item_id": STORY_BUTTON_ITEM_ID,
            "target_actor_id": 5001,
        }),
        &["item_id", "target_actor_id"],
        "Give",
    )
    .await;

    let trade_offer = transfer_runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "trade_item"
                && offer.id
                    == format!("trade_item:{STORY_BUTTON_ITEM_ID}:5001:{WATCH_BELL_ITEM_ID}")
        })
        .expect("the exact Trade card is dealt");
    let trade_state = test_app_state(transfer_runtime, None);
    let (trade_session, _) = issue_actor_session(&trade_state, actor_id);
    let (trade_target_session, _) = issue_actor_session(&trade_state, 5001);
    assert_eq!(
        actor_for_session(&trade_state.actor_sessions, &trade_target_session),
        Some(5001),
        "the direct counterparty is present for certificate validation"
    );
    assert_missing_and_wrong_fields_reject_without_mutation(
        &trade_state,
        &trade_offer,
        "/actions/trade-item",
        &serde_json::json!({
            "actor_id": actor_id,
            "actor_session": trade_session,
            "item_id": STORY_BUTTON_ITEM_ID,
            "target_actor_id": 5001,
            "target_item_id": WATCH_BELL_ITEM_ID,
        }),
        &["item_id", "target_actor_id", "target_item_id"],
        "Trade",
    )
    .await;

    // Contribution cards bind the project tuple even though it lives in the
    // payload rather than ActionTargetView.
    let mut contribution_runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut contribution_runtime,
        actor_id,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Contribution Certificate Witness",
    );
    let contribution_offer = contribution_runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.project.is_some()
                && matches!(
                    offer.kind.as_str(),
                    "check" | "study" | "work" | "help" | "use_item"
                )
        })
        .expect("a project contribution card is dealt");
    let project = contribution_offer
        .project
        .as_ref()
        .expect("contribution offer has an exact project binding");
    let contribution_path = match contribution_offer.kind.as_str() {
        "work" => "/actions/work",
        "help" => "/actions/help",
        "study" => "/actions/study",
        "check" | "use_item" => "/actions/contribute",
        kind => panic!("unexpected contribution kind {kind}"),
    };
    let contribution_state = test_app_state(contribution_runtime, None);
    let (contribution_session, _) = issue_actor_session(&contribution_state, actor_id);
    assert_missing_and_wrong_fields_reject_without_mutation(
        &contribution_state,
        &contribution_offer,
        contribution_path,
        &serde_json::json!({
            "actor_id": actor_id,
            "actor_session": contribution_session,
            "job_id": project.id,
            "strategy_id": project.strategy_id.clone().expect("project strategy id"),
        }),
        &["job_id", "strategy_id"],
        "project contribution",
    )
    .await;
}

#[test]
fn pickup_and_drop_offers_bind_exact_items_for_every_controller() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Item Offer Tester",
    );
    let item_ids = [2001, STORY_BUTTON_ITEM_ID];
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        item.location_id = 0;
        item.holder_actor_id = 0;
        item.zone = CW_CARD_ZONE_WORLD;
        item.container_item_id = 0;
        if item_ids.contains(&item.id) {
            item.location_id = COSY_COTTAGE_LOCATION_ID;
        }
    }

    let pickup_offers = runtime
        .legal_action_candidates(Some(5000), &AccessContext::default())
        .1
        .into_iter()
        .filter(|offer| offer.kind == "pick_up")
        .collect::<Vec<_>>();
    assert_eq!(pickup_offers.len(), item_ids.len());
    assert_eq!(
        pickup_offers
            .iter()
            .filter_map(|offer| offer.target.as_ref().and_then(|target| target.id))
            .collect::<Vec<_>>(),
        item_ids
    );
    assert!(pickup_offers.iter().all(|offer| {
        offer.target.as_ref().is_some_and(|target| {
            target.kind == "item"
                && target
                    .label
                    .as_deref()
                    .is_some_and(|label| offer.label.contains(label))
        })
    }));

    runtime.actor_autonomy.entry(5000).or_default().control_mode = ActorControlMode::LocalAi;
    let inference_pickup_offers = runtime
        .legal_action_candidates(Some(5000), &AccessContext::default())
        .1
        .into_iter()
        .filter(|offer| offer.kind == "pick_up")
        .collect::<Vec<_>>();
    assert_eq!(
        serde_json::to_value(&inference_pickup_offers).expect("inference pickup offers serialize"),
        serde_json::to_value(&pickup_offers).expect("direct pickup offers serialize"),
        "controller mode cannot change pickup enumeration or targets"
    );

    let pickup_offer = runtime
        .draw_until_test_offer(5000, &AccessContext::default(), |candidate| {
            candidate.kind == "pick_up"
                && candidate.target.as_ref().and_then(|target| target.id)
                    == Some(STORY_BUTTON_ITEM_ID)
        })
        .expect("the Story Button pickup card is dealt before its LocalAI trace");
    let pickup = runtime
        .plan_item_offer_action(5000, &pickup_offer, 0)
        .expect("the exact pickup offer plans");
    assert_eq!(pickup.kind, CW_ACTION_PICK_UP_ITEM);
    assert_eq!(pickup.item_id, STORY_BUTTON_ITEM_ID);

    let trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
        actor_id: 5000,
        rank: 40,
        score: 0,
        record: JournalRecord::new(pickup, 97_100).into_actor_consequence(runtime.world.tick, None),
    });
    assert_eq!(
        trace.choice.offer_id.as_deref(),
        Some(pickup_offer.offer_id.as_str())
    );
    assert!(trace.candidates.iter().any(|candidate| {
        candidate.selected
            && candidate.target.as_ref().is_some_and(|target| {
                target.kind == "item" && target.id == Some(STORY_BUTTON_ITEM_ID)
            })
    }));

    let mut forged_pickup_offer = pickup_offer.clone();
    forged_pickup_offer
        .target
        .as_mut()
        .expect("pickup target exists")
        .id = Some(999_999);
    assert!(runtime
        .plan_item_offer_action(5000, &forged_pickup_offer, 0)
        .is_err());

    for item in &mut runtime.world.items[..runtime.world.item_count] {
        item.location_id = 0;
        item.holder_actor_id = 0;
        item.zone = CW_CARD_ZONE_WORLD;
        item.container_item_id = 0;
        if item_ids.contains(&item.id) {
            item.holder_actor_id = 5000;
            item.zone = CW_CARD_ZONE_CARRIED;
        }
    }
    runtime.actor_autonomy.entry(5000).or_default().control_mode = ActorControlMode::DirectInput;
    let drop_offers = runtime
        .legal_action_candidates(Some(5000), &AccessContext::default())
        .1
        .into_iter()
        .filter(|offer| offer.kind == "drop_item")
        .collect::<Vec<_>>();
    assert_eq!(drop_offers.len(), item_ids.len());
    assert_eq!(
        drop_offers
            .iter()
            .filter_map(|offer| offer.target.as_ref().and_then(|target| target.id))
            .collect::<Vec<_>>(),
        item_ids
    );
    assert!(runtime
        .primary_action(Some(5000), &AccessContext::default())
        .options
        .iter()
        .any(|option| option.kind == "drop_item"));

    runtime.actor_autonomy.entry(5000).or_default().control_mode = ActorControlMode::LocalAi;
    let inference_drop_offers = runtime
        .legal_action_candidates(Some(5000), &AccessContext::default())
        .1
        .into_iter()
        .filter(|offer| offer.kind == "drop_item")
        .collect::<Vec<_>>();
    assert_eq!(
        serde_json::to_value(&inference_drop_offers).expect("inference drop offers serialize"),
        serde_json::to_value(&drop_offers).expect("direct drop offers serialize"),
        "controller mode cannot change drop enumeration or targets"
    );

    let drop_offer = runtime
        .draw_until_test_offer(5000, &AccessContext::default(), |candidate| {
            candidate.kind == "drop_item"
                && candidate.target.as_ref().and_then(|target| target.id)
                    == Some(STORY_BUTTON_ITEM_ID)
        })
        .expect("the Story Button drop card is dealt before LocalAI validates it");
    let drop_action = runtime
        .plan_item_offer_action(5000, &drop_offer, 0)
        .expect("the exact drop offer plans");
    let exact_proposal = AvatarProposedAction {
        kind: "drop".to_string(),
        item_id: Some(STORY_BUTTON_ITEM_ID),
        ..AvatarProposedAction::default()
    };
    assert!(runtime.resident_proposed_action_matches_legal_offer(
        5000,
        &exact_proposal,
        &drop_action
    ));
    let forged_proposal = AvatarProposedAction {
        item_id: Some(2001),
        ..exact_proposal.clone()
    };
    assert!(!runtime.resident_proposed_action_matches_legal_offer(
        5000,
        &forged_proposal,
        &drop_action
    ));

    assert_eq!(
        runtime
            .apply_journal_record(&JournalRecord::new(drop_action, 97_101))
            .0,
        CW_OK
    );
    assert!(runtime
        .plan_item_offer_action(5000, &drop_offer, 0)
        .is_err());
}

#[tokio::test]
async fn certified_pass_redeals_the_hand_and_consumes_the_turn() {
    let mut runtime = RuntimeWorld::seeded();
    hide_seed_items(&mut runtime);
    let create = CwAction {
        kind: CW_ACTION_CREATE_ACTOR,
        actor_id: 5000,
        location_id: COSY_COTTAGE_LOCATION_ID,
        ..CwAction::default()
    };
    let mut record = JournalRecord::new(create, 17627);
    record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Shuffle Witness".to_string(),
            speech_mode: "prose".to_string(),
            title: "Timekeeper".to_string(),
            description: "A test avatar watching time pass.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    complete_guided_story_for_test(&mut runtime, 5000);

    let state = test_app_state(runtime, None);
    let (actor_session, _) = issue_actor_session(&state, 5000);
    assert_eq!(
        actor_for_session(&state.actor_sessions, &actor_session),
        Some(5000)
    );
    commit_presence_event(&state, 5000, true).await;
    let (before_tick, before_next_event_seq, before_hand) = {
        let runtime = state.inner.lock().await;
        let (_, offers) = runtime.legal_action_candidates(Some(5000), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(5000), &offers);
        assert!(
            hand.draw_available,
            "the fixture needs cards beyond the hand"
        );
        (
            runtime.world.tick,
            runtime.world.next_event_seq,
            hand.entries
                .iter()
                .map(|entry| {
                    let offer = offers
                        .iter()
                        .find(|offer| offer.offer_id == entry.offer_id)
                        .expect("Story Hand entry has an authoritative offer");
                    (entry.slot.clone(), offer.id.clone())
                })
                .collect::<Vec<_>>(),
        )
    };

    let response = draw_action(
        ConnectInfo("127.0.0.1:0".parse().unwrap()),
        State(state.clone()),
        Json(ActorRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
        }),
    )
    .await
    .0;

    assert!(response.ok);
    assert_eq!(response.status, CW_OK);
    assert!(response
        .events
        .iter()
        .any(|event| event.type_name == "hand.thought"));
    let runtime = state.inner.lock().await;
    assert_eq!(
        runtime.world.tick, before_tick,
        "the first safe-scene Think is free"
    );
    assert!(runtime.world.next_event_seq > before_next_event_seq);
    let (_, offers) = runtime.legal_action_candidates(Some(5000), &AccessContext::default());
    let after_hand = runtime.action_hand_for(Some(5000), &offers);
    let after_cards = after_hand
        .entries
        .iter()
        .map(|entry| {
            let offer = offers
                .iter()
                .find(|offer| offer.offer_id == entry.offer_id)
                .expect("Story Hand entry has an authoritative offer");
            (entry.slot.clone(), offer.id.clone())
        })
        .collect::<Vec<_>>();
    assert_eq!(
        after_cards
            .iter()
            .zip(&before_hand)
            .filter(|(after, before)| after != before)
            .count(),
        1,
        "Think replaces exactly one Story Hand slot; before={before_hand:?} after={after_cards:?}"
    );
}

#[tokio::test]
async fn submit_offer_cannot_cross_a_certified_pass_hand_boundary() {
    let actor_id = 5_000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Serialized Hand Witness",
    );
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if [
            HEARTH_TONIC_ITEM_ID,
            DEWBRIGHT_BUTTON_ITEM_ID,
            STORY_BUTTON_ITEM_ID,
        ]
        .contains(&item.id)
        {
            item.holder_actor_id = 0;
            item.location_id = COSY_COTTAGE_LOCATION_ID;
            item.zone = CW_CARD_ZONE_WORLD;
            item.container_item_id = 0;
        }
    }
    complete_guided_story_for_test(&mut runtime, actor_id);
    let pickup_offer = runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "pick_up"
        })
        .expect("a dealt pickup certificate");
    let item_id = pickup_offer
        .target
        .as_ref()
        .and_then(|target| target.id)
        .expect("pickup certificate binds its item");
    let state = test_app_state(runtime, None);
    let (actor_session, _) = issue_actor_session(&state, actor_id);
    let (pass_offer_id, before_tick) = {
        let runtime = state.inner.lock().await;
        let (_, offers) =
            runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(actor_id), &offers);
        (
            hand.entries
                .iter()
                .find(|entry| entry.offer_id == pickup_offer.offer_id)
                .expect("the dealt pickup keeps its exact Story Hand slot")
                .think
                .offer_id
                .clone(),
            runtime.world.tick,
        )
    };
    let pass_request = live_command_request(actor_id, &actor_session, pass_offer_id);
    let submission = submission_for_offer(
        &pickup_offer,
        "/actions/pick-up",
        serde_json::json!({
            "actor_id": actor_id,
            "actor_session": actor_session,
            "item_id": item_id,
        }),
    );

    // Queue Pass first, then the certified card behind the same mutex. Before
    // submit_action_offer took this mutex the second task completed here,
    // proving validation and mutation were separated by a hand-changing pass.
    let hand_guard = state.canonical_command_lock.lock().await;
    let pass_state = state.clone();
    let pass_task = tokio::spawn(async move {
        command(
            ConnectInfo("127.0.0.1:44280".parse().expect("client address")),
            State(pass_state),
            Json(pass_request),
        )
        .await
        .0
    });
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
    assert!(
        !pass_task.is_finished(),
        "Pass must wait for the held command serialization lock"
    );
    let submit_state = state.clone();
    let submit_task = tokio::spawn(async move {
        submit_action_offer(
            ConnectInfo("127.0.0.1:44281".parse().expect("client address")),
            State(submit_state),
            Json(submission),
        )
        .await
        .0
    });
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
    assert!(
        !submit_task.is_finished(),
        "a certified offer must wait with Pass instead of validating the old hand"
    );
    drop(hand_guard);

    let pass = pass_task.await.expect("Pass task joins");
    assert!(pass.ok, "current certified Pass succeeds: {pass:?}");
    let submitted = submit_task.await.expect("submit task joins");
    assert!(
        !submitted.ok,
        "the certificate from the prior hand is rejected"
    );
    assert_eq!(
        submitted.status, 400,
        "the prior certificate is outside the new hand"
    );
    assert!(submitted.events.is_empty());
    let runtime = state.inner.lock().await;
    assert_eq!(
        runtime.world.tick, before_tick,
        "the first safe-scene Think is free"
    );
    assert!(runtime
        .item_by_id(item_id)
        .is_some_and(|item| item.holder_actor_id == 0));
}

#[test]
fn certified_pass_runs_the_ordinary_played_turn_pipeline() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.world.tick = WORLD_PULSE_INTERVAL_TICKS - 1;
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        },
        88_001,
    )
    .into_player_card();
    record
        .projection_mutations
        .push(ProjectionMutation::ThinkHand {
            slot: 0,
            scene_key: format!("safe:{COSY_COTTAGE_LOCATION_ID}"),
            replaces_offer_id: "test-offer".to_string(),
            free: false,
            reason: "player_think".to_string(),
        });

    let (status, events) = runtime.apply_journal_record(&record);
    assert_eq!(status, CW_OK);
    assert_eq!(runtime.world.tick, WORLD_PULSE_INTERVAL_TICKS);
    assert_eq!(runtime.world_simulation.pulse_index, 1);
    assert_eq!(
        runtime.world_simulation.last_advanced_tick,
        WORLD_PULSE_INTERVAL_TICKS
    );
    assert!(events.iter().any(|event| event.type_name == "hand.thought"));
}

#[tokio::test]
async fn certified_pass_is_actor_bound_idempotent_and_stale_safe() {
    let actor_id = 5_000;
    let other_actor_id = 5_001;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Certified Pass Witness",
    );
    create_test_human(
        &mut runtime,
        other_actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Other Certified Pass Witness",
    );
    complete_guided_story_for_test(&mut runtime, actor_id);
    let event_store_path = std::env::temp_dir().join(format!(
        "cosyworld-certified-pass-metrics-{}-{}.sqlite",
        std::process::id(),
        now_millis()
    ));
    let _ = fs::remove_file(&event_store_path);
    let state = test_app_state(runtime, Some(event_store_path.clone()));
    let actor_session = create_actor_session(&state.actor_sessions, actor_id).0;
    let other_actor_session = create_actor_session(&state.actor_sessions, other_actor_id).0;
    let active_direct_actors = active_actor_ids_for_state(&state);
    let (request, cross_actor_request, before_tick, before_generations, before_event_count) = {
        let runtime = state.inner.lock().await;
        let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
            Some(actor_id),
            &AccessContext::default(),
            Some(&active_direct_actors),
        );
        retain_configured_model_interaction_offers(
            &mut primary_action,
            &mut offers,
            state.ai_config.as_ref().as_ref(),
        );
        let hand = runtime.action_hand_for(Some(actor_id), &offers);
        assert!(!hand.pass.offer_id.is_empty());
        let mut request = canonical_test_command_request(
            &runtime,
            actor_id,
            &actor_session,
            "test:certified-pass",
            "pass",
        );
        request.offer_id = Some(hand.pass.offer_id);
        let mut cross_actor_request = canonical_test_command_request(
            &runtime,
            other_actor_id,
            &other_actor_session,
            "test:certified-pass-cross-actor",
            "pass",
        );
        cross_actor_request.offer_id = request.offer_id.clone();
        (
            request,
            cross_actor_request,
            runtime.world.tick,
            runtime.hand_generations.clone(),
            runtime.event_log.len(),
        )
    };
    let client = ConnectInfo("127.0.0.1:45131".parse().expect("client address"));

    let cross_actor = command(client, State(state.clone()), Json(cross_actor_request))
        .await
        .0;
    assert!(
        !cross_actor.ok,
        "a valid session for another actor must not redeem this actor's pass certificate"
    );
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.world.tick, before_tick);
    assert_eq!(runtime.hand_generations, before_generations);
    assert_eq!(runtime.event_log.len(), before_event_count);
    drop(runtime);

    let first = command(client, State(state.clone()), Json(request.clone()))
        .await
        .0;
    assert!(first.ok, "{first:?}");
    assert!(first
        .events
        .iter()
        .any(|event| event.type_name == "hand.thought"));
    let event_count_after_first = state.inner.lock().await.event_log.len();

    let duplicate = command(client, State(state.clone()), Json(request.clone()))
        .await
        .0;
    assert_eq!(first.receipt, duplicate.receipt);
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&duplicate).unwrap(),
        "the same canonical Pass submission must replay its receipt"
    );

    let mut stale_request = request;
    stale_request
        .envelope
        .as_mut()
        .expect("canonical envelope")
        .intent_id = "test:certified-pass-stale".to_string();
    let journal_count_before_stale = read_action_journal(&event_store_path)
        .expect("read committed pass before stale submission")
        .len();
    let stale = command(client, State(state.clone()), Json(stale_request.clone()))
        .await
        .0;
    assert!(!stale.ok);
    assert_eq!(stale.status, 409);
    assert!(stale.events.is_empty());

    let after_first_stale = {
        let runtime = state.inner.lock().await;
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
            .expect("snapshot serializes after stale command pass")
    };
    let stale_retry = command(client, State(state.clone()), Json(stale_request))
        .await
        .0;
    assert!(!stale_retry.ok);
    assert_eq!(stale_retry.status, 409);
    assert!(stale_retry.events.is_empty());

    let runtime = state.inner.lock().await;
    assert_eq!(
        runtime.world.tick, before_tick,
        "the first safe Think is free"
    );
    assert_eq!(runtime.event_log.len(), event_count_after_first);
    assert_eq!(
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
            .expect("snapshot serializes after stale retry"),
        after_first_stale,
        "stale command pass retries must not mutate the world"
    );
    drop(runtime);
    assert_eq!(
        read_action_journal(&event_store_path)
            .expect("read journal after stale command pass")
            .len(),
        journal_count_before_stale,
        "stale command pass retries must not append a world journal record"
    );
    let metric_count = open_event_store(&event_store_path)
        .expect("open stale pass metric store")
        .query_row(
            "SELECT COUNT(*) FROM story_metric_events WHERE event_kind = 'pass_stale_rejected'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .expect("count stale pass metrics");
    assert_eq!(
        metric_count, 1,
        "the same stale certificate is deduplicated"
    );
    drop(state);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn repeated_certified_thinks_rotate_and_roll_without_farming() {
    let actor_id = 5_000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Pass Boundary Witness",
    );
    complete_guided_story_for_test(&mut runtime, actor_id);
    // Start immediately before a pulse. Two certified passes cross the
    // boundary once, so the regression covers harmless simulation metadata
    // advancing without turning Think into a way to farm progress or stakes.
    runtime.world.tick = WORLD_PULSE_INTERVAL_TICKS - 1;
    let event_store_path = std::env::temp_dir().join(format!(
        "cosyworld-repeated-pass-replay-{}-{}.sqlite",
        std::process::id(),
        now_millis()
    ));
    let _ = fs::remove_file(&event_store_path);
    let state = test_app_state(runtime, Some(event_store_path.clone()));
    let (actor_session, _) = issue_actor_session(&state, actor_id);
    let relevant_state = |runtime: &RuntimeWorld| {
        serde_json::json!({
            "actor_status_and_effects": &runtime.world.actors[..runtime.world.actor_count],
            "actor_metadata": runtime.actors,
            "items": &runtime.world.items[..runtime.world.item_count],
            "item_metadata": runtime.items,
            "ledger_marks": runtime.ledger_marks,
            "actor_practices": runtime.actor_practices,
            "rpg_claims": runtime.rpg_claims,
            "orb_balances": runtime.orb_balances,
            "orb_reward_claims": runtime.orb_reward_claims,
            "listen_attempt_claims": runtime.listen_attempt_claims,
            "jobs": runtime.jobs,
            "clocks": runtime.clocks,
            "tags_and_effects": runtime.tags,
            "threshold_hazard_effects": runtime.threshold_hazard_states,
            "actor_safety": runtime.actor_safety,
        })
    };
    let (
        before_relevant,
        before_tick,
        before_generation,
        before_pulse_index,
        before_last_advanced_tick,
        baseline_snapshot,
    ) = {
        let runtime = state.inner.lock().await;
        (
            relevant_state(&runtime),
            runtime.world.tick,
            runtime
                .hand_generations
                .get(&actor_id)
                .copied()
                .unwrap_or_default(),
            runtime.world_simulation.pulse_index,
            runtime.world_simulation.last_advanced_tick,
            RuntimeSnapshot::from_runtime(&runtime),
        )
    };

    const PASS_COUNT: u64 = 2;
    for _ in 0..PASS_COUNT {
        certified_think(&state, actor_id, &actor_session).await;
    }

    let runtime = state.inner.lock().await;
    assert_eq!(
        relevant_state(&runtime),
        before_relevant,
        "repeated Think must not farm Orbs, marks, practice, claims, items, projects, or danger",
    );
    assert_eq!(runtime.world.tick, before_tick + PASS_COUNT - 1);
    assert_eq!(
        runtime.world_simulation.pulse_index,
        before_pulse_index + 1,
        "the first Pass crosses exactly one pulse boundary"
    );
    assert_eq!(
        runtime.world_simulation.last_advanced_tick,
        before_last_advanced_tick + WORLD_PULSE_INTERVAL_TICKS,
        "only the documented ambient/opportunity simulation metadata may advance at the pulse"
    );
    assert_eq!(
        runtime
            .hand_generations
            .get(&actor_id)
            .copied()
            .unwrap_or_default(),
        before_generation + PASS_COUNT,
        "only the dealt hand generation advances",
    );
    let expected_replay_state = relevant_state(&runtime);
    let expected_tick = runtime.world.tick;
    let expected_generation = runtime
        .hand_generations
        .get(&actor_id)
        .copied()
        .unwrap_or_default();
    drop(runtime);
    let records = read_action_journal(&event_store_path).expect("read committed pass journal");
    assert_eq!(records.len(), PASS_COUNT as usize);
    assert!(records.iter().all(|record| {
        record.action.actor_id == actor_id
            && record.action.kind == CW_ACTION_NONE
            && record.projection_mutations.iter().any(|mutation| {
                matches!(mutation, ProjectionMutation::ThinkHand { reason, .. } if reason == "player_think")
            })
            && record.projection_mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    ProjectionMutation::AvatarReflectionCheck {
                        reflection_kind: AvatarReflectionKind::Thought,
                        ..
                    }
                )
            })
    }));
    let mut replayed = baseline_snapshot
        .into_runtime()
        .expect("pre-pass snapshot restores for journal replay");
    for record in &records {
        assert_eq!(
            replayed.apply_journal_record(record).0,
            CW_OK,
            "each committed pass must replay from the pre-pass baseline"
        );
    }
    assert_eq!(
        relevant_state(&replayed),
        expected_replay_state,
        "journal replay preserves the no-farming state after repeated Think",
    );
    assert_eq!(replayed.world.tick, expected_tick);
    assert_eq!(
        replayed
            .hand_generations
            .get(&actor_id)
            .copied()
            .unwrap_or_default(),
        expected_generation
    );
    drop(state);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn certified_pass_metrics_track_consecutive_passes_and_reset_after_meaningful_action() {
    let actor_id = 5_000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Pass Metric Witness",
    );
    isolate_story_hand_actor(&mut runtime, actor_id);
    complete_guided_story_for_test(&mut runtime, actor_id);
    let event_store_path = std::env::temp_dir().join(format!(
        "cosyworld-certified-pass-window-{}-{}.sqlite",
        std::process::id(),
        now_millis()
    ));
    let _ = fs::remove_file(&event_store_path);
    let state = test_app_state(runtime, Some(event_store_path.clone()));
    let (actor_session, _) = issue_actor_session(&state, actor_id);

    let mut pass_source_seqs = Vec::new();
    for _ in 0..2 {
        let pass_offer_id = {
            let active_direct_actors = active_actor_ids_for_state(&state);
            let runtime = state.inner.lock().await;
            let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
                Some(actor_id),
                &AccessContext::default(),
                Some(&active_direct_actors),
            );
            retain_configured_model_interaction_offers(
                &mut primary_action,
                &mut offers,
                state.ai_config.as_ref().as_ref(),
            );
            runtime
                .action_hand_for(Some(actor_id), &offers)
                .pass
                .offer_id
        };
        let response = command(
            ConnectInfo("127.0.0.1:45141".parse().expect("client address")),
            State(state.clone()),
            Json(live_command_request(
                actor_id,
                &actor_session,
                pass_offer_id,
            )),
        )
        .await
        .0;
        assert!(response.ok, "certified Pass succeeds: {response:?}");
        let thought_check = response
            .events
            .iter()
            .find(|event| {
                event.type_name == "ability_check.rolled"
                    && event.content.as_deref() == Some("think")
            })
            .expect("each certified Think / Pass rolls for an asynchronous thought");
        assert_eq!(thought_check.ability.as_deref(), Some("Intelligence"));
        assert_eq!(thought_check.dc, Some(AVATAR_REFLECTION_DC as i16));
        assert!(!response
            .events
            .iter()
            .any(|event| event.type_name == "avatar.thought"));
        pass_source_seqs.push(
            response
                .events
                .iter()
                .find(|event| event.type_name == "hand.thought")
                .map(|event| event.seq)
                .expect("each Think emits its exact replacement source event"),
        );
    }

    // Select a real dealt Search without adding a third Pass to this specific
    // metric window. The submitted certificate remains fully authoritative.
    let search_offer = {
        let mut runtime = state.inner.lock().await;
        let (scene_key, _) = runtime.story_hand_scene_for_actor(actor_id);
        let mut found = None;
        for generation in 0..64 {
            let mut story_state = runtime.story_hand_state_for_scene(actor_id, &scene_key);
            story_state.slot_generations[0] = generation;
            runtime.story_hand_states.insert(actor_id, story_state);
            let (_, offers) =
                runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
            let hand = runtime.action_hand_for(Some(actor_id), &offers);
            if let Some(offer) = offers.into_iter().find(|offer| {
                offer.kind == "search"
                    && hand
                        .entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
            }) {
                found = Some(offer);
                break;
            }
        }
        found.expect("a finite Story slot eventually deals a meaningful Search")
    };
    let meaningful = command(
        ConnectInfo("127.0.0.1:45142".parse().expect("client address")),
        State(state.clone()),
        Json(live_command_request(
            actor_id,
            &actor_session,
            search_offer.offer_id,
        )),
    )
    .await
    .0;
    assert!(meaningful.ok, "dealt Search succeeds: {meaningful:?}");

    let next_pass_offer_id = {
        let active_direct_actors = active_actor_ids_for_state(&state);
        let runtime = state.inner.lock().await;
        let (mut primary_action, mut offers) = runtime.legal_action_candidates_with_presence(
            Some(actor_id),
            &AccessContext::default(),
            Some(&active_direct_actors),
        );
        retain_configured_model_interaction_offers(
            &mut primary_action,
            &mut offers,
            state.ai_config.as_ref().as_ref(),
        );
        runtime
            .action_hand_for(Some(actor_id), &offers)
            .pass
            .offer_id
    };
    let next_pass = command(
        ConnectInfo("127.0.0.1:45143".parse().expect("client address")),
        State(state.clone()),
        Json(live_command_request(
            actor_id,
            &actor_session,
            next_pass_offer_id,
        )),
    )
    .await
    .0;
    assert!(next_pass.ok, "Pass after Search succeeds: {next_pass:?}");
    let thought_check = next_pass
        .events
        .iter()
        .find(|event| {
            event.type_name == "ability_check.rolled" && event.content.as_deref() == Some("think")
        })
        .expect("the post-Search Think / Pass rolls for a thought");
    assert_eq!(thought_check.ability.as_deref(), Some("Intelligence"));
    assert_eq!(thought_check.dc, Some(AVATAR_REFLECTION_DC as i16));
    assert!(!next_pass
        .events
        .iter()
        .any(|event| event.type_name == "avatar.thought"));
    pass_source_seqs.push(
        next_pass
            .events
            .iter()
            .find(|event| event.type_name == "hand.thought")
            .map(|event| event.seq)
            .expect("the post-Search Think emits its exact replacement source event"),
    );

    let conn = open_event_store(&event_store_path).expect("open pass metric store");
    let mut statement = conn
        .prepare(
            "SELECT event_kind, source_event_seq, attributes_json
             FROM story_metric_events
             WHERE event_kind IN ('action_passed', 'meaningful_action_completed')
             ORDER BY source_event_seq ASC",
        )
        .expect("prepare pass metric query");
    let metric_events = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<u64>>(1)?,
                serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(2)?)
                    .expect("metric attributes are JSON"),
            ))
        })
        .expect("query pass metrics")
        .collect::<Result<Vec<_>, _>>()
        .expect("read pass metrics");
    let pass_metrics = metric_events
        .iter()
        .filter(|(kind, _, _)| kind == "action_passed")
        .collect::<Vec<_>>();
    assert_eq!(pass_metrics.len(), 3, "one metric per committed Pass");
    assert_eq!(
        pass_metrics
            .iter()
            .map(|(_, source_seq, _)| source_seq.expect("Pass source sequence"))
            .collect::<Vec<_>>(),
        pass_source_seqs,
        "Pass metrics are deduplicated and bound to their exact hand shuffle events"
    );
    for (metric, expected) in
        pass_metrics
            .iter()
            .zip([(1, 1, 10_000), (2, 2, 10_000), (3, 1, 7_500)])
    {
        let attributes = &metric.2;
        assert_eq!(attributes["pass_count"], expected.0);
        assert_eq!(attributes["consecutive_passes"], expected.1);
        assert_eq!(attributes["pass_rate_basis_points"], expected.2);
    }
    let meaningful_metric = metric_events
        .iter()
        .find(|(kind, _, _)| kind == "meaningful_action_completed")
        .expect("one meaningful action metric");
    assert!(
        meaningful
            .events
            .iter()
            .any(|event| Some(event.seq) == meaningful_metric.1),
        "the meaningful metric source sequence belongs to the committed Search"
    );
    assert_eq!(
        meaningful_metric.2["passes_before_meaningful"], 2,
        "the Search observes both prior certified Passes"
    );
    assert_eq!(meaningful_metric.2["pass_rate_basis_points"], 6_666);
    drop(state);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn stale_pass_certificate_does_not_release_inactive_inventory() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Current Pass Witness",
    );
    create_test_human(
        &mut runtime,
        5001,
        COSY_COTTAGE_LOCATION_ID,
        "Inactive Inventory Witness",
    );
    let held_since_tick = runtime.world.tick;
    let story = runtime
        .world
        .items
        .iter_mut()
        .find(|item| item.id == STORY_BUTTON_ITEM_ID)
        .expect("Story Button exists");
    story.holder_actor_id = 5001;
    story.location_id = 0;
    story.held_since_tick = held_since_tick;

    let state = test_app_state(runtime, None);
    let (actor_session, _) = issue_actor_session(&state, 5000);
    let before = {
        let runtime = state.inner.lock().await;
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
            .expect("snapshot serializes before stale Pass")
    };
    let mut stale_think = empty_think_view();
    stale_think.offer_id = "think:stale-certificate".to_string();
    stale_think.available = true;
    let response = pass_action(
        ConnectInfo("127.0.0.1:45132".parse().expect("client address")),
        State(state.clone()),
        Json(ActorRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
        }),
        &stale_think,
    )
    .await
    .0;

    assert!(!response.ok);
    assert_eq!(response.status, 409);
    assert!(response.events.is_empty());
    let runtime = state.inner.lock().await;
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| {
            item.id == STORY_BUTTON_ITEM_ID && item.holder_actor_id == 5001 && item.location_id == 0
        }));
    assert_eq!(
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
            .expect("snapshot serializes after stale Pass"),
        before,
        "a stale certificate must not mutate or clean up the world"
    );
}

#[tokio::test]
async fn legacy_pass_endpoint_refuses_an_uncertified_request() {
    let (status, Json(response)) = legacy_pass_requires_certificate(Json(ActorRequest {
        actor_id: 5_000,
        actor_session: None,
    }))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!response.ok);
    assert_eq!(response.status, 400);
    assert!(response.events.is_empty());
}

#[test]
fn public_state_keeps_the_action_hand_bounded() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Public State Tester",
    );
    let encoded =
        serde_json::to_vec(&runtime.state_response(Some(5000), &AccessContext::default()))
            .expect("serialize public state");
    assert!(
        encoded.len() < 32 * 1024,
        "the seeded browser state grew past its 32 KiB contract: {} bytes",
        encoded.len()
    );
    let state: serde_json::Value = serde_json::from_slice(&encoded).expect("decode public state");
    for hidden in [
        "account",
        "rules_context",
        "goals",
        "chat_bond_claimed_target_ids",
        "factions",
        "card_transactions",
        "inspector",
        "journal_beats",
    ] {
        assert!(state.get(hidden).is_none(), "{hidden} must remain internal");
    }
    assert!(
        state["command_context"]["actor_ref"].is_string(),
        "the browser gets only the opaque concurrency context it must submit"
    );
    assert!(
        state.get("recent_events").is_none(),
        "bounded event history belongs to /events, not the current-state payload"
    );
    assert!(state["action_offers"]
        .as_array()
        .is_some_and(|offers| offers.len() <= 3));
    assert!(state["action_hand"]["entries"]
        .as_array()
        .is_some_and(|entries| entries.len() <= 3));
    assert_eq!(state["journal"]["protocol"], "cosyworld.daily-journal.v1");
    assert!(state["journal"]["pages"]
        .as_array()
        .is_some_and(|pages| pages.len() <= 32));

    let location = state["location"].as_object().expect("public location");
    for hidden in [
        "canonical_ref",
        "entity_version",
        "pack_id",
        "persona",
        "memory",
        "factions",
    ] {
        assert!(location.get(hidden).is_none(), "location.{hidden} leaked");
    }
    for actor in state["actors"].as_array().expect("public actors") {
        for hidden in [
            "canonical_ref",
            "entity_version",
            "pack_id",
            "speech_mode",
            "factions",
            "bloodied",
        ] {
            assert!(actor.get(hidden).is_none(), "actor.{hidden} leaked");
        }
        assert_eq!(
            actor["stats"]
                .as_object()
                .expect("public actor stats")
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["hp_base".to_string(), "level".to_string()]),
            "actor stats must contain only values rendered by the client"
        );
    }
    for item in state["items"].as_array().expect("public items") {
        for hidden in [
            "canonical_ref",
            "entity_version",
            "pack_id",
            "mechanics",
            "provenance",
        ] {
            assert!(item.get(hidden).is_none(), "item.{hidden} leaked");
        }
    }
    for offer in state["action_offers"].as_array().expect("public offers") {
        for hidden in [
            "rules_action",
            "operation",
            "rules_profile",
            "resolver",
            "pack_provenance",
            "composition_trace",
            "state_revision",
            "route",
            "category",
            "zone",
            "source",
            "claim_key",
            "reason",
        ] {
            assert!(offer.get(hidden).is_none(), "offer.{hidden} leaked");
        }
        assert!(
            offer["provider"].get("label").is_none(),
            "offer.provider.label leaked"
        );
        assert!(
            offer["provider"]["reason"]
                .as_str()
                .is_some_and(|reason| !reason.is_empty()),
            "the browser-rendered provider reason must remain public"
        );
        if let Some(source) = offer.get("source_collectible") {
            for hidden in ["pack_id", "pack_version", "card_id", "provider_id"] {
                assert!(source.get(hidden).is_none(), "offer source.{hidden} leaked");
            }
        }
    }
    assert!(
        state["safety"].get("blocked_actor_ids").is_none(),
        "duplicated safety internals must not be sent"
    );
    for group in ["actors", "items", "locations"] {
        for card in state["cards"][group]
            .as_object()
            .expect("public card group")
            .values()
        {
            for hidden in [
                "pack_id",
                "source",
                "asset_status",
                "profile_id",
                "subject",
                "chain_image_uri",
                "generation_policy",
            ] {
                assert!(card.get(hidden).is_none(), "card.{hidden} leaked");
            }
        }
    }

    let sparse_event = serde_json::to_value(EventView {
        seq: 1,
        type_name: "world.bootstrapped".to_string(),
        success: true,
        ..EventView::default()
    })
    .expect("serialize sparse public event");
    for absent in ["actor_id", "content", "clock_id", "tag_id"] {
        assert!(
            sparse_event.get(absent).is_none(),
            "absent event field {absent} must not be serialized as null"
        );
    }
}

#[tokio::test]
async fn legacy_mutable_player_routes_require_an_action_hand_certificate() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind legacy route test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            routes::app_router(test_app_state(RuntimeWorld::seeded(), None)),
        )
        .await
        .expect("serve legacy route test");
    });
    let client = reqwest::Client::new();
    for path in [
        "/actions/pass",
        "/actions/chat",
        "/actions/move",
        "/actions/explore-path",
        "/actions/discover",
        "/actions/check",
        "/actions/study",
        "/actions/influence",
        "/actions/cast-spell",
        "/actions/pick-up",
        "/actions/drop",
        "/actions/use-item",
        "/actions/give-item",
        "/actions/trade-item",
        "/actions/theft",
        "/actions/craft",
        "/actions/attack",
        "/actions/defend",
        "/actions/prepare",
        "/actions/contribute",
        "/actions/work",
        "/actions/help",
        "/actions/rest",
        "/actions/create-bond",
        "/actions/resolve-bond",
        "/actions/flee",
    ] {
        let response = client
            .post(format!("http://{address}{path}"))
            .json(&serde_json::json!({ "actor_id": 5000 }))
            .send()
            .await
            .expect("legacy route response");
        assert_eq!(
            response.status(),
            reqwest::StatusCode::BAD_REQUEST,
            "{path}"
        );
        let body = response
            .json::<serde_json::Value>()
            .await
            .expect("legacy action response envelope");
        assert_eq!(body["ok"], false, "{path}");
        assert_eq!(body["status"], 400, "{path}");
        assert_eq!(body["events"], serde_json::json!([]), "{path}");
    }
    server.abort();
}

#[test]
fn full_carried_deck_still_projects_an_exact_pickup_exchange_offer() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Full Deck Tester",
    );
    runtime
        .world
        .actors
        .iter_mut()
        .take(runtime.world.actor_count)
        .find(|actor| actor.id == 5000)
        .expect("test actor exists")
        .stats
        .strength = 1;
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        item.location_id = 0;
        item.holder_actor_id = 0;
        item.zone = CW_CARD_ZONE_WORLD;
        item.container_item_id = 0;
        match item.id {
            2001 => {
                item.holder_actor_id = 5000;
                item.zone = CW_CARD_ZONE_CARRIED;
                item.weight_tenths = 150;
            }
            STORY_BUTTON_ITEM_ID => {
                item.location_id = COSY_COTTAGE_LOCATION_ID;
                item.weight_tenths = 1;
            }
            _ => {}
        }
    }

    assert!(runtime.actor_inventory_full(5000));
    assert!(runtime
        .primary_action(Some(5000), &AccessContext::default())
        .options
        .iter()
        .any(|option| option.kind == "pick_up"));
    let pickup_offer = runtime
        .legal_action_candidates(Some(5000), &AccessContext::default())
        .1
        .into_iter()
        .find(|offer| {
            offer.kind == "pick_up"
                && offer.target.as_ref().and_then(|target| target.id) == Some(STORY_BUTTON_ITEM_ID)
        })
        .expect("full Pack still has an exact Story Button offer");
    let exchange = runtime
        .plan_item_offer_action(5000, &pickup_offer, 2001)
        .expect("the exact pickup offer permits the required exchange");
    assert_eq!(exchange.kind, CW_ACTION_PICK_UP_ITEM);
    assert_eq!(exchange.item_id, STORY_BUTTON_ITEM_ID);
    assert_eq!(exchange.target_item_id, 2001);
    assert_eq!(
        runtime
            .apply_journal_record(&JournalRecord::new(exchange, 97_102))
            .0,
        CW_OK
    );
    assert!(runtime
        .item_by_id(STORY_BUTTON_ITEM_ID)
        .is_some_and(|item| item.holder_actor_id == 5000));
    assert!(runtime
        .item_by_id(2001)
        .is_some_and(|item| item.location_id == COSY_COTTAGE_LOCATION_ID));
}

#[test]
fn same_kind_exact_offers_cover_a_bounded_rotation_in_wrap_order() {
    let actor_id = 5_000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Exact Hand Rotation Witness",
    );
    let expected_item_ids = [
        HEARTH_TONIC_ITEM_ID,
        DEWBRIGHT_BUTTON_ITEM_ID,
        STORY_BUTTON_ITEM_ID,
        WATCH_BELL_ITEM_ID,
    ];
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if expected_item_ids.contains(&item.id) {
            item.location_id = COSY_COTTAGE_LOCATION_ID;
            item.holder_actor_id = 0;
            item.zone = CW_CARD_ZONE_WORLD;
            item.container_item_id = 0;
        }
    }
    let (_, offers) = runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
    let pickup_offers = offers
        .into_iter()
        .filter(|offer| offer.kind == "pick_up")
        .collect::<Vec<_>>();
    let pickup_offer_ids = pickup_offers
        .iter()
        .map(|offer| offer.offer_id.clone())
        .collect::<BTreeSet<_>>();
    assert!(pickup_offer_ids.len() >= expected_item_ids.len());

    let initial = compose_story_hand_at(&pickup_offers, [0; 3]);
    assert_eq!(initial.entries.len(), 3);
    assert_eq!(
        initial
            .entries
            .iter()
            .map(|entry| entry.slot.as_str())
            .collect::<Vec<_>>(),
        ["story", "self", "anchor"]
    );
    let mut seen = BTreeSet::new();
    for slot_index in 0..3 {
        let entry = &initial.entries[slot_index];
        let pool_size = usize::from(entry.replacement_count) + 1;
        let initial_ids = initial
            .entries
            .iter()
            .map(|entry| entry.offer_id.clone())
            .collect::<Vec<_>>();
        for generation in 0..pool_size {
            let mut generations = [0; 3];
            generations[slot_index] = generation;
            let hand = compose_story_hand_at(&pickup_offers, generations);
            seen.insert(hand.entries[slot_index].offer_id.clone());
            for (other_slot, initial_id) in initial_ids.iter().enumerate() {
                if other_slot != slot_index {
                    assert_eq!(
                        &hand.entries[other_slot].offer_id, initial_id,
                        "rotating one slot preserves both other exact cards"
                    );
                }
            }
        }
        let mut wrapped_generations = [0; 3];
        wrapped_generations[slot_index] = pool_size;
        let wrapped = compose_story_hand_at(&pickup_offers, wrapped_generations);
        assert_eq!(
            wrapped.entries[slot_index].offer_id, initial_ids[slot_index],
            "each exact slot wraps independently"
        );
    }
    assert_eq!(
        seen, pickup_offer_ids,
        "every exact pickup certificate is dealt"
    );
}

#[test]
fn hand_generation_survives_projection_churn_snapshot_migration_and_replay() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Durable Hand Tester",
    );
    complete_guided_story_for_test(&mut runtime, 5000);
    let initial = runtime
        .state_response(Some(5000), &AccessContext::default())
        .action_hand;

    let mut shuffle = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        93_001,
    )
    .into_player_card();
    shuffle
        .projection_mutations
        .push(ProjectionMutation::ShuffleHand {
            reason: "durable_generation_test".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&shuffle).0, CW_OK);
    let shuffled = runtime
        .state_response(Some(5000), &AccessContext::default())
        .action_hand;
    assert_eq!(
        shuffled.generation,
        initial.generation + 3,
        "a legacy whole-hand shuffle migrates all three slot counters"
    );
    assert_eq!(shuffled.pass.generation, 1);
    assert_eq!(runtime.hand_generations.get(&5000), Some(&1));

    let mut legacy_json = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
        .expect("legacy snapshot serializes");
    let legacy = legacy_json.as_object_mut().expect("snapshot is an object");
    legacy.insert("version".to_string(), serde_json::Value::from(16));
    legacy.remove("hand_generations");
    let migrated = serde_json::from_value::<RuntimeSnapshot>(legacy_json)
        .expect("v0.0.311 snapshot defaults missing hand generations")
        .into_runtime()
        .expect("v0.0.311 snapshot migrates");
    let migrated_hand = migrated
        .state_response(Some(5000), &AccessContext::default())
        .action_hand;
    assert_eq!(migrated_hand.generation, shuffled.generation);
    assert_eq!(migrated_hand.pass.offer_id, shuffled.pass.offer_id);

    for seq in 100_000..100_513 {
        runtime.push_projected_event(EventView {
            seq,
            type_name: "test.unrelated_projection".to_string(),
            success: true,
            actor_id: Some(1001),
            ..EventView::default()
        });
    }
    // The direct projection fixture bypasses normal event sequencing; keep
    // the runtime counter coherent so snapshot restoration sees the same
    // state revision as the live world.
    runtime.world.next_event_seq = 100_513;
    assert_eq!(runtime.event_log.len(), 512);
    assert!(runtime
        .event_log
        .iter()
        .all(|event| event.type_name != "hand.shuffled"));
    let churned = runtime
        .state_response(Some(5000), &AccessContext::default())
        .action_hand;
    assert_eq!(churned.generation, shuffled.generation);
    assert_eq!(churned.pass.generation, shuffled.pass.generation);
    assert_eq!(
        churned
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.kind.as_str(),
                    entry.provider.kind.as_str(),
                    entry.provider.id.as_str(),
                    entry.provider.reason.as_str(),
                )
            })
            .collect::<Vec<_>>(),
        shuffled
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.kind.as_str(),
                    entry.provider.kind.as_str(),
                    entry.provider.id.as_str(),
                    entry.provider.reason.as_str(),
                )
            })
            .collect::<Vec<_>>()
    );

    let restored = RuntimeSnapshot::from_runtime(&runtime)
        .into_runtime()
        .expect("current snapshot preserves durable hand generation");
    let restored_hand = restored
        .state_response(Some(5000), &AccessContext::default())
        .action_hand;
    assert_eq!(restored_hand.generation, shuffled.generation);
    assert_eq!(restored_hand.pass.generation, shuffled.pass.generation);
    assert_eq!(restored_hand.pass.offer_id, churned.pass.offer_id);

    let mut replay = RuntimeWorld::seeded();
    create_test_human(
        &mut replay,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Durable Hand Tester",
    );
    complete_guided_story_for_test(&mut replay, 5000);
    assert_eq!(replay.apply_journal_record(&shuffle).0, CW_OK);
    let replayed_hand = replay
        .state_response(Some(5000), &AccessContext::default())
        .action_hand;
    assert_eq!(replayed_hand.generation, shuffled.generation);
    assert_eq!(replayed_hand.pass.offer_id, shuffled.pass.offer_id);
}

#[test]
fn resident_inference_rejects_legal_off_hand_actions_and_traces_only_its_hand() {
    let actor_id = 5000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Finite Hand Resident",
    );
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if [
            HEARTH_TONIC_ITEM_ID,
            DEWBRIGHT_BUTTON_ITEM_ID,
            STORY_BUTTON_ITEM_ID,
            WATCH_BELL_ITEM_ID,
        ]
        .contains(&item.id)
        {
            item.location_id = COSY_COTTAGE_LOCATION_ID;
            item.holder_actor_id = 0;
            item.zone = CW_CARD_ZONE_WORLD;
            item.container_item_id = 0;
        }
    }
    let (_, offers) = runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
    runtime
        .actor_autonomy
        .entry(actor_id)
        .or_default()
        .control_mode = ActorControlMode::LocalAi;
    let hand = runtime.action_hand_for(Some(actor_id), &offers);
    let off_hand = offers
        .iter()
        .find(|offer| {
            offer.kind == "pick_up"
                && !hand
                    .entries
                    .iter()
                    .any(|entry| entry.offer_id == offer.offer_id)
        })
        .expect("one of the four legal pickup offers must be outside the Story Hand");
    let item_id = off_hand
        .target
        .as_ref()
        .and_then(|target| target.id)
        .expect("pickup offer has an exact item target");
    assert!(action_offer_is_reachable(off_hand));
    let action = CwAction {
        kind: CW_ACTION_PICK_UP_ITEM,
        actor_id,
        item_id,
        ..CwAction::default()
    };
    let proposal = AvatarProposedAction {
        kind: "pick_up".to_string(),
        item_id: Some(item_id),
        planning_generation_id: Some("finite-hand-test".to_string()),
        ..AvatarProposedAction::default()
    };
    assert!(
        !runtime.resident_proposed_action_matches_legal_offer(actor_id, &proposal, &action),
        "a legal but undealt action cannot be proposed by an inference resident"
    );
    runtime
        .resident_continuities
        .get_mut(&actor_id)
        .expect("test human has continuity")
        .pending_action = Some(proposal);

    let trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
        actor_id,
        rank: 0,
        score: 0,
        record: JournalRecord::new(action, 93_002),
    });
    let expected_offer_ids = runtime
        .current_action_hand_offers(actor_id, &offers)
        .into_iter()
        .map(|offer| offer.offer_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        trace
            .candidates
            .iter()
            .map(|candidate| candidate.offer_id.as_str())
            .collect::<Vec<_>>(),
        expected_offer_ids
    );
    assert!(trace.choice.offer_id.is_none());
}

#[tokio::test]
async fn direct_loadout_configuration_is_turn_neutral_outside_a_focused_scene() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Quiet Loadout Keeper",
    );
    let blade = runtime
        .world
        .items
        .iter_mut()
        .take(runtime.world.item_count)
        .find(|item| item.id == 2013)
        .expect("Ashwood Practice Blade exists");
    blade.location_id = 0;
    blade.holder_actor_id = 5000;
    blade.zone = CW_CARD_ZONE_CARRIED;
    blade.held_since_tick = runtime.world.tick;

    let before_tick = runtime.world.tick;
    let before_generation = runtime.hand_generations.get(&5000).copied();
    let before_state = runtime.state_response(Some(5000), &AccessContext::default());
    let before_entries = before_state
        .action_hand
        .entries
        .iter()
        .map(|entry| {
            (
                entry.kind.clone(),
                entry.provider.kind.clone(),
                entry.provider.id.clone(),
            )
        })
        .collect::<Vec<_>>();
    let before_revision = before_state.state_revision;
    let before_pass_offer_id = before_state.action_hand.pass.offer_id;
    let before_hand_generation = before_state.action_hand.generation;
    let state = test_app_state(runtime, None);
    let actor_session = issue_actor_session(&state, 5000).0;
    let mut request = command_request(5000, "wield Ashwood Practice Blade");
    request.actor_session = Some(actor_session);
    let response = command(
        ConnectInfo("127.0.0.1:46023".parse().expect("client address")),
        State(state.clone()),
        Json(request),
    )
    .await
    .0;
    assert!(response.ok, "{response:?}");

    let runtime = state.inner.lock().await;
    let after_state = runtime.state_response(Some(5000), &AccessContext::default());
    assert_eq!(runtime.world.tick, before_tick);
    assert_eq!(
        runtime.hand_generations.get(&5000).copied(),
        before_generation
    );
    assert_eq!(after_state.action_hand.generation, before_hand_generation);
    assert_eq!(
        after_state
            .action_hand
            .entries
            .iter()
            .map(|entry| (
                entry.kind.clone(),
                entry.provider.kind.clone(),
                entry.provider.id.clone()
            ))
            .collect::<Vec<_>>(),
        before_entries,
        "equipping outside a scene preserves the dealt action composition"
    );
    assert!(after_state.state_revision > before_revision);
    assert_ne!(after_state.action_hand.pass.offer_id, before_pass_offer_id);
    assert!(runtime
        .event_log
        .iter()
        .all(|event| { event.seq <= before_revision || event.type_name != "hand.shuffled" }));
    assert_eq!(
        runtime.item_by_id(2013).map(|item| item.zone),
        Some(CW_CARD_ZONE_EQUIPPED)
    );
}

#[tokio::test]
async fn direct_loadout_configuration_is_rejected_without_hand_or_world_change_in_combat() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        MOONLIT_TRAIL_LOCATION_ID,
        "Focused Loadout Keeper",
    );
    let blade = runtime
        .world
        .items
        .iter_mut()
        .take(runtime.world.item_count)
        .find(|item| item.id == 2013)
        .expect("Ashwood Practice Blade exists");
    blade.location_id = 0;
    blade.holder_actor_id = 5000;
    blade.zone = CW_CARD_ZONE_CARRIED;
    blade.held_since_tick = runtime.world.tick;
    let encounter_id = combat_encounter_id(MOONLIT_JOB_ID);
    let start = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_COMBAT_START,
            actor_id: 5000,
            target_actor_id: 1004,
            content_id: encounter_id,
            ..CwAction::default()
        },
        77_023,
    )
    .into_system();
    assert_eq!(runtime.apply_journal_record(&start).0, CW_OK);

    let before_tick = runtime.world.tick;
    let before_generation = runtime.hand_generations.get(&5000).copied();
    let before_hand = serde_json::to_value(
        runtime
            .state_response(Some(5000), &AccessContext::default())
            .action_hand,
    )
    .expect("hand serializes");
    let state = test_app_state(runtime, None);
    let actor_session = issue_actor_session(&state, 5000).0;
    let mut request = command_request(5000, "wield Ashwood Practice Blade");
    request.actor_session = Some(actor_session);
    let response = command(
        ConnectInfo("127.0.0.1:46024".parse().expect("client address")),
        State(state.clone()),
        Json(request),
    )
    .await
    .0;
    assert!(!response.ok);
    assert_eq!(response.status, 423);

    let runtime = state.inner.lock().await;
    assert_eq!(runtime.world.tick, before_tick);
    assert_eq!(
        runtime.hand_generations.get(&5000).copied(),
        before_generation
    );
    assert_eq!(
        serde_json::to_value(
            runtime
                .state_response(Some(5000), &AccessContext::default())
                .action_hand,
        )
        .expect("hand serializes"),
        before_hand,
    );
    assert_eq!(
        runtime.item_by_id(2013).map(|item| item.zone),
        Some(CW_CARD_ZONE_CARRIED)
    );
}
