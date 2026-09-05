use super::*;
use projection::{DeclaredWrites, ProjectionContext, StateKey};

impl RuntimeWorld {
    pub(super) fn ensure_seed_items(&mut self) {
        for item in &active_content().items {
            let Some(kind) = seed_item_kind(item) else {
                continue;
            };
            self.ensure_item(item.id, kind, item.location_id, item.charges);
            if self.item_identity_reveals.contains_key(&item.id) {
                continue;
            }
            let (Some(role), Some(size_class)) = (seed_item_role(item), seed_item_size(item))
            else {
                continue;
            };
            let status = unsafe {
                cw_world_set_item_profile(
                    &mut *self.world,
                    item.id,
                    item.weight_tenths.max(1),
                    size_class,
                    role,
                    item.container_capacity_tenths,
                )
            };
            debug_assert_eq!(status, CW_OK);
            let (max_charges, recovery, ready_zone) = seed_item_recovery_profile(item);
            let recovery_status = unsafe {
                cw_world_set_item_recovery_profile(
                    &mut *self.world,
                    item.id,
                    max_charges,
                    recovery,
                    ready_zone,
                )
            };
            debug_assert_eq!(recovery_status, CW_OK);
            let policy_status = unsafe {
                cw_world_set_item_policy(
                    &mut *self.world,
                    item.id,
                    declared_item_policy_flags(item.mechanics.as_ref())
                        & !CW_ITEM_POLICY_CONFIGURED,
                )
            };
            debug_assert_eq!(policy_status, CW_OK);
            if role == CW_ITEM_ROLE_WEAPON {
                if let Some(world_item) = self.world.items[..self.world.item_count]
                    .iter_mut()
                    .find(|world_item| world_item.id == item.id)
                {
                    world_item.reserved = seed_weapon_die_sides(item);
                }
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetItemContained {
    pub(super) item_id: u64,
    pub(super) container_item_id: Option<u64>,
    pub(super) reason: String,
}

impl DeclaredWrites for SetItemContained {
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetItemContained {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.set_item_contained(
            ctx.actor_id(),
            self.item_id,
            self.container_item_id,
            &self.reason,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetCharmEquipped {
    pub(super) item_id: u64,
    pub(super) equipped: bool,
    pub(super) reason: String,
}

impl DeclaredWrites for SetCharmEquipped {
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::EQUIPPED_CHARMS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetCharmEquipped {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.set_charm_equipped(ctx.actor_id(), self.item_id, self.equipped, &self.reason)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct UnlockCharmSlot {
    pub(super) cost: u8,
    pub(super) reason: String,
}

impl DeclaredWrites for UnlockCharmSlot {
    const WRITES: &'static [StateKey] = &[
        StateKey::ADVANCEMENT_SPENDS,
        StateKey::CHARM_SLOTS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl UnlockCharmSlot {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.unlock_charm_slot(ctx.actor_id(), self.cost, &self.reason)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct UnlockCharmSlotForCharm {
    pub(super) item_id: u64,
    pub(super) cost: u8,
    pub(super) reason: String,
}

impl DeclaredWrites for UnlockCharmSlotForCharm {
    const WRITES: &'static [StateKey] = &[
        StateKey::ADVANCEMENT_SPENDS,
        StateKey::CHARM_SLOTS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl UnlockCharmSlotForCharm {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.unlock_charm_slot_for_charm(ctx.actor_id(), self.item_id, self.cost, &self.reason)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SetSpellPrepared {
    pub(super) item_id: u64,
    pub(super) prepared: bool,
    pub(super) reason: String,
}

impl DeclaredWrites for SetSpellPrepared {
    const WRITES: &'static [StateKey] = &[
        StateKey::WORLD_ITEMS,
        StateKey::PREPARED_SPELLS,
        StateKey::ACTOR_RULES_FACETS,
        StateKey::EVENT_LOG,
        StateKey::NEXT_EVENT_SEQ,
    ];
}

impl SetSpellPrepared {
    pub(super) fn apply(
        &self,
        world: &mut RuntimeWorld,
        ctx: &ProjectionContext<'_>,
    ) -> Vec<EventView> {
        world.set_spell_prepared(ctx.actor_id(), self.item_id, self.prepared, &self.reason)
    }
}

#[cfg(test)]
mod projection_items_write_set_tests {
    use super::*;
    use test_support::create_test_human;

    fn changed_keys(
        world: &mut RuntimeWorld,
        apply: impl FnOnce(&mut RuntimeWorld),
    ) -> Vec<String> {
        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        apply(world);
        let after = serde_json::to_value(RuntimeSnapshot::from_runtime(world))
            .expect("snapshot serializes");
        let (serde_json::Value::Object(before), serde_json::Value::Object(after)) = (before, after)
        else {
            panic!("snapshot is a JSON object");
        };
        after
            .into_iter()
            .filter(|(key, value)| before.get(key) != Some(value))
            .map(|(key, _)| key)
            .collect()
    }

    fn assert_within_declared_writes(changed: &[String], declared: &[StateKey], label: &str) {
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

    fn context_for<'a>(action: &'a CwAction, events: &'a [EventView]) -> ProjectionContext<'a> {
        ProjectionContext {
            action,
            committed_events: events,
            enforce_active_contribution_contract: false,
            provenance: projection::RecordProvenance {
                allow_legacy_generated_identity_backfill: false,
                historical_bundle_hash: "",
            },
        }
    }

    fn carry_item(world: &mut RuntimeWorld, actor_id: u64, item_id: u64) {
        let item = world
            .world
            .items
            .iter_mut()
            .take(world.world.item_count)
            .find(|item| item.id == item_id)
            .expect("playable core item exists");
        item.holder_actor_id = actor_id;
        item.location_id = 0;
        item.zone = CW_CARD_ZONE_CARRIED;
        item.container_item_id = 0;
    }

    fn grant_advancement(world: &mut RuntimeWorld, actor_id: u64, id: &str) {
        world.ledger_marks.insert(
            id.to_string(),
            VisitLedgerMarkState {
                id: id.to_string(),
                actor_id,
                category: "witness".to_string(),
                label: "Found a reason to grow".to_string(),
                source_event_seq: world.world.next_event_seq,
                banked: true,
            },
        );
    }

    #[test]
    fn set_item_contained_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        create_test_human(
            &mut world,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Container Tester",
        );
        carry_item(&mut world, 5000, 2012);
        carry_item(&mut world, 5000, 2013);

        let action = CwAction {
            actor_id: 5000,
            ..CwAction::default()
        };
        let mutation = SetItemContained {
            item_id: 2013,
            container_item_id: Some(2012),
            reason: "container_configuration".to_string(),
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
                .any(|event| event.type_name == "item.contained"),
            "expected the item to be contained",
        );
        let stowed = world.item_by_id(2013).expect("item remains present");
        assert_eq!(stowed.zone, CW_CARD_ZONE_CONTAINED);
        assert_eq!(stowed.container_item_id, 2012);
        assert_within_declared_writes(&changed, SetItemContained::WRITES, "SetItemContained");
    }

    #[test]
    fn set_charm_equipped_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        create_test_human(&mut world, 5000, MOONLIT_TRAIL_LOCATION_ID, "Charm Tester");
        carry_item(&mut world, 5000, 2003);

        let action = CwAction {
            actor_id: 5000,
            ..CwAction::default()
        };
        let mutation = SetCharmEquipped {
            item_id: 2003,
            equipped: true,
            reason: "deck_configuration".to_string(),
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
                .any(|event| event.type_name == "skill_charm.equipped"),
            "expected the charm to be equipped",
        );
        assert_within_declared_writes(&changed, SetCharmEquipped::WRITES, "SetCharmEquipped");
    }

    #[test]
    fn unlock_charm_slot_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        create_test_human(&mut world, 5000, MOONLIT_TRAIL_LOCATION_ID, "Slot Tester");
        grant_advancement(&mut world, 5000, "test:unlock-charm-slot");

        let action = CwAction {
            actor_id: 5000,
            ..CwAction::default()
        };
        let mutation = UnlockCharmSlot {
            cost: CHARM_SLOT_COST,
            reason: "deck_loadout".to_string(),
        };

        let before_slots = world.charm_slot_count(5000);
        let mut produced = Vec::new();
        let changed = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            produced = mutation.apply(world, &ctx);
        });

        assert!(
            produced
                .iter()
                .any(|event| event.type_name == "charm_slot.unlocked"),
            "expected a charm slot to unlock",
        );
        assert_eq!(world.charm_slot_count(5000), before_slots + 1);
        assert_within_declared_writes(&changed, UnlockCharmSlot::WRITES, "UnlockCharmSlot");
    }

    #[test]
    fn unlock_charm_slot_for_charm_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        create_test_human(
            &mut world,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Slot For Charm Tester",
        );
        carry_item(&mut world, 5000, 2003);
        assert!(!world
            .set_charm_equipped(5000, 2003, true, "test")
            .is_empty());
        carry_item(&mut world, 5000, 2013);
        {
            let candidate = world
                .world
                .items
                .iter_mut()
                .take(world.world.item_count)
                .find(|item| item.id == 2013)
                .expect("playable core item exists");
            candidate.role = CW_ITEM_ROLE_SKILL_CHARM;
        }
        grant_advancement(&mut world, 5000, "test:unlock-charm-slot-for-charm");
        let candidate_id = world
            .charm_slot_expansion_candidate(5000)
            .expect("a full bracelet plus a carried charm exposes demand")
            .id;
        assert_eq!(candidate_id, 2013);

        let action = CwAction {
            actor_id: 5000,
            ..CwAction::default()
        };
        let mutation = UnlockCharmSlotForCharm {
            item_id: 2013,
            cost: CHARM_SLOT_COST,
            reason: "deck_loadout".to_string(),
        };

        let before_slots = world.charm_slot_count(5000);
        let mut produced = Vec::new();
        let changed = changed_keys(&mut world, |world| {
            let events = Vec::new();
            let ctx = context_for(&action, &events);
            produced = mutation.apply(world, &ctx);
        });

        assert!(
            produced
                .iter()
                .any(|event| event.type_name == "charm_slot.unlocked"),
            "expected a charm slot to unlock",
        );
        assert_eq!(world.charm_slot_count(5000), before_slots + 1);
        assert_within_declared_writes(
            &changed,
            UnlockCharmSlotForCharm::WRITES,
            "UnlockCharmSlotForCharm",
        );
    }

    #[test]
    fn set_spell_prepared_writes_only_its_declared_state() {
        let mut world = RuntimeWorld::seeded();
        create_test_human(&mut world, 5000, MOONLIT_TRAIL_LOCATION_ID, "Spell Tester");
        carry_item(&mut world, 5000, 2014);

        let action = CwAction {
            actor_id: 5000,
            ..CwAction::default()
        };
        let mutation = SetSpellPrepared {
            item_id: 2014,
            prepared: true,
            reason: "spell_deck_configuration".to_string(),
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
                .any(|event| event.type_name == "spell.prepared"),
            "expected the spell to be prepared",
        );
        assert_within_declared_writes(&changed, SetSpellPrepared::WRITES, "SetSpellPrepared");
    }
}
