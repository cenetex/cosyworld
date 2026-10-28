use super::*;

#[test]
fn shared_reflections_survive_restart_and_journal_rebuild_with_private_views() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    claim(&mut c, &id, 1);
    let mut w = full_store::world(&c, &id, now()).unwrap();
    let action = home_action(&w, 0, "light");
    let result = full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    let entity = result["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "vale")
        .unwrap();
    let evidence: Vec<_> = entity["memories"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["kind"] == "event")
        .map(|m| m["seq"].clone())
        .collect();
    let entry = json!({"id":"vale","model":"voice-model","reflection":{
        "thought":"The light gave me a reason to look closer.","persona":"I am learning to take care with borrowed things.",
        "dream":"A bright bird rested on the shore.","evidence":evidence,
        "models":{"thought":"thought-model","persona":"persona-model","dream":"dream-model"}
    }});
    let room = w.room(0).unwrap().to_string();
    full_store::commit(&c,&id,&mut w,json!({"op":"speech","actor":"vale","room":room,"lines":[{"actorId":"vale","text":"I can see the shore."}],"entries":[entry]}),now()).unwrap();
    let expected = w.clone();
    assert_eq!(
        expected.game["memories"]["vale"]["reflections"][0]["models"]["persona"],
        "persona-model"
    );
    assert!(w.project(0).unwrap()["world"]["memories"]["vale"]["innerLife"].is_object());
    let other = full_store::snapshot(&c, &id, "user1", now()).unwrap();
    for key in ["innerLife", "reflections", "learning"] {
        assert!(other["world"]["memories"]["vale"].get(key).is_none());
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&_path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
}

#[test]
fn version_twelve_history_replays_before_the_saved_learning_upgrade() {
    let (_path, c, id) = fixture();
    let mut old = World::create(None).unwrap();
    old.version = engine::TWELFTH_VERSION.into();
    c.execute("DELETE FROM card_full_log WHERE world=?", [&id])
        .unwrap();
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    full_store::seed(&c, &id, &old, "version-twelve", now()).unwrap();
    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["turn"], old.game["turn"]);
    assert_eq!(upgraded.game["items"], old.game["items"]);
    assert_eq!(upgraded.game["memories"], old.game["memories"]);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
}

#[test]
fn publication_keeps_reflection_private_after_disconnect_and_duplicate_finish() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let mut queued = body("play", None);
    queued.key = "learning-publication".into();
    queued.action = home_action(&full_store::world(&c, &id, now()).unwrap(), 0, "light");
    full::run(&c, &id, "user0", &queued, now()).unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    let duplicate = work.clone();
    let (_, ids) = full_speech::prepared(0, &work.context).unwrap();
    let evidence: Vec<_> = work.context["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "vale")
        .unwrap()["memories"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "event")
        .map(|e| e["seq"].clone())
        .collect();
    let entries: Vec<_> = ids.iter().map(|id| if id=="vale" {
        json!({"id":id,"text":"I can see the shore.","model":"voice-model","reflection":{"thought":"I will care for what I carry.","persona":"A private revised persona.","evidence":evidence,"models":{"thought":"thought-model","persona":"persona-model"}}})
    } else {json!({"id":id,"text":"Mist gathers by the water."})}).collect();
    let lines = full_speech::parse(
        &json!({"entries":entries}).to_string(),
        "stop",
        &work.context,
        &ids,
    )
    .unwrap();
    let mut w = full_store::world(&c, &id, now()).unwrap();
    full_store::commit(&c, &id, &mut w, json!({"op":"leave","actor":"vale"}), now()).unwrap();
    full::finish_work(&app, &id, work, Ok(lines)).unwrap();
    let expected = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(
        expected.game["memories"]["vale"]["innerLife"]["persona"],
        "A private revised persona."
    );
    full::finish_work(&app, &id, duplicate, Err("Late duplicate".into())).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let scene: String = c
        .query_row(
            "SELECT content FROM card_full_scenes WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!scene.contains("private revised persona"));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}

#[test]
fn shared_request_lessons_replay_from_their_completed_action() {
    let (_path, c, id) = fixture();
    c.execute("DELETE FROM card_full_log WHERE world=?", [&id])
        .unwrap();
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    let mut w = World::create(None).unwrap();
    w.game["actors"]["keeper"]["place"] = w.game["actors"]["vale"]["place"].clone();
    w.game.as_object_mut().unwrap().remove("opening");
    w.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    full_store::seed(&c, &id, &w, "learning-fixture", now()).unwrap();
    let action = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "ask" && a["item"] == "oil")
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
    assert_eq!(w.game["memories"]["vale"]["learning"][0]["observed"], false);
    assert_eq!(
        w.game["memories"]["vale"]["learning"][0]["strategy"],
        "offer_trade"
    );
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}

#[test]
fn shared_interpreter_keeps_absent_players_out_of_witnessed_memory() {
    let mut w = World::create(None).unwrap();
    w.game["actors"]["mara"]["place"] = w.game["actors"]["vale"]["place"].clone();
    for actor in ["vale", "mara"] {
        w.apply(&json!({"op":"claim","actor":actor})).unwrap();
    }
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    let action = home_action(&w, 0, "light");
    w.apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    let room = w.room(0).unwrap().to_string();
    w.apply(&json!({"op":"speech","actor":"vale","room":room,"lines":[{"actorId":"vale","text":"A quiet story for this room."}]})).unwrap();
    assert!(w.game["memories"]["mara"]["events"]
        .as_array()
        .unwrap()
        .is_empty());
    let own = w.game["memories"]["vale"]["events"].as_array().unwrap();
    assert!(own
        .iter()
        .any(|e| e["text"].as_str().unwrap().contains("quiet story")));
}
