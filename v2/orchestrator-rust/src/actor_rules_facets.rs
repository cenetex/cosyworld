use super::*;

const ACTOR_RULES_FACET_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ActorRulesFacetState {
    schema_version: u8,
    actor_id: u64,
    rules_profile: String,
    rules_capability_id: String,
    selected_by_pack_id: String,
    provider_pack_id: String,
    provider_pack_version: String,
    base_stats: CwStatBlock,
    status: u8,
    stats: CwStatBlock,
    damage: i16,
    conditions: u32,
    initialized_at_revision: u64,
    last_saved_at_revision: u64,
    last_restored_at_revision: u64,
}

impl ActorRulesFacetState {
    fn from_active_actor(
        actor: CwActor,
        context: &SceneRulesContextView,
        base_stats: CwStatBlock,
        revision: u64,
    ) -> Self {
        Self {
            schema_version: ACTOR_RULES_FACET_SCHEMA_VERSION,
            actor_id: actor.id,
            rules_profile: context.rules_profile.clone(),
            rules_capability_id: context.capability_id.clone(),
            selected_by_pack_id: context.selected_by_pack_id.clone(),
            provider_pack_id: context.provider_pack_id.clone(),
            provider_pack_version: context.provider_pack_version.clone(),
            base_stats,
            status: actor.status,
            stats: actor.stats,
            damage: actor.damage,
            conditions: actor.conditions,
            initialized_at_revision: revision,
            last_saved_at_revision: revision,
            last_restored_at_revision: revision,
        }
    }

    fn fresh_for_context(
        actor_id: u64,
        context: &SceneRulesContextView,
        base_stats: CwStatBlock,
        revision: u64,
    ) -> Self {
        Self {
            schema_version: ACTOR_RULES_FACET_SCHEMA_VERSION,
            actor_id,
            rules_profile: context.rules_profile.clone(),
            rules_capability_id: context.capability_id.clone(),
            selected_by_pack_id: context.selected_by_pack_id.clone(),
            provider_pack_id: context.provider_pack_id.clone(),
            provider_pack_version: context.provider_pack_version.clone(),
            base_stats,
            status: CW_ACTOR_ACTIVE,
            stats: base_stats,
            damage: 0,
            conditions: 0,
            initialized_at_revision: revision,
            last_saved_at_revision: revision,
            last_restored_at_revision: revision,
        }
    }

    fn save_actor(&mut self, actor: CwActor, context: &SceneRulesContextView, revision: u64) {
        self.schema_version = ACTOR_RULES_FACET_SCHEMA_VERSION;
        self.actor_id = actor.id;
        self.rules_profile = context.rules_profile.clone();
        self.rules_capability_id = context.capability_id.clone();
        self.selected_by_pack_id = context.selected_by_pack_id.clone();
        self.provider_pack_id = context.provider_pack_id.clone();
        self.provider_pack_version = context.provider_pack_version.clone();
        self.status = actor.status;
        self.stats = actor.stats;
        self.damage = actor.damage;
        self.conditions = actor.conditions;
        self.last_saved_at_revision = revision;
    }
}

impl RuntimeWorld {
    fn actor_rules_facet_base_stats(&self, actor: CwActor) -> CwStatBlock {
        self.actor_rules_facets
            .get(&actor.id)
            .and_then(|facets| facets.values().next())
            .map(|facet| facet.base_stats)
            .or_else(|| {
                active_content()
                    .actors
                    .iter()
                    .find(|seed| seed.id == actor.id)
                    .map(seed_actor_stats)
            })
            .unwrap_or(actor.stats)
    }

    pub(super) fn ensure_active_actor_rules_facets(&mut self) {
        let revision = self.world.next_event_seq.saturating_sub(1);
        let actors = self.world.actors[..self.world.actor_count].to_vec();
        for actor in actors {
            let Some(context) = self.scene_rules_context(actor.location_id, revision) else {
                continue;
            };
            let exists = self
                .actor_rules_facets
                .get(&actor.id)
                .is_some_and(|facets| facets.contains_key(&context.capability_id));
            if exists {
                continue;
            }
            let base_stats = self.actor_rules_facet_base_stats(actor);
            self.actor_rules_facets.entry(actor.id).or_default().insert(
                context.capability_id.clone(),
                ActorRulesFacetState::from_active_actor(actor, &context, base_stats, revision),
            );
        }
    }

    pub(super) fn snapshot_actor_rules_facets(
        &self,
    ) -> BTreeMap<u64, BTreeMap<String, ActorRulesFacetState>> {
        let revision = self.world.next_event_seq.saturating_sub(1);
        let mut snapshot = self.actor_rules_facets.clone();
        for actor in &self.world.actors[..self.world.actor_count] {
            let Some(context) = self.scene_rules_context(actor.location_id, revision) else {
                continue;
            };
            let base_stats = snapshot
                .get(&actor.id)
                .and_then(|facets| facets.values().next())
                .map(|facet| facet.base_stats)
                .or_else(|| {
                    active_content()
                        .actors
                        .iter()
                        .find(|seed| seed.id == actor.id)
                        .map(seed_actor_stats)
                })
                .unwrap_or(actor.stats);
            let facets = snapshot.entry(actor.id).or_default();
            if let Some(facet) = facets.get_mut(&context.capability_id) {
                facet.save_actor(*actor, &context, revision);
            } else {
                facets.insert(
                    context.capability_id.clone(),
                    ActorRulesFacetState::from_active_actor(*actor, &context, base_stats, revision),
                );
            }
        }
        snapshot
    }

