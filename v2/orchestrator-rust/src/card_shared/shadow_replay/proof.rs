use super::{content, direct, engine, Report, Result, World};
use crate::card_shared::store::sql_error;
use rusqlite::{params, Connection, OpenFlags, Transaction};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
};

const PROOF_MISMATCH: &str =
    "The epoch proof differs from this verified journal snapshot or candidate.";
const ANCHOR_MISMATCH: &str = "The checkpoint anchor differs from this verified epoch proof.";

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct Head {
    world_id_sha256: String,
    head_sequence: String,
    checkpoint_sha256: String,
    journal_sha256: String,
    #[serde(skip)]
    canonical_checkpoint_sha256: String,
}

impl Head {
    pub(super) fn read(
        c: &Connection,
        world: &str,
        seq: i64,
        state: &str,
        checkpoint: &World,
    ) -> Result<Self> {
        let canonical = serde_json::to_string(checkpoint).map_err(sql_error)?;
        Ok(Self {
            world_id_sha256: content::hash(world),
            head_sequence: seq.to_string(),
            checkpoint_sha256: content::hash(state),
            journal_sha256: journal_sha256(c, world)?,
            canonical_checkpoint_sha256: content::hash(&canonical),
        })
    }
}

#[derive(Debug)]
pub(super) struct VerifiedProof<'a> {
    sha256: String,
    heads: &'a [Head],
}

#[derive(Serialize)]
struct AnchorHead<'a> {
    world_id_sha256: &'a str,
    head_sequence: &'a str,
    canonical_checkpoint_sha256: &'a str,
}

#[derive(Serialize)]
struct Anchor<'a> {
    format: &'static str,
    readiness_proof_sha256: &'a str,
    worlds: Vec<AnchorHead<'a>>,
}

impl VerifiedProof<'_> {
    fn anchor_bytes(&self) -> Result<Vec<u8>> {
        let worlds = sorted_heads(self.heads)
            .into_iter()
            .map(|head| AnchorHead {
                world_id_sha256: &head.world_id_sha256,
                head_sequence: &head.head_sequence,
                canonical_checkpoint_sha256: &head.canonical_checkpoint_sha256,
            })
            .collect();
        json_bytes(&Anchor {
            format: "cosyworld-checkpoint-anchor/v1",
            readiness_proof_sha256: &self.sha256,
            worlds,
        })
    }

    pub(super) fn export_anchor(&self, path: &Path) -> Result<()> {
        let bytes = self.anchor_bytes()?;
        publish(path, |_, file| file.write_all(&bytes))
            .map_err(|err| format!("Could not publish the checkpoint anchor: {err}"))
    }

    pub(super) fn check_anchor(&self, path: &Path) -> Result<()> {
        compare(
            path,
            &self.anchor_bytes()?,
            "checkpoint anchor",
            ANCHOR_MISMATCH,
        )
    }

    pub(super) fn export_snapshot(
        &self,
        source: &Transaction<'_>,
        worlds: &[String],
        path: &Path,
    ) -> Result<()> {
        let anchor_sha256 = format!("{:x}", Sha256::digest(self.anchor_bytes()?));
        let mut heads: BTreeMap<_, _> = self
            .heads
            .iter()
            .map(|head| (head.world_id_sha256.as_str(), head))
            .collect();
        let mismatch = || io::Error::other("The checkpoint rows differ from the verified proof.");
        publish(path, |pending, _| {
            let mut database =
                Connection::open_with_flags(pending, OpenFlags::SQLITE_OPEN_READ_WRITE)
                    .map_err(io::Error::other)?;
            let output = database.transaction().map_err(io::Error::other)?;
            output
                .execute_batch(
                    "CREATE TABLE epoch_metadata (
                       format TEXT PRIMARY KEY, readiness_proof_sha256 TEXT NOT NULL,
                       anchor_sha256 TEXT NOT NULL
                     );
                     CREATE TABLE epoch_checkpoints (
                       world_id_sha256 TEXT PRIMARY KEY, head_sequence INTEGER NOT NULL,
                       state_sha256 TEXT NOT NULL, state TEXT NOT NULL
                     );",
                )
                .map_err(io::Error::other)?;
            output
                .execute(
                    "INSERT INTO epoch_metadata VALUES ('cosyworld-checkpoint-snapshot/v1',?,?)",
                    params![self.sha256, anchor_sha256],
                )
                .map_err(io::Error::other)?;
            let mut get = source
                .prepare("SELECT seq,state FROM card_full_checkpoints WHERE world=?")
                .map_err(io::Error::other)?;
            for world in worlds {
                let id = content::hash(world);
                let head = heads.remove(id.as_str()).ok_or_else(mismatch)?;
                let (seq, state): (i64, String) = get
                    .query_row([world], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(io::Error::other)?;
                let world: World = serde_json::from_str(&state).map_err(io::Error::other)?;
                let canonical = serde_json::to_string(&world).map_err(io::Error::other)?;
                if seq.to_string() != head.head_sequence
                    || content::hash(&state) != head.checkpoint_sha256
                    || content::hash(&canonical) != head.canonical_checkpoint_sha256
                {
                    return Err(mismatch());
                }
                output
                    .execute(
                        "INSERT INTO epoch_checkpoints VALUES (?,?,?,?)",
                        params![id, seq, head.canonical_checkpoint_sha256, canonical],
                    )
                    .map_err(io::Error::other)?;
            }
            if !heads.is_empty() {
                return Err(mismatch());
            }
            output.commit().map_err(io::Error::other)
        })
        .map_err(|err| format!("Could not publish the SQLite checkpoint snapshot: {err}"))
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
    let bytes = canonical_bytes(artifact, journal, direct)?;
    publish(path, |_, file| file.write_all(&bytes))
        .map_err(|err| format!("Could not publish the epoch proof: {err}"))
}

