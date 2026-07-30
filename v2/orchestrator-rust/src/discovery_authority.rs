// THR-D0 publishes the validated authority and receipt contract before the
// procedure/materialization consumers in #601/#602. Keep that staged API
// compiled in production without spending the repository's warning budget.
#![cfg_attr(not(test), allow(dead_code))]

use super::*;

pub(super) const DISCOVERY_AUTHORITY_SCHEMA_VERSION: u8 = 1;
pub(super) const DISCOVERY_RECEIPT_VERSION: &str = "discovery-receipt-v1";
const DISCOVERY_EXTENSION: &str = "x-cosyworld-discovery-slots";
const DISCOVERY_ROLL_DOMAIN: &str = "discovery-stock-row";
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryAuthorityCatalog {
    pub(super) schema_version: u8,
    pub(super) receipt_version: String,
    pub(super) roll_algorithm: String,
    pub(super) stocking_tables: Vec<DiscoveryStockingTable>,
    #[serde(default)]
    pub(super) event_tables: Vec<DiscoveryEventTable>,
    #[serde(default)]
    pub(super) presentation_tables: Vec<DiscoveryPresentationTable>,
    pub(super) slots: Vec<DiscoverySlotDefinition>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryStockingTable {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) target_kind: String,
    pub(super) eligible_inputs: Vec<String>,
    pub(super) rows: Vec<DiscoveryStockingRow>,
    pub(super) fallback_row_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryStockingRow {
    pub(super) id: String,
    pub(super) weight: u16,
    pub(super) result_ids: Vec<String>,
    #[serde(default)]
    pub(super) unique: bool,
    #[serde(default)]
    pub(super) topology_entity_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryEventTable {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) eligible_inputs: Vec<String>,
    pub(super) rows: Vec<DiscoveryEventRow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryEventRow {
    pub(super) id: String,
    pub(super) weight: u16,
    pub(super) effect_kind: String,
    pub(super) target_id: String,
    pub(super) amount: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryPresentationTable {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) rows: Vec<DiscoveryPresentationRow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryPresentationRow {
    pub(super) id: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoverySlotDefinition {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) target_kind: String,
    pub(super) origin_id: String,
    pub(super) scope: String,
    pub(super) initial_phase: String,
    pub(super) tells: Vec<DiscoveryTell>,
    pub(super) reveal_methods: Vec<String>,
    pub(super) claim_policy: String,
    pub(super) stocking: DiscoveryStockingBinding,
    #[serde(default)]
    pub(super) authorized_topology_ids: Vec<String>,
    #[serde(default)]
    pub(super) gate_id: Option<String>,
    #[serde(default)]
    pub(super) hazard_id: Option<String>,
    #[serde(default)]
    pub(super) event_table_id: Option<String>,
    #[serde(default)]
    pub(super) event_table_version: Option<u8>,
    #[serde(default)]
    pub(super) presentation_table_id: Option<String>,
    #[serde(default)]
    pub(super) presentation_table_version: Option<u8>,
    pub(super) progression: DiscoveryProgression,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryTell {
    pub(super) id: String,
    pub(super) sense: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryStockingBinding {
    pub(super) kind: String,
    #[serde(default)]
    pub(super) table_id: Option<String>,
    #[serde(default)]
    pub(super) table_version: Option<u8>,
    #[serde(default)]
    pub(super) result_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryProgression {
    pub(super) kind: String,
    #[serde(default)]
    pub(super) sign_budget: Option<u8>,
    #[serde(default)]
    pub(super) fallback_row_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum DiscoverySelectionMode {
    Weighted,
    RequiredFallback,
}

pub(super) struct DiscoveryReceiptRequest<'a> {
    pub(super) pack_id: &'a str,
    pub(super) pack_version: &'a str,
    pub(super) slot_id: &'a str,
    pub(super) scope_id: &'a str,
    pub(super) server_facts: BTreeMap<String, String>,
    pub(super) mode: DiscoverySelectionMode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryRollReceipt {
    pub(super) schema_version: u8,
    pub(super) receipt_version: String,
    pub(super) id: String,
    pub(super) claim_key: String,
    pub(super) slot_id: String,
    pub(super) slot_version: u8,
    pub(super) target_kind: String,
    pub(super) scope: String,
    pub(super) scope_id: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) table_id: Option<String>,
    pub(super) table_version: Option<u8>,
    pub(super) roll_algorithm: String,
    pub(super) eligible_input_facts: BTreeMap<String, String>,
    pub(super) seed_input: String,
    pub(super) roll_seed: u64,
    pub(super) selected_row_id: String,
    pub(super) materialized_entity_ids: Vec<String>,
    pub(super) fallback_decision: String,
}

fn parse_catalog(pack: &SeedWorldpackPack) -> Result<Option<DiscoveryAuthorityCatalog>, String> {
    let Some(value) = pack.extensions.get(DISCOVERY_EXTENSION).cloned() else {
        return Ok(None);
    };
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("pack {} discovery authority: {error}", pack.id))
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

fn receipt_claim_key(slot: &DiscoverySlotDefinition, scope_id: &str) -> String {
    format!(
        "discovery:{}@{}:{}:{}",
        slot.id, slot.version, slot.scope, scope_id
    )
}

fn canonical_seed_input(facts: &BTreeMap<String, String>) -> Result<String, String> {
    serde_json::to_string(facts).map_err(|error| format!("serialize discovery seed facts: {error}"))
}

fn validate_existing_receipt(receipt: &DiscoveryRollReceipt) -> Result<(), String> {
    if receipt.schema_version != DISCOVERY_AUTHORITY_SCHEMA_VERSION
        || receipt.receipt_version != DISCOVERY_RECEIPT_VERSION
        || receipt.roll_algorithm != WEIGHTED_FNV1A_V1
        || receipt.id.trim().is_empty()
        || receipt.claim_key.trim().is_empty()
        || receipt.slot_id.trim().is_empty()
        || receipt.slot_version == 0
        || receipt.pack_id.trim().is_empty()
        || receipt.pack_version.trim().is_empty()
        || receipt.selected_row_id.trim().is_empty()
        || receipt.materialized_entity_ids.is_empty()
    {
        return Err("discovery receipt uses an unknown version or is incomplete".to_string());
    }
    Ok(())
}

pub(super) fn freeze_discovery_receipt(
    catalog: &DiscoveryAuthorityCatalog,
    request: DiscoveryReceiptRequest<'_>,
    existing: Option<&DiscoveryRollReceipt>,
) -> Result<DiscoveryRollReceipt, String> {
    let DiscoveryReceiptRequest {
        pack_id,
        pack_version,
        slot_id,
        scope_id,
        mut server_facts,
        mode,
    } = request;
    if let Some(receipt) = existing {
        validate_existing_receipt(receipt)?;
        if receipt.slot_id != slot_id || receipt.scope_id != scope_id || receipt.pack_id != pack_id
        {
            return Err("discovery receipt does not match the requested claim".to_string());
        }
        return Ok(receipt.clone());
    }
    validate_discovery_authority_catalog(catalog, pack_id)?;
    let slot = catalog
        .slots
        .iter()
        .find(|slot| slot.id == slot_id)
        .ok_or_else(|| format!("unknown discovery slot {slot_id}"))?;
    if scope_id.trim().is_empty() || (slot.scope == "world" && scope_id != "world") {
        return Err("discovery claim scope id is invalid".to_string());
    }
    server_facts.insert("slot_id".to_string(), slot.id.clone());
    server_facts.insert("slot_version".to_string(), slot.version.to_string());
    server_facts.insert("origin_id".to_string(), slot.origin_id.clone());
    server_facts.insert("claim_scope_id".to_string(), scope_id.to_string());

    let table = slot.stocking.table_id.as_deref().and_then(|table_id| {
        catalog
            .stocking_tables
            .iter()
            .find(|table| table.id == table_id)
    });
    let fixed_inputs = [
        "worldpack_bundle_hash".to_string(),
        "slot_id".to_string(),
        "slot_version".to_string(),
        "origin_id".to_string(),
        "claim_scope_id".to_string(),
    ];
    let required_inputs = table
        .map(|table| table.eligible_inputs.as_slice())
        .unwrap_or(&fixed_inputs);
    if server_facts
        .keys()
        .any(|key| !required_inputs.contains(key) || !ELIGIBLE_INPUTS.contains(&key.as_str()))
        || required_inputs.iter().any(|key| {
            server_facts
                .get(key)
                .is_none_or(|value| value.trim().is_empty())
        })
    {
        return Err("discovery roll inputs must exactly match declared server facts".to_string());
    }
    let eligible_input_facts = required_inputs
        .iter()
        .map(|key| (key.clone(), server_facts[key].clone()))
        .collect::<BTreeMap<_, _>>();
    let seed_input = canonical_seed_input(&eligible_input_facts)?;
    let claim_key = receipt_claim_key(slot, scope_id);
    let roll_seed = stable_hash_u64(&[
        "discovery-stock",
        WEIGHTED_FNV1A_V1,
        pack_id,
        pack_version,
        &claim_key,
        &seed_input,
    ]);

    let (table_id, table_version, selected_row_id, materialized_entity_ids, fallback_decision) =
        if slot.stocking.kind == "fixed" {
            if mode == DiscoverySelectionMode::RequiredFallback {
                return Err("fixed discovery truth has no fallback roll".to_string());
            }
            (
                None,
                None,
                "fixed".to_string(),
                slot.stocking.result_ids.clone(),
                "fixed_outcome".to_string(),
            )
        } else {
            let table = table.ok_or_else(|| "discovery stocking table is missing".to_string())?;
            let selected = match mode {
                DiscoverySelectionMode::Weighted => {
                    let weights = table.rows.iter().map(|row| row.weight).collect::<Vec<_>>();
                    weighted_fnv1a_index(DISCOVERY_ROLL_DOMAIN, roll_seed, 0, &weights)
                        .and_then(|index| table.rows.get(index))
                        .ok_or_else(|| {
                            "discovery stocking table has no selectable row".to_string()
                        })?
                }
                DiscoverySelectionMode::RequiredFallback => {
                    if slot.progression.kind != "required" {
                        return Err(
                            "optional discovery cannot invoke the required fallback".to_string()
                        );
                    }
                    table
                        .rows
                        .iter()
                        .find(|row| row.id == table.fallback_row_id)
                        .ok_or_else(|| "discovery fallback row is missing".to_string())?
                }
            };
            (
                Some(table.id.clone()),
                Some(table.version),
                selected.id.clone(),
                selected.result_ids.clone(),
                match mode {
                    DiscoverySelectionMode::Weighted => "not_required",
                    DiscoverySelectionMode::RequiredFallback => "required_budget_exhausted",
                }
                .to_string(),
            )
        };
    let id = format!(
        "discovery-receipt:{:016x}",
        stable_hash_u64(&[
            DISCOVERY_RECEIPT_VERSION,
            &claim_key,
            &selected_row_id,
            &roll_seed.to_string(),
        ])
    );
    Ok(DiscoveryRollReceipt {
        schema_version: DISCOVERY_AUTHORITY_SCHEMA_VERSION,
        receipt_version: DISCOVERY_RECEIPT_VERSION.to_string(),
        id,
        claim_key,
        slot_id: slot.id.clone(),
        slot_version: slot.version,
        target_kind: slot.target_kind.clone(),
        scope: slot.scope.clone(),
        scope_id: scope_id.to_string(),
        pack_id: pack_id.to_string(),
        pack_version: pack_version.to_string(),
        table_id,
        table_version,
        roll_algorithm: WEIGHTED_FNV1A_V1.to_string(),
        eligible_input_facts,
        seed_input,
        roll_seed,
        selected_row_id,
        materialized_entity_ids,
        fallback_decision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> DiscoveryAuthorityCatalog {
        serde_json::from_str(include_str!("../fixtures/discovery-authority-v1.json"))
            .expect("discovery fixture")
    }

    fn facts() -> BTreeMap<String, String> {
        [
            ("world_seed", "world-17"),
            ("worldpack_bundle_hash", "sha256:fixture"),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
    }

    fn claim_receipt(
        catalog: &DiscoveryAuthorityCatalog,
        pack_version: &str,
        slot_id: &str,
        scope_id: &str,
        server_facts: BTreeMap<String, String>,
        mode: DiscoverySelectionMode,
        existing: Option<&DiscoveryRollReceipt>,
    ) -> Result<DiscoveryRollReceipt, String> {
        freeze_discovery_receipt(
            catalog,
            DiscoveryReceiptRequest {
                pack_id: "fixture.discovery",
                pack_version,
                slot_id,
                scope_id,
                server_facts,
                mode,
            },
            existing,
        )
    }

    #[test]
    fn fixture_covers_the_required_discovery_slot_kinds() {
        let catalog = fixture();
        validate_discovery_authority_catalog(&catalog, "fixture.discovery")
            .expect("valid discovery catalog");
        assert_eq!(
            catalog
                .slots
                .iter()
                .map(|slot| slot.target_kind.as_str())
                .collect::<Vec<_>>(),
            ["item", "feature", "resource", "location", "route"]
        );
    }

    #[test]
    fn stocking_receipt_is_stable_across_reconnect_replay_and_repeat_resolution() {
        let catalog = fixture();
        let first = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/chest-cache",
            "world",
            facts(),
            DiscoverySelectionMode::Weighted,
            None,
        )
        .expect("freeze receipt");
        let replayed: DiscoveryRollReceipt =
            serde_json::from_str(&serde_json::to_string(&first).expect("serialize receipt"))
                .expect("replay receipt");
        let repeated = claim_receipt(
            &catalog,
            "9.9.9",
            "fixture.discovery:discovery/chest-cache",
            "world",
            BTreeMap::new(),
            DiscoverySelectionMode::RequiredFallback,
            Some(&replayed),
        )
        .expect("existing receipt wins over changed execution context");
        assert_eq!(first, repeated);
        assert_eq!(first.roll_algorithm, WEIGHTED_FNV1A_V1);
        assert!(!first.materialized_entity_ids.is_empty());
    }

    #[test]
    fn input_order_controller_and_model_cannot_change_a_selection() {
        let catalog = fixture();
        let mut reversed = BTreeMap::new();
        reversed.insert(
            "worldpack_bundle_hash".to_string(),
            "sha256:fixture".to_string(),
        );
        reversed.insert("world_seed".to_string(), "world-17".to_string());
        let first = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/chest-cache",
            "world",
            facts(),
            DiscoverySelectionMode::Weighted,
            None,
        )
        .expect("first receipt");
        let second = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/chest-cache",
            "world",
            reversed,
            DiscoverySelectionMode::Weighted,
            None,
        )
        .expect("second receipt");
        assert_eq!(first, second);

        for forbidden in ["controller", "model_text", "client_state", "wall_clock"] {
            let mut tainted = facts();
            tainted.insert(forbidden.to_string(), "may-not-author-truth".to_string());
            let error = claim_receipt(
                &catalog,
                "1.0.0",
                "fixture.discovery:discovery/chest-cache",
                "world",
                tainted,
                DiscoverySelectionMode::Weighted,
                None,
            )
            .expect_err("privileged input rejected");
            assert!(error.contains("server facts"));
        }
    }

    #[test]
    fn required_discovery_has_a_finite_deterministic_fallback() {
        let catalog = fixture();
        let receipt = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/required-route-sign",
            "world",
            facts(),
            DiscoverySelectionMode::RequiredFallback,
            None,
        )
        .expect("required fallback");
        assert_eq!(receipt.selected_row_id, "ridge_route");
        assert_eq!(receipt.fallback_decision, "required_budget_exhausted");
        assert_eq!(
            receipt.materialized_entity_ids,
            ["fixture.discovery:route/ridge"]
        );
    }

    #[test]
    fn fixed_truth_receipt_does_not_reveal_or_expose_alternate_rows() {
        let catalog = fixture();
        let receipt = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/secret-door",
            "world",
            [("worldpack_bundle_hash", "sha256:fixture")]
                .into_iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
            DiscoverySelectionMode::Weighted,
            None,
        )
        .expect("fixed receipt");
        assert_eq!(receipt.selected_row_id, "fixed");
        assert_eq!(receipt.table_id, None);
        assert_eq!(
            receipt.materialized_entity_ids,
            ["fixture.discovery:feature/secret-door"]
        );
        let value = serde_json::to_value(receipt).expect("receipt JSON");
        assert!(value.get("initial_phase").is_none());
        assert!(value.get("rows").is_none());
    }

    #[test]
    fn invalid_versions_unbounded_fallbacks_duplicates_and_topology_fail_closed() {
        let mut catalog = fixture();
        catalog.schema_version = 2;
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());

        let mut catalog = fixture();
        catalog.stocking_tables[0]
            .eligible_inputs
            .push("model_text".to_string());
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());

        let mut malformed = serde_json::to_value(fixture()).expect("serialize discovery fixture");
        malformed["event_tables"][0]["rows"][0]["topology_entity_ids"] =
            serde_json::json!(["fixture.discovery:route/surprise"]);
        assert!(serde_json::from_value::<DiscoveryAuthorityCatalog>(malformed).is_err());

        let mut catalog = fixture();
        catalog.slots[0].stocking.table_version = Some(99);
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());

        let mut catalog = fixture();
        catalog
            .slots
            .last_mut()
            .expect("required slot")
            .progression
            .sign_budget = Some(0);
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());

        let mut catalog = fixture();
        catalog.stocking_tables[0].rows.push(DiscoveryStockingRow {
            id: "second_old_coin".to_string(),
            weight: 1,
            result_ids: vec!["fixture.discovery:item/old-coin".to_string()],
            unique: false,
            topology_entity_ids: Vec::new(),
        });
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());

        let mut catalog = fixture();
        catalog.stocking_tables[0].fallback_row_id = "old_coin".to_string();
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());

        let mut catalog = fixture();
        catalog.slots[3].authorized_topology_ids.clear();
        assert!(validate_discovery_authority_catalog(&catalog, "fixture.discovery").is_err());
    }

    #[test]
    fn unknown_receipt_versions_fail_new_execution() {
        let catalog = fixture();
        let mut receipt = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/chest-cache",
            "world",
            facts(),
            DiscoverySelectionMode::Weighted,
            None,
        )
        .expect("receipt");
        receipt.receipt_version = "future".to_string();
        assert!(claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/chest-cache",
            "world",
            facts(),
            DiscoverySelectionMode::Weighted,
            Some(&receipt),
        )
        .is_err());
    }

    #[test]
    fn a_receipt_cannot_be_reused_for_another_claim() {
        let catalog = fixture();
        let receipt = claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/chest-cache",
            "world",
            facts(),
            DiscoverySelectionMode::Weighted,
            None,
        )
        .expect("receipt");
        assert!(claim_receipt(
            &catalog,
            "1.0.0",
            "fixture.discovery:discovery/secret-door",
            "world",
            BTreeMap::new(),
            DiscoverySelectionMode::Weighted,
            Some(&receipt),
        )
        .is_err());
    }
}
