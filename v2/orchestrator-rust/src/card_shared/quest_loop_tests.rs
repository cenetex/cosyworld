use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn fixture(name: &str, world: &World) -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("{name}-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    if let Some(hash) = &world.pack {
        c.execute(
            "INSERT OR IGNORE INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
            rusqlite::params![hash, world.version, &*content::text(hash).unwrap()],
        )
        .unwrap();
    }
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, world, name, now()).unwrap();
    (path, c, id)
}

fn created(version: &str) -> World {
    let content = if version == engine::HUNDRED_TWENTY_EIGHTH_VERSION {
        let text = include_str!("../../../../test/fixtures/released-rules/content-v128.json");
        let hash = content::hash(text);
        let c = rusqlite::Connection::open_in_memory().unwrap();
        full_store::schema(&c).unwrap();
        c.execute(
            "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
            rusqlite::params![hash, version, text],
        )
        .unwrap();
        content::preload(&c, &hash).unwrap();
        hash
    } else {
        content::seeded(version).to_string()
    };
    let pack = engine::takes_content(version).then(|| content.clone());
    let game = engine::reduce_pack(version, Some(&content), json!({"op":"create","seed":9}))
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
        .filter(|w| !w.is_null())
        .chain(vale["under"].as_array().cloned().unwrap_or_default())
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

// Rules 133 in the C QuickJS host: one want per avatar. A Talk records the
// want told and hands the player nothing; giving the item the keeper wants
// pays the helper one XP at once (no claim) and raises the keeper's trust, a
// long rest at halfway dreams the glimpse and never a quest. The journal
// replays every new record (`heard`, `halfwayIssued`, `glimpse`) exactly.
#[test]
fn rules_133_one_want_commits_and_replays_in_the_c_host() {
    let mut world = created(engine::VERSION);
    let game = &mut world.game;
    game.as_object_mut().unwrap().remove("opening");
    game["turn"] = json!(2);
    game["revision"] = json!(2);
    game["actors"]["vale"]["place"] = json!("attic");
    game["actors"]["keeper"]["place"] = json!("attic");
    game["items"]["lamp"]["holder"] = json!("vale");
    game["actors"]["vale"]["heldItem"] = json!("bell");
    game["items"]["bell"]["holder"] = json!("vale");
    game["actors"]["keeper"]["want"] =
        json!({"kind":"item","target":"bell","since":2,"refusals":0});
    game["actors"]["vale"]["level"] = json!(1);
    game["actors"]["vale"]["xp"] = json!(0);
    game["opened"] = json!({"pond":["vale"]});
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
    let held = quests(&world);
    assert_eq!(held.len(), 1);
    assert_eq!(held[0]["from"], "quest:from:keeper");
    assert_eq!(held[0]["target"], "bell");
    assert_eq!(
        world.game["actors"]["vale"]["heard"],
        json!({"keeper":"item:bell"})
    );
    let again = play(&world, |a| a["kind"] == "talk" && a["target"] == "keeper");
    commit(&mut world, again);
    assert_eq!(quests(&world), held);
    assert!(play_missing(&world, |a| a["kind"] == "claim" || a["kind"] == "focus"));

    let give = play(&world, |a| {
        a["kind"] == "give" && a["target"] == "keeper" && a["item"] == "bell"
    });
    commit(&mut world, give);
    let stow = json!({"op":"hold","actor":"vale","choice":{
        "item":null,"revision":world.game["revision"]}});
    commit(&mut world, stow);
    assert_eq!(world.game["actors"]["vale"]["xp"], 2);
    assert!(quests(&world).is_empty());
    assert_eq!(world.game["actors"]["keeper"]["trust"]["vale"], 1);
    assert_eq!(world.game["actors"]["vale"]["halfwayIssued"], 2);
    assert!(world.game["actors"]["vale"].get("questRewards").is_none());
    assert!(quests(&world).is_empty());

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
    assert_eq!(world.game["actors"]["vale"]["glimpse"]["level"], 2);
    // A long rest deals the glimpse and never a quest.
    assert!(quests(&world).is_empty());

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

fn play_missing(world: &World, pick: impl Fn(&Value) -> bool) -> bool {
    !world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(pick)
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

#[test]
fn quiet_held_choice_replays_without_a_turn_or_speech_job() {
    let mut world = created(engine::VERSION);
    world.game["items"]["lamp"]["holder"] = json!("vale");
    world.game["actors"]["vale"]["heldItem"] = json!("lamp");
    let (path, c, id) = fixture("quiet-held-choice", &world);
    let mut world = full_store::world(&c, &id, now()).unwrap();
    let commit = |w: &mut World, cmd: Value| full_store::commit(&c, &id, w, cmd, now());
    commit(&mut world, json!({"op":"claim","actor":"vale"})).unwrap();
    commit(&mut world, json!({"op":"enter","actor":"vale"})).unwrap();
    let turn = world.game["turn"].clone();
    let fuel = world.game["items"]["lamp"]["fuel"].clone();
    let cmd = json!({"op":"hold","actor":"vale","choice":{
        "item":null,"revision":world.game["revision"]}});
    commit(&mut world, cmd.clone()).unwrap();
    assert_eq!(world.game["actors"]["vale"]["heldItem"], Value::Null);
    assert_eq!(world.game["items"]["lamp"]["holder"], "vale");
    assert_eq!(world.game["turn"], turn);
    assert_eq!(world.game["items"]["lamp"]["fuel"], fuel);
    let saved = world.clone();
    assert!(commit(&mut world, cmd).is_err());
    assert_eq!(world, saved);
    let foreign = json!({"op":"hold","actor":"mara","choice":{
        "item":"lamp","revision":world.game["revision"]}});
    assert!(commit(&mut world, foreign).is_err());
    assert_eq!(world, saved);
    let jobs: i64 = c
        .query_row(
            "SELECT count(*) FROM card_full_plays WHERE world=?",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(jobs, 0);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), saved);
    drop(c);
    let _ = std::fs::remove_file(path);
}

#[test]
fn three_room_lamp_replays_dark_travel_and_exhaustion() {
    let mut world = created(engine::VERSION);
    let (path, c, id) = fixture("lamp-room-visits", &world);
    let commit = |w: &mut World, cmd: Value| full_store::commit(&c, &id, w, cmd, now()).unwrap();
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let choose = |w: &mut World, item: Value| {
        let cmd = json!({"op":"hold","actor":"vale","choice":{
            "item":item,"revision":w.game["revision"]}});
        commit(w, cmd);
    };
    choose(&mut world, Value::Null);
    let step = play(&world, |a| a["kind"] == "move" && a["target"] == "pond");
    commit(&mut world, step);
    assert_eq!(world.game["items"]["lamp"]["fuelRooms"], 3);
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    choose(&mut world, json!("lamp"));
    assert_eq!(world.game["items"]["lamp"]["fuelRooms"], 2);
    for (place, remaining) in [("station", 1), ("pond", 0)] {
        let step = play(&world, |a| a["kind"] == "move" && a["target"] == place);
        commit(&mut world, step);
        assert_eq!(world.game["items"]["lamp"]["fuelRooms"], remaining);
        assert_eq!(world.game["items"]["lamp"]["lit"], remaining > 0);
    }
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let _ = std::fs::remove_file(path);
}

#[test]
fn portable_radio_switch_custody_and_sqlite_journal_replay() {
    let mut world = created(engine::VERSION);
    let radio = "ratiradio-portable-radio";
    // Synthetic possession/location fixture, not a completed station quest.
    world.game["items"][radio]["holder"] = json!("attic");
    world.game["actors"]["mara"]["place"] = json!("attic");
    let (path, c, id) = fixture("portable-radio", &world);
    let commit = |w: &mut World, cmd: Value| full_store::commit(&c, &id, w, cmd, now());
    for actor in ["vale", "mara"] {
        commit(&mut world, json!({"op":"claim","actor":actor})).unwrap();
        commit(&mut world, json!({"op":"enter","actor":actor})).unwrap();
    }
    for (kind, target) in [("take", ""), ("radio", ""), ("give", "mara")] {
        let mut cmd = play(&world, |a| {
            a["kind"] == kind && a["item"] == radio && (target.is_empty() || a["target"] == target)
        });
        cmd["revision"] = world.game["revision"].clone();
        commit(&mut world, cmd.clone()).unwrap();
        let accepted = world.clone();
        assert!(commit(&mut world, cmd).is_err());
        assert_eq!(world, accepted);
    }
    assert_eq!(world.game["items"][radio]["holder"], "mara");
    assert_eq!(world.game["items"][radio]["radioOn"], true);
    assert!(!world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["kind"] == "radio"));
    for kind in ["radio", "radio", "drop"] {
        let view = world.project(1).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind && a["item"] == radio)
            .unwrap();
        commit(
            &mut world,
            json!({"op":"play","actor":"mara","action":action}),
        )
        .unwrap();
    }
    assert_eq!(world.game["items"][radio]["holder"], "attic");
    assert_eq!(world.game["items"][radio]["radioOn"], true);
    let stow = json!({"op":"hold","actor":"vale","choice":{
        "item":null,"revision":world.game["revision"]}});
    commit(&mut world, stow).unwrap();
    let cmd = play(&world, |a| a["kind"] == "move" && a["target"] == "pond");
    commit(&mut world, cmd).unwrap();
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let _ = std::fs::remove_file(path);
}
