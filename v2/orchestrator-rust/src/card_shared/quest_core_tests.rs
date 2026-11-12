use super::{engine, full, full_speech, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn fixture(version: &str) -> (std::path::PathBuf, rusqlite::Connection, String, World) {
    let path = std::env::temp_dir().join(format!("quest-core-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let seed = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut world = World {
        version: version.into(),
        game: seed["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: None,
    };
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["packs"]["greek-drama"]["scope"] = json!("full");
    world.game["actors"]["vale"]["place"] = json!("greek-gate");
    world.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    full_store::seed(&c, &id, &world, "quest-core-fixture", now()).unwrap();
    (path, c, id, world)
}

fn action(world: &World, fields: &[(&str, &str)]) -> Value {
    world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| fields.iter().all(|(key, value)| a[key] == *value))
        .unwrap_or_else(|| panic!("Missing quest action {fields:?}"))
        .clone()
}

fn command(op: &str, key: &str) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: (op == "claim").then(|| "vale".into()),
        action: Value::Null,
        target: None,
        key: key.into(),
        moving: false,
        surface: crate::card_shared::Surface::Browser,
        revealed: None,
    }
}

#[test]
fn quest_core_talk_disclosure_waits_for_published_speech_and_replays_accepted_learning() {
    let (path, c, id, _) = fixture(engine::VERSION);
    full::run(&c, &id, "user0", &command("claim", ""), now()).unwrap();
    let before = full_store::world(&c, &id, now()).unwrap();
    let mut talk = command("play", "quest-core-talk-request");
    talk.action = action(&before, &[("kind", "talk"), ("target", "greek-guard")]);
    full::run(&c, &id, "user0", &talk, now()).unwrap();
    let app = crate::test_app_state(Some(path.clone()));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    let stale_attempt = work.clone();
    assert_eq!(work.room, "greek-gate");
    let disclosures = work.context["context"]["disclosures"].clone();
    let disclosure = &disclosures[0];
    assert_eq!(disclosure["speaker"], "greek-guard");
    assert_eq!(disclosure["listener"], "vale");
    assert_eq!(disclosure["factId"], "greek-hear-decree");
    let played_turn = work.context["turn"].clone();
    let interrupted = full_store::world(&c, &id, now()).unwrap();
    assert!(interrupted.game["knowledge"]["known"]["vale"]
        .get("greek-hear-decree")
        .is_none());
    // Meeting the guard tells the decree as the Talk is played (Greek
    // revision 11); only the heard fact waits for the published speech.
    assert_eq!(
        interrupted.game["packs"]["greek-drama"]["receipts"]["greek-hear-decree"],
        played_turn
    );
    let retry = work;
    assert_eq!(retry.room, "greek-gate");
    assert_eq!(retry.context["turn"], played_turn);
    assert_eq!(retry.context["context"]["disclosures"], disclosures);
    let (_, ids) = full_speech::prepared(0, &retry.context).unwrap();
    let entries: Vec<_> = ids
        .iter()
        .map(|id| {
            let words = if id == "greek-guard" {
                disclosure["text"].as_str().unwrap()
            } else if id == "vale" {
                "I will remember what you told me."
            } else {
                "The gate stands above the road."
            };
            json!({"id":id,"text":words})
        })
        .collect();
    let lines = full_speech::parse(
        &json!({"entries":entries}).to_string(),
        "stop",
        &retry.context,
        0,
        &ids,
    )
    .unwrap();
    let duplicate = retry.clone();
    full::finish_work(&app, &id, retry, Ok(lines)).unwrap();
    let expected = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(expected.game["turn"], played_turn);
    let learned = &expected.game["knowledge"]["known"]["vale"]["greek-hear-decree"];
    assert_eq!(learned["kind"], "heard");
    assert_eq!(learned["teller"], "greek-guard");
    assert_eq!(learned["learnedTurn"], played_turn);
    assert_eq!(
        expected.game["packs"]["greek-drama"]["receipts"]["greek-hear-decree"],
        played_turn
    );
    // The heard decree is a receipt and a known fact; no quest record joins it.
    assert!(expected.game.get("quests").is_none());
    full::finish_work(&app, &id, duplicate, Err("A duplicate reply.".into())).unwrap();
    full::finish_work(&app, &id, stale_attempt, Err("An earlier attempt.".into())).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), expected);
}
