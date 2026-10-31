use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn new_shared_world_starts_in_the_dark_attic_and_moves_after_the_lamp() {
    let mut world = World::create(None).unwrap();
    world.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    world.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "attic");
    assert_eq!(world.game["actors"]["moth"]["place"], "pond");
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    assert_eq!(
        world.game["opening"],
        json!({"version":1,"crossed":false,"met":{"vale":0}})
    );
    for (kind, target, place) in [("light", None, "attic"), ("move", Some("pond"), "pond")] {
        let view = world.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind && target.is_none_or(|target| a["target"] == target))
            .unwrap();
        world
            .apply(&json!({"op":"play","actor":"vale","action":action}))
            .unwrap();
        assert_eq!(world.game["actors"]["vale"]["place"], place);
        assert_eq!(world.game["items"]["lamp"]["lit"], true);
    }
}

#[test]
fn released_pond_opening_keeps_its_place_through_upgrade_and_journal_rebuild() {
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, json!({"op":"create"})).unwrap()
        ["world"]
        .clone();
    assert_eq!(old["actors"]["vale"]["place"], "pond");
    assert_eq!(old["opening"]["version"], 2);
    let mut world = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: old.clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    let path = std::env::temp_dir().join(format!("attic-opening-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "released-pond-opening", now()).unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"upgrade","from":engine::TWENTIETH_VERSION,"to":engine::VERSION}),
        now(),
    )
    .unwrap();
    // BoardyAI revision 2 carries his card from the pond to the station door.
    let mut expected = old.clone();
    expected["items"]["boardyai-calling-card"]["holder"] = json!("station");
    for field in ["items", "opening", "turn"] {
        assert_eq!(world.game[field], expected[field], "{field}");
    }
    // Places, trust and the rest of each actor survive; quest progress gives
    // way to one want, and quest lines leave the history.
    super::full_tests::assert_saved_actors(&world.game["actors"], &expected["actors"]);
    assert_eq!(world.game["actors"]["vale"]["place"], "pond");
    assert_eq!(
        world.game["log"],
        super::full_tests::quest_free_log(&expected["log"])
    );
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}
