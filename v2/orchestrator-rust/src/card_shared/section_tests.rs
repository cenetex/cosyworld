use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn old_fixture(version: &str, scope: &str) -> (rusqlite::Connection, String, World) {
    let path = std::env::temp_dir().join(format!("greek-section-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let result = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: version.into(),
        game: result["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    old.game.as_object_mut().unwrap().remove("opening");
    old.game["packs"]["greek-drama"]["scope"] = json!(scope);
    old.game["actors"]["vale"]["place"] = json!("greek-courtyard");
    old.game["actors"]["mara"]["place"] = json!("greek-harbor");
    old.game["items"]["greek-water-jar"]["holder"] = json!("vale");
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    old.project(0).unwrap();
    full_store::seed(&c, &id, &old, "earlier-greek-world", now()).unwrap();
    (c, id, old)
}

fn play(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    field: &str,
    value: &str,
) {
    let action = world.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a[field] == value)
        .unwrap_or_else(|| panic!("Missing {field}: {value}"))
        .clone();
    let actor_id = if actor == 0 { "vale" } else { "mara" };
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play","actor":actor_id,"action":action}),
        now(),
    )
    .unwrap();
}

fn preserves_old_entities(after: &Value, before: &Value) {
    for (id, old) in before["actors"].as_object().unwrap() {
        let mut actor = after["actors"][id].clone();
        actor["trust"]
            .as_object_mut()
            .unwrap()
            .retain(|other, trust| {
                if old["trust"].get(other).is_some() {
                    true
                } else {
                    assert_eq!(*trust, json!(0));
                    false
                }
            });
        assert_eq!(&actor, old, "saved actor {id}");
    }
    for field in ["items", "peaceUntil"] {
        for (id, value) in before[field].as_object().unwrap() {
            assert_eq!(&after[field][id], value, "saved {field} {id}");
        }
    }
    super::full_tests::assert_saved_memories(&after["memories"], &before["memories"]);
}

#[test]
fn earlier_greek_worlds_upgrade_once_with_original_history_and_new_entities() {
    for (version, through_tenth) in [
        (engine::NINTH_VERSION, false),
        (engine::TENTH_VERSION, false),
        (engine::NINTH_VERSION, true),
        (engine::ELEVENTH_VERSION, false),
    ] {
        for scope in ["opening", "full"] {
            for keep_checkpoint in [true, false] {
                let (c, id, mut old) = old_fixture(version, scope);
                play(&c, &id, &mut old, 0, "choiceId", "greek-return-water-jar");
                if through_tenth {
                    full_store::commit(&c, &id, &mut old, json!({"op":"upgrade","from":engine::NINTH_VERSION,"to":engine::TENTH_VERSION}), now()).unwrap();
                    assert_eq!(old.game["packs"]["greek-drama"]["revision"], 2);
                    assert!(old.game["actors"].get("greek-aethra").is_none());
                }
                if !keep_checkpoint {
                    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
                }
                let upgraded = full_store::world(&c, &id, now()).unwrap();
                assert_eq!(upgraded.version, engine::VERSION);
                assert_eq!(upgraded.game["packs"]["greek-drama"]["revision"], super::full_tests::greek_revision());
                assert_eq!(upgraded.claimed, old.claimed);
                assert_eq!(upgraded.present, old.present);
                preserves_old_entities(&upgraded.game, &old.game);
                for field in ["turn", "eventSeq", "log", "transports"] {
                    assert_eq!(upgraded.game[field], old.game[field]);
                }
                for (key, value) in old.game["crossings"].as_object().unwrap() {
                    assert_eq!(&upgraded.game["crossings"][key], value);
                }
                for field in ["choices", "flags", "receipts", "met", "scope", "recitals"] {
                    assert_eq!(
                        upgraded.game["packs"]["greek-drama"][field],
                        old.game["packs"]["greek-drama"][field]
                    );
                }
                assert_eq!(
                    upgraded.game["actors"].as_object().unwrap().len(),
                    old.game["actors"].as_object().unwrap().len()
                        + 16
                        + 3
                        + 4
                        + if version == engine::ELEVENTH_VERSION {
                            3
                        } else {
                            11
                        }
                );
                assert_eq!(
                    upgraded.game["items"].as_object().unwrap().len(),
                    old.game["items"].as_object().unwrap().len()
                        + 10
                        + 4
                        + 4
                        + if version == engine::ELEVENTH_VERSION {
                            9
                        } else {
                            18
                        }
                );
                assert_eq!(
                    upgraded.game["items"]["greek-burial-petition"]["holder"],
                    "greek-eleusis"
                );
                let mut voyage = upgraded.clone();
                voyage.game["actors"]["mara"]["place"] = json!("greek-ship");
                voyage.game["transports"]["greek-ship"] = json!({
                    "version":2, "dock":"greek-harbor", "destination":"pond", "recall":null
                });
                assert_eq!(
                    voyage.project(1).unwrap()["exits"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("greek-athens-harbor")),
                    scope == "full"
                );
                assert!(!upgraded.project(1).unwrap()["exits"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("greek-egypt-tomb")));
                assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
                assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
                let upgrades: i64 = c.query_row("SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'", [], |row| row.get(0)).unwrap();
                assert_eq!(upgrades, if through_tenth { 2 } else { 1 });
            }
        }
    }
}

#[test]
fn a_shared_section_opens_from_an_accepted_invitation_and_replays_for_both_people() {
    let (c, id, mut old) = old_fixture(engine::TENTH_VERSION, "opening");
    play(&c, &id, &mut old, 0, "choiceId", "greek-return-water-jar");
    play(&c, &id, &mut old, 0, "target", "greek-gate");
    play(&c, &id, &mut old, 0, "choiceId", "greek-hear-decree");
    play(&c, &id, &mut old, 0, "choiceId", "greek-decline-burial");
    play(&c, &id, &mut old, 0, "target", "greek-courtyard");
    play(&c, &id, &mut old, 0, "choiceId", "greek-courtyard-refusal");
    let mut world = full_store::world(&c, &id, now()).unwrap();
    let before = world.clone();
    assert!(full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"mara","action":{"key":"move:mara::greek-athens"}}),
        now()
    )
    .is_err());
    assert_eq!(world, before);
    let invitation = world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| {
            a["choiceId"]
                .as_str()
                .is_some_and(|id| id.starts_with("greek-open-door-invite-"))
        })
        .expect("Dione offers an invitation after the public response")
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":invitation}),
        now(),
    )
    .unwrap();
    assert_eq!(
        world.game["packs"]["greek-drama"]["flags"]["greek-open-door-open"],
        true
    );
    for target in [
        "greek-ship",
        "greek-athens-harbor",
        "greek-athens",
        "greek-road-athens-piraeus",
        "greek-piraeus",
    ] {
        if target == "greek-ship" {
            for _ in 0..32 {
                if world.project(1).unwrap()["exits"]
                    .as_array()
                    .unwrap()
                    .contains(&json!(target))
                {
                    break;
                }
                play(&c, &id, &mut world, 1, "kind", "wait");
            }
        }
        play(&c, &id, &mut world, 1, "target", target);
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    let recovered = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(recovered, world);
    assert_eq!(recovered.project(1).unwrap()["room"], "greek-piraeus");
    assert_eq!(recovered.project(0).unwrap()["room"], "greek-courtyard");
}
