//! Resident trade, gift, and feature-use policy regressions.
//!
//! The behaviour these pin lives in autonomy.rs and the residents seam, which
//! already own the trade, gift, and delivery candidate generators. The tests
//! stayed behind in main.rs's inline module, where they spent the same line
//! budget as production code without sitting beside the code they describe.
//!
//! Moved verbatim from `main.rs`: no test, assertion, or fixture changed.

use super::*;

#[test]
fn legacy_item_kind_restores_as_a_trinket_with_its_physical_state() {
    let mut snapshot = RuntimeSnapshot::from_runtime(&RuntimeWorld::seeded());
    let item = snapshot
        .world_items
        .iter_mut()
        .find(|item| item.id == THREADBARE_MAP_SCRAP_ITEM_ID)
        .unwrap();
    // Value 3 and the old source spelling are durable compatibility inputs.
    item.kind = 3;
    item.charges = 0;
    let location_id = item.location_id;
    let holder_actor_id = item.holder_actor_id;
    assert_eq!(seed_item_kind_from_str("keepsake"), Some(item.kind));
    let bytes = serde_json::to_vec(&snapshot).unwrap();
    let restored: RuntimeSnapshot = serde_json::from_slice(&bytes).unwrap();
    let runtime = restored.into_runtime().unwrap();
    let item = runtime.item_by_id(THREADBARE_MAP_SCRAP_ITEM_ID).unwrap();
    assert_eq!(item.charges, 0);
    assert_eq!(item.location_id, location_id);
    assert_eq!(item.holder_actor_id, holder_actor_id);
    assert_eq!(runtime.item_view(item).kind, "trinket");
}

#[test]
fn item_trade_swaps_player_and_resident_items() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    assert_eq!(
        runtime
            .apply_journal_record(&JournalRecord::new(create, 7829))
            .0,
        CW_OK
    );

    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
            }
            _ => {}
        }
    }
    runtime
        .prepare_resident_local_memories(RATI_ACTOR_ID)
        .expect("Rati observes the arranged trade inventory");
    runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

    let access = AccessContext::default();
    let state = runtime.state_response(Some(5000), &access);
    assert!(state.items.iter().any(|item| {
        item.id == DEWBRIGHT_BUTTON_ITEM_ID && item.holder_actor_id == Some(RATI_ACTOR_ID)
    }));
    assert!(state
        .primary_action
        .options
        .iter()
        .any(|option| option.kind == "trade_item"));

    let trade = runtime
        .resolve_command(
            &command_request(5000, "trade story with rati for dewbright"),
            &access,
        )
        .expect("trade resolves");
    match trade.dispatch {
        CommandDispatch::TradeItem {
            item_id,
            target_actor_id,
            target_item_id,
        } => {
            assert_eq!(item_id, STORY_BUTTON_ITEM_ID);
            assert_eq!(target_actor_id, RATI_ACTOR_ID);
            assert_eq!(target_item_id, DEWBRIGHT_BUTTON_ITEM_ID);
        }
        other => panic!("trade should map to trade-item, got {other:?}"),
    }

    let trade_action = CwAction {
        kind: CW_ACTION_TRADE_ITEM,
        actor_id: 5000,
        target_actor_id: RATI_ACTOR_ID,
        item_id: STORY_BUTTON_ITEM_ID,
        target_item_id: DEWBRIGHT_BUTTON_ITEM_ID,
        ..CwAction::default()
    };
    let reply_text = runtime
        .resident_reply_text_for_committed_action(&trade_action)
        .expect("trade reply target")
        .1;
    assert!(reply_text.contains("I traded you Story Button for Dewbright Button."));
    assert!(reply_text.contains("Rati wants Story Button"));
    assert!(reply_text.contains("blue scarf"));
    let (status, events) = runtime.apply_journal_record(&JournalRecord::new(trade_action, 7830));
    assert_eq!(status, CW_OK);
    let trade_event = events
        .iter()
        .find(|event| {
            event.type_name == "item.traded"
                && event.item_id == Some(STORY_BUTTON_ITEM_ID)
                && event.target_item_id == Some(DEWBRIGHT_BUTTON_ITEM_ID)
                && event.target_item_name.as_deref() == Some("Dewbright Button")
        })
        .expect("trade event");
    let trade_content = trade_event.content.as_deref().expect("trade content");
    assert!(trade_content.contains("Rati wanted Story Button"));
    assert!(trade_content.contains("blue scarf"));
    assert_eq!(
        command_response_output(None, &events).as_deref(),
        Some("You trade Story Button to Rati for Dewbright Button.")
    );
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| item.id == STORY_BUTTON_ITEM_ID && item.holder_actor_id == RATI_ACTOR_ID));
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| item.id == DEWBRIGHT_BUTTON_ITEM_ID && item.holder_actor_id == 5000));
}

