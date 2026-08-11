// THR-1 publishes strict authored descriptors and replay receipts, THR-2
// compiles their access predicates into the kernel, and THR-4 projects exact
// player methods from that same authority. Keep the remaining staged API
// compiled without spending the repository's production warning budget.
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
const HAZARD_TRIGGERS: [&str; 10] = [
    "interact",
    "open",
    "cross",
    "search",
    "failed_method",
    "turn",
    "force",
    "remove",
    "make_noise",
    "cast",
];
const HAZARD_SEVERITIES: [&str; 3] = ["minor", "major", "severe"];
const HAZARD_STATES: [&str; 5] = ["armed", "disarmed", "triggered", "spent", "bypassed"];
const HAZARD_TARGET_POLICIES: [&str; 4] = [
    "acting_actor",
    "holder",
    "expedition_order",
    "location_occupants",
];
const HAZARD_CONSEQUENCE_POLICIES: [&str; 4] = ["never", "success", "failure", "always"];
const HAZARD_RESOLUTION_VERSION: &str = "hazard-resolution-v1";
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
pub(crate) struct ThresholdTargetRef {
    pub(crate) kind: String,
    pub(crate) id: String,
    pub(crate) version: u8,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdRequirements {
    pub(super) mode: String,
    #[serde(default)]
    pub(super) clauses: Vec<ThresholdPredicate>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ThresholdEffect {
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThresholdMethodEconomy {
    pub(crate) played_time_turns: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ThresholdMethodResolution {
    Certain,
    SrdCheck {
        rules_action: String,
        ability: String,
        dc: u16,
    },
    ExistingKernelOutcome {
        event_type: String,
    },
    ConsequenceAvoidanceCheck {
        rules_action: String,
        ability: String,
        dc: u16,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThresholdMethodOfferContract {
    pub(crate) schema_version: u8,
    pub(crate) procedure: String,
    pub(crate) label: String,
    pub(crate) requirement: String,
    pub(crate) economy: ThresholdMethodEconomy,
    pub(crate) resolution: ThresholdMethodResolution,
    pub(crate) effect: String,
    pub(crate) consequence: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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
    #[serde(default)]
    pub(super) offer: Option<ThresholdMethodOfferContract>,
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
    pub(super) mechanics: Option<ThresholdHazardMechanics>,
    #[serde(default)]
    pub(super) slot: Option<ThresholdSlotRef>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdHazardMechanism {
    pub(super) text: String,
    pub(super) reveal_methods: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThresholdHazardTriggerBinding {
    pub(super) id: String,
    pub(super) act: String,
    pub(super) gate_method: String,
    pub(super) from_states: Vec<String>,
    pub(super) target_policy: String,
    pub(super) maximum_targets: u8,
    pub(super) on_success_state: String,
    #[serde(default)]
    pub(super) on_failure_state: Option<String>,
    pub(super) consequence_on: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThresholdHazardMechanics {
    pub(super) schema_version: u8,
    pub(super) resolution_version: String,
    pub(super) gate_id: String,
    pub(super) initial_state: String,
    pub(super) states: Vec<String>,
    pub(super) mechanism: ThresholdHazardMechanism,
    pub(super) trigger_bindings: Vec<ThresholdHazardTriggerBinding>,
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
pub(crate) struct AcceptedThresholdIntent {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) method_contract: Option<ThresholdMethodOfferContract>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) hazards: Vec<AcceptedThresholdHazard>,
    pub(super) target: ThresholdTargetRef,
    pub(super) accepted_turn: u64,
    pub(super) requirement_facts: BTreeMap<String, String>,
    pub(super) discovery_receipt_refs: Vec<String>,
    pub(super) materialized_entity_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AcceptedThresholdHazard {
    pub(super) schema_version: u8,
    pub(super) resolution_version: String,
    pub(super) descriptor_id: String,
    pub(super) descriptor_version: u8,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) pack_integrity: String,
    pub(super) scope_id: String,
    pub(super) trigger_id: String,
    pub(super) act: String,
    pub(super) gate_method: String,
    pub(super) state_before: String,
    pub(super) expected_revision: u64,
    pub(super) target_policy: String,
    pub(super) target_actor_ids: Vec<u64>,
    pub(super) on_success_state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) on_failure_state: Option<String>,
    pub(super) consequence_on: String,
    pub(super) tells: Vec<String>,
    pub(super) mechanism: String,
    #[serde(default)]
    pub(super) mechanism_revealed: bool,
    pub(super) consequences: Vec<ThresholdEffect>,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThresholdGateSource {
    pub(super) descriptor_id: String,
    pub(super) descriptor_version: u8,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) pack_integrity: String,
    pub(super) scope: String,
    #[serde(default)]
    pub(super) transition: String,
    pub(super) target: ThresholdTargetRef,
    pub(super) methods: BTreeMap<u64, String>,
    #[serde(default)]
    pub(crate) method_contracts: BTreeMap<u64, ThresholdMethodOfferContract>,
    #[serde(default)]
    pub(crate) hazards: Vec<ThresholdHazardSource>,
    #[serde(default)]
    pub(crate) facts: BTreeMap<u64, ThresholdFactSource>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThresholdHazardSource {
    pub(super) descriptor_id: String,
    pub(super) descriptor_version: u8,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) pack_integrity: String,
    pub(super) scope: String,
    pub(super) tells: Vec<String>,
    pub(super) severity: String,
    pub(super) mechanics: ThresholdHazardMechanics,
    pub(super) consequences: Vec<ThresholdEffect>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThresholdHazardRuntimeState {
    pub(super) descriptor_id: String,
    pub(super) descriptor_version: u8,
    pub(super) scope_id: String,
    pub(super) state: String,
    pub(super) revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) last_intent_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct ThresholdHazardPlayerView {
    pub(crate) descriptor_id: String,
    pub(crate) descriptor_version: u8,
    pub(crate) tells: Vec<String>,
    pub(crate) severity: String,
    pub(crate) consequence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mechanism: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct ThresholdHazardDeveloperView {
    pub(crate) descriptor_id: String,
    pub(crate) descriptor_version: u8,
    pub(crate) state: String,
    pub(crate) revision: u64,
    pub(crate) tells: Vec<String>,
    pub(crate) severity: String,
    pub(crate) mechanism: String,
    pub(crate) trigger_bindings: Vec<ThresholdHazardTriggerBinding>,
    pub(crate) consequences: Vec<ThresholdEffect>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct ThresholdMethodOfferView {
    pub(crate) component: String,
    pub(crate) descriptor_id: String,
    pub(crate) descriptor_version: u8,
    pub(crate) method: String,
    pub(crate) method_id: u64,
    pub(crate) target: ThresholdTargetRef,
    pub(crate) requirement: String,
    pub(crate) economy: ThresholdMethodEconomy,
    pub(crate) resolution: ThresholdMethodResolution,
    pub(crate) effect: String,
    pub(crate) consequence: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) hazards: Vec<ThresholdHazardPlayerView>,
}

#[derive(Clone, Debug)]
pub(crate) struct ProjectedThresholdMethod {
    pub(crate) binding: ThresholdOfferBinding,
    pub(crate) offer: ThresholdMethodOfferView,
    pub(crate) allowed: bool,
    pub(crate) disabled_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ThresholdFactSource {
    ItemCapability { capability: String },
    ActorTag { tag_id: String },
    ClockStatus { clock_id: String, status: String },
    JobStatus { job_id: String, status: String },
    BondState { target_actor_id: u64, state: String },
    AccessGrant { grant_id: String },
    PerActorClaim { claim_id: String },
}

type CompiledThresholdMethods = (
    Vec<CwGateMethodDefinition>,
    BTreeMap<u64, String>,
    BTreeMap<u64, ThresholdMethodOfferContract>,
    BTreeMap<u64, ThresholdFactSource>,
);

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ThresholdKernelSnapshot {
    #[serde(default)]
    sources: BTreeMap<u64, ThresholdGateSource>,
    #[serde(default)]
    hazard_states: BTreeMap<String, ThresholdHazardRuntimeState>,
    #[serde(default)]
    access_revision: u64,
    #[serde(default)]
    gates: Vec<CwGate>,
    #[serde(default)]
    methods: Vec<CwGateMethod>,
    #[serde(default)]
    predicates: Vec<CwGatePredicate>,
    #[serde(default)]
    actor_states: Vec<CwGateActorState>,
    #[serde(default)]
    claims: Vec<CwGateClaim>,
}

impl ThresholdKernelSnapshot {
    pub(crate) fn from_runtime(runtime: &RuntimeWorld) -> Self {
        Self {
            sources: runtime.threshold_gate_sources.clone(),
            hazard_states: runtime.threshold_hazard_states.clone(),
            access_revision: runtime.world.access_revision,
            gates: runtime.world.gates[..runtime.world.gate_count].to_vec(),
            methods: runtime.world.gate_methods[..runtime.world.gate_method_count].to_vec(),
            predicates: runtime.world.gate_predicates[..runtime.world.gate_predicate_count]
                .to_vec(),
            actor_states: runtime.world.gate_actor_states[..runtime.world.gate_actor_state_count]
                .to_vec(),
            claims: runtime.world.gate_claims[..runtime.world.gate_claim_count].to_vec(),
        }
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.gates.len() > CW_MAX_GATES
            || self.methods.len() > CW_MAX_GATE_METHOD_RECORDS
            || self.predicates.len() > CW_MAX_GATE_PREDICATE_RECORDS
            || self.actor_states.len() > CW_MAX_GATE_ACTOR_STATES
            || self.claims.len() > CW_MAX_GATE_CLAIMS
            || self.hazard_states.len() > 512
        {
            return Err("threshold authority exceeds a kernel snapshot capacity".to_string());
        }
        if self.gates.iter().any(|gate| {
            gate.id == 0
                || gate.version == 0
                || gate.method_start > self.methods.len()
                || gate.method_count > self.methods.len() - gate.method_start
        }) || self.methods.iter().any(|method| {
            method.id == 0
                || method.predicate_start > self.predicates.len()
                || method.predicate_count > self.predicates.len() - method.predicate_start
        }) {
            return Err("threshold authority has invalid method or predicate bounds".to_string());
        }
        if self.hazard_states.iter().any(|(key, state)| {
            key.trim().is_empty()
                || state.descriptor_id.trim().is_empty()
                || state.descriptor_version == 0
                || state.scope_id.trim().is_empty()
                || !HAZARD_STATES.contains(&state.state.as_str())
                || state.revision == 0
        }) {
            return Err("threshold authority has an invalid Hazard state".to_string());
        }
        Ok(())
    }

    pub(crate) fn restore_into(
        self,
        world: &mut CwWorld,
    ) -> (
        BTreeMap<u64, ThresholdGateSource>,
        BTreeMap<String, ThresholdHazardRuntimeState>,
    ) {
        world.access_revision = self.access_revision.max(1);
        world.gate_count = self.gates.len();
        world.gate_method_count = self.methods.len();
        world.gate_predicate_count = self.predicates.len();
        world.gate_actor_state_count = self.actor_states.len();
        world.gate_claim_count = self.claims.len();
        world.gates[..self.gates.len()].copy_from_slice(&self.gates);
        world.gate_methods[..self.methods.len()].copy_from_slice(&self.methods);
        world.gate_predicates[..self.predicates.len()].copy_from_slice(&self.predicates);
        world.gate_actor_states[..self.actor_states.len()].copy_from_slice(&self.actor_states);
        world.gate_claims[..self.claims.len()].copy_from_slice(&self.claims);
        (self.sources, self.hazard_states)
    }
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

fn validate_method_offer(
    method: &ThresholdMethod,
    offer: &ThresholdMethodOfferContract,
    label: &str,
) -> Result<(), String> {
    if offer.schema_version != 1
        || offer.procedure != "open_v1"
        || !valid_token(&offer.label, 96)
        || !valid_token(&offer.requirement, 256)
        || !valid_token(&offer.effect, 256)
        || !valid_token(&offer.consequence, 256)
        || offer.economy.played_time_turns != 1
    {
        return Err(format!(
            "{label} has an invalid concrete method offer contract"
        ));
    }
    let valid_check = |rules_action: &str, ability: &str, dc: u16| {
        valid_token(rules_action, 96)
            && matches!(
                ability,
                "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma"
            )
            && dc > 0
            && dc <= i16::MAX as u16
    };
    match &offer.resolution {
        ThresholdMethodResolution::Certain => {
            if !method.failure_effects.is_empty() {
                return Err(format!(
                    "{label} certain resolution cannot author failure effects"
                ));
            }
        }
        ThresholdMethodResolution::SrdCheck {
            rules_action,
            ability,
            dc,
        }
        | ThresholdMethodResolution::ConsequenceAvoidanceCheck {
            rules_action,
            ability,
            dc,
        } => {
            if !valid_check(rules_action, ability, *dc) || method.failure_effects.is_empty() {
                return Err(format!(
                    "{label} checked resolution must name an SRD check and a state-changing failure"
                ));
            }
        }
        ThresholdMethodResolution::ExistingKernelOutcome { event_type } => {
            if event_type != "gate.transition.applied" || !method.failure_effects.is_empty() {
                return Err(format!(
                    "{label} existing kernel outcome must bind gate.transition.applied"
                ));
            }
        }
    }
    if method
        .requirements
        .clauses
        .iter()
        .any(|predicate| matches!(predicate, ThresholdPredicate::ExactItem { .. }))
        && (!matches!(
            &offer.resolution,
            ThresholdMethodResolution::Certain
                | ThresholdMethodResolution::ExistingKernelOutcome { .. }
        ) || !offer.consequence.to_ascii_lowercase().contains("quiet"))
    {
        return Err(format!(
            "{label} exact-item methods must be certain and explicitly quiet"
        ));
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
    if let Some(offer) = &method.offer {
        validate_method_offer(method, offer, label)?;
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
            || hazard.triggers.len() > HAZARD_TRIGGERS.len()
            || hazard.triggers.iter().collect::<BTreeSet<_>>().len() != hazard.triggers.len()
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
        if let Some(mechanics) = &hazard.mechanics {
            if hazard
                .consequences
                .iter()
                .any(|effect| !matches!(effect, ThresholdEffect::AdvanceClock { .. }))
            {
                return Err(format!(
                    "hazard {} mechanics only supports deterministic clock consequences",
                    hazard.id
                ));
            }
            let gate = catalog
                .gates
                .iter()
                .find(|gate| gate.id == mechanics.gate_id)
                .ok_or_else(|| {
                    format!("hazard {} mechanics reference an unknown Gate", hazard.id)
                })?;
            if gate.target_ref != hazard.target_ref {
                return Err(format!(
                    "hazard {} mechanics must bind a Gate on the same target",
                    hazard.id
                ));
            }
            let gate_methods = gate
                .methods
                .iter()
                .map(|method| method.id.as_str())
                .collect::<BTreeSet<_>>();
            if mechanics.schema_version != 1
                || mechanics.resolution_version != HAZARD_RESOLUTION_VERSION
                || mechanics.initial_state != "armed"
                || !(2..=HAZARD_STATES.len()).contains(&mechanics.states.len())
                || !mechanics.states.iter().any(|state| state == "armed")
                || mechanics
                    .states
                    .iter()
                    .any(|state| !HAZARD_STATES.contains(&state.as_str()))
                || mechanics.states.iter().collect::<BTreeSet<_>>().len() != mechanics.states.len()
                || !valid_token(&mechanics.mechanism.text, 512)
                || !(1..=2).contains(&mechanics.mechanism.reveal_methods.len())
                || mechanics
                    .mechanism
                    .reveal_methods
                    .iter()
                    .any(|method| !["search", "study"].contains(&method.as_str()))
                || mechanics
                    .mechanism
                    .reveal_methods
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len()
                    != mechanics.mechanism.reveal_methods.len()
                || !(1..=16).contains(&mechanics.trigger_bindings.len())
            {
                return Err(format!("hazard {} mechanics are invalid", hazard.id));
            }
            let mut binding_ids = BTreeSet::new();
            let mut bound_methods = BTreeSet::new();
            for binding in &mechanics.trigger_bindings {
                let method = gate
                    .methods
                    .iter()
                    .find(|method| method.id == binding.gate_method)
                    .ok_or_else(|| {
                        format!(
                            "hazard {} trigger {} references an unknown Gate method",
                            hazard.id, binding.id
                        )
                    })?;
                let checked = method.offer.as_ref().is_some_and(|offer| {
                    matches!(
                        offer.resolution,
                        ThresholdMethodResolution::SrdCheck { .. }
                            | ThresholdMethodResolution::ConsequenceAvoidanceCheck { .. }
                    )
                });
                if !valid_local_id(&binding.id)
                    || !binding_ids.insert(binding.id.as_str())
                    || !bound_methods.insert(binding.gate_method.as_str())
                    || !gate_methods.contains(binding.gate_method.as_str())
                    || !HAZARD_TRIGGERS.contains(&binding.act.as_str())
                    || !hazard.triggers.contains(&binding.act)
                    || binding.from_states.is_empty()
                    || binding.from_states.len() > mechanics.states.len()
                    || binding
                        .from_states
                        .iter()
                        .any(|state| !mechanics.states.contains(state))
                    || binding.from_states.iter().collect::<BTreeSet<_>>().len()
                        != binding.from_states.len()
                    || !HAZARD_TARGET_POLICIES.contains(&binding.target_policy.as_str())
                    || !(1..=16).contains(&binding.maximum_targets)
                    || !mechanics.states.contains(&binding.on_success_state)
                    || binding
                        .on_failure_state
                        .as_ref()
                        .is_some_and(|state| !mechanics.states.contains(state))
                    || checked != binding.on_failure_state.is_some()
                    || !HAZARD_CONSEQUENCE_POLICIES.contains(&binding.consequence_on.as_str())
                {
                    return Err(format!(
                        "hazard {} trigger binding {} is invalid",
                        hazard.id, binding.id
                    ));
                }
            }
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
        || intent
            .method_contract
            .as_ref()
            .is_some_and(|contract| !valid_frozen_method_contract(contract))
        || intent.hazards.len() > 16
        || intent.hazards.iter().any(|hazard| {
            !valid_frozen_hazard(hazard)
                || hazard.gate_method != intent.selected_method
                || hazard.pack_id != intent.pack_id
                || hazard.pack_version != intent.pack_version
                || hazard.pack_integrity != intent.pack_integrity
        })
    {
        return Err(
            "accepted threshold intent uses an unknown version or is incomplete".to_string(),
        );
    }
    Ok(())
}

fn valid_frozen_hazard(hazard: &AcceptedThresholdHazard) -> bool {
    hazard.schema_version == 1
        && hazard.resolution_version == HAZARD_RESOLUTION_VERSION
        && valid_token(&hazard.descriptor_id, 256)
        && hazard.descriptor_version > 0
        && valid_token(&hazard.pack_id, 128)
        && valid_token(&hazard.pack_version, 64)
        && valid_token(&hazard.pack_integrity, 256)
        && valid_token(&hazard.scope_id, 256)
        && valid_local_id(&hazard.trigger_id)
        && HAZARD_TRIGGERS.contains(&hazard.act.as_str())
        && valid_local_id(&hazard.gate_method)
        && HAZARD_STATES.contains(&hazard.state_before.as_str())
        && hazard.expected_revision > 0
        && HAZARD_TARGET_POLICIES.contains(&hazard.target_policy.as_str())
        && !hazard.target_actor_ids.is_empty()
        && hazard.target_actor_ids.len() <= 16
        && hazard.target_actor_ids.iter().all(|actor_id| *actor_id > 0)
        && hazard
            .target_actor_ids
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            == hazard.target_actor_ids.len()
        && HAZARD_STATES.contains(&hazard.on_success_state.as_str())
        && hazard
            .on_failure_state
            .as_ref()
            .is_none_or(|state| HAZARD_STATES.contains(&state.as_str()))
        && HAZARD_CONSEQUENCE_POLICIES.contains(&hazard.consequence_on.as_str())
        && !hazard.tells.is_empty()
        && hazard.tells.len() <= 8
        && hazard.tells.iter().all(|tell| valid_token(tell, 512))
        && valid_token(&hazard.mechanism, 512)
        && !hazard.consequences.is_empty()
        && hazard.consequences.len() <= 8
}

fn valid_frozen_method_contract(contract: &ThresholdMethodOfferContract) -> bool {
    if contract.schema_version != 1
        || contract.procedure != "open_v1"
        || !valid_token(&contract.label, 96)
        || !valid_token(&contract.requirement, 256)
        || contract.economy.played_time_turns != 1
        || !valid_token(&contract.effect, 256)
        || !valid_token(&contract.consequence, 256)
    {
        return false;
    }
    match &contract.resolution {
        ThresholdMethodResolution::Certain => true,
        ThresholdMethodResolution::SrdCheck {
            rules_action,
            ability,
            dc,
        }
        | ThresholdMethodResolution::ConsequenceAvoidanceCheck {
            rules_action,
            ability,
            dc,
        } => {
            valid_token(rules_action, 96)
                && matches!(
                    ability.as_str(),
                    "strength"
                        | "dexterity"
                        | "constitution"
                        | "intelligence"
                        | "wisdom"
                        | "charisma"
                )
                && (1..=i16::MAX as u16).contains(dc)
        }
        ThresholdMethodResolution::ExistingKernelOutcome { event_type } => {
            event_type == "gate.transition.applied"
        }
    }
}

pub(crate) fn threshold_kernel_id(value: &str) -> u64 {
    let mut digest = 14_695_981_039_346_656_037u64;
    for byte in value.as_bytes() {
        digest ^= u64::from(*byte);
        digest = digest.wrapping_mul(1_099_511_628_211);
    }
    digest.max(1)
}

fn threshold_intent_matches_kernel_action(
    intent: &AcceptedThresholdIntent,
    action: &CwAction,
    rules_profile: &str,
    worldpack_bundle_hash: &str,
) -> bool {
    validate_existing_intent(intent).is_ok()
        && !rules_profile.trim().is_empty()
        && intent
            .requirement_facts
            .get("worldpack_bundle_hash")
            .is_none_or(|hash| hash == worldpack_bundle_hash)
        && intent.actor_id == action.actor_id
        && intent
            .requirement_facts
            .get("target_id")
            .and_then(|value| value.parse::<u64>().ok())
            == Some(action.threshold.gate_id)
        && intent
            .requirement_facts
            .get("method_id")
            .and_then(|value| value.parse::<u64>().ok())
            == Some(action.threshold.method_id)
        && (action.kind != CW_ACTION_GATE_TRANSITION
            || threshold_kernel_id(&intent.id) == action.threshold.claim_id)
}

fn threshold_method_contract_matches_action(
    intent: &AcceptedThresholdIntent,
    action: &CwAction,
) -> bool {
    if action.threshold.reserved[1..]
        .iter()
        .any(|value| *value != 0)
    {
        return false;
    }
    let Some(contract) = intent.method_contract.as_ref() else {
        return action.threshold.reserved[0] == CW_GATE_METHOD_RESOLUTION_CERTAIN
            && action.dc == 0
            && action.modifier == 0
            && action.roll_mode == CW_ROLL_NORMAL;
    };
    match &contract.resolution {
        ThresholdMethodResolution::Certain => {
            action.threshold.reserved[0] == CW_GATE_METHOD_RESOLUTION_CERTAIN
                && action.dc == 0
                && action.modifier == 0
                && action.roll_mode == CW_ROLL_NORMAL
        }
        ThresholdMethodResolution::ExistingKernelOutcome { .. } => {
            action.threshold.reserved[0] == CW_GATE_METHOD_RESOLUTION_EXISTING_KERNEL_OUTCOME
                && action.dc == 0
                && action.modifier == 0
                && action.roll_mode == CW_ROLL_NORMAL
        }
        ThresholdMethodResolution::SrdCheck { ability, dc, .. } => {
            action.threshold.reserved[0] == CW_GATE_METHOD_RESOLUTION_SRD_CHECK
                && action.ability == ability_from_string(ability)
                && action.dc == *dc
                && action.modifier == 0
                && action.roll_mode == CW_ROLL_NORMAL
        }
        ThresholdMethodResolution::ConsequenceAvoidanceCheck { ability, dc, .. } => {
            action.threshold.reserved[0] == CW_GATE_METHOD_RESOLUTION_CONSEQUENCE_AVOIDANCE_CHECK
                && action.ability == ability_from_string(ability)
                && action.dc == *dc
                && action.modifier == 0
                && action.roll_mode == CW_ROLL_NORMAL
        }
    }
}

pub(crate) fn threshold_record_preconditions_hold(record: &JournalRecord) -> bool {
    let action = &record.action;
    if action.threshold.gate_id == 0 {
        return record.threshold_intent.is_none()
            && action.threshold == CwThresholdInput::default();
    }
    let Some(intent) = record.threshold_intent.as_ref() else {
        return false;
    };
    if action.threshold.fact_count > CW_MAX_GATE_FACTS
        || !threshold_intent_matches_kernel_action(
            intent,
            action,
            &record.rules_profile,
            &record.worldpack_bundle_hash,
        )
        || !threshold_method_contract_matches_action(intent, action)
    {
        return false;
    }
    let action_shape_is_valid = match action.kind {
        CW_ACTION_MOVE | CW_ACTION_FLEE | CW_ACTION_COMBAT_ESCAPE => {
            action.threshold.transition == CW_GATE_TRANSITION_NONE && action.threshold.claim_id == 0
        }
        CW_ACTION_GATE_TRANSITION => {
            action.threshold.transition != CW_GATE_TRANSITION_NONE && action.threshold.claim_id != 0
        }
        _ => false,
    };
    action_shape_is_valid
        && record
            .route_binding
            .as_ref()
            .and_then(|route| route.threshold.as_ref())
            .is_none_or(|binding| {
                binding.actor_id == action.actor_id
                    && binding.gate_id == action.threshold.gate_id
                    && binding.method_id == action.threshold.method_id
                    && binding.gate_version == action.threshold.expected_gate_version
                    && binding.access_revision == action.threshold.expected_access_revision
                    && binding.evidence_digest == action.threshold.expected_evidence_digest
                    && binding.facts.as_slice()
                        == &action.threshold.facts[..action.threshold.fact_count]
            })
}

pub(crate) fn threshold_record_claim_already_applied(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
) -> bool {
    let threshold = &record.action.threshold;
    record.action.kind == CW_ACTION_GATE_TRANSITION
        && threshold.claim_id != 0
        && runtime.world.gate_claims[..runtime.world.gate_claim_count]
            .iter()
            .any(|claim| {
                claim.id == threshold.claim_id
                    && claim.gate_id == threshold.gate_id
                    && claim.actor_id == record.action.actor_id
                    && claim.item_id == record.action.item_id
                    && claim.method_id == threshold.method_id
                    && claim.transition == threshold.transition
            })
}

pub(super) fn accepted_intent_for_kernel_binding(
    source: &ThresholdGateSource,
    action: &CwAction,
    accepted_turn: u64,
    worldpack_bundle_hash: &str,
) -> Option<AcceptedThresholdIntent> {
    let selected_method = if action.threshold.method_id == 0 {
        "gate_state"
    } else {
        source.methods.get(&action.threshold.method_id)?.as_str()
    };
    let scope_id = match source.scope.as_str() {
        "world" => "world".to_string(),
        "expedition" => format!("expedition:{}", action.actor_id),
        "actor" | "holder" => action.actor_id.to_string(),
        _ => return None,
    };
    let mut requirement_facts = BTreeMap::from([
        ("actor_id".to_string(), action.actor_id.to_string()),
        ("scope_id".to_string(), scope_id.clone()),
        (
            "target_id".to_string(),
            action.threshold.gate_id.to_string(),
        ),
        (
            "method_id".to_string(),
            action.threshold.method_id.to_string(),
        ),
        (
            "worldpack_bundle_hash".to_string(),
            worldpack_bundle_hash.to_string(),
        ),
    ]);
    requirement_facts.retain(|key, _| ACCEPTED_FACTS.contains(&key.as_str()));
    let id = format!(
        "threshold-intent:{}@{}:{}:{}:{}:{}:{}:{}",
        source.descriptor_id,
        source.descriptor_version,
        action.actor_id,
        accepted_turn,
        action.threshold.gate_id,
        action.threshold.method_id,
        action.threshold.transition,
        action.item_id
    );
    Some(AcceptedThresholdIntent {
        schema_version: THRESHOLD_SCHEMA_VERSION,
        intent_version: THRESHOLD_INTENT_VERSION.to_string(),
        id,
        descriptor_kind: "gate".to_string(),
        descriptor_id: source.descriptor_id.clone(),
        descriptor_version: source.descriptor_version,
        pack_id: source.pack_id.clone(),
        pack_version: source.pack_version.clone(),
        pack_integrity: source.pack_integrity.clone(),
        actor_id: action.actor_id,
        scope: source.scope.clone(),
        scope_id,
        selected_method: selected_method.to_string(),
        method_contract: source
            .method_contracts
            .get(&action.threshold.method_id)
            .cloned(),
        hazards: Vec::new(),
        target: source.target.clone(),
        accepted_turn,
        requirement_facts,
        discovery_receipt_refs: Vec::new(),
        materialized_entity_ids: Vec::new(),
    })
}

impl RuntimeWorld {
    fn threshold_hazard_scope_id(source: &ThresholdHazardSource, actor_id: u64) -> Option<String> {
        match source.scope.as_str() {
            "world" => Some("world".to_string()),
            "expedition" => Some(format!("expedition:{actor_id}")),
            "actor" | "holder" => Some(actor_id.to_string()),
            _ => None,
        }
    }

    fn threshold_hazard_state_for(
        &self,
        source: &ThresholdHazardSource,
        actor_id: u64,
    ) -> Option<ThresholdHazardRuntimeState> {
        let scope_id = Self::threshold_hazard_scope_id(source, actor_id)?;
        let key = format!("{}:{scope_id}", source.descriptor_id);
        Some(
            self.threshold_hazard_states
                .get(&key)
                .cloned()
                .unwrap_or_else(|| ThresholdHazardRuntimeState {
                    descriptor_id: source.descriptor_id.clone(),
                    descriptor_version: source.descriptor_version,
                    scope_id,
                    state: source.mechanics.initial_state.clone(),
                    revision: 1,
                    last_intent_id: None,
                }),
        )
    }

    fn threshold_hazard_target_actor_ids(
        &self,
        actor_id: u64,
        binding: &ThresholdHazardTriggerBinding,
    ) -> Vec<u64> {
        if matches!(binding.target_policy.as_str(), "acting_actor" | "holder") {
            return vec![actor_id];
        }
        let Some(location_id) = self.actor_by_id(actor_id).map(|actor| actor.location_id) else {
            return Vec::new();
        };
        let mut actor_ids = self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|actor| actor.location_id == location_id && actor.location_id != 0)
            .map(|actor| actor.id)
            .collect::<Vec<_>>();
        actor_ids.sort_unstable();
        actor_ids.dedup();
        actor_ids.truncate(usize::from(binding.maximum_targets));
        actor_ids
    }

    fn threshold_hazard_mechanism_revealed(
        &self,
        source: &ThresholdHazardSource,
        actor_id: u64,
    ) -> bool {
        source
            .mechanics
            .mechanism
            .reveal_methods
            .iter()
            .any(|method| {
                let evidence_id = format!(
                    "threshold-hazard-evidence:{}:{actor_id}:{method}",
                    source.descriptor_id
                );
                self.tags.get(&evidence_id).is_some_and(|tag| tag.active)
            })
    }

    fn accepted_hazards_for_action(
        &self,
        source: &ThresholdGateSource,
        action: &CwAction,
        selected_method: &str,
    ) -> Vec<AcceptedThresholdHazard> {
        source
            .hazards
            .iter()
            .filter_map(|hazard| {
                let binding = hazard
                    .mechanics
                    .trigger_bindings
                    .iter()
                    .find(|binding| binding.gate_method == selected_method)?;
                let state = self.threshold_hazard_state_for(hazard, action.actor_id)?;
                binding
                    .from_states
                    .contains(&state.state)
                    .then_some((hazard, binding, state))
            })
            .filter_map(|(hazard, binding, state)| {
                let target_actor_ids =
                    self.threshold_hazard_target_actor_ids(action.actor_id, binding);
                (!target_actor_ids.is_empty()).then(|| AcceptedThresholdHazard {
                    schema_version: 1,
                    resolution_version: HAZARD_RESOLUTION_VERSION.to_string(),
                    descriptor_id: hazard.descriptor_id.clone(),
                    descriptor_version: hazard.descriptor_version,
                    pack_id: hazard.pack_id.clone(),
                    pack_version: hazard.pack_version.clone(),
                    pack_integrity: hazard.pack_integrity.clone(),
                    scope_id: state.scope_id,
                    trigger_id: binding.id.clone(),
                    act: binding.act.clone(),
                    gate_method: binding.gate_method.clone(),
                    state_before: state.state,
                    expected_revision: state.revision,
                    target_policy: binding.target_policy.clone(),
                    target_actor_ids,
                    on_success_state: binding.on_success_state.clone(),
                    on_failure_state: binding.on_failure_state.clone(),
                    consequence_on: binding.consequence_on.clone(),
                    tells: hazard.tells.clone(),
                    mechanism: hazard.mechanics.mechanism.text.clone(),
                    mechanism_revealed: self
                        .threshold_hazard_mechanism_revealed(hazard, action.actor_id),
                    consequences: hazard.consequences.clone(),
                })
            })
            .collect()
    }

    pub(crate) fn threshold_hazard_preconditions_hold(&self, record: &JournalRecord) -> bool {
        if threshold_record_claim_already_applied(self, record) {
            return true;
        }
        let Some(intent) = record.threshold_intent.as_ref() else {
            return record.action.threshold.gate_id == 0;
        };
        let Some(source) = self
            .threshold_gate_sources
            .get(&record.action.threshold.gate_id)
        else {
            return intent.hazards.is_empty();
        };
        intent.hazards
            == self.accepted_hazards_for_action(source, &record.action, &intent.selected_method)
    }

    pub(crate) fn bind_threshold_intent(&self, record: &mut JournalRecord) {
        if record.action.threshold.gate_id == 0 || record.threshold_intent.is_some() {
            return;
        }
        let Some(source) = self
            .threshold_gate_sources
            .get(&record.action.threshold.gate_id)
        else {
            return;
        };
        let Some(mut intent) = accepted_intent_for_kernel_binding(
            source,
            &record.action,
            self.world.tick,
            &record.worldpack_bundle_hash,
        ) else {
            return;
        };
        intent.hazards =
            self.accepted_hazards_for_action(source, &record.action, &intent.selected_method);
        if record.action.kind == CW_ACTION_GATE_TRANSITION && record.action.threshold.claim_id == 0
        {
            record.action.threshold.claim_id = threshold_kernel_id(&intent.id);
        }
        record.threshold_intent = Some(intent);
    }

    pub(crate) fn threshold_hazard_player_views_for_method(
        &self,
        source: &ThresholdGateSource,
        actor_id: u64,
        selected_method: &str,
        consequence: &str,
    ) -> Vec<ThresholdHazardPlayerView> {
        source
            .hazards
            .iter()
            .filter(|hazard| {
                hazard
                    .mechanics
                    .trigger_bindings
                    .iter()
                    .any(|binding| binding.gate_method == selected_method)
            })
            .map(|hazard| ThresholdHazardPlayerView {
                descriptor_id: hazard.descriptor_id.clone(),
                descriptor_version: hazard.descriptor_version,
                tells: hazard.tells.clone(),
                severity: hazard.severity.clone(),
                consequence: consequence.to_string(),
                mechanism: self
                    .threshold_hazard_mechanism_revealed(hazard, actor_id)
                    .then(|| hazard.mechanics.mechanism.text.clone()),
            })
            .collect()
    }

    pub(crate) fn threshold_hazard_developer_views(
        &self,
        actor_id: u64,
    ) -> Vec<ThresholdHazardDeveloperView> {
        self.threshold_gate_sources
            .values()
            .flat_map(|source| source.hazards.iter())
            .filter_map(|hazard| {
                let state = self.threshold_hazard_state_for(hazard, actor_id)?;
                Some(ThresholdHazardDeveloperView {
                    descriptor_id: hazard.descriptor_id.clone(),
                    descriptor_version: hazard.descriptor_version,
                    state: state.state,
                    revision: state.revision,
                    tells: hazard.tells.clone(),
                    severity: hazard.severity.clone(),
                    mechanism: hazard.mechanics.mechanism.text.clone(),
                    trigger_bindings: hazard.mechanics.trigger_bindings.clone(),
                    consequences: hazard.consequences.clone(),
                })
            })
            .collect()
    }

    pub(crate) fn touch_threshold_access_after_projection(
        &mut self,
        record: &JournalRecord,
        status: u32,
    ) {
        if status == CW_OK
            && record.action.kind == CW_ACTION_NONE
            && !record.projection_mutations.is_empty()
        {
            unsafe { cw_world_access_changed(&mut *self.world) };
        }
    }

    fn apply_threshold_hazard_evidence_projection(
        &mut self,
        record: &JournalRecord,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        let reveal_method = match record.action.kind {
            CW_ACTION_RULES_SEARCH | CW_ACTION_SEARCH => "search",
            CW_ACTION_RULES_STUDY => "study",
            _ => return Vec::new(),
        };
        let succeeded = committed_events.iter().any(|event| {
            event.actor_id == Some(record.action.actor_id)
                && event.success
                && (event.type_name == "ability_check.rolled"
                    || (reveal_method == "search"
                        && matches!(
                            event.type_name.as_str(),
                            "location.searched" | "feature.searched"
                        )))
        });
        if !succeeded {
            return Vec::new();
        }
        let Some(location_id) = self
            .actor_by_id(record.action.actor_id)
            .map(|actor| actor.location_id)
        else {
            return Vec::new();
        };
        let descriptor_ids = self
            .threshold_gate_sources
            .iter()
            .filter(|(gate_id, _)| {
                self.world.gates[..self.world.gate_count]
                    .iter()
                    .find(|gate| gate.id == **gate_id)
                    .is_some_and(|gate| {
                        gate.from_location_id == location_id
                            || (gate.target_kind == CW_GATE_TARGET_CONTAINER
                                && self.world.items[..self.world.item_count]
                                    .iter()
                                    .find(|item| item.id == gate.target_item_id)
                                    .is_some_and(|item| {
                                        item.location_id == location_id
                                            || item.holder_actor_id == record.action.actor_id
                                    }))
                    })
            })
            .flat_map(|(_, source)| source.hazards.iter())
            .filter(|hazard| {
                hazard
                    .mechanics
                    .mechanism
                    .reveal_methods
                    .iter()
                    .any(|method| method == reveal_method)
            })
            .map(|hazard| hazard.descriptor_id.clone())
            .collect::<BTreeSet<_>>();
        let mut events = Vec::new();
        for descriptor_id in descriptor_ids {
            let evidence_id = format!(
                "threshold-hazard-evidence:{descriptor_id}:{}:{reveal_method}",
                record.action.actor_id
            );
            let tag = RpgTagState {
                id: evidence_id,
                scope: "actor".to_string(),
                scope_id: record.action.actor_id,
                label: format!("Understood {descriptor_id} through {reveal_method}"),
                kind: "discovery".to_string(),
                active: true,
                source_event_seq: committed_events.last().map(|event| event.seq),
                expires: None,
            };
            if let Some(event) =
                self.set_rpg_tag(tag, record.action.actor_id, "threshold_hazard_evidence")
            {
                events.push(event);
            }
        }
        if !events.is_empty() {
            unsafe { cw_world_access_changed(&mut *self.world) };
        }
        events
    }

    fn apply_threshold_method_resolution_projection(
        &mut self,
        record: &JournalRecord,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        if record.action.kind != CW_ACTION_GATE_TRANSITION {
            return Vec::new();
        }
        let Some(contract) = record
            .threshold_intent
            .as_ref()
            .and_then(|intent| intent.method_contract.as_ref())
        else {
            return Vec::new();
        };
        let check = committed_events.iter().find(|event| {
            event.type_name == "ability_check.rolled"
                && event.actor_id == Some(record.action.actor_id)
        });
        let avoided_consequence = check.is_none_or(|event| event.success);
        let transition_applied = committed_events
            .iter()
            .any(|event| event.type_name == "gate.transition.applied");
        let content = match (
            &contract.resolution,
            avoided_consequence,
            transition_applied,
        ) {
            (ThresholdMethodResolution::ConsequenceAvoidanceCheck { .. }, false, true) => format!(
                "{} Consequence: {}",
                contract.effect.trim_end_matches(['.', '!', '?']),
                contract.consequence
            ),
            (_, false, false) => contract.consequence.clone(),
            (_, _, true) => contract.effect.clone(),
            _ => return Vec::new(),
        };
        vec![self.append_async_job_event(
            "threshold.method.resolved",
            record.action.actor_id,
            None,
            Some(content),
        )]
    }

    fn apply_threshold_hazard_resolution_projection(
        &mut self,
        record: &JournalRecord,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        let Some(intent) = record.threshold_intent.as_ref() else {
            return Vec::new();
        };
        let hazards = intent.hazards.clone();
        if hazards.is_empty() {
            return Vec::new();
        }
        let transition_applied = committed_events
            .iter()
            .any(|event| event.type_name == "gate.transition.applied");
        let check_success = committed_events
            .iter()
            .find(|event| {
                event.type_name == "ability_check.rolled"
                    && event.actor_id == Some(record.action.actor_id)
            })
            .map(|event| event.success);
        let method_success = match intent
            .method_contract
            .as_ref()
            .map(|contract| &contract.resolution)
        {
            Some(
                ThresholdMethodResolution::SrdCheck { .. }
                | ThresholdMethodResolution::ConsequenceAvoidanceCheck { .. },
            ) => check_success.unwrap_or(false),
            Some(ThresholdMethodResolution::ExistingKernelOutcome { event_type }) => {
                committed_events
                    .iter()
                    .any(|event| event.type_name == *event_type)
            }
            _ => transition_applied,
        };
        let intent_id = intent.id.clone();
        let mut events = Vec::new();
        for hazard in hazards {
            let state_after = if method_success {
                hazard.on_success_state.clone()
            } else {
                hazard
                    .on_failure_state
                    .clone()
                    .unwrap_or_else(|| hazard.state_before.clone())
            };
            let consequence_applied = match hazard.consequence_on.as_str() {
                "success" => method_success,
                "failure" => !method_success,
                "always" => true,
                _ => false,
            };
            let state_key = format!("{}:{}", hazard.descriptor_id, hazard.scope_id);
            self.threshold_hazard_states.insert(
                state_key,
                ThresholdHazardRuntimeState {
                    descriptor_id: hazard.descriptor_id.clone(),
                    descriptor_version: hazard.descriptor_version,
                    scope_id: hazard.scope_id.clone(),
                    state: state_after.clone(),
                    revision: hazard.expected_revision.saturating_add(1),
                    last_intent_id: Some(intent_id.clone()),
                },
            );
            let payload = serde_json::json!({
                "resolution_version": hazard.resolution_version,
                "intent_id": intent_id,
                "descriptor_id": hazard.descriptor_id,
                "descriptor_version": hazard.descriptor_version,
                "trigger_id": hazard.trigger_id,
                "act": hazard.act,
                "gate_method": hazard.gate_method,
                "state_before": hazard.state_before,
                "state_after": state_after,
                "target_policy": hazard.target_policy,
                "target_actor_ids": hazard.target_actor_ids,
                "tells": hazard.tells,
                "method_success": method_success,
                "consequence_applied": consequence_applied,
                "consequences": hazard.consequences,
                "mechanism": hazard
                    .mechanism_revealed
                    .then(|| hazard.mechanism.clone()),
            });
            let target_actor_id = payload["target_actor_ids"]
                .as_array()
                .and_then(|targets| targets.first())
                .and_then(serde_json::Value::as_u64);
            let mut resolution_event = self.append_async_job_event(
                "threshold.hazard.resolved",
                record.action.actor_id,
                target_actor_id,
                Some(payload.to_string()),
            );
            resolution_event.success = method_success;
            self.replace_projected_event(&resolution_event);
            let cause_seq = resolution_event.seq;
            events.push(resolution_event);
            if consequence_applied {
                for effect in &hazard.consequences {
                    if let ThresholdEffect::AdvanceClock { target_id, amount } = effect {
                        let mut consequence_events = self.advance_clock(
                            target_id,
                            *amount,
                            record.action.actor_id,
                            "threshold_hazard_consequence",
                        );
                        self.link_events_to_cause(&mut consequence_events, cause_seq);
                        events.extend(consequence_events);
                    }
                }
            }
        }
        unsafe { cw_world_access_changed(&mut *self.world) };
        events
    }

    pub(crate) fn apply_threshold_projections(
        &mut self,
        record: &JournalRecord,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        let mut events = self.apply_threshold_hazard_evidence_projection(record, committed_events);
        events.extend(self.apply_threshold_method_resolution_projection(record, committed_events));
        events.extend(self.apply_threshold_hazard_resolution_projection(record, committed_events));
        events
    }

    fn threshold_item_handle(&self, canonical_ref: &str) -> Option<u64> {
        self.runtime_handle_for_canonical_ref("item", canonical_ref)
            .or_else(|| {
                active_content().items.iter().find_map(|item| {
                    content_registry()
                        .content_reference("item", item.id)
                        .is_some_and(|entry| entry.canonical_ref == canonical_ref)
                        .then_some(item.id)
                })
            })
    }

    fn threshold_actor_handle(&self, canonical_ref: &str) -> Option<u64> {
        self.runtime_handle_for_canonical_ref("actor", canonical_ref)
            .or_else(|| {
                active_content().actors.iter().find_map(|actor| {
                    content_registry()
                        .content_reference("actor", actor.id)
                        .is_some_and(|entry| entry.canonical_ref == canonical_ref)
                        .then_some(actor.id)
                })
            })
    }

    fn compile_threshold_predicate(
        &self,
        predicate: &ThresholdPredicate,
        default_location_id: u64,
    ) -> Result<(CwGatePredicate, Option<(u64, ThresholdFactSource)>), String> {
        let compiled = match predicate {
            ThresholdPredicate::ExactItem { item_id } => CwGatePredicate {
                kind: CW_GATE_PREDICATE_HELD_ITEM,
                subject_id: self
                    .threshold_item_handle(item_id)
                    .ok_or_else(|| format!("threshold item {item_id} is not materialized"))?,
                ..CwGatePredicate::default()
            },
            ThresholdPredicate::ItemCapability { capability } => {
                let fact_id = threshold_kernel_id(&format!("item-capability:{capability}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_HELD_ITEM_CAPABILITY,
                        fact_id,
                        expected_value: 1,
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::ItemCapability {
                            capability: capability.clone(),
                        },
                    )),
                ));
            }
            ThresholdPredicate::InstalledItem { item_id, target_id } => {
                let target_location_id = self
                    .runtime_handle_for_canonical_ref("location", target_id)
                    .unwrap_or(default_location_id);
                CwGatePredicate {
                    kind: CW_GATE_PREDICATE_INSTALLED_ITEM,
                    subject_id: self
                        .threshold_item_handle(item_id)
                        .ok_or_else(|| format!("threshold item {item_id} is not materialized"))?,
                    target_id: target_location_id,
                    ..CwGatePredicate::default()
                }
            }
            ThresholdPredicate::MinimumCharges { item_id, amount } => CwGatePredicate {
                kind: CW_GATE_PREDICATE_MINIMUM_CHARGES,
                amount: *amount,
                subject_id: self
                    .threshold_item_handle(item_id)
                    .ok_or_else(|| format!("threshold item {item_id} is not materialized"))?,
                ..CwGatePredicate::default()
            },
            ThresholdPredicate::ActorTag { tag_id } => {
                let fact_id = threshold_kernel_id(&format!("actor-tag:{tag_id}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_ACTOR_FACT,
                        fact_id,
                        expected_value: 1,
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::ActorTag {
                            tag_id: tag_id.clone(),
                        },
                    )),
                ));
            }
            ThresholdPredicate::ClockStatus { clock_id, status } => {
                let fact_id = threshold_kernel_id(&format!("clock-status:{clock_id}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_WORLD_FACT,
                        subject_id: threshold_kernel_id(clock_id),
                        fact_id,
                        expected_value: threshold_kernel_id(status),
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::ClockStatus {
                            clock_id: clock_id.clone(),
                            status: status.clone(),
                        },
                    )),
                ));
            }
            ThresholdPredicate::JobStatus { job_id, status } => {
                let fact_id = threshold_kernel_id(&format!("job-status:{job_id}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_WORLD_FACT,
                        subject_id: threshold_kernel_id(job_id),
                        fact_id,
                        expected_value: threshold_kernel_id(status),
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::JobStatus {
                            job_id: job_id.clone(),
                            status: status.clone(),
                        },
                    )),
                ));
            }
            ThresholdPredicate::MinimumStanding { faction_id, .. } => {
                return Err(format!(
                    "threshold standing {faction_id} has no authoritative runtime projection"
                ))
            }
            ThresholdPredicate::BondState { actor_id, state } => {
                let target_actor_id = self
                    .threshold_actor_handle(actor_id)
                    .ok_or_else(|| format!("threshold actor {actor_id} is not materialized"))?;
                let fact_id = threshold_kernel_id(&format!("bond-state:{actor_id}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_ACTOR_FACT,
                        fact_id,
                        expected_value: threshold_kernel_id(state),
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::BondState {
                            target_actor_id,
                            state: state.clone(),
                        },
                    )),
                ));
            }
            ThresholdPredicate::AccessGrant { grant_id } => {
                let fact_id = threshold_kernel_id(&format!("access-grant:{grant_id}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_ACTOR_FACT,
                        fact_id,
                        expected_value: 1,
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::AccessGrant {
                            grant_id: grant_id.clone(),
                        },
                    )),
                ));
            }
            ThresholdPredicate::PerActorClaim { claim_id } => {
                let fact_id = threshold_kernel_id(&format!("actor-claim:{claim_id}"));
                return Ok((
                    CwGatePredicate {
                        kind: CW_GATE_PREDICATE_ACTOR_FACT,
                        fact_id,
                        expected_value: 1,
                        ..CwGatePredicate::default()
                    },
                    Some((
                        fact_id,
                        ThresholdFactSource::PerActorClaim {
                            claim_id: claim_id.clone(),
                        },
                    )),
                ));
            }
        };
        Ok((compiled, None))
    }

    fn compile_threshold_methods(
        &self,
        gate: &ThresholdGate,
        default_location_id: u64,
    ) -> Result<CompiledThresholdMethods, String> {
        let mut compiled = Vec::with_capacity(gate.methods.len());
        let mut names = BTreeMap::new();
        let mut contracts = BTreeMap::new();
        let mut facts = BTreeMap::new();
        for method in &gate.methods {
            let method_id = threshold_kernel_id(&format!("{}:{}", gate.id, method.id));
            let mut definition = CwGateMethodDefinition {
                id: method_id,
                ..CwGateMethodDefinition::default()
            };
            for predicate in &method.requirements.clauses {
                let (predicate, fact) =
                    self.compile_threshold_predicate(predicate, default_location_id)?;
                definition.predicates[definition.predicate_count] = predicate;
                definition.predicate_count += 1;
                if let Some((fact_id, source)) = fact {
                    facts.insert(fact_id, source);
                }
            }
            names.insert(method_id, method.id.clone());
            if let Some(contract) = &method.offer {
                contracts.insert(method_id, contract.clone());
            }
            compiled.push(definition);
        }
        Ok((compiled, names, contracts, facts))
    }

    pub(crate) fn ensure_seed_threshold_gates(&mut self) {
        for pack in &active_content().manifest.packs {
            let Some(catalog) = parse_catalog(pack).unwrap_or_else(|error| panic!("{error}"))
            else {
                continue;
            };
            for authored in &catalog.gates {
                let hazard_sources = catalog
                    .hazards
                    .iter()
                    .filter_map(|hazard| {
                        let mechanics = hazard.mechanics.as_ref()?;
                        (mechanics.gate_id == authored.id).then_some(ThresholdHazardSource {
                            descriptor_id: hazard.id.clone(),
                            descriptor_version: hazard.version,
                            pack_id: pack.id.clone(),
                            pack_version: pack.version.clone(),
                            pack_integrity: pack.integrity.clone(),
                            scope: hazard.scope.clone(),
                            tells: hazard.tells.clone(),
                            severity: hazard.severity.clone(),
                            mechanics: mechanics.clone(),
                            consequences: hazard.consequences.clone(),
                        })
                    })
                    .collect::<Vec<_>>();
                let targets = match authored.target_ref.kind.as_str() {
                    "route" => {
                        let route = self
                            .routes
                            .values()
                            .find(|route| {
                                route.id == authored.target_ref.id
                                    || route.canonical_id == authored.target_ref.id
                            })
                            .unwrap_or_else(|| {
                                panic!(
                                    "threshold route {} is not materialized",
                                    authored.target_ref.id
                                )
                            });
                        route
                            .edges
                            .iter()
                            .filter(|edge| {
                                self.world.exits[..self.world.exit_count]
                                    .iter()
                                    .any(|exit| {
                                        exit.from_location_id == edge.from_location_id
                                            && exit.to_location_id == edge.to_location_id
                                    })
                            })
                            .map(|edge| {
                                (
                                    CW_GATE_TARGET_EXIT,
                                    edge.from_location_id,
                                    edge.to_location_id,
                                    0,
                                    edge.flags,
                                )
                            })
                            .collect::<Vec<_>>()
                    }
                    "item" => {
                        let item_id = self
                            .threshold_item_handle(&authored.target_ref.id)
                            .unwrap_or_else(|| {
                                panic!(
                                    "threshold item {} is not materialized",
                                    authored.target_ref.id
                                )
                            });
                        vec![(CW_GATE_TARGET_CONTAINER, 0, 0, item_id, 0)]
                    }
                    target_kind => panic!(
                        "threshold gate {} targets unsupported {target_kind}",
                        authored.id
                    ),
                };
                for (target_kind, from_location_id, to_location_id, target_item_id, flags) in
                    targets
                {
                    let gate_id = threshold_kernel_id(&format!(
                        "{}:{from_location_id}:{to_location_id}:{target_item_id}",
                        authored.id
                    ));
                    let (methods, method_names, method_contracts, facts) = self
                        .compile_threshold_methods(authored, from_location_id)
                        .unwrap_or_else(|error| panic!("threshold gate {}: {error}", authored.id));
                    self.threshold_gate_sources
                        .entry(gate_id)
                        .or_insert_with(|| ThresholdGateSource {
                            descriptor_id: authored.id.clone(),
                            descriptor_version: authored.version,
                            pack_id: pack.id.clone(),
                            pack_version: pack.version.clone(),
                            pack_integrity: pack.integrity.clone(),
                            scope: authored.scope.clone(),
                            transition: authored.transition.clone(),
                            target: authored.target_ref.clone(),
                            methods: method_names,
                            method_contracts,
                            hazards: hazard_sources.clone(),
                            facts,
                        });
                    if self.world.gates[..self.world.gate_count]
                        .iter()
                        .any(|gate| gate.id == gate_id)
                    {
                        continue;
                    }
                    let scope = match authored.scope.as_str() {
                        "world" => CW_GATE_SCOPE_WORLD,
                        "actor" => CW_GATE_SCOPE_ACTOR,
                        "expedition" => CW_GATE_SCOPE_EXPEDITION,
                        "holder" => CW_GATE_SCOPE_HOLDER,
                        _ => unreachable!("validated threshold scope"),
                    };
                    let gate = CwGate {
                        id: gate_id,
                        version: u64::from(authored.version),
                        descriptor_version: u32::from(THRESHOLD_SCHEMA_VERSION),
                        target_kind,
                        scope,
                        state: CW_GATE_STATE_CLOSED,
                        compatibility: if flags & CW_EXIT_LOCKED != 0 {
                            CW_GATE_COMPAT_RECORDED_LOCK
                        } else {
                            CW_GATE_COMPAT_NONE
                        },
                        from_location_id,
                        to_location_id,
                        target_item_id,
                        ..CwGate::default()
                    };
                    let status = unsafe {
                        cw_world_set_gate(&mut *self.world, &gate, methods.as_ptr(), methods.len())
                    };
                    assert_eq!(
                        status, CW_OK,
                        "threshold gate {} did not compile into the kernel",
                        authored.id
                    );
                }
            }
        }
    }

    pub(crate) fn threshold_method_offers_for_exit_with_access(
        &self,
        actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
        access: &AccessContext,
    ) -> Vec<ProjectedThresholdMethod> {
        let Some(gate) = self.world.gates[..self.world.gate_count]
            .iter()
            .find(|gate| {
                gate.target_kind == CW_GATE_TARGET_EXIT
                    && gate.from_location_id == from_location_id
                    && gate.to_location_id == to_location_id
            })
        else {
            return Vec::new();
        };
        let mut gate_state = CwGateDecision::default();
        if unsafe {
            cw_gate_evaluate(
                &*self.world,
                gate.id,
                actor_id,
                std::ptr::null(),
                0,
                0,
                &mut gate_state,
            )
        } != CW_OK
            || (gate_state.allowed != 0 && gate_state.method_id == 0)
        {
            return Vec::new();
        }
        let Some(source) = self.threshold_gate_sources.get(&gate.id) else {
            return Vec::new();
        };
        self.world.gate_methods[gate.method_start..gate.method_start + gate.method_count]
            .iter()
            .filter_map(|method| {
                let contract = source.method_contracts.get(&method.id)?.clone();
                let method_name = source.methods.get(&method.id)?.clone();
                let facts = self.threshold_facts_for_method(gate, method, actor_id, access);
                let mut decision = CwGateDecision::default();
                if unsafe {
                    cw_gate_evaluate(
                        &*self.world,
                        gate.id,
                        actor_id,
                        facts.as_ptr(),
                        facts.len(),
                        method.id,
                        &mut decision,
                    )
                } != CW_OK
                {
                    return None;
                }
                let already_resolved = self.world.gate_claims
                    [..self.world.gate_claim_count]
                    .iter()
                    .any(|claim| {
                        claim.gate_id == gate.id
                            && claim.actor_id == actor_id
                            && claim.method_id == method.id
                            && claim.reserved[0] == CW_GATE_CLAIM_OUTCOME_FAILED_METHOD
                    });
                let allowed = decision.allowed != 0 && !already_resolved;
                let disabled_reason = if already_resolved {
                    Some(
                        "This method already resolved against the current threshold; choose another method."
                            .to_string(),
                    )
                } else if decision.allowed == 0 {
                    Some(format!(
                        "Requires {}.",
                        contract.requirement.trim_end_matches(['.', '!', '?'])
                    ))
                } else {
                    None
                };
                let hazards = self.threshold_hazard_player_views_for_method(
                    source,
                    actor_id,
                    &method_name,
                    &contract.consequence,
                );
                Some(ProjectedThresholdMethod {
                    binding: ThresholdOfferBinding {
                        actor_id,
                        gate_id: decision.gate_id,
                        method_id: decision.method_id,
                        gate_version: decision.gate_version,
                        access_revision: decision.access_revision,
                        evidence_digest: decision.evidence_digest,
                        facts,
                    },
                    offer: ThresholdMethodOfferView {
                        component: "gate".to_string(),
                        descriptor_id: source.descriptor_id.clone(),
                        descriptor_version: source.descriptor_version,
                        method: method_name,
                        method_id: method.id,
                        target: source.target.clone(),
                        requirement: contract.requirement,
                        economy: contract.economy,
                        resolution: contract.resolution,
                        effect: contract.effect,
                        consequence: contract.consequence,
                        hazards,
                    },
                    allowed,
                    disabled_reason,
                })
            })
            .collect()
    }

    pub(crate) fn threshold_method_action_offers(
        &self,
        actor_id: u64,
        access: &AccessContext,
    ) -> Vec<RankedActionOffer> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let state_revision = self.current_state_revision();
        let mut offers = Vec::new();
        for exit in self
            .exit_views(Some(actor_id), actor.location_id, access)
            .into_iter()
            .filter(|exit| exit.distance <= 1 && exit.threshold.is_some())
        {
            for projected in self.threshold_method_offers_for_exit_with_access(
                actor_id,
                actor.location_id,
                exit.destination_location_id,
                access,
            ) {
                let source = self
                    .threshold_gate_sources
                    .get(&projected.binding.gate_id)
                    .expect("projected threshold method has source authority");
                let method_label = source
                    .method_contracts
                    .get(&projected.binding.method_id)
                    .map(|contract| contract.label.as_str())
                    .unwrap_or(projected.offer.method.as_str());
                let target = ActionTargetView {
                    kind: "location".to_string(),
                    id: Some(exit.destination_location_id),
                    label: Some(exit.route_label.clone()),
                };
                let command = normalize_command_text(&format!(
                    "open {} with {}",
                    exit.route_label, method_label
                ));
                let mut disabled_reason = projected.disabled_reason.clone();
                if !exit.accessible {
                    disabled_reason = Some("The destination is not accessible.".to_string());
                }
                let disabled = !projected.allowed || !exit.accessible;
                let mut offer = self.ranked_offer_from_parts(
                    "open",
                    method_label,
                    &command,
                    action_offer_rank("open"),
                    disabled,
                    disabled_reason,
                    Some(target.clone()),
                    None,
                    Some(projected.offer.consequence.clone()),
                    Some(projected.offer.effect.clone()),
                    None,
                    "authored threshold method projected from current kernel evidence",
                );
                let local_id = format!(
                    "open:{}:{}:{}",
                    projected.binding.gate_id,
                    projected.binding.method_id,
                    exit.destination_location_id
                );
                offer.id = local_id.clone();
                offer.offer_id = format!(
                    "{}:{}:{}",
                    active_content().manifest.rules_profile,
                    state_revision,
                    local_id
                );
                offer.intention = "open".to_string();
                offer.category = "interaction".to_string();
                offer.verb = "Open".to_string();
                offer.label = method_label.to_string();
                offer.accessible_label = format!("Open {} with {}", exit.route_label, method_label);
                offer.source = "threshold_descriptor+kernel_evidence".to_string();
                offer.provider = action_provider(
                    "worldpack",
                    format!(
                        "threshold:{}@{}",
                        source.descriptor_id, source.descriptor_version
                    ),
                    "Authored threshold",
                    format!(
                        "Method authored by {} {}",
                        source.pack_id, source.pack_version
                    ),
                    20,
                );
                offer.route = Some(RouteOfferBinding {
                    route_id: exit.route_id.clone(),
                    route_version: exit.route_version,
                    directionality: self
                        .routes
                        .get(&exit.route_id)
                        .map(|route| route.directionality)
                        .unwrap_or_default(),
                    fallback_location_id: self
                        .routes
                        .get(&exit.route_id)
                        .and_then(|route| route.fallback_location_id),
                    threshold: Some(projected.binding),
                });
                offer.threshold_method = Some(projected.offer);
                offer.composition_trace.target = Some(target);
                offer.ranked_hand_eligible = true;
                offers.push(offer);
            }
        }
        offers
    }

