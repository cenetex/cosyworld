use super::*;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum TreasureObjectiveStatus {
    #[default]
    Active,
    Completed,
    TimedOut,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct TreasureObjectiveState {
    pub(super) schema_version: u32,
    pub(super) id: String,
    pub(super) actor_id: u64,
    /// Authoritative supervision only. Never copy this into model inputs or
    /// card-policy traces.
    pub(super) treasure_item_id: u64,
    pub(super) max_turns: u16,
    pub(super) turns_taken: u16,
    pub(super) status: TreasureObjectiveStatus,
    pub(super) started_world_tick: u64,
    pub(super) started_event_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) resolved_event_seq: Option<u64>,
}

impl TreasureObjectiveState {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct TreasureObjectiveStart {
    pub(super) schema_version: u32,
    pub(super) objective_id: String,
    pub(super) actor_id: u64,
    pub(super) treasure_item_id: u64,
    pub(super) max_turns: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct TreasureBranchLabel {
    pub(super) schema_version: u32,
    /// Stable episode key. The hidden treasure item id is deliberately absent.
    pub(super) objective_id: String,
    pub(super) objective_turn: u16,
    pub(super) evaluator: String,
    /// Counterfactual cost after forcing each candidate, in deck order.
    pub(super) child_losses: Vec<u16>,
}

impl RuntimeWorld {}
