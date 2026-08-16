use super::*;

fn roaming_actor(ambient_autonomy: Option<bool>, roaming: Option<bool>) -> SeedActorContent {
    SeedActorContent {
        pack_id: "test.roaming".to_string(),
        id: 900_001,
        name: "Test Wanderer".to_string(),
        speech_mode: "prose".to_string(),
        title: "Route Tester".to_string(),
        description: "A resident used to exercise roaming policy.".to_string(),
        identity: None,
        level_track_id: None,
        voice: String::new(),
        control_mode: None,
        ambient_autonomy,
        roaming,
        location_id: Some(COSY_COTTAGE_LOCATION_ID),
        stats: None,
        goals: Vec::new(),
        desires: Vec::new(),
        attachments: Vec::new(),
        relationship: None,
    }
}

#[test]
fn authored_control_mode_overrides_the_autonomy_default() {
    let mut actor = roaming_actor(Some(true), Some(true));
    actor.control_mode = Some(ActorControlMode::DirectInput);
    assert_eq!(
        actor.authored_default_control_mode(),
        ActorControlMode::DirectInput
    );

    actor.control_mode = None;
    assert_eq!(
        actor.authored_default_control_mode(),
        ActorControlMode::LocalAi
    );
}

#[test]
fn authored_roaming_requires_ambient_autonomy_and_an_explicit_opt_in() {
    assert!(movement::seed_actor_roaming_enabled(&roaming_actor(
        Some(true),
        Some(true)
    )));
    assert!(movement::seed_actor_roaming_enabled(&roaming_actor(
        None,
        Some(true)
    )));
    assert!(!movement::seed_actor_roaming_enabled(&roaming_actor(
        Some(false),
        Some(true)
    )));
    assert!(!movement::seed_actor_roaming_enabled(&roaming_actor(
        Some(true),
        None
    )));
    assert!(!movement::seed_actor_roaming_enabled(&roaming_actor(
        None, None
    )));
}

#[test]
fn autonomous_result_dedup_uses_event_causality_after_a_tick_restore() {
    let mut runtime = RuntimeWorld::seeded();
    let source_world_tick = runtime.world.tick;
    let caused_by_event_seq = runtime.world.next_event_seq.saturating_add(10);
    let observation = PlayerTickObservation {
        source_actor_id: 5000,
        source_world_tick,
        caused_by_event_seq: Some(caused_by_event_seq),
        observed_through_seq: caused_by_event_seq,
        source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
        allow_ordinary_speech: true,
        source_events: Vec::new(),
        ripple_source: None,
        relationship_reply: None,
    };
    let autonomy = runtime
        .actor_autonomy
        .get_mut(&RATI_ACTOR_ID)
        .expect("Rati has resident autonomy");
    autonomy.attention_credits = 1;
    autonomy.last_acted_tick = source_world_tick.saturating_add(50);

    assert!(
        !runtime.player_tick_already_has_autonomous_result(&observation),
        "a future historical tick watermark must not suppress a fresh observation"
    );
    assert!(
        runtime.autonomy_allows_action(RATI_ACTOR_ID, CW_ACTION_SAY),
        "a future historical tick watermark must not reject the fresh action"
    );

    runtime.event_log.push(EventView {
        success: true,
        type_name: "message.created".to_string(),
        source_world_tick: Some(source_world_tick),
        caused_by_event_seq: Some(caused_by_event_seq.saturating_sub(1)),
        ..EventView::default()
    });
    assert!(
        !runtime.player_tick_already_has_autonomous_result(&observation),
        "another result from the same restored tick is not the same observation"
    );

    runtime.event_log.push(EventView {
        success: true,
        type_name: "message.created".to_string(),
        source_world_tick: Some(source_world_tick),
        caused_by_event_seq: Some(caused_by_event_seq),
        ..EventView::default()
    });
    assert!(
        runtime.player_tick_already_has_autonomous_result(&observation),
        "the exact committed result must still make a reclaimed job a no-op"
    );
}
