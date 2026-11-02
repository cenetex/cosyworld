//! Only completed shared scenes can spend a world's speech pool. Their
//! normalized lines and speech journal entry commit in one transaction.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub(crate) fn line(
    c: &Connection,
    world: &str,
    play: &str,
    index: usize,
) -> rusqlite::Result<Option<(String, String)>> {
    let scene: Option<String> = c
        .query_row(
            "SELECT s.content FROM card_full_scenes s JOIN card_full_plays p
         ON p.id=s.play AND p.world=s.world
         WHERE s.world=?1 AND s.play=?2 AND p.status IN ('playing','done')",
            params![world, play],
            |r| r.get(0),
        )
        .optional()?;
    Ok(scene.and_then(|text| {
        let scene: Value = serde_json::from_str(&text).ok()?;
        let line = scene["lines"].as_array()?.get(index)?;
        if line["kind"] != "dialogue" {
            return None;
        }
        Some((
            line["actorId"].as_str()?.into(),
            line["text"].as_str()?.into(),
        ))
    }))
}

#[cfg(test)]
pub(super) fn seed(c: &Connection, second: &str) {
    c.execute_batch(
        "CREATE TABLE card_full_plays(id TEXT PRIMARY KEY,world TEXT,status TEXT);
         CREATE TABLE card_full_scenes(world TEXT,play TEXT,content TEXT);
         INSERT INTO card_full_plays VALUES('play-1','w1','playing');",
    )
    .unwrap();
    let lines = ["Hello.", second]
        .map(|text| serde_json::json!({"kind":"dialogue","actorId":"vale","text":text}));
    c.execute(
        "INSERT INTO card_full_scenes VALUES('w1','play-1',?)",
        [serde_json::json!({"lines":lines}).to_string()],
    )
    .unwrap();
}
