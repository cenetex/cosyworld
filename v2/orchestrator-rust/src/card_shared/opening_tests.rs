use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn new_shared_world_starts_in_the_lit_attic_and_moves_after_dousing_the_lamp() {
    let mut world = World::create(None).unwrap();
    world.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    world.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "attic");
    assert_eq!(world.game["actors"]["moth"]["place"], "pond");
    assert_eq!(world.game["items"]["lamp"]["lit"], true);
    assert_eq!(
        world.game["opening"],
        json!({"version":1,"crossed":false,"met":{"vale":0}})
    );
    // Dousing the lamp opens the mirror onto the Black Pond (#1600).
    for (kind, target, place) in [("snuff", None, "attic"), ("move", Some("pond"), "pond")] {
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
        assert_eq!(world.game["items"]["lamp"]["lit"], false);
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
        pack: None,
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
        json!({"op":"upgrade","from":engine::TWENTIETH_VERSION,"to":engine::VERSION,"pack":super::content::current()}),
        now(),
    )
    .unwrap();
    // BoardyAI revision 2 carries his card from the pond to the station door.
    let mut expected = old.clone();
    expected["items"] = super::saved_items::upgraded(&expected["items"]);
    super::saved_items::willows_kit_moved(&mut expected["items"]);
    expected["items"]["boardyai-calling-card"]["holder"] = json!("station");
    // Lonely Forest revision 2 retires three things and adds the buttons
    // and scarves, all unseen at the cottage.
    let items = expected["items"].as_object_mut().unwrap();
    for id in [
        "forest-story-button",
        "forest-dewbright-button",
        "forest-watch-bell",
    ] {
        items.remove(id);
    }
    for who in ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"] {
        for kind in ["button", "scarf"] {
            items.insert(
                format!("forest-{kind}-{who}"),
                json!({"holder": "forest-cottage", "history": []}),
            );
        }
    }
    // Greek revision 9 adds the olive branch, now the herald's truce, at the
    // Agora.
    items.insert(
        "greek-olive-branch".into(),
        json!({"holder": "greek-athens", "history": []}),
    );
    // The storybook world map waits at the empty station.
    items.insert(
        "world-map".into(),
        json!({"holder": "station", "history": []}),
    );
    // Greek revision 11's Theban outcomes wait unseen where their deeds are done.
    for (id, holder) in [
        ("greek-burial-account", "greek-battlefield"),
        ("greek-creon-writ", "greek-palace"),
        ("greek-guard-tablet", "greek-gate"),
        // Greek revision 15's Athenian outcomes wait the same way.
        ("greek-pyre-account", "greek-eleusis"),
        ("greek-marathon-record", "greek-marathon"),
    ] {
        items.insert(id.into(), json!({"holder": holder, "history": []}));
    }
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
