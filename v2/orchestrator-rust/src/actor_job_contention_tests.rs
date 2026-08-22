use super::*;

#[tokio::test]
async fn player_tick_job_from_an_old_reset_generation_is_ignored() {
    let state = test_app_state(RuntimeWorld::seeded(), None);
    state.actor_job_generation.store(2, AtomicOrdering::Release);
    let observation = PlayerTickObservation {
        source_actor_id: 5000,
        source_world_tick: 1,
        actor_job_generation: 1,
        caused_by_event_seq: Some(1),
        observed_through_seq: 1,
        source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
        allow_ordinary_speech: true,
        source_events: Vec::new(),
        ripple_source: None,
        relationship_reply: None,
    };
    let before = {
        let runtime = state.inner.lock().await;
        (
            runtime.world.tick,
            runtime.world.next_event_seq,
            runtime.event_log.len(),
        )
    };

    let (reply, relationship, followup) = complete_player_tick_observation(&state, observation)
        .await
        .expect("ignore stale player-tick job");
    let after = {
        let runtime = state.inner.lock().await;
        (
            runtime.world.tick,
            runtime.world.next_event_seq,
            runtime.event_log.len(),
        )
    };

    assert!(reply.is_none() && relationship.is_none() && followup.is_none());
    assert_eq!(after, before, "a stale job must not mutate the reset world");
}

