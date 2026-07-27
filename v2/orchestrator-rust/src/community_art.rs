use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex as StdMutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::warn;

use crate::{
    broadcast_events, commit_journal_record, is_safe_image_content_type, now_millis,
    record_ai_usage_for_provider, request_image_policy_decision, request_replicate_art, AiConfig,
    AppState, CwAction, EventView, ImagePolicyRequest, JournalRecord, ProjectionMutation,
    ReplicateAvatarArtConfig, RuntimeWorld, CW_ACTION_NONE, CW_OK,
};

pub(super) const MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS: u8 = 3;
pub(super) const LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION: u8 = 1;
pub(super) const LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION: u8 = 3;
pub(super) const LOCATION_LANDSCAPE_PROMPT_PREFIX: &str =
    "MRQ, cozy storybook landscape, wide environment establishing view";
const COMMUNITY_ART_CANDIDATE_SCHEMA_VERSION: u8 = 1;
pub(super) const POLICY_PREFLIGHT_IMAGE_URL: &str =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAA1BMVEUA/wA0XsCoAAAAD0lEQVQoz2NgGAWjgHwAAAJAAAGMxat3AAAAAElFTkSuQmCC";

pub(super) fn legacy_community_art_generation_profile_version() -> u8 {
    LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION
}

pub(super) fn community_art_generation_profile_version(subject_kind: &str) -> u8 {
    if subject_kind == "location" {
        LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION
    } else {
        LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION
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
    #[serde(default)]
    pub(super) last_prediction_id: Option<String>,
    #[serde(default)]
    pub(super) last_error_code: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct CommunityArtPlan {
    pub(super) subject_kind: String,
    pub(super) subject_id: u64,
    pub(super) level: u8,
    pub(super) generation_profile_version: u8,
    pub(super) required_orbs: i32,
    pub(super) history_through_seq: u64,
    pub(super) prompt: String,
    pub(super) aspect_ratio: &'static str,
    pub(super) image_policy: Option<CommunityArtImagePolicy>,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CommunityArtImagePolicy {
    LocationLandscape,
}

impl CommunityArtImagePolicy {
    pub(super) fn prompt(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Landscape only. No people, human figures, humanoids, characters, animals, creatures, silhouettes, faces, body parts, statues, portraits, text, letters, numbers, logos, watermarks, UI, or card borders."
            }
        }
    }

    fn review(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Publish only a landscape with no visible or implied people, human figures, humanoids, characters, animals, creatures, silhouettes, faces, body parts, statues, portraits, readable text, letters, numbers, logos, or watermarks."
            }
        }
    }

    fn preflight_review(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Allow this image only if it is a uniform solid-green square with no visible person, character, creature, text, logo, or watermark."
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
}

