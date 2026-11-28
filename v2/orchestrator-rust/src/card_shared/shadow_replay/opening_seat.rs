use super::{
    active_worlds, full_store, read_candidate, reduce_candidate, verify_worlds, Result, Rules,
    World,
};
use crate::card_shared::{
    full_world::actor_index,
    store::{self, sql_error},
};
use serde_json::{json, Value};
use std::path::Path;

#[test]
fn sqlite_rules_wasm_parity_replays_opening_seat_and_lamp() -> Result<()> {
    let guest = Rules::new(&read_candidate()?)?;
    let mut c = store::open(Path::new(":memory:"))?;
    full_store::schema(&c)?;
    let id = "opening-seat-and-lamp";
    store::create(&c, id, "opening-owner", 1)?;
    let mut state = World::seeded(None, Some(4242))?;
    let vale = actor_index("vale")?;
    full_store::seed(&c, id, &state, "opening-seat-and-lamp", 1)?;

    let claim = json!({
        "op":"claim", "actor":"vale",
        "progress":{"xp":7,"level":3,"upgrades":["scarf-gold"]},
    });
    full_store::commit(&c, id, &mut state, claim, 2)?;
    assert_eq!((state.claimed[vale], state.present[vale]), (1, 0));
    assert_eq!(state.game["actors"]["vale"]["xp"], 7);
    let enter = json!({"op":"enter", "actor":"vale"});
    full_store::commit(&c, id, &mut state, enter.clone(), 3)?;
    assert_eq!(state.present[vale], 1);

    for (time, item, lit) in [(4, Value::Null, false), (5, json!("lamp"), true)] {
        let command = json!({
            "op":"hold", "actor":"vale",
            "choice":{"item":item,"revision":state.game["revision"]},
        });
        assert_eq!(
            full_store::commit(&c, id, &mut state, command, time)?["ok"],
            true
        );
        assert_eq!(state.game["actors"]["vale"]["heldItem"], item);
        assert_eq!(state.game["items"]["lamp"]["lit"], lit);
        assert_eq!(state.game["opened"]["pond"], json!(["vale"]));
    }

    let leave = json!({"op":"leave", "actor":"vale"});
    full_store::commit(&c, id, &mut state, leave, 6)?;
    assert_eq!((state.claimed[vale], state.present[vale]), (1, 0));
    full_store::commit(&c, id, &mut state, enter, 7)?;
    assert_eq!((state.claimed[vale], state.present[vale]), (1, 1));
    let reset = json!({"op":"reset", "actor":"vale"});
    assert_eq!(
        full_store::commit(&c, id, &mut state, reset, 8)?["ok"],
        true
    );
    assert_eq!((state.claimed[vale], state.present[vale]), (0, 0));
    assert_eq!(state.game["items"]["lamp"]["holder"], "attic");
    assert_eq!(state.game["items"]["lamp"]["lit"], true);
    assert_eq!(state.game["actors"]["vale"]["heldItem"], Value::Null);
    assert_eq!(state.game["actors"]["vale"]["xp"], 0);
    assert!(state.game["actors"]["vale"].get("upgrades").is_none());

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
    assert_eq!(
        observed,
        [
            "join_state",
            "presence",
            "hold",
            "hold",
            "presence",
            "presence",
            "reset",
            "presence"
        ]
    );
    assert_eq!(report.checked, observed.len());
    report.require_coverage(true)?;
    println!(
        "WASM opening seat and lamp replay matched {} current journal calls",
        report.checked
    );
    Ok(())
}
