use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn select(world: &World, field: &str, value: &str) -> Value {
    world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action[field] == value)
        .unwrap()
        .clone()
}

const NEW_ACTORS: [&str; 14] = [
    "greek-danaid-melia",
    "greek-danaid-nera",
    "greek-alcestis-alcestis",
    "greek-alcestis-heracles",
    "greek-alcestis-chloris",
    "greek-heracles-megara",
    "greek-heracles-amphitryon",
    "greek-heracles-heracles",
    "greek-heracles-theseus",
    "greek-trachis-deianira",
    "greek-trachis-iole",
    "greek-trachis-hyllus",
    "greek-trachis-lichas",
    "greek-trachis-heracles",
];
const NEW_ITEMS: [&str; 20] = [
    "greek-danaid-branch",
    "greek-danaid-water-jug",
    "greek-danaid-host-pledge",
    "greek-danaid-provisions",
    "greek-alcestis-cup",
    "greek-alcestis-wine-jug",
    "greek-alcestis-loaf",
    "greek-alcestis-care-tablet",
    "greek-heracles-bread",
    "greek-heracles-water-cup",
    "greek-heracles-care-cloth",
    "greek-heracles-funeral-cloth",
    "greek-heracles-help-tablet",
    "greek-heracles-remembrance-tablet",
    "greek-trachis-meal",
    "greek-trachis-wool-remnant",
    "greek-trachis-treated-robe",
    "greek-trachis-plain-cloth",
    "greek-trachis-gift-casket",
    "greek-trachis-water-flask",
];
const NEW_PLACES: [&str; 5] = [
    "greek-danaid-refuge-court",
    "greek-heracles-theban-house",
    "greek-heracles-athens-road",
    "greek-heracles-athens-guest-room",
    "greek-trachis-canae-approach",
];

// The capacity release also mounts Book II. Build its exact extension while
// retaining every released record, including old quest hands and authors.
fn book_two_world(before: &Value, add_hands: bool) -> Value {
    let catalog: Value =
        serde_json::from_str(include_str!("../../../card-game/packs.json")).unwrap();
    let greek = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pack| pack["id"] == "greek-drama")
        .unwrap();
    let mut expected = before.clone();
    assert_eq!(expected["packs"]["greek-drama"]["revision"], 7);
    expected["packs"]["greek-drama"]["revision"] = json!(8);
    let actors: Vec<_> = before["actors"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .chain(NEW_ACTORS)
        .collect();
    for (_, actor) in expected["actors"].as_object_mut().unwrap() {
        for added in NEW_ACTORS {
            assert!(actor["trust"].get(added).is_none());
            actor["trust"][added] = json!(0);
        }
    }
    let memory = json!({"events":[],"landmarks":[],"text":null,"turn":null});
    for actor in NEW_ACTORS {
        assert!(before["actors"].get(actor).is_none());
        assert!(greek["avatars"][actor].get("temperament").is_none());
        let trust: serde_json::Map<String, Value> = actors
            .iter()
            .filter(|other| **other != actor)
            .map(|other| ((*other).into(), json!(0)))
            .collect();
        expected["actors"][actor] = json!({
            "place":greek["avatars"][actor]["place"],
            "progress":{"program":0,"step":0,"marks":[]},
            "crossed":0,"lastTalk":-9,"trust":trust
        });
        expected["peaceUntil"][actor] = json!(0);
        expected["motives"]["grievances"][actor] = json!([]);
        expected["memories"][actor] = memory.clone();
        expected["memories"][actor]["seen"] = json!({});
        if add_hands {
            assert!(before["quests"]["hands"].get(actor).is_none());
            expected["quests"]["hands"][actor] = json!([]);
        }
    }
    for item in NEW_ITEMS {
        assert!(before["items"].get(item).is_none());
        expected["items"][item] = json!({"holder":greek["items"][item]["holder"],"history":[]});
        expected["memories"][item] = memory.clone();
    }
    for place in NEW_PLACES {
        assert!(before["memories"].get(place).is_none());
        expected["memories"][place] = memory.clone();
    }
    expected
}

