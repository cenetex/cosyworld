#![allow(dead_code)]

use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

const PROFILE_SCHEMA_VERSION: u32 = 1;
const PROFILE_SNAPSHOT_VERSION: &str = "openrouter-interactions-2026-08-10.7";
const PROFILE_BINDING_COUNT: usize = 500;

// Interaction profiles describe operational provider routes, not authored or
// persisted world state. Embedding this separately avoids changing worldpack
// compatibility hashes for an endpoint-capability snapshot. The validator
// still pins every row to the embedded actor binding catalog. If interaction
// profiles become authored/persisted state, mount them through the content
// registry and declare the resulting worldpack migration instead.
const EMBEDDED_INTERACTION_PROFILES: &str =
    include_str!("../../content/elysium/actor_interaction_profiles.json");
const EMBEDDED_ACTOR_MODEL_BINDINGS: &str =
    include_str!("../../content/elysium/actor_model_bindings.json");

const ARCHIVED_MODEL_IDS: [&str; 5] = [
    "inclusionai/ling-3.0-flash:free",
    "mistralai/devstral-2512",
    "openai/gpt-5.1-chat",
    "openai/gpt-5.3-chat",
    "openai/text-embedding-3-small:batch",
];
const TTS_VOICE_UNAVAILABLE_REASON: &str =
    "no_authoritative_supported_voice_in_profile_snapshot_2026-08-08";
const TTS_DEFAULT_VOICES: [(&str, &str); 13] = [
    ("canopylabs/orpheus-3b-0.1-ft", "tara"),
    ("deepgram/aura-2", "aura-2-thalia-en"),
    ("google/gemini-3.1-flash-tts-preview", "Zephyr"),
    ("hexgrad/kokoro-82m", "af_alloy"),
    ("microsoft/mai-voice-2", "en-US-Harper:MAI-Voice-2"),
    ("microsoft/mai-voice-2-flash", "en-US-Harper:MAI-Voice-2"),
    ("mistralai/voxtral-mini-tts-2603", "en_paul_sad"),
    ("qwen/qwen-audio-3.0-tts-flash", "loongjohn"),
    ("qwen/qwen-audio-3.0-tts-plus", "longanlingxin"),
    ("sesame/csm-1b", "conversational_a"),
    ("x-ai/grok-voice-tts-1.0", "eve"),
    ("zyphra/zonos-v0.1-hybrid", "american_female"),
    ("zyphra/zonos-v0.1-transformer", "american_female"),
];

fn authoritative_tts_voice(requested_model_id: &str) -> Option<&'static str> {
    TTS_DEFAULT_VOICES
        .iter()
        .find_map(|(model_id, voice)| (*model_id == requested_model_id).then_some(*voice))
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub(super) enum ActorInteractionKind {
    Talk,
    BatchTalk,
    Illustrate,
    Speak,
    Transcribe,
    FindResonance,
    RankEchoes,
    CreateVideo,
    VoiceChat,
    ComposeAudio,
    Unsupported,
}

