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
    assert!(!before.game["packs"].as_object().unwrap().is_empty());
    assert_eq!(before.claimed, [1; 8]);
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
}
fn home_action(w: &World, actor: usize, kind: &str) -> Value {
    w.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == kind)
        .unwrap()
        .clone()
}
#[test]
fn home_item_pickup_and_drop_control_authoritative_travel_and_replay() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 1);
    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.game["items"]["mask"]["holder"], "theatre");
    assert!(!w.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
    let take = home_action(&w, 1, "take");
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"mara","action":take}),
        now(),
    )
    .unwrap();
    let travel = home_action(&w, 1, "move");
    assert_eq!(travel["target"], "pond");
    let put_down = home_action(&w, 1, "drop");
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"mara","action":put_down}),
        now(),
    )
    .unwrap();
    let before = w.clone();
    assert!(w
        .apply(&json!({"op":"play","actor":"mara","action":travel}))
        .is_err());
    assert_eq!(w, before);
    assert!(full::run(&c, &id, "user1", &body("upgrade", None), now()).is_err());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    let replayed = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(replayed, before);
    assert!(!replayed.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
}
#[test]
fn earlier_home_travel_replays_before_one_recorded_rules_upgrade() {
    let path = std::env::temp_dir().join(format!(
        "home-rules-upgrade-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let result = engine::reduce_version(engine::PREVIOUS_VERSION, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: engine::PREVIOUS_VERSION.into(),
        game: result["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
    };
    full_store::seed(&c, &id, &old, "previous-rules", now()).unwrap();
    for a in [1, 2] {
        for op in ["claim", "enter"] {
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":op,"actor":actor_id(a)}),
                now(),
            )
            .unwrap();
        }
        let action = home_action(&old, a, "drop");
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"play","actor":actor_id(a),"action":action}),
            now(),
        )
        .unwrap();
    }
    // Version 2 accepted this trip after Ash left the item on the home floor.
    let action = home_action(&old, 2, "move");
    full_store::commit(
        &c,
        &id,
        &mut old,
        json!({"op":"play","actor":"ash","action":action}),
        now(),
    )
    .unwrap();
    assert_eq!(old.game["actors"]["ash"]["place"], "pond");
    assert!(old.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["turn"], old.game["turn"]);
    assert_eq!(
        upgraded.game["revision"].as_u64(),
        old.game["revision"].as_u64().map(|n| n + 1)
    );
    assert_eq!(upgraded.game["actors"], old.game["actors"]);
    assert_eq!(upgraded.game["log"], old.game["log"]);
    assert_eq!(upgraded.game["items"]["mask"], old.game["items"]["mask"]);
    assert_eq!(upgraded.claimed, old.claimed);
    assert_eq!(upgraded.present, old.present);
    assert!(!upgraded.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
    let nell_item = cast()["avatars"][3]["item"]["id"].as_str().unwrap();
    let nell_home = cast()["avatars"][3]["home"]["id"].as_str().unwrap();
    assert_eq!(upgraded.game["items"][nell_item]["holder"], nell_home);
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    let upgrades: i64 = c.query_row(
        "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade'",
        [&id], |r| r.get(0),
    ).unwrap();
    assert_eq!(upgrades, 1);
}
#[test]
fn full_world_bard_visit_and_song_replay_from_the_journal() {
    let path = std::env::temp_dir().join(format!("bard-world-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut w = World::create(None).unwrap();
    // Set the Theban scene, then use real choices through the C interpreter.
    w.game.as_object_mut().unwrap().remove("opening");
    w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    w.game["actors"]["vale"]["place"] = json!("greek-courtyard");
    w.game["items"]["greek-water-jar"]["holder"] = json!("vale");
    full_store::seed(&c, &id, &w, "bard-test", now()).unwrap();
    for op in ["claim", "enter"] {
        full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
    }
    for (field, value) in [
        ("choiceId", "greek-return-water-jar"),
        ("kind", "wait"),
        ("target", "greek-well"),
        ("target", "greek-rhapsode"),
    ] {
        let view = w.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a[field] == value && (value != "greek-rhapsode" || a["kind"] == "talk"))
            .unwrap()
            .clone();
        let result = full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        if value == "wait" {
            assert_eq!(
                w.game["actors"]["greek-rhapsode"]["place"],
                "greek-argolid-road"
            );
        }
        if value == "greek-rhapsode" {
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "greek-well");
            let facts = result["context"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == "greek-rhapsode")
                .unwrap()["facts"]
                .to_string();
            assert!(facts.contains("I set the water by her hands."));
            assert!(facts.contains("She kept a loaf of bread for me."));
        }
    }
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
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
    let memory = json!({"play":"old-shared-scene","actor":0,"room":0,"turn":1,"action":"Vale waits.","lines":[{"speaker":"Vale","text":"I remember the light on the water."},{"speaker":"Pond","text":"The reeds move softly."}],"starts_at":1234,"until_at":8234,"error":null});
    c.execute(
        "INSERT INTO card_scenes(world,room,play,content) VALUES(?,0,'old-shared-scene',?)",
        params![id, memory.to_string()],
    )
    .unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.claimed[0], 1);
    assert_eq!(w.game["items"]["lamp"]["holder"], "vale");
    assert!(w.game["actors"]["moth"].is_object());
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let preserved: String = c
        .query_row(
            "SELECT content FROM card_full_scenes WHERE world=? AND play='old-shared-scene'",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    let preserved: Value = serde_json::from_str(&preserved).unwrap();
    assert_eq!(preserved["room"], "pond");
    assert_eq!(preserved["starts_at"], 1234);
    assert_eq!(preserved["until_at"], 8234);
    assert_eq!(preserved["lines"][0]["text"], memory["lines"][0]["text"]);
    assert!(w.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .any(|line| line["text"] == memory["lines"][0]["text"]
            && line["seq"] == preserved["lines"][0]["seq"]));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let scenes: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_scenes WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(scenes, 1);
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
    let stale_attempt = work.clone();
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
    full::finish_work(
        &app,
        &id,
        stale_attempt,
        Err("An earlier attempt finished late.".into()),
    )
    .unwrap();
    let status: String = c
        .query_row(
            "SELECT status FROM card_full_plays WHERE id=?",
            [&retry.key],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "working");
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

#[test]
fn cached_views_follow_actor_claim_presence_and_committed_turn_changes() {
    let mut w = World::create(None).unwrap();
    w.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    let first = w.project(0).unwrap();
    assert_eq!(w.project(0).unwrap(), first);
    w.apply(&json!({"op":"claim","actor":"mara"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"mara"})).unwrap();
    let claimed = w.project(0).unwrap();
    assert!(claimed["world"]["controlledActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
    assert!(claimed["world"]["presentActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
    assert_eq!(w.project(1).unwrap()["world"]["playerActorId"], "mara");
    assert_eq!(w.project(0).unwrap()["world"]["playerActorId"], "vale");
    w.apply(&json!({"op":"leave","actor":"mara"})).unwrap();
    let absent = w.project(0).unwrap();
    assert!(!absent["world"]["presentActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
    let action = absent["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    w.apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    let after = w.project(0).unwrap();
    assert_eq!(
        after["world"]["turn"].as_u64().unwrap(),
        first["world"]["turn"].as_u64().unwrap() + 1
    );
    assert_eq!(w.project(0).unwrap(), after);
    w.apply(&json!({"op":"release","actor":"mara"})).unwrap();
    assert!(!w.project(0).unwrap()["world"]["controlledActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
}

#[test]
fn unchanged_snapshots_leave_the_checkpoint_and_journal_untouched() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let before: i64 = c
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    let first = full_store::snapshot(&c, &id, "user0", 1234).unwrap();
    let second = full_store::snapshot(&c, &id, "user0", 2234).unwrap();
    let after: i64 = c
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(first["world"], second["world"]);
    assert_eq!(second["now"], 2234);
    assert_eq!(first["now"], 1234);
    let mut play = body("play", None);
    play.key = "fresh-queue-cached-view".into();
    play.action = first["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    full::run(&c, &id, "user0", &play, now()).unwrap();
    let queued = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    assert_eq!(queued["world"], first["world"]);
    assert_eq!(first["queue"].as_array().unwrap().len(), 0);
    assert_eq!(queued["queue"].as_array().unwrap().len(), 1);
}