fn assert_book_two_response(actual: Value, released: Value, fresh: bool, add_hands: bool) {
    let mut expected = released.clone();
    expected["world"] = book_two_world(&released["world"], add_hands);
    if fresh {
        // New games teach the Bard these added paths. Upgrades retain the
        // exact paths already learned in the released world.
        let mut routes = released["world"]["routeKnowledge"]["greek-rhapsode"]
            .as_array()
            .unwrap()
            .clone();
        for (from, to) in [
            ("greek-argos-sanctuary", "greek-danaid-refuge-court"),
            ("greek-courtyard", "greek-heracles-theban-house"),
            ("greek-courtyard", "greek-pherae"),
            ("greek-danaid-refuge-court", "greek-argos-sanctuary"),
            (
                "greek-heracles-athens-guest-room",
                "greek-heracles-athens-road",
            ),
            (
                "greek-heracles-athens-road",
                "greek-heracles-athens-guest-room",
            ),
            ("greek-heracles-athens-road", "greek-heracles-theban-house"),
            ("greek-heracles-theban-house", "greek-courtyard"),
            ("greek-heracles-theban-house", "greek-heracles-athens-road"),
            ("greek-oeta", "greek-trachis-canae-approach"),
            ("greek-pherae", "greek-courtyard"),
            ("greek-trachis-canae-approach", "greek-oeta"),
            ("greek-trachis-canae-approach", "greek-trachis"),
            ("greek-trachis", "greek-trachis-canae-approach"),
        ] {
            let edge = json!([from, to]);
            assert!(!routes.contains(&edge));
            routes.push(edge);
        }
        let mut actual_routes = actual["world"]["routeKnowledge"]["greek-rhapsode"]
            .as_array()
            .unwrap()
            .clone();
        routes.sort_by_key(Value::to_string);
        actual_routes.sort_by_key(Value::to_string);
        assert_eq!(actual_routes, routes);
        expected["world"]["routeKnowledge"]["greek-rhapsode"] =
            actual["world"]["routeKnowledge"]["greek-rhapsode"].clone();
    }
    let catalog: Value =
        serde_json::from_str(include_str!("../../../card-game/packs.json")).unwrap();
    let greek = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pack| pack["id"] == "greek-drama")
        .unwrap();
    for (ids, group, kind) in [
        (NEW_ACTORS.as_slice(), "avatars", "avatar"),
        (NEW_ITEMS.as_slice(), "items", "item"),
        (NEW_PLACES.as_slice(), "places", "location"),
    ] {
        for id in ids {
            assert!(released["profiles"].get(*id).is_none());
            let source = &greek[group][*id];
            let mut profile =
                json!({"kind":kind,"name":source["name"],"persona":source["persona"]});
            if kind == "avatar" {
                profile["voice"] = source["voice"].clone();
                if let Some(expression) = source.get("expression") {
                    profile["expression"] = expression.clone();
                }
            }
            expected["profiles"][*id] = profile;
        }
    }
    expected["profiles"]["greek-argos-sanctuary"]["persona"] =
        greek["places"]["greek-argos-sanctuary"]["persona"].clone();
    assert_eq!(actual, expected);
}

#[test]
fn capacity_rules_preserve_twenty_with_exact_book_two_additions() {
    let request = json!({"op":"create"});
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, request.clone()).unwrap();
    assert_book_two_response(engine::reduce(request).unwrap(), old.clone(), true, false);
    let mut world = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: old["world"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    let mut request = world.request("play", 0);
    request["action"] = select(&world, "kind", "light");
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, request.clone()).unwrap();
    assert_book_two_response(engine::reduce(request).unwrap(), old.clone(), false, true);
    world.game = old["world"].clone();
    assert_book_two_response(
        engine::reduce(world.request("view", 0)).unwrap(),
        engine::reduce_version(engine::TWENTIETH_VERSION, world.request("view", 0)).unwrap(),
        false,
        true,
    );
}

#[test]
fn capacity_upgrade_keeps_earned_wording_and_authors_through_journal_rebuild() {
    for unknown_author in [false, true] {
        let old =
            engine::reduce_version(engine::TWENTIETH_VERSION, json!({"op":"create"})).unwrap();
        let mut world = World {
            version: engine::TWENTIETH_VERSION.into(),
            game: old["world"].clone(),
            claimed: [1, 0, 0, 0, 0, 0, 0, 0],
            present: [1, 0, 0, 0, 0, 0, 0, 0],
        };
        world.game.as_object_mut().unwrap().remove("opening");
        world.game["actors"]["vale"]["place"] = json!("greek-courtyard");
        world.game["items"]["greek-water-jar"]["holder"] = json!("vale");
        world.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        let action = select(&world, "choiceId", "greek-return-water-jar");
        world
            .apply(&json!({"op":"play","actor":"vale","action":action}))
            .unwrap();
        if unknown_author {
            world.game["packs"]["greek-drama"]["recitals"]["greek-return-water-jar"]["actor"] =
                Value::Null;
            world.game["log"] = json!([]);
        }
        let path =
            std::env::temp_dir().join(format!("epic-capacity-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "e".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        full_store::seed(&c, &id, &world, "released-twenty-poem", now()).unwrap();
        let wait = select(&world, "kind", "wait");
        full_store::commit(
            &c,
            &id,
            &mut world,
            json!({"op":"play","actor":"vale","action":wait}),
            now(),
        )
        .unwrap();
        let before = world.game.clone();
        full_store::commit(
            &c,
            &id,
            &mut world,
            json!({"op":"upgrade","from":engine::TWENTIETH_VERSION,"to":engine::VERSION}),
            now(),
        )
        .unwrap();
        let mut expected_game = book_two_world(&before, true);
        expected_game["revision"] = json!(before["revision"].as_u64().unwrap() + 1);
        assert_eq!(world.game, expected_game);
        let record = &world.game["packs"]["greek-drama"]["recitals"]["greek-return-water-jar"];
        assert_eq!(record.as_object().unwrap().len(), 2);
        assert_eq!(
            record["actor"],
            if unknown_author {
                Value::Null
            } else {
                json!("vale")
            }
        );
        let expected = world.clone();
        drop(c);
        let c = store::open(&path).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
        let upgrades: i64 = c
            .query_row(
                "SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(upgrades, 1);
    }
}
