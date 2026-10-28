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
    // The closed attic keeps this presence check in one room.
    world.game["actors"]["vale"]["place"] = json!("attic");
    world.game["actors"]["boardyai"]["place"] = world.game["actors"]["vale"]["place"].clone();
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
    assert!(world.game["actors"]["boardyai"].is_object());
    let action = world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
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

#[test]
fn boardy_searches_and_alternates_visits_in_the_c_host() {
    assert_boardy_search_visits(
        World::create(None).unwrap(),
        ["pond", "station", "pond", "station", "pond", "station"],
    );
}

#[test]
fn released_boardy_searches_with_the_original_station_door() {
    let seed = engine::reduce_version(engine::SEVENTEENTH_VERSION, json!({"op":"create"})).unwrap();
    let world = World {
        version: engine::SEVENTEENTH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
    };
    assert_boardy_search_visits(
        world,
        ["station", "attic", "station", "pond", "station", "pond"],
    );
}

fn assert_boardy_search_visits(mut world: World, expected: [&str; 6]) {
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("station");
    world.game["actors"]["mara"]["place"] = json!("pond");
    for actor in ["vale", "mara"] {
        world.apply(&json!({"op":"claim", "actor":actor})).unwrap();
        world.apply(&json!({"op":"enter", "actor":actor})).unwrap();
    }
    let mut path = Vec::new();
    for _ in 0..6 {
        let view = world.project(0).unwrap();
        let wait = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        world
            .apply(&json!({"op":"play", "actor":"vale", "action":wait}))
            .unwrap();
        path.push(
            world.game["actors"]["boardyai"]["place"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
        assert_eq!(world.game["actors"]["vale"]["place"], "station");
        assert_eq!(world.game["actors"]["mara"]["place"], "pond");
    }
    assert_eq!(path, expected);
    assert_eq!(
        world.game["memories"]["boardyai"]["seen"]["mara"]["place"],
        "pond"
    );
    let key = world.game["life"]["actors"]["boardyai"]["collection"]["active"]
        .as_str()
        .unwrap()
        .to_owned();
    let view = world.project(1).unwrap();
    let meet = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "move" && a["target"] == "station")
        .unwrap()
        .clone();
    world
        .apply(&json!({"op":"play", "actor":"mara", "action":meet}))
        .unwrap();
    assert_eq!(
        world.game["quests"]["records"][&key]["completedTurn"],
        world.game["turn"]
    );
    assert_eq!(world.game["life"]["actors"]["boardyai"]["restLeft"], 3);
}

#[test]
fn boardy_version_sixteen_upgrade_preserves_sightings_and_replays() {
    let path =
        std::env::temp_dir().join(format!("boardy-sixteen-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let seed = engine::reduce_version(engine::SIXTEENTH_VERSION, json!({"op":"create"})).unwrap();
    let old = World {
        version: engine::SIXTEENTH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    full_store::seed(&c, &id, &old, "before-introductions", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    assert_eq!(
        world.game["actors"]["boardyai"]["place"],
        old.game["actors"]["boardyai"]["place"]
    );
    for (key, item) in old.game["items"].as_object().unwrap() {
        assert_eq!(&world.game["items"][key], item, "saved item {key}");
    }
    assert_eq!(world.game["log"], old.game["log"]);
    for _ in 0..4 {
        let view = world.project(0).unwrap();
        let wait = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut world,
            json!({"op":"play", "actor":"vale", "action":wait}),
            now(),
        )
        .unwrap();
    }
    assert!(world.game["introductionVisits"]["boardyai"].is_object());
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
}

#[test]
fn one_connected_human_keeps_the_normal_turn_loop() {
    let mut world = World::create(None).unwrap();
    world.apply(&json!({"op":"claim", "actor":"vale"})).unwrap();
    world.apply(&json!({"op":"enter", "actor":"vale"})).unwrap();
    for _ in 0..3 {
        let view = world.project(0).unwrap();
        let wait = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        world
            .apply(&json!({"op":"play", "actor":"vale", "action":wait}))
            .unwrap();
    }
    assert_eq!(world.game["turn"], 3);
}
