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
use std::sync::OnceLock;
use tokio::sync::{watch, Semaphore};

type Seat = Option<(String, usize)>;
// Reflections have their own capacity, so they never take a scene's slot.
fn capacity() -> &'static Semaphore {
    static CAP: OnceLock<Semaphore> = OnceLock::new();
    CAP.get_or_init(|| Semaphore::new(2))
}
fn cancel() -> &'static watch::Sender<Seat> {
    static CANCEL: OnceLock<watch::Sender<Seat>> = OnceLock::new();
    CANCEL.get_or_init(|| watch::channel(None).0)
}
/// A seat's newer scene drops its own unfinished reflection, never another's.
pub(super) fn replace(world: &str, actor: usize) {
    cancel().send_replace(Some((world.to_string(), actor)));
}
async fn replaced(mut cancel: watch::Receiver<Seat>, seat: (String, usize)) {
    loop {
        if cancel.changed().await.is_err() {
            return std::future::pending().await;
        }
        if cancel.borrow_and_update().as_ref() == Some(&seat) {
            return;
        }
    }
}

/// Whether the play's recent speech is journaled under rules that take a
/// later reflection, and none is journaled for it yet.
fn due(c: &rusqlite::Connection, id: &str, play: &str) -> super::Result<bool> {
    let ops: Vec<String> = c
        .prepare(
            "SELECT json_extract(command,'$.op') FROM card_full_log WHERE world=?1 AND seq>(SELECT coalesce(max(seq),0)-4096 FROM card_full_log WHERE world=?1) AND json_extract(command,'$.play')=?2 AND json_extract(command,'$.op') IN ('speech','reflect')",
        )
        .and_then(|mut q| {
            q.query_map(params![id, play], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()
        })
        .map_err(super::sql_error)?;
    let version: Option<String> = c
        .query_row(
            "SELECT json_extract(state,'$.version') FROM card_full_checkpoints WHERE world=?",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(super::sql_error)?
        .flatten();
    Ok(ops.iter().any(|op| op == "speech")
        && !ops.iter().any(|op| op == "reflect")
        && version.is_some_and(|v| super::super::engine::takes_reflect(&v)))
}

/// The command for a play's reflections, dated to its speech.
pub(in crate::card_shared) fn command(work: &Work, entries: Vec<Value>) -> Value {
    let scene = &work.context["context"];
    json!({"op":"reflect","actor":super::actor_id(work.actor),"play":work.id,
        "turn":work.context["turn"],"rest":scene["rest"],"entries":entries})
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
    if !due(&tx, id, play)? {
        return Ok(false);
    }
    let time = now();
    let mut w = store::world(&tx, id, time)?;
    store::commit(&tx, id, &mut w, command, time)?;
    tx.commit().map_err(super::sql_error)?;
    Ok(true)
}

/// After a play's line is journaled, reflect for the voices that spoke.
pub(super) fn spawn(state: AppState, id: String, work: Work, lines: &Value) {
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
    let cancelled = replaced(cancel().subscribe(), (id.clone(), work.actor));
    tokio::spawn(async move {
        let Ok(_permit) = capacity().acquire().await else {
            return;
        };
        let (s, wid, play) = (state.clone(), id.clone(), work.id.clone());
        let ready = tokio::task::spawn_blocking(move || {
            let c = db(&s)?;
            store::schema(&c)?;
            due(&c, &wid, &play)
        });
        if !matches!(ready.await, Ok(Ok(true))) {
            return;
        }
        let scene = &work.context["context"];
        let actor = super::actor_id(work.actor);
        let entries = tokio::select! {
            _ = cancelled => return,
            entries = crate::routes::card_game::narrative::shared_reflections(&config, scene, actor, &spoke, &models) => entries,
        };
        if entries.is_empty() {
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
        let waiting = tokio::spawn(replaced(cancel().subscribe(), ("w".into(), 0)));
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
}
