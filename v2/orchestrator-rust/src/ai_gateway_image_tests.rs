use super::{image_options::*, *};
use axum::{routing::post, Json, Router};
use std::sync::Mutex;
use tokio::net::TcpListener;

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const MODEL: &str = "openai/gpt-image-2.6-flare";

fn config(url: String, image_input: bool) -> AiConfig {
    let registry = json!({
        "schema_version": 1, "snapshot_version": "authoring-image-fixture-1",
        "declared": [{
            "requested_model_id": MODEL, "provider": "openrouter",
            "concrete_model": {"model_id": MODEL},
            "input_modalities": if image_input { vec!["text", "image"] } else { vec!["text"] },
            "output_modalities": ["image"], "capabilities": ["image_generation"],
            "data_policy": {"retention": "provider_default", "training": "prohibited"},
            "prompt_adapter": {"id": "openrouter-image", "version": "1"}
        }]
    });
    AiConfig {
        api_key: "fixture".into(),
        base_url: url,
        registry: Some(Arc::new(
            CapabilityRegistrySnapshot::from_json(&registry.to_string()).unwrap(),
        )),
        capability_models: BTreeMap::from([(ModelCapability::ImageGeneration, MODEL.into())]),
        data_policy_mode: DataPolicyMode::Production,
        ..AiConfig::default()
    }
}

fn request(reference: Option<ImageGenerationReference<'_>>) -> ImageGenerationRequest<'_> {
    ImageGenerationRequest {
        feature: "authoring_image_test",
        prompt_version: "portrait-v1",
        prompt: "Paint the same character holding a lantern",
        reference,
        options: Default::default(),
        timeout: Duration::from_secs(2),
        max_attempts: 1,
        referer: "http://127.0.0.1",
    }
}

#[tokio::test]
async fn keyed_image_options_preserve_defaults_and_accept_verified_references() {
    let captured = Arc::new(Mutex::new(Vec::<Value>::new()));
    let requests = Arc::clone(&captured);
    let app = Router::new().route(
        "/images",
        post(move |Json(body): Json<Value>| {
            requests.lock().unwrap().push(body);
            async {
                Json(
                    json!({"model": MODEL, "data": [{"b64_json": PNG, "media_type": "image/png"}]}),
                )
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = config(format!("http://{}", listener.local_addr().unwrap()), true);
    let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
    let baseline = request(None);
    let default = request_image_generation_for_key(&config, baseline, "authoring:1")
        .await
        .unwrap();
    let mut digest = Sha256::new();
    digest.update(b"authoring_image_test\0portrait-v1\0Paint the same character holding a lantern");
    assert_eq!(default.context_hash, format!("{:x}", digest.finalize()));
    let bytes = BASE64_STANDARD.decode(PNG).unwrap();
    let mut edited = request(Some(ImageGenerationReference {
        bytes: &bytes,
        content_type: "image/png",
    }));
    edited.options = ImageGenerationOptions {
        background: Some(ImageBackground::Transparent),
        output_format: Some(ImageFormat::Png),
        quality: Some(ImageQuality::Medium),
        aspect_ratio: Some(ImageAspectRatio::Portrait),
    };
    let first = request_image_generation_for_key(&config, edited, "authoring:1")
        .await
        .unwrap();
    edited.options.quality = Some(ImageQuality::High);
    let second = request_image_generation_for_key(&config, edited, "authoring:1")
        .await
        .unwrap();
    assert_ne!(first.context_hash, second.context_hash);
    assert_eq!(first.content_type, "image/png");
    assert_eq!(first.model_attribution.resolved_model_id, MODEL);
    edited.options.output_format = Some(ImageFormat::Webp);
    let error = request_image_generation_for_key(&config, edited, "authoring:1")
        .await
        .unwrap_err();
    assert_eq!(error.kind, AiFailureKind::InvalidResponse);
    let bodies = captured.lock().unwrap();
    assert_eq!(bodies.len(), 4);
    assert_eq!(
        bodies[0],
        json!({"model": MODEL, "prompt": baseline.prompt, "n": 1})
    );
    assert_eq!(bodies[1]["background"], "transparent");
    assert_eq!(bodies[1]["output_format"], "png");
    assert_eq!(bodies[1]["quality"], "medium");
    assert_eq!(bodies[1]["aspect_ratio"], "2:3");
    assert_eq!(
        bodies[1]["input_references"][0]["image_url"]["url"],
        format!("data:image/png;base64,{PNG}")
    );
    assert!(bodies[1].get("provider").is_none());
    server.abort();
}

#[tokio::test]
async fn invalid_image_options_and_references_fail_before_network() {
    let config = config("http://127.0.0.1:1".into(), true);
    let mut invalid = request(None);
    invalid.options.background = Some(ImageBackground::Transparent);
    for format in [None, Some(ImageFormat::Jpeg)] {
        invalid.options.output_format = format;
        let error = request_image_generation_for_key(&config, invalid, "authoring:1")
            .await
            .unwrap_err();
        assert_eq!(error.kind, AiFailureKind::Client);
        assert_eq!(error.attempts, 0);
    }
    let png = BASE64_STANDARD.decode(PNG).unwrap();
    let oversized = vec![0; IMAGE_GENERATION_MAX_BYTES + 1];
    for (bytes, content_type) in [
        (png.as_slice(), "image/jpeg"),
        (b"bad".as_slice(), "image/png"),
        (b"".as_slice(), "image/png"),
        (oversized.as_slice(), "image/png"),
        (png.as_slice(), "text/html"),
    ] {
        let error = request_image_generation_for_key(
            &config,
            request(Some(ImageGenerationReference {
                bytes,
                content_type,
            })),
            "authoring:1",
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind, AiFailureKind::Client);
        assert_eq!(error.attempts, 0);
    }
    let text_only = self::config("http://127.0.0.1:1".into(), false);
    let error = request_image_generation_for_key(
        &text_only,
        request(Some(ImageGenerationReference {
            bytes: &png,
            content_type: "image/png",
        })),
        "authoring:1",
    )
    .await
    .unwrap_err();
    assert_eq!(error.kind, AiFailureKind::Client);
    assert_eq!(error.attempts, 0);
}
