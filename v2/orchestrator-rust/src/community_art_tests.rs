use super::*;
use axum::{response::IntoResponse as _, routing::post, Router};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

fn test_art_config() -> ReplicateAvatarArtConfig {
    ReplicateAvatarArtConfig {
        api_token: "test-token".to_string(),
        model: "test/model".to_string(),
        version: None,
        lora_url: None,
        lora_input_key: "lora_weights".to_string(),
        lora_scale_input_key: "lora_scale".to_string(),
        lora_scale: 1.0,
        prompt_prefix: "cozy card art".to_string(),
        output_format: "png".to_string(),
    }
}

#[tokio::test]
async fn location_art_funding_fails_before_debit_without_policy_review() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Careful Patron",
    );
    runtime.callings.insert(
        5000,
        CallingState {
            actor_id: 5000,
            statement: EXPLORER_CALLING_STATEMENT.to_string(),
            source_event_seq: None,
        },
    );
    let (search, mutation, _) = runtime
        .plan_journey_move(5000, MOONLIT_TRAIL_LOCATION_ID)
        .expect("pathway planning succeeds")
        .expect("long route begins with discovery");
    let mut discovery = JournalRecord::new(search, 7049);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];
    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    assert!(state.ai_config.as_ref().is_none());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44991".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            intent_id: "test-location-policy-unconfigured".to_string(),
        }),
    )
    .await
    .0;

    assert!(!response.ok);
    assert_eq!(response.status, 503);
    assert!(response.events.is_empty());
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("location", waypoint_id, 1)));
}

#[tokio::test]
async fn location_policy_preflight_uses_a_known_safe_capability_contract() {
    let capability_contract_seen = Arc::new(AtomicBool::new(false));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let capability_contract_seen = capability_contract_seen.clone();
            move |Json(body): Json<serde_json::Value>| {
                let capability_contract_seen = capability_contract_seen.clone();
                async move {
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let review = body
                        .pointer("/messages/1/content/0/text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    capability_contract_seen.store(
                        body.get("model").and_then(serde_json::Value::as_str)
                            == Some("test-vision-model")
                            && body
                                .pointer("/response_format/json_schema/name")
                                .and_then(serde_json::Value::as_str)
                                == Some("cosyworld_image_policy")
                            && image_url == POLICY_PREFLIGHT_IMAGE_URL
                            && review.contains("uniform solid-green square")
                            && !review.contains("Publish only a landscape"),
                        Ordering::SeqCst,
                    );
                    Json(serde_json::json!({
                        "choices": [{
                            "message": {
                                "content": r#"{"allowed":true,"violations":[],"summary":"The known-safe capability fixture matches."}"#
                            }
                        }]
                    }))
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind successful policy preflight fixture");
    let address = listener
        .local_addr()
        .expect("successful policy preflight address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let config = AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
    };

    preflight_community_art_policy(Some(&config), CommunityArtImagePolicy::LocationLandscape)
        .await
        .expect("known-safe preflight fixture is accepted");

    assert!(capability_contract_seen.load(Ordering::SeqCst));
    server.abort();
}

#[tokio::test]
async fn location_policy_400_fails_before_orb_debit_or_replicate_schedule() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Preflight Patron",
    );
    runtime.callings.insert(
        5000,
        CallingState {
            actor_id: 5000,
            statement: EXPLORER_CALLING_STATEMENT.to_string(),
            source_event_seq: None,
        },
    );
    let (search, mutation, _) = runtime
        .plan_journey_move(5000, MOONLIT_TRAIL_LOCATION_ID)
        .expect("pathway planning succeeds")
        .expect("long route begins with discovery");
    let mut discovery = JournalRecord::new(search, 7054);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];

    let policy_requests = Arc::new(AtomicUsize::new(0));
    let preflight_shape_seen = Arc::new(AtomicBool::new(false));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let policy_requests = policy_requests.clone();
            let preflight_shape_seen = preflight_shape_seen.clone();
            move |Json(body): Json<serde_json::Value>| {
                let policy_requests = policy_requests.clone();
                let preflight_shape_seen = preflight_shape_seen.clone();
                async move {
                    policy_requests.fetch_add(1, Ordering::SeqCst);
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    preflight_shape_seen.store(
                        body.get("model").and_then(serde_json::Value::as_str)
                            == Some("test-vision-model")
                            && body
                                .pointer("/response_format/json_schema/name")
                                .and_then(serde_json::Value::as_str)
                                == Some("cosyworld_image_policy")
                            && image_url.starts_with("data:image/png;base64,"),
                        Ordering::SeqCst,
                    );
                    (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({
                            "error": {
                                "message": "configured model cannot combine image_url and json_schema"
                            }
                        })),
                    )
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind policy preflight fixture");
    let address = listener.local_addr().expect("policy preflight address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
    }));
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44992".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            intent_id: "test-location-policy-400".to_string(),
        }),
    )
    .await
    .0;

    assert!(!response.ok);
    assert_eq!(response.status, 503);
    assert!(response.events.is_empty());
    assert_eq!(policy_requests.load(Ordering::SeqCst), 1);
    assert!(preflight_shape_seen.load(Ordering::SeqCst));
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("location", waypoint_id, 1)));
    drop(runtime);
    assert!(!community_art_candidate_exists(
        &state.generated_asset_dir,
        &CommunityArtPlan {
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            level: 1,
            required_orbs: 1,
            history_through_seq: 0,
            prompt: String::new(),
            aspect_ratio: "16:9",
            image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
        }
    ));
    server.abort();
}

