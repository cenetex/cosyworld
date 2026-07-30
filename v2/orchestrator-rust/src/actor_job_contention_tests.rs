use super::*;

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
