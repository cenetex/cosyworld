#[path = "ai_image_options.rs"]
pub(crate) mod image_options;

#[path = "ai_gateway_stream.rs"]
mod streaming;

#[path = "ai_registry.rs"]
mod registry;

#[cfg(feature = "embedded-llama")]
#[path = "card_llama.rs"]
pub(crate) mod llama;

use super::compact_whitespace;
use crate::ai_readiness::{
    AiReadiness, AiReadinessGate, AiReadinessSnapshot, DEFAULT_LOW_CREDIT_THRESHOLD,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
pub(crate) use registry::{
    CapabilityRegistrySnapshot, ConcreteModelIdentity, DataPolicyMode, ModelAttribution,
    ModelCapability, PinnedModelSelection, RegistryError, AI_CAPABILITY_MODELS_ENV,
    AI_REGISTRY_ENV,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fmt,
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "openai/gpt-5.4-nano";
pub(crate) const DEFAULT_OPENROUTER_METACOGNITIVE_MODEL: &str = "openai/gpt-5.6-sol";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const OPENROUTER_METACOGNITIVE_MODEL_ENV: &str = "OPENROUTER_METACOGNITIVE_MODEL";
pub(crate) const OPENROUTER_FREE_MODEL: &str = "openrouter/free";
/// OpenRouter attributes usage to the app named by these headers on every request.
pub(crate) const OPENROUTER_APP_REFERER: &str = "https://lonelyforest.com";
pub(crate) const OPENROUTER_APP_TITLE: &str = "Lonely Forest";
pub(crate) const AI_LOW_CREDIT_THRESHOLD_ENV: &str = "COSYWORLD_AI_LOW_CREDIT_THRESHOLD";
const IMAGE_GENERATION_MAX_BYTES: usize = 8 * 1024 * 1024;
const IMAGE_GENERATION_MAX_RESPONSE_BYTES: u64 = 12 * 1024 * 1024;
const IMAGE_GENERATION_MAX_PROMPT_BYTES: usize = 16 * 1024;
const CHAT_COMPLETIONS_ENDPOINT: &str = "chat/completions";
const IMAGE_GENERATION_ENDPOINT: &str = "images";
const OPENROUTER_CURRENT_KEY_ENDPOINT: &str = "key";
const OPENROUTER_KEY_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const OPENROUTER_KEY_RESPONSE_MAX_BYTES: usize = 64 * 1024;
const OPENROUTER_ROOM_SESSION_PREFIX: &str = "cosyworld-room-";
const SERVER_PAID_DAILY_LIMIT_USD: f64 = 20.0;
static SERVER_PAID_INFERENCE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
// Bound model residents are the models they represent, including when that
// model reasons before it speaks. Keep the published speech bounded in the
// deterministic voice gate, but let the provider manage the private reasoning
// budget instead of forcing thought and speech through one tiny token cap.
const RAW_DIALOGUE_REASONING_MODE: &str = "enabled";
const REASONING_TRACE_MAX_CHARS: usize = 2_048;
const REASONING_MANDATORY_ERROR: &str =
    "reasoning is mandatory for this endpoint and cannot be disabled";

#[derive(Clone, Debug, Default)]
pub(crate) struct AiConfig {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) server_paid: bool,
    pub(crate) model: String,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) registry: Option<Arc<CapabilityRegistrySnapshot>>,
    pub(crate) capability_models: BTreeMap<ModelCapability, String>,
    pub(crate) data_policy_mode: DataPolicyMode,
    pub(crate) readiness: AiReadiness,
}

impl AiConfig {
    #[cfg(test)]
    pub(crate) fn for_transient_openrouter(&self, api_key: String) -> Self {
        let mut config = self.clone();
        config.api_key = api_key;
        config.base_url = "https://openrouter.ai/api/v1".to_string();
        config.server_paid = false;
        config.readiness =
            AiReadiness::ready_with_low_credit_threshold(DEFAULT_LOW_CREDIT_THRESHOLD);
        config
    }

    pub(crate) fn from_env() -> Result<Option<Self>, String> {
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
        let api_key = match enabled_ai_api_key(api_key, &base_url) {
            Some(key) => key,
            None => return Ok(None),
        };
        let low_credit_threshold =
            parse_low_credit_threshold(std::env::var(AI_LOW_CREDIT_THRESHOLD_ENV).ok().as_deref())?;
        let configured_model = std::env::var("COSYWORLD_AI_MODEL")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_CHAT_MODEL").ok())
            .or_else(|| std::env::var("OPENAI_MODEL").ok());
        let data_policy_mode = if std::env::var("COSYWORLD_DEPLOY_PROFILE")
            .map(|profile| profile.eq_ignore_ascii_case("production"))
            .unwrap_or(false)
        {
            DataPolicyMode::Production
        } else {
            DataPolicyMode::Development
        };
        let registry = std::env::var(AI_REGISTRY_ENV)
            .ok()
            .map(|value| {
                CapabilityRegistrySnapshot::from_json(&value)
                    .map(Arc::new)
                    .map_err(|error| format!("{AI_REGISTRY_ENV}: {error}"))
            })
            .transpose()?;
        require_explicit_production_registry(registry.as_deref(), data_policy_mode)?;
        let model = configured_model.unwrap_or_else(|| {
            registry
                .as_deref()
                .and_then(|snapshot| snapshot.first_model_for(ModelCapability::Voice))
                .map(ToString::to_string)
                .unwrap_or_else(|| {
                    if using_openrouter {
                        DEFAULT_OPENROUTER_CHAT_MODEL.to_string()
                    } else {
                        DEFAULT_OPENAI_CHAT_MODEL.to_string()
                    }
                })
        });
        let reasoning_effort = using_openrouter
            .then(|| std::env::var("OPENROUTER_REASONING_EFFORT").ok())
            .flatten()
            .map(|effort| effort.trim().to_ascii_lowercase())
            .filter(|effort| !effort.is_empty());
        let capability_models =
            parse_capability_models(std::env::var(AI_CAPABILITY_MODELS_ENV).ok().as_deref())?;
        // Development does not require an operator registry, but it still
        // preserves the production capability boundary: cheap character voice
        // is not silently promoted into intent planning or world generation.
        let runtime_registry = if registry.is_some() {
            registry.clone()
        } else if using_openrouter {
            Some(Arc::new(
                CapabilityRegistrySnapshot::legacy_split(
                    "legacy-openrouter-split-v1",
                    ai_provider_name_for_base_url(&base_url),
                    &model,
                    &std::env::var(OPENROUTER_METACOGNITIVE_MODEL_ENV)
                        .ok()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| DEFAULT_OPENROUTER_METACOGNITIVE_MODEL.to_string()),
                )
                .map_err(|error| format!("{AI_REGISTRY_ENV} legacy fallback: {error}"))?,
            ))
        } else {
            None
        };
        let fallback_registry;
        let effective_registry = if let Some(snapshot) = runtime_registry.as_deref() {
            snapshot
        } else {
            fallback_registry = CapabilityRegistrySnapshot::legacy(
                "legacy-config-v1",
                ai_provider_name_for_base_url(&base_url),
                &model,
            )
            .map_err(|error| format!("{AI_REGISTRY_ENV} legacy fallback: {error}"))?;
            &fallback_registry
        };
        validate_ai_routing_configuration(
            effective_registry,
            &capability_models,
            data_policy_mode,
        )?;
        let readiness = if ai_provider_name_for_base_url(&base_url) == "openrouter" {
            AiReadiness::probing_with_low_credit_threshold(low_credit_threshold)
        } else {
            AiReadiness::ready_with_low_credit_threshold(low_credit_threshold)
        };
        Ok(Some(Self {
            api_key,
            base_url,
            server_paid: true,
            model,
            reasoning_effort,
            registry: runtime_registry,
            capability_models,
            data_policy_mode,
            readiness,
        }))
    }

    pub(crate) fn pin_model(
        &self,
        capability: ModelCapability,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let fallback_registry;
        let registry = if let Some(registry) = self.registry.as_deref() {
            registry
        } else {
            fallback_registry = CapabilityRegistrySnapshot::legacy(
                "legacy-config-v1",
                ai_provider_name(Some(self)),
                &self.model,
            )?;
            &fallback_registry
        };
        let configured = if let Some(model) = self.capability_models.get(&capability) {
            Some(model.as_str())
        } else if self.registry.is_none()
            || registry
                .pin(capability, Some(self.model.as_str()), self.data_policy_mode)
                .is_ok()
        {
            Some(self.model.as_str())
        } else {
            None
        };
        registry.pin(capability, configured, self.data_policy_mode)
    }

    fn pin_model_for_key(
        &self,
        capability: ModelCapability,
        routing_key: &str,
    ) -> Result<PinnedModelSelection, RegistryError> {
        // A capability-specific override is an operator pin and therefore
        // wins over exploration. The legacy global model is only a default;
        // when a reviewed registry exposes a pool, stable keyed sampling keeps
        // one avatar consistent while spreading different avatars across it.
        if self.capability_models.contains_key(&capability) {
            return self.pin_model(capability);
        }
        let candidates = self.pin_models(capability)?;
        let digest = Sha256::digest(format!("{capability:?}\0{routing_key}").as_bytes());
        let index = u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 routing prefix"))
            as usize
            % candidates.len();
        Ok(candidates[index].clone())
    }

    pub(crate) fn pin_models(
        &self,
        capability: ModelCapability,
    ) -> Result<Vec<PinnedModelSelection>, RegistryError> {
        if let Some(registry) = self.registry.as_deref() {
            return registry.pin_all(capability, self.data_policy_mode);
        }
        CapabilityRegistrySnapshot::legacy(
            "legacy-config-v1",
            ai_provider_name(Some(self)),
            &self.model,
        )?
        .pin_all(capability, self.data_policy_mode)
    }

    pub(crate) fn readiness_snapshot(&self) -> AiReadinessSnapshot {
        self.readiness.snapshot()
    }

    pub(crate) fn recommended_readiness_probe_delay(&self) -> Duration {
        self.readiness.recommended_probe_delay()
    }

    pub(crate) fn exact_route_gate(
        &self,
        endpoint: &str,
        requested_model_id: &str,
    ) -> AiReadinessGate {
        self.readiness.gate(endpoint, requested_model_id)
    }

    #[allow(dead_code)]
    pub(crate) fn global_chat_route_is_ready(&self) -> bool {
        self.pin_models(ModelCapability::Voice)
            .is_ok_and(|selections| {
                !selections.is_empty()
                    && selections.iter().any(|selection| {
                        self.exact_route_gate(
                            CHAT_COMPLETIONS_ENDPOINT,
                            selection.requested_model_id(),
                        )
                        .is_ready()
                    })
            })
    }
}

fn enabled_ai_api_key(api_key: Option<String>, base_url: &str) -> Option<String> {
    api_key.or_else(|| local_ai_base_url(base_url).then(|| "local-ai".to_string()))
}

fn parse_low_credit_threshold(value: Option<&str>) -> Result<f64, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(DEFAULT_LOW_CREDIT_THRESHOLD);
    };
    let threshold = value.parse::<f64>().map_err(|_| {
        format!("{AI_LOW_CREDIT_THRESHOLD_ENV} must be a finite number from 0 through 10000")
    })?;
    if !threshold.is_finite() || !(0.0..=10_000.0).contains(&threshold) {
        return Err(format!(
            "{AI_LOW_CREDIT_THRESHOLD_ENV} must be a finite number from 0 through 10000"
        ));
    }
    Ok(threshold)
}

