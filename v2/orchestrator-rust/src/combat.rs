use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) enum CombatChoice {
    Attack { target_actor_id: u64 },
    Dodge,
    Escape { destination_location_id: u64 },
    Pass,
    NeedTime,
}

impl RuntimeWorld {
    pub(super) fn apply_defend_project_preparation(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        if action.kind != CW_ACTION_DEFEND
            || !events.iter().any(|event| {
                event.type_name == "combat.defend"
                    && event.success
                    && event.actor_id == Some(action.actor_id)
            })
            || !self.prepare_available(action.actor_id)
        {
            return Vec::new();
        }
        let Some(actor) = self.actor_by_id(action.actor_id) else {
            return Vec::new();
        };
        let tag = RpgTagState {
            id: prepared_tag_id(action.actor_id, actor.location_id),
            scope: "actor".to_string(),
            scope_id: action.actor_id,
            label: "prepared".to_string(),
            kind: "aspect".to_string(),
            active: true,
            source_event_seq: events
                .iter()
                .find(|event| {
                    event.type_name == "combat.defend"
                        && event.success
                        && event.actor_id == Some(action.actor_id)
                })
                .map(|event| event.seq),
            expires: Some("after_work".to_string()),
        };
        self.set_rpg_tag(tag, action.actor_id, "defend_prepare")
            .into_iter()
            .collect()
    }

    pub(super) fn apply_attack_project_danger(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        if action.kind != CW_ACTION_ATTACK {
            return Vec::new();
        }
        let Some(location_id) = events.iter().find_map(|event| {
            (event.type_name == "combat.attack.attempt" && event.actor_id == Some(action.actor_id))
                .then_some(event.location_id)
                .flatten()
        }) else {
            return Vec::new();
        };
        let Some(clock_id) = self
            .active_danger_clock_id_for_location(location_id)
            .filter(|clock_id| self.clock_is_frontier(clock_id))
        else {
            return Vec::new();
        };
        self.advance_clock(&clock_id, 1, action.actor_id, "attack")
    }

    pub(super) fn apply_combat_outcome_projection(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        let Some(encounter_id) = events.iter().find_map(|event| {
            (event.type_name == "combat.encounter.resolved"
                && event.success
                && event.total == Some(1))
            .then_some(event.content_id)
            .flatten()
        }) else {
            return Vec::new();
        };
        let Some(job_id) = self.combat_job_id_for_encounter(encounter_id) else {
            return Vec::new();
        };
        let Some((clock_id, remaining)) = self.jobs.get(&job_id).and_then(|job| {
            self.clocks.get(&job.progress_clock_id).map(|clock| {
                (
                    job.progress_clock_id.clone(),
                    clock.segments.saturating_sub(clock.filled),
                )
            })
        }) else {
            return Vec::new();
        };
        if remaining == 0 {
            return Vec::new();
        }
        self.advance_clock(&clock_id, remaining, action.actor_id, "combat_resolved")
    }

    pub(super) fn combat_job_for_actor(
        &self,
        actor_id: u64,
        requested_target_id: Option<u64>,
    ) -> Option<(String, u64)> {
        let actor = self.actor_by_id(actor_id)?;
        self.jobs
            .values()
            .filter(|job| job.location_ids.contains(&actor.location_id))
            .filter(|job| self.job_status(job) == "active")
            .filter(|job| {
                requested_target_id
                    .map(|target_id| job.participant_ids.contains(&target_id))
                    .unwrap_or(true)
            })
            .find_map(|job| {
                job.participant_ids
                    .iter()
                    .copied()
                    .filter(|target_id| {
                        requested_target_id
                            .map(|requested| requested == *target_id)
                            .unwrap_or(true)
                    })
                    .find(|target_id| {
                        self.actor_by_id(*target_id).is_some_and(|target| {
                            Self::actor_is_active_avatar(target)
                                && target.location_id == actor.location_id
                                && !self.actor_control_mode(target.id).is_direct_input()
                                && !self.actors_blocked(actor.id, target.id)
                        })
                    })
                    .map(|target_id| (job.id.clone(), target_id))
            })
    }

    pub(super) fn combat_encounter(&self, encounter_id: u64) -> Option<&CwCombatEncounter> {
        self.world.combat_encounters[..self.world.combat_encounter_count]
            .iter()
            .find(|encounter| encounter.id == encounter_id)
    }