impl ActorInteractionKind {
    fn expected_endpoint(self) -> Option<&'static str> {
        match self {
            Self::Talk | Self::VoiceChat | Self::ComposeAudio => Some("/api/v1/chat/completions"),
            Self::BatchTalk => Some("/api/beta/batches"),
            Self::Illustrate => Some("/api/v1/images"),
            Self::Speak => Some("/api/v1/audio/speech"),
            Self::Transcribe => Some("/api/v1/audio/transcriptions"),
            Self::FindResonance => Some("/api/v1/embeddings"),
            Self::RankEchoes => Some("/api/v1/rerank"),
            Self::CreateVideo => Some("/api/v1/videos"),
            Self::Unsupported => None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ActorInteractionProfile {
    pub(super) kind: ActorInteractionKind,
    pub(super) label: String,
    pub(super) provider_available: bool,
    pub(super) disabled_reason: Option<String>,
    pub(super) runtime_adapter_supported: bool,
    pub(super) runtime_adapter_unsupported_reason: Option<String>,
    pub(super) endpoint: Option<String>,
    pub(super) accepted_inputs: Vec<String>,
    pub(super) outputs: Vec<String>,
    pub(super) endpoint_zdr: Option<bool>,
    pub(super) asynchronous: bool,
    pub(super) streaming: bool,
    pub(super) required_parameters: Vec<String>,
    pub(super) defaults: Value,
}

impl ActorInteractionProfile {
    /// Provider and end-to-end adapter readiness only. Callers must still
    /// apply data-policy, authorization, rate, and runtime configuration gates.
    pub(super) fn ready_before_policy(&self) -> bool {
        self.provider_available && self.runtime_adapter_supported
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ActorInteractionBindingProfile {
    pub(super) actor_id: u64,
    pub(super) requested_model_id: String,
    pub(super) route_model_id: String,
    pub(super) canonical_slug: String,
    pub(super) availability: String,
    pub(super) availability_reason: Option<String>,
    pub(super) profiles: Vec<ActorInteractionProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ActorInteractionProfileDocument {
    pub(super) schema_version: u32,
    pub(super) profile_snapshot_version: String,
    pub(super) catalog_snapshot_version: String,
    pub(super) source_binding_count: usize,
    pub(super) runtime_refresh: bool,
    pub(super) provider_availability_semantics: String,
    pub(super) bindings: Vec<ActorInteractionBindingProfile>,
}

#[derive(Debug, Deserialize)]
struct ActorModelBindingIdentity {
    actor_id: u64,
    requested_model_id: String,
    canonical_slug: String,
    catalog_snapshot_version: String,
}

struct ActorInteractionProfileRegistry {
    document: ActorInteractionProfileDocument,
    by_actor_id: BTreeMap<u64, usize>,
    by_requested_model_id: BTreeMap<String, usize>,
}

#[derive(Clone, Copy)]
pub(super) struct ExactActorInteractionProfile<'a> {
    pub(super) binding: &'a ActorInteractionBindingProfile,
    pub(super) profile: &'a ActorInteractionProfile,
}

static PROFILE_REGISTRY: OnceLock<Result<ActorInteractionProfileRegistry, String>> =
    OnceLock::new();

fn profile_registry() -> Result<&'static ActorInteractionProfileRegistry, String> {
    match PROFILE_REGISTRY.get_or_init(load_profile_registry) {
        Ok(registry) => Ok(registry),
        Err(error) => Err(error.clone()),
    }
}

fn load_profile_registry() -> Result<ActorInteractionProfileRegistry, String> {
    let document =
        serde_json::from_str::<ActorInteractionProfileDocument>(EMBEDDED_INTERACTION_PROFILES)
            .map_err(|error| format!("invalid embedded actor interaction profiles: {error}"))?;
    let actor_bindings =
        serde_json::from_str::<Vec<ActorModelBindingIdentity>>(EMBEDDED_ACTOR_MODEL_BINDINGS)
            .map_err(|error| format!("invalid embedded actor model bindings: {error}"))?;
    validate_profile_document(&document, &actor_bindings)?;

    let mut by_actor_id = BTreeMap::new();
    let mut by_requested_model_id = BTreeMap::new();
    for (index, binding) in document.bindings.iter().enumerate() {
        if by_actor_id.insert(binding.actor_id, index).is_some()
            || by_requested_model_id
                .insert(binding.requested_model_id.clone(), index)
                .is_some()
        {
            return Err("actor interaction profiles contain duplicate bindings".to_string());
        }
    }
    Ok(ActorInteractionProfileRegistry {
        document,
        by_actor_id,
        by_requested_model_id,
    })
}

fn validate_profile_document(
    document: &ActorInteractionProfileDocument,
    actor_bindings: &[ActorModelBindingIdentity],
) -> Result<(), String> {
    if document.schema_version != PROFILE_SCHEMA_VERSION
        || document.profile_snapshot_version != PROFILE_SNAPSHOT_VERSION
        || document.runtime_refresh
        || document.source_binding_count != PROFILE_BINDING_COUNT
        || actor_bindings.len() != PROFILE_BINDING_COUNT
        || document.bindings.len() != actor_bindings.len()
    {
        return Err("actor interaction profile document identity is invalid".to_string());
    }
    if !document
        .provider_availability_semantics
        .contains("runtime_adapter_supported")
        || !document
            .provider_availability_semantics
            .contains("runtime policy gates")
    {
        return Err("actor interaction profile availability semantics are unsafe".to_string());
    }

    let mut actor_ids = BTreeSet::new();
    let mut model_ids = BTreeSet::new();
    let mut archived = BTreeSet::new();
    for (index, (binding, expected)) in document
        .bindings
        .iter()
        .zip(actor_bindings.iter())
        .enumerate()
    {
        if binding.actor_id != expected.actor_id
            || binding.requested_model_id != expected.requested_model_id
            || binding.route_model_id != expected.requested_model_id
            || binding.canonical_slug != expected.canonical_slug
            || document.catalog_snapshot_version != expected.catalog_snapshot_version
        {
            return Err(format!(
                "actor interaction profile row {index} changed its exact binding"
            ));
        }
        if !actor_ids.insert(binding.actor_id)
            || !model_ids.insert(binding.requested_model_id.as_str())
            || binding.profiles.is_empty()
        {
            return Err(format!(
                "actor interaction profile {} is duplicate or empty",
                binding.requested_model_id
            ));
        }
        if binding.availability == "archived" {
            archived.insert(binding.requested_model_id.as_str());
        } else if !matches!(binding.availability.as_str(), "active" | "unsupported") {
            return Err(format!(
                "actor interaction profile {} has invalid availability",
                binding.requested_model_id
            ));
        }

        let mut kinds = BTreeSet::new();
        for profile in &binding.profiles {
            if !kinds.insert(profile.kind)
                || profile.endpoint.as_deref() != profile.kind.expected_endpoint()
                || profile.provider_available != profile.disabled_reason.is_none()
                || profile.runtime_adapter_supported
                    != profile.runtime_adapter_unsupported_reason.is_none()
                || !profile.defaults.is_object()
            {
                return Err(format!(
                    "actor interaction profile {}/{} is contradictory",
                    binding.requested_model_id, profile.label
                ));
            }
            if profile.kind == ActorInteractionKind::CreateVideo
                && (profile.endpoint_zdr != Some(false) || !profile.asynchronous)
            {
                return Err(format!(
                    "actor interaction profile {} has an unsafe video contract",
                    binding.requested_model_id
                ));
            }
            if profile.kind == ActorInteractionKind::BatchTalk {
                let submitted_model = binding
                    .requested_model_id
                    .strip_suffix(":batch")
                    .unwrap_or_default();
                if submitted_model.is_empty()
                    || profile.endpoint_zdr != Some(false)
                    || !profile.asynchronous
                    || profile.streaming
                    || profile.defaults.get("endpoint").and_then(Value::as_str)
                        != Some("/v1/chat/completions")
                    || profile
                        .defaults
                        .get("submission_model_id")
                        .and_then(Value::as_str)
                        != Some(submitted_model)
                {
                    return Err(format!(
                        "actor interaction profile {} has an unsafe batch contract",
                        binding.requested_model_id
                    ));
                }
            }
            if profile.kind == ActorInteractionKind::Speak {
                let authoritative_voice = authoritative_tts_voice(&binding.requested_model_id);
                let pinned_voice_value = profile.defaults.get("voice");
                let pinned_voice = pinned_voice_value.and_then(Value::as_str);
                let exact_voice_contract = match authoritative_voice {
                    Some(voice) => pinned_voice == Some(voice),
                    None => pinned_voice_value.is_none(),
                };
                let expected_runtime_support =
                    profile.provider_available && authoritative_voice.is_some();
                let missing_voice_contract_is_disabled = authoritative_voice.is_some()
                    || (!profile.provider_available
                        && profile.disabled_reason.as_deref()
                            == Some(TTS_VOICE_UNAVAILABLE_REASON)
                        && profile.runtime_adapter_unsupported_reason.as_deref()
                            == Some(TTS_VOICE_UNAVAILABLE_REASON));
                if !exact_voice_contract
                    || profile
                        .defaults
                        .get("response_format")
                        .and_then(Value::as_str)
                        != Some("mp3")
                    || profile.runtime_adapter_supported != expected_runtime_support
                    || !missing_voice_contract_is_disabled
                {
                    return Err(format!(
                        "actor interaction profile {} differs from its authoritative speech contract",
                        binding.requested_model_id
                    ));
                }
            }
        }
    }

    let expected_archived = ARCHIVED_MODEL_IDS.into_iter().collect::<BTreeSet<_>>();
    if archived != expected_archived {
        return Err("actor interaction profile retired ids changed".to_string());
    }
    for binding in document
        .bindings
        .iter()
        .filter(|binding| binding.availability == "archived")
    {
        if binding
            .profiles
            .iter()
            .any(|profile| profile.provider_available)
        {
            return Err(format!(
                "archived actor interaction profile {} became available",
                binding.requested_model_id
            ));
        }
    }
    Ok(())
}

pub(super) fn pinned_actor_interaction_profiles(
) -> Result<&'static ActorInteractionProfileDocument, String> {
    Ok(&profile_registry()?.document)
}

pub(super) fn exact_actor_interaction_profile_for_actor(
    actor_id: u64,
    kind: ActorInteractionKind,
) -> Result<Option<ExactActorInteractionProfile<'static>>, String> {
    let registry = profile_registry()?;
    let Some(index) = registry.by_actor_id.get(&actor_id).copied() else {
        return Ok(None);
    };
    exact_profile_at(registry, index, kind)
}

pub(super) fn exact_actor_interaction_profile_for_model(
    requested_model_id: &str,
    kind: ActorInteractionKind,
) -> Result<Option<ExactActorInteractionProfile<'static>>, String> {
    let registry = profile_registry()?;
    let Some(index) = registry
        .by_requested_model_id
        .get(requested_model_id)
        .copied()
    else {
        return Ok(None);
    };
    exact_profile_at(registry, index, kind)
}

