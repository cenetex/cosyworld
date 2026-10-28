use super::*;

fn state(now: i64, revision: i64) -> Value {
    json!({"actor":"vale","now":now,"world":{"revision":revision,"items":{"lamp":"vale"}},"history":[],"queue":[],"notice":null})
}
fn cursor(value: &Value) -> String {
    let h = &value["sync"]["head"];
    format!(
        "{}:{}:{}",
        h["stream"].as_str().unwrap(),
        h["sequence"],
        h["hash"].as_str().unwrap()
    )
}
fn send(c: &Connection, value: Value, from: &str) -> Value {
    response(c, "world", "user", value, Some(from)).unwrap()
}
#[test]
fn idle_sync_sends_only_the_clock_and_cursor() {
    let c = Connection::open_in_memory().unwrap();
    let first = send(&c, state(1, 1), "snapshot");
    let next = send(&c, state(2, 1), &cursor(&first));
    assert_eq!(next["events"], json!([]));
    assert_eq!(next["now"], 2);
    assert_eq!(next["sync"]["head"], first["sync"]["head"]);
    assert!(next.get("state").is_none());
    assert!(next.get("history").is_none());
}
#[test]
fn missed_events_form_a_verified_chain_and_survive_reopen() {
    let path = std::env::temp_dir().join(format!("card-sync-{}.sqlite", crate::random_hex(12)));
    let c = Connection::open(&path).unwrap();
    let first = send(&c, state(1, 1), "snapshot");
    let second = send(&c, state(2, 2), &cursor(&first));
    let third = send(&c, state(3, 3), &cursor(&second));
    drop(c);
    let c = Connection::open(&path).unwrap();
    let catchup = send(&c, state(4, 3), &cursor(&first));
    assert_eq!(catchup["events"].as_array().unwrap().len(), 2);
    assert_eq!(catchup["sync"]["head"], third["sync"]["head"]);
    let stream = first["sync"]["head"]["stream"].as_str().unwrap();
    let mut previous = first["sync"]["head"]["hash"].as_str().unwrap().to_string();
    for event in catchup["events"].as_array().unwrap() {
        assert_eq!(event["previous"], previous);
        previous = hash(
            stream,
            event["sequence"].as_u64().unwrap(),
            &previous,
            event["payload"].as_str().unwrap(),
        );
        assert_eq!(event["hash"], previous);
    }
    drop(c);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn bounded_history_keeps_earlier_scenes_out_of_the_payload() {
    let c = Connection::open_in_memory().unwrap();
    let mut old = state(1, 1);
    old["history"] = json!((1..=40)
        .map(|i| json!({"play":format!("old-{i}"),"lines":["A quiet room.".repeat(100)]}))
        .collect::<Vec<_>>());
    let first = send(&c, old.clone(), "snapshot");
    let mut new = old;
    let list = new["history"].as_array_mut().unwrap();
    list.pop();
    list.insert(0, json!({"play":"new","lines":["New words."]}));
    new["now"] = json!(2);
    let delta = send(&c, new.clone(), &cursor(&first));
    let payload = delta["events"][0]["payload"].as_str().unwrap();
    assert!(payload.contains("New words."));
    assert!(!payload.contains("A quiet room."));
    assert!(delta.to_string().len() * 10 < new.to_string().len());
}
#[test]
fn old_or_wrong_cursors_get_a_snapshot_and_retention_stays_bounded() {
    let c = Connection::open_in_memory().unwrap();
    let first = send(&c, state(1, 1), "snapshot");
    let mut next = first.clone();
    for i in 2..=70 {
        next = send(&c, state(i, i), &cursor(&next));
    }
    let fresh = send(&c, state(71, 70), &cursor(&first));
    assert_eq!(fresh["sync"]["kind"], "snapshot");
    assert_eq!(fresh["state"]["world"]["revision"], 70);
    let wrong = send(
        &c,
        state(72, 70),
        &format!(
            "{}:70:{}",
            fresh["sync"]["head"]["stream"].as_str().unwrap(),
            "0".repeat(64)
        ),
    );
    assert_eq!(wrong["sync"]["kind"], "snapshot");
    let saved: String = c
        .query_row("SELECT chain FROM card_full_sync", [], |r| r.get(0))
        .unwrap();
    let chain: Chain = serde_json::from_str(&saved).unwrap();
    assert_eq!(chain.events.len(), EVENT_LIMIT);
    let mut huge = state(73, 71);
    huge["notice"] = json!("a".repeat(BYTE_LIMIT + 1));
    let fresh = send(&c, huge, &cursor(&fresh));
    assert_eq!(fresh["sync"]["kind"], "snapshot");
    let saved: String = c
        .query_row("SELECT chain FROM card_full_sync", [], |r| r.get(0))
        .unwrap();
    let chain: Chain = serde_json::from_str(&saved).unwrap();
    assert!(chain.events.is_empty());
}
#[test]
fn player_streams_and_legacy_views_keep_their_scope() {
    let c = Connection::open_in_memory().unwrap();
    let first = send(&c, state(1, 1), "snapshot");
    let other = response(&c, "world", "other", state(2, 1), Some(&cursor(&first))).unwrap();
    assert_eq!(other["sync"]["kind"], "snapshot");
    assert_ne!(
        other["sync"]["head"]["stream"],
        first["sync"]["head"]["stream"]
    );
    let mut changed_actor = state(3, 1);
    changed_actor["actor"] = json!("mara");
    let changed = send(&c, changed_actor, &cursor(&first));
    assert_ne!(
        changed["sync"]["head"]["stream"],
        first["sync"]["head"]["stream"]
    );
    assert_eq!(
        response(&c, "world", "user", state(4, 1), None).unwrap(),
        state(4, 1)
    );
    let unclaimed = json!({"actor":null,"now":5});
    assert_eq!(send(&c, unclaimed.clone(), "snapshot"), unclaimed);
}

#[test]
fn a_damaged_derived_cache_starts_a_fresh_stream() {
    let c = Connection::open_in_memory().unwrap();
    let first = send(&c, state(1, 1), "snapshot");
    c.execute("UPDATE card_full_sync SET chain='broken'", [])
        .unwrap();
    let fresh = send(&c, state(2, 1), &cursor(&first));
    assert_eq!(fresh["sync"]["kind"], "snapshot");
    assert_ne!(
        fresh["sync"]["head"]["stream"],
        first["sync"]["head"]["stream"]
    );
}

#[test]
fn a_rules_upgrade_replaces_retained_events_with_the_current_private_view() {
    let c = Connection::open_in_memory().unwrap();
    let mut old = state(1, 1);
    old["version"] = json!("full-card-world/12");
    old["world"]["memories"] = json!({"moth":{"innerLife":{"persona":"Earlier private thought."}}});
    let first = send(&c, old.clone(), "snapshot");
    old["world"]["memories"]["moth"]["innerLife"]["persona"] = json!("Unseen private thought.");
    let unseen = send(&c, old, &cursor(&first));
    assert!(unseen.to_string().contains("Unseen private thought."));
    let mut current = state(3, 3);
    current["version"] = json!("full-card-world/13");
    current["world"]["memories"] = json!({"moth":{"text":"A public character line."}});
    let fresh = send(&c, current, &cursor(&first));
    assert_eq!(fresh["sync"]["kind"], "snapshot");
    assert_ne!(
        fresh["sync"]["head"]["stream"],
        first["sync"]["head"]["stream"]
    );
    assert!(!fresh.to_string().contains("private thought"));
    let saved: String = c
        .query_row("SELECT chain FROM card_full_sync", [], |r| r.get(0))
        .unwrap();
    let chain: Chain = serde_json::from_str(&saved).unwrap();
    assert!(chain.events.is_empty());
    assert!(!saved.contains("private thought"));
}