pub(super) fn check<'a>(
    path: &Path,
    artifact: &[u8],
    journal: &'a Report,
    direct: &direct::Report,
) -> Result<VerifiedProof<'a>> {
    let expected = canonical_bytes(artifact, journal, direct)?;
    compare(path, &expected, "epoch proof", PROOF_MISMATCH)?;
    Ok(VerifiedProof {
        sha256: format!("{:x}", Sha256::digest(&expected)),
        heads: &journal.heads,
    })
}

fn compare(path: &Path, expected: &[u8], label: &str, mismatch: &str) -> Result<()> {
    let limit = u64::try_from(expected.len()).map_err(|err| err.to_string())? + 1;
    let mut recorded = Vec::new();
    File::open(path)
        .and_then(|file| file.take(limit).read_to_end(&mut recorded))
        .map_err(|err| format!("Could not read the {label}: {err}"))?;
    if recorded != expected {
        return Err(mismatch.into());
    }
    Ok(())
}

fn sorted_heads(heads: &[Head]) -> Vec<&Head> {
    let mut heads: Vec<_> = heads.iter().collect();
    heads.sort_unstable_by(|a, b| a.world_id_sha256.cmp(&b.world_id_sha256));
    heads
}

fn canonical_bytes(artifact: &[u8], journal: &Report, direct: &direct::Report) -> Result<Vec<u8>> {
    journal.require_coverage(true)?;
    direct.require_coverage(true)?;
    let proof = json!({
        "format": "cosyworld-epoch-readiness/v2",
        "rules_version": engine::version(),
        "rules_sha256": content::hash(engine::current_source()),
        "content_sha256": content::current(),
        "candidate_sha256": format!("{:x}", Sha256::digest(artifact)),
        "matched_journal_calls": journal.checked,
        "historical_journal_calls": journal.historical,
        "matched_direct_fixtures": direct.matched,
        "worlds": sorted_heads(&journal.heads),
    });
    json_bytes(&proof)
}

