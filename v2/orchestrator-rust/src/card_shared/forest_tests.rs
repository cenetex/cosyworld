use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn forest_crossing_upgrades_from_sixteen_and_replays_with_two_humans() {
    forest_crossing_upgrade_replays_with_two_humans(engine::SIXTEENTH_VERSION);
}

#[test]
fn forest_crossing_upgrades_from_seventeen_and_replays_with_two_humans() {
    forest_crossing_upgrade_replays_with_two_humans(engine::SEVENTEENTH_VERSION);
}

#[test]
fn forest_crossing_upgrades_from_eighteen_and_replays_with_two_humans() {
    forest_crossing_upgrade_replays_with_two_humans(engine::EIGHTEENTH_VERSION);
}

fn forest_crossing_upgrade_replays_with_two_humans(version: &str) {
    let path =
        std::env::temp_dir().join(format!("forest-crossing-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let released = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut w = World {
        version: version.into(),
        game: released["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
        pack: None,
    };
    w.game.as_object_mut().unwrap().remove("opening");
    for actor in ["vale", "mara"] {
        w.game["actors"][actor]["place"] = json!("attic");
    }
    w.game["items"]["cloth"]["holder"] = json!("vale");
    w.game["items"]["lamp"]["holder"] = json!("attic");
    w.game["items"]["lamp"]["lit"] = json!(true);
    w.game["items"]["lamp"]["fuel"] = json!(12);
    full_store::seed(&c, &id, &w, "forest-crossing-two-human-fixture", now()).unwrap();
    assert!(w.game["packs"].get("lonely-forest").is_none());
    // Record an accepted play under the released interpreter before the upgrade.
    let wait = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["kind"] == "wait")
        .unwrap()
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play", "actor":"vale", "action":wait}),
        now(),
    )
    .unwrap();
    assert_eq!(w.version, version);
    let old = w.clone();
    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(w.game["turn"], old.game["turn"]);
    assert_eq!(w.claimed, old.claimed);
    assert_eq!(w.present, old.present);
    // Lonely Forest revision 2 retires the shared buttons and the bell.
    let retired = [
        "forest-story-button",
        "forest-dewbright-button",
        "forest-watch-bell",
    ];
    for (key, value) in super::saved_items::upgraded(&old.game["items"])
        .as_object()
        .unwrap()
    {
        if retired.contains(&key.as_str()) {
            assert!(w.game["items"].get(key).is_none(), "{key}");
        } else {
            assert_eq!(&w.game["items"][key], value);
        }
    }
    assert_eq!(w.game["packs"]["lonely-forest"]["revision"], 3);
    for actor in ["rati", "skull", "whiskerwind", "oak"] {
        assert!(w.game["actors"].get(actor).is_some());
    }
    let move_to = |w: &mut World, actor: &str, index: usize, target: &str| {
        let view = w.project(index).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|action| action["kind"] == "move" && action["target"] == target)
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            w,
            json!({"op":"play", "actor":actor, "action":action}),
            now(),
        )
        .unwrap();
    };
    move_to(&mut w, "mara", 1, "forest-cottage");
    assert_eq!(w.game["items"]["cloth"]["holder"], "vale");
    move_to(&mut w, "vale", 0, "forest-cottage");
    assert_eq!(w.game["actors"]["mara"]["place"], "forest-cottage");
    // Each traveler who meets RATi has their own button hidden elsewhere.
    for who in ["vale", "mara"] {
        let button = &w.game["items"][format!("forest-button-{who}")];
        assert_ne!(button["holder"], "forest-cottage", "{who}");
        assert!(w.game["packs"]["lonely-forest"]["receipts"]
            .get(format!("forest-hide-button-{who}"))
            .is_some());
    }
    let loaded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(loaded, w);
    move_to(&mut w, "mara", 1, "attic");
    let view = w.project(1).unwrap();
    assert!(view["exits"]
        .as_array()
        .unwrap()
        .iter()
        .all(|exit| exit != "forest-cottage"));
    assert_eq!(w.game["items"]["cloth"]["holder"], "vale");
    assert_eq!(w.version, engine::VERSION);
    let expected = w.clone();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
    let upgrades: i64 = c.query_row(
        "SELECT COUNT(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade' AND json_extract(command,'$.from')=? AND json_extract(command,'$.to')=?",
        rusqlite::params![id, version, engine::VERSION], |row| row.get(0),
    ).unwrap();
    assert_eq!(upgrades, 1);
}
