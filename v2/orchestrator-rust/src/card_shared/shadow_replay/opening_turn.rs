use super::{
    active_worlds, engine, full_store, read_candidate, reduce_candidate, verify_worlds, Result,
    Rules, World,
};
use crate::card_shared::{
    full_world::actor_index,
    store::{self, sql_error},
};
use serde_json::{json, Value};
use std::path::Path;

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_wait() -> Result<()> {
    replay_first_attic_turn(
        "first-attic-wait",
        "wait:vale::",
        unseeded_opening()?,
        |_, reply| {
            assert_eq!(reply["events"][0]["verb"], "wait");
        },
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_drop() -> Result<()> {
    replay_first_attic_turn(
        "first-attic-drop",
        "drop:vale:lamp:attic",
        unseeded_opening()?,
        |lamp, reply| {
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
        },
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_wait_after_history() -> Result<()> {
    let created = engine::reduce(json!({"op":"create", "history":true, "seed":4242}))?;
    let save = created["world"].to_string();
    let imported = World::create(Some(&save))?;
    assert_eq!(imported.game, created["world"]);
    assert_eq!(imported.game["run"]["seed"], 4242);
    assert_eq!(imported.game["began"], imported.game["turn"]);
    assert!(imported.game["began"].as_u64().is_some_and(|turn| turn > 0));
    replay_first_attic_turn(
        "first-attic-wait-after-history",
        "wait:vale::",
        imported,
        |_, reply| {
            assert_eq!(reply["events"][0]["verb"], "wait");
        },
    )
}

fn unseeded_opening() -> Result<World> {
    let state = World::create(None)?;
    assert_eq!(state.game["turn"], 0);
    assert!(state.game.get("began").is_none());
    assert!(state.game.get("run").is_none());
    Ok(state)
}

fn replay_first_attic_turn(
    id: &str,
    action: &str,
    mut state: World,
    check_reply: impl FnOnce(&Value, &Value),
) -> Result<()> {
    let guest = Rules::new(&read_candidate()?)?;
    let mut c = store::open(Path::new(":memory:"))?;
    full_store::schema(&c)?;
    store::create(&c, id, "opening-owner", 1)?;
    let turn = state.game["turn"].as_u64().ok_or("Missing turn.")?;
    full_store::seed(&c, id, &state, id, 1)?;
    for (time, op) in [(2, "claim"), (3, "enter")] {
        full_store::commit(&c, id, &mut state, json!({"op":op, "actor":"vale"}), time)?;
    }
    let incoming = state.request("play", actor_index("vale")?);
    assert_eq!(incoming["claimed"], json!(["vale"]));
    assert_eq!(incoming["present"], json!(["vale"]));
    let revision = state.game["revision"].as_u64().ok_or("Missing revision.")?;
    let lamp = state.game["items"]["lamp"].clone();
    let command = json!({"op":"play", "actor":"vale", "action":action});
    let accepted = full_store::commit(&c, id, &mut state, command, 4)?;
    assert_eq!(accepted["ok"], true);
    assert_eq!(accepted["world"], state.game);
    assert_eq!(accepted["events"][0]["actorId"], "vale");
    assert!(accepted["events"]
        .as_array()
        .is_some_and(|events| events.len() > 1));
    assert_eq!(state.game["turn"], turn + 1);
    assert_eq!(accepted["events"][0]["turn"], turn + 1);
    assert_eq!(state.game["revision"], revision + 1);
    assert_eq!(state.game["speechVoices"]["vale"], json!(["vale"]));
    check_reply(&lamp, &accepted);

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
    assert_eq!(observed, ["join_state", "presence", "play"]);
    assert_eq!(report.checked, observed.len());
    report.require_coverage(true)?;
    println!(
        "WASM {id} replay matched {} current journal calls",
        report.checked
    );
    Ok(())
}
