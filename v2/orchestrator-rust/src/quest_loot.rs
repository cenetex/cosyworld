use super::*;

pub(super) const QUEST_LOOT_SCHEMA_VERSION: u8 = 1;
const LOOT_CATALOG_EXTENSION: &str = "x-cosyworld-loot-tables";
const LOOT_REPLAY_VERSION: &str = "weighted-fnv1a-v1";
const LOOT_ITEM_ID_BASE: u64 = 9_000_000_000;
const LOOT_ITEM_ID_RANGE: u64 = 1_000_000_000;
const MAX_LOOT_ITEMS_PER_COMPLETION: usize = 4;

#[derive(Clone, Debug, Deserialize)]
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

#[derive(Clone, Debug)]
struct MountedLootTable {
    pack_id: String,
    pack_version: String,
    replay_version: String,
    table: LootTableDefinition,
    templates: BTreeMap<String, LootItemTemplateDefinition>,
}

#[derive(Clone, Debug)]
pub(super) struct MountedLootItemTemplate {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) template: LootItemTemplateDefinition,
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

#[derive(Clone, Debug)]
struct ResolvedLootDestination {
    kind: String,
    id: String,
    location_id: u64,
    recipient_actor_id: Option<u64>,
    building_id: Option<String>,
}

fn parse_loot_catalog(pack: &SeedWorldpackPack) -> Result<Option<LootTableCatalog>, String> {
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
            if !valid_loot_template_id(&template.id)
                || template.name.trim().is_empty()
                || template.description.trim().is_empty()
                || seed_item_kind_from_str(&template.kind).is_none()
                || !valid_loot_item_role(&template.role)
                || item_size_from_str(&template.size).is_none()
                || template.weight_tenths == 0
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

fn mounted_loot_table(table_id: &str) -> Option<MountedLootTable> {
    for pack in &active_content().manifest.packs {
        let Ok(Some(catalog)) = parse_loot_catalog(pack) else {
            continue;
        };
        let templates = catalog
            .item_templates
            .into_iter()
            .map(|template| (template.id.clone(), template))
            .collect::<BTreeMap<_, _>>();
        if let Some(table) = catalog
            .tables
            .into_iter()
            .find(|table| table.id == table_id)
        {
            return Some(MountedLootTable {
                pack_id: pack.id.clone(),
                pack_version: pack.version.clone(),
                replay_version: catalog.replay_version,
                table,
                templates,
            });
        }
    }
    None
}

pub(super) fn mounted_loot_item_template(template_id: &str) -> Option<MountedLootItemTemplate> {
    for pack in &active_content().manifest.packs {
        let Ok(Some(catalog)) = parse_loot_catalog(pack) else {
            continue;
        };
        if let Some(template) = catalog
            .item_templates
            .into_iter()
            .find(|template| template.id == template_id)
        {
            return Some(MountedLootItemTemplate {
                pack_id: pack.id.clone(),
                pack_version: pack.version.clone(),
                template,
            });
        }
    }
    None
}

pub(super) fn loot_spec_for_table(table_id: &str, quest_template_id: &str) -> Option<JobLootSpec> {
    let mounted = mounted_loot_table(table_id)?;
    Some(JobLootSpec {
        table_id: table_id.to_string(),
        quest_template_id: quest_template_id.to_string(),
        allocation_policy: mounted.table.allocation_policy,
        recipient_actor_id: None,
    })
}

fn loot_allocation_id(
    job_id: &str,
    completion_event_seq: u64,
    table_id: &str,
    table_version: u8,
) -> String {
    format!("quest-loot:{job_id}:{completion_event_seq}:{table_id}@{table_version}")
}

fn loot_roll_seed(roll_input: &str) -> u64 {
    stable_hash_u64(&["quest-loot", LOOT_REPLAY_VERSION, roll_input])
}

fn loot_item_id(allocation_id: &str, index: usize) -> u64 {
    LOOT_ITEM_ID_BASE
        + stable_hash_u64(&["quest-loot-item", allocation_id, &index.to_string()])
            % LOOT_ITEM_ID_RANGE
}

pub(super) fn loot_item_role(value: &str) -> Option<u8> {
    match value {
        "generic" => Some(CW_ITEM_ROLE_GENERIC),
        "consumable" => Some(CW_ITEM_ROLE_CONSUMABLE),
        "weapon" => Some(CW_ITEM_ROLE_WEAPON),
        "skill_charm" => Some(CW_ITEM_ROLE_SKILL_CHARM),
        "spell" => Some(CW_ITEM_ROLE_SPELL),
        "container" => Some(CW_ITEM_ROLE_CONTAINER),
        "tool" => Some(CW_ITEM_ROLE_TOOL),
        "relic" => Some(CW_ITEM_ROLE_RELIC),
        _ => None,
    }
}

fn weighted_loot_entry<'a>(
    table: &'a LootTableDefinition,
    seed: u64,
    index: usize,
) -> Option<&'a LootTableEntryDefinition> {
    let total = table
        .entries
        .iter()
        .map(|entry| u64::from(entry.weight))
        .sum::<u64>();
    if total == 0 {
        return None;
    }
    let mut cursor =
        stable_hash_u64(&["quest-loot-entry", &seed.to_string(), &index.to_string()]) % total;
    table.entries.iter().find(|entry| {
        if cursor < u64::from(entry.weight) {
            true
        } else {
            cursor -= u64::from(entry.weight);
            false
        }
    })
}

