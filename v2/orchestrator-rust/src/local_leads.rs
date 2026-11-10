use super::*;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct LocalLeadState {
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) source_actor_id: u64,
    pub(super) source_offer_id: String,
    pub(super) source_reference: String,
    pub(super) source_event_seq: u64,
    pub(super) origin_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) destination_hint: String,
    pub(super) received_tick: u64,
    #[serde(default)]
    pub(super) consumed: bool,
    #[serde(default)]
    pub(super) settled: bool,
    #[serde(default)]
    pub(super) forgotten: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) consumed_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) settled_event_seq: Option<u64>,
}

impl RuntimeWorld {}
