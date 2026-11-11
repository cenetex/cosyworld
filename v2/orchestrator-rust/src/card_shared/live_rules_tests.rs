//! Live rules the C host runs, kept from tests that began on an older rules
//! version and upgraded it. Those old worlds can no longer be opened (the
//! rules floor, full_floor.rs), so each starts on today's rules instead.
use super::{full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn open(name: &str, fill: char) -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("{name}-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = fill.to_string().repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    (path, c, id)
}
fn play(action: &str) -> Value {
    json!({"op":"play","actor":"vale","action":action})
}
fn strikes(w: &World) -> Vec<Value> {
    let log = w.game["log"].as_array().unwrap();
    log.iter()
        .filter(|e| e["verb"] == "attack")
        .cloned()
        .collect()
}
// A world with Vale at the station, her claim and seat journaled.
fn station(c: &rusqlite::Connection, id: &str, with: &[&str], armed: bool, reason: &str) -> World {
    let mut w = World::seeded(None, Some(9)).unwrap();
    let game = &mut w.game;
    game.as_object_mut().unwrap().remove("opening");
    (game["turn"], game["revision"]) = (json!(3), json!(3));
    for actor in with {
        game["actors"][*actor]["place"] = json!("station");
        if armed {
            (
                game["actors"][*actor]["metTurn"],
                game["actors"][*actor]["want"],
            ) = (json!(0), Value::Null);
        }
    }
    if armed {
        game["items"]["lamp"]["holder"] = json!("moth");
    }
    full_store::seed(c, id, &w, reason, now()).unwrap();
    full_store::commit(c, id, &mut w, json!({"op":"claim","actor":"vale"}), now()).unwrap();
    full_store::commit(c, id, &mut w, json!({"op":"enter","actor":"vale"}), now()).unwrap();
    w
}

// Each strike rolls 1 or 2 by the rules' FNV-1a of
// "seed:strike:revision:actor:target", as the browser does (tiers, rules 83).
#[test]
fn strikes_roll_by_tier_in_the_c_host_and_replay() {
    let (path, c, id) = open("card-tiers", 'e');
    let mut w = station(&c, &id, &["vale", "moth"], true, "tiers");
    for action in ["threaten:vale:lamp:moth", "attack:vale::moth"] {
        full_store::commit(&c, &id, &mut w, play(action), now()).unwrap();
    }
    let (seed, revision) = (&w.game["run"]["seed"], &w.game["revision"]);
    let all = strikes(&w);
    assert!(!all.is_empty());
    for hit in &all {
        let key = format!(
            "{seed}:strike:{revision}:{}:{}",
            hit["actorId"].as_str().unwrap(),
            hit["targetId"].as_str().unwrap()
        );
        let hash = key.chars().fold(2166136261u32, |h, ch| {
            (h ^ ch as u32).wrapping_mul(16777619)
        });
        let landed = (1 + hash % 2)
            .saturating_sub(u32::from(hit["guarded"] == true))
            .max(1);
        assert_eq!(hit["damage"], json!(landed), "{hit}");
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}

// Talk is gone from a standoff and Brace names no target. The keeper joins the
// battle as Vale plays, and a round without a Strike ends it (rules 84).
#[test]
fn standoffs_and_battles_run_in_the_c_host_and_replay() {
    let (path, c, id) = open("card-battle", 'f');
    let mut w = station(&c, &id, &["vale", "moth", "keeper"], true, "battle");
    full_store::commit(&c, &id, &mut w, play("threaten:vale:lamp:moth"), now()).unwrap();
    assert_eq!(
        w.game["standoffs"][0]["resolve"],
        json!({"vale": 4, "moth": 4, "keeper": 4})
    );
    let talk = w.apply(&play("talk:vale::moth"));
    assert!(talk.map_or(true, |r| r["ok"] == false));
    full_store::commit(&c, &id, &mut w, play("guard:vale::"), now()).unwrap();
    let log = w.game["log"].as_array().unwrap();
    assert!(log
        .iter()
        .any(|e| e["verb"] == "guard" && e["actorId"] == "vale"));
    assert!(log
        .iter()
        .any(|e| e["text"] == "Nobody strikes for a whole round. The battle ends."));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}

// A speech op holds only the voices its play named, once each (rules 93). A
// threat voices only its target, so Pip's lone reply commits through the real
// engine; a line from an unnamed voice, or one voice twice, is refused.
#[test]
fn speech_keeps_to_the_voices_its_play_named() {
    let (path, c, id) = open("card-speech", 'g');
    let mut w = station(&c, &id, &["vale", "moth"], false, "speech");
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    let speech =
        |lines: Value| json!({"op":"speech","actor":"vale","room":"station","lines":lines});
    let pip = json!({"actorId":"moth","entityId":"moth","text":"Keep your threats, Vale."});
    let vale = json!({"actorId":"vale","entityId":"vale","text":"Give me the lamp."});
    let actions = w.project(0).unwrap()["actions"].clone();
    let threat = actions
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "threaten" && a["target"] == "moth")
        .unwrap_or_else(|| panic!("{actions}"))
        .clone();
    commit(&mut w, json!({"op":"play","actor":"vale","action":threat}));
    for refused in [json!([vale]), json!([pip, vale]), json!([pip, pip])] {
        let error =
            full_store::commit(&c, &id, &mut w.clone(), speech(refused), now()).unwrap_err();
        assert!(error.to_string().contains("speaks once"), "{error}");
    }
    let result = commit(&mut w, speech(json!([pip])));
    assert_eq!(result["lines"].as_array().unwrap().len(), 1);
    assert_eq!(result["lines"][0]["actorId"], "moth");
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}

// Wait is one turn; Sleep lasts until a real change. Daylight wakes a long
// rest without consuming lamp room fuel, and any other play wakes the sleeper
// first (#2028).
#[test]
fn sleep_replays_and_preserves_room_fuel() {
    let (path, c, id) = open("card-sleep", 'd');
    let mut w = World::create(None).unwrap();
    w.game.as_object_mut().unwrap().remove("opening");
    w.game["actors"]["vale"]["place"] = json!("attic");
    full_store::seed(&c, &id, &w, "sleep", now()).unwrap();
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut w, json!({"op":"claim","actor":"vale"}));
    commit(&mut w, json!({"op":"enter","actor":"vale"}));
    let lamp = w.game["items"]["lamp"].clone();
    assert_eq!(lamp["fuelPlace"], "attic");
    let turn = w.game["turn"].as_i64().unwrap();
    commit(&mut w, play("wait:vale::"));
    assert_eq!(w.game["turn"], json!(turn + 1));
    assert!(w.game["actors"]["vale"].get("sleeping").is_none());
    commit(&mut w, play("sleep:vale::"));
    let since = w.game["actors"]["vale"]["sleeping"]["since"].as_i64();
    let woke = |w: &World| {
        w.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .rev()
            .find(|e| e["actorId"] == "vale" && e.get("woke").is_some())
            .cloned()
    };
    for _ in 0..24 {
        if woke(&w).is_some() {
            break;
        }
        assert_eq!(w.game["actors"]["vale"]["sleeping"]["place"], "attic");
        commit(&mut w, play("sleep:vale::"));
    }
    let event = woke(&w).expect("the sleeper wakes");
    assert_eq!(event["verb"], "wait");
    let slept = event["turn"].as_i64().unwrap() - since.unwrap();
    assert_eq!(event["rest"] == "long", slept >= 12, "{event}");
    assert_eq!(event["woke"], "dusk");
    assert_eq!(event["turn"], 24);
    assert_eq!(w.game["items"]["lamp"]["fuelPlace"], lamp["fuelPlace"]);
    let fuel = w.game["items"]["lamp"].clone();
    commit(&mut w, play("wait:vale::"));
    assert_eq!(w.game["items"]["lamp"], fuel);
    let asleep = |w: &World| w.game["actors"]["vale"].get("sleeping").is_some();
    for _ in 0..4 {
        if !asleep(&w) {
            commit(&mut w, play("sleep:vale::"));
        }
    }
    assert!(asleep(&w), "{:?}", woke(&w));
    commit(&mut w, play("wait:vale::"));
    assert_eq!(woke(&w).unwrap()["woke"], "chose");
    assert!(w.game["actors"]["vale"].get("sleeping").is_none());
    assert_eq!(w.game["items"]["lamp"], fuel);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}

