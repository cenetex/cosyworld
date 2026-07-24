use super::*;

pub(super) const SETTLEMENT_BUILDING_SCHEMA_VERSION: u8 = 1;
const BUILDING_CATALOG_EXTENSION: &str = "x-cosyworld-building-archetypes";
const MAX_BUILDINGS_PER_LOCATION: usize = 2;
const MAX_FOLLOW_UP_JOBS_PER_BUILDING: usize = 2;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub(super) struct BuildingClockTemplate {
    pub(super) segments: u8,
    pub(super) strategies: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub(super) struct BuildingArchetypeDefinition {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) classification: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) natural_resource: Option<String>,
    pub(super) capabilities: Vec<String>,
    #[serde(default)]
    pub(super) upgrade_capabilities: Vec<String>,
    #[serde(default)]
    pub(super) quest_templates: Vec<String>,
    #[serde(default)]
    pub(super) recipe_tags: Vec<String>,
    #[serde(default)]
    pub(super) allowed_location_ids: Vec<u64>,
    #[serde(default)]
    pub(super) environment_tags: Vec<String>,
    #[serde(default)]
    pub(super) required_capabilities: Vec<String>,
    #[serde(default = "default_access_policy")]
    pub(super) access_policy: String,
    #[serde(default)]
    pub(super) covenant_required: bool,
    #[serde(default = "default_cache_policy")]
    pub(super) cache_policy: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) loot_table_id: Option<String>,
}

fn default_access_policy() -> String {
    "public".to_string()
}

fn default_cache_policy() -> String {
    "none".to_string()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub(super) struct BuildingArchetypeCatalog {
    pub(super) schema_version: u8,
    pub(super) footprint_class: String,
    pub(super) construction: BuildingClockTemplate,
    pub(super) upgrade: BuildingClockTemplate,
    pub(super) archetypes: Vec<BuildingArchetypeDefinition>,
}

#[derive(Clone, Debug)]
struct MountedBuildingArchetype {
    pack_id: String,
    pack_version: String,
    footprint_class: String,
    construction: BuildingClockTemplate,
    upgrade: BuildingClockTemplate,
    archetype: BuildingArchetypeDefinition,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum SettlementBuildingStatus {
    #[default]
    Constructing,
    Completed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct BuildingPublicCacheState {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) policy: String,
    #[serde(default)]
    pub(super) item_ids: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct BuildingFootprintClaimState {
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) slot_index: u8,
    pub(super) slot_class: String,
    pub(super) building_id: String,
    pub(super) governance_decision_id: String,
    pub(super) claimed_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct SettlementBuildingState {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) slot_index: u8,
    pub(super) slot_class: String,
    pub(super) archetype_id: String,
    pub(super) name: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) governance_decision_id: String,
    pub(super) selected_event_seq: u64,
    pub(super) construction_clock_id: String,
    pub(super) construction_job_id: String,
    pub(super) status: SettlementBuildingStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) completed_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) declared_capabilities: Vec<String>,
    #[serde(default)]
    pub(super) installed_capabilities: Vec<String>,
    #[serde(default)]
    pub(super) quest_templates: Vec<String>,
    #[serde(default)]
    pub(super) recipe_tags: Vec<String>,
    #[serde(default = "default_access_policy")]
    pub(super) access_policy: String,
    #[serde(default)]
    pub(super) covenant_required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) loot_table_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) public_cache: Option<BuildingPublicCacheState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) upgrade_clock_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) upgrade_job_id: Option<String>,
    #[serde(default)]
    pub(super) upgrade_level: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) upgraded_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) follow_up_job_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct BuildingPublicCacheView {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) policy: String,
    pub(super) item_ids: Vec<u64>,
    pub(super) item_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct SettlementBuildingView {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) slot_index: u8,
    pub(super) slot_class: String,
    pub(super) archetype_id: String,
    pub(super) name: String,
    pub(super) status: SettlementBuildingStatus,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) governance_decision_id: String,
    pub(super) selected_event_seq: u64,
    pub(super) completed_event_seq: Option<u64>,
    pub(super) construction_clock_id: String,
    pub(super) construction_job_id: String,
    pub(super) construction_filled: u8,
    pub(super) construction_segments: u8,
    pub(super) declared_capabilities: Vec<String>,
    pub(super) installed_capabilities: Vec<String>,
    pub(super) quest_templates: Vec<String>,
    pub(super) recipe_tags: Vec<String>,
    pub(super) access_policy: String,
    pub(super) covenant_required: bool,
    pub(super) loot_table_id: Option<String>,
    pub(super) public_cache: Option<BuildingPublicCacheView>,
    pub(super) upgrade_clock_id: Option<String>,
    pub(super) upgrade_job_id: Option<String>,
    pub(super) upgrade_level: u8,
    pub(super) follow_up_job_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct BuildingSlotView {
    pub(super) location_id: u64,
    pub(super) slot_class: String,
    pub(super) capacity: u8,
    pub(super) claimed: u8,
    pub(super) available: u8,
    pub(super) claim_ids: Vec<String>,
    pub(super) civic_clock_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum BuildingReconcileMode {
    Silent,
    EmitEvents,
}

fn natural_resource_kind(value: &str) -> Option<NaturalResourceKind> {
    match value {
        "fish_rich_water" => Some(NaturalResourceKind::FishRichWater),
        "ore_seam" => Some(NaturalResourceKind::OreSeam),
        "clay_bank" => Some(NaturalResourceKind::ClayBank),
        "ancient_woodland" => Some(NaturalResourceKind::AncientWoodland),
        "fast_river" => Some(NaturalResourceKind::FastRiver),
        "reliable_upland_wind" => Some(NaturalResourceKind::ReliableUplandWind),
        "hot_spring" => Some(NaturalResourceKind::HotSpring),
        "rich_soil" => Some(NaturalResourceKind::RichSoil),
        "rare_herb_habitat" => Some(NaturalResourceKind::RareHerbHabitat),
        "old_ruins" => Some(NaturalResourceKind::OldRuins),
        _ => None,
    }
}

fn allowed_building_capability(value: &str) -> bool {
    matches!(
        value,
        "sanctuary"
            | "rest"
            | "hosting"
            | "bonds"
            | "resident_arrivals"
            | "route_support"
            | "delivery_needs"
            | "traveler_arrivals"
            | "transformation_recipes"
            | "repair_jobs"
            | "production_quests"
            | "public_cache"
            | "fishing"
            | "preservation"
            | "boating"
            | "mining"
            | "prospecting"
            | "pottery"
            | "carpentry"
            | "herbalism"
            | "water_power"
            | "wind_power"
            | "signals"
            | "bathing"
            | "healing"
            | "cultivation"
            | "medicine"
            | "lore_investigation"
            | "knowledge_traces"
            | "museum_exhibits"
            | "expeditions"
            | "stewardship"
            | "additional_major_slot"
    )
}

fn allowed_environment_tag(value: &str) -> bool {
    matches!(
        value,
        "riverbank"
            | "woodland"
            | "upland"
            | "mountain"
            | "wetland"
            | "coast"
            | "ruins"
            | "flowing_river"
            | "spring"
            | "geothermal"
    )
}

fn environment_matches_tag(environment: &EnvironmentProfile, tag: &str) -> bool {
    match tag {
        "riverbank" => environment
            .landforms
            .contains(&EnvironmentLandform::Riverbank),
        "woodland" => environment
            .landforms
            .contains(&EnvironmentLandform::Woodland),
        "upland" => environment.landforms.contains(&EnvironmentLandform::Upland),
        "mountain" => environment
            .landforms
            .contains(&EnvironmentLandform::Mountain),
        "wetland" => environment
            .landforms
            .contains(&EnvironmentLandform::Wetland),
        "coast" => environment.landforms.contains(&EnvironmentLandform::Coast),
        "ruins" => environment.landforms.contains(&EnvironmentLandform::Ruins),
        "flowing_river" => environment
            .hydrology
            .contains(&EnvironmentHydrology::FlowingRiver),
        "spring" => environment
            .hydrology
            .contains(&EnvironmentHydrology::Spring),
        "geothermal" => environment
            .anomalies
            .contains(&EnvironmentAnomaly::Geothermal),
        _ => false,
    }
}

fn valid_building_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && value.len() <= 48
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn parse_building_catalog(
    pack: &SeedWorldpackPack,
) -> Result<Option<BuildingArchetypeCatalog>, String> {
    let Some(value) = pack.extensions.get(BUILDING_CATALOG_EXTENSION).cloned() else {
        return Ok(None);
    };
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("pack {} building archetypes: {error}", pack.id))
}

