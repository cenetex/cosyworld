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
use projection::{DeclaredWrites, ProjectionContext, StateKey};

/// `ProjectionMutation::SetGiftAutoAccept`
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetGiftAutoAccept {
    pub(super) policy: GiftAutoAcceptPolicy,
}

impl DeclaredWrites for SetGiftAutoAccept {
    const WRITES: &'static [StateKey] = &[StateKey::GIFT_AUTO_ACCEPTS];
}

impl SetGiftAutoAccept {
    pub(super) fn apply(&self, world: &mut RuntimeWorld, _ctx: &ProjectionContext<'_>) {
        world
            .gift_auto_accepts
            .insert(self.policy.id.clone(), self.policy.clone());
    }
}

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

impl MarkVisitLedger {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Option<EventView> {
        world.mark_visit_ledger(
            ctx.actor_id(),
            &self.category,
            &self.label,
            self.source_event_seq,
            &self.reason,
        )
    }
}

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

impl StartTreasureObjective {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        _ctx: &ProjectionContext<'_>,
    ) -> Option<EventView> {
        world.apply_treasure_objective_start(&self.start)
    }
}

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

impl RouteLifecycleMutation {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Option<EventView> {
        world.apply_route_lifecycle_mutation(
            ctx.actor_id(),
            &self.route_id,
            self.expected_version,
            self.lifecycle,
            &self.reason,
        )
    }
}

#[cfg(test)]
mod projection_ledger_write_set_tests {
    use super::*;
    use projection::RecordProvenance;
    use serde_json::Value;

    /// The durable projection keys touched by applying `mutation` to `world`,
    /// plus the post-mutation snapshot they were read from.
    ///
    /// A local copy of `projection::projection_write_set_tests::changed_keys`;
    /// that helper is private to its own test module, and duplicating a dozen
    /// lines here is cheaper than widening its visibility and risking a
    /// collision with the other agents reshaping adjacent variants in
    /// `projection.rs`. This copy diverges in one deliberate way: it also
    /// returns `after` so `assert_within_declared_writes` can validate field
    /// names against it instead of a freshly seeded world. Some snapshot
    /// fields (e.g. `treasure_objectives`) carry
    /// `skip_serializing_if = "BTreeMap::is_empty"`, so a field that is real
    /// but empty on a fresh world silently vanishes from its JSON and reads
    /// as "not a RuntimeSnapshot field". `after` is guaranteed non-empty for
    /// any key the fixture actually wrote.
    fn changed_keys(
        world: &mut RuntimeWorld,
        apply: impl FnOnce(&mut RuntimeWorld),
    ) -> (Vec<String>, Value) {
        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        apply(world);
        let after = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        let Value::Object(before_map) = &before else {
            panic!("snapshot is a JSON object");
        };
        let Value::Object(after_map) = &after else {
            panic!("snapshot is a JSON object");
        };
        let changed = after_map
            .iter()
            .filter(|(key, value)| before_map.get(key.as_str()) != Some(*value))
            .map(|(key, _)| key.clone())
            .collect();
        (changed, after)
    }

    fn assert_within_declared_writes(
        changed: &[String],
        after: &Value,
        declared: &[StateKey],
        label: &str,
    ) {
        // A mutation that changed nothing satisfies containment trivially and
        // would let a wrong declaration pass. Every fixture must exercise the
        // handler for real.
        assert!(
            !changed.is_empty(),
            "{label}: fixture produced no durable change, so its write set is untested",
        );
        let allowed: Vec<&str> = declared.iter().map(|key| key.snapshot_key()).collect();
        // Every declared key must name a real snapshot field, or the
        // declaration is checking nothing. Checked against `after` rather
        // than a fresh seeded snapshot; see `changed_keys`.
        for key in &allowed {
            assert!(
                after.get(key).is_some(),
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

    fn first_actor_id(world: &RuntimeWorld) -> u64 {
        world.world.actors[..world.world.actor_count][0].id
    }

    #[test]
    fn set_gift_auto_accept_writes_only_gift_auto_accepts() {
        let mut world = RuntimeWorld::seeded();
        let action = CwAction::default();
        let mutation = SetGiftAutoAccept {
            policy: GiftAutoAcceptPolicy {
                id: "policy-1".to_string(),
                recipient_actor_id: 1,
                offered_by_actor_id: 2,
                item_id: 3,
                created_tick: 0,
                expires_tick: 100,
                consumed: false,
            },
        };

        let (changed, after) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            mutation.apply(world, &ctx);
        });

        assert!(world.gift_auto_accepts.contains_key("policy-1"));
        assert_within_declared_writes(
            &changed,
            &after,
            SetGiftAutoAccept::WRITES,
            "SetGiftAutoAccept",
        );
    }

    #[test]
    fn mark_visit_ledger_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        let actor_id = first_actor_id(&world);
        let action = CwAction {
            actor_id,
            ..CwAction::default()
        };
        let mutation = MarkVisitLedger {
            category: "witness".to_string(),
            label: "saw something happen".to_string(),
            source_event_seq: 0,
            reason: "test:mark".to_string(),
        };

        let mut produced = None;
        let (changed, after) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            produced = mutation.apply(world, &ctx);
        });

        assert!(produced.is_some(), "expected the mark to be applied");
        assert!(world
            .ledger_marks
            .values()
            .any(|mark| mark.actor_id == actor_id && mark.category == "witness"),);
        assert_within_declared_writes(&changed, &after, MarkVisitLedger::WRITES, "MarkVisitLedger");
    }

    #[test]
    fn start_treasure_objective_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        let actor_id = first_actor_id(&world);
        let treasure_item_id = world.world.items[..world.world.item_count][0].id;
        let action = CwAction {
            actor_id,
            ..CwAction::default()
        };
        let mutation = StartTreasureObjective {
            start: TreasureObjectiveStart {
                schema_version: 1,
                objective_id: "objective:test".to_string(),
                actor_id,
                treasure_item_id,
                max_turns: 10,
            },
        };

        let mut produced = None;
        let (changed, after) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            produced = mutation.apply(world, &ctx);
        });

        assert!(
            produced.is_some(),
            "expected the objective start to be applied"
        );
        assert!(world.treasure_objectives.contains_key("objective:test"));
        assert_within_declared_writes(
            &changed,
            &after,
            StartTreasureObjective::WRITES,
            "StartTreasureObjective",
        );
    }

    #[test]
    fn set_route_lifecycle_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        let route_id = world
            .routes
            .values()
            .find(|route| route.lifecycle == RouteLifecycle::Open)
            .expect("seeded world has an open route")
            .id
            .clone();
        let expected_version = world.routes[&route_id].entity_version;
        let action = CwAction::default();
        let mutation = RouteLifecycleMutation {
            route_id: route_id.clone(),
            expected_version,
            lifecycle: RouteLifecycle::Blocked,
            reason: "test:block".to_string(),
        };

        let mut produced = None;
        let (changed, after) = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            produced = mutation.apply(world, &ctx);
        });

        assert!(produced.is_some(), "expected the transition to be applied");
        assert_eq!(world.routes[&route_id].lifecycle, RouteLifecycle::Blocked);
        assert_within_declared_writes(
            &changed,
            &after,
            RouteLifecycleMutation::WRITES,
            "SetRouteLifecycle",
        );
    }
}
