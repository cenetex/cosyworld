use super::*;

#[derive(Debug)]
pub(super) struct SeedContent {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) manifest: SeedWorldpackManifest,
    pub(super) actors: Vec<SeedActorContent>,
    pub(super) actor_facets: Vec<SeedActorFacetContent>,
    pub(super) access_gates: Vec<SeedAccessGateContent>,
    pub(super) factions: Vec<SeedFactionContent>,
    pub(super) items: Vec<SeedItemContent>,
    pub(super) locations: Vec<SeedLocationContent>,
    pub(super) room_features: Vec<SeedRoomFeatureContent>,
    pub(super) exits: Vec<SeedExitContent>,
    pub(super) hidden_exits: Vec<SeedHiddenExitContent>,
    pub(super) room_sheets: Vec<RoomSheetState>,
    pub(super) clocks: Vec<ClockState>,
    pub(super) jobs: Vec<JobState>,
    pub(super) action_vocabulary: Vec<SeedActionVocabulary>,
    pub(super) fronts: Vec<SeedFrontContent>,
    pub(super) cards: Vec<SeedCardContent>,
    pub(super) card_bindings: Vec<SeedCardBindingContent>,
    pub(super) lifecycle_hooks: Vec<SeedLifecycleHookContent>,
    pub(super) evolution_tracks: Vec<SeedEvolutionTrack>,
    pub(super) recipes: Vec<SeedRecipeContent>,
    pub(super) rules: Vec<SeedRuleBundle>,
    pub(super) contributions: Vec<SeedContributionBundle>,
    pub(super) attributions: Vec<SeedAttribution>,
    pub(super) licenses: Vec<SeedLicenseRecord>,
    pub(super) modified_material: Vec<SeedModifiedMaterial>,
    pub(super) character_creation: Vec<SeedCharacterCreationBundle>,
    pub(super) external_cards: Vec<ExternalCardSpec>,
    pub(super) asset_mounts: Vec<SeedAssetMount>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedActionVocabulary {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) notice: String,
    pub(super) inspect: String,
    pub(super) scout: String,
    pub(super) travel: String,
    pub(super) contribute: String,
    pub(super) push: String,
    pub(super) help: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct SeedWorldpackManifest {
    #[serde(default)]
    pub(super) schema_version: u32,
    #[serde(default)]
    pub(super) pack_contract: String,
    #[serde(default)]
    pub(super) canonical_id_mapping_version: u32,
    pub(super) id: String,
    pub(super) name: String,
    pub(super) version: u32,
    #[serde(default)]
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) description: String,
    #[serde(default)]
    pub(super) entry_location: String,
    #[serde(default)]
    pub(super) entry_grant_id: Option<String>,
    #[serde(default)]
    pub(super) bundle_hash: String,
    #[serde(default)]
    pub(super) rules_profile: String,
    #[serde(default)]
    pub(super) active_rules_variants: Vec<String>,
    #[serde(default)]
    pub(super) active_rules_extensions: Vec<String>,
    #[serde(default)]
    pub(super) persistence_compatibility: SeedPersistenceCompatibility,
    #[serde(default)]
    pub(super) avatar_naming: Option<cosyworld_ai_model::AvatarNamingConfig>,
    #[serde(default)]
    pub(super) packs: Vec<SeedWorldpackPack>,
    #[serde(default)]
    pub(super) registry: String,
    #[serde(default)]
    pub(super) content_references: String,
    #[serde(default)]
    pub(super) licenses: String,
    #[serde(default)]
    pub(super) contributions: String,
    #[serde(default)]
    pub(super) modified_material: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct SeedPersistenceCompatibility {
    #[serde(default)]
    pub(super) schema_version: u32,
    #[serde(default)]
    pub(super) replay_compatible_bundle_hashes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedWorldpackPack {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(default)]
    pub(super) description: String,
    pub(super) version: String,
    pub(super) kind: String,
    pub(super) license: String,
    pub(super) license_url: String,
    pub(super) integrity: String,
    #[serde(default)]
    pub(super) engine: String,
    #[serde(default)]
    pub(super) capabilities: Vec<SeedPackCapability>,
    #[serde(default)]
    pub(super) dependencies: Vec<String>,
    #[serde(default)]
    pub(super) dependency_requirements: Vec<SeedPackDependency>,
    #[serde(default)]
    pub(super) dependency_closure: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) default_ruleset: Option<String>,
    #[serde(default)]
    pub(super) entry_points: Vec<serde_json::Value>,
    pub(super) provenance: SeedPackProvenance,
    #[serde(default)]
    pub(super) resource_counts: BTreeMap<String, usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) distribution: Option<SeedPackDistribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) entitlements: Option<SeedPackEntitlements>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) rules_adapter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) rules_namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) rules_profile: Option<String>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub(super) extensions: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedPackCapability {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedPackDependency {
    pub(super) id: String,
    pub(super) version: String,
    #[serde(default)]
    pub(super) capabilities: Vec<String>,
    #[serde(default)]
    pub(super) optional: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedPackDistribution {
    pub(super) media_type: String,
    pub(super) canonicalization: String,
    pub(super) permanence: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) permanent_uri: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedPackEntitlements {
    pub(super) schema_version: u32,
    #[serde(default)]
    pub(super) authorities: Vec<SeedEntitlementAuthority>,
    #[serde(default)]
    pub(super) grants: Vec<SeedEntitlementGrant>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedEntitlementAuthority {
    pub(super) provider: String,
    pub(super) id: String,
    #[serde(rename = "type")]
    pub(super) kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) asset_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) issuer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) chain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) network: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) standard: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) collection_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) collection_binding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) algorithm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) public_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedEntitlementGrant {
    pub(super) id: String,
    pub(super) authority_id: String,
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub(super) match_rule: Option<SeedEntitlementMatch>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedEntitlementMatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) asset_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRuleBundle {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) adapter: String,
    pub(super) namespace: String,
    pub(super) resources: SeedRuleResources,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedContributionBundle {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) rules_profile: String,
    #[serde(default)]
    pub(super) reskins: Vec<SeedActionReskin>,
    #[serde(default)]
    pub(super) offers: Vec<SeedContextualActionOffer>,
    #[serde(default)]
    pub(super) variants: Vec<serde_json::Value>,
    #[serde(default)]
    pub(super) extensions: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedActionReskin {
    pub(super) id: String,
    pub(super) based_on: String,
    pub(super) label: String,
    #[serde(default)]
    pub(super) description: String,
    pub(super) scope: SeedContributionSubject,
    pub(super) compatibility: String,
    pub(super) source_reference: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedContextualActionOffer {
    pub(super) id: String,
    pub(super) based_on: String,
    pub(super) subject: SeedContributionSubject,
    pub(super) context: serde_json::Value,
    pub(super) label: String,
    pub(super) target_predicate: String,
    pub(super) source_reference: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedContributionSubject {
    #[serde(alias = "subject_kind")]
    pub(super) kind: String,
    #[serde(alias = "subject_id")]
    pub(super) id: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub(super) struct SeedRuleResources {
    #[serde(default)]
    pub(super) conditions: Vec<SeedRuleCondition>,
    #[serde(default)]
    pub(super) monster_seeds: Vec<SeedRuleMonsterSeed>,
    #[serde(default)]
    pub(super) profiles: Vec<SeedRulesProfile>,
    #[serde(default)]
    pub(super) actions: Vec<SeedRulesAction>,
    #[serde(default)]
    pub(super) operations: Vec<SeedRulesOperation>,
    #[serde(default)]
    pub(super) legacy_bindings: Vec<SeedLegacyBinding>,
    #[serde(default)]
    pub(super) abilities: Vec<SeedRulesAbility>,
    #[serde(default)]
    pub(super) skills: Vec<SeedRulesSkill>,
    #[serde(default)]
    pub(super) item_roles: Vec<SeedRulesItemRole>,
    #[serde(default)]
    pub(super) equipment_profiles: Vec<SeedEquipmentProfile>,
    #[serde(default)]
    pub(super) magic_effects: Vec<SeedMagicEffect>,
    #[serde(default)]
    pub(super) conformance: Vec<SeedRulesConformance>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRulesProfile {
    pub(super) id: String,
    pub(super) source_document: String,
    pub(super) source_version: String,
    pub(super) source_pack: String,
    pub(super) license: String,
    pub(super) compatibility_claim: String,
    #[serde(default)]
    pub(super) excluded_systems: Vec<String>,
    #[serde(default)]
    pub(super) cosyworld_deltas: Vec<String>,
    pub(super) source_reference: String,
    pub(super) import_transform: String,
    pub(super) modified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedRulesAction {
    pub(super) id: String,
    pub(super) namespace: String,
    pub(super) domain: String,
    pub(super) label: String,
    pub(super) source_reference: String,
    pub(super) support_status: String,
    pub(super) resolver_kind: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    pub(super) cosyworld_delta: String,
    pub(super) modified: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRulesConformance {
    pub(super) action_id: String,
    pub(super) support_status: String,
    pub(super) resolver_kind: String,
    pub(super) safe_behavior: String,
    pub(super) risky_behavior: String,
    #[serde(default)]
    pub(super) legal_targets: Vec<String>,
    #[serde(default)]
    pub(super) event_outputs: Vec<String>,
    pub(super) cosyworld_delta: String,
    #[serde(default)]
    pub(super) replay_fixture: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedModifiedMaterial {
    pub(super) pack_id: String,
    pub(super) rules_profile: String,
    pub(super) resource_type: String,
    pub(super) id: String,
    pub(super) source_document: String,
    pub(super) source_version: String,
    pub(super) source_pack: String,
    pub(super) source_reference: String,
    pub(super) license: String,
    pub(super) attribution_pack: String,
    pub(super) import_transform: String,
    pub(super) modification_status: String,
    #[serde(default)]
    pub(super) changes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRulesOperation {
    pub(super) id: String,
    pub(super) domain: String,
    pub(super) label: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    pub(super) resolver_kind: String,
    pub(super) source_reference: String,
    pub(super) modified: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedLegacyBinding {
    pub(super) legacy_kind: String,
    pub(super) binding_kind: String,
    pub(super) binding_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRulesAbility {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) source_reference: String,
    pub(super) modified: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRulesSkill {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) ability: String,
    pub(super) source_reference: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRulesItemRole {
    pub(super) id: String,
    pub(super) resolver_kind: String,
    pub(super) transfer_policy: String,
    pub(super) theft_policy: String,
    pub(super) mechanical_descriptor_required: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedEquipmentProfile {
    pub(super) id: String,
    pub(super) slot_kind: String,
    pub(super) base_slots: u8,
    pub(super) maximum_slots: u8,
    pub(super) unlock: String,
    pub(super) source_reference: String,
    pub(super) modified: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedMagicEffect {
    pub(super) id: String,
    pub(super) rules_action: String,
    pub(super) resolver_kind: String,
    pub(super) target_predicate: String,
    pub(super) effect: serde_json::Value,
    pub(super) uses: u8,
    pub(super) recovery: String,
    pub(super) source_reference: String,
    pub(super) modified: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRuleCondition {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) source_section: String,
    pub(super) source_text: String,
    pub(super) mapping: SeedRuleMapping,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRuleMonsterSeed {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) source_name: String,
    pub(super) size: String,
    pub(super) creature_type: String,
    pub(super) alignment: String,
    pub(super) armor_class: String,
    pub(super) hit_points: String,
    pub(super) speed: String,
    pub(super) ability_scores: BTreeMap<String, u8>,
    pub(super) challenge: String,
    #[serde(default)]
    pub(super) senses: String,
    #[serde(default)]
    pub(super) features: Vec<SeedRuleFeature>,
    pub(super) mapping: SeedRuleMapping,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRuleFeature {
    pub(super) name: String,
    pub(super) description: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRuleMapping {
    pub(super) status: String,
    #[serde(default)]
    pub(super) kernel_condition: Option<String>,
    #[serde(default)]
    pub(super) suggested_role: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedAttribution {
    pub(super) pack_id: String,
    pub(super) license: String,
    pub(super) source_name: String,
    pub(super) source_url: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedPackProvenance {
    pub(super) author: String,
    pub(super) source_name: String,
    pub(super) source_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) modification_notice: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedLicenseNotice {
    pub(super) kind: String,
    pub(super) title: String,
    pub(super) file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_url: Option<String>,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedLicenseRecord {
    pub(super) pack_id: String,
    pub(super) name: String,
    pub(super) version: String,
    pub(super) license_identifier: String,
    pub(super) license_url: String,
    pub(super) provenance: SeedPackProvenance,
    pub(super) notices: Vec<SeedLicenseNotice>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCharacterCreationBundle {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) profiles: Vec<SeedCharacterCreationProfile>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCharacterCreationProfile {
    pub(super) schema_version: u32,
    pub(super) id: String,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) entry_location_id: u64,
    pub(super) prompt: String,
    pub(super) default_choice_id: String,
    pub(super) choices: Vec<SeedCharacterCreationChoice>,
    #[serde(default)]
    pub(super) class_prompt: Option<String>,
    #[serde(default)]
    pub(super) default_species_id: Option<String>,
    #[serde(default)]
    pub(super) species: Vec<SeedCharacterCreationIdentityCard>,
    #[serde(default)]
    pub(super) default_origin_id: Option<String>,
    #[serde(default)]
    pub(super) origins: Vec<SeedCharacterCreationIdentityCard>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCharacterCreationChoice {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) detail: String,
    pub(super) calling: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) starting_skill_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCharacterCreationIdentityCard {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) detail: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) visual_prompt: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedAssetMount {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) pack_integrity: String,
    pub(super) provider: String,
    pub(super) mount: String,
    pub(super) root: String,
    pub(super) directory: String,
    pub(super) public_prefix: String,
    pub(super) content_hash: String,
    #[serde(default)]
    pub(super) optional: bool,
    #[serde(default)]
    pub(super) fallback: Option<String>,
}

impl SeedAssetMount {
    pub(super) fn cache_namespace(&self) -> String {
        format!(
            "pack://{}@{}/{}/{}?content={}",
            self.pack_id, self.pack_version, self.provider, self.mount, self.content_hash
        )
    }

    pub(super) fn cache_key(&self, asset_path: &str) -> String {
        format!(
            "pack://{}@{}/{}/{}/{}?content={}",
            self.pack_id,
            self.pack_version,
            self.provider,
            self.mount,
            asset_path.trim_start_matches('/'),
            self.content_hash
        )
    }
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedAccessGateContent {
    pub(super) location_id: u64,
    pub(super) required_grant_id: String,
    #[serde(default)]
    pub(super) required_card_id: Option<String>,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedFactionContent {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) axis: String,
    #[serde(default)]
    pub(super) opposes: Vec<String>,
    pub(super) truth: String,
    pub(super) shadow: String,
    pub(super) doctrine: String,
    #[serde(default)]
    pub(super) verbs: Vec<String>,
    #[serde(default)]
    pub(super) motif: Vec<String>,
    #[serde(default)]
    pub(super) home_location_ids: Vec<u64>,
    #[serde(default)]
    pub(super) player_facing: bool,
    #[serde(default)]
    pub(super) member_actor_ids: Vec<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedActorContent {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: u64,
    pub(super) name: String,
    pub(super) speech_mode: String,
    pub(super) title: String,
    pub(super) description: String,
    #[serde(default)]
    pub(super) ambient_autonomy: Option<bool>,
    #[serde(default)]
    pub(super) location_id: Option<u64>,
    #[serde(default)]
    pub(super) stats: Option<SeedStatBlockContent>,
    #[serde(default)]
    pub(super) desires: Vec<SeedResidentDesireContent>,
    #[serde(default)]
    pub(super) attachments: Vec<SeedResidentAttachmentContent>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedActorFacetContent {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) actor_ref: String,
    #[serde(default)]
    pub(super) faction_ids: Vec<String>,
    #[serde(default)]
    pub(super) vocabulary: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedResidentDesireContent {
    pub(super) item_id: u64,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedResidentAttachmentContent {
    pub(super) item_id: u64,
    pub(super) reason: String,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub(super) struct SeedStatBlockContent {
    pub(super) strength: i8,
    pub(super) dexterity: i8,
    pub(super) constitution: i8,
    pub(super) intelligence: i8,
    pub(super) wisdom: i8,
    pub(super) charisma: i8,
    pub(super) hp_base: i16,
    pub(super) level: u8,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedItemContent {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: u64,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) kind: String,
    pub(super) charges: u8,
    pub(super) location_id: u64,
    #[serde(default = "default_seed_item_role")]
    pub(super) role: String,
    #[serde(default = "default_seed_item_weight_tenths")]
    pub(super) weight_tenths: u16,
    #[serde(default = "default_seed_item_size")]
    pub(super) size: String,
    #[serde(default)]
    pub(super) container_capacity_tenths: u16,
    #[serde(default)]
    pub(super) skill_id: Option<String>,
    #[serde(default)]
    pub(super) skill_bonus: i8,
    #[serde(default)]
    pub(super) mechanics: Option<SeedPlayableItemMechanics>,
    #[serde(default)]
    pub(super) container_opening_size: Option<String>,
    #[serde(default)]
    pub(super) allowed_contents: Vec<String>,
    #[serde(default)]
    pub(super) access_cost: Option<String>,
    #[serde(default)]
    pub(super) nested_containers: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SeedPlayableItemMechanics {
    pub(super) binding: String,
    pub(super) equipment_profile: String,
    pub(super) target_predicate: String,
    pub(super) resolver: String,
    pub(super) effect_budget: serde_json::Value,
    pub(super) uses: u8,
    pub(super) exhaustion: String,
    pub(super) recovery: String,
    pub(super) transfer_policy: String,
    pub(super) theft_policy: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) magic_effect: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedLocationContent {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: u64,
    pub(super) name: String,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) persona: String,
    #[serde(default)]
    pub(super) memory: Vec<String>,
    #[serde(default)]
    pub(super) biome: String,
    #[serde(default)]
    pub(super) terrain: Vec<String>,
    #[serde(default)]
    pub(super) allow_combat: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedRoomFeatureContent {
    pub(super) location_id: u64,
    pub(super) key: String,
    pub(super) name: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    pub(super) look: String,
    pub(super) search: String,
    #[serde(default)]
    pub(super) uses: Vec<SeedFeatureUseContent>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedFeatureUseContent {
    pub(super) item_id: u64,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedExitContent {
    pub(super) from_location_id: u64,
    pub(super) to_location_id: u64,
    #[serde(default)]
    pub(super) direction: Option<String>,
    #[serde(default)]
    pub(super) flags: u32,
    #[serde(default = "default_pathway_distance")]
    pub(super) distance: u8,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedHiddenExitContent {
    pub(super) id: String,
    pub(super) from_location_id: u64,
    pub(super) to_location_id: u64,
    pub(super) feature_key: String,
    pub(super) direction: String,
    pub(super) return_direction: String,
    pub(super) reveal_chance_percent: u8,
    pub(super) source: String,
    pub(super) discovery_text: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCardContent {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) subject_kind: String,
    pub(super) subject_id: u64,
    pub(super) card_id: String,
    pub(super) display_name: String,
    pub(super) role: String,
    pub(super) rarity: String,
    pub(super) title: String,
    pub(super) blurb: String,
    pub(super) aspect: String,
    pub(super) source: String,
    pub(super) asset_status: String,
    #[serde(default)]
    pub(super) image_url: Option<String>,
    #[serde(default)]
    pub(super) external_card_id: Option<String>,
    #[serde(default)]
    pub(super) set_number: Option<String>,
    #[serde(default)]
    pub(super) profile_id: Option<String>,
    #[serde(default)]
    pub(super) subject: Option<String>,
    #[serde(default)]
    pub(super) chain_image_uri: Option<String>,
    #[serde(default)]
    pub(super) requires_ownership: bool,
    #[serde(default)]
    pub(super) art: Option<SeedCardArtContent>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCardBindingContent {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: String,
    pub(super) entity_ref: String,
    pub(super) subject_kind: String,
    pub(super) subject_id: u64,
    pub(super) seed_card_id: String,
    pub(super) external_card_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedCardArtContent {
    pub(super) label: String,
    pub(super) role: String,
    pub(super) aspect: String,
    pub(super) bg: String,
    pub(super) ink: String,
    pub(super) accent: String,
    pub(super) glyph: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedLifecycleHookContent {
    pub(super) hook: String,
    pub(super) target_kind: String,
    pub(super) target_id: String,
    #[serde(default)]
    pub(super) claim_scope: String,
    #[serde(default)]
    pub(super) effects: Vec<EffectDescriptor>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct SeedFrontContent {
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) zone: String,
    pub(super) status: String,
    pub(super) location_ids: Vec<u64>,
    pub(super) participant_ids: Vec<u64>,
    pub(super) stakes_questions: Vec<String>,
    pub(super) portent_clock_id: String,
    pub(super) job_ids: Vec<String>,
    pub(super) impending_outcome: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct SeedEvolutionTrack {
    pub(super) actor_id: u64,
    pub(super) requirements: Vec<SeedEvolutionRequirementContent>,
}

#[derive(Debug, Deserialize)]
pub(super) struct SeedEvolutionRequirementContent {
    pub(super) item_id: u64,
    pub(super) target_kind: String,
    pub(super) target_id: u64,
}

#[derive(Debug, Deserialize)]
pub(super) struct SeedRecipeContent {
    pub(super) id: u64,
    pub(super) key: String,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) input_item_ids: Vec<u64>,
    pub(super) output: Option<SeedRecipeOutputContent>,
    pub(super) balance: SeedRecipeBalanceContent,
}

#[derive(Debug, Deserialize)]
pub(super) struct SeedRecipeOutputContent {
    pub(super) item_id: u64,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) kind: String,
    pub(super) charges: u8,
    pub(super) target_kind: String,
    pub(super) target_id: u64,
}

#[derive(Debug, Deserialize)]
pub(super) struct SeedRecipeBalanceContent {
    pub(super) kind: String,
    pub(super) target_kind: String,
    pub(super) target_id: u64,
    pub(super) reason: String,
}

pub(super) fn parse_seed_json<T: DeserializeOwned>(label: &str, value: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|error| format!("{label}: {error}"))
}

pub(super) fn configured_content_root() -> PathBuf {
    if let Ok(path) = std::env::var("COSYWORLD_CONTENT_ROOT") {
        return PathBuf::from(path);
    }
    let source_tree_content = Path::new(env!("CARGO_MANIFEST_DIR")).join("../content");
    if source_tree_content.exists() {
        source_tree_content
    } else {
        PathBuf::from("/app/v2/content")
    }
}

fn safe_relative_asset_path(asset_path: &str) -> bool {
    !asset_path.is_empty()
        && asset_path.len() <= 512
        && Path::new(asset_path)
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

pub(super) fn seed_asset_mount_path(mount: &SeedAssetMount, asset_path: &str) -> Option<PathBuf> {
    if !safe_relative_asset_path(asset_path) {
        return None;
    }
    Some(
        configured_content_root()
            .join(&mount.root)
            .join(&mount.directory)
            .join(asset_path),
    )
}

pub(super) fn asset_content_type(asset_path: &str) -> &'static str {
    if asset_path.ends_with(".webp") {
        "image/webp"
    } else if asset_path.ends_with(".svg") {
        "image/svg+xml"
    } else if asset_path.ends_with(".json") {
        "application/json"
    } else {
        "image/png"
    }
}

pub(super) fn validate_worldpack_manifest(manifest: &SeedWorldpackManifest) -> Result<(), String> {
    let has_world_pack = manifest
        .packs
        .iter()
        .any(|pack| matches!(pack.kind.as_str(), "world" | "campaign"));
    if manifest.schema_version != 2
        || manifest.pack_contract != "cosyworld.content-pack/1"
        || manifest.canonical_id_mapping_version != 1
        || manifest.id.trim().is_empty()
        || manifest.name.trim().is_empty()
        || manifest.version == 0
        || (has_world_pack && manifest.entry_location.trim().is_empty())
        || (!has_world_pack && !manifest.entry_location.trim().is_empty())
        || !valid_sha256_digest(&manifest.bundle_hash)
        || manifest.packs.is_empty()
    {
        return Err("worldpack manifest is missing id, name, or version".to_string());
    }
    if let Some(avatar_naming) = manifest.avatar_naming.as_ref() {
        cosyworld_ai_model::validate_avatar_naming_config(avatar_naming)
            .map_err(|error| format!("invalid worldpack avatar_naming: {error}"))?;
    }
    let mut pack_ids = BTreeSet::new();
    for pack in &manifest.packs {
        if pack.id.trim().is_empty()
            || pack.name.trim().is_empty()
            || pack.version.trim().is_empty()
            || !matches!(
                pack.kind.as_str(),
                "world" | "campaign" | "catalog" | "assets" | "rules"
            )
            || pack.license.trim().is_empty()
            || !pack.license_url.starts_with("https://")
            || pack.provenance.author.trim().is_empty()
            || pack.provenance.source_name.trim().is_empty()
            || !pack.provenance.source_url.starts_with("https://")
            || !valid_sha256_digest(&pack.integrity)
            || !pack_ids.insert(pack.id.as_str())
        {
            return Err(format!("invalid or duplicate worldpack pack {}", pack.id));
        }
        if pack.kind == "rules" {
            if !matches!(
                pack.rules_adapter.as_deref(),
                Some("cosyworld.rules/1" | "cosyworld.rules/2")
            ) || pack
                .rules_namespace
                .as_deref()
                .is_none_or(|namespace| namespace.trim().is_empty())
            {
                return Err(format!("invalid rules pack metadata for {}", pack.id));
            }
            if pack.rules_adapter.as_deref() == Some("cosyworld.rules/2") {
                if manifest.rules_profile.is_empty()
                    || pack.rules_profile.as_deref() != Some(manifest.rules_profile.as_str())
                {
                    return Err(format!(
                        "rules profile pack {} does not provide {}",
                        pack.id, manifest.rules_profile
                    ));
                }
            } else if pack.rules_profile.is_some() {
                return Err(format!(
                    "reference rules pack {} cannot activate a rules profile",
                    pack.id
                ));
            }
        } else if !manifest.rules_profile.is_empty()
            && pack.rules_profile.as_deref() != Some(manifest.rules_profile.as_str())
        {
            return Err(format!(
                "pack {} does not target active rules profile {}",
                pack.id, manifest.rules_profile
            ));
        }
    }
    if manifest.registry != "registry.json"
        || manifest.content_references != "content_refs.json"
        || manifest.licenses != "licenses.json"
    {
        return Err(
            "worldpack manifest does not identify its compiled registry and content references"
                .to_string(),
        );
    }
    let compatibility = &manifest.persistence_compatibility;
    if compatibility.schema_version == 0 {
        if !compatibility.replay_compatible_bundle_hashes.is_empty() {
            return Err(
                "worldpack persistence compatibility hashes require schema version 1".to_string(),
            );
        }
    } else {
        let mut compatible_hashes = BTreeSet::new();
        if compatibility.schema_version != 1
            || compatibility
                .replay_compatible_bundle_hashes
                .iter()
                .any(|hash| !valid_sha256_digest(hash) || !compatible_hashes.insert(hash.as_str()))
        {
            return Err("invalid worldpack persistence compatibility policy".to_string());
        }
    }
    Ok(())
}

pub(super) fn valid_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .chars()
                .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
    })
}

fn validate_seed_rules_profile(bundle: &SeedRuleBundle) -> Result<(), String> {
    let resources = &bundle.resources;
    let profile = resources
        .profiles
        .first()
        .ok_or_else(|| format!("rules/2 bundle {} has no profile", bundle.pack_id))?;
    if profile.id != "cosyworld.srd5/1"
        || profile.source_document != "System Reference Document 5.2.1"
        || profile.source_version != "5.2.1"
        || profile.source_pack != "cosyworld.rules-srd-5.2.1"
        || profile.license != "CC-BY-4.0"
        || profile.compatibility_claim != "bounded_profile"
        || profile.excluded_systems.is_empty()
        || profile.cosyworld_deltas.is_empty()
        || profile.source_reference.trim().is_empty()
        || profile.import_transform.trim().is_empty()
        || !profile.modified
    {
        return Err(format!("invalid rules profile {}", profile.id));
    }

    let required_actions = BTreeSet::from([
        "srd5.2.1:attack",
        "srd5.2.1:dash",
        "srd5.2.1:disengage",
        "srd5.2.1:dodge",
        "srd5.2.1:help",
        "srd5.2.1:hide",
        "srd5.2.1:influence",
        "srd5.2.1:magic",
        "srd5.2.1:ready",
        "srd5.2.1:search",
        "srd5.2.1:study",
        "srd5.2.1:utilize",
    ]);
    let mut action_ids = BTreeSet::new();
    for action in &resources.actions {
        let supported = matches!(action.support_status.as_str(), "kernel" | "projection");
        if !required_actions.contains(action.id.as_str())
            || action.namespace != "srd5.2.1"
            || action.domain != "rules_action"
            || action.label.trim().is_empty()
            || action.source_reference.trim().is_empty()
            || action.aliases.is_empty()
            || action.aliases.iter().any(|alias| alias.trim().is_empty())
            || !matches!(
                action.support_status.as_str(),
                "kernel" | "projection" | "unsupported"
            )
            || (supported && action.resolver_kind == "none")
            || (!supported && action.resolver_kind != "none")
            || action.cosyworld_delta.trim().is_empty()
            || !action.modified
            || !action_ids.insert(action.id.as_str())
        {
            return Err(format!("invalid rules action {}", action.id));
        }
    }
    if action_ids != required_actions {
        return Err("rules profile does not declare exactly twelve SRD actions".to_string());
    }

    let mut conformance_ids = BTreeSet::new();
    for row in &resources.conformance {
        let Some(action) = resources
            .actions
            .iter()
            .find(|action| action.id == row.action_id)
        else {
            return Err(format!(
                "conformance references unknown action {}",
                row.action_id
            ));
        };
        if row.support_status != action.support_status
            || row.resolver_kind != action.resolver_kind
            || row.safe_behavior.trim().is_empty()
            || row.risky_behavior.trim().is_empty()
            || row.cosyworld_delta.trim().is_empty()
            || (action.support_status != "unsupported"
                && row
                    .replay_fixture
                    .as_deref()
                    .is_none_or(|fixture| fixture.trim().is_empty()))
            || !conformance_ids.insert(row.action_id.as_str())
        {
            return Err(format!("invalid conformance for {}", row.action_id));
        }
        let _ = (&row.legal_targets, &row.event_outputs);
    }
    if conformance_ids != action_ids {
        return Err("rules conformance does not cover exactly twelve SRD actions".to_string());
    }

    let mut operation_ids = BTreeSet::new();
    for operation in &resources.operations {
        if !operation.id.starts_with("cosyworld.operation/")
            || !matches!(
                operation.domain.as_str(),
                "movement"
                    | "communication"
                    | "object_transfer"
                    | "procedure"
                    | "cosy_advancement"
                    | "interface_meta"
            )
            || operation.label.trim().is_empty()
            || operation.aliases.is_empty()
            || operation.resolver_kind.trim().is_empty()
            || operation.source_reference.trim().is_empty()
            || !operation.modified
            || !operation_ids.insert(operation.id.as_str())
        {
            return Err(format!("invalid rules operation {}", operation.id));
        }
    }

    let mut ability_ids = BTreeSet::new();
    for ability in &resources.abilities {
        if ability.label.trim().is_empty()
            || ability.source_reference.trim().is_empty()
            || ability.modified
            || !ability_ids.insert(ability.id.as_str())
        {
            return Err(format!("invalid rules ability {}", ability.id));
        }
    }
    if ability_ids
        != BTreeSet::from([
            "strength",
            "dexterity",
            "constitution",
            "intelligence",
            "wisdom",
            "charisma",
        ])
    {
        return Err("rules profile must declare the six abilities".to_string());
    }

    let mut skill_ids = BTreeSet::new();
    for skill in &resources.skills {
        if skill.label.trim().is_empty()
            || skill.source_reference.trim().is_empty()
            || !ability_ids.contains(skill.ability.as_str())
            || !skill_ids.insert(skill.id.as_str())
        {
            return Err(format!("invalid rules skill {}", skill.id));
        }
    }
    if skill_ids.len() != 18 {
        return Err("rules profile must declare eighteen skills".to_string());
    }

    let mut role_ids = BTreeSet::new();
    for role in &resources.item_roles {
        if role.resolver_kind.trim().is_empty()
            || role.transfer_policy.trim().is_empty()
            || role.theft_policy.trim().is_empty()
            || !role_ids.insert(role.id.as_str())
        {
            return Err(format!("invalid rules item role {}", role.id));
        }
        let _ = role.mechanical_descriptor_required;
    }
    if role_ids
        != BTreeSet::from([
            "generic",
            "consumable",
            "weapon",
            "skill_charm",
            "spell",
            "container",
            "tool",
            "relic",
        ])
    {
        return Err("rules profile has an incomplete playable-item role registry".to_string());
    }

    let mut equipment_ids = BTreeSet::new();
    for equipment in &resources.equipment_profiles {
        if equipment.slot_kind.trim().is_empty()
            || equipment.base_slots == 0
            || equipment.maximum_slots < equipment.base_slots
            || equipment.unlock.trim().is_empty()
            || equipment.source_reference.trim().is_empty()
            || !equipment.modified
            || !equipment_ids.insert(equipment.id.as_str())
        {
            return Err(format!("invalid equipment profile {}", equipment.id));
        }
    }

    let mut magic_effect_ids = BTreeSet::new();
    for effect in &resources.magic_effects {
        if effect.rules_action != "srd5.2.1:magic"
            || effect.resolver_kind != "bounded_magic_v1"
            || effect.target_predicate.trim().is_empty()
            || !effect.effect.is_object()
            || effect.uses == 0
            || effect.recovery.trim().is_empty()
            || effect.source_reference.trim().is_empty()
            || !effect.modified
            || !magic_effect_ids.insert(effect.id.as_str())
        {
            return Err(format!("invalid magic effect {}", effect.id));
        }
    }

    let mut legacy_kinds = BTreeSet::new();
    for binding in &resources.legacy_bindings {
        if !matches!(
            binding.binding_kind.as_str(),
            "rules_action" | "operation" | "contextual"
        ) || binding.binding_id.split('|').any(|target| {
            if binding.binding_kind == "operation" {
                !operation_ids.contains(target)
            } else {
                !action_ids.contains(target)
            }
        }) || !legacy_kinds.insert(binding.legacy_kind.as_str())
        {
            return Err(format!(
                "invalid legacy action binding {}",
                binding.legacy_kind
            ));
        }
    }
    for required_kind in [
        "attack",
        "bank_ledger",
        "chat",
        "check",
        "craft",
        "create_avatar",
        "create_bond",
        "defend",
        "flee",
        "give_item",
        "help",
        "move",
        "pick_up",
        "prepare",
        "resolve_bond",
        "rest",
        "search",
        "study",
        "influence",
        "cast_spell",
        "trade_item",
        "unlock_charm_slot",
        "use_feature",
        "use_item",
        "wait",
        "work",
    ] {
        if !legacy_kinds.contains(required_kind) {
            return Err(format!(
                "active rules profile has no binding for runtime offer kind {required_kind}"
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_seed_content(content: &SeedContent) -> Result<(), String> {
    let packs_by_id = content
        .manifest
        .packs
        .iter()
        .map(|pack| (pack.id.as_str(), pack))
        .collect::<BTreeMap<_, _>>();
    let mut vocabulary_pack_ids = BTreeSet::new();
    for vocabulary in &content.action_vocabulary {
        if !packs_by_id.contains_key(vocabulary.pack_id.as_str())
            || !vocabulary_pack_ids.insert(vocabulary.pack_id.as_str())
            || [
                &vocabulary.notice,
                &vocabulary.inspect,
                &vocabulary.scout,
                &vocabulary.travel,
                &vocabulary.contribute,
                &vocabulary.push,
                &vocabulary.help,
            ]
            .into_iter()
            .any(|label| label.trim().is_empty())
        {
            return Err(format!(
                "invalid action vocabulary for pack {}",
                vocabulary.pack_id
            ));
        }
    }
    let mut licensed_pack_ids = BTreeSet::new();
    for record in &content.licenses {
        let Some(pack) = packs_by_id.get(record.pack_id.as_str()) else {
            return Err(format!(
                "license record {} references an unknown pack",
                record.pack_id
            ));
        };
        if record.name != pack.name
            || record.version != pack.version
            || record.license_identifier != pack.license
            || record.license_url != pack.license_url
            || record.provenance.author != pack.provenance.author
            || record.provenance.source_name != pack.provenance.source_name
            || record.provenance.source_url != pack.provenance.source_url
            || record.provenance.modification_notice != pack.provenance.modification_notice
            || !licensed_pack_ids.insert(record.pack_id.as_str())
        {
            return Err(format!("invalid license record for {}", record.pack_id));
        }
        for notice in &record.notices {
            if !matches!(notice.kind.as_str(), "attribution" | "license" | "notice")
                || notice.title.trim().is_empty()
                || notice.file.trim().is_empty()
                || notice.text.trim().is_empty()
                || notice
                    .source_url
                    .as_deref()
                    .is_some_and(|url| !url.starts_with("https://"))
            {
                return Err(format!("invalid bundled notice for {}", record.pack_id));
            }
        }
        let source = format!(
            "{} {}",
            record.provenance.source_name,
            record
                .notices
                .iter()
                .filter_map(|notice| notice.source_name.as_deref())
                .collect::<Vec<_>>()
                .join(" ")
        )
        .to_ascii_lowercase();
        if (source.contains("system reference document") || source.contains("srd"))
            && (record.license_identifier != "CC-BY-4.0"
                || record.provenance.modification_notice.is_none()
                || !record.notices.iter().any(|notice| {
                    notice.kind == "attribution"
                        && notice.text.contains("Wizards of the Coast LLC")
                        && notice
                            .text
                            .contains("creativecommons.org/licenses/by/4.0/legalcode")
                }))
        {
            return Err(format!(
                "SRD-derived pack {} has incomplete attribution",
                record.pack_id
            ));
        }
    }
    if licensed_pack_ids.len() != content.manifest.packs.len() {
        return Err("not every mounted pack has a license record".to_string());
    }
    let mut entitlement_grant_ids = BTreeSet::new();
    for pack in &content.manifest.packs {
        if let Some(distribution) = pack.distribution.as_ref() {
            if distribution.media_type != "application/vnd.cosyworld.pack+json"
                || distribution.canonicalization != "jcs"
                || !matches!(
                    distribution.permanence.as_str(),
                    "content-addressed" | "arweave"
                )
                || distribution
                    .permanent_uri
                    .as_deref()
                    .is_some_and(|uri| !uri.starts_with("ar://"))
            {
                return Err(format!(
                    "invalid distribution metadata for pack {}",
                    pack.id
                ));
            }
        }
        let Some(entitlements) = pack.entitlements.as_ref() else {
            continue;
        };
        if entitlements.schema_version != 1 {
            return Err(format!("invalid entitlement schema for pack {}", pack.id));
        }
        let mut authority_ids = BTreeSet::new();
        for authority in &entitlements.authorities {
            if authority.id.trim().is_empty()
                || !pack.capabilities.iter().any(|capability| {
                    capability.id == authority.provider && capability.kind == "entitlements"
                })
                || !matches!(
                    authority.kind.as_str(),
                    "asset_feed" | "solana_collection" | "signed_set"
                )
                || !authority_ids.insert(authority.id.as_str())
            {
                return Err(format!(
                    "invalid entitlement authority for pack {}",
                    pack.id
                ));
            }
            if authority.kind == "solana_collection"
                && (authority.network.as_deref().unwrap_or_default().is_empty()
                    || authority.standard.as_deref().unwrap_or_default().is_empty()
                    || authority
                        .collection_address
                        .as_deref()
                        .unwrap_or_default()
                        .is_empty())
            {
                return Err(format!("incomplete Solana authority {}", authority.id));
            }
            if authority.kind == "signed_set"
                && (authority.algorithm.as_deref() != Some("ed25519")
                    || authority
                        .public_key
                        .as_deref()
                        .unwrap_or_default()
                        .is_empty())
            {
                return Err(format!("invalid signed-set authority {}", authority.id));
            }
            let _ = (
                &authority.asset_kind,
                &authority.issuer,
                &authority.chain,
                &authority.collection_binding,
            );
        }
        for grant in &entitlements.grants {
            if !grant.id.starts_with(&format!("{}:", pack.id))
                || !authority_ids.contains(grant.authority_id.as_str())
                || !entitlement_grant_ids.insert(grant.id.as_str())
            {
                return Err(format!("invalid entitlement grant {}", grant.id));
            }
        }
    }
    let mut asset_mount_ids = BTreeSet::new();
    let mut asset_public_prefixes = BTreeSet::new();
    for mount in &content.asset_mounts {
        let Some(pack) = packs_by_id.get(mount.pack_id.as_str()) else {
            return Err(format!(
                "asset mount {}:{} references an unknown pack",
                mount.pack_id, mount.mount
            ));
        };
        if mount.pack_version != pack.version
            || mount.pack_integrity != pack.integrity
            || !pack
                .capabilities
                .iter()
                .any(|capability| capability.id == mount.provider && capability.kind == "assets")
            || !valid_sha256_digest(&mount.content_hash)
            || !safe_relative_asset_path(&mount.root)
            || !safe_relative_asset_path(&mount.directory)
            || !safe_relative_asset_path(&mount.mount)
            || !mount.public_prefix.starts_with("/assets/")
            || mount.public_prefix.ends_with('/')
            || !asset_mount_ids.insert((mount.pack_id.as_str(), mount.mount.as_str()))
            || !asset_public_prefixes.insert(mount.public_prefix.as_str())
        {
            return Err(format!(
                "invalid asset provider mount {}:{}",
                mount.pack_id, mount.mount
            ));
        }
    }
    let mut rules_pack_ids = BTreeSet::new();
    let mut rules_namespaces = BTreeSet::new();
    let mut active_rules_profile_bundle = None;
    for bundle in &content.rules {
        let Some(pack) = packs_by_id.get(bundle.pack_id.as_str()) else {
            return Err(format!(
                "rules bundle {} references an unknown pack",
                bundle.pack_id
            ));
        };
        if pack.kind != "rules"
            || bundle.pack_version != pack.version
            || !matches!(
                bundle.adapter.as_str(),
                "cosyworld.rules/1" | "cosyworld.rules/2"
            )
            || pack.rules_adapter.as_deref() != Some(bundle.adapter.as_str())
            || pack.rules_namespace.as_deref() != Some(bundle.namespace.as_str())
            || !rules_pack_ids.insert(bundle.pack_id.as_str())
            || !rules_namespaces.insert(bundle.namespace.as_str())
        {
            return Err(format!("invalid rules bundle {}", bundle.pack_id));
        }

        if bundle.adapter == "cosyworld.rules/2" {
            if pack.rules_profile.as_deref() != Some(content.manifest.rules_profile.as_str())
                || bundle.resources.profiles.len() != 1
                || bundle.resources.profiles[0].id != content.manifest.rules_profile
                || active_rules_profile_bundle
                    .replace(bundle.pack_id.as_str())
                    .is_some()
            {
                return Err(format!(
                    "invalid or duplicate active rules profile bundle {}",
                    bundle.pack_id
                ));
            }
            validate_seed_rules_profile(bundle)?;
            continue;
        }

        let mut condition_ids = BTreeSet::new();
        for condition in &bundle.resources.conditions {
            if !condition.id.starts_with("condition/")
                || condition.name.trim().is_empty()
                || condition.source_section.trim().is_empty()
                || condition.source_text.trim().is_empty()
                || !condition_ids.insert(condition.id.as_str())
            {
                return Err(format!("invalid rules condition {}", condition.id));
            }
            match condition.mapping.status.as_str() {
                "reference_only" if condition.mapping.kernel_condition.is_none() => {}
                "kernel"
                    if condition.id == "condition/unconscious"
                        && condition.mapping.kernel_condition.as_deref() == Some("unconscious") => {
                }
                _ => return Err(format!("invalid condition mapping {}", condition.id)),
            }
        }

        let mut monster_ids = BTreeSet::new();
        for monster in &bundle.resources.monster_seeds {
            if !monster.id.starts_with("monster/")
                || monster.name.trim().is_empty()
                || monster.source_name.trim().is_empty()
                || monster.size.trim().is_empty()
                || monster.creature_type.trim().is_empty()
                || monster.alignment.trim().is_empty()
                || monster.armor_class.trim().is_empty()
                || monster.hit_points.trim().is_empty()
                || monster.speed.trim().is_empty()
                || monster.challenge.trim().is_empty()
                || monster.mapping.status != "reference_only"
                || monster.mapping.kernel_condition.is_some()
                || !monster_ids.insert(monster.id.as_str())
            {
                return Err(format!("invalid rules monster seed {}", monster.id));
            }
            for ability in [
                "strength",
                "dexterity",
                "constitution",
                "intelligence",
                "wisdom",
                "charisma",
            ] {
                if !monster
                    .ability_scores
                    .get(ability)
                    .is_some_and(|score| (1..=30).contains(score))
                {
                    return Err(format!(
                        "invalid {ability} for rules monster {}",
                        monster.id
                    ));
                }
            }
            if monster.features.iter().any(|feature| {
                feature.name.trim().is_empty() || feature.description.trim().is_empty()
            }) {
                return Err(format!("invalid feature for rules monster {}", monster.id));
            }
            let _ = (&monster.senses, &monster.mapping.suggested_role);
        }
    }
    if !content.manifest.rules_profile.is_empty() && active_rules_profile_bundle.is_none() {
        return Err(format!(
            "no rules bundle provides active profile {}",
            content.manifest.rules_profile
        ));
    }
    let action_ids = content
        .rules
        .iter()
        .find(|bundle| bundle.adapter == "cosyworld.rules/2")
        .map(|bundle| {
            bundle
                .resources
                .actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let mut contribution_ids = BTreeSet::new();
    let mut compiled_variants = Vec::new();
    let mut compiled_extensions = Vec::new();
    for bundle in &content.contributions {
        let Some(pack) = packs_by_id.get(bundle.pack_id.as_str()) else {
            return Err(format!(
                "contribution bundle {} references an unknown pack",
                bundle.pack_id
            ));
        };
        if pack.kind == "rules"
            || bundle.pack_version != pack.version
            || bundle.rules_profile != content.manifest.rules_profile
        {
            return Err(format!("invalid contribution bundle {}", bundle.pack_id));
        }
        for reskin in &bundle.reskins {
            if !reskin.id.starts_with(&format!("{}:", bundle.pack_id))
                || !action_ids.contains(reskin.based_on.as_str())
                || reskin.label.trim().is_empty()
                || reskin.compatibility != content.manifest.rules_profile
                || reskin.source_reference.trim().is_empty()
                || !matches!(
                    reskin.scope.kind.as_str(),
                    "location" | "feature" | "actor" | "item" | "project"
                )
                || reskin.scope.id == 0
                || !contribution_ids.insert(reskin.id.as_str())
            {
                return Err(format!("invalid action reskin {}", reskin.id));
            }
        }
        for offer in &bundle.offers {
            if !offer.id.starts_with(&format!("{}:", bundle.pack_id))
                || !action_ids.contains(offer.based_on.as_str())
                || offer.label.trim().is_empty()
                || offer.target_predicate.trim().is_empty()
                || !offer.context.is_object()
                || !matches!(
                    offer.subject.kind.as_str(),
                    "location" | "feature" | "actor" | "item" | "project"
                )
                || offer.subject.id == 0
                || offer.source_reference.trim().is_empty()
                || !contribution_ids.insert(offer.id.as_str())
            {
                return Err(format!("invalid contextual action offer {}", offer.id));
            }
        }
        for variant in &bundle.variants {
            let id = variant
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if id.is_empty() || !contribution_ids.insert(id) {
                return Err(format!("invalid or duplicate rules variant {id}"));
            }
            compiled_variants.push(id.to_string());
        }
        for extension in &bundle.extensions {
            let id = extension
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if id.is_empty() || !contribution_ids.insert(id) {
                return Err(format!("invalid or duplicate rules extension {id}"));
            }
            compiled_extensions.push(id.to_string());
        }
    }
    compiled_variants.sort();
    compiled_extensions.sort();
    if compiled_variants != content.manifest.active_rules_variants
        || compiled_extensions != content.manifest.active_rules_extensions
    {
        return Err("compiled rules contribution identity is stale".to_string());
    }
    for pack in content
        .manifest
        .packs
        .iter()
        .filter(|pack| pack.kind == "rules")
    {
        if !rules_pack_ids.contains(pack.id.as_str()) {
            return Err(format!(
                "rules pack {} has no compiled rules bundle",
                pack.id
            ));
        }
    }

    let mut attributed_pack_ids = BTreeSet::new();
    for attribution in &content.attributions {
        let Some(pack) = packs_by_id.get(attribution.pack_id.as_str()) else {
            return Err(format!(
                "attribution {} references an unknown pack",
                attribution.pack_id
            ));
        };
        if attribution.license != pack.license
            || attribution.source_name.trim().is_empty()
            || attribution.source_url.trim().is_empty()
            || attribution.text.trim().is_empty()
            || !attributed_pack_ids.insert(attribution.pack_id.as_str())
        {
            return Err(format!("invalid attribution for {}", attribution.pack_id));
        }
    }
    for pack in content
        .manifest
        .packs
        .iter()
        .filter(|pack| pack.kind == "rules")
    {
        if !attributed_pack_ids.contains(pack.id.as_str()) {
            return Err(format!("rules pack {} has no attribution", pack.id));
        }
    }

    let mut actor_ids = BTreeSet::new();
    for actor in &content.actors {
        if actor.id == 0 || !actor_ids.insert(actor.id) {
            return Err(format!("duplicate or invalid seed actor id {}", actor.id));
        }
        if actor.name.trim().is_empty() || actor.speech_mode.trim().is_empty() {
            return Err(format!(
                "seed actor {} is missing name or speech mode",
                actor.id
            ));
        }
        let Some(stats) = actor.stats.as_ref() else {
            return Err(format!("seed actor {} is missing stats", actor.id));
        };
        validate_seed_stats(actor.id, stats)?;
    }

    let mut item_ids = BTreeSet::new();
    for item in &content.items {
        if item.id == 0 || item.charges == 0 || !item_ids.insert(item.id) {
            return Err(format!("duplicate or invalid seed item id {}", item.id));
        }
        if item.name.trim().is_empty()
            || item.description.trim().is_empty()
            || seed_item_kind(item).is_none()
        {
            return Err(format!("seed item {} is missing name", item.id));
        }
    }

    let mut location_ids = BTreeSet::new();
    for location in &content.locations {
        if location.id == 0 || !location_ids.insert(location.id) {
            return Err(format!(
                "duplicate or invalid seed location id {}",
                location.id
            ));
        }
        if location.name.trim().is_empty() {
            return Err(format!("seed location {} is missing name", location.id));
        }
        if location.title.trim().is_empty()
            || location.description.trim().is_empty()
            || location.persona.trim().is_empty()
        {
            return Err(format!(
                "seed location {} is missing title, description, or persona",
                location.id
            ));
        }
    }
    let mut character_creation_pack_ids = BTreeSet::new();
    let mut character_creation_profile_ids = BTreeSet::new();
    for bundle in &content.character_creation {
        let Some(pack) = packs_by_id.get(bundle.pack_id.as_str()) else {
            return Err(format!(
                "character creation bundle {} references an unknown pack",
                bundle.pack_id
            ));
        };
        if !matches!(pack.kind.as_str(), "world" | "campaign")
            || bundle.pack_version != pack.version
            || !character_creation_pack_ids.insert(bundle.pack_id.as_str())
        {
            return Err(format!(
                "invalid character creation bundle {}",
                bundle.pack_id
            ));
        }
        for profile in &bundle.profiles {
            if !matches!(profile.schema_version, 1 | 2)
                || profile.id.trim().is_empty()
                || profile.name.trim().is_empty()
                || profile.description.trim().is_empty()
                || profile.prompt.trim().is_empty()
                || !location_ids.contains(&profile.entry_location_id)
                || !(2..=6).contains(&profile.choices.len())
                || !character_creation_profile_ids.insert(profile.id.as_str())
            {
                return Err(format!("invalid character creation profile {}", profile.id));
            }
            let mut choice_ids = BTreeSet::new();
            for choice in &profile.choices {
                if choice.id.trim().is_empty()
                    || choice.label.trim().is_empty()
                    || choice.detail.trim().is_empty()
                    || normalize_calling_statement(&choice.calling).is_none()
                    || choice.title.trim().is_empty()
                    || choice.description.trim().is_empty()
                    || skill_label(&choice.starting_skill_id).is_none()
                    || !choice_ids.insert(choice.id.as_str())
                {
                    return Err(format!(
                        "invalid character creation choice {}:{}",
                        profile.id, choice.id
                    ));
                }
            }
            if !choice_ids.contains(profile.default_choice_id.as_str()) {
                return Err(format!(
                    "character creation profile {} has missing default choice",
                    profile.id
                ));
            }
            if profile.schema_version == 2 {
                if profile
                    .class_prompt
                    .as_deref()
                    .is_none_or(|prompt| prompt.trim().is_empty())
                    || !(3..=12).contains(&profile.species.len())
                    || !(3..=12).contains(&profile.origins.len())
                {
                    return Err(format!(
                        "character creation profile {} has invalid staged identity cards",
                        profile.id
                    ));
                }
                for (slot, cards, default_id) in [
                    (
                        "species",
                        profile.species.as_slice(),
                        profile.default_species_id.as_deref(),
                    ),
                    (
                        "origin",
                        profile.origins.as_slice(),
                        profile.default_origin_id.as_deref(),
                    ),
                ] {
                    let mut card_ids = BTreeSet::new();
                    for card in cards {
                        if card.id.trim().is_empty()
                            || card.label.trim().is_empty()
                            || card.detail.trim().is_empty()
                            || card.title.trim().is_empty()
                            || card.description.trim().is_empty()
                            || card.visual_prompt.trim().is_empty()
                            || !card_ids.insert(card.id.as_str())
                        {
                            return Err(format!(
                                "invalid character creation {slot} card {}:{}",
                                profile.id, card.id
                            ));
                        }
                    }
                    if default_id.is_none_or(|default_id| !card_ids.contains(default_id)) {
                        return Err(format!(
                            "character creation profile {} has missing default {slot}",
                            profile.id
                        ));
                    }
                }
            }
        }
    }
    for pack in content
        .manifest
        .packs
        .iter()
        .filter(|pack| pack.kind == "campaign")
    {
        if !character_creation_pack_ids.contains(pack.id.as_str()) {
            return Err(format!(
                "campaign pack {} has no character creation bundle",
                pack.id
            ));
        }
    }
    for actor in &content.actors {
        let Some(location_id) = actor.location_id else {
            return Err(format!("seed actor {} is missing location", actor.id));
        };
        if !location_ids.contains(&location_id) {
            return Err(format!(
                "seed actor {} references missing location {}",
                actor.id, location_id
            ));
        }
    }
    for item in &content.items {
        if !location_ids.contains(&item.location_id) {
            return Err(format!(
                "seed item {} references missing location {}",
                item.id, item.location_id
            ));
        }
    }
    for actor in &content.actors {
        let mut desired_item_ids = BTreeSet::new();
        for desire in &actor.desires {
            if !item_ids.contains(&desire.item_id)
                || desire.reason.trim().is_empty()
                || !desired_item_ids.insert(desire.item_id)
            {
                return Err(format!(
                    "seed actor {} has invalid desire for item {}",
                    actor.id, desire.item_id
                ));
            }
        }
        let mut attached_item_ids = BTreeSet::new();
        for attachment in &actor.attachments {
            if !item_ids.contains(&attachment.item_id)
                || attachment.reason.trim().is_empty()
                || !attached_item_ids.insert(attachment.item_id)
            {
                return Err(format!(
                    "seed actor {} has invalid attachment to item {}",
                    actor.id, attachment.item_id
                ));
            }
        }
    }

    for actor in &content.actors {
        if let Some(location_id) = actor.location_id {
            if !location_ids.contains(&location_id) {
                return Err(format!(
                    "seed actor {} references missing location {}",
                    actor.id, location_id
                ));
            }
        }
    }

    let mut faction_ids = BTreeSet::new();
    for faction in &content.factions {
        if faction.id.trim().is_empty()
            || faction.name.trim().is_empty()
            || faction.axis.trim().is_empty()
            || faction.truth.trim().is_empty()
            || faction.shadow.trim().is_empty()
            || faction.doctrine.trim().is_empty()
            || faction.verbs.is_empty()
            || faction.motif.is_empty()
            || !faction_ids.insert(faction.id.clone())
        {
            return Err(format!("invalid or duplicate seed faction {}", faction.id));
        }
        for location_id in &faction.home_location_ids {
            if !location_ids.contains(location_id) {
                return Err(format!(
                    "faction {} references missing home location {}",
                    faction.id, location_id
                ));
            }
        }
        for actor_id in &faction.member_actor_ids {
            if !actor_ids.contains(actor_id) {
                return Err(format!(
                    "faction {} references missing member actor {}",
                    faction.id, actor_id
                ));
            }
        }
    }
    let mut actor_facet_ids = BTreeSet::new();
    let mut actor_faction_facets = BTreeSet::new();
    for facet in &content.actor_facets {
        let Some(actor) = content
            .actors
            .iter()
            .find(|actor| actor.id == facet.actor_id)
        else {
            return Err(format!(
                "actor facet {} references missing actor {}",
                facet.id, facet.actor_id
            ));
        };
        let expected_ref = format!("pack://{}/actor/{}", actor.pack_id, actor.id);
        if facet.id.trim().is_empty()
            || facet.pack_id.trim().is_empty()
            || facet.actor_ref != expected_ref
            || facet.vocabulary.iter().any(|term| term.trim().is_empty())
            || !actor_facet_ids.insert(facet.id.as_str())
        {
            return Err(format!("invalid actor facet {}", facet.id));
        }
        for faction_id in &facet.faction_ids {
            if !faction_ids.contains(faction_id)
                || !actor_faction_facets.insert((facet.actor_id, faction_id.as_str()))
            {
                return Err(format!(
                    "actor facet {} has invalid faction {}",
                    facet.id, faction_id
                ));
            }
        }
    }
    for faction in &content.factions {
        for opposed_id in &faction.opposes {
            if opposed_id == &faction.id || !faction_ids.contains(opposed_id) {
                return Err(format!(
                    "faction {} has invalid opposition {}",
                    faction.id, opposed_id
                ));
            }
        }
    }

    let mut exit_keys = BTreeSet::new();
    let mut exit_direction_keys = BTreeSet::new();
    for exit in &content.exits {
        if !location_ids.contains(&exit.from_location_id)
            || !location_ids.contains(&exit.to_location_id)
            || !exit_keys.insert((exit.from_location_id, exit.to_location_id))
        {
            return Err(format!(
                "invalid or duplicate seed exit {} -> {}",
                exit.from_location_id, exit.to_location_id
            ));
        }
        if let Some(raw_direction) = exit.direction.as_deref() {
            let Some(direction) = canonical_direction(raw_direction) else {
                return Err(format!(
                    "invalid seed exit direction {:?} for {} -> {}",
                    exit.direction, exit.from_location_id, exit.to_location_id
                ));
            };
            if !exit_direction_keys.insert((exit.from_location_id, direction)) {
                return Err(format!(
                    "duplicate seed exit direction {} from location {}",
                    direction, exit.from_location_id
                ));
            }
        }
    }

    let mut feature_keys = BTreeSet::new();
    for feature in &content.room_features {
        if !location_ids.contains(&feature.location_id) {
            return Err(format!(
                "room feature {} references missing location {}",
                feature.key, feature.location_id
            ));
        }
        if feature.key.trim().is_empty()
            || feature.name.trim().is_empty()
            || feature.look.trim().is_empty()
            || feature.search.trim().is_empty()
        {
            return Err(format!(
                "room feature for location {} is missing key, name, look, or search text",
                feature.location_id
            ));
        }
        let feature_key = (feature.location_id, command_key(&feature.key));
        if feature_key.1.is_empty() || !feature_keys.insert(feature_key) {
            return Err(format!(
                "duplicate or invalid room feature key {} in location {}",
                feature.key, feature.location_id
            ));
        }
        for use_case in &feature.uses {
            if !item_ids.contains(&use_case.item_id) || use_case.text.trim().is_empty() {
                return Err(format!(
                    "room feature {} has invalid use item {}",
                    feature.key, use_case.item_id
                ));
            }
        }
    }
    let mut hidden_exit_ids = BTreeSet::new();
    for hidden_exit in &content.hidden_exits {
        if hidden_exit.id.trim().is_empty()
            || hidden_exit.feature_key.trim().is_empty()
            || hidden_exit.source.trim().is_empty()
            || hidden_exit.discovery_text.trim().is_empty()
            || hidden_exit.reveal_chance_percent == 0
            || hidden_exit.reveal_chance_percent > 100
            || hidden_exit.from_location_id == hidden_exit.to_location_id
            || !hidden_exit_ids.insert(hidden_exit.id.clone())
            || !location_ids.contains(&hidden_exit.from_location_id)
            || !location_ids.contains(&hidden_exit.to_location_id)
        {
            return Err(format!("invalid hidden exit {}", hidden_exit.id));
        }
        if !content.room_features.iter().any(|feature| {
            feature.location_id == hidden_exit.from_location_id
                && feature.key == hidden_exit.feature_key
        }) {
            return Err(format!(
                "hidden exit {} references missing feature {} in location {}",
                hidden_exit.id, hidden_exit.feature_key, hidden_exit.from_location_id
            ));
        }
        let Some(direction) = canonical_direction(&hidden_exit.direction) else {
            return Err(format!(
                "hidden exit {} has invalid direction {}",
                hidden_exit.id, hidden_exit.direction
            ));
        };
        if !exit_direction_keys.insert((hidden_exit.from_location_id, direction)) {
            return Err(format!(
                "hidden exit {} duplicates direction {} from location {}",
                hidden_exit.id, direction, hidden_exit.from_location_id
            ));
        }
        let Some(return_direction) = canonical_direction(&hidden_exit.return_direction) else {
            return Err(format!(
                "hidden exit {} has invalid return direction {}",
                hidden_exit.id, hidden_exit.return_direction
            ));
        };
        if !exit_direction_keys.insert((hidden_exit.to_location_id, return_direction)) {
            return Err(format!(
                "hidden exit {} duplicates return direction {} from location {}",
                hidden_exit.id, return_direction, hidden_exit.to_location_id
            ));
        }
    }

    let mut room_sheet_locations = BTreeSet::new();
    for sheet in &content.room_sheets {
        if sheet.id.trim().is_empty()
            || sheet.name.trim().is_empty()
            || sheet.safety.trim().is_empty()
            || sheet.aspects.is_empty()
            || sheet.boons.is_empty()
            || sheet.hooks.is_empty()
            || sheet.resources.is_empty()
            || !location_ids.contains(&sheet.location_id)
            || !room_sheet_locations.insert(sheet.location_id)
        {
            return Err(format!(
                "invalid or duplicate room sheet for location {}",
                sheet.location_id
            ));
        }
        if !matches!(room_sheet_zone(sheet), ZONE_SANCTUARY | ZONE_FRONTIER) {
            return Err(format!("room sheet {} has invalid zone", sheet.id));
        }
    }
    for location in &content.locations {
        if !room_sheet_locations.contains(&location.id) {
            return Err(format!("location {} is missing a room sheet", location.id));
        }
    }

    let mut clock_ids = BTreeSet::new();
    for clock in &content.clocks {
        if clock.id.trim().is_empty()
            || clock.scope.trim().is_empty()
            || clock.kind.trim().is_empty()
            || clock.label.trim().is_empty()
            || clock.segments == 0
            || clock.filled > clock.segments
            || !clock_ids.insert(clock.id.clone())
        {
            return Err(format!("invalid or duplicate clock {}", clock.id));
        }
        if clock.scope == "room" && !location_ids.contains(&clock.scope_id) {
            return Err(format!(
                "clock {} references missing room {}",
                clock.id, clock.scope_id
            ));
        }
    }

    let job_ids = content
        .jobs
        .iter()
        .map(|job| job.id.clone())
        .collect::<BTreeSet<_>>();
    if job_ids.len() != content.jobs.len() {
        return Err("duplicate seed job id".to_string());
    }
    for job in &content.jobs {
        if job.id.trim().is_empty()
            || job.premise.trim().is_empty()
            || job.stakes.trim().is_empty()
            || job.reward.label().trim().is_empty()
            || job.reward.orbs() < 0
            || !clock_ids.contains(&job.progress_clock_id)
            || !clock_ids.contains(&job.danger_clock_id)
            || (job.action_copy.label.trim().is_empty()
                != job.action_copy.summary.trim().is_empty())
        {
            return Err(format!("invalid seed job {}", job.id));
        }
        if job.contribution_schema_version != JOB_CONTRIBUTION_SCHEMA_VERSION
            || job.contribution_strategies.is_empty()
        {
            return Err(format!(
                "seed job {} is missing contribution schema v{}",
                job.id, JOB_CONTRIBUTION_SCHEMA_VERSION
            ));
        }
        let mut strategy_ids = BTreeSet::new();
        for strategy in &job.contribution_strategies {
            let target_identity_count = usize::from(strategy.target.id.is_some())
                + usize::from(strategy.target.predicate.is_some());
            let pack_matches =
                content.manifest.packs.iter().any(|pack| {
                    pack.id == strategy.pack_id && pack.version == strategy.pack_version
                });
            let rules_pack_matches = content.manifest.packs.iter().any(|pack| {
                pack.id == strategy.rules_pack_id && pack.version == strategy.rules_pack_version
            });
            let binding_count = usize::from(strategy.rules_action.is_some())
                + usize::from(strategy.operation.is_some());
            if strategy.version != JOB_CONTRIBUTION_SCHEMA_VERSION
                || strategy.id.trim().is_empty()
                || !strategy_ids.insert(strategy.id.clone())
                || strategy.action_kind.trim().is_empty()
                || binding_count != 1
                || strategy.target.kind.trim().is_empty()
                || strategy.target.label.trim().is_empty()
                || target_identity_count != 1
                || strategy.strategy_label.trim().is_empty()
                || strategy.narration_key.trim().is_empty()
                || strategy.rules_profile != content.manifest.rules_profile
                || strategy.rules_pack_id.trim().is_empty()
                || !rules_pack_matches
                || strategy.pack_id != job.pack_id
                || !pack_matches
                || (strategy.clock_id != job.progress_clock_id
                    && strategy.clock_id != job.danger_clock_id)
                || strategy
                    .baseline_progress
                    .saturating_add(strategy.success_progress)
                    .saturating_add(strategy.prepared_bonus_progress)
                    == 0
            {
                return Err(format!(
                    "job {} has invalid contribution strategy {}",
                    job.id, strategy.id
                ));
            }
            if let Some(predicate) = strategy.target.predicate.as_deref() {
                if !matches!(
                    predicate,
                    "current_room" | "job_participant_here" | "co_present_avatar"
                ) {
                    return Err(format!(
                        "job {} strategy {} has invalid target predicate {}",
                        job.id, strategy.id, predicate
                    ));
                }
            }
            match &strategy.resolution {
                ContributionResolutionPolicy::Certain => {}
                ContributionResolutionPolicy::SrdCheck { ability, dc } => {
                    if !matches!(
                        ability.to_ascii_lowercase().as_str(),
                        "strength"
                            | "dexterity"
                            | "constitution"
                            | "intelligence"
                            | "wisdom"
                            | "charisma"
                    ) || *dc == 0
                    {
                        return Err(format!(
                            "job {} strategy {} has invalid SRD check",
                            job.id, strategy.id
                        ));
                    }
                }
                ContributionResolutionPolicy::ExistingKernelOutcome { event_type } => {
                    if event_type.trim().is_empty() {
                        return Err(format!(
                            "job {} strategy {} has empty outcome event",
                            job.id, strategy.id
                        ));
                    }
                }
            }
            for requirement in &strategy.requirements {
                let valid = match requirement {
                    ContributionRequirement::AtLocation { location_id } => {
                        location_ids.contains(location_id)
                    }
                    ContributionRequirement::HeldItem { item_id } => item_ids.contains(item_id),
                    ContributionRequirement::ActiveTag { tag_id } => !tag_id.trim().is_empty(),
                    ContributionRequirement::RoomFeature {
                        location_id,
                        feature_key,
                    } => content.room_features.iter().any(|feature| {
                        feature.location_id == *location_id && feature.key == *feature_key
                    }),
                };
                if !valid {
                    return Err(format!(
                        "job {} strategy {} has invalid requirement",
                        job.id, strategy.id
                    ));
                }
            }
            for effect in strategy.on_success.iter().chain(strategy.on_failure.iter()) {
                validate_seed_effect_descriptor(
                    &format!("job {} strategy {}", job.id, strategy.id),
                    effect,
                    &actor_ids,
                    &item_ids,
                    &location_ids,
                    &clock_ids,
                    &job_ids,
                )?;
            }
        }
        let mut threshold_keys = BTreeSet::new();
        for threshold in &job.narrated_thresholds {
            let Some(clock) = content
                .clocks
                .iter()
                .find(|clock| clock.id == threshold.clock_id)
            else {
                return Err(format!(
                    "job {} has threshold for missing clock {}",
                    job.id, threshold.clock_id
                ));
            };
            if !threshold_keys.insert((threshold.clock_id.clone(), threshold.filled))
                || threshold.filled == 0
                || threshold.filled >= clock.segments
                || threshold.narration_key.trim().is_empty()
                || threshold.text.trim().is_empty()
            {
                return Err(format!(
                    "job {} has invalid narrated threshold {}:{}",
                    job.id, threshold.clock_id, threshold.filled
                ));
            }
        }
        for location_id in &job.location_ids {
            if !location_ids.contains(location_id) {
                return Err(format!(
                    "job {} references missing location {}",
                    job.id, location_id
                ));
            }
        }
        for participant_id in &job.participant_ids {
            if !actor_ids.contains(participant_id) {
                return Err(format!(
                    "job {} references missing participant {}",
                    job.id, participant_id
                ));
            }
        }
    }
    for sheet in &content.room_sheets {
        for project_id in &sheet.projects {
            if !job_ids.contains(project_id) {
                return Err(format!(
                    "room sheet {} references missing project {}",
                    sheet.id, project_id
                ));
            }
        }
    }
    let mut front_ids = BTreeSet::new();
    for front in &content.fronts {
        if front.id.trim().is_empty()
            || front.premise.trim().is_empty()
            || front.zone != ZONE_FRONTIER
            || !matches!(
                front.status.as_str(),
                "active" | "dormant" | "completed" | "failed"
            )
            || front.portent_clock_id.trim().is_empty()
            || front.impending_outcome.trim().is_empty()
            || front.location_ids.is_empty()
            || front.participant_ids.is_empty()
            || front.job_ids.is_empty()
            || front.stakes_questions.is_empty()
            || front
                .stakes_questions
                .iter()
                .any(|question| question.trim().is_empty())
            || !front_ids.insert(front.id.clone())
        {
            return Err(format!("invalid seed front {}", front.id));
        }
        let Some(portent_clock) = content
            .clocks
            .iter()
            .find(|clock| clock.id == front.portent_clock_id)
        else {
            return Err(format!(
                "front {} references missing portent clock {}",
                front.id, front.portent_clock_id
            ));
        };
        if portent_clock.kind != "danger" || clock_zone(portent_clock) != ZONE_FRONTIER {
            return Err(format!(
                "front {} must use a frontier danger portent clock",
                front.id
            ));
        }
        for location_id in &front.location_ids {
            if !location_ids.contains(location_id) {
                return Err(format!(
                    "front {} references missing location {}",
                    front.id, location_id
                ));
            }
            let Some(sheet) = content
                .room_sheets
                .iter()
                .find(|sheet| sheet.location_id == *location_id)
            else {
                return Err(format!(
                    "front {} location {} has no room sheet",
                    front.id, location_id
                ));
            };
            if room_sheet_zone(sheet) != ZONE_FRONTIER {
                return Err(format!(
                    "front {} location {} is not frontier",
                    front.id, location_id
                ));
            }
        }
        for participant_id in &front.participant_ids {
            if !actor_ids.contains(participant_id) {
                return Err(format!(
                    "front {} references missing participant {}",
                    front.id, participant_id
                ));
            }
        }
        for job_id in &front.job_ids {
            if !job_ids.contains(job_id) {
                return Err(format!(
                    "front {} references missing job {}",
                    front.id, job_id
                ));
            }
        }
    }
    for clock in &content.clocks {
        for effect in &clock.on_fill {
            validate_seed_effect_descriptor(
                &format!("clock {} on_fill", clock.id),
                effect,
                &actor_ids,
                &item_ids,
                &location_ids,
                &clock_ids,
                &job_ids,
            )?;
        }
    }

    let mut card_subjects = BTreeSet::new();
    let mut card_ids = BTreeSet::new();
    for card in &content.cards {
        if card.subject_kind.trim().is_empty()
            || card.subject_id == 0
            || card.card_id.trim().is_empty()
            || card.display_name.trim().is_empty()
            || card.role.trim().is_empty()
            || card.rarity.trim().is_empty()
            || card.title.trim().is_empty()
            || card.blurb.trim().is_empty()
            || card.aspect.trim().is_empty()
            || card.source.trim().is_empty()
            || card.asset_status.trim().is_empty()
            || !card_subjects.insert((card.subject_kind.clone(), card.subject_id))
            || !card_ids.insert(card.card_id.clone())
        {
            return Err(format!(
                "invalid or duplicate seed card {} for {}:{}",
                card.card_id, card.subject_kind, card.subject_id
            ));
        }
        let subject_exists = match card.subject_kind.as_str() {
            "actor" => actor_ids.contains(&card.subject_id),
            "item" => item_ids.contains(&card.subject_id),
            "location" => location_ids.contains(&card.subject_id),
            other => return Err(format!("invalid seed card subject kind {other}")),
        };
        if !subject_exists {
            return Err(format!(
                "seed card {} references missing {} {}",
                card.card_id, card.subject_kind, card.subject_id
            ));
        }
        if let Some(art) = card.art.as_ref() {
            if art.label.trim().is_empty()
                || art.role.trim().is_empty()
                || art.aspect.trim().is_empty()
                || art.bg.trim().is_empty()
                || art.ink.trim().is_empty()
                || art.accent.trim().is_empty()
                || art.glyph.trim().is_empty()
            {
                return Err(format!(
                    "seed card {} has incomplete art spec",
                    card.card_id
                ));
            }
        }
    }

    for card in &content.cards {
        let Some(external_card_id) = card.external_card_id.as_deref() else {
            continue;
        };
        let Some(external_card) = content
            .external_cards
            .iter()
            .find(|external| external.card_id == external_card_id)
        else {
            return Err(format!(
                "seed card {} references missing external card {}",
                card.card_id, external_card_id
            ));
        };
        if external_card.pack_id != card.pack_id {
            return Err(format!(
                "seed card {} may not bind external card owned by {}",
                card.card_id, external_card.pack_id
            ));
        }
    }
    let mut card_binding_ids = BTreeSet::new();
    let mut bound_seed_cards = BTreeSet::new();
    let mut bound_external_cards = BTreeSet::new();
    for binding in &content.card_bindings {
        let Some(seed_card) = content.cards.iter().find(|card| {
            card.card_id == binding.seed_card_id
                && card.subject_kind == binding.subject_kind
                && card.subject_id == binding.subject_id
        }) else {
            return Err(format!(
                "card binding {} does not resolve seed card {}",
                binding.id, binding.seed_card_id
            ));
        };
        let subject_pack_id = match binding.subject_kind.as_str() {
            "actor" => content
                .actors
                .iter()
                .find(|actor| actor.id == binding.subject_id)
                .map(|actor| actor.pack_id.as_str()),
            "item" => content
                .items
                .iter()
                .find(|item| item.id == binding.subject_id)
                .map(|item| item.pack_id.as_str()),
            "location" => content
                .locations
                .iter()
                .find(|location| location.id == binding.subject_id)
                .map(|location| location.pack_id.as_str()),
            _ => None,
        };
        let expected_ref = subject_pack_id.map(|pack_id| {
            format!(
                "pack://{pack_id}/{}/{}",
                binding.subject_kind, binding.subject_id
            )
        });
        let external_card = content
            .external_cards
            .iter()
            .find(|external| external.card_id == binding.external_card_id);
        if binding.id.trim().is_empty()
            || binding.pack_id.trim().is_empty()
            || expected_ref.as_deref() != Some(binding.entity_ref.as_str())
            || external_card.map(|card| card.pack_id.as_str()) != Some(binding.pack_id.as_str())
            || !card_binding_ids.insert(binding.id.as_str())
        {
            return Err(format!("invalid card binding {}", binding.id));
        }
        if !bound_seed_cards.insert(seed_card.card_id.as_str()) {
            return Err(format!(
                "seed card {} has more than one external binding",
                seed_card.card_id
            ));
        }
        if !bound_external_cards.insert(binding.external_card_id.as_str()) {
            return Err(format!(
                "external card {} binds more than one world entity",
                binding.external_card_id
            ));
        }
    }

    let mut access_gate_locations = BTreeSet::new();
    for gate in &content.access_gates {
        if !location_ids.contains(&gate.location_id)
            || gate.required_grant_id.trim().is_empty()
            || !entitlement_grant_ids.contains(gate.required_grant_id.as_str())
            || gate.reason.trim().is_empty()
            || !access_gate_locations.insert(gate.location_id)
        {
            return Err(format!(
                "invalid or duplicate access gate for location {}",
                gate.location_id
            ));
        }
        let grant = content
            .manifest
            .packs
            .iter()
            .filter_map(|pack| pack.entitlements.as_ref())
            .flat_map(|entitlements| entitlements.grants.iter())
            .find(|grant| grant.id == gate.required_grant_id);
        let Some(required_card_id) = gate.required_card_id.as_deref().or_else(|| {
            grant
                .and_then(|grant| grant.match_rule.as_ref())
                .and_then(|rule| rule.asset_id.as_deref())
        }) else {
            continue;
        };
        let Some(card) = content.cards.iter().find(|card| {
            card.card_id == required_card_id
                || card.external_card_id.as_deref() == Some(required_card_id)
        }) else {
            return Err(format!(
                "access gate for location {} references missing card {}",
                gate.location_id, required_card_id
            ));
        };
        if card.subject_kind != "location" || card.subject_id != gate.location_id {
            return Err(format!(
                "access gate for location {} references non-matching card {}",
                gate.location_id, required_card_id
            ));
        }
    }
    if let Some(entry_location_id) = content
        .manifest
        .entry_location
        .rsplit('/')
        .next()
        .and_then(|value| value.parse::<u64>().ok())
    {
        let entry_gate = content
            .access_gates
            .iter()
            .find(|gate| gate.location_id == entry_location_id);
        match (entry_gate, content.manifest.entry_grant_id.as_deref()) {
            (Some(gate), Some(entry_grant_id)) if gate.required_grant_id == entry_grant_id => {}
            (Some(gate), _) => {
                return Err(format!(
                    "gated entry location {} requires entry grant {}",
                    entry_location_id, gate.required_grant_id
                ));
            }
            (None, Some(entry_grant_id)) => {
                return Err(format!(
                    "public entry location {} declares unexpected entry grant {}",
                    entry_location_id, entry_grant_id
                ));
            }
            (None, None) => {}
        }
    }

    for hook in &content.lifecycle_hooks {
        validate_seed_lifecycle_hook(
            hook,
            &actor_ids,
            &item_ids,
            &location_ids,
            &clock_ids,
            &job_ids,
        )?;
    }

    let mut all_item_ids = item_ids.clone();
    let mut recipe_ids = BTreeSet::new();
    for recipe in &content.recipes {
        if recipe.id == 0
            || !recipe_ids.insert(recipe.id)
            || recipe.key.trim().is_empty()
            || recipe.name.trim().is_empty()
            || recipe.description.trim().is_empty()
            || recipe.input_item_ids.len() != 2
            || recipe.input_item_ids[0] == recipe.input_item_ids[1]
            || recipe
                .input_item_ids
                .iter()
                .any(|item_id| !item_ids.contains(item_id))
            || recipe.balance.kind.trim().is_empty()
            || recipe.balance.reason.trim().is_empty()
        {
            return Err(format!("invalid seed recipe {}", recipe.id));
        }
        if !matches!(
            recipe.balance.kind.as_str(),
            "location" | "avatar" | "resident" | "covenant" | "evolution"
        ) {
            return Err(format!(
                "recipe {} has invalid balance kind {}",
                recipe.id, recipe.balance.kind
            ));
        }
        let Some(balance_target_kind) = placement_target_kind_from_str(&recipe.balance.target_kind)
        else {
            return Err(format!(
                "recipe {} has invalid balance target kind {}",
                recipe.id, recipe.balance.target_kind
            ));
        };
        match balance_target_kind {
            CW_PLACEMENT_ACTOR_HAND => {
                if !actor_ids.contains(&recipe.balance.target_id) {
                    return Err(format!(
                        "recipe {} balance references missing actor {}",
                        recipe.id, recipe.balance.target_id
                    ));
                }
            }
            CW_PLACEMENT_LOCATION_FLOOR => {
                if !location_ids.contains(&recipe.balance.target_id) {
                    return Err(format!(
                        "recipe {} balance references missing location {}",
                        recipe.id, recipe.balance.target_id
                    ));
                }
            }
            _ => {}
        }
        if let Some(output) = recipe.output.as_ref() {
            let Some(output_target_kind) = placement_target_kind_from_str(&output.target_kind)
            else {
                return Err(format!(
                    "recipe {} output has invalid target kind {}",
                    recipe.id, output.target_kind
                ));
            };
            if output.item_id == 0
                || item_ids.contains(&output.item_id)
                || !all_item_ids.insert(output.item_id)
                || output.name.trim().is_empty()
                || output.description.trim().is_empty()
                || seed_item_kind_from_str(&output.kind).is_none()
                || output.charges == 0
            {
                return Err(format!("recipe {} has invalid output item", recipe.id));
            }
            match output_target_kind {
                CW_PLACEMENT_ACTOR_HAND => {
                    if !actor_ids.contains(&output.target_id) {
                        return Err(format!(
                            "recipe {} output references missing actor {}",
                            recipe.id, output.target_id
                        ));
                    }
                }
                CW_PLACEMENT_LOCATION_FLOOR => {
                    if !location_ids.contains(&output.target_id) {
                        return Err(format!(
                            "recipe {} output references missing location {}",
                            recipe.id, output.target_id
                        ));
                    }
                }
                _ => {}
            }
            if output.target_kind != recipe.balance.target_kind
                || output.target_id != recipe.balance.target_id
            {
                return Err(format!(
                    "recipe {} output slot must match its balance declaration",
                    recipe.id
                ));
            }
        }
    }

    let mut tracked_actors = BTreeSet::new();
    for track in &content.evolution_tracks {
        if !actor_ids.contains(&track.actor_id) || !tracked_actors.insert(track.actor_id) {
            return Err(format!(
                "invalid or duplicate evolution track actor {}",
                track.actor_id
            ));
        }
        if track.requirements.is_empty() || track.requirements.len() > CW_MAX_EVOLUTION_REQUIREMENTS
        {
            return Err(format!(
                "evolution track for actor {} has invalid requirement count",
                track.actor_id
            ));
        }
        let mut track_item_ids = BTreeSet::new();
        for requirement in &track.requirements {
            if !track_item_ids.insert(requirement.item_id)
                || !all_item_ids.contains(&requirement.item_id)
            {
                return Err(format!(
                    "evolution track for actor {} references missing item {}",
                    track.actor_id, requirement.item_id
                ));
            }
            let Some(target_kind) = placement_target_kind_from_str(&requirement.target_kind) else {
                return Err(format!(
                    "evolution track for actor {} has invalid target kind {}",
                    track.actor_id, requirement.target_kind
                ));
            };
            match target_kind {
                CW_PLACEMENT_ACTOR_HAND => {
                    if !actor_ids.contains(&requirement.target_id) {
                        return Err(format!(
                            "evolution track for actor {} references missing actor target {}",
                            track.actor_id, requirement.target_id
                        ));
                    }
                }
                CW_PLACEMENT_LOCATION_FLOOR => {
                    if !location_ids.contains(&requirement.target_id) {
                        return Err(format!(
                            "evolution track for actor {} references missing location target {}",
                            track.actor_id, requirement.target_id
                        ));
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn validate_seed_stats(actor_id: u64, stats: &SeedStatBlockContent) -> Result<(), String> {
    let ability_scores = [
        stats.strength,
        stats.dexterity,
        stats.constitution,
        stats.intelligence,
        stats.wisdom,
        stats.charisma,
    ];
    if ability_scores.iter().any(|score| !(1..=30).contains(score))
        || stats.hp_base <= 0
        || stats.level == 0
    {
        return Err(format!("seed actor {actor_id} has invalid stats"));
    }
    Ok(())
}

fn validate_seed_lifecycle_hook(
    hook: &SeedLifecycleHookContent,
    actor_ids: &BTreeSet<u64>,
    item_ids: &BTreeSet<u64>,
    location_ids: &BTreeSet<u64>,
    clock_ids: &BTreeSet<String>,
    job_ids: &BTreeSet<String>,
) -> Result<(), String> {
    if !matches!(
        hook.hook.as_str(),
        "on_enter" | "on_listen" | "on_use" | "on_give" | "on_clock_fill"
    ) {
        return Err(format!("invalid lifecycle hook {}", hook.hook));
    }
    if hook.effects.is_empty() {
        return Err(format!("lifecycle hook {} has no effects", hook.hook));
    }
    match hook.target_kind.as_str() {
        "room" => {
            let target_id = hook
                .target_id
                .parse::<u64>()
                .map_err(|_| format!("hook {} has invalid room target", hook.hook))?;
            if !location_ids.contains(&target_id) {
                return Err(format!(
                    "hook {} references missing room {target_id}",
                    hook.hook
                ));
            }
        }
        "actor" => {
            let target_id = hook
                .target_id
                .parse::<u64>()
                .map_err(|_| format!("hook {} has invalid actor target", hook.hook))?;
            if !actor_ids.contains(&target_id) {
                return Err(format!(
                    "hook {} references missing actor {target_id}",
                    hook.hook
                ));
            }
        }
        "item" => {
            let target_id = hook
                .target_id
                .parse::<u64>()
                .map_err(|_| format!("hook {} has invalid item target", hook.hook))?;
            if !item_ids.contains(&target_id) {
                return Err(format!(
                    "hook {} references missing item {target_id}",
                    hook.hook
                ));
            }
        }
        "clock" => {
            if !clock_ids.contains(&hook.target_id) {
                return Err(format!(
                    "hook {} references missing clock {}",
                    hook.hook, hook.target_id
                ));
            }
        }
        other => return Err(format!("invalid lifecycle target kind {other}")),
    }
    if !matches!(
        hook.claim_scope.as_str(),
        "" | "event_once" | "actor_target_once" | "world_target_once"
    ) {
        return Err(format!(
            "hook {} has invalid claim scope {}",
            hook.hook, hook.claim_scope
        ));
    }
    for effect in &hook.effects {
        validate_seed_effect_descriptor(
            &format!("hook {}", hook.hook),
            effect,
            actor_ids,
            item_ids,
            location_ids,
            clock_ids,
            job_ids,
        )?;
    }
    Ok(())
}

fn validate_seed_effect_descriptor(
    label: &str,
    effect: &EffectDescriptor,
    actor_ids: &BTreeSet<u64>,
    _item_ids: &BTreeSet<u64>,
    location_ids: &BTreeSet<u64>,
    clock_ids: &BTreeSet<String>,
    job_ids: &BTreeSet<String>,
) -> Result<(), String> {
    if effect_descriptor_reason(effect)
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        return Err(format!("{label} has an effect without a reason"));
    }
    match effect {
        EffectDescriptor::AdvanceClock {
            clock_id, amount, ..
        } => {
            if !clock_ids.contains(clock_id) || *amount == 0 {
                return Err(format!("{label} has invalid clock effect {clock_id}"));
            }
        }
        EffectDescriptor::SetTag {
            tag_id,
            scope,
            scope_id,
            label: tag_label,
            kind,
            ..
        } => {
            if tag_id.trim().is_empty()
                || tag_label.trim().is_empty()
                || !tag_scope_is_allowed(scope)
                || !tag_kind_is_allowed(kind)
            {
                return Err(format!("{label} has invalid tag effect"));
            }
            if scope == "actor" && !actor_ids.contains(scope_id) {
                return Err(format!("{label} tag references missing actor {scope_id}"));
            }
            if scope == "room" && !location_ids.contains(scope_id) {
                return Err(format!("{label} tag references missing room {scope_id}"));
            }
        }
        EffectDescriptor::ClearTag { tag_id, .. } => {
            if tag_id.trim().is_empty() {
                return Err(format!("{label} has empty clear tag effect"));
            }
        }
        EffectDescriptor::SetJobStatus { job_id, status, .. } => {
            if !job_ids.contains(job_id) || normalize_job_status(status).is_none() {
                return Err(format!("{label} has invalid job status effect {job_id}"));
            }
        }
    }
    Ok(())
}
