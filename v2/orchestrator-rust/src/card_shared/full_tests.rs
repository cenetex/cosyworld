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
    for (actor, index, item, home, destination) in [
        ("mara", 1, "mask", "theatre", "pond"),
        ("rue", 5, "routes", "train", "station"),
    ] {
        let (_path, mut c, id) = fixture();
        claim(&mut c, &id, index);
        let mut w = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(w.game["items"][item]["holder"], home);
        assert!(!w.project(index).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!(destination)));
        let take = home_action(&w, index, "take");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":take}),
            now(),
        )
        .unwrap();
        let travel = home_action(&w, index, "move");
        assert_eq!(travel["target"], destination);
        let put_down = home_action(&w, index, "drop");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":put_down}),
            now(),
        )
        .unwrap();
        let before = w.clone();
        assert!(w
            .apply(&json!({"op":"play","actor":actor,"action":travel}))
            .is_err());
        assert_eq!(w, before);
        assert!(full::run(
            &c,
            &id,
            &format!("user{index}"),
            &body("upgrade", None),
            now()
        )
        .is_err());
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        let replayed = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(replayed, before);
        assert!(!replayed.project(index).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!(destination)));
        let take = home_action(&w, index, "take");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":take}),
            now(),
        )
        .unwrap();
        let travel = home_action(&w, index, "move");
        assert_eq!(travel["target"], destination);
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":travel}),
            now(),
        )
        .unwrap();
        assert_eq!(w.game["actors"][actor]["place"], destination);
        assert!(w.project(index).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!(home)));
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
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
    let result = engine::reduce_version(engine::LEGACY_VERSION, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: engine::LEGACY_VERSION.into(),
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
        ("target", "greek-courtyard"),
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
                "greek-courtyard"
            );
        }
        if value == "greek-rhapsode" {
            assert_eq!(
                w.game["actors"]["greek-rhapsode"]["place"],
                "greek-courtyard"
            );
            let bard = result["context"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == "greek-rhapsode")
                .unwrap();
            let stanza = bard["poem"]["stanzas"]
                .as_array()
                .unwrap()
                .iter()
                .find(|stanza| stanza["id"] == "greek-return-water-jar")
                .unwrap();
            assert_eq!(stanza["authorId"], "vale");
            assert_eq!(stanza["authorName"], "Vale");
            assert_eq!(
                stanza["lines"],
                json!([
                    "I set the water by her hands.",
                    "She kept a loaf of bread for me."
                ])
            );
            assert_eq!(bard["poem"]["newLines"], stanza["lines"]);
        }
    }
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}
#[test]
fn earlier_completed_quests_gain_a_pending_bard_visit_after_recorded_upgrade() {
    for version in [engine::LEGACY_VERSION, "full-card-world/3"] {
        let path =
            std::env::temp_dir().join(format!("bard-upgrade-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "e".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        let old = engine::reduce_version(version, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: version.into(),
            game: old["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        w.game["actors"]["vale"]["place"] = json!("greek-courtyard");
        w.game["items"]["greek-water-jar"]["holder"] = json!("vale");
        full_store::seed(&c, &id, &w, "earlier-song", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
        }
        let view = w.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["choiceId"] == "greek-return-water-jar")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        if version == engine::LEGACY_VERSION {
            // A previously recorded 2 -> 3 upgrade still replays as it did then.
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"upgrade","from":version,"to":"full-card-world/3"}),
                now(),
            )
            .unwrap();
        }
        let previous = w.game.clone();
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(upgraded.version, engine::VERSION);
        assert_eq!(upgraded.game["actors"], previous["actors"]);
        assert_eq!(upgraded.game["log"], previous["log"]);
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["receipts"],
            previous["packs"]["greek-drama"]["receipts"]
        );
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-return-water-jar"],
            json!({"actor":"vale","visit":null})
        );
        let view = upgraded.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "greek-well")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(
            upgraded.game["actors"]["greek-rhapsode"]["place"],
            "greek-harbor"
        );
        let action = home_action(&upgraded, 0, "wait");
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(
            upgraded.game["actors"]["greek-rhapsode"]["place"],
            "greek-courtyard"
        );
        assert_eq!(
            upgraded.game["roamingQuests"]["greek-rhapsode"]["target"]["locationId"],
            "greek-courtyard"
        );
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
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

