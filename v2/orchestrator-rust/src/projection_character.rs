//! Payload structs for the character-progression `ProjectionMutation`
//! variants: class selection, calling revision, and bond deepening/revision.
//!
//! This is the same reshape as `projection.rs` applied to a different batch
//! of variants — see that module's doc comment and ADR 0008 for the pattern
//! and its rationale. Payloads live in this file rather than `projection.rs`
//! so that reshaping different variants in parallel does not collide on the
//! same file.

use super::*;
// `Type::WRITES` resolves through this trait, so it must be in scope; the
// `impl` headers below spell the trait name bare rather than fully qualified
// so this import stays live outside `#[cfg(test)]` too.
use projection::DeclaredWrites;

/// `ProjectionMutation::ChooseClass`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ChooseClass {
    pub(super) profile_id: String,
    pub(super) class_id: String,
    pub(super) calling: String,
    pub(super) starting_skill_id: String,
    pub(super) actor_meta: ActorMeta,
    pub(super) reason: String,
}

impl DeclaredWrites for ChooseClass {
    const WRITES: &'static [projection::StateKey] = &[
        projection::StateKey::WORLD_ACTORS,
        projection::StateKey::ACTOR_META,
        projection::StateKey::CHARACTER_IDENTITIES,
        projection::StateKey::CALLINGS,
        projection::StateKey::SKILLS,
        // `snapshot_actor_rules_facets` embeds the current event revision, so
        // it reads as changed whenever next_event_seq moves, which every
        // event-appending handler does. See ADR 0008 and SetItemEquipped's
        // declaration in projection.rs for the same reach.
        projection::StateKey::ACTOR_RULES_FACETS,
        projection::StateKey::EVENT_LOG,
        projection::StateKey::NEXT_EVENT_SEQ,
    ];
}

impl ChooseClass {}

/// `ProjectionMutation::ReviseCalling`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ReviseCalling {
    pub(super) statement: String,
    pub(super) cost: u8,
    pub(super) reason: String,
}

impl DeclaredWrites for ReviseCalling {
    const WRITES: &'static [projection::StateKey] = &[
        projection::StateKey::CALLINGS,
        projection::StateKey::ADVANCEMENT_SPENDS,
        // See ChooseClass's declaration above: appending an event moves
        // next_event_seq, which changes the embedded revision in every
        // actor's snapshotted rules facet.
        projection::StateKey::ACTOR_RULES_FACETS,
        projection::StateKey::EVENT_LOG,
        projection::StateKey::NEXT_EVENT_SEQ,
    ];
}

impl ReviseCalling {}

/// `ProjectionMutation::DeepenBond`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct DeepenBond {
    pub(super) target_actor_id: u64,
    pub(super) claim_key: String,
    pub(super) event_reason: String,
    pub(super) ledger_reason: String,
}

impl DeclaredWrites for DeepenBond {
    const WRITES: &'static [projection::StateKey] = &[
        projection::StateKey::BONDS,
        projection::StateKey::LEDGER_MARKS,
        projection::StateKey::RPG_CLAIMS,
        // See ChooseClass's declaration above: appending an event moves
        // next_event_seq, which changes the embedded revision in every
        // actor's snapshotted rules facet.
        projection::StateKey::ACTOR_RULES_FACETS,
        projection::StateKey::EVENT_LOG,
        projection::StateKey::NEXT_EVENT_SEQ,
    ];
}

impl DeepenBond {}

/// `ProjectionMutation::ReviseBond`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ReviseBond {
    pub(super) target_actor_id: u64,
    pub(super) statement: String,
    pub(super) cost: u8,
    pub(super) reason: String,
}

impl DeclaredWrites for ReviseBond {
    const WRITES: &'static [projection::StateKey] = &[
        projection::StateKey::BONDS,
        projection::StateKey::ADVANCEMENT_SPENDS,
        // See ChooseClass's declaration above: appending an event moves
        // next_event_seq, which changes the embedded revision in every
        // actor's snapshotted rules facet.
        projection::StateKey::ACTOR_RULES_FACETS,
        projection::StateKey::EVENT_LOG,
        projection::StateKey::NEXT_EVENT_SEQ,
    ];
}

impl ReviseBond {}