pub(super) fn validate_seed_building_archetypes(content: &SeedContent) -> Result<(), String> {
    let mut archetype_ids = BTreeSet::new();
    let mut covered_specials = BTreeSet::new();
    let mut catalog_count = 0usize;
    for pack in &content.manifest.packs {
        let Some(catalog) = parse_building_catalog(pack)? else {
            continue;
        };
        catalog_count += 1;
        if catalog.schema_version != SETTLEMENT_BUILDING_SCHEMA_VERSION
            || catalog.footprint_class != "major"
            || !(2..=12).contains(&catalog.construction.segments)
            || !(2..=12).contains(&catalog.upgrade.segments)
            || !catalog
                .construction
                .strategies
                .iter()
                .any(|kind| kind == "work")
            || !catalog.upgrade.strategies.iter().any(|kind| kind == "work")
        {
            return Err(format!("pack {} has an invalid building catalog", pack.id));
        }
        for strategy in catalog
            .construction
            .strategies
            .iter()
            .chain(catalog.upgrade.strategies.iter())
        {
            if !matches!(strategy.as_str(), "work" | "help" | "prepare") {
                return Err(format!(
                    "pack {} building catalog uses unsupported strategy {strategy}",
                    pack.id
                ));
            }
        }
        for archetype in &catalog.archetypes {
            if !valid_building_id(&archetype.id)
                || archetype.name.trim().is_empty()
                || archetype.description.trim().is_empty()
                || archetype.capabilities.is_empty()
                || !archetype_ids.insert(archetype.id.clone())
            {
                return Err(format!(
                    "pack {} has invalid or duplicate building {}",
                    pack.id, archetype.id
                ));
            }
            if archetype
                .capabilities
                .iter()
                .chain(archetype.upgrade_capabilities.iter())
                .chain(archetype.required_capabilities.iter())
                .any(|capability| !allowed_building_capability(capability))
            {
                return Err(format!(
                    "building {} uses an unknown capability",
                    archetype.id
                ));
            }
            if archetype
                .environment_tags
                .iter()
                .any(|tag| !allowed_environment_tag(tag))
                || archetype.access_policy != "public" && archetype.access_policy != "covenant"
                || archetype
                    .allowed_location_ids
                    .iter()
                    .any(|location_id| *location_id == 0)
                || archetype
                    .allowed_location_ids
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len()
                    != archetype.allowed_location_ids.len()
            {
                return Err(format!(
                    "building {} has invalid location or access predicates",
                    archetype.id
                ));
            }
            match archetype.classification.as_str() {
                "universal" if archetype.natural_resource.is_none() => {}
                "special" => {
                    let resource = archetype
                        .natural_resource
                        .as_deref()
                        .and_then(natural_resource_kind)
                        .ok_or_else(|| {
                            format!(
                                "building {} has an invalid natural prerequisite",
                                archetype.id
                            )
                        })?;
                    if !approved_buildings(resource)
                        .iter()
                        .any(|building| building.key() == archetype.id)
                    {
                        return Err(format!(
                            "building {} is not approved for {}",
                            archetype.id,
                            resource.label()
                        ));
                    }
                    covered_specials.insert(archetype.id.clone());
                }
                _ => {
                    return Err(format!(
                        "building {} has an invalid classification",
                        archetype.id
                    ))
                }
            }
            if archetype.cache_policy != "none"
                && (archetype.cache_policy != "public_empty_until_reward"
                    || !archetype
                        .capabilities
                        .iter()
                        .any(|capability| capability == "public_cache"))
            {
                return Err(format!(
                    "building {} has an invalid cache policy",
                    archetype.id
                ));
            }
            if archetype
                .quest_templates
                .iter()
                .any(|template| template.starts_with("production."))
                && archetype
                    .loot_table_id
                    .as_deref()
                    .is_none_or(|loot_table_id| loot_table_id.trim().is_empty())
            {
                return Err(format!(
                    "building {} production quest needs a loot table reference",
                    archetype.id
                ));
            }
        }
    }
    if catalog_count == 0 {
        return Ok(());
    }
    for required in ["dwelling", "waystation", "workshop"] {
        if !archetype_ids.contains(required) {
            return Err(format!("building catalog is missing universal {required}"));
        }
    }
    for resource in [
        NaturalResourceKind::FishRichWater,
        NaturalResourceKind::OreSeam,
        NaturalResourceKind::ClayBank,
        NaturalResourceKind::AncientWoodland,
        NaturalResourceKind::FastRiver,
        NaturalResourceKind::ReliableUplandWind,
        NaturalResourceKind::HotSpring,
        NaturalResourceKind::RichSoil,
        NaturalResourceKind::RareHerbHabitat,
        NaturalResourceKind::OldRuins,
    ] {
        for building in approved_buildings(resource) {
            if !covered_specials.contains(building.key()) {
                return Err(format!(
                    "building catalog is missing {} for {}",
                    building.key(),
                    resource.label()
                ));
            }
        }
    }
    Ok(())
}

fn mounted_building_archetypes() -> Vec<MountedBuildingArchetype> {
    let mut mounted = Vec::new();
    for pack in &active_content().manifest.packs {
        let Ok(Some(catalog)) = parse_building_catalog(pack) else {
            continue;
        };
        for archetype in catalog.archetypes {
            mounted.push(MountedBuildingArchetype {
                pack_id: pack.id.clone(),
                pack_version: pack.version.clone(),
                footprint_class: catalog.footprint_class.clone(),
                construction: catalog.construction.clone(),
                upgrade: catalog.upgrade.clone(),
                archetype,
            });
        }
    }
    mounted.sort_by(|left, right| left.archetype.id.cmp(&right.archetype.id));
    mounted
}

fn mounted_building_archetype(archetype_id: &str) -> Option<MountedBuildingArchetype> {
    mounted_building_archetypes()
        .into_iter()
        .find(|mounted| mounted.archetype.id == archetype_id)
}

pub(super) fn settlement_building_id(
    location_id: u64,
    slot_index: u8,
    archetype_id: &str,
) -> String {
    format!("settlement-building:{location_id}:major:{slot_index}:{archetype_id}")
}

fn building_claim_id(location_id: u64, slot_index: u8) -> String {
    format!("settlement-building:{location_id}:major:{slot_index}:claim")
}

fn building_construction_clock_id(building_id: &str) -> String {
    format!("{building_id}:construction")
}

fn building_construction_job_id(building_id: &str) -> String {
    format!("{building_id}:construction-job")
}

fn building_upgrade_clock_id(building_id: &str) -> String {
    format!("{building_id}:upgrade")
}

