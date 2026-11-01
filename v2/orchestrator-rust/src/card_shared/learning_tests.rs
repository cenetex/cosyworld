use super::*;

#[test]
fn shared_reflections_survive_restart_and_journal_rebuild_with_private_views() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    claim(&mut c, &id, 1);
    let mut w = full_store::world(&c, &id, now()).unwrap();
    let action = home_action(&w, 0, "snuff");
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    // Only the avatar who waits after something new turns inward.
    let action = home_action(&w, 0, "wait");
    let result = full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    assert_eq!(result["context"]["resting"], "vale");
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
        "thought":"The dark gave me a reason to look closer.","persona":"I am learning to take care with borrowed things.",
        "evidence":evidence,
        "models":{"thought":"thought-model","persona":"persona-model"}
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
    for key in ["innerLife", "reflections", "learning", "seen", "text"] {
        assert!(other["world"]["memories"]["vale"].get(key).is_none());
    }
    assert_eq!(other["world"]["memories"]["vale"]["events"], json!([]));
    assert!(other["world"]["memories"]["mara"]["events"].is_array());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&_path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
}

#[test]
fn version_twelve_history_replays_before_the_saved_learning_upgrade() {
    let (_path, c, id) = fixture();
    let seed = engine::reduce_version(engine::TWELFTH_VERSION, json!({"op":"create"})).unwrap();
    let old = World {
        version: engine::TWELFTH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: None,
    };
    c.execute("DELETE FROM card_full_log WHERE world=?", [&id])
        .unwrap();
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    full_store::seed(&c, &id, &old, "version-twelve", now()).unwrap();
    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["turn"], old.game["turn"]);
    for field in ["items"] {
        for (key, value) in super::saved_items::upgraded_field(&old.game, field)
            .as_object()
            .unwrap()
        {
            assert_eq!(&upgraded.game[field][key], value);
        }
    }
    assert_saved_memories(&upgraded.game["memories"], &old.game["memories"]);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
}

#[test]
fn publication_keeps_reflection_private_after_disconnect_and_duplicate_finish() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let mut doused = full_store::world(&c, &id, now()).unwrap();
    let snuff = home_action(&doused, 0, "snuff");
    full_store::commit(
        &c,
        &id,
        &mut doused,
        json!({"op":"play","actor":"vale","action":snuff}),
        now(),
    )
    .unwrap();
    let mut queued = body("play", None);
    queued.key = "learning-publication".into();
    queued.action = home_action(&full_store::world(&c, &id, now()).unwrap(), 0, "wait");
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
    assert_eq!(
        w.game["memories"]["vale"]["learning"][0]["after"]["met"],
        false
    );
    assert_eq!(
        w.game["memories"]["vale"]["learning"][0]["expected"]["samples"],
        0
    );
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}

