use super::*;

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActionCompositionTraceView {
    pub(super) worldpack_bundle_hash: String,
    pub(super) pack_mount_revision: u64,
    pub(super) pack_versions: Vec<ActionPackVersionView>,
    pub(super) rules_profile: String,
    pub(super) rules_pack_id: String,
    pub(super) rules_pack_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) rules_context: Option<SceneRulesContextView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) focused_encounter: Option<FocusedEncounterOfferContext>,
    pub(super) source_card_instances: Vec<ActionSourceCollectibleView>,
    pub(super) target: Option<ActionTargetView>,
    pub(super) applied_variants: Vec<String>,
    pub(super) active_extensions: Vec<String>,
    pub(super) applied_reskins: Vec<String>,
    pub(super) contextual_offers: Vec<String>,
    pub(super) resolver: String,
    pub(super) state_revision: u64,
}

impl ActionCompositionTraceView {}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActionPackVersionView {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) integrity: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct SceneRulesContextView {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) location_pack_id: String,
    pub(super) rules_profile: String,
    pub(super) selector_scope: String,
    pub(super) selector_id: String,
    pub(super) selected_by_pack_id: String,
    pub(super) capability_id: String,
    pub(super) provider_pack_id: String,
    pub(super) provider_pack_version: String,
    pub(super) state_revision: u64,
}

impl SceneRulesContextView {}

impl RuntimeWorld {}