    pub(crate) fn plan_threshold_method_offer_action(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
    ) -> Result<CwAction, String> {
        if offer.kind != "open" || !action_offer_is_reachable(offer) {
            return Err("Open needs a current enabled threshold method offer.".to_string());
        }
        let method = offer
            .threshold_method
            .as_ref()
            .ok_or_else(|| "Open is missing its authored method contract.".to_string())?;
        let binding = offer
            .route
            .as_ref()
            .and_then(|route| route.threshold.as_ref())
            .ok_or_else(|| "Open is missing its exact kernel binding.".to_string())?;
        if binding.actor_id != actor_id || binding.method_id != method.method_id {
            return Err("Open method binding no longer matches this actor.".to_string());
        }
        let source = self
            .threshold_gate_sources
            .get(&binding.gate_id)
            .ok_or_else(|| "Open method authority is no longer mounted.".to_string())?;
        let transition = match source.transition.as_str() {
            "open" | "unlock" | "cross" | "unseal" => CW_GATE_TRANSITION_OPEN,
            "install" => CW_GATE_TRANSITION_INSTALL,
            "consume" => CW_GATE_TRANSITION_EXHAUST,
            _ => return Err("Open method has an unsupported transition.".to_string()),
        };
        let gate = self.world.gates[..self.world.gate_count]
            .iter()
            .find(|gate| gate.id == binding.gate_id)
            .ok_or_else(|| "Open target is no longer present.".to_string())?;
        let kernel_method = self.world.gate_methods
            [gate.method_start..gate.method_start + gate.method_count]
            .iter()
            .find(|candidate| candidate.id == binding.method_id)
            .ok_or_else(|| "Open method is no longer present.".to_string())?;
        let item_id = if matches!(
            transition,
            CW_GATE_TRANSITION_INSTALL | CW_GATE_TRANSITION_EXHAUST
        ) {
            self.world.gate_predicates[kernel_method.predicate_start
                ..kernel_method.predicate_start + kernel_method.predicate_count]
                .iter()
                .find(|predicate| {
                    matches!(
                        predicate.kind,
                        CW_GATE_PREDICATE_HELD_ITEM
                            | CW_GATE_PREDICATE_INSTALLED_ITEM
                            | CW_GATE_PREDICATE_MINIMUM_CHARGES
                    )
                })
                .map(|predicate| predicate.subject_id)
                .filter(|item_id| *item_id != 0)
                .ok_or_else(|| {
                    "Open transition requires one exact authored item binding.".to_string()
                })?
        } else {
            0
        };
        let mut action = CwAction {
            kind: CW_ACTION_GATE_TRANSITION,
            actor_id,
            item_id,
            ..CwAction::default()
        };
        bind_threshold_action(&mut action, binding)?;
        action.threshold.transition = transition;
        match &method.resolution {
            ThresholdMethodResolution::Certain => {
                action.threshold.reserved[0] = CW_GATE_METHOD_RESOLUTION_CERTAIN;
            }
            ThresholdMethodResolution::ExistingKernelOutcome { .. } => {
                action.threshold.reserved[0] = CW_GATE_METHOD_RESOLUTION_EXISTING_KERNEL_OUTCOME;
            }
            ThresholdMethodResolution::SrdCheck { ability, dc, .. } => {
                action.threshold.reserved[0] = CW_GATE_METHOD_RESOLUTION_SRD_CHECK;
                action.ability = ability_from_string(ability.as_str());
                action.dc = dc.to_owned();
            }
            ThresholdMethodResolution::ConsequenceAvoidanceCheck { ability, dc, .. } => {
                action.threshold.reserved[0] =
                    CW_GATE_METHOD_RESOLUTION_CONSEQUENCE_AVOIDANCE_CHECK;
                action.ability = ability_from_string(ability.as_str());
                action.dc = dc.to_owned();
            }
        }
        if !self.threshold_action_is_current_and_allowed(&action) {
            return Err("Open method evidence is no longer current.".to_string());
        }
        Ok(action)
    }
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
        method_contract: None,
        hazards: Vec::new(),
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

