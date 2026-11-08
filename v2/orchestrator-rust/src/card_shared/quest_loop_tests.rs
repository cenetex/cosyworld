use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn fixture(name: &str, world: &World) -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("{name}-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, world, name, now()).unwrap();
    (path, c, id)
}

fn created(version: &str) -> World {
    let pack = engine::takes_content(version).then(|| content::seeded(version).into());
    let game = engine::reduce_pack(
        version,
        Some(content::seeded(version)),
        json!({"op":"create","seed":9}),
    )
    .unwrap()["world"]
        .clone();
    World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack,
    }
}

fn play(world: &World, pick: impl Fn(&Value) -> bool) -> Value {
    let view = world.project(0).unwrap();
    let action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| pick(a))
        .unwrap_or_else(|| panic!("Missing play in {}", view["actions"]))
        .clone();
    json!({"op":"play","actor":"vale","action":action})
}

fn quests(world: &World) -> Vec<Value> {
    let vale = &world.game["actors"]["vale"];
    std::iter::once(vale["want"].clone())
        .chain(vale["under"].as_array().cloned().unwrap_or_default())
        .filter(|w| !w.is_null())
        .collect()
}

fn woke(world: &World) -> Option<Value> {
    world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|e| e["actorId"] == "vale" && e.get("woke").is_some())
        .cloned()
}

// Rules 99 in the C QuickJS host: a Talk quest given and met reaches
// halfway, the quest to sleep at a sanctuary dreams the glimpse, and the
// long rest at full dreams the level quest that honours it. The journal
// replays every new record (`heard`, `halfwayIssued`, `glimpse`) exactly,
// and the glimpse is the one the browser rules draw for the same plays
// (test/card-quest-loop-agreement.test.mjs).
#[test]
fn rules_99_quest_loop_commits_and_replays_in_the_c_host() {
    let mut world = created(engine::VERSION);
    let game = &mut world.game;
    game.as_object_mut().unwrap().remove("opening");
    game["turn"] = json!(2);
    game["revision"] = json!(2);
    game["actors"]["vale"]["place"] = json!("attic");
    game["actors"]["keeper"]["place"] = json!("attic");
    game["items"]["lamp"]["holder"] = json!("station");
    game["items"]["bell"]["holder"] = json!("vale");
    game["actors"]["keeper"]["want"] =
        json!({"kind":"item","target":"bell","since":2,"refusals":0});
    game["actors"]["vale"]["level"] = json!(1);
    game["actors"]["vale"]["xp"] = json!(1);
    game["actors"]["vale"]["want"] = json!({"kind":"place","target":"pond","since":0,"refusals":0});
    let (path, c, id) = fixture("quest-loop", &world);
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));

    let talk = play(&world, |a| a["kind"] == "talk" && a["target"] == "keeper");
    commit(&mut world, talk);
    let conversation = world.game["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["actors"] == json!(["keeper", "vale"]))
        .expect("direct Talk has durable participants");
    assert_eq!(conversation["turn"], world.game["turn"]);
    assert!(conversation["seq"].as_u64().unwrap() > 0);
    assert_eq!(
        quests(&world)[1],
        json!({"kind":"item","target":"bell","since":3,"refusals":0,
            "step":{"verb":"give","to":"keeper"}})
    );
    assert_eq!(
        world.game["actors"]["vale"]["heard"],
        json!({"keeper":"item:bell"})
    );
    // Re-hearing the want adds nothing.
    let again = play(&world, |a| a["kind"] == "talk" && a["target"] == "keeper");
    let held = quests(&world);
    commit(&mut world, again);
    assert_eq!(quests(&world), held);

    let give = play(&world, |a| {
        a["kind"] == "give" && a["target"] == "keeper" && a["item"] == "bell"
    });
    commit(&mut world, give);
    assert_eq!(world.game["actors"]["vale"]["xp"], 1);
    let reward = play(&world, |a| a["kind"] == "claim");
    commit(&mut world, reward);
    assert_eq!(world.game["actors"]["vale"]["xp"], 2);
    assert_eq!(world.game["actors"]["vale"]["halfwayIssued"], 2);
    assert!(quests(&world).iter().all(|w| w["step"]["verb"] != "rest"));

    let wait = |w: &World| play(w, |a| a["kind"] == "wait" && a["sleep"] != true);
    let sleep = |w: &World| play(w, |a| a["sleep"] == true);
    let long_rest = |w: &mut World| {
        let waited = wait(w);
        commit(w, waited);
        for _ in 0..24 {
            let slept = sleep(w);
            commit(w, slept);
            let event = woke(w);
            if event
                .as_ref()
                .is_some_and(|e| e["turn"] == w.game["turn"] && e["rest"] == "long")
            {
                return event.unwrap();
            }
            if w.game["actors"]["vale"].get("sleeping").is_none() {
                let waited = wait(w);
                commit(w, waited);
            }
        }
        panic!("no long rest");
    };
    let event = long_rest(&mut world);
    assert_eq!(event["dream"], "glimpse");
    let glimpse = world.game["actors"]["vale"]["glimpse"].clone();
    assert_eq!(
        glimpse,
        json!({"level":2,"kind":"place","id":"attic","at":"attic"})
    );
    let visit = play(&world, |a| a["kind"] == "move" && a["target"] == "pond");
    commit(&mut world, visit);
    let reward = play(&world, |a| a["kind"] == "claim");
    commit(&mut world, reward);
    assert_eq!(world.game["actors"]["vale"]["xp"], 3);
    let home = play(&world, |a| a["kind"] == "move" && a["target"] == "attic");
    commit(&mut world, home);
    let event = long_rest(&mut world);
    assert_eq!(event["dream"], "quest");
    let level = quests(&world)
        .into_iter()
        .find(|w| w.get("quest").is_some())
        .expect("the level quest");
    assert_eq!(level["quest"]["level"], 2);

    // The journal alone rebuilds the same world, here and reopened.
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}