fn building_upgrade_job_id(building_id: &str) -> String {
    format!("{building_id}:upgrade-job")
}

pub(super) fn settlement_civic_clock_id(location_id: u64) -> String {
    format!("settlement-building:{location_id}:civic:second-major-slot")
}

fn settlement_civic_job_id(location_id: u64) -> String {
    format!("settlement-building:{location_id}:civic:second-major-slot-job")
}

fn follow_up_clock_id(building_id: &str, template_id: &str) -> String {
    format!("{building_id}:follow-up:{}", template_id.replace('.', "-"))
}

fn follow_up_job_id(building_id: &str, template_id: &str) -> String {
    format!("{}:job", follow_up_clock_id(building_id, template_id))
}

fn governance_slot_index(decision: &GovernanceDecisionState) -> Option<u8> {
    if decision.subject_kind != "founding_building"
        && decision.subject_kind != "settlement_building"
    {
        return None;
    }
    if decision.id.ends_with(":founding-building") {
        return Some(1);
    }
    decision
        .id
        .rsplit_once("-slot-")
        .and_then(|(_, slot)| slot.parse::<u8>().ok())
        .filter(|slot| (1..=MAX_BUILDINGS_PER_LOCATION as u8).contains(slot))
}

fn building_clock(
    id: String,
    location_id: u64,
    zone: &str,
    label: String,
    segments: u8,
    question: String,
    outcome: String,
    rhythm: &str,
    priority: i16,
) -> ClockState {
    ClockState {
        id,
        scope: "room".to_string(),
        scope_id: location_id,
        kind: "progress".to_string(),
        zone: zone.to_string(),
        label,
        segments,
        filled: 0,
        visible_to_players: true,
        status: "active".to_string(),
        presentation: ClockPresentation {
            version: CLOCK_PRESENTATION_SCHEMA_VERSION,
            question: question.clone(),
            rhythm: rhythm.to_string(),
            attention: "local".to_string(),
            priority,
            situation: question.trim_end_matches('?').to_string(),
            stakes: "Only committed contributions change the shared place.".to_string(),
            outcome: outcome.clone(),
            completion_memory: outcome,
        },
        on_fill: Vec::new(),
        recent_contributions: Vec::new(),
        completion: None,
        created_event_seq: None,
        updated_event_seq: None,
    }
}

fn building_strategy(
    id: String,
    action_kind: &str,
    clock_id: &str,
    location_id: u64,
    pack_id: &str,
    pack_version: &str,
    strategy_label: String,
) -> Option<JobContributionStrategy> {
    let binding = resolved_action_binding(action_kind)?;
    let target = if action_kind == "help" {
        ContributionTargetDescriptor {
            kind: "actor".to_string(),
            id: None,
            predicate: Some("co_present_avatar".to_string()),
            label: "a nearby avatar".to_string(),
        }
    } else {
        ContributionTargetDescriptor {
            kind: "room".to_string(),
            id: Some(location_id.to_string()),
            predicate: None,
            label: "the shared building".to_string(),
        }
    };
    Some(JobContributionStrategy {
        version: JOB_CONTRIBUTION_SCHEMA_VERSION,
        id,
        action_kind: action_kind.to_string(),
        rules_action: binding.rules_action,
        operation: binding.operation,
        target,
        requirements: vec![ContributionRequirement::AtLocation { location_id }],
        resolution: ContributionResolutionPolicy::Certain,
        clock_id: clock_id.to_string(),
        baseline_progress: 1,
        success_progress: 0,
        prepared_bonus_progress: 0,
        on_success: Vec::new(),
        on_failure: Vec::new(),
        claim_policy: ContributionClaimPolicy::Repeatable,
        strategy_label,
        narration_key: format!("settlement_building.{action_kind}"),
        rules_profile: active_content().manifest.rules_profile.clone(),
        rules_pack_id: binding.pack_id,
        rules_pack_version: binding.pack_version,
        pack_id: pack_id.to_string(),
        pack_version: pack_version.to_string(),
    })
}

fn building_strategies(
    prefix: &str,
    kinds: &[String],
    clock_id: &str,
    location_id: u64,
    pack_id: &str,
    pack_version: &str,
    name: &str,
) -> Vec<JobContributionStrategy> {
    kinds
        .iter()
        .filter_map(|kind| {
            building_strategy(
                format!("{prefix}:{kind}"),
                kind,
                clock_id,
                location_id,
                pack_id,
                pack_version,
                match kind.as_str() {
                    "help" => format!("Help another avatar with {name}"),
                    "prepare" => format!("Prepare the ground for {name}"),
                    _ => format!("Work on {name}"),
                },
            )
        })
        .collect()
}

impl RuntimeWorld {
    fn building_archetype_is_legal(
        &self,
        location_id: u64,
        mounted: &MountedBuildingArchetype,
    ) -> bool {
        let archetype = &mounted.archetype;
        if archetype.access_policy != "public"
            || archetype.covenant_required
            || !archetype.allowed_location_ids.is_empty()
                && !archetype.allowed_location_ids.contains(&location_id)
            || archetype
                .required_capabilities
                .iter()
                .any(|capability| !self.location_has_building_capability(location_id, capability))
        {
            return false;
        }
        if !archetype.environment_tags.is_empty()
            && self.natural_affordances.get(&location_id).map(|state| {
                archetype
                    .environment_tags
                    .iter()
                    .all(|tag| environment_matches_tag(&state.environment, tag))
            }) != Some(true)
        {
            return false;
        }
        if archetype.classification == "universal" {
            return archetype.natural_resource.is_none();
        }
        let Some(required) = archetype
            .natural_resource
            .as_deref()
            .and_then(natural_resource_kind)
        else {
            return false;
        };
        self.natural_affordances
            .get(&location_id)
            .and_then(|state| state.revealed_feature.as_ref())
            .is_some_and(|feature| feature.resource_kind == required)
    }

    pub(super) fn legal_settlement_building_archetype_ids(&self, location_id: u64) -> Vec<String> {
        let claimed = self
            .settlement_buildings
            .values()
            .filter(|building| building.location_id == location_id)
            .map(|building| building.archetype_id.as_str())
            .collect::<BTreeSet<_>>();
        mounted_building_archetypes()
            .into_iter()
            .filter(|mounted| self.building_archetype_is_legal(location_id, mounted))
            .filter(|mounted| !claimed.contains(mounted.archetype.id.as_str()))
            .map(|mounted| mounted.archetype.id)
            .take(8)
            .collect()
    }

    pub(super) fn location_has_building_capability(
        &self,
        location_id: u64,
        capability: &str,
    ) -> bool {
        self.settlement_buildings.values().any(|building| {
            building.location_id == location_id
                && building.status == SettlementBuildingStatus::Completed
                && building
                    .installed_capabilities
                    .iter()
                    .any(|installed| installed == capability)
        })
    }

    pub(super) fn location_building_recipe_tags(&self, location_id: u64) -> Vec<String> {
        let mut tags = self
            .settlement_buildings
            .values()
            .filter(|building| {
                building.location_id == location_id
                    && building.status == SettlementBuildingStatus::Completed
            })
            .flat_map(|building| building.recipe_tags.iter().cloned())
            .collect::<Vec<_>>();
        tags.sort();
        tags.dedup();
        tags
    }

    pub(super) fn settlement_building_slot_capacity(&self, location_id: u64) -> u8 {
        let has_settlement = self
            .generated_places
            .get(&location_id)
            .and_then(|place| place.building_proposal.as_ref())
            .is_some();
        if !has_settlement {
            return 0;
        }
        let civic_complete = self
            .clocks
            .get(&settlement_civic_clock_id(location_id))
            .is_some_and(|clock| clock.filled >= clock.segments);
        1 + u8::from(civic_complete)
    }