    fn install_holder_gate(runtime: &mut RuntimeWorld) -> (u64, u64) {
        let gate_id = threshold_kernel_id("test:gate/holder-threshold");
        let method_id = threshold_kernel_id("test:gate/holder-threshold:present-token");
        let gate = CwGate {
            id: gate_id,
            version: 1,
            descriptor_version: 1,
            target_kind: CW_GATE_TARGET_EXIT,
            scope: CW_GATE_SCOPE_HOLDER,
            state: CW_GATE_STATE_CLOSED,
            from_location_id: COSY_COTTAGE_LOCATION_ID,
            to_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            ..CwGate::default()
        };
        let mut method = CwGateMethodDefinition {
            id: method_id,
            predicate_count: 1,
            ..CwGateMethodDefinition::default()
        };
        method.predicates[0] = CwGatePredicate {
            kind: CW_GATE_PREDICATE_HELD_ITEM,
            subject_id: HEARTH_TONIC_ITEM_ID,
            ..CwGatePredicate::default()
        };
        assert_eq!(
            unsafe { cw_world_set_gate(&mut *runtime.world, &gate, &method, 1) },
            CW_OK
        );
        runtime.threshold_gate_sources.insert(
            gate_id,
            ThresholdGateSource {
                descriptor_id: "test:gate/holder-threshold".to_string(),
                descriptor_version: 1,
                pack_id: "test".to_string(),
                pack_version: "1.0.0".to_string(),
                pack_integrity: "sha256:test".to_string(),
                scope: "holder".to_string(),
                transition: "cross".to_string(),
                target: ThresholdTargetRef {
                    kind: "route".to_string(),
                    id: "test:route/cottage-garden".to_string(),
                    version: 1,
                },
                methods: BTreeMap::from([(method_id, "present_token".to_string())]),
                method_contracts: BTreeMap::new(),
                hazards: Vec::new(),
                facts: BTreeMap::new(),
            },
        );
        (gate_id, method_id)
    }

