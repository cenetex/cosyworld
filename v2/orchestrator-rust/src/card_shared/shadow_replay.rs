use super::{content, engine, full_store, full_world::World, store::Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Default, PartialEq)]
struct Report {
    worlds: usize,
    checked: usize,
    unsupported: BTreeMap<String, usize>,
    historical: usize,
    noncurrent_heads: usize,
}

impl Report {
    fn add(&mut self, other: Self) {
        self.worlds += other.worlds;
        self.checked += other.checked;
        self.historical += other.historical;
        self.noncurrent_heads += other.noncurrent_heads;
        for (op, count) in other.unsupported {
            *self.unsupported.entry(op).or_default() += count;
        }
    }

    fn require_coverage(&self, full: bool) -> Result<()> {
        if full && self.noncurrent_heads != 0 {
            return Err(
                "Every checked world must be saved on current rules and content for cutover."
                    .into(),
            );
        }
        if full && !self.unsupported.is_empty() {
            return Err("The candidate must cover every current reducer call for cutover.".into());
        }
        if self.checked == 0 {
            return Err("No current journal operations were checked by the candidate.".into());
        }
        Ok(())
    }
}

fn active_worlds(c: &Connection) -> Result<Vec<String>> {
    let mut query = c
        .prepare("SELECT id FROM card_tables WHERE retired_at IS NULL ORDER BY id")
        .map_err(super::store::sql_error)?;
    let worlds = query
        .query_map([], |row| row.get(0))
        .map_err(super::store::sql_error)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(super::store::sql_error)?;
    if worlds.is_empty() {
        return Err("The journal copy contains no active worlds.".into());
    }
    Ok(worlds)
}

fn verify_worlds(
    c: &Connection,
    worlds: &[String],
    mut candidate: impl FnMut(&str, Option<&str>, &Value) -> Result<Option<Value>>,
) -> Result<Report> {
    let mut report = Report::default();
    for (index, world) in worlds.iter().enumerate() {
        let verified = verify(c, world, &mut candidate)
            .map_err(|error| format!("World {} of {}: {error}", index + 1, worlds.len()))?;
        report.add(verified);
    }
    Ok(report)
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
                None => *report.unsupported.entry(op).or_default() += 1,
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
    report.worlds = 1;
    report.noncurrent_heads = usize::from(
        rebuilt.version != engine::version() || rebuilt.pack.as_deref() != Some(content::current()),
    );
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

#[test]
fn checks_active_worlds_including_untouched_checkpoints() -> Result<()> {
    let c = fixture()?;
    c.execute_batch(
        "
      CREATE TABLE card_tables(id TEXT PRIMARY KEY, retired_at INTEGER);
      INSERT INTO card_tables VALUES ('shadow-replay', NULL), ('untouched', NULL), ('retired', 1);
    ",
    )
    .map_err(super::store::sql_error)?;
    let state = World::seeded(None, Some(123))?;
    full_store::seed(&c, "untouched", &state, "shadow-replay", 4)?;
    let worlds = active_worlds(&c)?;
    assert_eq!(worlds, ["shadow-replay", "untouched"]);
    let equal = |version: &str, pack: Option<&str>, request: &Value| {
        engine::reduce_pack(version, pack, request.clone()).map(Some)
    };
    let report = verify_worlds(&c, &worlds, equal)?;
    assert_eq!(report.worlds, 2);
    assert_eq!(report.checked, 2);
    report.require_coverage(true)?;
    let report = verify_worlds(&c, &worlds, |_, _, _| Ok(None))?;
    assert_eq!(
        report.unsupported,
        BTreeMap::from([("join".into(), 1), ("presence".into(), 1)])
    );
    assert!(report.require_coverage(true).is_err());
    c.execute(
        "UPDATE card_full_checkpoints SET seq=3 WHERE world='untouched'",
        [],
    )
    .map_err(super::store::sql_error)?;
    assert_eq!(
        verify_worlds(&c, &worlds, equal).unwrap_err(),
        "World 2 of 2: checkpoint differs from journal head at sequence 4"
    );
    Ok(())
}

#[test]
fn cutover_requires_current_heads_and_observed_coverage() {
    assert!(Report::default().require_coverage(true).is_err());
    let report = Report {
        checked: 1,
        noncurrent_heads: 1,
        ..Report::default()
    };
    assert!(report.require_coverage(false).is_ok());
    assert_eq!(
        report.require_coverage(true).unwrap_err(),
        "Every checked world must be saved on current rules and content for cutover."
    );
}

#[cfg(feature = "rules-wasm")]
#[test]
fn sqlite_rules_wasm_parity() -> Result<()> {
    let artifact = std::env::var_os("COSYWORLD_RULES_WASM")
        .ok_or("Set COSYWORLD_RULES_WASM to the compiled rules artifact.")?;
    let bytes = std::fs::read(artifact).map_err(|_| "Could not read the rules artifact.")?;
    let guest = cosyworld_orchestrator::rules_wasm::Rules::new(&bytes)?;
    let candidate = |_: &str, _: Option<&str>, request: &Value| guest.reduce(request);
    let world = std::env::var("COSYWORLD_REPLAY_WORLD").ok();
    let all = std::env::var("COSYWORLD_REPLAY_ALL").as_deref() == Ok("1");
    let (mut c, world) = match (std::env::var_os("COSYWORLD_REPLAY_DB"), world, all) {
        (Some(path), world, all) if world.is_none() == all => {
            let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "Could not open the journal copy.")?;
            (c, world)
        }
        (None, None, false) => (fixture()?, Some("shadow-replay".into())),
        _ => return Err(
            "Set COSYWORLD_REPLAY_DB with either COSYWORLD_REPLAY_WORLD or COSYWORLD_REPLAY_ALL=1."
                .into(),
        ),
    };
    let snapshot = c.transaction().map_err(super::store::sql_error)?;
    let worlds = match world {
        Some(world) => vec![world],
        None => active_worlds(&snapshot)?,
    };
    let report = verify_worlds(&snapshot, &worlds, candidate)?;
    println!(
        "WASM replay totals: worlds={} matched={} unsupported={} historical={} noncurrent_heads={}",
        report.worlds,
        report.checked,
        report.unsupported.values().sum::<usize>(),
        report.historical,
        report.noncurrent_heads
    );
    for (op, count) in &report.unsupported {
        println!("Unsupported {op}: {count}");
    }
    report.require_coverage(std::env::var("COSYWORLD_REQUIRE_FULL_REPLAY").as_deref() == Ok("1"))
}
