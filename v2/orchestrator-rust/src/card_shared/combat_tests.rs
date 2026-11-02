use super::{
    content, engine, full_store,
    full_tests::{assert_saved_actors, quest_free_log},
    full_world::World,
    now, store,
};
use serde_json::{json, Value};

// The rules' seeded roll (pack-rules.mjs runHash): FNV-1a over "seed:key".
fn run_hash(seed: u64, key: &str) -> u32 {
    format!("{seed}:{key}")
        .chars()
        .fold(2166136261u32, |h, ch| {
            (h ^ ch as u32).wrapping_mul(16777619)
        })
}

// Vale at level II and Pip at level I meet at the station over the lamp.
fn meeting(version: &str, seed: u32) -> World {
    let result = engine::reduce_version(version, json!({"op":"create","seed":seed})).unwrap();
    let mut game = result["world"].clone();
    game.as_object_mut().unwrap().remove("opening");
    game["turn"] = json!(3);
    game["revision"] = json!(3);
    for id in ["vale", "moth"] {
        game["actors"][id]["place"] = json!("station");
    }
    game["actors"]["vale"]["xp"] = json!(1);
    game["actors"]["moth"]["want"] = Value::Null;
    game["actors"]["moth"]["metTurn"] = json!(0);
    game["items"]["lamp"]["holder"] = json!("moth");
    World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack: engine::takes_content(version).then(|| content::current().into()),
    }
}

fn strikes(w: &World) -> Vec<Value> {
    w.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["verb"] == "attack")
        .cloned()
        .collect()
}

fn play(c: &rusqlite::Connection, id: &str, w: &mut World, action: &str) {
    full_store::commit(
        c,
        id,
        w,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
}

#[test]
fn released_level_strikes_replay_and_current_strikes_roll_by_tier_in_the_c_host() {
    let path = std::env::temp_dir().join(format!(
        "card-combat-tiers-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut old = meeting(engine::EIGHTY_SECOND_VERSION, 9);
    full_store::seed(&c, &id, &old, "released-combat", now()).unwrap();
    for op in ["claim", "enter"] {
        full_store::commit(&c, &id, &mut old, json!({"op":op,"actor":"vale"}), now()).unwrap();
    }
    play(&c, &id, &mut old, "threaten:vale:lamp:moth");
    play(&c, &id, &mut old, "attack:vale::moth");
    // Rules 82 compared raw levels: II struck I for three (two through the
    // Brace), and I struck II for one.
    let released: Vec<_> = strikes(&old).iter().map(|e| e["damage"].clone()).collect();
    assert_eq!(released, [json!(2), json!(1)]);

    // Loading moves the world onto the current rules once; the journal's
    // earlier strikes keep the damage their rules gave, with or without the
    // checkpoint.
    let mut upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["log"], quest_free_log(&old.game["log"]));
    assert_saved_actors(&upgraded.game["actors"], &old.game["actors"]);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);

    // On the current rules I and II are one tier: each strike rolls 1 or 2
    // from the run seed and the play, the same roll the browser makes.
    play(&c, &id, &mut upgraded, "attack:vale::moth");
    let revision = upgraded.game["revision"].as_u64().unwrap();
    let seed = upgraded.game["run"]["seed"].as_u64().unwrap();
    let all = strikes(&upgraded);
    for hit in &all[2..] {
        let (actor, target) = (
            hit["actorId"].as_str().unwrap(),
            hit["targetId"].as_str().unwrap(),
        );
        let roll = 1 + run_hash(seed, &format!("strike:{revision}:{actor}:{target}")) % 2;
        let landed = if hit["guarded"] == true {
            roll.saturating_sub(1).max(1)
        } else {
            roll
        };
        assert_eq!(hit["damage"], json!(landed), "{hit}");
        assert_eq!(
            hit["resolveBefore"].as_u64().unwrap() - hit["resolveAfter"].as_u64().unwrap(),
            (landed as u64).min(hit["resolveBefore"].as_u64().unwrap())
        );
    }
    assert!(all.len() > 2);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    drop(c);
    let _ = std::fs::remove_file(path);
}
