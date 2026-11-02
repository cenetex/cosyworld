//! Bounded receipt reconciliation; a browser is not responsible for refunds.
use super::*;
use futures_util::{stream, StreamExt};
use rusqlite::TransactionBehavior;
use std::time::Duration;

type Pending = (String, String, String, String);

pub(crate) fn start(state: &AppState) -> Option<tokio::task::JoinHandle<()>> {
    let path = state.event_store_path.as_ref()?.as_ref().clone();
    let config = state.ai_config.as_ref().clone()?;
    Some(tokio::spawn(async move {
        let mut ticks = tokio::time::interval(Duration::from_secs(30));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticks.tick().await;
            run(&path, &config).await;
        }
    }))
}

pub(super) async fn run(path: &FsPath, config: &AiConfig) {
    let Ok(batch) = store(path, |c| plan(c, crate::util::now_unix_secs() as i64)).await else {
        return;
    };
    stream::iter(batch)
        .for_each_concurrent(4, |(user, world, id, job)| async move {
            receipts::observe(path, config, &user, &world, &id, &job).await;
        })
        .await;
}

fn plan(c: &mut rusqlite::Connection, now: i64) -> rusqlite::Result<Vec<Pending>> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let stale = {
        let mut query = tx.prepare("SELECT user_id, world_id, request_id, state FROM credit_video_requests
            WHERE state IN ('reserved', 'submitting') AND
            COALESCE(NULLIF(updated_at_unix, 0), created_at_unix) < ?1 - CASE state WHEN 'reserved' THEN 300 ELSE 120 END
            ORDER BY updated_at_unix LIMIT 16")?;
        let rows = query.query_map([now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (user, world, id, state) in stale {
        let (next, detail) = if state == "reserved" {
            (
                "failed",
                "Video was not submitted before the reservation expired",
            )
        } else {
            (
                "submission_unknown",
                "Submission was interrupted; provider acceptance needs review",
            )
        };
        tx.execute(
            "UPDATE credit_video_requests SET state = ?3, detail = ?4, updated_at_unix = ?5
            WHERE payer = ?1 AND request_id = ?2",
            params![reservations::scope(&user, &world), id, next, detail, now],
        )?;
        if state == "reserved" {
            credits::refund_in(&tx, Payer::of(&world, &user), SpendKind::Video, &id, detail)?;
        }
    }
    let batch = {
        let mut query = tx.prepare(
            "SELECT user_id, world_id, request_id, job_id FROM credit_video_requests
            WHERE state = 'submitted' AND updated_at_unix <= ?1 - 30
            ORDER BY updated_at_unix, created_at_unix LIMIT 16",
        )?;
        let rows = query.query_map([now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.collect::<rusqlite::Result<Vec<Pending>>>()?
    };
    for (user, world, id, _) in &batch {
        tx.execute("UPDATE credit_video_requests SET updated_at_unix = ?3 WHERE payer = ?1 AND request_id = ?2",
            params![reservations::scope(user, world), id, now])?;
    }
    tx.commit()?;
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn a_restarted_worker_and_a_poll_settle_each_pool_job_once() {
        use super::super::tests::{read, stub};
        use std::sync::Mutex;
        let path =
            std::env::temp_dir().join(format!("video-worker-{}.sqlite", crate::random_hex(8)));
        let status = Arc::new(Mutex::new("failed"));
        let submits = Arc::new(Mutex::new(Vec::new()));
        let config = stub(status.clone(), submits.clone()).await;
        let mut c = credits::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT, seen INTEGER);
            CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
            INSERT INTO card_members VALUES ('w1', 0, 'u1', 0), ('w1', 1, 'u2', 0);",
        )
        .unwrap();
        credits::grant(&mut c, "u1", 500, "pack", "").unwrap();
        credits::pool::commit(&mut c, "u1", "w1", 400, "pool").unwrap();
        let request = json!({"model": MODEL, "prompt": "scene"});
        begin(&path, &config, "u1", "w1", "film-failed", &request).await;
        c.execute("UPDATE credit_video_requests SET updated_at_unix = 0", [])
            .unwrap();
        drop(c); // Only durable pending receipts enter the restarted worker; no browser polls.
        let mut state =
            crate::test_support::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
        state.ai_config = Arc::new(Some(config.clone()));
        let worker = start(&state).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let c = credits::open(&path).unwrap();
                if credits::balance(&c, Payer::of("w1", "u1")).unwrap() == 400 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        worker.abort();
        *status.lock().unwrap() = "completed";
        assert_eq!(
            read(poll(&path, &config, "u2", "w1", "film-failed").await)
                .await
                .1["status"],
            "failed",
            "a terminal receipt is immutable"
        );
        let c = credits::open(&path).unwrap();
        for terminal in ["cancelled", "expired", "completed"] {
            *status.lock().unwrap() = terminal;
            let id = format!("film-{terminal}");
            begin(&path, &config, "u1", "w1", &id, &request).await;
            c.execute("UPDATE credit_video_requests SET updated_at_unix = 0", [])
                .unwrap();
            tokio::join!(run(&path, &config), poll(&path, &config, "u2", "w1", &id));
        }
        *status.lock().unwrap() = "failed";
        assert_eq!(
            read(poll(&path, &config, "u2", "w1", "film-completed").await)
                .await
                .1["status"],
            "completed"
        );
        assert_eq!(credits::balance(&c, Payer::of("w1", "u1")).unwrap(), 300);
        assert_eq!(credits::balance(&c, "u1").unwrap(), 100);
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM credit_events WHERE kind = 'refund'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            3
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM credit_video_requests WHERE state = 'submitted'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(submits.lock().unwrap().len(), 4);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn stale_reservations_and_late_receipts_keep_the_submission_boundary() {
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        jobs(&c).unwrap();
        credits::grant(&mut c, "u1", 300, "pack", "").unwrap();
        for id in ["before-submit", "after-submit"] {
            reservations::reserve(&mut c, "u1", "", id, &json!({"prompt": id})).unwrap();
        }
        reservations::claim(&c, "u1", "", "after-submit").unwrap();
        c.execute(
            "UPDATE credit_video_requests SET created_at_unix = 1, updated_at_unix = 1",
            [],
        )
        .unwrap();
        assert!(plan(&mut c, 1000).unwrap().is_empty());
        assert_eq!(
            reservations::get(&c, "u1", "", "before-submit")
                .unwrap()
                .unwrap()
                .2,
            "failed"
        );
        assert_eq!(
            reservations::get(&c, "u1", "", "after-submit")
                .unwrap()
                .unwrap()
                .2,
            "submission_unknown"
        );
        assert_eq!(
            credits::balance(&c, "u1").unwrap(),
            200,
            "only certainly unsubmitted work refunds"
        );
        assert!(!reservations::claim(&c, "u1", "", "after-submit").unwrap());
        assert!(reservations::finish(
            &mut c,
            "u1",
            "",
            "after-submit",
            "submitted",
            "late-job",
            ""
        )
        .unwrap());
        assert_eq!(credits::balance(&c, "u1").unwrap(), 200);
        let late = plan(&mut c, i64::MAX / 2).unwrap();
        assert_eq!(late.len(), 1);
        assert_eq!(late[0].3, "late-job");
    }

    #[test]
    fn bounded_batches_rotate_past_recently_checked_jobs() {
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        jobs(&c).unwrap();
        credits::grant(&mut c, "u1", 2000, "pack", "").unwrap();
        for n in 0..20 {
            let id = format!("film-{n:04}");
            reservations::reserve(&mut c, "u1", "", &id, &json!({"prompt": n})).unwrap();
            reservations::claim(&c, "u1", "", &id).unwrap();
            reservations::finish(&mut c, "u1", "", &id, "submitted", &id, "").unwrap();
        }
        let now = i64::MAX / 2;
        let first = plan(&mut c, now).unwrap();
        let second = plan(&mut c, now).unwrap();
        assert_eq!((first.len(), second.len()), (16, 4));
        assert!(first.iter().all(|a| second.iter().all(|b| a.2 != b.2)));
        assert!(plan(&mut c, now).unwrap().is_empty());
        assert_eq!(credits::balance(&c, "u1").unwrap(), 0);
    }
}
