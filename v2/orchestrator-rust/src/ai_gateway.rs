#[path = "ai_registry.rs"]
mod registry;

use crate::ai_voice_routing::VoiceRoutingConfig;
pub(crate) use registry::{
    CapabilityRegistrySnapshot, DataPolicyMode, ModelAttribution, ModelCapability,
    PinnedModelSelection, RegistryError, AI_CAPABILITY_MODELS_ENV, AI_REGISTRY_ENV,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fmt, sync::Arc, time::Duration};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const GENERATION_DEFAULT_MODE_ENV: &str = "COSYWORLD_GENERATION_DEFAULT_MODE";
pub(crate) const GENERATION_FEATURE_MODES_ENV: &str = "COSYWORLD_GENERATION_FEATURE_MODES_JSON";
pub(crate) const PATHWAY_CONTENT_FEATURE: &str = "pathway_content";
pub(crate) const PATHWAY_CONTENT_PROMPT_VERSION: &str = "pathway-content-v1";
const IMAGE_POLICY_MAX_TOKENS: u32 = 2_048;

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

#[derive(Clone, Debug, Default)]
pub(crate) struct AiConfig {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) vision_model: String,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) vision_reasoning_effort: Option<String>,
    pub(crate) registry: Option<Arc<CapabilityRegistrySnapshot>>,
    pub(crate) capability_models: BTreeMap<ModelCapability, String>,
    pub(crate) data_policy_mode: DataPolicyMode,
    pub(crate) voice_routing: VoiceRoutingConfig,
}

impl AiConfig {
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
        let api_key = match api_key {
            Some(key) => key,
            None if local_ai_base_url(&base_url) => "local-ai".to_string(),
            None => return Ok(None),
        };
        let configured_model = std::env::var("COSYWORLD_AI_MODEL")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_CHAT_MODEL").ok())
            .or_else(|| std::env::var("OPENAI_MODEL").ok());
        let registry = std::env::var(AI_REGISTRY_ENV)
            .ok()
            .map(|value| {
                CapabilityRegistrySnapshot::from_json(&value)
                    .map(Arc::new)
                    .map_err(|error| format!("{AI_REGISTRY_ENV}: {error}"))
            })
            .transpose()?;
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
        let vision_model = std::env::var("COSYWORLD_AI_VISION_MODEL")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_VISION_MODEL").ok())
            .or_else(|| std::env::var("OPENAI_VISION_MODEL").ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| model.clone());
        let reasoning_effort = using_openrouter
            .then(|| std::env::var("OPENROUTER_REASONING_EFFORT").ok())
            .flatten()
            .map(|effort| effort.trim().to_ascii_lowercase())
            .filter(|effort| !effort.is_empty());
        let vision_reasoning_effort = std::env::var("COSYWORLD_AI_VISION_REASONING_EFFORT")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_VISION_REASONING_EFFORT").ok())
            .or_else(|| std::env::var("OPENAI_VISION_REASONING_EFFORT").ok())
            .map(|effort| effort.trim().to_ascii_lowercase())
            .filter(|effort| !effort.is_empty())
            .or_else(|| reasoning_effort.clone());
        let capability_models =
            parse_capability_models(std::env::var(AI_CAPABILITY_MODELS_ENV).ok().as_deref())?;
        let data_policy_mode = if std::env::var("COSYWORLD_DEPLOY_PROFILE")
            .map(|profile| profile.eq_ignore_ascii_case("production"))
            .unwrap_or(false)
        {
            DataPolicyMode::Production
        } else {
            DataPolicyMode::Development
        };
        let voice_routing = VoiceRoutingConfig::from_env()?;