impl RuntimeWorld {
    fn loot_building_for_job(
        &self,
        job: &JobState,
        loot: &JobLootSpec,
    ) -> Option<&SettlementBuildingState> {
        self.settlement_buildings.values().find(|building| {
            building.status == SettlementBuildingStatus::Completed
                && building.location_id == job.location_ids.first().copied().unwrap_or_default()
                && building.loot_table_id.as_deref() == Some(loot.table_id.as_str())
                && building.follow_up_job_ids.contains(&job.id)
        })
    }

    fn loot_table_is_eligible(
        &self,
        mounted: &MountedLootTable,
        job: &JobState,
        loot: &JobLootSpec,
    ) -> bool {
        let table = &mounted.table;
        if table.allocation_policy != loot.allocation_policy
            || !table
                .eligibility
                .quest_templates
                .contains(&loot.quest_template_id)
        {
            return false;
        }
        let Some(location_id) = job.location_ids.first().copied() else {
            return false;
        };
        let building = self.loot_building_for_job(job, loot);
        if !table.eligibility.building_capabilities.is_empty()
            && building.is_none_or(|building| {
                table
                    .eligibility
                    .building_capabilities
                    .iter()
                    .any(|required| !building.installed_capabilities.contains(required))
            })
        {
            return false;
        }
        if !table.eligibility.natural_resources.is_empty()
            && self
                .natural_affordances
                .get(&location_id)
                .and_then(|state| state.revealed_feature.as_ref())
                .is_none_or(|feature| {
                    !table
                        .eligibility
                        .natural_resources
                        .iter()
                        .filter_map(|resource| loot_natural_resource(resource))
                        .any(|resource| resource == feature.resource_kind)
                })
        {
            return false;
        }
        let biome = self.location_meta_for(location_id).biome.to_lowercase();
        let has_required_biome = table
            .eligibility
            .biome_tags
            .iter()
            .all(|tag| biome.contains(&tag.to_lowercase()));
        let has_required_season = table.eligibility.seasons.is_empty()
            || self.tags.values().any(|tag| {
                tag.active
                    && tag.scope == "season"
                    && (tag.scope_id == 0 || tag.scope_id == location_id)
                    && table.eligibility.seasons.iter().any(|season| {
                        tag.id.eq_ignore_ascii_case(season)
                            || tag.label.eq_ignore_ascii_case(season)
                    })
            });
        if !has_required_biome || !has_required_season {
            return false;
        }
        if !table.eligibility.danger_tiers.is_empty() {
            let tier = if self.location_is_frontier(location_id) {
                "frontier"
            } else {
                "sanctuary"
            };
            if !table
                .eligibility
                .danger_tiers
                .iter()
                .any(|allowed| allowed == tier)
            {
                return false;
            }
        }
        if table.allocation_policy == "building_public_cache"
            && building.is_none_or(|building| building.public_cache.is_none())
        {
            return false;
        }
        true
    }