#[test]
fn measured_approaches_and_later_success_survive_journal_only_replay() {
    let (path, c, id) = fixture();
    c.execute("DELETE FROM card_full_log WHERE world=?", [&id])
        .unwrap();
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    let mut w = World::create(None).unwrap();
    w.game.as_object_mut().unwrap().remove("opening");
    w.game.as_object_mut().unwrap().remove("life");
    w.game["motives"]
        .as_object_mut()
        .unwrap()
        .remove("questPrograms");
    w.game["actors"]["vale"]["place"] = json!("station");
    w.game["actors"]["keeper"]["place"] = json!("station");
    w.game["items"]["lamp"]["holder"] = json!("vale");
    w.game["items"]["bell"]["holder"] = json!("vale");
    w.game["items"]["cloth"]["holder"] = json!("keeper");
    // A player holds no want before first reaching the Black Pond (#1768), so
    // Vale starts past it, as test/helpers/first-quest.mjs does.
    w.game["actors"]["vale"]["visited"]
        .as_array_mut()
        .unwrap()
        .push(json!("pond"));
    // Vale wants the keeper's cloth; the keeper wants Vale's bell, so the
    // gift earns trust and a later request succeeds.
    w.game["actors"]["vale"]["want"] =
        json!({"kind":"item","target":"cloth","since":0,"refusals":0});
    w.game["actors"]["keeper"]["want"] =
        json!({"kind":"item","target":"bell","since":0,"refusals":0});
    w.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    full_store::seed(&c, &id, &w, "measured-learning", now()).unwrap();
    for (kind, item) in [("ask", "cloth"), ("give", "bell"), ("ask", "cloth")] {
        let action = w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind && a["item"] == item && a["target"] == "keeper")
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
    }
    let trials = w.game["memories"]["vale"]["learning"].as_array().unwrap();
    assert_eq!(trials.len(), 3);
    assert_eq!(trials[0]["expected"]["value"], Value::Null);
    assert_eq!(trials[0]["reward"], -1);
    assert_eq!(trials[1]["action"]["kind"], "give");
    assert_eq!(trials[1]["reward"], -3);
    assert_eq!(trials[2]["expected"]["samples"], 1);
    assert_eq!(trials[2]["after"]["met"], true);
    assert_eq!(trials[2]["reward"], 23);
    assert!(w.project(1).unwrap()["world"]["memories"]["vale"]
        .get("learning")
        .is_none());
    let expected = w.clone();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
}

#[test]
fn version_sixteen_lessons_upgrade_before_new_measured_plays() {
    let (_path, c, id) = fixture();
    let seed = engine::reduce_version(engine::SIXTEENTH_VERSION, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: engine::SIXTEENTH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: None,
    };
    old.game.as_object_mut().unwrap().remove("opening");
    old.game.as_object_mut().unwrap().remove("life");
    old.game["motives"]
        .as_object_mut()
        .unwrap()
        .remove("questPrograms");
    for actor in old.game["actors"].as_object_mut().unwrap().values_mut() {
        actor["progress"] = json!({"program":0,"step":0,"marks":[]});
    }
    old.game["actors"]["vale"]["place"] = json!("station");
    old.game["actors"]["keeper"]["place"] = json!("station");
    old.game["items"]["bell"]["holder"] = json!("keeper");
    old.game["items"]["cloth"]["holder"] = json!("keeper");
    old.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    old.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    let action = old.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "ask" && a["item"] == "oil")
        .unwrap()
        .clone();
    old.apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    let earlier = old.game["memories"]["vale"]["learning"][0].clone();
    assert_eq!(earlier["strategy"], "offer_trade");
    c.execute("DELETE FROM card_full_log WHERE world=?", [&id])
        .unwrap();
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    full_store::seed(&c, &id, &old, "sixteen-learning", now()).unwrap();
    let mut upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["memories"]["vale"]["learning"][0], earlier);
    let action = upgraded.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "ask" && a["item"] == "oil")
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
        upgraded.game["memories"]["vale"]["learning"][1]["version"],
        2
    );
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
}

// An away holder's avatar stays as a resident and witnesses the room (#1846).
#[test]
fn shared_interpreter_lets_an_away_players_avatar_witness_as_a_resident() {
    let mut w = World::create(None).unwrap();
    w.game["actors"]["mara"]["place"] = w.game["actors"]["vale"]["place"].clone();
    for actor in ["vale", "mara"] {
        w.apply(&json!({"op":"claim","actor":actor})).unwrap();
    }
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    let action = home_action(&w, 0, "snuff");
    w.apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    let room = w.room(0).unwrap().to_string();
    w.apply(&json!({"op":"speech","actor":"vale","room":room,"lines":[{"actorId":"vale","text":"A quiet story for this room."}]})).unwrap();
    assert!(w.game["memories"]["mara"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["text"].as_str().unwrap().contains("quiet story")));
    let own = w.game["memories"]["vale"]["events"].as_array().unwrap();
    assert!(own
        .iter()
        .any(|e| e["text"].as_str().unwrap().contains("quiet story")));
}