fn require_explicit_production_registry(
    registry: Option<&CapabilityRegistrySnapshot>,
    data_policy_mode: DataPolicyMode,
) -> Result<(), String> {
    if data_policy_mode == DataPolicyMode::Production && registry.is_none() {
        return Err(format!(
            "{AI_REGISTRY_ENV} is required when AI is enabled and COSYWORLD_DEPLOY_PROFILE=production. Configure a reviewed capability registry (for Fly, set its [env] entry in fly.toml), or disable AI by unsetting COSYWORLD_AI_API_KEY, OPENROUTER_API_KEY, and OPENAI_API_KEY and not configuring a local AI base URL."
        ));
    }
    Ok(())
}

fn validate_ai_routing_configuration(
    registry: &CapabilityRegistrySnapshot,
    capability_models: &BTreeMap<ModelCapability, String>,
    data_policy_mode: DataPolicyMode,
) -> Result<(), String> {
    // An explicit override is the effective choice for a direct capability
    // request, so validate it before accepting the broader pool. Otherwise a
    // healthy pool can hide a configured model that fails every request.
    for (capability, model) in capability_models {
        registry
            .pin(*capability, Some(model), data_policy_mode)
            .map_err(|error| {
                format!(
                    "{AI_CAPABILITY_MODELS_ENV} configures {capability} as {model:?}, but {AI_REGISTRY_ENV} cannot pin that effective selection ({}): {error}",
                    error.code()
                )
            })?;
    }

    // Audit the same effective snapshot runtime pinning uses. Production still
    // refuses a registry that leaves a required capability entirely uncovered;
    // data-policy declarations remain attribution rather than pool coverage.
    let coverage = registry.audit_required_capabilities(data_policy_mode);
    if coverage.is_fatal() {
        return Err(coverage.to_string());
    }
    if !coverage.is_covered() {
        tracing::error!("{coverage}");
    }
    Ok(())
}

fn parse_capability_models(
    value: Option<&str>,
) -> Result<BTreeMap<ModelCapability, String>, String> {
    let raw = match value.map(str::trim) {
        None | Some("") => return Ok(BTreeMap::new()),
        Some(value) => serde_json::from_str::<BTreeMap<ModelCapability, String>>(value)
            .map_err(|error| {
                format!(
                    "{AI_CAPABILITY_MODELS_ENV} must map voice, intent_json, world_content, image_generation, speech_synthesis, transcription, embeddings, or rerank to model ids: {error}"
                )
            })?,
    };
    raw.into_iter()
        .map(|(capability, model)| {
            let model = model.trim().to_string();
            if model.is_empty() {
                Err(format!(
                    "{AI_CAPABILITY_MODELS_ENV} contains an empty {capability} model"
                ))
            } else {
                Ok((capability, model))
            }
        })
        .collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AiFailureKind {
    Registry,
    Capability,
    Alias,
    Client,
    Timeout,
    Transport,
    ProviderHttp {
        status: u16,
        retry_after_secs: Option<u64>,
    },
    Readiness {
        reason_code: &'static str,
        retry_at_unix: Option<u64>,
        terminal: bool,
    },
    InvalidResponse,
}

impl AiFailureKind {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Registry => "inference_registry_error",
            Self::Capability => "inference_capability_mismatch",
            Self::Alias => "inference_alias_unresolved",
            Self::Client => "inference_client_error",
            Self::Timeout => "inference_timeout",
            Self::Transport => "inference_transport_error",
            Self::ProviderHttp { .. } => "inference_provider_error",
            Self::Readiness { reason_code, .. } => reason_code,
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
    fn daily_spend_exhausted(feature: &str, retry_at_unix: u64) -> Self {
        Self {
            kind: AiFailureKind::Readiness {
                reason_code: "inference_daily_spend_exhausted",
                retry_at_unix: Some(retry_at_unix),
                terminal: true,
            },
            message: format!(
                "AI {feature} is paused because the ${SERVER_PAID_DAILY_LIMIT_USD:.0} UTC daily server budget is exhausted"
            ),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    fn daily_spend_check_unavailable(feature: &str) -> Self {
        Self {
            kind: AiFailureKind::Readiness {
                reason_code: "inference_daily_spend_check_unavailable",
                retry_at_unix: Some(current_unix_secs().saturating_add(60)),
                terminal: false,
            },
            message: format!("AI {feature} paused because server spend could not be verified"),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    fn registry(feature: &str, error: RegistryError) -> Self {
        let kind = match error.code() {
            "inference_capability_mismatch" => AiFailureKind::Capability,
            "inference_alias_unresolved" => AiFailureKind::Alias,
            _ => AiFailureKind::Registry,
        };
        Self {
            kind,
            message: format!("AI {feature} registry rejected the request: {error}"),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    pub(crate) fn readiness(feature: &str, gate: AiReadinessGate) -> Self {
        let reason_code = gate.reason_code().unwrap_or("ai_route_unavailable");
        Self {
            kind: AiFailureKind::Readiness {
                reason_code,
                retry_at_unix: gate.retry_at_unix(),
                terminal: gate.is_terminal_block(),
            },
            message: format!("AI {feature} exact route is not ready ({reason_code})"),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    fn provider_http(
        feature: &str,
        status: reqwest::StatusCode,
        retry_after: Option<Duration>,
        detail: Option<&str>,
        attempts: u8,
        latency: Duration,
    ) -> Self {
        Self {
            kind: AiFailureKind::ProviderHttp {
                status: status.as_u16(),
                retry_after_secs: retry_after.map(|duration| duration.as_secs()),
            },
            message: format!(
                "{feature} provider returned HTTP {status}{}",
                detail
                    .map(|detail| format!(": {detail}"))
                    .unwrap_or_default()
            ),
            attempts,
            latency,
        }
    }

    pub(crate) fn code(&self) -> &'static str {
        self.kind.code()
    }

    pub(crate) fn affects_provider_health(&self) -> bool {
        matches!(
            self.kind,
            AiFailureKind::Timeout
                | AiFailureKind::Transport
                | AiFailureKind::ProviderHttp { .. }
                | AiFailureKind::InvalidResponse
        )
    }

    pub(crate) fn provider_http_status(&self) -> Option<u16> {
        match self.kind {
            AiFailureKind::ProviderHttp { status, .. } => Some(status),
            _ => None,
        }
    }

    pub(crate) fn retry_after(&self) -> Option<Duration> {
        match self.kind {
            AiFailureKind::ProviderHttp {
                retry_after_secs: Some(seconds),
                ..
            } => Some(Duration::from_secs(seconds)),
            _ => None,
        }
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
    pub(crate) prompt_version: &'static str,
    pub(crate) capability: ModelCapability,
    pub(crate) system: &'a str,
    pub(crate) user: &'a str,
    pub(crate) temperature: f64,
    pub(crate) max_tokens: u32,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
    pub(crate) response_format: Option<&'a Value>,
    /// The canonical shared room associated with this inference. OpenRouter
    /// receives one stable session id per room; other providers receive no
    /// provider-specific session field.
    pub(crate) room_id: Option<u64>,
}

// Retained as truthful gateway execution metadata for audit correlation.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct AiCompletion {
    pub(crate) text: String,
    /// Readable provider reasoning, kept separate from publishable speech.
    /// Encrypted reasoning blocks are deliberately never copied here.
    pub(crate) reasoning_trace: Option<String>,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: Option<ModelAttribution>,
    pub(crate) resolved_model_id: String,
    pub(crate) finish_reason: String,
    pub(crate) usage: AiTokenUsage,
    pub(crate) context_hash: String,
    pub(crate) prompt_version: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct AiTokenUsage {
    pub(crate) prompt_tokens: Option<u64>,
    pub(crate) completion_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ImageGenerationRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) prompt: &'a str,
    pub(crate) reference: Option<ImageGenerationReference<'a>>,
    pub(crate) options: image_options::ImageGenerationOptions,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ImageGenerationReference<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) content_type: &'a str,
}

// Retained as truthful gateway execution metadata for audit correlation.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct AiGeneratedImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) content_type: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: ModelAttribution,
    pub(crate) usage: AiTokenUsage,
    pub(crate) context_hash: String,
    pub(crate) prompt_version: String,
}

#[cfg(feature = "embedded-llama")]
fn exact_endpoint_context_hash(
    feature: &str,
    prompt_version: &str,
    query: Option<&str>,
    values: &[String],
) -> String {
    let mut hasher = Sha256::new();
    for component in [feature, prompt_version].into_iter().chain(query) {
        hasher.update(component.len().to_be_bytes());
        hasher.update(component.as_bytes());
    }
    for value in values {
        hasher.update(value.len().to_be_bytes());
        hasher.update(value.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
pub(crate) async fn request_routed_chat_completion(
    config: &AiConfig,
    model: &str,
    request: ChatCompletionRequest<'_>,
) -> Result<AiCompletion, AiGatewayError> {
    let local_development_adapter = config.data_policy_mode == DataPolicyMode::Development
        && local_ai_base_url(&config.base_url);
    if (ai_provider_name(Some(config)) != "openrouter" && !local_development_adapter)
        || !model.starts_with("openrouter/")
    {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{} requires an OpenRouter router model", request.feature),
            attempts: 0,
            latency: Duration::ZERO,
        });
    }
    request_completion(
        config,
        request.feature,
        request.prompt_version,
        request.system,
        "",
        Value::String(request.user.to_string()),
        Some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        request.room_id,
        model,
        config.reasoning_effort.as_deref(),
        false,
        false,
        None,
        None,
    )
    .await
}

pub(crate) async fn request_chat_completion(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
) -> Result<AiCompletion, AiGatewayError> {
    request_chat_completion_progress(config, request, "", None).await
}

/// A character's line: `assistant` is its own first-person view, sent as
/// its own turn before what it heard (`request.user`); see `chat_messages`.
pub(crate) async fn request_voice_completion(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
    assistant: &str,
) -> Result<AiCompletion, AiGatewayError> {
    request_chat_completion_progress(config, request, assistant, None).await
}

async fn request_chat_completion_progress(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
    assistant: &str,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<AiCompletion, AiGatewayError> {
    let selection = config
        .pin_model(request.capability)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let raw_mode = selection.uses_raw_prompt_adapter();
    #[cfg(feature = "embedded-llama")]
    if config.base_url == "embedded://llama" {
        return llama::complete(request, assistant, selection.requested_model_id()).await;
    }
    request_completion(
        config,
        request.feature,
        request.prompt_version,
        request.system,
        assistant,
        Value::String(request.user.to_string()),
        (!raw_mode).then_some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        request.room_id,
        selection.requested_model_id(),
        if raw_mode {
            selection
                .candidate()
                .supported_parameters()
                .reasoning
                .then_some(RAW_DIALOGUE_REASONING_MODE)
        } else {
            config.reasoning_effort.as_deref()
        },
        raw_mode,
        selection.sends_openrouter_zdr_constraint(),
        Some(&selection),
        on_delta,
    )
    .await
}

fn add_exact_binding_zdr_constraint(payload: &mut Value, selection: &PinnedModelSelection) {
    if selection.sends_openrouter_zdr_constraint() {
        payload["provider"] = json!({
            "data_collection": "deny",
            "zdr": true,
        });
    }
}

pub(crate) async fn request_image_generation_for_key(
    config: &AiConfig,
    request: ImageGenerationRequest<'_>,
    routing_key: &str,
) -> Result<AiGeneratedImage, AiGatewayError> {
    let selection = config
        .pin_model_for_key(ModelCapability::ImageGeneration, routing_key)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let accepts_reference = selection.candidate().accepts_image_input();
    let result =
        request_image_generation_with_selection(config, &selection, request, accepts_reference)
            .await;
    if result.as_ref().is_err_and(|error| {
        error.affects_provider_health() && error.provider_http_status().is_none()
    }) {
        config
            .readiness
            .record_transport_failure(IMAGE_GENERATION_ENDPOINT, selection.requested_model_id());
    }
    result
}

async fn request_image_generation_with_selection(
    config: &AiConfig,
    selection: &PinnedModelSelection,
    request: ImageGenerationRequest<'_>,
    accepts_image_reference: bool,
) -> Result<AiGeneratedImage, AiGatewayError> {
    let started_at = Instant::now();
    if request.prompt.trim().is_empty() || request.prompt.len() > IMAGE_GENERATION_MAX_PROMPT_BYTES
    {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} prompt was empty or exceeded its byte limit",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let option_fields = request.options.fields().map_err(|message| AiGatewayError {
        kind: AiFailureKind::Client,
        message: format!("{} {message}", request.feature),
        attempts: 0,
        latency: started_at.elapsed(),
    })?;
    let reference_content_type = request
        .reference
        .map(|reference| normalize_generated_image_content_type(reference.content_type))
        .transpose()
        .map_err(|()| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} reference image MIME type was unsupported",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    if request.reference.is_some_and(|reference| {
        reference.bytes.is_empty()
            || reference.bytes.len() > IMAGE_GENERATION_MAX_BYTES
            || !accepts_image_reference
            || infer_generated_image_content_type(reference.bytes).as_deref()
                != reference_content_type.as_deref()
    }) {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} reference image was invalid for its exact model",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let gate = config.exact_route_gate(IMAGE_GENERATION_ENDPOINT, selection.requested_model_id());
    if !gate.is_ready() {
        return Err(AiGatewayError::readiness(request.feature, gate));
    }
    let _server_spend_guard = enforce_server_paid_daily_limit(config, request.feature).await?;
    let context_hash = {
        let mut hasher = Sha256::new();
        hasher.update(request.feature.as_bytes());
        hasher.update([0]);
        hasher.update(request.prompt_version.as_bytes());
        hasher.update([0]);
        hasher.update(request.prompt.as_bytes());
        if request.options != image_options::ImageGenerationOptions::default() {
            hasher.update([0]);
            hasher.update(option_fields.to_string().as_bytes());
        }
        if let Some(reference) = request.reference {
            hasher.update([0]);
            hasher.update(Sha256::digest(reference.bytes));
        }
        format!("{:x}", hasher.finalize())
    };
    let client = reqwest::Client::builder()
        .timeout(request.timeout)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{} client setup failed: {error}", request.feature),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/images", config.base_url);
    let max_attempts = request.max_attempts.max(1);
    for attempt in 1..=max_attempts {
        let mut payload = json!({
            "model": selection.requested_model_id(),
            "prompt": request.prompt,
            "n": 1,
        });
        payload
            .as_object_mut()
            .expect("image payload object")
            .extend(
                option_fields
                    .as_object()
                    .expect("image options object")
                    .clone(),
            );
        if let (Some(reference), Some(content_type)) =
            (request.reference, reference_content_type.as_deref())
        {
            payload["input_references"] = json!([{
                "type": "image_url",
                "image_url": {
                    "url": format!(
                        "data:{content_type};base64,{}",
                        BASE64_STANDARD.encode(reference.bytes)
                    )
                }
            }]);
        }
        add_exact_binding_zdr_constraint(&mut payload, selection);
        if selection.candidate().supported_parameters().seed {
            let digest = Sha256::digest(context_hash.as_bytes());
            payload["seed"] = json!(u32::from_be_bytes(
                digest[..4].try_into().expect("SHA-256 seed prefix")
            ));
        }
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", request.referer)
            .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE)
            .header("X-Title", OPENROUTER_APP_TITLE)
            .json(&payload)
            .send()
            .await;
        let mut response = match response {
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
                config.readiness.record_transport_failure(
                    IMAGE_GENERATION_ENDPOINT,
                    selection.requested_model_id(),
                );
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
            let retry_after = retry_after_from_headers(response.headers());
            let detail = provider_error_detail(response).await;
            config.readiness.record_http_failure(
                IMAGE_GENERATION_ENDPOINT,
                selection.requested_model_id(),
                status.as_u16(),
                retry_after,
            );
            return Err(AiGatewayError::provider_http(
                request.feature,
                status,
                retry_after,
                detail.as_deref(),
                attempt,
                started_at.elapsed(),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > IMAGE_GENERATION_MAX_RESPONSE_BYTES)
        {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} response exceeded the image size limit", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let mut response_bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!(
                "{} response body could not be read: {error}",
                request.feature
            ),
            attempts: attempt,
            latency: started_at.elapsed(),
        })? {
            if response_bytes.len().saturating_add(chunk.len())
                > IMAGE_GENERATION_MAX_RESPONSE_BYTES as usize
            {
                return Err(AiGatewayError {
                    kind: AiFailureKind::InvalidResponse,
                    message: format!("{} response exceeded the image size limit", request.feature),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                });
            }
            response_bytes.extend_from_slice(&chunk);
        }
        let body: Value =
            serde_json::from_slice(&response_bytes).map_err(|error| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} response was not valid JSON: {error}", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let data = body
            .get("data")
            .and_then(Value::as_array)
            .filter(|data| data.len() == 1)
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response did not include exactly one image",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let image = &data[0];
        let encoded = image
            .get("b64_json")
            .and_then(Value::as_str)
            .filter(|value| value.len() <= IMAGE_GENERATION_MAX_BYTES.saturating_mul(4) / 3 + 8)
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response did not include one bounded base64 image",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let bytes = BASE64_STANDARD
            .decode(encoded)
            .map_err(|error| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} image was not valid base64: {error}", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        if bytes.is_empty() || bytes.len() > IMAGE_GENERATION_MAX_BYTES {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} image exceeded the decoded size limit", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let declared_content_type = image
            .get("media_type")
            .and_then(Value::as_str)
            .map(normalize_generated_image_content_type)
            .transpose()
            .map_err(|()| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} returned an unsupported image MIME type",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let inferred_content_type =
            infer_generated_image_content_type(&bytes).ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} returned an unsupported image format", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        if declared_content_type
            .as_ref()
            .is_some_and(|declared| declared != &inferred_content_type)
        {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} image MIME type did not match its bytes",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let content_type = declared_content_type.unwrap_or(inferred_content_type);
        if request
            .options
            .content_type()
            .is_some_and(|expected| expected != content_type)
        {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} image format differed from its requested format",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let provider_model = body.get("model").and_then(Value::as_str);
        let model_attribution = selection
            .attribute_response(provider_model)
            .map_err(|error| {
                let mut error = AiGatewayError::registry(request.feature, error);
                error.attempts = attempt;
                error.latency = started_at.elapsed();
                error
            })?;
        let usage = body.get("usage");
        let usage = AiTokenUsage {
            prompt_tokens: usage
                .and_then(|usage| usage.get("prompt_tokens"))
                .and_then(Value::as_u64),
            completion_tokens: usage
                .and_then(|usage| usage.get("completion_tokens"))
                .and_then(Value::as_u64),
            total_tokens: usage
                .and_then(|usage| usage.get("total_tokens"))
                .and_then(Value::as_u64),
        };
        tracing::info!(
            feature = request.feature,
            provider = %model_attribution.provider,
            requested_model = %model_attribution.requested_model_id,
            resolved_model = %model_attribution.resolved_model_id,
            attempts = attempt,
            latency_ms = started_at.elapsed().as_millis() as u64,
            "CosyWorld AI image inference completed"
        );
        config
            .readiness
            .record_success(IMAGE_GENERATION_ENDPOINT, selection.requested_model_id());
        return Ok(AiGeneratedImage {
            bytes,
            content_type,
            attempts: attempt,
            latency: started_at.elapsed(),
            model_attribution,
            usage,
            context_hash,
            prompt_version: request.prompt_version.to_string(),
        });
    }
    unreachable!("the bounded AI image attempt loop always returns")
}

