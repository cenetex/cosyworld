use super::*;
use axum::{response::IntoResponse as _, routing::post, Router};
use base64::Engine as _;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use sha2::{Digest as _, Sha256};
use std::{
    io::Cursor,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
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

fn gate_png() -> Vec<u8> {
    let pixels = ImageBuffer::from_fn(16, 9, |x, y| {
        Rgba([
            (x as u8).wrapping_mul(17),
            (y as u8).wrapping_mul(29),
            (x as u8 ^ y as u8).wrapping_mul(11),
            255,
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(pixels)
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("encode gate PNG");
    bytes.into_inner()
}

#[test]
fn policy_preflight_fixture_is_a_real_sized_png() {
    let encoded = POLICY_PREFLIGHT_IMAGE_URL
        .strip_prefix("data:image/png;base64,")
        .expect("preflight fixture is an inline PNG");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("preflight fixture decodes");
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(&bytes[12..16], b"IHDR");
    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 64);
    assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 64);
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
async fn evolution_endpoint_freezes_prior_and_pools_without_extra_orb_or_turn() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Art Patron");
    runtime.world.actors[..runtime.world.actor_count]
        .iter_mut()
        .find(|actor| actor.id == 5000)
        .expect("test avatar exists")
        .stats
        .level = 2;
    let before_tick = runtime.world.tick;
    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    let prior_bytes = BASE64_STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XqgWAAAAAElFTkSuQmCC")
        .expect("decode prior-level PNG");
    let prior_prediction = "prior-level-prediction";
    let prior_asset = register_generated_media_asset(
        &state.generated_asset_dir,
        "actor",
        5000,
        1,
        &prior_bytes,
        "image/png",
        MediaAssetProvenance {
            pack_id: "cosyworld.core".to_string(),
            pack_version: "1.0.0".to_string(),
            composition_id: "community-art:actor:5000:level:1".to_string(),
            composition_revision: "1".to_string(),
            provider: "replicate".to_string(),
            model: "black-forest-labs/flux-dev-lora".to_string(),
            model_version: "pinned-flux1".to_string(),
            prompt_version: "community-art/3".to_string(),
            prediction_id: Some(prior_prediction.to_string()),
            source_event_seq: Some(1),
            history_through_seq: 1,
            ..MediaAssetProvenance::default()
        },
    )
    .expect("stage prior-level asset");
    assert!(reconcile_community_media_asset_status(
        &state.generated_asset_dir,
        "actor",
        5000,
        1,
        "ready",
        Some(prior_prediction),
        Some(2),
    )
    .expect("approve prior-level asset"));
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let fund = |session: String, intent_id: &str| {
        fund_community_image(
            ConnectInfo("127.0.0.1:44991".parse().expect("client address")),
            State(state.clone()),
            Json(FundCommunityImageRequest {
                actor_id: 5000,
                actor_session: Some(session),
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                intent_id: intent_id.to_string(),
            }),
        )
    };
    let response = fund(actor_session.clone(), "test-community-endpoint-1")
        .await
        .0;
    assert!(response.ok);
    assert!(response
        .events
        .iter()
        .any(|event| event.type_name == "community_art.funded"));
    let duplicate = fund(actor_session, "test-community-endpoint-1").await.0;
    assert!(duplicate.ok);
    assert!(duplicate.events.is_empty());

    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS - 1);
    assert_eq!(runtime.world.tick, before_tick);
    let generation =
        &runtime.community_art_generations[&community_art_generation_key("actor", 5000, 2)];
    assert_eq!(generation.funded_orbs, 1);
    assert_eq!(generation.required_orbs, 2);
    assert_eq!(generation.status, "funding");
    let evolution = generation
        .evolution_job
        .as_ref()
        .expect("evolution job is durably frozen on first funding");
    assert_eq!(evolution.prior_asset_id, prior_asset);
    assert_eq!(
        evolution.prior_asset_digest,
        format!("{:x}", Sha256::digest(&prior_bytes))
    );
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
        vision_reasoning_effort: None,
        ..AiConfig::default()
    };

    preflight_community_art_policy(Some(&config), CommunityArtImagePolicy::LocationLandscape)
        .await
        .expect("known-safe preflight fixture is accepted");

    assert!(capability_contract_seen.load(Ordering::SeqCst));
    server.abort();
}

#[test]
fn location_generation_replaces_portrait_prompt_without_disabling_the_style_lora() {
    let mut config = test_art_config();
    config.prompt_prefix = "MRQ, cozy storybook trading-card portrait".to_string();
    config.lora_url = Some("immanencer/mirquo".to_string());
    let history = community_art_prompt_history(
        "location",
        &[
            "Mara Bramblebrook leaves Foxglove Turn behind.".to_string(),
            "Quiet Rise has chalk in my boots already.".to_string(),
        ],
    );
    let plan = CommunityArtPlan {
        subject_kind: "location".to_string(),
        subject_id: 181_730,
        level: 1,
        generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        history_through_seq: 99,
        prompt: build_community_art_prompt(
            "location",
            "Quiet Rise",
            "Newly Found Path",
            "Chalky lanes meet a reed-fringed river.",
            1,
            "chalky lanes, reed beds, river stones",
            &history,
            Some(CommunityArtImagePolicy::LocationLandscape),
        ),
        aspect_ratio: "16:9",
        image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
        persisted_identity: "Quiet Rise".to_string(),
        persisted_visual_description: "chalky lanes and reed beds".to_string(),
        stable_traits: vec!["chalky lanes".to_string()],
        public_history: Vec::new(),
        evolution_job: None,
    };

    let prompt = community_art_generation_request(&config, &plan);

    assert!(prompt.starts_with(LOCATION_LANDSCAPE_PROMPT_PREFIX));
    assert!(!prompt.contains("trading-card portrait"));
    for portrait_leak in [
        "Collectible card art",
        "titled",
        "Mara Bramblebrook",
        "chalk in my boots",
    ] {
        assert!(!prompt.contains(portrait_leak), "{portrait_leak}: {prompt}");
    }
    assert_eq!(config.lora_url.as_deref(), Some("immanencer/mirquo"));
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
        vision_reasoning_effort: None,
        ..AiConfig::default()
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
            generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
            generation_policy: GeneratedPolicyBinding::default(),
            required_orbs: 1,
            history_through_seq: 0,
            prompt: String::new(),
            aspect_ratio: "16:9",
            image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
            persisted_identity: "test location".to_string(),
            persisted_visual_description: "test landscape".to_string(),
            stable_traits: vec!["test landscape".to_string()],
            public_history: Vec::new(),
            evolution_job: None,
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
        generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        history_through_seq: 99,
        prompt: "A quiet rain-soft path with no figures.".to_string(),
        aspect_ratio: "16:9",
        image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
        persisted_identity: "Quiet Rise".to_string(),
        persisted_visual_description: "rain-soft path".to_string(),
        stable_traits: vec!["rain-soft path".to_string()],
        public_history: Vec::new(),
        evolution_job: None,
    };
    let image_bytes = gate_png();
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
        vision_reasoning_effort: None,
        ..AiConfig::default()
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
    assert!(
        second.asset_id.is_some(),
        "publication stages an immutable asset before the ready journal transition"
    );
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
fn rollback_and_incumbent_routes_quarantine_a_stored_canary_before_publication() {
    let frozen = FrozenCommunityArtEvolutionJob::freeze(
        "actor",
        5000,
        "Rollback Patron",
        "a rust-red fox with a green scarf",
        vec!["green scarf".to_string(), "rust-red fur".to_string()],
        &[PublicArtHistoryEvent {
            seq: 72,
            summary: "The patron planted a public moonflower.".to_string(),
        }],
        1,
        "media-prior-level".to_string(),
        "a".repeat(64),
        "image/png".to_string(),
        70,
        72,
        2,
        1,
        "2:3",
    )
    .expect("freeze rollback fixture");
    let plan = CommunityArtPlan {
        subject_kind: "actor".to_string(),
        subject_id: 5000,
        level: 2,
        generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 2,
        history_through_seq: 72,
        prompt: "incumbent prompt".to_string(),
        aspect_ratio: "2:3",
        image_policy: None,
        persisted_identity: "Rollback Patron".to_string(),
        persisted_visual_description: "a rust-red fox with a green scarf".to_string(),
        stable_traits: vec!["green scarf".to_string(), "rust-red fur".to_string()],
        public_history: vec![PublicArtHistoryEvent {
            seq: 72,
            summary: "The patron planted a public moonflower.".to_string(),
        }],
        evolution_job: Some(frozen),
    };
    let prior = DownloadedReplicateImage {
        bytes: b"prior-approved-incumbent".to_vec(),
        content_type: "image/png".to_string(),
        source_url: "https://replicate.delivery/pbxt/prior.png".to_string(),
        prediction_id: Some("prior-approved".to_string()),
    };
    let canary = DownloadedReplicateImage {
        bytes: b"unapproved-flux2-canary".to_vec(),
        content_type: "image/png".to_string(),
        source_url: "https://replicate.delivery/pbxt/canary.png".to_string(),
        prediction_id: Some("canary-pending-review".to_string()),
    };

    for (route, label) in [
        (
            EvolutionRolloutRoute::AutomaticRollback,
            "automatic-rollback",
        ),
        (EvolutionRolloutRoute::Incumbent, "incumbent"),
    ] {
        let generated_dir = std::env::temp_dir().join(format!(
            "cosyworld-route-candidate-{label}-{}-{}",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_dir_all(&generated_dir);
        store_community_art_image(&generated_dir, &plan, &prior).expect("store prior public image");
        store_community_art_candidate_with_route(&generated_dir, &plan, &canary, true)
            .expect("store pending canary candidate");

        assert!(
            load_route_compatible_community_art_candidate(&generated_dir, &plan, route)
                .expect("route compatibility check")
                .is_none(),
            "{label} must continue through incumbent generation"
        );
        assert!(!community_art_candidate_exists(&generated_dir, &plan));
        assert!(
            publish_community_art_candidate(&generated_dir, &plan).is_err(),
            "{label} cannot publish the quarantined canary"
        );
        assert_eq!(
            fs::read(stored_community_art_image_path(
                &generated_dir,
                "actor",
                plan.subject_id
            ))
            .expect("read unchanged public image"),
            prior.bytes
        );
        assert_eq!(
            fs::read(
                generated_dir
                    .join("media-evolution-shadow")
                    .join("actor")
                    .join(plan.subject_id.to_string())
                    .join("level-2.image")
            )
            .expect("read privately retained canary"),
            canary.bytes
        );
        let _ = fs::remove_dir_all(generated_dir);
    }
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
            evolution_job: None,
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
                generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
                generation_policy: GeneratedPolicyBinding::default(),
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

#[test]
fn failed_evolution_retries_charge_no_extra_orbs_and_keep_prior_art_public() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Evolving Patron",
    );
    runtime.world.actors[..runtime.world.actor_count]
        .iter_mut()
        .find(|actor| actor.id == 5000)
        .expect("evolving actor")
        .stats
        .level = 2;
    let frozen = FrozenCommunityArtEvolutionJob::freeze(
        "actor",
        5000,
        "Evolving Patron — World Traveler",
        "a rust-red fox with a green scarf",
        vec!["green scarf".to_string(), "rust-red fur".to_string()],
        &[PublicArtHistoryEvent {
            seq: 72,
            summary: "The patron planted a public moonflower.".to_string(),
        }],
        1,
        "media-prior-level".to_string(),
        "a".repeat(64),
        "image/png".to_string(),
        70,
        72,
        2,
        1,
        "2:3",
    )
    .expect("freeze test evolution");

    let mut prior = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        70,
    );
    prior
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "prior-level".to_string(),
            amount: 1,
            history_through_seq: 69,
            evolution_job: None,
        });
    prior
        .projection_mutations
        .push(ProjectionMutation::SetCommunityArtStatus {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 1,
            status: "ready".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&prior).0, CW_OK);

    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        72,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 2,
            required_orbs: 2,
            contributor_actor_id: 5000,
            intent_id: "evolution-level".to_string(),
            amount: 2,
            history_through_seq: 72,
            evolution_job: Some(frozen.clone()),
        });
    funding.orb_deltas.push(OrbDelta {
        actor_id: 5000,
        delta: -2,
        reason: "community_image_generation".to_string(),
    });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);
    let balance_after_funding = runtime.orb_balance(5000);

    for attempt in 1..=MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS {
        let mut failure = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            72 + u64::from(attempt),
        );
        failure
            .projection_mutations
            .push(ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 2,
                provider_attempt: true,
                generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
                generation_policy: GeneratedPolicyBinding::default(),
            });
        failure
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 2,
                status: "failed".to_string(),
                prediction_id: Some(format!("flux2-failed-{attempt}")),
                error_code: Some("community_art_generation_failed".to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&failure).0, CW_OK);
        assert_eq!(runtime.orb_balance(5000), balance_after_funding);
    }

    let generation =
        &runtime.community_art_generations[&community_art_generation_key("actor", 5000, 2)];
    assert_eq!(generation.evolution_job.as_ref(), Some(&frozen));
    assert_eq!(generation.funded_orbs, 2);
    let card = &runtime
        .state_response(Some(5000), &AccessContext::default())
        .cards
        .actors[&5000];
    assert_eq!(
        card.image_url.as_deref(),
        Some("/assets/generated/community/actor/5000.image?level=1&revision=1")
    );
    assert_eq!(
        card.community_art.as_ref().map(|art| art.status.as_str()),
        Some("failed")
    );
}