        Ok(Some(Self {
            api_key,
            base_url,
            model,
            vision_model,
            reasoning_effort,
            vision_reasoning_effort,
            registry,
            capability_models,
            data_policy_mode,
            voice_routing,
        }))
    }

    fn pin_model(
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
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct GenerationProvenance {
    pub(crate) source: String,
    pub(crate) feature: String,
    pub(crate) policy_mode: String,
    pub(crate) prompt_version: String,
    pub(crate) provider: String,
    pub(crate) model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model_attribution: Option<ModelAttribution>,
    pub(crate) attempts: u8,
}

impl GenerationProvenance {
    pub(crate) fn for_pathway(
        mode: GenerationMode,
        config: Option<&AiConfig>,
        model_attribution: Option<&ModelAttribution>,
        source: &str,
        attempts: u8,
    ) -> Self {
        Self::for_feature(
            PATHWAY_CONTENT_FEATURE,
            PATHWAY_CONTENT_PROMPT_VERSION,
            mode,
            config,
            model_attribution,
            source,
            attempts,
        )
    }

    pub(crate) fn for_feature(
        feature: &str,
        prompt_version: &str,
        mode: GenerationMode,
        config: Option<&AiConfig>,
        model_attribution: Option<&ModelAttribution>,
        source: &str,
        attempts: u8,
    ) -> Self {
        let provider = model_attribution
            .map(|attribution| attribution.provider.clone())
            .unwrap_or_else(|| ai_provider_name(config).to_string());
        let model = model_attribution
            .map(|attribution| attribution.resolved_model_id.clone())
            .unwrap_or_else(|| ai_model_name(config));
        Self {
            source: source.to_string(),
            feature: feature.to_string(),
            policy_mode: mode.as_str().to_string(),
            prompt_version: prompt_version.to_string(),
            provider,
            model,
            model_attribution: model_attribution.cloned(),
            attempts,
        }
    }
}

fn parse_capability_models(
    value: Option<&str>,
) -> Result<BTreeMap<ModelCapability, String>, String> {
    let raw = match value.map(str::trim) {
        None | Some("") => return Ok(BTreeMap::new()),
        Some(value) => serde_json::from_str::<BTreeMap<ModelCapability, String>>(value)
            .map_err(|error| {
                format!(
                    "{AI_CAPABILITY_MODELS_ENV} must map voice, intent_json, or world_content to model ids: {error}"
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
    Unconfigured,
    Registry,
    Capability,
    Privacy,
    Alias,
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
            Self::Registry => "inference_registry_error",
            Self::Capability => "inference_capability_mismatch",
            Self::Privacy => "inference_privacy_rejected",
            Self::Alias => "inference_alias_unresolved",
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

    fn registry(feature: &str, error: RegistryError) -> Self {
        let kind = match error.code() {
            "inference_capability_mismatch" => AiFailureKind::Capability,
            "inference_privacy_rejected" => AiFailureKind::Privacy,
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

    pub(crate) fn code(&self) -> &'static str {
        self.kind.code()
    }

    pub(crate) fn affects_provider_health(&self) -> bool {
        matches!(
            self.kind,
            AiFailureKind::Timeout
                | AiFailureKind::Transport
                | AiFailureKind::Provider
                | AiFailureKind::InvalidResponse
        )
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
}

#[derive(Clone, Debug)]
pub(crate) struct AiCompletion {
    pub(crate) text: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: Option<ModelAttribution>,
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
pub(crate) struct ImagePolicyRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) image_url: &'a str,
    pub(crate) policy: &'a str,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ImagePolicyDecision {
    pub(crate) allowed: bool,
    pub(crate) violations: Vec<String>,
    pub(crate) summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImagePolicyDecision {
    allowed: bool,
    violations: Vec<String>,
    summary: String,
}

pub(crate) async fn request_chat_completion(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
) -> Result<AiCompletion, AiGatewayError> {
    let selection = config
        .pin_model(request.capability)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    request_completion(
        config,
        request.feature,
        request.prompt_version,
        request.system,
        Value::String(request.user.to_string()),
        Some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        selection.requested_model_id(),
        config.reasoning_effort.as_deref(),
        Some(&selection),
    )
    .await
}

pub(crate) async fn request_chat_completion_with_selection(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
    selection: &PinnedModelSelection,
) -> Result<AiCompletion, AiGatewayError> {
    request_completion(
        config,
        request.feature,
        request.prompt_version,
        request.system,
        Value::String(request.user.to_string()),
        Some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        selection.requested_model_id(),
        config.reasoning_effort.as_deref(),
        Some(selection),
    )
    .await
}

pub(crate) async fn request_image_policy_decision(
    config: &AiConfig,
    request: ImagePolicyRequest<'_>,
) -> Result<ImagePolicyDecision, AiGatewayError> {
    let response_format = json!({
        "type": "json_schema",
        "json_schema": {
            "name": "cosyworld_image_policy",
            "strict": true,
            "schema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "allowed": { "type": "boolean" },
                    "violations": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "person",
                                "character",
                                "creature",
                                "text",
                                "logo",
                                "watermark"
                            ]
                        }
                    },
                    "summary": { "type": "string", "maxLength": 240 }
                },
                "required": ["allowed", "violations", "summary"]
            }
        }
    });
    let user_content = json!([
        {
            "type": "text",
            "text": format!(
                "Review this generated image against the following publication policy. Reject only clearly visible listed violations; do not invent a catch-all violation or infer one from style alone. Policy: {}",
                request.policy
            )
        },
        {
            "type": "image_url",
            "image_url": { "url": request.image_url }
        }
    ]);
    let completion = request_completion(
        config,
        request.feature,
        "image-policy-v1",
        "You are a strict image publication gate. Inspect only visible pixels. Return the required JSON and no prose.",
        user_content,
        None,
        IMAGE_POLICY_MAX_TOKENS,
        request.timeout,
        request.max_attempts,
        request.referer,
        Some(&response_format),
        &config.vision_model,
        config.vision_reasoning_effort.as_deref(),
        None,
    )
    .await?;
    parse_image_policy_decision(&completion.text).map_err(|message| AiGatewayError {
        kind: AiFailureKind::InvalidResponse,
        message,
        attempts: completion.attempts,
        latency: completion.latency,
    })
}

fn parse_image_policy_decision(value: &str) -> Result<ImagePolicyDecision, String> {
    let raw: RawImagePolicyDecision = serde_json::from_str(value.trim())
        .map_err(|error| format!("image policy response was not valid strict JSON: {error}"))?;
    let summary = raw.summary.split_whitespace().collect::<Vec<_>>().join(" ");
    if summary.is_empty()
        || summary.chars().count() > 240
        || summary
            .chars()
            .any(|character| character.is_control() && !character.is_whitespace())
    {
        return Err("image policy response had an invalid summary".to_string());
    }
    const ALLOWED_VIOLATIONS: &[&str] = &[
        "person",
        "character",
        "creature",
        "text",
        "logo",
        "watermark",
    ];
    if raw
        .violations
        .iter()
        .any(|violation| !ALLOWED_VIOLATIONS.contains(&violation.as_str()))
    {
        return Err("image policy response named an unknown violation".to_string());
    }
    if raw.allowed != raw.violations.is_empty() {
        return Err("image policy response contradicted its violation list".to_string());
    }
    Ok(ImagePolicyDecision {
        allowed: raw.allowed,
        violations: raw.violations,
        summary,
    })
}

#[allow(clippy::too_many_arguments)]
async fn request_completion(
    config: &AiConfig,
    feature: &'static str,
    prompt_version: &'static str,
    system: &str,
    user_content: Value,
    temperature: Option<f64>,
    max_tokens: u32,
    timeout: Duration,
    max_attempts: u8,
    referer: &str,
    response_format: Option<&Value>,
    model: &str,
    reasoning_effort: Option<&str>,
    selection: Option<&PinnedModelSelection>,
) -> Result<AiCompletion, AiGatewayError> {
    let started_at = Instant::now();
    let context_hash = {
        let mut hasher = Sha256::new();
        hasher.update(feature.as_bytes());
        hasher.update([0]);
        hasher.update(prompt_version.as_bytes());
        hasher.update([0]);
        hasher.update(system.as_bytes());
        hasher.update([0]);
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

    for attempt in 1..=max_attempts {
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
        let mut payload = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user_content }
            ],
            "max_tokens": max_tokens
        });
        let temperature = selection
            .and_then(|selection| selection.candidate().sampling().temperature)
            .or(temperature);
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
        if let Some(reasoning_effort) = reasoning_effort {
            payload["reasoning"] = json!({ "effort": reasoning_effort });
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
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", referer)
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
                    message: format!("{feature} request failed: {error}"),
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
            let detail = provider_error_detail(response).await;
            return Err(AiGatewayError {
                kind: AiFailureKind::Provider,
                message: format!(
                    "{feature} provider returned HTTP {status}{}",
                    detail
                        .as_deref()
                        .map(|detail| format!(": {detail}"))
                        .unwrap_or_default()
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }

        let body: serde_json::Value = response.json().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response was not valid JSON: {error}"),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
        let first_choice = body
            .get("choices")
            .and_then(|choices| choices.get(0))
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response did not include a choice"),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let text = first_choice
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response did not include message content"),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        let finish_reason = first_choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
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
            "CosyWorld AI inference completed"
        );
        return Ok(AiCompletion {
            text,
            attempts: attempt,
            latency: started_at.elapsed(),
            model_attribution,
            finish_reason,
            usage,
            context_hash,
            prompt_version: prompt_version.to_string(),
        });
    }

    unreachable!("the bounded AI attempt loop always returns")
}

async fn provider_error_detail(response: reqwest::Response) -> Option<String> {
    if response
        .content_length()
        .is_some_and(|length| length > 64 * 1024)
    {
        return Some("provider error body exceeded the diagnostic limit".to_string());
    }
    let body = response.text().await.ok()?;
    let value = serde_json::from_str::<Value>(&body).ok()?;
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
    use base64::Engine;
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
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: None,
            vision_reasoning_effort: None,
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
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: Some("none".to_string()),
            vision_reasoning_effort: Some("low".to_string()),
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
            vision_model: "test-vision-model".to_string(),
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
    async fn production_privacy_rejection_happens_before_network_io() {
        let request_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_seen = request_seen.clone();
                move || {
                    let request_seen = request_seen.clone();
                    async move {
                        request_seen.store(true, Ordering::SeqCst);
                        Json(json!({
                            "choices": [{ "message": { "content": "must not run" } }]
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
            vision_model: "test-vision-model".to_string(),
            registry: Some(Arc::new(registry)),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };

        let error = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "privacy_test",
                prompt_version: "privacy-test-v1",
                capability: ModelCapability::Voice,
                system: "private system",
                user: "private prompt",
                temperature: 0.0,
                max_tokens: 20,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
            },
        )
        .await
        .expect_err("unknown production policy must fail closed");

        assert_eq!(error.code(), "inference_privacy_rejected");
        assert_eq!(error.attempts, 0);
        assert!(!request_seen.load(Ordering::SeqCst));
        server.abort();
    }

    #[tokio::test]
    async fn visible_person_fixture_fails_the_pathway_image_policy() {
        let request_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_seen = request_seen.clone();
                move |Json(body): Json<Value>| {
                    let request_seen = request_seen.clone();
                    async move {
                        let image_url = body
                            .pointer("/messages/1/content/1/image_url/url")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let correct_request = body.get("model").and_then(Value::as_str)
                            == Some("test-vision-model")
                            && body.get("temperature").is_none()
                            && body.get("max_tokens").and_then(Value::as_u64)
                                == Some(u64::from(IMAGE_POLICY_MAX_TOKENS))
                            && body.pointer("/reasoning/effort").and_then(Value::as_str)
                                == Some("low")
                            && body
                                .pointer("/response_format/json_schema/name")
                                .and_then(Value::as_str)
                                == Some("cosyworld_image_policy")
                            && image_url.starts_with("data:image/svg+xml;base64,");
                        request_seen.store(correct_request, Ordering::SeqCst);
                        Json(json!({
                            "choices": [{
                                "message": {
                                    "content": r#"{"allowed":false,"violations":["person"],"summary":"A standing human figure is visible beside the path."}"#
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image policy test server");
        let addr = listener.local_addr().expect("image policy test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let fixture = include_bytes!("test-fixtures/pathway-visible-person.svg");
        let image_url = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(fixture)
        );
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "test-model".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: None,
            vision_reasoning_effort: Some("low".to_string()),
            ..AiConfig::default()
        };

        let decision = request_image_policy_decision(
            &config,
            ImagePolicyRequest {
                feature: "media.pathway_policy",
                image_url: &image_url,
                policy: "Landscape only; no people, characters, or creatures.",
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("fixture review should return a strict decision");

        assert!(!decision.allowed);
        assert_eq!(decision.violations, vec!["person"]);
        assert!(request_seen.load(Ordering::SeqCst));
        server.abort();
    }

    #[tokio::test]
    async fn provider_4xx_includes_safe_image_policy_diagnostics() {
        let app = Router::new().route(
            "/chat/completions",
            post(|| async {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": {
                            "code": "unsupported_capability",
                            "message": "test-vision-model does not support image_url with json_schema"
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
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: None,
            vision_reasoning_effort: None,
            ..AiConfig::default()
        };

        let error = request_image_policy_decision(
            &config,
            ImagePolicyRequest {
                feature: "media.location_image_policy",
                image_url: "data:image/png;base64,dGVzdA==",
                policy: "Landscape only.",
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("provider capability mismatch must fail closed");
        let message = error.to_string();

        assert!(message.contains("HTTP 400 Bad Request"));
        assert!(message.contains("does not support image_url with json_schema"));
        assert!(!message.contains("dGVzdA=="));
        server.abort();
    }

    #[test]
    fn image_policy_decision_fails_closed_on_contradictory_json() {
        assert!(parse_image_policy_decision(
            r#"{"allowed":true,"violations":["person"],"summary":"A person is visible."}"#
        )
        .is_err());
        assert!(parse_image_policy_decision(
            r#"{"allowed":false,"violations":[],"summary":"Nothing visible."}"#
        )
        .is_err());
        assert!(parse_image_policy_decision(
            r#"{"allowed":false,"violations":["other"],"summary":"An unspecified concern."}"#
        )
        .is_err());
    }
}
