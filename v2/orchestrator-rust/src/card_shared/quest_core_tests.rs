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
    }
}

fn assert_saved_values(saved: &Value, current: &Value, path: &str) {
    if let Some(fields) = saved.as_object() {
        let current = current
            .as_object()
            .unwrap_or_else(|| panic!("Preserve released object {path}"));
        for (key, value) in fields {
            let path = format!("{path}.{key}");
            let actual = current
                .get(key)
                .unwrap_or_else(|| panic!("Preserve released field {path}"));
            assert_saved_values(value, actual, &path);
        }
    } else {
        assert_eq!(current, saved, "Preserve released {path}");
    }
}

// Both versions upgrade through the same command; the long history (over a
// hundred log lines) is played once, under the newest.
#[test]
fn quest_core_v17_upgrade_preserves_old_deeds_during_journal_replay() {
    quest_history_upgrade(engine::SEVENTEENTH_VERSION, 3);
}

#[test]
fn quest_core_v18_upgrade_preserves_old_deeds_and_long_history_during_journal_replay() {
    quest_history_upgrade(engine::EIGHTEENTH_VERSION, 55);
}

fn quest_history_upgrade(version: &str, speeches: usize) {
    let (path, c, id, mut old) = fixture(version);
    old.claimed[0] = 1;
    old.present[0] = 1;
    c.execute("DELETE FROM card_full_log", []).unwrap();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    full_store::seed(&c, &id, &old, "released-quest-history", now()).unwrap();
    let choice = action(
        &old,
        &[("kind", "choose"), ("choiceId", "greek-hear-decree")],
    );
    full_store::commit(
        &c,
        &id,
        &mut old,
        json!({"op":"play","actor":"vale","action":choice}),
        now(),
    )
    .unwrap();
    for speech in 0..speeches {
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"speech","actor":"vale","room":"greek-gate","lines":[
                {"actorId":"vale","text":"I will remember the order."},
                {"actorId":"greek-guard","text":"The road is quiet."}
            ]}),
            now(),
        )
        .unwrap_or_else(|error| {
            panic!(
                "Released speech {speech} under {} at turn {}: {error}",
                old.version, old.game["turn"]
            )
        });
    }
    assert!(old.game["log"].as_array().unwrap().len() > speeches.min(50) * 2);
    assert!(old.game.get("knowledge").is_none());
    assert!(old.game["packs"]["greek-drama"]["receipts"]["greek-hear-decree"].is_number());
    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["knowledge"]["version"], 1);
    // New packs add cast, belongings and story records. Every saved field and
    // complete history array still survives, with the authored pack revision.
    let catalog: Value =
        serde_json::from_str(include_str!("../../../card-game/packs.json")).unwrap();
    let greek = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pack| pack["id"] == "greek-drama")
        .unwrap();
    let mut expected_packs = old.game["packs"].clone();
    expected_packs["greek-drama"]["revision"] = greek["revision"].clone();
    // BoardyAI revision 2 moved his parlour door back to the station.
    expected_packs["boardyai"]["revision"] = json!(2);
    assert_saved_values(&expected_packs, &upgraded.game["packs"], "packs");
    // The want model drops quest records and progress on upgrade; every other
    // saved field and the rest of the history survive.
    for field in ["items", "memories", "turn", "eventSeq"] {
        assert_saved_values(
            &super::saved_items::upgraded_field(&old.game, field),
            &upgraded.game[field],
            field,
        );
    }
    super::full_tests::assert_saved_actors(&upgraded.game["actors"], &old.game["actors"]);
    assert_saved_values(
        &super::full_tests::quest_free_log(&old.game["log"]),
        &upgraded.game["log"],
        "log",
    );
    for field in ["quests", "questCompletions"] {
        assert!(upgraded.game.get(field).is_none(), "Drop {field}");
    }
    for actor in upgraded.game["actors"].as_object().unwrap().values() {
        assert!(actor.get("progress").is_none());
        assert!(actor.get("want").is_some());
    }
    for (id, actor) in old.game["actors"].as_object().unwrap() {
        for (other, trust) in upgraded.game["actors"][id]["trust"].as_object().unwrap() {
            if actor["trust"].get(other).is_none() {
                assert_eq!(trust, &json!(0), "New trust starts at zero: {id}/{other}");
            }
        }
    }
    let upgrades: i64 = c.query_row(
        "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade'",
        [&id],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(upgrades, 1);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), upgraded);
}

#[test]
fn quest_core_talk_disclosure_retries_the_original_scene_and_replays_accepted_learning() {
    let (path, c, id, _) = fixture(engine::VERSION);
    full::run(&c, &id, "user0", &command("claim", ""), now()).unwrap();
    let before = full_store::world(&c, &id, now()).unwrap();
    let mut talk = command("play", "quest-core-talk-request");
    talk.action = action(&before, &[("kind", "talk"), ("target", "greek-guard")]);
    full::run(&c, &id, "user0", &talk, now()).unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
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
    full::finish_work(&app, &id, work, Err("The voice needs another try.".into())).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), interrupted);
    full::run(
        &c,
        &id,
        "user0",
        &command("retry", "quest-core-talk-request"),
        now(),
    )
    .unwrap();
    let retry = full::take_work(&app, &id).unwrap().unwrap();
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
