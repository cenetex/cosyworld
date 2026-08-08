#[path = "ai_registry.rs"]
mod registry;

use super::{
    compact_whitespace, AppState, GeneratedPathwayState, GeneratedWaypointState, LocationMeta,
    NaturalPotentialPolicy,
};
use crate::ai_voice_routing::VoiceRoutingConfig;
use crate::media_recipes::media_verdict::{
    bounded_visual_verdict_summary, MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use cosyworld_orchestrator::card_policy::{
    CardPolicyModel, CARD_POLICY_DEFAULT_TOP_K, CARD_POLICY_MAX_TOP_K,
};
pub(crate) use registry::{
    CapabilityRegistrySnapshot, DataPolicyMode, ModelAttribution, ModelCapability,
    PinnedModelSelection, RegistryError, AI_CAPABILITY_MODELS_ENV, AI_REGISTRY_ENV,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    sync::Arc,
    time::Duration,
};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const GENERATION_DEFAULT_MODE_ENV: &str = "COSYWORLD_GENERATION_DEFAULT_MODE";
pub(crate) const GENERATION_FEATURE_MODES_ENV: &str = "COSYWORLD_GENERATION_FEATURE_MODES_JSON";
pub(crate) const PATHWAY_CONTENT_FEATURE: &str = "pathway_content";
pub(crate) const PATHWAY_CONTENT_PROMPT_VERSION: &str = "pathway-content-v2";
pub(crate) const CARD_POLICY_MODE_ENV: &str = "COSYWORLD_CARD_POLICY_MODE";
pub(crate) const CARD_POLICY_MODEL_PATH_ENV: &str = "COSYWORLD_CARD_POLICY_MODEL_PATH";
pub(crate) const CARD_POLICY_TOP_K_ENV: &str = "COSYWORLD_CARD_POLICY_TOP_K";
const IMAGE_POLICY_MAX_TOKENS: u32 = 2_048;
const IMAGE_GENERATION_MAX_BYTES: usize = 8 * 1024 * 1024;
const IMAGE_GENERATION_MAX_RESPONSE_BYTES: u64 = 12 * 1024 * 1024;
const IMAGE_GENERATION_MAX_PROMPT_BYTES: usize = 16 * 1024;
const EMBEDDING_MAX_BATCH: usize = 128;
const EMBEDDING_MAX_INPUT_BYTES: usize = 32 * 1024;
const EMBEDDING_MAX_TOTAL_INPUT_BYTES: usize = 512 * 1024;
const EMBEDDING_MAX_DIMENSIONS: usize = 16_384;
const EMBEDDING_MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const RERANK_MAX_DOCUMENTS: usize = 128;
const RERANK_MAX_QUERY_BYTES: usize = 16 * 1024;
const RERANK_MAX_DOCUMENT_BYTES: usize = 32 * 1024;
const RERANK_MAX_TOTAL_INPUT_BYTES: usize = 512 * 1024;
const RERANK_MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const SPEECH_SYNTHESIS_MAX_TEXT_BYTES: usize = 32 * 1024;
const SPEECH_SYNTHESIS_MAX_VOICE_BYTES: usize = 128;
const SPEECH_SYNTHESIS_MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const SPEECH_SYNTHESIS_GENERATION_ID_MAX_BYTES: usize = 256;
// The exact-bound STT gateway is intentionally dormant until a server-authored
// transcription action owns its input provenance and publication contract.
#[allow(dead_code)]
const TRANSCRIPTION_MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;
#[allow(dead_code)]
const TRANSCRIPTION_MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
// When a raw actor's catalog entry explicitly advertises the unified reasoning
// parameter, prefer visible speech over hidden work. This must never be sent to
// every raw model: some endpoints reject reasoning controls, while mandatory-
// reasoning endpoints need the bounded compatibility fallback below.
const RAW_DIALOGUE_DISABLED_REASONING_EFFORT: &str = "none";
const REASONING_MANDATORY_ERROR: &str =
    "reasoning is mandatory for this endpoint and cannot be disabled";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum CardPolicyRolloutMode {
    #[default]
    Off,
    Shadow,
    Live,
}

impl CardPolicyRolloutMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "off" | "" => Ok(Self::Off),
            "shadow" => Ok(Self::Shadow),
            "live" => Ok(Self::Live),
            _ => Err(format!(
                "{CARD_POLICY_MODE_ENV} must be off, shadow, or live; got {value:?}"
            )),
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Shadow => "shadow",
            Self::Live => "live",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CardPolicyRollout {
    pub(crate) mode: CardPolicyRolloutMode,
    pub(crate) model: Arc<CardPolicyModel>,
    pub(crate) model_hash: u64,
    pub(crate) top_k: usize,
}

impl CardPolicyRollout {
    pub(crate) fn from_env() -> Result<Option<Self>, String> {
        let mode = CardPolicyRolloutMode::parse(
            &std::env::var(CARD_POLICY_MODE_ENV).unwrap_or_else(|_| "off".to_string()),
        )?;
        if mode == CardPolicyRolloutMode::Off {
            return Ok(None);
        }
        let artifact_path = std::env::var(CARD_POLICY_MODEL_PATH_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!("{CARD_POLICY_MODEL_PATH_ENV} is required when card policy is enabled")
            })?;
        let bytes = std::fs::read(&artifact_path).map_err(|error| {
            format!("cannot read {CARD_POLICY_MODEL_PATH_ENV}={artifact_path:?}: {error}")
        })?;
        let model = CardPolicyModel::from_bytes(&bytes)
            .map_err(|error| format!("invalid card-policy artifact {artifact_path:?}: {error}"))?;
        let model_hash = model.model_hash();
        let top_k = std::env::var(CARD_POLICY_TOP_K_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .parse::<usize>()
                    .map_err(|_| format!("{CARD_POLICY_TOP_K_ENV} must be an integer from 1 to 3"))
            })
            .transpose()?
            .unwrap_or(CARD_POLICY_DEFAULT_TOP_K);
        if !(1..=CARD_POLICY_MAX_TOP_K).contains(&top_k) {
            return Err(format!(
                "{CARD_POLICY_TOP_K_ENV} must be from 1 to {CARD_POLICY_MAX_TOP_K}; got {top_k}"
            ));
        }
        tracing::info!(
            mode = mode.as_str(),
            top_k,
            model_hash = format_args!("{model_hash:016x}"),
            artifact_path = %artifact_path,
            "loaded resident card-policy ranker"
        );
        Ok(Some(Self {
            mode,
            model: Arc::new(model),
            model_hash,
            top_k,
        }))
    }
}

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
    pub(crate) card_policy: Option<Arc<CardPolicyRollout>>,
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
        let api_key = match enabled_ai_api_key(api_key, &base_url) {
            Some(key) => key,
            None => return Ok(None),
        };
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
        let fallback_registry;
        let effective_registry = if let Some(snapshot) = registry.as_deref() {
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
            // The local card ranker is loaded by AppState independently of the
            // remote AI provider. AppState attaches it here when an AI-backed
            // voice configuration is also present.
            card_policy: None,
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

    pub(crate) fn pin_actor_model(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let configured_provider = ai_provider_name(Some(self));
        if configured_provider != "openrouter" {
            return Err(RegistryError::ProviderMismatch {
                model: binding.requested_model_id.clone(),
                declared: "openrouter".to_string(),
                discovered: configured_provider.to_string(),
            });
        }
        PinnedModelSelection::from_actor_binding(binding, self.data_policy_mode)
    }

    pub(crate) fn pin_actor_image_model(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let configured_provider = ai_provider_name(Some(self));
        let local_development_adapter = self.data_policy_mode == DataPolicyMode::Development
            && local_ai_base_url(&self.base_url);
        if configured_provider != "openrouter" && !local_development_adapter {
            return Err(RegistryError::ProviderMismatch {
                model: binding.requested_model_id.clone(),
                declared: "openrouter".to_string(),
                discovered: configured_provider.to_string(),
            });
        }
        PinnedModelSelection::from_actor_image_binding(binding, self.data_policy_mode)
    }

    pub(crate) fn pin_actor_embedding_model(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let configured_provider = ai_provider_name(Some(self));
        let local_development_adapter = self.data_policy_mode == DataPolicyMode::Development
            && local_ai_base_url(&self.base_url);
        if configured_provider != "openrouter" && !local_development_adapter {
            return Err(RegistryError::ProviderMismatch {
                model: binding.requested_model_id.clone(),
                declared: "openrouter".to_string(),
                discovered: configured_provider.to_string(),
            });
        }
        PinnedModelSelection::from_actor_embedding_binding(binding, self.data_policy_mode)
    }

    pub(crate) fn pin_actor_rerank_model(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let configured_provider = ai_provider_name(Some(self));
        let local_development_adapter = self.data_policy_mode == DataPolicyMode::Development
            && local_ai_base_url(&self.base_url);
        if configured_provider != "openrouter" && !local_development_adapter {
            return Err(RegistryError::ProviderMismatch {
                model: binding.requested_model_id.clone(),
                declared: "openrouter".to_string(),
                discovered: configured_provider.to_string(),
            });
        }
        PinnedModelSelection::from_actor_rerank_binding(binding, self.data_policy_mode)
    }

    pub(crate) fn pin_actor_speech_synthesis_model(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let configured_provider = ai_provider_name(Some(self));
        let local_development_adapter = self.data_policy_mode == DataPolicyMode::Development
            && local_ai_base_url(&self.base_url);
        if configured_provider != "openrouter" && !local_development_adapter {
            return Err(RegistryError::ProviderMismatch {
                model: binding.requested_model_id.clone(),
                declared: "openrouter".to_string(),
                discovered: configured_provider.to_string(),
            });
        }
        PinnedModelSelection::from_actor_speech_synthesis_binding(binding, self.data_policy_mode)
    }

    #[allow(dead_code)] // Reserved for the exact-bound, server-authored STT action.
    pub(crate) fn pin_actor_transcription_model(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let configured_provider = ai_provider_name(Some(self));
        let local_development_adapter = self.data_policy_mode == DataPolicyMode::Development
            && local_ai_base_url(&self.base_url);
        if configured_provider != "openrouter" && !local_development_adapter {
            return Err(RegistryError::ProviderMismatch {
                model: binding.requested_model_id.clone(),
                declared: "openrouter".to_string(),
                discovered: configured_provider.to_string(),
            });
        }
        PinnedModelSelection::from_actor_transcription_binding(binding, self.data_policy_mode)
    }
}

fn enabled_ai_api_key(api_key: Option<String>, base_url: &str) -> Option<String> {
    api_key.or_else(|| local_ai_base_url(base_url).then(|| "local-ai".to_string()))
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

    // A missing explicit registry uses the same synthesized legacy snapshot as
    // runtime pinning. In production that snapshot has no reviewed data-policy
    // declaration, so this audit refuses startup instead of booting an AI
    // configuration whose every request will be privacy rejected.
    let coverage = registry.audit_required_capabilities(data_policy_mode);
    if coverage.is_fatal() {
        return Err(coverage.to_string());
    }
    if !coverage.is_covered() {
        tracing::error!("{coverage}");
    }
    Ok(())
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
pub(crate) struct ImageGenerationRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) prompt: &'a str,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

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