// A rules 98 world mid-opening upgrades to 99 through the one recorded
// upgrade: its opening, packs and actors are kept as they were, its journal
// replays on rules 98 and then 99, and the opening plays on.
#[test]
fn rules_98_world_upgrades_to_99_keeping_its_opening_and_packs() {
    let mut world = created(engine::NINETY_EIGHTH_VERSION);
    let (path, c, id) = fixture("rules-98-upgrade", &world);
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let waited = play(&world, |a| a["kind"] == "wait" && a["sleep"] != true);
    commit(&mut world, waited);
    let old = world.game.clone();
    assert_eq!(old["opening"]["crossed"], false);

    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    // Greek revision 20 and Hoppy revision 4 update their rooms and things.
    let old = super::saved_items::current_pack_changes(&old, &upgraded.game);
    for field in ["opening", "packs", "items", "turn", "log"] {
        assert_eq!(upgraded.game[field], old[field], "Keep {field}");
    }
    assert_eq!(upgraded.game.get("disabledPacks"), old.get("disabledPacks"));
    for (actor, before) in old["actors"].as_object().unwrap() {
        for (key, value) in before.as_object().unwrap() {
            assert_eq!(&upgraded.game["actors"][actor][key], value, "{actor}.{key}");
        }
    }
    // The opening goes on under rules 99: dousing the lamp opens the mirror.
    let mut world = upgraded;
    let snuff = play(&world, |a| a["kind"] == "snuff");
    commit(&mut world, snuff);
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}

#[test]
fn held_item_keeps_the_last_received_item_through_journal_replay() {
    let mut world = created(engine::HUNDRED_FOURTEENTH_VERSION);
    let game = &mut world.game;
    game.as_object_mut().unwrap().remove("opening");
    for actor in ["vale", "moth", "keeper"] {
        game["actors"][actor]["place"] = json!("station");
    }
    game["items"]["lamp"]["holder"] = json!("vale");
    game["items"]["cloth"]["holder"] = json!("keeper");
    game["items"]["oil"]["holder"] = json!("attic");
    game["actors"]["keeper"]["want"] = Value::Null;
    game["actors"]["keeper"]["trust"]["moth"] = json!(3);
    game["actors"]["moth"]["want"] = json!({"kind":"item","target":"cloth","since":0,"refusals":0});
    let (path, c, id) = fixture("held-item-replay", &world);
    let mut world = full_store::world(&c, &id, now()).unwrap();
    let commit =
        |w: &mut World, command: Value| full_store::commit(&c, &id, w, command, now()).unwrap();
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let gift = play(&world, |a| {
        a["kind"] == "give" && a["item"] == "lamp" && a["target"] == "moth"
    });
    commit(&mut world, gift.clone());
    assert_eq!(world.game["items"]["lamp"]["holder"], "moth");
    assert_eq!(world.game["items"]["cloth"]["holder"], "moth");
    assert_eq!(world.game["actors"]["moth"]["heldItem"], "cloth");
    let after = world.clone();
    assert!(full_store::commit(&c, &id, &mut world, gift, now()).is_err());
    assert_eq!(world, after);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let _ = std::fs::remove_file(path);
}

