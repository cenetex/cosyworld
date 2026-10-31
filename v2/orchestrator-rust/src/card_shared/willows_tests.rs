use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

// 2026-10-31T12:00:00Z.
const HALLOWEEN: i64 = 1_793_448_000_000;

#[test]
fn utc_date_counts_days_from_the_epoch() {
    assert_eq!(full_store::utc_date(0), "1970-01-01");
    assert_eq!(full_store::utc_date(HALLOWEEN), "2026-10-31");
    assert_eq!(full_store::utc_date(951_782_400_000), "2000-02-29");
    assert_eq!(full_store::utc_date(-1), "1969-12-31");
}

// Every released version upgrades through the same command, so each one
// proves its own upgrade and the journey runs once, from the newest.
#[test]
fn willows_upgrades_from_each_released_version() {
    for version in [engine::SIXTEENTH_VERSION, engine::SEVENTEENTH_VERSION] {
        upgraded_willows(version);
    }
}

#[test]
fn willows_upgrades_version_eighteen_and_replays_discoveries_custody_and_return() {
    let version = engine::EIGHTEENTH_VERSION;
    let (path, c, _, upgraded) = upgraded_willows(version);
    // The River Map starts in the Willows camp. This journey begins with it
    // on the deck, in a world of its own, and plays on 31 October (UTC):
    // with the map aboard the mist rises all day, whatever the clock.
    let mut aboard = upgraded.clone();
    aboard.game["items"]["willows-map"]["holder"] = json!("greek-ship");
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", HALLOWEEN).unwrap();
    full_store::seed(&c, &id, &aboard, "willows-map-aboard", HALLOWEEN).unwrap();
    let mut world = full_store::world(&c, &id, HALLOWEEN).unwrap();
    let willows = |w: &World| {
        w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["kind"] == "move" && a["target"] == "willows-landing")
    };
    let mut checked = false;
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
        // A resident may have called the empty ship away; waiting at the
        // pond brings it back one lane a round.
        if field == "target" && value == "greek-ship" {
            for _ in 0..8 {
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
                    HALLOWEEN,
                )
                .unwrap();
            }
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
            HALLOWEEN,
        )
        .unwrap_or_else(|error| panic!("{version}: {field} {value}: {error}"));
        // On the deck: the recorded day opens the way; by day on another
        // date, without dark mist, the deck shows none.
        if value == "greek-ship" && !checked {
            checked = true;
            assert_eq!(world.game["date"], "2026-10-31");
            assert!(willows(&world));
            let mut ordinary = world.clone();
            ordinary.game["date"] = json!(full_store::utc_date(HALLOWEEN + 86_400_000));
            assert_eq!(ordinary.game["date"], "2026-11-01");
            assert_eq!(world.game["turn"].as_u64().unwrap() / 24 % 2, 0, "by day");
            assert!(!willows(&ordinary));
        }
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
    assert_eq!(world.game["date"], "2026-10-31");
    // Every play recorded its UTC day, so replay needs no clock.
    let undated: i64 = c
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='play' AND json_extract(command,'$.date') IS NOT '2026-10-31'",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(undated, 0);
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
    };
    assert!(old.game["packs"].get("willows").is_none());
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    old.game["transports"]["greek-ship"]["dock"] = json!("pond");
    full_store::seed(&c, &id, &old, "before-willows", now()).unwrap();
    let world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game["turn"], old.game["turn"]);
    for (key, item) in old.game["items"].as_object().unwrap() {
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
