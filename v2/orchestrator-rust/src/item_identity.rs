use super::*;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct ItemIdentityRevealState {
    pub(super) schema_version: u8,
    pub(super) item_id: u64,
    pub(super) table_id: String,
    pub(super) table_version: u8,
    pub(super) replay_version: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) roll_seed: u64,
    pub(super) roll_input: String,
    pub(super) revealed_by_actor_id: u64,
    pub(super) revealed_at_location_id: u64,
    #[serde(default)]
    pub(super) unresolved_name: String,
    #[serde(default)]
    pub(super) revealed_event_seq: u64,
    pub(super) template: LootItemTemplateDefinition,
}

impl RuntimeWorld {}