#[test]
fn reset_event_store_rolls_back_all_tables_when_a_later_delete_fails() {
    let path = std::env::temp_dir().join(format!(
        "cosyworld-v2-reset-rollback-{}-{}.sqlite",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_file(&path);
    let old_event = EventView {
        seq: 1,
        type_name: "message.created".to_string(),
        success: true,
        ..EventView::default()
    };
    append_event_store(&path, &[old_event]).expect("append old-world event");

    let conn = open_event_store(&path).expect("open event store");
    conn.execute_batch(
        "CREATE TRIGGER fail_reset
         BEFORE DELETE ON canonical_world_state
         BEGIN
           SELECT RAISE(ABORT, 'forced reset failure');
         END;",
    )
    .expect("install reset failure trigger");
    drop(conn);

    assert!(reset_event_store(&path, &[]).is_err());
    let events = read_event_store(&path, None, 10).expect("read rolled-back event store");
    assert_eq!(events.len(), 1, "the earlier event delete must roll back");
    assert_eq!(events[0].seq, 1);

    let conn = open_event_store(&path).expect("open event store for cleanup");
    conn.execute_batch("DROP TRIGGER fail_reset;")
        .expect("drop reset failure trigger");
    drop(conn);
    let _ = fs::remove_file(path);
}

#[test]
fn actor_job_claim_waits_for_a_competing_writer() {
    let path = std::env::temp_dir().join(format!(
        "cosyworld-v2-actor-claim-contention-{}-{}.sqlite",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_file(&path);
    let observation = PlayerTickObservation {
        source_actor_id: 5000,
        source_world_tick: 41,
        actor_job_generation: 0,
        caused_by_event_seq: Some(401),
        observed_through_seq: 401,
        source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
        allow_ordinary_speech: true,
        source_events: Vec::new(),
        ripple_source: None,
        relationship_reply: None,
    };
    assert!(append_actor_job(&path, &observation).expect("queue actor job"));
    release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).expect("release actor job");

    let mut blocker = open_event_store(&path).expect("open competing writer");
    let blocker_tx = blocker
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("hold competing writer");
    let claim_path = path.clone();
    let claimant = std::thread::spawn(move || claim_next_actor_job(&claim_path));
    std::thread::sleep(Duration::from_millis(100));
    blocker_tx.commit().expect("release competing writer");

    let claimed = claimant
        .join()
        .expect("join actor-job claimant")
        .expect("claim actor job")
        .expect("pending actor job");
    assert_eq!(claimed.actor_id, observation.source_actor_id);
    complete_actor_job(&path, claimed.id).expect("complete actor job");
    let _ = fs::remove_file(path);
}

#[test]
fn malformed_oldest_actor_job_is_deferred_without_blocking_the_lane() {
    let path = std::env::temp_dir().join(format!(
        "cosyworld-v2-actor-claim-malformed-{}-{}.sqlite",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_file(&path);
    let observation = PlayerTickObservation {
        source_actor_id: 5001,
        source_world_tick: 42,
        actor_job_generation: 0,
        caused_by_event_seq: Some(402),
        observed_through_seq: 402,
        source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
        allow_ordinary_speech: true,
        source_events: Vec::new(),
        ripple_source: None,
        relationship_reply: None,
    };
    let valid_observation = PlayerTickObservation {
        source_actor_id: 5002,
        source_world_tick: 43,
        actor_job_generation: 0,
        caused_by_event_seq: Some(403),
        observed_through_seq: 403,
        source_location_id: Some(RAIN_SOFT_GARDEN_LOCATION_ID),
        allow_ordinary_speech: true,
        source_events: Vec::new(),
        ripple_source: None,
        relationship_reply: None,
    };
    assert!(append_actor_job(&path, &observation).expect("queue oldest actor job"));
    assert!(append_actor_job(&path, &valid_observation).expect("queue later actor job"));
    release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).expect("release actor job");

    let conn = open_event_store(&path).expect("open actor-job store");
    let (job_id, original_context): (i64, String) = conn
        .query_row(
            "SELECT id, context_json FROM actor_jobs WHERE actor_id = ?1",
            params![observation.source_actor_id as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read queued payload");
    conn.execute(
        "UPDATE actor_jobs SET context_json = '{malformed' WHERE id = ?1",
        params![job_id],
    )
    .expect("corrupt queued payload");
    let before_defer = now_millis() as i64;
    let error = claim_next_actor_job(&path).expect_err("malformed payload must fail closed");
    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    let after_defer = now_millis() as i64;
    let (status, attempts, lease, available_at, last_error): (
        String,
        i64,
        Option<i64>,
        i64,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT status, attempts, lease_until_ms, available_at_ms, last_error
             FROM actor_jobs WHERE id = ?1",
            params![job_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .expect("read deferred job");
    assert_eq!(status, "pending");
    assert_eq!(attempts, 0);
    assert_eq!(lease, None);
    assert!(
        available_at >= before_defer + ACTOR_JOB_MALFORMED_PAYLOAD_RETRY_DELAY_MS,
        "malformed row must be deferred by the bounded delay"
    );
    assert!(
        available_at <= after_defer + ACTOR_JOB_MALFORMED_PAYLOAD_RETRY_DELAY_MS,
        "malformed row delay must stay bounded"
    );
    assert_eq!(
        last_error.as_deref(),
        Some(ACTOR_JOB_MALFORMED_PAYLOAD_ERROR)
    );

    let valid = claim_next_actor_job(&path)
        .expect("claim later valid job")
        .expect("later valid job progresses past the deferred poison row");
    assert_eq!(valid.actor_id, valid_observation.source_actor_id);
    assert_eq!(valid.attempts, 1);
    complete_actor_job(&path, valid.id).expect("complete later valid job");

    conn.execute(
        "UPDATE actor_jobs SET context_json = ?2, available_at_ms = 0 WHERE id = ?1",
        params![job_id, original_context],
    )
    .expect("restore and release deferred payload");
    let claimed = claim_next_actor_job(&path)
        .expect("claim restored actor job")
        .expect("restored actor job exists");
    assert_eq!(claimed.id, job_id);
    assert_eq!(claimed.attempts, 1);
    complete_actor_job(&path, job_id).expect("complete restored job");
    assert!(
        claim_next_actor_job(&path)
            .expect("inspect drained actor-job lane")
            .is_none(),
        "restored payload must be claimed exactly once"
    );
    let _ = fs::remove_file(path);
}
