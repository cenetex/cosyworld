use super::{
    content, engine, full_store, full_tests::quest_free_log, full_world::World, now, store,
};
use serde_json::{json, Value};

fn strikes(w: &World) -> Vec<Value> {
    let log = w.game["log"].as_array().unwrap();
    log.iter()
        .filter(|e| e["verb"] == "attack")
        .cloned()
        .collect()
}

#[test]
fn released_level_strikes_replay_and_current_strikes_roll_by_tier_in_the_c_host() {
    let path = std::env::temp_dir().join(format!("card-tiers-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    // On rules 82, Vale at level II meets Pip at level I over the lamp.
    let version = engine::EIGHTY_SECOND_VERSION;
    let mut game =
        engine::reduce_version(version, json!({"op":"create","seed":9})).unwrap()["world"].clone();
    game.as_object_mut().unwrap().remove("opening");
    (game["turn"], game["revision"]) = (json!(3), json!(3));
    (
        game["actors"]["vale"]["place"],
        game["actors"]["moth"]["place"],
    ) = (json!("station"), json!("station"));
    (
        game["actors"]["vale"]["xp"],
        game["actors"]["moth"]["metTurn"],
    ) = (json!(1), json!(0));
    game["actors"]["moth"]["want"] = Value::Null;
    game["items"]["lamp"]["holder"] = json!("moth");
    let pack = engine::takes_content(version).then(|| content::current().into());
    let mut old = World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack,
    };
    full_store::seed(&c, &id, &old, "released-combat", now()).unwrap();
    let commit =
        |w: &mut World, command: Value| full_store::commit(&c, &id, w, command, now()).unwrap();
    commit(&mut old, json!({"op":"claim","actor":"vale"}));
    commit(&mut old, json!({"op":"enter","actor":"vale"}));
    let play = |action: &str| json!({"op":"play","actor":"vale","action":action});
    commit(&mut old, play("threaten:vale:lamp:moth"));
    commit(&mut old, play("attack:vale::moth"));
    // Rules 82 compared raw levels: II struck I for three (two through the
    // Brace), and I struck II for one.
    let released: Vec<_> = strikes(&old).iter().map(|e| e["damage"].clone()).collect();
    assert_eq!(released, [json!(2), json!(1)]);

    // The one recorded upgrade keeps the released strikes, with or without
    // the checkpoint.
    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(w.game["log"], quest_free_log(&old.game["log"]));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);

    // On rules 83, I and II are one tier: each strike rolls 1 or 2 by the
    // rules' FNV-1a of "seed:strike:revision:actor:target", as the browser does.
    full_store::commit(&c, &id, &mut w, play("attack:vale::moth"), now()).unwrap();
    let (seed, revision) = (&w.game["run"]["seed"], &w.game["revision"]);
    let all = strikes(&w);
    assert!(all.len() > 2);
    for hit in &all[2..] {
        let key = format!(
            "{seed}:strike:{revision}:{}:{}",
            hit["actorId"].as_str().unwrap(),
            hit["targetId"].as_str().unwrap()
        );
        let hash = key.chars().fold(2166136261u32, |h, ch| {
            (h ^ ch as u32).wrapping_mul(16777619)
        });
        let landed = (1 + hash % 2)
            .saturating_sub(u32::from(hit["guarded"] == true))
            .max(1);
        assert_eq!(hit["damage"], json!(landed), "{hit}");
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}

#[test]
fn rules_83_standoffs_replay_and_rules_84_battles_run_in_the_c_host() {
    let path = std::env::temp_dir().join(format!("card-battle-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    // On rules 83, Vale threatens Pip over the lamp; the keeper looks on.
    let version = engine::EIGHTY_THIRD_VERSION;
    let mut game =
        engine::reduce_version(version, json!({"op":"create","seed":9})).unwrap()["world"].clone();
    game.as_object_mut().unwrap().remove("opening");
    (game["turn"], game["revision"]) = (json!(3), json!(3));
    for actor in ["vale", "moth", "keeper"] {
        game["actors"][actor]["place"] = json!("station");
        (
            game["actors"][actor]["metTurn"],
            game["actors"][actor]["want"],
        ) = (json!(0), Value::Null);
    }
    game["items"]["lamp"]["holder"] = json!("moth");
    let pack = engine::takes_content(version).then(|| content::current().into());
    let mut old = World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack,
    };
    full_store::seed(&c, &id, &old, "released-standoff", now()).unwrap();
    let commit =
        |w: &mut World, command: Value| full_store::commit(&c, &id, w, command, now()).unwrap();
    let play = |action: &str| json!({"op":"play","actor":"vale","action":action});
    commit(&mut old, json!({"op":"claim","actor":"vale"}));
    commit(&mut old, json!({"op":"enter","actor":"vale"}));
    commit(&mut old, play("threaten:vale:lamp:moth"));
    assert_eq!(
        old.game["standoffs"][0]["resolve"],
        json!({"vale": 4, "moth": 4})
    );

    // The recorded upgrade keeps the rules 83 log, with or without the checkpoint.
    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(w.game["log"], quest_free_log(&old.game["log"]));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);

    // On rules 84 Talk is gone and Brace names no target. The keeper joins
    // the battle as Vale plays, and the round without a Strike ends it once
    // the keeper has played too.
    let talk = w.apply(&play("talk:vale::moth"));
    assert!(talk.map_or(true, |r| r["ok"] == false));
    commit(&mut w, play("guard:vale::"));
    let log = w.game["log"].as_array().unwrap();
    assert!(log
        .iter()
        .any(|e| e["verb"] == "guard" && e["actorId"] == "vale"));
    assert!(log
        .iter()
        .any(|e| e["text"] == "Nobody strikes for a whole round. The battle ends."));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}
