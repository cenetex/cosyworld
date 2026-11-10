use super::*;

pub(super) const SETTLEMENT_BUILDING_SCHEMA_VERSION: u8 = 1;
const BUILDING_CATALOG_EXTENSION: &str = "x-cosyworld-building-archetypes";

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
            | "metalworking"
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

impl RuntimeWorld {}
