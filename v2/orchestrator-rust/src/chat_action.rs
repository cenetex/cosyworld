use super::*;

static CHAT_ACTION_LOCKS: OnceLock<StdMutex<BTreeMap<String, Weak<Mutex<()>>>>> = OnceLock::new();

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CommittedOrbChatLine {
    pub(super) seq: u64,
    pub(super) speaker_actor_id: u64,
    pub(super) content: String,
}

pub(super) fn orb_chat_attempt_stage(stage: &str, attempt: u32) -> String {
    format!("{stage}:attempt:{}", attempt.max(1))
}

fn orb_chat_event_matches_job(
    event: &EventView,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    location_id: u64,
) -> bool {
    let cause_matches = match queue_event_id {
        Some(queue_event_id) => event.caused_by_event_seq == Some(queue_event_id),
        None => {
            event.caused_by_event_seq.is_none()
                && event.seq > observed_through_seq.unwrap_or_default()
        }
    };
    cause_matches
        && source_world_tick.is_none_or(|tick| event.source_world_tick == Some(tick))
        && event.source_location_id == Some(location_id)
}

pub(super) fn committed_orb_chat_lines(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
) -> Result<Vec<CommittedOrbChatLine>, String> {
    let mut lines = runtime
        .event_log
        .iter()
        .filter(|event| {
            event.type_name == "message.created"
                && event.success
                && matches!(event.actor_id, Some(id) if id == actor_id || id == target_actor_id)
                && orb_chat_event_matches_job(
                    event,
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    location_id,
                )
        })
        .filter_map(|event| {
            Some(CommittedOrbChatLine {
                seq: event.seq,
                speaker_actor_id: event.actor_id?,
                content: event.content.clone()?,
            })
        })
        .collect::<Vec<_>>();
    lines.sort_by_key(|line| line.seq);
    let expected_speakers = [actor_id, target_actor_id, actor_id, target_actor_id];
    if lines.len() > expected_speakers.len()
        || lines
            .iter()
            .zip(expected_speakers)
            .any(|(line, expected)| line.speaker_actor_id != expected)
    {
        return Err("the durable Chat transcript has an invalid turn sequence".to_string());
    }
    Ok(lines)
}

pub(super) fn orb_chat_status_already_committed(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    status: &str,
    location_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
) -> bool {
    let event_type = format!("chat.{status}");
    runtime.event_log.iter().any(|event| {
        event.type_name == event_type
            && event.success
            && event.actor_id == Some(actor_id)
            && event.target_actor_id == Some(target_actor_id)
            && orb_chat_event_matches_job(
                event,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                location_id,
            )
    })
}