fn normalize_generated_image_content_type(value: &str) -> Result<String, ()> {
    match value.trim().to_ascii_lowercase().as_str() {
        "image/png" => Ok("image/png".to_string()),
        "image/jpeg" | "image/jpg" => Ok("image/jpeg".to_string()),
        "image/webp" => Ok("image/webp".to_string()),
        "image/gif" => Ok("image/gif".to_string()),
        _ => Err(()),
    }
}

fn infer_generated_image_content_type(bytes: &[u8]) -> Option<String> {
    match image::guess_format(bytes).ok()? {
        image::ImageFormat::Png => Some("image/png".to_string()),
        image::ImageFormat::Jpeg => Some("image/jpeg".to_string()),
        image::ImageFormat::WebP => Some("image/webp".to_string()),
        image::ImageFormat::Gif => Some("image/gif".to_string()),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReasoningCompatibilityFallback {
    Enable,
    Omit,
}

impl ReasoningCompatibilityFallback {
    fn as_str(self) -> &'static str {
        match self {
            Self::Enable => "enable",
            Self::Omit => "omit",
        }
    }
}

/// OpenRouter's catalog tells us whether a model accepts the unified reasoning
/// object, but it does not say whether reasoning is mandatory. Some provider
/// endpoints also lag the catalog and reject that object. Retry exactly once
/// with the compatible shape; the normal provider retry loop must not multiply
/// a deterministic request-shape error across every voice candidate round.
fn reasoning_compatibility_fallback(
    status: reqwest::StatusCode,
    detail: Option<&str>,
    current_reasoning: Option<&Value>,
) -> Option<ReasoningCompatibilityFallback> {
    if status != reqwest::StatusCode::BAD_REQUEST {
        return None;
    }
    let detail = detail?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let reasoning_is_disabled = current_reasoning.is_some_and(|reasoning| {
        reasoning.get("effort").and_then(Value::as_str) == Some("none")
            || reasoning.get("enabled").and_then(Value::as_bool) == Some(false)
    });
    let requested_effort = current_reasoning
        .and_then(|reasoning| reasoning.get("effort"))
        .and_then(Value::as_str);
    let requires_reasoning = detail.trim_end_matches(['.', ' ']) == REASONING_MANDATORY_ERROR
        || (detail.contains("reasoning")
            && (detail.contains("mandatory")
                || detail.contains("required")
                || detail.contains("must be enabled")
                || detail.contains("cannot be disabled")
                || detail.contains("can't be disabled")));
    if reasoning_is_disabled && requires_reasoning {
        return Some(ReasoningCompatibilityFallback::Enable);
    }
    let rejects_reasoning_control = detail.contains("reasoning")
        && (detail.contains("not supported")
            || detail.contains("unsupported")
            || detail.contains("unknown parameter")
            || detail.contains("unrecognized parameter")
            || (detail.contains("invalid")
                && requested_effort.is_some_and(|effort| detail.contains(effort))));
    (current_reasoning.is_some() && rejects_reasoning_control)
        .then_some(ReasoningCompatibilityFallback::Omit)
}

fn bounded_reasoning_trace(value: &str) -> Option<String> {
    let value = compact_whitespace(value);
    if value.is_empty() || value.eq_ignore_ascii_case("[redacted]") {
        return None;
    }
    if value.chars().count() <= REASONING_TRACE_MAX_CHARS {
        return Some(value);
    }
    let mut bounded = value
        .chars()
        .take(REASONING_TRACE_MAX_CHARS.saturating_sub(1))
        .collect::<String>();
    bounded.push('…');
    Some(bounded)
}

/// Chat-completion providers normally return a string, but OpenAI-compatible
/// gateways also emit text-part arrays. Accept both without treating tool,
/// image, or opaque parts as resident speech.
fn readable_message_content(message: &Value) -> Option<String> {
    let content = message.get("content")?;
    let text = if let Some(text) = content.as_str() {
        text.to_string()
    } else {
        content
            .as_array()?
            .iter()
            .filter_map(|part| {
                part.as_str().or_else(|| {
                    if part
                        .get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| !matches!(kind, "text" | "output_text"))
                    {
                        return None;
                    }
                    part.get("text")
                        .and_then(Value::as_str)
                        .or_else(|| part.get("content").and_then(Value::as_str))
                })
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Extracts only readable reasoning. Structured summaries are preferred over
/// raw text, while encrypted or redacted blocks are deliberately ignored.
fn readable_reasoning_trace(message: &Value) -> Option<String> {
    let details = message.get("reasoning_details").and_then(Value::as_array);
    let detail_fragments = |field: &str| {
        details
            .into_iter()
            .flatten()
            .filter_map(|detail| detail.get(field).and_then(Value::as_str))
            .filter_map(bounded_reasoning_trace)
            .collect::<Vec<_>>()
    };
    let summaries = detail_fragments("summary");
    if !summaries.is_empty() {
        return bounded_reasoning_trace(&summaries.join(" "));
    }
    let texts = detail_fragments("text");
    if !texts.is_empty() {
        return bounded_reasoning_trace(&texts.join(" "));
    }
    message
        .get("reasoning")
        .or_else(|| message.get("reasoning_content"))
        .and_then(Value::as_str)
        .and_then(bounded_reasoning_trace)
}

/// The user turn before a character's own view, and its words when it has
/// heard nothing. Claude and Gemma's template refuse a chat that opens on an
/// assistant turn; silence opens every call the same way. It is no
/// instruction.
pub(crate) const SILENCE: &str = "…";

/// Whether a user turn is a line someone said (`Pip says, “…”`), which a
/// prefilled reply answers; silence or a presence ("Pip is here.") is not.
pub(crate) fn heard_line(user: &str) -> bool {
    user.contains(" says, \u{201c}") && user.ends_with('\u{201d}')
}

/// How a gesture or emoji voice's system turn opens (`expression::direction`):
/// its check reads that shape, so its reply gets no opening quote.
pub(crate) const SHAPE: &str = "My next reply";

/// The opening quote a speaking voice's reply continues, where a provider
/// continues a final assistant turn: Mistral, and the desktop's embedded
/// llama.cpp (`card_llama`). Claude 4.6+ and Haiku 5.5 reject one (400) and
/// OpenAI starts a new turn instead.
const OPEN_QUOTE: &str = "\u{201c}";

/// The chat turns for a call (owner, 2026-11-03). An empty system voice is
/// left out. A character's own view (`assistant`) is its own earlier turn
/// after silence, and the call ends on what it heard, or, where the route
/// continues it, on the opening quote of its reply.
pub(crate) fn chat_messages(system: &str, assistant: &str, user: Value, quote: bool) -> Value {
    let mut turns = Vec::new();
    if !system.trim().is_empty() {
        turns.push(json!({ "role": "system", "content": system }));
    }
    if !assistant.is_empty() {
        turns.push(json!({ "role": "user", "content": SILENCE }));
        turns.push(json!({ "role": "assistant", "content": assistant }));
    }
    turns.push(json!({ "role": "user", "content": user }));
    if quote {
        // Mistral continues an assistant turn only when it is a prefix.
        turns.push(json!({ "role": "assistant", "content": OPEN_QUOTE, "prefix": true }));
    }
    Value::Array(turns)
}

/// A reply that continued its opening quote, as its speaker wrote it, and
/// whether a quote closed: the voice check keeps the speaker's own quoted
/// words (`card_narrative::speech`), so a tag naming someone else
/// (`Then stay,” Pip says`) still shows whose they were.
pub(crate) fn prefilled(text: &str) -> (String, bool) {
    let text = text.trim_start().trim_start_matches(['\u{201c}', '"']);
    let closed = text.contains(['\u{201d}', '"']);
    (format!("{OPEN_QUOTE}{text}"), closed)
}

#[allow(clippy::too_many_arguments)]
async fn request_completion(
    config: &AiConfig,
    feature: &'static str,
    prompt_version: &'static str,
    system: &str,
    assistant: &str,
    user_content: Value,
    temperature: Option<f64>,
    max_tokens: u32,
    timeout: Duration,
    max_attempts: u8,
    referer: &str,
    response_format: Option<&Value>,
    room_id: Option<u64>,
    model: &str,
    reasoning_effort: Option<&str>,
    raw_mode: bool,
    enforce_zero_data_retention: bool,
    selection: Option<&PinnedModelSelection>,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<AiCompletion, AiGatewayError> {
    let started_at = Instant::now();
    // A speaking voice (no system shape) that heard a line continues its
    // opening quote; speaking first, a prefill voiced the listener instead.
    let quote = !assistant.is_empty()
        && !system.starts_with(SHAPE)
        && user_content.as_str().is_some_and(heard_line)
        && model.starts_with("mistralai/");
    let context_hash = {
        let mut hasher = Sha256::new();
        hasher.update(feature.as_bytes());
        hasher.update([0]);
        hasher.update(prompt_version.as_bytes());
        hasher.update([0]);
        hasher.update(system.as_bytes());
        hasher.update([0]);
        if !assistant.is_empty() {
            hasher.update(assistant.as_bytes());
            hasher.update([0]);
        }
        hasher.update(user_content.to_string().as_bytes());
        format!("{:x}", hasher.finalize())
    };
    if let Some(selection) = selection {
        let parameters = selection.candidate().supported_parameters();
        let structured_type = response_format
            .and_then(|format| format.get("type"))
            .and_then(Value::as_str);
        if structured_type == Some("json_schema") && !parameters.structured_output {
            return Err(AiGatewayError::registry(
                feature,
                RegistryError::CapabilityMismatch {
                    model: model.to_string(),
                    capability: ModelCapability::WorldContent,
                },
            ));
        }
        if structured_type == Some("json_object")
            && !(parameters.json_mode || parameters.structured_output)
        {
            return Err(AiGatewayError::registry(
                feature,
                RegistryError::CapabilityMismatch {
                    model: model.to_string(),
                    capability: ModelCapability::IntentJson,
                },
            ));
        }
    }
    let gate = config.exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, model);
    if !gate.is_ready() {
        return Err(AiGatewayError::readiness(feature, gate));
    }
    let _server_spend_guard = if model == OPENROUTER_FREE_MODEL {
        None
    } else {
        enforce_server_paid_daily_limit(config, feature).await?
    };
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{feature} client setup failed: {error}"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/chat/completions", config.base_url);
    let max_attempts = max_attempts.max(1);

    'attempts: for attempt in 1..=max_attempts {
        let candidate_output_cap = selection
            .map(|selection| {
                let candidate = selection.candidate();
                candidate
                    .output_limit()
                    .unwrap_or(u32::MAX)
                    .min(candidate.sampling().hard_output_cap)
            })
            .unwrap_or(u32::MAX);
        let max_tokens = max_tokens.min(candidate_output_cap);
        let mut provider_managed_reasoning =
            raw_mode && reasoning_effort == Some(RAW_DIALOGUE_REASONING_MODE);
        let mut payload = json!({
            "model": model,
            "messages": chat_messages(system, assistant, user_content.clone(), quote)
        });
        if on_delta.is_some() {
            payload["stream"] = json!(true);
            payload["stream_options"] = json!({ "include_usage": true });
        }
        if !provider_managed_reasoning {
            payload["max_tokens"] = json!(max_tokens);
        }
        let temperature = selection
            .and_then(|selection| selection.candidate().sampling().temperature)
            .or(temperature)
            .filter(|_| {
                selection.is_none_or(|selection| {
                    selection
                        .candidate()
                        .supported_parameters()
                        .accepts_temperature()
                })
            });
        if let Some(temperature) = temperature {
            payload["temperature"] = json!(temperature);
        }
        if let Some(response_format) = response_format {
            payload["response_format"] = response_format.clone();
            if response_format.get("type").and_then(Value::as_str) == Some("json_schema")
                && config.base_url.contains("openrouter.ai")
            {
                payload["provider"] = json!({ "require_parameters": true });
            }
        }
        add_openrouter_room_session(config, &mut payload, room_id);
        if let Some(reasoning_effort) = reasoning_effort {
            payload["reasoning"] = if raw_mode && reasoning_effort == RAW_DIALOGUE_REASONING_MODE {
                json!({ "enabled": true })
            } else {
                json!({ "effort": reasoning_effort })
            };
        }
        if enforce_zero_data_retention {
            let mut provider = payload
                .get("provider")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            provider.insert("data_collection".to_string(), json!("deny"));
            provider.insert("zdr".to_string(), json!(true));
            payload["provider"] = Value::Object(provider);
        }
        if let Some(selection) = selection {
            let candidate = selection.candidate();
            let defaults = candidate.sampling();
            if let Some(top_p) = defaults.top_p {
                payload["top_p"] = json!(top_p);
            }
            if candidate.supported_parameters().seed {
                if let Some(seed) = defaults.seed {
                    payload["seed"] = json!(seed);
                }
            }
            if candidate.supported_parameters().stop && !defaults.stop.is_empty() {
                payload["stop"] = json!(defaults.stop);
            }
        }
        let mut reasoning_compatibility_retried = false;
        let response = loop {
            let response = client
                .post(&url)
                .bearer_auth(&config.api_key)
                .header("HTTP-Referer", referer)
                .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE)
                .header("X-Title", OPENROUTER_APP_TITLE)
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
                        continue 'attempts;
                    }
                    config
                        .readiness
                        .record_transport_failure(CHAT_COMPLETIONS_ENDPOINT, model);
                    return Err(AiGatewayError {
                        kind,
                        message: format!("{feature} request failed: {error}"),
                        attempts: attempt,
                        latency: started_at.elapsed(),
                    });
                }
            };

            let status = response.status();
            if status.is_success() {
                break response;
            }
            let retryable = status.as_u16() == 429 || status.is_server_error();
            if retryable && attempt < max_attempts {
                sleep(retry_delay(attempt)).await;
                continue 'attempts;
            }
            let retry_after = retry_after_from_headers(response.headers());
            let detail = provider_error_detail(response).await;
            if raw_mode && !reasoning_compatibility_retried {
                if let Some(fallback) = reasoning_compatibility_fallback(
                    status,
                    detail.as_deref(),
                    payload.get("reasoning"),
                ) {
                    match fallback {
                        ReasoningCompatibilityFallback::Enable => {
                            payload["reasoning"] = json!({ "enabled": true });
                        }
                        ReasoningCompatibilityFallback::Omit => {
                            if let Some(body) = payload.as_object_mut() {
                                body.remove("reasoning");
                            }
                            payload["max_tokens"] = json!(max_tokens);
                            provider_managed_reasoning = false;
                        }
                    }
                    reasoning_compatibility_retried = true;
                    tracing::info!(
                        feature,
                        requested_model = model,
                        fallback = fallback.as_str(),
                        "retrying one AI request with a compatible reasoning shape"
                    );
                    continue;
                }
            }
            config.readiness.record_http_failure(
                CHAT_COMPLETIONS_ENDPOINT,
                model,
                status.as_u16(),
                retry_after,
            );
            return Err(AiGatewayError::provider_http(
                feature,
                status,
                retry_after,
                detail.as_deref(),
                attempt,
                started_at.elapsed(),
            ));
        };

        let body: serde_json::Value = if let Some(on_delta) = on_delta {
            streaming::read_completion(response, on_delta, selection)
                .await
                .map_err(|message| AiGatewayError {
                    kind: AiFailureKind::InvalidResponse,
                    message: format!("{feature} stream failed: {message}"),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                })?
        } else {
            response.json().await.map_err(|error| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response was not valid JSON: {error}"),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?
        };
        let first_choice = body
            .get("choices")
            .and_then(|choices| choices.get(0))
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response did not include a choice"),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let message = first_choice.get("message").ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response did not include a message"),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
        let finish_reason = first_choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let reasoning_trace = readable_reasoning_trace(message);
        let text = readable_message_content(message).ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{feature} response did not include message content (finish_reason={finish_reason}, reasoning_only={})",
                    reasoning_trace.is_some()
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let usage = body.get("usage");
        let usage = AiTokenUsage {
            prompt_tokens: usage
                .and_then(|usage| usage.get("prompt_tokens"))
                .and_then(Value::as_u64),
            completion_tokens: usage
                .and_then(|usage| usage.get("completion_tokens"))
                .and_then(Value::as_u64),
            total_tokens: usage
                .and_then(|usage| usage.get("total_tokens"))
                .and_then(Value::as_u64),
        };
        let model_attribution = selection
            .map(|selection| {
                let provider_model = body.get("model").and_then(Value::as_str);
                selection.attribute_response(provider_model)
            })
            .transpose()
            .map_err(|error| {
                let mut gateway_error = AiGatewayError::registry(feature, error);
                gateway_error.attempts = attempt;
                gateway_error.latency = started_at.elapsed();
                gateway_error
            })?;
        let resolved_model_id = model_attribution
            .as_ref()
            .map(|attribution| attribution.resolved_model_id.clone())
            .or_else(|| {
                body.get("model")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
            .unwrap_or_else(|| model.to_string());

        tracing::info!(
            feature,
            provider = ai_provider_name(Some(config)),
            requested_model = model,
            resolved_model = model_attribution
                .as_ref()
                .map(|attribution| attribution.resolved_model_id.as_str())
                .unwrap_or(model),
            registry_snapshot = model_attribution
                .as_ref()
                .map(|attribution| attribution.catalog_snapshot_version.as_str())
                .unwrap_or("vision-config"),
            attempts = attempt,
            latency_ms = started_at.elapsed().as_millis() as u64,
            // A completion that reaches this line is not necessarily one the
            // publication gate accepts: finish_reason "length" is a truncated
            // completion, and voice_finish_incomplete rejects it downstream.
            // Without these, distinguishing a token budget that is really too
            // tight from a model that stops cleanly but fails the structural
            // check meant reproducing the failure locally.
            finish_reason = %finish_reason,
            requested_max_tokens = if provider_managed_reasoning { 0 } else { max_tokens },
            provider_managed_reasoning,
            completion_tokens = usage.completion_tokens.unwrap_or(0),
            "CosyWorld AI inference completed"
        );
        config
            .readiness
            .record_success(CHAT_COMPLETIONS_ENDPOINT, model);
        let (text, finish_reason) = match quote.then(|| prefilled(&text)) {
            Some((said, true)) => (said, "stop".to_string()),
            Some((said, false)) => (said, finish_reason),
            None => (text, finish_reason),
        };
        return Ok(AiCompletion {
            text,
            reasoning_trace,
            attempts: attempt,
            latency: started_at.elapsed(),
            model_attribution,
            resolved_model_id,
            finish_reason,
            usage,
            context_hash,
            prompt_version: prompt_version.to_string(),
        });
    }

    unreachable!("the bounded AI attempt loop always returns")
}

