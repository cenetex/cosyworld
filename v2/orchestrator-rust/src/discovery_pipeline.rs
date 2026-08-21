use super::*;
use serde::ser::SerializeStruct;

pub(super) const DISCOVERY_PIPELINE_SCHEMA_VERSION: u8 = 1;
/// Append-only. `discovery-procedure-v2` froze a selection and deliberately
/// materialized nothing; every v2 row in the journal means "receipt only", and
/// replay must keep meaning exactly that. `v3` is the same procedure with the
/// selected item actually placed, so the two versions stay distinguishable in
/// history instead of one silently reinterpreting the other.
pub(super) const DISCOVERY_PROCEDURE_VERSION: &str = "discovery-procedure-v3";
const DISCOVERY_PROCEDURE_VERSION_RECEIPT_ONLY: &str = "discovery-procedure-v2";

/// Replay rejects a whole boot when one record fails its preconditions, so a
/// superseded procedure version has to stay *readable* forever even though
/// nothing new is minted at it. Only the current version is offered; both
/// replay.
fn discovery_procedure_version_is_supported(version: &str) -> bool {
    matches!(
        version,
        DISCOVERY_PROCEDURE_VERSION | DISCOVERY_PROCEDURE_VERSION_RECEIPT_ONLY
    )
}
pub(super) const FOCUSED_NOTICE_OFFER_KIND: &str = "focused_notice";
pub(super) const DISCOVERY_SEARCH_OFFER_KIND: &str = "search_discovery";
pub(super) const DISCOVERY_STUDY_OFFER_KIND: &str = "study_discovery";
pub(super) const DISCOVERY_SCOUT_OFFER_KIND: &str = "scout_discovery";

