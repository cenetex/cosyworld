use super::*;

impl RuntimeWorld {}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ActorRulesFacetState {
    schema_version: u8,
    actor_id: u64,
    rules_profile: String,
    rules_capability_id: String,
    selected_by_pack_id: String,
    provider_pack_id: String,
    provider_pack_version: String,
    base_stats: CwStatBlock,
    status: u8,
    stats: CwStatBlock,
    damage: i16,
    conditions: u32,
    initialized_at_revision: u64,
    last_saved_at_revision: u64,
    last_restored_at_revision: u64,
}

impl ActorRulesFacetState {}

impl RuntimeWorld {}