#[derive(Clone, Copy, Debug)]
pub(crate) struct EmbeddingRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) inputs: &'a [String],
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Debug)]
pub(crate) struct AiEmbeddings {
    /// Vectors are ordered to match the request inputs, even if the provider
    /// sends its indexed response entries out of order.
    pub(crate) vectors: Vec<Vec<f32>>,
    #[allow(dead_code)] // Retained as truthful gateway execution metadata.
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: ModelAttribution,
    #[allow(dead_code)] // Retained for publication accounting once token ledgers consume it.
    pub(crate) usage: AiTokenUsage,
    pub(crate) context_hash: String,
    pub(crate) prompt_version: String,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RerankRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) query: &'a str,
    pub(crate) documents: &'a [String],
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RerankScore {
    pub(crate) index: usize,
    pub(crate) relevance_score: f64,
}

#[derive(Clone, Debug)]
pub(crate) struct AiRerankResult {
    /// Provider ranking order, with each original document index represented
    /// exactly once.
    pub(crate) scores: Vec<RerankScore>,
    #[allow(dead_code)] // Retained as truthful gateway execution metadata.
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: ModelAttribution,
    #[allow(dead_code)] // Retained for publication accounting once token ledgers consume it.
    pub(crate) usage: AiTokenUsage,
    pub(crate) context_hash: String,
    pub(crate) prompt_version: String,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SpeechSynthesisRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) text: &'a str,
    /// Exact provider voice id chosen by the caller; the gateway never
    /// substitutes a default voice behind the caller's back.
    pub(crate) voice: &'a str,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Debug)]
pub(crate) struct AiSynthesizedSpeech {
    pub(crate) bytes: Vec<u8>,
    pub(crate) content_type: String,
    #[allow(dead_code)] // Preserved for provider generation audit correlation.
    pub(crate) generation_id: Option<String>,
    #[allow(dead_code)] // Retained as truthful gateway execution metadata.
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: ModelAttribution,
    pub(crate) context_hash: String,
    pub(crate) prompt_version: String,
}

#[allow(dead_code)] // Awaiting a server-authored STT action with bounded provenance.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TranscriptionRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) input_audio: &'a [u8],
    pub(crate) input_audio_format: TranscriptionAudioFormat,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[allow(dead_code)] // Awaiting the same exact-bound STT action as TranscriptionRequest.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TranscriptionAudioFormat {
    Mp3,
    Wav,
}

#[allow(dead_code)]
impl TranscriptionAudioFormat {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
        }
    }
}

#[allow(dead_code)] // Complete result contract retained until STT publication is wired.
#[derive(Clone, Debug)]
pub(crate) struct AiTranscription {
    pub(crate) text: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: ModelAttribution,
    pub(crate) usage: AiTokenUsage,
    pub(crate) context_hash: String,
    pub(crate) prompt_version: String,
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
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
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
    let raw_mode = selection.uses_raw_prompt_adapter();
    request_completion(
        config,
        request.feature,
        request.prompt_version,
        request.system,
        Value::String(request.user.to_string()),
        (!raw_mode).then_some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        selection.requested_model_id(),
        if raw_mode {
            selection
                .candidate()
                .supported_parameters()
                .reasoning
                .then_some(RAW_DIALOGUE_DISABLED_REASONING_EFFORT)
        } else {
            config.reasoning_effort.as_deref()
        },
        raw_mode,
        selection.enforces_zero_data_retention(),
        Some(&selection),
    )
    .await
}

pub(crate) async fn request_chat_completion_with_selection(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
    selection: &PinnedModelSelection,
) -> Result<AiCompletion, AiGatewayError> {
    let raw_mode = selection.uses_raw_prompt_adapter();
    request_completion(
        config,
        request.feature,
        request.prompt_version,
        request.system,
        Value::String(request.user.to_string()),
        (!raw_mode).then_some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        selection.requested_model_id(),
        if raw_mode {
            selection
                .candidate()
                .supported_parameters()
                .reasoning
                .then_some(RAW_DIALOGUE_DISABLED_REASONING_EFFORT)
        } else {
            config.reasoning_effort.as_deref()
        },
        raw_mode,
        selection.enforces_zero_data_retention(),
        Some(selection),
    )
    .await
}

pub(crate) async fn request_embeddings_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: EmbeddingRequest<'_>,
) -> Result<AiEmbeddings, AiGatewayError> {
    let started_at = Instant::now();
    let invalid_input = request.inputs.is_empty()
        || request.inputs.len() > EMBEDDING_MAX_BATCH
        || request
            .inputs
            .iter()
            .any(|input| input.trim().is_empty() || input.len() > EMBEDDING_MAX_INPUT_BYTES);
    let total_input_bytes = request
        .inputs
        .iter()
        .fold(0usize, |total, input| total.saturating_add(input.len()));
    if invalid_input || total_input_bytes > EMBEDDING_MAX_TOTAL_INPUT_BYTES {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} embedding inputs were empty or exceeded their batch or byte limits",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let selection = config
        .pin_actor_embedding_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let context_hash = exact_endpoint_context_hash(
        request.feature,
        request.prompt_version,
        None,
        request.inputs,
    );
    let mut payload = json!({
        "model": selection.requested_model_id(),
        "input": request.inputs,
        "encoding_format": "float",
    });
    add_exact_binding_zdr_constraint(&mut payload, &selection);
    let (body, attempt) = post_bounded_exact_json(
        config,
        request.feature,
        "embeddings",
        request.referer,
        &payload,
        request.timeout,
        request.max_attempts,
        EMBEDDING_MAX_RESPONSE_BYTES,
        &started_at,
    )
    .await?;

    let data = body
        .get("data")
        .and_then(Value::as_array)
        .filter(|data| data.len() == request.inputs.len())
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!(
                "{} response did not include one embedding per input",
                request.feature
            ),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
    let mut vectors = vec![None::<Vec<f32>>; request.inputs.len()];
    let mut expected_dimensions = None::<usize>;
    for item in data {
        let index = item
            .get("index")
            .and_then(Value::as_u64)
            .and_then(|index| usize::try_from(index).ok())
            .filter(|index| *index < request.inputs.len())
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response contained an invalid embedding index",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        if vectors[index].is_some() {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} response repeated an embedding index", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let raw_vector = item
            .get("embedding")
            .and_then(Value::as_array)
            .filter(|vector| !vector.is_empty() && vector.len() <= EMBEDDING_MAX_DIMENSIONS)
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response contained an empty or oversized embedding",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        if expected_dimensions.is_some_and(|dimensions| dimensions != raw_vector.len()) {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response contained inconsistent embedding dimensions",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        expected_dimensions = Some(raw_vector.len());
        let vector = raw_vector
            .iter()
            .map(|value| {
                let value = value.as_f64()?;
                let compact = value as f32;
                (value.is_finite() && compact.is_finite()).then_some(compact)
            })
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response contained a non-finite embedding value",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        vectors[index] = Some(vector);
    }
    let vectors = vectors
        .into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{} response omitted an embedding index", request.feature),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
    let model_attribution =
        exact_endpoint_model_attribution(request.feature, &selection, &body, attempt, &started_at)?;
    let usage = token_usage(&body);
    tracing::info!(
        feature = request.feature,
        provider = %model_attribution.provider,
        requested_model = %model_attribution.requested_model_id,
        resolved_model = %model_attribution.resolved_model_id,
        batch_size = vectors.len(),
        dimensions = expected_dimensions.unwrap_or_default(),
        attempts = attempt,
        latency_ms = started_at.elapsed().as_millis() as u64,
        "CosyWorld AI embedding inference completed"
    );
    Ok(AiEmbeddings {
        vectors,
        attempts: attempt,
        latency: started_at.elapsed(),
        model_attribution,
        usage,
        context_hash,
        prompt_version: request.prompt_version.to_string(),
    })
}

pub(crate) async fn request_rerank_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: RerankRequest<'_>,
) -> Result<AiRerankResult, AiGatewayError> {
    let started_at = Instant::now();
    let invalid_query =
        request.query.trim().is_empty() || request.query.len() > RERANK_MAX_QUERY_BYTES;
    let invalid_documents = request.documents.is_empty()
        || request.documents.len() > RERANK_MAX_DOCUMENTS
        || request.documents.iter().any(|document| {
            document.trim().is_empty() || document.len() > RERANK_MAX_DOCUMENT_BYTES
        });
    let total_input_bytes = request
        .documents
        .iter()
        .fold(request.query.len(), |total, document| {
            total.saturating_add(document.len())
        });
    if invalid_query || invalid_documents || total_input_bytes > RERANK_MAX_TOTAL_INPUT_BYTES {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} rerank inputs were empty or exceeded their batch or byte limits",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let selection = config
        .pin_actor_rerank_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let context_hash = exact_endpoint_context_hash(
        request.feature,
        request.prompt_version,
        Some(request.query),
        request.documents,
    );
    let mut payload = json!({
        "model": selection.requested_model_id(),
        "query": request.query,
        "documents": request.documents,
    });
    add_exact_binding_zdr_constraint(&mut payload, &selection);
    let (body, attempt) = post_bounded_exact_json(
        config,
        request.feature,
        "rerank",
        request.referer,
        &payload,
        request.timeout,
        request.max_attempts,
        RERANK_MAX_RESPONSE_BYTES,
        &started_at,
    )
    .await?;

    let results = body
        .get("results")
        .and_then(Value::as_array)
        .filter(|results| results.len() == request.documents.len())
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{} response did not rank every document", request.feature),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
    let mut seen = vec![false; request.documents.len()];
    let mut scores = Vec::with_capacity(results.len());
    let mut previous_score = None::<f64>;
    for result in results {
        let index = result
            .get("index")
            .and_then(Value::as_u64)
            .and_then(|index| usize::try_from(index).ok())
            .filter(|index| *index < request.documents.len())
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response contained an invalid rerank index",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        if seen[index] {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{} response repeated a rerank index", request.feature),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        seen[index] = true;
        let relevance_score = result
            .get("relevance_score")
            .and_then(Value::as_f64)
            .filter(|score| score.is_finite() && (0.0..=1.0).contains(score))
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response contained an invalid relevance score",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        if previous_score.is_some_and(|previous| relevance_score > previous) {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} response was not sorted by relevance score",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        previous_score = Some(relevance_score);
        scores.push(RerankScore {
            index,
            relevance_score,
        });
    }
    if seen.iter().any(|seen| !seen) {
        return Err(AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{} response omitted a rerank index", request.feature),
            attempts: attempt,
            latency: started_at.elapsed(),
        });
    }
    let model_attribution =
        exact_endpoint_model_attribution(request.feature, &selection, &body, attempt, &started_at)?;
    let usage = token_usage(&body);
    tracing::info!(
        feature = request.feature,
        provider = %model_attribution.provider,
        requested_model = %model_attribution.requested_model_id,
        resolved_model = %model_attribution.resolved_model_id,
        document_count = scores.len(),
        attempts = attempt,
        latency_ms = started_at.elapsed().as_millis() as u64,
        "CosyWorld AI rerank inference completed"
    );
    Ok(AiRerankResult {
        scores,
        attempts: attempt,
        latency: started_at.elapsed(),
        model_attribution,
        usage,
        context_hash,
        prompt_version: request.prompt_version.to_string(),
    })
}

