use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

// Every released version upgrades through the same command, so each one
// proves its own upgrade and the journey runs once, from the newest.
#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn greek_ports_and_roads_upgrade_from_each_released_version() {
    for version in [
        engine::THIRTEENTH_VERSION,
        engine::FOURTEENTH_VERSION,
        engine::FIFTEENTH_VERSION,
        engine::SIXTEENTH_VERSION,
        engine::SEVENTEENTH_VERSION,
    ] {
        upgraded_ports(version);
    }
}

#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn greek_ports_roads_and_waiting_replay_after_the_version_eighteen_upgrade() {
    let (path, c, id, mut w) = upgraded_ports(engine::EIGHTEENTH_VERSION);
    // Black Pond sails only to the Wine-Dark Harbor. Vale carries a load of
    // Travel Provisions from before rules 95, so it stays in play. Laid on
    // deck, it opens the lane to Piraeus (rules 102) and stays aboard; the
    // way home is free. The Long Walls open from either end only with the herald's
    // truce, so she waits at the quays beside the ship.
    assert_eq!(w.game["items"]["greek-provisions"]["holder"], "vale");
    for target in [
        "greek-ship",
        "greek-piraeus",
        "greek-ship",
        "greek-harbor",
        "greek-road-thebes",
        "greek-courtyard",
    ] {
        // Waiting brings the ship; aboard, a port is a voyage of course cards
        // and rounds at sea along the lanes.
        for _ in 0..32 {
            if w.game["actors"]["vale"]["place"] == target {
                break;
            }
            let action = super::sea_steps::toward(&w.project(0).unwrap()["actions"], target);
            if action["kind"] == "wait" || action["kind"] == "course" {
                assert!(
                    target == "greek-ship" || w.game["actors"]["vale"]["place"] == "greek-ship"
                );
            }
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        }
        assert_eq!(w.game["actors"]["vale"]["place"], target);
        if target == "greek-ship" && w.game["transports"]["greek-ship"]["dock"] == "greek-harbor" {
            let view = w.project(0).unwrap();
            let lay = view["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "drop" && a["item"] == "greek-provisions")
                .cloned()
                .expect("the provisions can be laid on deck");
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":lay}),
                now(),
            )
            .unwrap();
            assert_eq!(w.game["items"]["greek-provisions"]["holder"], "greek-ship");
        }
        if target == "greek-piraeus" {
            assert!(!w.project(0).unwrap()["exits"]
                .as_array()
                .unwrap()
                .contains(&json!("greek-road-athens-piraeus")));
        }
    }
    let expected = w.clone();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
}

#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn local_road_visitors_and_belongings_continue_inside_the_town_after_replay() {
    // Athens Harbor has joined Piraeus, so its old road folds into the
    // quays, and the visit continues there: the Long Walls inland wait for
    // the herald's truce (rules 94).
    for (road, port, town) in [(
        "greek-road-athens-harbor",
        "greek-piraeus",
        "greek-road-athens-piraeus",
    )] {
        let path =
            std::env::temp_dir().join(format!("town-travel-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "d".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        let released =
            engine::reduce_version(engine::SIXTEENTH_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::SIXTEENTH_VERSION.into(),
            game: released["world"].clone(),
            claimed: [1, 1, 0, 0, 0, 0, 0, 0],
            present: [1, 1, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        old.game.as_object_mut().unwrap().remove("opening");
        old.game["packs"]["greek-drama"]["scope"] = json!("full");
        for actor in ["vale", "mara"] {
            old.game["actors"][actor]["place"] = json!(road);
        }
        old.game["items"]["lamp"]["holder"] = json!(road);
        full_store::seed(&c, &id, &old, "released-local-road", now()).unwrap();
        let mut w = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(w.game["actors"]["vale"]["place"], port);
        assert_eq!(w.game["actors"]["mara"]["place"], port);
        assert_eq!(w.game["items"]["lamp"]["holder"], port);
        assert_eq!(
            w.game["log"],
            super::full_tests::quest_free_log(&old.game["log"])
        );
        let actions = w.project(0).unwrap()["actions"].clone();
        let actions = actions.as_array().unwrap();
        assert!(!actions
            .iter()
            .any(|a| a["kind"] == "move" && a["target"] == town));
        let action = actions
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
        drop(c);
        let restored = store::open(&path).unwrap();
        assert_eq!(full_store::world(&restored, &id, now()).unwrap(), w);
    }
}

fn upgraded_ports(version: &str) -> (std::path::PathBuf, rusqlite::Connection, String, World) {
    let path = std::env::temp_dir().join(format!("greek-travel-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let released = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: version.into(),
        game: released["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
        pack: None,
    };
    old.game.as_object_mut().unwrap().remove("opening");
    old.game["packs"]["greek-drama"]["scope"] = json!("full");
    for actor in ["vale", "mara"] {
        old.game["actors"][actor]["place"] = json!("greek-harbor");
    }
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    // Vale took the Travel Provisions, so they stay in play (rules 95).
    old.game["items"]["greek-provisions"]["holder"] = json!("vale");
    full_store::seed(&c, &id, &old, "released-ports-fixture", now()).unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    for (id, item) in super::saved_items::current_items(&old.game)
        .as_object()
        .unwrap()
    {
        assert_eq!(&w.game["items"][id], item);
    }
    assert_eq!(
        w.game["packs"]["greek-drama"]["revision"],
        super::full_tests::greek_revision()
    );
    // The upgrade itself replays from the journal.
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w, "{version}");
    (path, c, id, w)
}
