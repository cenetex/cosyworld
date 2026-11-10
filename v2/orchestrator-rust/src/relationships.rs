use super::*;

impl RuntimeWorld {}

impl RuntimeWorld {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedRelationshipContent {
    pub(super) intent: String,
    pub(super) statement: String,
    pub(super) first_beat: String,
    pub(super) reply_prompt: String,
    pub(super) active_on_gift_item_id: u64,
    pub(super) active_beat: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct RelationshipPreviewView {
    pub(super) intent: String,
    pub(super) statement: String,
    pub(super) initial_status: &'static str,
    pub(super) deterministic_consequence: String,
    pub(super) dialogue_contract: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct BondState {
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) statement: String,
    pub(super) strength: u8,
    pub(super) status: String,
    #[serde(default)]
    pub(super) source_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) updated_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) dialogue_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) dialogue_event_seq: Option<u64>,
}

impl RuntimeWorld {}