#[tokio::test]
async fn trade_action_without_ai_emits_no_fallback_reply() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    let mut create_record = JournalRecord::new(create, 7831);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Trade Listener".to_string(),
            speech_mode: "prose".to_string(),
            title: "Reply Tester".to_string(),
            description: "A test avatar checking contextual trade replies.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
            }
            _ => {}
        }
    }
    runtime
        .prepare_resident_local_memories(RATI_ACTOR_ID)
        .expect("Rati observes the arranged trade inventory");
    runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

    let state = test_app_state(runtime, None);
    let (actor_session, _) = issue_actor_session(&state, 5000);
    let response = trade_item(
        ConnectInfo("127.0.0.1:44102".parse().expect("client address")),
        State(state.clone()),
        Json(ItemRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            item_id: STORY_BUTTON_ITEM_ID,
            target_item_id: Some(DEWBRIGHT_BUTTON_ITEM_ID),
            target_actor_id: Some(RATI_ACTOR_ID),
        }),
    )
    .await
    .0;

    assert!(response.ok);
    assert_eq!(response.status, CW_OK);
    assert!(response.events.iter().any(|event| {
        event.type_name == "item.traded"
            && event.actor_id == Some(5000)
            && event.target_actor_id == Some(RATI_ACTOR_ID)
    }));
    assert!(!response
        .events
        .iter()
        .any(|event| event.type_name == "message.created" && event.actor_id == Some(1001)));

    let after_seq = response
        .events
        .iter()
        .map(|event| event.seq)
        .max()
        .unwrap_or(0);
    let mut saw_reply = false;
    for _ in 0..20 {
        {
            let runtime = state.inner.lock().await;
            saw_reply = runtime.event_log.iter().any(|event| {
                event.seq > after_seq
                    && event.type_name == "message.created"
                    && event.actor_id == Some(RATI_ACTOR_ID)
                    && event.location_id == Some(COSY_COTTAGE_LOCATION_ID)
                    && event
                        .content
                        .as_deref()
                        .is_some_and(|content| !content.is_empty())
            });
        }
        if saw_reply {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(!saw_reply, "no fallback reply should follow without AI");
}

#[tokio::test]
async fn remembered_exact_trade_offer_commits_without_full_inventory_disclosure() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    assert_eq!(
        runtime
            .apply_journal_record(&JournalRecord::new(create, 7832))
            .0,
        CW_OK
    );
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
            }
            _ => {}
        }
    }
    runtime.observe_room_for_actor(5000, COSY_COTTAGE_LOCATION_ID);
    assert!(!runtime.economy_known_by(5000, RATI_ACTOR_ID));
    assert!(runtime.resident_remembers_actor_holding_item_at(
        5000,
        RATI_ACTOR_ID,
        DEWBRIGHT_BUTTON_ITEM_ID,
        COSY_COTTAGE_LOCATION_ID,
    ));
    assert!(runtime
        .state_response(Some(5000), &AccessContext::default())
        .action_offers
        .iter()
        .any(|offer| {
            offer.kind == "trade_item"
                && offer.id
                    == format!(
                        "trade_item:{STORY_BUTTON_ITEM_ID}:{RATI_ACTOR_ID}:{DEWBRIGHT_BUTTON_ITEM_ID}"
                    )
        }));

    let state = test_app_state(runtime, None);
    let (actor_session, _) = issue_actor_session(&state, 5000);
    let response = trade_item(
        ConnectInfo("127.0.0.1:44103".parse().expect("client address")),
        State(state),
        Json(ItemRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            item_id: STORY_BUTTON_ITEM_ID,
            target_item_id: Some(DEWBRIGHT_BUTTON_ITEM_ID),
            target_actor_id: Some(RATI_ACTOR_ID),
        }),
    )
    .await
    .0;

    assert!(response.ok, "remembered exact trade should commit");
    assert!(response.events.iter().any(|event| {
        event.type_name == "item.traded"
            && event.item_id == Some(STORY_BUTTON_ITEM_ID)
            && event.target_item_id == Some(DEWBRIGHT_BUTTON_ITEM_ID)
    }));
}

