use super::*;
use sha2::{Digest, Sha256};
use std::fmt;

const MODEL_INTERACTION_SCHEMA_VERSION: u8 = 1;
const MODEL_INTERACTION_IMAGE_FEATURE: &str = "model_interaction_image";
const MODEL_INTERACTION_EMBEDDING_FEATURE: &str = "model_interaction_embeddings";
const MODEL_INTERACTION_RERANK_FEATURE: &str = "model_interaction_rerank";
const MODEL_INTERACTION_SPEECH_FEATURE: &str = "model_interaction_speech";
const MODEL_INTERACTION_SPEECH_TEXT_FEATURE: &str = "model_interaction_speech_text";
const MODEL_INTERACTION_BATCH_TALK_FEATURE: &str = "model_interaction_batch_talk";
const MODEL_INTERACTION_IMAGE_CONTEXT_VERSION: &str = "authoritative-scene-v1";
const MODEL_INTERACTION_SEMANTIC_CONTEXT_VERSION: &str = "authoritative-model-neighbors-v1";
const MODEL_INTERACTION_SPEECH_CONTEXT_VERSION: &str = "authoritative-world-speech-v2";
const MODEL_INTERACTION_SPEECH_TEXT_CONTEXT_VERSION: &str = "authoritative-world-speech-text-v1";
const MODEL_INTERACTION_BATCH_TALK_CONTEXT_VERSION: &str = "authoritative-world-echo-v1";
const MODEL_INTERACTION_SEMANTIC_CANDIDATES: usize = 8;
const MODEL_INTERACTION_SEMANTIC_RESULTS: usize = 3;
const MODEL_INTERACTION_MAX_PARTS: usize = 8;
const MODEL_INTERACTION_MAX_SUMMARY_CHARS: usize = 280;
pub(super) const MODEL_INTERACTION_BATCH_PENDING: &str = "model_interaction_batch_pending";
pub(super) const MODEL_INTERACTION_BATCH_POLL_DELAY_MS: u64 = 10_000;
const MODEL_INTERACTION_BATCH_RESPONSE_MAX_BYTES: usize = 2 * 1024 * 1024;
const MODEL_INTERACTION_BATCH_TEXT_MAX_CHARS: usize = 280;

static MODEL_INTERACTION_LOCKS: OnceLock<StdMutex<BTreeMap<String, Weak<Mutex<()>>>>> =
    OnceLock::new();

pub(super) fn init_model_interaction_batch_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS model_interaction_batches (
            interaction_id TEXT PRIMARY KEY,
            actor_id INTEGER NOT NULL,
            target_actor_id INTEGER NOT NULL,
            queue_event_seq INTEGER NOT NULL,
            requested_model_id TEXT NOT NULL,
            submission_model_id TEXT NOT NULL,
            custom_id TEXT NOT NULL UNIQUE,
            provider_batch_id TEXT UNIQUE,
            provider_status TEXT NOT NULL,
            result_digest TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_model_interaction_batches_provider
            ON model_interaction_batches(provider_batch_id, provider_status);",
    )
    .map_err(sqlite_error)
}

#[derive(Clone, Debug)]
pub(super) struct TransientOpenRouterKey {
    api_key: String,
    expires_at: Instant,
}

const TRANSIENT_OPENROUTER_KEY_TTL: Duration = Duration::from_secs(10 * 60);

fn store_transient_openrouter_key(state: &AppState, actor_id: u64, api_key: String) {
    let Ok(mut keys) = state.transient_openrouter_keys.lock() else {
        return;
    };
    let now = Instant::now();
    keys.retain(|_, key| key.expires_at > now);
    keys.insert(
        actor_id,
        TransientOpenRouterKey {
            api_key,
            expires_at: now + TRANSIENT_OPENROUTER_KEY_TTL,
        },
    );
}

fn transient_openrouter_config(
    state: &AppState,
    actor_id: u64,
    player_openrouter: bool,
) -> Option<(AiConfig, &'static str)> {
    let server_config = state.ai_config.as_ref().as_ref()?;
    if !player_openrouter {
        return Some((server_config.clone(), "server"));
    }
    let key = state
        .transient_openrouter_keys
        .lock()
        .ok()
        .and_then(|mut keys| {
            let now = Instant::now();
            keys.retain(|_, key| key.expires_at > now);
            keys.get(&actor_id).cloned()
        });
    key.map(|key| {
        (
            server_config.for_transient_openrouter(key.api_key),
            "player_openrouter",
        )
    })
}

fn clear_transient_openrouter_key(state: &AppState, actor_id: u64) {
    if let Ok(mut keys) = state.transient_openrouter_keys.lock() {
        keys.remove(&actor_id);
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ModelInteractionProfile {
    Image,
    Embeddings,
    Rerank,
    Speech,
    BatchTalk,
}

impl ModelInteractionProfile {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Image => "Illustrate",
            Self::Embeddings => "Find resonance",
            Self::Rerank => "Rank echoes",
            Self::Speech => "Speak",
            Self::BatchTalk => "Leave an echo",
        }
    }

    pub(super) fn intention(self) -> &'static str {
        match self {
            Self::Image => "illustrate",
            Self::Embeddings => "find_resonance",
            Self::Rerank => "rank_echoes",
            Self::Speech => "speak",
            Self::BatchTalk => "echo",
        }
    }

    fn interaction_kind(self) -> ActorInteractionKind {
        match self {
            Self::Image => ActorInteractionKind::Illustrate,
            Self::Embeddings => ActorInteractionKind::FindResonance,
            Self::Rerank => ActorInteractionKind::RankEchoes,
            Self::Speech => ActorInteractionKind::Speak,
            Self::BatchTalk => ActorInteractionKind::BatchTalk,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ModelInteractionCandidate {
    actor_id: u64,
    label: String,
    descriptor: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ModelInteractionPlan {
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
    target_name: String,
    location_name: String,
    location_description: String,
    profile: ModelInteractionProfile,
    #[serde(default)]
    requested_model_id: String,
    #[serde(default)]
    canonical_slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exact_voice: Option<String>,
    #[serde(default)]
    target_descriptor: String,
    #[serde(default)]
    semantic_candidates: Vec<ModelInteractionCandidate>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ModelInteractionJob {
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) plan: ModelInteractionPlan,
    #[serde(default)]
    pub(super) player_openrouter: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) queue_event_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_world_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) observed_through_seq: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ModelInteractionRequest {
    pub(super) actor_id: u64,
    pub(super) actor_session: Option<String>,
    pub(super) target_actor_id: u64,
    #[serde(default)]
    pub(super) openrouter_api_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ModelInteractionAttribution {
    provider: String,
    model: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "modality", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ModelInteractionOutputPart {
    Text {
        text: String,
    },
    Image {
        image: ResidentImagePublication,
    },
    Audio {
        asset_id: String,
        url: String,
        mime_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        description: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transcript: Option<String>,
        digest: String,
    },
    SemanticMatch {
        source: String,
        entity_kind: String,
        entity_id: String,
        label: String,
        relation: String,
        score_band: String,
    },
    Video {
        asset_id: String,
        url: String,
        mime_type: String,
        width: u32,
        height: u32,
        duration_ms: u64,
        description: String,
        digest: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ModelInteractionPublication {
    schema_version: u8,
    interaction_id: String,
    profile: ModelInteractionProfile,
    summary: String,
    output_parts: Vec<ModelInteractionOutputPart>,
    attribution: ModelInteractionAttribution,
    prompt_version: String,
    context_hash: String,
}

impl ModelInteractionPublication {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != MODEL_INTERACTION_SCHEMA_VERSION
            || !sha256_hex(&self.interaction_id)
            || !sha256_hex(&self.context_hash)
            || self.prompt_version.trim().is_empty()
            || self.prompt_version.chars().count() > 128
        {
            return Err("model interaction identity is invalid".to_string());
        }
        validate_bounded_text(
            &self.summary,
            MODEL_INTERACTION_MAX_SUMMARY_CHARS,
            "model interaction summary",
        )?;
        if self.output_parts.is_empty() || self.output_parts.len() > MODEL_INTERACTION_MAX_PARTS {
            return Err("model interaction output part count is invalid".to_string());
        }
        validate_bounded_text(
            &self.attribution.provider,
            128,
            "model interaction provider",
        )?;
        validate_bounded_text(&self.attribution.model, 256, "model interaction model")?;
        for part in &self.output_parts {
            part.validate()?;
        }
        let coherent = match self.profile {
            ModelInteractionProfile::Image => {
                self.output_parts.len() == 1
                    && matches!(&self.output_parts[0], ModelInteractionOutputPart::Image { .. })
            }
            ModelInteractionProfile::Embeddings => {
                self.output_parts.len() == MODEL_INTERACTION_SEMANTIC_RESULTS
                    && self.output_parts.iter().all(|part| {
                        matches!(part, ModelInteractionOutputPart::SemanticMatch { source, .. } if source == "embeddings")
                    })
            }
            ModelInteractionProfile::Rerank => {
                self.output_parts.len() == MODEL_INTERACTION_SEMANTIC_RESULTS
                    && self.output_parts.iter().all(|part| {
                        matches!(part, ModelInteractionOutputPart::SemanticMatch { source, .. } if source == "rerank")
                    })
            }
            ModelInteractionProfile::Speech => {
                self.output_parts.len() == 1
                    && matches!(
                        &self.output_parts[0],
                        ModelInteractionOutputPart::Audio {
                            transcript: Some(_),
                            ..
                        }
                    )
            }
            ModelInteractionProfile::BatchTalk => {
                self.output_parts.len() == 1
                    && matches!(&self.output_parts[0], ModelInteractionOutputPart::Text { .. })
            }
        };
        if !coherent {
            return Err("model interaction profile and output parts disagree".to_string());
        }
        Ok(())
    }
}

impl ModelInteractionOutputPart {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Text { text } => validate_bounded_text(text, 8_000, "model text output"),
            Self::Image { image } => image.validate(),
            Self::Audio {
                asset_id,
                url,
                mime_type,
                duration_ms,
                description,
                transcript,
                digest,
            } => {
                validate_media_identity(asset_id, url, digest)?;
                if asset_id != digest
                    || mime_type != "audio/mpeg"
                    || url != &format!("/assets/generated/model-audio/{digest}.mp3")
                    || duration_ms.is_some_and(|duration| duration == 0 || duration > 600_000)
                {
                    return Err("model audio output is invalid".to_string());
                }
                validate_bounded_text(description, 280, "model audio description")?;
                if let Some(transcript) = transcript {
                    validate_bounded_text(transcript, 280, "model audio transcript")?;
                }
                Ok(())
            }
            Self::SemanticMatch {
                source,
                entity_kind,
                entity_id,
                label,
                relation,
                score_band,
            } => {
                if !matches!(source.as_str(), "embeddings" | "rerank")
                    || !matches!(score_band.as_str(), "low" | "moderate" | "high")
                {
                    return Err("semantic match provenance is invalid".to_string());
                }
                for (value, maximum, label) in [
                    (entity_kind, 64, "semantic entity kind"),
                    (entity_id, 128, "semantic entity id"),
                    (label, 280, "semantic label"),
                    (relation, 280, "semantic relation"),
                ] {
                    validate_bounded_text(value, maximum, label)?;
                }
                Ok(())
            }
            Self::Video {
                asset_id,
                url,
                mime_type,
                width,
                height,
                duration_ms,
                description,
                digest,
            } => {
                validate_media_identity(asset_id, url, digest)?;
                if !matches!(mime_type.as_str(), "video/mp4" | "video/webm")
                    || *width == 0
                    || *height == 0
                    || *width > 4_096
                    || *height > 4_096
                    || *duration_ms == 0
                    || *duration_ms > 600_000
                {
                    return Err("model video output is invalid".to_string());
                }
                validate_bounded_text(description, 280, "model video description")
            }
        }
    }
}

fn validate_media_identity(asset_id: &str, url: &str, digest: &str) -> Result<(), String> {
    if !sha256_hex(asset_id)
        || !sha256_hex(digest)
        || !url.starts_with("/assets/generated/")
        || url.contains("..")
        || url.chars().any(char::is_control)
    {
        return Err("model media identity is invalid".to_string());
    }
    Ok(())
}

fn validate_bounded_text(value: &str, maximum: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.chars().count() > maximum
        || value.chars().any(char::is_control)
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(())
}

fn sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ModelInteractionProjection {
    Status {
        target_actor_id: u64,
        status: String,
        reason: String,
    },
    Output {
        target_actor_id: u64,
        publication: Box<ModelInteractionPublication>,
    },
}

impl RuntimeWorld {
    pub(super) fn default_model_interaction_target(&self, actor_id: u64) -> Option<CwActor> {
        self.active_chat_targets(actor_id)
            .into_iter()
            .find(|target| {
                self.model_interaction_plan_for(actor_id, target.id)
                    .is_some()
            })
    }

    pub(super) fn default_model_interaction_action_option(
        &self,
        actor_id: u64,
    ) -> Option<ActionOption> {
        let target = self.default_model_interaction_target(actor_id)?;
        let profile = supported_profile_for_actor(target.id)?;
        let target_name = self.actor_view(target).name;
        Some(ActionOption {
            kind: "model_interaction".to_string(),
            label: profile.label().to_string(),
            command: format!("{} {target_name}", profile.intention().replace('_', " ")),
        })
    }

    pub(super) fn model_interaction_offer_profile(
        &self,
        actor_id: u64,
    ) -> Option<ModelInteractionProfile> {
        self.default_model_interaction_target(actor_id)
            .and_then(|target| supported_profile_for_actor(target.id))
    }

    pub(super) fn model_interaction_profile_for(
        &self,
        actor_id: u64,
        target_actor_id: u64,
    ) -> Option<ModelInteractionProfile> {
        self.model_interaction_plan_for(actor_id, target_actor_id)
            .map(|plan| plan.profile)
    }

    pub(super) fn model_interaction_offer_label(&self, actor_id: u64) -> &'static str {
        self.model_interaction_offer_profile(actor_id)
            .map(ModelInteractionProfile::label)
            .unwrap_or("Interact")
    }

    pub(super) fn model_interaction_offer_effect(&self, actor_id: u64) -> Option<String> {
        let target = self.default_model_interaction_target(actor_id)?;
        let name = self.actor_name(target.id)?;
        Some(match supported_profile_for_actor(target.id)? {
            ModelInteractionProfile::Image => {
                format!("asks {name}'s exact image model to illustrate the current scene")
            }
            ModelInteractionProfile::Embeddings => format!(
                "asks {name}'s exact embedding model to find resonant neighboring model profiles"
            ),
            ModelInteractionProfile::Rerank => {
                format!("asks {name}'s exact rerank model to rank neighboring model echoes")
            }
            ModelInteractionProfile::Speech => {
                format!("asks {name}'s exact voice model to speak from authoritative world context")
            }
            ModelInteractionProfile::BatchTalk => {
                format!("leaves {name}'s exact batch model an echo that may return later")
            }
        })
    }

    fn model_interaction_plan_for(
        &self,
        actor_id: u64,
        target_actor_id: u64,
    ) -> Option<ModelInteractionPlan> {
        let actor = self.actor_by_id(actor_id)?;
        let target = self.actor_by_id(target_actor_id)?;
        if !Self::actor_can_act(actor)
            || !Self::actor_can_act(target)
            || target.location_id != actor.location_id
            || !self.actor_uses_inference(target_actor_id)
            || self.actors_blocked(actor_id, target_actor_id)
            || self.actor_muted(actor_id, target_actor_id)
            || !self.actor_visible_in_projection(target, Some(actor_id), None)
        {
            return None;
        }
        let profile = supported_profile_for_actor(target_actor_id)?;
        let binding = exact_ready_profile_binding(target_actor_id, profile)?;
        let location = self.location_meta_for(actor.location_id);
        let location_name = self
            .location_name(actor.location_id)
            .unwrap_or_else(|| "Unknown Location".to_string());
        let (target_descriptor, semantic_candidates) = if matches!(
            profile,
            ModelInteractionProfile::Embeddings | ModelInteractionProfile::Rerank
        ) {
            self.authoritative_semantic_context(target_actor_id)?
        } else {
            (String::new(), Vec::new())
        };
        let exact_voice = if profile == ModelInteractionProfile::Speech {
            Some(exact_speech_voice(target_actor_id)?.to_string())
        } else {
            None
        };
        Some(ModelInteractionPlan {
            actor_id,
            target_actor_id,
            location_id: actor.location_id,
            target_name: self
                .actor_name(target_actor_id)
                .unwrap_or_else(|| format!("Resident {target_actor_id}")),
            location_name,
            location_description: location.description,
            profile,
            requested_model_id: binding.requested_model_id.clone(),
            canonical_slug: binding.canonical_slug.clone(),
            exact_voice,
            target_descriptor,
            semantic_candidates,
        })
    }

    fn authoritative_semantic_context(
        &self,
        target_actor_id: u64,
    ) -> Option<(String, Vec<ModelInteractionCandidate>)> {
        let bindings = &active_content().actor_model_bindings;
        let target_index = bindings
            .iter()
            .position(|binding| binding.actor_id == target_actor_id)?;
        let target = &bindings[target_index];
        let target_location_id = self.actor_by_id(target_actor_id)?.location_id;
        let adjacent_locations = self.world.exits[..self.world.exit_count]
            .iter()
            .filter_map(|exit| {
                if exit.from_location_id == target_location_id {
                    Some(exit.to_location_id)
                } else if exit.to_location_id == target_location_id {
                    Some(exit.from_location_id)
                } else {
                    None
                }
            })
            .collect::<BTreeSet<_>>();
        let mut candidates = bindings
            .iter()
            .enumerate()
            .filter(|(_, binding)| binding.actor_id != target_actor_id)
            .collect::<Vec<_>>();
        candidates.sort_by_key(|(index, binding)| {
            let location = self
                .actor_by_id(binding.actor_id)
                .map(|actor| actor.location_id);
            let topology_rank = match location {
                Some(location_id) if adjacent_locations.contains(&location_id) => 0,
                Some(location_id) if location_id == target_location_id => 1,
                _ => 2,
            };
            (
                topology_rank,
                index.abs_diff(target_index),
                binding.actor_id,
                binding.requested_model_id.as_str(),
            )
        });
        let candidates = candidates
            .into_iter()
            .take(MODEL_INTERACTION_SEMANTIC_CANDIDATES)
            .map(|(_, binding)| ModelInteractionCandidate {
                actor_id: binding.actor_id,
                label: compact_whitespace(&binding.display_name),
                descriptor: authoritative_model_descriptor(binding),
            })
            .collect::<Vec<_>>();
        (candidates.len() >= 4).then(|| (authoritative_model_descriptor(target), candidates))
    }

    pub(super) fn apply_model_interaction_projection(
        &mut self,
        action: &CwAction,
        projection: &ModelInteractionProjection,
    ) -> Vec<EventView> {
        match projection {
            ModelInteractionProjection::Status {
                target_actor_id,
                status,
                reason,
            } if matches!(
                status.as_str(),
                "queued" | "generating" | "retrying" | "completed" | "failed"
            ) =>
            {
                vec![self.append_async_job_event(
                    &format!("model_interaction.{status}"),
                    action.actor_id,
                    Some(*target_actor_id),
                    Some(reason.clone()),
                )]
            }
            ModelInteractionProjection::Output {
                target_actor_id,
                publication,
            } if publication.validate().is_ok() => serde_json::to_string(publication)
                .ok()
                .map(|content| {
                    vec![self.append_async_job_event(
                        "model_interaction.output",
                        action.actor_id,
                        Some(*target_actor_id),
                        Some(content),
                    )]
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    }
}

fn supported_profile_for_actor(actor_id: u64) -> Option<ModelInteractionProfile> {
    let binding = active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| binding.actor_id == actor_id)?;
    supported_profile_for_binding(binding)
}

fn supported_profile_for_binding(
    binding: &SeedActorModelBinding,
) -> Option<ModelInteractionProfile> {
    [
        ModelInteractionProfile::Image,
        ModelInteractionProfile::Embeddings,
        ModelInteractionProfile::Rerank,
        ModelInteractionProfile::Speech,
        ModelInteractionProfile::BatchTalk,
    ]
    .into_iter()
    .find(|profile| binding_has_ready_profile(binding, *profile))
}

fn exact_ready_profile_binding(
    actor_id: u64,
    profile: ModelInteractionProfile,
) -> Option<&'static SeedActorModelBinding> {
    let binding = active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| binding.actor_id == actor_id)?;
    binding_has_ready_profile(binding, profile).then_some(binding)
}

fn exact_speech_voice(actor_id: u64) -> Option<&'static str> {
    if let Some(exact) =
        exact_actor_interaction_profile_for_actor(actor_id, ActorInteractionKind::VoiceChat)
            .ok()
            .flatten()
            .filter(|exact| exact.profile.ready_before_policy())
    {
        return (exact
            .profile
            .defaults
            .pointer("/audio/format")
            .and_then(serde_json::Value::as_str)
            == Some("mp3"))
        .then(|| {
            exact
                .profile
                .defaults
                .pointer("/audio/voice")
                .and_then(serde_json::Value::as_str)
        })
        .flatten();
    }
    let exact = exact_actor_interaction_profile_for_actor(actor_id, ActorInteractionKind::Speak)
        .ok()
        .flatten()
        .filter(|exact| exact.profile.ready_before_policy())?;
    (exact.profile.defaults.get("response_format")?.as_str()? == "mp3")
        .then(|| exact.profile.defaults.get("voice")?.as_str())
        .flatten()
}

fn frozen_ready_profile_binding(
    plan: &ModelInteractionPlan,
    expected_profile: ModelInteractionProfile,
) -> Result<&'static SeedActorModelBinding, String> {
    let binding = active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| binding.actor_id == plan.target_actor_id)
        .ok_or_else(|| "resident no longer has an exact ready model route".to_string())?;
    validate_frozen_route_against_binding(binding, plan, expected_profile)?;
    Ok(binding)
}