#[test]
fn old_rule_history_upgrades_once_and_replays_with_either_checkpoint_path() {
    for version in [
        engine::LEGACY_VERSION,
        engine::PREVIOUS_VERSION,
        engine::FOURTH_VERSION,
    ] {
        for keep_checkpoint in [true, false] {
            let (_path, c, id) = fixture();
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            c.execute("DELETE FROM card_full_log", []).unwrap();
            let result = engine::reduce_version(version, json!({"op":"create"})).unwrap();
            let mut old = World {
                version: version.into(),
                game: result["world"].clone(),
                claimed: [0; 8],
                present: [0; 8],
            };
            old.game["turn"] = json!(2);
            old.game["revision"] = json!(2);
            old.game["life"]["actors"]["vale"]["experiences"] = json!([
                {"kind":"care","key":"care:lamp:oil:station","turn":1,"points":2}
            ]);
            full_store::seed(&c, &id, &old, "old-full-world", now()).unwrap();
            for a in 0..8 {
                full_store::commit(
                    &c,
                    &id,
                    &mut old,
                    json!({"op":"claim","actor":actor_id(a)}),
                    now(),
                )
                .unwrap();
            }
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"enter","actor":"vale"}),
                now(),
            )
            .unwrap();
            let wait = old.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "wait")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"play","actor":"vale","action":wait}),
                now(),
            )
            .unwrap();
            if !keep_checkpoint {
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            }
            let upgraded = full_store::world(&c, &id, now()).unwrap();
            assert_eq!(upgraded.version, engine::VERSION);
            assert_eq!(upgraded.claimed, [1; 8]);
            assert_eq!(upgraded.present, old.present);
            assert_eq!(upgraded.game["actors"], old.game["actors"]);
            assert_eq!(upgraded.game["items"], old.game["items"]);
            assert_eq!(upgraded.game["log"], old.game["log"]);
            assert_eq!(upgraded.game["life"]["version"], 2);
            assert_eq!(
                upgraded.game["life"]["actors"]["vale"]["experiences"][0],
                json!({"kind":"care","turn":1,"other":null,"item":"lamp","place":"station"})
            );
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
            let mut continued = upgraded.clone();
            let wait = continued.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|action| action["kind"] == "wait")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut continued,
                json!({"op":"play","actor":"vale","action":wait}),
                now(),
            )
            .unwrap();
            let room = continued.room(0).unwrap().to_string();
            full_store::commit(
                &c,
                &id,
                &mut continued,
                json!({"op":"speech","actor":"vale","room":room,"lines":[
                    {"actorId":"vale","text":"I have time to choose my next step."},
                    {"actorId":null,"entityId":room,"text":"A small light rests by the wall."}
                ]}),
                now(),
            )
            .unwrap();
            assert_eq!(
                continued.game["turn"].as_u64().unwrap(),
                upgraded.game["turn"].as_u64().unwrap() + 1
            );
            assert!(continued.game["life"]["actors"]["vale"]["collection"].is_object());
            assert!(continued.game["log"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["text"] == "I have time to choose my next step."));
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), continued);
            let upgrades: i64 = c
            .query_row(
                "SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'",
                [],
                |r| r.get(0),
            )
            .unwrap();
            assert_eq!(upgrades, 1);
        }
    }
}

