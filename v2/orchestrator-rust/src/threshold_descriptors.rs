// THR-1 publishes strict authored descriptors and replay receipts before the
// THR-2 kernel enforcement layer consumes them. Keep this staged API compiled
// without spending the repository's production warning budget.
#![cfg_attr(not(test), allow(dead_code))]

use super::*;

const THRESHOLD_EXTENSION: &str = "x-cosyworld-threshold-descriptors";
pub(super) const THRESHOLD_SCHEMA_VERSION: u8 = 1;
pub(super) const THRESHOLD_DESCRIPTOR_VERSION: &str = "threshold-descriptor-v1";
pub(super) const THRESHOLD_INTENT_VERSION: &str = "threshold-intent-v1";
const DISCOVERY_RECEIPT_VERSION: &str = "discovery-receipt-v1";

const LEAD_STATES: [&str; 7] = [
    "latent",
    "signed",
    "followable",
    "lost",
    "marked",
    "mapped",
    "resolved",
];
const LEGACY_LEAD_STATES: [&str; 6] = ["latent", "sign", "followable", "lost", "marked", "mapped"];
const SCOPES: [&str; 4] = ["actor", "expedition", "world", "holder"];
const TARGET_KINDS: [&str; 12] = [
    "actor", "item", "feature", "route", "location", "resource", "lore", "gate", "hazard",
    "pressure", "lead", "anchor",
];
const TRANSITIONS: [&str; 6] = ["open", "unlock", "cross", "unseal", "install", "consume"];
const RESET_POLICIES: [&str; 4] = ["never", "manual", "scene_end", "world_tick"];
const HAZARD_TRIGGERS: [&str; 5] = ["interact", "open", "cross", "search", "failed_method"];
const HAZARD_SEVERITIES: [&str; 3] = ["minor", "major", "severe"];
const ACCEPTED_FACTS: [&str; 5] = [
    "actor_id",
    "scope_id",
    "target_id",
    "method_id",
    "worldpack_bundle_hash",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdDescriptorCatalog {
    pub(super) schema_version: u8,
    pub(super) descriptor_version: String,
    pub(super) accepted_intent_version: String,
    pub(super) authoring_authority: String,
    pub(super) lead_state_migrations: BTreeMap<String, String>,
    #[serde(default)]
    pub(super) recoveries: Vec<ThresholdRecovery>,
    #[serde(default)]
    pub(super) anchors: Vec<ThresholdAnchor>,
    #[serde(default)]
    pub(super) leads: Vec<ThresholdLead>,
    #[serde(default)]
    pub(super) gates: Vec<ThresholdGate>,
    #[serde(default)]
    pub(super) hazards: Vec<ThresholdHazard>,
    #[serde(default)]
    pub(super) pressures: Vec<ThresholdPressure>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdTargetRef {
    pub(super) kind: String,
    pub(super) id: String,
    pub(super) version: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdSlotRef {
    pub(super) source_type: String,
    pub(super) allowed_result_type: String,
    pub(super) slot_id: String,
    pub(super) slot_version: u8,
    #[serde(default)]
    pub(super) table_id: Option<String>,
    #[serde(default)]
    pub(super) table_version: Option<u8>,
    pub(super) claim_policy: String,
    pub(super) receipt_version: String,
    pub(super) receipt_ref: String,
    pub(super) finite_budget: u8,
    pub(super) fallback: String,
    #[serde(default)]
    pub(super) materialized_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ThresholdPredicate {
    ExactItem { item_id: String },
    ItemCapability { capability: String },
    InstalledItem { item_id: String, target_id: String },
    MinimumCharges { item_id: String, amount: u8 },
    ActorTag { tag_id: String },
    ClockStatus { clock_id: String, status: String },
    JobStatus { job_id: String, status: String },
    MinimumStanding { faction_id: String, level: u8 },
    BondState { actor_id: String, state: String },
    AccessGrant { grant_id: String },
    PerActorClaim { claim_id: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdRequirements {
    pub(super) mode: String,
    #[serde(default)]
    pub(super) clauses: Vec<ThresholdPredicate>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ThresholdEffect {
    SetGateState {
        target_id: String,
        state: String,
    },
    ConsumeItemCharge {
        target_id: String,
        amount: u8,
    },
    ConsumeItem {
        target_id: String,
    },
    SetHazardState {
        target_id: String,
        state: String,
    },
    AdvanceClock {
        target_id: String,
        amount: u8,
    },
    SetLeadState {
        target_id: String,
        state: String,
    },
    SetAnchorState {
        target_id: String,
        state: String,
    },
    AdvancePressure {
        target_id: String,
        track: String,
        amount: u8,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdMethod {
    pub(super) id: String,
    pub(super) action: String,
    pub(super) requirements: ThresholdRequirements,
    pub(super) success_effects: Vec<ThresholdEffect>,
    #[serde(default)]
    pub(super) failure_effects: Vec<ThresholdEffect>,
    #[serde(default)]
    pub(super) recovery_ref: Option<String>,
    #[serde(default)]
    pub(super) recovery_version: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdReset {
    pub(super) policy: String,
    #[serde(default)]
    pub(super) after_turns: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdRecovery {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) effects: Vec<ThresholdEffect>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdAnchor {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) location_ref: ThresholdTargetRef,
    pub(super) state: String,
    #[serde(default)]
    pub(super) return_chain: Vec<ThresholdTargetRef>,
    #[serde(default)]
    pub(super) branch_authorization: Vec<ThresholdTargetRef>,
    pub(super) durable_mark_state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdLeadTransition {
    pub(super) from: String,
    pub(super) to: String,
    pub(super) method: String,
    pub(super) effects: Vec<ThresholdEffect>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdLead {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) source_ref: ThresholdTargetRef,
    pub(super) target_ref: ThresholdTargetRef,
    pub(super) scope: String,
    pub(super) initial_state: String,
    pub(super) state_path: Vec<String>,
    pub(super) anchor_id: String,
    pub(super) anchor_version: u8,
    pub(super) slot: ThresholdSlotRef,
    pub(super) transitions: Vec<ThresholdLeadTransition>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdGate {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) target_ref: ThresholdTargetRef,
    pub(super) scope: String,
    pub(super) transition: String,
    pub(super) persistence: String,
    pub(super) closed_requirements: ThresholdRequirements,
    pub(super) methods: Vec<ThresholdMethod>,
    pub(super) reset: ThresholdReset,
    #[serde(default)]
    pub(super) slot: Option<ThresholdSlotRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdHazard {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) target_ref: ThresholdTargetRef,
    pub(super) scope: String,
    pub(super) tells: Vec<String>,
    pub(super) triggers: Vec<String>,
    pub(super) severity: String,
    pub(super) methods: Vec<ThresholdMethod>,
    #[serde(default)]
    pub(super) bypasses: Vec<ThresholdMethod>,
    pub(super) consequences: Vec<ThresholdEffect>,
    pub(super) reset: ThresholdReset,
    #[serde(default)]
    pub(super) slot: Option<ThresholdSlotRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdClockTrack {
    pub(super) clock_id: String,
    pub(super) question: String,
    pub(super) maximum: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdPressureStrategy {
    pub(super) id: String,
    pub(super) turn_cost: u8,
    pub(super) requirements: ThresholdRequirements,
    pub(super) success_effects: Vec<ThresholdEffect>,
    pub(super) soft_consequences: Vec<ThresholdEffect>,
    pub(super) hard_consequences: Vec<ThresholdEffect>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdPressure {
    pub(super) id: String,
    pub(super) version: u8,
    pub(super) participant_refs: Vec<ThresholdTargetRef>,
    pub(super) progress: ThresholdClockTrack,
    pub(super) danger: ThresholdClockTrack,
    pub(super) terminal_states: Vec<String>,
    pub(super) strategies: Vec<ThresholdPressureStrategy>,
    pub(super) slot: ThresholdSlotRef,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct AcceptedThresholdIntent {
    pub(super) schema_version: u8,
    pub(super) intent_version: String,
    pub(super) id: String,
    pub(super) descriptor_kind: String,
    pub(super) descriptor_id: String,
    pub(super) descriptor_version: u8,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) pack_integrity: String,
    pub(super) actor_id: u64,
    pub(super) scope: String,
    pub(super) scope_id: String,
    pub(super) selected_method: String,
    pub(super) target: ThresholdTargetRef,
    pub(super) accepted_turn: u64,
    pub(super) requirement_facts: BTreeMap<String, String>,
    pub(super) discovery_receipt_refs: Vec<String>,
    pub(super) materialized_entity_ids: Vec<String>,
}

pub(super) struct ThresholdIntentRequest<'a> {
    pub(super) descriptor_kind: &'a str,
    pub(super) descriptor_id: &'a str,
    pub(super) descriptor_version: u8,
    pub(super) pack_id: &'a str,
    pub(super) pack_version: &'a str,
    pub(super) pack_integrity: &'a str,
    pub(super) actor_id: u64,
    pub(super) scope_id: &'a str,
    pub(super) selected_method: &'a str,
    pub(super) accepted_turn: u64,
    pub(super) requirement_facts: BTreeMap<String, String>,
    pub(super) discovery_receipt_refs: Vec<String>,
    pub(super) materialized_entity_ids: Vec<String>,
}

fn parse_catalog(pack: &SeedWorldpackPack) -> Result<Option<ThresholdDescriptorCatalog>, String> {
    let Some(value) = pack.extensions.get(THRESHOLD_EXTENSION).cloned() else {
        return Ok(None);
    };
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("pack {} threshold descriptors: {error}", pack.id))
}

fn valid_local_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && (2..=64).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn valid_token(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum
}

fn valid_canonical_id(value: &str, pack_id: &str, kind: Option<&str>) -> bool {
    let Some((owner, path)) = value.split_once(':') else {
        return false;
    };
    if owner != pack_id
        || owner.is_empty()
        || !owner.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || ".-".contains(character)
        })
    {
        return false;
    }
    let Some((actual_kind, name)) = path.split_once('/') else {
        return false;
    };
    kind.is_none_or(|expected| actual_kind == expected)
        && !actual_kind.is_empty()
        && actual_kind
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && actual_kind.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && !name.is_empty()
        && name.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || ".-_/".contains(character)
        })
}

fn validate_target(
    target: &ThresholdTargetRef,
    pack_id: &str,
    expected_kind: Option<&str>,
    label: &str,
) -> Result<(), String> {
    if target.version == 0
        || !TARGET_KINDS.contains(&target.kind.as_str())
        || expected_kind.is_some_and(|kind| target.kind != kind)
        || !valid_canonical_id(&target.id, pack_id, Some(&target.kind))
    {
        return Err(format!(
            "{label} must be a pack-owned, typed, versioned target"
        ));
    }
    Ok(())
}

impl ThresholdPredicate {
    fn validate(&self, pack_id: &str, label: &str) -> Result<(), String> {
        let valid_id = |id: &str| valid_canonical_id(id, pack_id, None);
        match self {
            Self::ExactItem { item_id } if valid_id(item_id) => Ok(()),
            Self::ItemCapability { capability } if valid_token(capability, 64) => Ok(()),
            Self::InstalledItem { item_id, target_id }
                if valid_id(item_id) && valid_id(target_id) =>
            {
                Ok(())
            }
            Self::MinimumCharges { item_id, amount } if valid_id(item_id) && *amount > 0 => Ok(()),
            Self::ActorTag { tag_id } if valid_id(tag_id) => Ok(()),
            Self::ClockStatus { clock_id, status }
                if valid_id(clock_id) && valid_token(status, 32) =>
            {
                Ok(())
            }
            Self::JobStatus { job_id, status } if valid_id(job_id) && valid_token(status, 32) => {
                Ok(())
            }
            Self::MinimumStanding { faction_id, level } if valid_id(faction_id) && *level > 0 => {
                Ok(())
            }
            Self::BondState { actor_id, state } if valid_id(actor_id) && valid_token(state, 32) => {
                Ok(())
            }
            Self::AccessGrant { grant_id } if valid_id(grant_id) => Ok(()),
            Self::PerActorClaim { claim_id } if valid_id(claim_id) => Ok(()),
            _ => Err(format!("{label} has an invalid closed predicate")),
        }
    }

    fn referenced_ids(&self) -> Vec<&str> {
        match self {
            Self::ExactItem { item_id } | Self::MinimumCharges { item_id, .. } => vec![item_id],
            Self::InstalledItem { item_id, target_id } => vec![item_id, target_id],
            Self::ActorTag { tag_id } => vec![tag_id],
            Self::ClockStatus { clock_id, .. } => vec![clock_id],
            Self::JobStatus { job_id, .. } => vec![job_id],
            Self::MinimumStanding { faction_id, .. } => vec![faction_id],
            Self::BondState { actor_id, .. } => vec![actor_id],
            Self::AccessGrant { grant_id } => vec![grant_id],
            Self::PerActorClaim { claim_id } => vec![claim_id],
            Self::ItemCapability { .. } => Vec::new(),
        }
    }
}

impl ThresholdEffect {
    fn target_id(&self) -> &str {
        match self {
            Self::SetGateState { target_id, .. }
            | Self::ConsumeItemCharge { target_id, .. }
            | Self::ConsumeItem { target_id }
            | Self::SetHazardState { target_id, .. }
            | Self::AdvanceClock { target_id, .. }
            | Self::SetLeadState { target_id, .. }
            | Self::SetAnchorState { target_id, .. }
            | Self::AdvancePressure { target_id, .. } => target_id,
        }
    }

    fn validate(
        &self,
        pack_id: &str,
        known_ids: &BTreeSet<&str>,
        label: &str,
    ) -> Result<(), String> {
        if !valid_canonical_id(self.target_id(), pack_id, None)
            || !known_ids.contains(self.target_id())
        {
            return Err(format!("{label} references an unknown effect target"));
        }
        match self {
            Self::SetGateState { state, .. }
            | Self::SetHazardState { state, .. }
            | Self::SetLeadState { state, .. }
            | Self::SetAnchorState { state, .. }
                if !valid_token(state, 32) =>
            {
                Err(format!("{label} has an invalid state"))
            }
            Self::ConsumeItemCharge { amount, .. } | Self::AdvanceClock { amount, .. }
                if *amount == 0 =>
            {
                Err(format!("{label} has an invalid amount"))
            }
            Self::AdvancePressure { track, amount, .. }
                if !["progress", "danger"].contains(&track.as_str()) || *amount == 0 =>
            {
                Err(format!("{label} has an invalid pressure effect"))
            }
            _ => Ok(()),
        }
    }
}

fn validate_requirements(
    requirements: &ThresholdRequirements,
    pack_id: &str,
    label: &str,
) -> Result<(), String> {
    if requirements.mode != "all" || requirements.clauses.len() > 8 {
        return Err(format!(
            "{label} must use a bounded, flat, non-recursive all predicate"
        ));
    }
    for predicate in &requirements.clauses {
        predicate.validate(pack_id, label)?;
    }
    Ok(())
}

fn validate_effects(
    effects: &[ThresholdEffect],
    pack_id: &str,
    known_ids: &BTreeSet<&str>,
    label: &str,
) -> Result<(), String> {
    if effects.is_empty() || effects.len() > 8 {
        return Err(format!("{label} must contain 1-8 typed effects"));
    }
    for effect in effects {
        effect.validate(pack_id, known_ids, label)?;
    }
    Ok(())
}

fn validate_slot(
    slot: &ThresholdSlotRef,
    owner_kind: &str,
    pack_id: &str,
    discovery_slots: &discovery_authority::DiscoverySlotContracts,
    label: &str,
) -> Result<(), String> {
    let expected = discovery_slots.get(&slot.slot_id);
    if slot.source_type != owner_kind
        || expected.is_none_or(|contract| {
            contract.version != slot.slot_version
                || contract.target_kind != slot.allowed_result_type
                || contract.claim_policy != slot.claim_policy
                || contract.table_id != slot.table_id
                || contract.table_version != slot.table_version
        })
        || slot.claim_policy != "once_per_scope"
        || slot.receipt_version != DISCOVERY_RECEIPT_VERSION
        || !valid_canonical_id(&slot.receipt_ref, pack_id, Some("receipt"))
        || slot.finite_budget == 0
        || !["deny", "retain_state", "required_result"].contains(&slot.fallback.as_str())
        || slot.materialized_ids.len() > 8
        || slot
            .materialized_ids
            .iter()
            .any(|id| !valid_canonical_id(id, pack_id, None))
    {
        return Err(format!(
            "{label} must reference a compatible exact-version Discovery Slot and bounded claim"
        ));
    }
    Ok(())
}

fn validate_reset(reset: &ThresholdReset, label: &str) -> Result<(), String> {
    if !RESET_POLICIES.contains(&reset.policy.as_str())
        || (reset.policy == "world_tick") != reset.after_turns.is_some()
        || reset.after_turns == Some(0)
    {
        return Err(format!("{label} has an invalid reset policy"));
    }
    Ok(())
}

fn validate_method(
    method: &ThresholdMethod,
    pack_id: &str,
    known_ids: &BTreeSet<&str>,
    recoveries: &BTreeMap<&str, u8>,
    label: &str,
) -> Result<(), String> {
    if !valid_local_id(&method.id) || !valid_token(&method.action, 64) {
        return Err(format!("{label} has an invalid method"));
    }
    validate_requirements(&method.requirements, pack_id, label)?;
    validate_effects(&method.success_effects, pack_id, known_ids, label)?;
    if !method.failure_effects.is_empty() {
        validate_effects(&method.failure_effects, pack_id, known_ids, label)?;
    }
    match (&method.recovery_ref, method.recovery_version) {
        (None, None) => {}
        (Some(id), Some(version))
            if recoveries
                .get(id.as_str())
                .is_some_and(|actual| *actual == version) => {}
        _ => {
            return Err(format!(
                "{label} has an unknown recovery reference or version"
            ))
        }
    }
    Ok(())
}

fn collect_known_ids(catalog: &ThresholdDescriptorCatalog) -> BTreeSet<&str> {
    let mut ids = BTreeSet::new();
    for recovery in &catalog.recoveries {
        ids.insert(recovery.id.as_str());
    }
    for anchor in &catalog.anchors {
        ids.insert(anchor.id.as_str());
        ids.insert(anchor.location_ref.id.as_str());
        ids.extend(anchor.return_chain.iter().map(|target| target.id.as_str()));
        ids.extend(
            anchor
                .branch_authorization
                .iter()
                .map(|target| target.id.as_str()),
        );
    }
    for lead in &catalog.leads {
        ids.insert(lead.id.as_str());
        ids.insert(lead.source_ref.id.as_str());
        ids.insert(lead.target_ref.id.as_str());
        ids.extend(lead.slot.materialized_ids.iter().map(String::as_str));
    }
    for gate in &catalog.gates {
        ids.insert(gate.id.as_str());
        ids.insert(gate.target_ref.id.as_str());
        for predicate in gate
            .methods
            .iter()
            .flat_map(|method| &method.requirements.clauses)
            .chain(&gate.closed_requirements.clauses)
        {
            ids.extend(predicate.referenced_ids());
        }
        if let Some(slot) = &gate.slot {
            ids.extend(slot.materialized_ids.iter().map(String::as_str));
        }
    }
    for hazard in &catalog.hazards {
        ids.insert(hazard.id.as_str());
        ids.insert(hazard.target_ref.id.as_str());
        for predicate in hazard
            .methods
            .iter()
            .chain(&hazard.bypasses)
            .flat_map(|method| &method.requirements.clauses)
        {
            ids.extend(predicate.referenced_ids());
        }
        if let Some(slot) = &hazard.slot {
            ids.extend(slot.materialized_ids.iter().map(String::as_str));
        }
    }
    for pressure in &catalog.pressures {
        ids.insert(pressure.id.as_str());
        ids.insert(pressure.progress.clock_id.as_str());
        ids.insert(pressure.danger.clock_id.as_str());
        ids.extend(
            pressure
                .participant_refs
                .iter()
                .map(|target| target.id.as_str()),
        );
        ids.extend(pressure.slot.materialized_ids.iter().map(String::as_str));
        for predicate in pressure
            .strategies
            .iter()
            .flat_map(|strategy| &strategy.requirements.clauses)
        {
            ids.extend(predicate.referenced_ids());
        }
    }
    ids
}

pub(super) fn validate_threshold_descriptor_catalog(
    catalog: &ThresholdDescriptorCatalog,
    pack_id: &str,
    discovery_slots: &discovery_authority::DiscoverySlotContracts,
) -> Result<(), String> {
    if catalog.schema_version != THRESHOLD_SCHEMA_VERSION
        || catalog.descriptor_version != THRESHOLD_DESCRIPTOR_VERSION
        || catalog.accepted_intent_version != THRESHOLD_INTENT_VERSION
        || catalog.authoring_authority != "authored_pack"
    {
        return Err(
            "threshold descriptor versions or authoring authority are unsupported".to_string(),
        );
    }
    if catalog.lead_state_migrations.len() != LEGACY_LEAD_STATES.len()
        || LEGACY_LEAD_STATES.iter().any(|state| {
            catalog
                .lead_state_migrations
                .get(*state)
                .is_none_or(|mapped| !LEAD_STATES.contains(&mapped.as_str()))
        })
    {
        return Err("threshold descriptor legacy lead-state migration is incomplete".to_string());
    }

    let known_ids = collect_known_ids(catalog);
    let mut descriptor_ids = BTreeSet::new();
    let mut recoveries = BTreeMap::new();
    for recovery in &catalog.recoveries {
        if recovery.version == 0
            || !valid_canonical_id(&recovery.id, pack_id, Some("recovery"))
            || !descriptor_ids.insert(recovery.id.as_str())
        {
            return Err(format!("invalid threshold recovery {}", recovery.id));
        }
        recoveries.insert(recovery.id.as_str(), recovery.version);
        validate_effects(&recovery.effects, pack_id, &known_ids, &recovery.id)?;
    }
    if catalog.recoveries.len() > 32
        || catalog.anchors.len() > 128
        || catalog.leads.len() > 128
        || catalog.gates.len() > 128
        || catalog.hazards.len() > 128
        || catalog.pressures.len() > 64
    {
        return Err("threshold descriptor catalog exceeds a finite collection bound".to_string());
    }

    let mut anchors = BTreeMap::new();
    for anchor in &catalog.anchors {
        if anchor.version == 0
            || !valid_canonical_id(&anchor.id, pack_id, Some("anchor"))
            || !descriptor_ids.insert(anchor.id.as_str())
            || !["provisional", "marked", "mapped"].contains(&anchor.state.as_str())
            || !["marked", "mapped"].contains(&anchor.durable_mark_state.as_str())
            || anchor.return_chain.len() > 16
            || anchor.branch_authorization.len() > 16
        {
            return Err(format!("invalid threshold anchor {}", anchor.id));
        }
        validate_target(&anchor.location_ref, pack_id, Some("location"), &anchor.id)?;
        for route in anchor
            .return_chain
            .iter()
            .chain(&anchor.branch_authorization)
        {
            validate_target(route, pack_id, Some("route"), &anchor.id)?;
        }
        anchors.insert(anchor.id.as_str(), anchor.version);
    }

    for lead in &catalog.leads {
        if lead.version == 0
            || !valid_canonical_id(&lead.id, pack_id, Some("lead"))
            || !descriptor_ids.insert(lead.id.as_str())
            || !["actor", "expedition", "world"].contains(&lead.scope.as_str())
            || !LEAD_STATES.contains(&lead.initial_state.as_str())
            || !(2..=7).contains(&lead.state_path.len())
            || lead.state_path.first() != Some(&lead.initial_state)
            || lead
                .state_path
                .iter()
                .any(|state| !LEAD_STATES.contains(&state.as_str()))
            || lead.state_path.iter().collect::<BTreeSet<_>>().len() != lead.state_path.len()
            || anchors
                .get(lead.anchor_id.as_str())
                .is_none_or(|version| *version != lead.anchor_version)
            || !(1..=8).contains(&lead.transitions.len())
        {
            return Err(format!("invalid threshold lead {}", lead.id));
        }
        validate_target(&lead.source_ref, pack_id, None, &lead.id)?;
        validate_target(&lead.target_ref, pack_id, None, &lead.id)?;
        validate_slot(&lead.slot, "lead", pack_id, discovery_slots, &lead.id)?;
        for transition in &lead.transitions {
            if !LEAD_STATES.contains(&transition.from.as_str())
                || !LEAD_STATES.contains(&transition.to.as_str())
                || !valid_token(&transition.method, 64)
            {
                return Err(format!("lead {} has an invalid state transition", lead.id));
            }
            validate_effects(&transition.effects, pack_id, &known_ids, &lead.id)?;
        }
    }

    for gate in &catalog.gates {
        if gate.version == 0
            || !valid_canonical_id(&gate.id, pack_id, Some("gate"))
            || !descriptor_ids.insert(gate.id.as_str())
            || !SCOPES.contains(&gate.scope.as_str())
            || !TRANSITIONS.contains(&gate.transition.as_str())
            || !["persistent", "resettable"].contains(&gate.persistence.as_str())
            || !(1..=8).contains(&gate.methods.len())
        {
            return Err(format!("invalid threshold gate {}", gate.id));
        }
        validate_target(&gate.target_ref, pack_id, None, &gate.id)?;
        validate_requirements(&gate.closed_requirements, pack_id, &gate.id)?;
        validate_reset(&gate.reset, &gate.id)?;
        if let Some(slot) = &gate.slot {
            validate_slot(slot, "gate", pack_id, discovery_slots, &gate.id)?;
        }
        for method in &gate.methods {
            validate_method(method, pack_id, &known_ids, &recoveries, &gate.id)?;
        }
    }

    for hazard in &catalog.hazards {
        if hazard.version == 0
            || !valid_canonical_id(&hazard.id, pack_id, Some("hazard"))
            || !descriptor_ids.insert(hazard.id.as_str())
            || !SCOPES.contains(&hazard.scope.as_str())
            || !(1..=8).contains(&hazard.tells.len())
            || hazard.tells.iter().any(|tell| !valid_token(tell, 512))
            || hazard.triggers.is_empty()
            || hazard.triggers.len() > 8
            || hazard
                .triggers
                .iter()
                .any(|trigger| !HAZARD_TRIGGERS.contains(&trigger.as_str()))
            || !HAZARD_SEVERITIES.contains(&hazard.severity.as_str())
            || !(1..=8).contains(&hazard.methods.len())
            || hazard.bypasses.len() > 8
        {
            return Err(format!("invalid threshold hazard {}", hazard.id));
        }
        validate_target(&hazard.target_ref, pack_id, None, &hazard.id)?;
        validate_reset(&hazard.reset, &hazard.id)?;
        validate_effects(&hazard.consequences, pack_id, &known_ids, &hazard.id)?;
        if let Some(slot) = &hazard.slot {
            validate_slot(slot, "hazard", pack_id, discovery_slots, &hazard.id)?;
        }
        for method in hazard.methods.iter().chain(&hazard.bypasses) {
            validate_method(method, pack_id, &known_ids, &recoveries, &hazard.id)?;
        }
    }

    for pressure in &catalog.pressures {
        if pressure.version == 0
            || !valid_canonical_id(&pressure.id, pack_id, Some("pressure"))
            || !descriptor_ids.insert(pressure.id.as_str())
            || !(1..=16).contains(&pressure.participant_refs.len())
            || pressure.progress.maximum == 0
            || pressure.progress.maximum > 32
            || pressure.danger.maximum == 0
            || pressure.danger.maximum > 32
            || !valid_canonical_id(&pressure.progress.clock_id, pack_id, Some("clock"))
            || !valid_canonical_id(&pressure.danger.clock_id, pack_id, Some("clock"))
            || !valid_token(&pressure.progress.question, 256)
            || !valid_token(&pressure.danger.question, 256)
            || !(2..=8).contains(&pressure.terminal_states.len())
            || pressure
                .terminal_states
                .iter()
                .any(|state| !valid_token(state, 32))
            || pressure
                .terminal_states
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                != pressure.terminal_states.len()
            || !(1..=8).contains(&pressure.strategies.len())
        {
            return Err(format!("invalid threshold pressure {}", pressure.id));
        }
        for participant in &pressure.participant_refs {
            validate_target(participant, pack_id, None, &pressure.id)?;
        }
        validate_slot(
            &pressure.slot,
            "pressure",
            pack_id,
            discovery_slots,
            &pressure.id,
        )?;
        for strategy in &pressure.strategies {
            if !valid_local_id(&strategy.id) || !(1..=16).contains(&strategy.turn_cost) {
                return Err(format!("pressure {} has an invalid strategy", pressure.id));
            }
            validate_requirements(&strategy.requirements, pack_id, &pressure.id)?;
            validate_effects(&strategy.success_effects, pack_id, &known_ids, &pressure.id)?;
            validate_effects(
                &strategy.soft_consequences,
                pack_id,
                &known_ids,
                &pressure.id,
            )?;
            validate_effects(
                &strategy.hard_consequences,
                pack_id,
                &known_ids,
                &pressure.id,
            )?;
        }
    }
    Ok(())
}

pub(super) fn validate_seed_threshold_descriptors(content: &SeedContent) -> Result<(), String> {
    for pack in &content.manifest.packs {
        if let Some(catalog) = parse_catalog(pack)? {
            let discovery_slots = discovery_authority::discovery_slot_contracts(pack)?;
            validate_threshold_descriptor_catalog(&catalog, &pack.id, &discovery_slots)?;
        }
    }
    Ok(())
}

fn descriptor_contract<'a>(
    catalog: &'a ThresholdDescriptorCatalog,
    kind: &str,
    id: &str,
) -> Option<(u8, &'a str, &'a ThresholdTargetRef, Vec<&'a str>)> {
    match kind {
        "lead" => catalog
            .leads
            .iter()
            .find(|value| value.id == id)
            .map(|value| {
                (
                    value.version,
                    value.scope.as_str(),
                    &value.target_ref,
                    value
                        .transitions
                        .iter()
                        .map(|transition| transition.method.as_str())
                        .collect(),
                )
            }),
        "gate" => catalog
            .gates
            .iter()
            .find(|value| value.id == id)
            .map(|value| {
                (
                    value.version,
                    value.scope.as_str(),
                    &value.target_ref,
                    value
                        .methods
                        .iter()
                        .map(|method| method.id.as_str())
                        .collect(),
                )
            }),
        "hazard" => catalog
            .hazards
            .iter()
            .find(|value| value.id == id)
            .map(|value| {
                (
                    value.version,
                    value.scope.as_str(),
                    &value.target_ref,
                    value
                        .methods
                        .iter()
                        .chain(&value.bypasses)
                        .map(|method| method.id.as_str())
                        .collect(),
                )
            }),
        "pressure" => catalog
            .pressures
            .iter()
            .find(|value| value.id == id)
            .and_then(|value| {
                value.participant_refs.first().map(|target| {
                    (
                        value.version,
                        "expedition",
                        target,
                        value
                            .strategies
                            .iter()
                            .map(|strategy| strategy.id.as_str())
                            .collect(),
                    )
                })
            }),
        _ => None,
    }
}

fn validate_existing_intent(intent: &AcceptedThresholdIntent) -> Result<(), String> {
    if intent.schema_version != THRESHOLD_SCHEMA_VERSION
        || intent.intent_version != THRESHOLD_INTENT_VERSION
        || intent.id.trim().is_empty()
        || intent.descriptor_version == 0
        || intent.pack_id.trim().is_empty()
        || intent.pack_version.trim().is_empty()
        || intent.pack_integrity.trim().is_empty()
        || intent.actor_id == 0
        || intent.scope_id.trim().is_empty()
        || intent.selected_method.trim().is_empty()
        || intent
            .requirement_facts
            .keys()
            .any(|key| !ACCEPTED_FACTS.contains(&key.as_str()))
    {
        return Err(
            "accepted threshold intent uses an unknown version or is incomplete".to_string(),
        );
    }
    Ok(())
}

pub(super) fn freeze_threshold_intent(
    catalog: &ThresholdDescriptorCatalog,
    request: ThresholdIntentRequest<'_>,
    existing: Option<&AcceptedThresholdIntent>,
) -> Result<AcceptedThresholdIntent, String> {
    if let Some(intent) = existing {
        validate_existing_intent(intent)?;
        if intent.descriptor_kind != request.descriptor_kind
            || intent.descriptor_id != request.descriptor_id
            || intent.actor_id != request.actor_id
            || intent.scope_id != request.scope_id
        {
            return Err("accepted threshold intent does not match the requested claim".to_string());
        }
        return Ok(intent.clone());
    }
    let Some((version, scope, target, methods)) =
        descriptor_contract(catalog, request.descriptor_kind, request.descriptor_id)
    else {
        return Err("unknown threshold descriptor".to_string());
    };
    if version != request.descriptor_version
        || !methods.contains(&request.selected_method)
        || request.actor_id == 0
        || request.scope_id.trim().is_empty()
        || request.pack_id.trim().is_empty()
        || request.pack_version.trim().is_empty()
        || request.pack_integrity.trim().is_empty()
        || request
            .requirement_facts
            .keys()
            .any(|key| !ACCEPTED_FACTS.contains(&key.as_str()))
        || request
            .discovery_receipt_refs
            .iter()
            .any(|id| !valid_canonical_id(id, request.pack_id, Some("receipt")))
        || request
            .materialized_entity_ids
            .iter()
            .any(|id| !valid_canonical_id(id, request.pack_id, None))
    {
        return Err("threshold intent does not match the authored descriptor".to_string());
    }
    Ok(AcceptedThresholdIntent {
        schema_version: THRESHOLD_SCHEMA_VERSION,
        intent_version: THRESHOLD_INTENT_VERSION.to_string(),
        id: format!(
            "threshold-intent:{}@{}:{}:{}",
            request.descriptor_id, version, request.actor_id, request.accepted_turn
        ),
        descriptor_kind: request.descriptor_kind.to_string(),
        descriptor_id: request.descriptor_id.to_string(),
        descriptor_version: version,
        pack_id: request.pack_id.to_string(),
        pack_version: request.pack_version.to_string(),
        pack_integrity: request.pack_integrity.to_string(),
        actor_id: request.actor_id,
        scope: scope.to_string(),
        scope_id: request.scope_id.to_string(),
        selected_method: request.selected_method.to_string(),
        target: target.clone(),
        accepted_turn: request.accepted_turn,
        requirement_facts: request.requirement_facts,
        discovery_receipt_refs: request.discovery_receipt_refs,
        materialized_entity_ids: request.materialized_entity_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        pack_id: String,
        pack_version: String,
        discovery: serde_json::Value,
        thresholds: ThresholdDescriptorCatalog,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../fixtures/threshold-descriptors-v1.json"))
            .expect("threshold descriptor fixture")
    }

    fn discovery_slots(fixture: &Fixture) -> discovery_authority::DiscoverySlotContracts {
        fixture.discovery["slots"]
            .as_array()
            .expect("discovery slots")
            .iter()
            .map(|slot| {
                (
                    slot["id"].as_str().expect("slot id").to_string(),
                    discovery_authority::DiscoverySlotContract {
                        version: slot["version"].as_u64().expect("slot version") as u8,
                        target_kind: slot["target_kind"]
                            .as_str()
                            .expect("target kind")
                            .to_string(),
                        claim_policy: slot["claim_policy"]
                            .as_str()
                            .expect("claim policy")
                            .to_string(),
                        table_id: slot["stocking"]["table_id"].as_str().map(str::to_string),
                        table_version: slot["stocking"]["table_version"]
                            .as_u64()
                            .map(|value| value as u8),
                    },
                )
            })
            .collect()
    }

    fn request<'a>(fixture: &'a Fixture) -> ThresholdIntentRequest<'a> {
        ThresholdIntentRequest {
            descriptor_kind: "gate",
            descriptor_id: "fixture.discovery:gate/archive-door",
            descriptor_version: 1,
            pack_id: &fixture.pack_id,
            pack_version: &fixture.pack_version,
            pack_integrity: "sha256:fixture",
            actor_id: 7,
            scope_id: "world",
            selected_method: "use_retained_key",
            accepted_turn: 41,
            requirement_facts: [
                ("actor_id".to_string(), "7".to_string()),
                (
                    "worldpack_bundle_hash".to_string(),
                    "sha256:bundle".to_string(),
                ),
            ]
            .into_iter()
            .collect(),
            discovery_receipt_refs: vec!["fixture.discovery:receipt/archive-door".to_string()],
            materialized_entity_ids: vec!["fixture.discovery:feature/secret-door".to_string()],
        }
    }

    #[test]
    fn fixture_covers_shared_threshold_primitives_and_examples() {
        let fixture = fixture();
        validate_threshold_descriptor_catalog(
            &fixture.thresholds,
            &fixture.pack_id,
            &discovery_slots(&fixture),
        )
        .expect("valid threshold catalog");
        assert_eq!(fixture.thresholds.gates.len(), 4);
        assert_eq!(fixture.thresholds.hazards[0].bypasses.len(), 1);
        assert_eq!(fixture.thresholds.pressures[0].progress.maximum, 6);
        assert_eq!(
            fixture.thresholds.leads[0].transitions[1].method,
            "build_cairn"
        );
    }

    #[test]
    fn accepted_intent_replays_after_content_changes() {
        let mut fixture = fixture();
        let first = freeze_threshold_intent(&fixture.thresholds, request(&fixture), None)
            .expect("freeze intent");
        let replayed: AcceptedThresholdIntent =
            serde_json::from_str(&serde_json::to_string(&first).expect("serialize intent"))
                .expect("deserialize intent");
        fixture.thresholds.gates[0].transition = "open".to_string();
        fixture.thresholds.gates[0].methods.clear();
        let repeated = freeze_threshold_intent(
            &fixture.thresholds,
            ThresholdIntentRequest {
                descriptor_kind: "gate",
                descriptor_id: "fixture.discovery:gate/archive-door",
                descriptor_version: 99,
                pack_id: &fixture.pack_id,
                pack_version: "9.9.9",
                pack_integrity: "sha256:changed",
                actor_id: 7,
                scope_id: "world",
                selected_method: "removed",
                accepted_turn: 99,
                requirement_facts: BTreeMap::new(),
                discovery_receipt_refs: Vec::new(),
                materialized_entity_ids: Vec::new(),
            },
            Some(&replayed),
        )
        .expect("known existing intent wins");
        assert_eq!(first, repeated);
        assert_eq!(repeated.pack_version, "1.0.0");
        assert_eq!(repeated.descriptor_version, 1);
    }

    #[test]
    fn generated_authority_unknown_versions_and_privileged_facts_fail() {
        let fixture = fixture();
        let mut malformed = serde_json::to_value(&fixture.thresholds).expect("serialize catalog");
        malformed["authoring_authority"] = serde_json::json!("generated_text");
        let parsed: ThresholdDescriptorCatalog =
            serde_json::from_value(malformed).expect("closed known fields");
        assert!(validate_threshold_descriptor_catalog(
            &parsed,
            &fixture.pack_id,
            &discovery_slots(&fixture),
        )
        .is_err());

        let mut bad_request = request(&fixture);
        bad_request
            .requirement_facts
            .insert("model_text".to_string(), "open it".to_string());
        assert!(freeze_threshold_intent(&fixture.thresholds, bad_request, None).is_err());
    }

    #[test]
    fn incompatible_slots_unknown_recoveries_and_unknown_targets_fail() {
        let fixture = fixture();
        let slots = discovery_slots(&fixture);

        let mut catalog = fixture.thresholds.clone();
        catalog.leads[0].slot.slot_version = 99;
        assert!(validate_threshold_descriptor_catalog(&catalog, &fixture.pack_id, &slots).is_err());

        let mut catalog = fixture.thresholds.clone();
        catalog.hazards[0].methods[0].recovery_version = Some(99);
        assert!(validate_threshold_descriptor_catalog(&catalog, &fixture.pack_id, &slots).is_err());

        let mut catalog = fixture.thresholds.clone();
        if let ThresholdEffect::SetGateState { target_id, .. } =
            &mut catalog.gates[0].methods[0].success_effects[0]
        {
            *target_id = "fixture.discovery:gate/missing".to_string();
        }
        assert!(validate_threshold_descriptor_catalog(&catalog, &fixture.pack_id, &slots).is_err());
    }

    #[test]
    fn anchor_distinguishes_legal_return_from_new_branch_authority() {
        let fixture = fixture();
        let anchor = &fixture.thresholds.anchors[0];
        assert_eq!(anchor.return_chain[0].id, "fixture.discovery:route/ford");
        assert_eq!(
            anchor.branch_authorization[0].id,
            "fixture.discovery:route/ridge"
        );
        assert_ne!(anchor.return_chain[0], anchor.branch_authorization[0]);
    }
}
