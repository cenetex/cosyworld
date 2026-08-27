use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, Write as _},
    path::{Path, PathBuf},
    sync::{Mutex as StdMutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::warn;

use crate::media_recipes::media_verdict::{
    bounded_brief_constraints, make_visual_verdict, media_candidate_approved,
    media_candidate_digest, media_candidate_violations, media_provider_route_available,
    preflight_media_verdict_storage, prepare_media_candidate,
    prepare_rejected_media_candidate_replacement, record_media_provider_failure,
    record_media_review_unavailable, record_media_visual_verdict, FrozenMediaBrief,
    MediaCandidateInput, MediaVerdictDisposition, MediaViolation,
};
use crate::{
    active_content, backfill_legacy_community_asset, broadcast_events,
    canonical_community_media_asset_bytes, card_for_actor, card_for_item, card_for_location,
    commit_journal_record, community_art_eligible_card, execute_prepared_replicate_art,
    freeze_approved_community_media_reference, immutable_media_asset_bytes,
    is_safe_image_content_type, now_millis, prepare_replicate_art, prepare_replicate_evolution_art,
    queue_avatar_self_description, reconcile_community_media_asset_status,
    record_ai_usage_for_provider, register_derived_community_media_asset,
    register_generated_media_asset, request_image_policy_decision, resolve_generation_media_config,
    ActorMeta, AiConfig, AppState, CardView, CommunityArtView, CwAction, EventView,
    EvolutionRolloutRoute, FrozenCommunityArtEvolutionJob, FrozenMediaAssetReference,
    GeneratedPolicyBinding, ImagePolicyRequest, ItemMeta, JournalRecord, MediaAssetBackfill,
    MediaAssetProvenance, PreparedReplicateExecution, ProjectionMutation, PublicArtHistoryEvent,
    ReplicateAvatarArtConfig, RuntimeWorld, WorldEntityRef, CW_ACTION_NONE, CW_OK,
    EVOLUTION_EXECUTION_MODEL_REVISION, EVOLUTION_EXECUTION_RECIPE,
};

pub(super) const MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS: u8 = 3;
/// Mirrors `MAX_REVIEW_FAILURES` in the media verdict store, which already
/// counts and clamps review failures per candidate.
pub(super) const MAX_COMMUNITY_ART_REVIEW_ATTEMPTS: u8 = 3;

fn exhausted_community_art_review_attempts() -> u8 {
    MAX_COMMUNITY_ART_REVIEW_ATTEMPTS
}
pub(super) const LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION: u8 = 1;
pub(super) const ACTOR_ITEM_GENERATION_PROFILE_VERSION: u8 = 2;
pub(super) const LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION: u8 = 5;
pub(super) const LOCATION_LANDSCAPE_PROMPT_PREFIX: &str =
    "MRQ, cozy storybook landscape, wide environment establishing view";
const COMMUNITY_ART_CANDIDATE_SCHEMA_VERSION: u8 = 1;
/// Journaled error code for a frozen media brief that its own validator
/// rejects. The brief is derived deterministically from persisted subject facts
/// and this profile's code, so an identical retry reproduces the identical
/// rejection: the job is terminal until a newer generation profile reopens it.
pub(super) const COMMUNITY_ART_BRIEF_INVALID_CODE: &str = "community_art_brief_invalid";
pub(super) const AVATAR_APPEARANCE_REQUIRED_CODE: &str = "avatar_appearance_required";
pub(super) const COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE: &str =
    "community_art_candidate_quarantine_failed";
pub(super) const POLICY_PREFLIGHT_IMAGE_URL: &str =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAA1BMVEUA/wA0XsCoAAAAD0lEQVQoz2NgGAWjgHwAAAJAAAGMxat3AAAAAElFTkSuQmCC";

pub(super) fn legacy_community_art_generation_profile_version() -> u8 {
    LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION
}

pub(super) fn community_art_generation_profile_version(subject_kind: &str) -> u8 {
    if subject_kind == "location" {
        LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION
    } else {
        ACTOR_ITEM_GENERATION_PROFILE_VERSION
    }
}

pub(super) fn community_art_generation_key(
    subject_kind: &str,
    subject_id: u64,
    level: u8,
) -> String {
    format!("{subject_kind}:{subject_id}:level:{level}")
}

#[derive(Clone, Debug)]
pub(super) struct DownloadedReplicateImage {
    pub(super) bytes: Vec<u8>,
    pub(super) content_type: String,
    pub(super) source_url: String,
    pub(super) prediction_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct CommunityArtGenerationState {
    pub(super) subject_kind: String,
    pub(super) subject_id: u64,
    pub(super) level: u8,
    #[serde(default = "legacy_community_art_generation_profile_version")]
    pub(super) generation_profile_version: u8,
    #[serde(default)]
    pub(super) generation_policy: GeneratedPolicyBinding,
    pub(super) required_orbs: i32,
    pub(super) funded_orbs: i32,
    #[serde(default)]
    pub(super) contributions: BTreeMap<u64, i32>,
    #[serde(default)]
    pub(super) funding_intent_ids: BTreeSet<String>,
    pub(super) status: String,
    pub(super) history_through_seq: u64,
    #[serde(default)]
    pub(super) revision: u32,
    #[serde(default)]
    pub(super) provider_attempts: u8,
    /// Review attempts spent on a saved candidate.
    ///
    /// A job whose candidate exists but whose review failed used to be
    /// retryable forever. On Lonely Forest one such job re-ran 975 times
    /// between 2026-08-15 and 2026-08-22, accelerating to 239 attempts a day,
    /// because the reviewer was paused by the daily spend cap and nothing
    /// counted the attempts. `MAX_REVIEW_FAILURES` existed in the verdict
    /// record and saturated at 3 while the retry decision never read it.
    ///
    /// A state that predates this counter is treated as exhausted: it is only
    /// reachable through a status this field now governs, and a job already
    /// looping must stop rather than earn a fresh budget. Replay converges on
    /// the same value because the counter saturates at the cap.
    #[serde(default = "exhausted_community_art_review_attempts")]
    pub(super) review_attempts: u8,
    #[serde(default)]
    pub(super) last_prediction_id: Option<String>,
    #[serde(default)]
    pub(super) last_error_code: Option<String>,
    #[serde(default)]
    pub(super) status_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) evolution_job: Option<FrozenCommunityArtEvolutionJob>,
    #[serde(default)]
    pub(super) frozen_plan: Option<CommunityArtPlan>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct CommunityArtPlan {
    pub(super) subject_kind: String,
    pub(super) subject_id: u64,
    pub(super) level: u8,
    pub(super) generation_profile_version: u8,
    pub(super) generation_policy: GeneratedPolicyBinding,
    pub(super) required_orbs: i32,
    pub(super) history_through_seq: u64,
    pub(super) prompt: String,
    pub(super) aspect_ratio: String,
    pub(super) image_policy: Option<CommunityArtImagePolicy>,
    pub(super) persisted_identity: String,
    pub(super) persisted_visual_description: String,
    pub(super) stable_traits: Vec<String>,
    pub(super) public_history: Vec<PublicArtHistoryEvent>,
    pub(super) evolution_job: Option<FrozenCommunityArtEvolutionJob>,
}

impl CommunityArtPlan {
    pub(super) fn generation_retryable(
        &self,
        generation: &CommunityArtGenerationState,
        candidate_exists: bool,
    ) -> bool {
        community_art_generation_retryable_for_profile(
            generation,
            candidate_exists,
            self.generation_profile_version,
        )
    }
}

pub(super) fn warn_community_art_evolution_reference_failure(plan: &CommunityArtPlan, error: &str) {
    warn!(
        failure_stage = "evolution_reference",
        failure_code = "community_art_evolution_reference_unavailable",
        subject_kind = plan.subject_kind,
        subject_id = plan.subject_id,
        level = plan.level,
        "community art funding could not freeze the prior-level reference: {error}"
    );
}

pub(super) fn freeze_community_art_evolution(
    generated_asset_dir: &Path,
    plan: &mut CommunityArtPlan,
) -> Result<(), String> {
    if plan.level <= 1 {
        return Ok(());
    }
    if let Some(job) = plan.evolution_job.as_ref() {
        return job.validate();
    }
    let prior_level = plan.level.saturating_sub(1);
    let prior = match freeze_approved_community_media_reference(
        generated_asset_dir,
        &plan.subject_kind,
        plan.subject_id,
        prior_level,
        plan.history_through_seq,
    ) {
        Ok(prior) => prior,
        Err(error) if error.starts_with("no approved canonical media asset for ") => {
            warn!(
                event = "community_art_evolution_base_catch_up",
                subject_kind = plan.subject_kind,
                subject_id = plan.subject_id,
                target_level = plan.level,
                prior_level,
                history_through_seq = plan.history_through_seq,
                "prior-level art does not exist; generating a safe base image at the funded level"
            );
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    plan.evolution_job = Some(FrozenCommunityArtEvolutionJob::freeze(
        &plan.subject_kind,
        plan.subject_id,
        &plan.persisted_identity,
        &plan.persisted_visual_description,
        plan.stable_traits.clone(),
        &plan.public_history,
        prior_level,
        prior.asset_id,
        prior.content_digest,
        prior.mime_type,
        prior.history_through_seq,
        plan.history_through_seq,
        plan.level,
        1,
        &plan.aspect_ratio,
    )?);
    Ok(())
}

fn frozen_evolution_reference(job: &FrozenCommunityArtEvolutionJob) -> FrozenMediaAssetReference {
    FrozenMediaAssetReference {
        subject_kind: job.subject_kind.clone(),
        subject_id: job.subject_id,
        level: job.prior_level,
        asset_id: job.prior_asset_id.clone(),
        content_digest: job.prior_asset_digest.clone(),
        mime_type: job.prior_mime_type.clone(),
        history_through_seq: job.prior_history_through_seq,
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum CommunityArtImagePolicy {
    LocationLandscape,
}

impl CommunityArtImagePolicy {
    pub(super) fn prompt(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Landscape only. Produce an uninhabited environment. No people, human figures, humanoids, characters, animals, creatures, silhouettes, faces, body parts, statues, or portraits. Do not generate text, letters, numbers, signatures, artist marks, logos, watermarks, UI, or card borders."
            }
        }
    }

    fn review(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Publish only a landscape with no visible or implied people, human figures, humanoids, characters, animals, creatures, silhouettes, faces, body parts, statues, or portraits, and no readable text (including signatures or artist marks), letters, numbers, logos, or watermarks."
            }
        }
    }

    fn generation_prompt_prefix(self) -> &'static str {
        match self {
            Self::LocationLandscape => LOCATION_LANDSCAPE_PROMPT_PREFIX,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CommunityArtCandidateMetadata {
    schema_version: u8,
    content_type: String,
    source_url: String,
    #[serde(default)]
    prediction_id: Option<String>,
    sha256: String,
    #[serde(default)]
    evolution_canary: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CommunityArtCandidateAvailability {
    Absent,
    Valid,
    RecoveryRequired,
}

#[derive(Debug)]
pub(super) enum CommunityArtGenerationError {
    Provider(String),
    ProviderUnavailable(String),
    Preflight(String),
    BriefInvalid(String),
    CandidateQuarantine(String),
    PolicyUnavailable,
    PolicyReview(String),
    PolicyRejected(Vec<String>),
    Storage(String),
}

impl CommunityArtGenerationError {
    pub(super) fn status(&self) -> &'static str {
        match self {
            Self::PolicyUnavailable => "review_unavailable",
            Self::PolicyReview(_) => "review_failed",
            Self::PolicyRejected(_) => "policy_rejected",
            Self::Provider(_)
            | Self::ProviderUnavailable(_)
            | Self::Preflight(_)
            | Self::BriefInvalid(_)
            | Self::CandidateQuarantine(_)
            | Self::Storage(_) => "failed",
        }
    }

    pub(super) fn code(&self) -> &'static str {
        match self {
            Self::Provider(_) => "community_art_generation_failed",
            Self::ProviderUnavailable(_) => "community_art_provider_unavailable",
            Self::Preflight(_) => "community_art_preflight_failed",
            Self::BriefInvalid(_) => COMMUNITY_ART_BRIEF_INVALID_CODE,
            Self::CandidateQuarantine(_) => COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE,
            Self::PolicyUnavailable => "community_art_reviewer_unavailable",
            Self::PolicyReview(_) => "community_art_policy_review_failed",
            Self::PolicyRejected(_) => "community_art_policy_rejected",
            Self::Storage(_) => "community_art_storage_failed",
        }
    }

    pub(super) fn stage(&self) -> &'static str {
        match self {
            Self::Provider(_) | Self::ProviderUnavailable(_) => "provider",
            Self::Preflight(_) => "recipe",
            Self::BriefInvalid(_) => "brief",
            Self::CandidateQuarantine(_) => "quarantine",
            Self::PolicyUnavailable => "reviewer",
            Self::PolicyReview(_) => "review",
            Self::PolicyRejected(_) => "policy",
            Self::Storage(_) => "storage",
        }
    }

    pub(super) fn message(&self) -> String {
        match self {
            Self::Provider(error) => format!("provider generation failed: {error}"),
            Self::ProviderUnavailable(error) => {
                format!("provider route was unavailable before submission: {error}")
            }
            Self::Preflight(error) => {
                format!("community-art preflight failed before any provider call: {error}")
            }
            Self::BriefInvalid(error) => {
                format!("frozen media brief was rejected before any provider call: {error}")
            }
            Self::CandidateQuarantine(error) => {
                format!("invalid community-art candidate could not be quarantined: {error}")
            }
            Self::PolicyUnavailable => {
                "community-art publication reviewer is not configured; output withheld".to_string()
            }
            Self::PolicyReview(error) => format!("image policy review failed: {error}"),
            Self::PolicyRejected(violations) => format!(
                "image policy rejected all candidates: {}",
                if violations.is_empty() {
                    "unspecified violation".to_string()
                } else {
                    violations.join(", ")
                }
            ),
            Self::Storage(error) => format!("validated image storage failed: {error}"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CommunityArtProviderExecution {
    pub(super) feature: &'static str,
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) succeeded: bool,
}

#[derive(Debug)]
pub(super) struct CommunityArtGenerationOutcome {
    pub(super) result: Result<(), CommunityArtGenerationError>,
    pub(super) prediction_id: Option<String>,
    pub(super) reused_candidate: bool,
    pub(super) asset_id: Option<String>,
    pub(super) provider_executions: Vec<CommunityArtProviderExecution>,
}

pub(super) fn community_art_generation_retryable(
    generation: &CommunityArtGenerationState,
    candidate_exists: bool,
) -> bool {
    if generation.funded_orbs < generation.required_orbs {
        return false;
    }
    // A rejected frozen brief is deterministic in the plan and the profile, so
    // neither a saved candidate nor an unspent provider attempt can change the
    // outcome. Retrying only replays the same rejection forever; a newer
    // generation profile is the documented way back in.
    if matches!(
        generation.last_error_code.as_deref(),
        Some(COMMUNITY_ART_BRIEF_INVALID_CODE)
            | Some(COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE)
    ) {
        return false;
    }
    match generation.status.as_str() {
        "ready" => false,
        "review_failed" | "review_unavailable" if candidate_exists => {
            generation.review_attempts < MAX_COMMUNITY_ART_REVIEW_ATTEMPTS
        }
        "funded" | "generating" | "reviewing" | "failed" | "rejected" | "policy_rejected" => {
            candidate_exists || generation.provider_attempts < MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
        }
        _ => false,
    }
}

pub(super) fn community_art_generation_retryable_for_profile(
    generation: &CommunityArtGenerationState,
    candidate_exists: bool,
    generation_profile_version: u8,
) -> bool {
    generation.last_error_code.as_deref() != Some(COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE)
        && generation.funded_orbs >= generation.required_orbs
        && (generation_profile_version > generation.generation_profile_version
            || community_art_generation_retryable(generation, candidate_exists))
}

fn location_visual_history_trace(event_type: &str) -> Option<&'static str> {
    match event_type {
        "pathway.discovered" => Some("a newly opened path cuts through the terrain"),
        "first_tale.public_trace" => Some("a small public story-marker rests in the landscape"),
        "natural_feature.revealed" => Some("a newly noticed natural feature now shapes the view"),
        "governance.selected" => {
            Some("shared stewardship has left the grounds deliberately tended")
        }
        "building.completed" => {
            Some("a newly completed structure belongs to the settled landscape")
        }
        "quest.loot_allocated" => Some("signs of an opened cache remain in the surroundings"),
        "world.logistics.completed" => {
            Some("worked routes and orderly supplies have marked the ground")
        }
        "item.crafted" => Some("a modest work area shows recent craft use"),
        "item.transformed" => Some("subtle traces of recent craftwork remain"),
        _ => None,
    }
}

pub(super) fn community_art_prompt_history(
    subject_kind: &str,
    history_entries: &[String],
) -> String {
    if subject_kind == "location" {
        if history_entries.is_empty() {
            "newly revealed terrain with no depicted travelers".to_string()
        } else {
            history_entries
                .iter()
                .map(|entry| {
                    crate::compact_whitespace(entry)
                        .trim_end_matches(['.', '!', '?'])
                        .to_string()
                })
                .filter(|entry| !entry.is_empty())
                .take(6)
                .collect::<Vec<_>>()
                .join(". ")
        }
    } else if history_entries.is_empty() {
        "newly arrived in the shared world".to_string()
    } else {
        history_entries.join("; ")
    }
}

#[allow(clippy::too_many_arguments)] // Mirrors the bounded prompt components.
pub(super) fn build_community_art_prompt(
    subject_kind: &str,
    name: &str,
    title: &str,
    blurb: &str,
    level: u8,
    subject_details: &str,
    history: &str,
    image_policy: Option<CommunityArtImagePolicy>,
) -> String {
    let image_constraints = image_policy
        .map(CommunityArtImagePolicy::prompt)
        .unwrap_or(
            "No words, lettering, captions, signage, signatures, artist marks, logo, emblem, brand mark, watermark, UI, gore, or photorealism. Do not render typography-like shapes or text-like marks anywhere in the image.",
        );
    let prompt = if image_policy == Some(CommunityArtImagePolicy::LocationLandscape) {
        format!(
            "{name} — {blurb}. {subject_details}. Public visual traces: {history}. Wide uninhabited level {level} environment; established geography. {image_constraints}"
        )
    } else {
        format!(
            "{subject_kind} {name} — {title}. {blurb}. Level {level}. {subject_details}. Public visual traces: {history}. Established identity. {image_constraints}"
        )
    };
    crate::compact_whitespace(&prompt)
}

#[cfg(test)]
pub(super) fn self_authored_avatar_has_text_binding(
    identity_mode: &str,
    actor_id: u64,
    bindings: &[crate::SeedActorModelBinding],
) -> bool {
    matches!(identity_mode, "self_authored" | "hybrid")
        && bindings.iter().any(|binding| {
            binding.actor_id == actor_id
                && binding.input_modalities.iter().any(|mode| mode == "text")
                && binding.output_modalities.iter().any(|mode| mode == "text")
        })
}

impl RuntimeWorld {
    pub(super) fn community_art_subject_level(
        &self,
        subject_kind: &str,
        subject_id: u64,
    ) -> Option<u8> {
        match subject_kind {
            "actor" => {
                let actor = self.actor_by_id(subject_id)?;
                let meta = self.actors.get(&subject_id).cloned().unwrap_or(ActorMeta {
                    name: format!("Avatar {subject_id}"),
                    speech_mode: "prose".to_string(),
                    title: "World Traveler".to_string(),
                    description: String::new(),
                });
                community_art_eligible_card(&card_for_actor(
                    subject_id,
                    &meta.name,
                    &meta.title,
                    &meta.description,
                    actor.stats.level,
                ))
                .then_some(actor.stats.level.max(1))
            }
            "item" => {
                let item = self.world.items[..self.world.item_count]
                    .iter()
                    .find(|item| item.id == subject_id)?;
                let meta = self.items.get(&subject_id).cloned().unwrap_or(ItemMeta {
                    name: format!("Item {subject_id}"),
                    description: "A found keepsake.".to_string(),
                    skill_id: None,
                    skill_bonus: 0,
                    mechanics: None,
                });
                community_art_eligible_card(&card_for_item(item.id, &meta.name, &meta.description))
                    .then(|| self.world_entity_level(WorldEntityRef::item(subject_id)))
                    .flatten()
            }
            "location" => {
                let name = self.location_name(subject_id)?;
                let meta = self.location_meta_for(subject_id);
                let card = card_for_location(subject_id, &name, Some(&meta));
                if !community_art_eligible_card(&card) {
                    return None;
                }
                if let Some(pathway) = self.generated_pathway_for_location(subject_id) {
                    return (pathway.art_eligible
                        && self.generated_places.contains_key(&subject_id))
                    .then(|| self.world_entity_level(WorldEntityRef::location(subject_id)))
                    .flatten();
                }
                self.world_entity_level(WorldEntityRef::location(subject_id))
            }
            _ => None,
        }
    }

    pub(super) fn decorate_community_art_card(
        &self,
        mut card: CardView,
        subject_kind: &str,
        subject_id: u64,
        viewer_actor_id: Option<u64>,
    ) -> CardView {
        if subject_kind == "location" {
            card = self.decorate_generated_location_card(card, subject_id);
        }
        let Some(level) = self.community_art_subject_level(subject_kind, subject_id) else {
            return card;
        };
        let key = community_art_generation_key(subject_kind, subject_id, level);
        let generation = self.community_art_generations.get(&key);
        let published_generation = (1..=level).rev().find_map(|published_level| {
            self.community_art_generations
                .get(&community_art_generation_key(
                    subject_kind,
                    subject_id,
                    published_level,
                ))
                .filter(|state| state.status == "ready")
        });
        let required_orbs = i32::from(level.max(1));
        let funded_orbs = generation.map(|state| state.funded_orbs).unwrap_or(0);
        if let Some(published) = published_generation {
            card.image_url = Some(community_art_image_url(
                subject_kind,
                subject_id,
                published.level,
                published.revision,
            ));
            card.asset_status = "community_art".to_string();
        }
        card.level = level;
        card.evolved = level >= 2;
        card.community_art = Some(CommunityArtView {
            level,
            required_orbs,
            funded_orbs,
            remaining_orbs: required_orbs.saturating_sub(funded_orbs),
            viewer_contributed: viewer_actor_id.is_some_and(|actor_id| {
                generation.is_some_and(|state| {
                    state
                        .contributions
                        .get(&actor_id)
                        .is_some_and(|amount| *amount > 0)
                })
            }),
        });
        card
    }

    pub(super) fn avatar_portrait_appearance(&self, actor_id: u64, level: u8) -> Option<String> {
        self.avatar_level_identity(actor_id, level)
            .map(|identity| identity.appearance)
            .filter(|appearance| !appearance.trim().is_empty())
            .or_else(|| {
                self.character_identities
                    .get(&actor_id)
                    .map(|identity| identity.physical_description.clone())
                    .filter(|appearance| !appearance.trim().is_empty())
            })
            .or_else(|| {
                self.avatar_identity_policy(actor_id).and_then(|identity| {
                    (identity.mode == "authored" && !identity.appearance.trim().is_empty())
                        .then_some(identity.appearance)
                        .or_else(|| {
                            (identity.mode == "authored"
                                && !identity.canonical_description.trim().is_empty())
                            .then_some(identity.canonical_description)
                        })
                })
            })
            .map(|appearance| crate::compact_whitespace(&appearance))
    }

    pub(super) fn reset_community_art_after_avatar_description(
        &mut self,
        actor_id: u64,
        level: u8,
    ) -> bool {
        let Some(generation) = self
            .community_art_generations
            .get_mut(&community_art_generation_key("actor", actor_id, level))
        else {
            return false;
        };
        generation.status = if generation.funded_orbs >= generation.required_orbs {
            "funded".to_string()
        } else {
            "funding".to_string()
        };
        generation.provider_attempts = 0;
        generation.review_attempts = 0;
        generation.last_prediction_id = None;
        generation.last_error_code = None;
        generation.status_event_seq = None;
        generation.frozen_plan = None;
        generation.revision = generation.revision.saturating_add(1);
        true
    }

    fn actor_community_art_details(&self, actor_id: u64, card: &crate::CardView) -> String {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return String::new();
        };
        let mut facts = vec![format!("authoritative level {}", actor.stats.level)];
        if let Some(identity) = self.character_identities.get(&actor_id) {
            if let Some(profile) = crate::character_creation_profile(Some(&identity.profile_id)) {
                if let Some(species) = profile
                    .species
                    .iter()
                    .find(|species| species.id == identity.species_id)
                {
                    facts.push(format!("species: {}", species.label));
                    facts.push(format!("species appearance: {}", species.visual_prompt));
                }
                if let Some(origin) = profile
                    .origins
                    .iter()
                    .find(|origin| origin.id == identity.origin_id)
                {
                    facts.push(format!("origin: {}", origin.label));
                    facts.push(format!("origin details: {}", origin.visual_prompt));
                }
                if let Some(class) = identity.class_id.as_deref().and_then(|class_id| {
                    profile.choices.iter().find(|choice| choice.id == class_id)
                }) {
                    facts.push(format!("class: {}", class.label));
                    facts.push(format!("class gear and bearing: {}", class.description));
                } else {
                    facts.push("class: classless traveler".to_string());
                }
            }
        }
        if let Some(appearance) =
            self.avatar_portrait_appearance(actor_id, actor.stats.level.max(1))
        {
            facts.push(format!("stable physical description: {appearance}"));
        } else {
            facts.push(format!(
                "stable physical description: {}",
                crate::avatar_visual_prompt(&card.display_name, &card.title, &card.blurb)
            ));
        }
        if let Some(calling) = self.callings.get(&actor_id) {
            facts.push(format!("calling: {}", calling.statement));
        }
        if let Some(location) = self.location_name(actor.location_id) {
            facts.push(format!("current setting: {location}"));
        }
        let carried = self
            .actor_held_items(actor_id)
            .into_iter()
            .take(8)
            .map(|item| {
                let name = self
                    .item_name(item.id)
                    .unwrap_or_else(|| format!("Item {}", item.id));
                format!(
                    "{name} ({})",
                    crate::card_zone(item.zone, item.holder_actor_id, item.location_id)
                )
            })
            .collect::<Vec<_>>();
        if carried.is_empty() {
            facts.push("carried items: none".to_string());
        } else {
            facts.push(format!(
                "carried and equipped items: {}",
                carried.join(", ")
            ));
        }
        facts.join(". ")
    }

    fn item_community_art_details(&self, item: crate::CwItem) -> String {
        let mut facts = vec![
            format!("item type: {}", crate::item_kind(item.kind)),
            format!("equipment role: {}", crate::item_role(item.role)),
            format!("size: {}", crate::item_size(item.size_class)),
        ];
        if let Some(description) =
            self.latest_world_entity_description(WorldEntityRef::item(item.id))
        {
            facts.push(format!(
                "self-defined persona and appearance: {description}"
            ));
        }
        if item.charges > 0 {
            facts.push(format!("remaining charges: {}", item.charges));
        }
        if item.holder_actor_id != 0 {
            facts.push(format!(
                "carried by: {}",
                self.actor_name(item.holder_actor_id)
                    .unwrap_or_else(|| format!("Avatar {}", item.holder_actor_id))
            ));
            facts.push(format!(
                "card zone: {}",
                crate::card_zone(item.zone, item.holder_actor_id, item.location_id)
            ));
        } else if let Some(location) = self.location_name(item.location_id) {
            facts.push(format!("current setting: {location}"));
        }
        facts.join(". ")
    }

    fn location_community_art_details(&self, location_id: u64) -> String {
        let meta = self.location_meta_for(location_id);
        let mut facts = Vec::new();
        if !meta.description.trim().is_empty() {
            facts.push(format!("canonical description: {}", meta.description));
        }
        if !meta.persona.trim().is_empty() {
            facts.push(format!("place character: {}", meta.persona));
        }
        if let Some(description) =
            self.latest_world_entity_description(WorldEntityRef::location(location_id))
        {
            facts.push(format!(
                "self-defined persona and appearance: {description}"
            ));
        }
        if !meta.biome.trim().is_empty() {
            facts.push(format!("biome: {}", meta.biome));
        }
        if !meta.terrain.is_empty() {
            facts.push(format!("terrain: {}", meta.terrain.join(", ")));
        }
        if let Some(art_prompt) = meta
            .art_prompt
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            facts.push(format!("reviewed landscape brief: {art_prompt}"));
        }
        if let Some(sheet) = self.room_sheets.get(&location_id) {
            if !sheet.aspects.is_empty() {
                facts.push(format!("defining aspects: {}", sheet.aspects.join(", ")));
            }
            if !sheet.boons.is_empty() {
                facts.push(format!("visible boons: {}", sheet.boons.join(", ")));
            }
            if !sheet.hooks.is_empty() {
                facts.push(format!("visible hooks: {}", sheet.hooks.join(", ")));
            }
        }
        for evidence in self.media_location_evidence(location_id) {
            facts.push(format!("public place memory: {}", evidence.text));
        }
        facts.join(". ")
    }

    pub(super) fn community_art_plan(
        &self,
        contributor_actor_id: u64,
        subject_kind: &str,
        subject_id: u64,
    ) -> Result<CommunityArtPlan, String> {
        let contributor = self
            .actor_by_id(contributor_actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
            .ok_or_else(|| "The contributing avatar is no longer active.".to_string())?;
        let level = self
            .community_art_subject_level(subject_kind, subject_id)
            .ok_or_else(|| "That card does not have community-generated art.".to_string())?;
        if subject_kind == "actor" {
            let self_description_required =
                self.avatar_requires_self_description(subject_id, level);
            if (self_description_required
                && !self.avatar_can_redescribe_appearance(subject_id, level))
                || (!self_description_required
                    && self.avatar_portrait_appearance(subject_id, level).is_none())
            {
                return Err(AVATAR_APPEARANCE_REQUIRED_CODE.to_string());
            }
        }
        let generation_profile_version = community_art_generation_profile_version(subject_kind);
        if let Some(frozen_plan) = self
            .community_art_generations
            .get(&community_art_generation_key(
                subject_kind,
                subject_id,
                level,
            ))
            .and_then(|generation| generation.frozen_plan.as_ref())
            .filter(|plan| plan.generation_profile_version >= generation_profile_version)
        {
            return Ok(frozen_plan.clone());
        }
        let (card, visible, aspect_ratio, subject_details, image_policy) = match subject_kind {
            "actor" => {
                let actor = self
                    .actor_by_id(subject_id)
                    .ok_or_else(|| "That avatar is no longer here.".to_string())?;
                let meta = self
                    .actors
                    .get(&subject_id)
                    .cloned()
                    .unwrap_or(crate::ActorMeta {
                        name: format!("Avatar {subject_id}"),
                        speech_mode: "prose".to_string(),
                        title: "World Traveler".to_string(),
                        description: String::new(),
                    });
                let card = crate::card_for_actor(
                    subject_id,
                    &meta.name,
                    &meta.title,
                    &meta.description,
                    actor.stats.level,
                );
                (
                    card.clone(),
                    actor.location_id == contributor.location_id,
                    "2:3",
                    self.actor_community_art_details(subject_id, &card),
                    None,
                )
            }
            "item" => {
                let item = self.world.items[..self.world.item_count]
                    .iter()
                    .find(|item| item.id == subject_id)
                    .ok_or_else(|| "That item is no longer in the world.".to_string())?;
                let meta = self
                    .items
                    .get(&subject_id)
                    .cloned()
                    .unwrap_or(crate::ItemMeta {
                        name: format!("Item {subject_id}"),
                        description: "A found keepsake.".to_string(),
                        skill_id: None,
                        skill_bonus: 0,
                        mechanics: None,
                    });
                (
                    crate::card_for_item(subject_id, &meta.name, &meta.description),
                    item.holder_actor_id == contributor_actor_id
                        || (item.holder_actor_id == 0
                            && item.location_id == contributor.location_id),
                    "1:1",
                    self.item_community_art_details(*item),
                    None,
                )
            }
            "location" => {
                let name = self
                    .location_name(subject_id)
                    .ok_or_else(|| "That location is no longer on the shared map.".to_string())?;
                let visible = subject_id == contributor.location_id
                    || self.world.exits[..self.world.exit_count]
                        .iter()
                        .any(|exit| {
                            exit.from_location_id == contributor.location_id
                                && exit.to_location_id == subject_id
                        });
                (
                    crate::card_for_location(
                        subject_id,
                        &name,
                        Some(&self.location_meta_for(subject_id)),
                    ),
                    visible,
                    "16:9",
                    self.location_community_art_details(subject_id),
                    Some(CommunityArtImagePolicy::LocationLandscape),
                )
            }
            _ => return Err("Unknown community-art subject.".to_string()),
        };
        if !visible {
            return Err("That card is not visible from here.".to_string());
        }
        let history_through_seq = self.world.next_event_seq.saturating_sub(1);
        let public_history = self
            .event_log
            .iter()
            .rev()
            .filter(|event| event.success)
            .filter(|event| match subject_kind {
                "actor" => {
                    event.actor_id == Some(subject_id) || event.target_actor_id == Some(subject_id)
                }
                "item" => {
                    event.item_id == Some(subject_id) || event.target_item_id == Some(subject_id)
                }
                "location" => {
                    event.location_id == Some(subject_id)
                        || event.destination_location_id == Some(subject_id)
                }
                _ => false,
            })
            .filter_map(|event| {
                let summary = if subject_kind == "location" {
                    location_visual_history_trace(&event.type_name)?.to_string()
                } else {
                    event
                        .content
                        .as_deref()
                        .filter(|content| !content.trim().is_empty())
                        .map(ToString::to_string)
                        .unwrap_or_else(|| event.type_name.replace('.', " "))
                };
                Some(PublicArtHistoryEvent {
                    seq: event.seq,
                    summary,
                })
            })
            .take(if subject_kind == "location" { 6 } else { 12 })
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        let history_entries = public_history
            .iter()
            .map(|event| event.summary.clone())
            .collect::<Vec<_>>();
        let history = community_art_prompt_history(subject_kind, &history_entries);
        let prompt = build_community_art_prompt(
            subject_kind,
            &card.display_name,
            &card.title,
            &card.blurb,
            level,
            &subject_details,
            &history,
            image_policy,
        );
        let persisted_identity = format!("{} — {}", card.display_name, card.title);
        let stable_traits =
            crate::stable_art_traits(subject_kind, &persisted_identity, &subject_details);
        let persisted_visual_description = stable_traits.join(". ");
        let existing_evolution_job = self
            .community_art_generations
            .get(&community_art_generation_key(
                subject_kind,
                subject_id,
                level,
            ))
            .and_then(|generation| generation.evolution_job.clone());
        let generation_policy = (subject_kind == "location")
            .then(|| self.generated_pathway_for_location(subject_id))
            .flatten()
            .map(|pathway| pathway.generation_policy.clone())
            .unwrap_or_default();
        Ok(CommunityArtPlan {
            subject_kind: subject_kind.to_string(),
            subject_id,
            level,
            generation_profile_version,
            generation_policy,
            required_orbs: i32::from(level.max(1)),
            history_through_seq,
            prompt,
            aspect_ratio: aspect_ratio.to_string(),
            image_policy,
            persisted_identity,
            persisted_visual_description,
            stable_traits,
            public_history,
            evolution_job: existing_evolution_job,
        })
    }

    #[allow(clippy::too_many_arguments)] // Mirrors the durable funding mutation fields.
    pub(super) fn apply_fund_community_art_projection(
        &mut self,
        subject_kind: &str,
        subject_id: u64,
        level: u8,
        required_orbs: i32,
        contributor_actor_id: u64,
        intent_id: &str,
        amount: i32,
        history_through_seq: u64,
        evolution_job: Option<FrozenCommunityArtEvolutionJob>,
    ) -> Option<EventView> {
        let key = community_art_generation_key(subject_kind, subject_id, level);
        let generation = self
            .community_art_generations
            .entry(key)
            .or_insert_with(|| CommunityArtGenerationState {
                subject_kind: subject_kind.to_string(),
                subject_id,
                level,
                generation_profile_version: community_art_generation_profile_version(subject_kind),
                generation_policy: GeneratedPolicyBinding::default(),
                required_orbs: required_orbs.max(1),
                funded_orbs: 0,
                contributions: BTreeMap::new(),
                funding_intent_ids: BTreeSet::new(),
                status: "funding".to_string(),
                history_through_seq,
                revision: 0,
                provider_attempts: 0,
                review_attempts: 0,
                last_prediction_id: None,
                last_error_code: None,
                status_event_seq: None,
                evolution_job: evolution_job.clone(),
                frozen_plan: None,
            });
        if generation.evolution_job.is_none() {
            generation.evolution_job = evolution_job;
        }
        if !intent_id.is_empty() && !generation.funding_intent_ids.insert(intent_id.to_string()) {
            return None;
        }
        let accepted = amount.max(0).min(
            generation
                .required_orbs
                .saturating_sub(generation.funded_orbs),
        );
        if accepted > 0 {
            generation.funded_orbs += accepted;
            *generation
                .contributions
                .entry(contributor_actor_id)
                .or_insert(0) += accepted;
            generation.history_through_seq =
                generation.history_through_seq.max(history_through_seq);
            if generation.funded_orbs >= generation.required_orbs {
                generation.status = "funded".to_string();
            }
        }
        let funding_reason = format!(
            "{}:{}:level:{}:{}/{}",
            subject_kind, subject_id, level, generation.funded_orbs, generation.required_orbs
        );
        Some(self.append_async_job_event(
            "community_art.funded",
            contributor_actor_id,
            None,
            Some(funding_reason),
        ))
    }

    pub(super) fn apply_legacy_community_art_status_projection(
        &mut self,
        action_actor_id: u64,
        subject_kind: &str,
        subject_id: u64,
        level: u8,
        status: &str,
    ) -> Option<EventView> {
        let key = community_art_generation_key(subject_kind, subject_id, level);
        let generation = self.community_art_generations.get_mut(&key)?;
        if generation.status != status && matches!(status, "ready" | "rejected") {
            generation.revision = generation.revision.saturating_add(1);
        }
        if matches!(status, "failed" | "rejected") {
            generation.provider_attempts = MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS;
            generation.last_error_code = Some("legacy_community_art_failure".to_string());
        }
        generation.status = status.to_string();
        let event = self.append_async_job_event(
            &format!("community_art.{status}"),
            action_actor_id,
            None,
            Some(format!("{subject_kind}:{subject_id}:level:{level}")),
        );
        if let Some(generation) = self.community_art_generations.get_mut(&key) {
            generation.status_event_seq = Some(event.seq);
        }
        Some(event)
    }

    #[allow(clippy::too_many_arguments)] // Mirrors the durable begin-generation mutation.
    pub(super) fn apply_begin_community_art_generation_projection(
        &mut self,
        action_actor_id: u64,
        subject_kind: &str,
        subject_id: u64,
        level: u8,
        provider_attempt: bool,
        generation_profile_version: u8,
        generation_policy: &GeneratedPolicyBinding,
        frozen_plan: Option<&CommunityArtPlan>,
    ) -> Option<EventView> {
        let key = community_art_generation_key(subject_kind, subject_id, level);
        let generation = self.community_art_generations.get_mut(&key)?;
        if generation.generation_policy.is_empty() {
            generation.generation_policy = generation_policy.clone();
        } else if &generation.generation_policy != generation_policy {
            return None;
        }
        if generation_profile_version > generation.generation_profile_version {
            generation.generation_profile_version = generation_profile_version;
            generation.provider_attempts = 0;
            generation.frozen_plan = frozen_plan.cloned();
        } else if generation.frozen_plan.is_none() {
            generation.frozen_plan = frozen_plan.cloned();
        }
        if provider_attempt {
            generation.provider_attempts = generation.provider_attempts.saturating_add(1);
        }
        generation.status = if provider_attempt {
            "generating".to_string()
        } else {
            "reviewing".to_string()
        };
        generation.last_error_code = None;
        Some(self.append_async_job_event(
            if provider_attempt {
                "community_art.generating"
            } else {
                "community_art.reviewing"
            },
            action_actor_id,
            None,
            Some(format!("{subject_kind}:{subject_id}:level:{level}")),
        ))
    }

    #[allow(clippy::too_many_arguments)] // Mirrors the durable completion mutation fields.
    pub(super) fn apply_complete_community_art_generation_projection(
        &mut self,
        action_actor_id: u64,
        subject_kind: &str,
        subject_id: u64,
        level: u8,
        status: &str,
        prediction_id: Option<&str>,
        error_code: Option<&str>,
    ) -> Option<EventView> {
        let key = community_art_generation_key(subject_kind, subject_id, level);
        let generation = self.community_art_generations.get_mut(&key)?;
        if generation.status != status && matches!(status, "ready" | "rejected" | "policy_rejected")
        {
            generation.revision = generation.revision.saturating_add(1);
        }
        if matches!(status, "review_failed" | "review_unavailable") {
            // Saturating keeps journal replay and snapshot load on the same
            // value once the cap is reached.
            generation.review_attempts = generation
                .review_attempts
                .saturating_add(1)
                .min(MAX_COMMUNITY_ART_REVIEW_ATTEMPTS);
        }
        generation.status = status.to_string();
        generation.last_prediction_id = prediction_id.map(ToString::to_string);
        generation.last_error_code = error_code.map(ToString::to_string);
        Some(self.append_async_job_event(
            &format!("community_art.{status}"),
            action_actor_id,
            None,
            Some(format!("{subject_kind}:{subject_id}:level:{level}")),
        ))
    }
}

pub(super) async fn continue_community_art_generation(
    state: &AppState,
    actor_id: u64,
    plan: CommunityArtPlan,
) {
    let queue_self_description = if plan.subject_kind == "actor" {
        let runtime = state.inner.lock().await;
        runtime
            .community_art_generations
            .get(&community_art_generation_key(
                "actor",
                plan.subject_id,
                plan.level,
            ))
            .is_some_and(|generation| generation.funded_orbs >= generation.required_orbs)
            && runtime.avatar_requires_self_description(plan.subject_id, plan.level)
    } else {
        false
    };
    if queue_self_description {
        if let Err(error) = queue_avatar_self_description(state, plan.subject_id).await {
            warn!(
                actor_id = plan.subject_id,
                level = plan.level,
                "fully funded portrait could not queue its persona self-description: {error}"
            );
        }
        return;
    }
    schedule_community_art_generation(state, actor_id, plan);
}

pub(super) async fn resume_avatar_art_after_self_description(state: &AppState, actor_id: u64) {
    let plan = {
        let runtime = state.inner.lock().await;
        let Some(actor) = runtime.actor_by_id(actor_id) else {
            return;
        };
        let level = actor.stats.level.max(1);
        let Some(generation) = runtime
            .community_art_generations
            .get(&community_art_generation_key("actor", actor_id, level))
        else {
            return;
        };
        if generation.funded_orbs < generation.required_orbs || generation.status != "funded" {
            return;
        }
        runtime.community_art_plan(actor_id, "actor", actor_id).ok()
    };
    if let Some(plan) = plan {
        schedule_community_art_generation(state, actor_id, plan);
    }
}

pub(super) async fn preflight_community_art_funding(
    generation_config: &ReplicateAvatarArtConfig,
    policy_config: Option<&AiConfig>,
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<(), CommunityArtGenerationError> {
    let policy_config = policy_config.ok_or(CommunityArtGenerationError::PolicyUnavailable)?;
    let media_brief = community_art_media_brief(plan);
    media_brief
        .validate()
        .map_err(CommunityArtGenerationError::BriefInvalid)?;
    preflight_community_art_storage(generated_asset_dir, plan)?;
    // This performs the same media-registry resolution, provider request
    // construction, stale-brief migration, route/cooldown check,
    // saved-candidate validation, and quarantine recovery as the funded worker,
    // but never calls Replicate. It must run before the exact-brief storage
    // probe so an auditable legacy provider-failure record can be retired.
    prepare_community_art_generation(generation_config, generated_asset_dir, plan)?;
    preflight_media_verdict_storage(generated_asset_dir, &media_brief)
        .map_err(CommunityArtGenerationError::Storage)?;
    let review_policy = community_art_review_policy(&media_brief, plan);
    let capability_policy = community_art_reviewer_capability_policy(&review_policy);
    let decision = request_image_policy_decision(
        policy_config,
        ImagePolicyRequest {
            feature: "media.community_art_publication_preflight",
            image_url: POLICY_PREFLIGHT_IMAGE_URL,
            policy: &capability_policy,
            timeout: Duration::from_secs(10),
            max_attempts: 1,
            referer: "https://cosyworld.fly.dev",
        },
    )
    .await
    .map_err(|error| CommunityArtGenerationError::PolicyReview(error.to_string()))?;
    if !decision.allowed {
        return Err(CommunityArtGenerationError::PolicyReview(format!(
            "the known-safe policy preflight image was rejected: {}",
            if decision.violations.is_empty() {
                "unspecified violation".to_string()
            } else {
                decision.violations.join(", ")
            }
        )));
    }
    Ok(())
}

fn community_art_review_policy(media_brief: &FrozenMediaBrief, plan: &CommunityArtPlan) -> String {
    let mut review_policy = media_brief.review_policy();
    if let Some(policy) = plan.image_policy {
        review_policy.push(' ');
        review_policy.push_str(policy.review());
    }
    review_policy
}

fn community_art_reviewer_capability_policy(review_policy: &str) -> String {
    format!(
        "This is a publication-reviewer capability check, not a candidate verdict. Allow the known-safe fixture only if it is a uniform solid-green square with no visible person, character, creature, text, logo, watermark, or UI chrome. Confirm that you can receive and evaluate the production policy below, but do not apply its subject-identity or environment requirements to this synthetic fixture. Production policy: {review_policy}"
    )
}

fn preflight_community_art_storage(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<(), CommunityArtGenerationError> {
    let candidate_path = community_art_candidate_image_path(generated_asset_dir, plan);
    let candidate_parent = candidate_path.parent().ok_or_else(|| {
        CommunityArtGenerationError::Storage(
            "community-art candidate path has no parent".to_string(),
        )
    })?;
    let public_path =
        stored_community_art_image_path(generated_asset_dir, &plan.subject_kind, plan.subject_id);
    let public_parent = public_path.parent().ok_or_else(|| {
        CommunityArtGenerationError::Storage(
            "community-art publication path has no parent".to_string(),
        )
    })?;
    let quarantine_root = community_art_candidate_quarantine_root(generated_asset_dir, plan);
    for (directory, label) in [
        (candidate_parent, "candidate"),
        (quarantine_root.as_path(), "quarantine"),
        (public_parent, "publication"),
    ] {
        preflight_community_art_directory(directory, label)
            .map_err(CommunityArtGenerationError::Storage)?;
    }
    Ok(())
}

fn preflight_community_art_directory(directory: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| {
        format!(
            "failed to create community-art {label} directory {}: {error}",
            directory.display()
        )
    })?;
    let probe = directory.join(format!(
        ".preflight-{label}-{}-{}-{}",
        std::process::id(),
        now_millis(),
        crate::random_hex(6)
    ));
    let renamed = probe.with_extension("ready");
    let result = (|| -> io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)?;
        file.write_all(b"cosyworld-community-art-preflight")?;
        file.sync_all()?;
        drop(file);
        fs::rename(&probe, &renamed)?;
        fs::remove_file(&renamed)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&probe);
        let _ = fs::remove_file(&renamed);
        return Err(format!(
            "community-art {label} storage probe failed in {}: {error}",
            directory.display()
        ));
    }
    Ok(())
}

enum PreparedCommunityArtSource {
    Candidate {
        image: DownloadedReplicateImage,
        evolution_canary: bool,
    },
    Provider {
        primary: PreparedReplicateExecution,
        shadow: Option<PreparedReplicateExecution>,
        evolution_canary: bool,
    },
}

pub(super) struct PreparedCommunityArtGeneration {
    config: ReplicateAvatarArtConfig,
    media_brief: FrozenMediaBrief,
    source: PreparedCommunityArtSource,
}

impl PreparedCommunityArtGeneration {
    pub(super) fn provider_attempt(&self) -> bool {
        matches!(self.source, PreparedCommunityArtSource::Provider { .. })
    }
}

pub(super) fn prepare_community_art_generation(
    config: &ReplicateAvatarArtConfig,
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<PreparedCommunityArtGeneration, CommunityArtGenerationError> {
    let config = resolve_generation_media_config(
        config,
        plan.generation_policy.media.as_ref(),
        &plan.aspect_ratio,
    )
    .map_err(CommunityArtGenerationError::Preflight)?;
    let media_brief = community_art_media_brief(plan);
    media_brief
        .validate()
        .map_err(CommunityArtGenerationError::BriefInvalid)?;
    let job_key = media_brief.job_key.clone();
    let retry_preparation =
        prepare_rejected_media_candidate_replacement(generated_asset_dir, media_brief.clone())
            .map_err(CommunityArtGenerationError::Storage)?;
    if retry_preparation.migrated {
        warn!(
            event = "community_art_media_brief_migrated",
            job_key,
            generation_profile_version = plan.generation_profile_version,
            "retired an obsolete media verdict record before retrying generation"
        );
    }
    if retry_preparation.discard_staged_candidate {
        remove_community_art_candidate(generated_asset_dir, plan)
            .map_err(CommunityArtGenerationError::Storage)?;
    }
    // A frozen evolution job always carries an approved prior-level parent.
    // Running the base generator here silently starts over, so evolution is a
    // hard reference-preserving route rather than a probabilistic canary.
    let evolution_route = if plan.evolution_job.is_some() {
        EvolutionRolloutRoute::Canary
    } else {
        EvolutionRolloutRoute::Incumbent
    };
    let candidate = match load_route_compatible_community_art_candidate(
        generated_asset_dir,
        plan,
        evolution_route,
    ) {
        Ok(candidate) => candidate,
        Err(error) => {
            quarantine_invalid_community_art_candidate(generated_asset_dir, plan, &error)
                .map_err(CommunityArtGenerationError::CandidateQuarantine)?;
            None
        }
    };
    if let Some((image, evolution_canary)) = candidate {
        return Ok(PreparedCommunityArtGeneration {
            config,
            media_brief,
            source: PreparedCommunityArtSource::Candidate {
                image,
                evolution_canary,
            },
        });
    }
    if !media_provider_route_available(generated_asset_dir, &job_key)
        .map_err(CommunityArtGenerationError::Storage)?
    {
        return Err(CommunityArtGenerationError::ProviderUnavailable(
            "generated-image provider route is cooling down or disabled".to_string(),
        ));
    }

    let prepare_base = || {
        prepare_replicate_art(
            &config,
            community_art_generation_request(&config, plan),
            &plan.aspect_ratio,
            &plan.subject_kind,
            plan.subject_id,
            plan.level,
        )
        .map_err(CommunityArtGenerationError::Preflight)
    };
    let prepare_evolution = || {
        let job = plan.evolution_job.as_ref().ok_or_else(|| {
            CommunityArtGenerationError::Preflight(
                "evolution route is missing its frozen job".to_string(),
            )
        })?;
        let reference = frozen_evolution_reference(job);
        prepare_replicate_evolution_art(&config, generated_asset_dir, job, &reference)
            .map_err(CommunityArtGenerationError::Preflight)
    };
    let source = match evolution_route {
        EvolutionRolloutRoute::Canary => PreparedCommunityArtSource::Provider {
            primary: prepare_evolution()?,
            shadow: None,
            evolution_canary: true,
        },
        EvolutionRolloutRoute::Shadow => PreparedCommunityArtSource::Provider {
            primary: prepare_base()?,
            shadow: Some(prepare_evolution()?),
            evolution_canary: false,
        },
        EvolutionRolloutRoute::Incumbent | EvolutionRolloutRoute::AutomaticRollback => {
            PreparedCommunityArtSource::Provider {
                primary: prepare_base()?,
                shadow: None,
                evolution_canary: false,
            }
        }
    };
    Ok(PreparedCommunityArtGeneration {
        config,
        media_brief,
        source,
    })
}

fn community_art_outcome_without_provider(
    error: CommunityArtGenerationError,
) -> CommunityArtGenerationOutcome {
    CommunityArtGenerationOutcome {
        result: Err(error),
        prediction_id: None,
        reused_candidate: false,
        asset_id: None,
        provider_executions: Vec::new(),
    }
}

fn community_art_provider_execution(
    request: &PreparedReplicateExecution,
    feature: &'static str,
    succeeded: bool,
) -> CommunityArtProviderExecution {
    CommunityArtProviderExecution {
        feature,
        provider: request.provider().to_string(),
        model: request.model().to_string(),
        succeeded,
    }
}

#[cfg(test)]
pub(super) async fn generate_and_store_community_art(
    config: &ReplicateAvatarArtConfig,
    policy_config: Option<&AiConfig>,
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> CommunityArtGenerationOutcome {
    match prepare_community_art_generation(config, generated_asset_dir, plan) {
        Ok(prepared) => {
            generate_and_store_prepared_community_art(
                policy_config,
                generated_asset_dir,
                plan,
                prepared,
            )
            .await
        }
        Err(error) => community_art_outcome_without_provider(error),
    }
}

async fn generate_and_store_prepared_community_art(
    policy_config: Option<&AiConfig>,
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    prepared: PreparedCommunityArtGeneration,
) -> CommunityArtGenerationOutcome {
    let PreparedCommunityArtGeneration {
        config,
        media_brief,
        source,
    } = prepared;
    let config = &config;
    let job_key = media_brief.job_key.clone();
    let mut provider_executions = Vec::new();
    let (image, reused_candidate, evolution_canary) = match source {
        PreparedCommunityArtSource::Candidate {
            image,
            evolution_canary,
        } => (image, true, evolution_canary),
        PreparedCommunityArtSource::Provider {
            primary,
            shadow,
            evolution_canary,
        } => {
            let primary_feature = if evolution_canary {
                "community_image_evolution_canary"
            } else {
                "community_image_generation"
            };
            let request = if let Some(shadow) = shadow {
                let (primary_result, shadow_result) = tokio::join!(
                    execute_prepared_replicate_art(config, &primary),
                    execute_prepared_replicate_art(config, &shadow)
                );
                provider_executions.push(community_art_provider_execution(
                    &primary,
                    primary_feature,
                    primary_result.is_ok(),
                ));
                provider_executions.push(community_art_provider_execution(
                    &shadow,
                    "community_image_evolution_shadow",
                    shadow_result.is_ok(),
                ));
                match shadow_result {
                    Ok(shadow_image) => {
                        if let Err(error) =
                            store_community_art_shadow(generated_asset_dir, plan, &shadow_image)
                        {
                            warn!("failed to store private evolution shadow: {error}");
                        }
                    }
                    Err(error) => warn!("evolution shadow comparison failed: {error}"),
                }
                primary_result
            } else {
                let result = execute_prepared_replicate_art(config, &primary).await;
                provider_executions.push(community_art_provider_execution(
                    &primary,
                    primary_feature,
                    result.is_ok(),
                ));
                result
            };
            let image = match request {
                Ok(image) => image,
                Err(error) => {
                    // All deterministic validation and request construction ran
                    // before the durable provider attempt. Never discard this
                    // failure: a lost cooldown is an uncapped paid retry.
                    if let Err(cooldown_error) = record_media_provider_failure(
                        generated_asset_dir,
                        media_brief.clone(),
                        if evolution_canary {
                            "replicate-evolution-canary"
                        } else {
                            "replicate-primary"
                        },
                    ) {
                        warn!(
                            "failed to record the generated-image provider cooldown for {}: {}",
                            job_key, cooldown_error
                        );
                    }
                    return CommunityArtGenerationOutcome {
                        result: Err(CommunityArtGenerationError::Provider(error)),
                        prediction_id: None,
                        reused_candidate: false,
                        asset_id: None,
                        provider_executions,
                    };
                }
            };
            let stored = if evolution_canary {
                store_community_art_candidate_with_route(generated_asset_dir, plan, &image, true)
            } else {
                store_community_art_candidate(generated_asset_dir, plan, &image)
            };
            if let Err(error) = stored {
                return CommunityArtGenerationOutcome {
                    prediction_id: image.prediction_id.clone(),
                    result: Err(CommunityArtGenerationError::Storage(error)),
                    reused_candidate: false,
                    asset_id: None,
                    provider_executions,
                };
            }
            (image, false, evolution_canary)
        }
    };

    let prediction_id = image.prediction_id.clone();
    let result = async {
        let prior_public = fs::read(stored_community_art_image_path(
            generated_asset_dir,
            &plan.subject_kind,
            plan.subject_id,
        ))
        .ok();
        let disposition = prepare_media_candidate(
            generated_asset_dir,
            media_brief.clone(),
            MediaCandidateInput {
                image: &image,
                provider: "replicate",
                model: &config.model,
                claimed_digest: None,
                prior_public_bytes: prior_public.as_deref(),
            },
        )
        .map_err(CommunityArtGenerationError::Storage)?;
        let candidate_digest = media_candidate_digest(generated_asset_dir, &job_key)
            .map_err(CommunityArtGenerationError::Storage)?
            .ok_or_else(|| {
                CommunityArtGenerationError::Storage(
                    "generated-image gate lost its active candidate".to_string(),
                )
            })?;
        match disposition {
            MediaVerdictDisposition::Rejected => {
                return Err(CommunityArtGenerationError::PolicyRejected(
                    media_candidate_violations(generated_asset_dir, &job_key, &candidate_digest)
                        .map_err(CommunityArtGenerationError::Storage)?,
                ));
            }
            MediaVerdictDisposition::Disabled | MediaVerdictDisposition::ReplaceRequested => {
                return Err(CommunityArtGenerationError::PolicyReview(
                    "generated-image recipe is disabled or awaiting replacement".to_string(),
                ));
            }
            MediaVerdictDisposition::Approved => {}
            MediaVerdictDisposition::ReviewPending => {
                let policy_config =
                    policy_config.ok_or(CommunityArtGenerationError::PolicyUnavailable)?;
                let review_policy = community_art_review_policy(&media_brief, plan);
                let image_url = community_art_candidate_data_url(&image)?;
                let decision = request_image_policy_decision(
                    policy_config,
                    ImagePolicyRequest {
                        feature: "media.generated_image_verdict",
                        image_url: &image_url,
                        policy: &review_policy,
                        timeout: Duration::from_secs(30),
                        max_attempts: 2,
                        referer: "https://cosyworld.fly.dev",
                    },
                )
                .await
                .map_err(|error| {
                    let _ = record_media_review_unavailable(
                        generated_asset_dir,
                        &job_key,
                        &candidate_digest,
                        &error.to_string(),
                    );
                    CommunityArtGenerationError::PolicyReview(error.to_string())
                })?;
                let violations = decision
                    .violations
                    .iter()
                    .map(|violation| media_violation_from_policy(violation))
                    .collect::<Vec<_>>();
                if !decision.allowed {
                    warn!(
                        event = "community_art_candidate_policy_rejected",
                        job_key,
                        subject_kind = plan.subject_kind,
                        subject_id = plan.subject_id,
                        level = plan.level,
                        candidate_digest,
                        reviewer_model = policy_config.vision_model,
                        reviewer_attempts = decision.attempts,
                        reviewer_latency_ms = decision.latency.as_millis() as u64,
                        violations = ?decision.violations,
                        "generated image candidate was withheld by publication policy"
                    );
                }
                let verdict = make_visual_verdict(
                    &media_brief,
                    candidate_digest.clone(),
                    "openai-compatible-vision",
                    &policy_config.vision_model,
                    decision.allowed,
                    violations,
                    decision.summary,
                    decision.attempts,
                    decision.latency.as_millis() as u64,
                    0,
                )
                .map_err(CommunityArtGenerationError::Storage)?;
                let disposition =
                    record_media_visual_verdict(generated_asset_dir, &job_key, verdict)
                        .map_err(CommunityArtGenerationError::Storage)?;
                if disposition != MediaVerdictDisposition::Approved {
                    return Err(CommunityArtGenerationError::PolicyRejected(
                        media_candidate_violations(
                            generated_asset_dir,
                            &job_key,
                            &candidate_digest,
                        )
                        .map_err(CommunityArtGenerationError::Storage)?,
                    ));
                }
            }
        }
        if !media_candidate_approved(generated_asset_dir, &job_key, &candidate_digest)
            .map_err(CommunityArtGenerationError::Storage)?
        {
            return Err(CommunityArtGenerationError::PolicyReview(
                "generated-image candidate has no durable approving verdict".to_string(),
            ));
        }
        if plan.evolution_job.is_none() {
            store_community_art_image(generated_asset_dir, plan, &image)
                .map_err(CommunityArtGenerationError::Storage)?;
        }
        let provenance = community_art_asset_provenance(
            config,
            plan,
            image.prediction_id.clone(),
            evolution_canary,
        );
        if evolution_canary {
            let frozen_reference = plan
                .evolution_job
                .as_ref()
                .map(frozen_evolution_reference)
                .ok_or_else(|| {
                    CommunityArtGenerationError::Storage(
                        "evolution candidate is missing its frozen job".to_string(),
                    )
                })?;
            register_derived_community_media_asset(
                generated_asset_dir,
                &plan.subject_kind,
                plan.subject_id,
                plan.level,
                &image.bytes,
                &image.content_type,
                &frozen_reference,
                &plan.aspect_ratio,
                provenance,
            )
        } else {
            register_generated_media_asset(
                generated_asset_dir,
                &plan.subject_kind,
                plan.subject_id,
                plan.level,
                &image.bytes,
                &image.content_type,
                provenance,
            )
        }
        .map_err(CommunityArtGenerationError::Storage)
    }
    .await;

    let (result, asset_id) = match result {
        Ok(asset_id) => (Ok(()), Some(asset_id)),
        Err(error) => (Err(error), None),
    };
    CommunityArtGenerationOutcome {
        result,
        prediction_id,
        reused_candidate,
        asset_id,
        provider_executions,
    }
}

fn community_art_asset_provenance(
    config: &ReplicateAvatarArtConfig,
    plan: &CommunityArtPlan,
    prediction_id: Option<String>,
    evolution_canary: bool,
) -> MediaAssetProvenance {
    let manifest = &active_content().manifest;
    MediaAssetProvenance {
        pack_id: manifest.id.clone(),
        pack_version: manifest.version.to_string(),
        composition_id: format!(
            "community-art:{}:{}:level:{}",
            plan.subject_kind, plan.subject_id, plan.level
        ),
        composition_revision: plan
            .evolution_job
            .as_ref()
            .and_then(|job| job.digest().ok())
            .unwrap_or_else(|| plan.generation_profile_version.to_string()),
        provider: "replicate".to_string(),
        model: if evolution_canary {
            "black-forest-labs/flux-kontext-dev-lora".to_string()
        } else {
            config.model.clone()
        },
        model_version: if evolution_canary {
            EVOLUTION_EXECUTION_MODEL_REVISION.to_string()
        } else {
            config
                .version
                .clone()
                .unwrap_or_else(|| "provider-default".to_string())
        },
        prompt_version: format!(
            "cosyworld.community-art.generation-profile/{}/{}",
            plan.generation_profile_version,
            if evolution_canary {
                "kontext-lora-evolution"
            } else {
                "incumbent"
            }
        ),
        recipe_id: Some(if evolution_canary {
            EVOLUTION_EXECUTION_RECIPE.to_string()
        } else {
            "replicate.flux1-dev-lora.base".to_string()
        }),
        lora_weights: config.lora_url.clone(),
        lora_scale: config
            .lora_url
            .as_ref()
            .map(|_| config.lora_scale.to_string()),
        seed: None,
        prediction_id,
        source_event_seq: None,
        history_through_seq: plan.history_through_seq,
    }
}

pub(super) fn community_art_media_brief(plan: &CommunityArtPlan) -> FrozenMediaBrief {
    let mut brief = FrozenMediaBrief::new(
        community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level),
        format!(
            "cosyworld.community-art/{}/{}",
            plan.generation_profile_version,
            if plan.evolution_job.is_some() {
                "evolution"
            } else {
                "base"
            }
        ),
        format!("public {} progression art", plan.subject_kind),
        &plan.prompt,
        &plan.aspect_ratio,
    );
    brief.required_subjects = if plan.subject_kind == "location" {
        Vec::new()
    } else {
        bounded_brief_constraints([format!(
            "{} {} ({})",
            plan.subject_kind, plan.persisted_identity, plan.persisted_visual_description
        )])
    };
    if plan.subject_kind == "location" {
        brief.required_environment = bounded_brief_constraints([
            plan.persisted_identity.clone(),
            plan.persisted_visual_description.clone(),
        ]);
        brief
            .forbidden
            .push("people, characters, creatures, silhouettes, faces, or body parts".to_string());
    }
    brief.pack_negative_constraints = Vec::new();
    if let Some(job) = &plan.evolution_job {
        brief
            .approved_reference_digests
            .push(job.prior_asset_digest.clone());
    }
    brief
}

fn media_violation_from_policy(value: &str) -> MediaViolation {
    match value {
        "safety" => MediaViolation::Safety,
        "text" => MediaViolation::Text,
        "logo" => MediaViolation::Logo,
        "watermark" => MediaViolation::Watermark,
        "system_leak" => MediaViolation::SystemLeak,
        "ui_chrome" => MediaViolation::UiChrome,
        "missing_subject" => MediaViolation::MissingSubject,
        "identity_drift" => MediaViolation::IdentityDrift,
        "missing_item" => MediaViolation::MissingItem,
        "wrong_holder" => MediaViolation::WrongHolder,
        "wrong_environment" => MediaViolation::WrongEnvironment,
        "bad_crop" => MediaViolation::BadCrop,
        "pack_negative" => MediaViolation::PackNegative,
        "person" | "character" | "creature" | "extra_subject" => MediaViolation::ExtraSubject,
        _ => MediaViolation::Safety,
    }
}

fn legacy_community_art_asset_provenance(
    state: &AppState,
    generation: &CommunityArtGenerationState,
) -> MediaAssetProvenance {
    let manifest = &active_content().manifest;
    let config = state.avatar_art_config.as_ref().as_ref();
    MediaAssetProvenance {
        pack_id: manifest.id.clone(),
        pack_version: manifest.version.to_string(),
        composition_id: format!(
            "community-art:{}:{}:level:{}",
            generation.subject_kind, generation.subject_id, generation.level
        ),
        composition_revision: generation.generation_profile_version.to_string(),
        provider: "replicate".to_string(),
        model: config
            .map(|config| config.model.clone())
            .unwrap_or_else(|| "legacy-flux-1".to_string()),
        model_version: config
            .and_then(|config| config.version.clone())
            .unwrap_or_else(|| "legacy-provider-default".to_string()),
        prompt_version: format!(
            "cosyworld.community-art.generation-profile/{}",
            generation.generation_profile_version
        ),
        recipe_id: Some("replicate.flux1-dev-lora.base".to_string()),
        lora_weights: config.and_then(|config| config.lora_url.clone()),
        lora_scale: config.and_then(|config| {
            config
                .lora_url
                .as_ref()
                .map(|_| config.lora_scale.to_string())
        }),
        seed: None,
        prediction_id: generation.last_prediction_id.clone(),
        source_event_seq: generation.status_event_seq,
        history_through_seq: generation.history_through_seq,
    }
}

pub(super) fn community_art_generation_request(
    config: &ReplicateAvatarArtConfig,
    plan: &CommunityArtPlan,
) -> String {
    let prompt_prefix = plan
        .generation_policy
        .media
        .as_ref()
        .map(|media| media.prompt_prefix.as_str())
        .filter(|prefix| !prefix.trim().is_empty())
        .or_else(|| {
            plan.image_policy
                .map(CommunityArtImagePolicy::generation_prompt_prefix)
        })
        .unwrap_or(&config.prompt_prefix);
    crate::compact_whitespace(&format!("{prompt_prefix}, {}", plan.prompt))
}

static COMMUNITY_ART_JOBS: OnceLock<StdMutex<BTreeSet<String>>> = OnceLock::new();

fn community_art_jobs() -> &'static StdMutex<BTreeSet<String>> {
    COMMUNITY_ART_JOBS.get_or_init(|| StdMutex::new(BTreeSet::new()))
}

pub(super) async fn begin_community_art_generation(
    state: &AppState,
    actor_id: u64,
    plan: &CommunityArtPlan,
    provider_attempt: bool,
) -> Option<bool> {
    let mut runtime = state.inner.lock().await;
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let generation = runtime.community_art_generations.get(&key)?;
    let candidate_exists = !provider_attempt;
    if !plan.generation_retryable(generation, candidate_exists) {
        return None;
    }
    if provider_attempt
        && plan.generation_profile_version <= generation.generation_profile_version
        && generation.provider_attempts >= MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    {
        return None;
    }
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record
        .projection_mutations
        .push(ProjectionMutation::BeginCommunityArtGeneration {
            subject_kind: plan.subject_kind.clone(),
            subject_id: plan.subject_id,
            level: plan.level,
            provider_attempt,
            generation_profile_version: plan.generation_profile_version,
            generation_policy: plan.generation_policy.clone(),
            frozen_plan: Some(Box::new(plan.clone())),
        });
    let (commit_status, events) = commit_journal_record(state, &mut runtime, record).ok()?;
    drop(runtime);
    if commit_status == CW_OK {
        broadcast_events(state, &events);
        Some(provider_attempt)
    } else {
        None
    }
}

async fn complete_community_art_generation(
    state: &AppState,
    actor_id: u64,
    plan: &CommunityArtPlan,
    status: &str,
    prediction_id: Option<&str>,
    error_code: Option<&str>,
    preflight_candidate_exists: Option<bool>,
) -> Option<Vec<EventView>> {
    let mut runtime = state.inner.lock().await;
    if let Some(candidate_exists) = preflight_candidate_exists {
        let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
        let generation = runtime.community_art_generations.get(&key)?;
        if !plan.generation_retryable(generation, candidate_exists) {
            return None;
        }
    }
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record
        .projection_mutations
        .push(ProjectionMutation::CompleteCommunityArtGeneration {
            subject_kind: plan.subject_kind.clone(),
            subject_id: plan.subject_id,
            level: plan.level,
            status: status.to_string(),
            prediction_id: prediction_id.map(ToString::to_string),
            error_code: error_code.map(ToString::to_string),
        });
    let (commit_status, events) = commit_journal_record(state, &mut runtime, record).ok()?;
    drop(runtime);
    if commit_status == CW_OK {
        broadcast_events(state, &events);
        Some(events)
    } else {
        None
    }
}

pub(super) fn schedule_community_art_generation(
    state: &AppState,
    actor_id: u64,
    plan: CommunityArtPlan,
) {
    let Some(config) = state.avatar_art_config.as_ref().clone() else {
        return;
    };
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    if let Ok(mut jobs) = community_art_jobs().lock() {
        if !jobs.insert(key.clone()) {
            return;
        }
    }
    let state = state.clone();
    tokio::spawn(async move {
        let started_at = Instant::now();
        let candidate_exists_before_preflight =
            community_art_candidate_availability(&state.generated_asset_dir, &plan)
                != CommunityArtCandidateAvailability::Absent;
        let retryable = {
            let runtime = state.inner.lock().await;
            runtime
                .community_art_generations
                .get(&key)
                .is_some_and(|generation| {
                    plan.generation_retryable(generation, candidate_exists_before_preflight)
                })
        };
        if !retryable {
            if let Ok(mut jobs) = community_art_jobs().lock() {
                jobs.remove(&key);
            }
            return;
        }
        let prepared = prepare_community_art_generation(&config, &state.generated_asset_dir, &plan);
        let provider_attempt = prepared
            .as_ref()
            .map(PreparedCommunityArtGeneration::provider_attempt)
            .unwrap_or(false);
        let preflight_candidate_exists = prepared
            .is_err()
            .then_some(candidate_exists_before_preflight);
        if prepared.is_ok()
            && begin_community_art_generation(&state, actor_id, &plan, provider_attempt)
                .await
                .is_none()
        {
            if let Ok(mut jobs) = community_art_jobs().lock() {
                jobs.remove(&key);
            }
            return;
        }
        let outcome = match prepared {
            Ok(prepared) => {
                generate_and_store_prepared_community_art(
                    state.ai_config.as_ref().as_ref(),
                    &state.generated_asset_dir,
                    &plan,
                    prepared,
                )
                .await
            }
            Err(error) => community_art_outcome_without_provider(error),
        };
        let (status, error_code) = match &outcome.result {
            Ok(()) => ("ready", None),
            Err(error) => {
                warn!(
                    provider_attempt,
                    reused_candidate = outcome.reused_candidate,
                    prediction_id = outcome.prediction_id.as_deref().unwrap_or("unknown"),
                    failure_stage = error.stage(),
                    failure_code = error.code(),
                    "community art generation failed for {}: {}",
                    key,
                    error.message()
                );
                (error.status(), Some(error.code()))
            }
        };
        let events = complete_community_art_generation(
            &state,
            actor_id,
            &plan,
            status,
            outcome.prediction_id.as_deref(),
            error_code,
            preflight_candidate_exists,
        )
        .await;
        if let Some(events) = events.as_ref() {
            if let Err(error) = reconcile_community_media_asset_status(
                &state.generated_asset_dir,
                &plan.subject_kind,
                plan.subject_id,
                plan.level,
                status,
                outcome.prediction_id.as_deref(),
                events.first().map(|event| event.seq),
            ) {
                warn!(
                    "failed to reconcile immutable community art lifecycle for {}: {}",
                    key, error
                );
            }
        }
        if status == "ready" && events.is_some() {
            if outcome.asset_id.is_none() {
                warn!(
                    "ready community art {} has no staged immutable asset; route backfill will reconcile it",
                    key
                );
            }
            let published = if plan.evolution_job.is_some() {
                publish_community_art_candidate(&state.generated_asset_dir, &plan)
            } else {
                Ok(())
            };
            if let Err(error) = published {
                warn!(
                    "failed to publish approved evolution candidate for {}: {}",
                    key, error
                );
            } else if let Err(error) =
                remove_community_art_candidate(&state.generated_asset_dir, &plan)
            {
                warn!(
                    "failed to remove published community art candidate for {}: {}",
                    key, error
                );
            }
        }
        if status == "policy_rejected" && events.is_some() {
            if let Err(error) = remove_community_art_candidate(&state.generated_asset_dir, &plan) {
                warn!(
                    "failed to remove rejected community art candidate for {}: {}",
                    key, error
                );
            }
        }
        for execution in &outcome.provider_executions {
            record_ai_usage_for_provider(
                &state,
                Some(actor_id),
                execution.feature,
                "community_orbs",
                &execution.provider,
                &execution.model,
                if execution.succeeded { "ok" } else { "failed" },
                events
                    .as_ref()
                    .and_then(|events| events.first())
                    .map(|event| event.seq),
                0,
                (!execution.succeeded).then_some("community_art_generation_failed"),
                started_at.elapsed(),
            );
        }
        if let Ok(mut jobs) = community_art_jobs().lock() {
            jobs.remove(&key);
        }
    });
}

pub(super) fn pending_community_art_resumption_plans(
    runtime: &RuntimeWorld,
    generated_asset_dir: &Path,
) -> Vec<(u64, CommunityArtPlan)> {
    runtime
        .community_art_generations
        .values()
        .filter(|generation| {
            let self_description_required = generation.subject_kind == "actor"
                && runtime
                    .avatar_requires_self_description(generation.subject_id, generation.level);
            let interrupted = matches!(
                generation.status.as_str(),
                "funded" | "generating" | "reviewing"
            );
            let stale_brief =
                generation.last_error_code.as_deref() == Some("community_art_storage_failed");
            generation.funded_orbs >= generation.required_orbs
                && (self_description_required || interrupted || stale_brief)
        })
        .filter_map(|generation| {
            generation
                .contributions
                .keys()
                .copied()
                .find_map(|actor_id| {
                    let plan = runtime
                        .community_art_plan(
                            actor_id,
                            &generation.subject_kind,
                            generation.subject_id,
                        )
                        .ok()?;
                    let candidate_exists =
                        community_art_candidate_availability(generated_asset_dir, &plan)
                            != CommunityArtCandidateAvailability::Absent;
                    let self_description_required = generation.subject_kind == "actor"
                        && runtime.avatar_requires_self_description(
                            generation.subject_id,
                            generation.level,
                        );
                    (self_description_required
                        || plan.generation_retryable(generation, candidate_exists))
                    .then_some((actor_id, plan))
                })
        })
        .collect()
}

pub(super) fn pending_avatar_self_description_actor_ids(runtime: &RuntimeWorld) -> Vec<u64> {
    runtime
        .community_art_generations
        .values()
        .filter(|generation| {
            generation.subject_kind == "actor"
                && generation.funded_orbs >= generation.required_orbs
                && runtime
                    .actor_by_id(generation.subject_id)
                    .is_some_and(|actor| actor.stats.level.max(1) == generation.level)
                && runtime.avatar_requires_self_description(generation.subject_id, generation.level)
        })
        .map(|generation| generation.subject_id)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Replaces the in-memory worker that disappears when a deployment interrupts
/// a funded generation. Persona recovery belongs to the subject avatar and is
/// independent of whether the original contributor remains active or nearby.
/// Image generation still resumes only when an eligible contributor can see
/// the subject.
pub(super) fn resume_pending_community_art_generations(state: &AppState) {
    if state.avatar_art_config.as_ref().is_none() {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        let (self_descriptions, resumptions) = {
            let runtime = state.inner.lock().await;
            (
                pending_avatar_self_description_actor_ids(&runtime),
                pending_community_art_resumption_plans(&runtime, &state.generated_asset_dir),
            )
        };
        for actor_id in self_descriptions {
            if let Err(error) = queue_avatar_self_description(&state, actor_id).await {
                warn!(
                    actor_id,
                    "funded portrait could not recover its persona self-description: {error}"
                );
            }
        }
        for (actor_id, plan) in resumptions {
            continue_community_art_generation(&state, actor_id, plan).await;
        }
    });
}

pub(super) fn publish_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<(), String> {
    let image = load_community_art_candidate(generated_asset_dir, plan)?
        .ok_or_else(|| "approved evolution candidate is missing".to_string())?;
    store_community_art_image_with_route(generated_asset_dir, plan, &image.0, image.1)
}

pub(super) fn store_community_art_image(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    store_community_art_image_with_route(generated_asset_dir, plan, image, false)
}

fn store_community_art_image_with_route(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
    evolution_canary: bool,
) -> Result<(), String> {
    let path =
        stored_community_art_image_path(generated_asset_dir, &plan.subject_kind, plan.subject_id);
    let content_type_path = stored_community_art_content_type_path(
        generated_asset_dir,
        &plan.subject_kind,
        plan.subject_id,
    );
    let metadata_path = stored_community_art_metadata_path(
        generated_asset_dir,
        &plan.subject_kind,
        plan.subject_id,
    );
    store_community_art_bundle(
        &path,
        &content_type_path,
        &metadata_path,
        image,
        evolution_canary,
    )
}

pub(super) fn store_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    store_community_art_candidate_with_route(generated_asset_dir, plan, image, false)
}

pub(super) fn store_community_art_candidate_with_route(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
    evolution_canary: bool,
) -> Result<(), String> {
    let quarantine_marker =
        community_art_candidate_quarantine_marker_path(generated_asset_dir, plan);
    if quarantine_marker.exists() {
        return Err(format!(
            "community-art candidate quarantine is incomplete at {}",
            quarantine_marker.display()
        ));
    }
    store_community_art_bundle(
        &community_art_candidate_image_path(generated_asset_dir, plan),
        &community_art_candidate_content_type_path(generated_asset_dir, plan),
        &community_art_candidate_metadata_path(generated_asset_dir, plan),
        image,
        evolution_canary,
    )
}

fn store_community_art_shadow(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    let directory = generated_asset_dir
        .join("media-evolution-shadow")
        .join(&plan.subject_kind)
        .join(plan.subject_id.to_string());
    let stem = format!("level-{}", plan.level);
    store_community_art_bundle(
        &directory.join(format!("{stem}.image")),
        &directory.join(format!("{stem}.content-type")),
        &directory.join(format!("{stem}.metadata.json")),
        image,
        true,
    )
}

fn store_community_art_bundle(
    path: &Path,
    content_type_path: &Path,
    metadata_path: &Path,
    image: &DownloadedReplicateImage,
    evolution_canary: bool,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let metadata = serde_json::to_vec(&community_art_candidate_metadata(image, evolution_canary))
        .map_err(|e| e.to_string())?;
    let temporary_suffix = format!("{}-{}", std::process::id(), now_millis());
    let file_stem = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("community-art");
    let temporary_image_path =
        path.with_file_name(format!(".{file_stem}.image.tmp-{temporary_suffix}"));
    let temporary_content_type_path =
        path.with_file_name(format!(".{file_stem}.content-type.tmp-{temporary_suffix}"));
    let temporary_metadata_path =
        path.with_file_name(format!(".{file_stem}.metadata.tmp-{temporary_suffix}"));
    let stored = (|| -> io::Result<()> {
        fs::write(&temporary_image_path, &image.bytes)?;
        fs::write(&temporary_content_type_path, &image.content_type)?;
        fs::write(&temporary_metadata_path, metadata)?;
        fs::rename(&temporary_metadata_path, metadata_path)?;
        fs::rename(&temporary_content_type_path, content_type_path)?;
        fs::rename(&temporary_image_path, path)?;
        Ok(())
    })();
    if let Err(error) = stored {
        let _ = fs::remove_file(&temporary_image_path);
        let _ = fs::remove_file(&temporary_content_type_path);
        let _ = fs::remove_file(&temporary_metadata_path);
        return Err(error.to_string());
    }
    Ok(())
}

fn community_art_candidate_metadata(
    image: &DownloadedReplicateImage,
    evolution_canary: bool,
) -> CommunityArtCandidateMetadata {
    CommunityArtCandidateMetadata {
        schema_version: COMMUNITY_ART_CANDIDATE_SCHEMA_VERSION,
        content_type: image.content_type.clone(),
        source_url: image.source_url.clone(),
        prediction_id: image.prediction_id.clone(),
        sha256: format!("{:x}", Sha256::digest(&image.bytes)),
        evolution_canary,
    }
}

fn load_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<Option<(DownloadedReplicateImage, bool)>, String> {
    let image_path = community_art_candidate_image_path(generated_asset_dir, plan);
    let content_type_path = community_art_candidate_content_type_path(generated_asset_dir, plan);
    let metadata_path = community_art_candidate_metadata_path(generated_asset_dir, plan);
    let quarantine_marker =
        community_art_candidate_quarantine_marker_path(generated_asset_dir, plan);
    if quarantine_marker.exists() {
        return Err(format!(
            "community-art candidate has an incomplete quarantine marker at {}",
            quarantine_marker.display()
        ));
    }
    let component_exists = [
        image_path.exists(),
        content_type_path.exists(),
        metadata_path.exists(),
    ];
    if component_exists.iter().all(|present| !present) {
        return Ok(None);
    }
    let component_is_file = [
        image_path.is_file(),
        content_type_path.is_file(),
        metadata_path.is_file(),
    ];
    if !component_is_file.iter().all(|present| *present) {
        return Err(format!(
            "stored community-art candidate bundle is incomplete or non-file (image={}, content_type={}, metadata={})",
            component_is_file[0], component_is_file[1], component_is_file[2]
        ));
    }
    let bytes = fs::read(&image_path).map_err(|error| error.to_string())?;
    let content_type = fs::read_to_string(&content_type_path)
        .map_err(|error| error.to_string())?
        .trim()
        .to_ascii_lowercase();
    if !is_safe_image_content_type(&content_type) {
        return Err("stored community-art candidate has an unsafe content type".to_string());
    }
    let metadata = serde_json::from_slice::<CommunityArtCandidateMetadata>(
        &fs::read(metadata_path).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if metadata.schema_version != COMMUNITY_ART_CANDIDATE_SCHEMA_VERSION
        || metadata.content_type != content_type
        || metadata.sha256 != format!("{:x}", Sha256::digest(&bytes))
    {
        return Err("stored community-art candidate metadata did not match its image".to_string());
    }
    Ok(Some((
        DownloadedReplicateImage {
            bytes,
            content_type,
            source_url: metadata.source_url,
            prediction_id: metadata.prediction_id,
        },
        metadata.evolution_canary,
    )))
}

pub(super) fn load_route_compatible_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    route: EvolutionRolloutRoute,
) -> Result<Option<(DownloadedReplicateImage, bool)>, String> {
    let Some((image, stored_evolution_canary)) =
        load_community_art_candidate(generated_asset_dir, plan)?
    else {
        return Ok(None);
    };
    let route_uses_evolution_canary = route == EvolutionRolloutRoute::Canary;
    if stored_evolution_canary == route_uses_evolution_canary {
        return Ok(Some((image, stored_evolution_canary)));
    }

    if stored_evolution_canary {
        store_community_art_shadow(generated_asset_dir, plan, &image)?;
    }
    remove_community_art_candidate(generated_asset_dir, plan)?;
    Ok(None)
}

fn community_art_candidate_data_url(
    image: &DownloadedReplicateImage,
) -> Result<String, CommunityArtGenerationError> {
    if !is_safe_image_content_type(&image.content_type) {
        return Err(CommunityArtGenerationError::Storage(
            "stored community-art candidate has an unsafe content type".to_string(),
        ));
    }
    Ok(format!(
        "data:{};base64,{}",
        image.content_type,
        BASE64_STANDARD.encode(&image.bytes)
    ))
}

#[cfg(test)]
pub(super) fn community_art_candidate_exists(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> bool {
    community_art_candidate_availability(generated_asset_dir, plan)
        == CommunityArtCandidateAvailability::Valid
}

pub(super) fn community_art_candidate_availability(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> CommunityArtCandidateAvailability {
    match load_community_art_candidate(generated_asset_dir, plan) {
        Ok(Some(_)) => CommunityArtCandidateAvailability::Valid,
        Ok(None) => CommunityArtCandidateAvailability::Absent,
        Err(_) => CommunityArtCandidateAvailability::RecoveryRequired,
    }
}

fn quarantine_invalid_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    reason: &str,
) -> Result<PathBuf, String> {
    let marker_path = community_art_candidate_quarantine_marker_path(generated_asset_dir, plan);
    if marker_path.exists() {
        return Err(format!(
            "an earlier quarantine is incomplete at {}; remove or finish it before retrying",
            marker_path.display()
        ));
    }
    let active_paths = [
        community_art_candidate_image_path(generated_asset_dir, plan),
        community_art_candidate_content_type_path(generated_asset_dir, plan),
        community_art_candidate_metadata_path(generated_asset_dir, plan),
    ];
    if !active_paths.iter().any(|path| path.exists()) {
        return Ok(community_art_candidate_quarantine_root(
            generated_asset_dir,
            plan,
        ));
    }

    let quarantine_parent = community_art_candidate_quarantine_root(generated_asset_dir, plan);
    fs::create_dir_all(&quarantine_parent).map_err(|error| {
        format!(
            "failed to create candidate quarantine parent {}: {error}",
            quarantine_parent.display()
        )
    })?;
    let quarantine_directory = (0..32)
        .find_map(|nonce| {
            let path =
                quarantine_parent.join(format!("{}-{}-{nonce}", now_millis(), std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => Some(Ok(path)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(format!(
                    "failed to create candidate quarantine {}: {error}",
                    path.display()
                ))),
            }
        })
        .transpose()?
        .ok_or_else(|| {
            format!(
                "failed to allocate a unique candidate quarantine under {}",
                quarantine_parent.display()
            )
        })?;

    let marker_parent = marker_path.parent().ok_or_else(|| {
        format!(
            "candidate quarantine marker has no parent: {}",
            marker_path.display()
        )
    })?;
    fs::create_dir_all(marker_parent).map_err(|error| {
        format!(
            "failed to create candidate directory {}: {error}",
            marker_parent.display()
        )
    })?;
    let marker = serde_json::to_vec(&serde_json::json!({
        "schema_version": 1,
        "reason": reason,
        "quarantine_directory": quarantine_directory,
        "created_at_ms": now_millis(),
    }))
    .map_err(|error| error.to_string())?;
    let mut marker_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker_path)
        .map_err(|error| {
            format!(
                "failed to activate candidate quarantine marker {}: {error}",
                marker_path.display()
            )
        })?;
    marker_file.write_all(&marker).map_err(|error| {
        format!(
            "failed to write candidate quarantine marker {}: {error}",
            marker_path.display()
        )
    })?;
    marker_file.sync_all().map_err(|error| {
        format!(
            "failed to sync candidate quarantine marker {}: {error}",
            marker_path.display()
        )
    })?;
    drop(marker_file);

    for source in active_paths {
        if !source.exists() {
            continue;
        }
        let file_name = source
            .file_name()
            .ok_or_else(|| format!("candidate path has no file name: {}", source.display()))?;
        let destination = quarantine_directory.join(file_name);
        if let Err(error) = fs::rename(&source, &destination) {
            return Err(format!(
                "candidate quarantine remains active at {} after moving {} failed: {error}",
                marker_path.display(),
                source.display()
            ));
        }
    }
    let archived_marker = quarantine_directory.join("quarantine.json");
    fs::rename(&marker_path, &archived_marker).map_err(|error| {
        format!(
            "candidate quarantine remains active at {} because its marker could not be archived: {error}",
            marker_path.display()
        )
    })?;
    Ok(quarantine_directory)
}

pub(super) fn remove_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<(), String> {
    for path in [
        community_art_candidate_image_path(generated_asset_dir, plan),
        community_art_candidate_content_type_path(generated_asset_dir, plan),
        community_art_candidate_metadata_path(generated_asset_dir, plan),
        community_art_candidate_quarantine_marker_path(generated_asset_dir, plan),
    ] {
        if let Err(error) = fs::remove_file(path) {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error.to_string());
            }
        }
    }
    Ok(())
}