const DISCOVERY_EVENT_ROLL_DOMAIN: &str = "discovery-event-row";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryRuntimeSource {
    schema_version: u8,
    pack_id: String,
    pack_version: String,
    location_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    region_id: Option<String>,
    slot_id: String,
    catalog: DiscoveryAuthorityCatalog,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryClaimState {
    receipt: DiscoveryRollReceipt,
    phase: String,
    revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resolved_procedure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resolved_by_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryEventConsequence {
    table_id: String,
    table_version: u8,
    row_id: String,
    effect_kind: String,
    target_id: String,
    amount: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct AcceptedDiscoveryIntent {
    schema_version: u8,
    procedure_version: String,
    pub(super) procedure: String,
    offer_kind: String,
    actor_id: u64,
    location_id: u64,
    pack_id: String,
    pack_version: String,
    pub(super) slot_id: String,
    slot_version: u8,
    target_kind: String,
    origin_id: String,
    pub(super) claim_key: String,
    expected_revision: u64,
    phase_before: String,
    phase_after: String,
    resolution: String,
    turn_cost: u8,
    pub(super) receipt: DiscoveryRollReceipt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    consequence: Option<DiscoveryEventConsequence>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryOfferView {
    pub(super) schema_version: u8,
    pub(super) procedure_version: String,
    pub(super) procedure: String,
    pub(super) slot_id: String,
    pub(super) slot_version: u8,
    pub(super) receipt_id: String,
    pub(super) claim_key: String,
    pub(super) phase: String,
    pub(super) target_kind: String,
    pub(super) origin_id: String,
    pub(super) turn_cost: u8,
    pub(super) resolution: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct DiscoverySceneNoticeView {
    schema_version: u8,
    slot_id: String,
    slot_version: u8,
    claim_key: String,
    target_kind: String,
    origin_id: String,
    phase: String,
    tells: Vec<DiscoveryTell>,
    resolution: String,
}

impl Serialize for DiscoverySceneNoticeView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct PublicTell<'a> {
            text: &'a str,
        }

        let tells = self
            .tells
            .iter()
            .map(|tell| PublicTell {
                text: tell.text.as_str(),
            })
            .collect::<Vec<_>>();
        let mut out = serializer.serialize_struct("DiscoverySceneNoticeView", 1)?;
        out.serialize_field("tells", &tells)?;
        out.end()
    }
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct DiscoveryProcedureRequest {
    pub(super) actor_id: u64,
    pub(super) actor_session: Option<String>,
    pub(super) procedure: String,
    pub(super) slot_id: String,
    #[serde(default)]
    pub(super) receipt_id: Option<String>,
}

impl DiscoveryRuntimeSource {
    fn slot(&self) -> Option<&DiscoverySlotDefinition> {
        self.catalog
            .slots
            .iter()
            .find(|slot| slot.id == self.slot_id)
    }

    fn stocking_table(&self) -> Option<&DiscoveryStockingTable> {
        self.slot()
            .and_then(|slot| slot.stocking.table_id.as_deref())
            .and_then(|table_id| {
                self.catalog
                    .stocking_tables
                    .iter()
                    .find(|table| table.id == table_id)
            })
    }

    fn event_table(&self) -> Option<&DiscoveryEventTable> {
        self.slot()
            .and_then(|slot| slot.event_table_id.as_deref())
            .and_then(|table_id| {
                self.catalog
                    .event_tables
                    .iter()
                    .find(|table| table.id == table_id)
            })
    }

    fn scope_id(&self, actor_id: u64) -> String {
        match self.slot().map(|slot| slot.scope.as_str()) {
            Some("actor") => format!("actor:{actor_id}"),
            Some("expedition") => format!("expedition:{actor_id}"),
            _ => "world".to_string(),
        }
    }

    fn server_facts(&self) -> BTreeMap<String, String> {
        let required = self
            .stocking_table()
            .map(|table| table.eligible_inputs.clone())
            .unwrap_or_else(|| vec!["worldpack_bundle_hash".to_string()]);
        required
            .into_iter()
            .filter_map(|key| {
                let value = match key.as_str() {
                    "world_seed" => {
                        format!("{}:{}", OFFICIAL_WORLD_ID, OFFICIAL_WORLD_EPOCH)
                    }
                    "worldpack_bundle_hash" => active_content().manifest.bundle_hash.clone(),
                    "region_id" => self
                        .region_id
                        .clone()
                        .unwrap_or_else(|| format!("location:{}", self.location_id)),
                    "rules_profile" => active_content().manifest.rules_profile.clone(),
                    // The authority layer inserts these fields itself.
                    "slot_id" | "slot_version" | "origin_id" | "claim_scope_id" => return None,
                    _ => return None,
                };
                Some((key, value))
            })
            .collect()
    }

    fn freeze_receipt(
        &self,
        actor_id: u64,
        existing: Option<&DiscoveryRollReceipt>,
    ) -> Result<DiscoveryRollReceipt, String> {
        freeze_discovery_receipt(
            &self.catalog,
            DiscoveryReceiptRequest {
                pack_id: &self.pack_id,
                pack_version: &self.pack_version,
                slot_id: &self.slot_id,
                scope_id: &self.scope_id(actor_id),
                server_facts: if existing.is_some() {
                    BTreeMap::new()
                } else {
                    self.server_facts()
                },
                mode: DiscoverySelectionMode::Weighted,
            },
            existing,
        )
    }

    fn freeze_consequence(
        &self,
        receipt: &DiscoveryRollReceipt,
    ) -> Option<DiscoveryEventConsequence> {
        let table = self.event_table()?;
        let weights = table.rows.iter().map(|row| row.weight).collect::<Vec<_>>();
        let row = weighted_fnv1a_index(DISCOVERY_EVENT_ROLL_DOMAIN, receipt.roll_seed, 0, &weights)
            .and_then(|index| table.rows.get(index))?;
        Some(DiscoveryEventConsequence {
            table_id: table.id.clone(),
            table_version: table.version,
            row_id: row.id.clone(),
            effect_kind: row.effect_kind.clone(),
            target_id: row.target_id.clone(),
            amount: row.amount,
        })
    }
}

fn discovery_offer_kind(procedure: &str) -> Option<&'static str> {
    match procedure {
        "notice" => Some(FOCUSED_NOTICE_OFFER_KIND),
        "search" => Some(DISCOVERY_SEARCH_OFFER_KIND),
        "study" => Some(DISCOVERY_STUDY_OFFER_KIND),
        "scout" => Some(DISCOVERY_SCOUT_OFFER_KIND),
        _ => None,
    }
}

fn discovery_action_kind(procedure: &str) -> Option<u8> {
    match procedure {
        "notice" => Some(CW_ACTION_FOCUSED_NOTICE_V2),
        "search" => Some(CW_ACTION_SEARCH_V2),
        "study" => Some(CW_ACTION_STUDY_V2),
        "scout" => Some(CW_ACTION_SCOUT_V2),
        _ => None,
    }
}

fn discovery_ability(procedure: &str) -> u8 {
    if procedure == "study" {
        CW_ABILITY_INTELLIGENCE
    } else {
        CW_ABILITY_WISDOM
    }
}

fn discovery_phase_after(procedure: &str) -> &'static str {
    if procedure == "notice" {
        "lead"
    } else {
        "revealed"
    }
}

fn discovery_target_label(receipt: &DiscoveryRollReceipt) -> String {
    receipt
        .materialized_entity_ids
        .first()
        .and_then(|id| id.rsplit('/').next())
        .unwrap_or(receipt.target_kind.as_str())
        .replace(['-', '_'], " ")
}

impl RuntimeWorld {
    fn discovery_origin_location(&self, slot: &DiscoverySlotDefinition) -> Option<u64> {
        let (owner, path) = slot.origin_id.split_once(':')?;
        let (kind, local_id) = path.split_once('/')?;
        let canonical_ref = format!("pack://{owner}/{kind}/{local_id}");
        match kind {
            "location" => self.runtime_handle_for_canonical_ref("location", &canonical_ref),
            "item" => self
                .runtime_handle_for_canonical_ref("item", &canonical_ref)
                .and_then(|item_id| self.item_by_id(item_id))
                .and_then(|item| {
                    if item.location_id != 0 {
                        Some(item.location_id)
                    } else {
                        self.actor_by_id(item.holder_actor_id)
                            .map(|actor| actor.location_id)
                    }
                }),
            "feature" => active_content()
                .room_features
                .iter()
                .find(|feature| {
                    feature.key == local_id
                        && active_content().locations.iter().any(|location| {
                            location.id == feature.location_id && location.pack_id == owner
                        })
                })
                .map(|feature| feature.location_id),
            _ => None,
        }
    }

    pub(super) fn ensure_seed_discovery_sources(&mut self) {
        for pack in &active_content().manifest.packs {
            let Ok(Some(catalog)) = discovery_authority_catalog(pack) else {
                continue;
            };
            for slot in &catalog.slots {
                let Some(location_id) = self.discovery_origin_location(slot) else {
                    continue;
                };
                let source = DiscoveryRuntimeSource {
                    schema_version: DISCOVERY_PIPELINE_SCHEMA_VERSION,
                    pack_id: pack.id.clone(),
                    pack_version: pack.version.clone(),
                    location_id,
                    region_id: None,
                    slot_id: slot.id.clone(),
                    catalog: catalog.clone(),
                };
                self.discovery_sources
                    .entry(source.slot_id.clone())
                    .or_insert(source);
            }
        }
    }

    #[cfg(test)]
    pub(super) fn install_discovery_catalog_for_test(
        &mut self,
        catalog: DiscoveryAuthorityCatalog,
        pack_id: &str,
        pack_version: &str,
        location_id: u64,
        region_id: Option<&str>,
    ) {
        for slot in catalog.slots.clone() {
            self.discovery_sources.insert(
                slot.id.clone(),
                DiscoveryRuntimeSource {
                    schema_version: DISCOVERY_PIPELINE_SCHEMA_VERSION,
                    pack_id: pack_id.to_string(),
                    pack_version: pack_version.to_string(),
                    location_id,
                    region_id: region_id.map(str::to_string),
                    slot_id: slot.id,
                    catalog: catalog.clone(),
                },
            );
        }
    }

    fn discovery_intent(
        &self,
        actor_id: u64,
        procedure: &str,
        slot_id: &str,
    ) -> Result<AcceptedDiscoveryIntent, String> {
        let actor = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
            .ok_or_else(|| "discovery actor is unavailable".to_string())?;
        let source = self
            .discovery_sources
            .get(slot_id)
            .filter(|source| source.location_id == actor.location_id)
            .ok_or_else(|| "discovery source is not in this scene".to_string())?;
        let slot = source
            .slot()
            .ok_or_else(|| "discovery source lost its authored slot".to_string())?;
        if !slot.reveal_methods.iter().any(|method| method == procedure) {
            return Err("discovery procedure is not authored for this slot".to_string());
        }
        let offer_kind = discovery_offer_kind(procedure)
            .ok_or_else(|| "unknown discovery procedure".to_string())?;
        let initial_receipt = source.freeze_receipt(actor_id, None)?;
        let existing = self.discovery_claims.get(&initial_receipt.claim_key);
        if existing.is_some_and(|state| state.phase == "revealed")
            || (procedure == "notice"
                && existing
                    .is_some_and(|state| matches!(state.phase.as_str(), "lead" | "revealed")))
        {
            return Err("discovery claim is already resolved".to_string());
        }
        let receipt = if let Some(existing) = existing {
            source.freeze_receipt(actor_id, Some(&existing.receipt))?
        } else {
            initial_receipt
        };
        let phase_before = existing
            .map(|state| state.phase.clone())
            .unwrap_or_else(|| slot.initial_phase.clone());
        let expected_revision = existing.map(|state| state.revision).unwrap_or(0);
        let consequence = source.freeze_consequence(&receipt);
        Ok(AcceptedDiscoveryIntent {
            schema_version: DISCOVERY_PIPELINE_SCHEMA_VERSION,
            procedure_version: DISCOVERY_PROCEDURE_VERSION.to_string(),
            procedure: procedure.to_string(),
            offer_kind: offer_kind.to_string(),
            actor_id,
            location_id: source.location_id,
            pack_id: source.pack_id.clone(),
            pack_version: source.pack_version.clone(),
            slot_id: slot.id.clone(),
            slot_version: slot.version,
            target_kind: slot.target_kind.clone(),
            origin_id: slot.origin_id.clone(),
            claim_key: receipt.claim_key.clone(),
            expected_revision,
            phase_before,
            phase_after: discovery_phase_after(procedure).to_string(),
            resolution: if consequence.is_some() {
                "consequence_avoidance_check"
            } else {
                "certain"
            }
            .to_string(),
            turn_cost: 1,
            receipt,
            consequence,
        })
    }

    pub(super) fn discovery_scene_notices(&self, actor_id: u64) -> Vec<DiscoverySceneNoticeView> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        self.discovery_sources
            .values()
            .filter(|source| source.location_id == actor.location_id)
            .filter_map(|source| {
                let slot = source.slot()?;
                let initial_receipt = source.freeze_receipt(actor_id, None).ok()?;
                let existing = self.discovery_claims.get(&initial_receipt.claim_key);
                if existing.is_some_and(|state| state.phase == "revealed") {
                    return None;
                }
                let receipt = if let Some(existing) = existing {
                    source
                        .freeze_receipt(actor_id, Some(&existing.receipt))
                        .ok()?
                } else {
                    initial_receipt
                };
                Some(DiscoverySceneNoticeView {
                    schema_version: DISCOVERY_PIPELINE_SCHEMA_VERSION,
                    slot_id: slot.id.clone(),
                    slot_version: slot.version,
                    claim_key: receipt.claim_key,
                    target_kind: slot.target_kind.clone(),
                    origin_id: slot.origin_id.clone(),
                    phase: existing
                        .map(|state| state.phase.clone())
                        .unwrap_or_else(|| slot.initial_phase.clone()),
                    tells: slot.tells.clone(),
                    resolution: "automatic_obvious_truth_no_roll".to_string(),
                })
            })
            .collect()
    }

    pub(super) fn discovery_action_offers(&self, actor_id: u64) -> Vec<RankedActionOffer> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        let mut offers = Vec::new();
        for source in self
            .discovery_sources
            .values()
            .filter(|source| source.location_id == actor.location_id)
        {
            let Some(slot) = source.slot() else {
                continue;
            };
            for procedure in &slot.reveal_methods {
                let Ok(intent) = self.discovery_intent(actor_id, procedure, &slot.id) else {
                    continue;
                };
                let Some(binding) = resolved_action_binding(&intent.offer_kind) else {
                    continue;
                };
                let label = discovery_target_label(&intent.receipt);
                let target = ActionTargetView {
                    kind: intent.target_kind.clone(),
                    id: intent
                        .receipt
                        .materialized_entity_ids
                        .first()
                        .and_then(|id| {
                            let canonical = discovery_canonical_ref(id)?;
                            self.runtime_handle_for_canonical_ref(&intent.target_kind, &canonical)
                        }),
                    label: Some(label.clone()),
                };
                let state_revision = self.current_state_revision();
                let legacy_id = format!("discovery:{}:{}", intent.procedure, intent.slot_id);
                let offer_id = format!(
                    "{}:{}:{}",
                    active_content().manifest.rules_profile,
                    state_revision,
                    legacy_id
                );
                let source_collectible = self.location_source_collectible(actor_id);
                let source_card_instances =
                    source_collectible.clone().into_iter().collect::<Vec<_>>();
                let composition_trace = self.action_composition_trace(
                    Some(actor.location_id),
                    state_revision,
                    &binding,
                    ActionCompositionContributions {
                        source_card_instances,
                        target: Some(target.clone()),
                        applied_reskins: Vec::new(),
                        contextual_offers: Vec::new(),
                    },
                );
                let (verb, intention, category, rank) = match intent.procedure.as_str() {
                    "notice" => ("Notice", "notice", "inspect", 52),
                    "search" => ("Search", "inspect", "inspect", 53),
                    "study" => ("Study", "study", "inspect", 54),
                    "scout" => ("Scout", "scout", "travel", 55),
                    _ => continue,
                };
                offers.push(RankedActionOffer {
                    id: legacy_id,
                    offer_id,
                    kind: intent.offer_kind.clone(),
                    intention: intention.to_string(),
                    rules_action: binding.rules_action,
                    operation: binding.operation,
                    rules_profile: active_content().manifest.rules_profile.clone(),
                    resolver: binding.resolver,
                    source_collectible,
                    pack_provenance: ActionPackProvenanceView {
                        pack_id: binding.pack_id,
                        pack_version: binding.pack_version,
                        rules_namespace: binding.namespace,
                    },
                    composition_trace,
                    composition_id: String::new(),
                    state_revision,
                    route: None,
                    threshold_method: None,
                    discovery: Some(DiscoveryOfferView {
                        schema_version: intent.schema_version,
                        procedure_version: intent.procedure_version.clone(),
                        procedure: intent.procedure.clone(),
                        slot_id: intent.slot_id.clone(),
                        slot_version: intent.slot_version,
                        receipt_id: intent.receipt.id.clone(),
                        claim_key: intent.claim_key.clone(),
                        phase: intent.phase_before.clone(),
                        target_kind: intent.target_kind.clone(),
                        origin_id: intent.origin_id.clone(),
                        turn_cost: intent.turn_cost,
                        resolution: intent.resolution.clone(),
                    }),
                    category: category.to_string(),
                    verb: verb.to_string(),
                    label: format!("{verb} {label}"),
                    accessible_label: format!("{verb} {label}"),
                    command: format!(
                        "{} {}",
                        intent.procedure,
                        label.replace(' ', "-")
                    ),
                    rank,
                    disabled: false,
                    disabled_reason: None,
                    zone: self
                        .room_sheets
                        .get(&actor.location_id)
                        .map(room_sheet_zone)
                        .unwrap_or_else(|| default_zone_for_scope("room", actor.location_id))
                        .to_string(),
                    source: "authored_discovery_slot".to_string(),
                    provider: action_provider(
                        "discovery",
                        format!("discovery:{}", intent.slot_id),
                        "Authored discovery",
                        "Bound to one frozen discovery claim",
                        20,
                    ),
                    target: Some(target),
                    project: None,
                    cost: None,
                    risk: intent
                        .consequence
                        .as_ref()
                        .map(|value| format!("{} if the pressure check fails", value.effect_kind)),
                    effect: Some(if intent.procedure == "notice" {
                        "establishes one authored Lead without creating or taking anything"
                    } else {
                        "reveals frozen authored truth without opening, moving, taking, or awarding"
                    }
                    .to_string()),
                    progress: None,
                    claim_key: Some(intent.claim_key),
                    reason: "one slot-bound offer from the unified discovery pipeline".to_string(),
                    ranked_hand_eligible: true,
                });
            }
        }
        offers
    }

    pub(super) fn discovery_record_for_offer(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
        seed: u64,
    ) -> Result<JournalRecord, String> {
        let binding = offer
            .discovery
            .as_ref()
            .ok_or_else(|| "offer has no discovery binding".to_string())?;
        if offer.kind != discovery_offer_kind(&binding.procedure).unwrap_or_default() {
            return Err("discovery offer kind changed".to_string());
        }
        let intent = self.discovery_intent(actor_id, &binding.procedure, &binding.slot_id)?;
        if binding.receipt_id != intent.receipt.id
            || binding.claim_key != intent.claim_key
            || binding.phase != intent.phase_before
        {
            return Err("discovery offer is stale".to_string());
        }
        let action = CwAction {
            kind: discovery_action_kind(&intent.procedure)
                .ok_or_else(|| "unknown discovery procedure".to_string())?,
            actor_id,
            location_id: intent.location_id,
            ability: discovery_ability(&intent.procedure),
            dc: intent.consequence.as_ref().map(|_| LISTEN_DC).unwrap_or(0),
            ..CwAction::default()
        };
        let mut record = JournalRecord::new(action, seed);
        record.bind_offer_kind(&intent.offer_kind);
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveDiscovery { intent });
        Ok(record)
    }

    pub(super) fn discovery_record(
        &self,
        actor_id: u64,
        procedure: &str,
        slot_id: &str,
        receipt_id: Option<&str>,
        seed: u64,
    ) -> Result<JournalRecord, String> {
        let offer = self
            .discovery_action_offers(actor_id)
            .into_iter()
            .find(|offer| {
                offer.discovery.as_ref().is_some_and(|binding| {
                    binding.procedure == procedure
                        && binding.slot_id == slot_id
                        && receipt_id.is_none_or(|id| id == binding.receipt_id)
                })
            })
            .ok_or_else(|| "discovery offer is no longer available".to_string())?;
        self.discovery_record_for_offer(actor_id, &offer, seed)
    }

    pub(super) fn apply_discovery_projection(
        &mut self,
        intent: &AcceptedDiscoveryIntent,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        let after = DiscoveryClaimState {
            receipt: intent.receipt.clone(),
            phase: intent.phase_after.clone(),
            revision: intent.expected_revision.saturating_add(1),
            resolved_procedure: Some(intent.procedure.clone()),
            resolved_by_actor_id: Some(intent.actor_id),
            source_event_seq: committed_events
                .iter()
                .filter(|event| event.actor_id == Some(intent.actor_id))
                .map(|event| event.seq)
                .max(),
        };
        if self.discovery_claims.get(&intent.claim_key) == Some(&after) {
            return Vec::new();
        }
        self.discovery_claims
            .insert(intent.claim_key.clone(), after);

        let mut events = Vec::new();
        let failed_pressure_check = intent.consequence.is_some()
            && committed_events.iter().any(|event| {
                event.type_name == "ability_check.rolled"
                    && event.actor_id == Some(intent.actor_id)
                    && !event.success
            });
        if failed_pressure_check {
            if let Some(consequence) = &intent.consequence {
                events.push(self.append_async_job_event(
                    "discovery.consequence",
                    intent.actor_id,
                    None,
                    serde_json::to_string(consequence).ok(),
                ));
            }
        }
        let source_event_seq = committed_events
            .iter()
            .filter(|event| event.actor_id == Some(intent.actor_id))
            .map(|event| event.seq)
            .max()
            .unwrap_or_default();
        let (materialization, materialized_events) =
            self.materialize_discovery_result(intent, source_event_seq);
        events.extend(materialized_events);

        let content = serde_json::json!({
            "procedure_version": intent.procedure_version,
            "procedure": intent.procedure,
            "slot_id": intent.slot_id,
            "receipt_id": intent.receipt.id,
            "claim_key": intent.claim_key,
            "phase_before": intent.phase_before,
            "phase_after": intent.phase_after,
            "target_kind": intent.target_kind,
            "origin_id": intent.origin_id,
            "result_ids": intent.receipt.materialized_entity_ids,
            "materialization": materialization,
            "movement": "not_performed",
            "custody": "not_performed",
            "reward": "not_performed",
        });
        events.push(self.append_async_job_event(
            if intent.phase_after == "lead" {
                "discovery.lead"
            } else {
                "discovery.revealed"
            },
            intent.actor_id,
            None,
            serde_json::to_string(&content).ok(),
        ));
        events
    }

    /// Place the truth a discovery receipt already selected.
    ///
    /// The receipt froze *what* was found when it was minted; this turns that
    /// frozen selection into world state through the same fail-closed effect
    /// seam authored clock effects use, so the kernel stays the only authority
    /// on whether the item may appear. Returns the disposition recorded in the
    /// committed event, which never claims more than actually happened.
    fn materialize_discovery_result(
        &mut self,
        intent: &AcceptedDiscoveryIntent,
        source_event_seq: u64,
    ) -> (&'static str, Vec<EventView>) {
        if intent.procedure_version == DISCOVERY_PROCEDURE_VERSION_RECEIPT_ONLY {
            // A historical row. It meant "receipt only" when it was committed
            // and it still does; replay must not invent a placement.
            return ("not_performed", Vec::new());
        }
        if intent.phase_after != "revealed" {
            // A Lead names where to look. Nothing is found yet.
            return ("not_performed", Vec::new());
        }
        if intent.target_kind != "item" {
            // Location, route, feature, and resource slots keep their frozen
            // receipts until their own materializers exist. Saying so is more
            // useful than an empty field that reads like success.
            return ("unsupported_target_kind", Vec::new());
        }

        let effects = intent
            .receipt
            .materialized_entity_ids
            .iter()
            .filter_map(|entity_id| {
                let canonical = discovery_canonical_ref(entity_id)?;
                let item_id = self.discovery_item_handle(&canonical)?;
                Some(EffectDescriptor::RevealItem {
                    item_id,
                    location_id: intent.location_id,
                    reason: Some(format!("discovery {}", intent.slot_id)),
                })
            })
            .collect::<Vec<_>>();
        if effects.len() != intent.receipt.materialized_entity_ids.len() {
            // A selected id that no longer resolves to an authored item means
            // content moved under a frozen receipt. Fail closed and say so.
            return ("unresolved_result", Vec::new());
        }

        let events = self.apply_effects(
            EffectApplicationSource::DiscoveryMaterialization,
            intent.actor_id,
            source_event_seq,
            &effects,
        );
        let revealed = events
            .iter()
            .filter(|event| event.success && event.type_name == "item.revealed")
            .count();
        if revealed == effects.len() {
            ("revealed", events)
        } else if revealed == 0 {
            ("rejected", events)
        } else {
            ("partially_revealed", events)
        }
    }

    fn discovery_item_handle(&self, canonical_ref: &str) -> Option<u64> {
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
}