#[test]
fn ordinary_keepsakes_drive_resident_trade_without_evolution() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = 41;
    let mut create_record = JournalRecord::new(create, 78331);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Map Guest".to_string(),
            speech_mode: "prose".to_string(),
            title: "Keepsake Trader".to_string(),
            description: "A test avatar carrying a purely social keepsake.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            THREADBARE_MAP_SCRAP_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            WATCH_BELL_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = MOUSE_WANDERER_ACTOR_ID;
            }
            _ => {}
        }
    }
    runtime
        .prepare_resident_local_memories(MOUSE_WANDERER_ACTOR_ID)
        .expect("Septimus observes the arranged keepsake trade");

    let map_scrap = runtime
        .item_by_id(THREADBARE_MAP_SCRAP_ITEM_ID)
        .expect("map scrap exists");
    assert_eq!(item_kind(map_scrap.kind), "trinket");
    assert!(!evolution_track_item_ids(MOUSE_WANDERER_ACTOR_ID)
        .unwrap_or_default()
        .contains(&THREADBARE_MAP_SCRAP_ITEM_ID));
    runtime.record_economy_disclosure(5000, MOUSE_WANDERER_ACTOR_ID);

    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let mouse = state
        .actors
        .iter()
        .find(|actor| actor.id == MOUSE_WANDERER_ACTOR_ID)
        .expect("Septimus is visible");
    let economy = mouse
        .resident_economy
        .as_ref()
        .expect("resident economy is exposed");
    assert!(economy
        .desired_item_ids
        .contains(&THREADBARE_MAP_SCRAP_ITEM_ID));
    let sought_map = economy
        .sought_items
        .iter()
        .find(|item| item.item_id == THREADBARE_MAP_SCRAP_ITEM_ID)
        .expect("sought item details include map scrap");
    assert_eq!(sought_map.source, "personal");
    assert_eq!(sought_map.holder_actor_id, Some(5000));
    assert!(sought_map
        .reason
        .contains("Septimus wants Threadbare Map Scrap"));
    assert!(sought_map.reason.contains("wrong turn"));
    let stance = economy
        .trade_stance
        .as_ref()
        .expect("keepsake trade exposes a stance");
    assert!(stance.accepted);
    assert_eq!(stance.offered_item_id, THREADBARE_MAP_SCRAP_ITEM_ID);
    assert_eq!(stance.requested_item_id, WATCH_BELL_ITEM_ID);
    assert_eq!(stance.willingness, "eager");
    assert!(stance.reason.contains("Threadbare Map Scrap"));
    assert!(state
        .action_offers
        .iter()
        .find(|offer| offer.kind == "trade_item")
        .and_then(|offer| offer.effect.as_deref())
        .is_some_and(|effect| effect.contains("Threadbare Map Scrap")));

    let trade_action = CwAction {
        kind: CW_ACTION_TRADE_ITEM,
        actor_id: 5000,
        target_actor_id: MOUSE_WANDERER_ACTOR_ID,
        item_id: THREADBARE_MAP_SCRAP_ITEM_ID,
        target_item_id: WATCH_BELL_ITEM_ID,
        ..CwAction::default()
    };
    runtime
        .resident_trade_is_willing(
            5000,
            MOUSE_WANDERER_ACTOR_ID,
            THREADBARE_MAP_SCRAP_ITEM_ID,
            WATCH_BELL_ITEM_ID,
        )
        .expect("resident accepts an ordinary keepsake trade");
    let (status, events) = runtime.apply_journal_record(&JournalRecord::new(trade_action, 78332));
    assert_eq!(status, CW_OK);
    let trade_content = events
        .iter()
        .find(|event| event.type_name == "item.traded")
        .and_then(|event| event.content.as_deref())
        .expect("keepsake trade event");
    assert!(trade_content.contains("Septimus wanted Threadbare Map Scrap"));
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| {
            item.id == THREADBARE_MAP_SCRAP_ITEM_ID
                && item.holder_actor_id == MOUSE_WANDERER_ACTOR_ID
                && item.kind == CW_ITEM_KEEPSAKE
        }));
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| item.id == WATCH_BELL_ITEM_ID && item.holder_actor_id == 5000));
}

#[test]
fn content_authored_personal_desires_explain_trade_offers_and_events() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.world.tick = 0;
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = 40;
    let mut create_record = JournalRecord::new(create, 78333);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Button Trader".to_string(),
            speech_mode: "prose".to_string(),
            title: "Trade Tester".to_string(),
            description: "A test avatar carrying a personally desired item.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.held_since_tick = runtime.world.tick;
            }
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = STEAMPUNK_MOUSE_ACTOR_ID;
                item.held_since_tick = runtime.world.tick;
            }
            _ => {}
        }
    }

    runtime
        .prepare_resident_local_memories(STEAMPUNK_MOUSE_ACTOR_ID)
        .expect("Doctor Cogwhisker observes the trade item");
    runtime.record_economy_disclosure(5000, STEAMPUNK_MOUSE_ACTOR_ID);
    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let mouse = state
        .actors
        .iter()
        .find(|actor| actor.id == STEAMPUNK_MOUSE_ACTOR_ID)
        .expect("Doctor Cogwhisker is visible");
    let trade_offer = mouse
        .resident_economy
        .as_ref()
        .and_then(|economy| economy.trade_offer.as_ref())
        .expect("Mouse offers a trade for the personally desired item");
    assert_eq!(trade_offer.offered_item_id, DEWBRIGHT_BUTTON_ITEM_ID);
    assert_eq!(trade_offer.requested_item_id, STORY_BUTTON_ITEM_ID);
    assert_eq!(trade_offer.willingness, "eager");
    assert!(trade_offer.reason.contains("tiny rain engine"));
    assert!(state
        .action_offers
        .iter()
        .find(|offer| offer.kind == "trade_item")
        .and_then(|offer| offer.effect.as_deref())
        .is_some_and(|effect| effect.contains("tiny rain engine")));
    let mouse_actor = runtime
        .actor_by_id(STEAMPUNK_MOUSE_ACTOR_ID)
        .expect("Doctor Cogwhisker exists");
    let economy_note = runtime.resident_economy_prompt_note(mouse_actor, Some(5000));
    assert!(economy_note.contains("trade: eager"));
    assert!(economy_note.contains("Button Trader offers Dewbright Button for Story Button"));
    assert!(economy_note.contains("tiny rain engine"));

    let trade_action = CwAction {
        kind: CW_ACTION_TRADE_ITEM,
        actor_id: 5000,
        target_actor_id: STEAMPUNK_MOUSE_ACTOR_ID,
        item_id: DEWBRIGHT_BUTTON_ITEM_ID,
        target_item_id: STORY_BUTTON_ITEM_ID,
        ..CwAction::default()
    };
    let (status, events) = runtime.apply_journal_record(&JournalRecord::new(trade_action, 78334));
    assert_eq!(status, CW_OK);
    let trade_event = events
        .iter()
        .find(|event| {
            event.type_name == "item.traded"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(STEAMPUNK_MOUSE_ACTOR_ID)
                && event.item_id == Some(DEWBRIGHT_BUTTON_ITEM_ID)
                && event.target_item_id == Some(STORY_BUTTON_ITEM_ID)
        })
        .expect("trade event");
    assert!(trade_event
        .content
        .as_deref()
        .is_some_and(|content| content.contains("tiny rain engine")));
}