pub(super) fn request_community_art_candidate_replacement(
    root: &Path,
    job_key: &str,
) -> Result<bool, String> {
    let parts = job_key.split(':').collect::<Vec<_>>();
    if parts.len() != 4
        || !matches!(parts[0], "actor" | "item" | "location")
        || parts[2] != "level"
        || parts[1].parse::<u64>().is_err()
        || parts[3].parse::<u8>().is_err()
    {
        return Ok(false);
    }
    let stem = root
        .join("community-art-candidates")
        .join(parts[0])
        .join(parts[1])
        .join(format!("level-{}", parts[3]));
    for extension in ["image", "content-type", "metadata.json", "quarantine.json"] {
        if let Err(error) = fs::remove_file(stem.with_extension(extension)) {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error.to_string());
            }
        }
    }
    Ok(true)
}

fn community_art_dir(root: &Path, subject_kind: &str) -> PathBuf {
    root.join("community-art").join(subject_kind)
}

fn community_art_candidate_dir(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    root.join("community-art-candidates")
        .join(&plan.subject_kind)
        .join(plan.subject_id.to_string())
}

fn community_art_candidate_image_path(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    community_art_candidate_dir(root, plan).join(format!("level-{}.image", plan.level))
}

fn community_art_candidate_content_type_path(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    community_art_candidate_dir(root, plan).join(format!("level-{}.content-type", plan.level))
}

