use super::{
    engine, full, full_store,
    full_world::{actor_id, World},
    store, *,
};
use serde_json::json;
fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path =
        std::env::temp_dir().join(format!("full-card-world-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let world = World::create(None).unwrap();
    full_store::seed(&c, &id, &world, "test-create", now()).unwrap();
    (path, c, id)
}
fn body(op: &str, avatar: Option<&str>) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: avatar.map(str::to_string),
        action: Value::Null,
        target: None,
        key: String::new(),
    }
}
fn claim(c: &mut rusqlite::Connection, id: &str, a: usize) {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(
        &tx,
        id,
        &format!("user{a}"),
        &body("claim", Some(actor_id(a))),
        now(),
    )
    .unwrap();
    tx.commit().unwrap();
}
#[test]
fn full_world_has_existing_residents_and_packs_and_replays_from_seed() {
    let (path, mut c, id) = fixture();
    for a in 0..8 {
        claim(&mut c, &id, a);
    }
    let before = full_store::world(&c, &id, now()).unwrap();
    assert!(before.game["actors"]["moth"].is_object());
    assert!(before.game["actors"]["keeper"].is_object());
    assert!(before.game["packs"].as_object().unwrap().len() > 0);
    assert_eq!(before.claimed, [1; 8]);
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
}
#[test]
fn full_world_c_guard_counts_humans_in_arbitrary_existing_rooms() {
    let mut w = World::create(None).unwrap();
    for a in 0..8 {
        w.apply(&json!({"op":"claim","actor":actor_id(a)})).unwrap();
    }
    // This fixture isolates the C presence guard from authored travel rules.
    for a in 0..8 {
        w.game["actors"][actor_id(a)]["place"] = json!("station");
    }
    for a in 0..4 {
        w.apply(&json!({"op":"enter","actor":actor_id(a)})).unwrap();
    }
    let before = w.clone();
    assert!(w.apply(&json!({"op":"enter","actor":actor_id(4)})).is_err());
    assert_eq!(w, before);
    w.apply(&json!({"op":"leave","actor":actor_id(0)})).unwrap();
    w.apply(&json!({"op":"enter","actor":actor_id(4)})).unwrap();
}
#[test]
fn full_world_claims_queue_authority_and_request_ids() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let mut b = body("play", None);
    b.key = "full-world-action-0001".into();
    let w = full_store::world(&c, &id, now()).unwrap();
    let view = w.project(0).unwrap();
    b.action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    let count: i32 = tx
        .query_row("SELECT count(*) FROM card_full_plays", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
    b.key = "full-world-action-0002".into();
    b.action["actor"] = json!("mara");
    assert!(full::run(&tx, &id, "user0", &b, now()).is_err());
    assert!(full::run(&tx, &id, "user0", &body("claim", Some("mara")), now()).is_err());
    tx.commit().unwrap();
}
#[test]
fn full_world_npc_turn_and_speech_survive_worker_restart() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let view = w.project(0).unwrap();
    let mut b = body("play", None);
    b.key = "worker-recovery-0001".into();
    b.action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    tx.commit().unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    let before = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(
        before.game["turn"].as_u64().unwrap(),
        w.game["turn"].as_u64().unwrap() + 1
    );
    assert!(work.context["context"].is_object());
    assert!(full::take_work(&app, &id).unwrap().is_none());
    c.execute("UPDATE card_full_plays SET until_at=0", [])
        .unwrap();
    let mut recovered = before.clone();
    full_store::expire(&c, &id, &mut recovered, now()).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap().game, before.game);
    assert!(full::take_work(&app, &id).unwrap().is_none());
    let view = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    assert!(view["history"][0]["error"].is_string());
    assert!(view["history"][0].get("context").is_none());
}
#[test]
fn legacy_invitation_migrates_claims_and_items_once() {
    let path = std::env::temp_dir().join(format!("card-migrate-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut old = kernel::World::new();
    for kind in [1, 3] {
        store::commit(
            &c,
            &id,
            &mut old,
            kernel::Action {
                kind,
                actor: 0,
                item: -1,
                target: -1,
            },
            now(),
        )
        .unwrap();
    }
    c.execute(
        "INSERT INTO card_members(world,actor,user,seen) VALUES(?,0,'owner',?)",
        params![id, now()],
    )
    .unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.claimed[0], 1);
    assert_eq!(w.game["items"]["lamp"]["holder"], "vale");
    assert!(w.game["actors"]["moth"].is_object());
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let count: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn imported_save_cannot_supply_server_claims_or_authority() {
    let result = engine::reduce(
        json!({"op":"create","save":"{\"claimed\":[1,1,1,1,1,1,1,1],\"present\":[1]}"}),
    );
    assert!(result.is_err());
}

#[test]
fn full_world_shared_speech_is_journaled_with_matching_log_sequences() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let mut b = body("play", None);
    b.key = "shared-speech-0001".into();
    b.action = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    tx.commit().unwrap();
    let state = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&state, &id).unwrap().unwrap();
    let lines = json!([{"speaker":"Vale","actorId":"vale","entityId":"vale","text":"I could stay a little longer."},{"speaker":"Empty station","actorId":null,"entityId":work.room,"text":"A moth circles the glass."}]);
    full::finish_work(&state, &id, work, Ok(lines)).unwrap();
    let expected = full_store::world(&c, &id, now()).unwrap();
    let snap = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    let lines = snap["history"][0]["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    for line in lines {
        assert!(expected.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["seq"] == line["seq"] && e["text"] == line["text"]));
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}

#[test]
fn shared_speech_retry_reuses_committed_play_without_another_turn() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let mut b = body("play", None);
    b.key = "speech-retry-000001".into();
    b.action = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    tx.commit().unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    full::finish_work(
        &app,
        &id,
        work,
        Err("The story service is warming up.".into()),
    )
    .unwrap();
    let committed = full_store::world(&c, &id, now()).unwrap();
    let mut retry = body("retry", None);
    retry.key = b.key;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &retry, now()).unwrap();
    tx.commit().unwrap();
    let work = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(
        full_store::world(&c, &id, now()).unwrap().game,
        committed.game
    );
    let lines = json!([{"speaker":"Vale","actorId":"vale","entityId":"vale","text":"The quiet suits me."},{"speaker":"Empty station","actorId":null,"entityId":work.room,"text":"A moth circles the glass."}]);
    full::finish_work(&app, &id, work, Ok(lines)).unwrap();
    let after = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(after.game["turn"], committed.game["turn"]);
    assert_eq!(after.game["items"], committed.game["items"]);
    let count: i32 = c
        .query_row("SELECT count(*) FROM card_full_scenes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn existing_save_progress_and_inventory_are_preserved_on_share() {
    let mut w = World::create(None).unwrap();
    w.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    for _ in 0..3 {
        let view = w.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        w.apply(&json!({"op":"play","actor":"vale","action":action}))
            .unwrap();
    }
    let save = w.game.to_string();
    let imported = World::create(Some(&save)).unwrap();
    assert_eq!(imported.game["turn"], w.game["turn"]);
    assert_eq!(imported.game["items"], w.game["items"]);
    assert_eq!(imported.game["actors"], w.game["actors"]);
    assert_eq!(imported.claimed, [0; 8]);
    assert_eq!(imported.present, [0; 8]);
}