    pub(super) fn transition_actor_rules_facet(
        &mut self,
        actor_id: u64,
        from: &SceneRulesContextView,
        to: &SceneRulesContextView,
        revision: u64,
    ) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        let base_stats = self.actor_rules_facet_base_stats(actor);

        {
            let facets = self.actor_rules_facets.entry(actor_id).or_default();
            if let Some(facet) = facets.get_mut(&from.capability_id) {
                facet.save_actor(actor, from, revision);
            } else {
                facets.insert(
                    from.capability_id.clone(),
                    ActorRulesFacetState::from_active_actor(actor, from, base_stats, revision),
                );
            }
        }

        let restored = {
            let facets = self.actor_rules_facets.entry(actor_id).or_default();
            let facet = facets.entry(to.capability_id.clone()).or_insert_with(|| {
                ActorRulesFacetState::fresh_for_context(actor_id, to, base_stats, revision)
            });
            facet.schema_version = ACTOR_RULES_FACET_SCHEMA_VERSION;
            facet.rules_profile = to.rules_profile.clone();
            facet.selected_by_pack_id = to.selected_by_pack_id.clone();
            facet.provider_pack_id = to.provider_pack_id.clone();
            facet.provider_pack_version = to.provider_pack_version.clone();
            facet.last_restored_at_revision = revision;
            facet.clone()
        };

