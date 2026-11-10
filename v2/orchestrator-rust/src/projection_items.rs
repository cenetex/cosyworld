//! Payload structs for `ProjectionMutation` variants reshaped out of inline
//! named fields, following the pattern established in `projection.rs`.
//!
//! `projection.rs` owns the shared machinery (`ProjectionContext`,
//! `DeclaredWrites`, `StateKey`) and the first three reshaped variants. New
//! reshapes land here instead, so agents working through the variant list in
//! parallel do not collide on the same file. See ADR 0008 for the rationale
//! and the hard constraints (journal encoding must not change; write sets are
//! derived from a run, not read off the source).

use super::*;
use projection::{DeclaredWrites, StateKey};

impl RuntimeWorld {}

/// `ProjectionMutation::SetItemContained`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetItemContained {
    pub(super) item_id: u64,
    pub(super) container_item_id: Option<u64>,
    pub(super) reason: String,
}

impl DeclaredWrites for SetItemContained {
    // Empirically derived: a fixture that only moves an item into a container
    // also changed `actor_rules_facets`, the same cross-cutting effect
    // `SetItemEquipped` declares. See ADR 0008.
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetItemContained {}

/// `ProjectionMutation::SetCharmEquipped`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetCharmEquipped {
    pub(super) item_id: u64,
    pub(super) equipped: bool,
    pub(super) reason: String,
}

impl DeclaredWrites for SetCharmEquipped {
    // Empirically derived: also writes `equipped_charms` (the handler's own
    // bookkeeping) and `actor_rules_facets` (the same cross-cutting effect
    // every event-appending handler here shows; see ADR 0008).
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::EQUIPPED_CHARMS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetCharmEquipped {}

/// `ProjectionMutation::UnlockCharmSlot`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct UnlockCharmSlot {
    pub(super) cost: u8,
    pub(super) reason: String,
}

impl DeclaredWrites for UnlockCharmSlot {
    // Empirically derived: also writes `actor_rules_facets`, the same
    // cross-cutting effect every event-appending handler here shows; see
    // ADR 0008.
    const WRITES: &'static [StateKey] = &[
        StateKey::ADVANCEMENT_SPENDS,
        StateKey::CHARM_SLOTS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl UnlockCharmSlot {}

/// `ProjectionMutation::UnlockCharmSlotForCharm`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct UnlockCharmSlotForCharm {
    pub(super) item_id: u64,
    pub(super) cost: u8,
    pub(super) reason: String,
}

impl DeclaredWrites for UnlockCharmSlotForCharm {
    // Empirically derived: also writes `actor_rules_facets`, the same
    // cross-cutting effect every event-appending handler here shows; see
    // ADR 0008.
    const WRITES: &'static [StateKey] = &[
        StateKey::ADVANCEMENT_SPENDS,
        StateKey::CHARM_SLOTS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl UnlockCharmSlotForCharm {}

/// `ProjectionMutation::SetSpellPrepared`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetSpellPrepared {
    pub(super) item_id: u64,
    pub(super) prepared: bool,
    pub(super) reason: String,
}

impl DeclaredWrites for SetSpellPrepared {
    // Empirically derived: also writes `prepared_spells` (the handler's own
    // bookkeeping) and `actor_rules_facets` (the same cross-cutting effect
    // every event-appending handler here shows; see ADR 0008).
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::PREPARED_SPELLS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetSpellPrepared {}
