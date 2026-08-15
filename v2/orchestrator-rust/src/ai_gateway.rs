#[path = "ai_registry.rs"]
mod registry;

use super::{
    compact_whitespace, AppState, GeneratedPathwayState, GeneratedWaypointState, LocationMeta,
    NaturalPotentialPolicy,
};
use crate::ai_readiness::{
    AiReadiness, AiReadinessGate, AiReadinessSnapshot, DEFAULT_LOW_CREDIT_THRESHOLD,
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
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "mistralai/mistral-nemo";
pub(crate) const DEFAULT_OPENROUTER_METACOGNITIVE_MODEL: &str = "openai/gpt-5.6-sol";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const OPENROUTER_METACOGNITIVE_MODEL_ENV: &str = "OPENROUTER_METACOGNITIVE_MODEL";
pub(crate) const OPENROUTER_FREE_MODEL: &str = "openrouter/free";
pub(crate) const GENERATION_DEFAULT_MODE_ENV: &str = "COSYWORLD_GENERATION_DEFAULT_MODE";
pub(crate) const GENERATION_FEATURE_MODES_ENV: &str = "COSYWORLD_GENERATION_FEATURE_MODES_JSON";
pub(crate) const PATHWAY_CONTENT_FEATURE: &str = "pathway_content";
pub(crate) const PATHWAY_CONTENT_PROMPT_VERSION: &str = "pathway-content-v3";
pub(crate) const CARD_POLICY_MODE_ENV: &str = "COSYWORLD_CARD_POLICY_MODE";
pub(crate) const CARD_POLICY_MODEL_PATH_ENV: &str = "COSYWORLD_CARD_POLICY_MODEL_PATH";
pub(crate) const CARD_POLICY_TOP_K_ENV: &str = "COSYWORLD_CARD_POLICY_TOP_K";
pub(crate) const AI_LOW_CREDIT_THRESHOLD_ENV: &str = "COSYWORLD_AI_LOW_CREDIT_THRESHOLD";
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
const CHAT_COMPLETIONS_ENDPOINT: &str = "chat/completions";
const EMBEDDINGS_ENDPOINT: &str = "embeddings";
const RERANK_ENDPOINT: &str = "rerank";
const SPEECH_SYNTHESIS_ENDPOINT: &str = "audio/speech";
const TRANSCRIPTION_ENDPOINT: &str = "audio/transcriptions";
const IMAGE_GENERATION_ENDPOINT: &str = "images";
const OPENROUTER_CURRENT_KEY_ENDPOINT: &str = "key";
const OPENROUTER_KEY_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const OPENROUTER_KEY_RESPONSE_MAX_BYTES: usize = 64 * 1024;
const OPENROUTER_ROOM_SESSION_PREFIX: &str = "cosyworld-room-";
const SERVER_PAID_DAILY_LIMIT_USD: f64 = 10.0;
static SERVER_PAID_INFERENCE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
// The exact-bound STT gateway is intentionally dormant until a server-authored
// transcription action owns its input provenance and publication contract.
#[allow(dead_code)]
const TRANSCRIPTION_MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;
#[allow(dead_code)]
const TRANSCRIPTION_MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
// Raw residents have a deliberately small visible-speech budget. Even a
// "minimal" reasoning request can consume that entire budget and return a
// reasoning-only choice with `content: null` (observed from Qwen 3.6 through
// OpenRouter). Disable optional reasoning for speech; endpoints where reasoning
// is mandatory use the bounded compatibility fallback below.
const RAW_DIALOGUE_REASONING_EFFORT: &str = "none";
const REASONING_TRACE_MAX_CHARS: usize = 2_048;
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
    pub(crate) server_paid: bool,
    pub(crate) model: String,
    pub(crate) vision_model: String,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) vision_reasoning_effort: Option<String>,
    pub(crate) registry: Option<Arc<CapabilityRegistrySnapshot>>,
    pub(crate) capability_models: BTreeMap<ModelCapability, String>,
    pub(crate) data_policy_mode: DataPolicyMode,
    pub(crate) voice_routing: VoiceRoutingConfig,
    pub(crate) card_policy: Option<Arc<CardPolicyRollout>>,
    pub(crate) readiness: AiReadiness,
}

impl AiConfig {
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
        let voice_routing = VoiceRoutingConfig::from_env()?;
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
            vision_model,
            reasoning_effort,
            vision_reasoning_effort,
            registry: runtime_registry,
            capability_models,
            data_policy_mode,
            voice_routing,
            // The local card ranker is loaded by AppState independently of the
            // remote AI provider. AppState attaches it here when an AI-backed
            // voice configuration is also present.
            card_policy: None,
            readiness,
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