#[test]
fn released_pickup_journal_replays_through_both_recorded_upgrades() {
    for keep_checkpoint in [true, false] {
        let (_path, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::LEGACY_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::LEGACY_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        };
        full_store::seed(&c, &id, &old, "version-two-seed", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut old, json!({"op":op,"actor":"mara"}), now()).unwrap();
        }
        let drop = home_action(&old, 1, "drop");
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"play","actor":"mara","action":drop}),
            now(),
        )
        .unwrap();
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"upgrade","from":engine::LEGACY_VERSION,"to":engine::PREVIOUS_VERSION}),
            now(),
        )
        .unwrap();
        assert_eq!(old.version, engine::PREVIOUS_VERSION);
        assert_eq!(old.game["life"]["version"], 1);
        for kind in ["take", "drop", "take", "move"] {
            let action = home_action(&old, 1, kind);
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"play","actor":"mara","action":action}),
                now(),
            )
            .unwrap();
            if kind == "drop" {
                assert!(!old.project(1).unwrap()["exits"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("pond")));
            }
        }
        assert_eq!(old.game["actors"]["mara"]["place"], "pond");
        assert_eq!(old.game["items"]["mask"]["holder"], "mara");
        let speech = |text: &str| {
            json!({"op":"speech","actor":"mara","room":"pond","lines":[
                {"actorId":"mara","text":text},
                {"actorId":null,"entityId":"pond","text":"The water is still."}
            ]})
        };
        full_store::commit(
            &c,
            &id,
            &mut old,
            speech("I carried the mask to the shore."),
            now(),
        )
        .unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(upgraded.version, engine::VERSION);
        assert_eq!(upgraded.game["actors"], old.game["actors"]);
        assert_eq!(upgraded.game["items"], old.game["items"]);
        assert_eq!(upgraded.game["log"], old.game["log"]);
        assert_eq!(upgraded.claimed, old.claimed);
        assert_eq!(upgraded.present, old.present);
        assert_eq!(
            upgraded.game["revision"].as_u64().unwrap(),
            old.game["revision"].as_u64().unwrap() + 1
        );
        let talk = home_action(&upgraded, 1, "talk");
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"mara","action":talk}),
            now(),
        )
        .unwrap();
        let pursue = home_action(&upgraded, 1, "pursue");
        let quest_key = pursue["questKey"].clone();
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"mara","action":pursue}),
            now(),
        )
        .unwrap();
        assert_eq!(
            upgraded.game["life"]["actors"]["mara"]["collection"]["active"],
            quest_key
        );
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            speech("I have chosen my next quest."),
            now(),
        )
        .unwrap();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
        let upgrades: i64 = c.query_row("SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade'", [&id], |r| r.get(0)).unwrap();
        assert_eq!(upgrades, 2);
    }
}

#[test]
fn version_three_upgrade_keeps_released_untouched_belongings() {
    for keep_checkpoint in [true, false] {
        let (_path, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::LEGACY_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::LEGACY_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        };
        old.apply(&json!({"op":"claim","actor":"mara"})).unwrap();
        old.apply(
            &json!({"op":"upgrade","from":engine::LEGACY_VERSION,"to":engine::PREVIOUS_VERSION}),
        )
        .unwrap();
        old.apply(&json!({"op":"release","actor":"mara"})).unwrap();
        assert_eq!(old.game["items"]["mask"]["holder"], "mara");
        assert!(old.game["items"]["mask"]["history"]
            .as_array()
            .unwrap()
            .is_empty());
        full_store::seed(&c, &id, &old, "released-version-three-seed", now()).unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let upgraded = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(upgraded.version, engine::VERSION);
        assert_eq!(upgraded.game["items"], old.game["items"]);
        assert_eq!(upgraded.game["actors"], old.game["actors"]);
        assert_eq!(upgraded.claimed, old.claimed);
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}

#[test]
fn released_greek_upgrades_and_recitals_replay_before_collected_quests() {
    for path in [
        vec![engine::FIFTH_VERSION],
        vec![engine::FOURTH_VERSION, engine::FIFTH_VERSION],
        vec![engine::LEGACY_VERSION, engine::FOURTH_VERSION],
        vec![engine::PREVIOUS_VERSION, engine::FOURTH_VERSION],
        vec![
            engine::LEGACY_VERSION,
            engine::PREVIOUS_VERSION,
            engine::FOURTH_VERSION,
        ],
    ] {
        for keep_checkpoint in [true, false] {
            let (_file, c, id) = fixture();
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            c.execute("DELETE FROM card_full_log", []).unwrap();
            let result = engine::reduce_version(path[0], json!({"op":"create"})).unwrap();
            let mut w = World {
                version: path[0].into(),
                game: result["world"].clone(),
                claimed: [0; 8],
                present: [0; 8],
            };
            w.game.as_object_mut().unwrap().remove("opening");
            w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
            w.game["actors"]["vale"]["place"] = json!("greek-courtyard");
            w.game["items"]["greek-water-jar"]["holder"] = json!("vale");
            full_store::seed(&c, &id, &w, "released-greek", now()).unwrap();
            for op in ["claim", "enter"] {
                full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now())
                    .unwrap();
            }
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["choiceId"] == "greek-return-water-jar")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            for target in &path[1..] {
                let from = w.version.clone();
                full_store::commit(
                    &c,
                    &id,
                    &mut w,
                    json!({"op":"upgrade","from":from,"to":target}),
                    now(),
                )
                .unwrap();
            }
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "move" && a["target"] == "greek-well")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "greek-well");
            full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"greek-well","lines":[{"actorId":"vale","text":"The well is quiet today."},{"actorId":null,"entityId":"greek-well","text":"Water shines in the shade."}]}), now()).unwrap();
            let previous = w.clone();
            if !keep_checkpoint {
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            }
            w = full_store::world(&c, &id, now()).unwrap();
            assert_eq!(w.version, engine::VERSION);
            for key in ["actors", "items", "log", "packs", "turn"] {
                assert_eq!(w.game[key], previous.game[key], "Preserve {key}");
            }
            assert_eq!(
                w.game["revision"].as_u64().unwrap(),
                previous.game["revision"].as_u64().unwrap() + 1
            );
            assert!(w.game["life"]["actors"]["vale"]["collection"].is_object());
            for key in w.game["life"]["actors"]["vale"]["collection"]["cards"]
                .as_array()
                .unwrap()
            {
                let key = key.as_str().unwrap();
                assert_eq!(w.game["quests"]["records"][key]["key"], key);
            }
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "wait")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            assert_eq!(
                w.game["actors"]["greek-rhapsode"]["place"],
                "greek-courtyard"
            );
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "move" && a["target"] == "greek-courtyard")
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
            let poem = result["context"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == "greek-rhapsode")
                .unwrap()["poem"]
                .clone();
            assert!(poem["stanzas"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["id"] == "greek-return-water-jar"));
            assert_eq!(
                w.game["packs"]["greek-drama"]["receipts"],
                previous.game["packs"]["greek-drama"]["receipts"]
            );
            full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"greek-courtyard","lines":[{"actorId":"vale","text":"I remember the bread we shared."},{"actorId":"greek-rhapsode","text":"The song keeps that day."}]}), now()).unwrap();
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
            let upgrades: usize = c.query_row("SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'", [], |r| r.get(0)).unwrap();
            assert_eq!(upgrades, path.len());
        }
    }
}