fn validate_frozen_route_against_binding(
    binding: &SeedActorModelBinding,
    plan: &ModelInteractionPlan,
    expected_profile: ModelInteractionProfile,
) -> Result<(), String> {
    if plan.profile != expected_profile
        || plan.requested_model_id.trim().is_empty()
        || plan.canonical_slug.trim().is_empty()
        || !binding_has_ready_profile(binding, expected_profile)
    {
        return Err("model interaction has no frozen exact route".to_string());
    }
    if binding.actor_id != plan.target_actor_id
        || binding.requested_model_id != plan.requested_model_id
        || binding.canonical_slug != plan.canonical_slug
    {
        return Err(
            "resident exact model route changed after the interaction was queued".to_string(),
        );
    }
    match expected_profile {
        ModelInteractionProfile::Speech
            if plan.exact_voice.as_deref() != exact_speech_voice(plan.target_actor_id) =>
        {
            Err("resident exact speech voice changed after the interaction was queued".to_string())
        }
        ModelInteractionProfile::Speech => Ok(()),
        _ if plan.exact_voice.is_some() => {
            Err("non-speech model interaction carried a speech voice".to_string())
        }
        _ => Ok(()),
    }
}

fn binding_has_ready_profile(
    binding: &SeedActorModelBinding,
    profile: ModelInteractionProfile,
) -> bool {
    let interaction_kind = if profile == ModelInteractionProfile::Speech
        && binding_supports_direct_audio_reply(binding)
    {
        ActorInteractionKind::VoiceChat
    } else {
        profile.interaction_kind()
    };
    let exact = exact_actor_interaction_profile_for_actor(binding.actor_id, interaction_kind)
        .ok()
        .flatten()
        .filter(|exact| exact.profile.ready_before_policy());
    let Some(exact) = exact else {
        return false;
    };
    if binding.requested_model_id != exact.binding.requested_model_id
        || binding.canonical_slug != exact.binding.canonical_slug
        || binding.requested_model_id != exact.binding.route_model_id
    {
        return false;
    }
    let pinned = match profile {
        ModelInteractionProfile::Image => {
            PinnedModelSelection::from_actor_image_binding(binding, DataPolicyMode::Development)
        }
        ModelInteractionProfile::Embeddings => {
            PinnedModelSelection::from_actor_embedding_binding(binding, DataPolicyMode::Development)
        }
        ModelInteractionProfile::Rerank => {
            PinnedModelSelection::from_actor_rerank_binding(binding, DataPolicyMode::Development)
        }
        ModelInteractionProfile::Speech => {
            if binding_supports_direct_audio_reply(binding) {
                PinnedModelSelection::from_actor_binding(binding, DataPolicyMode::Development)
            } else {
                PinnedModelSelection::from_actor_speech_synthesis_binding(
                    binding,
                    DataPolicyMode::Development,
                )
            }
        }
        ModelInteractionProfile::BatchTalk => {
            PinnedModelSelection::from_actor_binding(binding, DataPolicyMode::Development)
        }
    };
    pinned.is_ok()
}

fn binding_supports_direct_audio_reply(binding: &SeedActorModelBinding) -> bool {
    binding.speech_mode == "raw"
        && binding.input_modalities.iter().any(|value| value == "text")
        && binding
            .output_modalities
            .iter()
            .any(|value| value == "text")
        && binding
            .output_modalities
            .iter()
            .any(|value| value == "audio")
}

fn authoritative_model_descriptor(binding: &SeedActorModelBinding) -> String {
    format!(
        "Model: {name}. Exact id: {model}. Inputs: {inputs}. Outputs: {outputs}. Context tokens: {context}. Supported parameters: {parameters}.",
        name = compact_whitespace(&binding.display_name),
        model = compact_whitespace(&binding.requested_model_id),
        inputs = binding.input_modalities.join(", "),
        outputs = binding.output_modalities.join(", "),
        context = binding
            .context_length
            .map(|value| value.to_string())
            .unwrap_or_else(|| "not declared".to_string()),
        parameters = if binding.supported_parameters.is_empty() {
            "none declared".to_string()
        } else {
            binding.supported_parameters.join(", ")
        },
    )
}

pub(super) async fn model_interaction(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ModelInteractionRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "model-interaction-actor",
        CHAT_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }
    let interaction_lock = model_interaction_lock(&state, payload.actor_id);
    let _interaction_guard = interaction_lock.lock().await;
    {
        let runtime = state.inner.lock().await;
        if !client_actor_authorized_for_state(
            &runtime,
            &state,
            payload.actor_id,
            payload.actor_session.as_deref(),
        ) {
            return client_actor_rejected_response();
        }
    }
    let player_openrouter = payload
        .openrouter_api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(ToString::to_string);
    if player_openrouter.is_some()
        && supported_profile_for_actor(payload.target_actor_id)
            == Some(ModelInteractionProfile::BatchTalk)
    {
        return model_interaction_failure(
            payload.actor_id,
            payload.target_actor_id,
            400,
            "Delayed echoes require the durable world route; a temporary key was not stored.",
        );
    }
    if let Some(path) = state.event_store_path.as_deref() {
        match active_model_interaction_target(path, payload.actor_id) {
            Ok(Some(active_target)) if active_target == payload.target_actor_id => {
                return Json(ActionResponse {
                    ok: true,
                    status: CW_OK,
                    events: Vec::new(),
                });
            }
            Ok(Some(_)) => {
                return model_interaction_failure(
                    payload.actor_id,
                    payload.target_actor_id,
                    409,
                    "Let the current model interaction finish before starting another.",
                );
            }
            Err(error) => {
                warn!("could not inspect the durable model interaction queue: {error}");
                return model_interaction_failure(
                    payload.actor_id,
                    payload.target_actor_id,
                    503,
                    "The model interaction could not start safely; try again.",
                );
            }
            Ok(None) => {}
        }
    }
    if let Some(api_key) = player_openrouter.as_deref() {
        if let Err(error) = verify_openrouter_key(api_key).await {
            return model_interaction_failure(
                payload.actor_id,
                payload.target_actor_id,
                401,
                &error,
            );
        }
    }

    let mut runtime = state.inner.lock().await;
    let Some(plan) = runtime.model_interaction_plan_for(payload.actor_id, payload.target_actor_id)
    else {
        return model_interaction_failure(
            payload.actor_id,
            payload.target_actor_id,
            409,
            "That model interaction is no longer within reach.",
        );
    };
    if !model_interaction_route_is_configured(&state, &plan) {
        return model_interaction_failure(
            payload.actor_id,
            payload.target_actor_id,
            503,
            "That model route is resting right now. Choose another action; nothing was spent.",
        );
    }
    if let Some(api_key) = player_openrouter.as_deref() {
        store_transient_openrouter_key(&state, payload.actor_id, api_key.to_string());
    }
    let source_world_tick = runtime.world.tick;
    let observed_through_seq = runtime.world.next_event_seq.saturating_sub(1);
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: payload.actor_id,
            target_actor_id: payload.target_actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_system();
    record.offer_kind = Some("model_interaction".to_string());
    record.projection_mutations.push(model_interaction_status(
        payload.target_actor_id,
        "queued",
        "the resident's model is considering authoritative world context",
    ));
    record.queued_actor_job = Some(ActorJobPayload::ModelInteraction(ModelInteractionJob {
        actor_id: payload.actor_id,
        target_actor_id: payload.target_actor_id,
        plan: plan.clone(),
        player_openrouter: player_openrouter.is_some(),
        queue_event_id: None,
        source_world_tick: None,
        observed_through_seq: None,
    }));
    let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
        if player_openrouter.is_some() {
            clear_transient_openrouter_key(&state, payload.actor_id);
        }
        return model_interaction_failure(
            payload.actor_id,
            payload.target_actor_id,
            500,
            "The model interaction could not be saved; try again.",
        );
    };
    if status != CW_OK && player_openrouter.is_some() {
        clear_transient_openrouter_key(&state, payload.actor_id);
    }
    drop(runtime);
    broadcast_events(&state, &events);
    if status == CW_OK {
        let queue_event_id = events
            .iter()
            .find(|event| event.type_name == "model_interaction.queued" && event.success)
            .map(|event| event.seq);
        if state.event_store_path.is_some() {
            state.actor_job_notify.notify_waiters();
        } else {
            let interaction_state = state.clone();
            tokio::spawn(async move {
                let job = ModelInteractionJob {
                    actor_id: payload.actor_id,
                    target_actor_id: payload.target_actor_id,
                    plan,
                    player_openrouter: player_openrouter.is_some(),
                    queue_event_id,
                    source_world_tick: Some(source_world_tick),
                    observed_through_seq: Some(observed_through_seq),
                };
                if let Err(error) =
                    complete_model_interaction_attempt(&interaction_state, job, 1).await
                {
                    warn!("in-memory model interaction failed: {error}");
                }
            });
        }
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events,
    })
}

fn model_interaction_failure(
    actor_id: u64,
    target_actor_id: u64,
    status: u32,
    reason: &str,
) -> Json<ActionResponse> {
    Json(ActionResponse {
        ok: false,
        status,
        events: vec![EventView {
            type_name: "model_interaction.failed".to_string(),
            actor_id: Some(actor_id),
            target_actor_id: Some(target_actor_id),
            content: Some(reason.to_string()),
            ..EventView::default()
        }],
    })
}

