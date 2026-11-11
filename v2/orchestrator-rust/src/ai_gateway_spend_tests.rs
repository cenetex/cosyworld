//! Server-paid admission must serialize only the usage probe and the
//! reservation, never the provider call, and must still hold the daily ceiling.

use super::*;
use axum::{http::StatusCode, response::IntoResponse, routing::get, routing::post, Json, Router};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::net::TcpListener;

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const IMAGE_MODEL: &str = "openai/gpt-image-2.6-flare";
const CHAT_MODEL: &str = "openai/test-chat";
const SLOW: Duration = Duration::from_millis(1_500);

fn pace(body: &Value) -> Option<Duration> {
    body.to_string().contains("slow").then_some(SLOW)
}

/// A fake OpenRouter. The base URL carries `openrouter.ai` in its path so the
/// gateway treats it as the server-paid provider. A request mentioning "slow"
/// takes `SLOW`, one mentioning "boom" fails; `/key` reports `usage`.
/// `calls` counts provider calls.
async fn provider(usage: f64, key: &str, calls: Arc<AtomicUsize>) -> AiConfig {
    let (chat_calls, image_calls, voice_calls) = (calls.clone(), calls.clone(), calls);
    let inner = Router::new()
        .route(
            "/key",
            get(move || async move { Json(json!({"data": {"usage_daily": usage}})) }),
        )
        .route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let calls = chat_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    if let Some(delay) = pace(&body) {
                        tokio::time::sleep(delay).await;
                    }
                    if body.to_string().contains("boom") {
                        return StatusCode::BAD_REQUEST.into_response();
                    }
                    Json(json!({
                        "model": CHAT_MODEL,
                        "choices": [{"message": {"content": "Hello."}, "finish_reason": "stop"}],
                        "usage": {"total_tokens": 3}
                    }))
                    .into_response()
                }
            }),
        )
        .route(
            "/images",
            post(move |Json(body): Json<Value>| {
                let calls = image_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    if let Some(delay) = pace(&body) {
                        tokio::time::sleep(delay).await;
                    }
                    Json(json!({"model": IMAGE_MODEL,
                        "data": [{"b64_json": PNG, "media_type": "image/png"}]}))
                }
            }),
        )
        .route(
            "/audio/speech",
            post(move |Json(body): Json<Value>| {
                let calls = voice_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    if let Some(delay) = pace(&body) {
                        tokio::time::sleep(delay).await;
                    }
                    ([("content-type", "audio/mpeg")], vec![255u8, 251, 144])
                }
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new().nest("/openrouter.ai", inner);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let registry = json!({
        "schema_version": 1, "snapshot_version": "spend-fixture-1",
        "declared": [{
            "requested_model_id": CHAT_MODEL, "provider": "openrouter",
            "concrete_model": {"model_id": CHAT_MODEL},
            "input_modalities": ["text"], "output_modalities": ["text"],
            "supported_parameters": {"stop": true}, "capabilities": ["voice"],
            "data_policy": {"retention": "none", "training": "prohibited"},
            "prompt_adapter": {"id": "openai-chat", "version": "1"},
            "sampling": {"hard_output_cap": 2048}
        }, {
            "requested_model_id": IMAGE_MODEL, "provider": "openrouter",
            "concrete_model": {"model_id": IMAGE_MODEL},
            "input_modalities": ["text"], "output_modalities": ["image"],
            "capabilities": ["image_generation"],
            "data_policy": {"retention": "provider_default", "training": "prohibited"},
            "prompt_adapter": {"id": "openrouter-image", "version": "1"}
        }]
    });
    AiConfig {
        api_key: key.to_string(),
        base_url: format!("http://{address}/openrouter.ai"),
        server_paid: true,
        model: "test-model".to_string(),
        registry: Some(Arc::new(
            CapabilityRegistrySnapshot::from_json(&registry.to_string()).unwrap(),
        )),
        capability_models: BTreeMap::from([
            (ModelCapability::ImageGeneration, IMAGE_MODEL.into()),
            (ModelCapability::Voice, CHAT_MODEL.into()),
        ]),
        data_policy_mode: DataPolicyMode::Development,
        ..AiConfig::default()
    }
}

fn unique_key(name: &str) -> String {
    format!("spend-test-{name}-{}", crate::random_hex(6))
}

async fn chat(config: &AiConfig, user: &str) -> Result<AiCompletion, AiGatewayError> {
    request_chat_completion(
        config,
        ChatCompletionRequest {
            feature: "spend_test",
            prompt_version: "spend-test-v1",
            capability: ModelCapability::Voice,
            system: "Write one line.",
            user,
            temperature: 0.7,
            max_tokens: 64,
            timeout: Duration::from_secs(10),
            max_attempts: 1,
            referer: "http://127.0.0.1",
            response_format: None,
            room_id: None,
        },
    )
    .await
}

async fn image(config: &AiConfig, prompt: &str) -> Result<AiGeneratedImage, AiGatewayError> {
    request_image_generation_for_key(
        config,
        ImageGenerationRequest {
            options: Default::default(),
            feature: "spend_test_image",
            prompt_version: "spend-image-v1",
            prompt,
            reference: None,
            timeout: Duration::from_secs(10),
            max_attempts: 1,
            referer: "http://127.0.0.1",
        },
        "spend:1",
    )
    .await
}

async fn voice(config: &AiConfig, input: &str) -> Result<Vec<u8>, String> {
    crate::routes::card_voices::synthesize(config, &json!({"input": input})).await
}

fn reserved(config: &AiConfig) -> u64 {
    server_spend_ledger(config)
        .reserved_micro_usd
        .load(Ordering::SeqCst)
}

/// Start the slow call, give it time to be admitted, then time a fast chat.
async fn fast_chat_while<F>(config: &AiConfig, slow: F) -> Duration
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    let slow = tokio::spawn(slow);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = Instant::now();
    chat(config, "fast").await.expect("fast chat completes");
    let elapsed = started.elapsed();
    slow.await.expect("slow call completes");
    elapsed
}