pub(super) async fn chat(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "chat-actor",
        CHAT_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }

    let chat_lock = chat_action_lock(&state, payload.actor_id);
    let _chat_guard = chat_lock.lock().await;
    {
        let runtime = state.inner.lock().await;
        if !client_actor_authorized_for_state(
            &runtime,
            &state,
            payload.actor_id,
            payload.actor_session.as_deref(),
        ) {
            return client_actor_rejected_response();
        }
    }
    if let Some(path) = state.event_store_path.as_deref() {
        match active_orb_chat_target(path, payload.actor_id) {
            Ok(Some(active_target_actor_id))
                if active_target_actor_id == payload.target_actor_id =>
            {
                return Json(ActionResponse {
                    ok: true,
                    status: CW_OK,
                    events: Vec::new(),
                });
            }
            Ok(Some(_)) => {
                return Json(ActionResponse {
                    ok: false,
                    status: 409,
                    events: vec![EventView {
                        type_name: "chat.failed".to_string(),
                        actor_id: Some(payload.actor_id),
                        target_actor_id: Some(payload.target_actor_id),
                        content: Some(
                            "Let the current conversation settle before starting another."
                                .to_string(),
                        ),
                        ..EventView::default()
                    }],
                });
            }
            Ok(None) => {}
            Err(error) => {
                warn!("could not inspect the durable Chat queue: {error}");
                return Json(ActionResponse {
                    ok: false,
                    status: 503,
                    events: vec![EventView {
                        type_name: "chat.failed".to_string(),
                        actor_id: Some(payload.actor_id),
                        target_actor_id: Some(payload.target_actor_id),
                        content: Some(
                            "The conversation could not start safely; try again.".to_string(),
                        ),
                        ..EventView::default()
                    }],
                });
            }
        }
    }

    let mut runtime = state.inner.lock().await;
    let target_is_available = runtime.actor_uses_inference(payload.target_actor_id)
        && resident_supports_text_reply(payload.target_actor_id)
        && !runtime.actors_blocked(payload.actor_id, payload.target_actor_id)
        && !runtime.actor_muted(payload.actor_id, payload.target_actor_id);
    let Some(plan) = target_is_available
        .then(|| runtime.avatar_chat_plan_for(payload.actor_id, payload.target_actor_id))
        .flatten()
    else {
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: vec![EventView {
                type_name: "chat.failed".to_string(),
                actor_id: Some(payload.actor_id),
                target_actor_id: Some(payload.target_actor_id),
                content: Some("That conversation is no longer within reach.".to_string()),
                ..EventView::default()
            }],
        });
    };

    let source_world_tick = runtime.world.tick;
    let observed_through_seq = runtime.world.next_event_seq.saturating_sub(1);
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: payload.actor_id,
            target_actor_id: payload.target_actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.offer_kind = Some("chat".to_string());
    record
        .projection_mutations
        .push(ProjectionMutation::ChatStatus {
            target_actor_id: payload.target_actor_id,
            status: "queued".to_string(),
            reason: "the conversation is unfolding".to_string(),
        });
    record.queued_actor_job = Some(ActorJobPayload::OrbChat(OrbChatJob {
        actor_id: payload.actor_id,
        target_actor_id: payload.target_actor_id,
        plan: plan.clone(),
        queue_event_id: None,
        source_world_tick: None,
        observed_through_seq: None,
    }));
    let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: vec![EventView {
                type_name: "chat.failed".to_string(),
                actor_id: Some(payload.actor_id),
                target_actor_id: Some(payload.target_actor_id),
                content: Some("The conversation could not be saved; try again.".to_string()),
                ..EventView::default()
            }],
        });
    };
    drop(runtime);

    broadcast_events(&state, &events);
    if status == CW_OK {
        let queue_event_id = events
            .iter()
            .find(|event| event.type_name == "chat.queued" && event.success)
            .map(|event| event.seq);
        if state.event_store_path.is_some() {
            state.actor_job_notify.notify_waiters();
        } else {
            let chat_state = state.clone();
            tokio::spawn(async move {
                if let Err(error) = complete_queued_orb_chat(
                    &chat_state,
                    payload.actor_id,
                    payload.target_actor_id,
                    plan,
                    queue_event_id,
                    Some(source_world_tick),
                    Some(observed_through_seq),
                )
                .await
                {
                    warn!("in-memory Chat job failed: {error}");
                }
            });
        }
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events,
    })
}