#[test]
fn pressured_handover_replays_custody_and_social_meaning_without_checkpoints() {
    let mut world = created(engine::VERSION);
    // A local actual Ask -> Threaten save, continued through shared authority.
    world.game = serde_json::from_str(include_str!(
        "../../../../test/fixtures/card-pressured-handover.json"
    ))
    .unwrap();
    let (path, c, id) = fixture("pressured-handover-replay", &world);
    let commit =
        |w: &mut World, command: Value| full_store::commit(&c, &id, w, command, now()).unwrap();
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let source = world.game["standoffs"][0]["sourceSeq"].clone();
    assert!(source.as_u64().unwrap() > 0);
    let give = play(&world, |a| {
        a["kind"] == "give" && a["item"] == "lamp" && a["target"] == "moth"
    });
    commit(&mut world, give.clone());
    assert_eq!(world.game["items"]["lamp"]["holder"], "moth");
    assert_eq!(world.game["actors"]["moth"]["trust"]["vale"], 0);
    assert!(world.game["life"]["actors"]["moth"]["attachments"]["lamp"].is_null());
    assert_eq!(world.game["standoffs"], json!([]));
    let event = world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["verb"] == "give")
        .unwrap();
    assert_eq!(event["handover"]["sourceSeq"], source);
    assert_eq!(event["handover"]["kind"], "pressure");
    let after = world.clone();
    assert!(full_store::commit(&c, &id, &mut world, give, now()).is_err());
    assert_eq!(world, after);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let _ = std::fs::remove_file(path);
}

#[test]
fn craft_outcome_keeps_its_source_and_custody_through_journal_replay() {
    let mut world = created(engine::VERSION);
    let game = &mut world.game;
    game.as_object_mut().unwrap().remove("opening");
    game["turn"] = json!(12);
    game["revision"] = json!(12);
    game["actors"]["vale"]["place"] = json!("greek-courtyard");
    game["actors"]["greek-baker"]["place"] = json!("greek-courtyard");
    game["packs"]["greek-drama"]["met"]["greek-baker"] = json!(12);
    game["items"]["greek-water-jar"]["holder"] = json!("vale");
    game["items"]["greek-wheat"]["holder"] = json!("greek-baker");
    let (path, c, id) = fixture("craft-outcome", &world);
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let gift = play(&world, |a| {
        a["kind"] == "give" && a["item"] == "greek-water-jar" && a["target"] == "greek-baker"
    });
    commit(&mut world, gift.clone());
    let events = world.game["log"].as_array().unwrap();
    let event = events.iter().find(|e| e["verb"] == "craft").unwrap();
    assert_eq!(event["actorId"], "greek-baker");
    assert_eq!(event["itemId"], "greek-bread");
    assert_eq!(event["holderId"], "greek-courtyard");
    assert_eq!(event["locationId"], "greek-courtyard");
    assert_eq!(
        event["consumedIds"],
        json!(["greek-water-jar", "greek-wheat"])
    );
    let source = events
        .iter()
        .find(|e| e["seq"] == event["sourceSeq"])
        .unwrap();
    assert_eq!(source["verb"], "give");
    assert_eq!(source["kind"], "action");
    assert_eq!(source["actorId"], "vale");
    assert_eq!(source["accepted"], true);
    assert_eq!(source["itemId"], "greek-water-jar");
    assert_eq!(source["turn"], event["turn"]);
    assert!(source["seq"].as_u64().unwrap() < event["seq"].as_u64().unwrap());
    assert_eq!(
        world.game["items"]["greek-bread"]["holder"],
        "greek-courtyard"
    );
    let before_retry = world.clone();
    assert!(full_store::commit(&c, &id, &mut world, gift, now()).is_err());
    assert_eq!(world, before_retry);
    let take = play(&world, |a| {
        a["kind"] == "take" && a["item"] == "greek-bread"
    });
    commit(&mut world, take);
    assert_eq!(world.game["items"]["greek-bread"]["holder"], "vale");
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}
