use super::*;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(super) struct StateKey(pub(super) &'static str);

#[allow(dead_code)]
impl StateKey {
    pub(super) const TRANSFER_OFFERS: Self = Self("transfer_offers");
    pub(super) const GIFT_AUTO_ACCEPTS: Self = Self("gift_auto_accepts");
    pub(super) const WORLD_ITEMS: Self = Self("world_items");
    pub(super) const WORLD_EXITS: Self = Self("world_exits");
    pub(super) const WORLD_ACTORS: Self = Self("world_actors");
    pub(super) const ACTOR_META: Self = Self("actor_meta");
    pub(super) const ACTOR_RULES_FACETS: Self = Self("actor_rules_facets");
    pub(super) const ADVANCEMENT_SPENDS: Self = Self("advancement_spends");
    pub(super) const CHARM_SLOTS: Self = Self("charm_slots");
    pub(super) const EQUIPPED_CHARMS: Self = Self("equipped_charms");
    pub(super) const PREPARED_SPELLS: Self = Self("prepared_spells");
    pub(super) const LEDGER_MARKS: Self = Self("ledger_marks");
    pub(super) const RPG_CLAIMS: Self = Self("rpg_claims");
    pub(super) const TREASURE_OBJECTIVES: Self = Self("treasure_objectives");
    pub(super) const ROUTES: Self = Self("routes");
    pub(super) const CHARACTER_IDENTITIES: Self = Self("character_identities");
    pub(super) const CALLINGS: Self = Self("callings");
    pub(super) const SKILLS: Self = Self("skills");
    pub(super) const BONDS: Self = Self("bonds");
    pub(super) const EVENT_LOG: Self = Self("event_log");
    pub(super) const NEXT_EVENT_SEQ: Self = Self("next_event_seq");

    pub(super) const fn snapshot_key(self) -> &'static str {
        self.0
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub(super) struct RecordProvenance<'a> {
    pub(super) allow_legacy_generated_identity_backfill: bool,
    pub(super) historical_bundle_hash: &'a str,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub(super) struct ProjectionContext<'a> {
    pub(super) action: &'a CwAction,
    pub(super) committed_events: &'a [EventView],
    pub(super) enforce_active_contribution_contract: bool,
    pub(super) provenance: RecordProvenance<'a>,
}

impl<'a> ProjectionContext<'a> {
    pub(super) fn actor_id(&self) -> u64 {
        self.action.actor_id
    }
}

#[allow(dead_code)]
pub(super) trait DeclaredWrites {
    const WRITES: &'static [StateKey];
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ResolveTransferOffer {
    pub(super) offer_id: String,
    pub(super) status: TransferOfferStatus,
    pub(super) resolved_by_actor_id: u64,
}

impl DeclaredWrites for ResolveTransferOffer {
    const WRITES: &'static [StateKey] = &[StateKey::TRANSFER_OFFERS];
}

impl ResolveTransferOffer {
    pub(super) fn apply(&self, world: &mut RuntimeWorld, _ctx: &ProjectionContext<'_>) {
        let Some(offer) = world.transfer_offers.get_mut(&self.offer_id) else {
            return;
        };
        if offer.status == TransferOfferStatus::Pending || offer.status == self.status {
            offer.status = self.status;
            offer.resolved_by_actor_id = Some(self.resolved_by_actor_id);
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ConsumeGiftAutoAccept {
    pub(super) policy_id: String,
}

impl DeclaredWrites for ConsumeGiftAutoAccept {
    const WRITES: &'static [StateKey] = &[StateKey::GIFT_AUTO_ACCEPTS];
}

impl ConsumeGiftAutoAccept {
    pub(super) fn apply(&self, world: &mut RuntimeWorld, _ctx: &ProjectionContext<'_>) {
        if let Some(policy) = world.gift_auto_accepts.get_mut(&self.policy_id) {
            policy.consumed = true;
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetItemEquipped {
    pub(super) item_id: u64,
    pub(super) equipped: bool,
    pub(super) reason: String,
}

impl DeclaredWrites for SetItemEquipped {
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetItemEquipped {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.set_item_equipped(ctx.actor_id(), self.item_id, self.equipped, &self.reason)
    }
}

#[cfg(test)]
mod projection_write_set_tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn reshaped_variants_keep_their_journal_encoding() {
        let cases: Vec<(ProjectionMutation, Value)> = vec![
            (
                ProjectionMutation::ResolveTransferOffer(ResolveTransferOffer {
                    offer_id: "offer-1".to_string(),
                    status: TransferOfferStatus::Accepted,
                    resolved_by_actor_id: 42,
                }),
                json!({
                    "kind": "resolve_transfer_offer",
                    "offer_id": "offer-1",
                    "status": "accepted",
                    "resolved_by_actor_id": 42,
                }),
            ),
            (
                ProjectionMutation::ConsumeGiftAutoAccept(ConsumeGiftAutoAccept {
                    policy_id: "policy-1".to_string(),
                }),
                json!({
                    "kind": "consume_gift_auto_accept",
                    "policy_id": "policy-1",
                }),
            ),
            (
                ProjectionMutation::ChooseClass(projection_character::ChooseClass {
                    profile_id: "profile-1".to_string(),
                    class_id: "class-1".to_string(),
                    calling: "I mend the paths.".to_string(),
                    starting_skill_id: "lifting".to_string(),
                    actor_meta: ActorMeta {
                        name: "Rati".to_string(),
                        speech_mode: "prose".to_string(),
                        title: "Lantern Warden".to_string(),
                        description: "A keeper of small lights.".to_string(),
                    },
                    reason: "first_world_action".to_string(),
                }),
                json!({
                    "kind": "choose_class",
                    "profile_id": "profile-1",
                    "class_id": "class-1",
                    "calling": "I mend the paths.",
                    "starting_skill_id": "lifting",
                    "actor_meta": {
                        "name": "Rati",
                        "speech_mode": "prose",
                        "title": "Lantern Warden",
                        "description": "A keeper of small lights.",
                    },
                    "reason": "first_world_action",
                }),
            ),
            (
                ProjectionMutation::ReviseCalling(projection_character::ReviseCalling {
                    statement: "I mend what the rain loosens.".to_string(),
                    cost: 1,
                    reason: "advancement".to_string(),
                }),
                json!({
                    "kind": "revise_calling",
                    "statement": "I mend what the rain loosens.",
                    "cost": 1,
                    "reason": "advancement",
                }),
            ),
            (
                ProjectionMutation::DeepenBond(projection_character::DeepenBond {
                    target_actor_id: 1002,
                    claim_key: "claim-1".to_string(),
                    event_reason: "help_project".to_string(),
                    ledger_reason: "help_project".to_string(),
                }),
                json!({
                    "kind": "deepen_bond",
                    "target_actor_id": 1002,
                    "claim_key": "claim-1",
                    "event_reason": "help_project",
                    "ledger_reason": "help_project",
                }),
            ),
            (
                ProjectionMutation::ReviseBond(projection_character::ReviseBond {
                    target_actor_id: 1002,
                    statement: "We mend the same roads now.".to_string(),
                    cost: 1,
                    reason: "advancement".to_string(),
                }),
                json!({
                    "kind": "revise_bond",
                    "target_actor_id": 1002,
                    "statement": "We mend the same roads now.",
                    "cost": 1,
                    "reason": "advancement",
                }),
            ),
            (
                ProjectionMutation::SetItemEquipped(SetItemEquipped {
                    item_id: 7,
                    equipped: true,
                    reason: "equipment_configuration".to_string(),
                }),
                json!({
                    "kind": "set_item_equipped",
                    "item_id": 7,
                    "equipped": true,
                    "reason": "equipment_configuration",
                }),
            ),
            (
                ProjectionMutation::SetItemContained(projection_items::SetItemContained {
                    item_id: 13,
                    container_item_id: Some(12),
                    reason: "container_configuration".to_string(),
                }),
                json!({
                    "kind": "set_item_contained",
                    "item_id": 13,
                    "container_item_id": 12,
                    "reason": "container_configuration",
                }),
            ),
            (
                ProjectionMutation::SetCharmEquipped(projection_items::SetCharmEquipped {
                    item_id: 2003,
                    equipped: true,
                    reason: "deck_configuration".to_string(),
                }),
                json!({
                    "kind": "set_charm_equipped",
                    "item_id": 2003,
                    "equipped": true,
                    "reason": "deck_configuration",
                }),
            ),
            (
                ProjectionMutation::UnlockCharmSlot(projection_items::UnlockCharmSlot {
                    cost: 1,
                    reason: "deck_loadout".to_string(),
                }),
                json!({
                    "kind": "unlock_charm_slot",
                    "cost": 1,
                    "reason": "deck_loadout",
                }),
            ),
            (
                ProjectionMutation::UnlockCharmSlotForCharm(
                    projection_items::UnlockCharmSlotForCharm {
                        item_id: 2901,
                        cost: 1,
                        reason: "deck_loadout".to_string(),
                    },
                ),
                json!({
                    "kind": "unlock_charm_slot_for_charm",
                    "item_id": 2901,
                    "cost": 1,
                    "reason": "deck_loadout",
                }),
            ),
            (
                ProjectionMutation::SetSpellPrepared(projection_items::SetSpellPrepared {
                    item_id: 2014,
                    prepared: true,
                    reason: "spell_deck_configuration".to_string(),
                }),
                json!({
                    "kind": "set_spell_prepared",
                    "item_id": 2014,
                    "prepared": true,
                    "reason": "spell_deck_configuration",
                }),
            ),
            (
                ProjectionMutation::SetGiftAutoAccept(
                    crate::projection_ledger::SetGiftAutoAccept {
                        policy: GiftAutoAcceptPolicy {
                            id: "policy-1".to_string(),
                            recipient_actor_id: 1,
                            offered_by_actor_id: 2,
                            item_id: 3,
                            created_tick: 10,
                            expires_tick: 110,
                            consumed: false,
                        },
                    },
                ),
                json!({
                    "kind": "set_gift_auto_accept",
                    "policy": {
                        "id": "policy-1",
                        "recipient_actor_id": 1,
                        "offered_by_actor_id": 2,
                        "item_id": 3,
                        "created_tick": 10,
                        "expires_tick": 110,
                        "consumed": false,
                    },
                }),
            ),
            (
                ProjectionMutation::MarkVisitLedger(crate::projection_ledger::MarkVisitLedger {
                    category: "witness".to_string(),
                    label: "saw something happen".to_string(),
                    source_event_seq: 5,
                    reason: "chat:1:2".to_string(),
                }),
                json!({
                    "kind": "mark_visit_ledger",
                    "category": "witness",
                    "label": "saw something happen",
                    "source_event_seq": 5,
                    "reason": "chat:1:2",
                }),
            ),
            (
                ProjectionMutation::StartTreasureObjective(
                    crate::projection_ledger::StartTreasureObjective {
                        start: TreasureObjectiveStart {
                            schema_version: 1,
                            objective_id: "objective:test".to_string(),
                            actor_id: 1,
                            treasure_item_id: 2012,
                            max_turns: 48,
                        },
                    },
                ),
                json!({
                    "kind": "start_treasure_objective",
                    "start": {
                        "schema_version": 1,
                        "objective_id": "objective:test",
                        "actor_id": 1,
                        "treasure_item_id": 2012,
                        "max_turns": 48,
                    },
                }),
            ),
            (
                ProjectionMutation::SetRouteLifecycle(RouteLifecycleMutation {
                    route_id: "route:authored:1:2".to_string(),
                    expected_version: 3,
                    lifecycle: RouteLifecycle::Blocked,
                    reason: "test".to_string(),
                }),
                json!({
                    "kind": "set_route_lifecycle",
                    "route_id": "route:authored:1:2",
                    "expected_version": 3,
                    "lifecycle": "blocked",
                    "reason": "test",
                }),
            ),
        ];

        for (mutation, expected) in cases {
            let encoded = serde_json::to_value(&mutation).expect("mutation serializes");
            assert_eq!(
                encoded, expected,
                "journal encoding changed for {mutation:?}; existing journals would not replay",
            );
            let decoded: ProjectionMutation =
                serde_json::from_value(expected).expect("mutation round-trips from its encoding");
            assert_eq!(
                serde_json::to_value(&decoded).expect("re-encode"),
                serde_json::to_value(&mutation).expect("re-encode"),
            );
        }
    }

    fn changed_keys(
        world: &mut RuntimeWorld,
        apply: impl FnOnce(&mut RuntimeWorld),
    ) -> (Vec<String>, Value) {
        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        apply(world);
        let after = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        let (Value::Object(before), Value::Object(after)) = (before, after) else {
            panic!("snapshot is a JSON object");
        };
        let changed = after
            .iter()
            .filter(|(key, value)| before.get(*key) != Some(*value))
            .map(|(key, _)| key.clone())
            .collect();
        (changed, Value::Object(after))
    }

    fn assert_within_declared_writes(
        changed: &[String],
        snapshot: &Value,
        declared: &[StateKey],
        label: &str,
    ) {
        assert!(
            !changed.is_empty(),
            "{label}: fixture produced no durable change, so its write set is untested",
        );
        let allowed: Vec<&str> = declared.iter().map(|key| key.snapshot_key()).collect();
        for key in &allowed {
            assert!(
                snapshot.get(key).is_some(),
                "{label}: declared write set names `{key}`, which is not a RuntimeSnapshot field",
            );
        }
        let undeclared: Vec<&String> = changed
            .iter()
            .filter(|key| !allowed.contains(&key.as_str()))
            .collect();
        assert!(
            undeclared.is_empty(),
            "{label}: wrote undeclared projection state {undeclared:?}; declared {allowed:?}",
        );
    }

    fn context_for<'a>(action: &'a CwAction, events: &'a [EventView]) -> ProjectionContext<'a> {
        ProjectionContext {
            action,
            committed_events: events,
            enforce_active_contribution_contract: false,
            provenance: RecordProvenance {
                allow_legacy_generated_identity_backfill: false,
                historical_bundle_hash: "",
            },
        }
    }

    #[test]
    fn resolve_transfer_offer_writes_only_transfer_offers() {
        let mut world = RuntimeWorld::seeded();
        world.transfer_offers.insert(
            "offer-1".to_string(),
            TransferOfferState {
                id: "offer-1".to_string(),
                kind: TransferOfferKind::Gift,
                offered_by_actor_id: 1,
                offered_to_actor_id: 2,
                offered_item_id: 3,
                requested_item_id: None,
                created_tick: 0,
                expires_tick: 100,
                status: TransferOfferStatus::Pending,
                resolved_by_actor_id: None,
            },
        );
        let action = CwAction::default();
        let mutation = ResolveTransferOffer {
            offer_id: "offer-1".to_string(),
            status: TransferOfferStatus::Accepted,
            resolved_by_actor_id: 2,
        };

        let (changed, snapshot) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            mutation.apply(world, &ctx);
        });

        assert_eq!(
            world.transfer_offers["offer-1"].status,
            TransferOfferStatus::Accepted,
        );
        assert!(
            !changed.is_empty(),
            "expected the offer resolution to be durable"
        );
        assert_within_declared_writes(
            &changed,
            &snapshot,
            ResolveTransferOffer::WRITES,
            "ResolveTransferOffer",
        );
    }

    #[test]
    fn consume_gift_auto_accept_writes_only_gift_auto_accepts() {
        let mut world = RuntimeWorld::seeded();
        world.gift_auto_accepts.insert(
            "policy-1".to_string(),
            GiftAutoAcceptPolicy {
                id: "policy-1".to_string(),
                recipient_actor_id: 1,
                offered_by_actor_id: 2,
                item_id: 3,
                created_tick: 0,
                expires_tick: 100,
                consumed: false,
            },
        );
        let action = CwAction::default();
        let mutation = ConsumeGiftAutoAccept {
            policy_id: "policy-1".to_string(),
        };

        let (changed, snapshot) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            mutation.apply(world, &ctx);
        });

        assert!(world.gift_auto_accepts["policy-1"].consumed);
        assert_within_declared_writes(
            &changed,
            &snapshot,
            ConsumeGiftAutoAccept::WRITES,
            "ConsumeGiftAutoAccept",
        );
    }

    #[test]
    fn set_item_equipped_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        let item = world
            .world
            .items
            .iter_mut()
            .take(world.world.item_count)
            .find(|item| item.id == 2012)
            .expect("playable core item exists");
        item.holder_actor_id = 5000;
        item.location_id = 0;
        item.zone = CW_CARD_ZONE_CARRIED;
        item.container_item_id = 0;

        let action = CwAction {
            actor_id: 5000,
            ..CwAction::default()
        };
        let mutation = SetItemEquipped {
            item_id: 2012,
            equipped: true,
            reason: "equipment_configuration".to_string(),
        };

        let mut produced = Vec::new();
        let (changed, snapshot) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            produced = mutation.apply(world, &ctx);
        });

        assert!(
            produced
                .iter()
                .any(|event| event.type_name == "item.equipped"),
            "expected the equip to be applied",
        );
        assert_within_declared_writes(
            &changed,
            &snapshot,
            SetItemEquipped::WRITES,
            "SetItemEquipped",
        );
    }
}
