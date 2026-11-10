use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{
    FrozenCommunityArtEvolutionJob, GeneratedPolicyBinding, PublicArtHistoryEvent, RuntimeWorld,
};

/// Mirrors `MAX_REVIEW_FAILURES` in the media verdict store, which already
/// counts and clamps review failures per candidate.
pub(super) const MAX_COMMUNITY_ART_REVIEW_ATTEMPTS: u8 = 3;

fn exhausted_community_art_review_attempts() -> u8 {
    MAX_COMMUNITY_ART_REVIEW_ATTEMPTS
}
pub(super) const LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION: u8 = 1;

pub(super) fn legacy_community_art_generation_profile_version() -> u8 {
    LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION
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

impl CommunityArtPlan {}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum CommunityArtImagePolicy {
    LocationLandscape,
}

impl CommunityArtImagePolicy {}

impl RuntimeWorld {}
