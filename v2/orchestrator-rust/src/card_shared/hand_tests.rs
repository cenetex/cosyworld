use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn threats(world: &World) -> Vec<Value> {
    world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["kind"] == "threaten" && a["target"] == "moth")
        .cloned()
        .collect()
}

#[test]
fn chosen_opponent_item_survives_rules_upgrade_and_journal_replay() {
    let seed = engine::reduce_version(engine::TWENTIETH_VERSION, json!({"op":"create"})).unwrap();
    let mut world = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("station");
    world.game["actors"]["moth"]["place"] = json!("station");
    for item in ["lamp", "oil", "cloth"] {
        world.game["items"][item]["holder"] = json!("moth");
    }
    let old = world.clone();
    assert_eq!(threats(&world).len(), 1);
    let path = std::env::temp_dir().join(format!("hand-choice-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "a".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "chosen-hand-fixture", now()).unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({
            "op":"upgrade", "from":engine::TWENTIETH_VERSION, "to":engine::VERSION
        }),
        now(),
    )
    .unwrap();
    assert_eq!(threats(&old).len(), 1);
    assert_eq!(threats(&world).len(), 3);
    let action = threats(&world)
        .into_iter()
        .find(|a| a["item"] == "oil")
        .unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play", "actor":"vale", "action":action}),
        now(),
    )
    .unwrap();
    assert!(world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["verb"] == "threaten" && e["itemId"] == "oil"));
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    std::fs::remove_file(path).unwrap();
}
