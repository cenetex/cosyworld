use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

// Every released version upgrades through the same command, so each one
// proves its own upgrade and the journey runs once, from the newest.
#[test]
fn willows_upgrades_from_each_released_version() {
    for version in [engine::SIXTEENTH_VERSION, engine::SEVENTEENTH_VERSION] {
        upgraded_willows(version);
    }
}

#[test]
fn willows_upgrades_version_eighteen_and_replays_observed_signs_custody_and_return() {
    let version = engine::EIGHTEENTH_VERSION;
    let (path, c, id, mut world) = upgraded_willows(version);
    // The released save keeps its unlit lamp, and a dark lamp already opens
    // the attic mirror (#1600), so the journey starts by stepping through.
    for (field, value) in [
        ("target", "pond"),
        ("target", "greek-ship"),
        ("target", "willows-landing"),
        ("observe", "willows-examine-hull"),
        ("target", "willows-camp"),
        ("observe", "willows-count-stores"),
        ("target", "willows-swede"),
        ("target", "willows-thicket"),
        ("observe", "willows-examine-hollows"),
        ("target", "willows-bank"),
        ("observe", "willows-hear-humming"),
        ("observe", "willows-look-beneath-roots"),
        ("target", "willows-thicket"),
        ("target", "willows-camp"),
        ("observe", "willows-compare-signs"),
        ("item", "willows-rope"),
        ("item", "willows-sheet"),
        ("target", "willows-landing"),
        ("choiceId", "willows-prepare-canoe"),
        ("item", "willows-paddle"),
        ("choiceId", "willows-set-paddle"),
        ("choiceId", "willows-choose-departure"),
        ("target", "greek-ship"),
    ] {
        // The Willows crossings open only on a misty night with the ship at
        // Black Pond (turns 120-131, then 264-275, ...). The journey waits for
        // the way; a resident may also have called the empty ship away, and
        // waiting brings it back one lane a round.
        if field == "target" && (value == "greek-ship" || value == "willows-landing") {
            for _ in 0..200 {
                let view = world.project(0).unwrap();
                let actions = view["actions"].as_array().unwrap();
                if actions
                    .iter()
                    .any(|a| a["kind"] == "move" && a["target"] == value)
                {
                    break;
                }
                let wait = actions
                    .iter()
                    .find(|a| a["kind"] == "wait")
                    .unwrap()
                    .clone();
                full_store::commit(
                    &c,
                    &id,
                    &mut world,
                    json!({"op":"play","actor":"vale","action":wait}),
                    now(),
                )
                .unwrap();
            }
        }
        // Observe (the Wait play) notices one sign at a time.
        if field == "observe" {
            for _ in 0..16 {
                if world.game["packs"]["willows"]["receipts"]
                    .get(value)
                    .is_some()
                {
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
                full_store::commit(
                    &c,
                    &id,
                    &mut world,
                    json!({"op":"play","actor":"vale","action":wait}),
                    now(),
                )
                .unwrap();
            }
            assert!(
                world.game["packs"]["willows"]["receipts"]
                    .get(value)
                    .is_some(),
                "{value}"
            );
            continue;
        }
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

fn upgraded_willows(version: &str) -> (std::path::PathBuf, rusqlite::Connection, String, World) {
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
        pack: None,
    };
    assert!(old.game["packs"].get("willows").is_none());
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    old.game["transports"]["greek-ship"]["dock"] = json!("pond");
    // Begin just before the first misty night at the pond (turn 120).
    old.game["turn"] = json!(117);
    old.game["revision"] = json!(117);
    full_store::seed(&c, &id, &old, "before-willows", now()).unwrap();
    let world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    for (key, item) in super::saved_items::upgraded(&old.game["items"])
        .as_object()
        .unwrap()
    {
        assert_eq!(&world.game["items"][key], item);
    }
    assert_eq!(world.game["packs"]["willows"]["revision"], 1);
    assert!(world.game["actors"].get("willows-narrator").is_none());
    // The upgrade itself replays from the journal.
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(
        full_store::world(&c, &id, now()).unwrap(),
        world,
        "{version}"
    );
    (path, c, id, world)
}