#[test]
fn newer_location_prompt_profile_reopens_a_paid_exhausted_job() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Recovered Patron",
    );
    let subject_id = 181_730;
    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7060,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "location".to_string(),
            subject_id,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "test-paid-location-recovery".to_string(),
            amount: 1,
            history_through_seq: 7060,
            evolution_job: None,
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);

    let key = community_art_generation_key("location", subject_id, 1);
    runtime
        .community_art_generations
        .get_mut(&key)
        .expect("funded generation")
        .generation_profile_version = LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION;
    for attempt in 1..=MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7060 + u64::from(attempt),
        );
        record
            .projection_mutations
            .push(ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "location".to_string(),
                subject_id,
                level: 1,
                provider_attempt: true,
                generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
                generation_policy: runtime
                    .generated_pathway_for_location(subject_id)
                    .map(|pathway| pathway.generation_policy.clone())
                    .unwrap_or_default(),
            });
        record
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "location".to_string(),
                subject_id,
                level: 1,
                status: "policy_rejected".to_string(),
                prediction_id: Some(format!("legacy-prediction-{attempt}")),
                error_code: Some("community_art_policy_rejected".to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    let exhausted = &runtime.community_art_generations[&key];
    assert_eq!(exhausted.funded_orbs, exhausted.required_orbs);
    assert_eq!(
        exhausted.provider_attempts,
        MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    );
    assert!(!community_art_generation_retryable(exhausted, false));
    assert!(community_art_generation_retryable_for_profile(
        exhausted,
        false,
        LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION
    ));

    let mut retry = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7064,
    );
    retry
        .projection_mutations
        .push(ProjectionMutation::BeginCommunityArtGeneration {
            subject_kind: "location".to_string(),
            subject_id,
            level: 1,
            provider_attempt: true,
            generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
            generation_policy: runtime
                .generated_pathway_for_location(subject_id)
                .map(|pathway| pathway.generation_policy.clone())
                .unwrap_or_default(),
        });
    assert_eq!(runtime.apply_journal_record(&retry).0, CW_OK);

    let recovered = &runtime.community_art_generations[&key];
    assert_eq!(
        recovered.generation_profile_version,
        LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION
    );
    assert_eq!(recovered.provider_attempts, 1);
    assert_eq!(recovered.funded_orbs, recovered.required_orbs);
    assert_eq!(recovered.status, "generating");
}

