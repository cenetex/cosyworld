use super::{engine, full_store, full_world::World, now, store};
use rusqlite::Connection;
use serde_json::{json, Value};

const PERSONAL_VERSION: &str = "full-card-world/22";
const RELEASED_VERSION: &str = "full-card-world/21";
const PACK: &str = "lonely-forest";
const QUEST: &str = "forest-rati-scarf";
const COTTAGE: &str = "forest-cottage";
const BUTTON: &str = "forest-rati-button-mara";
const REWARD: &str = "forest-rati-scarf-mara";

fn beside_rati(version: &str) -> World {
    let result = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut world = World {
        version: version.into(),
        game: result["world"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    // This seed models a saved avatar already at the cottage before claiming
    // and entering. The entry itself owns meeting and placement evidence.
    world.game["actors"]["mara"]["place"] = json!(COTTAGE);
    assert_eq!(world.game["actors"]["rati"]["place"], COTTAGE);
    world
}

fn database(label: &str, seed: &World) -> (std::path::PathBuf, Connection, String) {
    let path = std::env::temp_dir().join(format!("{label}-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = crate::random_hex(24);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, seed, label, now()).unwrap();
    (path, c, id)
}

fn commit(c: &Connection, id: &str, world: &mut World, op: &str) {
    full_store::commit(c, id, world, json!({"op":op,"actor":"mara"}), now())
        .unwrap_or_else(|error| panic!("{op} under {}: {error}", world.version));
}

fn checkpoint(c: &Connection, id: &str) -> World {
    let text: String = c
        .query_row(
            "SELECT state FROM card_full_checkpoints WHERE world=?",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

fn current_expected(mut world: World) -> World {
    // The fixed-version journal case remains useful after a later release:
    // replay its original entry first, then perform the normal explicit upgrade.
    if engine::historical(&world.version) {
        let from = world.version.clone();
        world
            .apply(&json!({"op":"upgrade","from":from,"to":engine::VERSION}))
            .unwrap();
    }
    world
}

fn assert_reload_and_rebuild(c: &Connection, id: &str, expected: &World) {
    assert_eq!(full_store::world(c, id, now()).unwrap(), *expected);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [id])
        .unwrap();
    assert_eq!(full_store::world(c, id, now()).unwrap(), *expected);
}

#[test]
fn rules_twenty_two_entry_beside_rati_records_personal_placement_and_replays() {
    let seed = beside_rati(PERSONAL_VERSION);
    let (path, c, id) = database("personal-entry-twenty-two", &seed);
    let mut world = seed.clone();
    commit(&c, &id, &mut world, "claim");
    assert_eq!(world.claimed[1], 1);
    assert_eq!(world.present[1], 0);
    assert!(
        world.game["packs"][PACK]["personalQuests"][QUEST]["records"]
            .get("mara")
            .is_none()
    );
    let before = world.clone();

    commit(&c, &id, &mut world, "enter");
    assert_eq!(world.version, PERSONAL_VERSION);
    assert_eq!(world.present, [1, 1, 0, 0, 0, 0, 0, 0]);
    assert_eq!(world.claimed, before.claimed);
    assert_eq!(world.game["actors"], before.game["actors"]);
    assert_eq!(world.game["turn"], before.game["turn"]);
    assert_eq!(
        world.game["revision"],
        before.game["revision"].as_u64().unwrap() + 1
    );
    let personal = &world.game["packs"][PACK]["personalQuests"][QUEST];
    assert_eq!(personal["legacy"], false);
    assert_eq!(personal["version"], 1);
    assert_eq!(personal["records"].as_object().unwrap().len(), 1);
    let record = &personal["records"]["mara"];
    assert_eq!(
        record["meeting"],
        json!({"turn":before.game["turn"],"seq":before.game["eventSeq"],"place":COTTAGE})
    );
    assert_eq!(record["button"]["id"], BUTTON);
    assert_eq!(record["button"]["consumedTurn"], Value::Null);
    assert_eq!(record["button"]["delivery"], Value::Null);
    assert_eq!(record["reward"], json!({"id":REWARD,"awardedTurn":null}));
    let candidates = record["eligiblePlaces"].as_array().unwrap();
    assert!(!candidates.is_empty());
    assert!(candidates
        .windows(2)
        .all(|pair| pair[0].as_str() < pair[1].as_str()));
    for place in candidates {
        assert!(matches!(
            place.as_str(),
            Some("forest-garden" | "forest-trail" | "forest-oak" | "attic" | "station" | "pond")
        ));
    }
    let placed_at = record["button"]["placedAt"].clone();
    assert!(candidates.contains(&placed_at));
    assert_ne!(placed_at, COTTAGE);
    let mut expected_items = before.game["items"].clone();
    expected_items[BUTTON]["holder"] = placed_at;
    assert_eq!(world.game["items"], expected_items);
    assert!(world.game["log"].as_array().unwrap().iter().any(|event| {
        event["kind"] == "narration"
            && event["actorId"] == "mara"
            && event["targetId"] == "rati"
            && event["itemId"] == BUTTON
            && event["locationId"] == COTTAGE
    }));
    world.project(1).unwrap();
    assert_eq!(checkpoint(&c, &id), world);

    // A later entry keeps the first meeting, chosen location, welcome and items.
    let after_entry = world.clone();
    commit(&c, &id, &mut world, "leave");
    commit(&c, &id, &mut world, "enter");
    assert_eq!(world, after_entry);
    assert_eq!(checkpoint(&c, &id), world);
    let expected = current_expected(world);
    assert_reload_and_rebuild(&c, &id, &expected);
    drop(c);
    let c = store::open(&path).unwrap();
    assert_reload_and_rebuild(&c, &id, &expected);
    let entries: i64 = c
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='enter'",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(entries, 2);
}

#[test]
fn released_twenty_one_entry_keeps_its_game_exact_before_upgrade_and_replay() {
    let seed = beside_rati(RELEASED_VERSION);
    assert!(seed.game["packs"][PACK].get("personalQuests").is_none());
    let (path, c, id) = database("personal-entry-released-twenty-one", &seed);
    let mut world = seed.clone();
    commit(&c, &id, &mut world, "claim");
    let before = world.clone();
    commit(&c, &id, &mut world, "enter");
    assert_eq!(world.version, RELEASED_VERSION);
    assert_eq!(world.game, before.game);
    assert_eq!(world.claimed, before.claimed);
    assert_eq!(world.present, [1, 1, 0, 0, 0, 0, 0, 0]);
    assert_eq!(checkpoint(&c, &id), world);

    // Loading follows the same frozen21 entry, then the current saved upgrade.
    let expected = current_expected(world);
    assert_reload_and_rebuild(&c, &id, &expected);
    drop(c);
    let c = store::open(&path).unwrap();
    assert_reload_and_rebuild(&c, &id, &expected);
    let upgrades: i64 = c
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade' AND json_extract(command,'$.from')='full-card-world/21'",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(upgrades, 1);
}
