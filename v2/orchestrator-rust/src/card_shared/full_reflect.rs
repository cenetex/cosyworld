//! Private reflections after a committed shared line (#2016).
//!
//! The line is journaled and shown first. A reflection (thought, persona,
//! dream) is generated afterwards, outside the scene's capacity, and journaled
//! as its own later `reflect` op naming the play and the speech's turn. It is
//! written at most once per play, only after that play's speech, and only for
//! rules that take it. One that fails, is cancelled, or no longer passes the
//! rules is simply absent: the world is whole without it.
use super::{db, now, store, turn, writer, Work};
use crate::AppState;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tokio::sync::{watch, Semaphore};

// Reflections have their own capacity, so they never take a scene's slot.
fn capacity() -> &'static Semaphore {
    static CAP: OnceLock<Semaphore> = OnceLock::new();
    CAP.get_or_init(|| Semaphore::new(2))
}
// A reflection waits this long for capacity, then is dropped.
const PERMIT_WAIT: Duration = Duration::from_secs(20);

// Each seat counts its scenes. A reflection started at one count is dropped
// once its own seat's count moves, so no replace is lost to another seat's.
type Seat = (String, usize);
fn seats() -> MutexGuard<'static, HashMap<Seat, watch::Sender<u64>>> {
    static SEATS: OnceLock<Mutex<HashMap<Seat, watch::Sender<u64>>>> = OnceLock::new();
    SEATS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}
fn generation(world: &str, actor: usize) -> watch::Receiver<u64> {
    seats()
        .entry((world.to_string(), actor))
        .or_insert_with(|| watch::channel(0).0)
        .subscribe()
}
/// A seat's newer scene drops its own unfinished reflection, never another's.
pub(in crate::card_shared) fn replace(world: &str, actor: usize) {
    seats()
        .entry((world.to_string(), actor))
        .or_insert_with(|| watch::channel(0).0)
        .send_modify(|n| *n += 1);
}
/// Resolves once the seat has moved past `start`, even if it moved before
/// this was first polled.
async fn replaced(mut seat: watch::Receiver<u64>, start: u64) {
    if seat.wait_for(|n| *n != start).await.is_err() {
        std::future::pending::<()>().await;
    }
}

/// Whether `version` journals reflections in their own op after the speech
/// they follow. Rules v88 added it; earlier rules take them in the speech.
pub(in crate::card_shared) fn takes_reflect(version: &str) -> bool {
    version
        .strip_prefix("full-card-world/")
        .and_then(|n| n.parse::<u32>().ok())
        .is_some_and(|n| n >= 88)
}