fn add_openrouter_room_session(config: &AiConfig, payload: &mut Value, room_id: Option<u64>) {
    if ai_provider_name(Some(config)) != "openrouter" {
        return;
    }
    let Some(room_id) = room_id.filter(|room_id| *room_id != 0) else {
        return;
    };
    payload["session_id"] = json!(format!("{OPENROUTER_ROOM_SESSION_PREFIX}{room_id}"));
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn next_utc_day_unix(now: u64) -> u64 {
    (now / 86_400).saturating_add(1).saturating_mul(86_400)
}

fn server_daily_spend_exhausted(usage_daily: f64) -> bool {
    usage_daily >= SERVER_PAID_DAILY_LIMIT_USD
}

fn uses_server_paid_openrouter(config: &AiConfig) -> bool {
    config.server_paid && ai_provider_name(Some(config)) == "openrouter"
}

pub(crate) async fn enforce_server_paid_daily_limit(
    config: &AiConfig,
    feature: &str,
) -> Result<Option<tokio::sync::MutexGuard<'static, ()>>, AiGatewayError> {
    if !uses_server_paid_openrouter(config) {
        return Ok(None);
    }
    // Hold this guard through the inference request. OpenRouter's usage_daily
    // is authoritative for the key, and serial admission prevents concurrent
    // calls from all observing the same just-below-limit balance.
    let guard = SERVER_PAID_INFERENCE_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let client = reqwest::Client::builder()
        .timeout(OPENROUTER_KEY_PROBE_TIMEOUT)
        .build()
        .map_err(|_| AiGatewayError::daily_spend_check_unavailable(feature))?;
    let mut response = client
        .get(format!(
            "{}/{}",
            config.base_url, OPENROUTER_CURRENT_KEY_ENDPOINT
        ))
        .bearer_auth(&config.api_key)
        .header("HTTP-Referer", OPENROUTER_APP_REFERER)
        .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE)
        .send()
        .await
        .map_err(|_| AiGatewayError::daily_spend_check_unavailable(feature))?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > OPENROUTER_KEY_RESPONSE_MAX_BYTES as u64)
    {
        return Err(AiGatewayError::daily_spend_check_unavailable(feature));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AiGatewayError::daily_spend_check_unavailable(feature))?
    {
        if bytes.len().saturating_add(chunk.len()) > OPENROUTER_KEY_RESPONSE_MAX_BYTES {
            return Err(AiGatewayError::daily_spend_check_unavailable(feature));
        }
        bytes.extend_from_slice(&chunk);
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AiGatewayError::daily_spend_check_unavailable(feature))?;
    let usage_daily = body
        .pointer("/data/usage_daily")
        .and_then(Value::as_f64)
        .filter(|usage| usage.is_finite() && *usage >= 0.0)
        .ok_or_else(|| AiGatewayError::daily_spend_check_unavailable(feature))?;
    if server_daily_spend_exhausted(usage_daily) {
        return Err(AiGatewayError::daily_spend_exhausted(
            feature,
            next_utc_day_unix(current_unix_secs()),
        ));
    }
    tracing::debug!(
        feature,
        usage_daily_usd = usage_daily,
        daily_limit_usd = SERVER_PAID_DAILY_LIMIT_USD,
        "admitted server-paid inference under the UTC daily budget"
    );
    Ok(Some(guard))
}