#[derive(Debug)]
pub(super) enum CommunityArtGenerationError {
    Provider(String),
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
            Self::Provider(_) | Self::Storage(_) => "failed",
        }
    }

    pub(super) fn code(&self) -> &'static str {
        match self {
            Self::Provider(_) => "community_art_generation_failed",
            Self::PolicyUnavailable => "community_art_policy_unconfigured",
            Self::PolicyReview(_) => "community_art_policy_review_failed",
            Self::PolicyRejected(_) => "community_art_policy_rejected",
            Self::Storage(_) => "community_art_storage_failed",
        }
    }

    pub(super) fn message(&self) -> String {
        match self {
            Self::Provider(error) => format!("provider generation failed: {error}"),
            Self::PolicyUnavailable => {
                "location art policy review is not configured; output withheld".to_string()
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

#[derive(Debug)]
pub(super) struct CommunityArtGenerationOutcome {
    pub(super) result: Result<(), CommunityArtGenerationError>,
    pub(super) prediction_id: Option<String>,
    pub(super) reused_candidate: bool,
}

pub(super) fn community_art_generation_retryable(
    generation: &CommunityArtGenerationState,
    candidate_exists: bool,
) -> bool {
    if generation.funded_orbs < generation.required_orbs {
        return false;
    }
    match generation.status.as_str() {
        "ready" => false,
        "review_failed" | "review_unavailable" if candidate_exists => true,
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
    generation.funded_orbs >= generation.required_orbs
        && (generation_profile_version > generation.generation_profile_version
            || community_art_generation_retryable(generation, candidate_exists))
}

pub(super) fn community_art_prompt_history(
    subject_kind: &str,
    history_entries: &[String],
) -> String {
    if subject_kind == "location" {
        if history_entries.is_empty() {
            "newly revealed terrain with no depicted travelers".to_string()
        } else {
            format!(
                "{} recent public moments have left subtle environmental traces such as path wear, tended ground, and changing weather; depict no traveler or written record",
                history_entries.len()
            )
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
        .unwrap_or("No words, logo, watermark, UI, gore, or photorealism.");
    let prompt = if image_policy == Some(CommunityArtImagePolicy::LocationLandscape) {
        format!(
            "Wide environment illustration of {name}. {blurb}. Authoritative landscape level {level}. Canonical landscape facts: {subject_details}. Let the terrain and weather remember public history only through environmental detail: {history}. Preserve the established geography across later levels. {image_constraints}"
        )
    } else {
        format!(
            "Collectible card art for {subject_kind} {name}, titled {title}. {blurb}. Authoritative level {level}. Canonical visual facts: {subject_details}. Let the image visibly remember this public history without adding text: {history}. Preserve the subject's established identity across later levels. {image_constraints}"
        )
    };
    crate::compact_whitespace(&prompt)
}

impl RuntimeWorld {
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
                required_orbs: required_orbs.max(1),
                funded_orbs: 0,
                contributions: BTreeMap::new(),
                funding_intent_ids: BTreeSet::new(),
                status: "funding".to_string(),
                history_through_seq,
                revision: 0,
                provider_attempts: 0,
                last_prediction_id: None,
                last_error_code: None,
            });
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
        Some(self.append_async_job_event(
            &format!("community_art.{status}"),
            action_actor_id,
            None,
            Some(format!("{subject_kind}:{subject_id}:level:{level}")),
        ))
    }

    pub(super) fn apply_begin_community_art_generation_projection(
        &mut self,
        action_actor_id: u64,
        subject_kind: &str,
        subject_id: u64,
        level: u8,
        provider_attempt: bool,
        generation_profile_version: u8,
    ) -> Option<EventView> {
        let key = community_art_generation_key(subject_kind, subject_id, level);
        let generation = self.community_art_generations.get_mut(&key)?;
        if generation_profile_version > generation.generation_profile_version {
            generation.generation_profile_version = generation_profile_version;
            generation.provider_attempts = 0;
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

pub(super) async fn preflight_community_art_policy(
    config: Option<&AiConfig>,
    policy: CommunityArtImagePolicy,
) -> Result<(), CommunityArtGenerationError> {
    let config = config.ok_or(CommunityArtGenerationError::PolicyUnavailable)?;
    let decision = request_image_policy_decision(
        config,
        ImagePolicyRequest {
            feature: "media.location_image_policy_preflight",
            image_url: POLICY_PREFLIGHT_IMAGE_URL,
            policy: policy.preflight_review(),
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

pub(super) async fn generate_and_store_community_art(
    config: &ReplicateAvatarArtConfig,
    policy_config: Option<&AiConfig>,
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> CommunityArtGenerationOutcome {
    let (image, reused_candidate) = match load_community_art_candidate(generated_asset_dir, plan) {
        Ok(Some(image)) => (image, true),
        Ok(None) => {
            let prompt = community_art_generation_request(config, plan);
            let image = match request_replicate_art(
                config,
                prompt,
                plan.aspect_ratio,
                &plan.subject_kind,
                plan.subject_id,
                plan.level,
            )
            .await
            {
                Ok(image) => image,
                Err(error) => {
                    return CommunityArtGenerationOutcome {
                        result: Err(CommunityArtGenerationError::Provider(error)),
                        prediction_id: None,
                        reused_candidate: false,
                    };
                }
            };
            if plan.image_policy.is_some() {
                if let Err(error) = store_community_art_candidate(generated_asset_dir, plan, &image)
                {
                    return CommunityArtGenerationOutcome {
                        prediction_id: image.prediction_id.clone(),
                        result: Err(CommunityArtGenerationError::Storage(error)),
                        reused_candidate: false,
                    };
                }
            }
            (image, false)
        }
        Err(error) => {
            return CommunityArtGenerationOutcome {
                result: Err(CommunityArtGenerationError::Storage(error)),
                prediction_id: None,
                reused_candidate: true,
            };
        }
    };

    let prediction_id = image.prediction_id.clone();
    let result = async {
        if let Some(policy) = plan.image_policy {
            let policy_config =
                policy_config.ok_or(CommunityArtGenerationError::PolicyUnavailable)?;
            let image_url = community_art_candidate_data_url(&image)?;
            let decision = request_image_policy_decision(
                policy_config,
                ImagePolicyRequest {
                    feature: "media.location_image_policy",
                    image_url: &image_url,
                    policy: policy.review(),
                    timeout: Duration::from_secs(30),
                    max_attempts: 2,
                    referer: "https://cosyworld.fly.dev",
                },
            )
            .await
            .map_err(|error| CommunityArtGenerationError::PolicyReview(error.to_string()))?;
            if !decision.allowed {
                remove_community_art_candidate(generated_asset_dir, plan)
                    .map_err(CommunityArtGenerationError::Storage)?;
                return Err(CommunityArtGenerationError::PolicyRejected(
                    decision.violations,
                ));
            }
        }
        store_community_art_image(generated_asset_dir, plan, &image)
            .map_err(CommunityArtGenerationError::Storage)
    }
    .await;

    CommunityArtGenerationOutcome {
        result,
        prediction_id,
        reused_candidate,
    }
}

pub(super) fn community_art_generation_request(
    config: &ReplicateAvatarArtConfig,
    plan: &CommunityArtPlan,
) -> String {
    let prompt_prefix = plan
        .image_policy
        .map(CommunityArtImagePolicy::generation_prompt_prefix)
        .unwrap_or(&config.prompt_prefix);
    crate::compact_whitespace(&format!("{prompt_prefix}, {}", plan.prompt))
}

static COMMUNITY_ART_JOBS: OnceLock<StdMutex<BTreeSet<String>>> = OnceLock::new();

fn community_art_jobs() -> &'static StdMutex<BTreeSet<String>> {
    COMMUNITY_ART_JOBS.get_or_init(|| StdMutex::new(BTreeSet::new()))
}

async fn begin_community_art_generation(
    state: &AppState,
    actor_id: u64,
    plan: &CommunityArtPlan,
    candidate_exists: bool,
) -> Option<bool> {
    let mut runtime = state.inner.lock().await;
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let generation = runtime.community_art_generations.get(&key)?;
    if !plan.generation_retryable(generation, candidate_exists) {
        return None;
    }
    let provider_attempt = !candidate_exists;
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
) -> Option<Vec<EventView>> {
    let mut runtime = state.inner.lock().await;
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
        let candidate_exists = community_art_candidate_exists(&state.generated_asset_dir, &plan);
        let Some(provider_attempt) =
            begin_community_art_generation(&state, actor_id, &plan, candidate_exists).await
        else {
            if let Ok(mut jobs) = community_art_jobs().lock() {
                jobs.remove(&key);
            }
            return;
        };
        let started_at = Instant::now();
        let outcome = generate_and_store_community_art(
            &config,
            state.ai_config.as_ref().as_ref(),
            &state.generated_asset_dir,
            &plan,
        )
        .await;
        let (status, error_code) = match &outcome.result {
            Ok(()) => ("ready", None),
            Err(error) => {
                warn!(
                    provider_attempt,
                    reused_candidate = outcome.reused_candidate,
                    prediction_id = outcome.prediction_id.as_deref().unwrap_or("unknown"),
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
        )
        .await;
        if status == "ready" && events.is_some() {
            if let Err(error) = remove_community_art_candidate(&state.generated_asset_dir, &plan) {
                warn!(
                    "failed to remove published community art candidate for {}: {}",
                    key, error
                );
            }
        }
        record_ai_usage_for_provider(
            &state,
            Some(actor_id),
            "community_image_generation",
            "community_orbs",
            "replicate",
            &config.model,
            if status == "ready" { "ok" } else { "failed" },
            events
                .as_ref()
                .and_then(|events| events.first())
                .map(|event| event.seq),
            0,
            error_code,
            started_at.elapsed(),
        );
        if let Ok(mut jobs) = community_art_jobs().lock() {
            jobs.remove(&key);
        }
    });
}

fn store_community_art_image(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
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
    store_community_art_bundle(&path, &content_type_path, &metadata_path, image)
}

pub(super) fn store_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    store_community_art_bundle(
        &community_art_candidate_image_path(generated_asset_dir, plan),
        &community_art_candidate_content_type_path(generated_asset_dir, plan),
        &community_art_candidate_metadata_path(generated_asset_dir, plan),
        image,
    )
}

fn store_community_art_bundle(
    path: &Path,
    content_type_path: &Path,
    metadata_path: &Path,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let metadata =
        serde_json::to_vec(&community_art_candidate_metadata(image)).map_err(|e| e.to_string())?;
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
) -> CommunityArtCandidateMetadata {
    CommunityArtCandidateMetadata {
        schema_version: COMMUNITY_ART_CANDIDATE_SCHEMA_VERSION,
        content_type: image.content_type.clone(),
        source_url: image.source_url.clone(),
        prediction_id: image.prediction_id.clone(),
        sha256: format!("{:x}", Sha256::digest(&image.bytes)),
    }
}

fn load_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<Option<DownloadedReplicateImage>, String> {
    let image_path = community_art_candidate_image_path(generated_asset_dir, plan);
    if !image_path.exists() {
        return Ok(None);
    }
    let content_type_path = community_art_candidate_content_type_path(generated_asset_dir, plan);
    let metadata_path = community_art_candidate_metadata_path(generated_asset_dir, plan);
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
    Ok(Some(DownloadedReplicateImage {
        bytes,
        content_type,
        source_url: metadata.source_url,
        prediction_id: metadata.prediction_id,
    }))
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

pub(super) fn community_art_candidate_exists(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> bool {
    community_art_candidate_image_path(generated_asset_dir, plan).is_file()
        && community_art_candidate_content_type_path(generated_asset_dir, plan).is_file()
        && community_art_candidate_metadata_path(generated_asset_dir, plan).is_file()
}

pub(super) fn remove_community_art_candidate(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<(), String> {
    for path in [
        community_art_candidate_image_path(generated_asset_dir, plan),
        community_art_candidate_content_type_path(generated_asset_dir, plan),
        community_art_candidate_metadata_path(generated_asset_dir, plan),
    ] {
        if let Err(error) = fs::remove_file(path) {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error.to_string());
            }
        }
    }
    Ok(())
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
    let ready = {
        let runtime = state.inner.lock().await;
        runtime
            .community_art_subject_level(&subject_kind, subject_id)
            .and_then(|level| {
                runtime
                    .community_art_generations
                    .get(&crate::community_art_generation_key(
                        &subject_kind,
                        subject_id,
                        level,
                    ))
            })
            .is_some_and(|generation| generation.status == "ready")
    };
    if !ready {
        return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
    }
    let path =
        stored_community_art_image_path(&state.generated_asset_dir, &subject_kind, subject_id);
    let Ok(bytes) = fs::read(path) else {
        return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
    };
    let content_type =
        stored_community_art_content_type(&state.generated_asset_dir, &subject_kind, subject_id);
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
