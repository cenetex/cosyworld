//! Durable payer-scoped submission ownership. Unknown acceptance never permits a retry.
use super::*;
use rusqlite::{Connection, TransactionBehavior};
use sha2::{Digest, Sha256};

fn scope(user: &str, world: &str) -> String {
    if world.is_empty() {
        format!("person:{user}")
    } else {
        format!("world:{world}")
    }
}

pub(super) fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS credit_video_requests (
        payer TEXT NOT NULL, request_id TEXT NOT NULL, user_id TEXT NOT NULL,
        world_id TEXT NOT NULL, content_hash TEXT NOT NULL, state TEXT NOT NULL,
        job_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at_unix INTEGER NOT NULL,
        PRIMARY KEY (payer, request_id));",
    )
}

pub(super) enum Reservation {
    Ready,
    Existing(String),
    Conflict,
    Insufficient { balance: i64, price: i64 },
}

pub(super) fn reserve(
    c: &mut Connection,
    user: &str,
    world: &str,
    id: &str,
    body: &Value,
) -> rusqlite::Result<Reservation> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let payer = scope(user, world);
    let hash = format!("{:x}", Sha256::digest(body.to_string().as_bytes()));
    let old: Option<(String, String)> = tx.query_row(
        "SELECT content_hash, state FROM credit_video_requests WHERE payer = ?1 AND request_id = ?2",
        params![payer, id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?;
    if let Some((content, state)) = old {
        return Ok(if content != hash {
            Reservation::Conflict
        } else if state == "reserved" {
            Reservation::Ready
        } else {
            Reservation::Existing(state)
        });
    }
    // Legacy receipts have no content hash. Keep them readable, but never resubmit them.
    if tx.prepare("SELECT 1 FROM credit_video_jobs WHERE request_id = ?1 AND world_id = ?2 AND (?2 <> '' OR user_id = ?3)")?
        .exists(params![id, world, user])? {
        return Ok(Reservation::Conflict);
    }
    let state = match credits::spend_in(&tx, Payer::of(world, user), SpendKind::Video, id)? {
        Spend::Insufficient { balance, price } => {
            return Ok(Reservation::Insufficient { balance, price })
        }
        Spend::AlreadyPaid { .. } => "submission_unknown",
        Spend::Spent { .. } => "reserved",
    };
    tx.execute("INSERT INTO credit_video_requests (payer, request_id, user_id, world_id, content_hash, state, created_at_unix)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![payer, id, user, world, hash, state, crate::util::now_unix_secs() as i64])?;
    tx.commit()?;
    Ok(if state == "reserved" {
        Reservation::Ready
    } else {
        Reservation::Existing(state.into())
    })
}

pub(super) fn claim(c: &Connection, user: &str, world: &str, id: &str) -> rusqlite::Result<bool> {
    Ok(c.execute("UPDATE credit_video_requests SET state = 'submitting' WHERE payer = ?1 AND request_id = ?2 AND state = 'reserved'",
        params![scope(user, world), id])? == 1)
}

pub(super) fn finish(
    c: &mut Connection,
    user: &str,
    world: &str,
    id: &str,
    state: &str,
    job: &str,
    detail: &str,
) -> rusqlite::Result<bool> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let changed = tx.execute(
        "UPDATE credit_video_requests SET state = ?3, job_id = ?4, detail = ?6
        WHERE payer = ?1 AND request_id = ?2 AND state = ?5",
        params![
            scope(user, world),
            id,
            state,
            job,
            if state == "failed" {
                "reserved"
            } else {
                "submitting"
            },
            detail
        ],
    )?;
    if changed == 1 && matches!(state, "failed" | "rejected") {
        credits::refund_in(
            &tx,
            Payer::of(world, user),
            SpendKind::Video,
            id,
            "video not submitted",
        )?;
    }
    tx.commit()?;
    Ok(changed == 1)
}

pub(super) fn get(
    c: &Connection,
    user: &str,
    world: &str,
    id: &str,
) -> rusqlite::Result<Option<(String, String, String)>> {
    let found = c.query_row("SELECT job_id, world_id, state FROM credit_video_requests WHERE payer = ?1 AND request_id = ?2",
        params![scope(user, world), id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    if found.is_some() {
        return Ok(found);
    }
    c.query_row("SELECT job_id, world_id, 'submitted' FROM credit_video_jobs WHERE user_id = ?1 AND request_id = ?2 AND (?3 = '' OR world_id = ?3)",
        params![user, id, world], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()
}

#[test]
fn old_receipts_and_orphan_debits_cannot_authorize_another_submission() {
    let mut c = Connection::open_in_memory().unwrap();
    jobs(&c).unwrap();
    credits::grant(&mut c, "u1", 200, "pack", "").unwrap();
    credits::spend(&mut c, "u1", SpendKind::Video, "orphan-1").unwrap();
    let body = json!({"model": MODEL, "prompt": "scene"});
    assert!(
        matches!(reserve(&mut c, "u1", "", "orphan-1", &body).unwrap(), Reservation::Existing(s) if s == "submission_unknown")
    );
    assert!(!claim(&c, "u1", "", "orphan-1").unwrap());
    c.execute(
        "INSERT INTO credit_video_jobs VALUES ('u1', 'legacy-1', 'old-job', 0, '')",
        [],
    )
    .unwrap();
    assert!(matches!(
        reserve(&mut c, "u1", "", "legacy-1", &body).unwrap(),
        Reservation::Conflict
    ));
    assert_eq!(get(&c, "u1", "", "legacy-1").unwrap().unwrap().0, "old-job");
    assert_eq!(credits::balance(&c, "u1").unwrap(), 100);
}