async fn provider_error_detail(mut response: reqwest::Response) -> Option<String> {
    const LIMIT: usize = 64 * 1024;
    let oversized = || Some("provider error body exceeded the diagnostic limit".to_string());
    if response
        .content_length()
        .is_some_and(|length| length > LIMIT as u64)
    {
        return oversized();
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len().saturating_add(chunk.len()) > LIMIT {
            return oversized();
        }
        body.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice::<Value>(&body).ok()?;
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/error/code").and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))?;
    let summary = message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| !character.is_control())
        .take(320)
        .collect::<String>();
    if summary.is_empty() {
        None
    } else if summary.contains("data:image") || summary.contains("Bearer ") {
        Some("provider rejected the request; sensitive echoed input was redacted".to_string())
    } else {
        Some(summary)
    }
}

fn retry_after_from_headers(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}

pub(crate) async fn probe_openrouter_account(
    config: &AiConfig,
) -> Result<AiReadinessSnapshot, AiGatewayError> {
    const FEATURE: &str = "ai_account_probe";

    let started_at = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(OPENROUTER_KEY_PROBE_TIMEOUT)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("OpenRouter account probe client setup failed: {error}"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/{}", config.base_url, OPENROUTER_CURRENT_KEY_ENDPOINT);
    let mut response = client
        .get(url)
        .bearer_auth(&config.api_key)
        .header("HTTP-Referer", OPENROUTER_APP_REFERER)
        .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE)
        .header("X-Title", OPENROUTER_APP_TITLE)
        .send()
        .await
        .map_err(|error| AiGatewayError {
            kind: if error.is_timeout() {
                AiFailureKind::Timeout
            } else {
                AiFailureKind::Transport
            },
            message: format!("OpenRouter account probe failed: {error}"),
            attempts: 1,
            latency: started_at.elapsed(),
        })?;
    let status = response.status();
    if !status.is_success() {
        let retry_after = retry_after_from_headers(response.headers());
        config.readiness.record_probe_http_failure(status.as_u16());
        return Err(AiGatewayError::provider_http(
            FEATURE,
            status,
            retry_after,
            None,
            1,
            started_at.elapsed(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > OPENROUTER_KEY_RESPONSE_MAX_BYTES as u64)
    {
        return Err(AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: "OpenRouter account probe response exceeded its byte limit".to_string(),
            attempts: 1,
            latency: started_at.elapsed(),
        });
    }
    let mut response_bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| AiGatewayError {
        kind: AiFailureKind::InvalidResponse,
        message: format!("OpenRouter account probe response could not be read: {error}"),
        attempts: 1,
        latency: started_at.elapsed(),
    })? {
        if response_bytes.len().saturating_add(chunk.len()) > OPENROUTER_KEY_RESPONSE_MAX_BYTES {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: "OpenRouter account probe response exceeded its byte limit".to_string(),
                attempts: 1,
                latency: started_at.elapsed(),
            });
        }
        response_bytes.extend_from_slice(&chunk);
    }
    let body =
        serde_json::from_slice::<Value>(&response_bytes).map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("OpenRouter account probe response was not valid JSON: {error}"),
            attempts: 1,
            latency: started_at.elapsed(),
        })?;
    let limit_remaining = body
        .pointer("/data/limit_remaining")
        .and_then(Value::as_f64);
    if limit_remaining.is_some_and(|remaining| remaining <= 0.0) {
        config.readiness.record_probe_credits_exhausted();
        let gate = config.exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, &config.model);
        let mut error = AiGatewayError::readiness(FEATURE, gate);
        error.attempts = 1;
        error.latency = started_at.elapsed();
        return Err(error);
    }
    config.readiness.record_probe_result(limit_remaining);
    Ok(config.readiness_snapshot())
}

pub(crate) fn start_ai_readiness_scheduler(
    config: Option<AiConfig>,
) -> Option<tokio::task::JoinHandle<()>> {
    let config = config.filter(|config| ai_provider_name(Some(config)) == "openrouter")?;
    let process_id = std::env::var("COSYWORLD_PROCESS_ID")
        .ok()
        .map(|value| {
            value
                .trim()
                .chars()
                .filter(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
                })
                .take(80)
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    Some(tokio::spawn(async move {
        loop {
            match probe_openrouter_account(&config).await {
                Ok(snapshot) => {
                    tracing::info!(
                        event = "ai_account_probe",
                        process_id = %process_id,
                        status = snapshot.status,
                        reason_code = snapshot.reason_code.unwrap_or("ready"),
                        blocked_route_count = snapshot.blocked_route_count,
                        next_probe_after_secs = snapshot.next_probe_after_secs,
                        "AI provider account probe completed"
                    );
                }
                Err(error) => {
                    tracing::warn!(
                        event = "ai_account_probe",
                        process_id = %process_id,
                        status = "failed",
                        reason_code = error.code(),
                        http_status = error.provider_http_status().unwrap_or(0),
                        attempts = error.attempts,
                        latency_ms = error.latency.as_millis() as u64,
                        "AI provider account probe failed"
                    );
                }
            }
            sleep(config.recommended_readiness_probe_delay()).await;
        }
    }))
}

fn retry_delay(attempt: u8) -> Duration {
    Duration::from_millis(150 * u64::from(attempt))
}

pub(crate) fn local_ai_base_url(base_url: &str) -> bool {
    base_url == "embedded://llama"
        || base_url.starts_with("http://127.0.0.1:")
        || base_url.starts_with("http://localhost:")
        || base_url.starts_with("http://[::1]:")
}

pub(crate) fn ai_provider_name(config: Option<&AiConfig>) -> &'static str {
    let Some(config) = config else {
        return "unconfigured";
    };
    ai_provider_name_for_base_url(&config.base_url)
}

