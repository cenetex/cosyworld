//! Payload structs for `ProjectionMutation` variants reshaped from inline
//! named fields into newtypes that own their `apply`.
//!
//! This is the same pattern as `projection.rs`: each payload declares the
//! projection state it may write via `DeclaredWrites`, and the declaration is
//! enforced by a per-mutation fixture test rather than trusted. See
//! `docs/decisions/0008-projection-mutations-declare-their-writes.md`.
//!
//! The journal-encoding pin for every variant reshaped here lives in
//! `projection::projection_write_set_tests::reshaped_variants_keep_their_journal_encoding`,
//! alongside the pins for variants reshaped elsewhere, so that guarantee stays
//! in one place.

use super::*;
use projection::{DeclaredWrites, StateKey};

/// `ProjectionMutation::SetGiftAutoAccept`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetGiftAutoAccept {
    pub(super) policy: GiftAutoAcceptPolicy,
}

impl DeclaredWrites for SetGiftAutoAccept {
    const WRITES: &'static [StateKey] = &[StateKey::GIFT_AUTO_ACCEPTS];
}

impl SetGiftAutoAccept {}

/// `ProjectionMutation::MarkVisitLedger`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct MarkVisitLedger {
    pub(super) category: String,
    pub(super) label: String,
    pub(super) source_event_seq: u64,
    pub(super) reason: String,
}

impl DeclaredWrites for MarkVisitLedger {
    // `EVENT_LOG` and `NEXT_EVENT_SEQ` because a mark appends a `ledger.marked`
    // event. `ACTOR_RULES_FACETS` is not touched directly; it appears because
    // `snapshot_actor_rules_facets` re-stamps every active facet's
    // `last_saved_at_revision` from `next_event_seq` on every snapshot, so any
    // handler that advances `next_event_seq` perturbs it too. Same surprise the
    // ADR documents for `SetItemEquipped`.
    const WRITES: &'static [StateKey] = &[
        StateKey::LEDGER_MARKS,
        StateKey::RPG_CLAIMS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl MarkVisitLedger {}

/// `ProjectionMutation::StartTreasureObjective`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct StartTreasureObjective {
    pub(super) start: TreasureObjectiveStart,
}

impl DeclaredWrites for StartTreasureObjective {
    // `ACTOR_RULES_FACETS` is the same `next_event_seq`-revision surprise as
    // `MarkVisitLedger`: starting an objective appends a
    // `treasure_objective.started` event.
    const WRITES: &'static [StateKey] = &[
        StateKey::TREASURE_OBJECTIVES,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl StartTreasureObjective {}

/// `ProjectionMutation::SetRouteLifecycle`
///
/// The payload, `RouteLifecycleMutation`, is defined in `topology.rs` next to
/// the route model it transitions, and predates this reshape. Its
/// `DeclaredWrites` and `apply` live here instead, alongside the rest of this
/// batch, rather than in `topology.rs` or `projection.rs`.
impl DeclaredWrites for RouteLifecycleMutation {
    // `ACTOR_RULES_FACETS` is the same `next_event_seq`-revision surprise as
    // `MarkVisitLedger`: a lifecycle change that actually transitions the
    // route appends a `route.<state>` event.
    const WRITES: &'static [StateKey] = &[
        StateKey::ROUTES,
        StateKey::WORLD_EXITS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl RouteLifecycleMutation {}