fn chat_action_lock(state: &AppState, actor_id: u64) -> Arc<Mutex<()>> {
    let key = format!("{:p}:{actor_id}", Arc::as_ptr(&state.inner));
    let mut locks = CHAT_ACTION_LOCKS
        .get_or_init(|| StdMutex::new(BTreeMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

fn active_orb_chat_target(path: &Path, actor_id: u64) -> io::Result<Option<u64>> {
    let conn = open_event_store(path)?;
    let mut stmt = conn
        .prepare(
            "SELECT context_json FROM actor_jobs
             WHERE kind = ?1 AND actor_id = ?2 AND status IN ('pending', 'running')",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![ACTOR_JOB_KIND_ORB_CHAT, actor_id as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(sqlite_error)?;
    for row in rows {
        let payload = row.map_err(sqlite_error)?;
        let Ok(ActorJobPayload::OrbChat(job)) = serde_json::from_str::<ActorJobPayload>(&payload)
        else {
            continue;
        };
        return Ok(Some(job.target_actor_id));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};

    #[test]
    fn bounded_chat_requires_original_room_and_current_safety_consent() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Room Anchor");
        assert!(chat_participants_can_continue(
            &runtime,
            5000,
            RATI_ACTOR_ID,
            COSY_COTTAGE_LOCATION_ID,
        ));

        runtime
            .actor_safety
            .entry(5000)
            .or_default()
            .muted_actor_ids
            .insert(RATI_ACTOR_ID);
        assert!(!chat_participants_can_continue(
            &runtime,
            5000,
            RATI_ACTOR_ID,
            COSY_COTTAGE_LOCATION_ID,
        ));
        runtime
            .actor_safety
            .get_mut(&5000)
            .expect("safety state")
            .muted_actor_ids
            .clear();
        runtime
            .actor_safety
            .entry(RATI_ACTOR_ID)
            .or_default()
            .blocked_actor_ids
            .insert(5000);
        assert!(!chat_participants_can_continue(
            &runtime,
            5000,
            RATI_ACTOR_ID,
            COSY_COTTAGE_LOCATION_ID,
        ));
        runtime
            .actor_safety
            .get_mut(&RATI_ACTOR_ID)
            .expect("safety state")
            .blocked_actor_ids
            .clear();
        let original_control_mode = runtime.actor_control_mode(RATI_ACTOR_ID);
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        assert!(!chat_participants_can_continue(
            &runtime,
            5000,
            RATI_ACTOR_ID,
            COSY_COTTAGE_LOCATION_ID,
        ));
        runtime
            .actor_autonomy
            .get_mut(&RATI_ACTOR_ID)
            .expect("autonomy state")
            .control_mode = original_control_mode;

        for actor_id in [5000, RATI_ACTOR_ID] {
            let actor = runtime.world.actors[..runtime.world.actor_count]
                .iter_mut()
                .find(|actor| actor.id == actor_id)
                .expect("Chat participant exists");
            actor.location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        }
        assert!(!chat_participants_can_continue(
            &runtime,
            5000,
            RATI_ACTOR_ID,
            COSY_COTTAGE_LOCATION_ID,
        ));
    }

    #[tokio::test]
    async fn chat_endpoint_queues_a_bounded_exchange_without_spending_advancement() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-action-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
        }
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = chat(
            ConnectInfo("127.0.0.1:44001".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;

        assert!(response.ok);
        assert_eq!(response.status, CW_OK);
        assert!(response.events.iter().any(|event| {
            event.type_name == "chat.queued"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
        }));
        assert!(!response
            .events
            .iter()
            .any(|event| event.type_name == "advancement.spent"));
        let unauthorized_retry = chat(
            ConnectInfo("127.0.0.1:44002".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some("not-the-actor-session".to_string()),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(
            !unauthorized_retry.ok,
            "an active Chat job must not bypass actor authorization"
        );
        let overlapping_target = chat(
            ConnectInfo("127.0.0.1:44001".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
                target_actor_id: WHISKERWIND_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(!overlapping_target.ok);
        assert_eq!(overlapping_target.status, 409);
        assert!(overlapping_target.events.iter().any(|event| {
            event.type_name == "chat.failed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(WHISKERWIND_ACTOR_ID)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("current conversation"))
        }));
        let retry = chat(
            ConnectInfo("127.0.0.1:44001".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(retry.ok);
        assert!(
            retry.events.is_empty(),
            "retrying an active Chat must reuse the durable exchange"
        );
        let queued = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("inspect Chat outbox")
            .expect("Chat queued one durable job");
        let ActorJobPayload::OrbChat(job) = queued.payload else {
            panic!("Chat queued the wrong actor job");
        };
        assert_eq!(job.actor_id, 5000);
        assert_eq!(job.target_actor_id, RATI_ACTOR_ID);
        complete_actor_job(&path, queued.id).expect("complete inspected Chat job");
        assert!(
            claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
                .expect("inspect deduplicated Chat outbox")
                .is_none(),
            "a rapid Chat retry must not queue a second exchange"
        );
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
        assert_eq!(runtime.advancement_points_available(5000), 0);
        assert!(runtime.active_bond(5000, RATI_ACTOR_ID).is_none());
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| { event.type_name == "message.created" && event.actor_id == Some(5000) }));
        drop(runtime);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn co_present_chat_is_free_and_not_owned_by_a_room_turn() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-concurrent-chat-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Current Player",
        );
        create_test_human(
            &mut runtime,
            5001,
            COSY_COTTAGE_LOCATION_ID,
            "Waiting Chatter",
        );
        let state = test_app_state(runtime, Some(path.clone()));
        let (session_5000, _) = issue_actor_session(&state, 5000);
        let (session_5001, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5000, &session_5000),
            Some(false)
        );
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5001, &session_5001),
            Some(false)
        );

        let before_tick = {
            let runtime = state.inner.lock().await;
            let active_direct_actors = active_actor_ids_for_state(&state);
            let turn = room_turn_view_for_runtime(
                &state,
                &runtime,
                COSY_COTTAGE_LOCATION_ID,
                Some(5000),
                &active_direct_actors,
            );
            assert!(!turn.enabled);
            assert_eq!(turn.policy, "concurrent");
            runtime.world.tick
        };

        for (actor_id, actor_session, port) in
            [(5001, session_5001, 44002), (5000, session_5000, 44003)]
        {
            let response = chat(
                ConnectInfo(format!("127.0.0.1:{port}").parse().expect("client address")),
                State(state.clone()),
                Json(ChatRequest {
                    actor_id,
                    actor_session: Some(actor_session),
                    target_actor_id: RATI_ACTOR_ID,
                }),
            )
            .await
            .0;
            assert!(
                response.ok,
                "each co-present avatar can chat without owning a room turn"
            );
            assert!(response
                .events
                .iter()
                .any(|event| event.type_name == "chat.queued"));
            assert!(!response.events.iter().any(|event| {
                matches!(
                    event.type_name.as_str(),
                    "bond.created" | "advancement.spent"
                )
            }));
        }

        let runtime = state.inner.lock().await;
        let active_direct_actors = active_actor_ids_for_state(&state);
        let turn = room_turn_view_for_runtime(
            &state,
            &runtime,
            COSY_COTTAGE_LOCATION_ID,
            Some(5000),
            &active_direct_actors,
        );
        assert_eq!(
            runtime.world.tick, before_tick,
            "queued conversation is asynchronous system work, not a player-card tick"
        );
        for actor_id in [5000, 5001] {
            assert_eq!(runtime.advancement_points_available(actor_id), 0);
            assert!(runtime.active_bond(actor_id, RATI_ACTOR_ID).is_none());
        }
        assert!(!turn.enabled);
        assert_eq!(turn.policy, "concurrent");
        assert_eq!(turn.current_actor_id, None);
        assert!(!turn.is_current_actor);
        drop(runtime);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn unavailable_inference_commits_a_visible_chat_failure() {
        let state = test_app_state(RuntimeWorld::seeded(), None);
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };

        let result = complete_queued_orb_chat(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(41),
            Some(7),
            Some(40),
        )
        .await;
        assert!(
            result.is_err(),
            "unconfigured inference must fail the Chat job"
        );

        let runtime = state.inner.lock().await;
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.failed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("try talking again"))
        }));
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "message.created"));
    }

    /// The scripted exchange the fake provider plays back, in order. Turn
    /// selection reads the transcript already in the prompt rather than a call
    /// counter, because voice routing asks the provider more than once per
    /// turn and then ranks the certified candidates.
    const CHAT_SCRIPT: [&str; 4] = [
        "I found a quiet minute. How is the cottage treating you?",
        "Kindly enough, though the kettle has opinions about punctuality.",
        "Then I will keep one ear on the kettle and one on your story.",
        "A sensible arrangement. Come back before the kettle starts whistling secrets.",
    ];

    #[tokio::test]
    async fn completed_chat_commits_exactly_two_lines_from_each_participant() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let requests = Arc::new(StdMutex::new(Vec::<serde_json::Value>::new()));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let calls = calls.clone();
                let requests = requests.clone();
                move |Json(request): Json<serde_json::Value>| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    // Voice routing certifies and ranks several candidates per
                    // turn, so a scripted reply cannot key off the call count.
                    // Answer the turn the prompt is actually asking for: each
                    // committed line adds one "said to" row to the transcript.
                    // Voice routing certifies and ranks several candidates per
                    // turn, so a scripted reply cannot key off the call count.
                    // Answer whichever turn the transcript has not reached yet;
                    // the prompt already carries every committed line.
                    let payload = request.to_string();
                    let index = CHAT_SCRIPT
                        .iter()
                        .rposition(|line| payload.contains(line))
                        .map(|position| position + 1)
                        .unwrap_or_default();
                    requests
                        .lock()
                        .expect("capture Chat inference request")
                        .push(request);
                    async move {
                        let content = CHAT_SCRIPT
                            .get(index)
                            .copied()
                            .unwrap_or("The conversation has already settled.");
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": { "content": content }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bounded Chat inference server");
        let address = listener
            .local_addr()
            .expect("Chat inference server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };

        complete_queued_orb_chat(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(51),
            Some(8),
            Some(50),
        )
        .await
        .expect("the scripted bounded Chat completes");

        let runtime = state.inner.lock().await;
        let speakers = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "message.created")
            .filter_map(|event| event.actor_id)
            .collect::<Vec<_>>();
        let event_diagnostic = runtime
            .event_log
            .iter()
            .map(|event| {
                (
                    event.type_name.clone(),
                    event.actor_id,
                    event.content.clone(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            speakers,
            vec![5000, RATI_ACTOR_ID, 5000, RATI_ACTOR_ID],
            "Chat must stay bounded to two authoritative lines per participant; calls={}, events={event_diagnostic:?}",
            calls.load(std::sync::atomic::Ordering::SeqCst),
        );
        let messages = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "message.created")
            .collect::<Vec<_>>();
        for pair in messages.windows(2) {
            assert!(
                pair[1].observed_through_seq.unwrap_or_default() >= pair[0].seq,
                "each reply must causally observe the committed line it answers: {pair:?}"
            );
        }
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.completed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
        }));
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "chat.failed"));
        drop(runtime);
        let captured = requests.lock().expect("inspect Chat inference requests");
        // Voice routing ranks several certified candidates before accepting
        // one, so the follow-up is no longer at a fixed request offset. Select
        // it by the speaker it is written for instead of by position.
        let last_user_prompt = |request: &serde_json::Value| -> Option<String> {
            request["messages"].as_array().and_then(|messages| {
                messages.iter().rev().find_map(|message| {
                    (message["role"].as_str() == Some("user"))
                        .then(|| message["content"].as_str())
                        .flatten()
                        .map(str::to_string)
                })
            })
        };
        // The opener is also written for Inference Tester, so match the
        // follow-up by the transcript it must carry back into the prompt.
        let followup_prompt = captured
            .iter()
            .filter_map(last_user_prompt)
            .rfind(|prompt| {
                prompt.contains("i am Inference Tester")
                    && prompt.contains("Inference Tester said to Rati:")
            })
            .expect("avatar follow-up prompt carrying the exchange transcript");
        let followup_prompt = followup_prompt.as_str();
        assert!(followup_prompt.contains("i am Inference Tester"));
        assert!(followup_prompt.contains("Inference Tester said to Rati:"));
        assert!(followup_prompt.contains("Rati said to Inference Tester:"));
        assert!(!followup_prompt.contains("actor_id="));
        assert!(!followup_prompt.contains("event_seq="));
        assert!(followup_prompt
            .contains("Kindly enough, though the kettle has opinions about punctuality."));
        assert!(!followup_prompt.contains("i am Rati"));
        server.abort();
    }

    #[test]
    fn orb_chat_provider_retry_waits_out_the_voice_health_cooldown_only_for_chat() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-retry-floor-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Retry Timer");
        let plan = runtime
            .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
            .expect("co-present inference resident is a Chat target");
        let mut state = test_app_state(runtime, Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig::default()));
        let queued = OrbChatJob {
            actor_id: 5000,
            target_actor_id: RATI_ACTOR_ID,
            plan,
            queue_event_id: Some(71),
            source_world_tick: Some(10),
            observed_through_seq: Some(70),
        };
        let conn = open_event_store(&path).expect("open Chat retry store");
        assert!(insert_orb_chat_job(&conn, &queued, 10, Some(71)).expect("queue Chat job"));
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("claim Chat job")
            .expect("queued Chat job exists");

        let retry_floor = actor_job_retry_floor_ms(&state, &claimed, "voice_provider_unavailable");
        assert_eq!(retry_floor, 2_250);
        let mut unrelated = claimed.clone();
        unrelated.kind = ACTOR_JOB_KIND_PLAYER_TICK.to_string();
        assert_eq!(
            actor_job_retry_floor_ms(&state, &unrelated, "voice_provider_unavailable"),
            0,
            "provider cooldown must not slow unrelated actor jobs"
        );

        let before = now_millis();
        fail_or_retry_actor_job(&path, &claimed, "voice_provider_unavailable", retry_floor)
            .expect("persist Chat retry");
        let (status, available_at_ms, last_error): (String, i64, Option<String>) = conn
            .query_row(
                "SELECT status, available_at_ms, last_error FROM actor_jobs WHERE id = ?1",
                params![claimed.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read persisted Chat retry");
        assert_eq!(status, "pending");
        assert_eq!(last_error.as_deref(), Some("voice_provider_unavailable"));
        assert!(available_at_ms as u64 >= before.saturating_add(2_000));
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn retry_resumes_after_the_last_committed_line_without_replaying_it() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-resume-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let fail_after_opening = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let fail_after_opening = fail_after_opening.clone();
                let calls = calls.clone();
                move |Json(request): Json<serde_json::Value>| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let payload = request.to_string();
                    let index = CHAT_SCRIPT
                        .iter()
                        .rposition(|line| payload.contains(line))
                        .map(|position| position + 1)
                        .unwrap_or_default();
                    let fail =
                        index > 0 && fail_after_opening.load(std::sync::atomic::Ordering::SeqCst);
                    async move {
                        if fail {
                            return Json(serde_json::json!({
                                "model": "test-chat-model",
                                "choices": []
                            }));
                        }
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {
                                    "content": CHAT_SCRIPT
                                        .get(index)
                                        .copied()
                                        .unwrap_or("The conversation has already settled.")
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind resumable Chat inference server");
        let address = listener
            .local_addr()
            .expect("resumable Chat inference server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };

        let first = complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan.clone(),
            Some(61),
            Some(9),
            Some(60),
            1,
        )
        .await;
        assert!(
            first.is_err(),
            "the injected resident outage ends attempt one"
        );
        {
            let runtime = state.inner.lock().await;
            let messages = runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "message.created")
                .collect::<Vec<_>>();
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0].actor_id, Some(5000));
            assert_eq!(messages[0].content.as_deref(), Some(CHAT_SCRIPT[0]));
            assert!(runtime.event_log.iter().any(|event| {
                event.type_name == "chat.retrying"
                    && event.caused_by_event_seq == Some(61)
                    && event
                        .content
                        .as_deref()
                        .is_some_and(|content| content.contains("retrying"))
            }));
        }

        fail_after_opening.store(false, std::sync::atomic::Ordering::SeqCst);
        // The failed resident route opened the model's two-second health
        // cooldown. The durable worker uses the same cooldown-sized retry
        // floor; wait it out here before invoking the next attempt directly.
        tokio::time::sleep(Duration::from_millis(2_100)).await;
        complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan.clone(),
            Some(61),
            Some(9),
            Some(60),
            2,
        )
        .await
        .expect("attempt two resumes and completes the durable transcript");
        let calls_after_completion = calls.load(std::sync::atomic::Ordering::SeqCst);
        complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(61),
            Some(9),
            Some(60),
            3,
        )
        .await
        .expect("reclaim after completion is idempotent");

        let runtime = state.inner.lock().await;
        let messages = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "message.created")
            .collect::<Vec<_>>();
        assert_eq!(messages.len(), 4);
        assert_eq!(
            messages
                .iter()
                .filter(|event| event.content.as_deref() == Some(CHAT_SCRIPT[0]))
                .count(),
            1,
            "the committed opening must not be generated or published twice"
        );
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "chat.completed")
                .count(),
            1,
            "a reclaimed completed job must not duplicate its terminal event"
        );
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            calls_after_completion,
            "a reclaimed completed job must not call inference again"
        );
        drop(runtime);
        server.abort();
        let _ = fs::remove_file(path);
    }
}