#[test]
fn resident_economy_exposes_same_room_player_gifts_without_memory() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    let mut create_record = JournalRecord::new(create, 78330);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Unseen Guest".to_string(),
            speech_mode: "prose".to_string(),
            title: "Pocket Test".to_string(),
            description: "A test avatar carrying an item a resident wants.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
            }
            _ => {}
        }
    }
    runtime.beliefs.clear();
    runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let economy = state
        .actors
        .iter()
        .find(|actor| actor.id == RATI_ACTOR_ID)
        .and_then(|actor| actor.resident_economy.as_ref())
        .expect("resident economy is exposed");
    let request = economy
        .request
        .as_ref()
        .expect("resident can ask for a currently visible player-held item");
    assert_eq!(request.item_id, STORY_BUTTON_ITEM_ID);
    assert_eq!(request.holder_actor_id, 5000);
    assert!(economy.trade_offer.is_some());
    assert!(
        state
            .action_offers
            .iter()
            .any(|offer| offer.kind == "give_item"),
        "action bar should offer a same-room wanted gift"
    );
    assert!(
        state
            .action_offers
            .iter()
            .any(|offer| offer.kind == "trade_item"),
        "action bar should offer a same-room accepted trade"
    );
}

#[test]
fn direct_avatars_share_actor_targets_and_gift_affordances() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, 5000, 2, "Button Giver");
    create_test_human(&mut runtime, 5001, 2, "Button Receiver");
    let item = runtime
        .world
        .items
        .iter_mut()
        .find(|item| item.id == STORY_BUTTON_ITEM_ID)
        .expect("Story Button exists");
    item.location_id = 0;
    item.holder_actor_id = 5000;
    item.held_since_tick = runtime.world.tick;
    for (item_id, holder_actor_id) in [(2001, 5000), (DEWBRIGHT_BUTTON_ITEM_ID, 5001)] {
        let item = runtime
            .world
            .items
            .iter_mut()
            .find(|item| item.id == item_id)
            .expect("trade item exists");
        item.location_id = 0;
        item.holder_actor_id = holder_actor_id;
        item.held_since_tick = runtime.world.tick;
    }
    runtime.record_economy_disclosure(5000, 5001);

    let targets = runtime.active_chat_targets(5000);
    assert_eq!(
        targets.iter().map(|target| target.id).collect::<Vec<_>>(),
        vec![5001]
    );
    let (offered_item, target) = runtime
        .actor_give_candidate(5000)
        .expect("a legal gift does not require a resident request");
    assert_eq!(offered_item.holder_actor_id, 5000);
    assert_eq!(target.id, 5001);
    runtime
        .actor_gift_is_legal(5000, 5001, STORY_BUTTON_ITEM_ID)
        .expect("directly controlled avatars use the same gift rule");
    assert!(runtime
        .item_trade_candidates(5000)
        .iter()
        .any(|candidate| candidate.target.id == 5001));

    let (trade_status, trade_events) = runtime.apply_journal_record(&JournalRecord::new(
        CwAction {
            kind: CW_ACTION_TRADE_ITEM,
            actor_id: 5000,
            target_actor_id: 5001,
            item_id: 2001,
            target_item_id: DEWBRIGHT_BUTTON_ITEM_ID,
            ..CwAction::default()
        },
        78_330,
    ));
    assert_eq!(trade_status, CW_OK);
    assert!(trade_events.iter().any(|event| {
        event.type_name == "item.traded"
            && event.actor_id == Some(5000)
            && event.target_actor_id == Some(5001)
    }));

    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let give_offer = state
        .action_offers
        .iter()
        .find(|offer| offer.kind == "give_item")
        .expect("the shared action surface includes Give");
    assert_eq!(
        give_offer.target.as_ref().and_then(|target| target.id),
        Some(5001)
    );
    let receiver = state
        .actors
        .iter()
        .find(|actor| actor.id == 5001)
        .expect("the other direct avatar is visible");
    let receiver_json = serde_json::to_value(receiver).expect("actor view serializes");
    assert_eq!(receiver_json["control_mode"], "direct_input");
    assert!(receiver_json.get("economy").is_some());
    assert!(receiver_json.get("resident_economy").is_none());

    let (status, events) = runtime.apply_journal_record(&JournalRecord::new(
        CwAction {
            kind: CW_ACTION_GIVE_ITEM,
            actor_id: 5000,
            target_actor_id: 5001,
            item_id: STORY_BUTTON_ITEM_ID,
            ..CwAction::default()
        },
        78_331,
    ));
    assert_eq!(status, CW_OK);
    assert!(events.iter().any(|event| {
        event.type_name == "item.given"
            && event.actor_id == Some(5000)
            && event.target_actor_id == Some(5001)
    }));
}

