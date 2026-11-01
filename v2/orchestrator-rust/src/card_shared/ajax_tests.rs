use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

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
            "Missing Ajax play at {}: {fields:?}",
            world.room(actor).unwrap()
        )
    });
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":if actor == 0 {"vale"} else {"mara"}, "action":selected}),
        now(),
    )
    .unwrap()
}

fn talk(c: &rusqlite::Connection, id: &str, world: &mut World, actor: usize, topic: &str) {
    let result = play(
        c,
        id,
        world,
        actor,
        &[("kind", "talk"), ("target", "greek-ajax-teucer")],
    );
    let disclosures = result["context"]["disclosures"].clone();
    assert_eq!(disclosures[0]["factId"], topic);
    full_store::commit(
        c,
        id,
        world,
        json!({
            "op":"speech", "actor":if actor == 0 {"vale"} else {"mara"},
            "room":"greek-greek-camp", "disclosures":disclosures,
            "lines":[
                {"actorId":if actor == 0 {"vale"} else {"mara"}, "text":"Tell me your account for Dione."},
                {"actorId":"greek-ajax-teucer", "text":disclosures[0]["text"]}
            ]
        }),
        now(),
    )
    .unwrap();
    assert!(
        world.game["knowledge"]["known"][if actor == 0 { "vale" } else { "mara" }]
            .get(topic)
            .is_some()
    );
}

// The source-model fixture reaches this saved vigil through every earlier
// journey. The native host validates it before journaling the remaining rite.
fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String, World) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node")
        .current_dir(root)
        .args([
            "--input-type=module",
            "-e",
            "import { ajaxGrave } from './test/helpers/greek-ajax.mjs'; console.log(JSON.stringify(ajaxGrave('appeal', false)));",
        ])
        .output()
        .expect("Node 24 creates the Ajax source fixture");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let save = String::from_utf8(output.stdout).unwrap();
    let mut world = World::create(Some(&save)).unwrap();
    world.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    world.game["actors"]["mara"]["place"] = json!("greek-greek-camp");
    world.project(0).unwrap();
    world.project(1).unwrap();
    let path = std::env::temp_dir().join(format!("ajax-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "ajax-prepared-vigil", now()).unwrap();
    (path, c, id, world)
}

#[test]
fn ajax_appeal_custody_spoken_accounts_and_second_carrier_replay_from_the_journal() {
    let (path, c, id, mut world) = fixture();
    assert_eq!(world.version, engine::VERSION);
    assert!(action(&world, 0, &[("choiceId", "greek-ajax-bury-appeal")]).is_none());
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-greek-camp")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-ajax-witness-appeal")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-ajax-grave")],
    );
    let burial = action(&world, 0, &[("choiceId", "greek-ajax-bury-appeal")]).unwrap();
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-ajax-grave")],
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "take"), ("item", "greek-ajax-cloth")],
    );
    let before = world.clone();
    let count: i64 = c
        .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
        .unwrap();
    assert!(full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":burial}),
        now()
    )
    .is_err());
    assert_eq!(world, before);
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_log", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "drop"), ("item", "greek-ajax-cloth")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-ajax-bury-appeal")],
    );
    assert_eq!(
        world.game["packs"]["greek-drama"]["choices"]["greek-ajax-ending"],
        "appeal"
    );
    for actor in [0, 1] {
        play(
            &c,
            &id,
            &mut world,
            actor,
            &[("kind", "move"), ("target", "greek-greek-camp")],
        );
    }
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "take"), ("item", "greek-ajax-plea")],
    );
    talk(&c, &id, &mut world, 0, "greek-ajax-account-appeal");
    let signed = world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-record-appeal"].clone();
    play(
        &c,
        &id,
        &mut world,
        0,
        &[
            ("kind", "give"),
            ("item", "greek-ajax-plea"),
            ("target", "mara"),
        ],
    );
    for topic in ["greek-ajax-plea", "greek-ajax-account-appeal"] {
        talk(&c, &id, &mut world, 1, topic);
    }
    assert_eq!(
        world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-record-appeal"],
        signed
    );
    for target in [
        "greek-ajax-landing",
        "greek-ship",
        "greek-harbor",
        "greek-road-thebes",
        "greek-courtyard",
    ] {
        if target == "greek-ship" {
            for _ in 0..32 {
                if action(&world, 1, &[("kind", "move"), ("target", target)]).is_some() {
                    break;
                }
                play(&c, &id, &mut world, 1, &[("kind", "wait")]);
            }
        }
        if target == "greek-harbor" {
            // Home from the landing by Marathon Bay and Piraeus: a course
            // card, then a round at sea, for each lane. A course card is
            // only a lane Mara knows, which may be the lane back, so take
            // only the next lane homeward; otherwise wait, and an idle ship
            // sails its port's first lane by itself.
            for _ in 0..24 {
                if action(&world, 1, &[("kind", "move"), ("target", target)]).is_some() {
                    break;
                }
                let homeward = match world.game["transports"]["greek-ship"]["dock"].as_str() {
                    Some("greek-ajax-landing") => Some("greek-marathon"),
                    Some("greek-marathon") => Some("greek-piraeus"),
                    Some("greek-piraeus") => Some(target),
                    _ => None,
                };
                let next = homeward.filter(|to| {
                    action(&world, 1, &[("kind", "course"), ("target", to)]).is_some()
                });
                match next {
                    Some(to) => play(
                        &c,
                        &id,
                        &mut world,
                        1,
                        &[("kind", "course"), ("target", to)],
                    ),
                    None => play(&c, &id, &mut world, 1, &[("kind", "wait")]),
                };
            }
        }
        play(
            &c,
            &id,
            &mut world,
            1,
            &[("kind", "move"), ("target", target)],
        );
    }
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("choiceId", "greek-ajax-return-appeal")],
    );
    assert_eq!(
        world.game["items"]["greek-ajax-plea"]["holder"],
        "greek-courtyard"
    );
    // The return is Mara's recorded choice; no quest record carries it.
    assert!(world.game.get("quests").is_none());
    let returned = world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["choiceId"] == "greek-ajax-return-appeal")
        .unwrap();
    assert_eq!(returned["actorId"], "mara");
    assert_eq!(
        world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-return-appeal"],
        returned["turn"]
    );
    let expected = world.clone();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}

