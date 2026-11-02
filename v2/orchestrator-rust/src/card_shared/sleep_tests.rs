use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

// Rules 88 slept a sanctuary Wait until the light changed. Its journal
// replays unchanged on its own bundle, and the one recorded upgrade to rules
// 89 leaves the sleeper awake. On rules 89 a Wait is one turn, Sleep follows a
// Wait, a long enough sleep is a long rest, and any other play wakes the
// sleeper first (#2028).
#[test]
fn rules_88_sleep_replays_and_rules_89_sleep_follows_a_wait() {
    let path = std::env::temp_dir().join(format!("card-sleep-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let version = engine::EIGHTY_EIGHTH_VERSION;
    let mut game = engine::reduce_pack(
        version,
        Some(content::released()),
        json!({"op":"create","seed":9}),
    )
    .unwrap()["world"]
        .clone();
    game.as_object_mut().unwrap().remove("opening");
    game["actors"]["vale"]["place"] = json!("attic");
    let pack = engine::takes_content(version).then(|| content::released().into());
    let mut old = World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack,
    };
    full_store::seed(&c, &id, &old, "released-sleep", now()).unwrap();
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    let play = |action: &str| json!({"op":"play","actor":"vale","action":action});
    commit(&mut old, json!({"op":"claim","actor":"vale"}));
    commit(&mut old, json!({"op":"enter","actor":"vale"}));
    commit(&mut old, play("wait:vale::"));
    // Rules 88: the attic Wait sleeps until the light changes.
    assert_eq!(old.game["actors"]["vale"]["sleepUntil"], json!(24));

    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(w.game["log"], old.game["log"]);
    assert!(w.game["actors"]["vale"].get("sleepUntil").is_none());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);

    // Rules 89: Wait is one turn; the Sleep after it lasts until a change.
    let turn = w.game["turn"].as_i64().unwrap();
    commit(&mut w, play("wait:vale::"));
    assert_eq!(w.game["turn"], json!(turn + 1));
    assert!(w.game["actors"]["vale"].get("sleeping").is_none());
    commit(&mut w, play("sleep:vale::"));
    let since = w.game["actors"]["vale"]["sleeping"]["since"].as_i64();
    let woke = |w: &World| {
        w.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .rev()
            .find(|e| e["actorId"] == "vale" && e.get("woke").is_some())
            .cloned()
    };
    for _ in 0..24 {
        if woke(&w).is_some() {
            break;
        }
        assert_eq!(w.game["actors"]["vale"]["sleeping"]["place"], "attic");
        commit(&mut w, play("sleep:vale::"));
    }
    let event = woke(&w).expect("the sleeper wakes");
    assert_eq!(event["verb"], "wait");
    // Half a light period or more in the sanctuary is a long rest.
    let slept = event["turn"].as_i64().unwrap() - since.unwrap();
    assert_eq!(event["rest"] == "long", slept >= 12, "{event}");
    // She woke as the lamp guttered: with one oil left, Sleep is not offered,
    // and the next Wait burns it out and opens the mirror.
    assert_eq!(event["woke"], "lamp");
    let refused = full_store::commit(&c, &id, &mut w.clone(), play("sleep:vale::"), now());
    assert!(refused.is_err());
    commit(&mut w, play("wait:vale::"));
    assert_eq!(w.game["items"]["lamp"]["fuel"], 0);
    // Sleep again, then choose a plain Wait: she wakes first, by choice.
    // Pip may come through the mirror and wake her; she sleeps again.
    let asleep = |w: &World| w.game["actors"]["vale"].get("sleeping").is_some();
    for _ in 0..4 {
        if !asleep(&w) {
            commit(&mut w, play("sleep:vale::"));
        }
    }
    assert!(asleep(&w), "{:?}", woke(&w));
    commit(&mut w, play("wait:vale::"));
    assert_eq!(woke(&w).unwrap()["woke"], "chose");
    assert!(w.game["actors"]["vale"].get("sleeping").is_none());
    assert!(w.game["actors"]["vale"].get("sleeping").is_none());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}