    fn resolve_loot_destination(
        &self,
        actor_id: u64,
        job: &JobState,
        loot: &JobLootSpec,
    ) -> Option<ResolvedLootDestination> {
        let location_id = job.location_ids.first().copied()?;
        match loot.allocation_policy.as_str() {
            "participant" => {
                let contributed = job.participant_ids.contains(&actor_id)
                    || self
                        .clocks
                        .get(&job.progress_clock_id)
                        .is_some_and(|clock| {
                            clock
                                .recent_contributions
                                .iter()
                                .any(|contribution| contribution.actor_id == actor_id)
                        });
                (contributed && self.actor_by_id(actor_id).is_some()).then(|| {
                    ResolvedLootDestination {
                        kind: "actor".to_string(),
                        id: actor_id.to_string(),
                        location_id,
                        recipient_actor_id: Some(actor_id),
                        building_id: None,
                    }
                })
            }
            "named_discoverer" => {
                let recipient_actor_id = self
                    .generated_places
                    .get(&location_id)
                    .map(|place| place.discovered_by_actor_id)?;
                self.actor_by_id(recipient_actor_id)?;
                Some(ResolvedLootDestination {
                    kind: "actor".to_string(),
                    id: recipient_actor_id.to_string(),
                    location_id,
                    recipient_actor_id: Some(recipient_actor_id),
                    building_id: None,
                })
            }
            "building_public_cache" => {
                let building = self.loot_building_for_job(job, loot)?;
                let cache_id = building.public_cache.as_ref()?.id.clone();
                Some(ResolvedLootDestination {
                    kind: "building_public_cache".to_string(),
                    id: cache_id,
                    location_id,
                    recipient_actor_id: None,
                    building_id: Some(building.id.clone()),
                })
            }
            "party_shared_cache" => Some(ResolvedLootDestination {
                kind: "party_shared_cache".to_string(),
                id: format!("location:{location_id}:shared-cache"),
                location_id,
                recipient_actor_id: None,
                building_id: None,
            }),
            "location_stockpile" => Some(ResolvedLootDestination {
                kind: "location_stockpile".to_string(),
                id: format!("location:{location_id}:stockpile"),
                location_id,
                recipient_actor_id: None,
                building_id: None,
            }),
            "commissioned_recipient" => {
                let recipient_actor_id = loot.recipient_actor_id?;
                self.actor_by_id(recipient_actor_id)?;
                Some(ResolvedLootDestination {
                    kind: "actor".to_string(),
                    id: recipient_actor_id.to_string(),
                    location_id,
                    recipient_actor_id: Some(recipient_actor_id),
                    building_id: None,
                })
            }
            _ => None,
        }
    }

    fn loot_template_allocated_before(&self, template_id: &str) -> bool {
        self.loot_allocations.values().any(|allocation| {
            allocation
                .selected_template_ids
                .iter()
                .any(|selected| selected == template_id)
        })
    }

    fn loot_template_present_at_destination(
        &self,
        template_id: &str,
        destination: &ResolvedLootDestination,
    ) -> bool {
        self.loot_allocations.values().any(|allocation| {
            if allocation.destination_id != destination.id {
                return false;
            }
            allocation
                .selected_template_ids
                .iter()
                .zip(allocation.item_ids.iter())
                .any(|(selected, item_id)| {
                    selected == template_id
                        && self.item_by_id(*item_id).is_some_and(|item| {
                            destination
                                .recipient_actor_id
                                .is_some_and(|actor_id| item.holder_actor_id == actor_id)
                                || destination.recipient_actor_id.is_none()
                                    && item.location_id == destination.location_id
                        })
                })
        })
    }