    fn method_offer_contract(
        label: &str,
        requirement: &str,
        resolution: ThresholdMethodResolution,
        consequence: &str,
    ) -> ThresholdMethodOfferContract {
        ThresholdMethodOfferContract {
            schema_version: 1,
            procedure: "open_v1".to_string(),
            label: label.to_string(),
            requirement: requirement.to_string(),
            economy: ThresholdMethodEconomy {
                played_time_turns: 1,
            },
            resolution,
            effect: "The garden threshold opens.".to_string(),
            consequence: consequence.to_string(),
        }
    }

    fn concrete_method_hazard(runtime: &RuntimeWorld) -> ThresholdHazardSource {
        let danger_clock_id = runtime
            .clocks
            .iter()
            .find(|(_, clock)| clock.filled < clock.segments)
            .map(|(id, _)| id)
            .expect("seed clock")
            .clone();
        ThresholdHazardSource {
            descriptor_id: "test:hazard/concrete-methods".to_string(),
            descriptor_version: 1,
            pack_id: "test".to_string(),
            pack_version: "1.0.0".to_string(),
            pack_integrity: "sha256:test".to_string(),
            scope: "actor".to_string(),
            tells: vec!["A hair-thin wire shines beside the latch.".to_string()],
            severity: "major".to_string(),
            mechanics: ThresholdHazardMechanics {
                schema_version: 1,
                resolution_version: HAZARD_RESOLUTION_VERSION.to_string(),
                gate_id: "test:gate/concrete-methods".to_string(),
                initial_state: "armed".to_string(),
                states: HAZARD_STATES
                    .iter()
                    .map(|state| state.to_string())
                    .collect(),
                mechanism: ThresholdHazardMechanism {
                    text: "Latch pressure draws the wire across a spring needle.".to_string(),
                    reveal_methods: vec!["search".to_string(), "study".to_string()],
                },
                trigger_bindings: vec![
                    ThresholdHazardTriggerBinding {
                        id: "key_turn".to_string(),
                        act: "turn".to_string(),
                        gate_method: "use_exact_key".to_string(),
                        from_states: vec!["armed".to_string()],
                        target_policy: "acting_actor".to_string(),
                        maximum_targets: 1,
                        on_success_state: "bypassed".to_string(),
                        on_failure_state: None,
                        consequence_on: "never".to_string(),
                    },
                    ThresholdHazardTriggerBinding {
                        id: "tool_slip".to_string(),
                        act: "interact".to_string(),
                        gate_method: "use_fine_tools".to_string(),
                        from_states: vec!["armed".to_string()],
                        target_policy: "holder".to_string(),
                        maximum_targets: 1,
                        on_success_state: "disarmed".to_string(),
                        on_failure_state: Some("triggered".to_string()),
                        consequence_on: "failure".to_string(),
                    },
                ],
            },
            consequences: vec![ThresholdEffect::AdvanceClock {
                target_id: danger_clock_id,
                amount: 1,
            }],
        }
    }

