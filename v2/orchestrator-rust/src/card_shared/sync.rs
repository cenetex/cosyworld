//! A bounded, durable chain of changes to one authenticated player's view.
use super::store::{sql_error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const EVENT_LIMIT: usize = 64;
const BYTE_LIMIT: usize = 512 * 1024;
pub(super) const HEADER: &str = "x-cosyworld-sync";

#[derive(Deserialize, Serialize)]
struct Event {
    sequence: u64,
    previous: String,
    hash: String,
    payload: String,
}
#[derive(Deserialize, Serialize)]
struct Chain {
    stream: String,
    sequence: u64,
    hash: String,
    state: Value,
    events: Vec<Event>,
}
fn hash(stream: &str, sequence: u64, previous: &str, payload: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{stream}\n{sequence}\n{previous}\n{payload}"))
    )
}
fn diff(old: &Value, new: &Value, path: &mut Vec<String>, patches: &mut Vec<Value>) {
    if old == new {
        return;
    }
    match (old, new) {
        (Value::Object(a), Value::Object(b)) => {
            for key in a.keys().filter(|key| !b.contains_key(*key)) {
                path.push(key.clone());
                patches.push(json!({"op":"remove","path":path}));
                path.pop();
            }
            for (key, value) in b {
                path.push(key.clone());
                if let Some(before) = a.get(key) {
                    diff(before, value, path, patches);
                } else {
                    patches.push(json!({"op":"set","path":path,"value":value}));
                }
                path.pop();
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            // Bounded logs trim one end while adding at the other. Keep their
            // shared middle so a full room history sends only the new scenes.
            let shifted = a
                .first()
                .and_then(|first| b.iter().position(|v| v == first))
                .map(|offset| (0, offset))
                .or_else(|| {
                    b.first()
                        .and_then(|first| a.iter().position(|v| v == first))
                        .map(|offset| (offset, 0))
                });
            if let Some((left, right)) = shifted.filter(|(left, right)| left != right) {
                let common = a[left..]
                    .iter()
                    .zip(&b[right..])
                    .take_while(|(a, b)| a == b)
                    .count();
                if common > 0 {
                    patches.push(json!({"op":"splice","path":path,"start":left+common,
                        "delete":a.len()-left-common,"items":&b[right+common..]}));
                    patches.push(json!({"op":"splice","path":path,"start":0,
                        "delete":left,"items":&b[..right]}));
                    return;
                }
            }
            let start = a.iter().zip(b).take_while(|(a, b)| a == b).count();
            let tail = a[start..]
                .iter()
                .rev()
                .zip(b[start..].iter().rev())
                .take_while(|(a, b)| a == b)
                .count();
            patches.push(json!({"op":"splice","path":path,"start":start,
                "delete":a.len()-start-tail,"items":&b[start..b.len()-tail]}));
        }
        _ => patches.push(json!({"op":"set","path":path,"value":new})),
    }
}

// Called inside the same immediate transaction as the view or command.
// Earlier clients keep receiving the ordinary snapshot.
pub(super) fn response(
    c: &Connection,
    id: &str,
    user: &str,
    mut state: Value,
    cursor: Option<&str>,
) -> Result<Value> {
    let Some(cursor) = cursor.filter(|_| state["actor"].is_string()) else {
        return Ok(state);
    };
    c.execute_batch("CREATE TABLE IF NOT EXISTS card_full_sync(world TEXT NOT NULL,user TEXT NOT NULL,chain TEXT NOT NULL,PRIMARY KEY(world,user));")
        .map_err(sql_error)?;
    let time = state
        .as_object_mut()
        .ok_or("The shared view needs attention.")?
        .remove("now")
        .unwrap_or(Value::Null);
    let saved: Option<String> = c
        .query_row(
            "SELECT chain FROM card_full_sync WHERE world=? AND user=?",
            params![id, user],
            |r| r.get(0),
        )
        .optional()
        .map_err(sql_error)?;
    let mut chain = saved
        .as_deref()
        .map(serde_json::from_str::<Chain>)
        .transpose()
        .map_err(sql_error)?;
    let reset = chain
        .as_ref()
        .is_none_or(|chain| chain.state["actor"] != state["actor"]);
    if reset {
        let stream = crate::random_hex(16);
        let digest = hash(&stream, 0, "", &state.to_string());
        chain = Some(Chain {
            stream,
            sequence: 0,
            hash: digest,
            state: state.clone(),
            events: vec![],
        });
    }
    let mut chain = chain.ok_or("The sync chain needs attention.")?;
    let changed = chain.state != state;
    if changed {
        let mut patches = vec![];
        diff(&chain.state, &state, &mut vec![], &mut patches);
        let payload = serde_json::to_string(&patches).map_err(sql_error)?;
        let sequence = chain.sequence + 1;
        let digest = hash(&chain.stream, sequence, &chain.hash, &payload);
        chain.events.push(Event {
            sequence,
            previous: chain.hash,
            hash: digest.clone(),
            payload,
        });
        chain.sequence = sequence;
        chain.hash = digest;
        chain.state = state;
        let mut bytes: usize = chain.events.iter().map(|e| e.payload.len()).sum();
        while chain.events.len() > EVENT_LIMIT || bytes > BYTE_LIMIT {
            bytes -= chain.events.remove(0).payload.len();
        }
    }
    if reset || changed {
        c.execute("INSERT INTO card_full_sync(world,user,chain) VALUES(?,?,?) ON CONFLICT(world,user) DO UPDATE SET chain=excluded.chain", params![id,user,serde_json::to_string(&chain).map_err(sql_error)?]).map_err(sql_error)?;
    }
    let parts: Vec<_> = cursor.split(':').collect();
    let base = if parts.len() == 3 && parts[0] == chain.stream {
        parts[1].parse::<u64>().ok().filter(|sequence| {
            (*sequence == chain.sequence && parts[2] == chain.hash)
                || chain.events.iter().any(|e| {
                    (e.sequence == *sequence && e.hash == parts[2])
                        || (e.sequence == sequence.saturating_add(1) && e.previous == parts[2])
                })
        })
    } else {
        None
    };
    let sync = json!({"stream":chain.stream,"sequence":chain.sequence,"hash":chain.hash});
    if let Some(base) = base {
        Ok(
            json!({"sync": {"kind":"events","head":sync,"from":cursor},"now":time,
            "events":chain.events.iter().filter(|e| e.sequence > base).collect::<Vec<_>>()}),
        )
    } else {
        let mut snapshot = chain.state;
        snapshot["now"] = time;
        Ok(json!({"sync":{"kind":"snapshot","head":sync},"state":snapshot}))
    }
}

#[cfg(test)]
mod tests;
