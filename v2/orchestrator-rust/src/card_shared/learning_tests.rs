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