    fn install_concrete_method_gate(runtime: &mut RuntimeWorld) -> (u64, u64, u64) {
        let destination_location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        assert!(runtime.world.exits[..runtime.world.exit_count]
            .iter()
            .any(|exit| {
                exit.from_location_id == COSY_COTTAGE_LOCATION_ID
                    && exit.to_location_id == destination_location_id
            }));
        let gate_id = threshold_kernel_id("test:gate/concrete-methods");
        let key_method_id = threshold_kernel_id("test:gate/concrete-methods:exact-key");
        let tool_method_id = threshold_kernel_id("test:gate/concrete-methods:fine-tools");
        let gate = CwGate {
            id: gate_id,
            version: 1,
            descriptor_version: 1,
            target_kind: CW_GATE_TARGET_EXIT,
            scope: CW_GATE_SCOPE_HOLDER,
            state: CW_GATE_STATE_CLOSED,
            from_location_id: COSY_COTTAGE_LOCATION_ID,
            to_location_id: destination_location_id,
            ..CwGate::default()
        };
        let mut key_method = CwGateMethodDefinition {
            id: key_method_id,
            predicate_count: 1,
            ..CwGateMethodDefinition::default()
        };
        key_method.predicates[0] = CwGatePredicate {
            kind: CW_GATE_PREDICATE_HELD_ITEM,
            subject_id: HEARTH_TONIC_ITEM_ID,
            ..CwGatePredicate::default()
        };
        let mut tool_method = CwGateMethodDefinition {
            id: tool_method_id,
            predicate_count: 1,
            ..CwGateMethodDefinition::default()
        };
        tool_method.predicates[0] = CwGatePredicate {
            kind: CW_GATE_PREDICATE_HELD_ITEM,
            subject_id: DEWBRIGHT_BUTTON_ITEM_ID,
            ..CwGatePredicate::default()
        };
        let methods = [key_method, tool_method];
        assert_eq!(
            unsafe {
                cw_world_set_gate(&mut *runtime.world, &gate, methods.as_ptr(), methods.len())
            },
            CW_OK
        );
        let hazard = concrete_method_hazard(runtime);
        runtime.threshold_gate_sources.insert(
            gate_id,
            ThresholdGateSource {
                descriptor_id: "test:gate/concrete-methods".to_string(),
                descriptor_version: 1,
                pack_id: "test".to_string(),
                pack_version: "1.0.0".to_string(),
                pack_integrity: "sha256:test".to_string(),
                scope: "holder".to_string(),
                transition: "open".to_string(),
                target: ThresholdTargetRef {
                    kind: "route".to_string(),
                    id: "test:route/cottage-visible-edge".to_string(),
                    version: 1,
                },
                methods: BTreeMap::from([
                    (key_method_id, "use_exact_key".to_string()),
                    (tool_method_id, "use_fine_tools".to_string()),
                ]),
                method_contracts: BTreeMap::from([
                    (
                        key_method_id,
                        method_offer_contract(
                            "Use the exact key",
                            "Carry the exact key.",
                            ThresholdMethodResolution::Certain,
                            "The exact key turns quietly with no additional consequence.",
                        ),
                    ),
                    (
                        tool_method_id,
                        method_offer_contract(
                            "Work with fine tools",
                            "Carry a set of fine tools.",
                            ThresholdMethodResolution::SrdCheck {
                                rules_action: "Use an Object".to_string(),
                                ability: "dexterity".to_string(),
                                dc: i16::MAX as u16,
                            },
                            "The tools slip, consume time, and cannot be tried again immediately.",
                        ),
                    ),
                ]),
                hazards: vec![hazard],
                facts: BTreeMap::new(),
            },
        );
        (gate_id, key_method_id, tool_method_id)
    }