#[test]
fn resident_waits_in_room_for_player_held_wanted_gift() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    let mut create_record = JournalRecord::new(create, 78334);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Bell Carrier".to_string(),
            speech_mode: "prose".to_string(),
            title: "Patient Visitor".to_string(),
            description: "A test avatar bringing Skull the bell he wants.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

    runtime
        .world
        .actors
        .iter_mut()
        .find(|actor| actor.id == SKULL_ACTOR_ID)
        .expect("Skull exists")
        .location_id = COSY_COTTAGE_LOCATION_ID;
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == WATCH_BELL_ITEM_ID {
            item.location_id = 0;
            item.holder_actor_id = 5000;
        }
    }
    runtime.beliefs.clear();

    let skull = runtime.actor_by_id(SKULL_ACTOR_ID).expect("Skull exists");
    let request = runtime
        .resident_request_for_holder(skull, 5000)
        .expect("Skull asks for the player-held Watch Bell");
    assert_eq!(request.item_id, WATCH_BELL_ITEM_ID);
    assert!(runtime.resident_waits_for_player_gift(skull));
    assert!(!runtime
        .resident_economy_autonomy_action(skull)
        .is_some_and(|action| matches!(action.kind, CW_ACTION_MOVE | CW_ACTION_PICK_UP_ITEM)));

    let watch_bell = runtime
        .world
        .items
        .iter_mut()
        .find(|item| item.id == WATCH_BELL_ITEM_ID)
        .expect("Watch Bell exists");
    watch_bell.holder_actor_id = 0;
    watch_bell.location_id = 0;
    assert!(!runtime.resident_waits_for_player_gift(skull));
}

#[test]
fn resident_economy_requests_medicine_for_hurt_companion() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    let mut create_record = JournalRecord::new(create, 78337);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Care Guest".to_string(),
            speech_mode: "prose".to_string(),
            title: "Tonic Holder".to_string(),
            description: "A test avatar holding medicine for someone nearby.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
    runtime
        .world
        .actors
        .iter_mut()
        .find(|actor| actor.id == WHISKERWIND_ACTOR_ID)
        .expect("Gust exists")
        .damage = 4;
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == 2001 {
            item.location_id = 0;
            item.holder_actor_id = 5000;
            item.charges = 1;
        }
    }
    runtime
        .prepare_resident_local_memories(RATI_ACTOR_ID)
        .expect("Rati observes the player-held medicine");
    runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let economy = state
        .actors
        .iter()
        .find(|actor| actor.id == RATI_ACTOR_ID)
        .and_then(|actor| actor.resident_economy.as_ref())
        .expect("resident economy is exposed");
    let request = economy
        .request
        .as_ref()
        .expect("Rati asks for player-held medicine for a companion");
    assert_eq!(request.item_id, 2001);
    assert_eq!(request.holder_actor_id, 5000);
    assert_eq!(request.reason, "Rati wants Hearth Tonic for Gust.");
    assert_eq!(
        economy.motive,
        "Rati wants Hearth Tonic for Gust from Care Guest."
    );
}

#[test]
fn resident_economy_values_items_useful_to_the_current_room() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    let mut create_record = JournalRecord::new(create, 78336);
    create_record.actor_meta_upserts.insert(
        5000,
        ActorMeta {
            name: "Bell Guest".to_string(),
            speech_mode: "prose".to_string(),
            title: "Threshold Carrier".to_string(),
            description: "A test avatar holding an item useful to the room.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            WATCH_BELL_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            STORY_BUTTON_ITEM_ID | 2004 => {
                item.location_id = MOONLIT_TRAIL_LOCATION_ID;
                item.holder_actor_id = 0;
            }
            _ => {}
        }
    }

    let rati = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
    assert!(runtime.resident_item_is_sought(rati, WATCH_BELL_ITEM_ID));
    let request = runtime
        .resident_request_for_holder(rati, 5000)
        .expect("Rati notices the currently visible held room item");
    assert_eq!(request.item_id, WATCH_BELL_ITEM_ID);
    assert_eq!(
        request.reason,
        "Rati could use Watch Bell with Low Doorway."
    );
    runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let economy = state
        .actors
        .iter()
        .find(|actor| actor.id == RATI_ACTOR_ID)
        .and_then(|actor| actor.resident_economy.as_ref())
        .expect("resident economy is exposed");
    assert_eq!(
        economy.motive,
        "Rati could use Watch Bell with Low Doorway from Bell Guest."
    );
}

