//! Multiplayer extends the existing authored card world and save format.
use super::bindings;
use super::full_floor as floor;
use super::unlocks;
use super::{
    admit, capacity, db, full_store as store,
    full_world::{actor_id, actor_index, World},
    now, reply,
    store::{sql_error, Result},
    user, valid_id,
};
use crate::routes::card_game::narrative::{imported, voice_scenes};
use crate::AppState;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::HeaderMap,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, Weak},
    time::{Duration, Instant},
};
#[path = "full_browser.rs"]
mod browser;
#[path = "full_continue.rs"]
mod continuation;
#[path = "full_dedupe.rs"]
mod dedupe;
#[path = "full_opening.rs"]
mod opening;
#[path = "full_reflect.rs"]
pub(super) mod reflect;
#[path = "full_retire.rs"]
mod retire;
#[cfg(test)]
#[path = "revision_tests.rs"]
mod revision_tests;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/card-game/shared/worlds",
            get(list)
                .post(create)
                .layer(DefaultBodyLimit::max(2 * 1024 * 1024)),
        )
        .route("/card-game/shared/worlds/{id}", get(view))
        .route(
            "/card-game/shared/worlds/{id}/browser-chat",
            post(browser::chat).layer(DefaultBodyLimit::max(64 * 1024)),
        )
        .route(
            "/card-game/shared/worlds/{id}/command",
            post(command).layer(DefaultBodyLimit::max(8192)),
        )
        .route(
            "/card-game/shared/worlds/{id}/talk",
            post(talk).layer(DefaultBodyLimit::max(8192)),
        )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    #[serde(default)]
    save: Option<String>,
    // The envelopes of the save's server-written words (signed-words.mjs).
    #[serde(default)]
    signed: Vec<crate::routes::signed_envelope::Envelope>,
    // The avatar the host shares as. `move` is accepted from older clients;
    // every claim now leaves the avatar's other worlds (#1846).
    #[serde(default)]
    avatar: Option<String>,
    #[serde(default, rename = "move")]
    #[allow(dead_code)]
    moving: bool,
}
async fn blocking(f: impl FnOnce() -> Result<Value> + Send + 'static) -> Result<Value> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| "The shared world is taking a moment.".to_string())?
}
// SQLite has one write lock per database file. Shared-world writes take
// turns here first, so they wait in line in this process instead of racing
// each other on the five-second busy timeout ("database is locked", #1364).
fn writer(state: &AppState) -> Arc<Mutex<()>> {
    static WRITERS: OnceLock<Mutex<HashMap<std::path::PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let path = state
        .event_store_path
        .as_deref()
        .cloned()
        .unwrap_or_default();
    let mut writers = WRITERS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if let Some(gate) = writers.get(&path).and_then(Weak::upgrade) {
        return gate;
    }
    writers.retain(|_, gate| gate.strong_count() > 0);
    let gate = Arc::new(Mutex::new(()));
    writers.insert(path, Arc::downgrade(&gate));
    gate
}
fn turn(gate: &Mutex<()>) -> MutexGuard<'_, ()> {
    gate.lock().unwrap_or_else(PoisonError::into_inner)
}
// Run one write in the world's turn. Tests that stand in for the clock or an
// operator write through this, like every shared-world writer.
#[cfg(test)]
pub(super) fn in_write_turn<T>(state: &AppState, f: impl FnOnce() -> T) -> T {
    let gate = writer(state);
    let _turn = turn(&gate);
    f()
}
async fn list(State(state): State<AppState>, h: HeaderMap) -> Response {
    reply(
        blocking(move || {
            let u = user(&state, &h, false)?;
            let mut c = db(&state)?;
            // Worlds on rules older than the floor retire first, keeping the
            // passkey's avatar levels (full_floor.rs).
            store::schema(&c)?;
            if floor::pending(&c, &u)? {
                if let Err(error) = tidy(&state, &mut c, |tx| floor::sweep(tx, &u, now())) {
                    tracing::warn!(%error, "old worlds kept for now");
                }
            }
            if dedupe::pending(&c, &u)? {
                if let Err(error) = tidy(&state, &mut c, |tx| dedupe::run(tx, &u, now())) {
                    tracing::warn!(%error, "duplicate avatar seats kept for now");
                }
            }
            if !retire::pending(&c, &u)?.is_empty() {
                if let Err(error) = tidy(&state, &mut c, |tx| retire::sweep(tx, &u, now())) {
                    tracing::warn!(%error, "empty worlds kept for now");
                }
            }
            let mut value = super::store::list(&c, &u)?;
            // The avatars this passkey has found (#1936).
            value["unlocked"] = unlocks::ids(&c, &u)?;
            let time = now();
            for row in value["worlds"]
                .as_array_mut()
                .ok_or("The world list needs a moment.")?
            {
                // The run seed names the world in the menu (avatar-menu.md).
                let id = row["id"].as_str().unwrap_or_default().to_string();
                row["seed"] = json!(store::name_seed(&c, &id)?);
                super::world_list::decorate(&c, row, time)?;
                for key in ["actor", "bound"] {
                    if let Some(a) = row[key].as_u64().filter(|a| *a < 8) {
                        row[key] = json!(actor_id(a as usize));
                    }
                }
            }
            Ok(value)
        })
        .await,
    )
}
// The passkey's next list empties legacy duplicate seats (full_dedupe.rs)
// and retires its empty worlds (full_retire.rs), each in one transaction.
fn tidy(
    state: &AppState,
    c: &mut rusqlite::Connection,
    f: impl FnOnce(&rusqlite::Connection) -> Result<usize>,
) -> Result<()> {
    store::schema(c)?;
    let gate = writer(state);
    let _turn = turn(&gate);
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    f(&tx)?;
    tx.commit().map_err(sql_error)
}
async fn create(State(state): State<AppState>, h: HeaderMap, Json(body): Json<Create>) -> Response {
    let result = blocking(move || {
        let revision = super::revision(&state, &h)?;
        let u = revision.user.clone();
        admit(&u)?;
        let mut c = db(&state)?;
        store::schema(&c)?;
        // An imported save keeps only text the server can vouch for (#2067),
        // checked before the world's writer is held.
        let save = body
            .save
            .as_deref()
            .map(|save| {
                imported::trusted_save(save, &body.signed, vocabulary(), |s| {
                    World::hiding(Some(s), None, &Value::Null).is_ok()
                })
            })
            .transpose()?;
        let gate = writer(&state);
        let _turn = turn(&gate);
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        revision.check(&tx).map_err(|error| error.to_string())?;
        let a = actor_index(body.avatar.as_deref().unwrap_or("vale"))?;
        let id = found(&tx, &u, a, save.as_deref(), now())?;
        tx.commit().map_err(sql_error)?;
        Ok(json!({"id":id}))
    })
    .await;
    reply(result)
}
/// The words the current rules and packs use, for imported saves.
pub(super) fn vocabulary() -> &'static imported::Vocabulary {
    static WORDS: OnceLock<imported::Vocabulary> = OnceLock::new();
    WORDS.get_or_init(|| {
        imported::Vocabulary::new(
            &[super::engine::current_source()],
            super::content::current_text(),
        )
    })
}
// A new world for one of the passkey's unlocked avatars. A fresh one hides
// one of its still-locked avatars (unlocks.rs).
pub(super) fn found(
    tx: &rusqlite::Connection,
    u: &str,
    a: usize,
    save: Option<&str>,
    time: i64,
) -> Result<String> {
    unlocks::require(tx, u, a)?;
    let id = crate::random_hex(24);
    let seed = super::full_world::run_seed(&id);
    leave_elsewhere(tx, &id, u, a, time)?;
    let mut hide = match save {
        None => unlocks::pick(tx, u, &id, a)?,
        Some(_) => Value::Null,
    };
    if save.is_none() && actor_id(a) != "vale" {
        hide["homecoming"] = json!(actor_id(a));
    }
    let mut w = World::hiding(save, Some(seed), &hide)?;
    super::store::create(tx, &id, u, time)?;
    store::seed(tx, &id, &w, "share-existing-card-world", time)?;
    let claim = claim_command(tx, &w, u, a)?;
    store::commit(tx, &id, &mut w, claim, time)?;
    store::commit(
        tx,
        &id,
        &mut w,
        json!({"op":"enter","actor":actor_id(a)}),
        time,
    )?;
    tx.execute(
        "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,?,?)",
        params![id, a, u, time],
    )
    .map_err(sql_error)?;
    bindings::claim(tx, &id, u, a)?;
    opening::enqueue(tx, &id, u, &w, a, time)?;
    Ok(id)
}
async fn view(State(state): State<AppState>, Path(id): Path<String>, h: HeaderMap) -> Response {
    let worker = state.clone();
    let wid = id.clone();
    let result = blocking(move || {
        let state = worker;
        let id = wid;
        valid_id(&id)?;
        let u = user(&state, &h, false)?;
        admit(&u)?;
        logged(&id, || {
            view_as(
                &state,
                &id,
                &u,
                h.get(super::sync::HEADER).and_then(|v| v.to_str().ok()),
            )
        })
    })
    .await;
    if result.as_ref().is_ok_and(|v: &Value| {
        v["actor"].is_string() || v["state"]["actor"].is_string() || v["sync"]["kind"] == "events"
    }) {
        kick(state, id);
    }
    reply(result)
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Command {
    pub op: String,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub action: Value,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub revealed: Option<Vec<String>>,
    // Accepted from older clients; every claim now leaves the avatar's other
    // worlds (#1846).
    #[serde(default, rename = "move")]
    #[allow(dead_code)]
    pub moving: bool,
    /// Which surface played this (`browser` | `discord`), for the journal and
    /// the corpus. The browser never sends it, so it defaults to `browser`.
    #[serde(default = "default_surface")]
    pub surface: String,
}

fn default_surface() -> String {
    "browser".to_string()
}

/// A client-agnostic Talk: the gateway (or any non-browser client) names a
/// target resident and this endpoint owns the play encoding, the key, and the
/// claimed-avatar resolution. The human's own line (`text`) arrives in the
/// next slice; this slice commits the talk play and returns the snapshot.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Talk {
    #[serde(default)]
    pub(super) avatar: Option<String>,
    pub(super) target: String,
}
async fn command(
    State(state): State<AppState>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(body): Json<Command>,
) -> Response {
    let worker = state.clone();
    let wid = id.clone();
    let result = blocking(move || {
        let state = worker;
        let id = wid;
        valid_id(&id)?;
        let revision = super::revision(&state, &h)?;
        let u = revision.user.clone();
        admit(&u)?;
        logged(&id, || {
            command_with_revision(
                &state,
                &id,
                &revision,
                &body,
                h.get(super::sync::HEADER).and_then(|v| v.to_str().ok()),
            )
        })
    })
    .await;
    if result.is_ok() {
        kick(state, id);
    }
    reply(result)
}
// A refused world names itself and the rules' reason, which says where a
// save failed validation, so a 409 is diagnosable from the host log. Only the
// world ID and rule text are logged.
fn logged(id: &str, f: impl FnOnce() -> Result<Value>) -> Result<Value> {
    let result = f();
    if let Err(error) = &result {
        tracing::warn!(world = %id, %error, "shared world request refused");
    }
    result
}
// The signed-in viewer's snapshot. Expiry and the sync chain write, so the
// view takes the world's write turn.
pub(super) fn view_as(state: &AppState, id: &str, u: &str, cursor: Option<&str>) -> Result<Value> {
    let mut c = db(state)?;
    store::schema(&c)?;
    let gate = writer(state);
    let _turn = turn(&gate);
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let time = now();
    retire::open(&tx, id)?;
    let mut w = store::world(&tx, id, time)?;
    store::expire(&tx, id, &mut w, time)?;
    let value = store::snapshot(&tx, id, u, time)?;
    let value = super::sync::response(&tx, id, u, value, cursor)?;
    tx.commit().map_err(sql_error)?;
    Ok(value)
}
#[cfg(test)]
pub(super) fn command_as(
    state: &AppState,
    id: &str,
    u: &str,
    body: &Command,
    cursor: Option<&str>,
) -> Result<Value> {
    let c = db(state)?;
    let revision = crate::account_revision::Revision {
        user: u.into(),
        epoch: crate::account_revision::current(&c, u).map_err(sql_error)?,
    };
    command_with_revision(state, id, &revision, body, cursor)
}
fn command_with_revision(
    state: &AppState,
    id: &str,
    revision: &crate::account_revision::Revision,
    body: &Command,
    cursor: Option<&str>,
) -> Result<Value> {
    let u = &revision.user;
    let mut c = db(state)?;
    store::schema(&c)?;
    let gate = writer(state);
    let _turn = turn(&gate);
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    revision.check(&tx).map_err(|error| error.to_string())?;
    let value = run(&tx, id, u, body, now())?;
    let value = super::sync::response(&tx, id, u, value, cursor)?;
    tx.commit().map_err(sql_error)?;
    Ok(value)
}

