#[cfg(test)]
mod ajax_tests;
mod bindings;
#[cfg(test)]
mod bindings_tests;
#[cfg(test)]
mod boardy_tests;
#[cfg(test)]
mod concurrency_tests;
mod content;
mod engine;
#[cfg(test)]
mod forest_tests;
pub(crate) const RULES_VERSION: &str = engine::VERSION;
mod full;
mod full_speech;
mod full_store;
#[cfg(test)]
mod full_tests;
mod full_world;
#[cfg(test)]
mod homecoming_tests;
#[cfg(test)]
mod hoppycat_tests;
mod kernel;
mod narrator;
#[cfg(test)]
mod opening_tests;
#[cfg(test)]
mod quest_core_tests;
#[cfg(test)]
mod saved_items;
#[cfg(test)]
mod sea_steps;
#[cfg(test)]
mod section_tests;
#[cfg(test)]
mod speech;
mod store;
mod sync;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod travel_tests;
#[cfg(test)]
mod weather_tests;
#[cfg(test)]
mod willows_tests;

use crate::AppState;
use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
#[cfg(test)]
use kernel::Action;
#[cfg(test)]
use rusqlite::{params, OptionalExtension, TransactionBehavior};
#[cfg(test)]
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::{Arc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use store::{sql_error, Result};
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub(super) fn cast() -> &'static Value {
    static CAST: OnceLock<Value> = OnceLock::new();
    CAST.get_or_init(|| {
        serde_json::from_str(include_str!("../../card-game/shared-cast.json")).expect("shared cast")
    })
}
fn capacity() -> &'static Arc<tokio::sync::Semaphore> {
    static CAP: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    CAP.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
}
pub(super) fn router() -> Router<AppState> {
    full::router()
}

