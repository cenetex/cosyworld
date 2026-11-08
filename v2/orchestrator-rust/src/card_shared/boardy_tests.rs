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
fn boardy_station_card_opens_the_authored_parlour_door() {
    let mut world = World::create(None).unwrap();
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("station");
    world.game["items"]["lamp"]["holder"] = json!("vale");
    world.game["items"]["lamp"]["lit"] = json!(false);
    for actor in ["vale", "mara"] {
        world.apply(&json!({"op":"claim", "actor":actor})).unwrap();
        world.apply(&json!({"op":"enter", "actor":actor})).unwrap();
    }
    let content: Value = serde_json::from_str(super::content::current_text()).unwrap();
    let crossings = content["files"]["v2/card-game/boardyai.json"]["crossings"]
        .as_array()
        .unwrap();
    let entrance = crossings
        .iter()
        .find(|c| c["id"] == "station-boardyai-parlour")
        .unwrap();
    let doorway = entrance["from"].as_str().unwrap();
    assert!(["station", "attic"].contains(&doorway));
    assert_eq!(entrance["to"], "boardyai-parlour");
    let return_door = crossings
        .iter()
        .find(|c| c["id"] == "boardyai-parlour-station")
        .unwrap();
    assert_eq!(return_door["to"], doorway);
    let mut journey = vec![("take", "item", "boardyai-calling-card", "station")];
    if doorway == "attic" {
        journey.extend([
            ("light", "item", "lamp", "station"),
            ("move", "target", "pond", "pond"),
            ("move", "target", "attic", "attic"),
        ]);
    }
    journey.extend([
        ("move", "target", "boardyai-parlour", "boardyai-parlour"),
        ("move", "target", doorway, doorway),
    ]);
    for (kind, field, value, destination) in journey {
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
        pack: None,
    };
    assert!(old.game["actors"].get("boardyai").is_none());
    full_store::seed(&c, &id, &old, "before-boardy", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    for (key, value) in super::saved_items::upgraded(&old.game["items"])
        .as_object()
        .unwrap()
    {
        assert_eq!(&world.game["items"][key], value);
    }
    assert_eq!(
        world.game["items"]["boardyai-calling-card"]["holder"],
        "station"
    );
    assert_eq!(
        world.game["log"],
        super::full_tests::quest_free_log(&old.game["log"])
    );
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

// Boardy no longer runs an introduction quest. A want to meet a person sends
// him along the open roads, and the Talk there meets it in the C host.
#[test]
fn boardy_follows_a_want_to_meet_a_human_in_the_c_host() {
    let mut world = World::create(None).unwrap();
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("station");
    world.game["actors"]["mara"]["place"] = json!("pond");
    world.game["actors"]["boardyai"]["want"] =
        json!({"kind":"person","target":"mara","since":0,"refusals":0});
    for actor in ["vale", "mara"] {
        world.apply(&json!({"op":"claim", "actor":actor})).unwrap();
        world.apply(&json!({"op":"enter", "actor":actor})).unwrap();
    }
    let met = |world: &World| {
        world.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["verb"] == "want_met" && e["actorId"] == "boardyai")
            .count()
    };
    for _ in 0..8 {
        if met(&world) > 0 {
            break;
        }
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
        assert_eq!(world.game["actors"]["vale"]["place"], "station");
        assert_eq!(world.game["actors"]["mara"]["place"], "pond");
    }
    if met(&world) == 0 {
        // Mara answers when he has reached her.
        assert_eq!(world.game["actors"]["boardyai"]["place"], "pond");
        let view = world.project(1).unwrap();
        let talk = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "talk" && a["target"] == "boardyai")
            .unwrap()
            .clone();
        world
            .apply(&json!({"op":"play", "actor":"mara", "action":talk}))
            .unwrap();
    }
    assert_eq!(met(&world), 1);
    assert_eq!(world.game["actors"]["boardyai"]["xp"], 1);
    assert!(world.game["actors"]["boardyai"]["talked"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
}

#[test]
fn released_boardy_searches_with_the_original_station_door() {
    let seed = engine::reduce_version(engine::SEVENTEENTH_VERSION, json!({"op":"create"})).unwrap();
    let world = World {
        version: engine::SEVENTEENTH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: None,
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
        pack: None,
    };
    full_store::seed(&c, &id, &old, "before-introductions", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    assert_eq!(
        world.game["actors"]["boardyai"]["place"],
        old.game["actors"]["boardyai"]["place"]
    );
    for (key, item) in super::saved_items::upgraded(&old.game["items"])
        .as_object()
        .unwrap()
    {
        assert_eq!(&world.game["items"][key], item, "saved item {key}");
    }
    assert_eq!(
        world.game["log"],
        super::full_tests::quest_free_log(&old.game["log"])
    );
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
    // Introduction visits were quest machinery; the upgrade drops them.
    assert!(world.game.get("introductionVisits").is_none());
    assert!(world.game["actors"]["boardyai"].get("want").is_some());
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

#[test]
fn historical_presence_commands_leave_game_bytes_unchanged() {
    let text = include_str!("../../../../test/fixtures/card-content-rules-125.json");
    let hash = super::content::hash(text);
    let c = rusqlite::Connection::open_in_memory().unwrap();
    full_store::schema(&c).unwrap();
    c.execute(
        "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        rusqlite::params![hash, "rules125", text],
    )
    .unwrap();
    super::content::preload(&c, &hash).unwrap();
    let version = "full-card-world/125";
    let game =
        engine::reduce_pack(version, Some(&hash), json!({"op":"create"})).unwrap()["world"].clone();
    let mut world = World {
        version: version.into(),
        game: game.clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [0; 8],
        pack: Some(hash),
    };
    for (op, actor) in [
        ("enter", "vale"),
        ("enter", "mara"),
        ("leave", "mara"),
        ("enter", "mara"),
        ("release", "mara"),
    ] {
        world.apply(&json!({"op":op,"actor":actor})).unwrap();
        assert_eq!(world.game, game, "historical {actor} {op}");
    }
}

#[test]
fn station_presence_admission_survives_checkpoint_free_replay() {
    let path = std::env::temp_dir().join(format!("station-slots-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut world = World::create(None).unwrap();
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("station");
    world.game["actors"]["mara"]["place"] = json!("pond");
    world.game["doors"]["pavilion"] = json!("station");
    world.game["items"]["routes"]["holder"] = json!("station");
    world.game["items"]["board"]["holder"] = json!("mara");
    world.game["items"]["boardyai-calling-card"]["holder"] = json!("station");
    world.game["stationExitOrder"] = json!([]);
    full_store::seed(&c, &id, &world, "station-presence", now()).unwrap();
    let commit = |world: &mut World, command: Value| {
        full_store::commit(&c, &id, world, command, now()).unwrap();
    };
    for actor in ["vale", "mara"] {
        for op in ["claim", "enter"] {
            commit(&mut world, json!({"op":op,"actor":actor}));
        }
    }
    let order = |world: &World| world.game["stationExitOrder"].clone();
    assert_eq!(order(&world), json!(["train", "boardyai-parlour"]));
    let before = world.clone();
    world.project(0).unwrap();
    world.project(1).unwrap();
    assert_eq!(world, before, "views do not admit exits");
    let action = world.project(1).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "move" && a["target"] == "station")
        .unwrap()
        .clone();
    let play = json!({"op":"play","actor":"mara","action":action});
    commit(&mut world, play);
    assert_eq!(
        order(&world),
        json!(["train", "boardyai-parlour", "pavilion"])
    );
    for (op, expected) in [
        ("leave", json!(["train", "pavilion"])),
        ("enter", json!(["train", "pavilion", "boardyai-parlour"])),
    ] {
        commit(&mut world, json!({"op":op,"actor":"mara"}));
        assert_eq!(world.game["stationExitOrder"], expected);
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
}
