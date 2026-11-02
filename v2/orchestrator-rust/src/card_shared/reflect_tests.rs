//! Shared reflections journaled after their speech (#2016).
use super::*;

fn reflect_count(c: &rusqlite::Connection, id: &str) -> i64 {
    c.query_row(
        "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='reflect'",
        [id],
        |r| r.get(0),
    )
    .unwrap()
}

// A resting play is published with no reflection; its reflection lands later,
// after another play, and is dated to the speech.
#[test]
fn shared_line_commits_before_its_reflection_and_the_reflect_op_replays() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    claim(&mut c, &id, 1);
    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert!(engine::takes_reflect(&w.version));
    let snuff = home_action(&w, 0, "snuff");
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":snuff}),
        now(),
    )
    .unwrap();
    let mut queued = body("play", None);
    queued.key = "reflect-later".into();
    queued.action = home_action(&full_store::world(&c, &id, now()).unwrap(), 0, "wait");
    full::run(&c, &id, "user0", &queued, now()).unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(work.context["context"]["resting"], "vale");
    let (_, ids) = full_speech::prepared(0, &work.context).unwrap();
    let entries: Vec<_> = ids
        .iter()
        .map(|id| json!({"id":id,"text":if id=="vale" {"I can see the shore."} else {"Mist gathers."}}))
        .collect();
    let lines = full_speech::parse(
        &json!({"entries":entries}).to_string(),
        "stop",
        &work.context,
        0,
        &ids,
    )
    .unwrap();
    full::finish_work(&app, &id, work.clone(), Ok(lines)).unwrap();
    // The line is journaled and valid on its own, naming its play.
    let spoken = full_store::world(&c, &id, now()).unwrap();
    let speech: String = c
        .query_row("SELECT command FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='speech'", [&id], |r| r.get(0))
        .unwrap();
    let speech: Value = serde_json::from_str(&speech).unwrap();
    assert_eq!(speech["play"], "reflect-later");
    assert_eq!(speech["entries"], json!([]));
    assert!(spoken.game["memories"]["vale"]["innerLife"].is_null());
    // Another play lands before the reflection.
    let mut w = spoken.clone();
    let wait = home_action(&w, 0, "wait");
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":wait}),
        now(),
    )
    .unwrap();
    assert!(w.game["turn"].as_i64() > work.context["turn"].as_i64());
    let evidence: Vec<_> = work.context["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "vale")
        .unwrap()["memories"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["kind"] == "event")
        .map(|m| m["seq"].clone())
        .collect();
    let entry = json!({"id":"vale","reflection":{"thought":"I will care for what I carry.",
        "persona":"A private revised persona.","evidence":evidence,
        "models":{"thought":"thought-model","persona":"persona-model"}}});
    let command = full::reflect::command(&work, vec![entry]);
    assert!(full::reflect::commit(&app, &id, command.clone()).unwrap());
    let reflected = full_store::world(&c, &id, now()).unwrap();
    let life = &reflected.game["memories"]["vale"]["innerLife"];
    assert_eq!(life["thoughts"][0]["turn"], work.context["turn"]);
    assert_eq!(life["persona"], "A private revised persona.");
    // Only private memory moved.
    assert_eq!(reflected.game["actors"], w.game["actors"]);
    assert_eq!(reflected.game["turn"], w.game["turn"]);
    // A retry is not journaled twice.
    assert!(!full::reflect::commit(&app, &id, command).unwrap());
    assert_eq!(reflect_count(&c, &id), 1);
    // Private to its avatar, and rebuilt from the journal alone.
    let other = full_store::snapshot(&c, &id, "user1", now()).unwrap();
    assert!(other["world"]["memories"]["vale"]
        .get("innerLife")
        .is_none());
    assert!(reflected.project(0).unwrap()["world"]["memories"]["vale"]["innerLife"].is_object());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), reflected);
}

// A reflection that fails, or has no speech before it, leaves the journal and
// the world as they were. Earlier rules never take the op.
#[test]
fn refused_or_orphan_reflections_leave_the_world_whole() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let before = full_store::world(&c, &id, now()).unwrap();
    let entry = json!({"id":"vale","reflection":{"thought":"A thought.","persona":"A persona.","evidence":[999999]}});
    let orphan = json!({"op":"reflect","actor":"vale","play":"never-spoken","turn":before.game["turn"],"rest":null,"entries":[entry]});
    assert!(!full::reflect::commit(&app, &id, orphan.clone()).unwrap());
    // Ungrounded evidence is refused by the rules, even if journaled directly.
    let mut w = before.clone();
    assert!(full_store::commit(&c, &id, &mut w, orphan.clone(), now()).is_err());
    assert_eq!(reflect_count(&c, &id), 0);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
    assert!(!engine::takes_reflect(engine::EIGHTY_SIXTH_VERSION));
    let mut old = World {
        version: engine::EIGHTY_SIXTH_VERSION.into(),
        ..before.clone()
    };
    assert!(old.apply(&orphan).is_err());
}