fn discovery_canonical_ref(value: &str) -> Option<String> {
    let (pack_id, path) = value.split_once(':')?;
    Some(format!("pack://{pack_id}/{path}"))
}

pub(super) fn discovery_record_preconditions_hold(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
) -> bool {
    let intents = record
        .projection_mutations
        .iter()
        .filter_map(|mutation| match mutation {
            ProjectionMutation::ResolveDiscovery { intent } => Some(intent),
            _ => None,
        })
        .collect::<Vec<_>>();
    if intents.is_empty() {
        return true;
    }
    if intents.len() != 1 {
        return false;
    }
    let intent = intents[0];
    if intent.schema_version != DISCOVERY_PIPELINE_SCHEMA_VERSION
        || !discovery_procedure_version_is_supported(&intent.procedure_version)
        || discovery_offer_kind(&intent.procedure) != Some(intent.offer_kind.as_str())
        || discovery_action_kind(&intent.procedure) != Some(record.action.kind)
        || record.action.actor_id != intent.actor_id
        || record.action.location_id != intent.location_id
        || record.action.ability != discovery_ability(&intent.procedure)
        || record.action.dc != intent.consequence.as_ref().map(|_| LISTEN_DC).unwrap_or(0)
    {
        return false;
    }
    let Some(actor) = runtime.actor_by_id(intent.actor_id) else {
        return false;
    };
    let Some(source) = runtime.discovery_sources.get(&intent.slot_id) else {
        return false;
    };
    let Some(slot) = source.slot() else {
        return false;
    };
    if actor.location_id != intent.location_id
        || source.location_id != intent.location_id
        || source.pack_id != intent.pack_id
        || source.pack_version != intent.pack_version
        || slot.version != intent.slot_version
        || slot.target_kind != intent.target_kind
        || slot.origin_id != intent.origin_id
        || !slot.reveal_methods.contains(&intent.procedure)
        || source
            .freeze_receipt(intent.actor_id, Some(&intent.receipt))
            .ok()
            .as_ref()
            != Some(&intent.receipt)
        || source.freeze_consequence(&intent.receipt) != intent.consequence
    {
        return false;
    }
    let after = DiscoveryClaimState {
        receipt: intent.receipt.clone(),
        phase: intent.phase_after.clone(),
        revision: intent.expected_revision.saturating_add(1),
        resolved_procedure: Some(intent.procedure.clone()),
        resolved_by_actor_id: Some(intent.actor_id),
        source_event_seq: runtime
            .discovery_claims
            .get(&intent.claim_key)
            .and_then(|state| state.source_event_seq),
    };
    match runtime.discovery_claims.get(&intent.claim_key) {
        None => {
            intent.expected_revision == 0
                && intent.phase_before == slot.initial_phase
                && intent.receipt.claim_key == intent.claim_key
        }
        Some(current) if current == &after => true,
        Some(current) => {
            current.receipt == intent.receipt
                && current.revision == intent.expected_revision
                && current.phase == intent.phase_before
        }
    }
}