#[test]
fn resident_refuses_to_trade_attached_items() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    assert_eq!(
        runtime
            .apply_journal_record(&JournalRecord::new(create, 7834))
            .0,
        CW_OK
    );

    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
            }
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
            }
            _ => {}
        }
    }
    runtime
        .prepare_resident_local_memories(RATI_ACTOR_ID)
        .expect("Rati observes the offered player item");
    runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

    let refusal = runtime
        .resident_trade_is_willing(
            5000,
            RATI_ACTOR_ID,
            DEWBRIGHT_BUTTON_ITEM_ID,
            STORY_BUTTON_ITEM_ID,
        )
        .expect_err("Rati protects a desired item she already holds");
    assert!(refusal.contains("attached to Story Button"));
    let command = runtime
        .resolve_command(
            &command_request(5000, "trade dewbright with rati for story"),
            &AccessContext::default(),
        )
        .expect_err("refused trade should not dispatch");
    assert_eq!(command.status, 409);
    assert!(command.output.contains("attached to Story Button"));
    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let economy = state
        .actors
        .iter()
        .find(|actor| actor.id == RATI_ACTOR_ID)
        .and_then(|actor| actor.resident_economy.as_ref())
        .expect("resident economy is exposed");
    let held_story = economy
        .held_items
        .iter()
        .find(|item| item.item_id == STORY_BUTTON_ITEM_ID)
        .expect("held item details include Story Button");
    assert_eq!(held_story.disposition, "identity");
    assert!(held_story.reason.contains("evolution track"));
    assert!(economy.attached_item_ids.contains(&STORY_BUTTON_ITEM_ID));
}

#[test]
fn wanted_gift_returns_expendable_resident_item_instead_of_disappearing() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Bell Giver");
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            WATCH_BELL_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.held_since_tick = runtime.world.tick;
            }
            DEWBRIGHT_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = SKULL_ACTOR_ID;
                item.held_since_tick = runtime.world.tick;
            }
            _ => {}
        }
    }
    runtime
        .world
        .actors
        .iter_mut()
        .find(|actor| actor.id == SKULL_ACTOR_ID)
        .expect("Skull exists")
        .stats
        .strength = 1;
    runtime
        .world
        .items
        .iter_mut()
        .find(|item| item.id == DEWBRIGHT_BUTTON_ITEM_ID)
        .expect("Dewbright exists")
        .weight_tenths = 150;
    runtime
        .prepare_resident_local_memories(SKULL_ACTOR_ID)
        .expect("Skull notices the player-held bell");
    runtime.record_economy_disclosure(5000, SKULL_ACTOR_ID);

    let candidate = runtime
        .default_actor_gift_candidate(5000)
        .expect("Skull's full paw should not hide the wanted gift card");
    assert_eq!(candidate.target.id, SKULL_ACTOR_ID);
    assert_eq!(candidate.offered_item.id, WATCH_BELL_ITEM_ID);
    let returned = runtime
        .resident_player_gift_return_item(candidate.target, candidate.offered_item)
        .expect("Skull can hand back an expendable item");
    assert_eq!(returned.id, DEWBRIGHT_BUTTON_ITEM_ID);

    let state = runtime.state_response(Some(5000), &AccessContext::default());
    let give_offer = state
        .action_offers
        .iter()
        .find(|offer| offer.kind == "give_item")
        .expect("Give remains in the card deal");
    assert!(give_offer
        .effect
        .as_deref()
        .is_some_and(|effect| { effect.contains("hands you Dewbright Button to make room") }));

    let give = CwAction {
        kind: CW_ACTION_GIVE_ITEM,
        actor_id: 5000,
        target_actor_id: SKULL_ACTOR_ID,
        item_id: WATCH_BELL_ITEM_ID,
        target_item_id: returned.id,
        ..CwAction::default()
    };
    let (status, events) = runtime.apply_journal_record(&JournalRecord::new(give, 78345));
    assert_eq!(status, CW_OK);
    let event = events
        .iter()
        .find(|event| event.type_name == "item.given")
        .expect("wanted gift event");
    assert_eq!(event.target_item_id, Some(DEWBRIGHT_BUTTON_ITEM_ID));
    assert!(event
        .content
        .as_deref()
        .is_some_and(|content| { content.contains("handed Dewbright Button back to make room") }));
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| item.id == WATCH_BELL_ITEM_ID && item.holder_actor_id == SKULL_ACTOR_ID));
    assert!(runtime.world.items[..runtime.world.item_count]
        .iter()
        .any(|item| item.id == DEWBRIGHT_BUTTON_ITEM_ID && item.holder_actor_id == 5000));
}

