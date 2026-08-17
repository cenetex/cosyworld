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
                    "search"
                        | "craft"
                        | "influence"
                        | NOTICE_ACTOR_OFFER_KIND
                        | "check"
                        | "explore_path"
                        | "open"
                        | FOCUSED_NOTICE_OFFER_KIND
                        | DISCOVERY_SEARCH_OFFER_KIND
                        | DISCOVERY_STUDY_OFFER_KIND
                        | DISCOVERY_SCOUT_OFFER_KIND
                )
            })
            .filter_map(|offer| self.resident_record_for_shared_offer(actor, offer, seed))
            .collect()
    }

    fn resident_economy_autonomy_records(&self, actor: CwActor, seed: u64) -> Vec<JournalRecord> {
        if !Self::actor_can_act(actor) || !self.actor_uses_inference(actor.id) {
            return Vec::new();
        }
        // A planner-selected Pass is a complete certified decision, not a
        // hint to run another autonomous preference first.
        if let Some(record) = self.resident_pending_planner_pass_record(actor, seed, None) {
            return vec![record];
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

    #[cfg(test)]
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
        let planner_selected_discovery = record
            .projection_mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::ResolveDiscovery { .. }))
            && self
                .resident_continuities
                .get(&actor.id)
                .and_then(|continuity| continuity.pending_action.as_ref())
                .and_then(|proposal| proposal.candidate_id.as_deref())
                .is_some_and(|candidate_id| {
                    self.legal_action_candidates(Some(actor.id), &AccessContext::default())
                        .1
                        .iter()
                        .any(|offer| {
                            offer.offer_id == candidate_id
                                && self.resident_offer_matches_record(offer, record)
                        })
                });
        let item_score = |item_id| {
            self.item_by_id(item_id)
                .map(|item| self.resident_item_offer_score(actor, item))
                .unwrap_or(RESIDENT_DEFAULT_ITEM_SCORE)
        };
        let (rank, score) = if planner_selected_discovery {
            (2, 0)
        } else if let Some(intent) =
            record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::ResolveJobContribution { intent } => Some(intent),
                    _ => None,
                })
        {
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
                "open" => (55, RESIDENT_DEFAULT_ITEM_SCORE),
                "search" => (65, 0),
                NOTICE_ACTOR_OFFER_KIND => (64, 0),
                FOCUSED_NOTICE_OFFER_KIND => (64, 0),
                DISCOVERY_SEARCH_OFFER_KIND => (65, 0),
                DISCOVERY_STUDY_OFFER_KIND => (66, 0),
                DISCOVERY_SCOUT_OFFER_KIND => (67, 0),
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
            if !Self::actor_can_act(actor) || !self.actor_uses_inference(*actor_id) {
                continue;
            }
            let (_, offers) =
                self.legal_action_candidates(Some(*actor_id), &AccessContext::default());
            let hand = self.action_hand_for(Some(*actor_id), &offers);
            let records = self.resident_economy_autonomy_records(actor, seed);
            let mut found_playable_card = false;
            for record in records.into_iter().filter(|record| {
                if Self::resident_record_offer_kind(record) == "pass" {
                    return record.projection_mutations.iter().any(|mutation| {
                        matches!(mutation, ProjectionMutation::ShuffleHand { reason }
                            if reason == "resident_planner_pass")
                    });
                }
                offers.iter().any(|offer| {
                    hand.entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
                        && self.resident_offer_matches_record(offer, record)
                })
            }) {
                found_playable_card = true;
                let (rank, score) = self.resident_autonomy_record_priority(actor, &record);
                candidates.push(ResidentAutonomyCandidate {
                    actor_id: *actor_id,
                    rank,
                    score,
                    record,
                });
            }
            if !found_playable_card && hand.draw_available {
                let mut record = JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_NONE,
                        actor_id: *actor_id,
                        location_id: actor.location_id,
                        ..CwAction::default()
                    },
                    seed,
                )
                .into_actor_consequence(self.world.tick, None);
                // A resident uses the same finite-hand escape hatch as a player.
                // This is a turn-consuming pass, never a free redeal.
                record.bind_offer_kind("pass");
                record.source_location_id = Some(actor.location_id);
                record
                    .projection_mutations
                    .push(ProjectionMutation::ShuffleHand {
                        reason: "resident_pass".to_string(),
                    });
                candidates.push(ResidentAutonomyCandidate {
                    actor_id: *actor_id,
                    rank: 89,
                    score: 0,
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

    fn fairest_top_resident_candidate(
        &self,
        candidates: Vec<ResidentAutonomyCandidate>,
    ) -> Option<ResidentAutonomyCandidate> {
        let best = candidates.first()?;
        let best_rank = best.rank;
        let best_score = best.score;
        let oldest_action_seq = candidates
            .iter()
            .take_while(|candidate| candidate.rank == best_rank && candidate.score == best_score)
            .map(|candidate| {
                self.actor_autonomy
                    .get(&candidate.actor_id)
                    .map(|autonomy| autonomy.last_acted_event_seq)
                    .unwrap_or_default()
            })
            .min()
            .unwrap_or_default();
        candidates
            .into_iter()
            .take_while(|candidate| candidate.rank == best_rank && candidate.score == best_score)
            .find(|candidate| {
                self.actor_autonomy
                    .get(&candidate.actor_id)
                    .map(|autonomy| autonomy.last_acted_event_seq)
                    .unwrap_or_default()
                    == oldest_action_seq
            })
    }

    pub(super) fn best_resident_economy_autonomy_candidate(
        &mut self,
        seed: u64,
    ) -> Option<ResidentAutonomyCandidate> {
        let actor_ids = self.resident_economy_autonomy_candidate_ids();
        let candidates = self
            .resident_autonomy_candidates_for_ids(&actor_ids, seed)
            .into_iter()
            .filter(|candidate| {
                self.autonomy_allows_action(
                    candidate.record.action.actor_id,
                    candidate.record.action.kind,
                )
            })
            .collect::<Vec<_>>();
        self.fairest_top_resident_candidate(candidates)
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

// --- moved from main.rs: ripple record/candidate selection ---
impl RuntimeWorld {
    pub(crate) fn resident_ripple_candidate_ids(&self, context: &RippleContext) -> Vec<u64> {
        let candidates: Vec<CwActor> = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| {
                Self::actor_can_act(*actor)
                    && self.actor_uses_inference(actor.id)
                    && context.affected_location_ids.contains(&actor.location_id)
            })
            .collect();
        if candidates.is_empty() {
            return Vec::new();
        }
        let start = (self.world.tick as usize) % candidates.len();
        (0..candidates.len())
            .map(|offset| candidates[(start + offset) % candidates.len()].id)
            .collect()
    }

    pub(crate) fn resident_ripple_record_for_seed(
        &mut self,
        context: &RippleContext,
        seed: u64,
    ) -> Option<JournalRecord> {
        self.best_resident_ripple_candidate(context, seed)
            .map(|candidate| candidate.record)
            .filter(|record| context.budget.allow_movement || record.action.kind != CW_ACTION_MOVE)
            .filter(|record| self.ripple_move_keeps_player_company(context, &record.action))
    }

    pub(crate) fn ripple_move_keeps_player_company(
        &self,
        context: &RippleContext,
        action: &CwAction,
    ) -> bool {
        if action.kind != CW_ACTION_MOVE {
            return true;
        }
        let Some(player) = self.actor_by_id(context.source_actor_id) else {
            return false;
        };
        let Some(resident) = self.actor_by_id(action.actor_id) else {
            return false;
        };
        if resident.location_id != player.location_id {
            return true;
        }
        self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|actor| {
                Self::actor_can_act(**actor)
                    && self.actor_uses_inference(actor.id)
                    && actor.location_id == player.location_id
            })
            .take(2)
            .count()
            > 1
    }
}
// --- moved from main.rs: autonomy record generation, action selection, intent ---
impl RuntimeWorld {
    pub(crate) fn resident_economy_autonomy_action(&self, actor: CwActor) -> Option<CwAction> {
        if !Self::actor_can_act(actor) || !self.actor_uses_inference(actor.id) {
            return None;
        }
        let waiting_for_player_gift = self.resident_waits_for_player_gift(actor);
        let staying_with_active_job = self.resident_stays_with_active_job(actor);
        let pending_proposal = self
            .resident_continuities
            .get(&actor.id)
            .and_then(|continuity| continuity.pending_action.as_ref());
        if let Some(proposal) = pending_proposal {
            let action = self.resident_pending_proposed_action(actor)?;
            if !self.resident_proposed_action_matches_legal_offer(actor.id, proposal, &action) {
                return None;
            }
            if !(waiting_for_player_gift || staying_with_active_job)
                || action.kind != CW_ACTION_MOVE
            {
                return self.fresh_resident_autonomy_action(actor, action);
            }
        }
        if let Some((item, target)) = self.resident_held_healing_item_for_target(actor) {
            if let Some(action) = self.fresh_resident_autonomy_action(
                actor,
                CwAction {
                    kind: CW_ACTION_USE_ITEM,
                    actor_id: actor.id,
                    target_actor_id: target.id,
                    item_id: item.id,
                    ..CwAction::default()
                },
            ) {
                return Some(action);
            }
        }
        if let Some(candidate) = self.resident_mutual_trade_candidate(actor) {
            if let Some(action) = self.fresh_resident_autonomy_action(
                actor,
                CwAction {
                    kind: CW_ACTION_TRADE_ITEM,
                    actor_id: actor.id,
                    target_actor_id: candidate.target.id,
                    item_id: candidate.actor_item.id,
                    target_item_id: candidate.target_item.id,
                    ..CwAction::default()
                },
            ) {
                return Some(action);
            }
        }
        if let Some(candidate) = self.resident_gift_candidate(actor) {
            if let Some(action) = self.fresh_resident_autonomy_action(
                actor,
                CwAction {
                    kind: CW_ACTION_GIVE_ITEM,
                    actor_id: actor.id,
                    target_actor_id: candidate.target.id,
                    item_id: candidate.actor_item.id,
                    ..CwAction::default()
                },
            ) {
                return Some(action);
            }
        }
        if let Some(candidate) = self.resident_delivery_candidate(actor) {
            if waiting_for_player_gift || staying_with_active_job {
                return None;
            }
            if let Some(next_location_id) =
                self.next_unlocked_step_toward(actor.location_id, candidate.target_location_id)
            {
                if let Some(action) = self.fresh_resident_autonomy_action(
                    actor,
                    CwAction {
                        kind: CW_ACTION_MOVE,
                        actor_id: actor.id,
                        destination_location_id: next_location_id,
                        ..CwAction::default()
                    },
                ) {
                    return Some(action);
                }
            }
        }
        if waiting_for_player_gift {
            return None;
        }
        if let Some(memory) = self.belief_seek_target(actor) {
            if memory.location_id == actor.location_id {
                if self.resident_has_fresh_loose_item_observation(
                    actor.id,
                    memory.subject_id,
                    actor.location_id,
                ) {
                    let incoming_item = self.item_by_id(memory.subject_id)?;
                    let exchange_item_id = if self.actor_can_receive_item(actor, incoming_item.id) {
                        0
                    } else {
                        self.resident_exchange_item_for_pickup(actor, Some(incoming_item))?
                            .id
                    };
                    if let Some(action) = self.fresh_resident_autonomy_action(
                        actor,
                        CwAction {
                            kind: CW_ACTION_PICK_UP_ITEM,
                            actor_id: actor.id,
                            item_id: memory.subject_id,
                            target_item_id: exchange_item_id,
                            ..CwAction::default()
                        },
                    ) {
                        return Some(action);
                    }
                }
            }
            if !staying_with_active_job {
                if let Some(next_location_id) =
                    self.next_unlocked_step_toward(actor.location_id, memory.location_id)
                {
                    if let Some(action) = self.fresh_resident_autonomy_action(
                        actor,
                        CwAction {
                            kind: CW_ACTION_MOVE,
                            actor_id: actor.id,
                            destination_location_id: next_location_id,
                            ..CwAction::default()
                        },
                    ) {
                        return Some(action);
                    }
                }
            }
        }
        self.resident_roaming_action(actor)
    }

    pub(crate) fn resident_proposed_action_matches_legal_offer(
        &self,
        actor_id: u64,
        proposal: &AvatarProposedAction,
        action: &CwAction,
    ) -> bool {
        if action.actor_id != actor_id {
            return false;
        }
        if action.kind == CW_ACTION_NONE && proposal.kind == "pass" {
            return self.resident_planner_pass_is_current(actor_id, proposal);
        }
        let offer_kind = match action.kind {
            CW_ACTION_MOVE => "move",
            CW_ACTION_PICK_UP_ITEM => "pick_up",
            CW_ACTION_DROP_ITEM => "drop_item",
            CW_ACTION_GIVE_ITEM => "give_item",
            CW_ACTION_TRADE_ITEM => "trade_item",
            CW_ACTION_USE_ITEM | CW_ACTION_RULES_UTILIZE_ITEM => "use_item",
            _ => return false,
        };
        let (_, offers) = self.legal_action_candidates(Some(actor_id), &AccessContext::default());
        self.planner_action_offers(actor_id, &offers, self.actor_uses_inference(actor_id))
            .into_iter()
            .filter(|offer| offer.kind == offer_kind)
            .any(|offer| match action.kind {
                CW_ACTION_MOVE => offer.target.as_ref().is_some_and(|target| {
                    target.kind == "location"
                        && target.id == proposal.destination_location_id
                        && target.id == Some(action.destination_location_id)
                }),
                CW_ACTION_PICK_UP_ITEM => {
                    proposal.item_id == Some(action.item_id)
                        && offer.target.as_ref().is_some_and(|target| {
                            target.kind == "item" && target.id == Some(action.item_id)
                        })
                }
                CW_ACTION_GIVE_ITEM => {
                    proposal.item_id == Some(action.item_id)
                        && proposal.target_actor_id == Some(action.target_actor_id)
                        && Self::transfer_offer_matches_action(offer, action)
                }
                CW_ACTION_TRADE_ITEM => {
                    proposal.item_id == Some(action.item_id)
                        && proposal.target_actor_id == Some(action.target_actor_id)
                        && Self::transfer_offer_matches_action(offer, action)
                }
                CW_ACTION_USE_ITEM => {
                    proposal.item_id == Some(action.item_id)
                        && proposal.target_actor_id.unwrap_or(0) == action.target_actor_id
                        && Self::use_offer_matches_action(offer, action)
                }
                CW_ACTION_DROP_ITEM => {
                    proposal.item_id == Some(action.item_id)
                        && offer.target.as_ref().is_some_and(|target| {
                            target.kind == "item" && target.id == Some(action.item_id)
                        })
                }
                _ => false,
            })
    }

    pub(crate) fn resident_stays_with_active_job(&self, actor: CwActor) -> bool {
        self.jobs.values().any(|job| {
            self.job_status(job) == "active"
                && job.participant_ids.contains(&actor.id)
                && job.location_ids.contains(&actor.location_id)
        })
    }

    pub(crate) fn fresh_resident_autonomy_action(
        &self,
        actor: CwActor,
        action: CwAction,
    ) -> Option<CwAction> {
        let action = match action.kind {
            CW_ACTION_MOVE => match self
                .plan_move_choice_action(
                    actor.id,
                    action.destination_location_id,
                    &AccessContext::default(),
                )
                .ok()?
            {
                MovementPlan::Adjacent(action) => action,
                MovementPlan::Journey { .. } => return None,
            },
            CW_ACTION_PICK_UP_ITEM | CW_ACTION_DROP_ITEM => {
                let kind = if action.kind == CW_ACTION_PICK_UP_ITEM {
                    "pick_up"
                } else {
                    "drop_item"
                };
                self.plan_item_choice_action(actor.id, kind, action.item_id, action.target_item_id)
                    .ok()?
            }
            CW_ACTION_GIVE_ITEM => self
                .plan_transfer_choice_action(
                    actor.id,
                    "give_item",
                    action.item_id,
                    action.target_actor_id,
                    0,
                )
                .ok()?,
            CW_ACTION_TRADE_ITEM => self
                .plan_transfer_choice_action(
                    actor.id,
                    "trade_item",
                    action.item_id,
                    action.target_actor_id,
                    action.target_item_id,
                )
                .ok()?,
            CW_ACTION_USE_ITEM => self
                .plan_use_item_choice_action(actor.id, action.item_id, action.target_actor_id)
                .ok()?,
            _ => action,
        };
        if matches!(action.kind, CW_ACTION_GIVE_ITEM | CW_ACTION_TRADE_ITEM)
            && (self
                .actor_control_mode(action.target_actor_id)
                .is_direct_input()
                || self.actors_blocked(actor.id, action.target_actor_id))
        {
            return None;
        }
        (!self.resident_autonomy_action_repeats_recent_event(actor, &action)
            && self.kernel_offer_allows_action(&action))
        .then_some(action)
    }

    pub(crate) fn resident_autonomy_action_repeats_recent_event(
        &self,
        actor: CwActor,
        action: &CwAction,
    ) -> bool {
        let min_seq = self
            .world
            .next_event_seq
            .saturating_sub(RESIDENT_AUTONOMY_REPEAT_EVENT_WINDOW);
        for event in self.event_log.iter().rev() {
            if event.seq < min_seq {
                break;
            }
            if !event.success {
                continue;
            }
            match action.kind {
                CW_ACTION_TRADE_ITEM if event.type_name == "item.traded" => {
                    let same_pair = event.actor_id == Some(action.actor_id)
                        && event.target_actor_id == Some(action.target_actor_id);
                    let reverse_pair = event.actor_id == Some(action.target_actor_id)
                        && event.target_actor_id == Some(action.actor_id);
                    let same_item_pair = event.item_id == Some(action.item_id)
                        && event.target_item_id == Some(action.target_item_id);
                    let swapped_item_pair = event.item_id == Some(action.target_item_id)
                        && event.target_item_id == Some(action.item_id);
                    if same_pair
                        || reverse_pair
                        || (event.actor_id == Some(action.actor_id)
                            && (same_item_pair || swapped_item_pair))
                    {
                        return true;
                    }
                }
                CW_ACTION_GIVE_ITEM if event.type_name == "item.given" => {
                    let same_pair = event.actor_id == Some(action.actor_id)
                        && event.target_actor_id == Some(action.target_actor_id);
                    let reverse_pair = event.actor_id == Some(action.target_actor_id)
                        && event.target_actor_id == Some(action.actor_id);
                    let same_actor_item = event.actor_id == Some(action.actor_id)
                        && event.item_id == Some(action.item_id);
                    let same_target_item = event.target_actor_id == Some(action.target_actor_id)
                        && event.item_id == Some(action.item_id);
                    if same_pair || reverse_pair || same_actor_item || same_target_item {
                        return true;
                    }
                }
                CW_ACTION_PICK_UP_ITEM | CW_ACTION_DROP_ITEM
                    if matches!(event.type_name.as_str(), "item.picked_up" | "item.dropped")
                        && event.actor_id == Some(action.actor_id)
                        && event.item_id == Some(action.item_id) =>
                {
                    return true;
                }
                CW_ACTION_USE_ITEM | CW_ACTION_RULES_UTILIZE_ITEM
                    if event.type_name == "item.used"
                        && event.actor_id == Some(action.actor_id)
                        && event.item_id == Some(action.item_id) =>
                {
                    return true;
                }
                CW_ACTION_MOVE if event.type_name == "actor.moved" => {
                    let same_destination = event.actor_id == Some(action.actor_id)
                        && event.destination_location_id == Some(action.destination_location_id);
                    let immediate_return = event.actor_id == Some(action.actor_id)
                        && event.location_id == Some(action.destination_location_id)
                        && event.destination_location_id == Some(actor.location_id);
                    if same_destination || immediate_return {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }

    pub(crate) fn resident_feature_use_autonomy_record(
        &self,
        actor: CwActor,
        seed: u64,
    ) -> Option<JournalRecord> {
        let preferred = self.resident_feature_use_candidate(actor)?;
        let candidate = self
            .plan_feature_use_choice(
                actor.id,
                preferred.item_id,
                preferred.location_id,
                &preferred.feature_key,
            )
            .ok()?;
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: candidate.actor_id,
                ..CwAction::default()
            },
            seed,
        )
        .into_actor_consequence(self.world.tick, None);
        record
            .projection_mutations
            .push(ProjectionMutation::UseFeature {
                item_id: candidate.item_id,
                location_id: candidate.location_id,
                feature_key: candidate.feature_key,
                content: candidate.content,
                reason: "resident_feature_use".to_string(),
            });
        self.append_resident_autonomy_intent_projection(actor, &mut record);
        Some(record)
    }

    pub(crate) fn preferred_job_contribution_intent(
        &self,
        actor_id: u64,
    ) -> Option<JobContributionIntent> {
        let (_, offers) = self.legal_action_candidates(Some(actor_id), &AccessContext::default());
        offers
            .into_iter()
            .filter(action_offer_is_reachable)
            .filter(|offer| {
                matches!(
                    offer.kind.as_str(),
                    "prepare" | "work" | "help" | "check" | "study" | "use_item"
                )
            })
            .find_map(|offer| {
                let project = offer.project?;
                let intent = self.job_contribution_intent(
                    actor_id,
                    &offer.kind,
                    Some(&project.id),
                    project.strategy_id.as_deref(),
                    None,
                )?;
                let target_matches = offer.target.as_ref().is_some_and(|target| {
                    target.kind == intent.target.kind
                        && target.id == intent.target.id.parse::<u64>().ok()
                });
                (target_matches
                    && project.progress_clock_id == intent.strategy.clock_id
                    && project.strategy_id.as_deref() == Some(intent.strategy.id.as_str()))
                .then_some(intent)
            })
    }

    pub(crate) fn resident_job_autonomy_record(
        &self,
        actor: CwActor,
        seed: u64,
    ) -> Option<JournalRecord> {
        let intent = self.preferred_job_contribution_intent(actor.id)?;
        let action_kind = intent.strategy.action_kind.clone();
        let clock_id = intent.strategy.clock_id.clone();
        let action = match (action_kind.as_str(), &intent.strategy.resolution) {
            ("check", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_SEARCH,
                actor_id: actor.id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("study", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_STUDY,
                actor_id: actor.id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("use_item", ContributionResolutionPolicy::ExistingKernelOutcome { event_type })
                if event_type == "item.used" && intent.target.kind == "item" =>
            {
                CwAction {
                    kind: CW_ACTION_RULES_UTILIZE_ITEM,
                    actor_id: actor.id,
                    item_id: intent.target.id.parse().ok()?,
                    ..CwAction::default()
                }
            }
            ("work", ContributionResolutionPolicy::Certain) => CwAction {
                kind: CW_ACTION_PROJECT_PUSH,
                actor_id: actor.id,
                project_push: self.project_push_input(
                    actor.id,
                    &intent,
                    self.prepared_tag_active(actor.id, actor.location_id),
                )?,
                ..CwAction::default()
            },
            ("prepare" | "help", _) => CwAction {
                kind: CW_ACTION_NONE,
                actor_id: actor.id,
                ..CwAction::default()
            },
            _ => return None,
        };
        let mut record =
            JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
        record.bind_offer_kind(&action_kind);
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveJobContribution { intent });
        if let Some(pathway_id) = self.generated_pathway_id_for_progress_clock(&clock_id) {
            record
                .projection_mutations
                .push(ProjectionMutation::UpgradePathwayIfReady {
                    pathway_id,
                    progress_clock_id: clock_id,
                });
        }
        self.append_resident_autonomy_intent_projection(actor, &mut record);
        Some(record)
    }

    pub(crate) fn resident_record_for_shared_offer(
        &self,
        actor: CwActor,
        offer: &RankedActionOffer,
        seed: u64,
    ) -> Option<JournalRecord> {
        let offer = self.current_reachable_offer(actor.id, offer)?;
        let min_seq = self
            .world
            .next_event_seq
            .saturating_sub(RESIDENT_AUTONOMY_REPEAT_EVENT_WINDOW);
        let mut record = match offer.kind.as_str() {
            "rest" => {
                if !self.rest_has_recovery_target(actor.id) {
                    return None;
                }
                let (action, mutations) = self.plan_rest_action(actor.id).ok()?;
                let mut record =
                    JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
                record.bind_offer_kind("rest");
                record.projection_mutations.extend(mutations);
                record
            }
            NOTICE_ACTOR_OFFER_KIND => {
                let target_actor_id = offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "actor")
                    .and_then(|target| target.id)?;
                let (action, mutation, _) = self
                    .plan_notice_actor_action(actor.id, target_actor_id)
                    .ok()?;
                let mut record =
                    JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
                record.bind_offer_kind(NOTICE_ACTOR_OFFER_KIND);
                record.projection_mutations.push(mutation);
                record
            }
            "check" => {
                if self.event_log.iter().rev().any(|event| {
                    event.seq >= min_seq
                        && event.success
                        && event.type_name == "ability_check.rolled"
                        && event.actor_id == Some(actor.id)
                        && event.location_id == Some(actor.location_id)
                }) {
                    return None;
                }
                let target_matches = offer.target.as_ref().is_some_and(|target| {
                    target.kind == "location" && target.id == Some(actor.location_id)
                });
                if !target_matches {
                    return None;
                }
                let (action, mutations) = self.plan_notice_action(actor.id, 0).ok()?;
                let mut record =
                    JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
                record.bind_offer_kind("check");
                record.projection_mutations.extend(mutations);
                record
            }
            FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND => self
                .discovery_record_for_offer(actor.id, &offer, seed)
                .ok()?
                .into_actor_consequence(self.world.tick, None),
            "influence" => {
                let target_actor_id = offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "actor")
                    .and_then(|target| target.id)?;
                if self.event_log.iter().rev().any(|event| {
                    event.seq >= min_seq
                        && event.success
                        && event.type_name == "influence.committed"
                        && event.actor_id == Some(actor.id)
                        && event.target_actor_id == Some(target_actor_id)
                }) {
                    return None;
                }
                let action = self.plan_influence_action(actor.id, target_actor_id).ok()?;
                let mut record =
                    JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
                record.bind_offer_kind("influence");
                record
            }
            "explore_path" => {
                let (action, mut mutation, narration_plan) =
                    self.plan_scout_offer(actor.id, &offer).ok()?;
                if let ProjectionMutation::JourneyTransition { narration, .. } = &mut mutation {
                    *narration = travel_narration_fallback(&narration_plan);
                }
                let mut record =
                    JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
                record.bind_offer_kind("explore_path");
                record.projection_mutations.push(mutation);
                record
            }
            "open" => {
                let action = self
                    .plan_threshold_method_offer_action(actor.id, &offer)
                    .ok()?;
                JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None)
            }
            "search" => {
                let target = self.default_search_target(actor.id)?;
                let target_matches = offer.target.as_ref().is_some_and(|offer_target| {
                    offer_target.kind == "feature"
                        && offer_target.id == Some(target.location_id)
                        && offer_target.label.as_deref() == Some(target.name.as_str())
                });
                if !target_matches
                    || self.event_log.iter().rev().any(|event| {
                        event.seq >= min_seq
                            && event.success
                            && event.actor_id == Some(actor.id)
                            && event.location_id == Some(target.location_id)
                            && matches!(
                                event.type_name.as_str(),
                                "location.searched" | "feature.searched"
                            )
                    })
                {
                    return None;
                }
                self.search_record_for_target(actor.id, &target, seed)
                    .into_actor_consequence(self.world.tick, None)
            }
            "craft" => {
                let recipe_id = offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "recipe")
                    .and_then(|target| target.id)?;
                let recipe = self.default_craft_recipe(actor.id)?;
                if recipe.id != recipe_id
                    || self.event_log.iter().rev().any(|event| {
                        event.seq >= min_seq
                            && event.success
                            && event.type_name == "item.crafted"
                            && event.actor_id == Some(actor.id)
                            && event.content_id == Some(recipe_id)
                    })
                {
                    return None;
                }
                let (action, mutation) = if recipe.schema_version == 2 {
                    let plan = self.versioned_craft_plan(actor.id, recipe_id, None)?;
                    (
                        plan.action,
                        Some(ProjectionMutation::ResolveCraft {
                            receipt: plan.receipt,
                        }),
                    )
                } else {
                    (self.craft_action_for_recipe(actor.id, recipe_id)?, None)
                };
                if !self.kernel_offer_allows_action(&action) {
                    return None;
                }
                let mut record =
                    JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
                record.bind_offer_kind("craft");
                if let Some(mutation) = mutation {
                    record.projection_mutations.push(mutation);
                }
                record
            }
            _ => return None,
        };
        record.source_location_id = Some(actor.location_id);
        self.append_resident_autonomy_intent_projection(actor, &mut record);
        Some(record)
    }

    pub(crate) fn resident_shared_offer_autonomy_record_for_kinds(
        &self,
        actor: CwActor,
        seed: u64,
        kinds: &[&str],
    ) -> Option<JournalRecord> {
        let (_, offers) = self.legal_action_candidates(Some(actor.id), &AccessContext::default());
        kinds.iter().find_map(|kind| {
            offers
                .iter()
                .filter(|offer| offer.kind == *kind)
                .find_map(|offer| self.resident_record_for_shared_offer(actor, offer, seed))
        })
    }

    pub(crate) fn append_resident_autonomy_intent_projection(
        &self,
        actor: CwActor,
        record: &mut JournalRecord,
    ) {
        let proposal = self.resident_autonomy_intent_for_record(actor, record);
        record
            .projection_mutations
            .push(ProjectionMutation::UpdateResidentContinuity {
                resident_id: actor.id,
                proposal,
                reason: "resident_autonomy_intent".to_string(),
            });
    }

    pub(crate) fn resident_autonomy_intent_for_record(
        &self,
        actor: CwActor,
        record: &JournalRecord,
    ) -> AvatarIntentProposal {
        let action = &record.action;
        let actor_name = self
            .actor_name(actor.id)
            .unwrap_or_else(|| format!("Resident {}", actor.id));
        let mut proposed_action = AvatarProposedAction {
            kind: "wait".to_string(),
            ..AvatarProposedAction::default()
        };
        let intent = match action.kind {
            CW_ACTION_COMBAT_ATTACK | CW_ACTION_COMBAT_FINESSE_ATTACK => {
                proposed_action.kind = "attack".to_string();
                proposed_action.target_actor_id = Some(action.target_actor_id);
                let target = self
                    .actor_name(action.target_actor_id)
                    .unwrap_or_else(|| format!("Actor {}", action.target_actor_id));
                format!("{actor_name} intends to press the attack against {target}.")
            }
            CW_ACTION_COMBAT_DODGE => {
                proposed_action.kind = "defend".to_string();
                format!("{actor_name} intends to guard and watch for an opening.")
            }
            CW_ACTION_COMBAT_ESCAPE => {
                proposed_action.kind = "flee".to_string();
                proposed_action.destination_location_id = Some(action.destination_location_id);
                let destination = self
                    .location_name(action.destination_location_id)
                    .unwrap_or_else(|| format!("Location {}", action.destination_location_id));
                format!("{actor_name} intends to escape toward {destination}.")
            }
            CW_ACTION_MOVE => {
                proposed_action.kind = "move".to_string();
                proposed_action.destination_location_id = Some(action.destination_location_id);
                let destination = self
                    .location_name(action.destination_location_id)
                    .unwrap_or_else(|| format!("Location {}", action.destination_location_id));
                format!("{actor_name} intends to move toward {destination}.")
            }
            CW_ACTION_PICK_UP_ITEM => {
                proposed_action.kind = "pick_up".to_string();
                proposed_action.item_id = Some(action.item_id);
                let item = self
                    .item_name(action.item_id)
                    .unwrap_or_else(|| format!("Item {}", action.item_id));
                format!("{actor_name} intends to pick up {item}.")
            }
            CW_ACTION_DROP_ITEM => {
                proposed_action.kind = "drop".to_string();
                proposed_action.item_id = Some(action.item_id);
                let item = self
                    .item_name(action.item_id)
                    .unwrap_or_else(|| format!("Item {}", action.item_id));
                format!("{actor_name} intends to set down {item} to make room.")
            }
            CW_ACTION_GIVE_ITEM => {
                proposed_action.kind = "give".to_string();
                proposed_action.target_actor_id = Some(action.target_actor_id);
                proposed_action.item_id = Some(action.item_id);
                let item = self
                    .item_name(action.item_id)
                    .unwrap_or_else(|| format!("Item {}", action.item_id));
                let target = self
                    .actor_name(action.target_actor_id)
                    .unwrap_or_else(|| format!("Actor {}", action.target_actor_id));
                format!("{actor_name} intends to give {item} to {target}.")
            }
            CW_ACTION_TRADE_ITEM => {
                proposed_action.kind = "trade".to_string();
                proposed_action.target_actor_id = Some(action.target_actor_id);
                proposed_action.item_id = Some(action.item_id);
                let offered = self
                    .item_name(action.item_id)
                    .unwrap_or_else(|| format!("Item {}", action.item_id));
                let requested = self
                    .item_name(action.target_item_id)
                    .unwrap_or_else(|| format!("Item {}", action.target_item_id));
                let target = self
                    .actor_name(action.target_actor_id)
                    .unwrap_or_else(|| format!("Actor {}", action.target_actor_id));
                format!("{actor_name} intends to trade {offered} for {requested} with {target}.")
            }
            CW_ACTION_USE_ITEM | CW_ACTION_RULES_UTILIZE_ITEM => {
                proposed_action.kind = "use".to_string();
                proposed_action.target_actor_id =
                    (action.target_actor_id != 0).then_some(action.target_actor_id);
                proposed_action.item_id = Some(action.item_id);
                let item = self
                    .item_name(action.item_id)
                    .unwrap_or_else(|| format!("Item {}", action.item_id));
                format!("{actor_name} intends to use {item}.")
            }
            CW_ACTION_GATE_TRANSITION => {
                proposed_action.kind = "open".to_string();
                format!("{actor_name} intends to use one certified threshold method.")
            }
            CW_ACTION_RULES_SEARCH => {
                if let Some(job_intent) =
                    record
                        .projection_mutations
                        .iter()
                        .find_map(|mutation| match mutation {
                            ProjectionMutation::ResolveJobContribution { intent } => Some(intent),
                            _ => None,
                        })
                {
                    proposed_action.kind = job_intent.strategy.action_kind.clone();
                    proposed_action.target_actor_id = (job_intent.target.kind == "actor")
                        .then(|| job_intent.target.id.parse::<u64>().ok())
                        .flatten();
                    format!(
                        "{actor_name} intends to {}.",
                        job_intent.strategy.strategy_label.trim_end_matches('.')
                    )
                } else {
                    proposed_action.kind = "check".to_string();
                    proposed_action.destination_location_id = Some(actor.location_id);
                    format!("{actor_name} intends to notice what has changed here.")
                }
            }
            CW_ACTION_RULES_INFLUENCE => {
                proposed_action.kind = "influence".to_string();
                proposed_action.target_actor_id = Some(action.target_actor_id);
                let target = self
                    .actor_name(action.target_actor_id)
                    .unwrap_or_else(|| format!("Actor {}", action.target_actor_id));
                format!("{actor_name} intends to ask {target} for a useful local lead.")
            }
            CW_ACTION_REST => {
                proposed_action.kind = "rest".to_string();
                format!("{actor_name} intends to rest.")
            }
            CW_ACTION_NONE => record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::JourneyTransition {
                        journey: Some(journey),
                        ..
                    } => {
                        proposed_action.kind = "scout".to_string();
                        proposed_action.destination_location_id =
                            Some(journey.destination_location_id);
                        let destination = self
                            .location_name(journey.destination_location_id)
                            .unwrap_or_else(|| {
                                format!("Location {}", journey.destination_location_id)
                            });
                        Some(format!(
                            "{actor_name} intends to scout toward {destination}."
                        ))
                    }
                    ProjectionMutation::DiscoverSeedExit { to_location_id, .. } => {
                        proposed_action.kind = "scout".to_string();
                        proposed_action.destination_location_id = Some(*to_location_id);
                        let destination = self
                            .location_name(*to_location_id)
                            .unwrap_or_else(|| format!("Location {to_location_id}"));
                        Some(format!(
                            "{actor_name} intends to scout toward {destination}."
                        ))
                    }
                    ProjectionMutation::UseFeature {
                        item_id,
                        location_id,
                        ..
                    } => {
                        proposed_action.kind = "use".to_string();
                        proposed_action.item_id = Some(*item_id);
                        proposed_action.destination_location_id = Some(*location_id);
                        let item = self
                            .item_name(*item_id)
                            .unwrap_or_else(|| format!("Item {item_id}"));
                        let location = self
                            .location_name(*location_id)
                            .unwrap_or_else(|| format!("Location {location_id}"));
                        Some(format!(
                            "{actor_name} intends to use {item} on a room feature in {location}."
                        ))
                    }
                    ProjectionMutation::ResolveJobContribution { intent } => {
                        proposed_action.kind = intent.strategy.action_kind.clone();
                        proposed_action.target_actor_id = (intent.target.kind == "actor")
                            .then(|| intent.target.id.parse::<u64>().ok())
                            .flatten();
                        Some(format!(
                            "{actor_name} intends to {}.",
                            intent.strategy.strategy_label.trim_end_matches('.')
                        ))
                    }
                    ProjectionMutation::RecordNoticeActorFact {
                        target_actor_id, ..
                    } => {
                        proposed_action.kind = NOTICE_ACTOR_OFFER_KIND.to_string();
                        proposed_action.target_actor_id = Some(*target_actor_id);
                        let target = self
                            .actor_name(*target_actor_id)
                            .unwrap_or_else(|| format!("Avatar {target_actor_id}"));
                        Some(format!(
                            "{actor_name} intends to notice one visible detail about {target}."
                        ))
                    }
                    ProjectionMutation::ClearTag { reason, .. } if reason == "rest" => {
                        proposed_action.kind = "rest".to_string();
                        Some(format!("{actor_name} intends to rest."))
                    }
                    _ => None,
                })
                .unwrap_or_else(|| format!("{actor_name} intends to wait and observe.")),
            _ => format!("{actor_name} intends to wait and observe."),
        };
        proposed_action.reason = Some(intent.clone());
        AvatarIntentProposal {
            // Autonomy continuity is not visible dialogue. Spoken reactions are
            // generated separately through the resident inference path.
            speech: intent.clone(),
            intent: Some(intent.clone()),
            belief: None,
            desire: Some(intent),
            promise: None,
            refusal: None,
            proposed_action: Some(proposed_action),
        }
    }

    pub(crate) fn prepare_resident_local_memories(&mut self, actor_id: u64) -> Option<CwActor> {
        let actor = self.actor_by_id(actor_id)?;
        if !Self::actor_can_act(actor) || !self.actor_uses_inference(actor.id) {
            return None;
        }
        self.observe_room_for_actor(actor.id, actor.location_id);
        self.exchange_beliefs_at(actor.location_id);
        self.actor_by_id(actor_id)
    }

    pub(crate) fn resident_economy_autonomy_candidate_ids(&self) -> Vec<u64> {
        let candidates: Vec<CwActor> = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| {
                Self::actor_can_act(*actor)
                    && matches!(
                        self.actor_control_mode(actor.id),
                        ActorControlMode::LocalAi
                            | ActorControlMode::RoamingAi
                            | ActorControlMode::DelegatedAi
                    )
            })
            .collect();
        if candidates.is_empty() {
            return Vec::new();
        }
        let start = (self.world.tick as usize) % candidates.len();
        (0..candidates.len())
            .map(|offset| candidates[(start + offset) % candidates.len()].id)
            .collect()
    }

    pub(crate) fn refresh_resident_local_memories_for_ids(&mut self, actor_ids: &[u64]) {
        for actor_id in actor_ids {
            let _ = self.prepare_resident_local_memories(*actor_id);
        }
    }

    pub(crate) fn resident_record_offer_kind(record: &JournalRecord) -> String {
        if let Some(kind) = record.offer_kind.as_ref() {
            return kind.clone();
        }
        if let Some(kind) = record
            .projection_mutations
            .iter()
            .find_map(|mutation| match mutation {
                ProjectionMutation::ResolveJobContribution { intent } => {
                    Some(intent.strategy.action_kind.as_str())
                }
                ProjectionMutation::UseFeature { .. } => Some("use_feature"),
                ProjectionMutation::ResolveCraft { .. } => Some("craft"),
                ProjectionMutation::SearchFeature { .. }
                | ProjectionMutation::SearchLocation { .. } => Some("search"),
                ProjectionMutation::JourneyTransition { .. } => {
                    Some(if record.action.kind == CW_ACTION_MOVE {
                        "move"
                    } else {
                        "explore_path"
                    })
                }
                ProjectionMutation::DiscoverSeedExit { .. } => Some("explore_path"),
                ProjectionMutation::ClearTag { reason, .. } if reason == "rest" => Some("rest"),
                ProjectionMutation::ShuffleHand { .. } => Some("draw"),
                _ => None,
            })
        {
            return kind.to_string();
        }
        match record.action.kind {
            CW_ACTION_MOVE => "move",
            CW_ACTION_ABILITY_CHECK => "check",
            CW_ACTION_RULES_SEARCH => "check",
            CW_ACTION_RULES_INFLUENCE => "influence",
            CW_ACTION_SEARCH => "search",
            CW_ACTION_RULES_STUDY => "study",
            CW_ACTION_RULES_MAGIC => "cast_spell",
            CW_ACTION_PICK_UP_ITEM => "pick_up",
            CW_ACTION_DROP_ITEM => "drop_item",
            CW_ACTION_GIVE_ITEM => "give_item",
            CW_ACTION_TRADE_ITEM => "trade_item",
            CW_ACTION_USE_ITEM | CW_ACTION_RULES_UTILIZE_ITEM => "use_item",
            CW_ACTION_CRAFT => "craft",
            CW_ACTION_ATTACK | CW_ACTION_COMBAT_ATTACK | CW_ACTION_COMBAT_FINESSE_ATTACK => {
                "attack"
            }
            CW_ACTION_DEFEND | CW_ACTION_COMBAT_DODGE => "defend",
            CW_ACTION_FLEE | CW_ACTION_COMBAT_ESCAPE => "flee",
            CW_ACTION_REST => "rest",
            _ => "act",
        }
        .to_string()
    }

    pub(crate) fn resident_offer_matches_record(
        &self,
        offer: &RankedActionOffer,
        record: &JournalRecord,
    ) -> bool {
        let action = &record.action;
        if offer.kind != Self::resident_record_offer_kind(record) {
            return false;
        }
        if let Some(intent) = record
            .projection_mutations
            .iter()
            .find_map(|mutation| match mutation {
                ProjectionMutation::ResolveDiscovery { intent } => Some(intent),
                _ => None,
            })
        {
            return offer.discovery.as_ref().is_some_and(|binding| {
                binding.procedure == intent.procedure
                    && binding.slot_id == intent.slot_id
                    && binding.receipt_id == intent.receipt.id
                    && binding.claim_key == intent.claim_key
            });
        }
        if let Some(destination_location_id) =
            record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::JourneyTransition {
                        journey: Some(journey),
                        ..
                    } if action.kind != CW_ACTION_MOVE => Some(journey.destination_location_id),
                    ProjectionMutation::DiscoverSeedExit { to_location_id, .. } => {
                        Some(*to_location_id)
                    }
                    _ => None,
                })
        {
            return offer.target.as_ref().is_some_and(|target| {
                target.kind == "location" && target.id == Some(destination_location_id)
            });
        }
        if let Some((fact_id, target_actor_id)) =
            record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::RecordNoticeActorFact {
                        fact_id,
                        target_actor_id,
                        ..
                    } => Some((fact_id.as_str(), *target_actor_id)),
                    _ => None,
                })
        {
            return offer.claim_key.as_deref() == Some(fact_id)
                && offer.target.as_ref().is_some_and(|target| {
                    target.kind == "actor" && target.id == Some(target_actor_id)
                });
        }
        if action.kind == CW_ACTION_RULES_SEARCH && offer.kind == "check" {
            return offer.target.as_ref().is_some_and(|target| {
                target.kind == "location" && target.id == Some(action.location_id)
            });
        }
        if let Some(intent) = record
            .projection_mutations
            .iter()
            .find_map(|mutation| match mutation {
                ProjectionMutation::ResolveJobContribution { intent } => Some(intent),
                _ => None,
            })
        {
            return offer.target.as_ref().is_some_and(|target| {
                target.kind == intent.target.kind
                    && target.id == intent.target.id.parse::<u64>().ok()
            }) && offer.project.as_ref().is_some_and(|project| {
                project.id == intent.job_id
                    && project.strategy_id.as_deref() == Some(intent.strategy.id.as_str())
            });
        }
        if let Some((item_id, location_id, feature_key)) = record
            .projection_mutations
            .iter()
            .find_map(|mutation| match mutation {
                ProjectionMutation::UseFeature {
                    item_id,
                    location_id,
                    feature_key,
                    ..
                } => Some((*item_id, *location_id, feature_key.as_str())),
                _ => None,
            })
        {
            return Self::use_offer_matches_feature(offer, item_id, location_id, feature_key);
        }
        match action.kind {
            CW_ACTION_MOVE | CW_ACTION_FLEE | CW_ACTION_COMBAT_ESCAPE => {
                offer.target.as_ref().is_some_and(|target| {
                    target.kind == "location" && target.id == Some(action.destination_location_id)
                })
            }
            CW_ACTION_ABILITY_CHECK => offer.target.as_ref().is_some_and(|target| {
                target.kind == "location" && target.id == Some(action.location_id)
            }),
            CW_ACTION_RULES_INFLUENCE => offer.target.as_ref().is_some_and(|target| {
                target.kind == "actor" && target.id == Some(action.target_actor_id)
            }),
            CW_ACTION_RULES_SEARCH | CW_ACTION_SEARCH | CW_ACTION_NONE
                if offer.kind == "search" =>
            {
                offer.target.as_ref().is_some_and(|target| {
                    target.kind == "feature" && target.id == Some(action.location_id)
                })
            }
            CW_ACTION_RULES_STUDY => offer.project.is_some(),
            CW_ACTION_RULES_MAGIC => offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "actor" && target.id == Some(action.actor_id)),
            CW_ACTION_PICK_UP_ITEM => offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "item" && target.id == Some(action.item_id)),
            CW_ACTION_DROP_ITEM => offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "item" && target.id == Some(action.item_id)),
            CW_ACTION_GIVE_ITEM | CW_ACTION_TRADE_ITEM => {
                Self::transfer_offer_matches_action(offer, action)
            }
            CW_ACTION_USE_ITEM => Self::use_offer_matches_action(offer, action),
            CW_ACTION_RULES_UTILIZE_ITEM => offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "item" && target.id == Some(action.item_id)),
            CW_ACTION_CRAFT => offer.target.as_ref().is_some_and(|target| {
                target.kind == "recipe" && target.id == Some(action.content_id)
            }),
            CW_ACTION_ATTACK | CW_ACTION_COMBAT_ATTACK | CW_ACTION_COMBAT_FINESSE_ATTACK => {
                offer.target.as_ref().is_some_and(|target| {
                    target.kind == "actor" && target.id == Some(action.target_actor_id)
                })
            }
            CW_ACTION_DEFEND => offer.target.as_ref().is_some_and(|target| {
                target.kind == "actor" && target.id == Some(action.target_actor_id)
            }),
            CW_ACTION_COMBAT_DODGE => offer.target.as_ref().is_some_and(|target| {
                target.kind == "actor"
                    && self.combat_target_for_actor(action.content_id, action.actor_id) == target.id
            }),
            CW_ACTION_REST if offer.kind == "rest" => offer.target.is_none(),
            CW_ACTION_NONE if offer.kind == "rest" => {
                offer.target.is_none()
                    && record.projection_mutations.iter().any(|mutation| {
                        matches!(
                            mutation,
                            ProjectionMutation::ClearTag { reason, .. } if reason == "rest"
                        )
                    })
            }
            _ => false,
        }
    }

    pub(crate) fn resident_decision_trace(
        &self,
        candidate: &ResidentAutonomyCandidate,
    ) -> ResidentDecisionTrace {
        let actor = self
            .actor_by_id(candidate.actor_id)
            .expect("resident autonomy candidate must reference an active actor");
        let offer_kind = Self::resident_record_offer_kind(&candidate.record);
        let (_, offers) =
            self.legal_action_candidates(Some(candidate.actor_id), &AccessContext::default());
        let planner = self.resident_planner_proposal_for_action(actor, &candidate.record.action);
        let offers = self.planner_action_offers(
            candidate.actor_id,
            &offers,
            self.actor_uses_inference(candidate.actor_id),
        );
        let mut chosen_offer = offers
            .iter()
            .find(|offer| self.resident_offer_matches_record(offer, &candidate.record))
            .map(|offer| {
                (
                    offer.offer_id.clone(),
                    offer.composition_id.clone(),
                    offer.composition_trace.focused_encounter.clone(),
                )
            });
        let mut candidates: Vec<ResidentDecisionCandidateTrace> = offers
            .into_iter()
            .map(|offer| {
                let selected = chosen_offer
                    .as_ref()
                    .is_some_and(|(offer_id, _, _)| offer.offer_id == *offer_id);
                ResidentDecisionCandidateTrace {
                    offer_id: offer.offer_id.clone(),
                    composition_id: offer.composition_id.clone(),
                    focused_encounter: offer.composition_trace.focused_encounter.clone(),
                    kind: offer.kind.clone(),
                    provider_id: offer.provider.id.clone(),
                    target: offer.target.clone(),
                    rank: offer.rank,
                    selected,
                    rejection_reason: (!selected)
                        .then(|| "not_selected_by_resident_policy".to_string()),
                }
            })
            .collect();
        if offer_kind == "pass" {
            let (offer_id, composition_id) = planner
                .filter(|proposal| proposal.kind == "pass")
                .and_then(|proposal| {
                    proposal
                        .candidate_id
                        .clone()
                        .zip(proposal.composition_id.clone())
                })
                .unwrap_or_else(|| {
                    let pass = self
                        .action_hand_for(
                            Some(candidate.actor_id),
                            &self
                                .legal_action_candidates(
                                    Some(candidate.actor_id),
                                    &AccessContext::default(),
                                )
                                .1,
                        )
                        .pass;
                    (
                        pass.offer_id,
                        format!("think:{}:{}", pass.scene_key, pass.slot),
                    )
                });
            chosen_offer = Some((offer_id.clone(), composition_id.clone(), None));
            candidates.push(ResidentDecisionCandidateTrace {
                offer_id,
                composition_id,
                focused_encounter: None,
                kind: "pass".to_string(),
                provider_id: "action_hand_pass".to_string(),
                target: None,
                rank: u16::MAX,
                selected: true,
                rejection_reason: None,
            });
        }
        ResidentDecisionTrace {
            schema_version: 1,
            actor_id: candidate.actor_id,
            location_id: actor.location_id,
            controller: self
                .actor_control_mode(candidate.actor_id)
                .as_str()
                .to_string(),
            world_tick: self.world.tick,
            observed_through_seq: self.world.next_event_seq.saturating_sub(1),
            candidates,
            choice: ResidentDecisionChoiceTrace {
                offer_id: chosen_offer
                    .as_ref()
                    .map(|(offer_id, _, _)| offer_id.clone()),
                composition_id: chosen_offer
                    .as_ref()
                    .map(|(_, composition_id, _)| composition_id.clone()),
                focused_encounter: chosen_offer
                    .and_then(|(_, _, focused_encounter)| focused_encounter),
                offer_kind,
                policy_rank: candidate.rank,
                policy_score: candidate.score,
                action: candidate.record.action,
            },
            outcome: None,
            planning_generation_id: planner
                .and_then(|proposal| proposal.planning_generation_id.clone()),
            planner_candidate_id: planner.and_then(|proposal| proposal.candidate_id.clone()),
            planner_state_revision: planner.and_then(|proposal| proposal.state_revision),
        }
    }

    pub(crate) fn attach_resident_decision_trace(
        &self,
        mut candidate: ResidentAutonomyCandidate,
    ) -> ResidentAutonomyCandidate {
        candidate.record.resident_decision = Some(self.resident_decision_trace(&candidate));
        candidate
    }

    pub(crate) fn resident_economy_autonomy_record_for_seed(
        &mut self,
        seed: u64,
    ) -> Option<JournalRecord> {
        self.best_resident_economy_autonomy_candidate(seed)
            .map(|candidate| candidate.record)
    }

    #[cfg(test)]
    pub(crate) fn resident_economy_autonomy_action_by_priority(&mut self) -> Option<CwAction> {
        let actor_ids = self.resident_economy_autonomy_candidate_ids();
        if actor_ids.is_empty() {
            return None;
        }
        self.refresh_resident_local_memories_for_ids(&actor_ids);

        let mut candidates = Vec::new();
        for actor_id in actor_ids {
            let Some(actor) = self.actor_by_id(actor_id) else {
                continue;
            };
            let Some(action) = self.resident_economy_autonomy_action(actor) else {
                continue;
            };
            let record = JournalRecord::new(action, 0);
            let (rank, score) = self.resident_autonomy_record_priority(actor, &record);
            candidates.push(ResidentAutonomyCandidate {
                actor_id,
                rank,
                score,
                record,
            });
        }
        Self::sort_resident_autonomy_candidates(&mut candidates);
        candidates
            .into_iter()
            .next()
            .map(|candidate| candidate.record.action)
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ambient_ties_prefer_the_resident_waiting_longest() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_actor_autonomy();
        runtime
            .actor_autonomy
            .get_mut(&RATI_ACTOR_ID)
            .expect("Rati autonomy")
            .last_acted_event_seq = 90;
        runtime
            .actor_autonomy
            .get_mut(&WHISKERWIND_ACTOR_ID)
            .expect("Gust autonomy")
            .last_acted_event_seq = 0;
        let candidate = |actor_id| ResidentAutonomyCandidate {
            actor_id,
            rank: 60,
            score: 0,
            record: JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_MOVE,
                    actor_id,
                    destination_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                    ..CwAction::default()
                },
                1,
            ),
        };

        let selected = runtime
            .fairest_top_resident_candidate(vec![
                candidate(RATI_ACTOR_ID),
                candidate(WHISKERWIND_ACTOR_ID),
            ])
            .expect("one tied resident is selected");
        assert_eq!(selected.actor_id, WHISKERWIND_ACTOR_ID);
    }

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
        runtime.record_economy_disclosure(RATI_ACTOR_ID, WHISKERWIND_ACTOR_ID);
        runtime
            .draw_until_test_offer(RATI_ACTOR_ID, &AccessContext::default(), |offer| {
                offer.kind == "trade_item"
                    && offer.id
                        == format!(
                            "trade_item:{DEWBRIGHT_BUTTON_ITEM_ID}:{WHISKERWIND_ACTOR_ID}:{STORY_BUTTON_ITEM_ID}"
                        )
            })
            .expect("the mutual trade card is dealt before LocalAI scoring");

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
