use super::*;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum GovernanceDecisionStatus {
    Open,
    Selected,
    Closed,
    Invalidated,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum GovernanceAlternativeStatus {
    Open,
    Selected,
    Closed,
    Invalidated,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum GovernancePolicy {
    NamedChooser {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        chooser_actor_id: Option<u64>,
        chooser_rule: String,
        allow_explicit_delegation: bool,
    },
    CovenantMembers {
        covenant_id: String,
        member_actor_ids: Vec<u64>,
        quorum: u16,
        allow_explicit_delegation: bool,
    },
    CompetingProjects {
        eligible_actor_ids: Vec<u64>,
        support_threshold: u16,
    },
    DelegatedDecision {
        delegator_actor_id: u64,
        delegate_actor_id: u64,
    },
    AuthoredAutomatic {
        alternative_id: String,
    },
}

impl GovernancePolicy {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceAlternativeState {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) expected_consequence: String,
    pub(super) incompatible_alternative_ids: Vec<String>,
    pub(super) status: GovernanceAlternativeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) closed_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceSupportRecord {
    pub(super) actor_id: u64,
    pub(super) alternative_id: String,
    pub(super) event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceDelegationRecord {
    pub(super) delegated_by_actor_id: u64,
    pub(super) delegated_to_actor_id: u64,
    pub(super) event_seq: u64,
    pub(super) active: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceSelectionRecord {
    pub(super) alternative_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selected_by_actor_id: Option<u64>,
    pub(super) event_seq: u64,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceClosurePolicy {
    pub(super) contribution_disposition: String,
    pub(super) refund_policy: String,
    pub(super) permanence: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceDecisionState {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) subject_kind: String,
    pub(super) subject_id: String,
    pub(super) policy: GovernancePolicy,
    pub(super) alternatives: Vec<GovernanceAlternativeState>,
    #[serde(default)]
    pub(super) support: Vec<GovernanceSupportRecord>,
    #[serde(default)]
    pub(super) delegations: Vec<GovernanceDelegationRecord>,
    pub(super) closure: GovernanceClosurePolicy,
    pub(super) status: GovernanceDecisionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selection: Option<GovernanceSelectionRecord>,
    pub(super) opened_event_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) updated_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) review_after_world_tick: Option<u64>,
    pub(super) timeout_behavior: String,
    pub(super) late_arrival_opportunity: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GovernanceAlternativeView {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) expected_consequence: String,
    pub(super) incompatible_alternative_ids: Vec<String>,
    pub(super) status: GovernanceAlternativeStatus,
    pub(super) closed_reason: Option<String>,
    pub(super) supporter_actor_ids: Vec<u64>,
    pub(super) supporter_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GovernanceDelegationView {
    pub(super) delegated_by_actor_id: u64,
    pub(super) delegated_by_name: String,
    pub(super) delegated_to_actor_id: u64,
    pub(super) delegated_to_name: String,
    pub(super) event_seq: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GovernanceDecisionView {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) subject_kind: String,
    pub(super) subject_id: String,
    pub(super) status: GovernanceDecisionStatus,
    pub(super) policy_kind: String,
    pub(super) policy_summary: String,
    pub(super) authorized_actor_ids: Vec<u64>,
    pub(super) authorized_actor_names: Vec<String>,
    pub(super) quorum: Option<u16>,
    pub(super) support_threshold: Option<u16>,
    pub(super) alternatives: Vec<GovernanceAlternativeView>,
    pub(super) delegations: Vec<GovernanceDelegationView>,
    pub(super) selection: Option<GovernanceSelectionRecord>,
    pub(super) contribution_disposition: String,
    pub(super) refund_policy: String,
    pub(super) permanence: String,
    pub(super) timeout_behavior: String,
    pub(super) late_arrival_opportunity: String,
    pub(super) opened_event_seq: u64,
    pub(super) updated_event_seq: Option<u64>,
}

impl RuntimeWorld {}
