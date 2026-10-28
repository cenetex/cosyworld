use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn regional_weather_agrees_in_c_and_survives_upgrade_and_journal_replay() {
    let path = std::env::temp_dir().join(format!("weather-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let old = engine::reduce_version(engine::TWELFTH_VERSION, json!({"op":"create"})).unwrap();
    let mut saved = World {
        version: engine::TWELFTH_VERSION.into(),
        game: old["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    saved.game.as_object_mut().unwrap().remove("opening");
    saved.game["packs"]["greek-drama"]["scope"] = json!("full");
    saved.game["actors"]["vale"]["place"] = json!("greek-harbor");
    saved.game["actors"]["mara"]["place"] = json!("greek-sanctuary");
    saved.game["turn"] = json!(23);
    saved.game["revision"] = json!(23);
    assert!(saved.project(0).unwrap()["scene"].get("weather").is_none());
    full_store::seed(&c, &id, &saved, "weather-release", now()).unwrap();

    let mut world = full_store::world(&c, &id, now()).unwrap();
    let mut expected = saved.game.clone();
    expected["revision"] = json!(24);
    assert_eq!(world.game, expected);
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
    }
    let context = engine::reduce(json!({
        "op":"context", "world":world.game, "actor":"vale",
        "claimed":["vale","mara"], "present":["vale","mara"]
    }))
    .unwrap();
    assert_eq!(
        context["context"]["weather"],
        world.project(0).unwrap()["scene"]["weather"]
    );
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
