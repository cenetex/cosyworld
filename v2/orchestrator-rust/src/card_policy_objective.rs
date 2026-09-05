use super::*;

const TREASURE_OBJECTIVE_SCHEMA_VERSION: u32 = 1;
const TREASURE_BRANCH_LABEL_SCHEMA_VERSION: u32 = 1;
const TREASURE_BRANCH_EVALUATOR: &str = "treasure_branch_distance_v1";
const DEFAULT_TREASURE_OBJECTIVE_MAX_TURNS: u16 = 48;
const MAX_TREASURE_OBJECTIVE_TURNS: u16 = 4_096;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum TreasureObjectiveStatus {
    #[default]
    Active,
    Completed,
    TimedOut,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct TreasureObjectiveState {
    pub(super) schema_version: u32,
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) treasure_item_id: u64,
    pub(super) max_turns: u16,
    pub(super) turns_taken: u16,
    pub(super) status: TreasureObjectiveStatus,
    pub(super) started_world_tick: u64,
    pub(super) started_event_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) resolved_event_seq: Option<u64>,
}

impl TreasureObjectiveState {
    pub(super) fn active(&self) -> bool {
        self.status == TreasureObjectiveStatus::Active
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct TreasureObjectiveStart {
    pub(super) schema_version: u32,
    pub(super) objective_id: String,
    pub(super) actor_id: u64,
    pub(super) treasure_item_id: u64,
    pub(super) max_turns: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct TreasureBranchLabel {
    pub(super) schema_version: u32,
    pub(super) objective_id: String,
    pub(super) objective_turn: u16,
    pub(super) evaluator: String,
    pub(super) child_losses: Vec<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StartTreasureObjectiveRequest {
    #[serde(default)]
    objective_id: String,
    actor_id: u64,
    treasure_item_id: u64,
    #[serde(default = "default_treasure_objective_max_turns")]
    max_turns: u16,
}

fn default_treasure_objective_max_turns() -> u16 {
    DEFAULT_TREASURE_OBJECTIVE_MAX_TURNS
}

#[derive(Debug, Serialize)]
pub(super) struct TreasureObjectiveResponse {
    ok: bool,
    status: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    objective: Option<TreasureObjectiveState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    events: Vec<EventView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn objective_response(
    ok: bool,
    status: u32,
    objective: Option<TreasureObjectiveState>,
    events: Vec<EventView>,
    error: Option<&str>,
) -> Json<TreasureObjectiveResponse> {
    Json(TreasureObjectiveResponse {
        ok,
        status,
        objective,
        events,
        error: error.map(str::to_string),
    })
}

pub(super) async fn start_treasure_objective(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<StartTreasureObjectiveRequest>,
) -> Json<TreasureObjectiveResponse> {
    if !moderation_authorized(&state, &headers) {
        return objective_response(
            false,
            403,
            None,
            Vec::new(),
            Some("moderation bearer token required"),
        );
    }

    let mut runtime = state.inner.lock().await;
    let objective_id = if payload.objective_id.trim().is_empty() {
        format!(
            "treasure:{}:{}",
            payload.actor_id, runtime.world.next_event_seq
        )
    } else {
        payload.objective_id.trim().to_string()
    };
    let start = TreasureObjectiveStart {
        schema_version: TREASURE_OBJECTIVE_SCHEMA_VERSION,
        objective_id: objective_id.clone(),
        actor_id: payload.actor_id,
        treasure_item_id: payload.treasure_item_id,
        max_turns: payload.max_turns,
    };
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: payload.actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_system();
    record
        .projection_mutations
        .push(ProjectionMutation::StartTreasureObjective(
            projection_ledger::StartTreasureObjective { start },
        ));

    if !treasure_objective_record_preconditions_hold(&runtime, &record) {
        return objective_response(
            false,
            409,
            None,
            Vec::new(),
            Some("objective, actor, or loose treasure item is not currently valid"),
        );
    }
    let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
        return objective_response(
            false,
            500,
            None,
            Vec::new(),
            Some("treasure objective could not be committed"),
        );
    };
    let objective = runtime.treasure_objectives.get(&objective_id).cloned();
    drop(runtime);
    if status == CW_OK {
        broadcast_events(&state, &events);
    }
    objective_response(
        status == CW_OK,
        status,
        objective,
        events,
        (status != CW_OK).then_some("treasure objective was refused"),
    )
}

fn valid_objective_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

pub(super) fn treasure_objective_record_preconditions_hold(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
) -> bool {
    let starts = record
        .projection_mutations
        .iter()
        .filter_map(|mutation| match mutation {
            ProjectionMutation::StartTreasureObjective(mutation) => Some(&mutation.start),
            _ => None,
        })
        .collect::<Vec<_>>();
    if starts.is_empty() {
        return true;
    }
    if starts.len() != 1
        || record.action.kind != CW_ACTION_NONE
        || record.origin != JournalOrigin::System
    {
        return false;
    }
    let start = starts[0];
    if start.schema_version != TREASURE_OBJECTIVE_SCHEMA_VERSION
        || start.actor_id == 0
        || start.actor_id != record.action.actor_id
        || start.treasure_item_id == 0
        || !valid_objective_id(&start.objective_id)
        || !(1..=MAX_TREASURE_OBJECTIVE_TURNS).contains(&start.max_turns)
        || runtime
            .treasure_objectives
            .contains_key(&start.objective_id)
        || runtime
            .treasure_objectives
            .values()
            .any(|objective| objective.actor_id == start.actor_id && objective.active())
    {
        return false;
    }
    let actor_is_active = runtime
        .actor_by_id(start.actor_id)
        .is_some_and(RuntimeWorld::actor_can_act)
        && runtime.actor_uses_inference(start.actor_id);
    let treasure_is_loose = runtime
        .item_by_id(start.treasure_item_id)
        .is_some_and(|item| {
            item.zone == CW_CARD_ZONE_WORLD && item.holder_actor_id == 0 && item.location_id != 0
        });
    actor_is_active && treasure_is_loose
}

impl RuntimeWorld {
    pub(super) fn actor_has_active_treasure_objective(&self, actor_id: u64) -> bool {
        self.treasure_objectives
            .values()
            .any(|objective| objective.actor_id == actor_id && objective.active())
    }

    pub(super) fn prepare_card_policy_objective_plan(
        &self,
        mut plan: AvatarReplyPlan,
    ) -> AvatarReplyPlan {
        if self.actor_has_active_treasure_objective(plan.speaker_actor_id) {
            plan.planner_requested = true;
        }
        self.prepare_resident_planner_snapshot(plan)
    }

    pub(super) fn apply_treasure_objective_start(
        &mut self,
        start: &TreasureObjectiveStart,
    ) -> Option<EventView> {
        if self.treasure_objectives.contains_key(&start.objective_id) {
            return None;
        }
        let mut event = self.append_async_job_event(
            "treasure_objective.started",
            start.actor_id,
            None,
            Some(format!(
                "Treasure objective {} started with a {}-turn budget.",
                start.objective_id, start.max_turns
            )),
        );
        event.success = true;
        let state = TreasureObjectiveState {
            schema_version: TREASURE_OBJECTIVE_SCHEMA_VERSION,
            id: start.objective_id.clone(),
            actor_id: start.actor_id,
            treasure_item_id: start.treasure_item_id,
            max_turns: start.max_turns,
            turns_taken: 0,
            status: TreasureObjectiveStatus::Active,
            started_world_tick: self.world.tick,
            started_event_seq: event.seq,
            resolved_event_seq: None,
        };
        self.treasure_objectives.insert(state.id.clone(), state);
        Some(event)
    }

    pub(super) fn apply_treasure_objective_progress(
        &mut self,
        record: &JournalRecord,
        status: u32,
    ) -> Vec<EventView> {
        if status != CW_OK || record.action.actor_id == 0 {
            return Vec::new();
        }
        let actor_id = record.action.actor_id;
        let Some(objective_id) = self
            .treasure_objectives
            .values()
            .find(|objective| objective.actor_id == actor_id && objective.active())
            .map(|objective| objective.id.clone())
        else {
            return Vec::new();
        };
        let counts_as_turn = record
            .resident_decision
            .as_ref()
            .is_some_and(|decision| decision.actor_id == actor_id)
            || (record.action.kind != CW_ACTION_SAY
                && record.resident_planning.as_ref().is_some_and(|planning| {
                    planning.actor_id == actor_id && planning.card_policy.is_some()
                }));
        let treasure_item_id = self.treasure_objectives[&objective_id].treasure_item_id;
        let completed = self
            .item_by_id(treasure_item_id)
            .is_some_and(|item| item.holder_actor_id == actor_id);
        if !completed && !counts_as_turn {
            return Vec::new();
        }

        let objective = self
            .treasure_objectives
            .get_mut(&objective_id)
            .expect("active treasure objective remains present");
        if counts_as_turn {
            objective.turns_taken = objective.turns_taken.saturating_add(1);
        }
        let resolved_status = if completed {
            Some(TreasureObjectiveStatus::Completed)
        } else if objective.turns_taken >= objective.max_turns {
            Some(TreasureObjectiveStatus::TimedOut)
        } else {
            None
        };
        let Some(resolved_status) = resolved_status else {
            return Vec::new();
        };
        objective.status = resolved_status;
        let turns_taken = objective.turns_taken;
        let event_type = match resolved_status {
            TreasureObjectiveStatus::Completed => "treasure_objective.completed",
            TreasureObjectiveStatus::TimedOut => "treasure_objective.timed_out",
            TreasureObjectiveStatus::Active => unreachable!(),
        };
        let content = format!(
            "Treasure objective {} {} after {} decisions.",
            objective_id,
            if completed { "completed" } else { "timed out" },
            turns_taken
        );
        let mut event = self.append_async_job_event(event_type, actor_id, None, Some(content));
        event.success = completed;
        if let Some(objective) = self.treasure_objectives.get_mut(&objective_id) {
            objective.resolved_event_seq = Some(event.seq);
        }
        vec![event]
    }

    pub(super) fn treasure_branch_label(
        &self,
        actor_id: u64,
        deck: &[(&RankedActionOffer, ResidentPlannerCandidate)],
    ) -> Option<TreasureBranchLabel> {
        let objective = self
            .treasure_objectives
            .values()
            .find(|objective| objective.actor_id == actor_id && objective.active())?;
        let child_losses = deck
            .iter()
            .enumerate()
            .map(|(index, (offer, candidate))| {
                self.treasure_branch_child_loss(objective, actor_id, offer, candidate, index)
            })
            .collect::<Vec<_>>();
        Some(TreasureBranchLabel {
            schema_version: TREASURE_BRANCH_LABEL_SCHEMA_VERSION,
            objective_id: objective.id.clone(),
            objective_turn: objective.turns_taken,
            evaluator: TREASURE_BRANCH_EVALUATOR.to_string(),
            child_losses,
        })
    }

    fn treasure_branch_child_loss(
        &self,
        objective: &TreasureObjectiveState,
        actor_id: u64,
        offer: &RankedActionOffer,
        candidate: &ResidentPlannerCandidate,
        candidate_index: usize,
    ) -> u16 {
        let maximum_loss = objective
            .max_turns
            .saturating_sub(objective.turns_taken)
            .saturating_add(1);
        let seed = stable_branch_seed(
            &objective.id,
            offer.state_revision,
            &offer.offer_id,
            candidate_index,
        );
        let Ok(mut record) = self.treasure_branch_record(actor_id, offer, candidate, seed) else {
            return maximum_loss;
        };
        bind_focused_encounter_context(self, &mut record);
        self.bind_route_precondition(&mut record);
        self.bind_threshold_intent(&mut record);
        let mut branch = self.clone();
        let (status, _) = branch.apply_journal_record(&record);
        if status != CW_OK {
            return maximum_loss;
        }
        branch
            .treasure_remaining_steps(objective.actor_id, objective.treasure_item_id)
            .map(|remaining| remaining.saturating_add(1).min(maximum_loss))
            .unwrap_or(maximum_loss)
    }

    fn treasure_branch_record(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
        _candidate: &ResidentPlannerCandidate,
        seed: u64,
    ) -> Result<JournalRecord, String> {
        let actor = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
            .ok_or_else(|| "candidate actor is unavailable".to_string())?;
        self.resident_card_policy_record_for_offer(actor, offer, seed, None)
            .ok_or_else(|| "candidate kind is not branch-evaluable".to_string())
    }

    fn treasure_remaining_steps(&self, actor_id: u64, treasure_item_id: u64) -> Option<u16> {
        let actor = self.actor_by_id(actor_id)?;
        let treasure = self.item_by_id(treasure_item_id)?;
        if treasure.holder_actor_id == actor_id {
            return Some(0);
        }
        let target_location_id = if treasure.holder_actor_id != 0 {
            self.actor_by_id(treasure.holder_actor_id)?.location_id
        } else if treasure.zone == CW_CARD_ZONE_WORLD && treasure.location_id != 0 {
            treasure.location_id
        } else {
            return None;
        };
        let travel = self.shortest_unlocked_distance(actor.location_id, target_location_id)?;
        Some(travel.saturating_add(1))
    }

    fn shortest_unlocked_distance(&self, from: u64, target: u64) -> Option<u16> {
        if from == target {
            return Some(0);
        }
        let mut visited = BTreeSet::from([from]);
        let mut queue = VecDeque::from([(from, 0_u16)]);
        while let Some((location_id, distance)) = queue.pop_front() {
            for exit in self.world.exits[..self.world.exit_count]
                .iter()
                .filter(|exit| {
                    exit.from_location_id == location_id && exit.flags & CW_EXIT_LOCKED == 0
                })
            {
                if !visited.insert(exit.to_location_id) {
                    continue;
                }
                let next_distance = distance.saturating_add(1);
                if exit.to_location_id == target {
                    return Some(next_distance);
                }
                queue.push_back((exit.to_location_id, next_distance));
            }
        }
        None
    }
}

fn stable_branch_seed(
    objective_id: &str,
    state_revision: u64,
    offer_id: &str,
    candidate_index: usize,
) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in objective_id
        .bytes()
        .chain(state_revision.to_le_bytes())
        .chain(offer_id.bytes())
        .chain((candidate_index as u64).to_le_bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[derive(Clone, Debug)]
struct CommittedResidentPolicyTurn {
    action: CwAction,
    offer_kind: String,
    offer_label: String,
    offer_id: String,
    events: Vec<EventView>,
}

impl CommittedResidentPolicyTurn {
    fn narration_prompt(&self) -> String {
        let outcomes = self
            .events
            .iter()
            .filter(|event| event.success)
            .filter_map(|event| {
                event
                    .content
                    .as_deref()
                    .map(str::trim)
                    .filter(|content| !content.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        (!event.type_name.is_empty())
                            .then(|| event.type_name.replace(['.', '_'], " "))
                    })
            })
            .take(4)
            .collect::<Vec<_>>();
        format!(
            "Your local instinct already committed the public action \"{}\" ({}). \
The authoritative outcome is: {}. Speak one short in-character after-the-fact line about the \
instinct behind that completed action. Do not propose another action and do not invent an outcome.",
            self.offer_label,
            self.offer_kind.replace('_', " "),
            if outcomes.is_empty() {
                "the kernel accepted the action exactly as offered".to_string()
            } else {
                outcomes.join(" | ")
            }
        )
    }
}

fn commit_resident_card_policy_turn(
    state: &AppState,
    runtime: &mut RuntimeWorld,
    base_plan: &AvatarReplyPlan,
    rollout: &CardPolicyRollout,
) -> Result<Option<CommittedResidentPolicyTurn>, String> {
    if rollout.mode != CardPolicyRolloutMode::Live || !base_plan.planner_requested {
        return Ok(None);
    }
    if !runtime.actor_has_active_treasure_objective(base_plan.speaker_actor_id) {
        return Ok(None);
    }
    let maximum_draws = base_plan
        .card_policy_snapshot
        .as_ref()
        .map(|snapshot| snapshot.deck_candidate_ids.len().saturating_add(1))
        .unwrap_or(1)
        .clamp(1, 128);
    let mut accumulated_events = Vec::new();
    for draw_index in 0..=maximum_draws {
        let plan = runtime.prepare_resident_planner_snapshot(base_plan.clone());
        let planning = request_resident_card_policy(rollout, &plan);
        let action = planning
            .trace
            .card_policy
            .as_ref()
            .map(|policy| policy.action)
            .ok_or_else(|| {
                planning
                    .trace
                    .card_policy_failure_code
                    .clone()
                    .unwrap_or_else(|| "card_policy_decision_missing".to_string())
            })?;
        match action {
            CardPolicyAction::A | CardPolicyAction::B => {
                let seed = runtime.next_seed_value();
                let Some((record, offer)) =
                    runtime.resident_card_policy_action_record(&plan, &planning, seed)
                else {
                    return Err("card_policy_selected_offer_stale_or_illegal".to_string());
                };
                let committed_action = record.action;
                let Ok((status, events)) = commit_journal_record(state, runtime, record) else {
                    return Err("card_policy_action_commit_failed".to_string());
                };
                accumulated_events.extend(events);
                if status != CW_OK {
                    return Err(format!("card_policy_kernel_rejected:{status}"));
                }
                return Ok(Some(CommittedResidentPolicyTurn {
                    action: committed_action,
                    offer_kind: offer.kind,
                    offer_label: offer.accessible_label,
                    offer_id: offer.offer_id,
                    events: accumulated_events,
                }));
            }
            CardPolicyAction::Draw => {
                let seed = runtime.next_seed_value();
                let Some(record) = runtime.resident_card_policy_draw_record(&plan, &planning, seed)
                else {
                    return Err("card_policy_draw_stale_or_illegal".to_string());
                };
                let committed_action = record.action;
                let Ok((status, events)) = commit_journal_record(state, runtime, record) else {
                    return Err("card_policy_draw_commit_failed".to_string());
                };
                accumulated_events.extend(events);
                if status != CW_OK {
                    return Err(format!("card_policy_draw_kernel_rejected:{status}"));
                }
                if !runtime.actor_has_active_treasure_objective(base_plan.speaker_actor_id)
                    || draw_index == maximum_draws
                {
                    return Ok(Some(CommittedResidentPolicyTurn {
                        action: committed_action,
                        offer_kind: "draw".to_string(),
                        offer_label: "think about one Story Hand card".to_string(),
                        offer_id: format!(
                            "resident-card-policy-draw:{}:{}",
                            base_plan.speaker_actor_id, draw_index
                        ),
                        events: accumulated_events,
                    }));
                }
            }
        }
    }
    unreachable!("bounded card-policy turn always selects or returns its final draw")
}

fn resident_card_policy_narration_plan(
    runtime: &RuntimeWorld,
    mut plan: AvatarReplyPlan,
    committed: &CommittedResidentPolicyTurn,
) -> AvatarReplyPlan {
    if let Some(actor) = runtime.actor_by_id(plan.speaker_actor_id) {
        let location_meta = runtime.location_meta_for(actor.location_id);
        plan.location_id = actor.location_id;
        plan.location_name = runtime
            .location_name(actor.location_id)
            .unwrap_or_else(|| "Unknown Location".to_string());
        plan.location_title = location_meta.title;
        plan.location_description = location_meta.description;
        plan.location_persona = location_meta.persona;
        plan.location_evidence =
            runtime.conversation_location_evidence(actor.location_id, actor.id, None);
        plan.public_room_memory = runtime.recent_public_room_evidence(actor.location_id, 3);
        plan.cast = runtime.room_cast_names(actor.location_id);
        plan.recent_lines = runtime.recent_room_lines(actor.location_id, 8);
        plan.recent_activity = runtime.recent_room_activity(actor.location_id, 10);
        plan.resident_continuity = runtime.resident_continuity_for(actor);
        plan.economy_note = runtime.resident_economy_prompt_note(actor, None);
        plan.goals = runtime.narrative_goal_lines(Some(actor.id), actor.location_id);
    }
    plan.user_text = committed.narration_prompt();
    plan.context_spine = runtime
        .avatar_context_spine(
            plan.speaker_actor_id,
            plan.incoming_turn
                .as_ref()
                .map(|turn| turn.speaker_actor_id),
            plan.incoming_turn.clone(),
            plan.user_text.clone(),
        )
        .unwrap_or_default();
    plan.caused_by_event_seq = committed.events.last().map(|event| event.seq);
    plan.observed_through_seq = committed.events.last().map(|event| event.seq);
    plan.source_world_tick = Some(runtime.world.tick);
    plan.source_location_id = Some(plan.location_id);
    plan.publication_beat_id = format!(
        "resident-card-policy-narration:{}:{}",
        plan.speaker_actor_id,
        committed
            .events
            .last()
            .map(|event| event.seq)
            .unwrap_or_default()
    );
    plan.planner_requested = false;
    plan.planner_candidates.clear();
    plan.card_policy_snapshot = None;
    plan
}

fn resident_card_policy_fallback_line(
    plan: &AvatarReplyPlan,
    committed: &CommittedResidentPolicyTurn,
) -> String {
    match plan.speech_mode.as_str() {
        "emoji_only" => "✨➡️".to_string(),
        "emote_only" => format!(
            "*{} follows a quiet instinct: {}.*",
            plan.speaker_name, committed.offer_label
        ),
        "oracle" => format!(
            "Root: Instinct chose {}. Ring: The choice is already made.",
            committed.offer_label
        ),
        _ => format!("I followed the pull to {}.", committed.offer_label),
    }
}

fn commit_resident_card_policy_fallback(
    state: &AppState,
    runtime: &mut RuntimeWorld,
    plan: &AvatarReplyPlan,
    committed: &CommittedResidentPolicyTurn,
    relationship_reply: Option<&RelationshipReplyExpectation>,
) -> Option<Vec<EventView>> {
    let actor = runtime
        .actor_by_id(plan.speaker_actor_id)
        .filter(|actor| RuntimeWorld::actor_can_act(*actor))?;
    let content_id = runtime.next_content_id_value();
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_SAY,
            actor_id: actor.id,
            content_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.caused_by_event_seq = committed.events.last().map(|event| event.seq);
    record.source_world_tick = Some(runtime.world.tick);
    record.observed_through_seq = committed.events.last().map(|event| event.seq);
    record.source_location_id = Some(actor.location_id);
    record.content_upserts.insert(
        content_id,
        resident_card_policy_fallback_line(plan, committed),
    );
    if let Some(expectation) = relationship_reply {
        record
            .projection_mutations
            .push(ProjectionMutation::SetRelationshipDialogueStatus {
                relationship_actor_id: expectation.actor_id,
                target_actor_id: expectation.target_actor_id,
                status: RELATIONSHIP_DIALOGUE_DELIVERED.to_string(),
                reason: "the committed action received an authored fallback narration".to_string(),
            });
    }
    let Ok((status, events)) = commit_journal_record(state, runtime, record) else {
        return None;
    };
    (status == CW_OK).then_some(events)
}

pub(super) async fn complete_avatar_reply(
    state: &AppState,
    plan: AvatarReplyPlan,
    relationship_reply: Option<&RelationshipReplyExpectation>,
) -> Result<bool, String> {
    let (plan, committed) = {
        let mut runtime = state.inner.lock().await;
        let plan = runtime.prepare_card_policy_objective_plan(plan);
        let committed = state
            .card_policy
            .as_deref()
            .filter(|rollout| rollout.mode == CardPolicyRolloutMode::Live)
            .map(|rollout| commit_resident_card_policy_turn(state, &mut runtime, &plan, rollout))
            .transpose()?
            .flatten();
        let narration_plan = committed
            .as_ref()
            .map(|committed| resident_card_policy_narration_plan(&runtime, plan.clone(), committed))
            .unwrap_or(plan);
        (narration_plan, committed)
    };
    if let Some(committed) = committed.as_ref() {
        tracing::debug!(
            actor_id = committed.action.actor_id,
            action_kind = committed.action.kind,
            offer_id = %committed.offer_id,
            "resident card policy committed before narration"
        );
        broadcast_events(state, &committed.events);
    }
    if resident_uses_image_reply(plan.speaker_actor_id) {
        return match complete_resident_image_reply(state, &plan, relationship_reply).await {
            Ok(published) => Ok(published || committed.is_some()),
            Err(error) if committed.is_some() => {
                warn!("resident image narration failed after committed action: {error}");
                Ok(true)
            }
            Err(error) => Err(error),
        };
    }
    let proposal = match avatar_reply_intent(state, &plan).await {
        Ok(proposal) => proposal,
        Err(error) => {
            warn!("AI resident narration failed: {}", error);
            record_rejected_ai_publication(state, &error);
            if let Some(committed) = committed.as_ref() {
                let mut runtime = state.inner.lock().await;
                let fallback = commit_resident_card_policy_fallback(
                    state,
                    &mut runtime,
                    &plan,
                    committed,
                    relationship_reply,
                );
                drop(runtime);
                if let Some(events) = fallback {
                    broadcast_events(state, &events);
                }
                return Ok(true);
            }
            return Err(error.to_string());
        }
    };
    let mut runtime = state.inner.lock().await;
    let Some(events) = commit_resident_reply_record(
        state,
        &mut runtime,
        &plan,
        proposal,
        relationship_reply,
        None,
    ) else {
        return Ok(committed.is_some());
    };
    drop(runtime);
    broadcast_events(state, &events);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_test_treasure_objective(runtime: &mut RuntimeWorld, max_turns: u16) {
        let treasure_item_id = runtime.world.items[..runtime.world.item_count]
            .iter()
            .find(|item| {
                item.zone == CW_CARD_ZONE_WORLD
                    && item.holder_actor_id == 0
                    && item.location_id != 0
            })
            .expect("seeded world has a loose treasure candidate")
            .id;
        runtime.treasure_objectives.insert(
            "test-card-policy-treasure".to_string(),
            TreasureObjectiveState {
                schema_version: 1,
                id: "test-card-policy-treasure".to_string(),
                actor_id: RATI_ACTOR_ID,
                treasure_item_id,
                max_turns,
                turns_taken: 0,
                status: TreasureObjectiveStatus::Active,
                started_world_tick: runtime.world.tick,
                started_event_seq: runtime.world.next_event_seq.saturating_sub(1),
                resolved_event_seq: None,
            },
        );
    }

    fn live_test_card_policy(
        plan: &AvatarReplyPlan,
        target: CardPolicyAction,
    ) -> Arc<CardPolicyRollout> {
        use cosyworld_orchestrator::card_policy::CardPolicyModel;

        for seed in 0..10_000 {
            let model = CardPolicyModel::new(seed);
            if test_card_policy_action(&model, plan) == target {
                return Arc::new(CardPolicyRollout {
                    mode: CardPolicyRolloutMode::Live,
                    model_hash: model.model_hash(),
                    model: Arc::new(model),
                    top_k: 1,
                });
            }
        }
        panic!("no deterministic model selected {target:?}");
    }

    fn test_card_policy_action(
        model: &cosyworld_orchestrator::card_policy::CardPolicyModel,
        plan: &AvatarReplyPlan,
    ) -> CardPolicyAction {
        use cosyworld_orchestrator::card_policy::CARD_POLICY_FEATURES;

        let snapshot = plan
            .card_policy_snapshot
            .as_ref()
            .expect("prepared card-policy snapshot");
        let features = snapshot
            .candidate_features_q15
            .iter()
            .map(|features| {
                let features: &[i16; CARD_POLICY_FEATURES] = features
                    .as_slice()
                    .try_into()
                    .expect("fixed card-policy feature shape");
                *features
            })
            .collect::<Vec<_>>();
        model
            .rank(&features)
            .expect("rank test observation")
            .action_for_hand(snapshot.hand_candidate_indices, 1)
            .expect("adapt test ranking")
    }

    #[test]
    fn active_objective_promotes_a_voice_reply_to_a_labeled_planner_turn() {
        let mut runtime = RuntimeWorld::seeded();
        active_test_treasure_objective(&mut runtime, 8);
        let plan = runtime
            .resident_reply_plan_for_target(
                SKULL_ACTOR_ID,
                RATI_ACTOR_ID,
                "Which path should we take?",
            )
            .expect("seeded resident reply plan");
        assert!(!plan.planner_requested);

        let prepared = runtime.prepare_card_policy_objective_plan(plan);

        assert!(prepared.planner_requested);
        assert!(!prepared.planner_candidates.is_empty());
        assert!(prepared
            .card_policy_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.branch_label.as_ref())
            .is_some_and(|label| label.objective_id == "test-card-policy-treasure"));
    }

    #[tokio::test]
    async fn live_card_policy_commits_action_before_fallback_narration() {
        let mut runtime = RuntimeWorld::seeded();
        active_test_treasure_objective(&mut runtime, 8);
        let mut plan = runtime
            .resident_reply_plan_for_target(
                SKULL_ACTOR_ID,
                RATI_ACTOR_ID,
                "Something glints beyond the room.",
            )
            .expect("seeded resident reply plan");
        plan.planner_requested = true;
        let plan = runtime.prepare_resident_planner_snapshot(plan);
        let rollout = live_test_card_policy(&plan, CardPolicyAction::A);
        let first_new_seq = runtime.world.next_event_seq;
        let mut state = test_app_state(runtime, None);
        state.card_policy = Some(rollout);

        assert!(complete_avatar_reply(&state, plan, None)
            .await
            .expect("committed action survives unavailable narration provider"));

        let runtime = state.inner.lock().await;
        let new_events = runtime
            .event_log
            .iter()
            .filter(|event| event.seq >= first_new_seq)
            .collect::<Vec<_>>();
        let narration_seq = new_events
            .iter()
            .find(|event| {
                event.type_name == "message.created" && event.actor_id == Some(RATI_ACTOR_ID)
            })
            .map(|event| event.seq)
            .expect("authored fallback narration was committed");
        assert!(new_events.iter().any(|event| {
            event.seq < narration_seq
                && event.actor_id == Some(RATI_ACTOR_ID)
                && event.type_name != "message.created"
                && event.type_name != "treasure_objective.completed"
                && event.type_name != "treasure_objective.timed_out"
        }));
        assert!(runtime
            .card_policy_preferences
            .get(&RATI_ACTOR_ID)
            .is_some_and(|preferences| !preferences.is_empty()));

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("card-policy history survives a snapshot round trip");
        assert_eq!(
            restored.card_policy_preferences,
            runtime.card_policy_preferences
        );
    }

    #[tokio::test]
    async fn live_card_policy_thinks_one_slot_then_reranks_the_replacement() {
        use cosyworld_orchestrator::card_policy::CardPolicyModel;

        let mut runtime = RuntimeWorld::seeded();
        active_test_treasure_objective(&mut runtime, 8);
        let mut plan = runtime
            .resident_reply_plan_for_target(
                SKULL_ACTOR_ID,
                RATI_ACTOR_ID,
                "The first Story Hand choices feel wrong.",
            )
            .expect("seeded resident reply plan");
        plan.planner_requested = true;
        let plan = runtime.prepare_resident_planner_snapshot(plan);

        let mut after_draw = runtime.clone();
        let (_, offers) =
            after_draw.legal_action_candidates(Some(RATI_ACTOR_ID), &AccessContext::default());
        let hand = after_draw.action_hand_for(Some(RATI_ACTOR_ID), &offers);
        let slot = STORY_HAND_SLOTS
            .iter()
            .position(|candidate| *candidate == hand.pass.slot)
            .expect("resident Think has an exact Story Hand slot");
        let (scene_key, _) = after_draw.story_hand_scene_for_actor(RATI_ACTOR_ID);
        let mut story_state = after_draw.story_hand_state_for_scene(RATI_ACTOR_ID, &scene_key);
        story_state.slot_generations[slot] = story_state.slot_generations[slot].saturating_add(1);
        story_state.free_think_used = true;
        after_draw
            .story_hand_states
            .insert(RATI_ACTOR_ID, story_state);
        let after_draw_plan = after_draw.prepare_resident_planner_snapshot(plan.clone());
        let rollout = (0..10_000)
            .find_map(|seed| {
                let model = CardPolicyModel::new(seed);
                (test_card_policy_action(&model, &plan) == CardPolicyAction::Draw
                    && test_card_policy_action(&model, &after_draw_plan) != CardPolicyAction::Draw)
                    .then(|| {
                        Arc::new(CardPolicyRollout {
                            mode: CardPolicyRolloutMode::Live,
                            model_hash: model.model_hash(),
                            model: Arc::new(model),
                            top_k: 1,
                        })
                    })
            })
            .expect("a deterministic model draws once and then selects the new hand");
        let first_new_seq = runtime.world.next_event_seq;
        let mut state = test_app_state(runtime, None);
        state.card_policy = Some(rollout);

        assert!(complete_avatar_reply(&state, plan, None)
            .await
            .expect("draw and committed action survive unavailable narration provider"));

        let runtime = state.inner.lock().await;
        let new_events = runtime
            .event_log
            .iter()
            .filter(|event| event.seq >= first_new_seq)
            .collect::<Vec<_>>();
        let draw_seq = new_events
            .iter()
            .find(|event| event.type_name == "hand.thought")
            .map(|event| event.seq)
            .expect("Think advanced one authoritative Story Hand slot");
        let narration_seq = new_events
            .iter()
            .find(|event| event.type_name == "message.created")
            .map(|event| event.seq)
            .expect("fallback narrated the final action");
        assert!(new_events.iter().any(|event| {
            event.seq > draw_seq
                && event.seq < narration_seq
                && event.actor_id == Some(RATI_ACTOR_ID)
                && event.type_name != "hand.thought"
        }));
        let generations = runtime
            .story_hand_states
            .get(&RATI_ACTOR_ID)
            .map(|state| state.slot_generations)
            .expect("resident Think keeps an actor-scoped Story Hand state");
        assert!(generations[slot] >= 1);
        assert!(generations
            .iter()
            .enumerate()
            .all(|(index, generation)| index == slot || *generation == 0));
    }

    fn loose_treasure(runtime: &RuntimeWorld) -> CwItem {
        runtime.world.items[..runtime.world.item_count]
            .iter()
            .copied()
            .find(|item| {
                item.zone == CW_CARD_ZONE_WORLD
                    && item.holder_actor_id == 0
                    && item.location_id != 0
            })
            .expect("seed world has a loose item")
    }

    fn objective_record(
        runtime: &RuntimeWorld,
        actor_id: u64,
        treasure_item_id: u64,
        max_turns: u16,
    ) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_system();
        record
            .projection_mutations
            .push(ProjectionMutation::StartTreasureObjective(
                projection_ledger::StartTreasureObjective {
                    start: TreasureObjectiveStart {
                        schema_version: TREASURE_OBJECTIVE_SCHEMA_VERSION,
                        objective_id: "objective:test".to_string(),
                        actor_id,
                        treasure_item_id,
                        max_turns,
                    },
                },
            ));
        record
    }

    #[test]
    fn treasure_objective_is_journaled_and_snapshot_replayable() {
        let mut runtime = RuntimeWorld::seeded();
        let treasure = loose_treasure(&runtime);
        let record = objective_record(&runtime, RATI_ACTOR_ID, treasure.id, 12);
        assert!(treasure_objective_record_preconditions_hold(
            &runtime, &record
        ));
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "treasure_objective.started"));
        let objective = &runtime.treasure_objectives["objective:test"];
        assert_eq!(objective.treasure_item_id, treasure.id);
        assert_eq!(objective.status, TreasureObjectiveStatus::Active);

        let bytes = serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime)).unwrap();
        let snapshot: RuntimeSnapshot = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(snapshot.treasure_objectives["objective:test"], *objective);
    }

    #[test]
    fn treasure_objective_times_out_on_a_resident_decision() {
        let mut runtime = RuntimeWorld::seeded();
        let treasure = loose_treasure(&runtime);
        let start = objective_record(&runtime, RATI_ACTOR_ID, treasure.id, 1);
        assert_eq!(runtime.apply_journal_record(&start).0, CW_OK);

        let action = CwAction {
            kind: CW_ACTION_NONE,
            actor_id: RATI_ACTOR_ID,
            ..CwAction::default()
        };
        let mut decision =
            JournalRecord::new(action, 991_002).into_actor_consequence(runtime.world.tick, None);
        decision.resident_decision = Some(ResidentDecisionTrace {
            schema_version: 1,
            actor_id: RATI_ACTOR_ID,
            location_id: runtime.actor_by_id(RATI_ACTOR_ID).unwrap().location_id,
            controller: "test".to_string(),
            world_tick: runtime.world.tick,
            observed_through_seq: runtime.world.next_event_seq.saturating_sub(1),
            candidates: Vec::new(),
            choice: ResidentDecisionChoiceTrace {
                offer_id: None,
                composition_id: None,
                focused_encounter: None,
                offer_kind: "wait".to_string(),
                policy_rank: 1,
                policy_score: 0,
                action,
            },
            outcome: None,
            planning_generation_id: None,
            planner_candidate_id: None,
            planner_state_revision: None,
        });
        let events = runtime.apply_treasure_objective_progress(&decision, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "treasure_objective.timed_out"));
        let objective = &runtime.treasure_objectives["objective:test"];
        assert_eq!(objective.turns_taken, 1);
        assert_eq!(objective.status, TreasureObjectiveStatus::TimedOut);
    }
}