#[test]
fn pruned_shared_recital_keeps_unknown_author_through_upgrade_and_replay() {
    for keep_checkpoint in [true, false] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::PREVIOUS_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::PREVIOUS_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        };
        old.game.as_object_mut().unwrap().remove("opening");
        old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        old.game["actors"]["mara"]["place"] = json!("greek-gate");
        for op in ["claim", "enter"] {
            old.apply(&json!({"op":op,"actor":"mara"})).unwrap();
        }
        for choice in ["greek-hear-decree", "greek-decline-burial"] {
            let action = old.project(1).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["choiceId"] == choice)
                .unwrap()
                .clone();
            old.apply(&json!({"op":"play","actor":"mara","action":action}))
                .unwrap();
        }
        assert!(old.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["choiceId"] == "greek-decline-burial" && e["actorId"] == "mara"));
        old.game["log"] = json!([]);
        full_store::seed(&c, &id, &old, "pruned-shared-song", now()).unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(upgraded.version, engine::VERSION);
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-decline-burial"],
            json!({"actor":null,"visit":null})
        );
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["receipts"],
            old.game["packs"]["greek-drama"]["receipts"]
        );
        let action = upgraded.project(1).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "greek-courtyard")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"mara","action":action}),
            now(),
        )
        .unwrap();
        assert!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-decline-burial"]["visit"]
                .is_null()
        );
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}

