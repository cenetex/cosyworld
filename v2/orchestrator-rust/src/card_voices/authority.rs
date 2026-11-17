//! Only completed shared scenes can be voiced in a shared world. Their
//! normalized lines and speech journal entry commit in one transaction.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub(crate) const VOICE_CHANCE: f64 = 0.05;

pub(crate) fn chance_line(speaker: &str, text: &str) -> bool {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in speaker.bytes().chain(*b"\n").chain(text.bytes()) {
        hash = (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193);
    }
    f64::from(hash) < VOICE_CHANCE * 4_294_967_296.0
}

pub(crate) fn quest_residents(
    game: &Value,
    actor: &str,
    turn: &Value,
    lines: &Value,
) -> Vec<String> {
    let closed = &game["actors"][actor]["closed"];
    let met = game["log"].as_array().into_iter().flatten().any(|entry| {
        entry["verb"] == "want_met"
            && entry["actorId"] == actor
            && entry["turn"] == *turn
            && entry["generated"] != true
    });
    if !met {
        return vec![];
    }
    lines
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|line| line["actorId"].as_str())
        .filter(|id| turn.is_number() && closed[format!("quest:from:{id}")][0] == *turn)
        .map(String::from)
        .collect()
}

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
        let actor = line["actorId"].as_str()?;
        let words = line["text"].as_str()?;
        let quest = scene["quest"]
            .as_array()
            .is_some_and(|quest| quest.iter().any(|id| id == actor));
        if line["kind"] != "dialogue" || !(quest || chance_line(actor, words)) {
            return None;
        }
        Some((actor.into(), words.into()))
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
        [serde_json::json!({"lines":lines,"quest":["vale"]}).to_string()],
    )
    .unwrap();
}
