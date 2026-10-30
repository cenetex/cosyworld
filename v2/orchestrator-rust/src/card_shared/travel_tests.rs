use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn greek_ports_roads_and_waiting_replay_after_the_version_thirteen_upgrade() {
    replay_journey(engine::THIRTEENTH_VERSION);
}

#[test]
fn greek_ports_roads_and_waiting_replay_after_the_version_fourteen_upgrade() {
    replay_journey(engine::FOURTEENTH_VERSION);
}

#[test]
fn greek_ports_roads_and_waiting_replay_after_the_version_fifteen_upgrade() {
    replay_journey(engine::FIFTEENTH_VERSION);
}

#[test]
fn greek_ports_roads_and_waiting_replay_after_the_version_sixteen_upgrade() {
    replay_journey(engine::SIXTEENTH_VERSION);
}

#[test]
fn greek_ports_roads_and_waiting_replay_after_the_version_seventeen_upgrade() {
    replay_journey(engine::SEVENTEENTH_VERSION);
}

#[test]
fn greek_ports_roads_and_waiting_replay_after_the_version_eighteen_upgrade() {
    replay_journey(engine::EIGHTEENTH_VERSION);
}

#[test]
fn local_road_visitors_and_belongings_continue_inside_the_town_after_replay() {
    for (road, port, town) in [
        ("greek-road-thebes", "greek-harbor", "greek-courtyard"),
        (
            "greek-road-athens-harbor",
            "greek-athens-harbor",
            "greek-athens",
        ),
    ] {
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
        assert_eq!(w.game["log"], old.game["log"]);
        let action = w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == town)
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

fn replay_journey(version: &str) {
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
    };
    old.game.as_object_mut().unwrap().remove("opening");
    old.game["packs"]["greek-drama"]["scope"] = json!("full");
    for actor in ["vale", "mara"] {
        old.game["actors"][actor]["place"] = json!("greek-harbor");
    }
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    full_store::seed(&c, &id, &old, "released-ports-fixture", now()).unwrap();
    let mut w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    for (id, item) in old.game["items"].as_object().unwrap() {
        assert_eq!(&w.game["items"][id], item);
    }
    assert_eq!(w.game["packs"]["greek-drama"]["revision"], super::full_tests::greek_revision());
    for target in [
        "greek-ship",
        "greek-athens-harbor",
        "greek-athens",
        "greek-road-athens-piraeus",
        "greek-piraeus",
        "greek-ship",
        "greek-harbor",
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
    }
    let expected = w.clone();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
}