#[test]
fn released_carriage_route_replays_before_the_station_connection_upgrade() {
    for keep_checkpoint in [true, false] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::FOURTH_VERSION, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: engine::FOURTH_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        };
        full_store::seed(&c, &id, &w, "released-carriage", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"rue"}), now()).unwrap();
        }
        for kind in ["take", "move"] {
            let action = home_action(&w, 5, kind);
            if kind == "move" {
                assert_eq!(action["target"], "pond");
            }
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"rue","action":action}),
                now(),
            )
            .unwrap();
        }
        let earlier = w.clone();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        w = full_store::world(&c, &id, now()).unwrap();
        for key in ["actors", "items", "log", "crossings"] {
            assert_eq!(w.game[key], earlier.game[key]);
        }
        assert_eq!(w.version, engine::VERSION);
        assert!(!w.project(5).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!("train")));
        let action = w.project(5).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "station")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"rue","action":action}),
            now(),
        )
        .unwrap();
        assert!(w.project(5).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!("train")));
        let action = w.project(5).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "train")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"rue","action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(w.game["actors"]["rue"]["place"], "train");
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[test]
fn shared_quest_receipts_drive_bard_travel_after_version_seven_upgrade_and_replay() {
    for keep_checkpoint in [true, false] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result = engine::reduce_version(engine::SIXTH_VERSION, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: engine::SIXTH_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["actors"]["vale"]["place"] = json!("station");
        let receipt = json!({"id":"world:quest:0:terminal:1","seq":1,"eventSeq":0,"turn":0,"questKey":"world:quest:0","terminalRevision":1,"actorId":"keeper","locationId":"greek-well","participants":["keeper"],"outcome":"fulfilled","cause":null});
        w.game["quests"] = json!({"version":1,"next":1,"records":{},"focus":{}});
        w.game["quests"]["records"]["world:quest:0"] = json!({
          "key":"world:quest:0","mode":"shared","holder":{"kind":"item","id":"bell"},
          "subjectActor":null,"rewardActor":null,"participants":["keeper"],
          "program":{"id":"well-deed","name":"A deed at the well","steps":[{"items":[],"avatars":[],"location":"greek-well"}]},
          "step":1,"origin":null,"createdTurn":0,"completedTurn":0,"cause":null,"terminalRevision":1,"completion":receipt
        });
        w.game["questCompletions"] = json!({"next":2,"recent":[receipt],"latest":receipt});
        full_store::seed(&c, &id, &w, "released-shared-quest", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
        }
        let action = home_action(&w, 0, "wait");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"station","lines":[{"actorId":"vale","text":"I remember the well."},{"actorId":null,"entityId":"station","text":"The platform is quiet."}]}), now()).unwrap();
        let previous = w.clone();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        w = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(w.version, engine::VERSION);
        for key in [
            "actors",
            "items",
            "questCompletions",
            "quests",
            "log",
            "packs",
            "turn",
        ] {
            assert_eq!(w.game[key], previous.game[key], "Preserve {key}");
        }
        assert_eq!(w.claimed, previous.claimed);
        for destination in [
            "greek-harbor",
            "greek-courtyard",
            "greek-well",
            "greek-well",
        ] {
            let action = home_action(&w, 0, "wait");
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], destination);
            assert_eq!(w.game["roamingQuests"]["greek-rhapsode"]["target"], receipt);
        }
        full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"station","lines":[{"actorId":"vale","text":"The journey continues."},{"actorId":null,"entityId":"station","text":"A breeze crosses the platform."}]}), now()).unwrap();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[test]
fn bard_passage_help_uses_authoritative_home_and_ship_actions_and_replays() {
    for sea in [false, true] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let mut w = World::create(None).unwrap();
        w.game.as_object_mut().unwrap().remove("opening");
        // Keep this passage fixture separate from unrelated shore quests.
        w.game["actors"]["moth"]["place"] = json!("greek-battlefield");
        w.game["actors"]["keeper"]["place"] = json!("greek-battlefield");
        let start = if sea { "greek-harbor" } else { "theatre" };
        w.game["actors"]["vale"]["place"] = json!(if sea { "pond" } else { "theatre" });
        w.game["actors"]["greek-rhapsode"]["place"] = json!(start);
        w.game["items"]["mask"]["holder"] = json!("theatre");
        w.game["items"]["lamp"]["holder"] = json!("vale");
        w.game["transports"]["greek-ship"]["dock"] = json!("pond");
        let receipt = json!({"id":"world:quest:0:terminal:1","seq":1,"eventSeq":0,"turn":0,"questKey":"world:quest:0","terminalRevision":1,"actorId":"keeper","locationId":"pond","participants":["keeper"],"outcome":"fulfilled","cause":null});
        w.game["quests"] = json!({"version":1,"next":1,"records":{},"focus":{}});
        w.game["quests"]["records"]["world:quest:0"] = json!({
          "key":"world:quest:0","mode":"shared","holder":{"kind":"place","id":"pond"},
          "subjectActor":null,"rewardActor":null,"participants":["keeper"],
          "program":{"id":"shore-deed","name":"A deed at the shore","steps":[{"items":[],"avatars":[],"location":"pond"}]},
          "step":1,"origin":null,"createdTurn":0,"completedTurn":0,"cause":null,"terminalRevision":1,"completion":receipt
        });
        w.game["questCompletions"] = json!({"next":2,"recent":[receipt],"latest":receipt});
        full_store::seed(&c, &id, &w, "blocked-bard-passage", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
        }
        let play = |w: &mut World, kind: &str, field: &str, value: &str| {
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == kind && (field.is_empty() || a[field] == value))
                .unwrap_or_else(|| panic!("Missing {kind} {field} {value}"))
                .clone();
            full_store::commit(
                &c,
                &id,
                w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        };
        play(&mut w, "wait", "", "");
        assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], start);
        let help = w.game["roamingQuests"]["greek-rhapsode"]["blocked"]["questKey"]
            .as_str()
            .unwrap()
            .to_string();
        play(&mut w, "wait", "", "");
        assert_eq!(
            w.game["roamingQuests"]["greek-rhapsode"]["blocked"]["questKey"],
            help
        );
        if sea {
            play(&mut w, "move", "target", "greek-ship");
            play(&mut w, "move", "target", "greek-harbor");
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "greek-ship");
            play(&mut w, "wait", "", "");
        } else {
            play(&mut w, "join-quest", "questKey", &help);
            play(&mut w, "take", "item", "mask");
        }
        assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "pond");
        assert_eq!(w.game["roamingQuests"]["greek-rhapsode"]["target"], receipt);
        let arrived = w.clone();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), arrived);
        play(&mut w, "wait", "", "");
        assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "pond");
    }
}