#[test]
fn ajax_upgrade_brings_an_uninvited_nineteen_camp_visitor_home_and_replays_it() {
    let released = engine::NINETEENTH_VERSION;
    let mut checkpointed = None;
    for keep_checkpoint in [true, false] {
        let seed = engine::reduce_version(released, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: released.into(),
            game: seed["world"].clone(),
            claimed: [1, 1, 0, 0, 0, 0, 0, 0],
            present: [1, 1, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        old.game.as_object_mut().unwrap().remove("opening");
        old.game["packs"]["greek-drama"]["scope"] = json!("full");
        old.game["actors"]["vale"]["place"] = json!("greek-greek-camp");
        old.game["actors"]["mara"]["place"] = json!("greek-harbor");
        old.game["items"]["lamp"]["holder"] = json!("vale");
        old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        let path =
            std::env::temp_dir().join(format!("ajax-upgrade-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "c".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        full_store::seed(&c, &id, &old, "released-nineteen-camp", now()).unwrap();
        play(&c, &id, &mut old, 0, &[("kind", "wait")]);
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut current = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(current.clone());
            continue;
        }
        assert_eq!(Some(&current), checkpointed.as_ref());
        assert_eq!(current.version, engine::VERSION);
        assert_eq!(
            current.game["packs"]["greek-drama"]["revision"],
            super::full_tests::greek_revision()
        );
        assert_eq!(current.claimed, old.claimed);
        assert_eq!(current.present, old.present);
        for field in ["turn", "eventSeq", "log", "knowledge"] {
            assert_eq!(current.game[field], old.game[field], "Preserve {field}");
        }
        // Greek revision 8 walks each known town link along its one road,
        // forgets cut links, and turns a step onto a retired road into a
        // walkable path. Every other known step stays.
        let walkable = [
            "greek-road-athens-piraeus",
            "greek-road-athens-eleusis",
            "greek-road-thebes",
            "greek-road-sacred-way",
        ];
        let along = |from: &str, to: &str| -> Option<&str> {
            let mut pair = [from, to];
            pair.sort();
            match pair {
                ["greek-courtyard", "greek-harbor"] => Some("greek-road-thebes"),
                ["greek-athens", "greek-delphi"] => Some("greek-road-sacred-way"),
                ["greek-delphi", "greek-trachis"] => Some("greek-oeta"),
                _ => None,
            }
        };
        // Greek revision 11 sets the Market Well within the courtyard, so a
        // step the well lost walks through the courtyard.
        let within = |from: &str, to: &str| -> Option<&str> {
            let mut pair = [from, to];
            pair.sort();
            match pair {
                ["greek-gate", "greek-well"] | ["greek-palace", "greek-well"] => {
                    Some("greek-courtyard")
                }
                // Greek revision 15 reaches the sanctuary through the palace.
                ["greek-courtyard", "greek-sanctuary"] => Some("greek-palace"),
                _ => None,
            }
        };
        let cut = [
            ["greek-piraeus", "greek-tauris"],
            ["greek-piraeus", "greek-sicily"],
            ["greek-aulis", "greek-greek-camp"],
            ["greek-scythian-crag", "greek-susa"],
            // Greek revision 12 retires these Athenian places.
            ["greek-athens", "greek-athens-harbor"],
            ["greek-athens", "greek-jury-house"],
            ["greek-attic-farm", "greek-divine-heights"],
            ["greek-attic-farm", "greek-bird-wilderness"],
            ["greek-colonus", "greek-underworld"],
            ["greek-athens-harbor", "greek-ship"],
            ["sea:greek-athens-harbor", "sea:greek-piraeus"],
            // Greek revision 13 makes Cithaeron a road from the battlefield.
            ["greek-cithaeron", "greek-sanctuary"],
            // The Athenian districts link only through their gate roads.
            ["greek-athens", "greek-attic-farm"],
            ["greek-athens", "greek-colonus"],
            ["greek-athens", "greek-demos-house"],
            ["greek-athens", "greek-festival"],
            ["greek-eleusis", "greek-piraeus"],
            // Greek revision 16 makes the Far Shores one-place ship stops.
            ["greek-susa", "greek-troy"],
            ["greek-greek-camp", "greek-lemnos"],
            ["greek-thrace", "greek-troy"],
            ["greek-scythian-crag", "greek-tauris"],
            ["sea:greek-ajax-landing", "sea:greek-harbor"],
        ];
        let walked = |edges: &Value| -> Vec<Value> { edges.as_array().unwrap().to_vec() };
        for (who, edges) in old.game["routeKnowledge"].as_object().unwrap() {
            let now_known = walked(&current.game["routeKnowledge"][who]);
            for edge in walked(edges) {
                let (from, to) = (edge[0].as_str().unwrap(), edge[1].as_str().unwrap());
                let mut pair = [from, to];
                pair.sort();
                let expected = if cut.contains(&pair) {
                    assert!(!now_known.contains(&edge), "{who} forgets {edge}");
                    vec![]
                } else if let Some(road) = along(from, to) {
                    vec![json!([from, road]), json!([road, to])]
                } else if let Some(via) = within(from, to) {
                    vec![json!([from, via]), json!([via, to])]
                } else if from.starts_with("greek-road-") || to.starts_with("greek-road-") {
                    vec![]
                } else {
                    vec![edge.clone()]
                };
                for step in expected {
                    assert!(now_known.contains(&step), "{who} knows {step}");
                }
            }
            for edge in &now_known {
                for end in edge.as_array().unwrap() {
                    let end = end.as_str().unwrap();
                    assert!(
                        !end.starts_with("greek-road-") || walkable.contains(&end),
                        "{who} knows a step onto retired {end}"
                    );
                }
            }
        }
        // BoardyAI revision 2 carries his card from the pond to the station door.
        let mut saved = old.game.clone();
        saved["items"] = super::saved_items::upgraded(&saved["items"]);
        super::saved_items::willows_kit_moved(&mut saved["items"]);
        saved["items"]["boardyai-calling-card"]["holder"] = json!("station");
        super::sea_steps::assert_upgraded_ship(&current.game, &old.game);
        // The upgrade draws Hoppy Cat's specials, and a drawn thing waits at
        // its anchor in the Hoppy Cat core (#1622).
        let drawn = current.game["packs"]["hoppycat-archive"]["specials"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for field in ["items", "peaceUntil"] {
            for (key, value) in saved[field].as_object().unwrap() {
                if field == "items" && drawn.iter().any(|id| id.as_str() == Some(key.as_str())) {
                    let holder = current.game["items"][key]["holder"].as_str().unwrap();
                    assert!(holder.starts_with("hoppycat-"), "{key} waits at {holder}");
                    continue;
                }
                // Lonely Forest revision 2 retires these three things.
                if [
                    "forest-story-button",
                    "forest-dewbright-button",
                    "forest-watch-bell",
                ]
                .contains(&key.as_str())
                {
                    assert!(current.game[field].get(key).is_none(), "{key}");
                    continue;
                }
                assert_eq!(&current.game[field][key], value);
            }
        }
        super::full_tests::assert_saved_memories(&current.game["memories"], &old.game["memories"]);
        for field in ["choices", "flags", "receipts", "met", "recitals", "scope"] {
            assert_eq!(
                current.game["packs"]["greek-drama"][field],
                old.game["packs"]["greek-drama"][field]
            );
        }
        for (id, saved) in old.game["actors"].as_object().unwrap() {
            let mut retained = current.game["actors"][id].clone();
            if id == "vale" {
                retained["place"] = saved["place"].clone();
            }
            // Drawing Hoppy Cat's specials brings a drawn resident to its
            // anchor and sends anyone in an undrawn place to the garden (#1622).
            let hoppy = |place: &Value| place.as_str().is_some_and(|p| p.starts_with("hoppycat-"));
            if hoppy(&saved["place"]) && hoppy(&retained["place"]) {
                retained["place"] = saved["place"].clone();
            }
            let mut saved = saved.clone();
            saved.as_object_mut().unwrap().remove("progress");
            // Greek revision 12 retired the Underworld Landing into Colonus.
            for field in ["place", "home"] {
                if saved[field] == "greek-underworld" {
                    saved[field] = json!("greek-colonus");
                }
            }
            for field in ["want", "xp", "visited", "talked", "metTurn", "gaveUp"] {
                retained.as_object_mut().unwrap().remove(field);
                saved.as_object_mut().unwrap().remove(field);
            }
            let saved = &saved;
            retained["trust"]
                .as_object_mut()
                .unwrap()
                .retain(|id, trust| {
                    if saved["trust"].get(id).is_some() {
                        true
                    } else {
                        assert_eq!(*trust, json!(0));
                        false
                    }
                });
            assert_eq!(&retained, saved);
        }
        for id in [
            "greek-ajax-tecmessa",
            "greek-ajax-teucer",
            "greek-ajax-odysseus",
        ] {
            assert!(current.game["actors"].get(id).is_some());
        }
        // Without the Trojan invitation the ship does not call at the camp,
        // so the visitor goes back to Aulis, the way they came.
        assert_eq!(current.game["actors"]["vale"]["place"], "greek-aulis");
        play(
            &c,
            &id,
            &mut current,
            0,
            &[("kind", "move"), ("target", "greek-gate")],
        );
        let expected = current.clone();
        drop(c);
        let c = store::open(&path).unwrap();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
        let upgrades: i64 = c
            .query_row(
                "SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(upgrades, 1);
    }
}

// Rules 21 delivered the shield without a spoken step. A world that did so
// keeps its completed story through the rules 22 upgrade and a journal rebuild.
#[test]
fn ajax_shield_delivered_under_rules_twenty_one_stays_complete_after_upgrade() {
    // Saved by the released rules 21 code (main at 1348ab52), so this world
    // is exactly what a rules 21 player could have had. It took the exposure
    // branch at Thebes: a refusal save that went on to Athens starts fresh
    // under Greek revision 11.
    let save = include_str!("../../../../test/fixtures/ajax-household-rules-21.json");
    // Load it with rules 21 too; current rules would upgrade it first.
    let mut old = World {
        version: engine::TWENTY_FIRST_VERSION.into(),
        game: engine::reduce_version(
            engine::TWENTY_FIRST_VERSION,
            json!({"op":"create","save":save}),
        )
        .unwrap()["world"]
            .clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: None,
    };
    old.claimed = [1, 0, 0, 0, 0, 0, 0, 0];
    old.present = old.claimed;
    let path = std::env::temp_dir().join(format!("ajax-shield-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &old, "rules-twenty-one-shield", now()).unwrap();
    play(
        &c,
        &id,
        &mut old,
        0,
        &[("choiceId", "greek-ajax-deliver-shield")],
    );
    assert_eq!(old.version, engine::TWENTY_FIRST_VERSION);
    let key = "greek-drama:story-quest-greek-ajax-shield";
    let completed = old.game["quests"]["records"][key]["completedTurn"].clone();
    assert!(completed.is_number());
    assert!(old.game["packs"]["greek-drama"]["flags"]
        .get("greek-ajax-shield-keeper-heard")
        .is_none());
    let current = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(current.version, engine::VERSION);
    // Greek revision 11 retires the Theban invitation buttons, and revision
    // 15 the Open Door's request, care and Marathon hearing buttons.
    let mut receipts = old.game["packs"]["greek-drama"]["receipts"].clone();
    for retired in [
        "greek-open-door-invite-exposure",
        "greek-open-door-request-truce",
        "greek-open-door-eleusis-care",
        "greek-open-door-marathon-hearing",
    ] {
        receipts.as_object_mut().unwrap().remove(retired).unwrap();
    }
    assert_eq!(current.game["packs"]["greek-drama"]["receipts"], receipts);
    // The delivered shield stays a receipt; story quest records are dropped.
    assert!(current.game.get("quests").is_none());
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), current);
    drop(c);
    let _ = std::fs::remove_file(path);
}