pub(crate) async fn request_speech_synthesis_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: SpeechSynthesisRequest<'_>,
) -> Result<AiSynthesizedSpeech, AiGatewayError> {
    let started_at = Instant::now();
    let voice = request.voice.trim();
    if request.text.trim().is_empty()
        || request.text.len() > SPEECH_SYNTHESIS_MAX_TEXT_BYTES
        || voice.is_empty()
        || voice.len() > SPEECH_SYNTHESIS_MAX_VOICE_BYTES
        || voice != request.voice
        || voice.chars().any(char::is_control)
    {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} speech text or caller-pinned voice was empty or exceeded its byte limit",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let selection = config
        .pin_actor_speech_synthesis_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let context_hash = exact_endpoint_binary_context_hash(
        request.feature,
        request.prompt_version,
        &[voice.as_bytes(), request.text.as_bytes()],
    );
    let mut payload = json!({
        "model": selection.requested_model_id(),
        "input": request.text,
        "voice": voice,
        "response_format": "mp3",
    });
    add_exact_binding_zdr_constraint(&mut payload, &selection);
    let (bytes, generation_id, attempt) = post_bounded_exact_audio(
        config,
        request.feature,
        "audio/speech",
        request.referer,
        &payload,
        request.timeout,
        request.max_attempts,
        &started_at,
    )
    .await?;
    let model_attribution = selection.attribute_response(None).map_err(|error| {
        let mut error = AiGatewayError::registry(request.feature, error);
        error.attempts = attempt;
        error.latency = started_at.elapsed();
        error
    })?;
    tracing::info!(
        feature = request.feature,
        provider = %model_attribution.provider,
        requested_model = %model_attribution.requested_model_id,
        resolved_model = %model_attribution.resolved_model_id,
        audio_bytes = bytes.len(),
        attempts = attempt,
        latency_ms = started_at.elapsed().as_millis() as u64,
        "CosyWorld AI speech synthesis completed"
    );
    Ok(AiSynthesizedSpeech {
        bytes,
        content_type: "audio/mpeg".to_string(),
        generation_id,
        attempts: attempt,
        latency: started_at.elapsed(),
        model_attribution,
        context_hash,
        prompt_version: request.prompt_version.to_string(),
    })
}

#[allow(dead_code)] // Safe primitive is held dormant until input provenance is enforced.
pub(crate) async fn request_transcription_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: TranscriptionRequest<'_>,
) -> Result<AiTranscription, AiGatewayError> {
    let started_at = Instant::now();
    if request.input_audio.is_empty() || request.input_audio.len() > TRANSCRIPTION_MAX_AUDIO_BYTES {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!(
                "{} transcription audio was empty or exceeded its byte limit",
                request.feature
            ),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let selection = config
        .pin_actor_transcription_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let context_hash = exact_endpoint_binary_context_hash(
        request.feature,
        request.prompt_version,
        &[
            request.input_audio_format.as_str().as_bytes(),
            request.input_audio,
        ],
    );
    let mut payload = json!({
        "model": selection.requested_model_id(),
        "input_audio": {
            "data": BASE64_STANDARD.encode(request.input_audio),
            "format": request.input_audio_format.as_str(),
        },
    });
    add_exact_binding_zdr_constraint(&mut payload, &selection);
    let (body, attempt) = post_bounded_exact_json(
        config,
        request.feature,
        "audio/transcriptions",
        request.referer,
        &payload,
        request.timeout,
        request.max_attempts,
        TRANSCRIPTION_MAX_RESPONSE_BYTES,
        &started_at,
    )
    .await?;
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!(
                "{} response omitted a non-empty transcript",
                request.feature
            ),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?
        .to_string();
    let model_attribution = exact_endpoint_optional_model_attribution(
        request.feature,
        &selection,
        &body,
        attempt,
        &started_at,
    )?;
    let usage = token_usage(&body);
    tracing::info!(
        feature = request.feature,
        provider = %model_attribution.provider,
        requested_model = %model_attribution.requested_model_id,
        resolved_model = %model_attribution.resolved_model_id,
        input_audio_bytes = request.input_audio.len(),
        transcript_bytes = text.len(),
        attempts = attempt,
        latency_ms = started_at.elapsed().as_millis() as u64,
        "CosyWorld AI transcription completed"
    );
    Ok(AiTranscription {
        text,
        attempts: attempt,
        latency: started_at.elapsed(),
        model_attribution,
        usage,
        context_hash,
        prompt_version: request.prompt_version.to_string(),
    })
}

fn add_exact_binding_zdr_constraint(payload: &mut Value, selection: &PinnedModelSelection) {
    if selection.enforces_zero_data_retention() {
        payload["provider"] = json!({
            "data_collection": "deny",
            "zdr": true,
        });
    }
}

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

fn exact_endpoint_binary_context_hash(
    feature: &str,
    prompt_version: &str,
    values: &[&[u8]],
) -> String {
    let mut hasher = Sha256::new();
    for component in [feature.as_bytes(), prompt_version.as_bytes()]
        .into_iter()
        .chain(values.iter().copied())
    {
        hasher.update(component.len().to_be_bytes());
        hasher.update(component);
    }
    format!("{:x}", hasher.finalize())
}

fn token_usage(body: &Value) -> AiTokenUsage {
    let usage = body.get("usage");
    AiTokenUsage {
        prompt_tokens: usage
            .and_then(|usage| usage.get("prompt_tokens"))
            .and_then(Value::as_u64)
            .or_else(|| {
                usage
                    .and_then(|usage| usage.get("input_tokens"))
                    .and_then(Value::as_u64)
            }),
        completion_tokens: usage
            .and_then(|usage| usage.get("completion_tokens"))
            .and_then(Value::as_u64)
            .or_else(|| {
                usage
                    .and_then(|usage| usage.get("output_tokens"))
                    .and_then(Value::as_u64)
            }),
        total_tokens: usage
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_u64),
    }
}

fn exact_endpoint_model_attribution(
    feature: &str,
    selection: &PinnedModelSelection,
    body: &Value,
    attempt: u8,
    started_at: &Instant,
) -> Result<ModelAttribution, AiGatewayError> {
    let provider_model = body
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.trim().is_empty())
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response omitted model attribution"),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
    let requested_model = selection.requested_model_id();
    let concrete_model = selection
        .candidate()
        .concrete_model()
        .map(|identity| identity.model_id.as_str());
    if provider_model != requested_model && Some(provider_model) != concrete_model {
        return Err(AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} provider attributed the response to an unexpected model"),
            attempts: attempt,
            latency: started_at.elapsed(),
        });
    }
    selection
        .attribute_response(Some(provider_model))
        .map_err(|error| {
            let mut error = AiGatewayError::registry(feature, error);
            error.attempts = attempt;
            error.latency = started_at.elapsed();
            error
        })
}

#[allow(dead_code)] // STT permits omitted response model while pinning the request model.
fn exact_endpoint_optional_model_attribution(
    feature: &str,
    selection: &PinnedModelSelection,
    body: &Value,
    attempt: u8,
    started_at: &Instant,
) -> Result<ModelAttribution, AiGatewayError> {
    match body.get("model") {
        None | Some(Value::Null) => selection.attribute_response(None).map_err(|error| {
            let mut error = AiGatewayError::registry(feature, error);
            error.attempts = attempt;
            error.latency = started_at.elapsed();
            error
        }),
        Some(Value::String(model)) if model.trim().is_empty() => {
            selection.attribute_response(None).map_err(|error| {
                let mut error = AiGatewayError::registry(feature, error);
                error.attempts = attempt;
                error.latency = started_at.elapsed();
                error
            })
        }
        Some(Value::String(_)) => {
            exact_endpoint_model_attribution(feature, selection, body, attempt, started_at)
        }
        Some(_) => Err(AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response contained invalid model attribution"),
            attempts: attempt,
            latency: started_at.elapsed(),
        }),
    }
}

#[allow(clippy::too_many_arguments)]
async fn post_bounded_exact_json(
    config: &AiConfig,
    feature: &str,
    endpoint: &str,
    referer: &str,
    payload: &Value,
    timeout: Duration,
    max_attempts: u8,
    response_limit: usize,
    started_at: &Instant,
) -> Result<(Value, u8), AiGatewayError> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{feature} client setup failed: {error}"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/{endpoint}", config.base_url);
    let max_attempts = max_attempts.max(1);
    for attempt in 1..=max_attempts {
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", referer)
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .json(payload)
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
            // Request-shape and other deterministic 4xx failures are terminal.
            // Rate limiting is transient and retains the ordinary bounded retry.
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
        if response
            .content_length()
            .is_some_and(|length| length > response_limit as u64)
        {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response exceeded its byte limit"),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let mut response_bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response body could not be read: {error}"),
            attempts: attempt,
            latency: started_at.elapsed(),
        })? {
            if response_bytes.len().saturating_add(chunk.len()) > response_limit {
                return Err(AiGatewayError {
                    kind: AiFailureKind::InvalidResponse,
                    message: format!("{feature} response exceeded its byte limit"),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                });
            }
            response_bytes.extend_from_slice(&chunk);
        }
        let body =
            serde_json::from_slice::<Value>(&response_bytes).map_err(|error| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response was not valid JSON: {error}"),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
        return Ok((body, attempt));
    }
    unreachable!("the bounded exact-endpoint attempt loop always returns")
}

#[allow(clippy::too_many_arguments)]
async fn post_bounded_exact_audio(
    config: &AiConfig,
    feature: &str,
    endpoint: &str,
    referer: &str,
    payload: &Value,
    timeout: Duration,
    max_attempts: u8,
    started_at: &Instant,
) -> Result<(Vec<u8>, Option<String>, u8), AiGatewayError> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{feature} client setup failed: {error}"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/{endpoint}", config.base_url);
    let max_attempts = max_attempts.max(1);
    for attempt in 1..=max_attempts {
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", referer)
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .json(payload)
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

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim);
        if !content_type.is_some_and(|value| value.eq_ignore_ascii_case("audio/mpeg")) {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response content type was not audio/mpeg"),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let generation_id = response
            .headers()
            .get("X-Generation-Id")
            .map(|value| {
                let value = value.to_str().map_err(|_| AiGatewayError {
                    kind: AiFailureKind::InvalidResponse,
                    message: format!("{feature} response contained an invalid generation id"),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                })?;
                let trimmed = value.trim();
                if trimmed.is_empty()
                    || trimmed.len() > SPEECH_SYNTHESIS_GENERATION_ID_MAX_BYTES
                    || trimmed.chars().any(char::is_control)
                {
                    return Err(AiGatewayError {
                        kind: AiFailureKind::InvalidResponse,
                        message: format!(
                            "{feature} response generation id was empty or exceeded its byte limit"
                        ),
                        attempts: attempt,
                        latency: started_at.elapsed(),
                    });
                }
                Ok(trimmed.to_string())
            })
            .transpose()?;
        if response
            .content_length()
            .is_some_and(|length| length > SPEECH_SYNTHESIS_MAX_RESPONSE_BYTES as u64)
        {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response exceeded its byte limit"),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let mut response_bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response body could not be read: {error}"),
            attempts: attempt,
            latency: started_at.elapsed(),
        })? {
            if response_bytes.len().saturating_add(chunk.len())
                > SPEECH_SYNTHESIS_MAX_RESPONSE_BYTES
            {
                return Err(AiGatewayError {
                    kind: AiFailureKind::InvalidResponse,
                    message: format!("{feature} response exceeded its byte limit"),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                });
            }
            response_bytes.extend_from_slice(&chunk);
        }
        if response_bytes.is_empty() {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response contained empty audio"),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        return Ok((response_bytes, generation_id, attempt));
    }
    unreachable!("the bounded exact-audio attempt loop always returns")
}

