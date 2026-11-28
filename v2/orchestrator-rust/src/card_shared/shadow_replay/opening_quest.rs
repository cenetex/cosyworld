use super::{
    active_worlds, full_store, read_candidate, reduce_candidate, verify_worlds, Result, Rules,
    World,
};
use crate::card_shared::store::{self, sql_error};
use serde_json::json;
use std::path::Path;

#[test]
fn sqlite_rules_wasm_parity_accepts_opening_quest() -> Result<()> {
    let guest = Rules::new(&read_candidate()?)?;
    let mut c = store::open(Path::new(":memory:"))?;
    full_store::schema(&c)?;
    let id = "opening-quest";
    store::create(&c, id, "opening-owner", 1)?;
    let mut state = World::seeded(None, Some(4242))?;
    full_store::seed(&c, id, &state, "opening-quest", 1)?;
    for (time, op) in [(2, "claim"), (3, "enter")] {
        full_store::commit(&c, id, &mut state, json!({"op": op, "actor": "vale"}), time)?;
    }
    let action = json!({"op":"play","actor":"vale","action":"accept:vale::box:pond"});
    let accepted = full_store::commit(&c, id, &mut state, action, 4)?;
    assert_eq!(accepted["ok"], true);
    assert_eq!(
        state.game["actors"]["vale"]["want"]["from"],
        "quest:box:pond"
    );

    c.pragma_update(None, "query_only", true)
        .map_err(sql_error)?;
    let snapshot = c.transaction().map_err(sql_error)?;
    let worlds = active_worlds(&snapshot)?;
    assert_eq!(worlds, [id]);
    let report = verify_worlds(&snapshot, &worlds, |_, pack, request| {
        reduce_candidate(&guest, pack, request)
    })?;
    assert_eq!(report.checked, 3);
    assert_eq!(report.heads.len(), 1);
    report.require_coverage(true)?;
    println!("WASM opening quest replay matched 3 current journal calls");
    Ok(())
}
