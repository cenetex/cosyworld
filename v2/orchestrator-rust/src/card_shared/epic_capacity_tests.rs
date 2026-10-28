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

#[test]
fn capacity_rules_match_twenty_for_existing_worlds_and_plays() {
    let request = json!({"op":"create"});
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, request.clone()).unwrap();
    assert_eq!(engine::reduce(request).unwrap(), old);
    let mut world = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: old["world"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    let mut request = world.request("play", 0);
    request["action"] = select(&world, "kind", "light");
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, request.clone()).unwrap();
    assert_eq!(engine::reduce(request).unwrap(), old);
    world.game = old["world"].clone();
    assert_eq!(
        engine::reduce(world.request("view", 0)).unwrap(),
        engine::reduce_version(engine::TWENTIETH_VERSION, world.request("view", 0)).unwrap()
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
        for field in [
            "packs",
            "actors",
            "items",
            "memories",
            "knowledge",
            "transports",
            "routeKnowledge",
            "questCompletions",
        ] {
            assert_eq!(world.game[field], before[field], "Preserve {field}");
        }
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
