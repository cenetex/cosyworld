use super::{
    active_worlds, full_store, read_candidate, reduce_candidate, verify_worlds, Result, Rules,
    World,
};
use crate::card_shared::{
    full_world::actor_index,
    store::{self, sql_error},
};
use serde_json::json;
use std::path::Path;

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_attic_wait() -> Result<()> {
    let guest = Rules::new(&read_candidate()?)?;
    let mut c = store::open(Path::new(":memory:"))?;
    full_store::schema(&c)?;
    let id = "first-attic-wait";
    store::create(&c, id, "opening-owner", 1)?;
    let mut state = World::create(None)?;
    assert_eq!(state.game["turn"], 0);
    assert!(state.game.get("began").is_none());
    assert!(state.game.get("run").is_none());
    full_store::seed(&c, id, &state, "first-attic-wait", 1)?;
    for (time, op) in [(2, "claim"), (3, "enter")] {
        full_store::commit(&c, id, &mut state, json!({"op":op, "actor":"vale"}), time)?;
    }
    let incoming = state.request("play", actor_index("vale")?);
    assert_eq!(incoming["claimed"], json!(["vale"]));
    assert_eq!(incoming["present"], json!(["vale"]));
    let revision = state.game["revision"].as_u64().ok_or("Missing revision.")?;
    let action = json!({"op":"play", "actor":"vale", "action":"wait:vale::"});
    let accepted = full_store::commit(&c, id, &mut state, action, 4)?;
    assert_eq!(accepted["ok"], true);
    assert_eq!(accepted["world"], state.game);
    assert_eq!(accepted["events"][0]["verb"], "wait");
    assert_eq!(accepted["events"][0]["actorId"], "vale");
    assert!(accepted["events"]
        .as_array()
        .is_some_and(|events| events.len() > 1));
    assert_eq!(state.game["turn"], 1);
    assert_eq!(state.game["revision"], revision + 1);
    assert_eq!(state.game["speechVoices"]["vale"], json!(["vale"]));

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
        "WASM first attic Wait replay matched {} current journal calls",
        report.checked
    );
    Ok(())
}