#[tokio::test]
async fn policy_retry_reuses_the_saved_candidate_without_calling_replicate() {
    let policy_requests = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let policy_requests = policy_requests.clone();
            move |Json(body): Json<serde_json::Value>| {
                let policy_requests = policy_requests.clone();
                async move {
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    assert!(image_url.starts_with("data:image/png;base64,"));
                    if policy_requests.fetch_add(1, Ordering::SeqCst) == 0 {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({
                                "error": { "message": "temporary structured vision mismatch" }
                            })),
                        )
                            .into_response();
                    }
                    Json(serde_json::json!({
                        "choices": [{
                            "message": {
                                "content": r#"{"allowed":true,"violations":[],"summary":"An empty landscape contains no forbidden subjects."}"#
                            }
                        }]
                    }))
                    .into_response()
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind retained candidate fixture");
    let address = listener.local_addr().expect("retained candidate address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-retained-candidate-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let plan = CommunityArtPlan {
        subject_kind: "location".to_string(),
        subject_id: 181_728,
        level: 1,
        required_orbs: 1,
        history_through_seq: 99,
        prompt: "A quiet rain-soft path with no figures.".to_string(),
        aspect_ratio: "16:9",
        image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
    };
    let image_bytes = BASE64_STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XqgWAAAAAElFTkSuQmCC")
        .expect("decode retained PNG fixture");
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: image_bytes.clone(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/test.png".to_string(),
            prediction_id: Some("prediction-retained-1".to_string()),
        },
    )
    .expect("persist candidate before review");
    let policy_config = AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
    };

    let first = generate_and_store_community_art(
        &test_art_config(),
        Some(&policy_config),
        &generated_dir,
        &plan,
    )
    .await;
    assert!(first.reused_candidate);
    assert_eq!(
        first.prediction_id.as_deref(),
        Some("prediction-retained-1")
    );
    assert!(matches!(
        first.result,
        Err(CommunityArtGenerationError::PolicyReview(_))
    ));
    assert!(community_art_candidate_exists(&generated_dir, &plan));
    assert!(!stored_community_art_image_path(&generated_dir, "location", plan.subject_id).exists());

    let second = generate_and_store_community_art(
        &test_art_config(),
        Some(&policy_config),
        &generated_dir,
        &plan,
    )
    .await;
    assert!(second.reused_candidate);
    assert!(second.result.is_ok());
    assert_eq!(policy_requests.load(Ordering::SeqCst), 2);
    assert_eq!(
        fs::read(stored_community_art_image_path(
            &generated_dir,
            "location",
            plan.subject_id
        ))
        .expect("read published retained candidate"),
        image_bytes
    );

    remove_community_art_candidate(&generated_dir, &plan).expect("remove retained fixture");
    let _ = fs::remove_dir_all(generated_dir);
    server.abort();
}

#[test]
fn provider_attempt_budget_is_journaled_and_survives_serialization() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Budget Patron",
    );
    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7055,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "test-provider-budget".to_string(),
            amount: 1,
            history_through_seq: 7055,
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);

    for attempt in 1..=MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7055 + u64::from(attempt),
        );
        record
            .projection_mutations
            .push(ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                provider_attempt: true,
            });
        record
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                status: "failed".to_string(),
                prediction_id: Some(format!("prediction-{attempt}")),
                error_code: Some("community_art_generation_failed".to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    let key = community_art_generation_key("actor", 5000, 1);
    let generation = &runtime.community_art_generations[&key];
    assert_eq!(
        generation.provider_attempts,
        MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    );
    assert_eq!(
        generation.last_prediction_id.as_deref(),
        Some("prediction-3")
    );
    assert!(!community_art_generation_retryable(generation, false));

    let serialized =
        serde_json::to_string(&runtime.community_art_generations).expect("serialize art budget");
    let restored: BTreeMap<String, CommunityArtGenerationState> =
        serde_json::from_str(&serialized).expect("restore art budget");
    assert_eq!(
        restored[&key].provider_attempts,
        MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    );
    assert!(!community_art_generation_retryable(&restored[&key], false));
}