    pub(super) fn settlement_building_claim_count(&self, location_id: u64) -> u8 {
        self.building_footprint_claims
            .values()
            .filter(|claim| claim.location_id == location_id && claim.slot_class == "major")
            .count()
            .min(MAX_BUILDINGS_PER_LOCATION) as u8
    }

    pub(super) fn settlement_building_slot_view(&self, location_id: u64) -> BuildingSlotView {
        let capacity = self.settlement_building_slot_capacity(location_id);
        let mut claim_ids = self
            .building_footprint_claims
            .values()
            .filter(|claim| claim.location_id == location_id && claim.slot_class == "major")
            .map(|claim| claim.id.clone())
            .collect::<Vec<_>>();
        claim_ids.sort();
        let claimed = claim_ids.len().min(MAX_BUILDINGS_PER_LOCATION) as u8;
        BuildingSlotView {
            location_id,
            slot_class: "major".to_string(),
            capacity,
            claimed,
            available: capacity.saturating_sub(claimed),
            claim_ids,
            civic_clock_id: self
                .clocks
                .contains_key(&settlement_civic_clock_id(location_id))
                .then(|| settlement_civic_clock_id(location_id)),
        }
    }

    fn ensure_construction_projection(
        &mut self,
        building: &SettlementBuildingState,
        mounted: &MountedBuildingArchetype,
    ) {
        let zone = if self.location_is_frontier(building.location_id) {
            ZONE_FRONTIER
        } else {
            ZONE_SANCTUARY
        };
        self.clocks
            .entry(building.construction_clock_id.clone())
            .or_insert_with(|| {
                let mut clock = building_clock(
                    building.construction_clock_id.clone(),
                    building.location_id,
                    zone,
                    format!("Build {}", building.name),
                    mounted.construction.segments,
                    format!("Can everyone finish {} together?", building.name),
                    format!("{} stands as a shared world capability.", building.name),
                    "construction",
                    85,
                );
                clock.created_event_seq = Some(building.selected_event_seq);
                clock
            });
        let strategies = building_strategies(
            &building.construction_job_id,
            &mounted.construction.strategies,
            &building.construction_clock_id,
            building.location_id,
            &building.pack_id,
            &building.pack_version,
            &building.name,
        );
        self.jobs
            .entry(building.construction_job_id.clone())
            .or_insert_with(|| JobState {
                pack_id: building.pack_id.clone(),
                id: building.construction_job_id.clone(),
                premise: format!("Build {} together.", building.name),
                stakes:
                    "Selection claims the footprint, but only shared work completes the building."
                        .to_string(),
                location_ids: vec![building.location_id],
                participant_ids: Vec::new(),
                progress_clock_id: building.construction_clock_id.clone(),
                danger_clock_id: String::new(),
                status: if building.status == SettlementBuildingStatus::Completed {
                    "completed"
                } else {
                    "active"
                }
                .to_string(),
                reward: JobReward::Label(format!(
                    "{} installs only its declared capabilities.",
                    building.name
                )),
                consequence: "The claimed footprint remains under construction.".to_string(),
                memory_summary: format!("Many hands completed {}.", building.name),
                action_copy: JobActionCopy {
                    label: format!("Build {}", building.name),
                    summary: "Work, help, or prepare through the ordinary shared action surface."
                        .to_string(),
                },
                contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
                contribution_strategies: strategies,
                narrated_thresholds: vec![JobNarratedThreshold {
                    clock_id: building.construction_clock_id.clone(),
                    filled: mounted.construction.segments.saturating_sub(1).max(1),
                    narration_key: "building.nearly_complete".to_string(),
                    text: format!("{} needs one final committed contribution.", building.name),
                }],
                delivery: None,
            });
        if let Some(job) = self.jobs.get_mut(&building.construction_job_id) {
            job.status = if building.status == SettlementBuildingStatus::Completed {
                "completed"
            } else {
                "active"
            }
            .to_string();
        }
        if let Some(sheet) = self.room_sheets.get_mut(&building.location_id) {
            if !sheet.projects.contains(&building.construction_job_id) {
                sheet.projects.push(building.construction_job_id.clone());
                sheet.projects.sort();
                sheet.projects.dedup();
            }
        }
    }

    fn ensure_upgrade_projection(
        &mut self,
        building: &SettlementBuildingState,
        mounted: &MountedBuildingArchetype,
    ) {
        if mounted.archetype.upgrade_capabilities.is_empty() {
            return;
        }
        let clock_id = building
            .upgrade_clock_id
            .clone()
            .unwrap_or_else(|| building_upgrade_clock_id(&building.id));
        let job_id = building
            .upgrade_job_id
            .clone()
            .unwrap_or_else(|| building_upgrade_job_id(&building.id));
        let zone = if self.location_is_frontier(building.location_id) {
            ZONE_FRONTIER
        } else {
            ZONE_SANCTUARY
        };
        self.clocks.entry(clock_id.clone()).or_insert_with(|| {
            building_clock(
                clock_id.clone(),
                building.location_id,
                zone,
                format!("Improve {}", building.name),
                mounted.upgrade.segments,
                format!(
                    "What should the next care for {} make possible?",
                    building.name
                ),
                format!("{} gains its authored upgrade capabilities.", building.name),
                "civic",
                55,
            )
        });
        let strategies = building_strategies(
            &job_id,
            &mounted.upgrade.strategies,
            &clock_id,
            building.location_id,
            &building.pack_id,
            &building.pack_version,
            &building.name,
        );
        self.jobs.entry(job_id.clone()).or_insert_with(|| JobState {
            pack_id: building.pack_id.clone(),
            id: job_id.clone(),
            premise: format!("Improve {} through shared care.", building.name),
            stakes: "The completed building remains useful even if this upgrade stays open."
                .to_string(),
            location_ids: vec![building.location_id],
            participant_ids: Vec::new(),
            progress_clock_id: clock_id.clone(),
            danger_clock_id: String::new(),
            status: if building.upgrade_level > 0 {
                "completed"
            } else {
                "active"
            }
            .to_string(),
            reward: JobReward::Label("An authored building capability is added.".to_string()),
            consequence: "The building keeps its current capabilities.".to_string(),
            memory_summary: format!("Shared care improved {}.", building.name),
            action_copy: JobActionCopy {
                label: format!("Improve {}", building.name),
                summary: "Continue the place through a bounded upgrade.".to_string(),
            },
            contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
            contribution_strategies: strategies,
            narrated_thresholds: Vec::new(),
            delivery: None,
        });
        if let Some(sheet) = self.room_sheets.get_mut(&building.location_id) {
            if !sheet.projects.contains(&job_id) {
                sheet.projects.push(job_id);
                sheet.projects.sort();
                sheet.projects.dedup();
            }
        }
    }