// A local actual Ask -> Threaten, built by the browser rules on today's
// rules and continued through shared authority.
fn pressured_game() -> Value {
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
            "import { pressuredHandover } from './test/helpers/pressured-handover.mjs'; console.log(JSON.stringify(pressuredHandover()));",
        ])
        .output()
        .expect("Node 24 builds the pressured handover");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn pressured_handover_replays_custody_and_social_meaning_without_checkpoints() {
    let mut world = World::create(None).unwrap();
    world.game = pressured_game();
    let (path, c, id) = open("pressured-handover-replay", 'e');
    full_store::seed(&c, &id, &world, "pressured-handover-replay", now()).unwrap();
    let commit =
        |w: &mut World, command: Value| full_store::commit(&c, &id, w, command, now()).unwrap();
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let source = world.game["standoffs"][0]["sourceSeq"].clone();
    assert!(source.as_u64().unwrap() > 0);
    let actions = world.project(0).unwrap()["actions"].clone();
    let give = actions
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "give" && a["item"] == "lamp" && a["target"] == "moth")
        .unwrap_or_else(|| panic!("{actions}"))
        .clone();
    commit(
        &mut world,
        json!({"op":"play","actor":"vale","action":give.clone()}),
    );
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
    assert!(full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":give}),
        now()
    )
    .is_err());
    assert_eq!(world, after);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let _ = std::fs::remove_file(path);
}