        let Some(actor) = self.world.actors[..self.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == actor_id)
        else {
            return false;
        };
        actor.status = restored.status;
        actor.stats = restored.stats;
        actor.damage = restored.damage;
        actor.conditions = restored.conditions;
        true
    }

    pub(super) fn choose_character_class(
        &mut self,
        actor_id: u64,
        profile_id: &str,
        class_id: &str,
        calling_statement: &str,
        starting_skill_id: &str,
        actor_meta: &ActorMeta,
        reason: &str,
    ) -> Vec<EventView> {
        let valid_identity = self
            .character_identities
            .get(&actor_id)
            .is_some_and(|identity| {
                identity.profile_id == profile_id
                    && identity.class_id.is_none()
                    && identity.class_selection_ready
            });
        if !valid_identity {
            return Vec::new();
        }
        let Some(actor_index) = self.world.actors[..self.world.actor_count]
            .iter()
            .position(|actor| actor.id == actor_id && Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        self.world.actors[actor_index].stats.level = 1;
        self.actors.insert(actor_id, actor_meta.clone());
        if let Some(identity) = self.character_identities.get_mut(&actor_id) {
            identity.class_id = Some(class_id.to_string());
            identity.class_selection_ready = false;
        }

        let mut events = Vec::new();
        let class_event = self.append_async_job_event(
            "class.chosen",
            actor_id,
            None,
            Some(format!("{class_id}:{reason}")),
        );
        if let Some(identity) = self.character_identities.get_mut(&actor_id) {
            identity.class_source_event_seq = Some(class_event.seq);
        }
        events.push(class_event);

        let calling = CallingState {
            actor_id,
            statement: normalize_calling_statement(calling_statement)
                .unwrap_or_else(|| default_calling_statement().to_string()),
            source_event_seq: events.first().map(|event| event.seq),
        };
        self.callings.insert(actor_id, calling.clone());
        events.push(self.append_calling_event("calling.set", &calling, "class_chosen"));

        if let Some(label) = skill_label(starting_skill_id) {
            let id = skill_state_id(actor_id, starting_skill_id);
            if !self.skills.contains_key(&id) {
                let skill = SkillState {
                    actor_id,
                    skill_id: starting_skill_id.to_string(),
                    label: label.to_string(),
                    rank: 1,
                    updated_event_seq: Some(self.world.next_event_seq),
                };
                self.skills.insert(id, skill.clone());
                events.push(self.append_skill_event("skill.stepped", &skill, "class_chosen"));
            }
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CORE_TEST_CONDITION: u32 = 1 << 20;
    const RUBY_TEST_CONDITION: u32 = 1 << 21;

    fn create_test_human(runtime: &mut RuntimeWorld, actor_id: u64, location_id: u64, name: &str) {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id,
                location_id,
                ..CwAction::default()
            },
            148_000 + actor_id,
        );
        record.actor_meta_upserts.insert(
            actor_id,
            ActorMeta {
                name: name.to_string(),
                speech_mode: "prose".to_string(),
                title: "Facet Boundary Tester".to_string(),
                description: "A test avatar with two rules-local facets.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    fn move_actor(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
        destination_location_id: u64,
        seed: u64,
    ) -> Vec<EventView> {
        let record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_MOVE,
                actor_id,
                destination_location_id,
                ..CwAction::default()
            },
            seed,
        );
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        events
    }

    fn held_items(runtime: &RuntimeWorld, actor_id: u64) -> Vec<(u64, u8)> {
        runtime.world.items[..runtime.world.item_count]
            .iter()
            .filter(|item| item.holder_actor_id == actor_id)
            .map(|item| (item.id, item.zone))
            .collect()
    }

    #[test]
    fn rules_facets_freeze_restore_and_survive_snapshot_without_moving_identity_or_cards() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Facet Tester");
        let held_before = held_items(&runtime, 5000);
        let item_count_before = runtime.world.item_count;
        let identity_before =
            serde_json::to_value(runtime.actors.get(&5000)).expect("serialize identity");
        let base_stats = runtime.actor_rules_facets[&5000]["cosyworld.core/rules"].base_stats;

        {
            let core = runtime
                .world
                .actors
                .iter_mut()
                .take(runtime.world.actor_count)
                .find(|actor| actor.id == 5000)
                .expect("core actor");
            core.stats.level = 3;
            core.stats.wisdom = 18;
            core.damage = 2;
            core.conditions = CORE_TEST_CONDITION;
        }
        let mut replay = runtime.clone();
        let events = move_actor(&mut runtime, 5000, 11, 148_026);
        let replay_events = move_actor(&mut replay, 5000, 11, 148_026);
        assert_eq!(
            serde_json::to_value(&events).expect("serialize first transition"),
            serde_json::to_value(&replay_events).expect("serialize replayed transition")
        );
        assert_eq!(
            serde_json::to_value(&runtime.actor_rules_facets).expect("serialize first facets"),
            serde_json::to_value(&replay.actor_rules_facets).expect("serialize replayed facets")
        );
        assert_eq!(
            serde_json::to_value(runtime.actor_by_id(5000)).expect("serialize first actor"),
            serde_json::to_value(replay.actor_by_id(5000)).expect("serialize replayed actor")
        );
        assert!(events
            .iter()
            .any(|event| event.type_name == "rules_context.changed"));

        let ruby = runtime.actor_by_id(5000).expect("ruby actor");
        assert_eq!(ruby.location_id, 11);
        assert_eq!(
            serde_json::to_value(ruby.stats).expect("serialize ruby base stats"),
            serde_json::to_value(base_stats).expect("serialize facet base stats")
        );
        assert_eq!(ruby.damage, 0);
        assert_eq!(ruby.conditions, 0);

        {
            let ruby = runtime
                .world
                .actors
                .iter_mut()
                .take(runtime.world.actor_count)
                .find(|actor| actor.id == 5000)
                .expect("ruby actor");
            ruby.stats.level = 2;
            ruby.stats.intelligence = 19;
            ruby.damage = 1;
            ruby.conditions = RUBY_TEST_CONDITION;
        }

        let snapshot = RuntimeSnapshot::from_runtime(&runtime);
        let persisted_facets =
            serde_json::to_value(&snapshot.actor_rules_facets).expect("serialize facets");
        let snapshot_bytes = serde_json::to_vec(&snapshot).expect("serialize snapshot");
        let mut restored = serde_json::from_slice::<RuntimeSnapshot>(&snapshot_bytes)
            .expect("deserialize snapshot")
            .into_runtime()
            .expect("restore runtime");
        assert_eq!(
            serde_json::to_value(&restored.actor_rules_facets).expect("serialize restored facets"),
            persisted_facets
        );

        move_actor(&mut restored, 5000, COSY_COTTAGE_LOCATION_ID, 148_027);
        let core = restored.actor_by_id(5000).expect("restored core actor");
        assert_eq!(core.stats.level, 3);
        assert_eq!(core.stats.wisdom, 18);
        assert_eq!(core.damage, 2);
        assert_eq!(core.conditions, CORE_TEST_CONDITION);

        move_actor(&mut restored, 5000, 11, 148_028);
        let ruby = restored.actor_by_id(5000).expect("restored ruby actor");
        assert_eq!(ruby.stats.level, 2);
        assert_eq!(ruby.stats.intelligence, 19);
        assert_eq!(ruby.damage, 1);
        assert_eq!(ruby.conditions, RUBY_TEST_CONDITION);
        assert_eq!(restored.world.item_count, item_count_before);
        assert_eq!(held_items(&restored, 5000), held_before);
        assert_eq!(
            serde_json::to_value(restored.actors.get(&5000)).expect("serialize restored identity"),
            identity_before
        );
        assert_eq!(
            restored.actor_rules_facets.get(&5000).map(BTreeMap::len),
            Some(2)
        );
    }

    #[test]
    fn legacy_snapshot_backfills_only_the_current_rules_facet() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, 11, "Legacy Facet Tester");
        runtime
            .actor_rules_facets
            .get_mut(&5000)
            .expect("active facet")
            .clear();

        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.actor_rules_facets.clear();
        let restored = snapshot.into_runtime().expect("restore legacy snapshot");
        let facets = restored
            .actor_rules_facets
            .get(&5000)
            .expect("legacy active facet backfilled");
        assert_eq!(facets.len(), 1);
        assert!(facets.contains_key("ruby-high.first-bell/rules"));
    }
}