    pub(crate) fn pin_actor_model(
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
    pub(crate) fn actor_image_route_is_ready(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> bool {
        self.exact_route_gate(IMAGE_GENERATION_ENDPOINT, &binding.requested_model_id)
            .is_ready()
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

    #[allow(dead_code)]
    pub(crate) fn actor_chat_route_is_ready(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> bool {
        self.exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, &binding.requested_model_id)
            .is_ready()
    }

    #[allow(dead_code)]
    pub(crate) fn actor_embedding_route_is_ready(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> bool {
        self.exact_route_gate(EMBEDDINGS_ENDPOINT, &binding.requested_model_id)
            .is_ready()
    }

    #[allow(dead_code)]
    pub(crate) fn actor_rerank_route_is_ready(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> bool {
        self.exact_route_gate(RERANK_ENDPOINT, &binding.requested_model_id)
            .is_ready()
    }

    #[allow(dead_code)]
    pub(crate) fn actor_speech_route_is_ready(
        &self,
        binding: &crate::content_load::SeedActorModelBinding,
    ) -> bool {
        self.exact_route_gate(SPEECH_SYNTHESIS_ENDPOINT, &binding.requested_model_id)
            .is_ready()
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
            Self::Unconfigured => "inference_unconfigured",
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
    pub(crate) fn unconfigured(feature: &str) -> Self {
        Self {
            kind: AiFailureKind::Unconfigured,
            message: format!("AI {feature} inference is not configured"),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    pub(crate) fn invalid_response(feature: &str) -> Self {
        Self {
            kind: AiFailureKind::InvalidResponse,
            message: format!("AI {feature} returned an invalid response"),
            attempts: 1,
            latency: Duration::ZERO,
        }
    }

    fn daily_spend_exhausted(feature: &str, retry_at_unix: u64) -> Self {
        Self {
            kind: AiFailureKind::Readiness {
                reason_code: "inference_daily_spend_exhausted",
                retry_at_unix: Some(retry_at_unix),
                terminal: true,
            },
            message: format!(
                "AI {feature} is paused because the $10 UTC daily server budget is exhausted"
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

    pub(crate) fn retry_at_unix(&self) -> Option<u64> {
        match self.kind {
            AiFailureKind::Readiness { retry_at_unix, .. } => retry_at_unix,
            _ => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn retry_floor_ms_at(&self, now_unix: u64) -> u64 {
        if let Some(retry_at_unix) = self.retry_at_unix() {
            return retry_at_unix.saturating_sub(now_unix).saturating_mul(1_000);
        }
        self.retry_after()
            .map(|delay| delay.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(0)
    }

    pub(crate) fn terminal_for_model_interaction(&self) -> bool {
        match self.kind {
            AiFailureKind::Timeout | AiFailureKind::Transport => false,
            AiFailureKind::ProviderHttp { status, .. } => {
                !matches!(status, 401 | 404 | 408 | 425 | 429 | 500..=599)
            }
            AiFailureKind::Readiness { terminal, .. } => terminal,
            AiFailureKind::Unconfigured
            | AiFailureKind::Registry
            | AiFailureKind::Capability
            | AiFailureKind::Alias
            | AiFailureKind::Client
            | AiFailureKind::InvalidResponse => true,
        }
    }

    pub(crate) fn retryable_for_model_interaction(&self) -> bool {
        !self.terminal_for_model_interaction()
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
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ImageGenerationReference<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) content_type: &'a str,
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

#[derive(Clone, Copy, Debug)]
pub(crate) struct DirectAudioCompletionRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) system: &'a str,
    pub(crate) user: &'a str,
    pub(crate) voice: &'a str,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
    pub(crate) room_id: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct AiDirectAudioCompletion {
    pub(crate) bytes: Vec<u8>,
    pub(crate) content_type: String,
    pub(crate) transcript: String,
    #[allow(dead_code)] // Retained as truthful gateway execution metadata.
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
    pub(crate) model_attribution: ModelAttribution,
    #[allow(dead_code)] // Retained for provider usage audit correlation.
    pub(crate) usage: AiTokenUsage,
    #[allow(dead_code)] // Retained for exact prompt provenance audits.
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
        request.room_id,
        selection.requested_model_id(),
        if raw_mode {
            selection
                .candidate()
                .supported_parameters()
                .reasoning
                .then_some(RAW_DIALOGUE_REASONING_EFFORT)
        } else {
            config.reasoning_effort.as_deref()
        },
        raw_mode,
        selection.sends_openrouter_zdr_constraint(),
        Some(&selection),
    )
    .await
}

pub(crate) async fn request_chat_completion_for_key(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
    routing_key: &str,
) -> Result<AiCompletion, AiGatewayError> {
    let selection = config
        .pin_model_for_key(request.capability, routing_key)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    request_chat_completion_with_selection(config, request, &selection).await
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
        request.room_id,
        selection.requested_model_id(),
        if raw_mode {
            selection
                .candidate()
                .supported_parameters()
                .reasoning
                .then_some(RAW_DIALOGUE_REASONING_EFFORT)
        } else {
            config.reasoning_effort.as_deref()
        },
        raw_mode,
        selection.sends_openrouter_zdr_constraint(),
        Some(selection),
    )
    .await
}

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
        EMBEDDINGS_ENDPOINT,
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
        RERANK_ENDPOINT,
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
        SPEECH_SYNTHESIS_ENDPOINT,
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

pub(crate) async fn request_direct_audio_completion_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: DirectAudioCompletionRequest<'_>,
) -> Result<AiDirectAudioCompletion, AiGatewayError> {
    let started_at = Instant::now();
    if request.system.trim().is_empty()
        || request.user.trim().is_empty()
        || request.voice.trim().is_empty()
        || request.voice.len() > SPEECH_SYNTHESIS_MAX_VOICE_BYTES
        || !binding.input_modalities.iter().any(|value| value == "text")
        || !binding
            .output_modalities
            .iter()
            .any(|value| value == "text")
        || !binding
            .output_modalities
            .iter()
            .any(|value| value == "audio")
    {
        return Err(AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{} direct-audio request was invalid", request.feature),
            attempts: 0,
            latency: started_at.elapsed(),
        });
    }
    let selection = config
        .pin_actor_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let gate = config.exact_route_gate(CHAT_COMPLETIONS_ENDPOINT, selection.requested_model_id());
    if !gate.is_ready() {
        return Err(AiGatewayError::readiness(request.feature, gate));
    }
    let context_hash = exact_endpoint_binary_context_hash(
        request.feature,
        request.prompt_version,
        &[
            request.system.as_bytes(),
            request.user.as_bytes(),
            request.voice.as_bytes(),
            b"mp3",
        ],
    );
    let _server_spend_guard = enforce_server_paid_daily_limit(config, request.feature).await?;
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
            "model": selection.requested_model_id(),
            "messages": [
                { "role": "system", "content": request.system },
                { "role": "user", "content": request.user }
            ],
            "modalities": ["text", "audio"],
            "audio": { "voice": request.voice, "format": "mp3" },
            "stream": true,
            "max_tokens": 256,
        });
        add_openrouter_room_session(config, &mut payload, request.room_id);
        add_exact_binding_zdr_constraint(&mut payload, &selection);
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
                if (error.is_timeout() || error.is_connect()) && attempt < max_attempts {
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                config.readiness.record_transport_failure(
                    CHAT_COMPLETIONS_ENDPOINT,
                    selection.requested_model_id(),
                );
                return Err(AiGatewayError {
                    kind: if error.is_timeout() {
                        AiFailureKind::Timeout
                    } else {
                        AiFailureKind::Transport
                    },
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
                CHAT_COMPLETIONS_ENDPOINT,
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
        let mut stream_bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::Transport,
            message: format!("{} audio stream failed: {error}", request.feature),
            attempts: attempt,
            latency: started_at.elapsed(),
        })? {
            if stream_bytes.len().saturating_add(chunk.len())
                > IMAGE_GENERATION_MAX_RESPONSE_BYTES as usize
            {
                return Err(AiGatewayError {
                    kind: AiFailureKind::InvalidResponse,
                    message: format!("{} audio stream exceeded its byte limit", request.feature),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                });
            }
            stream_bytes.extend_from_slice(&chunk);
        }
        let stream = std::str::from_utf8(&stream_bytes).map_err(|_| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{} audio stream was not UTF-8 SSE", request.feature),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
        let mut audio = Vec::new();
        let mut transcript = String::new();
        let mut provider_model = None::<String>;
        let mut usage = AiTokenUsage::default();
        for data in stream
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
        {
            if data == "[DONE]" {
                continue;
            }
            let value = serde_json::from_str::<Value>(data).map_err(|error| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} audio stream event was invalid: {error}",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;
            if let Some(model) = value.get("model").and_then(Value::as_str) {
                provider_model = Some(model.to_string());
            }
            if value.get("usage").is_some() {
                usage = token_usage(&value);
            }
            let audio_delta = value
                .pointer("/choices/0/delta/audio")
                .or_else(|| value.pointer("/choices/0/message/audio"));
            if let Some(encoded) = audio_delta
                .and_then(|audio| audio.get("data"))
                .and_then(Value::as_str)
            {
                let decoded = BASE64_STANDARD
                    .decode(encoded)
                    .map_err(|error| AiGatewayError {
                        kind: AiFailureKind::InvalidResponse,
                        message: format!(
                            "{} audio chunk was invalid base64: {error}",
                            request.feature
                        ),
                        attempts: attempt,
                        latency: started_at.elapsed(),
                    })?;
                if audio.len().saturating_add(decoded.len()) > SPEECH_SYNTHESIS_MAX_RESPONSE_BYTES {
                    return Err(AiGatewayError {
                        kind: AiFailureKind::InvalidResponse,
                        message: format!(
                            "{} audio output exceeded its byte limit",
                            request.feature
                        ),
                        attempts: attempt,
                        latency: started_at.elapsed(),
                    });
                }
                audio.extend_from_slice(&decoded);
            }
            if let Some(fragment) = audio_delta
                .and_then(|audio| audio.get("transcript"))
                .and_then(Value::as_str)
            {
                if fragment.starts_with(&transcript) {
                    transcript = fragment.to_string();
                } else {
                    transcript.push_str(fragment);
                }
            }
        }
        let transcript = transcript.trim().to_string();
        if audio.is_empty() || transcript.is_empty() {
            return Err(AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!(
                    "{} audio stream omitted audio or transcript",
                    request.feature
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }
        let model_attribution = selection
            .attribute_response(provider_model.as_deref())
            .map_err(|error| {
                let mut error = AiGatewayError::registry(request.feature, error);
                error.attempts = attempt;
                error.latency = started_at.elapsed();
                error
            })?;
        config
            .readiness
            .record_success(CHAT_COMPLETIONS_ENDPOINT, selection.requested_model_id());
        return Ok(AiDirectAudioCompletion {
            bytes: audio,
            content_type: "audio/mpeg".to_string(),
            transcript,
            attempts: attempt,
            latency: started_at.elapsed(),
            model_attribution,
            usage,
            context_hash,
            prompt_version: request.prompt_version.to_string(),
        });
    }
    unreachable!("the bounded direct-audio attempt loop always returns")
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
        TRANSCRIPTION_ENDPOINT,
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
    if selection.sends_openrouter_zdr_constraint() {
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
    // OpenRouter's exact non-chat routes may attribute a successful response
    // with the serving backend's implementation id rather than either the
    // requested catalog id or its pinned catalog slug (for example,
    // `baai/bge-m3` is returned as `parasail-bge-m3`). The authenticated
    // request body remains pinned to `selection.requested_model_id()`; retain
    // that requested identity and record the provider's non-empty normalized
    // value as the resolved identity, just as exact raw Chat already does.
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
    let requested_model_id = payload
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{feature} exact request did not identify its model"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let gate = config.exact_route_gate(endpoint, requested_model_id);
    if !gate.is_ready() {
        return Err(AiGatewayError::readiness(feature, gate));
    }
    let _server_spend_guard = if requested_model_id == OPENROUTER_FREE_MODEL {
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
                config
                    .readiness
                    .record_transport_failure(endpoint, requested_model_id);
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
            let retry_after = retry_after_from_headers(response.headers());
            let detail = provider_error_detail(response).await;
            config.readiness.record_http_failure(
                endpoint,
                requested_model_id,
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
        config
            .readiness
            .record_success(endpoint, requested_model_id);
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
    let requested_model_id = payload
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{feature} exact request did not identify its model"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let gate = config.exact_route_gate(endpoint, requested_model_id);
    if !gate.is_ready() {
        return Err(AiGatewayError::readiness(feature, gate));
    }
    let _server_spend_guard = if requested_model_id == OPENROUTER_FREE_MODEL {
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
                config
                    .readiness
                    .record_transport_failure(endpoint, requested_model_id);
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
            let retry_after = retry_after_from_headers(response.headers());
            let detail = provider_error_detail(response).await;
            config.readiness.record_http_failure(
                endpoint,
                requested_model_id,
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
        config
            .readiness
            .record_success(endpoint, requested_model_id);
        return Ok((response_bytes, generation_id, attempt));
    }
    unreachable!("the bounded exact-audio attempt loop always returns")
}

pub(crate) async fn request_image_generation_with_binding(
    config: &AiConfig,
    binding: &crate::content_load::SeedActorModelBinding,
    request: ImageGenerationRequest<'_>,
) -> Result<AiGeneratedImage, AiGatewayError> {
    let selection = config
        .pin_actor_image_model(binding)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let result = request_image_generation_with_selection(
        config,
        &selection,
        request,
        binding
            .input_modalities
            .iter()
            .any(|value| value == "image"),
    )
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

pub(crate) async fn request_image_generation_for_key(
    config: &AiConfig,
    request: ImageGenerationRequest<'_>,
    routing_key: &str,
) -> Result<AiGeneratedImage, AiGatewayError> {
    let selection = config
        .pin_model_for_key(ModelCapability::ImageGeneration, routing_key)
        .map_err(|error| AiGatewayError::registry(request.feature, error))?;
    let result = request_image_generation_with_selection(config, &selection, request, false).await;
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
        None,
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
    room_id: Option<u64>,
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
        add_openrouter_room_session(config, &mut payload, room_id);
        if let Some(reasoning_effort) = reasoning_effort {
            payload["reasoning"] = if raw_mode && reasoning_effort == RAW_DIALOGUE_REASONING_EFFORT
            {
                json!({ "enabled": false })
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
            requested_max_tokens = max_tokens,
            completion_tokens = usage.completion_tokens.unwrap_or(0),
            "CosyWorld AI inference completed"
        );
        config
            .readiness
            .record_success(CHAT_COMPLETIONS_ENDPOINT, model);
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
        .header("HTTP-Referer", "https://cosy.world/")
        .header("X-OpenRouter-Title", "CosyWorld v2")
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
        .header("HTTP-Referer", "https://cosy.world/")
        .header("X-OpenRouter-Title", "CosyWorld v2")
        .header("X-Title", "CosyWorld v2")
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
    pub(super) occupied_name_words: BTreeSet<String>,
}

const GENERIC_PATHWAY_NAME_WORDS: &[&str] = &[
    "bend", "causeway", "crossing", "cut", "ford", "glen", "hollow", "mile", "notch", "pass",
    "path", "reach", "ridge", "rise", "road", "steps", "terrace", "trail", "turn", "verge", "way",
];

pub(super) fn distinctive_pathway_name_words(value: &str) -> BTreeSet<String> {
    value
        .split(|character: char| !character.is_ascii_alphabetic())
        .map(str::to_ascii_lowercase)
        .filter(|word| word.len() >= 4 && !GENERIC_PATHWAY_NAME_WORDS.contains(&word.as_str()))
        .collect()
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
    occupied_name_words: &BTreeSet<String>,
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
    let avoided_words = occupied_name_words
        .iter()
        .take(80)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Create {count} distinct hidden waypoint identities for successive segments of one cozy storybook route. They are generated together now but players encounter them one at a time through Scout.\nCanonical route ID: {route_id}\nCanonical route version: {route_version}\nRoute endpoints: origin {origin_name}; destination {destination_name}\nTravel direction: {direction}, from {origin_name} toward {destination_name}.\nNearby authored origin description: {origin_description}\nNearby authored origin persona: {origin_persona}\nOrigin ecology: {origin_ecology}\nNearby authored destination description: {destination_description}\nNearby authored destination persona: {destination_persona}\nDestination ecology: {destination_ecology}\n{waypoint_context}\nAlready-visible distinctive name words to avoid: {avoided_words}.\nFor each waypoint return: name (evocative proper place name, 2-5 words); title (1-6 words); description (one concrete physical sentence); persona (one sentence describing how the place behaves, never dialogue); visual_detail (physical landscape details only). Preserve order. Ground every field in the supplied direction, endpoint descriptions, biome, terrain, climate, hydrology, vegetation, fauna, and ecosystem cues. Use a different distinctive naming word for every waypoint and do not reuse any already-visible distinctive name word listed above. You may name and describe a waypoint, but you must not choose or change topology, route identity, endpoints, directionality, ownership, route version, segment count, access, or rules. Do not introduce named people, items, quests, rewards, danger outcomes, magic powers, or unsupported ecological facts. Names must use only ASCII letters, spaces, hyphens, or apostrophes, and must not use numbers, Pathway, Segment, either route endpoint, or duplicates.",
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
    let occupied_name_words = runtime
        .generated_pathways
        .values()
        .filter(|existing| existing.id != pathway.id)
        .flat_map(|existing| existing.waypoints.iter())
        .flat_map(|waypoint| distinctive_pathway_name_words(&waypoint.name))
        .collect::<BTreeSet<_>>();
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
        &occupied_name_words,
    );
    PathwayContentPromptContext {
        prompt,
        origin_name,
        destination_name,
        occupied_names,
        occupied_name_words,
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

pub(super) fn generated_pathway_names_use_fresh_words(
    waypoints: &[GeneratedWaypointContentProposal],
    occupied_name_words: &BTreeSet<String>,
) -> bool {
    let mut proposed_words = BTreeSet::new();
    waypoints.iter().all(|waypoint| {
        let distinctive_words = distinctive_pathway_name_words(&waypoint.name);
        !distinctive_words.is_empty()
            && distinctive_words.iter().all(|word| {
                !occupied_name_words.contains(word) && proposed_words.insert(word.clone())
            })
    })
}

pub(super) fn generated_pathway_contents_are_novel(
    waypoints: &[GeneratedWaypointContentProposal],
    anchors: &[&str],
    occupied_names: &BTreeSet<String>,
    occupied_name_words: &BTreeSet<String>,
) -> bool {
    generated_pathway_names_use_fresh_words(waypoints, occupied_name_words)
        && waypoints.iter().all(|waypoint| {
            generated_pathway_name_avoids_anchors(&waypoint.name, anchors)
                && !occupied_names.contains(&waypoint.name.to_ascii_lowercase())
        })
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

#[cfg(test)]
mod tests {
    use super::registry::DataPolicyEligibility;
    use super::*;
    use crate::RuntimeWorld;
    use axum::{
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use base64::Engine;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;

    #[test]
    fn server_budget_closes_at_ten_dollars_and_resets_on_utc_boundary() {
        assert!(!server_daily_spend_exhausted(9.999_999));
        assert!(server_daily_spend_exhausted(10.0));
        assert!(server_daily_spend_exhausted(10.01));
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

    fn direct_audio_actor_model_binding() -> crate::content_load::SeedActorModelBinding {
        let mut binding = raw_actor_model_binding(false);
        binding.id = "openai/gpt-audio".to_string();
        binding.actor_id = 232_270_660_128;
        binding.actor_ref = "pack://cosyworld.elysium/actor/232270660128".to_string();
        binding.requested_model_id = binding.id.clone();
        binding.canonical_slug = binding.id.clone();
        binding.display_name = "OpenAI: GPT Audio".to_string();
        binding.input_modalities = vec!["audio".to_string(), "text".to_string()];
        binding.output_modalities = vec!["audio".to_string(), "text".to_string()];
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
                room_id: None,
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
        let occupied_name_words = BTreeSet::from(["foxglove".to_string()]);
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
            &occupied_name_words,
        );

        assert!(prompt.contains("Canonical route ID: route://cosyworld.the-holy-land"));
        assert!(prompt.contains("Canonical route version: 3"));
        assert!(prompt.contains("Route endpoints: origin Bethlehem; destination Jerusalem"));
        assert!(prompt.contains("Travel direction: north, from Bethlehem toward Jerusalem"));
        assert!(prompt.contains(&origin_meta.description));
        assert!(prompt.contains(&destination_meta.description));
        assert!(prompt.contains("segment index/count: 1/2"));
        assert!(prompt.contains("Already-visible distinctive name words to avoid: foxglove"));
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
    fn pathway_name_vocabulary_separates_distinctive_words_from_landforms() {
        assert_eq!(
            distinctive_pathway_name_words("Foxglove Turn"),
            BTreeSet::from(["foxglove".to_string()])
        );
        assert_eq!(
            distinctive_pathway_name_words("Rain-Silver Crossing"),
            BTreeSet::from(["rain".to_string(), "silver".to_string()])
        );
        assert!(distinctive_pathway_name_words("Quiet Hollow").contains("quiet"));
    }

    #[test]
    fn pathway_names_reject_reused_distinctive_words() {
        let waypoint = |name: &str| GeneratedWaypointContentProposal {
            name: name.to_string(),
            title: "A route landmark".to_string(),
            description: "Flat stones cross the slope beside low grass.".to_string(),
            persona: "Footprints remain visible on the pale ground.".to_string(),
            visual_detail: "flat stones and low grass".to_string(),
        };
        let occupied = BTreeSet::from(["foxglove".to_string()]);

        assert!(generated_pathway_names_use_fresh_words(
            &[waypoint("Cedar Hollow"), waypoint("Amber Crossing")],
            &occupied,
        ));
        assert!(!generated_pathway_names_use_fresh_words(
            &[waypoint("Foxglove Turn")],
            &occupied,
        ));
        assert!(!generated_pathway_names_use_fresh_words(
            &[waypoint("Cedar Hollow"), waypoint("Cedar Crossing")],
            &BTreeSet::new(),
        ));
        assert!(generated_pathway_contents_are_novel(
            &[waypoint("Cedar Hollow")],
            &["Bethlehem", "Jerusalem"],
            &BTreeSet::new(),
            &occupied,
        ));
        assert!(!generated_pathway_contents_are_novel(
            &[waypoint("Jerusalem Hollow")],
            &["Bethlehem", "Jerusalem"],
            &BTreeSet::new(),
            &occupied,
        ));
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
        let reference_bytes = BASE64_STANDARD
            .decode(PNG_1X1)
            .expect("decode reference image");
        let generated = request_image_generation_with_binding(
            &config,
            &image_actor_model_binding(false),
            ImageGenerationRequest {
                feature: "image_test",
                prompt_version: "image-test-v1",
                prompt: "a tiny lantern",
                reference: Some(ImageGenerationReference {
                    bytes: &reference_bytes,
                    content_type: "image/png",
                }),
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
        assert!(body["input_references"][0]["image_url"]["url"]
            .as_str()
            .is_some_and(|url| url.starts_with("data:image/png;base64,")));
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
                        "model": "parasail-bge-base-en-v1.5",
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
            "parasail-bge-base-en-v1.5"
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
    async fn direct_audio_model_streams_its_own_mp3_and_transcript() {
        use std::sync::Mutex;

        let request_body = Arc::new(Mutex::new(None::<Value>));
        let captured = Arc::clone(&request_body);
        let audio = BASE64_STANDARD.encode(b"ID3\x04direct-model-mp3");
        let app = Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let captured = Arc::clone(&captured);
                let audio = audio.clone();
                async move {
                    *captured.lock().expect("capture direct audio request") = Some(body);
                    let stream = format!(
                        "data: {{\"model\":\"openai/gpt-audio\",\"choices\":[{{\"delta\":{{\"audio\":{{\"data\":\"{audio}\",\"transcript\":\"Welcome home.\"}}}}}}]}}\n\ndata: {{\"usage\":{{\"prompt_tokens\":8,\"completion_tokens\":4,\"total_tokens\":12}},\"choices\":[{{\"delta\":{{}}}}]}}\n\ndata: [DONE]\n\n"
                    );
                    ([(("content-type"), "text/event-stream")], stream).into_response()
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind direct audio gateway test server");
        let address = listener.local_addr().expect("direct audio gateway address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let direct = request_direct_audio_completion_with_binding(
            &config,
            &direct_audio_actor_model_binding(),
            DirectAudioCompletionRequest {
                feature: "direct_audio_test",
                prompt_version: "direct-audio-test-v1",
                system: "Speak directly.",
                user: "Welcome the traveler.",
                voice: "alloy",
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
                room_id: Some(118),
            },
        )
        .await
        .expect("direct audio completion");

        let body = request_body
            .lock()
            .expect("read direct audio request")
            .clone()
            .expect("direct audio request captured");
        assert_eq!(body["model"], "openai/gpt-audio");
        assert_eq!(body["modalities"], json!(["text", "audio"]));
        assert_eq!(body["audio"], json!({ "voice": "alloy", "format": "mp3" }));
        assert_eq!(body["stream"], true);
        assert!(body.get("session_id").is_none());
        assert_eq!(direct.bytes, b"ID3\x04direct-model-mp3");
        assert_eq!(direct.transcript, "Welcome home.");
        assert_eq!(direct.usage.total_tokens, Some(12));
        assert_eq!(
            direct.model_attribution.resolved_model_id,
            "openai/gpt-audio"
        );
        server.abort();
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
    async fn transcription_rejects_empty_transcript() {
        let app = Router::new().route(
            "/audio/transcriptions",
            post(|| async {
                Json(json!({
                    "model": "openai/gpt-4o-mini-transcribe-20260731",
                    "text": "  "
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind empty transcription gateway test server");
        let address = listener
            .local_addr()
            .expect("empty transcription gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let error = request_transcription_with_binding(
            &config,
            &transcription_actor_model_binding(true),
            TranscriptionRequest {
                feature: "transcription_empty_test",
                prompt_version: "transcription-empty-test-v1",
                input_audio: b"empty",
                input_audio_format: TranscriptionAudioFormat::Mp3,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("empty transcription response must fail closed");
        assert_eq!(error.code(), "inference_invalid_response");
        assert_eq!(error.attempts, 1);
        server.abort();
    }

    #[tokio::test]
    async fn transcription_accepts_backend_model_attribution_without_unpinning_request() {
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
                        "model": "other/provider-model",
                        "text": "Backend attribution is truthful."
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind backend attribution transcription test server");
        let address = listener
            .local_addr()
            .expect("backend attribution transcription test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let audio = b"server-authored audio fixture";

        let transcription = request_transcription_with_binding(
            &config,
            &transcription_actor_model_binding(true),
            TranscriptionRequest {
                feature: "transcription_backend_attribution_test",
                prompt_version: "transcription-backend-attribution-test-v1",
                input_audio: audio,
                input_audio_format: TranscriptionAudioFormat::Mp3,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("a non-empty provider backend model is valid attribution");

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
        assert_eq!(body["input_audio"]["format"], "mp3");
        assert_eq!(body["provider"]["data_collection"], "deny");
        assert_eq!(body["provider"]["zdr"], true);
        assert_eq!(
            transcription.model_attribution.requested_model_id,
            "openai/gpt-4o-mini-transcribe"
        );
        assert_eq!(
            transcription.model_attribution.resolved_model_id,
            "other/provider-model"
        );
        assert_eq!(transcription.text, "Backend attribution is truthful.");
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
    fn keyed_world_content_routing_is_stable_and_uses_the_reviewed_pool() {
        let registry = CapabilityRegistrySnapshot::from_json(
            r#"{
              "schema_version": 1,
              "snapshot_version": "keyed-routing-1",
              "declared": [
                {
                  "requested_model_id": "provider/luna",
                  "provider": "openrouter",
                  "concrete_model": {"model_id": "provider/luna"},
                  "input_modalities": ["text"],
                  "output_modalities": ["text"],
                  "supported_parameters": {"structured_output": true, "json_mode": true},
                  "data_policy": {"retention": "none", "training": "prohibited"},
                  "capabilities": ["world_content"]
                },
                {
                  "requested_model_id": "provider/gemini",
                  "provider": "openrouter",
                  "concrete_model": {"model_id": "provider/gemini"},
                  "input_modalities": ["text"],
                  "output_modalities": ["text"],
                  "supported_parameters": {"structured_output": true, "json_mode": true},
                  "data_policy": {"retention": "none", "training": "prohibited"},
                  "capabilities": ["world_content"]
                }
              ]
            }"#,
        )
        .expect("keyed routing registry");
        let config = AiConfig {
            model: "provider/luna".to_string(),
            registry: Some(Arc::new(registry)),
            data_policy_mode: DataPolicyMode::Production,
            ..AiConfig::default()
        };

        let first = config
            .pin_model_for_key(ModelCapability::WorldContent, "avatar:5000")
            .expect("first selection");
        let repeated = config
            .pin_model_for_key(ModelCapability::WorldContent, "avatar:5000")
            .expect("repeated selection");
        assert_eq!(first.requested_model_id(), repeated.requested_model_id());

        let selected = (5000..5100)
            .map(|actor_id| {
                config
                    .pin_model_for_key(ModelCapability::WorldContent, &format!("avatar:{actor_id}"))
                    .expect("pooled selection")
                    .requested_model_id()
                    .to_string()
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(selected.len(), 2);

        let mut pinned = config.clone();
        pinned
            .capability_models
            .insert(ModelCapability::WorldContent, "provider/luna".to_string());
        for actor_id in 5000..5010 {
            assert_eq!(
                pinned
                    .pin_model_for_key(
                        ModelCapability::WorldContent,
                        &format!("avatar:{actor_id}"),
                    )
                    .expect("operator pin")
                    .requested_model_id(),
                "provider/luna"
            );
        }
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
    fn actor_job_failure_classification_separates_permanent_and_transient_outages() {
        for status in [
            reqwest::StatusCode::REQUEST_TIMEOUT,
            reqwest::StatusCode::UNAUTHORIZED,
            reqwest::StatusCode::TOO_EARLY,
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            reqwest::StatusCode::NOT_FOUND,
            reqwest::StatusCode::BAD_GATEWAY,
            reqwest::StatusCode::SERVICE_UNAVAILABLE,
        ] {
            let error =
                AiGatewayError::provider_http("test", status, None, None, 1, Duration::ZERO);
            assert!(error.retryable_for_model_interaction(), "{status}");
            assert!(!error.terminal_for_model_interaction(), "{status}");
        }
        for status in [
            reqwest::StatusCode::BAD_REQUEST,
            reqwest::StatusCode::PAYMENT_REQUIRED,
        ] {
            let error =
                AiGatewayError::provider_http("test", status, None, None, 1, Duration::ZERO);
            assert!(error.terminal_for_model_interaction(), "{status}");
            assert!(!error.retryable_for_model_interaction(), "{status}");
        }

        for kind in [AiFailureKind::Timeout, AiFailureKind::Transport] {
            let error = AiGatewayError {
                kind,
                message: "transient".to_string(),
                attempts: 1,
                latency: Duration::ZERO,
            };
            assert!(error.retryable_for_model_interaction());
        }

        let probing = AiReadiness::probing_with_low_credit_threshold(5.0);
        let probing_error = AiGatewayError::readiness(
            "test",
            probing.gate(CHAT_COMPLETIONS_ENDPOINT, "provider/model"),
        );
        assert!(probing_error.retryable_for_model_interaction());

        probing.record_probe_http_failure(401);
        let unauthorized = AiGatewayError::readiness(
            "test",
            probing.gate(CHAT_COMPLETIONS_ENDPOINT, "provider/model"),
        );
        assert!(unauthorized.terminal_for_model_interaction());

        let exact_route = AiReadiness::default();
        exact_route.record_http_failure(CHAT_COMPLETIONS_ENDPOINT, "provider/model", 404, None);
        let incompatible = AiGatewayError::readiness(
            "test",
            exact_route.gate(CHAT_COMPLETIONS_ENDPOINT, "provider/model"),
        );
        assert!(incompatible.retryable_for_model_interaction());
        assert!(!incompatible.terminal_for_model_interaction());
    }

    #[test]
    fn actor_job_retry_floor_preserves_provider_delay() {
        let retry_after = AiGatewayError::provider_http(
            "test",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            Some(Duration::from_secs(17)),
            None,
            1,
            Duration::ZERO,
        );
        assert_eq!(retry_after.retry_floor_ms_at(0), 17_000);

        let readiness = AiReadiness::default();
        readiness.record_http_failure(
            EMBEDDINGS_ENDPOINT,
            "provider/model",
            429,
            Some(Duration::from_secs(10)),
        );
        let blocked = AiGatewayError::readiness(
            "test",
            readiness.gate(EMBEDDINGS_ENDPOINT, "provider/model"),
        );
        let retry_at = blocked.retry_at_unix().expect("route retry deadline");
        assert_eq!(blocked.retry_floor_ms_at(retry_at.saturating_sub(2)), 2_000);
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
    async fn raw_actor_disables_optional_reasoning_and_enables_it_once_when_mandatory() {
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
                                        "message": "Reasoning is mandatory and cannot be disabled"
                                    }
                                })),
                            )
                                .into_response();
                        }
                        Json(json!({
                            "model": "arcee-ai/trinity-large-thinking",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {
                                    "content": "Reasoning is enabled, and I can answer.",
                                    "reasoning": "A longer raw trace that should lose to the structured summary.",
                                    "reasoning_details": [
                                        {
                                            "type": "reasoning.summary",
                                            "summary": "I connected the question to the room before answering."
                                        },
                                        {
                                            "type": "reasoning.encrypted",
                                            "data": "must-not-be-stored"
                                        }
                                    ]
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
                room_id: None,
            },
            &selection,
        )
        .await
        .expect("mandatory reasoning fallback succeeds");

        assert_eq!(completion.attempts, 1);
        assert_eq!(
            completion.reasoning_trace.as_deref(),
            Some("I connected the question to the room before answering.")
        );
        let bodies = request_bodies.lock().expect("read raw requests");
        assert_eq!(bodies.len(), 2, "one 400 gets exactly one shape fallback");
        assert_eq!(
            bodies[0]
                .pointer("/reasoning/enabled")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert!(bodies[0].pointer("/reasoning/exclude").is_none());
        assert_eq!(
            bodies[1]
                .pointer("/reasoning/enabled")
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
            vision_model: "test-vision-model".to_string(),
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
            vision_model: "test-vision-model".to_string(),
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

    #[tokio::test]
    async fn unauthorized_exact_request_is_single_call_and_blocks_only_that_route() {
        let requests = Arc::new(AtomicUsize::new(0));
        let observed_requests = Arc::clone(&requests);
        let app = Router::new().route(
            "/embeddings",
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
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let inputs = vec!["one passage".to_string()];
        let binding = embedding_actor_model_binding(false);
        let request = || {
            request_embeddings_with_binding(
                &config,
                &binding,
                EmbeddingRequest {
                    feature: "embedding_readiness_unauthorized",
                    prompt_version: "embedding-readiness-v1",
                    inputs: &inputs,
                    timeout: Duration::from_secs(2),
                    max_attempts: 4,
                    referer: "http://127.0.0.1",
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
            "/embeddings",
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
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        let binding = embedding_actor_model_binding(false);
        let inputs = vec!["one passage".to_string()];
        let error = request_embeddings_with_binding(
            &config,
            &binding,
            EmbeddingRequest {
                feature: "embedding_readiness_rate_limit",
                prompt_version: "embedding-readiness-v1",
                inputs: &inputs,
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("429 must open a route cooldown");

        assert_eq!(error.provider_http_status(), Some(429));
        assert_eq!(error.retry_after(), Some(Duration::from_secs(7)));
        assert!(!config.actor_embedding_route_is_ready(&binding));
        assert!(config.actor_rerank_route_is_ready(&rerank_actor_model_binding(false)));
        server.abort();
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