#[tokio::test]
async fn moderation_rejects_pathway_art_to_the_fallback_without_refunding() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Art Ranger",
    );
    runtime.callings.insert(
        5000,
        CallingState {
            actor_id: 5000,
            statement: EXPLORER_CALLING_STATEMENT.to_string(),
            source_event_seq: None,
        },
    );
    let (search, mutation, _) = runtime
        .plan_journey_move(5000, MOONLIT_TRAIL_LOCATION_ID)
        .expect("pathway planning succeeds")
        .expect("long route begins with discovery");
    let mut discovery = JournalRecord::new(search, 7051);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];

    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7052,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "test-pathway-policy-funding".to_string(),
            amount: 1,
            history_through_seq: 7052,
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);
    let mut ready = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7053,
    );
    ready
        .projection_mutations
        .push(ProjectionMutation::SetCommunityArtStatus {
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            level: 1,
            status: "ready".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&ready).0, CW_OK);
    assert_eq!(
        runtime
            .state_response(Some(5000), &AccessContext::default())
            .cards
            .locations[&waypoint_id]
            .image_url
            .as_deref(),
        Some(
            format!("/assets/generated/community/location/{waypoint_id}.image?level=1&revision=1")
                .as_str()
        )
    );
    let before_world_tick = runtime.world.tick;
    let before_exit_count = runtime.world.exit_count;
    let before_journey = runtime.journeys[&5000].clone();

    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-pathway-policy-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let mut state = test_app_state(runtime, None);
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    state.moderation_token = Some(Arc::new("test-moderator".to_string()));
    let image_path = stored_community_art_image_path(&generated_dir, "location", waypoint_id);
    let content_type_path =
        stored_community_art_content_type_path(&generated_dir, "location", waypoint_id);
    fs::create_dir_all(image_path.parent().expect("community art parent"))
        .expect("create community art fixture directory");
    fs::write(&image_path, b"reviewed fixture bytes").expect("write ready art fixture");
    fs::write(&content_type_path, "image/png").expect("write ready art type fixture");
    let legacy_pathway_dir = generated_dir.join("pathways");
    fs::create_dir_all(&legacy_pathway_dir).expect("create legacy pathway directory");
    fs::write(
        legacy_pathway_dir.join(format!("{waypoint_id}.image")),
        b"legacy person-bearing image",
    )
    .expect("write legacy pathway fixture");

    let legacy_response =
        generated_pathway_asset(State(state.clone()), AxumPath(format!("{waypoint_id}.svg")))
            .await
            .into_response();
    assert_eq!(legacy_response.status(), StatusCode::OK);
    assert_eq!(
        legacy_response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("image/svg+xml; charset=utf-8"),
        "legacy pathway bitmaps must never override the deterministic fallback"
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        "Bearer test-moderator".parse().expect("moderation header"),
    );
    let rejected = moderation_reject_community_art(
        headers,
        State(state.clone()),
        AxumPath(("location".to_string(), waypoint_id)),
    )
    .await
    .0;
    assert!(rejected.ok);
    assert_eq!(rejected.art_status.as_deref(), Some("rejected"));
    assert!(rejected.retryable_without_orbs);
    assert!(!image_path.exists());
    assert!(!content_type_path.exists());

    let runtime = state.inner.lock().await;
    let card = &runtime
        .state_response(Some(5000), &AccessContext::default())
        .cards
        .locations[&waypoint_id];
    assert_eq!(card.asset_status, "generated_pathway_art");
    assert_eq!(
        card.image_url.as_deref(),
        Some(format!("/assets/generated/pathways/{waypoint_id}.svg").as_str())
    );
    let generation = &runtime.community_art_generations
        [&community_art_generation_key("location", waypoint_id, 1)];
    assert_eq!(generation.status, "rejected");
    assert_eq!(generation.funded_orbs, generation.required_orbs);
    assert_eq!(generation.revision, 2);
    assert_eq!(runtime.world.tick, before_world_tick);
    assert_eq!(runtime.world.exit_count, before_exit_count);
    let journey = &runtime.journeys[&5000];
    assert_eq!(journey.pathway_id, before_journey.pathway_id);
    assert_eq!(journey.path, before_journey.path);
    assert_eq!(journey.current_step, before_journey.current_step);
    drop(runtime);

    let rejected_asset = generated_community_art_asset(
        State(state),
        AxumPath(("location".to_string(), format!("{waypoint_id}.image"))),
    )
    .await
    .into_response();
    assert_eq!(rejected_asset.status(), StatusCode::NOT_FOUND);
    let _ = fs::remove_dir_all(generated_dir);
}
