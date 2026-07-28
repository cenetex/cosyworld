use super::*;

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
