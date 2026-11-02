//! Terminal provider receipts and refunds commit together and remain immutable.
use super::*;
use rusqlite::TransactionBehavior;

pub(super) async fn observe(
    path: &FsPath,
    config: &AiConfig,
    user: &str,
    world: &str,
    id: &str,
    job: &str,
) -> Value {
    let receipt = match provider_json(config, &format!("videos/{}", urlencode(job)), None).await {
        Ok(receipt) => receipt,
        Err(reason) => return json!({"status": "processing", "detail": reason}),
    };
    let status = receipt["status"].as_str().unwrap_or("");
    if receipt["id"].as_str() != Some(job)
        || !matches!(status, "completed" | "failed" | "cancelled" | "expired")
    {
        return json!({"status": "processing"});
    }
    let reason = receipt["error"]["message"]
        .as_str()
        .or(receipt["error"].as_str())
        .unwrap_or("")
        .to_owned();
    let (u, w, i, j, s) = (
        user.to_owned(),
        world.to_owned(),
        id.to_owned(),
        job.to_owned(),
        status.to_owned(),
    );
    store(path, move |c| settle(c, &u, &w, &i, &j, &s, &reason))
        .await
        .unwrap_or_else(|_| json!({"status": "processing"}))
}

pub(super) fn terminal(state: &str) -> bool {
    matches!(
        state,
        "completed" | "failed" | "cancelled" | "expired" | "rejected"
    )
}

fn settle(
    c: &mut rusqlite::Connection,
    user: &str,
    world: &str,
    id: &str,
    job: &str,
    status: &str,
    reason: &str,
) -> rusqlite::Result<Value> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let payer = reservations::scope(user, world);
    // A second legacy receipt can arrive after adoption. Recheck before refunding.
    if status != "completed"
        && tx
            .prepare(
                "SELECT 1 FROM credit_video_jobs
        WHERE request_id = ?1 AND world_id = ?2 AND (?2 <> '' OR user_id = ?3) AND job_id <> ?4
        AND EXISTS (SELECT 1 FROM credit_video_requests WHERE payer = ?5 AND request_id = ?1 AND state = 'submitted')",
            )?
            .exists(params![id, world, user, job, payer])?
    {
        return Ok(review(status));
    }
    let changed = tx.execute(
        "UPDATE credit_video_requests SET state = ?4, detail = ?5
        WHERE payer = ?1 AND request_id = ?2 AND job_id = ?3 AND state = 'submitted'",
        params![payer, id, job, status, reason],
    )?;
    let receipt: Option<(String, String, String)> = tx
        .query_row(
            "SELECT state, detail, user_id FROM credit_video_requests
        WHERE payer = ?1 AND request_id = ?2 AND job_id = ?3",
            params![payer, id, job],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((state, detail, creator)) = receipt else {
        // Several legacy provider jobs may share one debit. Keep their content readable;
        // a failed sibling must not refund another sibling's successful generation.
        return Ok(review(status));
    };
    let refunded = changed == 1
        && state != "completed"
        && credits::refund_in(
            &tx,
            Payer::of(world, &creator),
            SpendKind::Video,
            id,
            &format!("video {state}: {detail}"),
        )?;
    tx.commit()?;
    Ok(json!({"status": state, "error": detail, "refunded": refunded}))
}

fn review(status: &str) -> Value {
    json!({"status": status, "error": "This earlier request's credits need review.", "refunded": false})
}

#[test]
fn unique_legacy_receipts_settle_once_but_duplicate_jobs_need_review() {
    let mut c = rusqlite::Connection::open_in_memory().unwrap();
    jobs(&c).unwrap();
    credits::grant(&mut c, "u1", 300, "pack", "").unwrap();
    credits::pool::commit(&mut c, "u1", "w1", 200, "pool").unwrap();
    credits::spend(&mut c, "u1", SpendKind::Video, "old-film").unwrap();
    credits::spend(&mut c, Payer::of("w1", "u1"), SpendKind::Video, "many-film").unwrap();
    credits::spend(&mut c, Payer::of("w1", "u1"), SpendKind::Video, "late-film").unwrap();
    c.execute_batch(
        "INSERT INTO credit_video_jobs VALUES
        ('u1', 'old-film', 'job-old', 1, ''),
        ('u1', 'many-film', 'job-a', 1, 'w1'), ('u2', 'many-film', 'job-b', 2, 'w1'),
        ('u1', 'late-film', 'job-c', 1, 'w1');",
    )
    .unwrap();
    reservations::schema(&c).unwrap();
    c.execute(
        "INSERT INTO credit_video_jobs VALUES ('u2', 'late-film', 'job-d', 2, 'w1')",
        [],
    )
    .unwrap();
    assert_eq!(
        settle(
            &mut c,
            "u1",
            "w1",
            "late-film",
            "job-c",
            "failed",
            "rejected"
        )
        .unwrap()["refunded"],
        false
    );
    settle(&mut c, "u1", "w1", "late-film", "job-c", "completed", "").unwrap();
    let sibling = reservations::get(&c, "u2", "", "late-film")
        .unwrap()
        .unwrap();
    assert_eq!(sibling.0, "job-d");
    assert_eq!(sibling.2, "submitted");
    let other = settle(&mut c, "u2", "w1", "late-film", "job-d", "failed", "").unwrap();
    assert_eq!(other["status"], "failed");
    assert_eq!(
        settle(&mut c, "u1", "w1", "late-film", "job-c", "failed", "").unwrap()["status"],
        "completed"
    );
    let failed = settle(
        &mut c, "u1", "", "old-film", "job-old", "failed", "rejected",
    )
    .unwrap();
    assert_eq!(failed["refunded"], true);
    let replay = settle(&mut c, "u1", "", "old-film", "job-old", "completed", "").unwrap();
    assert_eq!(
        (replay["status"].as_str(), replay["refunded"].as_bool()),
        (Some("failed"), Some(false))
    );
    assert_eq!(credits::balance(&c, "u1").unwrap(), 100);
    let duplicate = settle(
        &mut c,
        "u1",
        "w1",
        "many-film",
        "job-a",
        "failed",
        "rejected",
    )
    .unwrap();
    assert_eq!(duplicate["refunded"], false);
    assert_eq!(credits::balance(&c, Payer::of("w1", "u2")).unwrap(), 0);
    assert_eq!(
        reservations::get(&c, "u1", "w1", "many-film")
            .unwrap()
            .unwrap()
            .0,
        "job-a"
    );
}
