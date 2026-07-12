use serde_json::{json, Value};
use std::{collections::BTreeMap, fmt, time::Duration};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const GENERATION_DEFAULT_MODE_ENV: &str = "COSYWORLD_GENERATION_DEFAULT_MODE";
pub(crate) const GENERATION_FEATURE_MODES_ENV: &str = "COSYWORLD_GENERATION_FEATURE_MODES_JSON";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum GenerationMode {
    #[default]
    Off,
    Shadow,
    AutoBounded,
}

impl GenerationMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "off" => Ok(Self::Off),
            "shadow" => Ok(Self::Shadow),
            "auto" | "auto_bounded" => Ok(Self::AutoBounded),
            _ => Err(format!(
                "generation mode must be off, shadow, or auto_bounded; got {value:?}"
            )),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Shadow => "shadow",
            Self::AutoBounded => "auto_bounded",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct GenerationControls {
    default_mode: GenerationMode,
    feature_modes: BTreeMap<String, GenerationMode>,
}

impl GenerationControls {
    pub(crate) fn from_env() -> Result<Self, String> {
        let default_mode = std::env::var(GENERATION_DEFAULT_MODE_ENV).ok();
        let feature_modes = std::env::var(GENERATION_FEATURE_MODES_ENV).ok();
        Self::from_values(default_mode.as_deref(), feature_modes.as_deref())
    }

    pub(crate) fn from_values(
        default_mode: Option<&str>,
        feature_modes_json: Option<&str>,
    ) -> Result<Self, String> {
        let default_mode = default_mode
            .map(GenerationMode::parse)
            .transpose()?
            .unwrap_or_default();
        let raw_modes = match feature_modes_json.map(str::trim) {
            None | Some("") => BTreeMap::new(),
            Some(value) => serde_json::from_str::<BTreeMap<String, String>>(value)
                .map_err(|error| format!("{GENERATION_FEATURE_MODES_ENV} must be a JSON object of feature-to-mode strings: {error}"))?,
        };
        let mut feature_modes = BTreeMap::new();
        for (feature, mode) in raw_modes {
            if feature.is_empty()
                || feature.len() > 64
                || !feature.chars().all(|character| {
                    character.is_ascii_lowercase()
                        || character.is_ascii_digit()
                        || "_.-".contains(character)
                })
            {
                return Err(format!("invalid generation feature id {feature:?}"));
            }
            feature_modes.insert(feature, GenerationMode::parse(&mode)?);
        }
        Ok(Self {
            default_mode,
            feature_modes,
        })
    }

    pub(crate) fn default_mode(&self) -> GenerationMode {
        self.default_mode
    }

