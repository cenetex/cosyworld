use super::{
    active_worlds, content, engine, full_store, read_candidate, reduce_candidate, verify_worlds,
    Result, Rules, World,
};
use crate::card_shared::store::{self, sql_error};
use rusqlite::params;
use serde_json::json;
use std::path::Path;

#[test]
fn sqlite_rules_wasm_parity_replays_opening_repack() -> Result<()> {
    let guest = Rules::new(&read_candidate()?)?;
    let mut c = store::open(Path::new(":memory:"))?;
    full_store::schema(&c)?;
    let id = "opening-repack";
    store::create(&c, id, "opening-owner", 1)?;
    let earlier = format!("{}\n", content::current_text());
    let pack = content::hash(&earlier);
    assert_ne!(pack, content::current());
    c.execute(
        "INSERT INTO card_full_packs(hash, revision, content) VALUES(?, ?, ?)",
        params![pack, "synthetic-prior-equivalent", earlier],
    )
    .map_err(sql_error)?;
    content::preload(&c, &pack)?;
    let version = engine::version();
    let source = engine::reduce_pack(
        version,
        Some(&pack),
        json!({"op":"create", "seed":4242, "history":true}),
    )?;
    let mut state = World {
        version: version.into(),
        game: source["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: Some(pack.clone()),
    };
    full_store::seed(&c, id, &state, "opening-repack", 1)?;
    let revision = state.game["revision"].as_u64().ok_or("Missing revision.")?;
    let command = json!({"op":"repack", "from":pack, "to":content::current()});
    let result = full_store::commit(&c, id, &mut state, command, 2)?;
    assert_eq!(result["ok"], true);
    assert_eq!(state.pack.as_deref(), Some(content::current()));
    let mut expected = source["world"].clone();
    expected["revision"] = json!(revision + 1);
    assert_eq!(state.game, expected);
    for (time, op) in [(3, "claim"), (4, "enter")] {
        full_store::commit(&c, id, &mut state, json!({"op":op,"actor":"vale"}), time)?;
    }

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
    assert_eq!(observed, ["upgrade", "join_state", "presence"]);
    assert_eq!(report.checked, observed.len());
    assert_eq!(report.historical, 0);
    report.require_coverage(true)?;
    Ok(())
}
