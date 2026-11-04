use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const ELDER: &str = "greek-elder";
const COURT: &str = "greek-courtyard";

fn created(version: &str) -> World {
    let pack = engine::takes_content(version).then(|| content::seeded(version).into());
    let mut game = engine::reduce_pack(
        version,
        Some(content::seeded(version)),
        json!({"op":"create","seed":9}),
    )
    .unwrap()["world"]
        .clone();
    // Vale waits in the courtyard; the elder walks in from the well at dusk.
    game.as_object_mut().unwrap().remove("opening");
    game["turn"] = json!(116);
    game["revision"] = json!(116);
    game["actors"]["vale"]["place"] = json!(COURT);
    game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    game["actors"][ELDER]["place"] = json!("greek-well");
    game["actors"][ELDER]["want"] = json!({"kind":"place","target":COURT,"since":116,"refusals":0});
    World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack,
    }
}

fn wait(world: &World) -> Value {
    let view = world.project(0).unwrap();
    let action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait" && a["sleep"] != true && a.get("guards").is_none())
        .cloned()
        .expect("a wait");
    json!({"op":"play","actor":"vale","action":action})
}

// Rules 101 (#2248): a resident who walks in where the player waits is met
// on that turn, in the C QuickJS host, and the journal alone rebuilds the
// meeting, here and reopened. A rules 100 world upgrades and meets on
// arrival too.
fn meets_on_arrival(version: &str) {
    let mut world = created(version);
    let path = std::env::temp_dir().join(format!("meet-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "meet-on-arrival", now()).unwrap();
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    if version != engine::VERSION {
        world = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(world.version, engine::VERSION);
    }
    assert!(world.game["packs"]["greek-drama"]["met"]
        .get(ELDER)
        .is_none());
    for _ in 0..6 {
        if world.game["actors"][ELDER]["place"] == COURT {
            break;
        }
        let next = wait(&world);
        commit(&mut world, next);
    }
    assert_eq!(world.game["actors"][ELDER]["place"], COURT);
    assert_eq!(world.game["turn"], 120);
    assert_eq!(world.game["packs"]["greek-drama"]["met"][ELDER], 120);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}

#[test]
fn rules_101_meets_a_resident_on_arrival_and_replays_in_the_c_host() {
    meets_on_arrival(engine::VERSION);
}

#[test]
fn rules_100_world_upgrades_to_101_and_meets_on_arrival() {
    meets_on_arrival(engine::HUNDREDTH_VERSION);
}