    fn ensure_follow_up_projection(
        &mut self,
        building: &SettlementBuildingState,
        template_id: &str,
    ) {
        let clock_id = follow_up_clock_id(&building.id, template_id);
        let job_id = follow_up_job_id(&building.id, template_id);
        let production = template_id.starts_with("production.");
        let zone = if self.location_is_frontier(building.location_id) {
            ZONE_FRONTIER
        } else {
            ZONE_SANCTUARY
        };
        self.clocks.entry(clock_id.clone()).or_insert_with(|| {
            building_clock(
                clock_id.clone(),
                building.location_id,
                zone,
                format!("{}: {}", building.name, template_id.replace('.', " ")),
                2,
                if production {
                    format!("Can someone complete a represented {} quest?", building.name)
                } else {
                    format!("Who will return to care for {}?", building.name)
                },
                if production {
                    "The declared production reward becomes eligible; the building itself creates no cargo."
                        .to_string()
                } else {
                    format!("{} keeps a public trace of continued care.", building.name)
                },
                "session",
                if production { 65 } else { 45 },
            )
        });
        let kinds = vec!["work".to_string(), "help".to_string()];
        let strategies = building_strategies(
            &job_id,
            &kinds,
            &clock_id,
            building.location_id,
            &building.pack_id,
            &building.pack_version,
            &building.name,
        );
        self.jobs.entry(job_id.clone()).or_insert_with(|| JobState {
            pack_id: building.pack_id.clone(),
            id: job_id.clone(),
            premise: if production {
                format!(
                    "Complete one reward-bearing {} quest without passive production.",
                    building.name
                )
            } else {
                format!("Return to care for {}.", building.name)
            },
            stakes: if production {
                "Only quest completion can authorize a later physical loot allocation.".to_string()
            } else {
                "Late arrivals can leave a meaningful public contribution.".to_string()
            },
            location_ids: vec![building.location_id],
            participant_ids: Vec::new(),
            progress_clock_id: clock_id,
            danger_clock_id: String::new(),
            status: "active".to_string(),
            reward: JobReward::Details {
                label: if production {
                    "A declared production-table reward becomes eligible.".to_string()
                } else {
                    "The place remembers the contribution.".to_string()
                },
                orbs: 1,
            },
            consequence: "No item or capability appears without completed shared work.".to_string(),
            memory_summary: format!("Travelers returned to {}.", building.name),
            action_copy: JobActionCopy {
                label: if production {
                    format!("Work through a {} quest", building.name)
                } else {
                    format!("Care for {}", building.name)
                },
                summary: "Use the same shared Work and Help surface as every avatar.".to_string(),
            },
            contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
            contribution_strategies: strategies,
            narrated_thresholds: Vec::new(),
            delivery: None,
        });
        if let Some(sheet) = self.room_sheets.get_mut(&building.location_id) {
            if !sheet.projects.contains(&job_id) {
                sheet.projects.push(job_id);
                sheet.projects.sort();
                sheet.projects.dedup();
            }
        }
    }

    fn ensure_civic_projection(&mut self, location_id: u64, pack_id: &str, pack_version: &str) {
        let clock_id = settlement_civic_clock_id(location_id);
        let job_id = settlement_civic_job_id(location_id);
        let zone = if self.location_is_frontier(location_id) {
            ZONE_FRONTIER
        } else {
            ZONE_SANCTUARY
        };
        self.clocks.entry(clock_id.clone()).or_insert_with(|| {
            building_clock(
                clock_id.clone(),
                location_id,
                zone,
                "Make room for another major building".to_string(),
                5,
                "Will the settlement make room for a second major building?".to_string(),
                "A second major footprint becomes available without changing a settlement level."
                    .to_string(),
                "civic",
                50,
            )
        });
        let kinds = vec!["work".to_string(), "help".to_string()];
        let strategies = building_strategies(
            &job_id,
            &kinds,
            &clock_id,
            location_id,
            pack_id,
            pack_version,
            "the shared civic footprint",
        );
        self.jobs.entry(job_id.clone()).or_insert_with(|| JobState {
            pack_id: pack_id.to_string(),
            id: job_id.clone(),
            premise: "Make room for one more major building.".to_string(),
            stakes: "Capacity comes only from this completed civic clock.".to_string(),
            location_ids: vec![location_id],
            participant_ids: Vec::new(),
            progress_clock_id: clock_id,
            danger_clock_id: String::new(),
            status: "active".to_string(),
            reward: JobReward::Label("One additional major slot opens.".to_string()),
            consequence: "The settlement keeps its current bounded footprint.".to_string(),
            memory_summary: "Shared civic work made room for another building.".to_string(),
            action_copy: JobActionCopy {
                label: "Make room together".to_string(),
                summary: "Open one bounded additional footprint.".to_string(),
            },
            contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
            contribution_strategies: strategies,
            narrated_thresholds: Vec::new(),
            delivery: None,
        });
        if let Some(sheet) = self.room_sheets.get_mut(&location_id) {
            if !sheet.projects.contains(&job_id) {
                sheet.projects.push(job_id);
                sheet.projects.sort();
                sheet.projects.dedup();
            }
        }
    }

    fn apply_completed_building_room_effects(&mut self, building: &SettlementBuildingState) {
        let sanctuary = building
            .installed_capabilities
            .iter()
            .any(|capability| capability == "sanctuary");
        if let Some(sheet) = self.room_sheets.get_mut(&building.location_id) {
            if sanctuary {
                sheet.safety = "safe".to_string();
                sheet.zone = ZONE_SANCTUARY.to_string();
            }
            let boon = format!("{} is complete.", building.name);
            if !sheet.boons.contains(&boon) {
                sheet.boons.push(boon);
            }
            let hook = format!("{} leaves shared work for later arrivals.", building.name);
            if !sheet.hooks.contains(&hook) {
                sheet.hooks.push(hook);
            }
        }
    }

    fn append_building_event(
        &mut self,
        event_type: &str,
        actor_id: u64,
        location_id: u64,
        content: String,
        caused_by_event_seq: Option<u64>,
    ) -> EventView {
        let mut event = self.append_async_job_event(event_type, actor_id, None, Some(content));
        event.location_id = Some(location_id);
        event.location_name = self.location_name(location_id);
        event.caused_by_event_seq = caused_by_event_seq;
        self.replace_projected_event(&event);
        event
    }

    fn install_selected_buildings(
        &mut self,
        actor_id: u64,
        mode: BuildingReconcileMode,
    ) -> Vec<EventView> {
        let selections = self
            .governance_decisions
            .values()
            .filter_map(|decision| {
                let slot_index = governance_slot_index(decision)?;
                let selection = decision.selection.as_ref()?;
                Some((
                    decision.id.clone(),
                    decision.location_id,
                    slot_index,
                    selection.alternative_id.clone(),
                    selection.event_seq,
                ))
            })
            .collect::<Vec<_>>();
        let mut events = Vec::new();
        for (decision_id, location_id, slot_index, archetype_id, selected_event_seq) in selections {
            if self
                .settlement_buildings
                .values()
                .any(|building| building.governance_decision_id == decision_id)
            {
                continue;
            }
            let Some(mounted) = mounted_building_archetype(&archetype_id) else {
                continue;
            };
            if !self.building_archetype_is_legal(location_id, &mounted)
                || slot_index > self.settlement_building_slot_capacity(location_id)
            {
                continue;
            }
            let claim_id = building_claim_id(location_id, slot_index);
            if self.building_footprint_claims.contains_key(&claim_id) {
                continue;
            }
            let building_id = settlement_building_id(location_id, slot_index, &archetype_id);
            let construction_clock_id = building_construction_clock_id(&building_id);
            let construction_job_id = building_construction_job_id(&building_id);
            let upgrade_clock_id = (!mounted.archetype.upgrade_capabilities.is_empty())
                .then(|| building_upgrade_clock_id(&building_id));
            let upgrade_job_id = (!mounted.archetype.upgrade_capabilities.is_empty())
                .then(|| building_upgrade_job_id(&building_id));
            let building = SettlementBuildingState {
                schema_version: SETTLEMENT_BUILDING_SCHEMA_VERSION,
                id: building_id.clone(),
                location_id,
                slot_index,
                slot_class: mounted.footprint_class.clone(),
                archetype_id,
                name: mounted.archetype.name.clone(),
                pack_id: mounted.pack_id.clone(),
                pack_version: mounted.pack_version.clone(),
                governance_decision_id: decision_id.clone(),
                selected_event_seq,
                construction_clock_id,
                construction_job_id,
                status: SettlementBuildingStatus::Constructing,
                completed_event_seq: None,
                declared_capabilities: mounted.archetype.capabilities.clone(),
                installed_capabilities: Vec::new(),
                quest_templates: mounted.archetype.quest_templates.clone(),
                recipe_tags: mounted.archetype.recipe_tags.clone(),
                access_policy: mounted.archetype.access_policy.clone(),
                covenant_required: mounted.archetype.covenant_required,
                loot_table_id: mounted.archetype.loot_table_id.clone(),
                public_cache: None,
                upgrade_clock_id,
                upgrade_job_id,
                upgrade_level: 0,
                upgraded_event_seq: None,
                follow_up_job_ids: mounted
                    .archetype
                    .quest_templates
                    .iter()
                    .take(MAX_FOLLOW_UP_JOBS_PER_BUILDING)
                    .map(|template| follow_up_job_id(&building_id, template))
                    .collect(),
            };
            self.building_footprint_claims.insert(
                claim_id.clone(),
                BuildingFootprintClaimState {
                    id: claim_id,
                    location_id,
                    slot_index,
                    slot_class: mounted.footprint_class.clone(),
                    building_id: building_id.clone(),
                    governance_decision_id: decision_id,
                    claimed_event_seq: selected_event_seq,
                },
            );
            self.ensure_construction_projection(&building, &mounted);
            self.settlement_buildings
                .insert(building_id, building.clone());
            if mode == BuildingReconcileMode::EmitEvents {
                events.push(self.append_building_event(
                    "building.construction_opened",
                    actor_id,
                    location_id,
                    format!(
                        "{} claimed major slot {}; construction is now open to every avatar.",
                        building.name, slot_index
                    ),
                    Some(selected_event_seq),
                ));
            }
        }
        events
    }

