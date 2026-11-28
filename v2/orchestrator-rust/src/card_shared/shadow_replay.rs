use super::{content, engine, full_store, full_world::World, store::Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Debug, Default, PartialEq)]
struct Report {
    checked: usize,
    unsupported: usize,
    historical: usize,
}

fn verify(
    c: &Connection,
    world: &str,
    mut candidate: impl FnMut(&str, Option<&str>, &Value) -> Result<Option<Value>>,
) -> Result<Report> {
    let mut report = Report::default();
    let mut verified_packs = BTreeSet::new();
    let mut verify_pack = |pack: Option<&str>| {
        if let Some(pack) = pack.filter(|pack| !verified_packs.contains(*pack)) {
            content::verify_stored(c, pack)?;
            verified_packs.insert(pack.to_owned());
        }
        Ok::<_, String>(())
    };
    let (head, rebuilt) = full_store::replay(c, world, 0, None, |seq, state, command| {
        verify_pack(state.pack.as_deref())?;
        state.apply_with(command, &mut |version, pack, request| {
            verify_pack(pack)?;
            let op = request["op"].as_str().unwrap_or("unknown").to_owned();
            let context = || format!("journal sequence {seq}, rules operation {op}");
            let quickjs = |request| {
                engine::reduce_pack(version, pack, request)
                    .map_err(|_| format!("QuickJS failed at {}", context()))
            };
            if version != engine::version() || pack != Some(content::current()) {
                report.historical += 1;
                return quickjs(request);
            }
            let response = candidate(version, pack, &request)
                .map_err(|_| format!("candidate failed at {}", context()))?;
            let reference = quickjs(request)?;
            match response {
                Some(response) if response == reference => report.checked += 1,
                Some(_) => return Err(format!("reducer output differs at {}", context())),
                None => report.unsupported += 1,
            }
            Ok(reference)
        })?;
        Ok(())
    })?;
    let rebuilt = rebuilt.ok_or("The replay journal is empty.")?;
    verify_pack(rebuilt.pack.as_deref())?;

    let (sequence, state): (i64, String) = c
        .query_row(
            "SELECT seq,state FROM card_full_checkpoints WHERE world=?",
            [world],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "The replay checkpoint is missing or unreadable.")?;
    let checkpoint: World =
        serde_json::from_str(&state).map_err(|_| "The replay checkpoint needs attention.")?;
    if sequence != head || checkpoint != rebuilt {
        return Err(format!(
            "checkpoint differs from journal head at sequence {head}"
        ));
    }
    if report.checked == 0 {
        return Err("No current journal operations were checked by the candidate.".into());
    }
    Ok(report)
}

fn fixture() -> Result<Connection> {
    let c = Connection::open_in_memory().map_err(super::store::sql_error)?;
    full_store::schema(&c)?;
    let world = "shadow-replay";
    let mut state = World::seeded(None, Some(4242))?;
    full_store::seed(&c, world, &state, "shadow-replay", 1)?;
    for (time, op) in [(2, "claim"), (3, "enter")] {
        full_store::commit(
            &c,
            world,
            &mut state,
            json!({"op":op, "actor":"mara"}),
            time,
        )?;
    }
    Ok(c)
}

#[test]
fn detects_divergence_before_a_matching_checkpoint() -> Result<()> {
    let c = fixture()?;
    let error = verify(&c, "shadow-replay", |version, pack, request| {
        if request["op"] != "presence" {
            return Ok(None);
        }
        let mut response = engine::reduce_pack(version, pack, request.clone())?;
        response["world"]["shadowReplayMismatch"] = json!(true);
        Ok(Some(response))
    })
    .unwrap_err();
    assert_eq!(
        error,
        "reducer output differs at journal sequence 3, rules operation presence"
    );
    Ok(())
}

#[test]
fn detects_stale_checkpoints_after_matching_replay() -> Result<()> {
    let c = fixture()?;
    let equal = |version: &str, pack: Option<&str>, request: &Value| {
        engine::reduce_pack(version, pack, request.clone()).map(Some)
    };
    let report = verify(&c, "shadow-replay", equal)?;
    assert_eq!(report.checked, 2);
    c.execute(
        "UPDATE card_full_checkpoints SET seq=? WHERE world=?",
        params![2, "shadow-replay"],
    )
    .map_err(super::store::sql_error)?;
    assert_eq!(
        verify(&c, "shadow-replay", equal).unwrap_err(),
        "checkpoint differs from journal head at sequence 3"
    );
    Ok(())
}

#[test]
fn verifies_recorded_bytes_even_for_the_current_pack() -> Result<()> {
    let c = fixture()?;
    c.execute(
        "UPDATE card_full_packs SET content='{}' WHERE hash=?",
        [content::current()],
    )
    .map_err(super::store::sql_error)?;
    let error = verify(&c, "shadow-replay", |_, _, _| Ok(None)).unwrap_err();
    assert_eq!(error, "This world's pack content needs recovery.");
    Ok(())
}

#[cfg(feature = "rules-wasm")]
#[test]
fn sqlite_rules_wasm_parity() -> Result<()> {
    let artifact = std::env::var_os("COSYWORLD_RULES_WASM")
        .ok_or("Set COSYWORLD_RULES_WASM to the compiled rules artifact.")?;
    let bytes = std::fs::read(artifact).map_err(|_| "Could not read the rules artifact.")?;
    let guest = cosyworld_orchestrator::rules_wasm::Rules::new(&bytes)?;
    let candidate = |_: &str, _: Option<&str>, request: &Value| guest.reduce(request);
    let (mut c, world) = match std::env::var_os("COSYWORLD_REPLAY_DB") {
        Some(path) => {
            let world = std::env::var("COSYWORLD_REPLAY_WORLD")
                .map_err(|_| "Set COSYWORLD_REPLAY_WORLD to the world ID in the SQLite copy.")?;
            let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "Could not open the journal copy.")?;
            (c, world)
        }
        None => (fixture()?, "shadow-replay".into()),
    };
    let snapshot = c.transaction().map_err(super::store::sql_error)?;
    let report = verify(&snapshot, &world, candidate)?;
    println!(
        "Wasm matched {} reducer calls, with {} unsupported and {} historical calls",
        report.checked, report.unsupported, report.historical
    );
    if std::env::var("COSYWORLD_REQUIRE_FULL_REPLAY").as_deref() == Ok("1")
        && report.unsupported != 0
    {
        return Err("The candidate must cover every current reducer call for cutover.".into());
    }
    Ok(())
}
