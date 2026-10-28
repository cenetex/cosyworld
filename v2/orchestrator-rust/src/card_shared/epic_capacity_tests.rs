use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn upgraded_routes(previous: &Value) -> Value {
    let sea_paths: &[&[&str]] = &[
        &["greek-harbor", "greek-ship", "greek-book-iv-helen-landing", "greek-egypt-tomb"],
        &["greek-harbor", "greek-ship", "greek-ajax-landing", "greek-troy-beach"],
        &["greek-piraeus", "greek-ship", "greek-tauris-shore", "greek-tauris"],
        &["greek-piraeus", "greek-ship", "greek-sicily-shore", "greek-sicily"],
        &["greek-gate", "greek-courtyard", "greek-harbor", "greek-ship", "greek-aulis"],
        &["greek-aulis", "greek-ship", "greek-ajax-landing", "greek-greek-camp"],
        &["greek-greek-camp", "greek-ajax-landing", "greek-ship", "greek-lemnos-landing", "greek-lemnos"],
        &["greek-troy", "greek-greek-camp", "greek-ajax-landing", "greek-ship", "greek-thrace"],
    ];
    let mut routes = Vec::new();
    for edge in previous.as_array().unwrap() {
        let sea_path = sea_paths.iter().find_map(|path| {
            if edge[0] == path[0] && edge[1] == path[path.len() - 1] {
                Some(path.to_vec())
            } else if edge[1] == path[0] && edge[0] == path[path.len() - 1] {
                Some(path.iter().copied().rev().collect())
            } else {
                None
            }
        });
        let replacements = if (edge[0] == "greek-susa" && edge[1] == "greek-scythian-crag")
            || (edge[1] == "greek-susa" && edge[0] == "greek-scythian-crag")
        {
            vec![
                json!([edge[0], "greek-vii-crag-camp"]),
                json!(["greek-vii-crag-camp", edge[1]]),
            ]
        } else if let Some(path) = sea_path {
            path.windows(2).map(|pair| json!(pair)).collect()
        } else {
            vec![edge.clone()]
        };
        for route in replacements {
            if !routes.contains(&route) {
                routes.push(route);
            }
        }
    }
    json!(routes)
}

fn sorted_routes(previous: &Value) -> Vec<String> {
    let mut routes: Vec<_> = previous
        .as_array()
        .unwrap()
        .iter()
        .map(Value::to_string)
        .collect();
    routes.sort();
    routes
}

// Earlier saved fields retain their values. Known distant paths gain their
// actual landings and camp; the pack revision records the larger catalog.
pub(super) fn assert_retained(old: &Value, current: &Value, path: &str) {
    if path.ends_with("packs.greek-drama.revision") {
        assert!(current.as_u64().unwrap() >= old.as_u64().unwrap());
    } else if path.contains("routeKnowledge.") && old.is_array() {
        // A normal turn sorts learned roads through rememberRoutes. Compare
        // every saved edge after the route expansion, including multiplicity.
        assert_eq!(
            sorted_routes(current),
            sorted_routes(&upgraded_routes(old)),
            "Retain {path}"
        );
    } else if let Some(fields) = old.as_object() {
        for (key, value) in fields {
            assert_retained(value, &current[key], &format!("{path}.{key}"));
        }
    } else {
        assert_eq!(current, old, "Retain {path}");
    }
}

fn select(world: &World, field: &str, value: &str) -> Value {
    world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action[field] == value)
        .unwrap()
        .clone()
}