    fn complete_and_upgrade_buildings(
        &mut self,
        actor_id: u64,
        mode: BuildingReconcileMode,
    ) -> Vec<EventView> {
        let building_ids = self
            .settlement_buildings
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut events = Vec::new();
        for building_id in building_ids {
            let Some(mut building) = self.settlement_buildings.get(&building_id).cloned() else {
                continue;
            };
            let Some(mounted) = mounted_building_archetype(&building.archetype_id) else {
                continue;
            };
            self.ensure_construction_projection(&building, &mounted);
            let construction_complete = self
                .clocks
                .get(&building.construction_clock_id)
                .is_some_and(|clock| clock.filled >= clock.segments);
            if building.status == SettlementBuildingStatus::Constructing && construction_complete {
                let completion_seq = self.world.next_event_seq;
                building.status = SettlementBuildingStatus::Completed;
                building.completed_event_seq = Some(completion_seq);
                building.installed_capabilities = mounted.archetype.capabilities.clone();
                building.installed_capabilities.sort();
                building.installed_capabilities.dedup();
                if mounted.archetype.cache_policy == "public_empty_until_reward" {
                    building.public_cache = Some(BuildingPublicCacheState {
                        id: format!("{}:public-cache", building.id),
                        name: format!("{} Public Cache", building.name),
                        policy: mounted.archetype.cache_policy.clone(),
                        item_ids: Vec::new(),
                    });
                }
                if let Some(job) = self.jobs.get_mut(&building.construction_job_id) {
                    job.status = "completed".to_string();
                }
                self.apply_completed_building_room_effects(&building);
                for template in building
                    .quest_templates
                    .iter()
                    .take(MAX_FOLLOW_UP_JOBS_PER_BUILDING)
                {
                    self.ensure_follow_up_projection(&building, template);
                }
                self.ensure_upgrade_projection(&building, &mounted);
                self.ensure_civic_projection(
                    building.location_id,
                    &building.pack_id,
                    &building.pack_version,
                );
                self.settlement_buildings
                    .insert(building_id.clone(), building.clone());
                if mode == BuildingReconcileMode::EmitEvents {
                    events.push(self.append_building_event(
                        "building.completed",
                        actor_id,
                        building.location_id,
                        format!(
                            "{} is complete; only its declared capabilities and follow-up work opened.",
                            building.name
                        ),
                        self.clocks
                            .get(&building.construction_clock_id)
                            .and_then(|clock| clock.updated_event_seq),
                    ));
                }
            } else if building.status == SettlementBuildingStatus::Completed {
                self.apply_completed_building_room_effects(&building);
                for template in building
                    .quest_templates
                    .iter()
                    .take(MAX_FOLLOW_UP_JOBS_PER_BUILDING)
                {
                    self.ensure_follow_up_projection(&building, template);
                }
                self.ensure_upgrade_projection(&building, &mounted);
                self.ensure_civic_projection(
                    building.location_id,
                    &building.pack_id,
                    &building.pack_version,
                );
            }

            let upgrade_complete = building
                .upgrade_clock_id
                .as_deref()
                .and_then(|clock_id| self.clocks.get(clock_id))
                .is_some_and(|clock| clock.filled >= clock.segments);
            if building.status == SettlementBuildingStatus::Completed
                && building.upgrade_level == 0
                && upgrade_complete
            {
                let upgrade_seq = self.world.next_event_seq;
                building.upgrade_level = 1;
                building.upgraded_event_seq = Some(upgrade_seq);
                building
                    .installed_capabilities
                    .extend(mounted.archetype.upgrade_capabilities.clone());
                building.installed_capabilities.sort();
                building.installed_capabilities.dedup();
                if let Some(job_id) = building.upgrade_job_id.as_deref() {
                    if let Some(job) = self.jobs.get_mut(job_id) {
                        job.status = "completed".to_string();
                    }
                }
                self.apply_completed_building_room_effects(&building);
                self.settlement_buildings
                    .insert(building_id.clone(), building.clone());
                if mode == BuildingReconcileMode::EmitEvents {
                    events.push(
                        self.append_building_event(
                            "building.upgraded",
                            actor_id,
                            building.location_id,
                            format!(
                                "{} gained its declared upgrade; its original capabilities remain.",
                                building.name
                            ),
                            building
                                .upgrade_clock_id
                                .as_deref()
                                .and_then(|clock_id| self.clocks.get(clock_id))
                                .and_then(|clock| clock.updated_event_seq),
                        ),
                    );
                }
            }
        }
        events
    }

    fn open_unlocked_building_slots(
        &mut self,
        actor_id: u64,
        mode: BuildingReconcileMode,
    ) -> Vec<EventView> {
        let locations = self
            .settlement_buildings
            .values()
            .filter(|building| building.status == SettlementBuildingStatus::Completed)
            .map(|building| building.location_id)
            .collect::<BTreeSet<_>>();
        let mut events = Vec::new();
        for location_id in locations {
            let capacity = self.settlement_building_slot_capacity(location_id);
            let claimed = self.settlement_building_claim_count(location_id);
            if capacity <= claimed || capacity < 2 {
                continue;
            }
            let decision_id =
                generated_building_governance_decision_id_for_slot(location_id, claimed + 1);
            if self.governance_decisions.contains_key(&decision_id) {
                continue;
            }
            let choices = self.legal_settlement_building_archetype_ids(location_id);
            if choices.is_empty() {
                continue;
            }
            let opened_event_seq = self.world.next_event_seq;
            let outcome = self.sync_generated_place_governance_for_slot(
                location_id,
                claimed + 1,
                &choices,
                opened_event_seq,
            );
            if outcome == GovernanceSyncOutcome::Opened && mode == BuildingReconcileMode::EmitEvents
            {
                events.push(
                    self.append_building_event(
                        "building.proposal_opened",
                        actor_id,
                        location_id,
                        "Civic work opened one additional governed major-building choice."
                            .to_string(),
                        self.clocks
                            .get(&settlement_civic_clock_id(location_id))
                            .and_then(|clock| clock.updated_event_seq),
                    ),
                );
            }
        }
        events
    }