    fn resolved_loot_template_id(
        &self,
        mounted: &MountedLootTable,
        entry: &LootTableEntryDefinition,
        destination: &ResolvedLootDestination,
    ) -> Option<String> {
        let unavailable = entry.unique && self.loot_template_allocated_before(&entry.template_id);
        let already_present =
            self.loot_template_present_at_destination(&entry.template_id, destination);
        if unavailable {
            return (mounted.table.unavailable_policy == "fallback")
                .then(|| mounted.table.fallback_template_id.clone());
        }
        if already_present {
            return match mounted.table.already_present_policy.as_str() {
                "allow_duplicate" => Some(entry.template_id.clone()),
                "fallback" => Some(mounted.table.fallback_template_id.clone()),
                "skip" => None,
                _ => None,
            };
        }
        Some(entry.template_id.clone())
    }

    fn prepare_loot_item(
        &self,
        allocation_id: &str,
        item_index: usize,
        template: &LootItemTemplateDefinition,
        destination: &ResolvedLootDestination,
        completion_event_seq: u64,
        mounted: &MountedLootTable,
    ) -> Option<(CwItem, ItemMeta, String, ItemProvenanceState)> {
        let item_id = loot_item_id(allocation_id, item_index);
        if self.item_by_id(item_id).is_some() {
            return None;
        }
        let holder_actor_id = destination.recipient_actor_id.unwrap_or_default();
        let item = CwItem {
            id: item_id,
            kind: seed_item_kind_from_str(&template.kind)?,
            charges: template.charges,
            weight_tenths: template.weight_tenths,
            container_capacity_tenths: template.container_capacity_tenths,
            size_class: item_size_from_str(&template.size)?,
            role: loot_item_role(&template.role)?,
            zone: if holder_actor_id == 0 {
                CW_CARD_ZONE_WORLD
            } else {
                CW_CARD_ZONE_CARRIED
            },
            location_id: if holder_actor_id == 0 {
                destination.location_id
            } else {
                0
            },
            holder_actor_id,
            held_since_tick: self.world.tick,
            ..CwItem::default()
        };
        if holder_actor_id != 0 && !self.actor_can_exchange_items(holder_actor_id, None, item) {
            return None;
        }
        let meta = ItemMeta {
            name: template.name.clone(),
            description: template.description.clone(),
            skill_id: None,
            skill_bonus: 0,
            mechanics: template.mechanics.clone(),
        };
        let canonical_ref = opaque_runtime_ref(
            "item",
            &format!("loot:{allocation_id}:{item_index}:{}", template.id),
        );
        let provenance = ItemProvenanceState {
            item_id,
            origin: format!(
                "loot:{}@{}:{}@{}",
                mounted.table.id, mounted.table.version, mounted.pack_id, mounted.pack_version
            ),
            acquisition: "quest.loot_allocated".to_string(),
            previous_holder_actor_id: None,
            current_holder_actor_id: destination.recipient_actor_id,
            current_location_id: destination
                .recipient_actor_id
                .is_none()
                .then_some(destination.location_id),
            transfer_count: 0,
            source_event_seq: Some(completion_event_seq),
            possession_journey: destination.recipient_actor_id.map(|actor_id| {
                PossessionJourneyState::new(actor_id, destination.location_id, completion_event_seq)
            }),
        };
        Some((item, meta, canonical_ref, provenance))
    }

