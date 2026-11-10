use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct GeneratedBuildingProposalState {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) eligible_archetype_ids: Vec<String>,
    pub(super) opened_event_seq: u64,
    #[serde(default)]
    pub(super) governance_decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selected_archetype_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct GeneratedPlaceState {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    #[serde(default)]
    pub(super) canonical_id: String,
    pub(super) pathway_id: String,
    pub(super) connected_from_location_id: u64,
    pub(super) discovered_by_actor_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) discovered_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) source_generation: GenerationProvenance,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    #[serde(default)]
    pub(super) generation_policy: GeneratedPolicyBinding,
    pub(super) anchor_clock_id: String,
    pub(super) connection_clock_id: String,
    pub(super) settlement_clock_id: String,
    pub(super) anchor_job_id: String,
    pub(super) connection_job_id: String,
    pub(super) settlement_job_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) connection_item_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) building_proposal: Option<GeneratedBuildingProposalState>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GeneratedPlaceView {
    pub(super) schema_version: u8,
    pub(super) pathway_id: String,
    pub(super) connected_from_location_id: u64,
    pub(super) discovered_by_actor_id: u64,
    pub(super) discovered_event_seq: Option<u64>,
    pub(super) source_generation: GenerationProvenance,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) generation_policy: GeneratedPolicyBinding,
    pub(super) milestones: Vec<String>,
    pub(super) anchor_clock_id: String,
    pub(super) connection_clock_id: String,
    pub(super) settlement_clock_id: String,
    pub(super) building_proposal: Option<GeneratedBuildingProposalState>,
    pub(super) settlement_buildings: Vec<SettlementBuildingView>,
    pub(super) building_slots: BuildingSlotView,
}

impl RuntimeWorld {}