fn reply(r: Result<Value>) -> Response {
    let (status, body) = match r {
        Ok(v) => (StatusCode::OK, v),
        Err(e) => (
            if e == "Sign in with your passkey." {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::CONFLICT
            },
            json!({"error":e}),
        ),
    };
    (
        status,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
        .into_response()
}
fn user(state: &AppState, h: &HeaderMap, mutation: bool) -> Result<String> {
    if mutation {
        // JSON and same-origin requests keep the account cookie out of cross-site commands.
        if h.get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v != "same-origin" && v != "none")
        {
            return Err("Open this world on its own site.".into());
        }
        if let Some(origin) = h.get("origin").and_then(|v| v.to_str().ok()) {
            let url = webauthn_rs::prelude::Url::parse(origin).map_err(sql_error)?;
            let host = h.get("host").and_then(|v| v.to_str().ok()).unwrap_or("");
            let authority = match url.port() {
                Some(p) => format!("{}:{p}", url.host_str().unwrap_or("")),
                None => url.host_str().unwrap_or("").to_string(),
            };
            if authority != host {
                return Err("Open this world on its own site.".into());
            }
        }
    }
    state
        .account_auth
        .authenticated_user_id(h)
        .map_err(sql_error)?
        .ok_or_else(|| "Sign in with your passkey.".into())
}
fn admit(user: &str) -> Result<()> {
    use crate::rate_limit::{RateLimit, RateLimiter};
    use std::{
        sync::Mutex,
        time::{Duration, Instant},
    };
    static LIMITS: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    let mut limits = LIMITS
        .get_or_init(|| Mutex::new(RateLimiter::default()))
        .lock()
        .map_err(sql_error)?;
    if limits.allow(
        format!("shared:{user}"),
        RateLimit {
            max_hits: 120,
            window: Duration::from_secs(60),
        },
        Instant::now(),
    ) {
        Ok(())
    } else {
        Err("Give the table a moment, then try again.".into())
    }
}
fn db(state: &AppState) -> Result<rusqlite::Connection> {
    store::open(
        state
            .event_store_path
            .as_deref()
            .ok_or("Shared worlds need the saved-world service.")?,
    )
}
fn valid_id(id: &str) -> Result<()> {
    if id.len() == 48 && id.bytes().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Open the complete world invitation.".into())
    }
}
#[cfg(test)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    op: String,
    #[serde(default)]
    avatar: i32,
    #[serde(default)]
    kind: i32,
    #[serde(default = "minus_one")]
    item: i32,
    #[serde(default = "minus_one")]
    target: i32,
    #[serde(default)]
    key: String,
}
#[cfg(test)]
fn minus_one() -> i32 {
    -1
}
#[cfg(test)]
fn run_command(
    c: &rusqlite::Connection,
    id: &str,
    u: &str,
    b: &Command,
    time: i64,
) -> Result<Value> {
    let mut w = store::world(c, id)?;
    store::expire(c, id, &mut w, time)?;
    let member = store::member(c, id, u)?;
    if b.op == "claim" {
        if member.is_some() {
            return Err("You already have an avatar in this world.".into());
        }
        if !(0..8).contains(&b.avatar) {
            return Err("Choose one of the eight avatars.".into());
        }
        store::commit(
            c,
            id,
            &mut w,
            Action {
                kind: 1,
                actor: b.avatar,
                item: -1,
                target: -1,
            },
            time,
        )?;
        c.execute(
            "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,?,?)",
            params![id, b.avatar, u, time],
        )
        .map_err(sql_error)?;
        // A claimed place can be full after an earlier owner released the avatar.
        // The claim persists; the entry screen waits for space.
        let mut probe = w.clone();
        let enter = Action {
            kind: 3,
            actor: b.avatar,
            item: -1,
            target: -1,
        };
        if probe.apply(enter).is_ok() {
            store::commit(c, id, &mut w, enter, time)?;
        }
    } else {
        let a = member.ok_or("Choose an avatar to enter this world.")?;
        let action = |kind| Action {
            kind,
            actor: a,
            item: b.item,
            target: b.target,
        };
        match b.op.as_str() {
            "heartbeat" | "enter" => {
                c.execute(
                    "UPDATE card_members SET seen=? WHERE world=? AND actor=?",
                    params![time, id, a],
                )
                .map_err(sql_error)?;
                if w.present[a as usize] == 0 {
                    let enter = action(3);
                    let mut probe = w.clone();
                    if probe.apply(enter).is_ok() {
                        store::commit(c, id, &mut w, enter, time)?;
                    }
                }
            }
            "leave" | "release" => {
                let busy:i32=c.query_row("SELECT count(*) FROM card_plays WHERE world=? AND actor=? AND status='working'",params![id,a],|r|r.get(0)).map_err(sql_error)?;
                if busy > 0 {
                    return Err("Your current play is finishing. Try again in a moment.".into());
                }
                c.execute("UPDATE card_plays SET status='cancelled' WHERE world=? AND actor=? AND status='waiting'",params![id,a]).map_err(sql_error)?;
                store::commit(
                    c,
                    id,
                    &mut w,
                    action(if b.op == "release" { 2 } else { 4 }),
                    time,
                )?;
                if b.op == "release" {
                    c.execute(
                        "DELETE FROM card_members WHERE world=? AND actor=?",
                        params![id, a],
                    )
                    .map_err(sql_error)?;
                } else {
                    c.execute(
                        "UPDATE card_members SET seen=0 WHERE world=? AND actor=?",
                        params![id, a],
                    )
                    .map_err(sql_error)?;
                }
            }
            "play" => {
                if b.key.len() < 16
                    || b.key.len() > 80
                    || !b
                        .key
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                {
                    return Err("Use a fresh play request.".into());
                }
                store::enqueue(c, id, u, &w, action(b.kind), &b.key, time)?;
                c.execute(
                    "UPDATE card_members SET seen=? WHERE world=? AND actor=?",
                    params![time, id, a],
                )
                .map_err(sql_error)?;
            }
            "cancel" => {
                c.execute("UPDATE card_plays SET status='cancelled' WHERE world=? AND user=? AND id=? AND status='waiting'",params![id,u,b.key]).map_err(sql_error)?;
            }
            "nudge" => {
                let t = b.target;
                if !(0..8).contains(&t)
                    || a == t
                    || w.present[a as usize] == 0
                    || w.present[t as usize] == 0
                    || w.places[a as usize] != w.places[t as usize]
                {
                    return Err("Choose someone in this room.".into());
                }
                let last: Option<i64> = c
                    .query_row(
                        "SELECT at FROM card_nudges WHERE world=? AND target=?",
                        params![id, t],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(sql_error)?;
                if last.is_some_and(|last| time - last < 30_000) {
                    return Err("Give them a moment to answer your nudge.".into());
                }
                c.execute("INSERT INTO card_nudges(world,target,sender,at) VALUES(?,?,?,?) ON CONFLICT(world,target) DO UPDATE SET sender=excluded.sender,at=excluded.at",params![id,t,a,time]).map_err(sql_error)?;
            }
            _ => return Err("Choose an available action.".into()),
        }
    }
    store::snapshot(c, id, u, time)
}
#[cfg(test)]
struct Work {
    id: String,
    room: i32,
    context: Value,
}
#[cfg(test)]
fn take_work(state: &AppState, id: &str) -> Result<Option<Work>> {
    let mut c = db(state)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let time = now();
    let mut w = store::world(&tx, id)?;
    store::expire(&tx, id, &mut w, time)?;
    let rows = {
        let mut q=tx.prepare("SELECT id,actor,room,command,user FROM card_plays WHERE world=? AND status='waiting' ORDER BY created,id LIMIT 32").map_err(sql_error)?;
        let rows = q
            .query_map([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i32>(1)?,
                    r.get::<_, i32>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        rows
    };
    for (key, a, room, command, u) in rows {
        let action: Action = serde_json::from_str(&command).map_err(sql_error)?;
        let destination = if action.kind == 5 {
            action.target
        } else {
            room
        };
        let busy:i32=tx.query_row("SELECT count(*) FROM card_plays WHERE world=? AND room IN (?,?) AND status IN ('working','playing')",params![id,room,destination],|r|r.get(0)).map_err(sql_error)?;
        if busy > 0 {
            continue;
        }
        let valid = if store::member(&tx, id, &u)? != Some(a) || w.places[a as usize] != room {
            Err("The scene changed before this play. Choose again.".into())
        } else {
            store::commit(&tx, id, &mut w, action, time)
        };
        if let Err(error) = valid {
            tx.execute(
                "UPDATE card_plays SET status='failed',result=? WHERE id=?",
                params![json!({"error":error}).to_string(), key],
            )
            .map_err(sql_error)?;
            continue;
        }
        let summary = describe(action, &w);
        let context = json!({"play":key,"actor":a,"room":destination,"action":summary,"turn":w.turn,"world":w,"lines":[],"starts_at":time,"until_at":time,"error":null});
        tx.execute(
            "UPDATE card_plays SET status='working',room=?,until_at=?,result=? WHERE id=?",
            params![destination, time + 35_000, context.to_string(), key],
        )
        .map_err(sql_error)?;
        tx.commit().map_err(sql_error)?;
        return Ok(Some(Work {
            id: key,
            room: destination,
            context,
        }));
    }
    tx.commit().map_err(sql_error)?;
    Ok(None)
}
#[cfg(test)]
fn describe(a: Action, w: &kernel::World) -> String {
    let cast = &cast()["avatars"];
    let name = cast[a.actor as usize]["name"].as_str().unwrap();
    let item = cast
        .get(a.item as usize)
        .and_then(|v| v["item"]["name"].as_str())
        .unwrap_or("item");
    let target = cast
        .get(a.target as usize)
        .and_then(|v| v["name"].as_str())
        .unwrap_or("someone");
    match a.kind {
        5 => format!("{name} arrives at {}.", place_name(a.target)),
        6 => format!("{name} picks up the {item}."),
        7 => format!("{name} leaves the {item} here."),
        8 => format!("{name} gives the {item} to {target}."),
        9 if a.item == 0 => format!(
            "{name} {} the lamp.",
            if w.uses[0] % 2 == 1 {
                "lights"
            } else {
                "puts out"
            }
        ),
        9 => format!(
            "{name} {}.",
            cast[a.item as usize]["item"]["effect"].as_str().unwrap()
        ),
        10 => format!("{name} starts a conversation with {target}."),
        _ => format!("{name} takes a quiet moment."),
    }
}
#[cfg(test)]
fn place_name(p: i32) -> String {
    if p == 0 {
        cast()["hub"]["name"].as_str().unwrap().into()
    } else {
        cast()["avatars"][(p - 1) as usize]["home"]["name"]
            .as_str()
            .unwrap()
            .into()
    }
}
#[cfg(test)]
fn finish_work(state: &AppState, id: &str, work: Work, lines: Result<Value>) -> Result<()> {
    let mut c = db(state)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let status: String = tx
        .query_row(
            "SELECT status FROM card_plays WHERE id=?",
            [&work.id],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    if status != "working" {
        return Ok(());
    }
    let time = now();
    let mut scene = work.context;
    // Persist only public scene text and the recorded result in the feed.
    scene.as_object_mut().unwrap().remove("world");
    let ok = lines.is_ok();
    match lines {
        Ok(lines) => scene["lines"] = lines,
        Err(e) => scene["error"] = json!(e),
    }
    scene["starts_at"] = json!(time);
    let duration = if ok {
        scene["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                ((l["text"].as_str().unwrap_or("").chars().count() as i64) * 45 + 1500)
                    .clamp(3500, 9000)
            })
            .sum::<i64>()
    } else {
        2000
    };
    scene["until_at"] = json!(time + duration);
    tx.execute(
        "UPDATE card_plays SET status=?,until_at=?,result=? WHERE id=?",
        params![
            if ok { "playing" } else { "failed" },
            time + duration,
            scene.to_string(),
            work.id
        ],
    )
    .map_err(sql_error)?;
    tx.execute(
        "INSERT INTO card_scenes(world,room,play,content) VALUES(?,?,?,?)",
        params![id, work.room, work.id, scene.to_string()],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)?;
    Ok(())
}
