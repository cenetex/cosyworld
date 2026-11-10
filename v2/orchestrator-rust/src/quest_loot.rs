use super::*;

pub(super) const QUEST_LOOT_SCHEMA_VERSION: u8 = 1;
const LOOT_CATALOG_EXTENSION: &str = "x-cosyworld-loot-tables";
pub(super) const WEIGHTED_FNV1A_V1: &str = "weighted-fnv1a-v1";
const LOOT_REPLAY_VERSION: &str = WEIGHTED_FNV1A_V1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct LootItemTemplateDefinition {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) kind: String,
    pub(super) charges: u8,
    #[serde(default = "default_loot_item_role")]
    pub(super) role: String,
    pub(super) weight_tenths: u16,
    #[serde(default = "default_loot_item_size")]
    pub(super) size: String,
    #[serde(default)]
    pub(super) container_capacity_tenths: u16,
    #[serde(default)]
    pub(super) delivery_tags: Vec<String>,
    #[serde(default)]
    pub(super) mechanics: Option<SeedPlayableItemMechanics>,
}

fn default_loot_item_role() -> String {
    "generic".to_string()
}

fn default_loot_item_size() -> String {
    "small".to_string()
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct LootQuantityDefinition {
    pub(super) min: u8,
    pub(super) max: u8,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub(super) struct LootEligibilityDefinition {
    #[serde(default)]
    pub(super) quest_templates: Vec<String>,
    #[serde(default)]
    pub(super) natural_resources: Vec<String>,
    #[serde(default)]
    pub(super) building_capabilities: Vec<String>,
    #[serde(default)]
    pub(super) biome_tags: Vec<String>,
    #[serde(default)]
    pub(super) seasons: Vec<String>,
    #[serde(default)]
    pub(super) danger_tiers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct LootTableEntryDefinition {
    pub(super) template_id: String,
    pub(super) weight: u16,
    #[serde(default = "default_loot_rarity")]
    pub(super) rarity: String,
    #[serde(default)]
    pub(super) unique: bool,
}

fn default_loot_rarity() -> String {
    "common".to_string()
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct LootPresentationDefinition {
    pub(super) label: String,
    pub(super) summary: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct LootTableDefinition {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) allocation_policy: String,
    pub(super) quantity: LootQuantityDefinition,
    pub(super) eligibility: LootEligibilityDefinition,
    pub(super) entries: Vec<LootTableEntryDefinition>,
    pub(super) fallback_template_id: String,
    pub(super) already_present_policy: String,
    pub(super) unavailable_policy: String,
    pub(super) presentation: LootPresentationDefinition,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct LootTableCatalog {
    pub(super) schema_version: u8,
    pub(super) replay_version: String,
    pub(super) item_templates: Vec<LootItemTemplateDefinition>,
    pub(super) tables: Vec<LootTableDefinition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct JobLootSpec {
    pub(super) table_id: String,
    pub(super) quest_template_id: String,
    pub(super) allocation_policy: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) recipient_actor_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct LootAllocationState {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) job_id: String,
    pub(super) quest_template_id: String,
    pub(super) table_id: String,
    pub(super) table_version: u8,
    pub(super) replay_version: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) rules_profile: String,
    pub(super) completion_event_seq: u64,
    pub(super) allocation_event_seq: u64,
    pub(super) roll_seed: u64,
    pub(super) roll_input: String,
    pub(super) selected_template_ids: Vec<String>,
    pub(super) item_ids: Vec<u64>,
    pub(super) allocation_policy: String,
    pub(super) destination_kind: String,
    pub(super) destination_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) recipient_actor_id: Option<u64>,
    pub(super) location_id: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct LootAllocationView {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) job_id: String,
    pub(super) quest_template_id: String,
    pub(super) table_id: String,
    pub(super) table_version: u8,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) completion_event_seq: u64,
    pub(super) allocation_event_seq: u64,
    pub(super) selected_template_ids: Vec<String>,
    pub(super) item_ids: Vec<u64>,
    pub(super) item_names: Vec<String>,
    pub(super) allocation_policy: String,
    pub(super) destination_kind: String,
    pub(super) destination_id: String,
    pub(super) recipient_actor_id: Option<u64>,
    pub(super) location_id: u64,
}

pub(super) fn parse_loot_catalog(
    pack: &SeedWorldpackPack,
) -> Result<Option<LootTableCatalog>, String> {
    let Some(value) = pack.extensions.get(LOOT_CATALOG_EXTENSION).cloned() else {
        return Ok(None);
    };
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("pack {} loot tables: {error}", pack.id))
}

fn valid_loot_template_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && value.len() <= 48
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn valid_loot_table_id(value: &str) -> bool {
    let Some((pack, path)) = value.split_once(":loot/") else {
        return false;
    };
    !pack.is_empty()
        && !path.is_empty()
        && pack.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || ".-".contains(character)
        })
        && path.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn valid_loot_allocation_policy(value: &str) -> bool {
    matches!(
        value,
        "participant"
            | "named_discoverer"
            | "party_shared_cache"
            | "building_public_cache"
            | "location_stockpile"
            | "commissioned_recipient"
    )
}

fn valid_loot_item_role(value: &str) -> bool {
    matches!(
        value,
        "generic"
            | "consumable"
            | "weapon"
            | "skill_charm"
            | "spell"
            | "container"
            | "tool"
            | "relic"
    )
}