#[test]
fn resident_feature_use_keeps_foreign_evolution_item_shareable() {
    let mut runtime = RuntimeWorld::seeded();
    let mut create = CwAction::default();
    create.kind = CW_ACTION_CREATE_ACTOR;
    create.actor_id = 5000;
    create.location_id = COSY_COTTAGE_LOCATION_ID;
    assert_eq!(
        runtime
            .apply_journal_record(&JournalRecord::new(create, 7835))
            .0,
        CW_OK
    );

    runtime.world.tick = 2;
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        match item.id {
            WATCH_BELL_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = RATI_ACTOR_ID;
                item.held_since_tick = runtime.world.tick;
            }
            STORY_BUTTON_ITEM_ID => {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.held_since_tick = runtime.world.tick;
            }
            _ => {}
        }
    }

    let rati = runtime
        .prepare_resident_local_memories(RATI_ACTOR_ID)
        .expect("Rati observes the offered player item");
    assert!(!runtime.resident_item_is_attached(
        RATI_ACTOR_ID,
        runtime
            .item_by_id(WATCH_BELL_ITEM_ID)
            .expect("Watch Bell exists")
    ));
    let initial_trade = runtime.resident_trade_is_willing(
        5000,
        RATI_ACTOR_ID,
        STORY_BUTTON_ITEM_ID,
        WATCH_BELL_ITEM_ID,
    );
    assert!(initial_trade.is_ok(), "{initial_trade:?}");

    let mut use_action = CwAction::default();
    use_action.kind = CW_ACTION_NONE;
    use_action.actor_id = RATI_ACTOR_ID;
    let mut record = JournalRecord::new(use_action, 7836);
    record
        .projection_mutations
        .push(ProjectionMutation::UseFeature {
            item_id: WATCH_BELL_ITEM_ID,
            location_id: COSY_COTTAGE_LOCATION_ID,
            feature_key: LOW_DOORWAY_FEATURE_KEY.to_string(),
            content: "The Watch Bell gave the doorway a remembered chime.".to_string(),
            reason: "resident_feature_use".to_string(),
        });
    let (status, events) = runtime.apply_journal_record(&record);
    assert_eq!(status, CW_OK);
    let feature_use_event = events
        .iter()
        .find(|event| {
            event.type_name == "item.used"
                && event.actor_id == Some(RATI_ACTOR_ID)
                && event.item_id == Some(WATCH_BELL_ITEM_ID)
        })
        .expect("feature-use item event");
    assert_eq!(
        feature_use_event.content.as_deref(),
        Some("The Watch Bell gave the doorway a remembered chime.")
    );
    assert!(!feature_use_event
        .content
        .as_deref()
        .unwrap_or_default()
        .contains("resident_feature_use"));
    assert!(events.iter().any(|event| {
        event.type_name == "item.used"
            && event.actor_id == Some(RATI_ACTOR_ID)
            && event.item_id == Some(WATCH_BELL_ITEM_ID)
    }));

    let watch_bell = runtime
        .item_by_id(WATCH_BELL_ITEM_ID)
        .expect("Watch Bell exists");
    assert!(!runtime.resident_item_is_attached(RATI_ACTOR_ID, watch_bell));
    let held_watch = runtime.resident_held_item_view(rati, watch_bell, None);
    assert_eq!(held_watch.disposition, "tradeable");
    assert!(held_watch.reason.contains("may trade Watch Bell"));
    runtime.world.tick = 20;
    let watch_bell = runtime
        .item_by_id(WATCH_BELL_ITEM_ID)
        .expect("Watch Bell still exists");
    assert!(
        !runtime.resident_item_is_attached(RATI_ACTOR_ID, watch_bell),
        "time alone must not turn another resident's evolution item into a keepsake"
    );
    let trade = runtime.resident_trade_is_willing(
        5000,
        RATI_ACTOR_ID,
        STORY_BUTTON_ITEM_ID,
        WATCH_BELL_ITEM_ID,
    );
    assert!(
        trade.is_ok(),
        "Skull's evolution item should remain shareable: {trade:?}"
    );
}

#[test]
fn resident_feature_use_can_turn_ordinary_item_into_keepsake() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.world.tick = 2;
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == THREADBARE_MAP_SCRAP_ITEM_ID {
            item.location_id = 0;
            item.holder_actor_id = RATI_ACTOR_ID;
            item.held_since_tick = runtime.world.tick;
        }
    }

    let mut use_action = CwAction::default();
    use_action.kind = CW_ACTION_NONE;
    use_action.actor_id = RATI_ACTOR_ID;
    let mut record = JournalRecord::new(use_action, 7837);
    record
        .projection_mutations
        .push(ProjectionMutation::UseFeature {
            item_id: THREADBARE_MAP_SCRAP_ITEM_ID,
            location_id: COSY_COTTAGE_LOCATION_ID,
            feature_key: LOW_DOORWAY_FEATURE_KEY.to_string(),
            content: "Rati checks the little map against the low doorway.".to_string(),
            reason: "resident_feature_use".to_string(),
        });
    let (status, _) = runtime.apply_journal_record(&record);
    assert_eq!(status, CW_OK);

    let rati = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
    let map = runtime
        .item_by_id(THREADBARE_MAP_SCRAP_ITEM_ID)
        .expect("Threadbare Map Scrap exists");
    assert!(runtime.resident_item_is_attached(RATI_ACTOR_ID, map));
    let held_map = runtime.resident_held_item_view(rati, map, None);
    assert_eq!(held_map.disposition, "attached");
    assert!(held_map.reason.contains("mattered in a room moment"));
}

