use serde_json::json;
use std::{fmt, time::Duration};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";

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
}

#[derive(Clone, Debug)]
pub(crate) struct AiCompletion {
    pub(crate) text: String,
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
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", request.referer)
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .json(&json!({
                "model": config.model,
                "messages": [
                    { "role": "system", "content": request.system },
                    { "role": "user", "content": request.user }
                ],
                "temperature": request.temperature,
                "max_tokens": request.max_tokens
            }))
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
        return Ok(AiCompletion { text });
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
        atomic::{AtomicUsize, Ordering},
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

    #[tokio::test]
    async fn gateway_retries_transient_provider_failures_once() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let attempts = attempts.clone();
                move || {
                    let attempts = attempts.clone();
                    async move {
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
            },
        )
        .await
        .expect("transient provider failure should retry");

        assert_eq!(completion.text, "The kettle behaves.");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        server.abort();
    }
}
