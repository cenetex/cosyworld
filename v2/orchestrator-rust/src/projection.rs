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

impl<'a> ProjectionContext<'a> {}

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

impl ResolveTransferOffer {}

/// `ProjectionMutation::ConsumeGiftAutoAccept`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ConsumeGiftAutoAccept {
    pub(super) policy_id: String,
}

impl DeclaredWrites for ConsumeGiftAutoAccept {
    const WRITES: &'static [StateKey] = &[StateKey::GIFT_AUTO_ACCEPTS];
}

impl ConsumeGiftAutoAccept {}

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

impl SetItemEquipped {}