async fn talk(
    State(state): State<AppState>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(body): Json<Talk>,
) -> Response {
    let h2 = h.clone();
    let worker = state.clone();
    let wid = id.clone();
    let committed = blocking(move || {
        let state = worker;
        let id = wid;
        valid_id(&id)?;
        let u = user(&state, &h, true)?;
        admit(&u)?;
        logged(&id, || talk_as(&state, &id, &u, &body))
    })
    .await;
    if committed.is_err() {
        return reply(committed);
    }
    // Voice the talk inline, then return the view with the fresh lines.
    let _ = voice_once(&state, &id).await;
    let worker = state.clone();
    let wid = id.clone();
    let view = blocking(move || {
        let state = worker;
        let id = wid;
        let u = user(&state, &h2, false)?;
        view_as(&state, &id, &u, None)
    })
    .await;
    reply(view)
}

pub(super) fn talk_as(state: &AppState, id: &str, u: &str, body: &Talk) -> Result<Value> {
    let c = db(state)?;
    store::schema(&c)?;
    let actor = match body.avatar.as_deref() {
        Some(avatar) => actor_index(avatar)?,
        None => bindings::mine(&c, id, u)?.ok_or("Claim an avatar first.")?,
    };
    if body.target.trim().is_empty() {
        return Err("Choose someone to talk to.".into());
    }
    // The engine accepts only the exact legal action object for this actor's
    // current state, so look it up rather than authoring one by hand.
    let world = store::world(&c, id, now())?;
    let view = world.project(actor)?;
    let action = view["actions"]
        .as_array()
        .and_then(|actions| {
            actions
                .iter()
                .find(|action| action["kind"] == "talk" && action["target"] == body.target)
                .cloned()
        })
        .ok_or("Choose someone here to talk to.")?;
    let command = Command {
        op: "play".to_string(),
        avatar: Some(actor_id(actor).to_string()),
        action,
        target: Some(body.target.clone()),
        key: format!("talk-{}", crate::random_hex(24)),
        revealed: None,
        moving: false,
        surface: "discord".to_string(),
    };
    command_as(state, id, u, &command, None)
}
// Leaving keeps the claim; releasing frees the avatar for someone else.
fn leave(
    c: &rusqlite::Connection,
    id: &str,
    w: &mut World,
    a: usize,
    op: &str,
    time: i64,
) -> Result<()> {
    let busy: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_plays WHERE world=? AND actor=? AND status='working'",
            params![id, a],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    if busy > 0 {
        return Err("Your current play is finishing. Try again in a moment.".into());
    }
    c.execute("UPDATE card_full_plays SET status='cancelled' WHERE world=? AND actor=? AND status IN ('waiting','retry')",params![id,a]).map_err(sql_error)?;
    store::commit(c, id, w, json!({"op":op,"actor":actor_id(a)}), time)?;
    if op == "release" {
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
    Ok(())
}
// The world's owner frees an avatar, or its holder releases it: it starts
// over as a fresh starter, what it held stays where it stood, and its place
// is free for anyone (#1825).
fn reset(
    c: &rusqlite::Connection,
    id: &str,
    u: &str,
    w: &mut World,
    b: &Command,
    time: i64,
) -> Result<Value> {
    let mine = bindings::mine(c, id, u)?;
    let a = match b.avatar.as_deref() {
        Some(avatar) => actor_index(avatar)?,
        None => mine.ok_or("Choose an avatar.")?,
    };
    if mine != Some(a) && !bindings::owner(c, id, u)? {
        return Err("Only this world's owner can free an avatar.".into());
    }
    vacate(c, id, w, a, time)?;
    retire::if_empty(c, id, u, time)?;
    store::snapshot(c, id, u, time)
}
// A seat empties: it starts over for whoever takes that avatar here next,
// what the avatar held stays where it stood, and its holder keeps its level
// for the avatar's next seat (#1846).
fn vacate(c: &rusqlite::Connection, id: &str, w: &mut World, a: usize, time: i64) -> Result<()> {
    let busy: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_plays WHERE world=? AND actor=? AND status IN ('working','playing')",
            params![id, a],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    if busy > 0 {
        return Err("That avatar's play is finishing. Try again in a moment.".into());
    }
    c.execute("UPDATE card_full_plays SET status='cancelled' WHERE world=? AND actor=? AND status IN ('waiting','retry')",params![id,a]).map_err(sql_error)?;
    let holder = bindings::holder(c, id, a)?;
    let progress = bindings::progress_of(&w.game, actor_id(a));
    store::commit(c, id, w, json!({"op":"reset","actor":actor_id(a)}), time)?;
    if let Some(holder) = holder {
        bindings::save_progress(c, &holder, a, &progress)?;
    }
    bindings::free(c, id, a)
}
// Any found avatar may come to a world this passkey has played (owner,
// 2026-11-03). The avatar it had there stays as a resident: a journaled
// release, no reset, so it keeps its state and level there, and its binding
// goes. Its level also goes with the passkey to that avatar's next seat
// (#1846). Refused before anything is journaled.
fn hand_over(
    c: &rusqlite::Connection,
    id: &str,
    u: &str,
    w: &mut World,
    old: usize,
    a: usize,
    time: i64,
) -> Result<()> {
    if w.claimed[a] == 1 || bindings::holder(c, id, a)?.is_some() {
        return Err("That avatar belongs to someone else in this world.".into());
    }
    if w.claimed[old] == 1 {
        leave(c, id, w, old, "release", time)?;
    }
    let progress = bindings::progress_of(&w.game, actor_id(old));
    bindings::save_progress(c, u, old, &progress)?;
    bindings::free(c, id, old)
}
// An avatar is in one world at a time (#1846): a claim empties its seats in
// every other world, in the same transaction, and takes its level along.
// Loading upgrades earlier rules first. A busy seat keeps its claim and
// progress until the move can reset it in this same transaction.
fn leave_elsewhere(c: &rusqlite::Connection, id: &str, u: &str, a: usize, time: i64) -> Result<()> {
    for other in bindings::seats_elsewhere(c, id, u, a)? {
        // A world on rules older than the floor retires instead of opening.
        if floor::retire(c, &other, time)? {
            continue;
        }
        let mut w = store::world(c, &other, time)?;
        store::expire(c, &other, &mut w, time)?;
        vacate(c, &other, &mut w, a, time)?;
        retire::if_empty(c, &other, u, time)?;
    }
    Ok(())
}
// The claim command, with the avatar's level from its last seat when these
// rules can take it.
fn claim_command(c: &rusqlite::Connection, w: &World, u: &str, a: usize) -> Result<Value> {
    let mut command = json!({"op":"claim","actor":actor_id(a)});
    if bindings::carries_progress(&w.version) {
        if let Some(progress) = bindings::take_progress(c, u, a)? {
            command["progress"] = progress;
        }
    }
    if bindings::carries_upgrades(&w.version) {
        let upgrades = bindings::upgrades(c, u, a)?;
        if !upgrades.is_empty() {
            if command["progress"].is_null() {
                command["progress"] = json!({});
            }
            command["progress"]["upgrades"] = json!(upgrades);
        }
    }
    Ok(command)
}
pub(super) fn run(
    c: &rusqlite::Connection,
    id: &str,
    u: &str,
    b: &Command,
    time: i64,
) -> Result<Value> {
    retire::open(c, id)?;
    let mut w = store::world(c, id, time)?;
    store::expire(c, id, &mut w, time)?;
    let member = super::store::member(c, id, u)?;
    if b.op == "reset" {
        return reset(c, id, u, &mut w, b, time);
    }
    if b.op == "claim" {
        let a = actor_index(b.avatar.as_deref().ok_or("Choose an avatar.")?)?;
        unlocks::require(c, u, a)?;
        let seated = member.and_then(|m| usize::try_from(m).ok());
        match seated.or(bindings::mine(c, id, u)?) {
            Some(old) if old != a => hand_over(c, id, u, &mut w, old, a, time)?,
            Some(_) if seated.is_some() => {
                return Err("You already have an avatar in this world.".into())
            }
            _ => {}
        }
        bindings::claim(c, id, u, a)?;
        leave_elsewhere(c, id, u, a, time)?;
        let claim = claim_command(c, &w, u, a)?;
        store::commit(c, id, &mut w, claim, time)?;
        c.execute(
            "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,?,?)",
            params![id, a, u, time],
        )
        .map_err(sql_error)?;
        let enter = json!({"op":"enter","actor":actor_id(a)});
        if w.clone().apply(&enter).is_ok() {
            store::commit(c, id, &mut w, enter, time)?;
        }
    } else {
        let a = member
            .and_then(|a| usize::try_from(a).ok())
            .filter(|a| *a < 8)
            .ok_or("Choose an avatar to enter this world.")?;
        match b.op.as_str() {
            "heartbeat" | "enter" => {
                c.execute(
                    "UPDATE card_members SET seen=? WHERE world=? AND actor=?",
                    params![time, id, a],
                )
                .map_err(sql_error)?;
                if w.present[a] == 0 {
                    let cmd = json!({"op":"enter","actor":actor_id(a)});
                    if w.clone().apply(&cmd).is_ok() {
                        store::commit(c, id, &mut w, cmd, time)?;
                    }
                }
                if b.op == "enter" {
                    opening::resume(c, id, &w, a)?;
                }
            }
            "leave" => leave(c, id, &mut w, a, &b.op, time)?,
            "release" => {
                leave(c, id, &mut w, a, &b.op, time)?;
                retire::if_empty(c, id, u, time)?;
            }
            "hold" => {
                // A card choice is journaled immediately, without a speech
                // job or an NPC turn. The reducer checks its saved revision.
                store::commit(
                    c,
                    id,
                    &mut w,
                    json!({"op":"hold","actor":actor_id(a),"choice":b.action}),
                    time,
                )?;
            }
            "play" => {
                if b.key.len() < 16
                    || b.key.len() > 80
                    || !b
                        .key
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                {
                    return Err("Use a fresh play request.".into());
                }
                if b.action
                    .get("actor")
                    .is_some_and(|v| v.as_str() != Some(actor_id(a)))
                    || b.action.get("actorId").is_some()
                    || b.action.get("world").is_some()
                    || b.action.get("outcome").is_some()
                {
                    return Err("Play a card for your claimed avatar.".into());
                }
                store::enqueue(
                    c,
                    id,
                    u,
                    &w,
                    a,
                    store::PlayRequest {
                        action: b.action.clone(),
                        key: &b.key,
                        revealed: b.revealed.as_deref(),
                        surface: &b.surface,
                    },
                    time,
                )?;
                c.execute(
                    "UPDATE card_members SET seen=? WHERE world=? AND actor=?",
                    params![time, id, a],
                )
                .map_err(sql_error)?;
            }
            "cancel" => {
                c.execute("UPDATE card_full_plays SET status='cancelled' WHERE world=? AND user=? AND id=? AND status IN ('waiting','retry')",params![id,u,b.key]).map_err(sql_error)?;
            }
            "nudge" => {
                let t = actor_index(b.target.as_deref().ok_or("Choose someone here.")?)?;
                if a == t || w.present[a] == 0 || w.present[t] == 0 || w.room(a)? != w.room(t)? {
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
#[derive(Clone)]
pub(super) struct Work {
    pub id: String,
    pub room: String,
    pub actor: usize,
    pub context: Value,
    attempt: i32,
    revision: crate::account_revision::Revision,
}
pub(super) fn take_work(state: &AppState, id: &str) -> Result<Option<Work>> {
    let mut c = db(state)?;
    store::schema(&c)?;
    let gate = writer(state);
    let _turn = turn(&gate);
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let time = now();
    // Resume an older browser-funded scene through the server. Fence its old reply.
    tx.execute(
        "UPDATE card_full_plays SET status='retry',retries=retries+1,narrative=json_set(narrative,'$.browser_chat',json('false')) WHERE world=? AND status='working' AND json_extract(narrative,'$.browser_chat')=1",
        [id],
    ).map_err(sql_error)?;
    let mut w = store::world(&tx, id, time)?;
    store::expire(&tx, id, &mut w, time)?;
    // The authored world advances NPCs across rooms each turn. Serialize the
    // entire world's turn and speech so every room sees one coherent result.
    let busy:i32=tx.query_row("SELECT count(*) FROM card_full_plays WHERE world=? AND status IN ('working','playing')",[id],|r|r.get(0)).map_err(sql_error)?;
    if busy > 0 {
        tx.commit().map_err(sql_error)?;
        return Ok(None);
    }
    let rows = {
        let mut q=tx.prepare("SELECT id,actor,room,command,user,status,narrative,retries FROM card_full_plays WHERE world=? AND status IN ('waiting','retry') ORDER BY created,CASE WHEN json_extract(narrative,'$.opening')=1 THEN 0 ELSE 1 END,id LIMIT 32").map_err(sql_error)?;
        let rows = q
            .query_map([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, usize>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, i32>(7)?,
                ))
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        rows
    };
    for (key, a, room, text, u, status, narrative, attempt) in rows {
        let retry = status == "retry";
        let prior: Value = serde_json::from_str(&narrative).map_err(sql_error)?;
        let mut action: Value = serde_json::from_str(&text).map_err(sql_error)?;
        let revealed = store::take_revealed(&mut action);
        let valid = if a >= 8
            || super::store::member(&tx, id, &u)? != Some(a as i32)
            || w.room(a)? != room
        {
            Err("The scene changed before this play. Choose again.".into())
        } else if retry {
            if w.present[a] != 1 || prior["turn"] != w.game["turn"] || !prior["context"].is_object()
            {
                Err("The scene has moved on. Play a card for a fresh exchange.".into())
            } else {
                Ok(prior.clone())
            }
        } else {
            store::commit_with_reveal(&tx, id, &mut w, action, revealed, time)
        };
        let result = match valid {
            Ok(v) => v,
            Err(e) => {
                tx.execute(
                    "UPDATE card_full_plays SET status='failed',result=? WHERE id=?",
                    params![json!({"error":e}).to_string(), key],
                )
                .map_err(sql_error)?;
                continue;
            }
        };
        let destination = w.room(a)?.to_string();
        let mut context = if retry {
            continuation::context(&tx, &w, &key, a, &prior)?
        } else {
            json!({"play":key,"actor":actor_id(a),"room":destination,"turn":w.game["turn"],"context":result["context"],"profiles":result["profiles"],"events":result["events"],"lines":[],"starts_at":time,"until_at":time,"error":null,"browser_chat":false})
        };
        context["browser_chat"] = json!(false);
        context["hold_seq"] = json!(continuation::hold_seq(&tx, id)?);
        tx.execute(
            "UPDATE card_full_plays SET status='working',room=?,until_at=?,result=?,narrative=? WHERE id=?",
            params![destination, time + 60_000, context.to_string(), context.to_string(), key],
        )
        .map_err(sql_error)?;
        let revision = crate::account_revision::Revision {
            user: u.clone(),
            epoch: crate::account_revision::current(&tx, &u).map_err(sql_error)?,
        };
        tx.commit().map_err(sql_error)?;
        return Ok(Some(Work {
            id: key,
            room: destination,
            actor: a,
            context,
            attempt,
            revision,
        }));
    }
    tx.commit().map_err(sql_error)?;
    Ok(None)
}
fn kick(state: AppState, id: String) {
    let Ok(permit) = capacity().clone().try_acquire_owned() else {
        return;
    };
    tokio::spawn(async move {
        let _permit = permit;
        while voice_once(&state, &id).await.unwrap_or(false) {}
    });
}

/// One voice pass: commits the next waiting play, voices its residents, and
/// journals the lines. Returns Ok(true) when it voiced a play, Ok(false) when
/// there was no waiting play, and Err when publication failed. `kick` loops
/// it; the synchronous `/talk` endpoint awaits it once.
async fn voice_once(state: &AppState, id: &str) -> Result<bool> {
    let s = state.clone();
    let wid = id.to_string();
    let work = tokio::task::spawn_blocking(move || take_work(&s, &wid)).await;
    let Ok(Ok(Some(work))) = work else {
        return Ok(false);
    };
    reflect::replace(id, work.actor);
    let lines = super::full_speech::generate(state, work.actor, &work.context).await;
    let s = state.clone();
    let wid = id.to_string();
    let after = lines
        .as_ref()
        .ok()
        .cloned()
        .map(|lines| (work.clone(), lines));
    match tokio::task::spawn_blocking(move || publish(&s, &wid, work, lines)).await {
        Ok(Ok(published)) => {
            if published {
                if let Some((work, lines)) = after {
                    reflect::spawn(state.clone(), id.to_string(), work, &lines);
                }
            }
            Ok(true)
        }
        other => {
            tracing::warn!(result=?other, "shared card publication failed");
            Err("shared card publication failed".into())
        }
    }
}
/// Journals the words. Words the rules refuse end like words that never
/// came: the play's voices show "…" and its seat frees at once.
pub(super) fn publish(
    state: &AppState,
    id: &str,
    work: Work,
    lines: Result<Value>,
) -> Result<bool> {
    let refused = lines.is_ok().then(|| work.clone());
    match (finish_work(state, id, work, lines), refused) {
        (Err(error), Some(work)) => {
            tracing::warn!(%error, "shared card words refused by the rules");
            voice_scenes::shared("refused", 0);
            finish_work(state, id, work, Err(error))
        }
        (result, _) => result,
    }
}
pub(super) fn finish_work(
    state: &AppState,
    id: &str,
    work: Work,
    lines: Result<Value>,
) -> Result<bool> {
    finish_work_with_lock_budget(state, id, work, lines, Duration::from_secs(8))
}

// The provider has already finished. Keep those exact words while short-lived
// poll transactions release the database, then fence this attempt again.
pub(super) fn finish_work_with_lock_budget(
    state: &AppState,
    id: &str,
    work: Work,
    lines: Result<Value>,
    budget: Duration,
) -> Result<bool> {
    let started = Instant::now();
    let gate = writer(state);
    let _turn = turn(&gate);
    loop {
        let remaining = budget.saturating_sub(started.elapsed());
        match finish_work_attempt(
            state,
            id,
            &work,
            &lines,
            remaining.min(Duration::from_millis(100)),
        ) {
            Ok(result) => return result,
            Err(error) => {
                let busy = matches!(&error, rusqlite::Error::SqliteFailure(failure, _)
                    if matches!(failure.code, rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked));
                let remaining = budget.saturating_sub(started.elapsed());
                if !busy || remaining.is_zero() {
                    return Err(sql_error(error));
                }
                std::thread::sleep(remaining.min(Duration::from_millis(25)));
            }
        }
    }
}

fn finish_work_attempt(
    state: &AppState,
    id: &str,
    work: &Work,
    lines: &Result<Value>,
    busy_timeout: Duration,
) -> rusqlite::Result<Result<bool>> {
    let Some(path) = state.event_store_path.as_deref() else {
        return Ok(Err("Shared worlds need the saved-world service.".into()));
    };
    let mut c = super::store::open_sqlite(path, busy_timeout)?;
    store::schema_sqlite(&c)?;
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.busy_timeout(Duration::from_secs(5))?;
    Ok((|| -> Result<bool> {
        let (status, attempt): (String, i32) = tx
            .query_row(
                "SELECT status,retries FROM card_full_plays WHERE id=?",
                [&work.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(sql_error)?;
        if status != "working" || attempt != work.attempt {
            return Ok(false);
        }
        work.revision
            .check(&tx)
            .map_err(|error| error.to_string())?;
        let time = now();
        if continuation::refresh(&tx, id, work, time)? {
            tx.commit().map_err(sql_error)?;
            return Ok(false);
        }
        let mut scene = work.context.clone();
        // A scene without lines follows its play's last event, so its "…"
        // takes that place in the room's speech.
        if let Some(seq) = work.context["events"].as_array().and_then(|events| {
            events
                .iter()
                .filter_map(|e| e["seq"].as_f64())
                .reduce(f64::max)
        }) {
            scene["after"] = json!(seq);
        }
        let failed = lines.is_err();
        match lines {
            // A silent play, or one whose only voices stayed quiet, commits
            // no speech op: the journal matches a play whose words never came.
            Ok(lines) if lines.as_array().is_some_and(Vec::is_empty) => {
                scene["lines"] = json!([]);
                let silent = super::full_speech::silent(&work.context, work.actor, lines);
                if !silent.is_empty() {
                    scene["silent"] = json!(silent);
                }
            }
            Ok(lines) => {
                let mut w = store::world(&tx, id, time)?;
                let result = store::commit(
                    &tx,
                    id,
                    &mut w,
                    json!({"op":"speech","actor":actor_id(work.actor),"room":work.room,"play":work.id,"lines":lines,
                    "disclosures":scene["context"]["disclosures"],
                    "entries":lines.as_array().into_iter().flatten().filter(|line| line["reflection"].is_object()).map(|line| json!({"id":line["entityId"],"model":line["model"],"reflection":line["reflection"]})).collect::<Vec<_>>()}),
                    time,
                )?;
                scene["lines"] = result["lines"].clone();
                let silent = super::full_speech::silent(&work.context, work.actor, lines);
                if !silent.is_empty() {
                    scene["silent"] = json!(silent);
                }
            }
            // Words that failed are silence, not an error: every voice due
            // shows "…", nothing is journaled, and no retry is kept. The
            // journal matches a play whose words never came (rules unchanged).
            Err(error) => {
                tracing::warn!(%error, play = %work.id, "shared card words fell silent");
                scene["lines"] = json!([]);
                let voices = super::full_speech::voices(&work.context, work.actor);
                if !voices.is_empty() {
                    scene["silent"] = json!(voices);
                }
                scene["failed"] = json!(true);
            }
        }
        for key in ["context", "profiles", "events"] {
            scene
                .as_object_mut()
                .ok_or("The scene needs attention.")?
                .remove(key);
        }
        scene["starts_at"] = json!(time);
        // Failed words hold nothing: the seat and the world free at once.
        let duration = if !failed {
            scene["lines"]
                .as_array()
                .ok_or("The scene needs attention.")?
                .iter()
                .map(|l| {
                    ((l["text"].as_str().unwrap_or("").chars().count() as i64) * 45 + 1500)
                        .clamp(3500, 9000)
                })
                .sum::<i64>()
                + 3500 * scene["silent"].as_array().map_or(0, Vec::len) as i64
        } else {
            0
        };
        scene["until_at"] = json!(time + duration);
        tx.execute(
            "UPDATE card_full_plays SET status=?,until_at=?,result=? WHERE id=?",
            params![
                // Failed words free the seat now; a reading scene holds it.
                if failed { "done" } else { "playing" },
                time + duration,
                scene.to_string(),
                work.id
            ],
        )
        .map_err(sql_error)?;
        tx.execute(
        "INSERT INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?) ON CONFLICT(play) DO UPDATE SET content=excluded.content",
        params![id, work.room, work.id, scene.to_string()],
    )
    .map_err(sql_error)?;
        tx.commit().map_err(sql_error)?;
        // Counted once committed: a busy retry runs this again.
        let silent = scene["silent"].as_array().map_or(0, Vec::len);
        let spoke = scene["lines"].as_array().is_some_and(|l| !l.is_empty());
        match (failed, spoke, silent) {
            (true, ..) => voice_scenes::shared("failed", silent),
            (false, _, 1..) => voice_scenes::shared("partial", silent),
            (false, true, 0) => voice_scenes::shared("spoken", 0),
            // A play that voiced no one is not a scene of words.
            (false, false, 0) => {}
        }
        Ok(!failed)
    })())
}
