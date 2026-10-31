use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn regional_weather_agrees_in_c_and_survives_upgrade_and_journal_replay() {
    let path = std::env::temp_dir().join(format!("weather-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let old = engine::reduce_version(engine::FOURTEENTH_VERSION, json!({"op":"create"})).unwrap();
    let mut saved = World {
        version: engine::FOURTEENTH_VERSION.into(),
        game: old["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    saved.game.as_object_mut().unwrap().remove("opening");
    saved.game["packs"]["greek-drama"]["scope"] = json!("full");
    saved.game["actors"]["vale"]["place"] = json!("greek-harbor");
    saved.game["actors"]["mara"]["place"] = json!("greek-sanctuary");
    saved.game["actors"]["greek-rhapsode"]["place"] = json!("attic");
    saved.game["turn"] = json!(22);
    saved.game["revision"] = json!(22);
    saved.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    // A released play installs that version's quest collections for each actor.
    let action = saved.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    saved
        .apply(&json!({"op":"play", "actor":"vale", "action":action}))
        .unwrap();
    assert!(saved.project(0).unwrap()["scene"].get("weather").is_none());
    full_store::seed(&c, &id, &saved, "weather-release", now()).unwrap();

    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(
        world.game["revision"],
        saved.game["revision"].as_u64().unwrap() + 1
    );
    let old_routes = saved.game["routeKnowledge"]["greek-rhapsode"]
        .as_array()
        .unwrap();
    assert!(old_routes.contains(&json!(["attic", "station"])));
    let routes = world.game["routeKnowledge"]["greek-rhapsode"]
        .as_array()
        .unwrap();
    assert!(routes.contains(&json!(["attic", "pond"])));
    assert!(routes.contains(&json!(["pond", "station"])));
    assert!(!routes.contains(&json!(["attic", "station"])));
    super::sea_steps::assert_upgraded_ship(&world.game, &saved.game);
    for field in ["turn", "eventSeq"] {
        assert_eq!(world.game[field], saved.game[field], "saved {field}");
    }
    assert_eq!(
        world.game["log"],
        super::full_tests::quest_free_log(&saved.game["log"])
    );
    for (key, item) in super::saved_items::upgraded(&saved.game["items"])
        .as_object()
        .unwrap()
    {
        assert_eq!(&world.game["items"][key], item, "saved item {key}");
    }
    assert_eq!(
        world.game["packs"]["hoppycat-archive"]["revision"],
        super::full_tests::pack_revision("hoppycat-archive")
    );
    super::full_tests::assert_saved_actors(&world.game["actors"], &saved.game["actors"]);
    super::full_tests::assert_saved_memories(&world.game["memories"], &saved.game["memories"]);
    // The released quest collections are dropped by the upgrade.
    assert!(world.game.get("quests").is_none());
    assert_eq!(
        world.game["packs"]["greek-drama"]["revision"],
        super::full_tests::greek_revision()
    );
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(
        world.project(0).unwrap()["scene"]["weather"]["condition"],
        "cloud"
    );
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
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    for (actor, variant) in [(0, "rain-coast"), (1, "rain-grove")] {
        let view = world.project(actor).unwrap();
        let weather = &view["scene"]["weather"];
        assert_eq!(weather["region"], "boeotia");
        assert_eq!(weather["condition"], "rain");
        assert_eq!(weather["variant"], variant);
        assert_eq!(view["scene"]["daylight"]["phase"], "night");
        assert!(view["scene"]["background"]
            .as_str()
            .unwrap()
            .ends_with("-night.webp"));
    }
    assert_eq!(
        world.project(0).unwrap()["scene"]["background"],
        "./assets/greek-drama/harbor-ship-at-berth-night.webp"
    );
    let context = engine::reduce(json!({
        "op":"context", "world":world.game, "actor":"vale",
        "claimed":["vale","mara"], "present":["vale","mara"]
    }))
    .unwrap();
    let weather = world.project(0).unwrap()["scene"]["weather"].clone();
    let place = context["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["id"] == "greek-harbor")
        .unwrap();
    assert!(place["facts"].as_array().unwrap().contains(&json!(format!(
        "Weather: {}.",
        weather["condition"].as_str().unwrap()
    ))));
    assert!(place["facts"]
        .as_array()
        .unwrap()
        .contains(&json!("It is night in Thebes.")));
    let ids = vec!["vale".to_string()];
    crate::routes::card_game::narrative::browser::prepare(&context["context"], Some(&ids), None)
        .unwrap();
    let views = [world.project(0).unwrap(), world.project(1).unwrap()];
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let replay = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(replay, world);
    assert_eq!(replay.project(0).unwrap(), views[0]);
    assert_eq!(replay.project(1).unwrap(), views[1]);
    drop(c);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn harbor_night_views_follow_the_shared_ship_and_replay_from_version_seventeen() {
    let path = std::env::temp_dir().join(format!("harbor-night-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let seed = engine::reduce_version(engine::SEVENTEENTH_VERSION, json!({"op":"create"})).unwrap();
    let mut saved = World {
        version: engine::SEVENTEENTH_VERSION.into(),
        game: seed["world"].clone(),
        claimed: [1, 1, 1, 0, 0, 0, 0, 0],
        present: [1, 1, 1, 0, 0, 0, 0, 0],
    };
    saved.game.as_object_mut().unwrap().remove("opening");
    saved.game["packs"]["greek-drama"]["scope"] = json!("full");
    for (actor, place) in [
        ("vale", "greek-athens-harbor"),
        ("mara", "pond"),
        ("ash", "greek-road-thebes"),
        ("greek-rhapsode", "attic"),
    ] {
        saved.game["actors"][actor]["place"] = json!(place);
    }
    saved.game["turn"] = json!(22);
    saved.game["revision"] = json!(22);
    saved.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    // Black Pond sails only to the Wine-Dark Harbor, where the ship waits
    // with the Travel Provisions on deck. They open the lane to Piraeus.
    saved.game["transports"]["greek-ship"]["dock"] = json!("greek-harbor");
    saved.game["items"]["greek-provisions"]["holder"] = json!("greek-ship");
    // Ash waits on the road under the released rules. A wait away from any
    // port leaves the empty ship at the Wine-Dark Harbor.
    let old_wait = saved.project(2).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    saved
        .apply(&json!({"op":"play","actor":"ash","action":old_wait}))
        .unwrap();
    assert_eq!(
        saved.game["transports"]["greek-ship"]["dock"],
        "greek-harbor"
    );
    full_store::seed(&c, &id, &saved, "before-harbor-nights", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.game["revision"], json!(24));
    for field in ["turn", "eventSeq", "log"] {
        assert_eq!(world.game[field], saved.game[field], "saved {field}");
    }
    super::sea_steps::assert_upgraded_ship(&world.game, &saved.game);
    assert_eq!(world.game["transports"]["greek-ship"]["phase"], "docked");
    for (id, item) in super::saved_items::upgraded(&saved.game["items"])
        .as_object()
        .unwrap()
    {
        assert_eq!(&world.game["items"][id], item, "saved item {id}");
    }
    // The Theban Harbor Road is a real road again, so Ash stays on it.
    assert_eq!(world.game["actors"]["ash"]["place"], "greek-road-thebes");
    super::full_tests::assert_saved_actors(&world.game["actors"], &saved.game["actors"]);
    super::full_tests::assert_saved_memories(&world.game["memories"], &saved.game["memories"]);
    assert_eq!(
        world.game["packs"]["greek-drama"]["revision"],
        super::full_tests::greek_revision()
    );
    assert_eq!(
        world.game["packs"]["hoppycat-archive"]["revision"],
        super::full_tests::pack_revision("hoppycat-archive")
    );
    assert_eq!(world.game["packs"]["willows"]["revision"], 1);
    assert!(world.game["knowledge"].is_object());
    assert_eq!(world.version, engine::VERSION);

    // Her wait at the pond brings the empty ship one lane to her. She
    // boards and sails by the Wine-Dark Harbor to Piraeus, opened by the
    // provisions aboard, a round at sea each, and steps ashore. Vale's wait
    // at Athens Harbor brings the empty ship to her berth, and Mara walks on.
    let plays = [
        ("mara", "wait", None),
        ("mara", "move", Some("greek-ship")),
        ("mara", "course", Some("greek-harbor")),
        ("mara", "wait", None),
        ("mara", "course", Some("greek-piraeus")),
        ("mara", "wait", None),
        ("mara", "move", Some("greek-piraeus")),
        ("vale", "wait", None),
        ("mara", "move", Some("greek-road-athens-piraeus")),
        ("mara", "move", Some("greek-athens")),
        ("mara", "move", Some("greek-athens-harbor")),
    ];
    for (step, (actor, kind, target)) in plays.into_iter().enumerate() {
        let action = world.project(usize::from(actor == "mara")).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind && target.is_none_or(|to| a["target"] == to))
            .unwrap_or_else(|| panic!("{actor} {kind} {target:?}"))
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut world,
            json!({"op":"play","actor":actor,"action":action}),
            now(),
        )
        .unwrap();
        let views = [
            world.project(0).unwrap(),
            world.project(1).unwrap(),
            world.project(2).unwrap(),
        ];
        assert_eq!(views[0]["scene"]["daylight"]["phase"], "night");
        assert_eq!(
            views[2]["scene"]["background"],
            "./assets/greek-drama/theban-harbor-road-night.webp"
        );
        if step == 0 {
            assert_eq!(world.game["transports"]["greek-ship"]["dock"], "pond");
        }
        if step < 7 {
            assert_eq!(
                views[0]["scene"]["background"],
                "./assets/greek-drama/athens-harbor-open-berth-night.webp"
            );
        } else {
            assert_eq!(
                world.game["transports"]["greek-ship"]["dock"],
                "greek-athens-harbor"
            );
            assert_eq!(
                views[0]["scene"]["background"],
                "./assets/greek-drama/athens-harbor-ship-at-berth-night.webp"
            );
        }
        if step == plays.len() - 1 {
            assert_eq!(
                views[1]["scene"]["background"],
                views[0]["scene"]["background"]
            );
        }
    }
    let views = [
        world.project(0).unwrap(),
        world.project(1).unwrap(),
        world.project(2).unwrap(),
    ];
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let replay = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(replay, world);
    for (actor, view) in views.iter().enumerate() {
        assert_eq!(&replay.project(actor).unwrap(), view);
    }
    drop(c);
    std::fs::remove_file(path).unwrap();
}
