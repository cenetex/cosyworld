use super::{full_store, full_world::World, now, store};
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
fn boardy_calling_card_opens_the_authored_parlour_door() {
    let mut world = World::create(None).unwrap();
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("station");
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
    assert_eq!(doorway, "behind-station");
    assert_eq!(entrance["to"], "boardyai-parlour");
    let return_door = crossings
        .iter()
        .find(|c| c["id"] == "boardyai-parlour-station")
        .unwrap();
    assert_eq!(return_door["to"], doorway);
    let journey = [
        ("move", "target", doorway, doorway),
        ("take", "item", "boardyai-calling-card", doorway),
        ("move", "target", "boardyai-parlour", "boardyai-parlour"),
        ("move", "target", doorway, doorway),
    ];
    for (step, (kind, field, value, destination)) in journey.into_iter().enumerate() {
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
            if step == 0 { doorway } else { "vale" }
        );
    }
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
    // He walks at the dwell pace (rules 133), so wait for him, not for a count.
    for _ in 0..120 {
        if met(&world) > 0 || world.game["actors"]["boardyai"]["place"] == "pond" {
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
fn parlour_presence_and_station_exits_survive_checkpoint_free_replay() {
    let path = std::env::temp_dir().join(format!("parlour-doors-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut world = World::create(None).unwrap();
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["actors"]["vale"]["place"] = json!("behind-station");
    world.game["actors"]["mara"]["place"] = json!("pond");
    world.game["doors"]["pavilion"] = json!("station");
    world.game["items"]["routes"]["holder"] = json!("station");
    world.game["items"]["board"]["holder"] = json!("mara");
    world.game["stationExitOrder"] = json!([]);
    full_store::seed(&c, &id, &world, "parlour-presence", now()).unwrap();
    let commit = |world: &mut World, command: Value| {
        full_store::commit(&c, &id, world, command, now()).unwrap();
    };
    let parlour_open = |world: &World| {
        world.project(0).unwrap()["exits"]
            .as_array()
            .unwrap()
            .iter()
            .any(|exit| exit == "boardyai-parlour")
    };
    for op in ["claim", "enter"] {
        commit(&mut world, json!({"op":op,"actor":"vale"}));
    }
    assert!(!parlour_open(&world));
    for (op, open) in [("claim", false), ("enter", true)] {
        commit(&mut world, json!({"op":op,"actor":"mara"}));
        assert_eq!(parlour_open(&world), open);
    }
    assert_eq!(world.game["stationExitOrder"], json!(["train"]));
    let before = world.clone();
    world.project(0).unwrap();
    world.project(1).unwrap();
    assert_eq!(world, before, "views do not admit exits");
    let view = world.project(1).unwrap();
    let action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "move" && a["target"] == "station")
        .unwrap();
    commit(
        &mut world,
        json!({"op":"play","actor":"mara","action":action}),
    );
    assert_eq!(world.game["stationExitOrder"], json!(["train", "pavilion"]));
    for (op, open) in [("leave", false), ("enter", true)] {
        commit(&mut world, json!({"op":op,"actor":"mara"}));
        assert_eq!(parlour_open(&world), open);
        assert_eq!(world.game["stationExitOrder"], json!(["train", "pavilion"]));
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    let replayed = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(replayed, world);
    assert!(parlour_open(&replayed));
}