// The scene the browser draws for this avatar, from the narrator bundle.
fn scene(world: &World, a: usize) -> Value {
    super::narrator::scene(&world.request("context", a)).unwrap()
}

#[test]
fn regional_weather_agrees_in_c_and_survives_journal_replay() {
    let (path, c, id) = open("weather", 'c');
    let mut world = World::create(None).unwrap();
    world.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["packs"]["greek-drama"]["scope"] = json!("full");
    world.game["actors"]["vale"]["place"] = json!("greek-harbor");
    world.game["actors"]["mara"]["place"] = json!("greek-sanctuary");
    world.game["actors"]["greek-rhapsode"]["place"] = json!("attic");
    world.game["turn"] = json!(23);
    world.game["revision"] = json!(23);
    world.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    full_store::seed(&c, &id, &world, "weather", now()).unwrap();
    assert_eq!(scene(&world, 0)["weather"]["condition"], "cloud");
    let action = world.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    for (actor, variant) in [(0, "rain-coast"), (1, "rain-grove")] {
        let view = scene(&world, actor);
        let weather = &view["weather"];
        assert_eq!(weather["region"], "boeotia");
        assert_eq!(weather["condition"], "rain");
        assert_eq!(weather["variant"], variant);
        assert_eq!(view["daylight"]["phase"], "night");
        assert!(view["background"]
            .as_str()
            .unwrap()
            .ends_with("-night.webp"));
    }
    assert_eq!(
        scene(&world, 0)["background"],
        "./assets/greek-drama/harbor-ship-at-berth-night.webp"
    );
    let views = [world.project(0).unwrap(), world.project(1).unwrap()];
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let replay = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(replay, world);
    assert_eq!(replay.project(0).unwrap(), views[0]);
    assert_eq!(replay.project(1).unwrap(), views[1]);
    drop(c);
    std::fs::remove_file(path).unwrap();
}
