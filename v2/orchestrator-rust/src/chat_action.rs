use super::*;

static CHAT_ACTION_LOCKS: OnceLock<StdMutex<BTreeMap<String, Weak<Mutex<()>>>>> = OnceLock::new();

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
                complete_queued_orb_chat(
                    &chat_state,
                    payload.actor_id,
                    payload.target_actor_id,
                    plan,
                    queue_event_id,
                    Some(source_world_tick),
                    Some(observed_through_seq),
                )
                .await;
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

        complete_queued_orb_chat(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(41),
            Some(7),
            Some(40),
        )
        .await;

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
                    let index = calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    requests
                        .lock()
                        .expect("capture Chat inference request")
                        .push(request);
                    async move {
                        let content = [
                            "I found a quiet minute. How is the cottage treating you?",
                            "Kindly enough, though the kettle has opinions about punctuality.",
                            "Then I will keep one ear on the kettle and one on your story.",
                            "A sensible arrangement. Come back before it starts whistling secrets.",
                        ]
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
        .await;

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
        let followup_request = captured.get(2).expect("avatar follow-up request");
        let followup_prompt = followup_request["messages"]
            .as_array()
            .and_then(|messages| {
                messages.iter().rev().find_map(|message| {
                    (message["role"].as_str() == Some("user"))
                        .then(|| message["content"].as_str())
                        .flatten()
                })
            })
            .expect("follow-up user prompt");
        assert!(followup_prompt.contains("i am Inference Tester"));
        assert!(followup_prompt.contains("Inference Tester → Rati:"));
        assert!(followup_prompt.contains("Rati → Inference Tester:"));
        assert!(followup_prompt
            .contains("Kindly enough, though the kettle has opinions about punctuality."));
        assert!(!followup_prompt.contains("actor_id="));
        assert!(!followup_prompt.contains("i am Rati"));
        server.abort();
    }
}
