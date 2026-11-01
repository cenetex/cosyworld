use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const MYRINE: &str = "greek-household-witness";

fn play(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    fields: &[(&str, &str)],
) -> Value {
    if !engine::historical(&world.version)
        && fields.iter().any(|(k, v)| *k == "kind" && *v == "move")
    {
        if let Some((_, target)) = fields.iter().find(|(k, _)| *k == "target") {
            let from = world.game["actors"][if actor == 0 { "vale" } else { "mara" }]["place"]
                .as_str()
                .unwrap()
                .to_string();
            // Aboard, a dock is a voyage: course, a round at sea, Disembark.
            // Mara does not know the Piraeus lane home, and the provisions
            // aboard open the lane to Marathon Bay (#1789), so a course
            // anywhere else is a wrong turn: she waits, and the idle ship
            // sails its port's first lane, home to the Wine-Dark Harbor.
            if from == "greek-ship" && *target != "greek-ship" {
                let who = if actor == 0 { "vale" } else { "mara" };
                for _ in 0..8 {
                    let actions = world.project(actor).unwrap()["actions"].clone();
                    let mut action = super::sea_steps::toward(&actions, target);
                    if action["kind"] == "course" && action["target"] != *target {
                        action = actions
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|a| a["kind"] == "wait")
                            .cloned()
                            .expect("a wait aboard");
                    }
                    full_store::commit(
                        c,
                        id,
                        world,
                        json!({"op":"play", "actor":who, "action":action}),
                        now(),
                    )
                    .unwrap();
                    if world.game["actors"][who]["place"] == *target {
                        return action;
                    }
                }
                panic!("{who} never reached {target}");
            }
        }
    }
    let step = format!(
        "{} turn {} actor {actor} at {} playing {fields:?}",
        world.version,
        world.game["turn"],
        world.room(actor).unwrap()
    );
    let action = world
        .project(actor)
        .unwrap_or_else(|error| panic!("Project {step}: {error}"))["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| fields.iter().all(|(key, value)| a[key] == *value))
        .unwrap_or_else(|| panic!("Missing card for {step}"))
        .clone();
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":if actor == 0 {"vale"} else {"mara"}, "action":action}),
        now(),
    )
    .unwrap_or_else(|error| panic!("Commit {step}: {error}"));
    action
}

