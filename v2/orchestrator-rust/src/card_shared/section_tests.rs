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
        pack: None,
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
    // Quest progress gives way to one want; the rest of each actor survives.
    super::full_tests::assert_saved_actors(&after["actors"], &before["actors"]);
    for field in ["items", "peaceUntil"] {
        for (id, value) in super::saved_items::upgraded_field(before, field)
            .as_object()
            .unwrap()
        {
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
            let mut checkpointed = None;
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
                // The checkpoint path must reach the same upgraded world; the rest of
                // the case runs once, from the journal.
                if keep_checkpoint {
                    checkpointed = Some(upgraded.clone());
                    continue;
                }
                assert_eq!(Some(&upgraded), checkpointed.as_ref());
                assert_eq!(upgraded.version, engine::VERSION);
                assert_eq!(
                    upgraded.game["packs"]["greek-drama"]["revision"],
                    super::full_tests::greek_revision()
                );
                assert_eq!(upgraded.claimed, old.claimed);
                assert_eq!(upgraded.present, old.present);
                preserves_old_entities(&upgraded.game, &old.game);
                super::sea_steps::assert_upgraded_ship(&upgraded.game, &old.game);
                for field in ["turn", "eventSeq"] {
                    assert_eq!(upgraded.game[field], old.game[field]);
                }
                assert_eq!(
                    upgraded.game["log"],
                    super::full_tests::quest_free_log(&old.game["log"])
                );
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
                        // Greek revision 9: the Suppliant's Olive Branch.
                        + 1
                        // The storybook world map at the empty station.
                        + 1
                        // The Lonely Forest: the Wolfprint Charm and eight
                        // buttons and scarves.
                        + 17
                        // Greek revision 11: the Burial Account, Creon's Writ
                        // and the Guard's Tablet.
                        + 3
                        // Greek revision 15: the Pyre Account and the
                        // Marathon Record.
                        + 2
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
                    "version":3, "phase":"docked", "dock":"greek-harbor", "destination":null,
                    "riders":[], "since":voyage.game["turn"], "recall":null
                });
                // Black Pond sails only to the Wine-Dark Harbor. From there
                // Piraeus is a course card while the Travel Provisions are
                // aboard, whichever scope the save keeps.
                let piraeus = |w: &World| {
                    w.project(1).unwrap()["exits"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("greek-piraeus"))
                };
                assert_eq!(
                    voyage.game["items"]["greek-provisions"]["holder"],
                    "greek-harbor"
                );
                assert!(!piraeus(&voyage));
                voyage.game["items"]["greek-provisions"]["holder"] = json!("greek-ship");
                assert!(piraeus(&voyage));
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
    play(&c, &id, &mut old, 0, "choiceId", "greek-report-plan");
    play(&c, &id, &mut old, 0, "target", "greek-courtyard");
    play(&c, &id, &mut old, 0, "choiceId", "greek-courtyard-exposure");
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
    // Under the current rules the public account itself opened the road;
    // there is no invitation button left to play.
    assert!(!world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["kind"] == "choose"));
    assert_eq!(
        world.game["packs"]["greek-drama"]["flags"]["greek-open-door-open"],
        true
    );
    // Mara loads the Travel Provisions at the harbor, which opens the lane
    // to Piraeus. Dione's invitation opens the road on to Athens.
    let take = world.project(1).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "take" && a["item"] == "greek-provisions")
        .expect("Mara can take the provisions at the harbor")
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"mara","action":take}),
        now(),
    )
    .unwrap();
    for target in [
        "greek-ship",
        "greek-piraeus",
        "greek-road-athens-piraeus",
        "greek-athens",
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
        // Aboard, Piraeus is a voyage of course cards and rounds at sea.
        if target == "greek-piraeus" {
            for _ in 0..8 {
                if world.game["actors"]["mara"]["place"] == target {
                    break;
                }
                let step = super::sea_steps::toward(&world.project(1).unwrap()["actions"], target);
                full_store::commit(
                    &c,
                    &id,
                    &mut world,
                    json!({"op":"play","actor":"mara","action":step}),
                    now(),
                )
                .unwrap();
            }
            assert_eq!(world.game["actors"]["mara"]["place"], target);
            continue;
        }
        play(&c, &id, &mut world, 1, "target", target);
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    let recovered = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(recovered, world);
    assert_eq!(recovered.project(1).unwrap()["room"], "greek-athens");
    assert_eq!(recovered.project(0).unwrap()["room"], "greek-courtyard");
}