fn model_interaction_lock(state: &AppState, actor_id: u64) -> Arc<Mutex<()>> {
    let key = format!("{:p}:{actor_id}", Arc::as_ptr(&state.inner));
    let mut locks = MODEL_INTERACTION_LOCKS
        .get_or_init(|| StdMutex::new(BTreeMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AiRouteAvailability {
    Ready,
    Retryable { retry_at_unix: Option<u64> },
    Permanent,
}

impl AiRouteAvailability {
    fn from_gate(gate: crate::ai_readiness::AiReadinessGate) -> Self {
        if gate.is_ready() {
            Self::Ready
        } else if gate.is_terminal_block() {
            Self::Permanent
        } else {
            debug_assert!(gate.is_retryable_block());
            Self::Retryable {
                retry_at_unix: gate.retry_at_unix(),
            }
        }
    }

    const fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }

    const fn is_permanent(self) -> bool {
        matches!(self, Self::Permanent)
    }

    fn and(self, other: Self) -> Self {
        match (self, other) {
            (Self::Permanent, _) | (_, Self::Permanent) => Self::Permanent,
            (Self::Ready, Self::Ready) => Self::Ready,
            (
                Self::Retryable {
                    retry_at_unix: left,
                },
                Self::Retryable {
                    retry_at_unix: right,
                },
            ) => Self::Retryable {
                retry_at_unix: match (left, right) {
                    (Some(left), Some(right)) => Some(left.max(right)),
                    _ => None,
                },
            },
            (Self::Retryable { retry_at_unix }, Self::Ready)
            | (Self::Ready, Self::Retryable { retry_at_unix }) => Self::Retryable { retry_at_unix },
        }
    }

    fn retry_floor_ms(self, config: &AiConfig) -> u64 {
        let Self::Retryable { retry_at_unix } = self else {
            return 0;
        };
        retry_at_unix
            .map(|retry_at_unix| {
                retry_at_unix
                    .saturating_mul(1_000)
                    .saturating_sub(now_millis())
                    .max(250)
            })
            .unwrap_or_else(|| {
                config
                    .recommended_readiness_probe_delay()
                    .as_millis()
                    .min(u64::MAX as u128) as u64
            })
    }
}

fn model_interaction_route_availability(
    config: Option<&AiConfig>,
    plan: &ModelInteractionPlan,
) -> AiRouteAvailability {
    if frozen_ready_profile_binding(plan, plan.profile).is_err() {
        return AiRouteAvailability::Permanent;
    }
    model_interaction_target_availability(config, plan.target_actor_id, Some(plan.profile))
}

fn model_interaction_route_is_configured(state: &AppState, plan: &ModelInteractionPlan) -> bool {
    if plan.profile == ModelInteractionProfile::BatchTalk && state.event_store_path.is_none() {
        return false;
    }
    model_interaction_route_availability(state.ai_config.as_ref().as_ref(), plan).is_ready()
}

fn model_interaction_target_is_configured(
    config: Option<&AiConfig>,
    target_actor_id: u64,
    expected_profile: Option<ModelInteractionProfile>,
) -> bool {
    model_interaction_target_availability(config, target_actor_id, expected_profile).is_ready()
}

fn model_interaction_target_availability(
    config: Option<&AiConfig>,
    target_actor_id: u64,
    expected_profile: Option<ModelInteractionProfile>,
) -> AiRouteAvailability {
    let Some(config) = config else {
        return AiRouteAvailability::Permanent;
    };
    let Some(profile) = supported_profile_for_actor(target_actor_id) else {
        return AiRouteAvailability::Permanent;
    };
    if expected_profile.is_some_and(|expected| expected != profile) {
        return AiRouteAvailability::Permanent;
    }
    let Some(binding) = exact_ready_profile_binding(target_actor_id, profile) else {
        return AiRouteAvailability::Permanent;
    };
    let (pinned, endpoint) = match profile {
        ModelInteractionProfile::Image => (config.pin_actor_image_model(binding).is_ok(), "images"),
        ModelInteractionProfile::Embeddings => (
            config.pin_actor_embedding_model(binding).is_ok(),
            "embeddings",
        ),
        ModelInteractionProfile::Rerank => {
            (config.pin_actor_rerank_model(binding).is_ok(), "rerank")
        }
        ModelInteractionProfile::Speech => (
            if binding_supports_direct_audio_reply(binding) {
                config.pin_actor_model(binding).is_ok()
            } else {
                config.pin_actor_speech_synthesis_model(binding).is_ok()
            },
            if binding_supports_direct_audio_reply(binding) {
                "chat/completions"
            } else {
                "audio/speech"
            },
        ),
        ModelInteractionProfile::BatchTalk => (
            config.pin_actor_model(binding).is_ok()
                && (ai_provider_name(Some(config)) == "openrouter"
                    || local_ai_base_url(&config.base_url)),
            "batches",
        ),
    };
    if !pinned {
        return AiRouteAvailability::Permanent;
    }
    AiRouteAvailability::from_gate(config.exact_route_gate(endpoint, &binding.requested_model_id))
}

pub(super) fn model_interaction_route_is_permanently_unavailable(
    config: Option<&AiConfig>,
    plan: &ModelInteractionPlan,
) -> bool {
    model_interaction_route_availability(config, plan).is_permanent()
}

pub(super) fn model_interaction_route_retry_floor_ms(
    config: Option<&AiConfig>,
    plan: &ModelInteractionPlan,
) -> u64 {
    let Some(config) = config else {
        return 0;
    };
    model_interaction_route_availability(Some(config), plan).retry_floor_ms(config)
}

pub(super) fn chat_target_route_is_configured(
    config: Option<&AiConfig>,
    target_actor_id: u64,
) -> bool {
    chat_target_route_availability(config, target_actor_id).is_ready()
}

fn chat_target_route_availability(
    config: Option<&AiConfig>,
    target_actor_id: u64,
) -> AiRouteAvailability {
    let Some(config) = config else {
        return AiRouteAvailability::Permanent;
    };
    let global = global_chat_route_availability(config);
    let binding = active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| binding.actor_id == target_actor_id);
    let Some(binding) = binding else {
        return global;
    };
    if !resident_supports_text_reply(target_actor_id) || config.pin_actor_model(binding).is_err() {
        return AiRouteAvailability::Permanent;
    }
    global.and(AiRouteAvailability::from_gate(
        config.exact_route_gate("chat/completions", &binding.requested_model_id),
    ))
}

fn global_chat_route_availability(config: &AiConfig) -> AiRouteAvailability {
    let Ok(selections) = config.pin_models(ModelCapability::Voice) else {
        return AiRouteAvailability::Permanent;
    };
    if selections.is_empty() {
        return AiRouteAvailability::Permanent;
    }
    let mut retryable: Option<Option<u64>> = None;
    for selection in selections {
        match AiRouteAvailability::from_gate(
            config.exact_route_gate("chat/completions", selection.requested_model_id()),
        ) {
            AiRouteAvailability::Ready => return AiRouteAvailability::Ready,
            AiRouteAvailability::Retryable { retry_at_unix } => {
                retryable = Some(match (retryable, retry_at_unix) {
                    (Some(Some(current)), Some(next)) => Some(current.min(next)),
                    (None, deadline) => deadline,
                    _ => None,
                });
            }
            AiRouteAvailability::Permanent => {}
        }
    }
    retryable
        .map(|retry_at_unix| AiRouteAvailability::Retryable { retry_at_unix })
        .unwrap_or(AiRouteAvailability::Permanent)
}

pub(super) fn chat_target_route_is_permanently_unavailable(
    config: Option<&AiConfig>,
    target_actor_id: u64,
) -> bool {
    chat_target_route_availability(config, target_actor_id).is_permanent()
}

pub(super) fn chat_target_route_retry_floor_ms(
    config: Option<&AiConfig>,
    target_actor_id: u64,
) -> u64 {
    let Some(config) = config else {
        return 0;
    };
    chat_target_route_availability(Some(config), target_actor_id).retry_floor_ms(config)
}

pub(super) fn retain_configured_model_interaction_offers(
    primary_action: &mut PrimaryAction,
    action_offers: &mut Vec<RankedActionOffer>,
    config: Option<&AiConfig>,
) {
    action_offers.retain(|offer| {
        let target_actor_id = offer.target.as_ref().and_then(|target| target.id);
        match offer.kind.as_str() {
            "model_interaction" => target_actor_id.is_some_and(|target_actor_id| {
                model_interaction_target_is_configured(config, target_actor_id, None)
            }),
            "chat" => target_actor_id.is_some_and(|target_actor_id| {
                chat_target_route_is_configured(config, target_actor_id)
            }),
            _ => true,
        }
    });
    let offered_kinds = action_offers
        .iter()
        .map(|offer| offer.kind.as_str())
        .collect::<BTreeSet<_>>();
    primary_action
        .options
        .retain(|option| offered_kinds.contains(option.kind.as_str()));
    let primary_offer_kind = if primary_action.kind == "travel" {
        "move"
    } else {
        primary_action.kind.as_str()
    };
    if offered_kinds.contains(primary_offer_kind) {
        return;
    }
    if let Some(offer) = action_offers.first() {
        primary_action.kind = if offer.kind == "move" {
            "travel".to_string()
        } else {
            offer.kind.clone()
        };
        primary_action.label = offer.verb.clone();
        primary_action.command = offer.command.clone();
        primary_action.disabled = offer.disabled;
    } else {
        *primary_action = PrimaryAction {
            kind: "wait".to_string(),
            label: "Wait".to_string(),
            command: "wait".to_string(),
            disabled: true,
            options: Vec::new(),
        };
    }
}

fn active_model_interaction_target(path: &Path, actor_id: u64) -> io::Result<Option<u64>> {
    let conn = open_event_store(path)?;
    let mut stmt = conn
        .prepare(
            "SELECT context_json FROM actor_jobs
             WHERE kind = ?1 AND actor_id = ?2 AND status IN ('pending', 'running')",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(
            params![ACTOR_JOB_KIND_MODEL_INTERACTION, actor_id as i64],
            |row| row.get::<_, String>(0),
        )
        .map_err(sqlite_error)?;
    for row in rows {
        let payload = row.map_err(sqlite_error)?;
        if let Ok(ActorJobPayload::ModelInteraction(job)) =
            serde_json::from_str::<ActorJobPayload>(&payload)
        {
            return Ok(Some(job.target_actor_id));
        }
    }
    Ok(None)
}

pub(super) fn insert_model_interaction_job(
    conn: &Connection,
    job: &ModelInteractionJob,
    source_tick: u64,
    queue_event_id: Option<u64>,
) -> io::Result<bool> {
    let mut job = job.clone();
    job.queue_event_id = queue_event_id.or(job.queue_event_id);
    job.source_world_tick = Some(source_tick);
    job.observed_through_seq = job.queue_event_id;
    let payload = ActorJobPayload::ModelInteraction(job.clone());
    let cause_event_seq = job.queue_event_id;
    insert_actor_job_payload(
        conn,
        ACTOR_JOB_KIND_MODEL_INTERACTION,
        job.actor_id,
        cause_event_seq,
        source_tick,
        cause_event_seq.unwrap_or(0),
        Some(job.plan.location_id),
        &format!(
            "model-interaction:{}:{}:{}",
            job.actor_id,
            job.target_actor_id,
            cause_event_seq.unwrap_or(0)
        ),
        &payload,
        0,
    )
}

pub(super) async fn complete_model_interaction_attempt(
    state: &AppState,
    job: ModelInteractionJob,
    attempt: u32,
) -> Result<(), String> {
    let interaction_id = model_interaction_id(&job);
    if model_interaction_output_committed(state, &job, &interaction_id).await? {
        clear_transient_openrouter_key(state, job.actor_id);
        commit_model_interaction_status(
            state,
            &job,
            "completed",
            "the model interaction is complete",
        )
        .await?;
        return Ok(());
    }
    commit_model_interaction_status(
        state,
        &job,
        "generating",
        "the resident's model is interpreting authoritative world context",
    )
    .await?;
    let execution = match execute_model_interaction_profile(state, &job, &interaction_id).await {
        Ok(Some(execution)) => execution,
        Ok(None) => {
            clear_transient_openrouter_key(state, job.actor_id);
            commit_model_interaction_status(
                state,
                &job,
                "failed",
                "the generated result did not pass publication review",
            )
            .await?;
            return Ok(());
        }
        Err(error) if error.local_terminal() => {
            clear_transient_openrouter_key(state, job.actor_id);
            commit_model_interaction_status(
                state,
                &job,
                "failed",
                "the delayed model interaction could not finish",
            )
            .await?;
            return Ok(());
        }
        Err(error) if error.provider_terminal() => {
            let gateway = error
                .gateway()
                .expect("provider-terminal errors keep their gateway evidence");
            warn!(
                event = "model_interaction_provider_failure",
                process_id = %state.deployment.process_id,
                interaction_id,
                queue_event_id = job.queue_event_id.unwrap_or(0),
                actor_attempt = attempt,
                actor_id = job.actor_id,
                target_actor_id = job.target_actor_id,
                profile = job.plan.profile.intention(),
                requested_model_id = job.plan.requested_model_id,
                error_code = gateway.code(),
                http_status = gateway.provider_http_status().unwrap_or(0),
                gateway_attempts = gateway.attempts,
                latency_ms = gateway.latency.as_millis() as u64,
                retry_after_secs = gateway
                    .retry_after()
                    .map(|value| value.as_secs())
                    .unwrap_or(0),
                retry_at_unix = gateway.retry_at_unix().unwrap_or(0),
                disposition = "terminal",
                "exact model interaction provider failure"
            );
            clear_transient_openrouter_key(state, job.actor_id);
            commit_model_interaction_status(
                state,
                &job,
                "failed",
                "the model interaction could not finish",
            )
            .await?;
            return Ok(());
        }
        Err(error) => {
            let retryable_provider = error.provider_retryable();
            let route_retry_floor_ms = if retryable_provider {
                model_interaction_route_retry_floor_ms(state.ai_config.as_ref().as_ref(), &job.plan)
            } else {
                0
            };
            let terminal =
                model_interaction_attempt_is_terminal(&error, attempt, route_retry_floor_ms);
            if retryable_provider {
                let gateway = error
                    .gateway()
                    .expect("provider-retryable errors keep their gateway evidence");
                warn!(
                    event = "model_interaction_provider_failure",
                    process_id = %state.deployment.process_id,
                    interaction_id,
                    queue_event_id = job.queue_event_id.unwrap_or(0),
                    actor_attempt = attempt,
                    actor_id = job.actor_id,
                    target_actor_id = job.target_actor_id,
                    profile = job.plan.profile.intention(),
                    requested_model_id = job.plan.requested_model_id,
                    error_code = gateway.code(),
                    http_status = gateway.provider_http_status().unwrap_or(0),
                    gateway_attempts = gateway.attempts,
                    latency_ms = gateway.latency.as_millis() as u64,
                    retry_after_secs = gateway
                        .retry_after()
                        .map(|value| value.as_secs())
                        .unwrap_or(0),
                    retry_at_unix = gateway.retry_at_unix().unwrap_or(0),
                    retry_floor_ms = route_retry_floor_ms,
                    disposition = if terminal { "terminal_attempt_budget" } else { "retryable" },
                    "transient exact model interaction provider failure"
                );
            }
            if terminal {
                clear_transient_openrouter_key(state, job.actor_id);
            }
            commit_model_interaction_status(
                state,
                &job,
                if terminal { "failed" } else { "retrying" },
                if terminal {
                    "the model interaction could not finish"
                } else {
                    "the model interaction will retry"
                },
            )
            .await?;
            return Err(error.to_string());
        }
    };
    let events = commit_model_interaction_output(state, &job, execution.publication).await?;
    let output_event_id = events
        .iter()
        .find(|event| event.type_name == "model_interaction.output")
        .map(|event| event.seq);
    if let Some(image) = execution.image {
        image.record_published(state, output_event_id);
    }
    for usage in execution.usages {
        usage.record_published(state, output_event_id);
    }
    clear_transient_openrouter_key(state, job.actor_id);
    commit_model_interaction_status(
        state,
        &job,
        "completed",
        "the model interaction is complete",
    )
    .await
}

#[derive(Debug)]
enum ModelInteractionAttemptError {
    Gateway(AiGatewayError),
    Local(String),
    Terminal(String),
    Pending,
}

impl ModelInteractionAttemptError {
    fn from_gateway(error: AiGatewayError) -> Self {
        Self::Gateway(error)
    }

    fn provider_terminal(&self) -> bool {
        matches!(self, Self::Gateway(error) if error.terminal_for_model_interaction())
    }

    fn provider_retryable(&self) -> bool {
        matches!(self, Self::Gateway(error) if error.retryable_for_model_interaction())
    }

    fn local_terminal(&self) -> bool {
        matches!(self, Self::Terminal(_))
    }

    fn gateway(&self) -> Option<&AiGatewayError> {
        match self {
            Self::Gateway(error) => Some(error),
            Self::Local(_) | Self::Terminal(_) | Self::Pending => None,
        }
    }

    fn pending(&self) -> bool {
        matches!(self, Self::Pending)
    }
}

impl From<String> for ModelInteractionAttemptError {
    fn from(error: String) -> Self {
        Self::Local(error)
    }
}

impl fmt::Display for ModelInteractionAttemptError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Gateway(error) => write!(
                formatter,
                "exact model route unavailable (code={}, http_status={}, attempts={}, latency_ms={})",
                error.code(),
                error.provider_http_status().unwrap_or(0),
                error.attempts,
                error.latency.as_millis()
            ),
            Self::Local(error) => formatter.write_str(error),
            Self::Terminal(error) => formatter.write_str(error),
            Self::Pending => formatter.write_str(MODEL_INTERACTION_BATCH_PENDING),
        }
    }
}

fn model_interaction_attempt_is_terminal(
    error: &ModelInteractionAttemptError,
    attempt: u32,
    route_retry_floor_ms: u64,
) -> bool {
    !error.pending()
        && attempt >= ACTOR_JOB_MAX_ATTEMPTS
        && (!error.provider_retryable() || route_retry_floor_ms == 0)
}

pub(super) fn model_interaction_batch_poll_pending(
    interaction: &ModelInteractionJob,
    error: &str,
) -> bool {
    interaction.plan.profile == ModelInteractionProfile::BatchTalk
        && error == MODEL_INTERACTION_BATCH_PENDING
}

struct ExecutedModelInteraction {
    publication: ModelInteractionPublication,
    image: Option<GeneratedResidentImage>,
    usages: Vec<ModelInteractionUsage>,
}