    pub(crate) fn mode(&self, feature: &str) -> GenerationMode {
        self.feature_modes
            .get(feature)
            .copied()
            .unwrap_or(self.default_mode)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AiConfig {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
}

impl AiConfig {
    pub(crate) fn from_env() -> Option<Self> {
        let api_key = std::env::var("COSYWORLD_AI_API_KEY")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
            .or_else(|| std::env::var("OPENAI_API_KEY").ok())
            .filter(|key| !key.trim().is_empty());

        let using_openrouter = std::env::var("OPENROUTER_API_KEY").is_ok()
            || std::env::var("COSYWORLD_AI_PROVIDER")
                .map(|provider| provider.eq_ignore_ascii_case("openrouter"))
                .unwrap_or(false);
        let base_url = std::env::var("COSYWORLD_AI_BASE_URL").unwrap_or_else(|_| {
            if using_openrouter {
                "https://openrouter.ai/api/v1".to_string()
            } else {
                "https://api.openai.com/v1".to_string()
            }
        });
        let base_url = base_url.trim_end_matches('/').to_string();
        let api_key = match api_key {
            Some(key) => key,
            None if local_ai_base_url(&base_url) => "local-ai".to_string(),
            None => return None,
        };
        let model = std::env::var("COSYWORLD_AI_MODEL")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_CHAT_MODEL").ok())
            .or_else(|| std::env::var("OPENAI_MODEL").ok())
            .unwrap_or_else(|| {
                if using_openrouter {
                    DEFAULT_OPENROUTER_CHAT_MODEL.to_string()
                } else {
                    DEFAULT_OPENAI_CHAT_MODEL.to_string()
                }
            });

        Some(Self {
            api_key,
            base_url,
            model,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AiFailureKind {
    Unconfigured,
    Client,
    Timeout,
    Transport,
    Provider,
    InvalidResponse,
}

impl AiFailureKind {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Unconfigured => "inference_unconfigured",
            Self::Client => "inference_client_error",
            Self::Timeout => "inference_timeout",
            Self::Transport => "inference_transport_error",
            Self::Provider => "inference_provider_error",
            Self::InvalidResponse => "inference_invalid_response",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AiGatewayError {
    kind: AiFailureKind,
    message: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
}

impl AiGatewayError {
    pub(crate) fn unconfigured(feature: &str) -> Self {
        Self {
            kind: AiFailureKind::Unconfigured,
            message: format!("AI {feature} inference is not configured"),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    pub(crate) fn invalid_response(message: impl Into<String>) -> Self {
        Self {
            kind: AiFailureKind::InvalidResponse,
            message: message.into(),
            attempts: 1,
            latency: Duration::ZERO,
        }
    }

    pub(crate) fn code(&self) -> &'static str {
        self.kind.code()
    }
}

impl fmt::Display for AiGatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} (code={}, attempts={}, latency_ms={})",
            self.message,
            self.code(),
            self.attempts,
            self.latency.as_millis()
        )
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ChatCompletionRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) system: &'a str,
    pub(crate) user: &'a str,
    pub(crate) temperature: f64,
    pub(crate) max_tokens: u32,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
    pub(crate) response_format: Option<&'a Value>,
}

#[derive(Clone, Debug)]
pub(crate) struct AiCompletion {
    pub(crate) text: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
}

pub(crate) async fn request_chat_completion(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
) -> Result<AiCompletion, AiGatewayError> {
    let started_at = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(request.timeout)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{} client setup failed: {error}", request.feature),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/chat/completions", config.base_url);
    let max_attempts = request.max_attempts.max(1);

    for attempt in 1..=max_attempts {
        let mut payload = json!({
            "model": config.model,
            "messages": [
                { "role": "system", "content": request.system },
                { "role": "user", "content": request.user }
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens
        });
        if let Some(response_format) = request.response_format {
            payload["response_format"] = response_format.clone();
        }
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", request.referer)
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .json(&payload)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let kind = if error.is_timeout() {
                    AiFailureKind::Timeout
                } else {
                    AiFailureKind::Transport
                };
                let retryable = error.is_timeout() || error.is_connect();
                if retryable && attempt < max_attempts {
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(AiGatewayError {
                    kind,
                    message: format!("{} request failed: {error}", request.feature),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                });
            }
        };

        let status = response.status();
        if !status.is_success() {
            let retryable = status.as_u16() == 429 || status.is_server_error();
            if retryable && attempt < max_attempts {
                sleep(retry_delay(attempt)).await;
                continue;
            }
            return Err(AiGatewayError {
                kind: AiFailureKind::Provider,
                message: format!("{} provider returned HTTP {status}", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }

        let body: serde_json::Value = response.json().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{} response was not valid JSON: {error}", request.feature),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
        let text = body
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response did not include message content",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;

        tracing::info!(
            feature = request.feature,
            provider = ai_provider_name(Some(config)),
            model = config.model,
            attempts = attempt,
            latency_ms = started_at.elapsed().as_millis() as u64,
            "CosyWorld AI inference completed"
        );
        return Ok(AiCompletion {
            text,
            attempts: attempt,
            latency: started_at.elapsed(),
        });
    }

    unreachable!("the bounded AI attempt loop always returns")
}

fn retry_delay(attempt: u8) -> Duration {
    Duration::from_millis(150 * u64::from(attempt))
}

pub(crate) fn local_ai_base_url(base_url: &str) -> bool {
    base_url.starts_with("http://127.0.0.1:")
        || base_url.starts_with("http://localhost:")
        || base_url.starts_with("http://[::1]:")
}

pub(crate) fn ai_provider_name(config: Option<&AiConfig>) -> &'static str {
    let Some(config) = config else {
        return "unconfigured";
    };
    if config.base_url.contains("openrouter.ai") {
        "openrouter"
    } else if config.base_url.contains("api.openai.com") {
        "openai"
    } else {
        "openai_compatible"
    }
}

pub(crate) fn ai_model_name(config: Option<&AiConfig>) -> String {
    config
        .map(|config| config.model.clone())
        .unwrap_or_else(|| "none".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, response::IntoResponse, routing::post, Json, Router};
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;

    #[test]
    fn provider_names_follow_the_configured_endpoint() {
        let config = |base_url: &str| AiConfig {
            api_key: "test".to_string(),
            base_url: base_url.to_string(),
            model: "test-model".to_string(),
        };
        assert_eq!(
            ai_provider_name(Some(&config("https://openrouter.ai/api/v1"))),
            "openrouter"
        );
        assert_eq!(
            ai_provider_name(Some(&config("https://api.openai.com/v1"))),
            "openai"
        );
        assert_eq!(
            ai_provider_name(Some(&config("http://127.0.0.1:8080/v1"))),
            "openai_compatible"
        );
        assert_eq!(ai_provider_name(None), "unconfigured");
    }

    #[test]
    fn local_sidecars_are_keyless_but_remote_endpoints_are_not() {
        assert!(local_ai_base_url("http://127.0.0.1:8080/v1"));
        assert!(local_ai_base_url("http://localhost:8080/v1"));
        assert!(!local_ai_base_url("https://openrouter.ai/api/v1"));
        assert!(!local_ai_base_url("https://api.openai.com/v1"));
    }

    #[test]
    fn gateway_errors_have_stable_telemetry_codes() {
        assert_eq!(
            AiGatewayError::unconfigured("dialogue").code(),
            "inference_unconfigured"
        );
        assert_eq!(
            AiGatewayError::invalid_response("bad response").code(),
            "inference_invalid_response"
        );
    }

    #[test]
    fn generation_controls_are_feature_scoped_and_fail_closed_on_bad_configuration() {
        assert_eq!(
            GenerationControls::default().default_mode(),
            GenerationMode::Off,
            "unreviewed generation features must default off"
        );
        let controls = GenerationControls::from_values(
            Some("shadow"),
            Some(r#"{"pathway_content":"auto_bounded","room.memory":"off"}"#),
        )
        .expect("valid generation controls");
        assert_eq!(controls.default_mode(), GenerationMode::Shadow);
        assert_eq!(
            controls.mode("pathway_content"),
            GenerationMode::AutoBounded
        );
        assert_eq!(controls.mode("room.memory"), GenerationMode::Off);
        assert_eq!(controls.mode("dialogue_avatar"), GenerationMode::Shadow);
        assert!(GenerationControls::from_values(Some("unbounded"), None).is_err());
        assert!(GenerationControls::from_values(None, Some(r#"{"Bad Feature":"off"}"#)).is_err());
    }

    #[tokio::test]
    async fn gateway_retries_transient_provider_failures_once() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let structured_format_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let attempts = attempts.clone();
                let structured_format_seen = structured_format_seen.clone();
                move |Json(body): Json<Value>| {
                    let attempts = attempts.clone();
                    let structured_format_seen = structured_format_seen.clone();
                    async move {
                        if body
                            .pointer("/response_format/json_schema/name")
                            .and_then(Value::as_str)
                            == Some("retry_test_schema")
                        {
                            structured_format_seen.store(true, Ordering::SeqCst);
                        }
                        if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                            return (StatusCode::BAD_GATEWAY, "try again").into_response();
                        }
                        Json(json!({
                            "choices": [{ "message": { "content": "The kettle behaves." } }]
                        }))
                        .into_response()
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind AI gateway retry test server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "test-model".to_string(),
        };
        let response_format = json!({
            "type": "json_schema",
            "json_schema": {
                "name": "retry_test_schema",
                "strict": true,
                "schema": { "type": "object" }
            }
        });

        let completion = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "retry_test",
                system: "system",
                user: "user",
                temperature: 0.0,
                max_tokens: 20,
                timeout: Duration::from_secs(2),
                max_attempts: 2,
                referer: "http://127.0.0.1",
                response_format: Some(&response_format),
            },
        )
        .await
        .expect("transient provider failure should retry");

        assert_eq!(completion.text, "The kettle behaves.");
        assert_eq!(completion.attempts, 2);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(structured_format_seen.load(Ordering::SeqCst));
        server.abort();
    }
}