fn community_art_candidate_metadata_path(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    community_art_candidate_dir(root, plan).join(format!("level-{}.metadata.json", plan.level))
}

fn community_art_candidate_quarantine_marker_path(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    community_art_candidate_dir(root, plan).join(format!("level-{}.quarantine.json", plan.level))
}

fn community_art_candidate_quarantine_root(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    root.join("community-art-candidate-quarantine")
        .join(&plan.subject_kind)
        .join(plan.subject_id.to_string())
        .join(format!("level-{}", plan.level))
}

pub(super) fn stored_community_art_image_path(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> PathBuf {
    community_art_dir(root, subject_kind).join(format!("{subject_id}.image"))
}

pub(super) fn stored_community_art_content_type_path(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> PathBuf {
    community_art_dir(root, subject_kind).join(format!("{subject_id}.content-type"))
}

pub(super) fn stored_community_art_metadata_path(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> PathBuf {
    community_art_dir(root, subject_kind).join(format!("{subject_id}.metadata.json"))
}

pub(super) fn stored_community_art_content_type(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> String {
    fs::read_to_string(stored_community_art_content_type_path(
        root,
        subject_kind,
        subject_id,
    ))
    .ok()
    .map(|value| value.trim().to_ascii_lowercase())
    .filter(|value| is_safe_image_content_type(value))
    .unwrap_or_else(|| "image/png".to_string())
}

pub(super) fn community_art_image_url(
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    revision: u32,
) -> String {
    format!(
        "/assets/generated/community/{subject_kind}/{subject_id}.image?level={level}&revision={revision}"
    )
}

pub(super) async fn generated_community_art_asset(
    State(state): State<AppState>,
    AxumPath((subject_kind, asset_file)): AxumPath<(String, String)>,
    Query(query): Query<BTreeMap<String, String>>,
) -> Response {
    if !matches!(subject_kind.as_str(), "actor" | "item" | "location") {
        return (StatusCode::NOT_FOUND, "unknown community artwork").into_response();
    }
    let Some(subject_id) = asset_file
        .strip_suffix(".image")
        .and_then(|value| value.parse::<u64>().ok())
    else {
        return (StatusCode::NOT_FOUND, "unknown community artwork").into_response();
    };
    let generation = {
        let runtime = state.inner.lock().await;
        let Some(current_level) = runtime.community_art_subject_level(&subject_kind, subject_id)
        else {
            return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
        };
        let requested_level = query
            .get("level")
            .and_then(|value| value.parse::<u8>().ok())
            .filter(|level| *level > 0 && *level <= current_level)
            .unwrap_or(current_level);
        runtime
            .community_art_generations
            .get(&crate::community_art_generation_key(
                &subject_kind,
                subject_id,
                requested_level,
            ))
            .cloned()
    };
    let Some(generation) = generation else {
        return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
    };
    if let Err(error) = reconcile_community_media_asset_status(
        &state.generated_asset_dir,
        &subject_kind,
        subject_id,
        generation.level,
        &generation.status,
        generation.last_prediction_id.as_deref(),
        generation.status_event_seq,
    ) {
        warn!(
            "failed to reconcile immutable community artwork {}:{} from durable state: {}",
            subject_kind, subject_id, error
        );
    }
    if generation.status != "ready" {
        return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
    }
    let path =
        stored_community_art_image_path(&state.generated_asset_dir, &subject_kind, subject_id);
    let content_type_path = stored_community_art_content_type_path(
        &state.generated_asset_dir,
        &subject_kind,
        subject_id,
    );
    let metadata_path =
        stored_community_art_metadata_path(&state.generated_asset_dir, &subject_kind, subject_id);
    let created_at_ms = fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_else(now_millis);
    let immutable = if generation.evolution_job.is_some() {
        canonical_community_media_asset_bytes(
            &state.generated_asset_dir,
            &subject_kind,
            subject_id,
            generation.level,
            generation.last_prediction_id.as_deref(),
        )
    } else {
        backfill_legacy_community_asset(
            &state.generated_asset_dir,
            MediaAssetBackfill {
                subject_kind: subject_kind.clone(),
                subject_id,
                level: generation.level,
                revision: generation.revision.max(1),
                image_path: path.clone(),
                content_type_path,
                metadata_path: metadata_path.is_file().then_some(metadata_path),
                created_at_ms,
                provenance: legacy_community_art_asset_provenance(&state, &generation),
            },
        )
        .and_then(|asset_id| immutable_media_asset_bytes(&state.generated_asset_dir, &asset_id))
    };
    let (bytes, content_type) = match immutable {
        Ok(asset) => asset,
        Err(error) => {
            warn!(
                "failed to backfill immutable community artwork {}:{}: {}",
                subject_kind, subject_id, error
            );
            if generation.evolution_job.is_some() {
                return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
            }
            let Ok(bytes) = fs::read(path) else {
                return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
            };
            let content_type = stored_community_art_content_type(
                &state.generated_asset_dir,
                &subject_kind,
                subject_id,
            );
            (bytes, content_type)
        }
    };
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (
                header::CACHE_CONTROL,
                "public, no-cache, must-revalidate".to_string(),
            ),
        ],
        bytes,
    )
        .into_response()
}
