//! The one-time classic table drop (#1652) against a store that the real card
//! init paths filled: accounts, a shared world, play metrics.
use super::{full_store, full_world::World, store};
use crate::card_boot::classic_row_drop::{classic_tables, drop_classic_tables, shrink_store};
use rusqlite::Connection;
use std::{collections::BTreeMap, path::Path, sync::Arc};

/// Every table that is not a classic one, with its row count and schema text.
fn survivors(path: &Path) -> BTreeMap<String, (i64, String)> {
    let c = Connection::open(path).unwrap();
    let mut s = c
        .prepare(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .unwrap();
    let tables: Vec<(String, String)> = s
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    tables
        .into_iter()
        .filter(|(name, _)| !classic_tables().contains(&name.as_str()))
        .map(|(name, sql)| {
            let n = c
                .query_row(&format!("SELECT COUNT(*) FROM \"{name}\""), [], |r| {
                    r.get(0)
                })
                .unwrap();
            (name, (n, sql))
        })
        .collect()
}

fn names(path: &Path) -> Vec<String> {
    let c = Connection::open(path).unwrap();
    let mut s = c
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .unwrap();
    s.query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// The store as a deployed card server leaves it, before any classic table.
fn card_store(legacy: bool) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("classic-drop-{}.sqlite", crate::random_hex(12)));
    if legacy {
        // A store created before #877 holds tables under auto_vacuum = none.
        let c = Connection::open(&path).unwrap();
        c.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))
            .unwrap();
        c.execute_batch("CREATE TABLE actor_sessions(id INTEGER PRIMARY KEY)")
            .unwrap();
    }
    crate::init_event_store(&path).unwrap();
    // Accounts and passkeys, through their real schema init.
    let _ = crate::account_auth::AccountAuth::for_test(Some(Arc::new(path.clone())));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", 1_000_000).unwrap();
    full_store::seed(
        &c,
        &id,
        &World::create(None).unwrap(),
        "test-create",
        1_000_000,
    )
    .unwrap();
    c.execute(
        "INSERT INTO auth_users(id, username, display_name, created_at_unix, updated_at_unix) VALUES('u1','ada','Ada',1,1)",
        [],
    )
    .unwrap();
    let mut m = Connection::open(&path).unwrap();
    let day = 20_000;
    let batch = crate::routes::play_metrics::parse(
        format!(r#"{{"day":{day},"counters":{{"session.start":3,"play.talk":5}}}}"#).as_bytes(),
        day,
    )
    .unwrap();
    crate::routes::play_metrics::store(&mut m, &batch, day).unwrap();
    path
}

#[test]
fn classic_tables_do_not_collide_with_tables_the_card_paths_create() {
    let path = card_store(false);
    let present = names(&path);
    for needed in [
        "auth_users",
        "card_tables",
        "card_full_log",
        "play_metrics_daily",
    ] {
        assert!(
            present.iter().any(|n| n == needed),
            "fixture lacks {needed}"
        );
    }
    for table in classic_tables() {
        assert!(
            !present.iter().any(|n| n == table),
            "card init creates {table}, which the drop would delete"
        );
    }
}

#[test]
fn classic_tables_are_not_created_or_queried_by_current_source() {
    fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|e| e == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    assert!(files.len() > 50);
    for file in files {
        if file.ends_with("classic_row_drop.rs") || file.ends_with("classic_drop_tests.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&file).unwrap();
        for table in classic_tables() {
            for verb in [
                "TABLE IF NOT EXISTS",
                "TABLE",
                "FROM",
                "INTO",
                "UPDATE",
                "JOIN",
            ] {
                let probe = format!("{verb} {table}");
                assert!(
                    !text
                        .to_ascii_uppercase()
                        .contains(&probe.to_ascii_uppercase()),
                    "{} still uses `{probe}`",
                    file.display()
                );
            }
        }
    }
}

#[test]
fn drop_removes_only_classic_tables_and_shrinks_the_file() {
    let path = card_store(true);
    let before_survivors = survivors(&path);
    {
        let c = Connection::open(&path).unwrap();
        for table in [
            "world_events",
            "canonical_commits",
            "orb_ledger",
            "media_jobs",
            "action_journal",
            "persistence_compaction",
        ] {
            c.execute_batch(&format!(
                "CREATE TABLE {table}(id INTEGER PRIMARY KEY, body BLOB);
                 CREATE INDEX {table}_body ON {table}(id, body);
                 CREATE TRIGGER {table}_t AFTER INSERT ON {table} BEGIN SELECT 1; END;"
            ))
            .unwrap();
            for _ in 0..3 {
                c.execute(
                    &format!("INSERT INTO {table}(body) VALUES(zeroblob(400000))"),
                    [],
                )
                .unwrap();
            }
        }
    }
    let with_classic = survivors(&path);
    assert_eq!(
        with_classic, before_survivors,
        "only classic tables were added"
    );
    let size_before = std::fs::metadata(&path).unwrap().len();
    assert!(size_before > 4_000_000);

    let report = drop_classic_tables(&path).unwrap();
    assert_eq!(report.dropped.len(), 7);
    assert_eq!(
        report.dropped.iter().filter(|(_, rows)| *rows == 3).count(),
        6
    );
    assert!(report.dropped.contains(&("actor_sessions", 0)));
    assert_eq!(report.missing, classic_tables().len() - 7);
    assert!(report.freed_bytes > 4_000_000);

    let left = names(&path);
    for table in classic_tables() {
        assert!(!left.iter().any(|n| n == table), "{table} survived");
    }
    let c = Connection::open(&path).unwrap();
    let leftovers: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'world_events%' OR name LIKE 'orb_ledger%' OR name LIKE 'canonical_commits%' OR name LIKE 'media_jobs%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(leftovers, 0, "indexes and triggers go with their table");
    drop(c);
    assert_eq!(
        survivors(&path),
        with_classic,
        "every other table is untouched"
    );

    let legacy: i64 = Connection::open(&path)
        .unwrap()
        .query_row("PRAGMA auto_vacuum", [], |r| r.get(0))
        .unwrap();
    assert_eq!(legacy, 0, "fixture models a pre-#877 store");
    assert_eq!(shrink_store(&path).unwrap(), "vacuum");
    let size_after = std::fs::metadata(&path).unwrap().len();
    assert!(
        size_after < size_before / 4,
        "{size_after} !< {size_before}/4"
    );
    assert_eq!(survivors(&path), with_classic);
    let c = Connection::open(&path).unwrap();
    let mode: i64 = c.query_row("PRAGMA auto_vacuum", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, 2);
    drop(c);

    // Second run: nothing left, nothing changes.
    let again = drop_classic_tables(&path).unwrap();
    assert!(again.dropped.is_empty());
    assert_eq!(again.missing, classic_tables().len());
    assert_eq!(survivors(&path), with_classic);
    assert_eq!(shrink_store(&path).unwrap(), "incremental_vacuum");
    assert_eq!(survivors(&path), with_classic);
}

#[test]
fn boot_step_drops_once_and_is_a_no_op_the_second_time() {
    use crate::card_boot::classic_row_drop::run_requested_drop;
    let path = card_store(true);
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "CREATE TABLE ai_usage_ledger(id INTEGER); INSERT INTO ai_usage_ledger VALUES(1);",
        )
        .unwrap();
    let kept = survivors(&path);
    let first = run_requested_drop(&path).unwrap();
    assert_eq!(first.dropped.len(), 2);
    assert_eq!(survivors(&path), kept);
    let second = run_requested_drop(&path).unwrap();
    assert!(second.dropped.is_empty());
    assert_eq!(survivors(&path), kept);
}
