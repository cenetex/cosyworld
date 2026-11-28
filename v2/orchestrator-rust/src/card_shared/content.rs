//! Save `globalThis.cardContent` revisions in `card_full_packs` before use and verify SHA-256 on replay.
use super::store::{sql_error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

const MISSING: &str = "This world's pack content needs recovery.";

pub(super) fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
pub(super) fn current() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| hash(current_text()))
}
pub(super) fn current_text() -> &'static str {
    cosyworld_orchestrator::card_assets::text("card_shared/content.json")
}
pub(super) const REVISION: &str = env!("CARGO_PKG_VERSION");
fn loaded() -> &'static Mutex<HashMap<String, Arc<str>>> {
    static LOADED: OnceLock<Mutex<HashMap<String, Arc<str>>>> = OnceLock::new();
    LOADED.get_or_init(|| {
        Mutex::new(HashMap::from([(
            current().to_string(),
            Arc::from(current_text()),
        )]))
    })
}
pub(super) fn text(pack: &str) -> Result<Arc<str>> {
    loaded()
        .lock()
        .map_err(|_| MISSING.to_string())?
        .get(pack)
        .cloned()
        .ok_or_else(|| MISSING.into())
}
pub(super) fn save(c: &Connection) -> Result<()> {
    c.execute(
        "INSERT OR IGNORE INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        params![current(), REVISION, current_text()],
    )
    .map_err(sql_error)?;
    match stored(c, current())? {
        Some(text) if text == current_text() => Ok(()),
        _ => Err(MISSING.into()),
    }
}
fn stored(c: &Connection, pack: &str) -> Result<Option<String>> {
    c.query_row(
        "SELECT content FROM card_full_packs WHERE hash=?",
        [pack],
        |r| r.get(0),
    )
    .optional()
    .map_err(sql_error)
}
/// Load and verify a stored revision so replay can use it.
pub(super) fn preload(c: &Connection, pack: &str) -> Result<()> {
    if text(pack).is_ok() {
        return Ok(());
    }
    let stored = stored(c, pack)?.ok_or(MISSING)?;
    if hash(&stored) != pack {
        tracing::error!(pack, "stored pack content failed its hash");
        return Err(MISSING.into());
    }
    if let Ok(mut loaded) = loaded().lock() {
        loaded
            .entry(pack.to_string())
            .or_insert_with(|| Arc::from(stored));
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn verify_stored(c: &Connection, pack: &str) -> Result<()> {
    match stored(c, pack)? {
        Some(text) if hash(&text) == pack => Ok(()),
        _ => Err(MISSING.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        super::super::full_store::schema(&c).unwrap();
        c
    }

    #[test]
    fn names_the_current_revision_by_its_exact_bytes() {
        assert_eq!(current(), hash(current_text()));
        assert_eq!(&*text(current()).unwrap(), current_text());
        let content: serde_json::Value = serde_json::from_str(current_text()).unwrap();
        assert_eq!(content["schema"], 1);
        assert!(content["files"]["v2/card-game/packs.json"].is_object());
    }

    #[test]
    fn stores_each_revision_once_and_replays_only_verified_bytes() {
        let c = db();
        save(&c).unwrap();
        save(&c).unwrap();
        let rows: i64 = c
            .query_row("SELECT count(*) FROM card_full_packs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
        let old = "{\"schema\":1,\"files\":{}}\n";
        let old_hash = hash(old);
        assert!(text(&old_hash).is_err());
        assert!(preload(&c, &old_hash).is_err());
        c.execute(
            "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
            params![old_hash, "1.0.0", old],
        )
        .unwrap();
        preload(&c, &old_hash).unwrap();
        assert_eq!(&*text(&old_hash).unwrap(), old);
        let forged = hash("forged");
        c.execute(
            "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
            params![forged, "1.0.0", old],
        )
        .unwrap();
        assert!(preload(&c, &forged).is_err());
    }
}
