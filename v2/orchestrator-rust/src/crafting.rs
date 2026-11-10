use super::*;

pub(super) fn recipe_uses_receipt(recipe: &SeedRecipeContent) -> bool {
    recipe
        .output
        .as_ref()
        .is_some_and(|output| !output.template_id.is_empty())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct CraftInputState {
    pub(super) item_id: u64,
    pub(super) template_id: String,
    pub(super) zone: String,
    #[serde(default)]
    pub(super) charges_before: u8,
    pub(super) disposition: String,
    #[serde(default)]
    pub(super) source_origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) transition_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct CraftReceiptState {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) recipe_id: u64,
    pub(super) recipe_schema_version: u8,
    pub(super) recipe_key: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) rules_profile: String,
    pub(super) actor_id: u64,
    pub(super) location_id: u64,
    pub(super) inputs: Vec<CraftInputState>,
    pub(super) output_item_id: u64,
    pub(super) output_template_id: String,
    pub(super) output_destination: String,
    #[serde(default)]
    pub(super) output_fallback_destination: String,
    pub(super) output_effect: String,
    #[serde(default)]
    pub(super) output_uniqueness: String,
    #[serde(default)]
    pub(super) capability_source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) craft_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) output_event_seq: Option<u64>,
}

impl RuntimeWorld {}
