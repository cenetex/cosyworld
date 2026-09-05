use super::*;

pub(super) const ENTITY_LEVEL_CONTRACT_VERSION: u8 = 1;
const MAX_ENTITY_LEVEL: u8 = 20;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum EntityLevelPhase {
    #[default]
    Legacy,
    Fresh,
    Authoritative,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct EntityLevelLedger {
    phase: EntityLevelPhase,
    #[serde(default)]
    entities: BTreeMap<String, EntityLevelState>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct EntityLevelState {
    level: u8,
    #[serde(default)]
    grandfathered: bool,
    #[serde(default)]
    receipts: BTreeMap<String, EntityLevelReceipt>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct EntityLevelReceipt {
    source_event_seq: Option<u64>,
    kind: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ItemLevelPolicy {
    pub(super) schema_version: u8,
    pub(super) criteria: Vec<ItemLevelCriterion>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ItemLevelCriterion {
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) feature_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EntityLevelRecord {
    version: u8,
    #[serde(default)]
    item_uses: Vec<ItemLevelUseClaim>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ItemLevelUseClaim {
    item_id: u64,
    criterion_id: String,
    owner_pack_id: String,
    owner_pack_version: String,
    location_id: u64,
    feature_key: String,
}

impl Default for EntityLevelRecord {
    fn default() -> Self {
        Self {
            version: ENTITY_LEVEL_CONTRACT_VERSION,
            item_uses: Vec::new(),
        }
    }
}

impl EntityLevelLedger {
    pub(super) fn fresh() -> Self {
        Self {
            phase: EntityLevelPhase::Fresh,
            entities: BTreeMap::new(),
        }
    }
}

pub(super) fn validate_item_level_policy(
    item: &SeedItemContent,
    features: &[SeedRoomFeatureContent],
) -> Result<(), String> {
    let Some(policy) = item.level_policy.as_ref() else {
        return Ok(());
    };
    let invalid = || format!("item {} has an invalid authored level-use policy", item.id);
    if policy.schema_version != 1 || !(1..=19).contains(&policy.criteria.len()) {
        return Err(invalid());
    }
    let mut ids = BTreeSet::new();
    let mut targets = BTreeSet::new();
    for criterion in &policy.criteria {
        if criterion.id.is_empty()
            || criterion.id.len() > 64
            || !criterion.id.as_bytes()[0].is_ascii_lowercase()
            || !criterion
                .id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || !ids.insert(&criterion.id)
            || !targets.insert((criterion.location_id, &criterion.feature_key))
            || !features.iter().any(|feature| {
                feature.location_id == criterion.location_id
                    && feature.key == criterion.feature_key
                    && feature.uses.iter().any(|use_| use_.item_id == item.id)
            })
        {
            return Err(invalid());
        }
    }
    Ok(())
}

impl RuntimeWorld {
    // Only historical records and snapshots use the old interpretation. The
    // first journal record carrying contract v1 freezes this result once.
    fn legacy_entity_level(&self, subject: WorldEntityRef) -> u8 {
        let memory = self.entity_memories.get(&subject.key());
        let progress = match subject.kind {
            WorldEntityKind::Item => memory.map(|state| state.use_count / 3),
            WorldEntityKind::Location => memory.map(|state| state.meaningful_event_count / 8),
            WorldEntityKind::Avatar => None,
        }
        .unwrap_or_default();
        1 + progress.min(19) as u8
    }

    pub(crate) fn world_entity_level(&self, subject: WorldEntityRef) -> Option<u8> {
        match subject.kind {
            WorldEntityKind::Avatar => {
                return self
                    .actor_by_id(subject.id)
                    .map(|actor| actor.stats.level.max(1))
            }
            WorldEntityKind::Item => {
                self.item_by_id(subject.id)?;
            }
            WorldEntityKind::Location => {
                self.location_name(subject.id)?;
            }
        }
        if self.entity_levels.phase == EntityLevelPhase::Legacy {
            return Some(self.legacy_entity_level(subject));
        }
        Some(
            self.entity_levels
                .entities
                .get(&subject.key())
                .map(|state| state.level)
                .unwrap_or(if subject.kind == WorldEntityKind::Item {
                    1
                } else {
                    0
                }),
        )
    }

    pub(super) fn entity_level_record_supported(record: &JournalRecord) -> bool {
        record
            .entity_level_contract
            .as_ref()
            .is_none_or(|contract| {
                contract.version == ENTITY_LEVEL_CONTRACT_VERSION
                    && contract.item_uses.len() <= 19
                    && contract.item_uses.iter().all(|claim| {
                        claim.item_id > 0
                            && claim.location_id > 0
                            && !claim.criterion_id.is_empty()
                            && !claim.owner_pack_id.is_empty()
                            && !claim.owner_pack_version.is_empty()
                            && !claim.feature_key.is_empty()
                    })
            })
    }

    pub(super) fn prepare_entity_level_contract(&mut self, record: &JournalRecord) {
        match (
            self.entity_levels.phase,
            record.entity_level_contract.as_ref(),
        ) {
            (EntityLevelPhase::Fresh, None) => self.entity_levels.phase = EntityLevelPhase::Legacy,
            (EntityLevelPhase::Fresh, Some(_)) => {
                self.entity_levels.phase = EntityLevelPhase::Authoritative
            }
            (EntityLevelPhase::Legacy, Some(_)) => {
                let subjects = self.world.items[..self.world.item_count]
                    .iter()
                    .map(|item| WorldEntityRef::item(item.id))
                    .chain(
                        self.world.locations[..self.world.location_count]
                            .iter()
                            .map(|location| WorldEntityRef::location(location.id)),
                    )
                    .collect::<Vec<_>>();
                for subject in subjects {
                    let level = self.legacy_entity_level(subject);
                    self.entity_levels.entities.insert(
                        subject.key(),
                        EntityLevelState {
                            level,
                            grandfathered: true,
                            receipts: BTreeMap::new(),
                        },
                    );
                }
                // Existing projects are already inside the grandfathered level.
                // Reconciliation keeps their identity without awarding it twice.
                for (subject, project, receipt) in self.completed_development_receipts() {
                    self.entity_levels
                        .entities
                        .entry(subject.key())
                        .or_default()
                        .receipts
                        .insert(project, receipt);
                }
                for tag in self.tags.values() {
                    let Some(rest) = tag.id.strip_prefix("room:") else {
                        continue;
                    };
                    let Some((location, rest)) = rest.split_once(":feature_use:") else {
                        continue;
                    };
                    let Some((feature, item)) = rest.rsplit_once(':') else {
                        continue;
                    };
                    let (Ok(location_id), Ok(item_id)) =
                        (location.parse::<u64>(), item.parse::<u64>())
                    else {
                        continue;
                    };
                    if let Some(entity) = self
                        .entity_levels
                        .entities
                        .get_mut(&WorldEntityRef::item(item_id).key())
                    {
                        entity.receipts.insert(
                            format!("feature:{location_id}:{feature}"),
                            EntityLevelReceipt {
                                source_event_seq: tag.source_event_seq,
                                kind: "legacy_feature_use".to_string(),
                            },
                        );
                    }
                }
                self.entity_levels.phase = EntityLevelPhase::Authoritative;
            }
            _ => {}
        }
    }

    fn completed_development_receipts(&self) -> Vec<(WorldEntityRef, String, EntityLevelReceipt)> {
        let mut receipts = Vec::new();
        for building in self.settlement_buildings.values() {
            let subject = WorldEntityRef::location(building.location_id);
            if let Some(seq) = building.completed_event_seq {
                receipts.push((
                    subject,
                    building.construction_job_id.clone(),
                    EntityLevelReceipt {
                        source_event_seq: Some(seq),
                        kind: "construction".to_string(),
                    },
                ));
            }
            if let (Some(seq), Some(project)) = (
                building.upgraded_event_seq,
                building.upgrade_job_id.as_ref(),
            ) {
                receipts.push((
                    subject,
                    project.clone(),
                    EntityLevelReceipt {
                        source_event_seq: Some(seq),
                        kind: "building_upgrade".to_string(),
                    },
                ));
            }
        }
        for location in &self.world.locations[..self.world.location_count] {
            let project = settlement_civic_job_id(location.id);
            let Some(clock) = self.clocks.get(&settlement_civic_clock_id(location.id)) else {
                continue;
            };
            if clock.filled >= clock.segments
                && self
                    .jobs
                    .get(&project)
                    .is_some_and(|job| self.job_status(job) == "completed")
            {
                if let Some(seq) = clock.updated_event_seq {
                    receipts.push((
                        WorldEntityRef::location(location.id),
                        project,
                        EntityLevelReceipt {
                            source_event_seq: Some(seq),
                            kind: "civic_expansion".to_string(),
                        },
                    ));
                }
            }
        }
        receipts
    }

    pub(super) fn bind_entity_level_use_claims(&self, record: &mut JournalRecord) {
        let Some(contract) = record.entity_level_contract.as_mut() else {
            return;
        };
        contract.item_uses.clear();
        for mutation in &record.projection_mutations {
            let ProjectionMutation::UseFeature {
                item_id,
                location_id,
                feature_key,
                ..
            } = mutation
            else {
                continue;
            };
            let Some(item) = active_content()
                .items
                .iter()
                .find(|item| item.id == *item_id)
            else {
                continue;
            };
            let Some(policy) = item
                .level_policy
                .as_ref()
                .filter(|policy| policy.schema_version == 1)
            else {
                continue;
            };
            for criterion in &policy.criteria {
                if criterion.location_id != *location_id || criterion.feature_key != *feature_key {
                    continue;
                }
                contract.item_uses.push(ItemLevelUseClaim {
                    item_id: *item_id,
                    criterion_id: criterion.id.clone(),
                    owner_pack_id: item.pack_id.clone(),
                    owner_pack_version: self.active_pack_version(&item.pack_id),
                    location_id: *location_id,
                    feature_key: feature_key.clone(),
                });
            }
        }
    }

    fn credit_entity_level(
        &mut self,
        subject: WorldEntityRef,
        key: String,
        receipt: EntityLevelReceipt,
    ) {
        let baseline = if subject.kind == WorldEntityKind::Item {
            1
        } else {
            0
        };
        let state = self
            .entity_levels
            .entities
            .entry(subject.key())
            .or_insert_with(|| EntityLevelState {
                level: baseline,
                ..EntityLevelState::default()
            });
        if state.receipts.contains_key(&key) || state.level >= MAX_ENTITY_LEVEL {
            return;
        }
        state.receipts.insert(key, receipt);
        state.level = state.level.saturating_add(1).min(MAX_ENTITY_LEVEL);
    }

    pub(super) fn apply_entity_level_receipts(
        &mut self,
        record: &JournalRecord,
        events: &[EventView],
    ) {
        let Some(contract) = record.entity_level_contract.as_ref() else {
            return;
        };
        if self.entity_levels.phase != EntityLevelPhase::Authoritative {
            return;
        }
        for claim in &contract.item_uses {
            let bound_use = record.projection_mutations.iter().any(|mutation| matches!(mutation,
                ProjectionMutation::UseFeature { item_id, location_id, feature_key, .. }
                if *item_id == claim.item_id && *location_id == claim.location_id && *feature_key == claim.feature_key));
            if !bound_use {
                continue;
            }
            let Some(event) = events.iter().find(|event| {
                event.type_name == "item.used"
                    && event.item_id == Some(claim.item_id)
                    && event.location_id == Some(claim.location_id)
                    && event.actor_id == Some(record.action.actor_id)
            }) else {
                continue;
            };
            self.credit_entity_level(
                WorldEntityRef::item(claim.item_id),
                format!("feature:{}:{}", claim.location_id, claim.feature_key),
                EntityLevelReceipt {
                    source_event_seq: Some(event.seq),
                    kind: "authored_feature_use".to_string(),
                },
            );
        }
        for (subject, project, receipt) in self.completed_development_receipts() {
            self.credit_entity_level(subject, project, receipt);
        }
    }
}

#[cfg(test)]
pub(crate) fn freeze_legacy_test_levels(runtime: &mut RuntimeWorld) {
    // Media fixtures represent an existing world with numbered art pools.
    runtime.entity_levels = EntityLevelLedger::default();
    runtime.prepare_entity_level_contract(&JournalRecord::new(CwAction::default(), 954));
}

#[cfg(test)]
pub(crate) fn assert_location_level_replay(
    first: &RuntimeWorld,
    replay: &RuntimeWorld,
    location_id: u64,
    level: u8,
) {
    let subject = WorldEntityRef::location(location_id);
    assert_eq!(first.world_entity_level(subject), Some(level));
    assert_eq!(replay.world_entity_level(subject), Some(level));
    assert_eq!(
        serde_json::to_value(&first.entity_levels).unwrap(),
        serde_json::to_value(&replay.entity_levels).unwrap()
    );
}

#[cfg(test)]
pub(crate) fn verify_development_level_receipts(
    first: &mut RuntimeWorld,
    replay: &mut RuntimeWorld,
    location_id: u64,
) {
    assert_location_level_replay(first, replay, location_id, 2);
    let building = first
        .settlement_buildings
        .values()
        .find(|building| {
            building.location_id == location_id && building.completed_event_seq.is_some()
        })
        .unwrap()
        .clone();
    let upgrade = building.upgrade_clock_id.as_ref().unwrap();
    let service = building
        .follow_up_job_ids
        .iter()
        .filter_map(|id| first.jobs.get(id))
        .next()
        .unwrap()
        .progress_clock_id
        .clone();
    // The authored upgrade and civic project each have one stable identity.
    // A repeatable service retains its own rewards while the level stays put.
    for clock_id in [upgrade, &service, &settlement_civic_clock_id(location_id)] {
        let mut record = JournalRecord::new(
            CwAction {
                actor_id: 5000,
                location_id,
                ..CwAction::default()
            },
            920_954,
        );
        record
            .projection_mutations
            .push(ProjectionMutation::AdvanceClock {
                clock_id: clock_id.clone(),
                amount: first.clocks[clock_id].segments,
                reason: "complete_development_test_project".to_string(),
            });
        let record: JournalRecord =
            serde_json::from_slice(&serde_json::to_vec(&record).unwrap()).unwrap();
        for _ in 0..3 {
            let (status, events) = first.apply_journal_record(&record);
            assert_eq!(status, CW_OK);
            let (replay_status, replay_events) = replay.apply_journal_record(&record);
            assert_eq!(replay_status, CW_OK);
            assert_eq!(
                serde_json::to_value(events).unwrap(),
                serde_json::to_value(replay_events).unwrap()
            );
            assert_location_level_replay(first, replay, location_id, 3);
        }
    }
    let restored = RuntimeSnapshot::from_runtime(first).into_runtime().unwrap();
    assert_location_level_replay(first, &restored, location_id, 3);
    let receipts =
        &first.entity_levels.entities[&WorldEntityRef::location(location_id).key()].receipts;
    assert_eq!(receipts.len(), 3);
    assert!(receipts
        .values()
        .all(|receipt| receipt.source_event_seq.is_some()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feature_record(actor_id: u64, seed: u64) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                actor_id,
                ..CwAction::default()
            },
            seed,
        );
        record
            .projection_mutations
            .push(ProjectionMutation::UseFeature {
                item_id: STORY_BUTTON_ITEM_ID,
                location_id: 1,
                feature_key: "scarf_basket".to_string(),
                content: "The Story Button fits the notch. The basket clicks once.".to_string(),
                reason: "use_feature".to_string(),
            });
        record
    }

    fn historical(mut record: JournalRecord) -> JournalRecord {
        record.entity_level_contract = None;
        let bytes = serde_json::to_vec(&record).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("entity_level_contract"));
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn legacy_journal_and_snapshot_freeze_levels_at_the_same_boundary() {
        let mut runtime = RuntimeWorld::seeded();
        let mut prefix = Vec::new();
        for actor_id in 5000..=5002 {
            prefix.push(historical(JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_CREATE_ACTOR,
                    actor_id,
                    location_id: 1,
                    ..CwAction::default()
                },
                actor_id,
            )));
        }
        prefix.push(historical(JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id: 5000,
                item_id: STORY_BUTTON_ITEM_ID,
                ..CwAction::default()
            },
            6000,
        )));
        for actor_id in 5000..=5002 {
            prefix.push(historical(feature_record(actor_id, 7000 + actor_id)));
            if actor_id < 5002 {
                prefix.push(historical(JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_GIVE_ITEM,
                        actor_id,
                        target_actor_id: actor_id + 1,
                        item_id: STORY_BUTTON_ITEM_ID,
                        ..CwAction::default()
                    },
                    8000 + actor_id,
                )));
            }
        }
        for record in &prefix {
            assert_eq!(runtime.apply_journal_record(record).0, CW_OK);
        }
        let item = WorldEntityRef::item(STORY_BUTTON_ITEM_ID);
        let location = WorldEntityRef::location(1);
        assert_eq!(runtime.world_entity_level(item), Some(2));
        let level = runtime.world_entity_level(location).unwrap();
        let mut description = historical(JournalRecord::new(CwAction::default(), 9000));
        description.content_upserts.insert(
            90_000,
            "A worn button with a red thread in its rim.".to_string(),
        );
        description
            .projection_mutations
            .push(ProjectionMutation::RecordEntitySelfDescription(
                EntitySelfDescriptionProjection {
                    subject: item,
                    content_id: 90_000,
                    level: 2,
                    source_actor_id: 5002,
                    source_location_id: 1,
                    caused_by_event_seq: None,
                    source_world_tick: runtime.world.tick,
                    observed_through_seq: runtime.current_state_revision(),
                },
            ));
        description
            .projection_mutations
            .push(ProjectionMutation::FundCommunityArt {
                subject_kind: "item".to_string(),
                subject_id: STORY_BUTTON_ITEM_ID,
                level: 2,
                required_orbs: 20,
                contributor_actor_id: 5002,
                intent_id: "legacy-art-funding".to_string(),
                amount: 7,
                history_through_seq: runtime.current_state_revision(),
                evolution_job: None,
            });
        assert_eq!(runtime.apply_journal_record(&description).0, CW_OK);
        let original_art = serde_json::to_value(&runtime.community_art_generations).unwrap();
        prefix.push(description);
        let mut old_snapshot =
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap();
        old_snapshot
            .as_object_mut()
            .unwrap()
            .remove("entity_levels");
        old_snapshot["version"] = 21.into();
        let mut restored = serde_json::from_value::<RuntimeSnapshot>(old_snapshot)
            .unwrap()
            .into_runtime()
            .unwrap();
        let mut replayed = RuntimeWorld::seeded();
        for record in &prefix {
            assert_eq!(replayed.apply_journal_record(record).0, CW_OK);
        }
        let boundary = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5003,
                location_id: 1,
                ..CwAction::default()
            },
            10_000,
        );
        for world in [&mut runtime, &mut restored, &mut replayed] {
            assert_eq!(world.apply_journal_record(&boundary).0, CW_OK);
            let mut repeated = feature_record(5002, 11_000);
            world.bind_entity_level_use_claims(&mut repeated);
            for _ in 0..24 {
                assert_eq!(world.apply_journal_record(&repeated).0, CW_OK);
            }
            assert_eq!(world.world_entity_level(item), Some(2));
            assert_eq!(world.world_entity_level(location), Some(level));
            assert!(!world.world_entity_self_description_due(item));
            assert_eq!(
                serde_json::to_value(&world.community_art_generations).unwrap(),
                original_art
            );
            assert_eq!(
                world
                    .world_entity_context_spine(item, "Still here")
                    .unwrap()
                    .level,
                2
            );
        }
        let expected = serde_json::to_value(&runtime.entity_levels).unwrap();
        assert_eq!(
            serde_json::to_value(&restored.entity_levels).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(&replayed.entity_levels).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(&restored.event_log).unwrap(),
            serde_json::to_value(&replayed.event_log).unwrap()
        );
    }

    #[test]
    fn unsupported_contract_and_unbound_claim_leave_levels_unchanged() {
        let mut runtime = RuntimeWorld::seeded();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5000,
                location_id: 1,
                ..CwAction::default()
            },
            954,
        );
        record.entity_level_contract.as_mut().unwrap().version = 2;
        let before = serde_json::to_value(&runtime.entity_levels).unwrap();
        assert_eq!(runtime.apply_journal_record(&record).0, CW_ERR_RULE);
        assert_eq!(
            serde_json::to_value(&runtime.entity_levels).unwrap(),
            before
        );
        record.entity_level_contract.as_mut().unwrap().version = 1;
        let mut feature = feature_record(5000, 955);
        runtime.bind_entity_level_use_claims(&mut feature);
        record.entity_level_contract = feature.entity_level_contract;
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert_eq!(
            runtime.world_entity_level(WorldEntityRef::item(STORY_BUTTON_ITEM_ID)),
            Some(1)
        );
        assert!(runtime.entity_levels.entities.is_empty());
    }

    #[tokio::test]
    async fn accepted_feature_use_credits_one_authored_item_milestone() {
        let mut runtime = RuntimeWorld::seeded();
        crate::test_support::create_test_human(&mut runtime, 5000, 1, "Use Maker");
        let item = runtime.world.items[..runtime.world.item_count]
            .iter_mut()
            .find(|item| item.id == STORY_BUTTON_ITEM_ID)
            .unwrap();
        item.location_id = 0;
        item.holder_actor_id = 5000;
        runtime.actor_autonomy.entry(5000).or_default().control_mode =
            ActorControlMode::DirectInput;
        let subject = WorldEntityRef::item(STORY_BUTTON_ITEM_ID);
        assert_eq!(runtime.world_entity_level(subject), Some(1));
        assert_eq!(
            runtime.world_entity_level(WorldEntityRef::location(1)),
            Some(0)
        );
        assert_eq!(runtime.community_art_subject_level("location", 1), None);
        assert!(!runtime.world_entity_self_description_due(WorldEntityRef::location(1)));
        let state = crate::test_support::test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5000);
        let result = execute_feature_use_action(
            &state,
            "127.0.0.1:48154".parse().unwrap(),
            5000,
            Some(&session),
            STORY_BUTTON_ITEM_ID,
            1,
            "scarf_basket",
        )
        .await;
        assert!(result.response.ok, "{:?}", result.response);
        let world = state.inner.lock().await;
        assert_eq!(world.world_entity_level(subject), Some(2));
        let visible = world.state_response(Some(5000), &AccessContext::default());
        assert_eq!(visible.cards.items[&STORY_BUTTON_ITEM_ID].level, 2);
        assert_eq!(visible.cards.locations[&1].level, 0);
        assert_eq!(
            world.entity_levels.entities[&subject.key()].receipts.len(),
            1
        );
        let restored = RuntimeSnapshot::from_runtime(&world)
            .into_runtime()
            .unwrap();
        assert_eq!(restored.world_entity_level(subject), Some(2));
        assert_eq!(
            restored.world_entity_level(WorldEntityRef::location(1)),
            Some(0)
        );
        assert_eq!(
            restored
                .world_entity_context_spine(subject, "The basket clicked")
                .unwrap()
                .level,
            2
        );
    }
}
