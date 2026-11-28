use super::{content, direct, engine, Report, Result};
use crate::card_shared::store::sql_error;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct Head {
    world_id_sha256: String,
    head_sequence: String,
    checkpoint_sha256: String,
    journal_sha256: String,
}

impl Head {
    pub(super) fn read(c: &Connection, world: &str, seq: i64, state: &str) -> Result<Self> {
        Ok(Self {
            world_id_sha256: content::hash(world),
            head_sequence: seq.to_string(),
            checkpoint_sha256: content::hash(state),
            journal_sha256: journal_sha256(c, world)?,
        })
    }
}

fn journal_sha256(c: &Connection, world: &str) -> Result<String> {
    let mut statement = c
        .prepare("SELECT seq, at, command FROM card_full_log WHERE world=? ORDER BY seq")
        .map_err(sql_error)?;
    let mut rows = statement.query([world]).map_err(sql_error)?;
    let mut digest = Sha256::new();
    digest.update(b"cosyworld-sqlite-journal-v1\0");
    while let Some(row) = rows.next().map_err(sql_error)? {
        let seq: i64 = row.get(0).map_err(sql_error)?;
        let at: i64 = row.get(1).map_err(sql_error)?;
        let command = row
            .get_ref(2)
            .map_err(sql_error)?
            .as_str()
            .map_err(sql_error)?;
        if seq <= 0 {
            return Err("Journal sequences must be positive for epoch verification.".into());
        }
        digest.update(seq.to_be_bytes());
        digest.update(at.to_be_bytes());
        let length = u64::try_from(command.len()).map_err(sql_error)?;
        digest.update(length.to_be_bytes());
        digest.update(command.as_bytes());
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn export(
    path: &Path,
    artifact: &[u8],
    journal: &Report,
    direct: &direct::Report,
) -> Result<()> {
    journal.require_coverage(true)?;
    direct.require_coverage(true)?;
    let mut heads: Vec<_> = journal.heads.iter().collect();
    heads.sort_unstable_by(|a, b| a.world_id_sha256.cmp(&b.world_id_sha256));
    let proof = json!({
        "format": "cosyworld-epoch-readiness/v2",
        "rules_version": engine::version(),
        "rules_sha256": content::hash(engine::current_source()),
        "content_sha256": content::current(),
        "candidate_sha256": format!("{:x}", Sha256::digest(artifact)),
        "matched_journal_calls": journal.checked,
        "historical_journal_calls": journal.historical,
        "matched_direct_fixtures": direct.matched,
        "worlds": heads,
    });
    let mut bytes = serde_json::to_vec_pretty(&proof).map_err(|err| err.to_string())?;
    bytes.push(b'\n');
    publish(path, &bytes).map_err(|err| format!("Could not publish the epoch proof: {err}"))
}

fn publish(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let pending = path.with_file_name(format!(
        ".cosyworld-epoch-{}.pending",
        crate::random_hex(16)
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&pending)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::hard_link(&pending, path)
    })();
    let _ = fs::remove_file(pending);
    result
}

#[test]
fn exports_only_complete_proof_from_a_read_only_snapshot() -> Result<()> {
    use super::{active_worlds, fixture, full_store, verify_worlds, World};
    use rusqlite::{OpenFlags, MAIN_DB};
    use serde_json::Value;
    use std::path::PathBuf;

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let root =
        Scratch(std::env::temp_dir().join(format!("cosyworld-proof-{}", crate::random_hex(8))));
    fs::create_dir(&root.0).unwrap();
    let db = root.0.join("copy.sqlite");
    let output = root.0.join("proof.json");
    let second = root.0.join("repeat.json");
    let c = fixture()?;
    full_store::seed(
        &c,
        "untouched",
        &World::seeded(None, Some(123))?,
        "proof",
        4,
    )?;
    c.execute_batch(
        "
        CREATE TABLE card_tables(id TEXT PRIMARY KEY, retired_at INTEGER);
        INSERT INTO card_tables VALUES ('shadow-replay', NULL), ('untouched', NULL), ('retired', 4);
        UPDATE card_full_log SET seq=9007199254740993 WHERE world='untouched';
        UPDATE card_full_checkpoints SET seq=9007199254740993 WHERE world='untouched';
    ",
    )
    .map_err(sql_error)?;
    c.backup(MAIN_DB, &db, None).map_err(sql_error)?;
    let before = fs::read(&db).unwrap();
    let mut read =
        Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(sql_error)?;
    let snapshot = read.transaction().map_err(sql_error)?;
    let worlds = active_worlds(&snapshot)?;
    let journal_oracle = |version: &str, pack: Option<&str>, request: &Value| {
        engine::reduce_journal(version, pack, request.clone()).map(Some)
    };
    let journal = verify_worlds(&snapshot, &worlds, journal_oracle)?;
    let mut direct = direct::verify(|version, pack, request| {
        engine::reduce_pack_envelope(version, pack, request.clone()).map(Some)
    })?;
    let artifact = b"synthetic candidate";
    let incomplete = verify_worlds(&snapshot, &worlds, |_, _, _| Ok(None))?;
    assert!(export(&output, artifact, &incomplete, &direct).is_err());
    direct.unsupported.push("create-fresh");
    assert!(export(&output, artifact, &journal, &direct).is_err());
    direct.unsupported.clear();
    assert!(!output.exists());
    export(&output, artifact, &journal, &direct)?;
    export(&second, artifact, &journal, &direct)?;
    let bytes = fs::read(&output).unwrap();
    assert_eq!(bytes, fs::read(&second).unwrap());
    assert!(export(&output, b"different", &journal, &direct).is_err());
    assert_eq!(bytes, fs::read(&output).unwrap());

    let proof: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(proof["format"], "cosyworld-epoch-readiness/v2");
    assert_eq!(
        proof["candidate_sha256"],
        content::hash("synthetic candidate")
    );
    assert_eq!(
        proof["rules_sha256"],
        content::hash(engine::current_source())
    );
    assert_eq!(proof["rules_version"], engine::version());
    assert_eq!(proof["content_sha256"], content::current());
    assert_eq!(proof["worlds"].as_array().unwrap().len(), 2);
    let expected = [("shadow-replay", "3"), ("untouched", "9007199254740993")];
    for (world, sequence) in expected {
        let state: String = snapshot
            .query_row(
                "SELECT state FROM card_full_checkpoints WHERE world=?",
                [world],
                |r| r.get(0),
            )
            .map_err(sql_error)?;
        let head = proof["worlds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|head| head["world_id_sha256"] == content::hash(world))
            .unwrap();
        assert_eq!(head["head_sequence"], sequence);
        assert_eq!(head["checkpoint_sha256"], content::hash(&state));
        assert_eq!(head["journal_sha256"], journal_sha256(&snapshot, world)?);
        assert!(!String::from_utf8_lossy(&bytes).contains(world));
    }
    drop(snapshot);
    drop(read);
    assert!(before == fs::read(&db).unwrap());
    Ok(())
}

#[test]
fn detects_changes_to_journal_rows_that_leave_the_checkpoint_identical() -> Result<()> {
    use super::{fixture, verify};
    use serde_json::Value;

    let c = fixture()?;
    let world = "shadow-replay";
    let oracle = |version: &str, pack: Option<&str>, request: &Value| {
        engine::reduce_journal(version, pack, request.clone()).map(Some)
    };
    let before = verify(&c, world, oracle)?;
    c.execute(
        "UPDATE card_full_log SET at=at+1 WHERE world=? AND seq=2",
        [world],
    )
    .map_err(sql_error)?;
    let after = verify(&c, world, oracle)?;
    assert_eq!(before.checked, after.checked);
    assert_eq!(before.heads[0].head_sequence, after.heads[0].head_sequence);
    assert_eq!(
        before.heads[0].checkpoint_sha256,
        after.heads[0].checkpoint_sha256
    );
    assert_ne!(
        before.heads[0].journal_sha256,
        after.heads[0].journal_sha256
    );

    c.execute(
        "INSERT INTO card_full_log(seq, world, command, at)
        SELECT 0, world, command, at FROM card_full_log WHERE world=? AND seq=2",
        [world],
    )
    .map_err(sql_error)?;
    assert_eq!(
        verify(&c, world, oracle).unwrap_err(),
        "Journal sequences must be positive for epoch verification."
    );
    Ok(())
}

#[test]
fn journal_digest_frames_exact_bytes_in_sequence_order() -> Result<()> {
    let c = Connection::open_in_memory().map_err(sql_error)?;
    super::full_store::schema(&c)?;
    c.execute(
        "INSERT INTO card_full_log(seq, world, command, at) VALUES (?, 'test', '{}', 4)",
        [9007199254740993_i64],
    )
    .map_err(sql_error)?;
    c.execute(
        "INSERT INTO card_full_log(seq, world, command, at) VALUES (1, 'test', ?, -2)",
        [r#"{"note":"é"}"#],
    )
    .map_err(sql_error)?;
    assert_eq!(
        journal_sha256(&c, "test")?,
        "e91704f431d4e886ec54112cb55aafb071894390a24cd4c60ed0ceac49d92647"
    );
    Ok(())
}