    pub(super) fn active_combat_encounter_for_actor(
        &self,
        actor_id: u64,
    ) -> Option<&CwCombatEncounter> {
        self.world.combat_encounters[..self.world.combat_encounter_count]
            .iter()
            .filter(|encounter| encounter.status == CW_COMBAT_ENCOUNTER_ACTIVE)
            .find(|encounter| {
                encounter.participants[..encounter.participant_count]
                    .iter()
                    .any(|participant| {
                        participant.actor_id == actor_id
                            && participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED == 0
                    })
            })
    }

    pub(super) fn active_combat_encounter(&self, encounter_id: u64) -> Option<&CwCombatEncounter> {
        self.combat_encounter(encounter_id)
            .filter(|encounter| encounter.status == CW_COMBAT_ENCOUNTER_ACTIVE)
    }

    pub(super) fn combat_actor_is_participant(&self, encounter_id: u64, actor_id: u64) -> bool {
        self.active_combat_encounter(encounter_id)
            .is_some_and(|encounter| {
                encounter.participants[..encounter.participant_count]
                    .iter()
                    .any(|participant| participant.actor_id == actor_id)
            })
    }

    pub(super) fn combat_current_actor_id(&self, encounter_id: u64) -> Option<u64> {
        let encounter = self.active_combat_encounter(encounter_id)?;
        encounter
            .participants
            .get(usize::from(encounter.current_index))
            .map(|participant| participant.actor_id)
            .filter(|actor_id| *actor_id != 0)
    }

    pub(super) fn combat_target_for_actor(&self, encounter_id: u64, actor_id: u64) -> Option<u64> {
        let encounter = self.active_combat_encounter(encounter_id)?;
        let actor_side = encounter.participants[..encounter.participant_count]
            .iter()
            .find(|participant| participant.actor_id == actor_id)?
            .side;
        encounter.participants[..encounter.participant_count]
            .iter()
            .filter(|participant| {
                participant.side != actor_side
                    && participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED == 0
            })
            .filter_map(|participant| self.actor_by_id(participant.actor_id))
            .filter(|target| target.status == CW_ACTOR_ACTIVE)
            .min_by_key(|target| (target.damage, target.id))
            .map(|target| target.id)
    }

    pub(super) fn combat_actors_share_side(&self, left_actor_id: u64, right_actor_id: u64) -> bool {
        let Some(encounter) = self.active_combat_encounter_for_actor(left_actor_id) else {
            return false;
        };
        let participant_side = |actor_id| {
            encounter.participants[..encounter.participant_count]
                .iter()
                .find(|participant| participant.actor_id == actor_id)
                .map(|participant| participant.side)
        };
        participant_side(left_actor_id)
            .zip(participant_side(right_actor_id))
            .is_some_and(|(left, right)| left == right)
    }

    pub(super) fn combat_job_id_for_encounter(&self, encounter_id: u64) -> Option<String> {
        self.jobs
            .keys()
            .find(|job_id| combat_encounter_id(job_id) == encounter_id)
            .cloned()
    }

    pub(super) fn active_danger_clock_id_for_location(&self, location_id: u64) -> Option<String> {
        self.jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .filter(|job| self.job_status(job) == "active")
            .filter_map(|job| {
                self.clocks
                    .get(&job.danger_clock_id)
                    .map(|clock| (job, clock))
            })
            .find(|(_, clock)| clock.filled < clock.segments)
            .map(|(job, _)| job.danger_clock_id.clone())
    }

    pub(super) fn has_active_combat_target(&self, actor_id: u64) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        self.combat_job_for_actor(actor_id, None)
            .is_some_and(|(job_id, target_id)| {
                let encounter_id = combat_encounter_id(&job_id);
                let actor_can_act = self
                    .active_combat_encounter(encounter_id)
                    .map(|_| {
                        !self.combat_actor_is_participant(encounter_id, actor_id)
                            || self.combat_current_actor_id(encounter_id) == Some(actor_id)
                    })
                    .unwrap_or(true);
                actor_can_act
                    && self.actor_by_id(target_id).is_some_and(|target| {
                        Self::actor_is_active_avatar(target)
                            && target.location_id == actor.location_id
                            && self.actor_visible_in_projection(target, Some(actor_id), None)
                    })
            })
    }

    pub(super) fn location_has_unresolved_combat(&self, location_id: u64) -> bool {
        self.location_allows_combat(location_id)
            && self.jobs.values().any(|job| {
                !job.participant_ids.is_empty()
                    && job.location_ids.contains(&location_id)
                    && self.job_status(job) == "active"
            })
    }

    pub(super) fn location_allows_combat(&self, location_id: u64) -> bool {
        self.world.locations[..self.world.location_count]
            .iter()
            .any(|location| {
                location.id == location_id && (location.flags & CW_LOCATION_ALLOW_COMBAT) != 0
            })
    }
}