    fn allocate_completed_quest_loot(
        &mut self,
        actor_id: u64,
        job: &JobState,
        completion_event_seq: u64,
    ) -> Vec<EventView> {
        let Some(loot) = job.loot.as_ref() else {
            return Vec::new();
        };
        let Some(mounted) = mounted_loot_table(&loot.table_id) else {
            return Vec::new();
        };
        if !self.loot_table_is_eligible(&mounted, job, loot) {
            return Vec::new();
        }
        let Some(destination) = self.resolve_loot_destination(actor_id, job, loot) else {
            return Vec::new();
        };
        let allocation_id = loot_allocation_id(
            &job.id,
            completion_event_seq,
            &mounted.table.id,
            mounted.table.version,
        );
        if self.loot_allocations.contains_key(&allocation_id) {
            return Vec::new();
        }
        let roll_input = format!(
            "{}:{}:{}:{}:{}",
            job.id, completion_event_seq, mounted.table.id, mounted.table.version, destination.id
        );
        let roll_seed = loot_roll_seed(&roll_input);
        let quantity_range = mounted
            .table
            .quantity
            .max
            .saturating_sub(mounted.table.quantity.min)
            .saturating_add(1);
        let quantity = mounted.table.quantity.min
            + u8::try_from(roll_seed % u64::from(quantity_range)).unwrap_or_default();
        let mut selected_template_ids = Vec::new();
        for index in 0..usize::from(quantity).min(MAX_LOOT_ITEMS_PER_COMPLETION) {
            let Some(entry) = weighted_loot_entry(&mounted.table, roll_seed, index) else {
                return Vec::new();
            };
            if let Some(template_id) = self.resolved_loot_template_id(&mounted, entry, &destination)
            {
                selected_template_ids.push(template_id);
            }
        }
        if selected_template_ids.is_empty()
            || self.world.item_count + selected_template_ids.len() > CW_MAX_ITEMS
        {
            return Vec::new();
        }
        let templates = selected_template_ids
            .iter()
            .map(|template_id| mounted.templates.get(template_id).cloned())
            .collect::<Option<Vec<_>>>();
        let Some(templates) = templates else {
            return Vec::new();
        };
        let mut prepared_items = Vec::new();
        for (index, template) in templates.iter().enumerate() {
            let Some(prepared) = self.prepare_loot_item(
                &allocation_id,
                index,
                template,
                &destination,
                completion_event_seq,
                &mounted,
            ) else {
                return Vec::new();
            };
            prepared_items.push(prepared);
        }
        if let Some(recipient_actor_id) = destination.recipient_actor_id {
            let added_weight = prepared_items
                .iter()
                .map(|(item, _, _, _)| u32::from(effective_item_weight_tenths(*item)))
                .sum::<u32>();
            let Some(capacity) = self.actor_carrying_capacity_tenths(recipient_actor_id) else {
                return Vec::new();
            };
            if self
                .actor_carried_weight_tenths(recipient_actor_id)
                .saturating_add(added_weight)
                > capacity
            {
                return Vec::new();
            }
        }
        let item_ids = prepared_items
            .iter()
            .map(|(item, _, _, _)| item.id)
            .collect::<Vec<_>>();
        for (item, meta, canonical_ref, provenance) in prepared_items {
            self.world.items[self.world.item_count] = item;
            self.world.item_count += 1;
            self.items.insert(item.id, meta);
            self.canonical_identities
                .item_refs
                .insert(item.id, canonical_ref.clone());
            self.canonical_identities
                .entity_versions
                .entry(canonical_ref)
                .or_insert(1);
            self.item_provenance.insert(item.id, provenance);
        }
        if let Some(building_id) = destination.building_id.as_deref() {
            let Some(building) = self.settlement_buildings.get_mut(building_id) else {
                return Vec::new();
            };
            let Some(cache) = building.public_cache.as_mut() else {
                return Vec::new();
            };
            cache.item_ids.extend(item_ids.iter().copied());
            cache.item_ids.sort_unstable();
            cache.item_ids.dedup();
        }
        let item_names = item_ids
            .iter()
            .filter_map(|item_id| self.item_name(*item_id))
            .collect::<Vec<_>>();
        let destination_name = match destination.kind.as_str() {
            "actor" => destination
                .recipient_actor_id
                .and_then(|actor_id| self.actor_name(actor_id))
                .unwrap_or_else(|| "its recipient".to_string()),
            "building_public_cache" => self
                .loot_building_for_job(job, loot)
                .and_then(|building| building.public_cache.as_ref())
                .map(|cache| cache.name.clone())
                .unwrap_or_else(|| "the public cache".to_string()),
            _ => self
                .location_name(destination.location_id)
                .unwrap_or_else(|| format!("Location {}", destination.location_id)),
        };
        let summary = format!(
            "{} placed {} in {}.",
            mounted.table.presentation.label,
            item_names.join(" and "),
            destination_name
        );
        let mut event =
            self.append_async_job_event("quest.loot_allocated", actor_id, None, Some(summary));
        event.location_id = Some(destination.location_id);
        event.location_name = self.location_name(destination.location_id);
        event.item_id = item_ids.first().copied();
        event.item_name = item_names.first().cloned();
        event.caused_by_event_seq = Some(completion_event_seq);
        self.replace_projected_event(&event);
        self.loot_allocations.insert(
            allocation_id.clone(),
            LootAllocationState {
                schema_version: QUEST_LOOT_SCHEMA_VERSION,
                id: allocation_id,
                job_id: job.id.clone(),
                quest_template_id: loot.quest_template_id.clone(),
                table_id: mounted.table.id.clone(),
                table_version: mounted.table.version,
                replay_version: mounted.replay_version,
                pack_id: mounted.pack_id,
                pack_version: mounted.pack_version,
                rules_profile: active_content().manifest.rules_profile.clone(),
                completion_event_seq,
                allocation_event_seq: event.seq,
                roll_seed,
                roll_input,
                selected_template_ids,
                item_ids,
                allocation_policy: loot.allocation_policy.clone(),
                destination_kind: destination.kind,
                destination_id: destination.id,
                recipient_actor_id: destination.recipient_actor_id,
                location_id: destination.location_id,
            },
        );
        vec![event]
    }