#[test]
fn non_track_resident_uses_attached_item_with_room_feature() {
    let mut runtime = RuntimeWorld::seeded();
    runtime.world.tick = 0;
    runtime.beliefs.clear();
    for item in &mut runtime.world.items[..runtime.world.item_count] {
        if item.id == STORY_BUTTON_ITEM_ID {
            item.location_id = 40;
            item.holder_actor_id = 0;
            item.held_since_tick = 0;
        }
    }

    assert_eq!(evolution_track_item_ids(OLD_OAK_TREE_ACTOR_ID), None);
    let old_oak = runtime
        .prepare_resident_local_memories(OLD_OAK_TREE_ACTOR_ID)
        .expect("Old Oak observes the local room item");
    assert!(runtime
        .resident_sought_item_ids(old_oak)
        .contains(&STORY_BUTTON_ITEM_ID));
    let sought = runtime.resident_sought_item_view(old_oak, STORY_BUTTON_ITEM_ID);
    assert_eq!(sought.source, "attachment");
    assert!(sought.reason.contains("wants Story Button back"));
    assert!(sought.reason.contains("Hollow"));
    let memory = runtime
        .resident_best_item_memory(OLD_OAK_TREE_ACTOR_ID, STORY_BUTTON_ITEM_ID)
        .expect("Old Oak carries a memory of the local item");
    assert_eq!(memory.location_id, 40);
    assert_eq!(memory.source_actor_id, Some(OLD_OAK_TREE_ACTOR_ID));

    let pickup = runtime
        .resident_economy_autonomy_action(old_oak)
        .expect("Old Oak acts on the remembered room item");
    assert_eq!(pickup.kind, CW_ACTION_PICK_UP_ITEM);
    assert_eq!(pickup.actor_id, OLD_OAK_TREE_ACTOR_ID);
    assert_eq!(pickup.item_id, STORY_BUTTON_ITEM_ID);
    let (status, events) = runtime.apply_journal_record(&JournalRecord::new(pickup, 7837));
    assert_eq!(status, CW_OK);
    assert!(events.iter().any(|event| {
        event.type_name == "item.picked_up"
            && event.actor_id == Some(OLD_OAK_TREE_ACTOR_ID)
            && event.item_id == Some(STORY_BUTTON_ITEM_ID)
    }));
    let pickup_event = events
        .iter()
        .find(|event| {
            event.type_name == "item.picked_up"
                && event.actor_id == Some(OLD_OAK_TREE_ACTOR_ID)
                && event.item_id == Some(STORY_BUTTON_ITEM_ID)
        })
        .expect("Old Oak pickup event");
    assert!(pickup_event
        .content
        .as_deref()
        .is_some_and(
            |content| content.contains("wants Story Button back") && content.contains("Hollow")
        ));

    let old_oak = runtime
        .actor_by_id(OLD_OAK_TREE_ACTOR_ID)
        .expect("Old Oak remains present");
    let record = runtime
        .resident_economy_autonomy_record(old_oak, 7838)
        .expect("Old Oak can use the held room item");
    assert_eq!(record.action.kind, CW_ACTION_NONE);
    assert_eq!(record.action.actor_id, OLD_OAK_TREE_ACTOR_ID);
    match record.projection_mutations.as_slice() {
        [ProjectionMutation::UseFeature {
            item_id,
            location_id,
            feature_key,
            reason,
            ..
        }, ProjectionMutation::UpdateResidentContinuity {
            resident_id,
            reason: continuity_reason,
            ..
        }] => {
            assert_eq!(*item_id, STORY_BUTTON_ITEM_ID);
            assert_eq!(*location_id, 40);
            assert_eq!(feature_key, "hollow_voice");
            assert_eq!(reason, "resident_feature_use");
            assert_eq!(*resident_id, OLD_OAK_TREE_ACTOR_ID);
            assert_eq!(continuity_reason, "resident_autonomy_intent");
        }
        other => panic!("expected Old Oak room feature use, got {other:?}"),
    }

    let (status, events) = runtime.apply_journal_record(&record);
    assert_eq!(status, CW_OK);
    assert!(events.iter().any(|event| {
        event.type_name == "item.used"
            && event.actor_id == Some(OLD_OAK_TREE_ACTOR_ID)
            && event.item_id == Some(STORY_BUTTON_ITEM_ID)
            && event.location_id == Some(40)
    }));
    assert!(runtime.feature_use_claimed(
        OLD_OAK_TREE_ACTOR_ID,
        40,
        "hollow_voice",
        STORY_BUTTON_ITEM_ID,
    ));
    let story_button = runtime
        .item_by_id(STORY_BUTTON_ITEM_ID)
        .expect("Story Button exists");
    assert!(runtime.resident_item_is_attached(OLD_OAK_TREE_ACTOR_ID, story_button));
    let old_oak = runtime
        .actor_by_id(OLD_OAK_TREE_ACTOR_ID)
        .expect("Old Oak remains present");
    let held_story = runtime.resident_held_item_view(old_oak, story_button, None);
    assert_eq!(held_story.disposition, "attached");
    assert!(held_story.reason.contains("protects Story Button"));
    assert!(held_story.reason.contains("Hollow"));
}
