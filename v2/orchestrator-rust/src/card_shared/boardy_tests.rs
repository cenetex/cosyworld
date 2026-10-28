use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn boardy_talk(view: &Value) -> Option<Value> {
    view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "talk" && a["target"] == "boardyai")
        .cloned()
}

#[test]
fn boardy_follows_authenticated_presence_in_the_c_host() {
    let mut world = World::create(None).unwrap();
    for actor in ["vale", "mara"] {
        world.apply(&json!({"op":"claim", "actor":actor})).unwrap();
        world.apply(&json!({"op":"enter", "actor":actor})).unwrap();
    }
    let together = world.project(0).unwrap();
    assert!(boardy_talk(&together).is_some());
    assert_eq!(
        together["world"]["actors"]["boardyai"]["place"],
        together["world"]["actors"]["vale"]["place"]
    );
    assert_eq!(
        together["world"]["actors"]["boardyai"],
        world.project(1).unwrap()["world"]["actors"]["boardyai"]
    );
    let before = world.game["actors"]["mara"]["place"].clone();
    world
        .apply(&json!({"op":"play", "actor":"vale", "action":boardy_talk(&together).unwrap()}))
        .unwrap();
    assert_eq!(world.game["actors"]["mara"]["place"], before);
    world.apply(&json!({"op":"leave", "actor":"mara"})).unwrap();
    assert!(boardy_talk(&world.project(0).unwrap()).is_none());
    world.apply(&json!({"op":"enter", "actor":"mara"})).unwrap();
    assert!(boardy_talk(&world.project(0).unwrap()).is_some());
}

#[test]
fn boardy_calling_card_opens_the_parlour_from_black_pond() {
    let mut world = World::create(None).unwrap();
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("pond");
    for actor in ["vale", "mara"] {
        world.apply(&json!({"op":"claim", "actor":actor})).unwrap();
        world.apply(&json!({"op":"enter", "actor":actor})).unwrap();
    }
    for (kind, field, value, destination) in [
        ("take", "item", "boardyai-calling-card", "pond"),
        ("move", "target", "boardyai-parlour", "boardyai-parlour"),
        ("move", "target", "pond", "pond"),
    ] {
        let view = world.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind && a[field] == value)
            .unwrap()
            .clone();
        world
            .apply(&json!({"op":"play", "actor":"vale", "action":action}))
            .unwrap();
        assert_eq!(world.game["actors"]["vale"]["place"], destination);
        assert_eq!(
            world.game["items"]["boardyai-calling-card"]["holder"],
            "vale"
        );
    }
}

#[test]
fn boardy_upgrade_from_twelve_survives_checkpoints_and_journal_replay() {
    assert_boardy_upgrade(engine::TWELFTH_VERSION);
}

#[test]
fn boardy_upgrade_from_thirteen_survives_checkpoints_and_journal_replay() {
    assert_boardy_upgrade(engine::THIRTEENTH_VERSION);
}

fn assert_boardy_upgrade(version: &str) {
    let path = std::env::temp_dir().join(format!("boardy-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let seed = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let old = World {
        version: version.into(),
        game: seed["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    assert!(old.game["actors"].get("boardyai").is_none());
    full_store::seed(&c, &id, &old, "before-boardy", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    for (key, value) in old.game["items"].as_object().unwrap() {
        assert_eq!(&world.game["items"][key], value);
    }
    assert_eq!(
        world.game["items"]["boardyai-calling-card"]["holder"],
        "pond"
    );
    assert_eq!(world.game["log"], old.game["log"]);
    assert!(boardy_talk(&world.project(0).unwrap()).is_some());
    let action = boardy_talk(&world.project(0).unwrap()).unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play", "actor":"vale", "action":action}),
        now(),
    )
    .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
}