    pub(super) fn reconcile_quest_loot(&mut self, events: &[EventView]) -> Vec<EventView> {
        let jobs = self
            .jobs
            .values()
            .filter(|job| job.loot.is_some())
            .cloned()
            .collect::<Vec<_>>();
        let mut completions = Vec::new();
        for job in jobs {
            let clock_segments = self
                .clocks
                .get(&job.progress_clock_id)
                .map(|clock| clock.segments)
                .unwrap_or_default();
            if let Some(event) = events.iter().find(|event| {
                event.success
                    && event.actor_id.is_some()
                    && (event.type_name == "job.updated"
                        && event
                            .content
                            .as_deref()
                            .and_then(job_id_from_event_content)
                            .as_deref()
                            == Some(job.id.as_str())
                        && event
                            .content
                            .as_deref()
                            .and_then(job_status_from_event_content)
                            == Some("completed")
                        || event.type_name == "clock.updated"
                            && event.clock_id.as_deref() == Some(job.progress_clock_id.as_str())
                            && event.clock_delta.unwrap_or_default() > 0
                            && event.clock_filled.unwrap_or_default() >= clock_segments)
            }) {
                completions.push((event.seq, event.actor_id.unwrap_or_default(), job));
            }
        }
        completions.sort_by_key(|(event_seq, _, job)| (*event_seq, job.id.clone()));
        completions
            .into_iter()
            .flat_map(|(event_seq, actor_id, job)| {
                self.allocate_completed_quest_loot(actor_id, &job, event_seq)
            })
            .collect()
    }