struct ModelInteractionUsage {
    feature: &'static str,
    actor_id: u64,
    provider: String,
    model: String,
    latency: Duration,
    payer_mode: &'static str,
}

impl ModelInteractionUsage {
    fn record_published(&self, state: &AppState, source_event_id: Option<u64>) {
        record_ai_usage_for_provider(
            state,
            Some(self.actor_id),
            self.feature,
            self.payer_mode,
            &self.provider,
            &self.model,
            "published",
            source_event_id,
            0,
            None,
            self.latency,
        );
    }
}

async fn execute_model_interaction_profile(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    if job.actor_id != job.plan.actor_id || job.target_actor_id != job.plan.target_actor_id {
        return Err("model interaction durable identity changed"
            .to_string()
            .into());
    }
    match job.plan.profile {
        ModelInteractionProfile::Image => {
            execute_image_model_interaction(state, job, interaction_id).await
        }
        ModelInteractionProfile::Embeddings => {
            execute_embedding_model_interaction(state, job, interaction_id).await
        }
        ModelInteractionProfile::Rerank => {
            execute_rerank_model_interaction(state, job, interaction_id).await
        }
        ModelInteractionProfile::Speech => {
            execute_speech_model_interaction(state, job, interaction_id).await
        }
        ModelInteractionProfile::BatchTalk => {
            execute_batch_talk_model_interaction(state, job, interaction_id).await
        }
    }
}

#[derive(Clone, Debug)]
struct BatchTalkState {
    provider_batch_id: Option<String>,
    provider_status: String,
    submission_model_id: String,
}

fn batch_talk_submission_model(job: &ModelInteractionJob) -> Result<String, String> {
    frozen_ready_profile_binding(&job.plan, ModelInteractionProfile::BatchTalk)?;
    let exact = exact_actor_interaction_profile_for_actor(
        job.target_actor_id,
        ActorInteractionKind::BatchTalk,
    )
    .map_err(|error| format!("batch profile registry is unavailable: {error}"))?
    .ok_or_else(|| "batch interaction lost its exact profile".to_string())?;
    let submission_model_id = exact
        .profile
        .defaults
        .get("submission_model_id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if exact.binding.requested_model_id != job.plan.requested_model_id
        || exact.binding.canonical_slug != job.plan.canonical_slug
        || job.plan.requested_model_id.strip_suffix(":batch") != Some(submission_model_id)
        || submission_model_id.is_empty()
    {
        return Err("batch interaction changed its pinned submission model".to_string());
    }
    Ok(submission_model_id.to_string())
}

fn batch_talk_context_hash(plan: &ModelInteractionPlan) -> String {
    let mut hasher = Sha256::new();
    for component in [
        MODEL_INTERACTION_BATCH_TALK_FEATURE.as_bytes(),
        MODEL_INTERACTION_BATCH_TALK_CONTEXT_VERSION.as_bytes(),
        plan.target_name.as_bytes(),
        plan.location_name.as_bytes(),
        plan.location_description.as_bytes(),
        plan.requested_model_id.as_bytes(),
        plan.canonical_slug.as_bytes(),
    ] {
        hasher.update(component.len().to_be_bytes());
        hasher.update(component);
    }
    format!("{:x}", hasher.finalize())
}

fn batch_talk_messages(plan: &ModelInteractionPlan) -> (String, String) {
    let system = "Return one brief line of in-world dialogue as the named resident. This is a delayed echo tied to an earlier world moment. Return only the spoken words: no label, quotation marks, markdown, stage direction, tool call, or explanation. Use only the supplied authoritative setting and stay under 240 characters.".to_string();
    let user = format!(
        "Resident: {name}\nOrigin location: {location}\nAuthoritative setting at submission: {description}\nLet one fitting echo return from that moment.",
        name = compact_whitespace(&plan.target_name),
        location = compact_whitespace(&plan.location_name),
        description = compact_whitespace(&plan.location_description),
    );
    (system, user)
}

fn openrouter_batch_collection_url(config: &AiConfig) -> Result<String, String> {
    let base = config.base_url.trim_end_matches('/');
    if let Some(prefix) = base.strip_suffix("/api/v1") {
        return Ok(format!("{prefix}/api/beta/batches"));
    }
    if let Some(prefix) = base.strip_suffix("/v1") {
        return Ok(format!("{prefix}/beta/batches"));
    }
    Err("batch interactions require an OpenRouter-compatible /api/v1 base URL".to_string())
}

fn valid_provider_batch_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn load_or_create_batch_talk_state(
    path: &Path,
    job: &ModelInteractionJob,
    interaction_id: &str,
    submission_model_id: &str,
) -> Result<BatchTalkState, String> {
    let conn = open_event_store(path).map_err(|error| error.to_string())?;
    let now = now_millis() as i64;
    conn.execute(
        "INSERT OR IGNORE INTO model_interaction_batches
            (interaction_id, actor_id, target_actor_id, queue_event_seq,
             requested_model_id, submission_model_id, custom_id, provider_status,
             created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?1, 'submitting', ?7, ?7)",
        params![
            interaction_id,
            job.actor_id as i64,
            job.target_actor_id as i64,
            job.queue_event_id.unwrap_or(0) as i64,
            job.plan.requested_model_id,
            submission_model_id,
            now,
        ],
    )
    .map_err(|error| sqlite_error(error).to_string())?;
    let row = conn
        .query_row(
            "SELECT actor_id, target_actor_id, queue_event_seq, requested_model_id,
                    submission_model_id, custom_id, provider_batch_id, provider_status
             FROM model_interaction_batches WHERE interaction_id = ?1",
            [interaction_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .map_err(|error| sqlite_error(error).to_string())?;
    if row.0 != job.actor_id as i64
        || row.1 != job.target_actor_id as i64
        || row.2 != job.queue_event_id.unwrap_or(0) as i64
        || row.3 != job.plan.requested_model_id
        || row.4 != submission_model_id
        || row.5 != interaction_id
        || row
            .6
            .as_deref()
            .is_some_and(|id| !valid_provider_batch_id(id))
    {
        return Err("durable batch interaction identity changed".to_string());
    }
    Ok(BatchTalkState {
        provider_batch_id: row.6,
        provider_status: row.7,
        submission_model_id: row.4,
    })
}

fn persist_batch_talk_state(
    path: &Path,
    interaction_id: &str,
    provider_batch_id: &str,
    provider_status: &str,
    result_digest: Option<&str>,
) -> Result<(), String> {
    if !valid_provider_batch_id(provider_batch_id)
        || provider_status.is_empty()
        || provider_status.len() > 64
        || result_digest.is_some_and(|digest| !sha256_hex(digest))
    {
        return Err("provider batch state is invalid".to_string());
    }
    let conn = open_event_store(path).map_err(|error| error.to_string())?;
    let updated = conn
        .execute(
            "UPDATE model_interaction_batches
             SET provider_batch_id = ?2, provider_status = ?3, result_digest = ?4,
                 updated_at_ms = ?5
             WHERE interaction_id = ?1
               AND (provider_batch_id IS NULL OR provider_batch_id = ?2)",
            params![
                interaction_id,
                provider_batch_id,
                provider_status,
                result_digest,
                now_millis() as i64,
            ],
        )
        .map_err(|error| sqlite_error(error).to_string())?;
    if updated != 1 {
        return Err("provider batch id changed after submission".to_string());
    }
    Ok(())
}

fn batch_object(value: &serde_json::Value) -> &serde_json::Value {
    value
        .get("data")
        .filter(|data| data.is_object())
        .unwrap_or(value)
}

fn batch_status(value: &serde_json::Value) -> Option<&str> {
    batch_object(value)
        .get("status")
        .and_then(serde_json::Value::as_str)
}

async fn bounded_batch_json(
    response: reqwest::Response,
) -> Result<serde_json::Value, ModelInteractionAttemptError> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MODEL_INTERACTION_BATCH_RESPONSE_MAX_BYTES as u64)
    {
        return Err(ModelInteractionAttemptError::Terminal(
            "provider batch response exceeded its byte limit".to_string(),
        ));
    }
    let bytes = response.bytes().await.map_err(|error| {
        ModelInteractionAttemptError::Local(format!(
            "provider batch response could not be read: {error}"
        ))
    })?;
    if bytes.len() > MODEL_INTERACTION_BATCH_RESPONSE_MAX_BYTES {
        return Err(ModelInteractionAttemptError::Terminal(
            "provider batch response exceeded its byte limit".to_string(),
        ));
    }
    let value = serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|error| {
        ModelInteractionAttemptError::Local(format!(
            "provider batch response was not valid JSON: {error}"
        ))
    })?;
    if status.is_success() {
        return Ok(value);
    }
    let detail = value
        .pointer("/error/message")
        .and_then(serde_json::Value::as_str)
        .map(|message| trim_to_chars(message, 200))
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
    if status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error() {
        Err(ModelInteractionAttemptError::Local(format!(
            "provider batch request will retry: {detail}"
        )))
    } else {
        Err(ModelInteractionAttemptError::Terminal(format!(
            "provider rejected the batch request: {detail}"
        )))
    }
}

fn readable_batch_message_content(message: &serde_json::Value) -> Option<String> {
    if let Some(text) = message.get("content").and_then(serde_json::Value::as_str) {
        return Some(text.to_string());
    }
    let parts = message.get("content")?.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    (!text.trim().is_empty()).then_some(text)
}

fn completed_batch_talk_publication(
    job: &ModelInteractionJob,
    interaction_id: &str,
    submission_model_id: &str,
    batch: &serde_json::Value,
) -> Result<(ModelInteractionPublication, String), ModelInteractionAttemptError> {
    let batch = batch_object(batch);
    let results = batch
        .get("results")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            ModelInteractionAttemptError::Local(
                "completed provider batch did not include results".to_string(),
            )
        })?;
    let matches = results
        .iter()
        .filter(|result| {
            result.get("custom_id").and_then(serde_json::Value::as_str) == Some(interaction_id)
        })
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(ModelInteractionAttemptError::Terminal(
            "completed provider batch did not contain one exact custom id".to_string(),
        ));
    }
    let result = matches[0];
    if result.get("error").is_some_and(|error| !error.is_null()) {
        return Err(ModelInteractionAttemptError::Terminal(
            "the provider batch request failed".to_string(),
        ));
    }
    let response = result.get("response").ok_or_else(|| {
        ModelInteractionAttemptError::Terminal("provider batch result had no response".to_string())
    })?;
    let status_code = response
        .get("status_code")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            ModelInteractionAttemptError::Terminal(
                "provider batch result had no response status".to_string(),
            )
        })?;
    if status_code != 200 {
        return Err(ModelInteractionAttemptError::Terminal(format!(
            "provider batch item failed with HTTP {status_code}"
        )));
    }
    let body = response.get("body").unwrap_or(response);
    let choices = body
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            ModelInteractionAttemptError::Terminal(
                "provider batch result had no completion choices".to_string(),
            )
        })?;
    if choices.len() != 1 {
        return Err(ModelInteractionAttemptError::Terminal(
            "provider batch result did not contain exactly one completion choice".to_string(),
        ));
    }
    let choice = &choices[0];
    if choice
        .get("finish_reason")
        .and_then(serde_json::Value::as_str)
        != Some("stop")
    {
        return Err(ModelInteractionAttemptError::Terminal(
            "provider batch result was incomplete".to_string(),
        ));
    }
    let message = choice.get("message").ok_or_else(|| {
        ModelInteractionAttemptError::Terminal("provider batch result had no message".to_string())
    })?;
    let raw_text = readable_batch_message_content(message).ok_or_else(|| {
        ModelInteractionAttemptError::Terminal(
            "provider batch result had no publishable text".to_string(),
        )
    })?;
    if raw_text
        .chars()
        .any(|character| character.is_control() && !character.is_whitespace())
    {
        return Err(ModelInteractionAttemptError::Terminal(
            "provider batch result contained unsafe control text".to_string(),
        ));
    }
    let text = compact_whitespace(&raw_text);
    validate_bounded_text(
        &text,
        MODEL_INTERACTION_BATCH_TEXT_MAX_CHARS,
        "batch echo text",
    )
    .map_err(ModelInteractionAttemptError::Terminal)?;
    let resolved_model = body
        .get("model")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            ModelInteractionAttemptError::Terminal(
                "provider batch result had no model attribution".to_string(),
            )
        })?;
    if ![
        submission_model_id,
        job.plan.requested_model_id.as_str(),
        job.plan.canonical_slug.as_str(),
    ]
    .contains(&resolved_model)
    {
        return Err(ModelInteractionAttemptError::Terminal(
            "provider batch result changed its exact model route".to_string(),
        ));
    }
    let result_bytes = serde_json::to_vec(result).map_err(|error| {
        ModelInteractionAttemptError::Local(format!(
            "provider batch result could not be hashed: {error}"
        ))
    })?;
    let result_digest = format!("{:x}", Sha256::digest(result_bytes));
    let publication = ModelInteractionPublication {
        schema_version: MODEL_INTERACTION_SCHEMA_VERSION,
        interaction_id: interaction_id.to_string(),
        profile: ModelInteractionProfile::BatchTalk,
        summary: bounded_authoritative_speech(
            &format!(
                "{}'s delayed echo returned to {}.",
                authoritative_speech_fragment(&job.plan.target_name),
                authoritative_speech_fragment(&job.plan.location_name)
            ),
            MODEL_INTERACTION_MAX_SUMMARY_CHARS,
        ),
        output_parts: vec![ModelInteractionOutputPart::Text { text }],
        attribution: ModelInteractionAttribution {
            provider: "openrouter".to_string(),
            model: job.plan.requested_model_id.clone(),
        },
        prompt_version: MODEL_INTERACTION_BATCH_TALK_CONTEXT_VERSION.to_string(),
        context_hash: batch_talk_context_hash(&job.plan),
    };
    publication
        .validate()
        .map_err(ModelInteractionAttemptError::Terminal)?;
    Ok((publication, result_digest))
}

async fn execute_batch_talk_model_interaction(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    let submission_model_id = batch_talk_submission_model(job)?;
    execute_batch_talk_with_submission_model(state, job, interaction_id, &submission_model_id).await
}

async fn execute_batch_talk_with_submission_model(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
    submission_model_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    if job.player_openrouter {
        return Err(ModelInteractionAttemptError::Terminal(
            "batch interactions cannot use transient credentials".to_string(),
        ));
    }
    let path = state.event_store_path.as_deref().ok_or_else(|| {
        ModelInteractionAttemptError::Terminal(
            "batch interactions require durable storage".to_string(),
        )
    })?;
    let config = state.ai_config.as_ref().as_ref().ok_or_else(|| {
        ModelInteractionAttemptError::Terminal(
            "batch interactions require a configured provider".to_string(),
        )
    })?;
    if ai_provider_name(Some(config)) != "openrouter" && !local_ai_base_url(&config.base_url) {
        return Err(ModelInteractionAttemptError::Terminal(
            "batch interactions require OpenRouter".to_string(),
        ));
    }
    let mut durable =
        load_or_create_batch_talk_state(path, job, interaction_id, submission_model_id)?;
    let collection_url = openrouter_batch_collection_url(config)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| {
            ModelInteractionAttemptError::Local(format!(
                "provider batch client setup failed: {error}"
            ))
        })?;
    let started_at = Instant::now();
    let batch_json = if let Some(provider_batch_id) = durable.provider_batch_id.as_deref() {
        let response = client
            .get(format!("{collection_url}/{provider_batch_id}"))
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", "https://cosy.world/")
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .send()
            .await
            .map_err(|error| {
                ModelInteractionAttemptError::Local(format!("provider batch poll failed: {error}"))
            })?;
        bounded_batch_json(response).await?
    } else {
        let _server_spend_guard =
            enforce_server_paid_daily_limit(config, MODEL_INTERACTION_BATCH_TALK_FEATURE)
                .await
                .map_err(ModelInteractionAttemptError::from_gateway)?;
        let (system, user) = batch_talk_messages(&job.plan);
        let payload = serde_json::json!({
            "endpoint": "/v1/chat/completions",
            "model": submission_model_id,
            "requests": [{
                "custom_id": interaction_id,
                "body": {
                    "model": submission_model_id,
                    "messages": [
                        { "role": "system", "content": system },
                        { "role": "user", "content": user }
                    ],
                    "max_tokens": 96
                }
            }]
        });
        let response = client
            .post(&collection_url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", "https://cosy.world/")
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .header("Idempotency-Key", interaction_id)
            .json(&payload)
            .send()
            .await
            .map_err(|error| {
                ModelInteractionAttemptError::Local(format!(
                    "provider batch submission failed: {error}"
                ))
            })?;
        bounded_batch_json(response).await?
    };
    let provider_batch_id = batch_object(&batch_json)
        .get("id")
        .and_then(serde_json::Value::as_str)
        .or(durable.provider_batch_id.as_deref())
        .filter(|id| valid_provider_batch_id(id))
        .ok_or_else(|| {
            ModelInteractionAttemptError::Terminal(
                "provider batch response had no valid id".to_string(),
            )
        })?
        .to_string();
    let provider_status = batch_status(&batch_json).ok_or_else(|| {
        ModelInteractionAttemptError::Local("provider batch response had no status".to_string())
    })?;
    durable.provider_batch_id = Some(provider_batch_id.clone());
    durable.provider_status = provider_status.to_string();
    persist_batch_talk_state(
        path,
        interaction_id,
        &provider_batch_id,
        provider_status,
        None,
    )?;
    match provider_status {
        "validating" | "in_progress" | "finalizing" | "cancelling" => {
            Err(ModelInteractionAttemptError::Pending)
        }
        "completed" => {
            let (publication, result_digest) = completed_batch_talk_publication(
                job,
                interaction_id,
                &durable.submission_model_id,
                &batch_json,
            )?;
            persist_batch_talk_state(
                path,
                interaction_id,
                &provider_batch_id,
                provider_status,
                Some(&result_digest),
            )?;
            Ok(Some(ExecutedModelInteraction {
                publication,
                image: None,
                usages: vec![ModelInteractionUsage {
                    feature: MODEL_INTERACTION_BATCH_TALK_FEATURE,
                    actor_id: job.target_actor_id,
                    provider: "openrouter".to_string(),
                    model: job.plan.requested_model_id.clone(),
                    latency: started_at.elapsed(),
                    payer_mode: "server",
                }],
            }))
        }
        "failed" | "cancelled" | "expired" => Err(ModelInteractionAttemptError::Terminal(format!(
            "provider batch ended with status {provider_status}"
        ))),
        _ => Err(ModelInteractionAttemptError::Local(format!(
            "provider batch returned unknown status {provider_status}"
        ))),
    }
}

