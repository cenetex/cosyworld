use super::{
    engine, epic_capacity_tests::assert_retained, full_store, full_world::World, now, store,
};
use serde_json::json;

#[test]
fn willows_upgrades_version_sixteen_and_replays_discoveries_custody_and_return() {
    replay_willows(engine::SIXTEENTH_VERSION);
}

#[test]
fn willows_upgrades_version_seventeen_and_replays_discoveries_custody_and_return() {
    replay_willows(engine::SEVENTEENTH_VERSION);
}

#[test]
fn willows_upgrades_version_eighteen_and_replays_discoveries_custody_and_return() {
    replay_willows(engine::EIGHTEENTH_VERSION);
}

fn replay_willows(version: &str) {
    let path = std::env::temp_dir().join(format!("willows-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "a".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let released = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: version.into(),
        game: released["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    assert!(old.game["packs"].get("willows").is_none());
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    old.game["transports"]["greek-ship"]["dock"] = json!("pond");
    full_store::seed(&c, &id, &old, "before-willows", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    for (key, item) in old.game["items"].as_object().unwrap() {
        assert_eq!(&world.game["items"][key], item);
    }
    assert_eq!(world.game["packs"]["willows"]["revision"], 1);
    assert!(world.game["actors"].get("willows-narrator").is_none());
    for (field, value) in [
        ("kind", "light"),
        ("target", "pond"),
        ("target", "greek-ship"),
        ("target", "willows-landing"),
        ("choiceId", "willows-examine-hull"),
        ("target", "willows-camp"),
        ("choiceId", "willows-count-stores"),
        ("target", "willows-swede"),
        ("target", "willows-thicket"),
        ("choiceId", "willows-examine-hollows"),
        ("target", "willows-bank"),
        ("choiceId", "willows-hear-humming"),
        ("choiceId", "willows-look-beneath-roots"),
        ("target", "willows-thicket"),
        ("target", "willows-camp"),
        ("choiceId", "willows-compare-signs"),
        ("item", "willows-rope"),
        ("item", "willows-sheet"),
        ("target", "willows-landing"),
        ("choiceId", "willows-prepare-canoe"),
        ("item", "willows-paddle"),
        ("choiceId", "willows-set-paddle"),
        ("choiceId", "willows-choose-departure"),
        ("target", "greek-ship"),
    ] {
        let view = world.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| {
                a[field] == value
                    && match field {
                        "item" => a["kind"] == "take",
                        "target" if value == "willows-swede" => a["kind"] == "talk",
                        "target" => a["kind"] == "move",
                        _ => true,
                    }
            })
            .unwrap_or_else(|| {
                panic!(
                    "Choose {field} {value} at {}",
                    world.game["actors"]["vale"]["place"]
                )
            })
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut world,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap_or_else(|error| panic!("{version}: {field} {value}: {error}"));
    }
    assert_eq!(world.game["actors"]["vale"]["place"], "greek-ship");
    assert_eq!(
        world.game["actors"]["willows-swede"]["place"],
        "willows-camp"
    );
    assert_eq!(
        world.game["packs"]["willows"]["choices"]["willows-response"],
        "depart"
    );
    for item in ["willows-rope", "willows-sheet", "willows-paddle"] {
        assert_eq!(world.game["items"][item]["holder"], "willows-landing");
    }
    assert_eq!(
        world.project(1).unwrap()["world"]["packs"]["willows"],
        world.game["packs"]["willows"]
    );
    let expected = world.clone();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    drop(c);
    let restored = store::open(&path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
    let upgrades: i64 = restored
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(upgrades, 1);
}

#[test]
fn willows_sky_upgrades_twenty_and_survives_journal_replay() {
    let path = std::env::temp_dir().join(format!("willows-sky-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let released =
        engine::reduce_version(engine::TWENTIETH_VERSION, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: released["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    old.game["actors"]["vale"]["place"] = json!("willows-camp");
    old.game["actors"]["mara"]["place"] = json!("willows-bank");
    old.game["items"]["willows-rope"]["holder"] = json!("mara");
    old.game["turn"] = json!(23);
    old.game["revision"] = json!(23);
    assert!(old.project(0).unwrap()["scene"]["daylight"].is_null());
    full_store::seed(&c, &id, &old, "before-sky", now()).unwrap();
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_retained(&old.game["items"], &world.game["items"], "items");
    assert_retained(&old.game["packs"], &world.game["packs"], "packs");
    let view = world.project(0).unwrap();
    let action = view["actions"]
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
    for actor in [0, 1] {
        let scene = world.project(actor).unwrap()["scene"].clone();
        assert_eq!(scene["daylight"]["phase"], "dusk");
        assert_eq!(scene["weather"]["condition"], "rain");
        assert_eq!(scene["weather"]["region"], "danube");
    }
    for _ in 0..2 {
        for choice in ["willows-put-out-fire", "willows-light-fire"] {
            let view = world.project(0).unwrap();
            let action = view["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["choiceId"] == choice)
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
        }
    }
    assert_eq!(
        world.game["packs"]["willows"]["flags"]["willows-fire-out"],
        false
    );
    let expected = world.clone();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}