pub(crate) async fn request_image_generation_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: ImageGenerationRequest<'_>,
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
    let selection = config
        .pin_actor_image_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let context_hash = {
        let mut hasher = Sha256::new();
        hasher.update(request.feature.as_bytes());
        hasher.update([0]);
        hasher.update(request.prompt_version.as_bytes());
        hasher.update([0]);
        hasher.update(request.prompt.as_bytes());
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
        add_exact_binding_zdr_constraint(&mut payload, &selection);
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
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
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
            let detail = provider_error_detail(response).await;
            return Err(AiGatewayError {
                kind: AiFailureKind::Provider,
                message: format!(
                    "{} provider returned HTTP {status}{}",
                    request.feature,
                    detail
                        .as_deref()
                        .map(|detail| format!(": {detail}"))
                        .unwrap_or_default()
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
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
                                "safety",
                                "text",
                                "logo",
                                "watermark",
                                "system_leak",
                                "ui_chrome",
                                "missing_subject",
                                "extra_subject",
                                "identity_drift",
                                "missing_item",
                                "wrong_holder",
                                "wrong_environment",
                                "bad_crop",
                                "pack_negative"
                            ]
                        }
                    },
                    "summary": {
                        "type": "string",
                        "maxLength": MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT
                    }
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
        false,
        false,
        None,
    )
    .await?;
    let mut decision =
        parse_image_policy_decision(&completion.text).map_err(|message| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message,
            attempts: completion.attempts,
            latency: completion.latency,
        })?;
    decision.attempts = completion.attempts;
    decision.latency = completion.latency;
    Ok(decision)
}

