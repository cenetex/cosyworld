use super::*;
use cosyworld_orchestrator::card_policy::CardPolicyAction;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentPlannerCandidate {
    pub(super) candidate_id: String,
    pub(super) composition_id: String,
    pub(super) state_revision: u64,
    pub(super) kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) target_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) item_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) target_item_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) destination_location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) hand_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) scene_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentCardPolicyTrace {
    pub(super) schema_version: u32,
    pub(super) rollout_mode: String,
    pub(super) model_hash: u64,
    pub(super) action: CardPolicyAction,
    pub(super) top_k: usize,
    pub(super) ranked_candidate_ids: Vec<String>,
    pub(super) scores_q8: Vec<i32>,
    #[serde(default)]
    pub(super) personalization_scores_q8: Vec<i32>,
    /// Frozen per-avatar observation used for replay and gated online learning.
    pub(super) candidate_features_q15: Vec<Vec<i16>>,
    pub(super) hand_signature: String,
    pub(super) hand_offset: u16,
    pub(super) next_hand_offset: u16,
    pub(super) hand_candidate_ids: [Option<String>; 2],
    pub(super) deck_candidate_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) branch_label: Option<TreasureBranchLabel>,
    pub(super) top_candidate_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selected_offer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) llm_offer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) agrees_with_llm: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResidentSpeechAct {
    Inform,
    Propose,
    Commit,
    Refuse,
    React,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResidentPlanningStatus {
    Absent,
    Requested,
    Proposed,
    Drew,
    Accepted,
    Committed,
    Rejected,
    Superseded,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentPlanningTrace {
    pub(super) schema_version: u32,
    pub(super) generation_id: String,
    pub(super) prompt_version: String,
    pub(super) actor_id: u64,
    pub(super) state_revision: u64,
    pub(super) candidates: Vec<ResidentPlannerCandidate>,
    #[serde(default)]
    pub(super) eligibility_policy: String,
    #[serde(default)]
    pub(super) eligible_offer_kinds: Vec<String>,
    pub(super) status: ResidentPlanningStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) candidate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) speech_act: Option<ResidentSpeechAct>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) proposal_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) failure_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) model_attribution: Option<ModelAttribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) context_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) card_policy: Option<ResidentCardPolicyTrace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) card_policy_failure_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) supersedes_generation_id: Option<String>,
}

impl ResidentPlanningTrace {}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ResidentPlanningDisposition {
    pub(super) trace: ResidentPlanningTrace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) proposed_action: Option<AvatarProposedAction>,
}

impl RuntimeWorld {}