#[tokio::test]
async fn a_slow_image_does_not_hold_up_chat() {
    let config = provider(1.0, &unique_key("img"), Arc::default()).await;
    let slow = {
        let config = config.clone();
        async move { image(&config, "slow painting").await.expect("slow image") }
    };
    let elapsed = fast_chat_while(&config, slow).await;
    assert!(
        elapsed < SLOW / 2,
        "chat waited {elapsed:?} behind an image"
    );
}

#[tokio::test]
async fn a_slow_chat_does_not_hold_up_chat() {
    let config = provider(1.0, &unique_key("chat"), Arc::default()).await;
    let slow = {
        let config = config.clone();
        async move { chat(&config, "slow").await.expect("slow chat") }
    };
    let elapsed = fast_chat_while(&config, slow).await;
    assert!(elapsed < SLOW / 2, "chat waited {elapsed:?} behind a chat");
}

#[tokio::test]
async fn a_slow_voice_does_not_hold_up_chat_and_an_image_does_not_wait_for_chat() {
    let config = provider(1.0, &unique_key("voice"), Arc::default()).await;
    let slow = {
        let config = config.clone();
        async move { voice(&config, "slow words").await.expect("slow voice") }
    };
    let elapsed = fast_chat_while(&config, slow).await;
    assert!(elapsed < SLOW / 2, "chat waited {elapsed:?} behind a voice");

    let slow_chat = tokio::spawn({
        let config = config.clone();
        async move { chat(&config, "slow").await.expect("slow chat") }
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = Instant::now();
    image(&config, "fast painting").await.expect("fast image");
    assert!(started.elapsed() < SLOW / 2, "image queued behind chat");
    slow_chat.await.unwrap();
}

#[tokio::test]
async fn concurrent_calls_near_the_ceiling_admit_only_what_the_budget_covers() {
    // 19.95 used; each chat reserves 0.02, so in-flight totals of 19.95,
    // 19.97 and 19.99 admit and the fourth would reach 20.01.
    let calls = Arc::new(AtomicUsize::new(0));
    let config = provider(19.95, &unique_key("ceiling"), calls.clone()).await;
    let results = futures_util::future::join_all((0..8).map(|_| chat(&config, "slow"))).await;
    let admitted = results.iter().filter(|result| result.is_ok()).count();
    assert_eq!(admitted, 3);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    for refused in results.iter().filter_map(|result| result.as_ref().err()) {
        assert_eq!(refused.code(), "inference_daily_spend_exhausted");
    }
    assert_eq!(reserved(&config), 0);
}

#[tokio::test]
async fn a_finished_call_releases_its_reservation() {
    let config = provider(19.99, &unique_key("release"), Arc::default()).await;
    let first = enforce_server_paid_daily_limit(&config, "spend_test")
        .await
        .expect("admitted");
    assert_eq!(reserved(&config), 20_000);
    let blocked = enforce_server_paid_daily_limit(&config, "spend_test").await;
    assert!(blocked.is_err_and(|error| error.code() == "inference_daily_spend_exhausted"));
    drop(first);
    assert_eq!(reserved(&config), 0);
    assert!(enforce_server_paid_daily_limit(&config, "spend_test")
        .await
        .is_ok());
}

#[tokio::test]
async fn a_failed_provider_call_releases_its_reservation() {
    let calls = Arc::new(AtomicUsize::new(0));
    let config = provider(1.0, &unique_key("fail"), calls.clone()).await;
    chat(&config, "boom").await.expect_err("provider rejects");
    assert_eq!(calls.load(Ordering::SeqCst), 1, "the call was admitted");
    assert_eq!(reserved(&config), 0);
}