    fn hold_seed_item(runtime: &mut RuntimeWorld, actor_id: u64, item_id: u64) {
        let item = runtime.world.items[..runtime.world.item_count]
            .iter_mut()
            .find(|item| item.id == item_id)
            .expect("seed threshold item");
        item.holder_actor_id = actor_id;
        item.location_id = 0;
        item.zone = CW_CARD_ZONE_CARRIED;
    }

    fn bind_threshold(
        action: &mut CwAction,
        runtime: &RuntimeWorld,
        gate_id: u64,
        method_id: u64,
        transition: u8,
    ) {
        let mut decision = CwGateDecision::default();
        assert_eq!(
            unsafe {
                cw_gate_evaluate(
                    &*runtime.world,
                    gate_id,
                    action.actor_id,
                    std::ptr::null(),
                    0,
                    method_id,
                    &mut decision,
                )
            },
            CW_OK
        );
        assert_eq!(decision.allowed, 1);
        action.threshold = CwThresholdInput {
            gate_id,
            method_id,
            expected_gate_version: decision.gate_version,
            expected_access_revision: decision.access_revision,
            expected_evidence_digest: decision.evidence_digest,
            transition,
            ..CwThresholdInput::default()
        };
    }

    fn install_projection_fact_gate(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
    ) -> (u64, String, String, String) {
        let from_location_id = COSY_COTTAGE_LOCATION_ID;
        let to_location_id = 11;
        assert!(runtime.world.exits[..runtime.world.exit_count]
            .iter()
            .any(|exit| {
                exit.from_location_id == from_location_id && exit.to_location_id == to_location_id
            }));
        let job = runtime.jobs.values().next().expect("seed threshold job");
        let job_id = job.id.clone();
        let job_status = job.status.clone();
        let tag_id = "test:tag/threshold-ready".to_string();
        let grant_id = "test:grant/threshold-pass".to_string();
        runtime.tags.insert(
            tag_id.clone(),
            RpgTagState {
                id: tag_id.clone(),
                scope: "actor".to_string(),
                scope_id: actor_id,
                label: "Threshold ready".to_string(),
                kind: "state".to_string(),
                active: true,
                source_event_seq: Some(77),
                expires: None,
            },
        );

        let gate_id = threshold_kernel_id("test:gate/projection-facts");
        let method_id = threshold_kernel_id("test:gate/projection-facts:qualify");
        let tag_fact_id = threshold_kernel_id(&format!("actor-tag:{tag_id}"));
        let job_fact_id = threshold_kernel_id(&format!("job-status:{job_id}"));
        let grant_fact_id = threshold_kernel_id(&format!("access-grant:{grant_id}"));
        let gate = CwGate {
            id: gate_id,
            version: 1,
            descriptor_version: 1,
            target_kind: CW_GATE_TARGET_EXIT,
            scope: CW_GATE_SCOPE_ACTOR,
            state: CW_GATE_STATE_CLOSED,
            from_location_id,
            to_location_id,
            ..CwGate::default()
        };
        let mut method = CwGateMethodDefinition {
            id: method_id,
            predicate_count: 3,
            ..CwGateMethodDefinition::default()
        };
        method.predicates[0] = CwGatePredicate {
            kind: CW_GATE_PREDICATE_ACTOR_FACT,
            fact_id: tag_fact_id,
            expected_value: 1,
            ..CwGatePredicate::default()
        };
        method.predicates[1] = CwGatePredicate {
            kind: CW_GATE_PREDICATE_WORLD_FACT,
            subject_id: threshold_kernel_id(&job_id),
            fact_id: job_fact_id,
            expected_value: threshold_kernel_id(&job_status),
            ..CwGatePredicate::default()
        };
        method.predicates[2] = CwGatePredicate {
            kind: CW_GATE_PREDICATE_ACTOR_FACT,
            fact_id: grant_fact_id,
            expected_value: 1,
            ..CwGatePredicate::default()
        };
        assert_eq!(
            unsafe { cw_world_set_gate(&mut *runtime.world, &gate, &method, 1) },
            CW_OK
        );
        runtime.threshold_gate_sources.insert(
            gate_id,
            ThresholdGateSource {
                descriptor_id: "test:gate/projection-facts".to_string(),
                descriptor_version: 1,
                pack_id: "test".to_string(),
                pack_version: "1.0.0".to_string(),
                pack_integrity: "sha256:test".to_string(),
                scope: "actor".to_string(),
                transition: "cross".to_string(),
                target: ThresholdTargetRef {
                    kind: "route".to_string(),
                    id: "test:route/projection-facts".to_string(),
                    version: 1,
                },
                methods: BTreeMap::from([(method_id, "qualify".to_string())]),
                method_contracts: BTreeMap::new(),
                hazards: Vec::new(),
                facts: BTreeMap::from([
                    (
                        tag_fact_id,
                        ThresholdFactSource::ActorTag {
                            tag_id: tag_id.clone(),
                        },
                    ),
                    (
                        job_fact_id,
                        ThresholdFactSource::JobStatus {
                            job_id: job_id.clone(),
                            status: job_status.clone(),
                        },
                    ),
                    (
                        grant_fact_id,
                        ThresholdFactSource::AccessGrant {
                            grant_id: grant_id.clone(),
                        },
                    ),
                ]),
            },
        );
        (gate_id, tag_id, job_id, grant_id)
    }

