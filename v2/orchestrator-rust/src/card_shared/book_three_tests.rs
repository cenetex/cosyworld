use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const PHILOCTETES: &str = "greek-lemnos-philoctetes";
const LANDING: &str = "greek-lemnos-landing";

fn action(world: &World, actor: usize, fields: &[(&str, &str)]) -> Option<Value> {
    world.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| fields.iter().all(|(key, value)| a[key] == *value))
        .cloned()
}

fn play(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    fields: &[(&str, &str)],
) -> Value {
    let selected = action(world, actor, fields).unwrap_or_else(|| {
        panic!(
            "Missing Book III play at {}: {fields:?}",
            world.room(actor).unwrap()
        )
    });
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":super::full_world::actor_id(actor), "action":selected}),
        now(),
    )
    .unwrap()
}

fn reject_stale(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    selected: Value,
) {
    let before = world.clone();
    let count: i64 = c
        .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
        .unwrap();
    assert!(full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":super::full_world::actor_id(actor), "action":selected}),
        now()
    )
    .is_err());
    assert_eq!(*world, before);
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_log", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
}

fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String, World) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node")
        .current_dir(root)
        .args(["--input-type=module", "-e", "import {lemnosReady} from './test/helpers/greek-book-three.mjs'; console.log(JSON.stringify(lemnosReady()));"])
        .output().expect("Node 24 creates the completed care and bow-return fixture");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut world = World::create(Some(&String::from_utf8(output.stdout).unwrap())).unwrap();
    world.claimed = [1, 1, 1, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    world.game["actors"]["mara"]["place"] = json!(LANDING);
    world.game["actors"]["ash"]["place"] = json!(LANDING);
    for actor in 0..3 {
        world.project(actor).unwrap();
    }
    let path =
        std::env::temp_dir().join(format!("book-three-ship-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "book-three-care-and-returned-bow", now()).unwrap();
    (path, c, id, world)
}

#[test]
fn book_three_agreed_ship_passenger_waits_for_the_shared_arrival_and_replays_the_journal() {
    let (path, c, id, mut world) = fixture();
    assert!(action(&world, 0, &[("kind", "accompany"), ("target", PHILOCTETES)]).is_none());
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-lemnos-agree-troy")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "take"), ("item", "greek-lemnos-water")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[
            ("kind", "accompany"),
            ("target", PHILOCTETES),
            ("destination", LANDING),
        ],
    );
    let stale_companion = action(
        &world,
        0,
        &[
            ("kind", "accompany"),
            ("target", PHILOCTETES),
            ("destination", "greek-ship"),
        ],
    )
    .unwrap();
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-ship")],
    );
    play(
        &c,
        &id,
        &mut world,
        2,
        &[
            ("kind", "accompany"),
            ("target", PHILOCTETES),
            ("destination", "greek-ship"),
        ],
    );
    reject_stale(&c, &id, &mut world, 0, stale_companion);
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-ship")],
    );
    assert_eq!(world.game["transports"]["greek-ship"]["dock"], LANDING);
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-athens-harbor")],
    );
    play(
        &c,
        &id,
        &mut world,
        2,
        &[("kind", "move"), ("target", "greek-athens-harbor")],
    );
    assert_eq!(world.game["actors"][PHILOCTETES]["place"], "greek-ship");
    assert!(action(
        &world,
        0,
        &[
            ("kind", "accompany"),
            ("target", PHILOCTETES),
            ("destination", "greek-ajax-landing")
        ]
    )
    .is_none());
    let stale_board = action(&world, 2, &[("kind", "move"), ("target", "greek-ship")]).unwrap();
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-ship")],
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-piraeus")],
    );
    reject_stale(&c, &id, &mut world, 2, stale_board);
    assert_eq!(world.game["actors"][PHILOCTETES]["place"], "greek-ship");
    assert_eq!(
        world.game["items"]["greek-lemnos-bow"]["holder"],
        PHILOCTETES
    );
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-ship")],
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-ajax-landing")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[
            ("kind", "accompany"),
            ("target", PHILOCTETES),
            ("destination", "greek-ajax-landing"),
        ],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[
            ("kind", "accompany"),
            ("target", PHILOCTETES),
            ("destination", "greek-greek-camp"),
        ],
    );
    let result = play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "talk"), ("target", PHILOCTETES)],
    );
    let disclosures = result["context"]["disclosures"].clone();
    assert_eq!(disclosures[0]["factId"], "greek-lemnos-arrival-troy");
    assert!(world.game["knowledge"]["known"]["vale"]
        .get("greek-lemnos-arrival-troy")
        .is_none());
    full_store::commit(&c, &id, &mut world, json!({"op":"speech", "actor":"vale", "room":"greek-greek-camp", "disclosures":disclosures, "lines":[{"actorId":"vale", "text":"Tell Dione where you have arrived."}, {"actorId":PHILOCTETES, "text":disclosures[0]["text"]}]}), now()).unwrap();
    assert_eq!(
        world.game["packs"]["greek-drama"]["choices"]["greek-lemnos-ending"],
        "troy"
    );
    for target in ["greek-ajax-landing", "greek-ship", "greek-harbor"] {
        play(
            &c,
            &id,
            &mut world,
            0,
            &[("kind", "move"), ("target", target)],
        );
    }
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-lemnos-check-manifest")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-courtyard")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-lemnos-return-troy")],
    );
    assert_eq!(
        world.game["actors"][PHILOCTETES]["place"],
        "greek-greek-camp"
    );
    assert_eq!(
        world.game["items"]["greek-lemnos-water"]["holder"],
        "greek-courtyard"
    );
    let expected = world.clone();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    drop(c);
    let reopened = store::open(&path).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), expected);
}

#[test]
fn book_three_rules_twenty_upgrade_preserves_the_old_full_scope_lemnian_visit() {
    let released =
        engine::reduce_version(engine::TWENTIETH_VERSION, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: released["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    old.game.as_object_mut().unwrap().remove("opening");
    old.game["packs"]["greek-drama"]["scope"] = json!("full");
    old.game["actors"]["vale"]["place"] = json!("greek-lemnos");
    let path = std::env::temp_dir().join(format!(
        "book-three-rules-twenty-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &old, "released-lemnian-visit", now()).unwrap();
    let current = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(current.version, engine::VERSION);
    assert_eq!(current.game["packs"]["greek-drama"]["revision"], 8);
    assert_eq!(current.game["actors"]["vale"]["place"], "greek-lemnos");
    assert!(current.game["actors"].get(PHILOCTETES).is_some());
    assert!(current.game["memories"].get(LANDING).is_some());
    for field in [
        "turn",
        "eventSeq",
        "log",
        "transports",
        "routeKnowledge",
        "knowledge",
    ] {
        assert_eq!(current.game[field], old.game[field], "Preserve {field}");
    }
    for (id, item) in old.game["items"].as_object().unwrap() {
        assert_eq!(&current.game["items"][id], item);
    }
    assert!(action(
        &current,
        0,
        &[("kind", "move"), ("target", "greek-greek-camp")]
    )
    .is_some());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), current);
}
