//! One durable owner per payer and spoken line. Completion survives cache
//! eviction; an expired unfinished purchase is refunded before a new attempt.
use super::{clips, refund_in, spend_in, Payer, Spend, SpendKind};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

pub(crate) enum Start {
    Outsider,
    Cached(Vec<u8>),
    Busy,
    Spent(Spend),
}

pub(crate) fn start(
    c: &mut Connection,
    payer: Payer,
    id: &str,
    token: &str,
) -> rusqlite::Result<Start> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS credit_speech_attempts (
        world TEXT NOT NULL, account TEXT NOT NULL, request TEXT NOT NULL,
        token TEXT NOT NULL, until_at INTEGER NOT NULL, fresh INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0, started_by TEXT NOT NULL,
        PRIMARY KEY(world, account, request))",
    )?;
    let world = payer.world();
    let account = if world.is_empty() { payer.user() } else { "" };
    if !world.is_empty() {
        if !clips::plays_in(&tx, world, payer.user())? {
            return Ok(Start::Outsider);
        }
        if let Some(audio) = clips::clip(&tx, world, id)? {
            return Ok(Start::Cached(audio));
        }
    }
    let now = crate::util::now_unix_secs() as i64;
    let old: Option<(i64, bool, bool, String)> = tx
        .query_row(
            "SELECT until_at,fresh,completed,started_by FROM credit_speech_attempts
         WHERE world=?1 AND account=?2 AND request=?3",
            params![world, account, id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    if let Some((until, fresh, completed, by)) = old {
        if until > now {
            return Ok(Start::Busy);
        }
        if fresh && !completed {
            refund_in(
                &tx,
                Payer::of(world, &by),
                SpendKind::Tts,
                id,
                "voice attempt expired",
            )?;
        }
        tx.execute(
            "UPDATE credit_speech_attempts SET token='',until_at=0,fresh=0
                    WHERE world=?1 AND account=?2 AND request=?3",
            params![world, account, id],
        )?;
    }
    let spent = spend_in(&tx, payer, SpendKind::Tts, id)?;
    if !matches!(spent, Spend::Insufficient { .. }) {
        tx.execute(
            "INSERT INTO credit_speech_attempts
            (world,account,request,token,until_at,fresh,started_by) VALUES (?1,?2,?3,?4,?5,?6,?7)
            ON CONFLICT(world,account,request) DO UPDATE SET token=excluded.token,
              until_at=excluded.until_at,fresh=excluded.fresh,started_by=excluded.started_by",
            params![
                world,
                account,
                id,
                token,
                now + 60,
                matches!(spent, Spend::Spent { .. }),
                payer.user()
            ],
        )?;
    }
    tx.commit()?;
    Ok(Start::Spent(spent))
}

/// Fence stale replies; the clip and completed purchase commit together.
pub(crate) fn finish(
    c: &mut Connection,
    payer: Payer,
    id: &str,
    token: &str,
    audio: Option<&[u8]>,
) -> rusqlite::Result<bool> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let world = payer.world();
    let account = if world.is_empty() { payer.user() } else { "" };
    let owned: Option<(bool, bool)> = tx
        .query_row(
            "SELECT fresh,completed FROM credit_speech_attempts
         WHERE world=?1 AND account=?2 AND request=?3 AND token=?4",
            params![world, account, id, token],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((fresh, completed)) = owned else {
        return Ok(false);
    };
    if let Some(audio) = audio {
        if !world.is_empty() {
            clips::keep(&tx, world, id, audio)?;
        }
    } else if fresh && !completed {
        refund_in(&tx, payer, SpendKind::Tts, id, "voice provider failed")?;
    }
    tx.execute(
        "UPDATE credit_speech_attempts SET token='',until_at=0,fresh=0,completed=?5
                WHERE world=?1 AND account=?2 AND request=?3 AND token=?4",
        params![world, account, id, token, completed || audio.is_some()],
    )?;
    tx.commit()?;
    Ok(true)
}