fn loot_natural_resource(value: &str) -> Option<NaturalResourceKind> {
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

pub(super) fn validate_seed_loot_tables(content: &SeedContent) -> Result<(), String> {
    let mut table_ids = BTreeSet::new();
    let mut table_quantities = BTreeMap::new();
    for pack in &content.manifest.packs {
        let Some(catalog) = parse_loot_catalog(pack)? else {
            continue;
        };
        if catalog.schema_version != QUEST_LOOT_SCHEMA_VERSION
            || catalog.replay_version != LOOT_REPLAY_VERSION
            || catalog.item_templates.is_empty()
            || catalog.item_templates.len() > 64
            || catalog.tables.is_empty()
            || catalog.tables.len() > 32
        {
            return Err(format!("pack {} has an invalid loot catalog", pack.id));
        }
        let mut templates = BTreeMap::new();
        for template in &catalog.item_templates {
            let delivery_tags = template.delivery_tags.iter().collect::<BTreeSet<_>>();
            if !valid_loot_template_id(&template.id)
                || template.name.trim().is_empty()
                || template.description.trim().is_empty()
                || seed_item_kind_from_str(&template.kind).is_none()
                || !valid_loot_item_role(&template.role)
                || item_size_from_str(&template.size).is_none()
                || template.weight_tenths == 0
                || template.delivery_tags.len() > 16
                || delivery_tags.len() != template.delivery_tags.len()
                || template
                    .delivery_tags
                    .iter()
                    .any(|tag| !valid_delivery_item_tag(tag))
                || !templates.insert(template.id.clone(), template).is_none()
            {
                return Err(format!(
                    "pack {} has invalid or duplicate loot template {}",
                    pack.id, template.id
                ));
            }
        }
        for table in &catalog.tables {
            if !valid_loot_table_id(&table.id)
                || !table.id.starts_with(&format!("{}:loot/", pack.id))
                || !table_ids.insert(table.id.clone())
                || table.version == 0
                || !valid_loot_allocation_policy(&table.allocation_policy)
                || !(1..=4).contains(&table.quantity.min)
                || table.quantity.max < table.quantity.min
                || table.quantity.max > 4
                || table.eligibility.quest_templates.is_empty()
                || table.entries.is_empty()
                || table.entries.len() > 32
                || table.presentation.label.trim().is_empty()
                || table.presentation.summary.trim().is_empty()
                || !matches!(
                    table.already_present_policy.as_str(),
                    "allow_duplicate" | "fallback" | "skip"
                )
                || !matches!(
                    table.unavailable_policy.as_str(),
                    "fallback" | "fail_closed"
                )
                || !templates.contains_key(&table.fallback_template_id)
            {
                return Err(format!(
                    "pack {} has invalid loot table {}",
                    pack.id, table.id
                ));
            }
            table_quantities.insert(table.id.clone(), (table.quantity.min, table.quantity.max));
            let mut entry_templates = BTreeSet::new();
            for entry in &table.entries {
                if entry.weight == 0
                    || !matches!(
                        entry.rarity.as_str(),
                        "common" | "uncommon" | "rare" | "special"
                    )
                    || !templates.contains_key(&entry.template_id)
                    || !entry_templates.insert(entry.template_id.clone())
                {
                    return Err(format!("loot table {} has an invalid entry", table.id));
                }
            }
            if table
                .eligibility
                .natural_resources
                .iter()
                .any(|resource| loot_natural_resource(resource).is_none())
                || table
                    .eligibility
                    .danger_tiers
                    .iter()
                    .any(|tier| !matches!(tier.as_str(), "sanctuary" | "frontier"))
            {
                return Err(format!("loot table {} has invalid eligibility", table.id));
            }
            if matches!(table.already_present_policy.as_str(), "fallback")
                || table.unavailable_policy == "fallback"
            {
                if table
                    .entries
                    .iter()
                    .any(|entry| entry.template_id == table.fallback_template_id && entry.unique)
                {
                    return Err(format!(
                        "loot table {} has a unique fallback template",
                        table.id
                    ));
                }
            }
        }
    }

    for item in &content.items {
        let Some(table_id) = item.identity_table_id.as_deref() else {
            continue;
        };
        if table_quantities.get(table_id) != Some(&(1, 1)) {
            return Err(format!(
                "item {} references missing or non-single-item identity loot table {table_id}",
                item.id
            ));
        }
        if item.mechanics.is_some() || !item.capabilities.is_empty() {
            return Err(format!(
                "unresolved identity item {} cannot declare mechanics or capabilities",
                item.id
            ));
        }
    }

    for pack in &content.manifest.packs {
        let Some(archetypes) = pack
            .extensions
            .get("x-cosyworld-building-archetypes")
            .and_then(|value| value.get("archetypes"))
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };
        for archetype in archetypes {
            if let Some(table_id) = archetype
                .get("loot_table_id")
                .and_then(serde_json::Value::as_str)
            {
                if !table_ids.contains(table_id) {
                    return Err(format!(
                        "building {} references missing loot table {table_id}",
                        archetype
                            .get("id")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("unknown")
                    ));
                }
            }
        }
    }
    Ok(())
}

impl RuntimeWorld {}