fn exact_profile_at(
    registry: &'static ActorInteractionProfileRegistry,
    index: usize,
    kind: ActorInteractionKind,
) -> Result<Option<ExactActorInteractionProfile<'static>>, String> {
    let binding = registry
        .document
        .bindings
        .get(index)
        .ok_or_else(|| "actor interaction profile index is corrupt".to_string())?;
    Ok(binding
        .profiles
        .iter()
        .find(|profile| profile.kind == kind)
        .map(|profile| ExactActorInteractionProfile { binding, profile }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_profiles_match_every_exact_actor_binding() {
        let document = pinned_actor_interaction_profiles().expect("valid profiles");
        let profiles = document
            .bindings
            .iter()
            .flat_map(|binding| binding.profiles.iter())
            .collect::<Vec<_>>();
        assert_eq!(document.bindings.len(), 500);
        assert_eq!(profiles.len(), 511);
        assert_eq!(
            profiles
                .iter()
                .filter(|profile| profile.provider_available)
                .count(),
            495
        );
        assert_eq!(
            profiles
                .iter()
                .filter(|profile| profile.runtime_adapter_supported)
                .count(),
            463
        );
        assert_eq!(
            profiles
                .iter()
                .filter(|profile| profile.ready_before_policy())
                .count(),
            453
        );
    }

    #[test]
    fn exact_queries_never_substitute_models_or_modalities() {
        let trinity = exact_actor_interaction_profile_for_model(
            "arcee-ai/trinity-large-thinking",
            ActorInteractionKind::Talk,
        )
        .expect("profile registry")
        .expect("Trinity Talk profile");
        assert_eq!(
            trinity.binding.requested_model_id,
            "arcee-ai/trinity-large-thinking"
        );
        assert_eq!(
            trinity.binding.route_model_id,
            trinity.binding.requested_model_id
        );
        assert_eq!(
            trinity.profile.endpoint.as_deref(),
            Some("/api/v1/chat/completions")
        );
        assert!(exact_actor_interaction_profile_for_actor(
            trinity.binding.actor_id,
            ActorInteractionKind::Illustrate,
        )
        .expect("profile registry")
        .is_none());
    }

    #[test]
    fn exact_batch_query_pins_the_provider_submission_model() {
        let exact = exact_actor_interaction_profile_for_model(
            "google/gemini-2.5-pro:batch",
            ActorInteractionKind::BatchTalk,
        )
        .expect("profile registry")
        .expect("Gemini batch profile");
        assert_eq!(exact.binding.route_model_id, "google/gemini-2.5-pro:batch");
        assert_eq!(
            exact
                .profile
                .defaults
                .get("submission_model_id")
                .and_then(Value::as_str),
            Some("google/gemini-2.5-pro")
        );
        assert!(exact.profile.ready_before_policy());
        assert!(exact.profile.asynchronous);
        assert_eq!(exact.profile.endpoint_zdr, Some(false));
    }

    #[test]
    fn vector_and_unimplemented_media_profiles_fail_the_adapter_gate() {
        let document = pinned_actor_interaction_profiles().expect("valid profiles");
        let vector_profiles = document
            .bindings
            .iter()
            .filter(|binding| {
                binding.requested_model_id.starts_with("recraft/recraft-v4")
                    && binding.requested_model_id.ends_with("vector")
            })
            .flat_map(|binding| binding.profiles.iter())
            .collect::<Vec<_>>();
        assert_eq!(vector_profiles.len(), 4);
        assert!(vector_profiles.iter().all(|profile| {
            profile.provider_available
                && !profile.runtime_adapter_supported
                && profile.runtime_adapter_unsupported_reason.as_deref()
                    == Some("safe_svg_rasterizer_not_implemented")
        }));
        assert!(document
            .bindings
            .iter()
            .flat_map(|binding| &binding.profiles)
            .all(|profile| profile.kind != ActorInteractionKind::CreateVideo
                || (profile.provider_available
                    && !profile.runtime_adapter_supported
                    && profile.endpoint_zdr == Some(false)
                    && profile.asynchronous)));
    }

    #[test]
    fn speech_profiles_pin_mp3_and_only_authoritative_voices() {
        let document = pinned_actor_interaction_profiles().expect("valid profiles");
        let speech = document
            .bindings
            .iter()
            .filter_map(|binding| {
                binding
                    .profiles
                    .iter()
                    .find(|profile| profile.kind == ActorInteractionKind::Speak)
                    .map(|profile| (binding, profile))
            })
            .collect::<Vec<_>>();
        assert_eq!(speech.len(), 19);
        assert_eq!(
            speech
                .iter()
                .filter(|(_, profile)| profile.provider_available)
                .count(),
            13
        );
        assert!(speech.iter().all(|(binding, profile)| {
            let authoritative_voice = authoritative_tts_voice(&binding.requested_model_id);
            let pinned_voice_value = profile.defaults.get("voice");
            let exact_voice_contract = match authoritative_voice {
                Some(voice) => pinned_voice_value.and_then(Value::as_str) == Some(voice),
                None => pinned_voice_value.is_none(),
            };
            exact_voice_contract
                && profile
                    .defaults
                    .get("response_format")
                    .and_then(Value::as_str)
                    == Some("mp3")
                && profile.runtime_adapter_supported
                    == (profile.provider_available && authoritative_voice.is_some())
                && (authoritative_voice.is_some()
                    || (!profile.provider_available
                        && profile.disabled_reason.as_deref()
                            == Some(TTS_VOICE_UNAVAILABLE_REASON)
                        && profile.runtime_adapter_unsupported_reason.as_deref()
                            == Some(TTS_VOICE_UNAVAILABLE_REASON)))
        }));
    }
}