fn json_bytes(value: &impl Serialize) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|err| err.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn publish(path: &Path, write: impl FnOnce(&Path, &mut File) -> io::Result<()>) -> io::Result<()> {
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
        write(&pending, &mut file)?;
        file.sync_all()?;
        drop(file);
        fs::hard_link(&pending, path)
    })();
    let _ = fs::remove_file(pending);
    result
}

#[test]
fn exports_only_complete_proof_from_a_read_only_snapshot() -> Result<()> {
    use super::{active_worlds, fixture, full_store, verify_worlds};
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
    let anchor_path = root.0.join("anchor.json");
    let second_anchor = root.0.join("repeat-anchor.json");
    let checkpoints_path = root.0.join("checkpoint-snapshot.sqlite");
    let rejected_path = root.0.join("incomplete-snapshot.sqlite");
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
        UPDATE card_full_checkpoints SET seq=9007199254740993, state=char(10)||state
          WHERE world='untouched';
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
    {
        let verified = check(&output, artifact, &journal, &direct)?;
        verified.export_anchor(&anchor_path)?;
        assert!(verified.export_anchor(&anchor_path).is_err());
        verified.check_anchor(&anchor_path)?;
        check(&second, artifact, &journal, &direct)?.export_anchor(&second_anchor)?;
        assert!(verified
            .export_snapshot(&snapshot, &worlds[..1], &rejected_path)
            .is_err());
        assert!(!rejected_path.exists());
        verified.export_snapshot(&snapshot, &worlds, &checkpoints_path)?;
        assert!(verified.export_snapshot(&snapshot, &worlds, &db).is_err());

        let exported =
            Connection::open_with_flags(&checkpoints_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(sql_error)?;
        let metadata: (String, String, String) = exported
            .query_row("SELECT * FROM epoch_metadata", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(sql_error)?;
        assert_eq!(metadata.0, "cosyworld-checkpoint-snapshot/v1");
        assert_eq!(metadata.1, format!("{:x}", Sha256::digest(&bytes)));
        assert_eq!(
            metadata.2,
            format!("{:x}", Sha256::digest(fs::read(&anchor_path).unwrap()))
        );
        let count: usize = exported
            .query_row("SELECT count(*) FROM epoch_checkpoints", [], |row| {
                row.get(0)
            })
            .map_err(sql_error)?;
        assert_eq!(count, worlds.len());
        for head in &journal.heads {
            let (seq, digest, state): (i64, String, String) = exported
                .query_row(
                    "SELECT head_sequence,state_sha256,state FROM epoch_checkpoints WHERE world_id_sha256=?",
                    [&head.world_id_sha256],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(sql_error)?;
            assert_eq!(seq.to_string(), head.head_sequence);
            assert_eq!(digest, head.canonical_checkpoint_sha256);
            assert_eq!(digest, content::hash(&state));
            let state: World = serde_json::from_str(&state).map_err(sql_error)?;
            assert_eq!(
                digest,
                content::hash(&serde_json::to_string(&state).map_err(sql_error)?)
            );
        }
    }
    assert_eq!(
        check(&output, b"different", &journal, &direct).unwrap_err(),
        PROOF_MISMATCH
    );
    assert!(check(&output, artifact, &incomplete, &direct).is_err());
    direct.unsupported.push("create-fresh");
    assert!(check(&output, artifact, &journal, &direct).is_err());
    direct.unsupported.clear();
    let padded = root.0.join("padded.json");
    fs::write(&padded, [&bytes[..], b"\n"].concat()).unwrap();
    assert_eq!(
        check(&padded, artifact, &journal, &direct).unwrap_err(),
        PROOF_MISMATCH
    );

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
    let anchor_bytes = fs::read(&anchor_path).unwrap();
    assert_eq!(anchor_bytes, fs::read(&second_anchor).unwrap());
    let anchor: Value = serde_json::from_slice(&anchor_bytes).unwrap();
    assert_eq!(anchor["format"], "cosyworld-checkpoint-anchor/v1");
    assert_eq!(
        anchor["readiness_proof_sha256"],
        format!("{:x}", Sha256::digest(&bytes))
    );
    let anchor_worlds = anchor["worlds"].as_array().unwrap();
    assert_eq!(anchor_worlds.len(), 2);
    assert!(
        anchor_worlds[0]["world_id_sha256"].as_str() < anchor_worlds[1]["world_id_sha256"].as_str()
    );
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
        assert!(head.get("canonical_checkpoint_sha256").is_none());
        assert!(!String::from_utf8_lossy(&bytes).contains(world));
        let sealed = anchor_worlds
            .iter()
            .find(|head| head["world_id_sha256"] == content::hash(world))
            .unwrap();
        let canonical =
            serde_json::to_string(&serde_json::from_str::<World>(&state).unwrap()).unwrap();
        assert_eq!(sealed["head_sequence"], sequence);
        assert_eq!(
            sealed["canonical_checkpoint_sha256"],
            content::hash(&canonical)
        );
        if world == "untouched" {
            assert_ne!(
                sealed["canonical_checkpoint_sha256"],
                head["checkpoint_sha256"]
            );
        }
        assert!(!String::from_utf8_lossy(&anchor_bytes).contains(world));
    }
    let tampered = root.0.join("tampered-anchor.json");
    let digest = anchor_worlds[0]["canonical_checkpoint_sha256"]
        .as_str()
        .unwrap();
    fs::write(
        &tampered,
        String::from_utf8_lossy(&anchor_bytes).replacen(digest, &"0".repeat(64), 1),
    )
    .unwrap();
    assert_eq!(
        check(&output, artifact, &journal, &direct)?
            .check_anchor(&tampered)
            .unwrap_err(),
        ANCHOR_MISMATCH
    );
    let subset = verify_worlds(&snapshot, &worlds[..1], journal_oracle)?;
    assert_eq!(
        check(&output, artifact, &subset, &direct).unwrap_err(),
        PROOF_MISMATCH
    );
    drop(snapshot);
    drop(read);
    assert!(before == fs::read(&db).unwrap());
    let read_changed_copy = |name: &str| -> Result<Report> {
        let path = root.0.join(name);
        c.backup(MAIN_DB, &path, None).map_err(sql_error)?;
        let before = fs::read(&path).unwrap();
        let mut read = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(sql_error)?;
        let snapshot = read.transaction().map_err(sql_error)?;
        let worlds = active_worlds(&snapshot)?;
        let report = verify_worlds(&snapshot, &worlds, journal_oracle)?;
        drop(snapshot);
        drop(read);
        assert_eq!(before, fs::read(&path).unwrap());
        Ok(report)
    };
    c.execute_batch("UPDATE card_full_log SET at=at+1 WHERE seq=2")
        .map_err(sql_error)?;
    let timestamp = read_changed_copy("changed-timestamp.sqlite")?;
    assert_eq!(
        check(&output, artifact, &timestamp, &direct).unwrap_err(),
        PROOF_MISMATCH
    );

    c.execute_batch(
        "UPDATE card_full_log SET at=at-1 WHERE seq=2;
         UPDATE card_full_log SET seq=5 WHERE seq=3;
         UPDATE card_full_checkpoints SET seq=5 WHERE world='shadow-replay';",
    )
    .map_err(sql_error)?;
    let head = read_changed_copy("changed-head.sqlite")?;
    assert_eq!(
        check(&output, artifact, &head, &direct).unwrap_err(),
        PROOF_MISMATCH
    );
    assert_eq!(bytes, fs::read(&output).unwrap());
    assert_eq!(anchor_bytes, fs::read(&anchor_path).unwrap());
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