fn parse_image_policy_decision(value: &str) -> Result<ImagePolicyDecision, String> {
    let raw: RawImagePolicyDecision = serde_json::from_str(value.trim())
        .map_err(|error| format!("image policy response was not valid strict JSON: {error}"))?;
    let summary = bounded_visual_verdict_summary(&raw.summary);
    if summary.is_empty()
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
        "safety",
        "text",
        "logo",
        "watermark",
        "system_leak",
        "ui_chrome",
        "missing_subject",
        "extra_subject",
        "identity_drift",
        "missing_item",
        "wrong_holder",
        "wrong_environment",
        "bad_crop",
        "pack_negative",
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
        attempts: 0,
        latency: Duration::ZERO,
    })
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
    if detail.trim_end_matches(['.', ' ']) == REASONING_MANDATORY_ERROR {
        let already_enabled = current_reasoning
            .and_then(|reasoning| reasoning.get("enabled"))
            .and_then(Value::as_bool)
            == Some(true);
        return (!already_enabled).then_some(ReasoningCompatibilityFallback::Enable);
    }
    let rejects_reasoning_control = detail.contains("reasoning")
        && (detail.contains("not supported")
            || detail.contains("unsupported")
            || detail.contains("unknown parameter")
            || detail.contains("unrecognized parameter"));
    (current_reasoning.is_some() && rejects_reasoning_control)
        .then_some(ReasoningCompatibilityFallback::Omit)
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
    raw_mode: bool,
    enforce_zero_data_retention: bool,
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
        let messages = if raw_mode && system.trim().is_empty() {
            json!([{ "role": "user", "content": user_content }])
        } else {
            json!([
                { "role": "system", "content": system },
                { "role": "user", "content": user_content }
            ])
        };
        let mut payload = json!({
            "model": model,
            "messages": messages,
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
        if raw_mode && enforce_zero_data_retention {
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
                        continue 'attempts;
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
            if status.is_success() {
                break response;
            }
            let retryable = status.as_u16() == 429 || status.is_server_error();
            if retryable && attempt < max_attempts {
                sleep(retry_delay(attempt)).await;
                continue 'attempts;
            }
            let detail = provider_error_detail(response).await;
            if raw_mode && !reasoning_compatibility_retried {
                if let Some(fallback) = reasoning_compatibility_fallback(
                    status,
                    detail.as_deref(),
                    payload.get("reasoning"),
                ) {
                    match fallback {
                        ReasoningCompatibilityFallback::Enable => {
                            payload["reasoning"] = json!({ "enabled": true, "exclude": true });
                        }
                        ReasoningCompatibilityFallback::Omit => {
                            if let Some(body) = payload.as_object_mut() {
                                body.remove("reasoning");
                            }
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
        };

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
            // A completion that reaches this line is not necessarily one the
            // publication gate accepts: finish_reason "length" is a truncated
            // completion, and voice_finish_incomplete rejects it downstream.
            // Without these, distinguishing a token budget that is really too
            // tight from a model that stops cleanly but fails the structural
            // check meant reproducing the failure locally.
            finish_reason = %finish_reason,
            requested_max_tokens = max_tokens,
            completion_tokens = usage.completion_tokens.unwrap_or(0),
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
    ai_provider_name_for_base_url(&config.base_url)
}

fn ai_provider_name_for_base_url(base_url: &str) -> &'static str {
    if base_url.contains("openrouter.ai") {
        "openrouter"
    } else if base_url.contains("api.openai.com") {
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

pub(super) struct PathwayContentPromptContext {
    pub(super) prompt: String,
    pub(super) origin_name: String,
    pub(super) destination_name: String,
    pub(super) occupied_names: BTreeSet<String>,
}

fn ecosystem_labels(meta: &LocationMeta) -> Vec<&'static str> {
    meta.natural_potentials
        .iter()
        .filter(|potential| potential.policy != NaturalPotentialPolicy::Impossible)
        .map(|potential| potential.resource_kind.label())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn ecosystem_label_subset<'a>(labels: &'a [&'static str], accepted: &[&str]) -> Vec<&'a str> {
    labels
        .iter()
        .copied()
        .filter(|label| accepted.iter().any(|needle| label.contains(needle)))
        .collect()
}

fn pathway_ecosystem_context(meta: &LocationMeta) -> String {
    let environment = serde_json::to_value(&meta.environment).unwrap_or_else(|_| json!({}));
    let list = |key: &str| {
        environment
            .get(key)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "none authored".to_string())
    };
    let labels = ecosystem_labels(meta);
    let vegetation = ecosystem_label_subset(&labels, &["woodland", "herb", "soil"]);
    let fauna = ecosystem_label_subset(&labels, &["fish"]);
    let joined_or_none = |values: &[&str]| {
        if values.is_empty() {
            "none authored".to_string()
        } else {
            values.join(", ")
        }
    };
    format!(
        "biome: {biome}; terrain: {terrain}; climate: {climate}; landforms: {landforms}; geology: {geology}; hydrology: {hydrology}; vegetation cues: {vegetation}; fauna cues: {fauna}; ecosystem/resource cues: {ecosystem}",
        biome = meta.biome,
        terrain = if meta.terrain.is_empty() {
            "none authored".to_string()
        } else {
            meta.terrain.join(", ")
        },
        climate = environment
            .get("climate")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        landforms = list("landforms"),
        geology = list("geology"),
        hydrology = list("hydrology"),
        vegetation = joined_or_none(&vegetation),
        fauna = joined_or_none(&fauna),
        ecosystem = joined_or_none(&labels),
    )
}

struct PathwayRoutePromptContext<'a> {
    route_id: &'a str,
    route_version: u64,
    origin_name: &'a str,
    destination_name: &'a str,
    direction: &'a str,
    origin_meta: &'a LocationMeta,
    destination_meta: &'a LocationMeta,
}

fn generated_pathway_content_prompt(
    pathway: &GeneratedPathwayState,
    route: &PathwayRoutePromptContext<'_>,
) -> String {
    let waypoint_context = pathway
        .waypoints
        .iter()
        .enumerate()
        .map(|(index, waypoint)| {
            format!(
                "{step}. segment index/count: {step}/{segments}; fallback name: {fallback}; {ecology}",
                step = index + 1,
                segments = pathway.distance.max(1),
                fallback = waypoint.name,
                ecology = pathway_ecosystem_context(&waypoint.meta),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Create {count} distinct hidden waypoint identities for successive segments of one cozy storybook route. They are generated together now but players encounter them one at a time through Scout.\nCanonical route ID: {route_id}\nCanonical route version: {route_version}\nRoute endpoints: origin {origin_name}; destination {destination_name}\nTravel direction: {direction}, from {origin_name} toward {destination_name}.\nNearby authored origin description: {origin_description}\nNearby authored origin persona: {origin_persona}\nOrigin ecology: {origin_ecology}\nNearby authored destination description: {destination_description}\nNearby authored destination persona: {destination_persona}\nDestination ecology: {destination_ecology}\n{waypoint_context}\nFor each waypoint return: name (evocative proper place name, 2-5 words); title (1-6 words); description (one concrete physical sentence); persona (one sentence describing how the place behaves, never dialogue); visual_detail (physical landscape details only). Preserve order. Ground every field in the supplied direction, endpoint descriptions, biome, terrain, climate, hydrology, vegetation, fauna, and ecosystem cues. You may name and describe a waypoint, but you must not choose or change topology, route identity, endpoints, directionality, ownership, route version, segment count, access, or rules. Do not introduce named people, items, quests, rewards, danger outcomes, magic powers, or unsupported ecological facts. Names must use only ASCII letters, spaces, hyphens, or apostrophes, and must not use numbers, Pathway, Segment, either route endpoint, or duplicates.",
        count = pathway.waypoints.len(),
        route_id = route.route_id,
        route_version = route.route_version,
        direction = route.direction,
        origin_name = route.origin_name,
        destination_name = route.destination_name,
        origin_description = route.origin_meta.description,
        origin_persona = route.origin_meta.persona,
        origin_ecology = pathway_ecosystem_context(route.origin_meta),
        destination_description = route.destination_meta.description,
        destination_persona = route.destination_meta.persona,
        destination_ecology = pathway_ecosystem_context(route.destination_meta),
    )
}

pub(super) async fn pathway_content_generation_context(
    state: &AppState,
    pathway: &GeneratedPathwayState,
) -> PathwayContentPromptContext {
    let runtime = state.inner.lock().await;
    let origin_name = runtime
        .location_name(pathway.origin_location_id)
        .unwrap_or_else(|| "one known place".to_string());
    let destination_name = runtime
        .location_name(pathway.destination_location_id)
        .unwrap_or_else(|| "another known place".to_string());
    let direction = runtime
        .exit_direction(pathway.origin_location_id, pathway.destination_location_id)
        .unwrap_or_else(|| "endpoint-to-endpoint".to_string());
    let origin_meta = runtime.location_meta_for(pathway.origin_location_id);
    let destination_meta = runtime.location_meta_for(pathway.destination_location_id);
    let occupied_names = runtime
        .generated_pathways
        .values()
        .filter(|existing| existing.id != pathway.id)
        .flat_map(|existing| existing.waypoints.iter())
        .map(|waypoint| waypoint.name.to_ascii_lowercase())
        .chain(
            runtime
                .locations
                .iter()
                .filter(|(location_id, _)| {
                    !pathway
                        .waypoints
                        .iter()
                        .any(|waypoint| waypoint.id == **location_id)
                })
                .map(|(_, name)| name.to_ascii_lowercase()),
        )
        .collect();
    let route_id = if pathway.source_route_id.is_empty() {
        pathway.id.as_str()
    } else {
        pathway.source_route_id.as_str()
    };
    let route_version = pathway.source_route_version.max(1);
    let prompt = generated_pathway_content_prompt(
        pathway,
        &PathwayRoutePromptContext {
            route_id,
            route_version,
            origin_name: &origin_name,
            destination_name: &destination_name,
            direction: &direction,
            origin_meta: &origin_meta,
            destination_meta: &destination_meta,
        },
    );
    PathwayContentPromptContext {
        prompt,
        origin_name,
        destination_name,
        occupied_names,
    }
}

pub(super) fn sanitize_generated_pathway_name(value: &str) -> Option<String> {
    let name = compact_whitespace(value.trim().trim_matches('"'));
    let word_count = name.split_whitespace().count();
    let char_count = name.chars().count();
    let lower = name.to_ascii_lowercase();
    if !(2..=5).contains(&word_count)
        || !(4..=40).contains(&char_count)
        || lower.contains("pathway")
        || lower.contains("stretch")
        || generated_label_contains_authority_language(&lower)
        || !name
            .chars()
            .all(|character| character.is_ascii_alphabetic() || " -'".contains(character))
    {
        return None;
    }
    Some(name)
}

fn generated_label_contains_authority_language(value: &str) -> bool {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|token| {
            matches!(
                token,
                "access"
                    | "award"
                    | "awards"
                    | "clock"
                    | "damage"
                    | "health"
                    | "inventory"
                    | "item"
                    | "items"
                    | "orb"
                    | "orbs"
                    | "quest"
                    | "quests"
                    | "reward"
                    | "rewards"
                    | "unlock"
                    | "unlocks"
                    | "wallet"
            )
        })
}

fn sanitize_generated_content_text(
    value: &str,
    min_chars: usize,
    max_chars: usize,
) -> Option<String> {
    let text = compact_whitespace(value.trim().trim_matches('"'));
    let char_count = text.chars().count();
    let lowered = format!(" {} ", text.to_ascii_lowercase());
    if !(min_chars..=max_chars).contains(&char_count)
        || text.chars().any(char::is_control)
        || text.chars().any(|character| "{}<>\"".contains(character))
        || [
            " http://",
            " https://",
            " ignore previous",
            " system prompt",
            " developer message",
            " assistant message",
            " ai model",
            " policy",
            " wallet",
            " orb ",
            " orbs ",
            " item ",
            " items ",
            " inventory ",
            " reward",
            " award",
            " damage",
            " health ",
            " hit point",
            " level up",
            " grants ",
            " gives you ",
            " unlock",
            " access gate",
            " allows entry",
            " opens access",
            " locked until",
            " quest",
            " clock",
        ]
        .iter()
        .any(|needle| lowered.contains(needle))
    {
        return None;
    }
    Some(text)
}

pub(super) fn sanitize_generated_pathway_title(value: &str) -> Option<String> {
    let title = compact_whitespace(value.trim().trim_matches('"'));
    let word_count = title.split_whitespace().count();
    if !(1..=6).contains(&word_count)
        || !(4..=48).contains(&title.chars().count())
        || title.to_ascii_lowercase().contains("pathway to")
        || generated_label_contains_authority_language(&title.to_ascii_lowercase())
        || !title
            .chars()
            .all(|character| character.is_ascii_alphabetic() || " -'".contains(character))
    {
        return None;
    }
    Some(title)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GeneratedWaypointContentProposal {
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) persona: String,
    pub(super) visual_detail: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GeneratedPathwayContentProposal {
    waypoints: Vec<GeneratedWaypointContentProposal>,
}

pub(super) fn parse_generated_pathway_content(
    text: &str,
    expected: usize,
) -> Option<Vec<GeneratedWaypointContentProposal>> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let json_text = if cleaned.starts_with('{') {
        cleaned
    } else {
        let start = cleaned.find('{')?;
        let end = cleaned.rfind('}')?;
        cleaned.get(start..=end)?
    };
    let proposal: GeneratedPathwayContentProposal = serde_json::from_str(json_text).ok()?;
    if proposal.waypoints.len() != expected {
        return None;
    }
    let waypoints = proposal
        .waypoints
        .into_iter()
        .map(|waypoint| {
            Some(GeneratedWaypointContentProposal {
                name: sanitize_generated_pathway_name(&waypoint.name)?,
                title: sanitize_generated_pathway_title(&waypoint.title)?,
                description: sanitize_generated_content_text(&waypoint.description, 24, 240)?,
                persona: sanitize_generated_content_text(&waypoint.persona, 20, 180)?,
                visual_detail: sanitize_generated_content_text(&waypoint.visual_detail, 12, 180)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let unique = waypoints
        .iter()
        .map(|waypoint| waypoint.name.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    (unique.len() == waypoints.len()).then_some(waypoints)
}

pub(super) fn generated_pathway_name_avoids_anchors(name: &str, anchors: &[&str]) -> bool {
    let name = compact_whitespace(name).to_ascii_lowercase();
    anchors.iter().all(|anchor| {
        let anchor = compact_whitespace(anchor).to_ascii_lowercase();
        anchor.is_empty() || !name.contains(&anchor)
    })
}

pub(super) fn apply_generated_waypoint_content(
    waypoint: &mut GeneratedWaypointState,
    content: GeneratedWaypointContentProposal,
) {
    waypoint.name = content.name.clone();
    waypoint.meta.title = content.title;
    waypoint.meta.description = content.description;
    waypoint.meta.persona = content.persona;
    waypoint.meta.art_prompt = Some(format!(
        "cozy storybook landscape, {detail}, {name}, {biome}, terrain of {terrain}, no people, no characters, no creatures, no text, no logo, no watermark",
        detail = content.visual_detail,
        name = content.name,
        biome = waypoint.meta.biome,
        terrain = waypoint.meta.terrain.join(", "),
    ));
}

pub(super) fn set_pathway_generation_provenance(
    pathway: &mut GeneratedPathwayState,
    mode: GenerationMode,
    config: Option<&AiConfig>,
    source: &str,
    attempts: u8,
) {
    pathway.generation = GenerationProvenance {
        source: source.to_string(),
        feature: PATHWAY_CONTENT_FEATURE.to_string(),
        policy_mode: mode.as_str().to_string(),
        prompt_version: PATHWAY_CONTENT_PROMPT_VERSION.to_string(),
        provider: ai_provider_name(config).to_string(),
        model: ai_model_name(config),
        model_attribution: None,
        attempts,
    };
}

#[cfg(test)]
mod tests {
    use super::registry::DataPolicyEligibility;
    use super::*;
    use crate::RuntimeWorld;
    use axum::{http::StatusCode, response::IntoResponse, routing::post, Json, Router};
    use base64::Engine;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;

    fn raw_actor_model_binding(
        zero_data_retention: bool,
    ) -> crate::content_load::SeedActorModelBinding {
        crate::content_load::SeedActorModelBinding {
            pack_id: "cosyworld.elysium".to_string(),
            id: "~anthropic/claude-fable-latest".to_string(),
            actor_id: 652_001,
            actor_ref: "pack://cosyworld.elysium/actor/652001".to_string(),
            provider: "openrouter".to_string(),
            requested_model_id: "~anthropic/claude-fable-latest".to_string(),
            canonical_slug: "anthropic/claude-fable-20260731".to_string(),
            display_name: "Anthropic: Claude Fable".to_string(),
            catalog_snapshot_version: "openrouter-2026-07-31.1".to_string(),
            created: 1_785_456_000,
            input_modalities: vec!["text".to_string()],
            output_modalities: vec!["text".to_string()],
            context_length: Some(128_000),
            max_completion_tokens: Some(16_384),
            supported_parameters: vec!["max_tokens".to_string(), "temperature".to_string()],
            input_cost_per_million: Some(1.0),
            output_cost_per_million: Some(5.0),
            zero_data_retention,
            speech_mode: "raw".to_string(),
        }
    }

    fn image_actor_model_binding(
        zero_data_retention: bool,
    ) -> crate::content_load::SeedActorModelBinding {
        crate::content_load::SeedActorModelBinding {
            pack_id: "cosyworld.elysium".to_string(),
            id: "black-forest-labs/flux.2-klein-4b".to_string(),
            actor_id: 677_376_455_611,
            actor_ref: "pack://cosyworld.elysium/actor/677376455611".to_string(),
            provider: "openrouter".to_string(),
            requested_model_id: "black-forest-labs/flux.2-klein-4b".to_string(),
            canonical_slug: "black-forest-labs/flux.2-klein-4b".to_string(),
            display_name: "Black Forest Labs: FLUX.2 Klein 4B".to_string(),
            catalog_snapshot_version: "openrouter-2026-07-31.1".to_string(),
            created: 1_768_429_228,
            input_modalities: vec!["image".to_string(), "text".to_string()],
            output_modalities: vec!["image".to_string()],
            context_length: Some(40_960),
            max_completion_tokens: None,
            supported_parameters: vec!["seed".to_string()],
            input_cost_per_million: Some(0.0),
            output_cost_per_million: Some(0.0),
            zero_data_retention,
            speech_mode: "unavailable".to_string(),
        }
    }

    fn embedding_actor_model_binding(
        zero_data_retention: bool,
    ) -> crate::content_load::SeedActorModelBinding {
        let mut binding = image_actor_model_binding(zero_data_retention);
        binding.id = "baai/bge-base-en-v1.5".to_string();
        binding.actor_id = 436_500_960_082;
        binding.actor_ref = "pack://cosyworld.elysium/actor/436500960082".to_string();
        binding.requested_model_id = binding.id.clone();
        binding.canonical_slug = "baai/bge-base-en-v1.5-20251117".to_string();
        binding.display_name = "BAAI: bge-base-en-v1.5".to_string();
        binding.input_modalities = vec!["text".to_string()];
        binding.output_modalities = vec!["embeddings".to_string()];
        binding.context_length = Some(512);
        binding.supported_parameters.clear();
        binding
    }

    fn rerank_actor_model_binding(
        zero_data_retention: bool,
    ) -> crate::content_load::SeedActorModelBinding {
        let mut binding = image_actor_model_binding(zero_data_retention);
        binding.id = "cohere/rerank-4-fast".to_string();
        binding.actor_id = 692_772_004_841;
        binding.actor_ref = "pack://cosyworld.elysium/actor/692772004841".to_string();
        binding.requested_model_id = binding.id.clone();
        binding.canonical_slug = binding.id.clone();
        binding.display_name = "Cohere: Rerank 4 Fast".to_string();
        binding.input_modalities = vec!["text".to_string()];
        binding.output_modalities = vec!["rerank".to_string()];
        binding.context_length = Some(32_768);
        binding.supported_parameters.clear();
        binding
    }

    fn speech_synthesis_actor_model_binding(
        zero_data_retention: bool,
    ) -> crate::content_load::SeedActorModelBinding {
        let mut binding = image_actor_model_binding(zero_data_retention);
        binding.id = "openai/gpt-4o-mini-tts".to_string();
        binding.actor_id = 711_004_200_001;
        binding.actor_ref = "pack://cosyworld.elysium/actor/711004200001".to_string();
        binding.requested_model_id = binding.id.clone();
        binding.canonical_slug = "openai/gpt-4o-mini-tts-20260731".to_string();
        binding.display_name = "OpenAI: GPT-4o mini TTS".to_string();
        binding.input_modalities = vec!["text".to_string()];
        binding.output_modalities = vec!["speech".to_string()];
        binding.context_length = Some(16_384);
        binding.supported_parameters.clear();
        binding
    }

    fn transcription_actor_model_binding(
        zero_data_retention: bool,
    ) -> crate::content_load::SeedActorModelBinding {
        let mut binding = image_actor_model_binding(zero_data_retention);
        binding.id = "openai/gpt-4o-mini-transcribe".to_string();
        binding.actor_id = 711_004_200_002;
        binding.actor_ref = "pack://cosyworld.elysium/actor/711004200002".to_string();
        binding.requested_model_id = binding.id.clone();
        binding.canonical_slug = "openai/gpt-4o-mini-transcribe-20260731".to_string();
        binding.display_name = "OpenAI: GPT-4o mini Transcribe".to_string();
        binding.input_modalities = vec!["audio".to_string()];
        binding.output_modalities = vec!["transcription".to_string()];
        binding.context_length = Some(16_384);
        binding.supported_parameters.clear();
        binding
    }

    async fn capture_raw_actor_request(zero_data_retention: bool) -> (Value, AiCompletion) {
        let request_body = Arc::new(std::sync::Mutex::new(None::<Value>));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_body = request_body.clone();
                move |Json(body): Json<Value>| {
                    let request_body = request_body.clone();
                    async move {
                        *request_body.lock().expect("capture raw request") = Some(body);
                        let body = request_body
                            .lock()
                            .expect("read captured raw request")
                            .clone()
                            .expect("captured raw request exists");
                        if body.get("reasoning").is_some() {
                            return (
                                StatusCode::BAD_REQUEST,
                                Json(json!({
                                    "error": { "message": "reasoning is not supported" }
                                })),
                            )
                                .into_response();
                        }
                        Json(json!({
                            "model": "anthropic/claude-fable-20260731",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": { "content": "I am the selected model." }
                            }]
                        }))
                        .into_response()
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind raw actor gateway test server");
        let addr = listener
            .local_addr()
            .expect("raw actor gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "global/model-must-not-run".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: Some("high".to_string()),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };
        let binding = raw_actor_model_binding(zero_data_retention);
        let selection =
            PinnedModelSelection::from_actor_binding(&binding, DataPolicyMode::Production)
                .expect("actor model pins for server-authored dialogue");

        let completion = request_chat_completion_with_selection(
            &config,
            ChatCompletionRequest {
                feature: "dialogue_resident_raw",
                prompt_version: "dialogue-resident-raw-v1",
                capability: ModelCapability::Voice,
                system: "",
                user: "Which model are you?",
                temperature: 0.9,
                max_tokens: 160,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                response_format: None,
            },
            &selection,
        )
        .await
        .expect("raw actor request");
        let body = request_body
            .lock()
            .expect("read raw request")
            .clone()
            .expect("raw request was captured");
        server.abort();
        (body, completion)
    }

    #[test]
    fn pathway_prompt_carries_route_direction_ecology_and_authored_context() {
        let runtime = RuntimeWorld::seeded();
        let pathway = runtime
            .generated_pathway(5000, 700, 712, 2)
            .expect("Bethlehem-to-Jerusalem route");
        let origin_meta = runtime.location_meta_for(700);
        let destination_meta = runtime.location_meta_for(712);
        let prompt = generated_pathway_content_prompt(
            &pathway,
            &PathwayRoutePromptContext {
                route_id: "route://cosyworld.the-holy-land/authored/bethlehem|jerusalem",
                route_version: 3,
                origin_name: "Bethlehem",
                destination_name: "Jerusalem",
                direction: "north",
                origin_meta: &origin_meta,
                destination_meta: &destination_meta,
            },
        );

        assert!(prompt.contains("Canonical route ID: route://cosyworld.the-holy-land"));
        assert!(prompt.contains("Canonical route version: 3"));
        assert!(prompt.contains("Route endpoints: origin Bethlehem; destination Jerusalem"));
        assert!(prompt.contains("Travel direction: north, from Bethlehem toward Jerusalem"));
        assert!(prompt.contains(&origin_meta.description));
        assert!(prompt.contains(&destination_meta.description));
        assert!(prompt.contains("segment index/count: 1/2"));
        for field in [
            "biome:",
            "terrain:",
            "climate:",
            "hydrology:",
            "vegetation cues:",
            "fauna cues:",
            "ecosystem/resource cues:",
        ] {
            assert!(prompt.contains(field), "missing {field} from {prompt}");
        }
        assert!(prompt.contains("must not choose or change topology"));
    }

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
    fn raw_actor_binding_preserves_non_zdr_metadata_in_production() {
        let binding = raw_actor_model_binding(false);
        let selection =
            PinnedModelSelection::from_actor_binding(&binding, DataPolicyMode::Production)
                .expect("server-authored actor dialogue does not require ZDR");

        assert!(!selection.enforces_zero_data_retention());
        let attribution = selection
            .attribute_response(None)
            .expect("exact actor binding attribution");
        assert_eq!(attribution.data_policy, DataPolicyEligibility::default());
        assert_eq!(
            attribution.requested_model_id,
            "~anthropic/claude-fable-latest"
        );
        assert_eq!(
            attribution.resolved_model_id,
            "anthropic/claude-fable-20260731"
        );
    }

    #[tokio::test]
    async fn image_actor_request_uses_the_exact_bound_model_and_dedicated_endpoint() {
        use std::sync::Mutex;

        const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let app = Router::new().route(
            "/images",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    *captured.lock().expect("capture image request") = Some(body);
                    Json(json!({
                        "model": "black-forest-labs/flux.2-klein-4b",
                        "data": [{ "b64_json": PNG_1X1 }],
                        "usage": { "total_tokens": 12 }
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image gateway test server");
        let address = listener.local_addr().expect("image gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let generated = request_image_generation_with_binding(
            &config,
            &image_actor_model_binding(false),
            ImageGenerationRequest {
                feature: "image_test",
                prompt_version: "image-test-v1",
                prompt: "a tiny lantern",
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("bound image request");

        let body = request_body
            .lock()
            .expect("read image request")
            .clone()
            .expect("image request captured");
        assert_eq!(body["model"], "black-forest-labs/flux.2-klein-4b");
        assert_eq!(body["prompt"], "a tiny lantern");
        assert_eq!(body["n"], 1);
        assert!(body.get("provider").is_none());
        assert!(body.get("messages").is_none());
        assert!(body.get("seed").and_then(Value::as_u64).is_some());
        assert_eq!(generated.content_type, "image/png");
        assert_eq!(generated.usage.total_tokens, Some(12));
        assert_eq!(
            generated.model_attribution.resolved_model_id,
            "black-forest-labs/flux.2-klein-4b"
        );
        server.abort();
    }

    #[test]
    fn production_image_binding_without_zdr_is_selectable_and_truthfully_attributed() {
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };
        let selection = config
            .pin_actor_image_model(&image_actor_model_binding(false))
            .expect("server-authored exact image binding may be non-ZDR");

        assert!(!selection.enforces_zero_data_retention());
        assert_eq!(
            selection
                .attribute_response(None)
                .expect("exact image attribution")
                .data_policy,
            DataPolicyEligibility::default()
        );
    }

    #[tokio::test]
    async fn embedding_request_uses_exact_binding_zdr_and_reorders_indexed_vectors() {
        use std::sync::Mutex;

        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let app = Router::new().route(
            "/embeddings",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    *captured.lock().expect("capture embedding request") = Some(body);
                    Json(json!({
                        "model": "baai/bge-base-en-v1.5-20251117",
                        "data": [
                            { "index": 1, "embedding": [0.3, 0.4] },
                            { "index": 0, "embedding": [0.1, 0.2] }
                        ],
                        "usage": { "prompt_tokens": 7, "total_tokens": 7 }
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind embedding gateway test server");
        let address = listener
            .local_addr()
            .expect("embedding gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let inputs = vec!["first passage".to_string(), "second passage".to_string()];
        let embedded = request_embeddings_with_binding(
            &config,
            &embedding_actor_model_binding(true),
            EmbeddingRequest {
                feature: "embedding_test",
                prompt_version: "embedding-test-v1",
                inputs: &inputs,
                timeout: Duration::from_secs(2),
                max_attempts: 3,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("bound embedding request");

        let body = request_body
            .lock()
            .expect("read embedding request")
            .clone()
            .expect("embedding request captured");
        assert_eq!(body["model"], "baai/bge-base-en-v1.5");
        assert_eq!(body["input"], json!(inputs));
        assert_eq!(body["encoding_format"], "float");
        assert_eq!(
            body.pointer("/provider/data_collection")
                .and_then(Value::as_str),
            Some("deny")
        );
        assert_eq!(
            body.pointer("/provider/zdr").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(embedded.vectors, vec![vec![0.1, 0.2], vec![0.3, 0.4]]);
        assert_eq!(embedded.attempts, 1);
        assert_eq!(embedded.usage.prompt_tokens, Some(7));
        assert_eq!(
            embedded.model_attribution.capability,
            ModelCapability::Embeddings
        );
        assert_eq!(
            embedded.model_attribution.resolved_model_id,
            "baai/bge-base-en-v1.5-20251117"
        );
        server.abort();
    }

    #[tokio::test]
    async fn embedding_response_rejects_values_that_overflow_finite_vectors() {
        let app = Router::new().route(
            "/embeddings",
            post(|| async {
                Json(json!({
                    "model": "baai/bge-base-en-v1.5-20251117",
                    "data": [{ "index": 0, "embedding": [1.0e100] }]
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind invalid embedding gateway test server");
        let address = listener
            .local_addr()
            .expect("invalid embedding gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let inputs = vec!["one passage".to_string()];
        let error = request_embeddings_with_binding(
            &config,
            &embedding_actor_model_binding(false),
            EmbeddingRequest {
                feature: "embedding_invalid_test",
                prompt_version: "embedding-invalid-test-v1",
                inputs: &inputs,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("f64 values that overflow f32 must be rejected");

        assert_eq!(error.code(), "inference_invalid_response");
        assert_eq!(error.attempts, 1);
        server.abort();
    }

    #[tokio::test]
    async fn rerank_request_allows_non_zdr_exact_binding_and_validates_ranking() {
        use std::sync::Mutex;

        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let app = Router::new().route(
            "/rerank",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    *captured.lock().expect("capture rerank request") = Some(body);
                    Json(json!({
                        "model": "cohere/rerank-4-fast",
                        "results": [
                            { "index": 1, "relevance_score": 0.9 },
                            { "index": 0, "relevance_score": 0.2 }
                        ],
                        "usage": { "total_tokens": 18 }
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind rerank gateway test server");
        let address = listener.local_addr().expect("rerank gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let documents = vec![
            "Berlin is in Germany.".to_string(),
            "Paris is in France.".to_string(),
        ];
        let ranked = request_rerank_with_binding(
            &config,
            &rerank_actor_model_binding(false),
            RerankRequest {
                feature: "rerank_test",
                prompt_version: "rerank-test-v1",
                query: "capital of France",
                documents: &documents,
                timeout: Duration::from_secs(2),
                max_attempts: 3,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("bound rerank request");

        let body = request_body
            .lock()
            .expect("read rerank request")
            .clone()
            .expect("rerank request captured");
        assert_eq!(body["model"], "cohere/rerank-4-fast");
        assert_eq!(body["query"], "capital of France");
        assert_eq!(body["documents"], json!(documents));
        assert!(body.get("provider").is_none());
        assert_eq!(
            ranked.scores,
            vec![
                RerankScore {
                    index: 1,
                    relevance_score: 0.9,
                },
                RerankScore {
                    index: 0,
                    relevance_score: 0.2,
                }
            ]
        );
        assert_eq!(ranked.usage.total_tokens, Some(18));
        assert_eq!(ranked.model_attribution.capability, ModelCapability::Rerank);
        server.abort();
    }

    #[tokio::test]
    async fn rerank_rejects_duplicate_indices_and_out_of_range_scores() {
        let app = Router::new().route(
            "/rerank",
            post(|Json(body): Json<Value>| async move {
                let results = if body.get("query").and_then(Value::as_str) == Some("bad index") {
                    json!([
                        { "index": 0, "relevance_score": 0.9 },
                        { "index": 0, "relevance_score": 0.2 }
                    ])
                } else {
                    json!([
                        { "index": 0, "relevance_score": 1.1 },
                        { "index": 1, "relevance_score": 0.2 }
                    ])
                };
                Json(json!({
                    "model": "cohere/rerank-4-fast",
                    "results": results
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind invalid rerank gateway test server");
        let address = listener
            .local_addr()
            .expect("invalid rerank gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let documents = vec!["first".to_string(), "second".to_string()];
        for query in ["bad index", "bad score"] {
            let error = request_rerank_with_binding(
                &config,
                &rerank_actor_model_binding(false),
                RerankRequest {
                    feature: "rerank_invalid_test",
                    prompt_version: "rerank-invalid-test-v1",
                    query,
                    documents: &documents,
                    timeout: Duration::from_secs(2),
                    max_attempts: 1,
                    referer: "http://127.0.0.1",
                },
            )
            .await
            .expect_err("malformed rerank response must fail closed");
            assert_eq!(error.code(), "inference_invalid_response");
            assert_eq!(error.attempts, 1);
        }
        server.abort();
    }

    #[tokio::test]
    async fn speech_synthesis_uses_exact_binding_voice_mp3_zdr_and_retries_transient_statuses() {
        use std::sync::Mutex;

        let requests = Arc::new(AtomicUsize::new(0));
        let observed_requests = Arc::clone(&requests);
        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured_body = Arc::clone(&request_body);
        let app = Router::new().route(
            "/audio/speech",
            post(move |Json(body): Json<Value>| {
                let observed_requests = Arc::clone(&observed_requests);
                let captured_body = Arc::clone(&captured_body);
                async move {
                    *captured_body.lock().expect("capture speech request") = Some(body);
                    match observed_requests.fetch_add(1, Ordering::SeqCst) {
                        0 => {
                            return (
                                StatusCode::TOO_MANY_REQUESTS,
                                Json(json!({ "error": { "message": "try later" } })),
                            )
                                .into_response();
                        }
                        1 => {
                            return (
                                StatusCode::SERVICE_UNAVAILABLE,
                                Json(json!({ "error": { "message": "temporarily unavailable" } })),
                            )
                                .into_response();
                        }
                        _ => {}
                    }
                    (
                        [
                            ("content-type", "audio/mpeg"),
                            ("x-generation-id", "speech-gen-42"),
                        ],
                        b"ID3\x04synthetic-mp3".to_vec(),
                    )
                        .into_response()
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind speech gateway test server");
        let address = listener.local_addr().expect("speech gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let speech = request_speech_synthesis_with_binding(
            &config,
            &speech_synthesis_actor_model_binding(true),
            SpeechSynthesisRequest {
                feature: "speech_test",
                prompt_version: "speech-test-v1",
                text: "Welcome home.",
                voice: "coral",
                timeout: Duration::from_secs(2),
                max_attempts: 3,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("bound speech synthesis request");

        let body = request_body
            .lock()
            .expect("read speech request")
            .clone()
            .expect("speech request captured");
        assert_eq!(body["model"], "openai/gpt-4o-mini-tts");
        assert_eq!(body["input"], "Welcome home.");
        assert_eq!(body["voice"], "coral");
        assert_eq!(body["response_format"], "mp3");
        assert_eq!(
            body.pointer("/provider/data_collection")
                .and_then(Value::as_str),
            Some("deny")
        );
        assert_eq!(
            body.pointer("/provider/zdr").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(requests.load(Ordering::SeqCst), 3);
        assert_eq!(speech.attempts, 3);
        assert_eq!(speech.content_type, "audio/mpeg");
        assert_eq!(speech.generation_id.as_deref(), Some("speech-gen-42"));
        assert_eq!(speech.bytes, b"ID3\x04synthetic-mp3");
        assert_eq!(
            speech.model_attribution.capability,
            ModelCapability::SpeechSynthesis
        );
        assert_eq!(
            speech.model_attribution.resolved_model_id,
            "openai/gpt-4o-mini-tts-20260731"
        );
        server.abort();
    }

    #[tokio::test]
    async fn speech_synthesis_rejects_wrong_mime_empty_and_oversized_audio() {
        let app = Router::new().route(
            "/audio/speech",
            post(|Json(body): Json<Value>| async move {
                match body.get("input").and_then(Value::as_str) {
                    Some("wrong mime") => {
                        ([(("content-type"), "application/octet-stream")], vec![1u8])
                            .into_response()
                    }
                    Some("empty") => {
                        ([("content-type", "audio/mpeg")], Vec::<u8>::new()).into_response()
                    }
                    _ => (
                        [("content-type", "audio/mpeg")],
                        vec![0u8; SPEECH_SYNTHESIS_MAX_RESPONSE_BYTES + 1],
                    )
                        .into_response(),
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind invalid speech gateway test server");
        let address = listener
            .local_addr()
            .expect("invalid speech gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        for text in ["wrong mime", "empty", "oversized"] {
            let error = request_speech_synthesis_with_binding(
                &config,
                &speech_synthesis_actor_model_binding(false),
                SpeechSynthesisRequest {
                    feature: "speech_invalid_test",
                    prompt_version: "speech-invalid-test-v1",
                    text,
                    voice: "coral",
                    timeout: Duration::from_secs(2),
                    max_attempts: 3,
                    referer: "http://127.0.0.1",
                },
            )
            .await
            .expect_err("invalid speech response must fail closed");
            assert_eq!(error.code(), "inference_invalid_response");
            assert_eq!(error.attempts, 1);
        }
        server.abort();
    }

    #[tokio::test]
    async fn speech_synthesis_request_shape_4xx_is_terminal() {
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&requests);
        let app = Router::new().route(
            "/audio/speech",
            post(move |Json(_): Json<Value>| {
                let observed = Arc::clone(&observed);
                async move {
                    observed.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": { "message": "invalid voice" } })),
                    )
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind terminal speech 4xx test server");
        let address = listener
            .local_addr()
            .expect("terminal speech 4xx test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let error = request_speech_synthesis_with_binding(
            &config,
            &speech_synthesis_actor_model_binding(false),
            SpeechSynthesisRequest {
                feature: "speech_4xx_test",
                prompt_version: "speech-4xx-test-v1",
                text: "hello",
                voice: "coral",
                timeout: Duration::from_secs(2),
                max_attempts: 4,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("deterministic speech 400 must be terminal");

        assert_eq!(error.code(), "inference_provider_error");
        assert_eq!(error.attempts, 1);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        server.abort();
    }

    #[tokio::test]
    async fn transcription_uses_bounded_base64_exact_binding_and_attribution() {
        use std::sync::Mutex;

        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let app = Router::new().route(
            "/audio/transcriptions",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    *captured.lock().expect("capture transcription request") = Some(body);
                    Json(json!({
                        "text": "  A lantern is glowing.  ",
                        "usage": {
                            "input_tokens": 9,
                            "output_tokens": 5,
                            "total_tokens": 14
                        }
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind transcription gateway test server");
        let address = listener
            .local_addr()
            .expect("transcription gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let audio = [0_u8, 1, 2, 3, 254, 255];
        let transcription = request_transcription_with_binding(
            &config,
            &transcription_actor_model_binding(false),
            TranscriptionRequest {
                feature: "transcription_test",
                prompt_version: "transcription-test-v1",
                input_audio: &audio,
                input_audio_format: TranscriptionAudioFormat::Wav,
                timeout: Duration::from_secs(2),
                max_attempts: 2,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("bound transcription request");

        let body = request_body
            .lock()
            .expect("read transcription request")
            .clone()
            .expect("transcription request captured");
        assert_eq!(body["model"], "openai/gpt-4o-mini-transcribe");
        assert_eq!(
            body["input_audio"]["data"],
            Value::String(BASE64_STANDARD.encode(audio))
        );
        assert_eq!(body["input_audio"]["format"], "wav");
        assert!(body.get("response_format").is_none());
        assert!(body.get("provider").is_none());
        assert_eq!(transcription.text, "A lantern is glowing.");
        assert_eq!(transcription.usage.prompt_tokens, Some(9));
        assert_eq!(transcription.usage.completion_tokens, Some(5));
        assert_eq!(transcription.usage.total_tokens, Some(14));
        assert_eq!(
            transcription.model_attribution.capability,
            ModelCapability::Transcription
        );
        assert_eq!(
            transcription.model_attribution.resolved_model_id,
            "openai/gpt-4o-mini-transcribe-20260731"
        );
        server.abort();
    }

    #[tokio::test]
    async fn transcription_rejects_empty_transcript_and_mismatched_model_attribution() {
        let empty_audio = BASE64_STANDARD.encode(b"empty");
        let app = Router::new().route(
            "/audio/transcriptions",
            post(move |Json(body): Json<Value>| {
                let empty_audio = empty_audio.clone();
                async move {
                    if body.pointer("/input_audio/data").and_then(Value::as_str)
                        == Some(empty_audio.as_str())
                    {
                        Json(json!({
                            "model": "openai/gpt-4o-mini-transcribe-20260731",
                            "text": "  "
                        }))
                    } else {
                        Json(json!({
                            "model": "other/provider-model",
                            "text": "attribution mismatched"
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind invalid transcription gateway test server");
        let address = listener
            .local_addr()
            .expect("invalid transcription gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        for audio in [&b"empty"[..], &b"mismatched-model"[..]] {
            let error = request_transcription_with_binding(
                &config,
                &transcription_actor_model_binding(true),
                TranscriptionRequest {
                    feature: "transcription_invalid_test",
                    prompt_version: "transcription-invalid-test-v1",
                    input_audio: audio,
                    input_audio_format: TranscriptionAudioFormat::Mp3,
                    timeout: Duration::from_secs(2),
                    max_attempts: 1,
                    referer: "http://127.0.0.1",
                },
            )
            .await
            .expect_err("malformed transcription response must fail closed");
            assert_eq!(error.code(), "inference_invalid_response");
            assert_eq!(error.attempts, 1);
        }
        server.abort();
    }

    #[tokio::test]
    async fn exact_endpoint_request_shape_4xx_is_terminal_without_retry_amplification() {
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&requests);
        let app = Router::new().route(
            "/rerank",
            post(move || {
                let observed = Arc::clone(&observed);
                async move {
                    observed.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": { "message": "invalid documents shape" } })),
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
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let documents = vec!["first".to_string()];
        let error = request_rerank_with_binding(
            &config,
            &rerank_actor_model_binding(false),
            RerankRequest {
                feature: "rerank_4xx_test",
                prompt_version: "rerank-4xx-test-v1",
                query: "query",
                documents: &documents,
                timeout: Duration::from_secs(2),
                max_attempts: 4,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("deterministic 400 must be terminal");

        assert_eq!(error.code(), "inference_provider_error");
        assert_eq!(error.attempts, 1);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        server.abort();
    }

    #[test]
    fn exact_non_chat_bindings_preserve_non_zdr_metadata_in_production() {
        for selection in [
            PinnedModelSelection::from_actor_embedding_binding(
                &embedding_actor_model_binding(false),
                DataPolicyMode::Production,
            )
            .expect("server-authored embeddings may be non-ZDR"),
            PinnedModelSelection::from_actor_rerank_binding(
                &rerank_actor_model_binding(false),
                DataPolicyMode::Production,
            )
            .expect("server-authored rerank may be non-ZDR"),
            PinnedModelSelection::from_actor_speech_synthesis_binding(
                &speech_synthesis_actor_model_binding(false),
                DataPolicyMode::Production,
            )
            .expect("server-authored speech synthesis may be non-ZDR"),
            PinnedModelSelection::from_actor_transcription_binding(
                &transcription_actor_model_binding(false),
                DataPolicyMode::Production,
            )
            .expect("server-authored transcription may be non-ZDR"),
        ] {
            assert!(!selection.enforces_zero_data_retention());
            assert_eq!(
                selection
                    .attribute_response(None)
                    .expect("exact binding attribution")
                    .data_policy,
                DataPolicyEligibility::default()
            );
        }
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
                  "requested_model_id": "provider/unsafe-planner",
                  "provider": "test-provider",
                  "concrete_model": {"model_id": "provider/unsafe-planner", "revision": "r1"},
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
    fn startup_rejects_capability_mismatched_and_privacy_ineligible_overrides() {
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

        let privacy = validate_ai_routing_configuration(
            &registry,
            &BTreeMap::from([(
                ModelCapability::IntentJson,
                "provider/unsafe-planner".to_string(),
            )]),
            DataPolicyMode::Production,
        )
        .expect_err("production must reject an unsafe planner override");
        assert!(privacy.contains("intent_json"), "{privacy}");
        assert!(privacy.contains("\"provider/unsafe-planner\""), "{privacy}");
        assert!(privacy.contains("inference_privacy_rejected"), "{privacy}");
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
    fn production_audits_the_same_legacy_fallback_used_by_runtime_pinning() {
        let fallback = CapabilityRegistrySnapshot::legacy(
            "legacy-config-v1",
            "openrouter",
            "provider/unreviewed",
        )
        .expect("legacy registry");

        let error = validate_ai_routing_configuration(
            &fallback,
            &BTreeMap::new(),
            DataPolicyMode::Production,
        )
        .expect_err("unreviewed legacy policy must stop production startup");
        assert!(error.contains("\"legacy-config-v1\""), "{error}");
        assert!(error.contains("privacy rejected"), "{error}");
        assert!(
            error.contains("Startup is refused because COSYWORLD_DEPLOY_PROFILE=production"),
            "{error}"
        );

        validate_ai_routing_configuration(&fallback, &BTreeMap::new(), DataPolicyMode::Development)
            .expect("legacy local development stays compatible");
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

    #[test]
    fn card_policy_rollout_mode_is_explicit_and_fail_closed() {
        assert_eq!(
            CardPolicyRolloutMode::parse("off").unwrap(),
            CardPolicyRolloutMode::Off
        );
        assert_eq!(
            CardPolicyRolloutMode::parse("SHADOW").unwrap(),
            CardPolicyRolloutMode::Shadow
        );
        assert_eq!(
            CardPolicyRolloutMode::parse("live").unwrap(),
            CardPolicyRolloutMode::Live
        );
        let error = CardPolicyRolloutMode::parse("auto")
            .expect_err("an ambiguous live mode must not be accepted");
        assert!(error.contains(CARD_POLICY_MODE_ENV));
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
    async fn ordinary_raw_actor_request_omits_reasoning_and_preserves_zdr() {
        let (body, completion) = capture_raw_actor_request(true).await;
        assert_eq!(
            body.get("model").and_then(Value::as_str),
            Some("~anthropic/claude-fable-latest")
        );
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            body.pointer("/messages/0/role").and_then(Value::as_str),
            Some("user")
        );
        assert_eq!(
            body.pointer("/messages/0/content").and_then(Value::as_str),
            Some("Which model are you?")
        );
        assert!(body.get("temperature").is_none());
        assert!(body.get("reasoning").is_none());
        assert!(body.get("response_format").is_none());
        assert_eq!(
            body.pointer("/provider/data_collection")
                .and_then(Value::as_str),
            Some("deny")
        );
        assert_eq!(
            body.pointer("/provider/zdr").and_then(Value::as_bool),
            Some(true)
        );
        let attribution = completion.model_attribution.expect("raw attribution");
        assert_eq!(
            attribution.requested_model_id,
            "~anthropic/claude-fable-latest"
        );
        assert_eq!(
            attribution.resolved_model_id,
            "anthropic/claude-fable-20260731"
        );
    }

    #[tokio::test]
    async fn mandatory_reasoning_raw_actor_uses_one_bounded_shape_fallback() {
        use std::sync::Mutex;

        let request_bodies = Arc::new(Mutex::new(Vec::<Value>::new()));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_bodies = Arc::clone(&request_bodies);
                move |Json(body): Json<Value>| {
                    let request_bodies = Arc::clone(&request_bodies);
                    async move {
                        let ordinal = {
                            let mut bodies = request_bodies.lock().expect("capture raw requests");
                            bodies.push(body.clone());
                            bodies.len()
                        };
                        if ordinal == 1 {
                            return (
                                StatusCode::BAD_REQUEST,
                                Json(json!({
                                    "error": {
                                        "message": "Reasoning is mandatory for this endpoint and cannot be disabled."
                                    }
                                })),
                            )
                                .into_response();
                        }
                        Json(json!({
                            "model": "arcee-ai/trinity-large-thinking",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": { "content": "Reasoning is enabled, and I can answer." }
                            }]
                        }))
                        .into_response()
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mandatory reasoning gateway test server");
        let addr = listener
            .local_addr()
            .expect("mandatory reasoning gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "global/model-must-not-run".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: Some("high".to_string()),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };
        let mut binding = raw_actor_model_binding(true);
        binding.id = "arcee-ai/trinity-large-thinking".to_string();
        binding.requested_model_id = binding.id.clone();
        binding.canonical_slug = binding.id.clone();
        binding.display_name = "Arcee AI: Trinity Large Thinking".to_string();
        binding.supported_parameters.push("reasoning".to_string());
        let selection =
            PinnedModelSelection::from_actor_binding(&binding, DataPolicyMode::Production)
                .expect("mandatory reasoning actor model pins");

        let completion = request_chat_completion_with_selection(
            &config,
            ChatCompletionRequest {
                feature: "dialogue_resident_raw",
                prompt_version: "dialogue-resident-raw-v2",
                capability: ModelCapability::Voice,
                system: "",
                user: "Can you answer?",
                temperature: 0.0,
                max_tokens: 160,
                timeout: Duration::from_secs(2),
                // Even with a larger ordinary retry budget, compatibility is an
                // inner one-shot fallback and must not amplify across attempts.
                max_attempts: 4,
                referer: "http://127.0.0.1",
                response_format: None,
            },
            &selection,
        )
        .await
        .expect("mandatory reasoning fallback succeeds");

        assert_eq!(completion.attempts, 1);
        let bodies = request_bodies.lock().expect("read raw requests");
        assert_eq!(bodies.len(), 2, "one 400 gets exactly one shape fallback");
        assert_eq!(
            bodies[0]
                .pointer("/reasoning/effort")
                .and_then(Value::as_str),
            Some("none")
        );
        assert_eq!(
            bodies[1]
                .pointer("/reasoning/enabled")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            bodies[1]
                .pointer("/reasoning/exclude")
                .and_then(Value::as_bool),
            Some(true)
        );
        for body in bodies.iter() {
            assert_eq!(
                body.pointer("/provider/data_collection")
                    .and_then(Value::as_str),
                Some("deny")
            );
            assert_eq!(
                body.pointer("/provider/zdr").and_then(Value::as_bool),
                Some(true)
            );
        }
        server.abort();
    }

    #[tokio::test]
    async fn non_zdr_raw_actor_request_reaches_provider_without_privacy_constraints() {
        let (body, completion) = capture_raw_actor_request(false).await;

        assert_eq!(
            body.get("model").and_then(Value::as_str),
            Some("~anthropic/claude-fable-latest")
        );
        assert!(body.get("provider").is_none());
        let attribution = completion.model_attribution.expect("raw attribution");
        assert_eq!(attribution.data_policy, DataPolicyEligibility::default());
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
    fn image_policy_summary_is_bounded_by_utf8_bytes() {
        let decision = parse_image_policy_decision(
            &json!({
                "allowed": true,
                "violations": [],
                "summary": format!("{} accepted", "landscape—".repeat(40))
            })
            .to_string(),
        )
        .expect("multi-byte policy summary should normalize without a storage failure");

        assert!(decision.summary.len() <= MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT);
        assert!(decision.summary.is_char_boundary(decision.summary.len()));
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
