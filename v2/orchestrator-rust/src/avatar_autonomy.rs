use super::*;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum DelegationScope {
    Speech,
    #[default]
    SpeechAndActions,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct OwnerDelegation {
    pub(super) generation: u64,
    pub(super) enabled: bool,
    pub(super) scope: DelegationScope,
    pub(super) action_limit: u8,
    pub(super) actions_used: u8,
    pub(super) speech_limit: u8,
    pub(super) speech_used: u8,
    pub(super) goal_item_id: Option<u64>,
    pub(super) goal_status: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct AvatarAutonomyView {
    pub(super) generation: u64,
    pub(super) enabled: bool,
    pub(super) scope: DelegationScope,
    pub(super) action_limit: u8,
    pub(super) remaining_actions: u8,
    pub(super) speech_limit: u8,
    pub(super) remaining_speech: u8,
    pub(super) estimated_spend_limit_microdollars: u64,
    pub(super) goal_item_id: Option<u64>,
    pub(super) goal_status: String,
}

impl RuntimeWorld {}
