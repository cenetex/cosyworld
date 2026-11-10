// THR-D0 publishes the validated authority and receipt contract before the
// procedure/materialization consumers in #601/#602. Keep that staged API
// compiled in production without spending the repository's warning budget.
#![cfg_attr(not(test), allow(dead_code))]

use super::*;

pub(super) const DISCOVERY_AUTHORITY_SCHEMA_VERSION: u8 = 1;
pub(super) const DISCOVERY_RECEIPT_VERSION: &str = "discovery-receipt-v1";
const DISCOVERY_EXTENSION: &str = "x-cosyworld-discovery-slots";
const DISCOVERY_CLAIM_POLICY: &str = "once_per_scope";

const TARGET_KINDS: [&str; 7] = [
    "item", "feature", "actor", "route", "location", "resource", "lore",
];
const SCOPES: [&str; 3] = ["actor", "expedition", "world"];
const INITIAL_PHASES: [&str; 2] = ["latent", "signed"];
const SENSES: [&str; 6] = ["sight", "sound", "smell", "touch", "taste", "other"];
const REVEAL_METHODS: [&str; 4] = ["notice", "search", "study", "scout"];
const ELIGIBLE_INPUTS: [&str; 8] = [
    "world_seed",
    "worldpack_bundle_hash",
    "slot_id",
    "slot_version",
    "origin_id",
    "region_id",
    "rules_profile",
    "claim_scope_id",
];
const EVENT_EFFECTS: [&str; 6] = [
    "advance_pressure",
    "alter_lead",
    "change_position",
    "consume_resource",
    "change_hazard",
    "change_method",
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryAuthorityCatalog {
    pub(crate) schema_version: u8,
    pub(crate) receipt_version: String,
    pub(crate) roll_algorithm: String,
    pub(crate) stocking_tables: Vec<DiscoveryStockingTable>,
    #[serde(default)]
    pub(crate) event_tables: Vec<DiscoveryEventTable>,
    #[serde(default)]
    pub(crate) presentation_tables: Vec<DiscoveryPresentationTable>,
    pub(crate) slots: Vec<DiscoverySlotDefinition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryStockingTable {
    pub(crate) id: String,
    pub(crate) version: u8,
    pub(crate) target_kind: String,
    pub(crate) eligible_inputs: Vec<String>,
    pub(crate) rows: Vec<DiscoveryStockingRow>,
    pub(crate) fallback_row_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryStockingRow {
    pub(crate) id: String,
    pub(crate) weight: u16,
    pub(crate) result_ids: Vec<String>,
    #[serde(default)]
    pub(crate) unique: bool,
    #[serde(default)]
    pub(crate) topology_entity_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryEventTable {
    pub(crate) id: String,
    pub(crate) version: u8,
    pub(crate) eligible_inputs: Vec<String>,
    pub(crate) rows: Vec<DiscoveryEventRow>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryEventRow {
    pub(crate) id: String,
    pub(crate) weight: u16,
    pub(crate) effect_kind: String,
    pub(crate) target_id: String,
    pub(crate) amount: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryPresentationTable {
    pub(crate) id: String,
    pub(crate) version: u8,
    pub(crate) rows: Vec<DiscoveryPresentationRow>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryPresentationRow {
    pub(crate) id: String,
    pub(crate) text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoverySlotDefinition {
    pub(crate) id: String,
    pub(crate) version: u8,
    pub(crate) target_kind: String,
    pub(crate) origin_id: String,
    pub(crate) scope: String,
    pub(crate) initial_phase: String,
    pub(crate) tells: Vec<DiscoveryTell>,
    pub(crate) reveal_methods: Vec<String>,
    pub(crate) claim_policy: String,
    pub(crate) stocking: DiscoveryStockingBinding,
    #[serde(default)]
    pub(crate) authorized_topology_ids: Vec<String>,
    #[serde(default)]
    pub(crate) gate_id: Option<String>,
    #[serde(default)]
    pub(crate) hazard_id: Option<String>,
    #[serde(default)]
    pub(crate) event_table_id: Option<String>,
    #[serde(default)]
    pub(crate) event_table_version: Option<u8>,
    #[serde(default)]
    pub(crate) presentation_table_id: Option<String>,
    #[serde(default)]
    pub(crate) presentation_table_version: Option<u8>,
    pub(crate) progression: DiscoveryProgression,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryTell {
    pub(crate) id: String,
    pub(crate) sense: String,
    pub(crate) text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryStockingBinding {
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) table_id: Option<String>,
    #[serde(default)]
    pub(crate) table_version: Option<u8>,
    #[serde(default)]
    pub(crate) result_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryProgression {
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) sign_budget: Option<u8>,
    #[serde(default)]
    pub(crate) fallback_row_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveryRollReceipt {
    pub(crate) schema_version: u8,
    pub(crate) receipt_version: String,
    pub(crate) id: String,
    pub(crate) claim_key: String,
    pub(crate) slot_id: String,
    pub(crate) slot_version: u8,
    pub(crate) target_kind: String,
    pub(crate) scope: String,
    pub(crate) scope_id: String,
    pub(crate) pack_id: String,
    pub(crate) pack_version: String,
    pub(crate) table_id: Option<String>,
    pub(crate) table_version: Option<u8>,
    pub(crate) roll_algorithm: String,
    pub(crate) eligible_input_facts: BTreeMap<String, String>,
    pub(crate) seed_input: String,
    pub(crate) roll_seed: u64,
    pub(crate) selected_row_id: String,
    pub(crate) materialized_entity_ids: Vec<String>,
    pub(crate) fallback_decision: String,
}

fn parse_catalog(pack: &SeedWorldpackPack) -> Result<Option<DiscoveryAuthorityCatalog>, String> {
    let Some(value) = pack.extensions.get(DISCOVERY_EXTENSION).cloned() else {
        return Ok(None);
    };
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("pack {} discovery authority: {error}", pack.id))
}

pub(crate) fn discovery_authority_catalog(
    pack: &SeedWorldpackPack,
) -> Result<Option<DiscoveryAuthorityCatalog>, String> {
    parse_catalog(pack)
}

pub(super) struct DiscoverySlotContract {
    pub(super) version: u8,
    pub(super) target_kind: String,
    pub(super) claim_policy: String,
    pub(super) table_id: Option<String>,
    pub(super) table_version: Option<u8>,
}

pub(super) type DiscoverySlotContracts = BTreeMap<String, DiscoverySlotContract>;

pub(super) fn discovery_slot_contracts(
    pack: &SeedWorldpackPack,
) -> Result<DiscoverySlotContracts, String> {
    let Some(catalog) = parse_catalog(pack)? else {
        return Ok(BTreeMap::new());
    };
    Ok(catalog
        .slots
        .into_iter()
        .map(|slot| {
            (
                slot.id,
                DiscoverySlotContract {
                    version: slot.version,
                    target_kind: slot.target_kind,
                    claim_policy: slot.claim_policy,
                    table_id: slot.stocking.table_id,
                    table_version: slot.stocking.table_version,
                },
            )
        })
        .collect())
}

fn valid_row_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && (2..=64).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn valid_canonical_id(value: &str, pack_id: &str, kind: Option<&str>) -> bool {
    let Some((owner, path)) = value.split_once(':') else {
        return false;
    };
    if owner != pack_id
        || owner.is_empty()
        || !owner
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        || !owner.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || ".-".contains(character)
        })
    {
        return false;
    }
    let Some((actual_kind, entity_path)) = path.split_once('/') else {
        return false;
    };
    kind.is_none_or(|expected| actual_kind == expected)
        && !actual_kind.is_empty()
        && !entity_path.is_empty()
        && actual_kind.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && entity_path.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || ".-_/".contains(character)
        })
}

fn bounded_unique_strings(
    values: &[String],
    minimum: usize,
    maximum: usize,
    allowed: Option<&[&str]>,
) -> bool {
    values.len() >= minimum
        && values.len() <= maximum
        && values.iter().all(|value| {
            !value.trim().is_empty()
                && allowed.is_none_or(|choices| choices.contains(&value.as_str()))
        })
        && values.iter().collect::<BTreeSet<_>>().len() == values.len()
}

fn validate_eligible_inputs(values: &[String], label: &str) -> Result<(), String> {
    if !bounded_unique_strings(values, 1, 16, Some(&ELIGIBLE_INPUTS))
        || !values.iter().any(|value| value == "slot_id")
        || !values.iter().any(|value| value == "slot_version")
    {
        return Err(format!(
            "{label} eligible_inputs must be bounded server facts including slot_id and slot_version"
        ));
    }
    Ok(())
}

pub(super) fn validate_discovery_authority_catalog(
    catalog: &DiscoveryAuthorityCatalog,
    pack_id: &str,
) -> Result<(), String> {
    if catalog.schema_version != DISCOVERY_AUTHORITY_SCHEMA_VERSION
        || catalog.receipt_version != DISCOVERY_RECEIPT_VERSION
        || catalog.roll_algorithm != WEIGHTED_FNV1A_V1
        || !(1..=64).contains(&catalog.stocking_tables.len())
        || catalog.event_tables.len() > 32
        || catalog.presentation_tables.len() > 32
        || !(1..=256).contains(&catalog.slots.len())
    {
        return Err(format!(
            "pack {pack_id} has an invalid discovery authority header"
        ));
    }

    let mut tables = BTreeMap::new();
    let mut result_occurrences = BTreeMap::<String, Vec<bool>>::new();
    for table in &catalog.stocking_tables {
        let label = format!("discovery stocking table {}", table.id);
        if !valid_canonical_id(&table.id, pack_id, Some("discovery-table"))
            || tables.contains_key(table.id.as_str())
            || table.version == 0
            || !TARGET_KINDS.contains(&table.target_kind.as_str())
            || !(1..=64).contains(&table.rows.len())
        {
            return Err(format!("{label} is invalid or duplicated"));
        }
        validate_eligible_inputs(&table.eligible_inputs, &label)?;
        let mut row_ids = BTreeSet::new();
        for row in &table.rows {
            if !valid_row_id(&row.id)
                || !row_ids.insert(row.id.as_str())
                || row.weight == 0
                || !bounded_unique_strings(&row.result_ids, 1, 8, None)
                || row
                    .result_ids
                    .iter()
                    .any(|id| !valid_canonical_id(id, pack_id, None))
                || row.topology_entity_ids.len() > 8
                || row
                    .topology_entity_ids
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len()
                    != row.topology_entity_ids.len()
                || row
                    .topology_entity_ids
                    .iter()
                    .any(|id| !row.result_ids.contains(id))
                || (!row.topology_entity_ids.is_empty()
                    && !matches!(table.target_kind.as_str(), "route" | "location"))
            {
                return Err(format!("{label} has invalid row {}", row.id));
            }
            for result_id in &row.result_ids {
                result_occurrences
                    .entry(result_id.clone())
                    .or_default()
                    .push(row.unique);
            }
        }
        let fallback_row = table
            .rows
            .iter()
            .find(|row| row.id == table.fallback_row_id);
        if fallback_row.is_none() || fallback_row.is_some_and(|row| row.unique) {
            return Err(format!("{label} has an invalid fallback row"));
        }
        tables.insert(table.id.as_str(), table);
    }
    if result_occurrences
        .values()
        .any(|occurrences| occurrences.len() > 1 && occurrences.iter().any(|unique| *unique))
    {
        return Err(format!(
            "pack {pack_id} repeats a unique discovery result across stocking rows"
        ));
    }

    let mut event_tables = BTreeMap::new();
    for table in &catalog.event_tables {
        let label = format!("discovery event table {}", table.id);
        if !valid_canonical_id(&table.id, pack_id, Some("event-table"))
            || event_tables.contains_key(table.id.as_str())
            || table.version == 0
            || !(1..=64).contains(&table.rows.len())
        {
            return Err(format!("{label} is invalid or duplicated"));
        }
        validate_eligible_inputs(&table.eligible_inputs, &label)?;
        let mut row_ids = BTreeSet::new();
        for row in &table.rows {
            if !valid_row_id(&row.id)
                || !row_ids.insert(row.id.as_str())
                || row.weight == 0
                || !EVENT_EFFECTS.contains(&row.effect_kind.as_str())
                || !valid_canonical_id(&row.target_id, pack_id, None)
                || row.amount == 0
            {
                return Err(format!(
                    "{label} row {} may not create topology, unique loot, or rewards",
                    row.id
                ));
            }
        }
        event_tables.insert(table.id.as_str(), table);
    }

    let mut presentation_tables = BTreeMap::new();
    for table in &catalog.presentation_tables {
        if !valid_canonical_id(&table.id, pack_id, Some("presentation-table"))
            || presentation_tables.contains_key(table.id.as_str())
            || table.version == 0
            || !(1..=64).contains(&table.rows.len())
        {
            return Err(format!(
                "discovery presentation table {} is invalid or duplicated",
                table.id
            ));
        }
        presentation_tables.insert(table.id.as_str(), table);
        let mut row_ids = BTreeSet::new();
        if table.rows.iter().any(|row| {
            !valid_row_id(&row.id) || !row_ids.insert(row.id.as_str()) || row.text.trim().is_empty()
        }) {
            return Err(format!(
                "discovery presentation table {} has an invalid row",
                table.id
            ));
        }
    }

    let mut slot_ids = BTreeSet::new();
    for slot in &catalog.slots {
        let label = format!("discovery slot {}", slot.id);
        if !valid_canonical_id(&slot.id, pack_id, Some("discovery"))
            || !slot_ids.insert(slot.id.as_str())
            || slot.version == 0
            || !TARGET_KINDS.contains(&slot.target_kind.as_str())
            || !valid_canonical_id(&slot.origin_id, pack_id, None)
            || !SCOPES.contains(&slot.scope.as_str())
            || !INITIAL_PHASES.contains(&slot.initial_phase.as_str())
            || slot.claim_policy != DISCOVERY_CLAIM_POLICY
            || !bounded_unique_strings(&slot.reveal_methods, 1, 4, Some(&REVEAL_METHODS))
            || !(1..=8).contains(&slot.tells.len())
            || !bounded_unique_strings(&slot.authorized_topology_ids, 0, 64, None)
            || slot
                .authorized_topology_ids
                .iter()
                .any(|id| !valid_canonical_id(id, pack_id, None))
            || (!slot.authorized_topology_ids.is_empty()
                && !matches!(slot.target_kind.as_str(), "route" | "location"))
        {
            return Err(format!("{label} is invalid or duplicated"));
        }
        let mut tell_ids = BTreeSet::new();
        if slot.tells.iter().any(|tell| {
            !valid_row_id(&tell.id)
                || !tell_ids.insert(tell.id.as_str())
                || !SENSES.contains(&tell.sense.as_str())
                || tell.text.trim().is_empty()
        }) {
            return Err(format!("{label} has an invalid sensory tell"));
        }
        if slot
            .gate_id
            .iter()
            .chain(slot.hazard_id.iter())
            .any(|id| !valid_canonical_id(id, pack_id, None))
            || match (&slot.event_table_id, slot.event_table_version) {
                (None, None) => false,
                (Some(id), Some(version)) => event_tables
                    .get(id.as_str())
                    .is_none_or(|table| table.version != version),
                _ => true,
            }
            || match (&slot.presentation_table_id, slot.presentation_table_version) {
                (None, None) => false,
                (Some(id), Some(version)) => presentation_tables
                    .get(id.as_str())
                    .is_none_or(|table| table.version != version),
                _ => true,
            }
        {
            return Err(format!(
                "{label} has an invalid descriptor or table binding"
            ));
        }

        let table = match slot.stocking.kind.as_str() {
            "fixed" => {
                if slot.stocking.table_id.is_some()
                    || slot.stocking.table_version.is_some()
                    || !bounded_unique_strings(&slot.stocking.result_ids, 1, 8, None)
                    || slot
                        .stocking
                        .result_ids
                        .iter()
                        .any(|id| !valid_canonical_id(id, pack_id, None))
                    || (matches!(slot.target_kind.as_str(), "route" | "location")
                        && slot
                            .stocking
                            .result_ids
                            .iter()
                            .any(|id| !slot.authorized_topology_ids.contains(id)))
                {
                    return Err(format!("{label} has invalid fixed stocking"));
                }
                None
            }
            "table" => {
                if !slot.stocking.result_ids.is_empty() {
                    return Err(format!("{label} table stocking contains fixed results"));
                }
                let Some(table) = slot
                    .stocking
                    .table_id
                    .as_deref()
                    .and_then(|id| tables.get(id).copied())
                else {
                    return Err(format!("{label} references a missing stocking table"));
                };
                if table.target_kind != slot.target_kind
                    || slot.stocking.table_version != Some(table.version)
                {
                    return Err(format!(
                        "{label} and its stocking table target different kinds or versions"
                    ));
                }
                if table.rows.iter().any(|row| {
                    row.topology_entity_ids
                        .iter()
                        .any(|id| !slot.authorized_topology_ids.contains(id))
                }) {
                    return Err(format!(
                        "{label} stocking table creates topology outside its authorization"
                    ));
                }
                Some(table)
            }
            _ => return Err(format!("{label} has an unknown stocking kind")),
        };

        match slot.progression.kind.as_str() {
            "optional"
                if slot.progression.sign_budget.is_none()
                    && slot.progression.fallback_row_id.is_none() => {}
            "required" => {
                let Some(table) = table else {
                    return Err(format!(
                        "{label} required progression must use a bounded table"
                    ));
                };
                if slot.progression.sign_budget.is_none()
                    || slot.progression.sign_budget == Some(0)
                    || slot.progression.fallback_row_id.as_deref()
                        != Some(table.fallback_row_id.as_str())
                {
                    return Err(format!(
                        "{label} required progression needs a finite budget and deterministic fallback"
                    ));
                }
            }
            _ => return Err(format!("{label} has invalid progression")),
        }
    }
    Ok(())
}

pub(super) fn validate_seed_discovery_authority(content: &SeedContent) -> Result<(), String> {
    for pack in &content.manifest.packs {
        if let Some(catalog) = parse_catalog(pack)? {
            validate_discovery_authority_catalog(&catalog, &pack.id)?;
        }
    }
    Ok(())
}