#[test]
fn legacy_begin_generation_journal_defaults_to_the_original_prompt_profile() {
    let mutation: ProjectionMutation = serde_json::from_value(serde_json::json!({
        "kind": "begin_community_art_generation",
        "subject_kind": "location",
        "subject_id": 181730,
        "level": 1,
        "provider_attempt": true
    }))
    .expect("legacy begin-generation journal remains readable");

    let ProjectionMutation::BeginCommunityArtGeneration {
        generation_profile_version,
        ..
    } = mutation
    else {
        panic!("legacy mutation retains its variant");
    };
    assert_eq!(
        generation_profile_version,
        LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION
    );
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
            evolution_job: None,
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
    runtime
        .community_art_generations
        .get_mut(&community_art_generation_key("location", waypoint_id, 1))
        .expect("ready community art generation")
        .last_prediction_id = Some("pathway-approved-prediction".to_string());
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
    let reviewed_bytes = base64::engine::general_purpose::STANDARD
        .decode(
            POLICY_PREFLIGHT_IMAGE_URL
                .strip_prefix("data:image/png;base64,")
                .expect("fixture prefix"),
        )
        .expect("decode reviewed PNG fixture");
    fs::write(&image_path, &reviewed_bytes).expect("write ready art fixture");
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

    let ready_asset = generated_community_art_asset(
        State(state.clone()),
        AxumPath(("location".to_string(), format!("{waypoint_id}.image"))),
        Query(BTreeMap::new()),
    )
    .await
    .into_response();
    assert_eq!(ready_asset.status(), StatusCode::OK);
    let immutable_object = fs::read_dir(generated_dir.join("media-assets/objects/sha256"))
        .expect("immutable object directory")
        .next()
        .expect("one immutable object")
        .expect("immutable object entry")
        .path();
    assert_eq!(
        fs::read(&immutable_object).expect("read immutable object"),
        reviewed_bytes
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
    assert!(
        immutable_object.exists(),
        "rejection removes mutable aliases but preserves immutable evidence"
    );
    let graph = fs::read_to_string(generated_dir.join("media-assets/graph-v1.json"))
        .expect("read immutable graph after rejection");
    assert!(graph.contains("\"state\": \"rejected\""));
    assert!(graph.contains("\"canonical\": {}"));

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
        Query(BTreeMap::new()),
    )
    .await
    .into_response();
    assert_eq!(rejected_asset.status(), StatusCode::NOT_FOUND);
    let _ = fs::remove_dir_all(generated_dir);
}