    #[test]
    fn kernel_threshold_receipts_snapshot_and_claim_retries_are_exact() {
        let mut runtime = Box::new(RuntimeWorld::seeded());
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Token Holder");
        create_test_human(&mut runtime, 5001, COSY_COTTAGE_LOCATION_ID, "Companion");
        let item_index = runtime.world.items[..runtime.world.item_count]
            .iter()
            .position(|item| item.id == HEARTH_TONIC_ITEM_ID)
            .expect("seed threshold item");
        runtime.world.items[item_index].holder_actor_id = 5000;
        runtime.world.items[item_index].location_id = 0;
        runtime.world.items[item_index].zone = CW_CARD_ZONE_CARRIED;
        let (gate_id, method_id) = install_holder_gate(&mut runtime);

        let (holder_offer, holder_allowed) = runtime
            .threshold_offer_binding_for_exit(
                5000,
                COSY_COTTAGE_LOCATION_ID,
                RAIN_SOFT_GARDEN_LOCATION_ID,
            )
            .expect("holder threshold offer");
        let (_, companion_allowed) = runtime
            .threshold_offer_binding_for_exit(
                5001,
                COSY_COTTAGE_LOCATION_ID,
                RAIN_SOFT_GARDEN_LOCATION_ID,
            )
            .expect("companion threshold offer");
        assert!(holder_allowed);
        assert!(!companion_allowed);

        let mut route_binding = runtime
            .route_offer_binding(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("route binding");
        route_binding.threshold = Some(holder_offer);
        assert!(runtime.route_binding_is_current(&route_binding));
        runtime.world.items[item_index].holder_actor_id = 5001;
        assert!(!runtime.route_binding_is_current(&route_binding));
        runtime.world.items[item_index].holder_actor_id = 5000;

        let (_, tag_id, job_id, _legacy_grant_id) =
            install_projection_fact_gate(&mut runtime, 5000);
        let access = AccessContext::default();
        let (projection_offer, projection_allowed) = runtime
            .threshold_offer_binding_for_exit_with_access(
                5000,
                COSY_COTTAGE_LOCATION_ID,
                11,
                &access,
            )
            .expect("projection threshold offer");
        assert!(projection_allowed);
        let mut projected_move = CwAction {
            kind: CW_ACTION_MOVE,
            actor_id: 5000,
            destination_location_id: 11,
            ..CwAction::default()
        };
        projected_move.threshold = CwThresholdInput {
            gate_id: projection_offer.gate_id,
            method_id: projection_offer.method_id,
            expected_gate_version: projection_offer.gate_version,
            expected_access_revision: projection_offer.access_revision,
            expected_evidence_digest: projection_offer.evidence_digest,
            fact_count: projection_offer.facts.len(),
            ..CwThresholdInput::default()
        };
        projected_move.threshold.facts[..projection_offer.facts.len()]
            .copy_from_slice(&projection_offer.facts);
        assert!(runtime.threshold_action_is_current_and_allowed(&projected_move));
        let mut projection_route = runtime
            .route_offer_binding(COSY_COTTAGE_LOCATION_ID, 11)
            .expect("projection route binding");
        projection_route.threshold = Some(projection_offer);
        runtime.tags.get_mut(&tag_id).expect("threshold tag").active = false;
        unsafe { cw_world_access_changed(&mut *runtime.world) };
        assert!(!runtime.route_binding_is_current(&projection_route));
        assert!(!runtime.threshold_action_is_current_and_allowed(&projected_move));
        assert!(
            !runtime
                .threshold_offer_binding_for_exit_with_access(
                    5000,
                    COSY_COTTAGE_LOCATION_ID,
                    11,
                    &access
                )
                .expect("closed tag threshold")
                .1
        );
        runtime.tags.get_mut(&tag_id).expect("threshold tag").active = true;
        runtime.jobs.get_mut(&job_id).expect("threshold job").status = "changed".to_string();
        unsafe { cw_world_access_changed(&mut *runtime.world) };
        assert!(
            !runtime
                .threshold_offer_binding_for_exit_with_access(
                    5000,
                    COSY_COTTAGE_LOCATION_ID,
                    11,
                    &access
                )
                .expect("closed job threshold")
                .1
        );

        let mut exhaust = CwAction {
            kind: CW_ACTION_GATE_TRANSITION,
            actor_id: 5000,
            item_id: HEARTH_TONIC_ITEM_ID,
            ..CwAction::default()
        };
        bind_threshold(
            &mut exhaust,
            &runtime,
            gate_id,
            method_id,
            CW_GATE_TRANSITION_EXHAUST,
        );
        let mut record = JournalRecord::new(exhaust, 70_589);
        runtime.bind_threshold_intent(&mut record);
        record.orb_deltas.push(OrbDelta {
            actor_id: 5000,
            delta: 2,
            reason: "threshold-test-reward".to_string(),
        });
        assert!(threshold_record_preconditions_hold(&record));
        assert_eq!(
            serde_json::to_value(&record)
                .expect("serialize threshold journal")
                .pointer("/threshold_intent/intent_version")
                .and_then(serde_json::Value::as_str),
            Some(THRESHOLD_INTENT_VERSION)
        );

        let balance_before = runtime.orb_balance(5000);
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "gate.transition.applied"));
        assert_eq!(runtime.orb_balance(5000), balance_before + 2);
        assert_eq!(runtime.world.gate_claim_count, 1);
        let tick_after_first_apply = runtime.world.tick;
        let sequence_after_first_apply = runtime.world.next_event_seq;

        let (retry_status, retry_events) = runtime.apply_journal_record(&record);
        assert_eq!(retry_status, CW_OK);
        assert!(retry_events.is_empty());
        assert_eq!(runtime.orb_balance(5000), balance_before + 2);
        assert_eq!(runtime.world.tick, tick_after_first_apply);
        assert_eq!(runtime.world.next_event_seq, sequence_after_first_apply);

