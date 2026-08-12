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

impl ChooseClass {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &projection::ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.choose_character_class(
            ctx.actor_id(),
            &self.profile_id,
            &self.class_id,
            &self.calling,
            &self.starting_skill_id,
            &self.actor_meta,
            &self.reason,
        )
    }
}

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

impl ReviseCalling {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &projection::ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.revise_calling(ctx.actor_id(), &self.statement, self.cost, &self.reason)
    }
}

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

impl DeepenBond {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &projection::ProjectionContext<'_>,
    ) -> Vec<EventView> {
        // Mirrors the pre-reshape call site: the source event seq is read
        // before the handler runs and appends its own events.
        let source_event_seq = world.world.next_event_seq;
        world.deepen_bond_from_event(
            ctx.actor_id(),
            self.target_actor_id,
            source_event_seq,
            self.claim_key.clone(),
            &self.event_reason,
            &self.ledger_reason,
        )
    }
}

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

impl ReviseBond {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &projection::ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.revise_bond(
            ctx.actor_id(),
            self.target_actor_id,
            &self.statement,
            self.cost,
            &self.reason,
        )
    }
}

#[cfg(test)]
mod projection_character_write_set_tests {
    use super::*;
    use serde_json::Value;

    /// Local copy of `projection::projection_write_set_tests::changed_keys`.
    /// That helper is private to `projection.rs`'s test module, and this file
    /// exists precisely so parallel reshapes do not share edits to
    /// `projection.rs`; duplicating the small helper avoids reopening that
    /// file's test internals.
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

    fn assert_within_declared_writes(
        changed: &[String],
        declared: &[projection::StateKey],
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

    fn context_for<'a>(
        action: &'a CwAction,
        events: &'a [EventView],
    ) -> projection::ProjectionContext<'a> {
        projection::ProjectionContext {
            action,
            committed_events: events,
            enforce_active_contribution_contract: false,
            provenance: projection::RecordProvenance {
                allow_legacy_generated_identity_backfill: false,
                historical_bundle_hash: "",
            },
        }
    }

    #[test]
    fn choose_class_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        world.character_identities.insert(
            RATI_ACTOR_ID,
            AvatarIdentityState {
                actor_id: RATI_ACTOR_ID,
                profile_id: "test-profile".to_string(),
                species_id: "human".to_string(),
                origin_id: "wayside-inn".to_string(),
                physical_description: String::new(),
                class_id: None,
                class_selection_ready: true,
                qualifying_world_actions: 1,
                class_source_event_seq: None,
                class_readiness_evidence: None,
            },
        );
        let action = CwAction {
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        };
        // A starting skill with a known label exercises the skill-stepping
        // reach too, not just the identity and calling writes.
        let mutation = ChooseClass {
            profile_id: "test-profile".to_string(),
            class_id: "lantern-warden".to_string(),
            calling: "I keep the old lights burning.".to_string(),
            starting_skill_id: "lifting".to_string(),
            actor_meta: ActorMeta {
                name: "Rati".to_string(),
                speech_mode: "prose".to_string(),
                title: "Lantern Warden".to_string(),
                description: String::new(),
            },
            reason: "first_world_action".to_string(),
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
                .any(|event| event.type_name == "class.chosen"),
            "expected the class choice to be applied",
        );
        assert_eq!(
            world.character_identities[&RATI_ACTOR_ID]
                .class_id
                .as_deref(),
            Some("lantern-warden"),
        );
        assert_within_declared_writes(&changed, ChooseClass::WRITES, "ChooseClass");
    }

    #[test]
    fn revise_calling_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        // A banked, unspent ledger mark funds one advancement point, which is
        // what revise_calling's cost gate requires.
        world.ledger_marks.insert(
            "mark-1".to_string(),
            VisitLedgerMarkState {
                id: "mark-1".to_string(),
                actor_id: RATI_ACTOR_ID,
                category: "test".to_string(),
                label: "Test bank".to_string(),
                source_event_seq: 0,
                banked: true,
            },
        );
        let action = CwAction {
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        };
        let mutation = ReviseCalling {
            statement: "I mend what the rain loosens.".to_string(),
            cost: CALLING_REVISION_COST,
            reason: "advancement".to_string(),
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
                .any(|event| event.type_name == "calling.revised"),
            "expected the calling revision to be applied",
        );
        assert_eq!(
            world.callings[&RATI_ACTOR_ID].statement,
            "I mend what the rain loosens.",
        );
        assert_within_declared_writes(&changed, ReviseCalling::WRITES, "ReviseCalling");
    }

    #[test]
    fn deepen_bond_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        let action = CwAction {
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        };
        let mutation = DeepenBond {
            target_actor_id: WHISKERWIND_ACTOR_ID,
            claim_key: "deepen-bond-test-claim".to_string(),
            event_reason: "help_project".to_string(),
            ledger_reason: "help_project".to_string(),
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
                .any(|event| event.type_name == "bond.deepened"),
            "expected the bond to deepen",
        );
        assert_eq!(
            world.bonds[&bond_id(RATI_ACTOR_ID, WHISKERWIND_ACTOR_ID)].strength,
            1,
        );
        assert_within_declared_writes(&changed, DeepenBond::WRITES, "DeepenBond");
    }

    #[test]
    fn revise_bond_writes_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        let id = bond_id(RATI_ACTOR_ID, WHISKERWIND_ACTOR_ID);
        world.bonds.insert(
            id.clone(),
            BondState {
                id: id.clone(),
                actor_id: RATI_ACTOR_ID,
                target_actor_id: WHISKERWIND_ACTOR_ID,
                statement: "We used to pass each other in silence.".to_string(),
                strength: 1,
                status: "active".to_string(),
                source_event_seq: Some(0),
                updated_event_seq: None,
                dialogue_status: String::new(),
                dialogue_event_seq: None,
            },
        );
        world.ledger_marks.insert(
            "mark-1".to_string(),
            VisitLedgerMarkState {
                id: "mark-1".to_string(),
                actor_id: RATI_ACTOR_ID,
                category: "test".to_string(),
                label: "Test bank".to_string(),
                source_event_seq: 0,
                banked: true,
            },
        );
        let action = CwAction {
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        };
        let mutation = ReviseBond {
            target_actor_id: WHISKERWIND_ACTOR_ID,
            statement: "We mend the same roads now.".to_string(),
            cost: BOND_REVISION_COST,
            reason: "advancement".to_string(),
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
                .any(|event| event.type_name == "bond.revised"),
            "expected the bond revision to be applied",
        );
        assert_eq!(world.bonds[&id].statement, "We mend the same roads now.");
        assert_within_declared_writes(&changed, ReviseBond::WRITES, "ReviseBond");
    }
}
