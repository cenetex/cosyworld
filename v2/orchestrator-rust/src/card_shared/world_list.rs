//! What the passkey's world list shows of each world beyond its seats: who
//! is online in each seat now, and each human avatar's level there, so the
//! ☰ menu can colour and describe seats in worlds it is not playing
//! (avatar-menu.md). Read only: no journal, rule or checkpoint writes.
use super::{
    full_world::actor_id,
    store::{sql_error, Result},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

// A member is online while its heartbeat is newer than the expiry window
// `full_store::expire` uses; leaving sets `seen` to 0.
const ONLINE_MS: i64 = 60_000;

pub(super) fn decorate(c: &Connection, row: &mut Value, now: i64) -> Result<()> {
    let id = row["id"].as_str().unwrap_or_default().to_string();
    let mut online = [0; 8];
    let mut q = c
        .prepare("SELECT actor FROM card_members WHERE world=? AND seen>=?")
        .map_err(sql_error)?;
    for a in q
        .query_map(params![id, now - ONLINE_MS], |r| r.get::<_, usize>(0))
        .map_err(sql_error)?
    {
        if let Some(seat) = online.get_mut(a.map_err(sql_error)?) {
            *seat = 1;
        }
    }
    row["online"] = json!(online);
    // Level and experience from the last checkpoint; the client turns them
    // into a level with the rules' own `levelOf`.
    let state: Option<String> = c
        .query_row(
            "SELECT json_extract(state,'$.game.actors') FROM card_full_checkpoints WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .optional()
        .map_err(sql_error)?
        .flatten();
    let actors: Value = state
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let mut levels = serde_json::Map::new();
    for a in 0..8 {
        let id = actor_id(a);
        let actor = &actors[id];
        if actor.is_object() {
            let mut entry = serde_json::Map::new();
            for key in ["level", "xp"] {
                if actor[key].is_number() {
                    entry.insert(key.into(), actor[key].clone());
                }
            }
            levels.insert(id.into(), Value::Object(entry));
        }
    }
    row["actors"] = Value::Object(levels);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_marks_online_seats_and_carries_levels() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT,actor INTEGER,user TEXT,seen INTEGER);
             CREATE TABLE card_full_checkpoints(world TEXT PRIMARY KEY,seq INTEGER,state TEXT);",
        )
        .unwrap();
        let (vale, mara) = (actor_id(3), actor_id(4));
        c.execute(
            "INSERT INTO card_members VALUES('w',3,'a',?),('w',4,'b',?),('w',5,'c',0)",
            params![200_000, 100_000],
        )
        .unwrap();
        let state =
            json!({"game":{"actors":{vale:{"level":3,"xp":4},mara:{"xp":1},"moth":{"xp":9}}}});
        c.execute(
            "INSERT INTO card_full_checkpoints VALUES('w',1,?)",
            [state.to_string()],
        )
        .unwrap();
        let mut row = json!({"id":"w"});
        decorate(&c, &mut row, 200_500).unwrap();
        assert_eq!(row["online"], json!([0, 0, 0, 1, 0, 0, 0, 0]));
        assert_eq!(row["actors"][vale], json!({"level":3,"xp":4}));
        assert_eq!(row["actors"][mara], json!({"xp":1}));
        assert!(row["actors"]["moth"].is_null());
        let mut empty = json!({"id":"none"});
        decorate(&c, &mut empty, 200_500).unwrap();
        assert_eq!(empty["online"], json!([0, 0, 0, 0, 0, 0, 0, 0]));
        assert_eq!(empty["actors"], json!({}));
    }
}