        let restored = Box::new(
            RuntimeSnapshot::from_runtime(&runtime)
                .into_runtime()
                .expect("threshold authority restores"),
        );
        assert_eq!(
            &restored.world.gates[..restored.world.gate_count],
            &runtime.world.gates[..runtime.world.gate_count]
        );
        assert_eq!(
            &restored.world.gate_methods[..restored.world.gate_method_count],
            &runtime.world.gate_methods[..runtime.world.gate_method_count]
        );
        assert_eq!(
            &restored.world.gate_predicates[..restored.world.gate_predicate_count],
            &runtime.world.gate_predicates[..runtime.world.gate_predicate_count]
        );
        assert_eq!(
            &restored.world.gate_claims[..restored.world.gate_claim_count],
            &runtime.world.gate_claims[..runtime.world.gate_claim_count]
        );
        assert_eq!(
            restored.threshold_gate_sources,
            runtime.threshold_gate_sources
        );
        assert_eq!(restored.orb_balance(5000), balance_before + 2);
    }

    #[test]
    fn concrete_methods_have_one_certified_offer_and_surface_parity() {
        let mut runtime = Box::new(RuntimeWorld::seeded());
        create_test_human(
            &mut runtime,
            5_100,
            COSY_COTTAGE_LOCATION_ID,
            "Method Tester",
        );
        hold_seed_item(&mut runtime, 5_100, HEARTH_TONIC_ITEM_ID);
        let (_, key_method_id, tool_method_id) = install_concrete_method_gate(&mut runtime);
        runtime.mark_route_discovered_for_edge(
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            5_100,
            1,
            "threshold-method-test",
        );
        let access = AccessContext::default();

        let projected = runtime.threshold_method_offers_for_exit_with_access(
            5_100,
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            &access,
        );
        assert_eq!(
            projected.len(),
            2,
            "kernel methods must project independently"
        );
        let exit = runtime
            .exit_views(Some(5_100), COSY_COTTAGE_LOCATION_ID, &access)
            .into_iter()
            .find(|exit| exit.destination_location_id == RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("visible fixture edge");
        assert!(exit.threshold.is_some());
        assert!(
            exit.distance <= 1,
            "threshold methods require an adjacent edge"
        );
        let offers = runtime.threshold_method_action_offers(5_100, &access);
        assert_eq!(offers.len(), 2);
        let key_offer = offers
            .iter()
            .find(|offer| {
                offer
                    .threshold_method
                    .as_ref()
                    .is_some_and(|method| method.method_id == key_method_id)
            })
            .expect("exact-key offer");
        let tool_offer = offers
            .iter()
            .find(|offer| {
                offer
                    .threshold_method
                    .as_ref()
                    .is_some_and(|method| method.method_id == tool_method_id)
            })
            .expect("fine-tools offer");
        let key_hazard = &key_offer
            .threshold_method
            .as_ref()
            .expect("method contract")
            .hazards[0];
        assert_eq!(
            key_hazard.tells,
            vec!["A hair-thin wire shines beside the latch."]
        );
        assert!(key_hazard.mechanism.is_none());
        let developer_hazard = runtime
            .threshold_hazard_developer_views(5_100)
            .into_iter()
            .find(|hazard| hazard.descriptor_id == "test:hazard/concrete-methods")
            .expect("developer Hazard contract");
        assert!(developer_hazard.mechanism.contains("spring needle"));
        assert_eq!(developer_hazard.state, "armed");
        assert!(!key_offer.disabled);
        assert!(key_offer.cost.is_none());
        assert_eq!(
            key_offer
                .threshold_method
                .as_ref()
                .expect("method contract")
                .resolution,
            ThresholdMethodResolution::Certain
        );
        assert!(key_offer
            .threshold_method
            .as_ref()
            .expect("method contract")
            .consequence
            .contains("quietly"));
        assert!(tool_offer.disabled);
        assert!(tool_offer.disabled_reason.is_some());

        let planned = runtime
            .plan_threshold_method_offer_action(5_100, key_offer)
            .expect("exact-key action");
        assert_eq!(planned.kind, CW_ACTION_GATE_TRANSITION);
        assert_eq!(
            planned.threshold.reserved[0],
            CW_GATE_METHOD_RESOLUTION_CERTAIN
        );

        let terminal = runtime
            .resolve_command(
                &CommandRequest {
                    actor_id: 5_100,
                    actor_session: None,
                    command: "open".to_string(),
                    offer_id: None,
                    wallet_session: None,
                    envelope: None,
                },
                &access,
            )
            .expect("terminal open");
        let CommandDispatch::OpenThreshold {
            action: terminal_action,
        } = terminal.dispatch
        else {
            panic!("terminal must dispatch the exact threshold action");
        };
        assert_eq!(
            serde_json::to_value(*terminal_action).expect("terminal action"),
            serde_json::to_value(planned).expect("planned action")
        );

        let dealt_key_offer = (0..64)
            .find_map(|generation| {
                runtime.hand_generations.insert(5_100, generation);
                let (_, candidates) = runtime.legal_action_candidates(Some(5_100), &access);
                let hand = runtime.action_hand_for(Some(5_100), &candidates);
                candidates.into_iter().find(|offer| {
                    hand.entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
                        && offer
                            .threshold_method
                            .as_ref()
                            .is_some_and(|method| method.method_id == key_method_id)
                })
            })
            .expect("exact key threshold offer is dealt within a bounded rotation");
        let api = runtime
            .resolve_command_submission(
                &CommandRequest {
                    actor_id: 5_100,
                    actor_session: None,
                    command: String::new(),
                    offer_id: Some(dealt_key_offer.offer_id.clone()),
                    wallet_session: None,
                    envelope: None,
                },
                &access,
                None,
                None,
            )
            .expect("API offer submission");
        let CommandDispatch::OpenThreshold { action: api_action } = api.dispatch else {
            panic!("API must dispatch the exact threshold action");
        };
        assert_eq!(
            serde_json::to_value(*api_action).expect("API action"),
            serde_json::to_value(planned).expect("planned action")
        );

        let actor = runtime.actor_by_id(5_100).expect("method actor");
        let resident_record = runtime
            .resident_record_for_shared_offer(actor, key_offer, 71_591)
            .expect("resident inference uses the shared offer");
        assert_eq!(
            serde_json::to_value(resident_record.action).expect("resident action"),
            serde_json::to_value(planned).expect("planned action")
        );

        let mut record = JournalRecord::new(planned, 71_592);
        runtime.bind_threshold_intent(&mut record);
        let frozen_intent = record.threshold_intent.as_ref().expect("frozen intent");
        assert!(frozen_intent.method_contract.is_some());
        assert_eq!(frozen_intent.hazards.len(), 1);
        assert_eq!(frozen_intent.hazards[0].trigger_id, "key_turn");
        assert_eq!(frozen_intent.hazards[0].target_actor_ids, vec![5_100]);
        assert!(!frozen_intent.hazards[0].mechanism_revealed);
        let mut malformed_contract = record.clone();
        malformed_contract
            .threshold_intent
            .as_mut()
            .and_then(|intent| intent.method_contract.as_mut())
            .expect("frozen contract")
            .label
            .clear();
        assert!(!threshold_record_preconditions_hold(&malformed_contract));
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "gate.transition.applied"));
        assert!(events
            .iter()
            .any(|event| event.type_name == "threshold.method.resolved"));
        let hazard_event = events
            .iter()
            .find(|event| event.type_name == "threshold.hazard.resolved")
            .expect("Hazard resolution event");
        let hazard_payload: serde_json::Value =
            serde_json::from_str(hazard_event.content.as_deref().expect("Hazard payload"))
                .expect("JSON Hazard payload");
        assert_eq!(hazard_payload["state_before"], "armed");
        assert_eq!(hazard_payload["state_after"], "bypassed");
        assert_eq!(hazard_payload["trigger_id"], "key_turn");
        assert!(hazard_payload["mechanism"].is_null());
        assert_eq!(
            runtime
                .threshold_hazard_states
                .get("test:hazard/concrete-methods:5100")
                .expect("Hazard state")
                .state,
            "bypassed"
        );
        assert!(runtime
            .threshold_method_action_offers(5_100, &access)
            .is_empty());
        assert!(runtime
            .legal_action_candidates(Some(5_100), &access)
            .1
            .iter()
            .any(|offer| {
                offer.kind == "move"
                    && action_offer_is_reachable(offer)
                    && offer.target.as_ref().and_then(|target| target.id)
                        == Some(RAIN_SOFT_GARDEN_LOCATION_ID)
            }));
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("Hazard state snapshot restores");
        assert_eq!(
            restored.threshold_hazard_states,
            runtime.threshold_hazard_states
        );
    }

    #[test]
    fn explicit_study_evidence_reveals_the_mechanism_without_a_passive_roll() {
        let mut runtime = Box::new(RuntimeWorld::seeded());
        create_test_human(
            &mut runtime,
            5_102,
            COSY_COTTAGE_LOCATION_ID,
            "Hazard Student",
        );
        hold_seed_item(&mut runtime, 5_102, HEARTH_TONIC_ITEM_ID);
        install_concrete_method_gate(&mut runtime);
        runtime.mark_route_discovered_for_edge(
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            5_102,
            1,
            "threshold-hazard-study",
        );
        let access = AccessContext::default();
        assert!(runtime
            .threshold_method_action_offers(5_102, &access)
            .iter()
            .find_map(|offer| offer.threshold_method.as_ref())
            .and_then(|method| method.hazards.first())
            .is_some_and(|hazard| hazard.mechanism.is_none()));

        let study_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_STUDY,
                actor_id: 5_102,
                ..CwAction::default()
            },
            71_590,
        );
        let check = runtime.append_async_job_event("ability_check.rolled", 5_102, None, None);
        let evidence_events =
            runtime.apply_threshold_hazard_evidence_projection(&study_record, &[check]);
        assert!(evidence_events
            .iter()
            .any(|event| event.type_name == "tag.applied"));
        assert!(runtime
            .threshold_method_action_offers(5_102, &access)
            .iter()
            .find_map(|offer| offer.threshold_method.as_ref())
            .and_then(|method| method.hazards.first())
            .and_then(|hazard| hazard.mechanism.as_ref())
            .is_some_and(|mechanism| mechanism.contains("spring needle")));
    }

    #[test]
    fn failed_checked_method_consumes_time_and_disables_identical_retry() {
        let mut runtime = Box::new(RuntimeWorld::seeded());
        create_test_human(&mut runtime, 5_101, COSY_COTTAGE_LOCATION_ID, "Tool Tester");
        hold_seed_item(&mut runtime, 5_101, HEARTH_TONIC_ITEM_ID);
        hold_seed_item(&mut runtime, 5_101, DEWBRIGHT_BUTTON_ITEM_ID);
        let (gate_id, _, tool_method_id) = install_concrete_method_gate(&mut runtime);
        runtime.mark_route_discovered_for_edge(
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            5_101,
            1,
            "threshold-method-test",
        );
        let access = AccessContext::default();
        let tool_offer = runtime
            .threshold_method_action_offers(5_101, &access)
            .into_iter()
            .find(|offer| {
                offer
                    .threshold_method
                    .as_ref()
                    .is_some_and(|method| method.method_id == tool_method_id)
            })
            .expect("enabled fine-tools offer");
        assert!(!tool_offer.disabled);
        let action = runtime
            .plan_threshold_method_offer_action(5_101, &tool_offer)
            .expect("fine-tools action");
        assert_eq!(
            action.threshold.reserved[0],
            CW_GATE_METHOD_RESOLUTION_SRD_CHECK
        );
        assert_eq!(action.dc, i16::MAX as u16);

        let mut record = JournalRecord::new(action, 71_593);
        runtime.bind_threshold_intent(&mut record);
        let frozen_hazard = record
            .threshold_intent
            .as_ref()
            .and_then(|intent| intent.hazards.first())
            .expect("frozen tool Hazard")
            .clone();
        let danger_clock_id = match &frozen_hazard.consequences[0] {
            ThresholdEffect::AdvanceClock { target_id, .. } => target_id.clone(),
            _ => panic!("test Hazard consequence must advance a clock"),
        };
        let danger_before = runtime.clocks[&danger_clock_id].filled;
        let mut altered_roll = record.clone();
        altered_roll.action.roll_mode = CW_ROLL_ADVANTAGE;
        assert!(!threshold_record_preconditions_hold(&altered_roll));
        let tick_before = runtime.world.tick;
        let access_before = runtime.world.access_revision;
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| { event.type_name == "ability_check.rolled" && !event.success }));
        assert!(!events
            .iter()
            .any(|event| event.type_name == "gate.transition.applied"));
        assert!(events
            .iter()
            .any(|event| event.type_name == "threshold.method.resolved"));
        let hazard_event = events
            .iter()
            .find(|event| event.type_name == "threshold.hazard.resolved")
            .expect("failed tool Hazard resolution");
        assert!(!hazard_event.success);
        let payload: serde_json::Value =
            serde_json::from_str(hazard_event.content.as_deref().expect("Hazard payload"))
                .expect("JSON Hazard payload");
        assert_eq!(payload["trigger_id"], "tool_slip");
        assert_eq!(payload["state_after"], "triggered");
        assert_eq!(payload["target_actor_ids"], serde_json::json!([5_101]));
        assert_eq!(
            runtime.clocks[&danger_clock_id].filled,
            danger_before
                .saturating_add(1)
                .min(runtime.clocks[&danger_clock_id].segments)
        );
        let hazard_state = runtime
            .threshold_hazard_states
            .get("test:hazard/concrete-methods:5101")
            .expect("triggered Hazard state")
            .clone();
        assert_eq!(hazard_state.state, "triggered");
        assert!(runtime.world.tick > tick_before);
        assert!(runtime.world.access_revision > access_before);
        assert_eq!(runtime.world.gate_claim_count, 1);
        assert_eq!(
            runtime.world.gate_claims[0].reserved[0],
            CW_GATE_CLAIM_OUTCOME_FAILED_METHOD
        );
        assert_eq!(
            runtime.world.gates[..runtime.world.gate_count]
                .iter()
                .find(|gate| gate.id == gate_id)
                .expect("concrete gate")
                .state,
            CW_GATE_STATE_CLOSED
        );
        let retried_offer = runtime
            .threshold_method_action_offers(5_101, &access)
            .into_iter()
            .find(|offer| {
                offer
                    .threshold_method
                    .as_ref()
                    .is_some_and(|method| method.method_id == tool_method_id)
            })
            .expect("failed method remains explainable");
        assert!(retried_offer.disabled);
        assert!(runtime
            .plan_threshold_method_offer_action(5_101, &retried_offer)
            .is_err());

        let retry_tick = runtime.world.tick;
        let retry_revision = runtime.world.access_revision;
        let (retry_status, retry_events) = runtime.apply_journal_record(&record);
        assert_eq!(retry_status, CW_OK);
        assert!(retry_events.is_empty());
        assert_eq!(runtime.world.tick, retry_tick);
        assert_eq!(runtime.world.access_revision, retry_revision);
        assert_eq!(
            runtime
                .threshold_hazard_states
                .get("test:hazard/concrete-methods:5101"),
            Some(&hazard_state)
        );
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
        assert_eq!(fixture.thresholds.gates.len(), 5);
        assert_eq!(fixture.thresholds.hazards[0].bypasses.len(), 1);
        assert_eq!(fixture.thresholds.pressures[0].progress.maximum, 6);
        assert_eq!(
            fixture.thresholds.leads[0].transitions[1].method,
            "build_cairn"
        );
    }

    #[test]
    fn authored_gate_methods_compile_to_bounded_kernel_predicates() {
        let runtime = RuntimeWorld::seeded();
        let fixture = fixture();
        let mut gate = fixture.thresholds.gates[4].clone();
        let item_ref = content_registry()
            .content_reference("item", HEARTH_TONIC_ITEM_ID)
            .expect("seed item canonical reference")
            .canonical_ref
            .clone();
        gate.methods[0].requirements.clauses = vec![
            ThresholdPredicate::ExactItem { item_id: item_ref },
            ThresholdPredicate::ActorTag {
                tag_id: "test:tag/ready".to_string(),
            },
            ThresholdPredicate::JobStatus {
                job_id: "test:job/threshold".to_string(),
                status: "active".to_string(),
            },
            ThresholdPredicate::AccessGrant {
                grant_id: "test:grant/pass".to_string(),
            },
        ];
        let (methods, names, contracts, facts) = runtime
            .compile_threshold_methods(&gate, COSY_COTTAGE_LOCATION_ID)
            .expect("authored methods compile");
        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].predicate_count, 4);
        assert_eq!(methods[0].predicates[0].kind, CW_GATE_PREDICATE_HELD_ITEM);
        assert_eq!(methods[0].predicates[1].kind, CW_GATE_PREDICATE_ACTOR_FACT);
        assert_eq!(methods[0].predicates[2].kind, CW_GATE_PREDICATE_WORLD_FACT);
        assert_eq!(methods[0].predicates[3].kind, CW_GATE_PREDICATE_ACTOR_FACT);
        assert_eq!(names.len(), 1);
        assert_eq!(contracts.len(), 1);
        assert_eq!(facts.len(), 3);
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
