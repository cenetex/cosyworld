use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

// From rules 93 a speech op holds only the voices its play named, once each.
// A threat voices only its target, so Pip's lone reply commits through the
// real engine, on a rules 92 world upgraded by its journal as on a new one;
// a line from an unnamed voice, or one voice twice, is refused.
#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn rules_93_speech_keeps_to_the_voices_its_play_named() {
    let path = std::env::temp_dir().join(format!("card-speech-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let version = engine::NINETY_SECOND_VERSION;
    let mut game = engine::reduce_pack(
        version,
        Some(content::released()),
        json!({"op":"create","seed":9}),
    )
    .unwrap()["world"]
        .clone();
    game.as_object_mut().unwrap().remove("opening");
    for actor in ["vale", "moth"] {
        game["actors"][actor]["place"] = json!("station");
    }
    let mut old = World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack: engine::takes_content(version).then(|| content::released().into()),
    };
    full_store::seed(&c, &id, &old, "released-speech", now()).unwrap();
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    let speech =
        |lines: Value| json!({"op":"speech","actor":"vale","room":"station","lines":lines});
    let pip = json!({"actorId":"moth","entityId":"moth","text":"Keep your threats, Vale."});
    let vale = json!({"actorId":"vale","entityId":"vale","text":"Give me the lamp."});
    commit(&mut old, json!({"op":"claim","actor":"vale"}));
    commit(&mut old, json!({"op":"enter","actor":"vale"}));
    // Rules 92 took one voice twice; its journal replays as recorded.
    commit(&mut old, speech(json!([vale, vale])));

    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(w.game["log"], old.game["log"]);
    let actions = w.project(0).unwrap()["actions"].clone();
    let threat = actions
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "threaten" && a["target"] == "moth")
        .unwrap_or_else(|| panic!("{actions}"))
        .clone();
    commit(&mut w, json!({"op":"play","actor":"vale","action":threat}));
    for refused in [json!([vale]), json!([pip, vale]), json!([pip, pip])] {
        let error =
            full_store::commit(&c, &id, &mut w.clone(), speech(refused), now()).unwrap_err();
        assert!(error.to_string().contains("speaks once"), "{error}");
    }
    let result = commit(&mut w, speech(json!([pip])));
    assert_eq!(result["lines"].as_array().unwrap().len(), 1);
    assert_eq!(result["lines"][0]["actorId"], "moth");
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}
