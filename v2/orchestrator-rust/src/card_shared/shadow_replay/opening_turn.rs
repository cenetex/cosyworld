use super::{
    active_worlds, engine, full_store, read_candidate, reduce_candidate, verify_worlds, Result,
    Rules, World,
};
use crate::card_shared::{
    full_world::actor_index,
    store::{self, sql_error},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;

type PlayAssertion = fn(&Value, &Value);

const WAIT: (&str, PlayAssertion) = ("wait:vale::", check_wait);
const SECOND_WAIT: (&str, PlayAssertion) = (WAIT.0, check_silent_wait);
const DROP: (&str, PlayAssertion) = ("drop:vale:lamp:attic", check_lamp_drop);
const TAKE: (&str, PlayAssertion) = ("take:vale:lamp:", check_lamp_take);
const BARE_POND_MOVE: (&str, PlayAssertion) = ("move:vale::pond", check_bare_pond_move);
const BARE_STATION_MOVE: (&str, PlayAssertion) = ("move:vale::station", check_bare_station_move);
const HISTORIC_POND_MOVE: (&str, PlayAssertion) = (BARE_POND_MOVE.0, check_historic_pond_move);
const AWAKE_HISTORIC_POND_MOVE: (&str, PlayAssertion) =
    (BARE_POND_MOVE.0, check_awake_historic_pond_move);
const KEEPER_LOG_READ: (&str, PlayAssertion) = ("read:vale:keeper-log:", check_keeper_log_read);
const SHIP_CALL_VISITORS: &[(&str, &str, &str, &str)] = &[
    ("ada", "loft", "greek-ship", "shears"),
    ("tavi", "hill", "forest-oak", "kite"),
];

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_wait() -> Result<()> {
    replay_opening_turns("first-attic-wait", unseeded_opening()?, false, &[WAIT])
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_drop() -> Result<()> {
    replay_opening_turns("first-attic-drop", unseeded_opening()?, false, &[DROP])
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_wait_after_history() -> Result<()> {
    replay_opening_turns(
        "first-attic-wait-after-history",
        historic_opening(Some(4242))?,
        false,
        &[WAIT],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_drop_after_history() -> Result<()> {
    replay_opening_turns(
        "first-attic-drop-after-history",
        historic_opening(Some(4242))?,
        false,
        &[DROP],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_bare_pond_move() -> Result<()> {
    replay_opening_turns(
        "first-bare-pond-move",
        unseeded_opening()?,
        true,
        &[BARE_POND_MOVE],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_bare_pond_move_after_history() -> Result<()> {
    replay_opening_turns(
        "first-bare-pond-move-after-history",
        historic_opening(Some(4242))?,
        true,
        &[HISTORIC_POND_MOVE],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_second_attic_wait() -> Result<()> {
    replay_opening_turns(
        "second-attic-wait",
        unseeded_opening()?,
        false,
        &[WAIT, SECOND_WAIT],
    )
}

#[test]
fn sqlite_rules_wasm_parity_reenters_after_the_second_attic_wait() -> Result<()> {
    let id = "reenter-after-second-attic-wait";
    let (mut c, mut state, mut calls) =
        commit_opening_turns(id, unseeded_opening()?, false, &[WAIT, SECOND_WAIT])?;
    let vale = actor_index("vale")?;
    let played = state.game.clone();
    assert_eq!((state.claimed[vale], state.present[vale]), (1, 1));
    for (time, op, present) in [(6, "leave", 0), (7, "enter", 1)] {
        full_store::commit(&c, id, &mut state, json!({"op":op,"actor":"vale"}), time)?;
        assert_eq!((state.claimed[vale], state.present[vale]), (1, present));
        assert_eq!(state.game, played);
        calls.push("presence");
    }
    verify_opening_journal(&mut c, id, &calls)
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_second_attic_lamp_take() -> Result<()> {
    replay_opening_turns(
        "second-attic-lamp-take",
        unseeded_opening()?,
        false,
        &[DROP, TAKE],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_second_bare_pond_move() -> Result<()> {
    replay_opening_turns(
        "second-bare-pond-move",
        unseeded_opening()?,
        true,
        &[WAIT, BARE_POND_MOVE],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_station_after_the_first_pond_move() -> Result<()> {
    replay_opening_turns(
        "station-after-first-pond-move",
        unseeded_opening()?,
        true,
        &[BARE_POND_MOVE, BARE_STATION_MOVE],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_move_behind_station() -> Result<()> {
    let id = "first-move-behind-station";
    let (mut c, state, calls) = commit_opening_turns(
        id,
        unseeded_opening()?,
        true,
        &[
            BARE_POND_MOVE,
            BARE_STATION_MOVE,
            ("move:vale::behind-station", |lamp, reply| {
                check_quiet_station_departure(lamp, reply, "behind-station");
                let world = &reply["world"];
                assert_eq!(world["turn"], 3);
                assert_eq!(world["actors"]["vale"]["want"], Value::Null);
                assert_eq!(
                    world["actors"]["vale"]["visited"],
                    json!(["attic", "pond", "station", "behind-station"])
                );
                assert_eq!(world["items"]["ratiradio-station-key"]["holder"], "pond");
            }),
        ],
    )?;
    verify_opening_journal(&mut c, id, &calls)?;
    verify_seated_reload(&c, id, &state, "behind-station", &["station"], 8)
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_keeper_log_read() -> Result<()> {
    replay_opening_turns(
        "first-keeper-log-read",
        unseeded_opening()?,
        true,
        &[BARE_POND_MOVE, BARE_STATION_MOVE, KEEPER_LOG_READ],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_keeper_quest_pond_return() -> Result<()> {
    let id = "keeper-quest-pond-return";
    let (mut c, state, calls) = commit_keeper_quest_pond_return(id, None)?;
    verify_opening_journal(&mut c, id, &calls)?;
    verify_seated_reload(&c, id, &state, "pond", &["station"], 10)
}

fn commit_keeper_quest_pond_return(
    id: &str,
    seed: Option<u32>,
) -> Result<(Connection, World, Vec<&'static str>)> {
    let (c, mut state, mut calls) = commit_keeper_quest(id, seed)?;
    let known = state.game["knowledge"]["known"]["vale"]["quest:keeper:pond"].clone();
    let want = state.game["actors"]["vale"]["want"].clone();
    let lamp = state.game["items"]["lamp"].clone();
    let returned = commit_keeper_play(&c, id, &mut state, &mut calls, BARE_POND_MOVE.0, 9)?;
    assert_eq!(state.game["turn"], 4);
    check_quiet_station_departure(&lamp, &returned, "pond");
    assert_eq!(state.game["actors"]["vale"]["want"], want);
    assert_eq!(
        state.game["knowledge"]["known"]["vale"]["quest:keeper:pond"],
        known
    );
    assert_eq!(
        state.game["actors"]["vale"]["visited"],
        json!(["attic", "pond", "station"])
    );
    assert_eq!(
        state.game["crossings"]["pond-greek-harbor"]["discovered"],
        false
    );
    let actions = returned["actions"].as_array().ok_or("Missing actions.")?;
    assert_eq!(actions.last().unwrap()["key"], "drop:vale:::0");
    assert!(actions
        .iter()
        .any(|action| action["key"] == "accept:vale::box:greek-ship"));
    Ok((c, state, calls))
}

#[test]
fn sqlite_rules_wasm_parity_replays_keeper_quest_station_return_and_cloth_gift() -> Result<()> {
    let id = "keeper-quest-station-return-cloth-gift";
    let (mut c, state, calls) = commit_keeper_quest_station_return(id, None)?;
    assert_eq!(calls.len(), 9);
    verify_opening_journal(&mut c, id, &calls)?;
    verify_seated_reload(&c, id, &state, "station", &["pond", "behind-station"], 11)
}

fn commit_keeper_quest_station_return(
    id: &str,
    seed: Option<u32>,
) -> Result<(Connection, World, Vec<&'static str>)> {
    let (c, mut state, mut calls) = commit_keeper_quest_pond_return(id, seed)?;
    let want = state.game["actors"]["vale"]["want"].clone();
    let lamp = state.game["items"]["lamp"].clone();
    let returned = commit_keeper_play(&c, id, &mut state, &mut calls, BARE_STATION_MOVE.0, 10)?;
    let [arrival, gift] = returned["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale's Station arrival followed by Pip's cloth gift");
    };
    let world = &state.game;
    check_stowed_lamp_move(&lamp, &returned, "pond", "station");
    assert_eq!(world["turn"], 5);
    assert_eq!(arrival["seq"], 18);
    assert_eq!(arrival["cast"], json!(["keeper", "moth", "vale"]));
    assert_eq!(gift["seq"], 19);
    assert_eq!(gift["actorId"], "moth");
    assert_eq!(gift["verb"], "give");
    assert_eq!(gift["itemId"], "cloth");
    assert_eq!(gift["targetId"], "vale");
    assert_eq!(gift["accepted"], true);
    assert_eq!(gift["locationId"], "station");
    assert_eq!(gift["cast"], arrival["cast"]);
    assert_eq!(world["eventSeq"], gift["seq"]);
    assert_eq!(world["actors"]["vale"]["want"], want);
    assert_eq!(world["actors"]["vale"]["heldItem"], "cloth");
    assert_eq!(world["actors"]["moth"]["heldItem"], Value::Null);
    assert_eq!(world["items"]["cloth"]["holder"], "vale");
    assert_eq!(
        world["items"]["cloth"]["history"][1],
        "Turn 5: Pip gives the Black cloth to Vale."
    );
    assert_eq!(world["speechVoices"]["vale"], json!(["vale"]));
    assert_eq!(
        returned["actions"].as_array().unwrap().last().unwrap()["key"],
        "drop:vale:::0"
    );
    Ok((c, state, calls))
}

#[test]
fn sqlite_rules_wasm_parity_replays_keeper_quest_pond_return_with_cloth() -> Result<()> {
    let id = "keeper-quest-pond-return-with-cloth";
    let (mut c, state, calls) = commit_keeper_quest_pond_with_cloth(id, None)?;
    assert_eq!(calls.len(), 10);
    verify_opening_journal(&mut c, id, &calls)?;
    verify_seated_reload(&c, id, &state, "pond", &["station"], 12)
}

fn commit_keeper_quest_pond_with_cloth(
    id: &str,
    seed: Option<u32>,
) -> Result<(Connection, World, Vec<&'static str>)> {
    let (c, mut state, mut calls) = commit_keeper_quest_station_return(id, seed)?;
    let want = state.game["actors"]["vale"]["want"].clone();
    let lamp = state.game["items"]["lamp"].clone();
    let mut cloth = state.game["items"]["cloth"].clone();
    cloth["history"]
        .as_array_mut()
        .unwrap()
        .push(json!("Turn 6: Vale carried it to Black pond."));
    let returned = commit_keeper_play(&c, id, &mut state, &mut calls, BARE_POND_MOVE.0, 11)?;
    let [arrival] = returned["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale's single Pond arrival with the cloth");
    };
    let world = &state.game;
    check_stowed_lamp_move(&lamp, &returned, "station", "pond");
    assert_eq!(world["turn"], 6);
    assert_eq!(world["eventSeq"], 20);
    assert_eq!(arrival["seq"], world["eventSeq"]);
    assert_eq!(arrival["cast"], json!(["vale"]));
    assert_eq!(world["actors"]["moth"]["place"], "station");
    assert_eq!(world["actors"]["keeper"]["place"], "station");
    assert_eq!(world["actors"]["vale"]["heldItem"], "cloth");
    assert_eq!(world["items"]["cloth"], cloth);
    assert_eq!(world["actors"]["vale"]["want"], want);
    assert_eq!(
        world["crossings"]["pond-greek-harbor"],
        json!({"discovered":false})
    );
    assert!(returned["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|action| action["key"] == "drop:vale:lamp:pond"));
    Ok((c, state, calls))
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_quiet_keeper_quest_ship_call() -> Result<()> {
    verify_keeper_quest_ship_call("quiet-keeper-quest-ship-call", Some(17), &[])
}

#[test]
fn sqlite_rules_wasm_parity_replays_keeper_quest_ship_call_with_visitors() -> Result<()> {
    verify_keeper_quest_ship_call(
        "keeper-quest-ship-call-with-visitors",
        None,
        SHIP_CALL_VISITORS,
    )
}

fn verify_keeper_quest_ship_call(
    id: &str,
    seed: Option<u32>,
    visitors: &[(&str, &str, &str, &str)],
) -> Result<()> {
    let (mut c, state, calls) = commit_keeper_quest_ship_call(id, seed, visitors)?;
    verify_opening_journal(&mut c, id, &calls)?;
    verify_seated_reload(
        &c,
        id,
        &state,
        "pond",
        &["station", "attic", "greek-ship"],
        13,
    )
}

fn commit_keeper_quest_ship_call(
    id: &str,
    seed: Option<u32>,
    visitors: &[(&str, &str, &str, &str)],
) -> Result<(Connection, World, Vec<&'static str>)> {
    let (c, mut state, mut calls) = commit_keeper_quest_pond_with_cloth(id, seed)?;
    if let Some(seed) = seed {
        assert_eq!(state.game["run"]["seed"], seed);
    }
    let keeper_want = state.game["actors"]["keeper"]["want"].clone();
    let cloth = state.game["items"]["cloth"].clone();
    let called = commit_keeper_play(&c, id, &mut state, &mut calls, "drop:vale:lamp:pond", 12)?;
    let events = called["events"].as_array().unwrap();
    let [drop, credit, offstage @ .., reflection] = events.as_slice() else {
        panic!("Expected Vale's Drop, the Keeper's quest credit, and the opened reflection");
    };
    let world = &state.game;
    assert_eq!(world["turn"], 7);
    assert_eq!(world["eventSeq"], reflection["seq"]);
    for (seq, event) in (21..).zip(events) {
        assert_eq!(event["seq"], seq);
        assert_eq!(event["turn"], 7);
    }
    assert_eq!(offstage.len(), visitors.len());
    for (event, &(actor, from, to, item)) in offstage.iter().zip(visitors) {
        assert_eq!(event["actorId"], actor);
        assert_eq!(event["verb"], "move");
        assert_eq!(event["fromLocationId"], from);
        assert_eq!(event["locationId"], to);
        assert_eq!(world["actors"][actor]["place"], to);
        assert_eq!(world["items"][item]["holder"], from);
    }
    for event in [drop, credit, reflection] {
        assert_eq!(event["locationId"], "pond");
        assert_eq!(event["cast"], json!(["vale"]));
        assert_eq!(event["light"], true);
    }
    assert_eq!(drop["actorId"], "vale");
    assert_eq!(drop["verb"], "drop");
    assert_eq!(drop["itemId"], "lamp");
    assert_eq!(drop["targetId"], "pond");
    assert_eq!(credit["actorId"], "vale");
    assert_eq!(credit["verb"], "want_met");
    assert_eq!(credit["wantMet"], json!({"kind":"place","target":"pond"}));
    assert_eq!(credit["text"], "Vale calls the ship for The keeper.");
    assert_eq!(reflection["kind"], "narration");
    assert_eq!(reflection["actorId"], Value::Null);
    assert_eq!(
        reflection["text"],
        "The pond's reflection opens a path to the attic."
    );
    assert_eq!(world["actors"]["vale"]["heldItem"], "cloth");
    assert_eq!(world["actors"]["vale"]["want"], Value::Null);
    assert_eq!(world["items"]["cloth"], cloth);
    assert_eq!(
        world["actors"]["vale"]["arcana"]["callers"],
        json!(["keeper"])
    );
    assert_eq!(
        world["actors"]["keeper"]["completedQuest"],
        json!({"want":keeper_want,"by":"vale","turn":7})
    );
    assert_eq!(world["items"]["lamp"]["holder"], "pond");
    assert_eq!(world["items"]["lamp"]["fuel"], 8);
    assert_eq!(world["items"]["lamp"]["lit"], true);
    assert_eq!(
        world["crossings"]["pond-greek-harbor"],
        json!({"discovered":true,"method":"pond-lamp"})
    );
    assert_eq!(
        world["transports"]["greek-ship"],
        json!({"version":3,"phase":"docked","dock":"pond","riders":[],"destination":null,"since":7,"recall":null})
    );
    assert_eq!(calls.len(), 11);
    Ok((c, state, calls))
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_ship_boarding() -> Result<()> {
    verify_keeper_quest_ship_boarding(
        "first-ship-boarding",
        Some(17),
        &[],
        "move:vale::greek-ship",
        None,
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_first_ship_boarding_with_sage() -> Result<()> {
    verify_keeper_quest_ship_boarding(
        "first-ship-boarding-with-sage",
        None,
        SHIP_CALL_VISITORS,
        "move:vale:cloth:greek-ship",
        Some("cloth"),
    )
}

fn verify_keeper_quest_ship_boarding(
    id: &str,
    seed: Option<u32>,
    visitors: &[(&str, &str, &str, &str)],
    action: &str,
    carried: Option<&str>,
) -> Result<()> {
    let (mut c, mut state, mut calls) = commit_keeper_quest_ship_call(id, seed, visitors)?;
    let seq = state.game["eventSeq"].as_u64().unwrap() + 1;
    let lamp = state.game["items"]["lamp"].clone();
    let mut cloth = state.game["items"]["cloth"].clone();
    cloth["history"]
        .as_array_mut()
        .unwrap()
        .push(json!("Turn 8: Vale carried it to The Charybdis."));
    let mut ship = state.game["transports"]["greek-ship"].clone();
    ship["since"] = json!(8);
    let boarded = commit_keeper_play(&c, id, &mut state, &mut calls, action, 13)?;
    let [event] = boarded["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale's single boarding event");
    };
    let world = &state.game;
    assert_eq!(boarded["room"], "greek-ship");
    assert_eq!(boarded["exits"], json!(["greek-harbor"]));
    assert_eq!(world["turn"], 8);
    assert_eq!(world["eventSeq"], seq);
    assert_eq!(
        world["arrival"],
        json!({"seq":seq,"fromLocationId":"pond","locationId":"greek-ship"})
    );
    assert_eq!(event["seq"], seq);
    assert_eq!(event["kind"], "action");
    assert_eq!(event["actorId"], "vale");
    assert_eq!(event["verb"], "move");
    assert_eq!(event["fromLocationId"], "pond");
    assert_eq!(event["locationId"], "greek-ship");
    assert_eq!(event["targetId"], "greek-ship");
    assert_eq!(event["itemId"], json!(carried));
    let narration = if carried.is_some() {
        "Vale carries the Black cloth aboard The Charybdis."
    } else {
        "Vale boards The Charybdis."
    };
    assert_eq!(event["text"], narration);
    assert_eq!(event["items"], json!([{"id":"cloth","holder":"vale"}]));
    assert_eq!(event["light"], false);
    assert_eq!(world["actors"]["vale"]["place"], "greek-ship");
    assert_eq!(world["actors"]["vale"]["crossed"], 2);
    assert_eq!(
        world["actors"]["vale"]["visited"],
        json!(["attic", "pond", "station", "greek-ship"])
    );
    assert_eq!(world["actors"]["vale"]["heldItem"], "cloth");
    assert_eq!(world["items"]["cloth"], cloth);
    assert_eq!(world["items"]["lamp"], lamp);
    assert_eq!(world["transports"]["greek-ship"], ship);
    let with_sage = visitors
        .iter()
        .any(|(actor, _, to, _)| *actor == "ada" && *to == "greek-ship");
    let (cast, voices, met) = if with_sage {
        assert_eq!(world["actors"]["ada"]["place"], "greek-ship");
        (json!(["ada", "vale"]), json!(["vale", "ada"]), json!(8))
    } else {
        assert_eq!(world["actors"]["ada"]["place"], "loft");
        (json!(["vale"]), json!(["vale"]), Value::Null)
    };
    assert_eq!(event["cast"], cast);
    assert_eq!(world["speechVoices"]["vale"], voices);
    assert_eq!(world["opening"]["met"]["ada"], met);
    assert_eq!(world["packs"]["shared-homes"]["met"]["ada"], met);
    let mut keys = vec!["wait:vale::", "course:vale::greek-harbor"];
    if with_sage {
        keys.extend(["threaten:vale::ada", "talk:vale::ada"]);
    }
    keys.push("drop:vale:cloth:greek-ship");
    if with_sage {
        keys.push("give:vale:cloth:ada");
    }
    keys.push("accept:vale::box:loft");
    let action_keys: Vec<_> = boarded["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|action| action["key"].as_str().unwrap())
        .collect();
    assert_eq!(action_keys, keys);
    assert_eq!(calls.len(), 12);
    verify_opening_journal(&mut c, id, &calls)?;
    let view = seated_reload(&c, id, &state, "greek-ship", &["greek-harbor"], 14)?;
    assert_eq!(
        view["world"]["actors"]["ada"]["place"],
        world["actors"]["ada"]["place"]
    );
    assert_eq!(view["world"]["speechVoices"]["vale"], voices);
    assert_eq!(view["world"]["items"]["cloth"], cloth);
    assert_eq!(view["actions"], boarded["actions"]);
    assert!(view["world"]["memories"]["ada"].get("learning").is_none());
    Ok(())
}

#[test]
fn sqlite_rules_wasm_parity_replays_keeper_quest_abandonment_and_cloth_gift() -> Result<()> {
    let id = "keeper-quest-abandonment-cloth-gift";
    let (mut c, mut state, mut calls) = commit_keeper_quest(id, None)?;
    let revision = state.game["revision"].as_u64().ok_or("Missing revision.")?;
    let seq = state.game["eventSeq"]
        .as_u64()
        .ok_or("Missing event sequence.")?;
    let known = state.game["knowledge"]["known"]["vale"]["quest:keeper:pond"].clone();
    let reply = full_store::commit(
        &c,
        id,
        &mut state,
        json!({"op":"play","actor":"vale","action":"drop:vale:::0"}),
        9,
    )?;
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["world"], state.game);
    assert_eq!(reply["room"], "station");
    assert_eq!(state.game["turn"], 4);
    assert_eq!(state.game["revision"], revision + 1);
    assert_eq!(state.game["eventSeq"], seq + 2);
    let [drop, gift] = reply["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale's abandonment followed by Pip's gift");
    };
    assert_eq!(drop["seq"], seq + 1);
    assert_eq!(drop["actorId"], "vale");
    assert_eq!(drop["verb"], "drop");
    assert_eq!(drop["itemId"], Value::Null);
    assert_eq!(gift["seq"], seq + 2);
    assert_eq!(gift["actorId"], "moth");
    assert_eq!(gift["verb"], "give");
    assert_eq!(gift["itemId"], "cloth");
    assert_eq!(gift["targetId"], "vale");
    assert_eq!(gift["accepted"], true);
    assert_eq!(gift["locationId"], "station");
    assert_eq!(gift["cast"], drop["cast"]);
    assert_eq!(gift["witnesses"], drop["witnesses"]);
    let witnesses = gift["witnesses"]
        .as_array()
        .ok_or("Missing gift witnesses.")?;
    for id in ["vale", "moth", "keeper", "cloth"] {
        assert!(witnesses.iter().any(|witness| witness == id));
    }
    let vale = &state.game["actors"]["vale"];
    assert_eq!(vale["want"], Value::Null);
    assert_eq!(vale["gaveUp"], json!({"target":"pond","turn":4}));
    let terms = r#"["place","pond",[["crossing","pond-greek-harbor"],["verb","call"]],null]"#;
    assert_eq!(vale["closed"], json!({"quest:from:keeper":[4,terms]}));
    assert_eq!(vale["heldItem"], "cloth");
    assert_eq!(state.game["actors"]["moth"]["heldItem"], Value::Null);
    assert_eq!(state.game["items"]["cloth"]["holder"], "vale");
    let history = state.game["items"]["cloth"]["history"].as_array().unwrap();
    assert_eq!(
        history.last(),
        Some(&json!("Turn 4: Pip gives the Black cloth to Vale."))
    );
    assert_eq!(state.game["speechVoices"]["vale"], json!(["vale"]));
    assert_eq!(
        state.game["knowledge"]["known"]["vale"]["quest:keeper:pond"],
        known
    );
    let actions = reply["actions"].as_array().ok_or("Missing actions.")?;
    assert!(actions
        .iter()
        .all(|action| action["key"] != "accept:vale::keeper"));
    assert!(actions
        .iter()
        .any(|action| action["key"] == "drop:vale:cloth:station"));
    calls.push("play");
    verify_opening_journal(&mut c, id, &calls)?;
    verify_seated_reload(&c, id, &state, "station", &["pond", "behind-station"], 10)
}

#[test]
fn sqlite_rules_wasm_parity_replays_station_after_history() -> Result<()> {
    let state = historic_opening(None)?;
    assert_eq!(state.game["began"], 480);
    assert!(state.game.get("run").is_none());
    replay_opening_turns(
        "station-after-history",
        state,
        true,
        &[
            HISTORIC_POND_MOVE,
            (BARE_STATION_MOVE.0, |lamp, reply| {
                check_bare_move(lamp, reply, "pond", "station");
                let world = &reply["world"];
                assert_eq!(world["turn"], 482);
                assert_eq!(reply["events"].as_array().unwrap().len(), 1);
                assert_eq!(world["eventSeq"], world["arrival"]["seq"]);
                let pip = &world["actors"]["moth"];
                assert_eq!(pip["place"], "pond");
                assert_eq!(
                    pip["sleeping"],
                    json!({"since":481,"place":"pond","until":503})
                );
                assert_eq!(pip["slept"], 481);
                assert_eq!(world["opening"]["met"]["keeper"], 482);
                assert_eq!(world["speechVoices"]["vale"], json!(["vale", "keeper"]));
            }),
        ],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_awake_historic_station_follow() -> Result<()> {
    replay_opening_turns(
        "awake-historic-station-follow",
        historic_opening(Some(17))?,
        true,
        &[
            AWAKE_HISTORIC_POND_MOVE,
            (BARE_STATION_MOVE.0, |lamp, reply| {
                check_awake_historic_station_move(lamp, reply, false);
            }),
        ],
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_awake_historic_station_with_ada() -> Result<()> {
    replay_opening_turns(
        "awake-historic-station-with-ada",
        historic_opening(Some(99))?,
        true,
        &[
            AWAKE_HISTORIC_POND_MOVE,
            (BARE_STATION_MOVE.0, |lamp, reply| {
                check_awake_historic_station_move(lamp, reply, true);
            }),
        ],
    )
}

#[test]
fn sqlite_rules_wasm_parity_reenters_awake_historic_station() -> Result<()> {
    let id = "reenter-awake-historic-station";
    let (mut c, mut state, mut calls) = commit_opening_turns(
        id,
        historic_opening(Some(99))?,
        true,
        &[
            AWAKE_HISTORIC_POND_MOVE,
            (BARE_STATION_MOVE.0, |lamp, reply| {
                check_awake_historic_station_move(lamp, reply, true);
            }),
        ],
    )?;
    let vale = actor_index("vale")?;
    let arrived = state.game.clone();
    for (time, op, present) in [(7, "leave", 0), (8, "enter", 1)] {
        full_store::commit(&c, id, &mut state, json!({"op":op,"actor":"vale"}), time)?;
        assert_eq!((state.claimed[vale], state.present[vale]), (1, present));
        assert_eq!(state.game, arrived);
        calls.push("presence");
    }
    verify_opening_journal(&mut c, id, &calls)
}

#[test]
fn sqlite_rules_wasm_parity_replays_station_train_quest_and_reload() -> Result<()> {
    let id = "station-train-quest";
    let (mut c, mut state, mut calls) = commit_opening_turns(
        id,
        unseeded_opening()?,
        true,
        &[BARE_POND_MOVE, BARE_STATION_MOVE],
    )?;
    let mut expected = state.game.clone();
    let turn = expected["turn"].as_u64().ok_or("Missing turn.")?;
    let revision = expected["revision"].as_u64().ok_or("Missing revision.")?;
    let want = json!({
        "kind":"item", "target":"routes", "since":turn, "refusals":0, "story":true,
        "step":{"verb":"bring","at":"station"}, "from":"quest:box:train",
    });
    expected["revision"] = json!(revision + 1);
    expected["actors"]["vale"]["want"] = want.clone();
    let accepted = full_store::commit(
        &c,
        id,
        &mut state,
        json!({"op":"play","actor":"vale","action":"accept:vale::box:train"}),
        7,
    )?;
    assert_eq!(accepted["ok"], true);
    assert_eq!(accepted["world"], expected);
    assert_eq!(accepted["events"], json!([]));
    assert_eq!(state.game, expected);
    calls.push("play");
    verify_opening_journal(&mut c, id, &calls)?;

    let reloaded = full_store::world(&c, id, 8)?;
    assert_eq!(reloaded, state);
    let request = reloaded.request("view", actor_index("vale")?);
    assert_eq!(request["present"], json!(["vale"]));
    let pack = reloaded.pack.as_deref();
    let reference = engine::reduce_journal(&reloaded.version, pack, request.clone())?;
    assert_eq!(reference["world"]["actors"]["vale"]["want"], want);
    assert!(reference.get("events").is_none());
    let actions = reference["actions"].as_array().ok_or("Missing actions.")?;
    assert!(actions
        .iter()
        .any(|action| action["key"] == "drop:vale:::0"));
    assert!(actions
        .iter()
        .all(|action| action["key"] != "accept:vale::box:train"));
    let guest = Rules::new(&read_candidate()?)?;
    assert_eq!(reduce_candidate(&guest, pack, &request)?, Some(reference));
    Ok(())
}

#[test]
fn sqlite_rules_wasm_parity_replays_station_after_the_second_pond_move() -> Result<()> {
    replay_opening_turns(
        "station-after-second-pond-move",
        unseeded_opening()?,
        true,
        &[WAIT, BARE_POND_MOVE, BARE_STATION_MOVE],
    )
}

fn check_bare_pond_move(lamp: &Value, reply: &Value) {
    check_bare_move(lamp, reply, "attic", "pond");
    let world = &reply["world"];
    assert_eq!(world["opening"]["crossed"], true);
    assert_eq!(world["speechVoices"]["vale"], json!(["vale", "moth"]));
}

fn check_historic_pond_move(lamp: &Value, reply: &Value) {
    check_historic_pond_ask(lamp, reply);
    let world = &reply["world"];
    assert_eq!(world["actors"]["moth"]["sleeping"]["since"], world["turn"]);
}

fn check_awake_historic_pond_move(lamp: &Value, reply: &Value) {
    check_historic_pond_ask(lamp, reply);
    let world = &reply["world"];
    assert_eq!(world["turn"], 481);
    assert_eq!(world["actors"]["moth"]["sleeping"], Value::Null);
    assert_eq!(
        world["actors"]["keeper"]["sleeping"],
        json!({"since":481,"place":"station","until":482})
    );
}

fn check_historic_pond_ask(lamp: &Value, reply: &Value) {
    check_bare_pond_move(lamp, reply);
    let world = &reply["world"];
    let ask = reply["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["actorId"] == "moth" && event["verb"] == "ask")
        .expect("Pip asks for the lamp on the historic Pond arrival");
    assert_eq!(ask["itemId"], "lamp");
    assert_eq!(ask["accepted"], false);
    let moth = &world["actors"]["moth"];
    assert_eq!(moth["want"]["refusals"], 1);
}

fn check_bare_station_move(lamp: &Value, reply: &Value) {
    check_bare_move(lamp, reply, "pond", "station");
    let world = &reply["world"];
    let followed = &reply["events"][1];
    assert_eq!(followed["actorId"], "moth");
    assert_eq!(followed["verb"], "move");
    assert_eq!(followed["locationId"], "station");
    assert_eq!(world["actors"]["moth"]["place"], "station");
    assert_eq!(world["opening"]["met"]["keeper"], world["turn"]);
    assert_eq!(world["speechVoices"]["vale"], json!(["vale", "keeper"]));
}

fn check_quiet_station_departure(lamp: &Value, reply: &Value, destination: &str) {
    check_bare_move(lamp, reply, "station", destination);
    let [departure] = reply["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale's single Station departure");
    };
    let world = &reply["world"];
    assert_eq!(departure["kind"], "action");
    assert_eq!(departure["cast"], json!(["vale"]));
    let witnesses = departure["witnesses"].as_array().unwrap();
    assert_eq!(
        witnesses[..3],
        [json!("vale"), json!("moth"), json!("keeper")]
    );
    for resident in ["moth", "keeper"] {
        assert_eq!(world["actors"][resident]["place"], "station");
    }
    assert_eq!(world["eventSeq"], departure["seq"]);
    assert_eq!(world["speechVoices"]["vale"], json!(["vale"]));
    assert_eq!(reply["room"], destination);
    assert_eq!(reply["exits"], json!(["station"]));
}

fn check_awake_historic_station_move(lamp: &Value, reply: &Value, ada_moves: bool) {
    check_bare_station_move(lamp, reply);
    let events = reply["events"].as_array().unwrap();
    assert_eq!(events.len(), 3 + usize::from(ada_moves));
    let world = &reply["world"];
    assert_eq!(world["turn"], 482);

    let pip = &events[1];
    assert_eq!(pip["fromLocationId"], "pond");
    assert_eq!(pip["targetId"], "station");
    assert_eq!(world["actors"]["moth"]["heldItem"], "cloth");
    assert_eq!(world["actors"]["moth"]["sleeping"], Value::Null);

    if ada_moves {
        let ada = &events[2];
        assert_eq!(ada["actorId"], "ada");
        assert_eq!(ada["verb"], "move");
        assert_eq!(ada["fromLocationId"], "loft");
        assert_eq!(ada["locationId"], "greek-ship");
        assert_eq!(world["actors"]["ada"]["place"], "greek-ship");
        assert_eq!(world["actors"]["ada"]["heldItem"], Value::Null);
        assert_eq!(world["items"]["shears"]["holder"], "loft");
        assert_eq!(world["actors"]["moth"]["homeward"], Value::Null);
    } else {
        assert_eq!(world["actors"]["moth"]["homeward"], true);
    }
    assert_eq!(world["actors"]["orin"]["place"], "pavilion");
    assert_eq!(world["items"]["board"]["holder"], "orin");

    let wake = events.last().unwrap();
    assert_eq!(wake["actorId"], "keeper");
    assert_eq!(wake["kind"], "narration");
    assert_eq!(wake["locationId"], "station");
    assert_eq!(wake["text"], "The keeper wakes.");
    assert_eq!(wake["seq"], world["eventSeq"]);
    assert_eq!(world["actors"]["keeper"]["sleeping"], Value::Null);
}

fn check_keeper_log_read(_: &Value, reply: &Value) {
    let [read, wait] = reply["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale's read followed by Pip's Wait");
    };
    assert_eq!(read["actorId"], "vale");
    assert_eq!(read["verb"], "read");
    assert_eq!(read["itemId"], "keeper-log");
    assert_eq!(wait["actorId"], "moth");
    assert_eq!(wait["verb"], "wait");
    assert_eq!(
        wait["seq"].as_u64(),
        read["seq"].as_u64().map(|seq| seq + 1)
    );
    let world = &reply["world"];
    assert_eq!(world["turn"], 3);
    assert_eq!(read["locationId"], "station");
    assert_eq!(wait["locationId"], "station");
    assert_eq!(world["items"]["keeper-log"]["holder"], "station");
    assert_eq!(world["eventSeq"], wait["seq"]);
    assert_eq!(world["speechVoices"]["vale"], json!([]));
    assert_eq!(
        world["knowledge"]["known"]["vale"]["quest:keeper:pond"],
        json!({"kind":"read","teller":null,"eventSeq":read["seq"],"learnedTurn":3,"book":"keeper-log"})
    );
    assert!(reply["actions"].as_array().unwrap().iter().any(|action| {
        action["key"] == "accept:vale::keeper"
            && action["kind"] == "accept"
            && action["target"] == "keeper"
    }));
}

fn check_bare_move(lamp: &Value, reply: &Value, from: &str, to: &str) {
    check_stowed_lamp_move(lamp, reply, from, to);
    assert_eq!(reply["world"]["actors"]["vale"]["heldItem"], Value::Null);
}

fn check_stowed_lamp_move(lamp: &Value, reply: &Value, from: &str, to: &str) {
    let event = &reply["events"][0];
    assert_eq!(event["actorId"], "vale");
    assert_eq!(event["verb"], "move");
    assert_eq!(event["fromLocationId"], from);
    assert_eq!(event["locationId"], to);
    assert_eq!(event["itemId"], Value::Null);
    assert_eq!(event["targetId"], to);
    assert_eq!(event["light"], false);
    let world = &reply["world"];
    assert_eq!(world["actors"]["vale"]["place"], to);
    assert_eq!(
        world["arrival"],
        json!({"seq":event["seq"],"fromLocationId":from,"locationId":to})
    );
    let carried = &world["items"]["lamp"];
    assert_eq!(carried["holder"], "vale");
    assert_eq!(carried["lit"], false);
    assert_eq!(carried["fuelPlace"], to);
    assert_eq!(carried["fuelVisit"], false);
    assert_eq!(carried["fuel"], lamp["fuel"]);
}

fn check_wait(_: &Value, reply: &Value) {
    assert_eq!(reply["events"][0]["verb"], "wait");
    assert_eq!(reply["world"]["speechVoices"]["vale"], json!(["vale"]));
}

fn check_silent_wait(_: &Value, reply: &Value) {
    assert_eq!(reply["events"][0]["verb"], "wait");
    assert_eq!(reply["world"]["speechVoices"]["vale"], json!([]));
}

fn check_lamp_drop(lamp: &Value, reply: &Value) {
    let event = &reply["events"][0];
    assert_eq!(event["verb"], "drop");
    assert_eq!(event["itemId"], "lamp");
    assert_eq!(event["locationId"], "attic");
    assert_eq!(event["targetId"], "attic");
    let world = &reply["world"];
    let dropped = &world["items"]["lamp"];
    assert_eq!(world["actors"]["vale"]["heldItem"], Value::Null);
    assert_eq!(lamp["holder"], "vale");
    assert_eq!(dropped["holder"], "attic");
    assert_eq!(dropped["lit"], true);
    assert_eq!(dropped["fuelRooms"], lamp["fuelRooms"]);
    assert_eq!(dropped["fuel"], lamp["fuel"]);
    assert_eq!(world["speechVoices"]["vale"], json!(["vale"]));
}

fn check_lamp_take(lamp: &Value, reply: &Value) {
    let event = &reply["events"][0];
    assert_eq!(event["verb"], "take");
    assert_eq!(event["itemId"], "lamp");
    assert_eq!(event["locationId"], "attic");
    let world = &reply["world"];
    let taken = &world["items"]["lamp"];
    assert_eq!(lamp["holder"], "attic");
    assert_eq!(world["actors"]["vale"]["heldItem"], "lamp");
    assert_eq!(taken["holder"], "vale");
    assert_eq!(taken["lit"], true);
    assert_eq!(taken["fuel"], lamp["fuel"]);
}

fn historic_opening(seed: Option<u32>) -> Result<World> {
    let mut request = json!({"op":"create", "history":true});
    if let Some(seed) = seed {
        request["seed"] = json!(seed);
    }
    let created = engine::reduce(request)?;
    let save = created["world"].to_string();
    let imported = World::create(Some(&save))?;
    assert_eq!(imported.game, created["world"]);
    assert_eq!(imported.game["run"]["seed"], json!(seed));
    assert_eq!(imported.game["began"], imported.game["turn"]);
    assert!(imported.game["began"].as_u64().is_some_and(|turn| turn > 0));
    Ok(imported)
}

fn unseeded_opening() -> Result<World> {
    let state = World::create(None)?;
    assert_eq!(state.game["turn"], 0);
    assert!(state.game.get("began").is_none());
    assert!(state.game.get("run").is_none());
    Ok(state)
}

fn commit_keeper_quest(
    id: &str,
    seed: Option<u32>,
) -> Result<(Connection, World, Vec<&'static str>)> {
    let world = match seed {
        Some(seed) => World::seeded(None, Some(seed))?,
        None => unseeded_opening()?,
    };
    let (c, mut state, mut calls) = commit_opening_turns(
        id,
        world,
        true,
        &[BARE_POND_MOVE, BARE_STATION_MOVE, KEEPER_LOG_READ],
    )?;
    let mut expected = state.game.clone();
    let revision = expected["revision"].as_u64().ok_or("Missing revision.")?;
    expected["revision"] = json!(revision + 1);
    expected["actors"]["vale"]["want"] = json!({
        "kind":"place", "target":"pond", "since":3, "refusals":0,
        "step":{"verb":"call","crossing":"pond-greek-harbor"}, "from":"quest:from:keeper",
    });
    let accepted = full_store::commit(
        &c,
        id,
        &mut state,
        json!({"op":"play","actor":"vale","action":"accept:vale::keeper"}),
        8,
    )?;
    assert_eq!(accepted["ok"], true);
    assert_eq!(accepted["events"], json!([]));
    assert_eq!(accepted["world"], expected);
    assert_eq!(state.game, expected);
    calls.push("play");
    Ok((c, state, calls))
}

fn commit_keeper_play(
    c: &Connection,
    id: &str,
    state: &mut World,
    calls: &mut Vec<&'static str>,
    action: &str,
    now: i64,
) -> Result<Value> {
    let turn = state.game["turn"].as_u64().ok_or("Missing turn.")?;
    let revision = state.game["revision"].as_u64().ok_or("Missing revision.")?;
    let command = json!({"op":"play","actor":"vale","action":action});
    let reply = full_store::commit(c, id, state, command, now)?;
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["world"], state.game);
    assert_eq!(state.game["turn"], turn + 1);
    assert_eq!(state.game["revision"], revision + 1);
    calls.push("play");
    Ok(reply)
}

fn replay_opening_turns(
    id: &str,
    state: World,
    stow_lamp: bool,
    plays: &[(&str, PlayAssertion)],
) -> Result<()> {
    let (mut c, _, calls) = commit_opening_turns(id, state, stow_lamp, plays)?;
    verify_opening_journal(&mut c, id, &calls)
}

fn commit_opening_turns(
    id: &str,
    mut state: World,
    stow_lamp: bool,
    plays: &[(&str, PlayAssertion)],
) -> Result<(Connection, World, Vec<&'static str>)> {
    let c = store::open(Path::new(":memory:"))?;
    full_store::schema(&c)?;
    store::create(&c, id, "opening-owner", 1)?;
    full_store::seed(&c, id, &state, id, 1)?;
    for (time, op) in [(2, "claim"), (3, "enter")] {
        full_store::commit(&c, id, &mut state, json!({"op":op, "actor":"vale"}), time)?;
    }
    let incoming = state.request("play", actor_index("vale")?);
    assert_eq!(incoming["claimed"], json!(["vale"]));
    assert_eq!(incoming["present"], json!(["vale"]));
    let mut calls = vec!["join_state", "presence"];
    if stow_lamp {
        let hold = json!({"op":"hold","actor":"vale","choice":{"item":null,"revision":state.game["revision"]}});
        assert_eq!(full_store::commit(&c, id, &mut state, hold, 4)?["ok"], true);
        assert_eq!(state.game["actors"]["vale"]["heldItem"], Value::Null);
        assert_eq!(state.game["opened"]["pond"], json!(["vale"]));
        assert_eq!(state.game["items"]["lamp"]["lit"], false);
        calls.push("hold");
    }
    let first_play_time = 4 + i64::from(stow_lamp);
    for (time, &(action, check_reply)) in (first_play_time..).zip(plays) {
        let turn = state.game["turn"].as_u64().ok_or("Missing turn.")?;
        let revision = state.game["revision"].as_u64().ok_or("Missing revision.")?;
        let lamp = state.game["items"]["lamp"].clone();
        let command = json!({"op":"play", "actor":"vale", "action":action});
        let accepted = full_store::commit(&c, id, &mut state, command, time)?;
        assert_eq!(accepted["ok"], true);
        assert_eq!(accepted["world"], state.game);
        assert_eq!(accepted["events"][0]["actorId"], "vale");
        let minimum_events = 1 + usize::from(time == first_play_time);
        assert!(accepted["events"]
            .as_array()
            .is_some_and(|events| events.len() >= minimum_events));
        assert_eq!(state.game["turn"], turn + 1);
        assert_eq!(accepted["events"][0]["turn"], turn + 1);
        assert_eq!(state.game["revision"], revision + 1);
        check_reply(&lamp, &accepted);
        calls.push("play");
    }
    Ok((c, state, calls))
}

fn verify_opening_journal(c: &mut Connection, id: &str, calls: &[&str]) -> Result<()> {
    let guest = Rules::new(&read_candidate()?)?;
    c.pragma_update(None, "query_only", true)
        .map_err(sql_error)?;
    let snapshot = c.transaction().map_err(sql_error)?;
    let worlds = active_worlds(&snapshot)?;
    assert_eq!(worlds, [id]);
    let mut observed = Vec::new();
    let report = verify_worlds(&snapshot, &worlds, |_, pack, request| {
        observed.push(request["op"].as_str().unwrap_or_default().to_owned());
        reduce_candidate(&guest, pack, request)
    })?;
    assert_eq!(observed.as_slice(), calls);
    assert_eq!(report.checked, observed.len());
    report.require_coverage(true)?;
    println!(
        "WASM {id} replay matched {} current journal calls",
        report.checked
    );
    Ok(())
}

fn verify_seated_reload(
    c: &Connection,
    id: &str,
    state: &World,
    room: &str,
    exits: &[&str],
    now: i64,
) -> Result<()> {
    seated_reload(c, id, state, room, exits, now).map(|_| ())
}

fn seated_reload(
    c: &Connection,
    id: &str,
    state: &World,
    room: &str,
    exits: &[&str],
    now: i64,
) -> Result<Value> {
    let reloaded = full_store::world(c, id, now)?;
    assert_eq!(&reloaded, state);
    let request = reloaded.request("view", actor_index("vale")?);
    assert_eq!(request["present"], json!(["vale"]));
    let pack = reloaded.pack.as_deref();
    let reference = engine::reduce_journal(&reloaded.version, pack, request.clone())?;
    assert_eq!(reference["room"], room);
    assert_eq!(reference["exits"], json!(exits));
    assert!(reference.get("events").is_none());
    assert_eq!(
        reference["world"]["memories"]["vale"],
        state.game["memories"]["vale"]
    );
    assert!(reference["world"]["memories"]["moth"]
        .get("subjects")
        .is_none());
    let guest = Rules::new(&read_candidate()?)?;
    assert_eq!(
        reduce_candidate(&guest, pack, &request)?.as_ref(),
        Some(&reference)
    );
    Ok(reference)
}
