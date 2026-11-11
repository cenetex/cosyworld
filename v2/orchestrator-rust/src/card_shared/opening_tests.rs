use super::{engine, full_store, full_world::World, now, store};
use serde_json::json;

#[test]
fn new_shared_world_starts_in_the_lit_attic_and_moves_after_stowing_the_lamp() {
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
    // Stowing the lamp opens the mirror without committing a turn.
    let turn = world.game["turn"].clone();
    let history = world.game["log"].clone();
    let stow = json!({"op":"hold","actor":"vale","choice":{
        "item":null,"revision":world.game["revision"]}});
    world.apply(&stow).unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "attic");
    assert_eq!(
        world.game["actors"]["vale"]["heldItem"],
        serde_json::Value::Null
    );
    assert_eq!(world.game["items"]["lamp"]["holder"], "vale");
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    assert_eq!(world.game["turn"], turn);
    assert_eq!(world.game["log"], history);
    let view = world.project(0).unwrap();
    let action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "move" && a["target"] == "pond")
        .unwrap();
    world
        .apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "pond");
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    assert_eq!(world.game["items"]["lamp"]["fuelRooms"], 3);
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
    expected["items"] = super::saved_items::current_items(&expected);
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
    // Greek revision 11's Theban outcomes wait unseen where their deeds are done.
    for (id, holder) in [
        ("greek-burial-account", "greek-battlefield"),
        // Greek revision 20: Creon holds his writ, and Dione the wheat.
        ("greek-creon-writ", "greek-creon"),
        ("greek-wheat", "greek-baker"),
        // Greek revision 15's Athenian outcomes wait the same way.
        ("greek-pyre-account", "greek-eleusis"),
        ("greek-marathon-record", "greek-marathon"),
        // The Thebes provisions loop: the Dried Figs, the Wine Skin and the
        // Libation Wine wait at home (rules 95).
        ("greek-figs", "greek-sanctuary"),
        ("greek-wine-skin", "greek-gate"),
        ("greek-libation", "greek-cithaeron"),
    ] {
        items.insert(id.into(), json!({"holder": holder, "history": []}));
    }
    super::saved_items::greek_story_items(&mut expected["items"]);
    expected = super::saved_items::hoppy_revision_4(&expected, &world.game);
    let initial = super::saved_items::initial_game(&world.game);
    expected["items"] =
        super::saved_items::with_initial_additions(&expected["items"], &initial["items"]);
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

// A scarf opens the attic stair from the first turn. Rules 96 offered it and
// then refused the play as an invalid save ("waiting for an update"). A rules
// 96 world mid-opening upgrades to 97, where the stair crosses the opening:
// Vale meets only who is at the cottage, and the journal replays it.
#[test]
fn scarf_stair_refused_by_rules_96_crosses_the_opening_after_upgrade() {
    let created = engine::reduce_pack(
        engine::NINETY_SIXTH_VERSION,
        Some(super::content::released_101()),
        json!({"op":"create"}),
    );
    let mut world = World {
        version: engine::NINETY_SIXTH_VERSION.into(),
        game: created.unwrap()["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: Some(super::content::released_101().into()),
    };
    let path = std::env::temp_dir().join(format!("scarf-stair-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "scarf-stair", now()).unwrap();
    for command in [
        json!({"op":"claim","actor":"vale","progress":{"upgrades":["scarf"]}}),
        json!({"op":"enter","actor":"vale"}),
    ] {
        full_store::commit(&c, &id, &mut world, command, now()).unwrap();
    }
    assert_eq!(world.game["opening"]["crossed"], false);
    let stair = |world: &World| {
        let view = world.project(0).unwrap();
        let down = view["actions"].as_array().unwrap().iter().find(|a| {
            a["kind"] == "move" && a["target"] == "forest-cottage" && a["item"] == "lamp"
        });
        json!({"op":"play","actor":"vale","action":down.unwrap()})
    };
    assert!(world.clone().apply(&stair(&world)).is_err());
    let upgrade = json!({"op":"upgrade","from":engine::NINETY_SIXTH_VERSION,
        "to":engine::VERSION,"pack":super::content::current()});
    full_store::commit(&c, &id, &mut world, upgrade, now()).unwrap();
    let play = stair(&world);
    full_store::commit(&c, &id, &mut world, play, now()).unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "forest-cottage");
    assert_eq!(world.game["opening"]["crossed"], true);
    let actors = world.game["actors"].as_object().unwrap();
    let mut here: Vec<&str> = actors
        .iter()
        .filter(|(_, a)| a["place"] == "forest-cottage")
        .map(|(id, _)| id.as_str())
        .collect();
    let mut met: Vec<&str> = world.game["opening"]["met"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    here.sort();
    met.sort();
    assert_eq!(met, here);
    assert!(met.len() < actors.len());
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}