fn ai_provider_name_for_base_url(base_url: &str) -> &'static str {
    if base_url == "embedded://llama" {
        "embedded_llama"
    } else if base_url.contains("openrouter.ai") {
        "openrouter"
    } else if base_url.contains("api.openai.com") {
        "openai"
    } else {
        "openai_compatible"
    }
}

#[cfg(test)]
mod tests {
    use super::registry::DataPolicyEligibility;
    use super::*;
    use axum::{
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };

    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;

    /// A character's view is its own assistant turn after silence; only a
    /// route that continues a final assistant turn gets the opening quote.
    #[test]
    fn a_view_is_its_own_turn_and_a_quote_closes_the_speech() {
        let roles = |turns: Value| -> Vec<String> {
            let turns = turns.as_array().unwrap().iter();
            turns.map(|t| t["role"].as_str().unwrap().into()).collect()
        };
        assert_eq!(
            roles(chat_messages("Voice.", "", "Scene".into(), false)),
            ["system", "user"]
        );
        let view = chat_messages(
            "",
            "I am Pip.",
            "Vale says, \u{201c}Hi.\u{201d}".into(),
            false,
        );
        assert_eq!(view[0]["content"], SILENCE);
        assert_eq!(roles(view), ["user", "assistant", "user"]);
        let quoted = chat_messages(
            "",
            "I am Pip.",
            "Vale says, \u{201c}Hi.\u{201d}".into(),
            true,
        );
        assert_eq!(
            quoted[3],
            json!({"role": "assistant", "content": "\u{201c}", "prefix": true})
        );
        assert_eq!(
            prefilled("Mind the oil,\u{201d} he says"),
            ("\u{201c}Mind the oil,\u{201d} he says".into(), true)
        );
        assert_eq!(
            prefilled("\u{201c}Mind the oil, and"),
            ("\u{201c}Mind the oil, and".into(), false)
        );
    }