    pub(super) fn reconcile_settlement_buildings(
        &mut self,
        actor_id: u64,
        mode: BuildingReconcileMode,
    ) -> Vec<EventView> {
        let mut events = self.install_selected_buildings(actor_id, mode);
        events.extend(self.complete_and_upgrade_buildings(actor_id, mode));
        events.extend(self.open_unlocked_building_slots(actor_id, mode));
        events
    }

    pub(super) fn backfill_settlement_buildings(&mut self) {
        self.reconcile_settlement_buildings(0, BuildingReconcileMode::Silent);
    }

    pub(super) fn settlement_building_views(
        &self,
        location_id: u64,
    ) -> Vec<SettlementBuildingView> {
        let mut buildings = self
            .settlement_buildings
            .values()
            .filter(|building| building.location_id == location_id)
            .collect::<Vec<_>>();
        buildings.sort_by_key(|building| (building.slot_index, building.id.as_str()));
        buildings
            .into_iter()
            .map(|building| {
                let (construction_filled, construction_segments) = self
                    .clocks
                    .get(&building.construction_clock_id)
                    .map(|clock| (clock.filled, clock.segments))
                    .unwrap_or_default();
                let public_cache =
                    building
                        .public_cache
                        .as_ref()
                        .map(|cache| BuildingPublicCacheView {
                            id: cache.id.clone(),
                            name: cache.name.clone(),
                            policy: cache.policy.clone(),
                            item_ids: cache.item_ids.clone(),
                            item_names: cache
                                .item_ids
                                .iter()
                                .map(|item_id| {
                                    self.item_name(*item_id)
                                        .unwrap_or_else(|| format!("Item {item_id}"))
                                })
                                .collect(),
                        });
                SettlementBuildingView {
                    schema_version: building.schema_version,
                    id: building.id.clone(),
                    location_id: building.location_id,
                    slot_index: building.slot_index,
                    slot_class: building.slot_class.clone(),
                    archetype_id: building.archetype_id.clone(),
                    name: building.name.clone(),
                    status: building.status,
                    pack_id: building.pack_id.clone(),
                    pack_version: building.pack_version.clone(),
                    governance_decision_id: building.governance_decision_id.clone(),
                    selected_event_seq: building.selected_event_seq,
                    completed_event_seq: building.completed_event_seq,
                    construction_clock_id: building.construction_clock_id.clone(),
                    construction_job_id: building.construction_job_id.clone(),
                    construction_filled,
                    construction_segments,
                    declared_capabilities: building.declared_capabilities.clone(),
                    installed_capabilities: building.installed_capabilities.clone(),
                    quest_templates: building.quest_templates.clone(),
                    recipe_tags: building.recipe_tags.clone(),
                    access_policy: building.access_policy.clone(),
                    covenant_required: building.covenant_required,
                    loot_table_id: building.loot_table_id.clone(),
                    public_cache,
                    upgrade_clock_id: building.upgrade_clock_id.clone(),
                    upgrade_job_id: building.upgrade_job_id.clone(),
                    upgrade_level: building.upgrade_level,
                    follow_up_job_ids: building.follow_up_job_ids.clone(),
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounted_catalog_covers_every_natural_choice_and_hides_unmet_specials() {
        let mut runtime = RuntimeWorld::seeded();
        let location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let universal = runtime.legal_settlement_building_archetype_ids(location_id);
        assert!(universal.contains(&"dwelling".to_string()));
        assert!(universal.contains(&"waystation".to_string()));
        assert!(universal.contains(&"workshop".to_string()));
        assert!(!universal.contains(&"fishery".to_string()));

        runtime.natural_affordances.insert(
            location_id,
            NaturalAffordanceState {
                schema_version: NATURAL_AFFORDANCE_SCHEMA_VERSION,
                location_id,
                environment: EnvironmentProfile::default(),
                latent_potential: None,
                generation: NaturalGenerationProvenance {
                    source: "test".to_string(),
                    algorithm: "test".to_string(),
                    world_seed: "test".to_string(),
                    environment_profile_version: ENVIRONMENT_PROFILE_VERSION,
                    pack_id: "cosyworld.core".to_string(),
                    pack_version: runtime.active_pack_version("cosyworld.core"),
                    provider: "test".to_string(),
                    model: "test".to_string(),
                },
                investigation_job_id: "test".to_string(),
                investigation_clock_id: "test".to_string(),
                causal_action_event_seqs: Vec::new(),
                revealed_feature: Some(NaturalFeatureState {
                    schema_version: NATURAL_AFFORDANCE_SCHEMA_VERSION,
                    location_id,
                    resource_kind: NaturalResourceKind::FishRichWater,
                    richness: NaturalRichness::Rich,
                    character: NaturalCharacter::Renewable,
                    building_archetypes: approved_buildings(NaturalResourceKind::FishRichWater),
                    presentation_key: "test".to_string(),
                    environment_profile_version: ENVIRONMENT_PROFILE_VERSION,
                    revealed_by_actor_id: RATI_ACTOR_ID,
                    revealed_event_seq: 1,
                    causal_action_event_seqs: vec![1],
                    generation: NaturalGenerationProvenance {
                        source: "test".to_string(),
                        algorithm: "test".to_string(),
                        world_seed: "test".to_string(),
                        environment_profile_version: ENVIRONMENT_PROFILE_VERSION,
                        pack_id: "cosyworld.core".to_string(),
                        pack_version: runtime.active_pack_version("cosyworld.core"),
                        provider: "test".to_string(),
                        model: "test".to_string(),
                    },
                }),
            },
        );
        let revealed = runtime.legal_settlement_building_archetype_ids(location_id);
        assert!(revealed.contains(&"fishery".to_string()));
        assert!(revealed.contains(&"smokehouse".to_string()));
        assert!(!revealed.contains(&"shallow_mine".to_string()));
        assert_eq!(
            runtime.world.item_count,
            RuntimeWorld::seeded().world.item_count
        );
    }

    #[test]
    fn location_environment_prerequisite_and_access_predicates_fail_closed() {
        let mut runtime = RuntimeWorld::seeded();
        let location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let mut mounted = mounted_building_archetype("dwelling").expect("dwelling is mounted");

        mounted.archetype.allowed_location_ids = vec![MOONLIT_TRAIL_LOCATION_ID];
        assert!(!runtime.building_archetype_is_legal(location_id, &mounted));

        mounted.archetype.allowed_location_ids = vec![location_id];
        mounted.archetype.environment_tags = vec!["woodland".to_string()];
        assert!(!runtime.building_archetype_is_legal(location_id, &mounted));
        runtime.natural_affordances.insert(
            location_id,
            freeze_natural_affordance(
                "test",
                location_id,
                EnvironmentProfile {
                    landforms: vec![EnvironmentLandform::Woodland],
                    ..EnvironmentProfile::default()
                },
                Vec::new(),
                "test",
                "cosyworld.core",
                &runtime.active_pack_version("cosyworld.core"),
            ),
        );
        assert!(runtime.building_archetype_is_legal(location_id, &mounted));

        mounted.archetype.required_capabilities = vec!["sanctuary".to_string()];
        assert!(!runtime.building_archetype_is_legal(location_id, &mounted));
        mounted.archetype.required_capabilities.clear();
        mounted.archetype.access_policy = "covenant".to_string();
        assert!(!runtime.building_archetype_is_legal(location_id, &mounted));
        mounted.archetype.access_policy = "public".to_string();
        mounted.archetype.covenant_required = true;
        assert!(!runtime.building_archetype_is_legal(location_id, &mounted));
    }

    #[test]
    fn recipe_tags_exist_only_at_a_completed_capable_building() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.settlement_buildings.insert(
            "workshop".to_string(),
            SettlementBuildingState {
                schema_version: SETTLEMENT_BUILDING_SCHEMA_VERSION,
                id: "workshop".to_string(),
                location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                slot_index: 1,
                slot_class: "major".to_string(),
                archetype_id: "workshop".to_string(),
                name: "Workshop".to_string(),
                pack_id: "cosyworld.core".to_string(),
                pack_version: runtime.active_pack_version("cosyworld.core"),
                governance_decision_id: "test".to_string(),
                selected_event_seq: 1,
                construction_clock_id: "test".to_string(),
                construction_job_id: "test".to_string(),
                status: SettlementBuildingStatus::Completed,
                completed_event_seq: Some(2),
                declared_capabilities: vec!["transformation_recipes".to_string()],
                installed_capabilities: vec!["transformation_recipes".to_string()],
                quest_templates: Vec::new(),
                recipe_tags: vec!["workshop".to_string(), "repair".to_string()],
                access_policy: default_access_policy(),
                covenant_required: false,
                loot_table_id: None,
                public_cache: None,
                upgrade_clock_id: None,
                upgrade_job_id: None,
                upgrade_level: 0,
                upgraded_event_seq: None,
                follow_up_job_ids: Vec::new(),
            },
        );
        assert_eq!(
            runtime.location_building_recipe_tags(RAIN_SOFT_GARDEN_LOCATION_ID),
            vec!["repair".to_string(), "workshop".to_string()]
        );
        assert!(runtime
            .location_building_recipe_tags(MOONLIT_TRAIL_LOCATION_ID)
            .is_empty());
    }

    #[test]
    fn fishery_completion_opens_a_reward_quest_and_empty_cache_without_cargo() {
        let mut runtime = RuntimeWorld::seeded();
        let location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let actor = runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("seed actor exists");
        actor.location_id = location_id;
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        let pack_version = runtime.active_pack_version("cosyworld.core");
        runtime.natural_affordances.insert(
            location_id,
            NaturalAffordanceState {
                schema_version: NATURAL_AFFORDANCE_SCHEMA_VERSION,
                location_id,
                environment: EnvironmentProfile::default(),
                latent_potential: None,
                generation: NaturalGenerationProvenance {
                    source: "test".to_string(),
                    algorithm: "test".to_string(),
                    world_seed: "test".to_string(),
                    environment_profile_version: ENVIRONMENT_PROFILE_VERSION,
                    pack_id: "cosyworld.core".to_string(),
                    pack_version: pack_version.clone(),
                    provider: "test".to_string(),
                    model: "test".to_string(),
                },
                investigation_job_id: "test".to_string(),
                investigation_clock_id: "test".to_string(),
                causal_action_event_seqs: Vec::new(),
                revealed_feature: Some(NaturalFeatureState {
                    schema_version: NATURAL_AFFORDANCE_SCHEMA_VERSION,
                    location_id,
                    resource_kind: NaturalResourceKind::FishRichWater,
                    richness: NaturalRichness::Rich,
                    character: NaturalCharacter::Renewable,
                    building_archetypes: approved_buildings(NaturalResourceKind::FishRichWater),
                    presentation_key: "test".to_string(),
                    environment_profile_version: ENVIRONMENT_PROFILE_VERSION,
                    revealed_by_actor_id: RATI_ACTOR_ID,
                    revealed_event_seq: 1,
                    causal_action_event_seqs: vec![1],
                    generation: NaturalGenerationProvenance {
                        source: "test".to_string(),
                        algorithm: "test".to_string(),
                        world_seed: "test".to_string(),
                        environment_profile_version: ENVIRONMENT_PROFILE_VERSION,
                        pack_id: "cosyworld.core".to_string(),
                        pack_version: pack_version.clone(),
                        provider: "test".to_string(),
                        model: "test".to_string(),
                    },
                }),
            },
        );
        let decision_id = generated_building_governance_decision_id(location_id);
        runtime.generated_places.insert(
            location_id,
            GeneratedPlaceState {
                schema_version: GENERATED_PLACE_SCHEMA_VERSION,
                location_id,
                pathway_id: "test-pathway".to_string(),
                connected_from_location_id: MOONLIT_TRAIL_LOCATION_ID,
                discovered_by_actor_id: RATI_ACTOR_ID,
                discovered_event_seq: Some(1),
                source_generation: GenerationProvenance::default(),
                pack_id: "cosyworld.core".to_string(),
                pack_version: pack_version.clone(),
                anchor_clock_id: "test-anchor".to_string(),
                connection_clock_id: "test-connection".to_string(),
                settlement_clock_id: "test-settlement".to_string(),
                anchor_job_id: "test-anchor-job".to_string(),
                connection_job_id: "test-connection-job".to_string(),
                settlement_job_id: "test-settlement-job".to_string(),
                building_proposal: Some(GeneratedBuildingProposalState {
                    schema_version: GENERATED_PLACE_SCHEMA_VERSION,
                    location_id,
                    eligible_archetype_ids: vec!["fishery".to_string()],
                    opened_event_seq: 2,
                    governance_decision_id: decision_id.clone(),
                    selected_archetype_id: None,
                }),
            },
        );
        assert_eq!(
            runtime.sync_generated_place_governance(location_id, &["fishery".to_string()], 2,),
            GovernanceSyncOutcome::Opened
        );
        let choice = GovernanceAction::Select {
            decision_id,
            alternative_id: "fishery".to_string(),
        };
        assert_eq!(
            runtime
                .apply_governance_action(RATI_ACTOR_ID, &choice)
                .len(),
            1
        );
        runtime.reconcile_settlement_buildings(RATI_ACTOR_ID, BuildingReconcileMode::EmitEvents);
        let building = runtime
            .settlement_buildings
            .values()
            .find(|building| building.archetype_id == "fishery")
            .cloned()
            .expect("fishery construction opens");
        let item_count = runtime.world.item_count;
        let segments = runtime.clocks[&building.construction_clock_id].segments;
        runtime.advance_clock(
            &building.construction_clock_id,
            segments,
            RATI_ACTOR_ID,
            "test_fishery_construction",
        );
        runtime.reconcile_settlement_buildings(RATI_ACTOR_ID, BuildingReconcileMode::EmitEvents);

        let completed = &runtime.settlement_buildings[&building.id];
        assert_eq!(completed.status, SettlementBuildingStatus::Completed);
        assert_eq!(
            completed.loot_table_id.as_deref(),
            Some("cosyworld.core:loot/fishery-catch")
        );
        let cache = completed
            .public_cache
            .as_ref()
            .expect("fishery installs a public cache");
        assert_eq!(cache.policy, "public_empty_until_reward");
        assert!(cache.item_ids.is_empty());
        assert_eq!(runtime.world.item_count, item_count);
        assert!(completed
            .follow_up_job_ids
            .iter()
            .filter_map(|job_id| runtime.jobs.get(job_id))
            .any(|job| job.reward.orbs() > 0 && job.premise.contains("reward-bearing")));
        assert_eq!(
            runtime.natural_affordances[&location_id]
                .revealed_feature
                .as_ref()
                .map(|feature| feature.resource_kind),
            Some(NaturalResourceKind::FishRichWater)
        );
    }
}
