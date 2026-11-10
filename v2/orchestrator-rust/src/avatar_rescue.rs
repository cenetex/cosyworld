use super::*;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct AvatarRescueState {
    pub(super) id: String,
    pub(super) account_key: String,
    pub(super) downed_actor_id: u64,
    pub(super) rescuer_actor_id: u64,
    pub(super) draught_item_id: u64,
    pub(super) status: String,
    pub(super) started_tick: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) resolved_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) inhabited_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) released_actor_id: Option<u64>,
}

impl RuntimeWorld {}