async fn execute_image_model_interaction(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    let binding = frozen_ready_profile_binding(&job.plan, ModelInteractionProfile::Image)?;
    let (config, payer_mode) =
        transient_openrouter_config(state, job.actor_id, job.player_openrouter).ok_or_else(
            || {
                ModelInteractionAttemptError::from_gateway(AiGatewayError::unconfigured(
                    MODEL_INTERACTION_IMAGE_FEATURE,
                ))
            },
        )?;
    config
        .pin_actor_image_model(binding)
        .map_err(|error| error.to_string())?;
    let image = generate_moderated_resident_image(
        state,
        Some(&config),
        payer_mode,
        binding,
        job.target_actor_id,
        interaction_id,
        &authoritative_image_prompt(&job.plan),
        &format!(
            "{} illustrates the current scene in {}.",
            compact_whitespace(&job.plan.target_name),
            compact_whitespace(&job.plan.location_name)
        ),
        MODEL_INTERACTION_IMAGE_FEATURE,
    )
    .await
    .map_err(|message| {
        let gate = config.exact_route_gate("images", &binding.requested_model_id);
        if gate.is_ready() {
            ModelInteractionAttemptError::Local(message)
        } else {
            let error = AiGatewayError::readiness(MODEL_INTERACTION_IMAGE_FEATURE, gate);
            record_model_interaction_failure(
                state,
                job.target_actor_id,
                binding,
                MODEL_INTERACTION_IMAGE_FEATURE,
                &error,
            );
            ModelInteractionAttemptError::from_gateway(error)
        }
    })?;
    let Some(image) = image else {
        return Ok(None);
    };
    let publication = ModelInteractionPublication {
        schema_version: MODEL_INTERACTION_SCHEMA_VERSION,
        interaction_id: interaction_id.to_string(),
        profile: job.plan.profile,
        summary: image.publication.alt.clone(),
        output_parts: vec![ModelInteractionOutputPart::Image {
            image: image.publication.clone(),
        }],
        attribution: ModelInteractionAttribution {
            provider: image.publication.provider.clone(),
            model: image.publication.model.clone(),
        },
        prompt_version: image.publication.prompt_version.clone(),
        context_hash: image.publication.context_hash.clone(),
    };
    publication.validate()?;
    Ok(Some(ExecutedModelInteraction {
        publication,
        image: Some(image),
        usages: Vec::new(),
    }))
}

async fn execute_embedding_model_interaction(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    let binding = frozen_ready_profile_binding(&job.plan, ModelInteractionProfile::Embeddings)?;
    validate_semantic_plan(&job.plan)?;
    let (config, payer_mode) =
        transient_openrouter_config(state, job.actor_id, job.player_openrouter).ok_or_else(
            || {
                ModelInteractionAttemptError::from_gateway(AiGatewayError::unconfigured(
                    MODEL_INTERACTION_EMBEDDING_FEATURE,
                ))
            },
        )?;
    config
        .pin_actor_embedding_model(binding)
        .map_err(|error| error.to_string())?;
    let inputs = std::iter::once(job.plan.target_descriptor.clone())
        .chain(
            job.plan
                .semantic_candidates
                .iter()
                .map(|candidate| candidate.descriptor.clone()),
        )
        .collect::<Vec<_>>();
    let embedded = request_embeddings_with_binding(
        &config,
        binding,
        EmbeddingRequest {
            feature: MODEL_INTERACTION_EMBEDDING_FEATURE,
            prompt_version: MODEL_INTERACTION_SEMANTIC_CONTEXT_VERSION,
            inputs: &inputs,
            timeout: Duration::from_secs(45),
            max_attempts: 2,
            referer: "https://cosy.world/",
        },
    )
    .await
    .map_err(|error| {
        record_model_interaction_failure(
            state,
            job.target_actor_id,
            binding,
            MODEL_INTERACTION_EMBEDDING_FEATURE,
            &error,
        );
        ModelInteractionAttemptError::from_gateway(error)
    })?;
    let ranked = rank_embedding_candidates(&embedded.vectors, &job.plan.semantic_candidates)?;
    let publication = semantic_publication(
        &job.plan,
        interaction_id,
        "embeddings",
        ranked,
        &embedded.model_attribution,
        &embedded.prompt_version,
        &embedded.context_hash,
    )?;
    Ok(Some(ExecutedModelInteraction {
        publication,
        image: None,
        usages: vec![ModelInteractionUsage {
            feature: MODEL_INTERACTION_EMBEDDING_FEATURE,
            actor_id: job.target_actor_id,
            provider: embedded.model_attribution.provider,
            model: embedded.model_attribution.resolved_model_id,
            latency: embedded.latency,
            payer_mode,
        }],
    }))
}

async fn execute_rerank_model_interaction(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    let binding = frozen_ready_profile_binding(&job.plan, ModelInteractionProfile::Rerank)?;
    validate_semantic_plan(&job.plan)?;
    let (config, payer_mode) =
        transient_openrouter_config(state, job.actor_id, job.player_openrouter).ok_or_else(
            || {
                ModelInteractionAttemptError::from_gateway(AiGatewayError::unconfigured(
                    MODEL_INTERACTION_RERANK_FEATURE,
                ))
            },
        )?;
    config
        .pin_actor_rerank_model(binding)
        .map_err(|error| error.to_string())?;
    let documents = job
        .plan
        .semantic_candidates
        .iter()
        .map(|candidate| candidate.descriptor.clone())
        .collect::<Vec<_>>();
    let reranked = request_rerank_with_binding(
        &config,
        binding,
        RerankRequest {
            feature: MODEL_INTERACTION_RERANK_FEATURE,
            prompt_version: MODEL_INTERACTION_SEMANTIC_CONTEXT_VERSION,
            query: &job.plan.target_descriptor,
            documents: &documents,
            timeout: Duration::from_secs(45),
            max_attempts: 2,
            referer: "https://cosy.world/",
        },
    )
    .await
    .map_err(|error| {
        record_model_interaction_failure(
            state,
            job.target_actor_id,
            binding,
            MODEL_INTERACTION_RERANK_FEATURE,
            &error,
        );
        ModelInteractionAttemptError::from_gateway(error)
    })?;
    let ranked = reranked
        .scores
        .iter()
        .take(MODEL_INTERACTION_SEMANTIC_RESULTS)
        .map(|score| (score.index, score.relevance_score))
        .collect::<Vec<_>>();
    let publication = semantic_publication(
        &job.plan,
        interaction_id,
        "rerank",
        ranked,
        &reranked.model_attribution,
        &reranked.prompt_version,
        &reranked.context_hash,
    )?;
    Ok(Some(ExecutedModelInteraction {
        publication,
        image: None,
        usages: vec![ModelInteractionUsage {
            feature: MODEL_INTERACTION_RERANK_FEATURE,
            actor_id: job.target_actor_id,
            provider: reranked.model_attribution.provider,
            model: reranked.model_attribution.resolved_model_id,
            latency: reranked.latency,
            payer_mode,
        }],
    }))
}

async fn execute_speech_model_interaction(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    let binding = frozen_ready_profile_binding(&job.plan, ModelInteractionProfile::Speech)?;
    let voice = job
        .plan
        .exact_voice
        .as_deref()
        .ok_or_else(|| "speech interaction has no frozen exact voice".to_string())?;
    let (config, payer_mode) =
        transient_openrouter_config(state, job.actor_id, job.player_openrouter).ok_or_else(
            || {
                ModelInteractionAttemptError::from_gateway(AiGatewayError::unconfigured(
                    MODEL_INTERACTION_SPEECH_FEATURE,
                ))
            },
        )?;
    if binding_supports_direct_audio_reply(binding) {
        return execute_direct_audio_model_interaction(
            state,
            job,
            interaction_id,
            binding,
            &config,
            payer_mode,
            voice,
        )
        .await;
    }
    let selection = config
        .pin_actor_speech_synthesis_model(binding)
        .map_err(|error| error.to_string())?;
    let attribution = selection
        .attribute_response(None)
        .map_err(|error| error.to_string())?;
    let recovered = load_generated_model_audio_for_interaction(
        interaction_id,
        state.generated_asset_dir.as_path(),
    )?;
    let persisted_transcript = load_generated_model_audio_transcript_for_interaction(
        interaction_id,
        state.generated_asset_dir.as_path(),
    )?;
    let (authored_transcript, transcript_usage) = if let Some(transcript) = persisted_transcript {
        (transcript, None)
    } else if recovered.is_some() {
        // Audio receipts created before model-authored TTS text used the
        // deterministic authoritative line. Keep that recovery path coherent.
        (authoritative_speech_text(&job.plan), None)
    } else {
        let (transcript, usage) =
            generate_tts_transcript(state, &config, payer_mode, job.target_actor_id, &job.plan)
                .await?;
        (transcript, Some(usage))
    };
    let transcript = store_generated_model_audio_transcript_for_interaction(
        interaction_id,
        &authored_transcript,
        state.generated_asset_dir.as_path(),
    )?;
    validate_bounded_text(&transcript, 280, "authoritative speech text")?;
    let context_hash = speech_context_hash(voice, &transcript);
    let (asset, synthesis_usage) = if let Some(asset) = recovered {
        (asset, None)
    } else {
        let synthesized = request_speech_synthesis_with_binding(
            &config,
            binding,
            SpeechSynthesisRequest {
                feature: MODEL_INTERACTION_SPEECH_FEATURE,
                prompt_version: MODEL_INTERACTION_SPEECH_CONTEXT_VERSION,
                text: &transcript,
                voice,
                timeout: Duration::from_secs(45),
                max_attempts: 2,
                referer: "https://cosy.world/",
            },
        )
        .await
        .map_err(|error| {
            record_model_interaction_failure(
                state,
                job.target_actor_id,
                binding,
                MODEL_INTERACTION_SPEECH_FEATURE,
                &error,
            );
            ModelInteractionAttemptError::from_gateway(error)
        })?;
        if synthesized.content_type != "audio/mpeg"
            || synthesized.prompt_version != MODEL_INTERACTION_SPEECH_CONTEXT_VERSION
            || synthesized.context_hash != context_hash
            || synthesized.model_attribution != attribution
        {
            return Err("speech synthesis response changed its exact route contract"
                .to_string()
                .into());
        }
        let asset = store_generated_model_audio_for_interaction(
            interaction_id,
            &synthesized.bytes,
            state.generated_asset_dir.as_path(),
        )?;
        let usage = ModelInteractionUsage {
            feature: MODEL_INTERACTION_SPEECH_FEATURE,
            actor_id: job.target_actor_id,
            provider: attribution.provider.clone(),
            model: attribution.resolved_model_id.clone(),
            latency: synthesized.latency,
            payer_mode,
        };
        (asset, Some(usage))
    };
    let summary = format!(
        "{} spoke one authoritative line about {}.",
        authoritative_speech_fragment(&job.plan.target_name),
        authoritative_speech_fragment(&job.plan.location_name)
    );
    let publication = ModelInteractionPublication {
        schema_version: MODEL_INTERACTION_SCHEMA_VERSION,
        interaction_id: interaction_id.to_string(),
        profile: job.plan.profile,
        summary: bounded_authoritative_speech(&summary, MODEL_INTERACTION_MAX_SUMMARY_CHARS),
        output_parts: vec![ModelInteractionOutputPart::Audio {
            asset_id: asset.asset_id,
            url: asset.url,
            mime_type: asset.mime_type,
            duration_ms: None,
            description: bounded_authoritative_speech(
                &format!(
                    "{} speaks from {}.",
                    authoritative_speech_fragment(&job.plan.target_name),
                    authoritative_speech_fragment(&job.plan.location_name)
                ),
                280,
            ),
            transcript: Some(transcript),
            digest: asset.digest,
        }],
        attribution: ModelInteractionAttribution {
            provider: attribution.provider,
            model: attribution.resolved_model_id,
        },
        prompt_version: MODEL_INTERACTION_SPEECH_CONTEXT_VERSION.to_string(),
        context_hash,
    };
    publication.validate()?;
    let mut usages = transcript_usage.into_iter().collect::<Vec<_>>();
    usages.extend(synthesis_usage);
    Ok(Some(ExecutedModelInteraction {
        publication,
        image: None,
        usages,
    }))
}

