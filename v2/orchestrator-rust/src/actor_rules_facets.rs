use super::*;

impl RuntimeWorld {
    pub(super) fn default_search_target(&self, actor_id: u64) -> Option<RoomSearchTarget> {
        let actor = self.actor_by_id(actor_id)?;
        if actor.location_id == COSY_COTTAGE_LOCATION_ID
            && self.listen_attempt_claimed_at(actor_id, actor.location_id)
            && !self.feature_search_claimed(actor_id, actor.location_id, SCARF_BASKET_FEATURE_KEY)
        {
            let feature = self
                .room_features(actor.location_id)
                .into_iter()
                .find(|feature| feature.key == SCARF_BASKET_FEATURE_KEY)?;
            return Some(RoomSearchTarget::feature(feature));
        }
        if let Some(feature) = self
            .room_features(actor.location_id)
            .into_iter()
            .find(|feature| {
                !self.feature_search_claimed(actor_id, actor.location_id, &feature.key)
                    && self.jobs.values().any(|job| {
                        self.job_status(job) == "active"
                            && job.contribution_strategies.iter().any(|strategy| {
                                strategy.requirements.iter().any(|requirement| {
                                    matches!(
                                        requirement,
                                        ContributionRequirement::FeatureSearched {
                                            location_id,
                                            feature_key,
                                        } if *location_id == actor.location_id
                                            && feature_key == &feature.key
                                    )
                                })
                            })
                    })
            })
        {
            return Some(RoomSearchTarget::feature(feature));
        }
        if self
            .search_reveal_candidates_for_location(actor.location_id)
            .is_empty()
        {
            return None;
        }
        let location_name = self
            .location_name(actor.location_id)
            .unwrap_or_else(|| format!("Location {}", actor.location_id));
        Some(RoomSearchTarget::virtual_room(
            actor.location_id,
            location_name,
        ))
    }
}

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
    pub(super) fn apply_actor_creation_rpg_projection(
        &mut self,
        action: &CwAction,
        events: &[EventView],
        initial_calling: Option<&str>,
        initial_skill: Option<&str>,
        initial_character_profile_id: Option<&str>,
        initial_species_id: Option<&str>,
        initial_origin_id: Option<&str>,
        initial_physical_description: Option<&str>,
    ) -> Vec<EventView> {
        if !matches!(
            action.kind,
            CW_ACTION_CREATE_ACTOR | CW_ACTION_REPLACE_AVATAR_RESCUER
        ) || self.callings.contains_key(&action.actor_id)
        {
            return Vec::new();
        }
        let Some(actor) = self.actor_by_id(action.actor_id) else {
            return Vec::new();
        };
        if !Self::actor_can_act(actor) {
            return Vec::new();
        }
        if let (Some(profile_id), Some(species_id), Some(origin_id)) = (
            initial_character_profile_id,
            initial_species_id,
            initial_origin_id,
        ) {
            self.character_identities
                .entry(action.actor_id)
                .or_insert_with(|| AvatarIdentityState {
                    actor_id: action.actor_id,
                    profile_id: profile_id.to_string(),
                    species_id: species_id.to_string(),
                    origin_id: origin_id.to_string(),
                    physical_description: initial_physical_description
                        .map(compact_whitespace)
                        .unwrap_or_default(),
                    class_id: None,
                    class_selection_ready: false,
                    qualifying_world_actions: 0,
                    class_source_event_seq: None,
                    class_readiness_evidence: None,
                });
        }
        let source_event_seq = events
            .iter()
            .find(|event| event.actor_id == Some(action.actor_id))
            .map(|event| event.seq);
        let calling = CallingState {
            actor_id: action.actor_id,
            statement: initial_calling
                .and_then(normalize_calling_statement)
                .unwrap_or_else(|| default_calling_statement().to_string()),
            source_event_seq,
        };
        self.callings.insert(action.actor_id, calling.clone());
        let reason = initial_calling
            .and_then(normalize_calling_statement)
            .map(|_| "chosen_calling")
            .unwrap_or(CALLING_REASON_AVATAR_CREATED);
        let mut projection_events =
            vec![self.append_calling_event("calling.set", &calling, reason)];
        if let Some(skill_id) = initial_skill.filter(|skill_id| skill_label(skill_id).is_some()) {
            let id = skill_state_id(action.actor_id, skill_id);
            if !self.skills.contains_key(&id) {
                let skill = SkillState {
                    actor_id: action.actor_id,
                    skill_id: skill_id.to_string(),
                    label: skill_label(skill_id).unwrap_or("Knack").to_string(),
                    rank: 1,
                    updated_event_seq: Some(self.world.next_event_seq),
                };
                self.skills.insert(id, skill.clone());
                projection_events.push(self.append_skill_event(
                    "skill.stepped",
                    &skill,
                    "character_creation",
                ));
            }
        }
        projection_events
    }

    fn first_meaningful_class_readiness_event(
        actor_id: u64,
        events: &[EventView],
    ) -> Option<&EventView> {
        events.iter().find(|event| {
            event.actor_id == Some(actor_id)
                && event.success
                && (matches!(
                    event.type_name.as_str(),
                    "actor.moved"
                        | "ability_check.rolled"
                        | "location.searched"
                        | "feature.searched"
                        | "exit.discovered"
                        | "avatar.discovered"
                        | "item.picked_up"
                        | "item.dropped"
                        | "item.used"
                        | "item.given"
                        | "item.traded"
                        | "combat.attack.attempt"
                        | "combat.attack.hit"
                        | "combat.attack.miss"
                        | "combat.defend"
                        | "combat.flee.success"
                ) || (matches!(event.type_name.as_str(), "tag.applied" | "tag.cleared")
                    && matches!(event.tag_label.as_deref(), Some("prepared") | Some("tired"))))
        })
    }

    fn generic_class_readiness_evidence(
        &self,
        record: &JournalRecord,
        action: &CwAction,
        committed_events: &[EventView],
    ) -> Option<ClassReadinessEvidence> {
        if action.kind == CW_ACTION_SAY {
            return None;
        }
        let event =
            Self::first_meaningful_class_readiness_event(action.actor_id, committed_events)?;
        let offer_kind = Self::resident_record_offer_kind(record);
        let strategy_label = self.action_offer_verb(offer_kind.as_str(), action.actor_id);
        let label = self
            .card_reaction_subject(event)
            .or_else(|| event.location_name.clone())
            .unwrap_or_else(|| "the world around you".to_string());
        let (target_kind, target_id) = match event.type_name.as_str() {
            "actor.moved" | "combat.flee.success" | "exit.discovered" => (
                "location",
                event
                    .destination_location_id
                    .or(event.location_id)
                    .map(|id| id.to_string()),
            ),
            "avatar.discovered"
            | "combat.attack.attempt"
            | "combat.attack.hit"
            | "combat.attack.miss" => ("actor", event.target_actor_id.map(|id| id.to_string())),
            "item.picked_up" | "item.dropped" | "item.used" | "item.given" => {
                ("item", event.item_id.map(|id| id.to_string()))
            }
            "item.traded" => (
                "item",
                event
                    .target_item_id
                    .or(event.item_id)
                    .map(|id| id.to_string()),
            ),
            "feature.searched" => (
                "feature",
                event.location_id.map(|location_id| {
                    format!(
                        "{location_id}:{}",
                        label.to_ascii_lowercase().replace(' ', "_")
                    )
                }),
            ),
            "tag.applied" | "tag.cleared" => ("tag", event.tag_id.clone()),
            _ => ("location", event.location_id.map(|id| id.to_string())),
        };
        let target = ResolvedContributionTarget {
            kind: target_kind.to_string(),
            id: target_id.unwrap_or_else(|| format!("event:{}", event.seq)),
            label,
        };
        Some(ClassReadinessEvidence {
            offer_kind: offer_kind.as_str().to_string(),
            strategy_label: strategy_label.clone(),
            summary: format!(
                "{strategy_label} at {} became your first meaningful world action.",
                target.label
            ),
            target,
            outcome: "committed".to_string(),
            progress: 0,
            source_event_seq: event.seq,
        })
    }

    pub(super) fn apply_class_readiness_projection(
        &mut self,
        record: &JournalRecord,
        action: &CwAction,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        if action.actor_id == 0
            || action.kind == CW_ACTION_CREATE_ACTOR
            || !matches!(
                record.origin,
                JournalOrigin::PlayerCard | JournalOrigin::Speech
            )
        {
            return Vec::new();
        }
        if action.kind == CW_ACTION_NONE
            && !record.projection_mutations.is_empty()
            && record
                .projection_mutations
                .iter()
                .all(|mutation| matches!(mutation, ProjectionMutation::ShuffleHand { .. }))
        {
            return Vec::new();
        }
        let contribution_evidence = committed_events.iter().find_map(|event| {
            (event.type_name == "job.contribution.resolved"
                && event.actor_id == Some(action.actor_id))
            .then(|| {
                event
                    .content
                    .as_deref()
                    .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
                    .filter(|trace| trace.total_progress > 0)
                    .map(|trace| (event.seq, trace))
            })
            .flatten()
        });
        let evidence = contribution_evidence
            .map(|(source_event_seq, trace)| ClassReadinessEvidence {
                offer_kind: trace.action_kind.clone(),
                strategy_label: trace.strategy_label.clone(),
                target: trace.target.clone(),
                outcome: trace.outcome.clone(),
                summary: format!(
                    "{} changed {} by +{} progress.",
                    trace.strategy_label, trace.target.label, trace.total_progress
                ),
                progress: trace.total_progress,
                source_event_seq,
            })
            .or_else(|| self.generic_class_readiness_evidence(record, action, committed_events));
        let Some(evidence) = evidence else {
            return Vec::new();
        };
        let became_ready = {
            let Some(identity) = self.character_identities.get_mut(&action.actor_id) else {
                return Vec::new();
            };
            if identity.class_id.is_some() {
                return Vec::new();
            }
            let recommendable =
                character_creation_profile(Some(&identity.profile_id)).is_some_and(|profile| {
                    profile
                        .class_recommendations
                        .iter()
                        .any(|candidate| candidate.offer_kind == evidence.offer_kind)
                });
            if recommendable && identity.class_readiness_evidence.is_none() {
                identity.class_readiness_evidence = Some(evidence.clone());
            }
            if identity.class_selection_ready {
                false
            } else {
                identity.qualifying_world_actions =
                    identity.qualifying_world_actions.saturating_add(1);
                identity.class_selection_ready = identity.qualifying_world_actions >= 1;
                identity.class_selection_ready
            }
        };
        if !became_ready {
            return Vec::new();
        }
        let recommendation = self
            .character_identities
            .get(&action.actor_id)
            .and_then(|identity| character_creation_profile(Some(&identity.profile_id)))
            .and_then(|profile| {
                let recommendation = profile
                    .class_recommendations
                    .iter()
                    .find(|candidate| candidate.offer_kind == evidence.offer_kind)?;
                profile
                    .choices
                    .iter()
                    .find(|choice| choice.id == recommendation.class_id)
                    .map(|choice| choice.label.clone())
            });
        let recommendation_copy = recommendation
            .map(|label| {
                format!(
                    " {label} is recommended from that evidence; every Class remains selectable."
                )
            })
            .unwrap_or_else(|| {
                " That evidence does not point to one Class; every Class remains selectable."
                    .to_string()
            });
        vec![self.append_async_job_event(
            "class.selection_ready",
            action.actor_id,
            None,
            Some(format!(
                "{} Optional campaign rules are now available.{}",
                evidence.summary, recommendation_copy
            )),
        )]
    }

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

    fn qualifying_contribution(actor_id: u64, action_kind: &str, seq: u64) -> EventView {
        let trace = JobContributionTrace {
            schema_version: 1,
            job_id: "lantern-test".to_string(),
            strategy_id: format!("{action_kind}-strategy"),
            strategy_label: if action_kind == "work" {
                "Hold the lantern line".to_string()
            } else {
                "Help mend the lantern".to_string()
            },
            narration_key: "test".to_string(),
            action_kind: action_kind.to_string(),
            rules_action: None,
            operation: None,
            target: ResolvedContributionTarget {
                kind: "job".to_string(),
                id: "lantern-test".to_string(),
                label: "the last roadside lantern".to_string(),
            },
            resolution: "success".to_string(),
            outcome: "progressed".to_string(),
            baseline_progress: 1,
            success_progress: 0,
            prepared_bonus_progress: 0,
            project_push_prepared: false,
            project_evidence_count: 0,
            project_location_count: 0,
            total_progress: 1,
            clock_id: "lantern-test.progress".to_string(),
            claim_key: None,
            requirement_source_event_seqs: Vec::new(),
            source_event_seqs: Vec::new(),
            rules_profile: "cosyworld.srd5/1".to_string(),
            rules_pack_id: "cosyworld.rules-srd-5.1".to_string(),
            rules_pack_version: "5.1".to_string(),
            pack_id: "cosyworld.campaign.the-lantern-keeper".to_string(),
            pack_version: "1.0.0".to_string(),
        };
        EventView {
            seq,
            type_name: "job.contribution.resolved".to_string(),
            success: true,
            actor_id: Some(actor_id),
            content: Some(serde_json::to_string(&trace).expect("serialize contribution trace")),
            ..EventView::default()
        }
    }

    #[test]
    fn first_positive_contribution_freezes_evidence_and_authored_class_recommendation() {
        for (action_kind, expected_class) in [("work", "lantern-warden"), ("help", "hedge-mender")]
        {
            let mut runtime = RuntimeWorld::seeded();
            runtime.character_identities.insert(
                RATI_ACTOR_ID,
                AvatarIdentityState {
                    actor_id: RATI_ACTOR_ID,
                    profile_id: "the-lantern-keeper".to_string(),
                    species_id: "human".to_string(),
                    origin_id: "wayside-inn".to_string(),
                    physical_description: String::new(),
                    class_id: None,
                    class_selection_ready: false,
                    qualifying_world_actions: 0,
                    class_source_event_seq: None,
                    class_readiness_evidence: None,
                },
            );
            let action = CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                ..CwAction::default()
            };
            let record = JournalRecord::new(action, 1).into_player_card();
            let readiness = runtime.apply_class_readiness_projection(
                &record,
                &action,
                &[qualifying_contribution(RATI_ACTOR_ID, action_kind, 41)],
            );
            assert_eq!(readiness.len(), 1);
            assert_eq!(readiness[0].type_name, "class.selection_ready");
            let identity = runtime
                .character_identities
                .get(&RATI_ACTOR_ID)
                .expect("campaign identity");
            assert_eq!(
                identity
                    .class_readiness_evidence
                    .as_ref()
                    .map(|evidence| (evidence.offer_kind.as_str(), evidence.source_event_seq)),
                Some((action_kind, 41))
            );
            let view = runtime
                .character_identity_view(RATI_ACTOR_ID)
                .expect("campaign identity view");
            assert_eq!(
                view.class_recommendation
                    .as_ref()
                    .map(|recommendation| recommendation.class_id.as_str()),
                Some(expected_class)
            );

            let duplicate = runtime.apply_class_readiness_projection(
                &record,
                &action,
                &[qualifying_contribution(RATI_ACTOR_ID, "help", 42)],
            );
            assert!(duplicate.is_empty());
            assert_eq!(
                runtime.character_identities[&RATI_ACTOR_ID]
                    .class_readiness_evidence
                    .as_ref()
                    .map(|evidence| evidence.source_event_seq),
                Some(41)
            );
            let restored = RuntimeSnapshot::from_runtime(&runtime)
                .into_runtime()
                .expect("evidence survives snapshot restore");
            assert_eq!(
                restored.character_identities[&RATI_ACTOR_ID].class_readiness_evidence,
                runtime.character_identities[&RATI_ACTOR_ID].class_readiness_evidence
            );
        }
    }

    #[test]
    fn unrecommendable_first_action_readies_without_freezing_evidence() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.character_identities.insert(
            RATI_ACTOR_ID,
            AvatarIdentityState {
                actor_id: RATI_ACTOR_ID,
                profile_id: "the-lantern-keeper".to_string(),
                species_id: "human".to_string(),
                origin_id: "wayside-inn".to_string(),
                physical_description: String::new(),
                class_id: None,
                class_selection_ready: false,
                qualifying_world_actions: 0,
                class_source_event_seq: None,
                class_readiness_evidence: None,
            },
        );
        let action = CwAction {
            kind: CW_ACTION_NONE,
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        };
        let record = JournalRecord::new(action, 1).into_player_card();

        let readiness = runtime.apply_class_readiness_projection(
            &record,
            &action,
            &[qualifying_contribution(RATI_ACTOR_ID, "draw", 41)],
        );
        assert_eq!(readiness.len(), 1);
        assert_eq!(readiness[0].type_name, "class.selection_ready");
        let identity = runtime
            .character_identities
            .get(&RATI_ACTOR_ID)
            .expect("campaign identity");
        assert!(identity.class_selection_ready);
        assert_eq!(identity.qualifying_world_actions, 1);
        assert_eq!(
            identity.class_readiness_evidence, None,
            "an unrecommendable draw must not freeze class evidence"
        );

        let second = runtime.apply_class_readiness_projection(
            &record,
            &action,
            &[qualifying_contribution(RATI_ACTOR_ID, "search", 42)],
        );
        assert!(second.is_empty());
        let identity = runtime
            .character_identities
            .get(&RATI_ACTOR_ID)
            .expect("campaign identity");
        assert_eq!(
            identity
                .class_readiness_evidence
                .as_ref()
                .map(|evidence| (evidence.offer_kind.as_str(), evidence.source_event_seq)),
            Some(("search", 42))
        );
        let view = runtime
            .character_identity_view(RATI_ACTOR_ID)
            .expect("campaign identity view");
        assert_eq!(
            view.class_recommendation
                .as_ref()
                .map(|recommendation| recommendation.class_id.as_str()),
            Some("mothwood-guide")
        );
    }

    #[test]
    fn first_committed_search_reveals_class_without_waiting_for_finale_work() {
        let mut runtime = RuntimeWorld::seeded();
        let actor_id = RATI_ACTOR_ID;
        runtime.character_identities.insert(
            actor_id,
            AvatarIdentityState {
                actor_id,
                profile_id: "the-lantern-keeper".to_string(),
                species_id: "human".to_string(),
                origin_id: "old-chapel".to_string(),
                physical_description: String::new(),
                class_id: None,
                class_selection_ready: false,
                qualifying_world_actions: 0,
                class_source_event_seq: None,
                class_readiness_evidence: None,
            },
        );
        let action = CwAction {
            kind: CW_ACTION_SEARCH,
            actor_id,
            location_id: 800,
            ..CwAction::default()
        };
        let mut record = JournalRecord::new(action, 2).into_player_card();
        record.bind_offer_kind("search");
        let feature_search = EventView {
            seq: 51,
            type_name: "feature.searched".to_string(),
            success: true,
            actor_id: Some(actor_id),
            location_id: Some(800),
            location_name: Some("Wayside Lantern Inn".to_string()),
            content: Some(
                "failing lantern: Its wick points toward Rowan Vale's missing tower.".to_string(),
            ),
            ..EventView::default()
        };

        let readiness = runtime.apply_class_readiness_projection(
            &record,
            &action,
            std::slice::from_ref(&feature_search),
        );

        assert_eq!(readiness.len(), 1);
        assert_eq!(readiness[0].type_name, "class.selection_ready");
        let identity = &runtime.character_identities[&actor_id];
        assert!(identity.class_selection_ready);
        assert_eq!(identity.qualifying_world_actions, 1);
        let evidence = identity
            .class_readiness_evidence
            .as_ref()
            .expect("the first meaningful world action is frozen");
        assert_eq!(evidence.offer_kind, "search");
        assert_eq!(evidence.target.kind, "feature");
        assert_eq!(evidence.target.label, "failing lantern");
        assert_eq!(evidence.progress, 0);
        assert_eq!(evidence.source_event_seq, feature_search.seq);
        assert!(evidence.summary.contains("first meaningful world action"));
        assert_eq!(
            runtime
                .character_identity_view(actor_id)
                .and_then(|view| view.class_recommendation)
                .map(|recommendation| recommendation.class_id),
            Some("mothwood-guide".to_string())
        );

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("search readiness survives snapshot restore");
        assert_eq!(
            restored.character_identities[&actor_id].class_readiness_evidence,
            identity.class_readiness_evidence
        );
    }

    #[test]
    fn chat_only_speech_does_not_reveal_class() {
        let mut runtime = RuntimeWorld::seeded();
        let actor_id = RATI_ACTOR_ID;
        runtime.character_identities.insert(
            actor_id,
            AvatarIdentityState {
                actor_id,
                profile_id: "the-lantern-keeper".to_string(),
                species_id: "human".to_string(),
                origin_id: "old-chapel".to_string(),
                physical_description: String::new(),
                class_id: None,
                class_selection_ready: false,
                qualifying_world_actions: 0,
                class_source_event_seq: None,
                class_readiness_evidence: None,
            },
        );
        let action = CwAction {
            kind: CW_ACTION_SAY,
            actor_id,
            ..CwAction::default()
        };
        let record = JournalRecord::new(action, 3).into_player_card();
        let message = EventView {
            seq: 52,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(actor_id),
            ..EventView::default()
        };

        let readiness = runtime.apply_class_readiness_projection(
            &record,
            &action,
            std::slice::from_ref(&message),
        );

        assert!(readiness.is_empty());
        let identity = &runtime.character_identities[&actor_id];
        assert!(!identity.class_selection_ready);
        assert_eq!(identity.qualifying_world_actions, 0);
        assert!(identity.class_readiness_evidence.is_none());
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