pub(super) fn discovery_record_claim_already_applied(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
) -> bool {
    record.projection_mutations.iter().any(|mutation| {
        let ProjectionMutation::ResolveDiscovery { intent } = mutation else {
            return false;
        };
        runtime
            .discovery_claims
            .get(&intent.claim_key)
            .is_some_and(|state| {
                state.receipt == intent.receipt
                    && state.phase == intent.phase_after
                    && state.revision == intent.expected_revision.saturating_add(1)
                    && state.resolved_procedure.as_deref() == Some(intent.procedure.as_str())
                    && state.resolved_by_actor_id == Some(intent.actor_id)
            })
    })
}

pub(super) async fn discover(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<DiscoveryProcedureRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "action-actor",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }
    let plan = {
        let runtime = state.inner.lock().await;
        if !client_actor_authorized_for_state(
            &runtime,
            &state,
            payload.actor_id,
            payload.actor_session.as_deref(),
        ) {
            return client_actor_rejected_response();
        }
        if let Some(receipt_id) = payload.receipt_id.as_deref() {
            if runtime.discovery_claims.values().any(|claim| {
                claim.receipt.id == receipt_id
                    && claim.receipt.slot_id == payload.slot_id
                    && claim.phase == discovery_phase_after(&payload.procedure)
            }) {
                return Json(ActionResponse {
                    ok: true,
                    status: CW_OK,
                    events: Vec::new(),
                });
            }
        }
        runtime.discovery_record(
            payload.actor_id,
            &payload.procedure,
            &payload.slot_id,
            payload.receipt_id.as_deref(),
            runtime.next_seed_value(),
        )
    };
    let Ok(record) = plan else {
        return action_offer_rejected("That discovery claim or procedure is no longer available");
    };
    let intent = record
        .projection_mutations
        .into_iter()
        .find_map(|mutation| match mutation {
            ProjectionMutation::ResolveDiscovery { intent } => Some(intent),
            _ => None,
        })
        .expect("planned discovery record has one intent");
    apply_and_broadcast_with_mutations(
        state,
        record.action,
        payload.actor_session.as_deref(),
        vec![ProjectionMutation::ResolveDiscovery { intent }],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> DiscoveryAuthorityCatalog {
        serde_json::from_str(include_str!("../fixtures/discovery-authority-v1.json"))
            .expect("discovery fixture")
    }

    fn prepared_runtime() -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Discovery Tester",
        );
        runtime.install_discovery_catalog_for_test(
            fixture(),
            "fixture.discovery",
            "1.0.0",
            COSY_COTTAGE_LOCATION_ID,
            Some("fixture.discovery:region/mossy-verge"),
        );
        runtime
    }

    #[test]
    fn scene_notice_is_free_obvious_truth_and_never_rolls() {
        let runtime = prepared_runtime();
        let notices = runtime.discovery_scene_notices(5_000);
        assert_eq!(notices.len(), 5);
        assert!(notices
            .iter()
            .all(|notice| notice.resolution == "automatic_obvious_truth_no_roll"));
        assert!(runtime
            .event_log
            .iter()
            .all(|event| event.type_name != "ability_check.rolled"));
    }

    #[test]
    fn item_and_location_use_one_scale_specific_claim_pipeline() {
        let runtime = prepared_runtime();
        let offers = runtime.discovery_action_offers(5_000);
        let search = offers
            .iter()
            .find(|offer| {
                offer.kind == DISCOVERY_SEARCH_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.target_kind == "item")
            })
            .expect("item Search");
        let scout = offers
            .iter()
            .find(|offer| {
                offer.kind == DISCOVERY_SCOUT_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.target_kind == "location")
            })
            .expect("location Scout");
        assert_eq!(search.discovery.as_ref().unwrap().procedure, "search");
        assert_eq!(scout.discovery.as_ref().unwrap().procedure, "scout");
        assert_ne!(search.claim_key, scout.claim_key);
    }

    #[test]
    fn safe_search_reveals_without_a_roll_or_physical_side_effect() {
        let mut runtime = prepared_runtime();
        let before_items = runtime.world.items[..runtime.world.item_count].to_vec();
        let before_locations = runtime.world.locations[..runtime.world.location_count].to_vec();
        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| {
                offer.kind == DISCOVERY_SEARCH_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.target_kind == "item")
            })
            .expect("safe item Search");
        let record = runtime
            .discovery_record_for_offer(5_000, &offer, 91_001)
            .expect("record");
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .all(|event| event.type_name != "ability_check.rolled"));
        assert!(events
            .iter()
            .any(|event| event.type_name == "discovery.revealed"));
        assert_eq!(
            runtime.world.items[..runtime.world.item_count],
            before_items
        );
        assert_eq!(
            runtime.world.locations[..runtime.world.location_count],
            before_locations
        );
    }

    #[test]
    fn pressure_check_only_controls_the_frozen_consequence() {
        let mut runtime = prepared_runtime();
        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| {
                offer.kind == DISCOVERY_SEARCH_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.target_kind == "resource")
            })
            .expect("pressured Search");
        let record = runtime
            .discovery_record_for_offer(5_000, &offer, 1)
            .expect("record");
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "ability_check.rolled"));
        assert!(events
            .iter()
            .any(|event| event.type_name == "discovery.revealed"));
    }

    #[test]
    fn replay_retry_and_controller_paths_cannot_duplicate_or_reroll() {
        let mut runtime = prepared_runtime();
        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| offer.kind == DISCOVERY_SEARCH_OFFER_KIND)
            .expect("Search");
        let record = runtime
            .discovery_record_for_offer(5_000, &offer, 91_002)
            .expect("record");
        let receipt = match &record.projection_mutations[0] {
            ProjectionMutation::ResolveDiscovery { intent } => intent.receipt.clone(),
            _ => unreachable!(),
        };
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        let event_count = runtime.event_log.len();
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert_eq!(runtime.event_log.len(), event_count);
        assert_eq!(
            runtime.discovery_claims[&receipt.claim_key].receipt,
            receipt
        );
        assert!(runtime.discovery_action_offers(5_000).iter().all(|next| {
            next.discovery
                .as_ref()
                .is_none_or(|binding| binding.claim_key != receipt.claim_key)
        }));
    }

    #[test]
    fn focused_notice_disappears_after_its_authored_claim_is_exhausted() {
        let mut runtime = prepared_runtime();
        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| offer.kind == FOCUSED_NOTICE_OFFER_KIND)
            .expect("Focused Notice");
        let claim_key = offer.claim_key.clone().expect("claim");
        let record = runtime
            .discovery_record_for_offer(5_000, &offer, 91_003)
            .expect("record");
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert!(runtime.discovery_action_offers(5_000).iter().all(|next| {
            next.kind != FOCUSED_NOTICE_OFFER_KIND
                || next.claim_key.as_deref() != Some(claim_key.as_str())
        }));
    }

    #[test]
    fn actor_scoped_claims_do_not_consume_another_actors_offer() {
        let mut catalog = fixture();
        let slot = catalog
            .slots
            .iter_mut()
            .find(|slot| slot.id.ends_with("secret-door"))
            .expect("actor-scoped slot");
        slot.scope = "actor".to_string();
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "First Discovery Tester",
        );
        create_test_human(
            &mut runtime,
            5_001,
            COSY_COTTAGE_LOCATION_ID,
            "Second Discovery Tester",
        );
        runtime.install_discovery_catalog_for_test(
            catalog,
            "fixture.discovery",
            "1.0.0",
            COSY_COTTAGE_LOCATION_ID,
            Some("fixture.discovery:region/mossy-verge"),
        );
        let first = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| {
                offer.kind == FOCUSED_NOTICE_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.slot_id.ends_with("secret-door"))
            })
            .expect("first actor offer");
        let first_claim = first.claim_key.clone().expect("first actor claim");
        let record = runtime
            .discovery_record_for_offer(5_000, &first, 91_004)
            .expect("first actor record");
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        let second = runtime
            .discovery_action_offers(5_001)
            .into_iter()
            .find(|offer| {
                offer.kind == FOCUSED_NOTICE_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.slot_id.ends_with("secret-door"))
            })
            .expect("second actor still has an offer");
        assert_ne!(second.claim_key.as_deref(), Some(first_claim.as_str()));
    }

    /// A slot whose frozen selection names a real authored core item, so the
    /// receipt can actually be turned into world state. A catalog may only
    /// name entities inside its own pack, so this one is authored as core.
    fn materializing_catalog() -> DiscoveryAuthorityCatalog {
        serde_json::from_str(
            r#"{
              "schema_version": 1,
              "receipt_version": "discovery-receipt-v1",
              "roll_algorithm": "weighted-fnv1a-v1",
              "stocking_tables": [
                {
                  "id": "cosyworld.core:discovery-table/hearth-cache",
                  "version": 1,
                  "target_kind": "item",
                  "eligible_inputs": [
                    "worldpack_bundle_hash",
                    "slot_id",
                    "slot_version",
                    "origin_id",
                    "claim_scope_id"
                  ],
                  "rows": [
                    {
                      "id": "tucked_keepsake",
                      "weight": 1,
                      "result_ids": ["cosyworld.core:item/2005"]
                    }
                  ],
                  "fallback_row_id": "tucked_keepsake"
                }
              ],
              "event_tables": [],
              "presentation_tables": [],
              "slots": [
                {
                  "id": "cosyworld.core:discovery/hidden-cache",
                  "version": 1,
                  "target_kind": "item",
                  "origin_id": "cosyworld.core:feature/hollow-stone",
                  "scope": "world",
                  "initial_phase": "signed",
                  "tells": [
                    {
                      "id": "hollow_note",
                      "sense": "sight",
                      "text": "One hearthstone sits a finger proud of the rest."
                    }
                  ],
                  "reveal_methods": ["search"],
                  "claim_policy": "once_per_scope",
                  "stocking": {
                    "kind": "table",
                    "table_id": "cosyworld.core:discovery-table/hearth-cache",
                    "table_version": 1
                  },
                  "progression": { "kind": "optional" }
                }
              ]
            }"#,
        )
        .expect("materializing discovery fixture")
    }

    fn runtime_with_materializing_slot() -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Discovery Tester",
        );
        // The kernel allows one loose item per floor, and the seed cottage
        // already has one. Clear it so the reveal is testing materialization
        // rather than the capacity rule the effect seam already pins.
        runtime.hide_loose_items_at_location(COSY_COTTAGE_LOCATION_ID);
        let hidden = runtime.world.items[..runtime.world.item_count]
            .iter_mut()
            .find(|item| item.id == 2005)
            .expect("seed item 2005");
        hidden.holder_actor_id = 0;
        hidden.location_id = 0;
        hidden.zone = CW_CARD_ZONE_WORLD;
        runtime.install_discovery_catalog_for_test(
            materializing_catalog(),
            "cosyworld.core",
            "1.0.0",
            COSY_COTTAGE_LOCATION_ID,
            None,
        );
        runtime
    }

    fn hidden_cache_search_record(runtime: &mut RuntimeWorld, seed: u64) -> JournalRecord {
        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| {
                offer.discovery.as_ref().is_some_and(|binding| {
                    binding.slot_id == "cosyworld.core:discovery/hidden-cache"
                })
            })
            .expect("hidden cache Search offer");
        runtime
            .discovery_record_for_offer(5_000, &offer, seed)
            .expect("hidden cache record")
    }

    #[test]
    fn a_revealed_item_slot_places_its_frozen_selection_on_the_floor() {
        let mut runtime = runtime_with_materializing_slot();
        assert!(runtime.room_floor_empty(COSY_COTTAGE_LOCATION_ID));

        let record = hidden_cache_search_record(&mut runtime, 91_101);
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);

        assert!(events
            .iter()
            .any(|event| event.success && event.type_name == "item.revealed"));
        assert_eq!(
            runtime
                .loose_items_at_location(COSY_COTTAGE_LOCATION_ID)
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            vec![2005],
            "the selected item is placed where it was found"
        );

        let revealed = events
            .iter()
            .find(|event| event.type_name == "discovery.revealed")
            .expect("discovery.revealed");
        let content: serde_json::Value =
            serde_json::from_str(revealed.content.as_deref().expect("content"))
                .expect("discovery content");
        assert_eq!(content["materialization"], "revealed");
        // Reveal is not Take and not Travel; those stay separate operations.
        assert_eq!(content["custody"], "not_performed");
        assert_eq!(content["movement"], "not_performed");
    }

    #[test]
    fn a_historical_receipt_only_record_replays_without_materializing() {
        let mut runtime = runtime_with_materializing_slot();
        let mut record = hidden_cache_search_record(&mut runtime, 91_102);
        for mutation in &mut record.projection_mutations {
            if let ProjectionMutation::ResolveDiscovery { intent } = mutation {
                intent.procedure_version = DISCOVERY_PROCEDURE_VERSION_RECEIPT_ONLY.to_string();
            }
        }

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(
            status, CW_OK,
            "a superseded procedure version must still replay, or boot dies on it"
        );
        assert!(
            runtime.room_floor_empty(COSY_COTTAGE_LOCATION_ID),
            "a v2 row meant receipt-only when it was written and still does"
        );
        let revealed = events
            .iter()
            .find(|event| event.type_name == "discovery.revealed")
            .expect("discovery.revealed");
        let content: serde_json::Value =
            serde_json::from_str(revealed.content.as_deref().expect("content"))
                .expect("discovery content");
        assert_eq!(content["materialization"], "not_performed");
    }

    #[test]
    fn both_procedure_versions_satisfy_replay_preconditions() {
        let mut runtime = runtime_with_materializing_slot();
        let current = hidden_cache_search_record(&mut runtime, 91_103);
        assert!(discovery_record_preconditions_hold(&runtime, &current));

        let mut historical = current.clone();
        for mutation in &mut historical.projection_mutations {
            if let ProjectionMutation::ResolveDiscovery { intent } = mutation {
                intent.procedure_version = DISCOVERY_PROCEDURE_VERSION_RECEIPT_ONLY.to_string();
            }
        }
        assert!(
            discovery_record_preconditions_hold(&runtime, &historical),
            "replay rejects the whole boot when a record fails preconditions"
        );

        let mut unknown = current.clone();
        for mutation in &mut unknown.projection_mutations {
            if let ProjectionMutation::ResolveDiscovery { intent } = mutation {
                intent.procedure_version = "discovery-procedure-v99".to_string();
            }
        }
        assert!(
            !discovery_record_preconditions_hold(&runtime, &unknown),
            "an unknown procedure version is still refused"
        );
    }

    #[test]
    fn a_selection_that_no_longer_resolves_fails_closed() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Discovery Tester",
        );
        runtime.hide_loose_items_at_location(COSY_COTTAGE_LOCATION_ID);
        // The stock fixture names items that no pack authors.
        runtime.install_discovery_catalog_for_test(
            fixture(),
            "fixture.discovery",
            "1.0.0",
            COSY_COTTAGE_LOCATION_ID,
            Some("fixture.discovery:region/mossy-verge"),
        );
        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| {
                offer.kind == DISCOVERY_SEARCH_OFFER_KIND
                    && offer
                        .discovery
                        .as_ref()
                        .is_some_and(|binding| binding.target_kind == "item")
            })
            .expect("item Search");
        let record = runtime
            .discovery_record_for_offer(5_000, &offer, 91_104)
            .expect("record");
        let (status, events) = runtime.apply_journal_record(&record);

        assert_eq!(status, CW_OK);
        assert!(
            runtime.room_floor_empty(COSY_COTTAGE_LOCATION_ID),
            "an unresolvable selection materializes nothing"
        );
        let revealed = events
            .iter()
            .find(|event| event.type_name == "discovery.revealed")
            .expect("discovery.revealed");
        let content: serde_json::Value =
            serde_json::from_str(revealed.content.as_deref().expect("content"))
                .expect("discovery content");
        assert_eq!(content["materialization"], "unresolved_result");
    }

    /// The authored end of the loop: a slot shipped in the core worldpack, not
    /// a fixture. Search at Mossbell Inn finds the pair of socks the pack
    /// authors unplaced, and puts them on the floor where they were found.
    #[test]
    fn the_authored_mossbell_slot_reveals_its_hidden_item() {
        const MOSSBELL_INN_LOCATION_ID: u64 = 4;
        const DRY_WOOL_SOCKS_ITEM_ID: u64 = 2015;

        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            MOSSBELL_INN_LOCATION_ID,
            "Mossbell Guest",
        );

        // Authored unplaced: it exists in the world but is nowhere yet.
        let hidden = runtime.world.items[..runtime.world.item_count]
            .iter()
            .find(|item| item.id == DRY_WOOL_SOCKS_ITEM_ID)
            .expect("the pack authors the hidden item into the world");
        assert_eq!(hidden.location_id, 0);
        assert_eq!(hidden.holder_actor_id, 0);
        assert!(runtime.room_floor_empty(MOSSBELL_INN_LOCATION_ID));

        let offer = runtime
            .discovery_action_offers(5_000)
            .into_iter()
            .find(|offer| {
                offer.discovery.as_ref().is_some_and(|binding| {
                    binding.slot_id == "cosyworld.core:discovery/mossbell-floorboard"
                })
            })
            .expect("the authored slot deals a Search offer in its own room");
        let record = runtime
            .discovery_record_for_offer(5_000, &offer, 92_001)
            .expect("record");
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);

        assert!(events
            .iter()
            .any(|event| event.success && event.type_name == "item.revealed"));
        assert_eq!(
            runtime
                .loose_items_at_location(MOSSBELL_INN_LOCATION_ID)
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            vec![DRY_WOOL_SOCKS_ITEM_ID],
        );
        let revealed = events
            .iter()
            .find(|event| event.type_name == "discovery.revealed")
            .expect("discovery.revealed");
        let content: serde_json::Value =
            serde_json::from_str(revealed.content.as_deref().expect("content"))
                .expect("discovery content");
        assert_eq!(content["materialization"], "revealed");
    }
}