#[allow(clippy::too_many_arguments)]
async fn execute_direct_audio_model_interaction(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
    binding: &SeedActorModelBinding,
    config: &AiConfig,
    payer_mode: &'static str,
    voice: &str,
) -> Result<Option<ExecutedModelInteraction>, ModelInteractionAttemptError> {
    let selection = config
        .pin_actor_model(binding)
        .map_err(|error| error.to_string())?;
    let attribution = selection
        .attribute_response(None)
        .map_err(|error| error.to_string())?;
    let recovered = load_generated_model_audio_for_interaction(
        interaction_id,
        state.generated_asset_dir.as_path(),
    )?;
    let persisted_transcript = load_generated_model_audio_transcript_for_interaction(
        interaction_id,
        state.generated_asset_dir.as_path(),
    )?;
    let (asset, transcript, usage) = match (recovered, persisted_transcript) {
        (Some(asset), Some(transcript)) => (asset, transcript, None),
        (Some(_), None) => {
            return Err("direct audio receipt was missing its transcript"
                .to_string()
                .into());
        }
        (None, persisted_transcript) => {
            let system = if persisted_transcript.is_some() {
                "Respond directly in audio as the named resident. Say the supplied recovery line exactly, with no added words."
            } else {
                "Respond directly in audio as the named resident. Speak one brief, natural in-world line with no preamble, label, stage direction, or explanation."
            };
            let recovery = persisted_transcript
                .as_deref()
                .map(|transcript| format!("\nRecovery line to say exactly: {transcript}"))
                .unwrap_or_default();
            let user = format!(
                "Resident: {name}\nLocation: {location}\nAuthoritative setting: {description}{recovery}",
                name = compact_whitespace(&job.plan.target_name),
                location = compact_whitespace(&job.plan.location_name),
                description = compact_whitespace(&job.plan.location_description),
            );
            let direct = request_direct_audio_completion_with_binding(
                config,
                binding,
                DirectAudioCompletionRequest {
                    feature: MODEL_INTERACTION_SPEECH_FEATURE,
                    prompt_version: MODEL_INTERACTION_SPEECH_CONTEXT_VERSION,
                    system,
                    user: &user,
                    voice,
                    timeout: Duration::from_secs(60),
                    max_attempts: 2,
                    referer: "https://cosy.world/",
                    room_id: Some(job.plan.location_id),
                },
            )
            .await
            .map_err(|error| {
                record_model_interaction_failure(
                    state,
                    job.target_actor_id,
                    binding,
                    MODEL_INTERACTION_SPEECH_FEATURE,
                    &error,
                );
                ModelInteractionAttemptError::from_gateway(error)
            })?;
            if direct.content_type != "audio/mpeg"
                || direct.prompt_version != MODEL_INTERACTION_SPEECH_CONTEXT_VERSION
                || direct.model_attribution != attribution
            {
                return Err("direct speech response changed its exact route contract"
                    .to_string()
                    .into());
            }
            let direct_transcript = bounded_authoritative_speech(&direct.transcript, 280);
            if persisted_transcript.as_deref().is_some_and(|persisted| {
                compact_whitespace(persisted) != compact_whitespace(&direct_transcript)
            }) {
                return Err("direct speech recovery did not preserve its transcript"
                    .to_string()
                    .into());
            }
            let transcript = store_generated_model_audio_transcript_for_interaction(
                interaction_id,
                &direct_transcript,
                state.generated_asset_dir.as_path(),
            )?;
            let asset = store_generated_model_audio_for_interaction(
                interaction_id,
                &direct.bytes,
                state.generated_asset_dir.as_path(),
            )?;
            let usage = ModelInteractionUsage {
                feature: MODEL_INTERACTION_SPEECH_FEATURE,
                actor_id: job.target_actor_id,
                provider: direct.model_attribution.provider,
                model: direct.model_attribution.resolved_model_id,
                latency: direct.latency,
                payer_mode,
            };
            (asset, transcript, Some(usage))
        }
    };
    validate_bounded_text(&transcript, 280, "direct speech transcript")?;
    let context_hash = speech_context_hash(voice, &transcript);
    let summary = format!(
        "{} spoke one direct model response in {}.",
        authoritative_speech_fragment(&job.plan.target_name),
        authoritative_speech_fragment(&job.plan.location_name)
    );
    let publication = ModelInteractionPublication {
        schema_version: MODEL_INTERACTION_SCHEMA_VERSION,
        interaction_id: interaction_id.to_string(),
        profile: job.plan.profile,
        summary: bounded_authoritative_speech(&summary, MODEL_INTERACTION_MAX_SUMMARY_CHARS),
        output_parts: vec![ModelInteractionOutputPart::Audio {
            asset_id: asset.asset_id,
            url: asset.url,
            mime_type: asset.mime_type,
            duration_ms: None,
            description: bounded_authoritative_speech(
                &format!(
                    "{} responds directly from {}.",
                    authoritative_speech_fragment(&job.plan.target_name),
                    authoritative_speech_fragment(&job.plan.location_name)
                ),
                280,
            ),
            transcript: Some(transcript),
            digest: asset.digest,
        }],
        attribution: ModelInteractionAttribution {
            provider: attribution.provider,
            model: attribution.resolved_model_id,
        },
        prompt_version: MODEL_INTERACTION_SPEECH_CONTEXT_VERSION.to_string(),
        context_hash,
    };
    publication.validate()?;
    Ok(Some(ExecutedModelInteraction {
        publication,
        image: None,
        usages: usage.into_iter().collect(),
    }))
}

async fn generate_tts_transcript(
    state: &AppState,
    config: &AiConfig,
    payer_mode: &'static str,
    actor_id: u64,
    plan: &ModelInteractionPlan,
) -> Result<(String, ModelInteractionUsage), ModelInteractionAttemptError> {
    let system = "Write one brief line of in-world dialogue for the named resident. Return only the words they should speak: no speaker label, quotation marks, stage direction, markdown, or explanation. Stay within the supplied setting and keep the line under 240 characters.";
    let user = format!(
        "Resident: {name}\nLocation: {location}\nAuthoritative setting: {description}\nSpeak naturally from this moment.",
        name = compact_whitespace(&plan.target_name),
        location = compact_whitespace(&plan.location_name),
        description = compact_whitespace(&plan.location_description),
    );
    let completion = request_routed_chat_completion(
        config,
        OPENROUTER_FREE_MODEL,
        ChatCompletionRequest {
            feature: MODEL_INTERACTION_SPEECH_TEXT_FEATURE,
            prompt_version: MODEL_INTERACTION_SPEECH_TEXT_CONTEXT_VERSION,
            capability: ModelCapability::Voice,
            system,
            user: &user,
            temperature: 0.7,
            max_tokens: 96,
            timeout: Duration::from_secs(30),
            max_attempts: 2,
            referer: "https://cosy.world/",
            response_format: None,
            room_id: Some(plan.location_id),
        },
    )
    .await
    .map_err(|error| {
        record_ai_usage_for_provider(
            state,
            Some(actor_id),
            MODEL_INTERACTION_SPEECH_TEXT_FEATURE,
            payer_mode,
            "openrouter",
            OPENROUTER_FREE_MODEL,
            "failed",
            None,
            0,
            Some(error.code()),
            error.latency,
        );
        ModelInteractionAttemptError::from_gateway(error)
    })?;
    if completion.finish_reason == "length" {
        return Err("speech text router returned an incomplete line"
            .to_string()
            .into());
    }
    let transcript = bounded_authoritative_speech(
        completion
            .text
            .trim()
            .trim_matches(['\"', '\'', '“', '”', '‘', '’']),
        280,
    );
    validate_bounded_text(&transcript, 280, "model-authored speech text")?;
    Ok((
        transcript,
        ModelInteractionUsage {
            feature: MODEL_INTERACTION_SPEECH_TEXT_FEATURE,
            actor_id,
            provider: "openrouter".to_string(),
            model: completion.resolved_model_id,
            latency: completion.latency,
            payer_mode,
        },
    ))
}

fn validate_semantic_plan(plan: &ModelInteractionPlan) -> Result<(), String> {
    if plan.target_descriptor.trim().is_empty()
        || !(4..=MODEL_INTERACTION_SEMANTIC_CANDIDATES).contains(&plan.semantic_candidates.len())
    {
        return Err("semantic model interaction context is incomplete".to_string());
    }
    let mut actor_ids = BTreeSet::new();
    for candidate in &plan.semantic_candidates {
        if !actor_ids.insert(candidate.actor_id)
            || candidate.actor_id == plan.target_actor_id
            || candidate.descriptor.trim().is_empty()
        {
            return Err("semantic model interaction candidates are invalid".to_string());
        }
        validate_bounded_text(&candidate.label, 280, "semantic candidate label")?;
    }
    Ok(())
}