/// Whether the play's recent speech is journaled, none of its reflections
/// is yet, and the world's rules take a later reflection.
fn due(c: &rusqlite::Connection, id: &str, play: &str, version: &str) -> super::Result<bool> {
    let ops: Vec<String> = c
        .prepare(
            "SELECT json_extract(command,'$.op') FROM card_full_log WHERE world=?1 AND seq>(SELECT coalesce(max(seq),0)-4096 FROM card_full_log WHERE world=?1) AND json_extract(command,'$.play')=?2 AND json_extract(command,'$.op') IN ('speech','reflect')",
        )
        .and_then(|mut q| {
            q.query_map(params![id, play], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()
        })
        .map_err(super::sql_error)?;
    Ok(ops.iter().any(|op| op == "speech")
        && !ops.iter().any(|op| op == "reflect")
        && takes_reflect(version))
}
// The checkpoint's version, a cheap early answer before a model call. It can
// trail an upgrade journaled since; `commit` checks the live world's version.
fn checkpoint_version(c: &rusqlite::Connection, id: &str) -> super::Result<String> {
    Ok(c.query_row(
        "SELECT json_extract(state,'$.version') FROM card_full_checkpoints WHERE world=?",
        [id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map_err(super::sql_error)?
    .flatten()
    .unwrap_or_default())
}

/// The command for a play's reflections, dated to its speech.
pub(in crate::card_shared) fn command(work: &Work, entries: Vec<Value>) -> Value {
    let scene = &work.context["context"];
    json!({"op":"reflect","actor":super::actor_id(work.actor),"play":work.id,
        "turn":work.context["turn"],"resting":scene["resting"],"rest":scene["rest"],
        "entries":entries})
}

/// Journal `command` once, after its play's speech. A refusal leaves the
/// journal as it was.
pub(in crate::card_shared) fn commit(
    state: &AppState,
    id: &str,
    command: Value,
) -> super::Result<bool> {
    let mut c = db(state)?;
    store::schema(&c)?;
    let gate = writer(state);
    let _turn = turn(&gate);
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(super::sql_error)?;
    let play = command["play"].as_str().unwrap_or_default();
    let time = now();
    let mut w = store::world(&tx, id, time)?;
    if !due(&tx, id, play, &w.version)? {
        return Ok(false);
    }
    store::commit(&tx, id, &mut w, command, time)?;
    tx.commit().map_err(super::sql_error)?;
    Ok(true)
}

/// After a play's line is journaled, reflect for the voices that spoke.
pub(in crate::card_shared) fn spawn(state: AppState, id: String, work: Work, lines: &Value) {
    let spoke: Vec<String> = lines
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|line| line["actorId"].as_str().map(str::to_string))
        .collect();
    let Ok((config, models)) = super::super::full_speech::story(&state) else {
        return;
    };
    if spoke.is_empty() {
        return;
    }
    let seat = generation(&id, work.actor);
    let start = *seat.borrow();
    let cancelled = replaced(seat.clone(), start);
    tokio::spawn(async move {
        tokio::pin!(cancelled);
        // A reflection that cannot get capacity soon, or whose seat moves on
        // while it waits, is dropped.
        let _permit = tokio::select! {
            _ = &mut cancelled => return,
            permit = tokio::time::timeout(PERMIT_WAIT, capacity().acquire()) => match permit {
                Ok(Ok(permit)) => permit,
                _ => return,
            },
        };
        let (s, wid, play) = (state.clone(), id.clone(), work.id.clone());
        let ready = tokio::task::spawn_blocking(move || {
            let c = db(&s)?;
            store::schema(&c)?;
            let version = checkpoint_version(&c, &wid)?;
            due(&c, &wid, &play, &version)
        });
        if !matches!(ready.await, Ok(Ok(true))) {
            return;
        }
        let scene = &work.context["context"];
        let actor = super::actor_id(work.actor);
        let entries = tokio::select! {
            _ = &mut cancelled => return,
            entries = crate::routes::card_game::narrative::shared_reflections(&config, scene, actor, &spoke, &models) => entries,
        };
        if entries.is_empty() || *seat.borrow() != start {
            return;
        }
        let command = command(&work, entries);
        let done = tokio::task::spawn_blocking(move || commit(&state, &id, command)).await;
        if !matches!(done, Ok(Ok(_))) {
            tracing::warn!(result = ?done, "a shared reflection was not kept");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn reflections_keep_their_own_capacity_and_seat() {
        // Busy reflections leave every scene slot free.
        assert!(!std::ptr::eq(capacity(), &**super::super::capacity()));
        assert_eq!(capacity().available_permits(), 2);
        // Only the same seat's newer scene drops its reflection.
        let seat = generation("w", 0);
        let waiting = tokio::spawn(replaced(seat.clone(), *seat.borrow()));
        replace("w", 1);
        replace("other", 0);
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        replace("w", 0);
        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .unwrap()
            .unwrap();
    }

    // Two seats replaced back to back each lose their own reflection, and a
    // replace that lands before the wait is first polled (while a reflection
    // waits for a permit) still cancels it.
    #[tokio::test]
    async fn back_to_back_and_early_replaces_are_not_lost() {
        let (a, b) = (generation("race", 0), generation("race", 1));
        let (start_a, start_b) = (*a.borrow(), *b.borrow());
        let early = replaced(a.clone(), start_a);
        let late = tokio::spawn(replaced(b, start_b));
        replace("race", 0);
        replace("race", 1);
        tokio::time::timeout(Duration::from_secs(1), early)
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), late)
            .await
            .unwrap()
            .unwrap();
        // A fresh reflection after both starts at the new count and waits.
        let next = generation("race", 0);
        let fresh = replaced(next.clone(), *next.borrow());
        assert!(tokio::time::timeout(Duration::from_millis(20), fresh)
            .await
            .is_err());
    }
}