    #[test]
    fn provider_names_follow_the_configured_endpoint() {
        let config = |base_url: &str| AiConfig {
            api_key: "test".to_string(),
            base_url: base_url.to_string(),
            model: "test-model".to_string(),
            reasoning_effort: None,
            ..AiConfig::default()
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

    #[tokio::test]
    async fn keyed_image_request_uses_the_registered_image_generation_capability() {
        use std::sync::Mutex;

        const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let app = Router::new().route(
            "/images",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    *captured.lock().expect("capture keyed image request") = Some(body);
                    Json(json!({
                        "model": "provider/journal-painter-v1",
                        "data": [{ "b64_json": PNG_1X1 }]
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind keyed image gateway test server");
        let address = listener.local_addr().expect("keyed image gateway address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let registry = CapabilityRegistrySnapshot::from_json(
            r#"{
              "schema_version": 1,
              "snapshot_version": "journal-image-1",
              "declared": [{
                "requested_model_id": "provider/journal-painter-v1",
                "provider": "test-provider",
                "mutable_alias": false,
                "input_modalities": ["text"],
                "output_modalities": ["image"],
                "supported_parameters": {"seed": true},
                "data_policy": {"retention": "none", "training": "prohibited"},
                "prompt_adapter": {"id": "image-generation", "version": "1"},
                "sampling": {},
                "capabilities": ["image_generation"]
              }]
            }"#,
        )
        .expect("valid Journal image registry");
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            registry: Some(Arc::new(registry)),
            capability_models: BTreeMap::from([(
                ModelCapability::ImageGeneration,
                "provider/journal-painter-v1".to_string(),
            )]),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };

        let generated = request_image_generation_for_key(
            &config,
            ImageGenerationRequest {
                options: Default::default(),
                feature: "journal_image_test",
                prompt_version: "journal-image-test-v1",
                prompt: "one painted journal page",
                reference: None,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
            "avatar:5000:day:20600",
        )
        .await
        .expect("keyed image request");

        let body = request_body
            .lock()
            .expect("read keyed image request")
            .clone()
            .expect("keyed image request captured");
        assert_eq!(body["model"], "provider/journal-painter-v1");
        assert_eq!(body["prompt"], "one painted journal page");
        assert!(body.get("input_references").is_none());
        assert_eq!(generated.content_type, "image/png");
        server.abort();
    }

    #[test]
    fn local_sidecars_are_keyless_but_remote_endpoints_are_not() {
        assert!(local_ai_base_url("http://127.0.0.1:8080/v1"));
        assert!(local_ai_base_url("http://localhost:8080/v1"));
        assert!(!local_ai_base_url("https://openrouter.ai/api/v1"));
        assert!(!local_ai_base_url("https://api.openai.com/v1"));
        assert_eq!(
            enabled_ai_api_key(None, "http://127.0.0.1:8080/v1").as_deref(),
            Some("local-ai")
        );
        assert_eq!(
            enabled_ai_api_key(None, "https://api.openai.com/v1"),
            None,
            "omitting credentials from a remote deployment keeps AI disabled"
        );
    }

    #[test]
    fn openrouter_room_sessions_are_stable_provider_scoped_and_room_specific() {
        let openrouter = AiConfig {
            base_url: "https://openrouter.ai/api/v1".to_string(),
            ..AiConfig::default()
        };
        let mut first = json!({});
        let mut repeated = json!({});
        let mut other_room = json!({});
        add_openrouter_room_session(&openrouter, &mut first, Some(71));
        add_openrouter_room_session(&openrouter, &mut repeated, Some(71));
        add_openrouter_room_session(&openrouter, &mut other_room, Some(72));

        assert_eq!(first["session_id"], "cosyworld-room-71");
        assert_eq!(repeated["session_id"], first["session_id"]);
        assert_eq!(other_room["session_id"], "cosyworld-room-72");

        let openai = AiConfig {
            base_url: "https://api.openai.com/v1".to_string(),
            ..AiConfig::default()
        };
        let mut non_openrouter = json!({});
        add_openrouter_room_session(&openai, &mut non_openrouter, Some(71));
        assert!(non_openrouter.get("session_id").is_none());

        let mut no_room = json!({});
        add_openrouter_room_session(&openrouter, &mut no_room, None);
        add_openrouter_room_session(&openrouter, &mut no_room, Some(0));
        assert!(no_room.get("session_id").is_none());
    }

    #[test]
    fn enabled_production_ai_requires_an_explicit_registry() {
        let error = require_explicit_production_registry(None, DataPolicyMode::Production)
            .expect_err("production AI without a reviewed registry must not boot");

        assert!(error.contains(AI_REGISTRY_ENV), "{error}");
        assert!(
            error.contains("COSYWORLD_DEPLOY_PROFILE=production"),
            "{error}"
        );
        assert!(error.contains("disable AI by unsetting"), "{error}");
        assert!(error.contains("OPENROUTER_API_KEY"), "{error}");

        require_explicit_production_registry(None, DataPolicyMode::Development)
            .expect("development keeps the legacy fallback");
        let registry = startup_validation_registry();
        require_explicit_production_registry(Some(&registry), DataPolicyMode::Production)
            .expect("a configured production registry passes the presence guard");
    }

    fn startup_validation_registry() -> CapabilityRegistrySnapshot {
        CapabilityRegistrySnapshot::from_json(
            r#"{
              "schema_version": 1,
              "snapshot_version": "startup-validation-1",
              "declared": [
                {
                  "requested_model_id": "provider/generalist",
                  "provider": "test-provider",
                  "concrete_model": {"model_id": "provider/generalist", "revision": "r1"},
                  "input_modalities": ["text"],
                  "output_modalities": ["text"],
                  "supported_parameters": {"structured_output": true, "json_mode": true},
                  "data_policy": {"retention": "none", "training": "prohibited"},
                  "capabilities": ["voice", "intent_json", "world_content"]
                },
                {
                  "requested_model_id": "provider/voice-only",
                  "provider": "test-provider",
                  "concrete_model": {"model_id": "provider/voice-only", "revision": "r1"},
                  "input_modalities": ["text"],
                  "output_modalities": ["text"],
                  "data_policy": {"retention": "none", "training": "prohibited"},
                  "capabilities": ["voice"]
                },
                {
                  "requested_model_id": "provider/non-zdr-planner",
                  "provider": "test-provider",
                  "concrete_model": {"model_id": "provider/non-zdr-planner", "revision": "r1"},
                  "input_modalities": ["text"],
                  "output_modalities": ["text"],
                  "supported_parameters": {"json_mode": true},
                  "data_policy": {"retention": "provider_default", "training": "permitted"},
                  "capabilities": ["intent_json"]
                }
              ]
            }"#,
        )
        .expect("startup validation registry")
    }

    #[test]
    fn startup_rejects_unknown_capability_override_with_stable_context() {
        let error = validate_ai_routing_configuration(
            &startup_validation_registry(),
            &BTreeMap::from([(ModelCapability::IntentJson, "provider/missing".to_string())]),
            DataPolicyMode::Production,
        )
        .expect_err("an unknown effective model must stop startup");

        assert!(error.contains(AI_CAPABILITY_MODELS_ENV), "{error}");
        assert!(error.contains(AI_REGISTRY_ENV), "{error}");
        assert!(error.contains("intent_json"), "{error}");
        assert!(error.contains("\"provider/missing\""), "{error}");
        assert!(error.contains("inference_registry_error"), "{error}");
    }

    #[test]
    fn startup_rejects_capability_mismatch_but_accepts_non_zdr_override() {
        let registry = startup_validation_registry();
        let mismatch = validate_ai_routing_configuration(
            &registry,
            &BTreeMap::from([(
                ModelCapability::IntentJson,
                "provider/voice-only".to_string(),
            )]),
            DataPolicyMode::Production,
        )
        .expect_err("a voice-only model cannot be the planner");
        assert!(mismatch.contains("intent_json"), "{mismatch}");
        assert!(mismatch.contains("\"provider/voice-only\""), "{mismatch}");
        assert!(
            mismatch.contains("inference_capability_mismatch"),
            "{mismatch}"
        );

        validate_ai_routing_configuration(
            &registry,
            &BTreeMap::from([(
                ModelCapability::IntentJson,
                "provider/non-zdr-planner".to_string(),
            )]),
            DataPolicyMode::Production,
        )
        .expect("server-authored planner input may use a non-ZDR route");
    }

    #[test]
    fn startup_accepts_valid_effective_capability_overrides() {
        validate_ai_routing_configuration(
            &startup_validation_registry(),
            &BTreeMap::from([
                (ModelCapability::Voice, "provider/voice-only".to_string()),
                (
                    ModelCapability::IntentJson,
                    "provider/generalist".to_string(),
                ),
                (
                    ModelCapability::WorldContent,
                    "provider/generalist".to_string(),
                ),
            ]),
            DataPolicyMode::Production,
        )
        .expect("every effective selection is eligible");
    }

    #[test]
    fn production_capability_audit_does_not_treat_unknown_policy_as_a_gap() {
        let fallback = CapabilityRegistrySnapshot::legacy(
            "legacy-config-v1",
            "openrouter",
            "provider/unreviewed",
        )
        .expect("legacy registry");

        validate_ai_routing_configuration(&fallback, &BTreeMap::new(), DataPolicyMode::Production)
            .expect("unknown policy remains metadata for server-authored input");

        validate_ai_routing_configuration(&fallback, &BTreeMap::new(), DataPolicyMode::Development)
            .expect("legacy local development stays compatible");
    }

    #[tokio::test]
    async fn gateway_retries_transient_provider_failures_once() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let structured_format_seen = Arc::new(AtomicBool::new(false));
        let reasoning_none_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let attempts = attempts.clone();
                let structured_format_seen = structured_format_seen.clone();
                let reasoning_none_seen = reasoning_none_seen.clone();
                move |Json(body): Json<Value>| {
                    let attempts = attempts.clone();
                    let structured_format_seen = structured_format_seen.clone();
                    let reasoning_none_seen = reasoning_none_seen.clone();
                    async move {
                        if body
                            .pointer("/response_format/json_schema/name")
                            .and_then(Value::as_str)
                            == Some("retry_test_schema")
                        {
                            structured_format_seen.store(true, Ordering::SeqCst);
                        }
                        if body.pointer("/reasoning/effort").and_then(Value::as_str) == Some("none")
                        {
                            reasoning_none_seen.store(true, Ordering::SeqCst);
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
            reasoning_effort: Some("none".to_string()),
            ..AiConfig::default()
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
                prompt_version: "retry-test-v1",
                capability: ModelCapability::WorldContent,
                system: "system",
                user: "user",
                temperature: 0.0,
                max_tokens: 20,
                timeout: Duration::from_secs(2),
                max_attempts: 2,
                referer: "http://127.0.0.1",
                response_format: Some(&response_format),
                room_id: None,
            },
        )
        .await
        .expect("transient provider failure should retry");

        assert_eq!(completion.text, "The kettle behaves.");
        assert_eq!(completion.attempts, 2);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(structured_format_seen.load(Ordering::SeqCst));
        assert!(reasoning_none_seen.load(Ordering::SeqCst));
        server.abort();
    }

    #[tokio::test]
    async fn gateway_sends_one_pinned_alias_and_attributes_the_concrete_model() {
        let request_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_seen = request_seen.clone();
                move |Json(body): Json<Value>| {
                    let request_seen = request_seen.clone();
                    async move {
                        request_seen.store(
                            body.get("model").and_then(Value::as_str) == Some("provider/auto")
                                && body.get("max_tokens").and_then(Value::as_u64) == Some(33)
                                && body.pointer("/stop/0").and_then(Value::as_str) == Some("<END>"),
                            Ordering::SeqCst,
                        );
                        Json(json!({
                            "model": "provider/concrete-2026-07-26",
                            "choices": [{ "message": { "content": "A small hello." } }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind pinned alias gateway test server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let registry = CapabilityRegistrySnapshot::from_json(
            r#"{
              "schema_version": 1,
              "snapshot_version": "gateway-alias-1",
              "declared": [{
                "requested_model_id": "provider/auto",
                "provider": "test-provider",
                "mutable_alias": true,
                "input_modalities": ["text"],
                "output_modalities": ["text"],
                "supported_parameters": {"stop": true},
                "data_policy": {"retention": "none", "training": "prohibited"},
                "prompt_adapter": {"id": "cosy-chat", "version": "3"},
                "sampling": {"stop": ["<END>"], "hard_output_cap": 33},
                "capabilities": ["voice"]
              }]
            }"#,
        )
        .expect("valid alias registry");
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "provider/auto".to_string(),
            registry: Some(Arc::new(registry)),
            capability_models: BTreeMap::from([(
                ModelCapability::Voice,
                "provider/auto".to_string(),
            )]),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };

        let completion = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "alias_test",
                prompt_version: "alias-test-v1",
                capability: ModelCapability::Voice,
                system: "system",
                user: "user",
                temperature: 0.6,
                max_tokens: 200,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect("alias request");
        let attribution = completion
            .model_attribution
            .expect("resolved model attribution");

        assert!(request_seen.load(Ordering::SeqCst));
        assert_eq!(attribution.requested_model_id, "provider/auto");
        assert_eq!(
            attribution.resolved_model_id,
            "provider/concrete-2026-07-26"
        );
        assert_eq!(attribution.catalog_snapshot_version, "gateway-alias-1");
        assert_eq!(attribution.prompt_adapter_version, "3");
        server.abort();
    }

    #[tokio::test]
    async fn gateway_omits_temperature_the_registry_marks_unsupported() {
        let seen = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let seen = seen.clone();
                move |Json(body): Json<Value>| {
                    let seen = seen.clone();
                    async move {
                        seen.lock().unwrap().push(body);
                        Json(json!({ "choices": [{ "message": { "content": "Hello." } }] }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let entry = |model: &str, temperature: &str| {
            format!(
                r#"{{"requested_model_id":"{model}","provider":"openrouter","input_modalities":["text"],"output_modalities":["text"],"supported_parameters":{{"structured_output":true,"json_mode":true,"reasoning":true{temperature}}},"data_policy":{{"retention":"none","training":"prohibited"}},"capabilities":["world_content"],"sampling":{{"temperature":0.4,"hard_output_cap":64}}}}"#
            )
        };
        let registry = CapabilityRegistrySnapshot::from_json(&format!(
            r#"{{"schema_version":1,"snapshot_version":"temperature-1","declared":[{},{}]}}"#,
            entry("test/no-temperature", r#","temperature":false"#),
            entry("test/legacy", ""),
        ))
        .expect("valid registry");
        for model in ["test/no-temperature", "test/legacy"] {
            let config = AiConfig {
                api_key: "test".to_string(),
                base_url: format!("http://{addr}"),
                model: model.to_string(),
                registry: Some(Arc::new(registry.clone())),
                capability_models: BTreeMap::from([(
                    ModelCapability::WorldContent,
                    model.to_string(),
                )]),
                reasoning_effort: Some("none".to_string()),
                data_policy_mode: DataPolicyMode::Production,
                ..AiConfig::default()
            };
            request_chat_completion(
                &config,
                ChatCompletionRequest {
                    feature: "temperature_test",
                    prompt_version: "temperature-test-v1",
                    capability: ModelCapability::WorldContent,
                    system: "system",
                    user: "user",
                    temperature: 0.9,
                    max_tokens: 32,
                    timeout: Duration::from_secs(2),
                    max_attempts: 1,
                    referer: "http://127.0.0.1",
                    response_format: None,
                    room_id: None,
                },
            )
            .await
            .expect("completion");
        }
        let seen = seen.lock().unwrap();
        assert!(seen[0].get("temperature").is_none());
        assert_eq!(seen[0].pointer("/reasoning/effort"), Some(&json!("none")));
        assert_eq!(seen[1]["temperature"], json!(0.4));
        server.abort();
    }

    #[test]
    fn reasoning_shape_fallback_accepts_current_provider_wording() {
        let disabled = json!({ "effort": "none" });
        assert_eq!(
            reasoning_compatibility_fallback(
                reqwest::StatusCode::BAD_REQUEST,
                Some("Reasoning must be enabled for this model"),
                Some(&disabled),
            ),
            Some(ReasoningCompatibilityFallback::Enable),
        );
        assert_eq!(
            reasoning_compatibility_fallback(
                reqwest::StatusCode::BAD_REQUEST,
                Some("Invalid reasoning effort: none"),
                Some(&disabled),
            ),
            Some(ReasoningCompatibilityFallback::Omit),
        );
        let minimal = json!({ "effort": "minimal" });
        assert_eq!(
            reasoning_compatibility_fallback(
                reqwest::StatusCode::BAD_REQUEST,
                Some("Invalid reasoning effort: minimal"),
                Some(&minimal),
            ),
            Some(ReasoningCompatibilityFallback::Omit),
        );

        let enabled = json!({ "enabled": true, "exclude": true });
        assert_eq!(
            reasoning_compatibility_fallback(
                reqwest::StatusCode::BAD_REQUEST,
                Some("Reasoning is mandatory and cannot be disabled"),
                Some(&enabled),
            ),
            None,
        );
    }

    #[test]
    fn readable_reasoning_prefers_summaries_and_ignores_encrypted_blocks() {
        let message = json!({
            "reasoning": "raw fallback",
            "reasoning_details": [
                { "type": "reasoning.text", "text": "longer raw reasoning" },
                { "type": "reasoning.encrypted", "data": "opaque-secret" },
                { "type": "reasoning.summary", "summary": "A brief useful thought." }
            ]
        });
        assert_eq!(
            readable_reasoning_trace(&message).as_deref(),
            Some("A brief useful thought.")
        );
        assert!(readable_reasoning_trace(&json!({
            "reasoning_details": [{ "type": "reasoning.encrypted", "data": "opaque-secret" }]
        }))
        .is_none());
        assert_eq!(
            readable_reasoning_trace(&json!({ "reasoning_content": "  one\nthought  " }))
                .as_deref(),
            Some("one thought")
        );
    }

    #[test]
    fn readable_message_content_accepts_string_and_text_part_shapes() {
        assert_eq!(
            readable_message_content(&json!({ "content": "  hello there  " })).as_deref(),
            Some("hello there")
        );
        assert_eq!(
            readable_message_content(&json!({
                "content": [
                    { "type": "output_text", "text": "first line" },
                    { "type": "image", "image_url": "ignored" },
                    { "type": "tool_call", "text": "also ignored" },
                    { "type": "text", "content": "second line" }
                ]
            }))
            .as_deref(),
            Some("first line\nsecond line")
        );
        assert!(readable_message_content(&json!({
            "content": null,
            "reasoning": "thinking only"
        }))
        .is_none());
    }

    #[tokio::test]
    async fn production_non_zdr_global_request_reaches_provider_without_privacy_constraints() {
        let request_shape_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_shape_seen = request_shape_seen.clone();
                move |Json(body): Json<Value>| {
                    let request_shape_seen = request_shape_seen.clone();
                    async move {
                        request_shape_seen.store(
                            body.get("provider").is_none()
                                && body.pointer("/messages/0/content").and_then(Value::as_str)
                                    == Some("server-authored system")
                                && body.pointer("/messages/1/content").and_then(Value::as_str)
                                    == Some("server-authored world event"),
                            Ordering::SeqCst,
                        );
                        Json(json!({
                            "choices": [{ "message": { "content": "The world answers." } }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind privacy gateway test server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let registry = CapabilityRegistrySnapshot::from_json(
            r#"{
              "schema_version": 1,
              "snapshot_version": "privacy-unknown-1",
              "declared": [{
                "requested_model_id": "provider/unknown-policy",
                "provider": "test-provider",
                "concrete_model": {"model_id": "provider/unknown-policy"},
                "input_modalities": ["text"],
                "output_modalities": ["text"],
                "capabilities": ["voice"]
              }]
            }"#,
        )
        .expect("valid unknown-policy registry");
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "provider/unknown-policy".to_string(),
            registry: Some(Arc::new(registry)),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };

        let completion = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "non_zdr_global_test",
                prompt_version: "non-zdr-global-test-v1",
                capability: ModelCapability::Voice,
                system: "server-authored system",
                user: "server-authored world event",
                temperature: 0.0,
                max_tokens: 20,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect("unknown production policy does not block server-authored input");

        assert!(request_shape_seen.load(Ordering::SeqCst));
        assert_eq!(
            completion
                .model_attribution
                .expect("non-ZDR global attribution")
                .data_policy,
            DataPolicyEligibility::default()
        );
        server.abort();
    }

    #[tokio::test]
    async fn production_zdr_global_request_sends_truthful_openrouter_constraints() {
        let request_shape_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_shape_seen = request_shape_seen.clone();
                move |Json(body): Json<Value>| {
                    let request_shape_seen = request_shape_seen.clone();
                    async move {
                        request_shape_seen.store(
                            body.pointer("/provider/data_collection")
                                .and_then(Value::as_str)
                                == Some("deny")
                                && body.pointer("/provider/zdr").and_then(Value::as_bool)
                                    == Some(true)
                                && body["messages"].as_array().map(Vec::len) == Some(2),
                            Ordering::SeqCst,
                        );
                        Json(json!({
                            "model": "provider/zdr-global",
                            "choices": [{ "message": { "content": "The world answers." } }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind ZDR gateway test server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let registry = CapabilityRegistrySnapshot::from_json(
            r#"{
              "schema_version": 1,
              "snapshot_version": "zdr-global-1",
              "declared": [{
                "requested_model_id": "provider/zdr-global",
                "provider": "openrouter",
                "concrete_model": {"model_id": "provider/zdr-global"},
                "input_modalities": ["text"],
                "output_modalities": ["text"],
                "data_policy": {"retention": "none", "training": "prohibited"},
                "capabilities": ["voice"]
              }]
            }"#,
        )
        .expect("valid ZDR registry");
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "provider/zdr-global".to_string(),
            registry: Some(Arc::new(registry)),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };

        let completion = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "zdr_global_test",
                prompt_version: "zdr-global-test-v1",
                capability: ModelCapability::Voice,
                system: "server-authored system",
                user: "server-authored world event",
                temperature: 0.0,
                max_tokens: 20,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect("ZDR global request succeeds");

        assert!(request_shape_seen.load(Ordering::SeqCst));
        assert_ne!(
            completion
                .model_attribution
                .expect("ZDR global attribution")
                .data_policy,
            DataPolicyEligibility::default()
        );
        server.abort();
    }

    #[tokio::test]
    async fn provider_diagnostics_bound_chunked_bodies_before_the_stream_ends() {
        use futures_util::StreamExt;
        for size in [64 * 1024, 64 * 1024 + 1] {
            let overflow = size > 64 * 1024;
            let app = Router::new().route(
                "/error",
                get(move || async move {
                    let mut bytes = br#"{"error":{"message":"Try again later"}}"#.to_vec();
                    bytes.resize(size, b' ');
                    let chunks = bytes
                        .chunks(4096)
                        .map(|chunk| {
                            Ok::<_, std::io::Error>(axum::body::Bytes::copy_from_slice(chunk))
                        })
                        .collect::<Vec<_>>();
                    // An oversized stream stays open: the reader must stop at its bound.
                    let stream = futures_util::stream::iter(chunks)
                        .chain(futures_util::stream::pending().take(usize::from(overflow)));
                    (
                        StatusCode::TOO_MANY_REQUESTS,
                        axum::body::Body::from_stream(stream),
                    )
                }),
            );
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let response = reqwest::Client::new()
                .get(format!("http://{address}/error"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.content_length(), None);
            let detail =
                tokio::time::timeout(Duration::from_secs(2), provider_error_detail(response))
                    .await
                    .expect("read only the bounded diagnostic body");
            server.abort();
            assert_eq!(
                detail.as_deref(),
                Some(if overflow {
                    "provider error body exceeded the diagnostic limit"
                } else {
                    "Try again later"
                })
            );
        }
    }

    #[tokio::test]
    async fn current_key_probe_blocks_exhausted_credit_and_recovers_without_leaking_balance() {
        let remaining_millis = Arc::new(AtomicUsize::new(0));
        let observed_remaining = Arc::clone(&remaining_millis);
        let app = Router::new().route(
            "/key",
            get(move || {
                let observed_remaining = Arc::clone(&observed_remaining);
                async move {
                    Json(json!({
                        "data": {
                            "limit_remaining": observed_remaining.load(Ordering::SeqCst) as f64 / 1_000.0
                        }
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind current-key probe server");
        let address = listener.local_addr().expect("probe test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "provider/chat".to_string(),
            ..AiConfig::default()
        };

        let error = probe_openrouter_account(&config)
            .await
            .expect_err("zero remaining credit must fail readiness");
        assert_eq!(error.code(), crate::ai_readiness::AI_CREDITS_EXHAUSTED);
        assert_eq!(error.attempts, 1);
        assert_eq!(config.readiness_snapshot().status, "degraded");
        remaining_millis.store(2_500, Ordering::SeqCst);
        let warning = probe_openrouter_account(&config)
            .await
            .expect("low positive credit remains usable");
        assert_eq!(warning.status, "degraded");
        assert_eq!(
            warning.reason_code,
            Some(crate::ai_readiness::AI_CREDITS_LOW)
        );
        assert!(config.global_chat_route_is_ready());
        let public_warning = serde_json::to_string(&warning).expect("serialize safe readiness");
        assert!(!public_warning.contains("2.5"));
        assert!(!public_warning.contains("balance"));
        assert!(!public_warning.contains("remaining"));
        assert!(!public_warning.contains("threshold"));

        remaining_millis.store(12_500, Ordering::SeqCst);
        let recovered = probe_openrouter_account(&config)
            .await
            .expect("positive remaining credit recovers the account");
        assert_eq!(recovered.status, "ready");
        assert_eq!(recovered.reason_code, None);
        assert_eq!(recovered.next_probe_after_secs, 300);
        server.abort();
    }

    #[test]
    fn low_credit_threshold_is_bounded_and_invalid_values_fail_closed() {
        assert_eq!(
            parse_low_credit_threshold(None).expect("documented default"),
            DEFAULT_LOW_CREDIT_THRESHOLD
        );
        assert_eq!(
            parse_low_credit_threshold(Some("0")).expect("zero disables the warning"),
            0.0
        );
        assert_eq!(
            parse_low_credit_threshold(Some("12.5")).expect("bounded threshold"),
            12.5
        );
        for invalid in ["-1", "10001", "NaN", "infinite", "credits"] {
            assert!(
                parse_low_credit_threshold(Some(invalid)).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn server_budget_closes_at_twenty_dollars_and_resets_on_utc_boundary() {
        assert!(!server_daily_spend_exhausted(19.999_999));
        assert!(server_daily_spend_exhausted(20.0));
        assert!(server_daily_spend_exhausted(20.01));
        assert_eq!(next_utc_day_unix(0), 86_400);
        assert_eq!(next_utc_day_unix(86_399), 86_400);
        assert_eq!(next_utc_day_unix(86_400), 172_800);

        let server = AiConfig {
            api_key: "sk-or-server".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            server_paid: true,
            ..AiConfig::default()
        };
        assert!(uses_server_paid_openrouter(&server));
        assert!(!uses_server_paid_openrouter(
            &server.for_transient_openrouter("sk-or-player".to_string())
        ));
    }

    #[tokio::test]
    async fn free_router_authors_text_and_reports_the_resolved_model() {
        use std::sync::Mutex;

        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let app = Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    *captured.lock().expect("capture free router request") = Some(body);
                    Json(json!({
                        "model": "example/resolved-free-model:free",
                        "choices": [{
                            "message": { "content": "The kettle remembers you." },
                            "finish_reason": "stop"
                        }],
                        "usage": { "total_tokens": 9 }
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind free router gateway test server");
        let address = listener.local_addr().expect("free router gateway address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let completion = request_routed_chat_completion(
            &config,
            OPENROUTER_FREE_MODEL,
            ChatCompletionRequest {
                feature: "speech_text_test",
                prompt_version: "speech-text-test-v1",
                capability: ModelCapability::Voice,
                system: "Write one line.",
                user: "Welcome the traveler.",
                temperature: 0.7,
                max_tokens: 64,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect("free router text completion");

        let body = request_body
            .lock()
            .expect("read free router request")
            .clone()
            .expect("free router request captured");
        assert_eq!(body["model"], OPENROUTER_FREE_MODEL);
        assert_eq!(completion.text, "The kettle remembers you.");
        assert_eq!(
            completion.resolved_model_id,
            "example/resolved-free-model:free"
        );
        server.abort();
    }

    #[test]
    fn gateway_errors_have_stable_telemetry_codes() {
        assert_eq!(
            AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: "bad response".to_string(),
                attempts: 1,
                latency: Duration::ZERO,
            }
            .code(),
            "inference_invalid_response"
        );
    }

    #[tokio::test]
    async fn exact_endpoint_request_shape_4xx_is_terminal_without_retry_amplification() {
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&requests);
        let app = Router::new().route(
            "/chat/completions",
            post(move || {
                let observed = Arc::clone(&observed);
                async move {
                    observed.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": { "message": "invalid request shape" } })),
                    )
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind terminal 4xx gateway test server");
        let address = listener
            .local_addr()
            .expect("terminal 4xx gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-model".to_string(),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let error = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "chat_route_test",
                prompt_version: "chat-route-test-v1",
                capability: ModelCapability::Voice,
                system: "Write one line.",
                user: "Hello.",
                temperature: 0.7,
                max_tokens: 64,
                timeout: Duration::from_secs(2),
                max_attempts: 4,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect_err("deterministic 400 must be terminal");

        assert_eq!(error.code(), "inference_provider_error");
        assert_eq!(error.attempts, 1);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_exact_request_is_single_call_and_blocks_only_that_route() {
        let requests = Arc::new(AtomicUsize::new(0));
        let observed_requests = Arc::clone(&requests);
        let app = Router::new().route(
            "/chat/completions",
            post(move || {
                let observed_requests = Arc::clone(&observed_requests);
                async move {
                    observed_requests.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({ "error": { "message": "invalid credential" } })),
                    )
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind readiness authorization server");
        let address = listener.local_addr().expect("readiness test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-model".to_string(),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let request = || {
            request_chat_completion(
                &config,
                ChatCompletionRequest {
                    feature: "chat_route_test",
                    prompt_version: "chat-route-test-v1",
                    capability: ModelCapability::Voice,
                    system: "Write one line.",
                    user: "Hello.",
                    temperature: 0.7,
                    max_tokens: 64,
                    timeout: Duration::from_secs(2),
                    max_attempts: 4,
                    referer: "http://127.0.0.1",
                    response_format: None,
                    room_id: None,
                },
            )
        };

        let first = request().await.expect_err("401 must fail closed");
        assert_eq!(first.provider_http_status(), Some(401));
        assert_eq!(first.attempts, 1);
        let second = request()
            .await
            .expect_err("open exact-route circuit must reject before I/O");
        assert_eq!(second.code(), crate::ai_readiness::AI_ROUTE_INCOMPATIBLE);
        assert_eq!(second.attempts, 0);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        assert!(config
            .exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, "provider/other-model")
            .is_ready());
        server.abort();
    }

    #[tokio::test]
    async fn retry_after_opens_only_the_failed_exact_route() {
        let app = Router::new().route(
            "/chat/completions",
            post(|| async {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [("retry-after", "7")],
                    Json(json!({ "error": { "message": "slow down" } })),
                )
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind readiness rate-limit server");
        let address = listener.local_addr().expect("readiness test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-model".to_string(),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let error = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "chat_route_test",
                prompt_version: "chat-route-test-v1",
                capability: ModelCapability::Voice,
                system: "Write one line.",
                user: "Hello.",
                temperature: 0.7,
                max_tokens: 64,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect_err("429 must open a route cooldown");

        assert_eq!(error.provider_http_status(), Some(429));
        assert_eq!(error.retry_after(), Some(Duration::from_secs(7)));
        assert!(!config
            .exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, "test-model")
            .is_ready());
        assert!(config
            .exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, "provider/other-model")
            .is_ready());
        server.abort();
    }

    #[tokio::test]
    async fn provider_4xx_includes_safe_capability_diagnostics() {
        let app = Router::new().route(
            "/chat/completions",
            post(|| async {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": {
                            "code": "unsupported_capability",
                            "message": "test-model does not support image_url with json_schema"
                        }
                    })),
                )
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image policy diagnostic server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "test-model".to_string(),
            reasoning_effort: None,
            ..AiConfig::default()
        };

        let error = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "chat_route_test",
                prompt_version: "chat-route-test-v1",
                capability: ModelCapability::Voice,
                system: "Write one line.",
                user: "Hello.",
                temperature: 0.7,
                max_tokens: 64,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
                room_id: None,
            },
        )
        .await
        .expect_err("provider capability mismatch must fail closed");
        let message = error.to_string();

        assert!(message.contains("HTTP 400 Bad Request"));
        assert!(message.contains("does not support image_url with json_schema"));
        server.abort();
    }
}

#[cfg(test)]
#[path = "ai_gateway_image_tests.rs"]
mod image_tests;
