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
    /// Authoritative supervision only. Never copy this into model inputs or
    /// card-policy traces.
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
    /// Stable episode key. The hidden treasure item id is deliberately absent.
    pub(super) objective_id: String,
    pub(super) objective_turn: u16,
    pub(super) evaluator: String,
    /// Counterfactual cost after forcing each candidate, in deck order.
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
        .push(ProjectionMutation::StartTreasureObjective { start });

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
            ProjectionMutation::StartTreasureObjective { start } => Some(start),
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
        // One optimistic terminal interaction: pickup for a loose item, or an
        // exact give/trade once the current holder is reached.
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

#[cfg(test)]
mod tests {
    use super::*;

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
            .push(ProjectionMutation::StartTreasureObjective {
                start: TreasureObjectiveStart {
                    schema_version: TREASURE_OBJECTIVE_SCHEMA_VERSION,
                    objective_id: "objective:test".to_string(),
                    actor_id,
                    treasure_item_id,
                    max_turns,
                },
            });
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