#[test]
fn invited_carriage_trip_preserves_agreement_visited_places_and_replays() {
    for agrees in [false, true] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let mut w = World::create(None).unwrap();
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["actors"]["rue"]["place"] = json!("station");
        w.game["actors"]["moth"]["place"] = json!("station");
        w.game["actors"]["moth"]["trust"]["rue"] = json!(if agrees { 1 } else { 0 });
        w.game["items"]["routes"]["holder"] = json!("rue");
        full_store::seed(&c, &id, &w, "invited-carriage", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"rue"}), now()).unwrap();
        }
        let action = w.project(5).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| {
                a["kind"] == "accompany" && a["target"] == "moth" && a["destination"] == "train"
            })
            .unwrap()
            .clone();
        let before = w.clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"rue","action":action}),
            now(),
        )
        .unwrap();
        let place = if agrees { "train" } else { "station" };
        assert_eq!(w.game["actors"]["rue"]["place"], place);
        assert_eq!(w.game["actors"]["moth"]["place"], place);
        assert_eq!(w.game["items"]["routes"]["holder"], "rue");
        if agrees {
            assert_eq!(w.game["invitedPlaces"]["moth"], json!(["train"]));
        } else {
            assert!(w.game["invitedPlaces"].is_null());
        }
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
        let mut closed = before;
        closed.game["items"]["routes"]["holder"] = json!("train");
        assert!(closed
            .apply(&json!({"op":"play","actor":"rue","action":action}))
            .is_err());
        assert_eq!(closed.game["actors"]["moth"]["place"], "station");
        assert!(closed.game["invitedPlaces"].is_null());
    }
}

#[test]
fn embedded_selected_cards_match_with_personal_and_shared_quest_offers() {
    let mut w = World::create(None).unwrap();
    for op in ["claim", "enter"] {
        w.apply(&json!({"op":op,"actor":"vale"})).unwrap();
    }
    for (kind, target) in [("light", None), ("move", Some("pond"))] {
        let action = w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind && target.is_none_or(|to| a["target"] == to))
            .unwrap()
            .clone();
        w.apply(&json!({"op":"play","actor":"vale","action":action}))
            .unwrap();
    }
    w.game["items"]["cloth"]["holder"] = json!("vale");
    let view = w.project(0).unwrap();
    let actions = view["actions"].as_array().unwrap();
    for kind in ["pursue", "share-quest", "join-quest"] {
        assert!(actions
            .iter()
            .any(|a| a["kind"] == kind && a["cards"].is_null()));
    }
    let cover = actions
        .iter()
        .find(|a| a["kind"] == "cover")
        .unwrap()
        .clone();
    let mut selected = w.request("play", 0);
    selected["selectedIds"] = json!(["vale", "cloth", "lamp", "cloth"]);
    let actual = engine::reduce(selected).unwrap();
    assert_eq!(actual["ok"], true);
    w.apply(&json!({"op":"play","actor":"vale","action":cover}))
        .unwrap();
    assert_eq!(actual["world"], w.game);
    assert_eq!(w.game["items"]["cloth"]["holder"], "lamp");
}
