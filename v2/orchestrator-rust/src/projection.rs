//! Projection mutation context and declared write sets.
//!
//! `ProjectionMutation` is the write API for the projection state that lives
//! beside the deterministic kernel: the `RuntimeWorld` maps that the C world
//! does not model but that must still survive journal replay and snapshot
//! round trips. `RuntimeWorld::apply_projection_mutations` is its interpreter.
//!
//! Two things live here.
//!
//! [`ProjectionContext`] carries what every handler needs besides
//! `&mut RuntimeWorld`, so handlers take one borrow instead of a growing
//! positional argument list.
//!
//! [`DeclaredWrites`] lets a mutation payload state which projection state it
//! may touch. The declaration is an upper bound, not an exact set, and it is
//! enforced by test rather than trusted: handlers delegate through several
//! layers, so a transitive write set cannot be read off the source by hand.
//! `projection_write_set_tests` applies each mutation to a seeded world and
//! fails if anything outside the declaration changed.
//!
//! Declaring writes is worth the line it costs because the coupling is
//! otherwise invisible. `SetActorSafety` looks like it sets safety flags; it
//! also invalidates pending transfer offers and gift auto-accept policies. That
//! kind of reach is what makes moving these handlers risky, and a declared,
//! enforced write set is what makes it safe.

use super::*;

/// A durable projection field, named by its `RuntimeSnapshot` key.
///
/// Write sets are expressed in snapshot terms because the snapshot is the
/// surface that has to survive replay; a mutation that changes state outside
/// the snapshot changes nothing a restart would remember.
// Keys and context fields are consumed as the remaining variants are reshaped;
// until then some are declared but unread. Kept deliberately rather than added
// piecemeal so every reshape is a copy of one pattern.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(super) struct StateKey(pub(super) &'static str);

#[allow(dead_code)]
impl StateKey {
    pub(super) const TRANSFER_OFFERS: Self = Self("transfer_offers");
    pub(super) const GIFT_AUTO_ACCEPTS: Self = Self("gift_auto_accepts");
    pub(super) const WORLD_ITEMS: Self = Self("world_items");
    pub(super) const ACTOR_RULES_FACETS: Self = Self("actor_rules_facets");
    pub(super) const ADVANCEMENT_SPENDS: Self = Self("advancement_spends");
    pub(super) const CHARM_SLOTS: Self = Self("charm_slots");
    pub(super) const EQUIPPED_CHARMS: Self = Self("equipped_charms");
    pub(super) const PREPARED_SPELLS: Self = Self("prepared_spells");
    /// Appending an event is itself durable projection state. Any handler that
    /// returns events writes these two, which is easy to miss by inspection and
    /// is why the declaration is derived from a run rather than from reading.
    pub(super) const EVENT_LOG: Self = Self("event_log");
    pub(super) const NEXT_EVENT_SEQ: Self = Self("next_event_seq");

    pub(super) const fn snapshot_key(self) -> &'static str {
        self.0
    }
}

/// Facts about the journal record being applied.
///
/// Live commits and replayed records take the same path; what differs is the
/// record, so these belong to the record rather than to a runtime mode.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub(super) struct RecordProvenance<'a> {
    /// Records written before `JOURNAL_RECORD_VERSION` predate generated
    /// identity binding and may backfill it.
    pub(super) allow_legacy_generated_identity_backfill: bool,
    /// The worldpack bundle hash recorded with this record.
    pub(super) historical_bundle_hash: &'a str,
}

/// Everything a projection handler needs besides `&mut RuntimeWorld`.
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

/// A mutation payload that states which projection state it may write.
///
/// This is a compile-time marker with an associated constant. It introduces no
/// dynamic dispatch: `ProjectionMutation` stays a closed enum matched
/// exhaustively in list order, which is what journal replay determinism
/// depends on.
#[allow(dead_code)]
pub(super) trait DeclaredWrites {
    const WRITES: &'static [StateKey];
}

/// `ProjectionMutation::ResolveTransferOffer`
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

/// `ProjectionMutation::ConsumeGiftAutoAccept`
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

/// `ProjectionMutation::SetItemEquipped`
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

    /// `ProjectionMutation` is `#[serde(tag = "kind")]` and is persisted inside
    /// `JournalRecord`, so its JSON is a durable wire format, not an
    /// implementation detail. Reshaping a variant from inline named fields to a
    /// newtype payload must keep that encoding byte-identical or every journal
    /// written before the change becomes unreadable.
    ///
    /// These literals are the encoding produced by the pre-reshape enum. They
    /// are the contract; if a change makes them fail, the change breaks replay.
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
        ];

        for (mutation, expected) in cases {
            let encoded = serde_json::to_value(&mutation).expect("mutation serializes");
            assert_eq!(
                encoded, expected,
                "journal encoding changed for {mutation:?}; existing journals would not replay",
            );
            // A journal is read back, not just written.
            let decoded: ProjectionMutation =
                serde_json::from_value(expected).expect("mutation round-trips from its encoding");
            assert_eq!(
                serde_json::to_value(&decoded).expect("re-encode"),
                serde_json::to_value(&mutation).expect("re-encode"),
            );
        }
    }

    /// The durable projection keys touched by applying `mutation` to `world`.
    ///
    /// Snapshot terms, because the snapshot is what a restart remembers.
    fn changed_keys(
        world: &mut RuntimeWorld,
        apply: impl FnOnce(&mut RuntimeWorld),
    ) -> Vec<String> {
        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        apply(world);
        let after = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        let (Value::Object(before), Value::Object(after)) = (before, after) else {
            panic!("snapshot is a JSON object");
        };
        after
            .into_iter()
            .filter(|(key, value)| before.get(key) != Some(value))
            .map(|(key, _)| key)
            .collect()
    }

    fn assert_within_declared_writes(changed: &[String], declared: &[StateKey], label: &str) {
        // A mutation that changed nothing satisfies containment trivially and
        // would let a wrong declaration pass. Every fixture must exercise the
        // handler for real.
        assert!(
            !changed.is_empty(),
            "{label}: fixture produced no durable change, so its write set is untested",
        );
        let allowed: Vec<&str> = declared.iter().map(|key| key.snapshot_key()).collect();
        // Every declared key must name a real snapshot field, or the
        // declaration is checking nothing.
        let snapshot = serde_json::to_value(RuntimeSnapshot::from_runtime(&RuntimeWorld::seeded()))
            .expect("snapshot serializes");
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

        let changed = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            mutation.apply(world, &ctx);
        });

        // The mutation must actually do something, or containment is vacuous.
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

        let changed = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            mutation.apply(world, &ctx);
        });

        assert!(world.gift_auto_accepts["policy-1"].consumed);
        assert_within_declared_writes(
            &changed,
            ConsumeGiftAutoAccept::WRITES,
            "ConsumeGiftAutoAccept",
        );
    }

    #[test]
    fn set_item_equipped_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        // Same fixture shape the playable-core equip tests use: the actor must
        // actually hold the item, carried, before equipping does anything.
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
        // Equipping reaches through item lookup, zone assignment, and deck
        // events. The declaration is an upper bound over that whole reach,
        // which is why it is checked rather than read off the source.
        let mutation = SetItemEquipped {
            item_id: 2012,
            equipped: true,
            reason: "equipment_configuration".to_string(),
        };

        let mut produced = Vec::new();
        let changed = changed_keys(&mut world, |world| {
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
        assert_within_declared_writes(&changed, SetItemEquipped::WRITES, "SetItemEquipped");
    }
}
