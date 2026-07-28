use super::*;

impl RuntimeWorld {
    fn resident_shared_offer_autonomy_records(
        &self,
        actor: CwActor,
        seed: u64,
    ) -> Vec<JournalRecord> {
        let (_, offers) = self.legal_action_candidates(Some(actor.id), &AccessContext::default());
        offers
            .iter()
            .filter(|offer| {
                matches!(
                    offer.kind.as_str(),
                    "search" | "craft" | "influence" | "check" | "explore_path"
                )
            })
            .filter_map(|offer| self.resident_record_for_shared_offer(actor, offer, seed))
            .collect()
    }

    fn resident_economy_autonomy_records(&self, actor: CwActor, seed: u64) -> Vec<JournalRecord> {
        if !Self::actor_can_act(actor) || !self.actor_uses_inference(actor.id) {
            return Vec::new();
        }

        let mut records = Vec::new();
        if let Some(record) =
            self.resident_shared_offer_autonomy_record_for_kinds(actor, seed, &["rest"])
        {
            records.push(record);
        }
        if let Some(record) = self.resident_feature_use_autonomy_record(actor, seed) {
            records.push(record);
        }
        if let Some(record) = self.resident_job_autonomy_record(actor, seed) {
            records.push(record);
        }
        if let Some(action) = self.resident_economy_autonomy_action(actor) {
            let mut record =
                JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
            self.append_resident_autonomy_intent_projection(actor, &mut record);
            records.push(record);
        }
        records.extend(self.resident_shared_offer_autonomy_records(actor, seed));
        records
    }

    pub(super) fn resident_economy_autonomy_record(
        &self,
        actor: CwActor,
        seed: u64,
    ) -> Option<JournalRecord> {
        let mut candidates = self
            .resident_economy_autonomy_records(actor, seed)
            .into_iter()
            .map(|record| {
                let (rank, score) = self.resident_autonomy_record_priority(actor, &record);
                ResidentAutonomyCandidate {
                    actor_id: actor.id,
                    rank,
                    score,
                    record,
                }
            })
            .collect::<Vec<_>>();
        Self::sort_resident_autonomy_candidates(&mut candidates);
        candidates
            .into_iter()
            .next()
            .map(|candidate| candidate.record)
    }

