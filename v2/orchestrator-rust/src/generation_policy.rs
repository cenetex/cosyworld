use super::*;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GeneratedMediaBinding {
    pub(super) profile_id: String,
    pub(super) recipe_id: String,
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) revision: String,
    pub(super) prompt_version: String,
    pub(super) prompt_prefix: String,
    pub(super) aspect_ratios: Vec<String>,
    pub(super) output_format: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GeneratedPolicyBinding {
    pub(super) schema_version: u8,
    pub(super) policy_id: String,
    pub(super) migration_version: u32,
    pub(super) collision_namespace: String,
    pub(super) owner_pack_id: String,
    pub(super) owner_pack_version: String,
    pub(super) composition_id: String,
    pub(super) composition_bundle_hash: String,
    pub(super) prose_profile_id: String,
    pub(super) prose_prompt_version: String,
    pub(super) ecology_transition: String,
    pub(super) topology_profile_id: String,
    pub(super) unmount_behavior: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) place_anchor: Option<GeneratedPlaceAnchorTerminology>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) media: Option<GeneratedMediaBinding>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GeneratedPlaceAnchorTerminology {
    pub(super) action_label: String,
    pub(super) target_label: String,
    pub(super) question: String,
    pub(super) description: String,
    pub(super) completion_memory: String,
    pub(super) visual_description: String,
}

impl GeneratedPolicyBinding {}
