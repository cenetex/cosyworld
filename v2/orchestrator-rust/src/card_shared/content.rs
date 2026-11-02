//! Pack content revisions for shared rules that take content as input.
//!
//! Rules bundles from v58 on read packs, forest, weather and cast data from
//! `globalThis.cardContent` instead of carrying them. A revision is named by
//! the SHA-256 of its exact bytes. The server stores every revision a journal
//! names in `card_full_packs` before that journal row, never changes a row,
//! and replays only from verified bytes. Bundles v2 to v57 carry their own
//! packs and never see this. See docs/design/pack-content-outside-the-engine.md.
use super::store::{sql_error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

const CURRENT: &str = include_str!("content.json");
const MISSING: &str = "This world's pack content needs recovery.";

pub(super) fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
/// The content revision this binary was built with.
pub(super) fn current() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| hash(CURRENT))
}
/// The package version that built the current revision, for people.
pub(super) const REVISION: &str = env!("CARGO_PKG_VERSION");
/// A rules bundle takes content as input when it reads the content global.
pub(super) fn takes_content(source: &str) -> bool {
    source.contains("globalThis.cardContent")
}
fn loaded() -> &'static Mutex<HashMap<String, Arc<str>>> {
    static LOADED: OnceLock<Mutex<HashMap<String, Arc<str>>>> = OnceLock::new();
    LOADED.get_or_init(|| Mutex::new(HashMap::from([(current().to_string(), Arc::from(CURRENT))])))
}
/// Verified content for `pack`, from this binary or an earlier `preload`.
pub(super) fn text(pack: &str) -> Result<Arc<str>> {
    loaded()
        .lock()
        .map_err(|_| MISSING.to_string())?
        .get(pack)
        .cloned()
        .ok_or_else(|| MISSING.into())
}
/// Store the current revision before a journal row names it.
pub(super) fn save(c: &Connection) -> Result<()> {
    c.execute(
        "INSERT OR IGNORE INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        params![current(), REVISION, CURRENT],
    )
    .map_err(sql_error)?;
    // An existing row must hold the same bytes; rows are never rewritten.
    match stored(c, current())? {
        Some(text) if text == CURRENT => Ok(()),
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

/// This binary's content less what rules 86 added (hiding places, `live`
/// routes, `gate_open`), which earlier released rules refuse. Tests that seed
/// a world on those rules read it. The cut keeps every other byte in order.
#[cfg(test)]
pub(super) fn released() -> &'static str {
    fn cut(text: &mut String, open: &str, close: &str) {
        while let Some(at) = text.find(open) {
            let end = text[at..].find(close).expect("a closed field") + at + close.len();
            text.replace_range(at..end, "");
        }
    }
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| {
        let mut text = CURRENT.replace("\"live\":true,", "");
        cut(&mut text, ",\"hiding\":{\"pool\":[", "]}");
        cut(&mut text, ",{\"kind\":\"gate_open\"", "}");
        let name = hash(&text);
        if let Ok(mut loaded) = loaded().lock() {
            loaded.insert(name.clone(), Arc::from(text));
        }
        name
    })
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
        assert_eq!(current(), hash(CURRENT));
        assert_eq!(&*text(current()).unwrap(), CURRENT);
        let content: serde_json::Value = serde_json::from_str(CURRENT).unwrap();
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

    #[test]
    fn worlds_on_rules_with_their_own_packs_keep_their_saved_bytes() {
        use super::super::{engine, full_world::World};
        let mut w = World::create(None).unwrap();
        assert_eq!(w.pack.is_some(), engine::takes_content(engine::VERSION));
        if w.pack.is_none() {
            let saved = serde_json::to_value(&w).unwrap();
            assert!(saved.get("pack").is_none());
            let mut named = saved.clone();
            named["pack"] = serde_json::json!(current());
            let back: World = serde_json::from_value(named).unwrap();
            assert_eq!(back.pack.as_deref(), Some(current()));
            let repack = serde_json::json!({"op":"repack","from":null,"to":current()});
            assert!(w.apply(&repack).is_err());
        }
    }

    #[test]
    fn released_bundles_carry_their_own_packs() {
        assert!(!takes_content(include_str!("engine-v57.js")));
        assert!(!takes_content(include_str!("engine-v2.js")));
    }
}