fn rejected(c: &rusqlite::Connection, id: &str, world: &mut World, actor: &str, action: Value) {
    let before = world.clone();
    let count: i64 = c
        .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
        .unwrap();
    assert!(full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":actor, "action":action}),
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

fn fixture() -> (rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("homecoming-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    (c, id)
}

fn step(target: &str) -> [(&str, &str); 2] {
    [("kind", "move"), ("target", target)]
}

// Myrine's walk from Eleusis to the Piraeus quays, one road at a time.
const MYRINE_PATH: [&str; 4] = [
    "greek-road-athens-eleusis",
    "greek-athens",
    "greek-road-athens-piraeus",
    "greek-piraeus",
];

fn released_berth(c: &rusqlite::Connection, id: &str) -> World {
    let result = engine::reduce_version(engine::ELEVENTH_VERSION, json!({"op":"create"})).unwrap();
    let mut world = World {
        version: engine::ELEVENTH_VERSION.into(),
        game: result["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
        pack: None,
    };
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["packs"]["greek-drama"]["scope"] = json!("full");
    world.game["actors"]["vale"]["place"] = json!("greek-courtyard");
    world.game["actors"]["mara"]["place"] = json!("greek-eleusis");
    world.game["items"]["greek-water-jar"]["holder"] = json!("vale");
    // The Travel Provisions ride on deck. Under the current rules they open
    // the lane between Piraeus and the Wine-Dark Harbor, so Mara can call the
    // ship to the quay and sail home.
    world.game["items"]["greek-provisions"]["holder"] = json!("greek-ship");
    world.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    full_store::seed(c, id, &world, "released-open-door", now()).unwrap();
    let steps = [
        ("choose", "choiceId", "greek-return-water-jar"),
        ("drop", "item", "lamp"),
        ("move", "target", "greek-gate"),
        ("choose", "choiceId", "greek-hear-decree"),
        ("choose", "choiceId", "greek-report-plan"),
        ("move", "target", "greek-courtyard"),
        ("choose", "choiceId", "greek-courtyard-exposure"),
        ("choose", "choiceId", "greek-open-door-invite-exposure"),
        ("move", "target", "greek-harbor"),
        ("move", "target", "greek-athens"),
        ("move", "target", "greek-eleusis"),
        ("choose", "choiceId", "greek-open-door-hear-mothers"),
        ("choose", "choiceId", "greek-open-door-hear-adrastus"),
        ("take", "item", "greek-burial-petition"),
        ("move", "target", "greek-athens"),
        ("choose", "choiceId", "greek-open-door-register-plea"),
        ("choose", "choiceId", "greek-open-door-request-truce"),
        ("choose", "choiceId", "greek-open-door-hear-truce-report"),
        ("move", "target", "greek-piraeus"),
        ("choose", "choiceId", "greek-open-door-hear-quay"),
        ("take", "item", "greek-provision-basket"),
        ("choose", "choiceId", "greek-open-door-set-provisions"),
        ("take", "item", "greek-return-cloths"),
        ("move", "target", "greek-athens"),
        ("move", "target", "greek-eleusis"),
        ("choose", "choiceId", "greek-open-door-lay-cloths"),
        ("take", "item", "greek-ash-urn"),
        ("choose", "choiceId", "greek-open-door-lay-ashes"),
        ("choose", "choiceId", "greek-open-door-hear-pyre"),
        ("choose", "choiceId", "greek-open-door-eleusis-care"),
        ("take", "item", "greek-return-list"),
        ("move", "target", "greek-athens"),
        ("move", "target", "greek-piraeus"),
    ];
    for (kind, field, value) in steps {
        play(c, id, &mut world, 0, &[("kind", kind), (field, value)]);
    }
    assert_eq!(world.game["packs"]["greek-drama"]["revision"], 3);
    assert!(world.game["actors"].get(MYRINE).is_none());
    world
}

#[test]
fn agreed_household_journey_replays_after_released_history_with_both_care_choices() {
    // Build the shared historical scene once through the real v11 actions.
    // Each case then journals its old berth choice and every new journey step.
    let (history, history_id) = fixture();
    let prepared = released_berth(&history, &history_id);
    for policy in ["family", "open"] {
        // The checkpoint path must upgrade to the same world as the journal
        // path; the journey then runs once, from the journal path.
        let mut checkpointed = None;
        for keep_checkpoint in [true, false] {
            let (c, id) = fixture();
            let mut old = prepared.clone();
            full_store::seed(&c, &id, &old, "released-prepared-quay", now()).unwrap();
            play(
                &c,
                &id,
                &mut old,
                0,
                &[("choiceId", &format!("greek-open-door-{policy}-berth"))],
            );
            if !keep_checkpoint {
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            }
            let mut world = full_store::world(&c, &id, now()).unwrap();
            assert_eq!(world.version, engine::VERSION);
            if keep_checkpoint {
                checkpointed = Some(world);
                continue;
            }
            assert_eq!(Some(&world), checkpointed.as_ref());
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-eleusis");
            super::sea_steps::assert_upgraded_ship(&world.game, &old.game);
            // Greek revision 11 retires the invitation button, and revision 15
            // the truce request and the Eleusis care fork: their receipts and
            // log lines leave the upgraded save. An open berth passes to the
            // family berth, the one that stays.
            let retired = [
                "greek-open-door-invite-exposure",
                "greek-open-door-request-truce",
                "greek-open-door-eleusis-care",
            ];
            let (open, family) = ("greek-open-door-open-berth", "greek-open-door-family-berth");
            let mut expected = old.game.clone();
            let drama = &mut expected["packs"]["greek-drama"];
            for key in ["receipts", "recitals"] {
                if let Some(record) = drama[key].as_object_mut() {
                    for id in retired {
                        record.remove(id);
                    }
                    if let Some(value) = record.remove(open) {
                        record.insert(family.into(), value);
                    }
                }
            }
            let choices = drama["choices"].as_object_mut().unwrap();
            choices.remove("greek-open-door-eleusis");
            choices.insert("greek-open-door-berth".into(), json!("family"));
            let log: Vec<Value> = expected["log"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| !retired.iter().any(|id| e["choiceId"] == *id))
                .map(|e| {
                    let mut e = e.clone();
                    if e["choiceId"] == open {
                        e["choiceId"] = json!(family);
                    }
                    e
                })
                .collect();
            expected["log"] = Value::Array(log);
            for key in ["turn", "eventSeq", "log"] {
                assert_eq!(world.game[key], expected[key]);
            }
            for field in ["items", "crossings"] {
                for (key, value) in super::saved_items::upgraded_field(&old.game, field)
                    .as_object()
                    .unwrap()
                {
                    assert_eq!(&world.game[field][key], value);
                }
            }
            for key in ["receipts", "choices", "flags", "recitals"] {
                assert_eq!(
                    world.game["packs"]["greek-drama"][key],
                    expected["packs"]["greek-drama"][key]
                );
            }
            let escort = format!("accompany:mara::{MYRINE}:greek-piraeus");
            rejected(&c, &id, &mut world, "mara", json!({"key":escort}));
            // Piraeus and Eleusis are joined through the city, by the Long
            // Walls and the Sacred Way.
            for target in [
                "greek-road-athens-piraeus",
                "greek-athens",
                "greek-road-athens-eleusis",
                "greek-eleusis",
            ] {
                play(&c, &id, &mut world, 0, &step(target));
            }
            // Meeting Myrine at Eleusis is her agreement to walk.
            assert!(world.game["packs"]["greek-drama"]["receipts"]
                ["greek-homecoming-agree-journey"]
                .is_number());
            for target in MYRINE_PATH {
                play(&c, &id, &mut world, 0, &step(target));
            }
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-eleusis");
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
            let mut travel = Value::Null;
            for destination in MYRINE_PATH {
                travel = play(
                    &c,
                    &id,
                    &mut world,
                    1,
                    &[
                        ("kind", "accompany"),
                        ("target", MYRINE),
                        ("destination", destination),
                    ],
                );
            }
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-piraeus");
            assert_eq!(world.game["actors"]["mara"]["place"], "greek-piraeus");
            assert_eq!(
                world.game["packs"]["greek-drama"]["flags"]["greek-homecoming-arrived"],
                Value::Null
            );
            rejected(&c, &id, &mut world, "mara", travel);
            // Myrine arrives when she holds her household's basket at the
            // quay, whichever berth the save once chose.
            play(
                &c,
                &id,
                &mut world,
                1,
                &[("kind", "take"), ("item", "greek-provision-basket")],
            );
            let gift = play(
                &c,
                &id,
                &mut world,
                1,
                &[
                    ("kind", "give"),
                    ("item", "greek-provision-basket"),
                    ("target", MYRINE),
                ],
            );
            assert_eq!(
                world.game["items"]["greek-provision-basket"]["holder"],
                MYRINE
            );
            assert_eq!(
                world.game["packs"]["greek-drama"]["flags"]["greek-homecoming-arrived"],
                true
            );
            assert!(world.game["packs"]["greek-drama"]["receipts"]
                ["greek-homecoming-receive-family"]
                .is_number());
            rejected(&c, &id, &mut world, "mara", gift);
            for _ in 0..32 {
                if world.project(1).unwrap()["actions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| a["kind"] == "move" && a["target"] == "greek-ship")
                {
                    break;
                }
                play(&c, &id, &mut world, 1, &[("kind", "wait")]);
            }
            for target in ["greek-ship", "greek-harbor"] {
                play(
                    &c,
                    &id,
                    &mut world,
                    1,
                    &[("kind", "move"), ("target", target)],
                );
            }
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-piraeus");
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
            let upgrades: i64 = c.query_row("SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'", [], |r| r.get(0)).unwrap();
            assert_eq!(upgrades, 1);
        }
    }
}