fn drive_combat_inference_turns(
    state: &AppState,
    runtime: &mut RuntimeWorld,
    encounter_id: u64,
    events: &mut Vec<EventView>,
) -> io::Result<u32> {
    for _ in 0..CW_MAX_COMBAT_PARTICIPANTS {
        let Some(actor_id) = runtime.combat_current_actor_id(encounter_id) else {
            return Ok(CW_OK);
        };
        let Some(actor) = runtime.actor_by_id(actor_id) else {
            return Ok(CW_OK);
        };
        if !runtime.actor_uses_inference(actor.id) {
            return Ok(CW_OK);
        }
        let Some(target_actor_id) = runtime.combat_target_for_actor(encounter_id, actor_id) else {
            return Ok(CW_OK);
        };
        let record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_FINESSE_ATTACK,
                actor_id,
                target_actor_id,
                content_id: encounter_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_system();
        let (status, inference_events) = commit_journal_record(state, runtime, record)?;
        events.extend(inference_events);
        if status != CW_OK {
            return Ok(status);
        }
    }
    Ok(CW_OK)
}

pub(super) async fn apply_combat_choice(
    state: AppState,
    actor_id: u64,
    choice: CombatChoice,
    actor_session: Option<&str>,
) -> Json<ActionResponse> {
    let was_active = actor_session
        .and_then(|token| actor_session_active_for_actor(&state.actor_sessions, actor_id, token))
        .unwrap_or(false);
    let mut runtime = state.inner.lock().await;
    if !client_actor_authorized_for_state(&runtime, &state, actor_id, actor_session) {
        return client_actor_rejected_response();
    }
    let released_events = release_inactive_direct_inventory_locked(&state, &mut runtime);
    let Some(actor) = runtime.actor_by_id(actor_id) else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 404,
            events: Vec::new(),
        });
    };
    if !RuntimeWorld::actor_is_active_avatar(actor) {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    }
    let requested_target_id = match choice {
        CombatChoice::Attack { target_actor_id } => Some(target_actor_id),
        CombatChoice::Dodge
        | CombatChoice::Escape { .. }
        | CombatChoice::Pass
        | CombatChoice::NeedTime => None,
    };
    let Some((job_id, encounter_target_id)) =
        runtime.combat_job_for_actor(actor_id, requested_target_id)
    else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    };
    let encounter_id = combat_encounter_id(&job_id);
    let turn_location_id = Some(actor.location_id);
    let mut events = Vec::new();

    if runtime.active_combat_encounter(encounter_id).is_none() {
        let record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_START,
                actor_id,
                target_actor_id: encounter_target_id,
                content_id: encounter_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_system();
        let Ok((status, start_events)) = commit_journal_record(&state, &mut runtime, record) else {
            drop(runtime);
            broadcast_events(&state, &released_events);
            return Json(ActionResponse {
                ok: false,
                status: 500,
                events: Vec::new(),
            });
        };
        events.extend(start_events);
        if status != CW_OK {
            drop(runtime);
            broadcast_events(&state, &released_events);
            broadcast_events(&state, &events);
            return Json(ActionResponse {
                ok: false,
                status,
                events,
            });
        }
    } else if !runtime.combat_actor_is_participant(encounter_id, actor_id) {
        let record = JournalRecord::new(
            combat_join_action(actor_id, encounter_id),
            runtime.next_seed_value(),
        )
        .into_system();
        let Ok((status, join_events)) = commit_journal_record(&state, &mut runtime, record) else {
            drop(runtime);
            broadcast_events(&state, &released_events);
            broadcast_events(&state, &events);
            return Json(ActionResponse {
                ok: false,
                status: 500,
                events: Vec::new(),
            });
        };
        events.extend(join_events);
        if status != CW_OK {
            drop(runtime);
            broadcast_events(&state, &released_events);
            broadcast_events(&state, &events);
            return Json(ActionResponse {
                ok: false,
                status,
                events,
            });
        }
    }

    let inference_status =
        match drive_combat_inference_turns(&state, &mut runtime, encounter_id, &mut events) {
            Ok(status) => status,
            Err(_) => 500,
        };
    if inference_status != CW_OK {
        drop(runtime);
        broadcast_events(&state, &released_events);
        broadcast_events(&state, &events);
        return Json(ActionResponse {
            ok: false,
            status: inference_status,
            events,
        });
    }
    let Some(current_actor_id) = runtime.combat_current_actor_id(encounter_id) else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        broadcast_events(&state, &events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events,
        });
    };
    if current_actor_id != actor_id {
        events.push(EventView {
            type_name: "combat.turn.waiting".to_string(),
            success: true,
            actor_id: Some(current_actor_id),
            actor_name: runtime.actor_name(current_actor_id),
            location_id: turn_location_id,
            content_id: Some(encounter_id),
            content: Some("wait".to_string()),
            ..EventView::default()
        });
        drop(runtime);
        broadcast_events(&state, &released_events);
        broadcast_events(&state, &events);
        return Json(ActionResponse {
            ok: false,
            status: 423,
            events,
        });
    }
    if matches!(choice, CombatChoice::NeedTime)
        && combat_need_time_used(&runtime, encounter_id, actor_id)
    {
        events.push(EventView {
            type_name: "combat.need_time.already_used".to_string(),
            success: false,
            actor_id: Some(actor_id),
            actor_name: runtime.actor_name(actor_id),
            location_id: turn_location_id,
            content_id: Some(encounter_id),
            content: Some(
                "This turn already has its nonpunitive time extension; the combat floor stays with you."
                    .to_string(),
            ),
            ..EventView::default()
        });
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events,
        });
    }

    let action = match choice {
        CombatChoice::Attack { target_actor_id } => CwAction {
            kind: CW_ACTION_COMBAT_FINESSE_ATTACK,
            actor_id,
            target_actor_id,
            content_id: encounter_id,
            ..CwAction::default()
        },
        CombatChoice::Dodge => CwAction {
            kind: CW_ACTION_COMBAT_DODGE,
            actor_id,
            content_id: encounter_id,
            ..CwAction::default()
        },
        CombatChoice::Escape {
            destination_location_id,
        } => CwAction {
            kind: CW_ACTION_COMBAT_ESCAPE,
            actor_id,
            destination_location_id,
            content_id: encounter_id,
            ..CwAction::default()
        },
        CombatChoice::Pass => CwAction {
            kind: CW_ACTION_COMBAT_PASS,
            actor_id,
            content_id: encounter_id,
            ..CwAction::default()
        },
        CombatChoice::NeedTime => CwAction {
            kind: CW_ACTION_COMBAT_NEED_TIME,
            actor_id,
            content_id: encounter_id,
            ..CwAction::default()
        },
    };
    let need_time = matches!(choice, CombatChoice::NeedTime);
    let record = if need_time {
        JournalRecord::new(action, runtime.next_seed_value()).into_system()
    } else {
        JournalRecord::new(action, runtime.next_seed_value()).into_player_card()
    };
    let Ok((mut status, player_events)) = commit_journal_record(&state, &mut runtime, record)
    else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        broadcast_events(&state, &events);
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: Vec::new(),
        });
    };
    events.extend(player_events);
    if status == CW_OK {
        status = match drive_combat_inference_turns(&state, &mut runtime, encounter_id, &mut events)
        {
            Ok(inference_status) => inference_status,
            Err(_) => 500,
        };
    }
    let observation = if need_time {
        if status == CW_OK {
            append_action_receipt(&state, &runtime, actor_id, &mut events);
        }
        None
    } else {
        advance_turn_and_capture_player_tick_observation(
            &state,
            &mut runtime,
            turn_location_id,
            actor_id,
            status,
            &mut events,
        )
    };
    drop(runtime);

    broadcast_events(&state, &released_events);
    broadcast_events(&state, &events);
    if let Some(observation) = observation {
        schedule_player_tick_observation(&state, observation);
    }
    let mut response_events = events;
    if !was_active {
        response_events.extend(commit_presence_event(&state, actor_id, true).await);
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events: response_events,
    })
}

fn combat_join_action(actor_id: u64, encounter_id: u64) -> CwAction {
    CwAction {
        kind: CW_ACTION_COMBAT_JOIN,
        actor_id,
        content_id: encounter_id,
        // New journal records declare encounter allegiance explicitly. A zero
        // modifier remains reserved for historical replay.
        modifier: 1,
        ..CwAction::default()
    }
}

pub(super) fn combat_encounter_id(job_id: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    // Encounter identity predates the finesse rules and remains stable across
    // protocol revisions so restored snapshots still map back to their jobs.
    for byte in b"cosyworld.combat/2:"
        .iter()
        .copied()
        .chain(job_id.as_bytes().iter().copied())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_combat_join_records_declare_the_initiating_side() {
        let action = combat_join_action(5001, 9001);
        assert_eq!(action.kind, CW_ACTION_COMBAT_JOIN);
        assert_eq!(action.actor_id, 5001);
        assert_eq!(action.content_id, 9001);
        assert_eq!(action.modifier, 1);
    }
}