fn rank_embedding_candidates(
    vectors: &[Vec<f32>],
    candidates: &[ModelInteractionCandidate],
) -> Result<Vec<(usize, f64)>, String> {
    if vectors.len() != candidates.len() + 1 {
        return Err("embedding result did not match the frozen candidate set".to_string());
    }
    let query = &vectors[0];
    let mut ranked = vectors[1..]
        .iter()
        .enumerate()
        .map(|(index, vector)| cosine_similarity(query, vector).map(|score| (index, score)))
        .collect::<Result<Vec<_>, _>>()?;
    ranked.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.truncate(MODEL_INTERACTION_SEMANTIC_RESULTS);
    Ok(ranked)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> Result<f64, String> {
    if left.is_empty() || left.len() != right.len() {
        return Err("embedding dimensions did not match".to_string());
    }
    let (dot, left_norm, right_norm) = left.iter().zip(right).try_fold(
        (0.0_f64, 0.0_f64, 0.0_f64),
        |(dot, left_norm, right_norm), (left, right)| {
            let left = f64::from(*left);
            let right = f64::from(*right);
            if !left.is_finite() || !right.is_finite() {
                return Err("embedding contained a non-finite value".to_string());
            }
            Ok((
                dot + left * right,
                left_norm + left * left,
                right_norm + right * right,
            ))
        },
    )?;
    if left_norm <= f64::EPSILON || right_norm <= f64::EPSILON {
        return Err("embedding contained a zero-length vector".to_string());
    }
    let score = dot / (left_norm.sqrt() * right_norm.sqrt());
    score
        .is_finite()
        .then_some(score.clamp(-1.0, 1.0))
        .ok_or_else(|| "embedding cosine score was not finite".to_string())
}

fn semantic_publication(
    plan: &ModelInteractionPlan,
    interaction_id: &str,
    source: &str,
    ranked: Vec<(usize, f64)>,
    attribution: &ModelAttribution,
    prompt_version: &str,
    context_hash: &str,
) -> Result<ModelInteractionPublication, String> {
    if ranked.len() != MODEL_INTERACTION_SEMANTIC_RESULTS {
        return Err("semantic model interaction did not produce three matches".to_string());
    }
    let relation = match source {
        "embeddings" => "resonates with this neighboring model descriptor",
        "rerank" => "was ranked as a neighboring model echo",
        _ => return Err("semantic model interaction source is invalid".to_string()),
    };
    let output_parts = ranked
        .into_iter()
        .map(|(index, score)| {
            let candidate = plan
                .semantic_candidates
                .get(index)
                .ok_or_else(|| "semantic result referenced an unknown candidate".to_string())?;
            Ok(ModelInteractionOutputPart::SemanticMatch {
                source: source.to_string(),
                entity_kind: "actor_model".to_string(),
                entity_id: candidate.actor_id.to_string(),
                label: candidate.label.clone(),
                relation: relation.to_string(),
                score_band: semantic_score_band(score).to_string(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let summary = match source {
        "embeddings" => format!(
            "{} found three resonant neighboring model profiles.",
            compact_whitespace(&plan.target_name)
        ),
        "rerank" => format!(
            "{} ranked three neighboring model echoes.",
            compact_whitespace(&plan.target_name)
        ),
        _ => unreachable!(),
    };
    let publication = ModelInteractionPublication {
        schema_version: MODEL_INTERACTION_SCHEMA_VERSION,
        interaction_id: interaction_id.to_string(),
        profile: plan.profile,
        summary,
        output_parts,
        attribution: ModelInteractionAttribution {
            provider: attribution.provider.clone(),
            model: attribution.resolved_model_id.clone(),
        },
        prompt_version: prompt_version.to_string(),
        context_hash: context_hash.to_string(),
    };
    publication.validate()?;
    Ok(publication)
}

fn semantic_score_band(score: f64) -> &'static str {
    if score >= 0.75 {
        "high"
    } else if score >= 0.4 {
        "moderate"
    } else {
        "low"
    }
}

fn record_model_interaction_failure(
    state: &AppState,
    actor_id: u64,
    binding: &SeedActorModelBinding,
    feature: &'static str,
    error: &AiGatewayError,
) {
    record_ai_usage_for_provider(
        state,
        Some(actor_id),
        feature,
        "server",
        &binding.provider,
        &binding.requested_model_id,
        "failed",
        None,
        0,
        Some(error.code()),
        error.latency,
    );
}

fn authoritative_image_prompt(plan: &ModelInteractionPlan) -> String {
    format!(
        "Create one image as {resident}, a resident of {location}. Interpret the current authoritative world scene, using only the setting below.\n\nSetting: {description}\n\nShow one coherent, inviting in-world scene through composition, expression, action, light, and objects. Do not render an application interface, chat bubbles, a frame, a watermark, a logo, model names, captions, or system instructions.",
        resident = compact_whitespace(&plan.target_name),
        location = compact_whitespace(&plan.location_name),
        description = compact_whitespace(&plan.location_description),
    )
}

fn authoritative_speech_text(plan: &ModelInteractionPlan) -> String {
    bounded_authoritative_speech(
        &format!(
            "I am {}. From {}, I notice: {}",
            authoritative_speech_fragment(&plan.target_name),
            authoritative_speech_fragment(&plan.location_name),
            authoritative_speech_fragment(&plan.location_description),
        ),
        280,
    )
}

fn authoritative_speech_fragment(value: &str) -> String {
    compact_whitespace(
        &value
            .chars()
            .map(|character| {
                if character.is_control() {
                    ' '
                } else {
                    character
                }
            })
            .collect::<String>(),
    )
}

fn bounded_authoritative_speech(value: &str, maximum: usize) -> String {
    let value = authoritative_speech_fragment(value);
    if value.chars().count() <= maximum {
        return value;
    }
    let mut shortened = value
        .chars()
        .take(maximum.saturating_sub(1))
        .collect::<String>();
    while shortened
        .chars()
        .last()
        .is_some_and(|character| !character.is_whitespace())
    {
        shortened.pop();
    }
    let shortened = shortened.trim_end();
    let prefix = if shortened.is_empty() {
        value.chars().take(maximum.saturating_sub(1)).collect()
    } else {
        shortened.to_string()
    };
    format!("{prefix}…")
}

fn speech_context_hash(voice: &str, transcript: &str) -> String {
    let mut hasher = Sha256::new();
    for component in [
        MODEL_INTERACTION_SPEECH_FEATURE.as_bytes(),
        MODEL_INTERACTION_SPEECH_CONTEXT_VERSION.as_bytes(),
        voice.as_bytes(),
        transcript.as_bytes(),
    ] {
        hasher.update(component.len().to_be_bytes());
        hasher.update(component);
    }
    format!("{:x}", hasher.finalize())
}

fn model_interaction_id(job: &ModelInteractionJob) -> String {
    let mut hasher = Sha256::new();
    hasher.update(match job.plan.profile {
        ModelInteractionProfile::Image => MODEL_INTERACTION_IMAGE_CONTEXT_VERSION.as_bytes(),
        ModelInteractionProfile::Embeddings | ModelInteractionProfile::Rerank => {
            MODEL_INTERACTION_SEMANTIC_CONTEXT_VERSION.as_bytes()
        }
        ModelInteractionProfile::Speech => MODEL_INTERACTION_SPEECH_CONTEXT_VERSION.as_bytes(),
        ModelInteractionProfile::BatchTalk => {
            MODEL_INTERACTION_BATCH_TALK_CONTEXT_VERSION.as_bytes()
        }
    });
    hasher.update([0]);
    hasher.update(job.actor_id.to_be_bytes());
    hasher.update(job.target_actor_id.to_be_bytes());
    hasher.update(job.plan.location_id.to_be_bytes());
    hasher.update(job.queue_event_id.unwrap_or(0).to_be_bytes());
    hasher.update(job.source_world_tick.unwrap_or(0).to_be_bytes());
    hasher.update(job.observed_through_seq.unwrap_or(0).to_be_bytes());
    for route_component in [
        job.plan.requested_model_id.as_str(),
        job.plan.canonical_slug.as_str(),
        job.plan.exact_voice.as_deref().unwrap_or(""),
    ] {
        hasher.update(route_component.len().to_be_bytes());
        hasher.update(route_component.as_bytes());
    }
    hasher.update([job.plan.profile as u8]);
    format!("{:x}", hasher.finalize())
}

async fn model_interaction_output_committed(
    state: &AppState,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> Result<bool, String> {
    let runtime = state.inner.lock().await;
    let recent = runtime.event_log.iter().any(|event| {
        event.success
            && event.type_name == "model_interaction.output"
            && event.actor_id == Some(job.target_actor_id)
            && event.target_actor_id == Some(job.actor_id)
            && event.caused_by_event_seq == job.queue_event_id
            && event
                .content
                .as_deref()
                .is_some_and(|content| content.contains(interaction_id))
    });
    drop(runtime);
    if recent {
        return Ok(true);
    }
    state
        .event_store_path
        .as_deref()
        .map(|path| durable_model_interaction_output_committed(path, job, interaction_id))
        .transpose()
        .map(|committed| committed.unwrap_or(false))
        .map_err(|error| format!("could not verify durable model interaction output: {error}"))
}

fn durable_model_interaction_output_committed(
    path: &Path,
    job: &ModelInteractionJob,
    interaction_id: &str,
) -> io::Result<bool> {
    let conn = open_event_store(path)?;
    let mut stmt = conn
        .prepare(
            "SELECT payload_json FROM world_events
             WHERE event_type = 'model_interaction.output' AND payload_json LIKE ?1
             ORDER BY seq DESC",
        )
        .map_err(sqlite_error)?;
    let pattern = format!("%{interaction_id}%");
    let rows = stmt
        .query_map(params![pattern], |row| row.get::<_, String>(0))
        .map_err(sqlite_error)?;
    for row in rows {
        let payload = row.map_err(sqlite_error)?;
        let event = serde_json::from_str::<EventView>(&payload)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if event.success
            && event.actor_id == Some(job.target_actor_id)
            && event.target_actor_id == Some(job.actor_id)
            && event.caused_by_event_seq == job.queue_event_id
            && event
                .content
                .as_deref()
                .is_some_and(|content| content.contains(interaction_id))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn commit_model_interaction_status(
    state: &AppState,
    job: &ModelInteractionJob,
    status: &str,
    reason: &str,
) -> Result<(), String> {
    let mut runtime = state.inner.lock().await;
    if runtime.event_log.iter().any(|event| {
        event.type_name == format!("model_interaction.{status}")
            && event.actor_id == Some(job.actor_id)
            && event.target_actor_id == Some(job.target_actor_id)
            && event.caused_by_event_seq == job.queue_event_id
    }) {
        return Ok(());
    }
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: job.actor_id,
            target_actor_id: job.target_actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_system();
    record.offer_kind = Some("model_interaction".to_string());
    apply_job_causality(&mut record, job);
    record.projection_mutations.push(model_interaction_status(
        job.target_actor_id,
        status,
        reason,
    ));
    let (_, events) = commit_journal_record(state, &mut runtime, record)
        .map_err(|error| format!("model interaction status commit failed: {error}"))?;
    drop(runtime);
    broadcast_events(state, &events);
    Ok(())
}

async fn commit_model_interaction_output(
    state: &AppState,
    job: &ModelInteractionJob,
    publication: ModelInteractionPublication,
) -> Result<Vec<EventView>, String> {
    publication.validate()?;
    let mut runtime = state.inner.lock().await;
    if runtime.event_log.iter().any(|event| {
        event.success
            && event.type_name == "model_interaction.output"
            && event.actor_id == Some(job.target_actor_id)
            && event.target_actor_id == Some(job.actor_id)
            && event.caused_by_event_seq == job.queue_event_id
    }) {
        return Ok(Vec::new());
    }
    let frozen_batch_route_is_valid = job.plan.profile == ModelInteractionProfile::BatchTalk
        && frozen_ready_profile_binding(&job.plan, ModelInteractionProfile::BatchTalk).is_ok();
    let current_plan = (job.plan.profile != ModelInteractionProfile::BatchTalk)
        .then(|| runtime.model_interaction_plan_for(job.actor_id, job.target_actor_id))
        .flatten();
    if !frozen_batch_route_is_valid
        && current_plan.as_ref().is_none_or(|plan| {
            plan.location_id != job.plan.location_id
                || plan.profile != job.plan.profile
                || plan.requested_model_id != job.plan.requested_model_id
                || plan.canonical_slug != job.plan.canonical_slug
                || plan.exact_voice != job.plan.exact_voice
        })
    {
        return Err(
            "model interaction participants or exact route changed before publication".to_string(),
        );
    }
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: job.target_actor_id,
            target_actor_id: job.actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_system();
    record.offer_kind = Some("model_interaction".to_string());
    apply_job_causality(&mut record, job);
    record
        .projection_mutations
        .push(ProjectionMutation::ModelInteraction {
            projection: Box::new(ModelInteractionProjection::Output {
                target_actor_id: job.actor_id,
                publication: Box::new(publication),
            }),
        });
    let (status, events) = commit_journal_record(state, &mut runtime, record)
        .map_err(|error| format!("model interaction output commit failed: {error}"))?;
    if status != CW_OK {
        return Err("model interaction output was rejected by the journal".to_string());
    }
    drop(runtime);
    broadcast_events(state, &events);
    Ok(events)
}

fn model_interaction_status(
    target_actor_id: u64,
    status: &str,
    reason: &str,
) -> ProjectionMutation {
    ProjectionMutation::ModelInteraction {
        projection: Box::new(ModelInteractionProjection::Status {
            target_actor_id,
            status: status.to_string(),
            reason: reason.to_string(),
        }),
    }
}

fn apply_job_causality(record: &mut JournalRecord, job: &ModelInteractionJob) {
    record.caused_by_event_seq = job.queue_event_id;
    record.source_world_tick = job.source_world_tick;
    record.observed_through_seq = job.observed_through_seq;
    record.source_location_id = Some(job.plan.location_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        routing::{get, post},
        Router,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn elysium_bindings() -> Vec<SeedActorModelBinding> {
        serde_json::from_str(include_str!(
            "../../content/elysium/actor_model_bindings.json"
        ))
        .expect("Elysium actor model bindings")
    }

    fn publication_with_parts(
        profile: ModelInteractionProfile,
        output_parts: Vec<ModelInteractionOutputPart>,
    ) -> ModelInteractionPublication {
        ModelInteractionPublication {
            schema_version: MODEL_INTERACTION_SCHEMA_VERSION,
            interaction_id: "a".repeat(64),
            profile,
            summary: "A resident illustrates the room.".to_string(),
            output_parts,
            attribution: ModelInteractionAttribution {
                provider: "openrouter".to_string(),
                model: "example/image".to_string(),
            },
            prompt_version: "resident-image-v1".to_string(),
            context_hash: "b".repeat(64),
        }
    }

    #[test]
    fn output_contract_has_typed_extensible_parts_and_never_serializes_prompt_or_vectors() {
        let part = ModelInteractionOutputPart::SemanticMatch {
            source: "embeddings".to_string(),
            entity_kind: "location".to_string(),
            entity_id: "15".to_string(),
            label: "Courtyard".to_string(),
            relation: "best grounded scene match".to_string(),
            score_band: "high".to_string(),
        };
        let publication = publication_with_parts(
            ModelInteractionProfile::Embeddings,
            vec![part.clone(), part.clone(), part],
        );
        publication.validate().expect("valid semantic result");
        let value = serde_json::to_value(publication).expect("publication JSON");
        assert_eq!(value["output_parts"][0]["modality"], "semantic_match");
        assert!(value.get("prompt").is_none());
        assert!(value["output_parts"][0].get("vector").is_none());
        assert!(value["output_parts"][0].get("embedding").is_none());
    }

    #[test]
    fn mixed_text_and_image_bindings_keep_talk_and_gain_illustrate_capability() {
        let bindings = elysium_bindings();
        let binding = bindings
            .iter()
            .find(|binding| {
                binding_supports_image_interaction(binding)
                    && binding
                        .output_modalities
                        .iter()
                        .any(|value| value == "text")
                    && binding
                        .output_modalities
                        .iter()
                        .any(|value| value == "image")
            })
            .expect("Elysium mixed text and image binding");
        assert!(binding_supports_text_reply(binding));
        assert_eq!(
            supported_profile_for_binding(binding),
            Some(ModelInteractionProfile::Image)
        );
        assert_eq!(ModelInteractionProfile::Image.label(), "Illustrate");
        assert_eq!(ModelInteractionProfile::Image.intention(), "illustrate");
    }

    #[test]
    fn image_only_binding_gets_illustrate_without_talk() {
        let bindings = elysium_bindings();
        let binding = bindings
            .iter()
            .find(|binding| {
                binding_supports_image_interaction(binding)
                    && !binding
                        .output_modalities
                        .iter()
                        .any(|value| value == "text")
            })
            .expect("Elysium raster image-only binding");
        assert!(!binding_supports_text_reply(binding));
        assert_eq!(
            supported_profile_for_binding(binding),
            Some(ModelInteractionProfile::Image)
        );
    }

    #[test]
    fn exact_profiles_drive_semantic_actions_and_exclude_unavailable_routes() {
        let bindings = elysium_bindings();
        let embedding = bindings
            .iter()
            .find(|binding| {
                supported_profile_for_binding(binding) == Some(ModelInteractionProfile::Embeddings)
            })
            .expect("ready embedding binding");
        let rerank = bindings
            .iter()
            .find(|binding| {
                supported_profile_for_binding(binding) == Some(ModelInteractionProfile::Rerank)
            })
            .expect("ready rerank binding");
        assert_eq!(embedding.requested_model_id, "baai/bge-base-en-v1.5");
        assert_eq!(
            ModelInteractionProfile::Embeddings.label(),
            "Find resonance"
        );
        assert_eq!(
            ModelInteractionProfile::Embeddings.intention(),
            "find_resonance"
        );
        assert_eq!(rerank.requested_model_id, "cohere/rerank-4-fast");
        assert_eq!(ModelInteractionProfile::Rerank.label(), "Rank echoes");
        assert_eq!(ModelInteractionProfile::Rerank.intention(), "rank_echoes");

        for model_id in [
            "openai/text-embedding-3-small:batch",
            "openrouter/auto",
            "openrouter/auto-beta",
            "recraft/recraft-v4-vector",
        ] {
            let binding = bindings
                .iter()
                .find(|binding| binding.requested_model_id == model_id)
                .expect("exact excluded binding");
            assert_eq!(supported_profile_for_binding(binding), None, "{model_id}");
        }
    }

    #[test]
    fn batch_text_bindings_offer_delayed_echoes_instead_of_talk() {
        let bindings = elysium_bindings();
        let batch = bindings
            .iter()
            .filter(|binding| binding.requested_model_id.ends_with(":batch"))
            .filter(|binding| binding.output_modalities == ["text"])
            .collect::<Vec<_>>();
        assert_eq!(batch.len(), 28);
        assert!(batch.iter().all(|binding| {
            !binding_supports_text_reply(binding)
                && supported_profile_for_binding(binding)
                    == Some(ModelInteractionProfile::BatchTalk)
        }));
        assert_eq!(ModelInteractionProfile::BatchTalk.label(), "Leave an echo");
        assert_eq!(ModelInteractionProfile::BatchTalk.intention(), "echo");
    }

    #[test]
    fn exact_speech_profiles_offer_tts_and_direct_audio_routes() {
        let bindings = elysium_bindings();
        let speech = bindings
            .iter()
            .filter(|binding| {
                supported_profile_for_binding(binding) == Some(ModelInteractionProfile::Speech)
            })
            .collect::<Vec<_>>();
        assert_eq!(speech.len(), 15);
        assert_eq!(
            speech
                .iter()
                .filter(|binding| binding_supports_direct_audio_reply(binding))
                .count(),
            2
        );
        let missing_voices = speech
            .iter()
            .filter(|binding| exact_speech_voice(binding.actor_id).is_none())
            .map(|binding| binding.requested_model_id.as_str())
            .collect::<Vec<_>>();
        assert!(missing_voices.is_empty(), "{missing_voices:?}");
        assert_eq!(ModelInteractionProfile::Speech.label(), "Speak");
        assert_eq!(ModelInteractionProfile::Speech.intention(), "speak");

        let binding = speech[0];
        let voice = exact_speech_voice(binding.actor_id).expect("pinned speech voice");
        let plan = ModelInteractionPlan {
            actor_id: 5000,
            target_actor_id: binding.actor_id,
            location_id: COSY_COTTAGE_LOCATION_ID,
            target_name: binding.display_name.clone(),
            location_name: "The Cosy Cottage".to_string(),
            location_description: "A frozen authoritative room.".to_string(),
            profile: ModelInteractionProfile::Speech,
            requested_model_id: binding.requested_model_id.clone(),
            canonical_slug: binding.canonical_slug.clone(),
            exact_voice: Some(voice.to_string()),
            target_descriptor: String::new(),
            semantic_candidates: Vec::new(),
        };
        assert!(validate_frozen_route_against_binding(
            binding,
            &plan,
            ModelInteractionProfile::Speech
        )
        .is_ok());
        let job = ModelInteractionJob {
            actor_id: plan.actor_id,
            target_actor_id: plan.target_actor_id,
            plan: plan.clone(),
            player_openrouter: false,
            queue_event_id: Some(7),
            source_world_tick: Some(8),
            observed_through_seq: Some(7),
        };
        let mut changed = job.clone();
        changed.plan.exact_voice = Some("different-voice".to_string());
        assert_ne!(model_interaction_id(&job), model_interaction_id(&changed));
        assert!(validate_frozen_route_against_binding(
            binding,
            &changed.plan,
            ModelInteractionProfile::Speech
        )
        .is_err());
        changed.plan.requested_model_id.clear();
        assert!(validate_frozen_route_against_binding(
            binding,
            &changed.plan,
            ModelInteractionProfile::Speech
        )
        .is_err());
    }

    #[test]
    fn speech_output_is_exact_mp3_with_optional_duration_and_coherent_profile() {
        let digest = "c".repeat(64);
        let audio = ModelInteractionOutputPart::Audio {
            asset_id: digest.clone(),
            url: format!("/assets/generated/model-audio/{digest}.mp3"),
            mime_type: "audio/mpeg".to_string(),
            duration_ms: None,
            description: "A resident speaks from the cottage.".to_string(),
            transcript: Some("A server-authored line.".to_string()),
            digest: digest.clone(),
        };
        let publication = publication_with_parts(ModelInteractionProfile::Speech, vec![audio]);
        publication.validate().expect("valid exact MP3 output");
        let value = serde_json::to_value(&publication).expect("speech publication JSON");
        assert_eq!(value["output_parts"][0]["asset_id"], digest);
        assert!(value["output_parts"][0].get("duration_ms").is_none());

        let mut missing_transcript = publication.clone();
        let ModelInteractionOutputPart::Audio { transcript, .. } =
            &mut missing_transcript.output_parts[0]
        else {
            unreachable!()
        };
        *transcript = None;
        assert!(missing_transcript.validate().is_err());
        let mut wrong_profile = publication.clone();
        wrong_profile.profile = ModelInteractionProfile::Image;
        assert!(wrong_profile.validate().is_err());
        let ModelInteractionOutputPart::Audio { url, .. } = &mut wrong_profile.output_parts[0]
        else {
            unreachable!()
        };
        *url = "/assets/generated/model-audio/not-the-digest.mp3".to_string();
        wrong_profile.profile = ModelInteractionProfile::Speech;
        assert!(wrong_profile.validate().is_err());
    }

    #[test]
    fn authoritative_speech_is_deterministic_bounded_and_uses_only_frozen_world_metadata() {
        let plan = ModelInteractionPlan {
            actor_id: 5000,
            target_actor_id: 6000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            target_name: "Voice Resident".to_string(),
            location_name: "The Cosy Cottage".to_string(),
            location_description: "A lantern-lit room with wool blankets. ".repeat(30),
            profile: ModelInteractionProfile::Speech,
            requested_model_id: "example/voice".to_string(),
            canonical_slug: "example/voice".to_string(),
            exact_voice: Some("tara".to_string()),
            target_descriptor: String::new(),
            semantic_candidates: Vec::new(),
        };
        let first = authoritative_speech_text(&plan);
        assert_eq!(first, authoritative_speech_text(&plan));
        assert!(first.chars().count() <= 280);
        assert!(first.contains("Voice Resident"));
        assert!(first.contains("The Cosy Cottage"));
        assert!(!first.chars().any(char::is_control));
        assert_eq!(speech_context_hash("tara", &first).len(), 64);
    }

    #[test]
    fn audio_text_models_are_not_misrepresented_as_chat() {
        let bindings = elysium_bindings();
        let audio_text = bindings
            .iter()
            .filter(|binding| {
                binding
                    .output_modalities
                    .iter()
                    .any(|value| value == "audio")
                    && binding
                        .output_modalities
                        .iter()
                        .any(|value| value == "text")
            })
            .collect::<Vec<_>>();
        assert_eq!(audio_text.len(), 4);
        assert!(audio_text
            .iter()
            .all(|binding| !binding_supports_text_reply(binding)));
        assert_eq!(
            audio_text
                .iter()
                .filter(|binding| {
                    supported_profile_for_binding(binding) == Some(ModelInteractionProfile::Speech)
                })
                .count(),
            2
        );
    }

    #[test]
    fn local_cosine_ranking_is_deterministic_and_never_exposes_vectors() {
        let candidates = (0..4)
            .map(|index| ModelInteractionCandidate {
                actor_id: 100 + index,
                label: format!("Neighbor {index}"),
                descriptor: format!("Authoritative descriptor {index}"),
            })
            .collect::<Vec<_>>();
        let vectors = vec![
            vec![1.0, 0.0],
            vec![1.0, 0.0],
            vec![0.5, 0.5],
            vec![0.0, 1.0],
            vec![-1.0, 0.0],
        ];
        let ranked = rank_embedding_candidates(&vectors, &candidates).expect("cosine ranking");
        assert_eq!(
            ranked.iter().map(|(index, _)| *index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(semantic_score_band(ranked[0].1), "high");
        assert_eq!(semantic_score_band(ranked[1].1), "moderate");
        assert!(cosine_similarity(&[0.0, 0.0], &[1.0, 0.0]).is_err());
    }

    #[test]
    fn model_output_projection_is_system_media_not_speech_or_image_created() {
        let image = ResidentImagePublication {
            schema_version: 1,
            asset_id: "c".repeat(64),
            url: format!("/assets/generated/resident-images/{}.image", "c".repeat(64)),
            mime_type: "image/png".to_string(),
            width: 1,
            height: 1,
            alt: "A resident illustrates the room.".to_string(),
            digest: "d".repeat(64),
            provider: "openrouter".to_string(),
            model: "example/image".to_string(),
            prompt_version: "dialogue-resident-image-v1".to_string(),
            context_hash: "e".repeat(64),
        };
        let mut publication = publication_with_parts(
            ModelInteractionProfile::Image,
            vec![ModelInteractionOutputPart::Image { image }],
        );
        publication.prompt_version = "dialogue-resident-image-v1".to_string();
        let mut runtime = RuntimeWorld::seeded();
        let events = runtime.apply_projection_mutations(
            &CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                target_actor_id: 1002,
                ..CwAction::default()
            },
            &[],
            &[ProjectionMutation::ModelInteraction {
                projection: Box::new(ModelInteractionProjection::Output {
                    target_actor_id: 1002,
                    publication: Box::new(publication),
                }),
            }],
            false,
            false,
            &active_content().manifest.bundle_hash,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].type_name, "model_interaction.output");
        assert_ne!(events[0].type_name, "image.created");
    }

    #[test]
    fn durable_model_interaction_lane_round_trips_one_frozen_profile_job() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-model-interaction-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize durable interaction store");
        let conn = open_event_store(&path).expect("open durable interaction store");
        let job = ModelInteractionJob {
            actor_id: 5000,
            target_actor_id: 6000,
            plan: ModelInteractionPlan {
                actor_id: 5000,
                target_actor_id: 6000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                target_name: "Image Resident".to_string(),
                location_name: "The Cosy Cottage".to_string(),
                location_description: "An authoritative test room.".to_string(),
                profile: ModelInteractionProfile::Image,
                requested_model_id: "example/image".to_string(),
                canonical_slug: "example/image".to_string(),
                exact_voice: None,
                target_descriptor: String::new(),
                semantic_candidates: Vec::new(),
            },
            player_openrouter: true,
            queue_event_id: None,
            source_world_tick: None,
            observed_through_seq: None,
        };
        assert!(insert_model_interaction_job(&conn, &job, 11, Some(77))
            .expect("insert durable model interaction"));
        drop(conn);
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_MODEL_INTERACTION)
            .expect("claim durable model interaction")
            .expect("queued interaction");
        let ActorJobPayload::ModelInteraction(claimed_job) = claimed.payload else {
            panic!("wrong durable payload kind");
        };
        assert_eq!(claimed_job.queue_event_id, Some(77));
        assert!(claimed_job.player_openrouter);
        assert_eq!(claimed_job.plan.profile, ModelInteractionProfile::Image);
        let interaction_id = model_interaction_id(&claimed_job);
        let durable_output = EventView {
            seq: 99,
            type_name: "model_interaction.output".to_string(),
            actor_id: Some(claimed_job.target_actor_id),
            target_actor_id: Some(claimed_job.actor_id),
            content: Some(format!("{{\"interaction_id\":\"{interaction_id}\"}}")),
            caused_by_event_seq: claimed_job.queue_event_id,
            success: true,
            ..EventView::default()
        };
        let conn = open_event_store(&path).expect("reopen durable interaction store");
        conn.execute(
            "INSERT INTO world_events (seq, event_type, payload_json, created_at_ms)
             VALUES (?1, ?2, ?3, 1)",
            params![
                durable_output.seq as i64,
                durable_output.type_name,
                serde_json::to_string(&durable_output).expect("durable output JSON")
            ],
        )
        .expect("persist output beyond the bounded runtime log");
        assert!(
            durable_model_interaction_output_committed(&path, &claimed_job, &interaction_id)
                .expect("query durable output")
        );
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn account_readiness_withholds_model_interactions_and_exact_chat_failure_is_target_scoped() {
        let mut config = AiConfig {
            api_key: "test".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            model: "provider/global-chat".to_string(),
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        };
        assert!(config
            .exact_route_gate("embeddings", "provider/embedding-a")
            .is_ready());
        config
            .readiness
            .record_http_failure("embeddings", "provider/embedding-a", 402, None);
        assert_eq!(
            AiRouteAvailability::from_gate(config.exact_route_gate("rerank", "provider/rerank-b")),
            AiRouteAvailability::Permanent
        );
        assert!(!chat_target_route_is_configured(Some(&config), u64::MAX));
        assert!(chat_target_route_is_permanently_unavailable(
            Some(&config),
            u64::MAX,
        ));

        config.readiness = crate::ai_readiness::AiReadiness::probing_with_low_credit_threshold(5.0);
        assert_eq!(
            AiRouteAvailability::from_gate(
                config.exact_route_gate("embeddings", "provider/embedding-a")
            ),
            AiRouteAvailability::Retryable {
                retry_at_unix: None
            }
        );
        assert!(!chat_target_route_is_permanently_unavailable(
            Some(&config),
            u64::MAX,
        ));
        assert_eq!(
            chat_target_route_retry_floor_ms(Some(&config), u64::MAX),
            60_000,
            "startup probing should wait for the next account probe"
        );

        config.readiness.record_probe_success();
        config
            .readiness
            .record_http_failure("chat/completions", "provider/chat-a", 404, None);
        assert!(config
            .exact_route_gate("chat/completions", "provider/chat-a")
            .is_retryable_block());
        assert!(config
            .exact_route_gate("chat/completions", "provider/chat-b")
            .is_ready());

        config.readiness.record_http_failure(
            "chat/completions",
            "provider/chat-b",
            429,
            Some(Duration::from_secs(10)),
        );
        let transient = AiRouteAvailability::from_gate(
            config.exact_route_gate("chat/completions", "provider/chat-b"),
        );
        assert!(matches!(transient, AiRouteAvailability::Retryable { .. }));
        assert!(transient.retry_floor_ms(&config) > 0);
    }

    #[test]
    fn only_gateway_failures_take_the_terminal_model_interaction_path() {
        let gateway = ModelInteractionAttemptError::from_gateway(AiGatewayError::unconfigured(
            MODEL_INTERACTION_EMBEDDING_FEATURE,
        ));
        let probing = crate::ai_readiness::AiReadiness::probing_with_low_credit_threshold(5.0);
        let transient = ModelInteractionAttemptError::from_gateway(AiGatewayError::readiness(
            MODEL_INTERACTION_EMBEDDING_FEATURE,
            probing.gate("embeddings", "provider/model"),
        ));
        let local =
            ModelInteractionAttemptError::Local("event store write was interrupted".to_string());
        let pending = ModelInteractionAttemptError::Pending;
        assert!(gateway.provider_terminal());
        assert!(!gateway.provider_retryable());
        assert!(!transient.provider_terminal());
        assert!(transient.provider_retryable());
        assert!(!local.provider_terminal());
        assert!(!local.provider_retryable());
        assert!(!model_interaction_attempt_is_terminal(
            &pending,
            ACTOR_JOB_MAX_ATTEMPTS.saturating_add(100),
            0,
        ));
        assert!(model_interaction_attempt_is_terminal(
            &transient,
            ACTOR_JOB_MAX_ATTEMPTS,
            0,
        ));
        assert!(!model_interaction_attempt_is_terminal(
            &transient,
            ACTOR_JOB_MAX_ATTEMPTS,
            30_000,
        ));
        assert!(model_interaction_attempt_is_terminal(
            &local,
            ACTOR_JOB_MAX_ATTEMPTS,
            0,
        ));
    }

    fn frozen_batch_talk_job() -> ModelInteractionJob {
        let binding = elysium_bindings()
            .into_iter()
            .find(|binding| binding.requested_model_id == "google/gemini-2.5-pro:batch")
            .expect("pinned Gemini batch binding");
        ModelInteractionJob {
            actor_id: 5000,
            target_actor_id: binding.actor_id,
            plan: ModelInteractionPlan {
                actor_id: 5000,
                target_actor_id: binding.actor_id,
                location_id: COSY_COTTAGE_LOCATION_ID,
                target_name: binding.display_name,
                location_name: "The Cosy Cottage".to_string(),
                location_description: "A lantern-lit room frozen at submission.".to_string(),
                profile: ModelInteractionProfile::BatchTalk,
                requested_model_id: binding.requested_model_id,
                canonical_slug: binding.canonical_slug,
                exact_voice: None,
                target_descriptor: String::new(),
                semantic_candidates: Vec::new(),
            },
            player_openrouter: false,
            queue_event_id: Some(77),
            source_world_tick: Some(11),
            observed_through_seq: Some(77),
        }
    }

    #[tokio::test]
    async fn batch_talk_submits_once_resumes_by_provider_id_and_publishes_typed_text() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-batch-talk-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let job = frozen_batch_talk_job();
        let interaction_id = model_interaction_id(&job);
        let submissions = Arc::new(AtomicUsize::new(0));
        let polls = Arc::new(AtomicUsize::new(0));
        let submitted_payloads = Arc::new(StdMutex::new(Vec::<serde_json::Value>::new()));
        let app = Router::new()
            .route(
                "/api/beta/batches",
                post({
                    let submissions = submissions.clone();
                    let submitted_payloads = submitted_payloads.clone();
                    move |Json(payload): Json<serde_json::Value>| {
                        submissions.fetch_add(1, Ordering::SeqCst);
                        submitted_payloads
                            .lock()
                            .expect("capture batch payload")
                            .push(payload);
                        async {
                            Json(serde_json::json!({
                                "id": "batch_test_123",
                                "status": "validating"
                            }))
                        }
                    }
                }),
            )
            .route(
                "/api/beta/batches/batch_test_123",
                get({
                    let polls = polls.clone();
                    let interaction_id = interaction_id.clone();
                    move || {
                        polls.fetch_add(1, Ordering::SeqCst);
                        let interaction_id = interaction_id.clone();
                        async move {
                            Json(serde_json::json!({
                                "id": "batch_test_123",
                                "status": "completed",
                                "results": [{
                                    "custom_id": interaction_id,
                                    "response": {
                                        "status_code": 200,
                                        "body": {
                                            "model": "google/gemini-2.5-pro",
                                            "choices": [{
                                                "finish_reason": "stop",
                                                "message": {
                                                    "content": "The lantern kept your place; its warmth still remembers you."
                                                }
                                            }]
                                        }
                                    }
                                }]
                            }))
                        }
                    }
                }),
            );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind batch provider");
        let address = listener.local_addr().expect("batch provider address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}/api/v1"),
            server_paid: false,
            model: "google/gemini-2.5-pro:batch".to_string(),
            ..AiConfig::default()
        }));
        let first = match execute_batch_talk_with_submission_model(
            &state,
            &job,
            &interaction_id,
            "google/gemini-2.5-pro",
        )
        .await
        {
            Err(error) => error,
            Ok(_) => panic!("validating batch must remain pending"),
        };
        assert_eq!(first.to_string(), MODEL_INTERACTION_BATCH_PENDING);
        assert_eq!(submissions.load(Ordering::SeqCst), 1);
        assert_eq!(polls.load(Ordering::SeqCst), 0);
        drop(state);

        let mut resumed = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        resumed.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}/api/v1"),
            server_paid: false,
            model: "google/gemini-2.5-pro:batch".to_string(),
            ..AiConfig::default()
        }));
        let completed = execute_batch_talk_with_submission_model(
            &resumed,
            &job,
            &interaction_id,
            "google/gemini-2.5-pro",
        )
        .await
        .expect("persisted provider id resumes")
        .expect("completed batch publishes");
        assert_eq!(submissions.load(Ordering::SeqCst), 1);
        assert_eq!(polls.load(Ordering::SeqCst), 1);
        assert_eq!(
            completed.publication.profile,
            ModelInteractionProfile::BatchTalk
        );
        assert!(matches!(
            &completed.publication.output_parts[..],
            [ModelInteractionOutputPart::Text { text }]
                if text.contains("lantern kept your place")
        ));
        assert_eq!(
            completed.publication.attribution.model,
            "google/gemini-2.5-pro:batch"
        );

        let captured = submitted_payloads
            .lock()
            .expect("inspect submitted batch payload");
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["endpoint"], "/v1/chat/completions");
        assert_eq!(captured[0]["model"], "google/gemini-2.5-pro");
        assert_eq!(captured[0]["requests"][0]["custom_id"], interaction_id);
        assert_eq!(
            captured[0]["requests"][0]["body"]["model"],
            "google/gemini-2.5-pro"
        );
        drop(captured);
        let conn = open_event_store(&path).expect("inspect persisted batch state");
        let persisted: (String, String, Option<String>) = conn
            .query_row(
                "SELECT provider_batch_id, provider_status, result_digest
                 FROM model_interaction_batches WHERE interaction_id = ?1",
                [&interaction_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("persisted completed batch");
        assert_eq!(persisted.0, "batch_test_123");
        assert_eq!(persisted.1, "completed");
        assert!(persisted.2.as_deref().is_some_and(sha256_hex));
        drop(conn);
        server.abort();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn completed_batch_talk_requires_an_exact_provider_envelope() {
        let job = frozen_batch_talk_job();
        let interaction_id = model_interaction_id(&job);
        let valid = serde_json::json!({
            "status": "completed",
            "results": [{
                "custom_id": interaction_id,
                "response": {
                    "status_code": 200,
                    "body": {
                        "model": "google/gemini-2.5-pro",
                        "choices": [{
                            "finish_reason": "stop",
                            "message": { "content": "The lantern remembers." }
                        }]
                    }
                }
            }]
        });
        assert!(completed_batch_talk_publication(
            &job,
            &interaction_id,
            "google/gemini-2.5-pro",
            &valid,
        )
        .is_ok());

        let mut missing_status = valid.clone();
        missing_status
            .pointer_mut("/results/0/response")
            .and_then(serde_json::Value::as_object_mut)
            .expect("response object")
            .remove("status_code");
        let mut missing_model = valid.clone();
        missing_model
            .pointer_mut("/results/0/response/body")
            .and_then(serde_json::Value::as_object_mut)
            .expect("response body")
            .remove("model");
        let mut multiple_choices = valid.clone();
        let choices = multiple_choices
            .pointer_mut("/results/0/response/body/choices")
            .and_then(serde_json::Value::as_array_mut)
            .expect("completion choices");
        choices.push(choices[0].clone());

        for invalid in [missing_status, missing_model, multiple_choices] {
            assert!(matches!(
                completed_batch_talk_publication(
                    &job,
                    &interaction_id,
                    "google/gemini-2.5-pro",
                    &invalid,
                ),
                Err(ModelInteractionAttemptError::Terminal(_))
            ));
        }
    }

    #[test]
    fn pending_batch_poll_does_not_exhaust_the_actor_job_attempt_budget() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-batch-poll-budget-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize batch actor queue");
        let conn = open_event_store(&path).expect("open batch actor queue");
        let job = frozen_batch_talk_job();
        assert!(insert_model_interaction_job(&conn, &job, 11, Some(77))
            .expect("insert batch actor job"));
        conn.execute(
            "UPDATE actor_jobs SET attempts = 99, available_at_ms = 0",
            [],
        )
        .expect("age pending batch job");
        drop(conn);
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_MODEL_INTERACTION)
            .expect("claim aged batch job")
            .expect("aged batch job exists");
        assert_eq!(claimed.attempts, 100);
        let state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        fail_actor_job_for_runtime_state(
            &path,
            &state,
            &claimed,
            MODEL_INTERACTION_BATCH_PENDING,
            0,
        )
        .expect("requeue pending batch poll");
        let conn = open_event_store(&path).expect("inspect requeued batch job");
        let (status, available_at_ms): (String, i64) = conn
            .query_row(
                "SELECT status, available_at_ms FROM actor_jobs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("requeued batch job state");
        assert_eq!(status, "pending");
        assert!(available_at_ms >= now_millis() as i64);
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn browser_has_a_certificate_bound_non_speech_interaction_flow() {
        for contract in [
            "const buildModelInteractionAction",
            "action(\n          \"/actions/model-interaction\"",
            "function beginPendingModelInteraction",
            "function modelInteractionMetadata",
            "function modelInteractionOutputHtml",
            "const modelInteractionPresentations",
            "find_resonance",
            "rank_echoes",
            "batch_talk",
            "OpenRouter retains batch inputs and results for 30 days",
            "durableBatchInteraction",
            "modelInteractionPresentation(offer)",
            "clientModelInteractionProfile",
            "<audio controls preload=\"metadata\"",
            "<video controls preload=\"metadata\"",
            "There is no typed prompt or spoken line.",
        ] {
            assert!(
                INDEX_HTML.contains(contract),
                "missing browser contract: {contract}"
            );
        }
        assert!(INDEX_HTML.contains("modelInteractionContainsForbiddenPayload"));
        assert!(INDEX_HTML.contains("[\"prompt\", \"vector\", \"embedding\", \"embeddings\"]"));
    }
}