// New chapters add catalog entries while earlier saved records keep their values.
fn assert_catalog_extension(old: &Value, current: &Value, fresh: bool) {
    let mut retained = current.clone();
    if fresh {
        // Fresh rules21 rows resolve absent peers to zero. Imported rows stay exact.
        for (id, actor) in old["actors"].as_object().unwrap() {
            for (other, value) in actor["trust"].as_object().unwrap() {
                if retained["actors"][id]["trust"].get(other).is_none() {
                    assert_eq!(value, &json!(0));
                    retained["actors"][id]["trust"][other] = json!(0);
                }
            }
        }
        let expected_routes = upgraded_routes(&old["routeKnowledge"]["greek-rhapsode"]);
        let previous_routes = expected_routes.as_array().unwrap();
        let routes = current["routeKnowledge"]["greek-rhapsode"]
            .as_array()
            .unwrap();
        for route in previous_routes {
            assert!(routes.contains(route));
        }
        retained["routeKnowledge"]["greek-rhapsode"] = expected_routes;
    }
    assert_retained(old, &retained, "");
    let catalog: Value =
        serde_json::from_str(include_str!("../../../card-game/packs.json")).unwrap();
    let greek = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "greek-drama")
        .unwrap();
    for (id, definition) in greek["avatars"].as_object().unwrap() {
        if old["actors"].get(id).is_some() {
            continue;
        }
        let actor = &current["actors"][id];
        assert_eq!(actor["place"], definition["place"], "New resident {id}");
        assert_eq!(actor["progress"], json!({"program":0,"step":0,"marks":[]}));
        assert_eq!(actor["crossed"], 0);
        assert_eq!(actor["lastTalk"], -9);
        assert!(actor["trust"]
            .as_object()
            .unwrap()
            .values()
            .all(|value| value == 0));
        assert_eq!(current["peaceUntil"][id], 0);
        assert_eq!(current["motives"]["grievances"][id], json!([]));
    }
    for (id, definition) in greek["items"].as_object().unwrap() {
        if old["items"].get(id).is_some() {
            continue;
        }
        assert_eq!(
            current["items"][id],
            json!({"holder":definition["holder"],"history":[]})
        );
    }
    for field in ["avatars", "items", "places"] {
        for id in greek[field].as_object().unwrap().keys() {
            if old["memories"].get(id).is_some() {
                continue;
            }
            let memory = &current["memories"][id];
            assert_eq!(memory["events"], json!([]));
            assert_eq!(memory["landmarks"], json!([]));
            assert!(memory["text"].is_null());
            assert!(memory["turn"].is_null());
        }
    }
}

#[test]
fn capacity_rules_extend_twenty_and_preserve_existing_plays() {
    let request = json!({"op":"create"});
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, request.clone()).unwrap();
    let current = engine::reduce(request).unwrap();
    assert_catalog_extension(&old["world"], &current["world"], true);
    let mut world = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: old["world"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    let mut request = world.request("play", 0);
    request["action"] = select(&world, "kind", "light");
    let old = engine::reduce_version(engine::TWENTIETH_VERSION, request.clone()).unwrap();
    let current = engine::reduce(request).unwrap();
    assert_catalog_extension(&old["world"], &current["world"], false);
    world.game = old["world"].clone();
    assert_retained(
        &engine::reduce_version(engine::TWENTIETH_VERSION, world.request("view", 0)).unwrap()
            ["world"],
        &engine::reduce(world.request("view", 0)).unwrap()["world"],
        "",
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
            assert_retained(&before[field], &world.game[field], field);
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

#[test]
fn capacity_current_catalog_cold_runtime_stays_within_the_live_limits() {
    let seed = engine::reduce(json!({"op":"create"})).unwrap();
    let mut world = World {
        version: engine::VERSION.into(),
        game: seed["world"].clone(),
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
    let action = select(&world, "kind", "wait");
    for op in ["create", "validate", "view", "play", "upgrade"] {
        let mut times = Vec::new();
        let mut input_bytes = 0;
        let mut output_bytes = 0;
        for sample in 0..10 {
            // Every view gets a distinct valid revision, so each sample enters
            // a fresh interpreter. The other operations always enter it too.
            world.game["revision"] = json!(1000 + sample);
            let mut request = if op == "create" {
                json!({"op":"create"})
            } else {
                world.request(op, 0)
            };
            if op == "play" {
                request["action"] = action.clone();
            }
            if op == "upgrade" {
                request["from"] = json!(engine::TWENTIETH_VERSION);
                request["to"] = json!(engine::VERSION);
            }
            input_bytes = input_bytes.max(serde_json::to_vec(&request).unwrap().len());
            let started = std::time::Instant::now();
            let result = engine::reduce(request).unwrap();
            let elapsed = started.elapsed();
            assert!(
                elapsed < std::time::Duration::from_secs(2),
                "{op}: {elapsed:?}"
            );
            times.push(elapsed.as_secs_f64() * 1000.0);
            output_bytes = output_bytes.max(serde_json::to_vec(&result).unwrap().len());
        }
        times.sort_by(f64::total_cmp);
        println!(
            "current_catalog_cold_runtime {}",
            json!({
                "rules":engine::VERSION,"op":op,"samples":times.len(),
                "p95_ms":times[(times.len() * 95).div_ceil(100) - 1],
                "max_ms":times.last(),"input_bytes":input_bytes,"output_bytes":output_bytes,
                "heap_limit_mib":96,"deadline_ms":2000
            })
        );
    }
}