    pub(super) fn loot_allocation_views(&self, location_id: u64) -> Vec<LootAllocationView> {
        let mut allocations = self
            .loot_allocations
            .values()
            .filter(|allocation| allocation.location_id == location_id)
            .collect::<Vec<_>>();
        allocations
            .sort_by_key(|allocation| (allocation.completion_event_seq, allocation.id.as_str()));
        allocations
            .into_iter()
            .map(|allocation| LootAllocationView {
                schema_version: allocation.schema_version,
                id: allocation.id.clone(),
                job_id: allocation.job_id.clone(),
                quest_template_id: allocation.quest_template_id.clone(),
                table_id: allocation.table_id.clone(),
                table_version: allocation.table_version,
                pack_id: allocation.pack_id.clone(),
                pack_version: allocation.pack_version.clone(),
                completion_event_seq: allocation.completion_event_seq,
                allocation_event_seq: allocation.allocation_event_seq,
                selected_template_ids: allocation.selected_template_ids.clone(),
                item_ids: allocation.item_ids.clone(),
                item_names: allocation
                    .item_ids
                    .iter()
                    .map(|item_id| {
                        self.item_name(*item_id)
                            .unwrap_or_else(|| format!("Item {item_id}"))
                    })
                    .collect(),
                allocation_policy: allocation.allocation_policy.clone(),
                destination_kind: allocation.destination_kind.clone(),
                destination_id: allocation.destination_id.clone(),
                recipient_actor_id: allocation.recipient_actor_id,
                location_id: allocation.location_id,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weighted_selection_is_deterministic_and_unique_falls_back_without_rerolling() {
        let mounted =
            mounted_loot_table("cosyworld.core:loot/fishery-catch").expect("fishery table mounted");
        let first = weighted_loot_entry(&mounted.table, 42, 0).expect("weighted entry");
        let second = weighted_loot_entry(&mounted.table, 42, 0).expect("same weighted entry");
        assert_eq!(first.template_id, second.template_id);

        let mut runtime = RuntimeWorld::seeded();
        runtime.loot_allocations.insert(
            "prior".to_string(),
            LootAllocationState {
                schema_version: QUEST_LOOT_SCHEMA_VERSION,
                id: "prior".to_string(),
                job_id: "prior".to_string(),
                quest_template_id: "production.fishery".to_string(),
                table_id: mounted.table.id.clone(),
                table_version: mounted.table.version,
                replay_version: mounted.replay_version.clone(),
                pack_id: mounted.pack_id.clone(),
                pack_version: mounted.pack_version.clone(),
                rules_profile: active_content().manifest.rules_profile.clone(),
                completion_event_seq: 1,
                allocation_event_seq: 2,
                roll_seed: 3,
                roll_input: "prior".to_string(),
                selected_template_ids: vec!["glassfin_scale".to_string()],
                item_ids: Vec::new(),
                allocation_policy: "building_public_cache".to_string(),
                destination_kind: "building_public_cache".to_string(),
                destination_id: "prior".to_string(),
                recipient_actor_id: None,
                location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            },
        );
        let unique = mounted
            .table
            .entries
            .iter()
            .find(|entry| entry.unique)
            .expect("unique entry");
        let destination = ResolvedLootDestination {
            kind: "building_public_cache".to_string(),
            id: "new".to_string(),
            location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            recipient_actor_id: None,
            building_id: None,
        };
        assert_eq!(
            runtime.resolved_loot_template_id(&mounted, unique, &destination),
            Some("river_sprat".to_string())
        );

        let recipient = ResolvedLootDestination {
            kind: "actor".to_string(),
            id: RATI_ACTOR_ID.to_string(),
            location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            recipient_actor_id: Some(RATI_ACTOR_ID),
            building_id: None,
        };
        let template = mounted.templates.get("river_sprat").expect("fish template");
        let (item, _, _, provenance) = runtime
            .prepare_loot_item("private-reward", 0, template, &recipient, 9, &mounted)
            .expect("private physical reward can be prepared");
        assert_eq!(item.holder_actor_id, RATI_ACTOR_ID);
        assert_eq!(item.zone, CW_CARD_ZONE_CARRIED);
        assert_eq!(item.location_id, 0);
        assert_eq!(provenance.current_holder_actor_id, Some(RATI_ACTOR_ID));
    }
}