    pub(super) fn resident_autonomy_record_priority(
        &self,
        actor: CwActor,
        record: &JournalRecord,
    ) -> (u8, i16) {
        let item_score = |item_id| {
            self.item_by_id(item_id)
                .map(|item| self.resident_item_offer_score(actor, item))
                .unwrap_or(RESIDENT_DEFAULT_ITEM_SCORE)
        };
        let (rank, score) = if let Some(intent) =
            record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::ResolveJobContribution { intent } => Some(intent),
                    _ => None,
                }) {
            (
                35,
                i16::from(self.contribution_progress_amount(actor.id, intent)),
            )
        } else {
            match Self::resident_record_offer_kind(record).as_str() {
                "use_item" => (0, item_score(record.action.item_id)),
                "rest" => (5, RESIDENT_DESIRED_ITEM_SCORE),
                "trade_item" => {
                    let score = self
                        .item_by_id(record.action.item_id)
                        .zip(self.item_by_id(record.action.target_item_id))
                        .map(|(offered, requested)| {
                            self.resident_trade_preference(actor.id, offered, requested)
                                .score
                        })
                        .unwrap_or(RESIDENT_DEFAULT_ITEM_SCORE);
                    (10, score)
                }
                "give_item" => {
                    let score = self
                        .actor_by_id(record.action.target_actor_id)
                        .zip(self.item_by_id(record.action.item_id))
                        .map(|(target, item)| self.resident_item_offer_score(target, item))
                        .unwrap_or_else(|| item_score(record.action.item_id));
                    (20, score)
                }
                "use_feature" => (30, RESIDENT_DESIRED_ITEM_SCORE),
                "pick_up" => (40, item_score(record.action.item_id)),
                "drop_item" => {
                    let score = self
                        .item_by_id(record.action.item_id)
                        .map(|item| -self.resident_item_keep_score(actor, item))
                        .unwrap_or(-RESIDENT_DEFAULT_ITEM_SCORE);
                    (50, score)
                }
                "move" => (60, RESIDENT_DEFAULT_ITEM_SCORE),
                "search" => (65, 0),
                "craft"
                    if self.resident_needs_medicine(actor)
                        && record.projection_mutations.iter().any(|mutation| {
                            matches!(
                                mutation,
                                ProjectionMutation::ResolveCraft { receipt }
                                    if receipt.recipe_id == HEARTH_TONIC_RECIPE_ID
                            )
                        }) =>
                {
                    (1, RESIDENT_DESIRED_ITEM_SCORE)
                }
                "craft" => (66, 0),
                "influence" => (70, 0),
                "check" => (80, 0),
                "explore_path" => (85, 0),
                _ => (90, 0),
            }
        };
        let practice_tiebreak = self
            .practice_recognition_for_offer(actor.id, &Self::resident_record_offer_kind(record))
            .is_some() as i16;
        (rank, score.saturating_add(practice_tiebreak))
    }

    pub(super) fn sort_resident_autonomy_candidates(candidates: &mut [ResidentAutonomyCandidate]) {
        candidates.sort_by(|left, right| {
            left.rank
                .cmp(&right.rank)
                .then_with(|| right.score.cmp(&left.score))
                .then_with(|| left.actor_id.cmp(&right.actor_id))
                .then_with(|| {
                    Self::resident_record_offer_kind(&left.record)
                        .cmp(&Self::resident_record_offer_kind(&right.record))
                })
                .then_with(|| left.record.action.kind.cmp(&right.record.action.kind))
                .then_with(|| left.record.action.item_id.cmp(&right.record.action.item_id))
                .then_with(|| {
                    left.record
                        .action
                        .target_actor_id
                        .cmp(&right.record.action.target_actor_id)
                })
                .then_with(|| {
                    left.record
                        .action
                        .destination_location_id
                        .cmp(&right.record.action.destination_location_id)
                })
        });
    }

    fn resident_autonomy_candidates_for_ids(
        &mut self,
        actor_ids: &[u64],
        seed: u64,
    ) -> Vec<ResidentAutonomyCandidate> {
        self.refresh_resident_local_memories_for_ids(actor_ids);
        let mut candidates = Vec::new();
        for actor_id in actor_ids {
            let Some(actor) = self.actor_by_id(*actor_id) else {
                continue;
            };
            for record in self.resident_economy_autonomy_records(actor, seed) {
                let (rank, score) = self.resident_autonomy_record_priority(actor, &record);
                candidates.push(ResidentAutonomyCandidate {
                    actor_id: *actor_id,
                    rank,
                    score,
                    record,
                });
            }
        }
        let canonical_trade_actors = candidates
            .iter()
            .filter(|candidate| candidate.record.action.kind == CW_ACTION_TRADE_ITEM)
            .fold(
                BTreeMap::<(u64, u64, u64, u64), u64>::new(),
                |mut canonical, candidate| {
                    let action = candidate.record.action;
                    let key = (
                        action.actor_id.min(action.target_actor_id),
                        action.actor_id.max(action.target_actor_id),
                        action.item_id.min(action.target_item_id),
                        action.item_id.max(action.target_item_id),
                    );
                    canonical
                        .entry(key)
                        .and_modify(|actor_id| *actor_id = (*actor_id).min(action.actor_id))
                        .or_insert(action.actor_id);
                    canonical
                },
            );
        candidates.retain(|candidate| {
            let action = candidate.record.action;
            if action.kind != CW_ACTION_TRADE_ITEM {
                return true;
            }
            let key = (
                action.actor_id.min(action.target_actor_id),
                action.actor_id.max(action.target_actor_id),
                action.item_id.min(action.target_item_id),
                action.item_id.max(action.target_item_id),
            );
            canonical_trade_actors.get(&key) == Some(&action.actor_id)
        });
        Self::sort_resident_autonomy_candidates(&mut candidates);
        candidates
    }

    #[cfg(test)]
    pub(super) fn best_resident_economy_autonomy_candidate(
        &mut self,
        seed: u64,
    ) -> Option<ResidentAutonomyCandidate> {
        let actor_ids = self.resident_economy_autonomy_candidate_ids();
        let candidates = self.resident_autonomy_candidates_for_ids(&actor_ids, seed);
        candidates
            .into_iter()
            .next()
            .map(|candidate| self.attach_resident_decision_trace(candidate))
    }

    pub(super) fn best_resident_ripple_candidate(
        &mut self,
        context: &RippleContext,
        seed: u64,
    ) -> Option<ResidentAutonomyCandidate> {
        let actor_ids = self.resident_ripple_candidate_ids(context);
        let candidates = self.resident_autonomy_candidates_for_ids(&actor_ids, seed);
        candidates
            .into_iter()
            .next()
            .map(|candidate| self.attach_resident_decision_trace(candidate))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn establish_practice(runtime: &mut RuntimeWorld, actor_id: u64, category: DeedCategory) {
        for seq in 1..=5 {
            let claim_key = format!("test:offer-scoring:{actor_id}:{seq}");
            runtime.deeds.insert(
                claim_key.clone(),
                DeedRecord {
                    schema_version: 1,
                    id: claim_key.clone(),
                    claim_key,
                    actor_id,
                    controller_mode: "local_ai".to_string(),
                    category,
                    source_action: "check".to_string(),
                    operation: "test.offer_scoring".to_string(),
                    rules_profile: "cosyworld.srd5/1".to_string(),
                    contributing_pack_id: "cosyworld.core".to_string(),
                    target_kind: "location".to_string(),
                    target_id: seq.to_string(),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    source_event_seqs: vec![seq],
                    durable_public_trace: true,
                },
            );
        }
        runtime.rebuild_deed_index();
    }

    #[test]
    fn viable_offer_lanes_are_scored_together_before_selection() {
        let mut runtime = RuntimeWorld::seeded();
        let actor_id = RATI_ACTOR_ID;
        runtime
            .actor_autonomy
            .entry(actor_id)
            .or_default()
            .control_mode = ActorControlMode::LocalAi;
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == actor_id)
            .expect("Rati exists")
            .location_id = MOONLIT_TRAIL_LOCATION_ID;
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == actor_id)
            .expect("Rati exists")
            .damage = 4;
        let tonic = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == HEARTH_TONIC_ITEM_ID)
            .expect("Hearth Tonic exists");
        tonic.location_id = 0;
        tonic.holder_actor_id = actor_id;
        tonic.charges = 1;

        let actor = runtime.actor_by_id(actor_id).expect("Rati remains active");
        let records = runtime.resident_economy_autonomy_records(actor, 146_001);
        let kinds = records
            .iter()
            .map(RuntimeWorld::resident_record_offer_kind)
            .collect::<BTreeSet<_>>();
        assert!(kinds.contains("use_item"));
        assert!(
            kinds
                .iter()
                .any(|kind| matches!(kind.as_str(), "prepare" | "work" | "help" | "study")),
            "an active job contribution must remain in the scored set"
        );

        let selected = runtime
            .resident_economy_autonomy_record(actor, 146_001)
            .expect("one legal meaningful offer is selected");
        assert_eq!(
            RuntimeWorld::resident_record_offer_kind(&selected),
            "use_item",
            "urgent recovery wins through scoring, not lane order"
        );
    }

    #[test]
    fn practice_is_only_a_score_tiebreak_and_titles_do_not_count() {
        let mut runtime = RuntimeWorld::seeded();
        let practiced_id = RATI_ACTOR_ID;
        let plain_id = WHISKERWIND_ACTOR_ID;
        establish_practice(&mut runtime, practiced_id, DeedCategory::Exploration);
        runtime
            .actors
            .get_mut(&plain_id)
            .expect("plain actor metadata")
            .title = "Grand Explorer Without Evidence".to_string();

        let check_record = |actor_id| {
            JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_RULES_SEARCH,
                    actor_id,
                    location_id: COSY_COTTAGE_LOCATION_ID,
                    ability: LISTEN_ABILITY,
                    dc: LISTEN_DC,
                    ..CwAction::default()
                },
                146_010,
            )
        };
        let practiced = runtime.actor_by_id(practiced_id).expect("practiced actor");
        let plain = runtime.actor_by_id(plain_id).expect("plain actor");
        let practiced_priority =
            runtime.resident_autonomy_record_priority(practiced, &check_record(practiced_id));
        let plain_priority =
            runtime.resident_autonomy_record_priority(plain, &check_record(plain_id));
        assert_eq!(practiced_priority.0, plain_priority.0);
        assert_eq!(practiced_priority.1, plain_priority.1 + 1);
    }

    #[test]
    fn an_empty_scored_set_deterministically_does_nothing() {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        let first = runtime.resident_autonomy_candidates_for_ids(&[RATI_ACTOR_ID], 146_020);
        let second = runtime.resident_autonomy_candidates_for_ids(&[RATI_ACTOR_ID], 146_020);
        assert!(first.is_empty());
        assert!(second.is_empty());
    }

    #[test]
    fn mutual_trade_remains_the_top_scored_room_offer() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.world.tick = 0;
        runtime.beliefs.clear();
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                DEWBRIGHT_BUTTON_ITEM_ID => {
                    item.holder_actor_id = RATI_ACTOR_ID;
                    item.location_id = 0;
                    item.held_since_tick = runtime.world.tick;
                }
                STORY_BUTTON_ITEM_ID => {
                    item.holder_actor_id = WHISKERWIND_ACTOR_ID;
                    item.location_id = 0;
                    item.held_since_tick = runtime.world.tick;
                }
                _ => {}
            }
        }

        let actor_ids = runtime.resident_economy_autonomy_candidate_ids();
        let candidates = runtime.resident_autonomy_candidates_for_ids(&actor_ids, 146_030);
        let summary = candidates
            .iter()
            .map(|candidate| {
                (
                    candidate.actor_id,
                    RuntimeWorld::resident_record_offer_kind(&candidate.record),
                    candidate.rank,
                    candidate.score,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            summary
                .first()
                .map(|candidate| (candidate.0, candidate.1.as_str())),
            Some((RATI_ACTOR_ID, "trade_item")),
            "mutually desired physical exchange should beat ambient filler: {summary:?}"
        );
    }
}
