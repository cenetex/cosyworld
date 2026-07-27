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
        let Some((encounter_id, winning_side, source_event_seq, location_id)) =
            events.iter().find_map(|event| {
                (event.type_name == "combat.encounter.resolved" && event.success)
                    .then(|| {
                        Some((
                            event.content_id?,
                            event.total?,
                            event.seq,
                            event.location_id?,
                        ))
                    })
                    .flatten()
            })
        else {
            return Vec::new();
        };
        let Some(job_id) = self.combat_job_id_for_encounter(encounter_id) else {
            return Vec::new();
        };
        let gates_progress = self.jobs.get(&job_id).is_some_and(|job| {
            job.contribution_strategies.iter().any(|strategy| {
                strategy.requirements.iter().any(|requirement| {
                    matches!(
                        requirement,
                        ContributionRequirement::EncounterResolved {
                            job_id: required_job_id,
                            ..
                        } if required_job_id == &job_id
                    )
                })
            })
        });
        let evidence = RpgTagState {
            id: combat_resolution_tag_id(&job_id, winning_side),
            scope: "room".to_string(),
            scope_id: location_id,
            label: format!("combat resolved for {job_id}"),
            kind: "combat".to_string(),
            active: true,
            source_event_seq: Some(source_event_seq),
            expires: None,
        };
        let mut projected = self
            .set_rpg_tag(evidence, action.actor_id, "combat_resolved")
            .into_iter()
            .collect::<Vec<_>>();
        if gates_progress || winning_side != 1 {
            return projected;
        }
        let Some((clock_id, remaining)) = self.jobs.get(&job_id).and_then(|job| {
            self.clocks.get(&job.progress_clock_id).map(|clock| {
                (
                    job.progress_clock_id.clone(),
                    clock.segments.saturating_sub(clock.filled),
                )
            })
        }) else {
            return projected;
        };
        if remaining == 0 {
            return projected;
        }
        projected.extend(self.advance_clock(
            &clock_id,
            remaining,
            action.actor_id,
            "combat_resolved",
        ));
        projected
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
                    .map(|target_id| {
                        encounter_participant_ids_for_job(&job.id).contains(&target_id)
                    })
                    .unwrap_or(true)
            })
            .find_map(|job| {
                encounter_participant_ids_for_job(&job.id)
                    .iter()
                    .copied()
                    .filter(|target_id| {
                        requested_target_id
                            .map(|requested| requested == *target_id)
                            .unwrap_or(true)
                    })
                    .find(|target_id| {
                        self.actor_by_id(*target_id).is_some_and(|target| {
                            Self::actor_can_act(target)
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
            .filter(|encounter| {
                encounter.status == CW_COMBAT_ENCOUNTER_ACTIVE
                    && self.combat_encounter_job_is_active(encounter.id)
            })
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
        self.combat_encounter(encounter_id).filter(|encounter| {
            encounter.status == CW_COMBAT_ENCOUNTER_ACTIVE
                && self.combat_encounter_job_is_active(encounter.id)
        })
    }

    fn combat_encounter_job_is_active(&self, encounter_id: u64) -> bool {
        self.combat_job_id_for_encounter(encounter_id)
            .and_then(|job_id| self.jobs.get(&job_id))
            .is_some_and(|job| self.job_status(job) == "active")
    }

    pub(super) fn resolve_active_combat_encounter_for_job(&mut self, job_id: &str) {
        let encounter_id = combat_encounter_id(job_id);
        if let Some(encounter) = self.world.combat_encounters[..self.world.combat_encounter_count]
            .iter_mut()
            .find(|encounter| {
                encounter.id == encounter_id && encounter.status == CW_COMBAT_ENCOUNTER_ACTIVE
            })
        {
            encounter.status = CW_COMBAT_ENCOUNTER_RESOLVED;
        }
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
            .filter(|target| !self.actors_blocked(actor_id, target.id))
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
                        Self::actor_can_act(target)
                            && target.location_id == actor.location_id
                            && self.actor_visible_in_projection(target, Some(actor_id), None)
                    })
            })
    }

    pub(super) fn location_has_unresolved_combat(&self, location_id: u64) -> bool {
        self.location_allows_combat(location_id)
            && self.jobs.values().any(|job| {
                !encounter_participant_ids_for_job(&job.id).is_empty()
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

    fn current_combat_offer_for_choice(
        &self,
        actor_id: u64,
        choice: CombatChoice,
    ) -> Option<RankedActionOffer> {
        self.legal_action_candidates(Some(actor_id), &AccessContext::default())
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .find(|offer| match choice {
                CombatChoice::Attack { target_actor_id } => {
                    offer.kind == "attack"
                        && offer.target.as_ref().is_some_and(|target| {
                            target.kind == "actor" && target.id == Some(target_actor_id)
                        })
                }
                CombatChoice::Dodge => offer.kind == "defend",
                CombatChoice::Escape {
                    destination_location_id,
                } => {
                    offer.kind == "flee"
                        && offer.target.as_ref().is_some_and(|target| {
                            target.kind == "location" && target.id == Some(destination_location_id)
                        })
                }
                CombatChoice::Pass | CombatChoice::NeedTime => false,
            })
    }

    pub(super) fn plan_combat_offer_action(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
    ) -> Result<CwAction, String> {
        let offer = self
            .current_reachable_offer(actor_id, offered)
            .ok_or_else(|| "That combat choice is no longer available.".to_string())?;
        let encounter = self
            .active_combat_encounter_for_actor(actor_id)
            .ok_or_else(|| "There is no active encounter for that avatar.".to_string())?;
        if self.combat_current_actor_id(encounter.id) != Some(actor_id) {
            return Err("It is not that avatar's turn.".to_string());
        }

        match offer.kind.as_str() {
            "attack" => {
                let target_actor_id = offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "actor")
                    .and_then(|target| target.id)
                    .ok_or_else(|| "Attack needs a current opponent.".to_string())?;
                if self.combat_target_for_actor(encounter.id, actor_id) != Some(target_actor_id)
                    || self.actors_blocked(actor_id, target_actor_id)
                {
                    return Err("That opponent is no longer available.".to_string());
                }
                Ok(CwAction {
                    kind: CW_ACTION_COMBAT_FINESSE_ATTACK,
                    actor_id,
                    target_actor_id,
                    content_id: encounter.id,
                    ..CwAction::default()
                })
            }
            "defend" => {
                let target_actor_id = offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "actor")
                    .and_then(|target| target.id)
                    .ok_or_else(|| "Defend needs a current opponent.".to_string())?;
                if self.combat_target_for_actor(encounter.id, actor_id) != Some(target_actor_id)
                    || self.actors_blocked(actor_id, target_actor_id)
                {
                    return Err("That opponent is no longer available.".to_string());
                }
                Ok(CwAction {
                    kind: CW_ACTION_COMBAT_DODGE,
                    actor_id,
                    content_id: encounter.id,
                    ..CwAction::default()
                })
            }
            "flee" => {
                let destination_location_id = offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "location")
                    .and_then(|target| target.id)
                    .ok_or_else(|| "Flee needs a current exit.".to_string())?;
                Ok(CwAction {
                    kind: CW_ACTION_COMBAT_ESCAPE,
                    actor_id,
                    destination_location_id,
                    content_id: encounter.id,
                    ..CwAction::default()
                })
            }
            _ => Err("That offer is not a combat choice.".to_string()),
        }
    }

    pub(super) fn resident_combat_autonomy_record(
        &self,
        encounter_id: u64,
        seed: u64,
        caused_by_event_seq: Option<u64>,
    ) -> Option<JournalRecord> {
        let actor_id = self.combat_current_actor_id(encounter_id)?;
        let actor = self.actor_by_id(actor_id)?;
        if !Self::actor_can_act(actor) || !self.actor_uses_inference(actor_id) {
            return None;
        }
        let offers = self
            .legal_action_candidates(Some(actor_id), &AccessContext::default())
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .filter(|offer| matches!(offer.kind.as_str(), "attack" | "defend" | "flee"))
            .collect::<Vec<_>>();
        let hp_base = i32::from(actor.stats.hp_base.max(1));
        let damage = i32::from(actor.damage.max(0));
        let preferred_kinds: &[&str] = if damage.saturating_mul(4) >= hp_base.saturating_mul(3) {
            &["flee", "defend", "attack"]
        } else if damage.saturating_mul(2) >= hp_base {
            &["defend", "flee", "attack"]
        } else {
            &["attack", "defend", "flee"]
        };
        let offer = preferred_kinds
            .iter()
            .find_map(|kind| offers.iter().find(|offer| offer.kind == *kind))?;
        let action = self.plan_combat_offer_action(actor_id, offer).ok()?;
        let (rank, score) = match offer.kind.as_str() {
            "flee" => (0, i16::try_from(damage).unwrap_or(i16::MAX)),
            "defend" => (1, i16::try_from(damage).unwrap_or(i16::MAX)),
            _ => (2, i16::try_from(hp_base - damage).unwrap_or_default()),
        };
        let mut record = JournalRecord::new(action, seed)
            .into_actor_consequence(self.world.tick, caused_by_event_seq);
        record.bind_offer_kind(&offer.kind);
        record.source_location_id = Some(actor.location_id);
        self.append_resident_autonomy_intent_projection(actor, &mut record);
        Some(
            self.attach_resident_decision_trace(ResidentAutonomyCandidate {
                actor_id,
                rank,
                score,
                record,
            })
            .record,
        )
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
        let Some(record) = runtime.resident_combat_autonomy_record(
            encounter_id,
            runtime.next_seed_value(),
            events.last().map(|event| event.seq),
        ) else {
            return Ok(CW_OK);
        };
        let (status, inference_events) = commit_journal_record(state, runtime, record)?;
        events.extend(inference_events);
        if status != CW_OK {
            return Ok(status);
        }
    }
    Ok(CW_OK)
}

pub(super) fn drive_available_combat_turns(
    state: &AppState,
    runtime: &mut RuntimeWorld,
    encounter_id: u64,
    requesting_actor_id: u64,
    events: &mut Vec<EventView>,
) -> io::Result<u32> {
    for _ in 0..CW_MAX_COMBAT_PARTICIPANTS {
        let status = drive_combat_inference_turns(state, runtime, encounter_id, events)?;
        if status != CW_OK {
            return Ok(status);
        }
        let Some(current_actor_id) = runtime.combat_current_actor_id(encounter_id) else {
            return Ok(CW_OK);
        };
        let grace_period_ms = ORDERED_SCENE_BASE_GRACE_MS.saturating_add(
            if combat_need_time_used(runtime, encounter_id, current_actor_id) {
                ORDERED_SCENE_NEED_TIME_MS
            } else {
                0
            },
        );
        let active_direct_actors = active_actor_ids_for_focused_grace(state, grace_period_ms);
        if current_actor_id == requesting_actor_id
            || runtime.actor_uses_inference(current_actor_id)
            || active_direct_actors.contains(&current_actor_id)
        {
            return Ok(CW_OK);
        }
        let record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_PASS,
                actor_id: current_actor_id,
                content_id: encounter_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_system();
        let (status, pass_events) = commit_journal_record(state, runtime, record)?;
        events.extend(pass_events);
        if status != CW_OK {
            return Ok(status);
        }
    }
    Ok(CW_ERR_RULE)
}

fn focused_combat_turn_needs_recovery(
    state: &AppState,
    runtime: &RuntimeWorld,
    encounter_id: u64,
) -> bool {
    let Some(encounter) = runtime.active_combat_encounter(encounter_id) else {
        return false;
    };
    let Some(current_actor_id) = runtime.combat_current_actor_id(encounter_id) else {
        return false;
    };
    if runtime.actor_uses_inference(current_actor_id) {
        return true;
    }
    let grace_period_ms = ORDERED_SCENE_BASE_GRACE_MS.saturating_add(
        if combat_need_time_used(runtime, encounter_id, current_actor_id) {
            ORDERED_SCENE_NEED_TIME_MS
        } else {
            0
        },
    );
    let active_direct_actors = active_actor_ids_for_focused_grace(state, grace_period_ms);
    if active_direct_actors.contains(&current_actor_id) {
        return false;
    }
    encounter.participants[..encounter.participant_count]
        .iter()
        .filter(|participant| participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED == 0)
        .map(|participant| participant.actor_id)
        .any(|actor_id| {
            runtime.actor_uses_inference(actor_id) || active_direct_actors.contains(&actor_id)
        })
}

async fn recover_available_combat_turns(state: &AppState) -> io::Result<Vec<EventView>> {
    let mut runtime = state.inner.lock().await;
    let encounter_ids = runtime.world.combat_encounters[..runtime.world.combat_encounter_count]
        .iter()
        .map(|encounter| encounter.id)
        .filter(|encounter_id| runtime.active_combat_encounter(*encounter_id).is_some())
        .collect::<Vec<_>>();
    let mut events = Vec::new();
    for encounter_id in encounter_ids {
        if !focused_combat_turn_needs_recovery(state, &runtime, encounter_id) {
            continue;
        }
        let status =
            drive_available_combat_turns(state, &mut runtime, encounter_id, 0, &mut events)?;
        if status != CW_OK {
            return Err(io::Error::other(format!(
                "focused encounter {encounter_id} recovery failed with status {status}"
            )));
        }
    }
    Ok(events)
}

pub(super) fn start_focused_encounter_scheduler(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            match recover_available_combat_turns(&state).await {
                Ok(events) if !events.is_empty() => broadcast_events(&state, &events),
                Ok(_) => {}
                Err(error) => warn!("focused encounter recovery failed: {error}"),
            }
            match recover_available_focused_job_turns(&state).await {
                Ok(events) if !events.is_empty() => broadcast_events(&state, &events),
                Ok(_) => {}
                Err(error) => warn!("focused work recovery failed: {error}"),
            }
        }
    });
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
    if !RuntimeWorld::actor_can_act(actor) {
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
    if runtime
        .active_combat_encounter_for_actor(actor_id)
        .is_none()
        && !matches!(choice, CombatChoice::Pass | CombatChoice::NeedTime)
        && runtime
            .current_combat_offer_for_choice(actor_id, choice)
            .is_none()
    {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    }
    let active_encounter_context = runtime
        .active_combat_encounter_for_actor(actor_id)
        .and_then(|encounter| {
            runtime
                .combat_job_id_for_encounter(encounter.id)
                .map(|job_id| {
                    (
                        job_id,
                        runtime
                            .combat_target_for_actor(encounter.id, actor_id)
                            .unwrap_or_default(),
                    )
                })
        });
    let Some((job_id, encounter_target_id)) = active_encounter_context
        .or_else(|| runtime.combat_job_for_actor(actor_id, requested_target_id))
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

    let inference_status = match drive_available_combat_turns(
        &state,
        &mut runtime,
        encounter_id,
        actor_id,
        &mut events,
    ) {
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
        CombatChoice::Attack { .. } | CombatChoice::Dodge | CombatChoice::Escape { .. } => {
            let Some(offer) = runtime.current_combat_offer_for_choice(actor_id, choice) else {
                drop(runtime);
                broadcast_events(&state, &released_events);
                broadcast_events(&state, &events);
                return Json(ActionResponse {
                    ok: false,
                    status: 409,
                    events,
                });
            };
            let Ok(action) = runtime.plan_combat_offer_action(actor_id, &offer) else {
                drop(runtime);
                broadcast_events(&state, &released_events);
                broadcast_events(&state, &events);
                return Json(ActionResponse {
                    ok: false,
                    status: 409,
                    events,
                });
            };
            action
        }
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
        status = match drive_available_combat_turns(
            &state,
            &mut runtime,
            encounter_id,
            actor_id,
            &mut events,
        ) {
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

pub(super) fn combat_join_action(actor_id: u64, encounter_id: u64) -> CwAction {
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

pub(super) fn encounter_participant_ids_for_job(job_id: &str) -> &'static [u64] {
    active_content()
        .jobs
        .iter()
        .find(|job| job.id == job_id)
        .map(|job| job.participant_ids.as_slice())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_request(actor_id: u64, command: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: None,
            command: command.to_string(),
            wallet_address: None,
            wallet: None,
            wallet_session: None,
            owned_card_ids: None,
            cards: None,
            envelope: None,
        }
    }

    fn discover_seed_exit_for_test(
        runtime: &mut RuntimeWorld,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        let destination = runtime
            .location_name(to_location_id)
            .unwrap_or_else(|| format!("Location {to_location_id}"));
        let id = seed_exit_discovered_tag_id(from_location_id, to_location_id);
        runtime.tags.insert(
            id.clone(),
            RpgTagState {
                id,
                scope: "room".to_string(),
                scope_id: from_location_id,
                label: format!("path to {destination}"),
                kind: "discovery".to_string(),
                active: true,
                source_event_seq: None,
                expires: None,
            },
        );
        runtime.remember_search_discovery(
            RATI_ACTOR_ID,
            from_location_id,
            SEARCH_MEMORY_KIND_SEED_EXIT,
            to_location_id,
            &seed_exit_search_memory_subject_key(from_location_id, to_location_id),
        );
    }

    fn discover_seed_exit_pair_for_test(
        runtime: &mut RuntimeWorld,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        discover_seed_exit_for_test(runtime, from_location_id, to_location_id);
        discover_seed_exit_for_test(runtime, to_location_id, from_location_id);
    }

    #[test]
    fn new_combat_join_records_declare_the_initiating_side() {
        let action = combat_join_action(5001, 9001);
        assert_eq!(action.kind, CW_ACTION_COMBAT_JOIN);
        assert_eq!(action.actor_id, 5001);
        assert_eq!(action.content_id, 9001);
        assert_eq!(action.modifier, 1);
    }

    #[tokio::test]
    async fn focused_scheduler_replayably_passes_unavailable_direct_participants() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Present Companion",
        );
        create_test_human(
            &mut runtime,
            5001,
            MOONLIT_TRAIL_LOCATION_ID,
            "Unavailable Companion",
        );
        for (actor_id, dexterity) in [(5000, 100), (5001, 50), (1004, 1)] {
            let actor = runtime
                .world
                .actors
                .iter_mut()
                .take(runtime.world.actor_count)
                .find(|actor| actor.id == actor_id)
                .expect("focused scheduler participant");
            actor.stats.dexterity = dexterity;
            actor.stats.hp_base = 100;
            runtime
                .actor_autonomy
                .entry(actor_id)
                .or_default()
                .control_mode = ActorControlMode::DirectInput;
        }
        let encounter_id = combat_encounter_id(MOONLIT_JOB_ID);
        let start = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_START,
                actor_id: 5000,
                target_actor_id: 1004,
                content_id: encounter_id,
                ..CwAction::default()
            },
            71_910,
        )
        .into_system();
        assert_eq!(runtime.apply_journal_record(&start).0, CW_OK);
        assert_eq!(
            runtime
                .apply_journal_record(
                    &JournalRecord::new(combat_join_action(5001, encounter_id), 71_911)
                        .into_system()
                )
                .0,
            CW_OK
        );
        let pass = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_PASS,
                actor_id: 5000,
                content_id: encounter_id,
                ..CwAction::default()
            },
            71_912,
        )
        .into_player_card();
        assert_eq!(runtime.apply_journal_record(&pass).0, CW_OK);
        assert_eq!(runtime.combat_current_actor_id(encounter_id), Some(5001));

        let replay_base = RuntimeSnapshot::from_runtime(&runtime);
        let path = std::env::temp_dir().join(format!(
            "cosyworld-focused-recovery-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let state = test_app_state(runtime, Some(path.clone()));
        assert!(
            recover_available_combat_turns(&state)
                .await
                .expect("idle recovery succeeds")
                .is_empty(),
            "a scene with nobody available must not churn Pass records"
        );

        let (session, _) = issue_actor_session(&state, 5000);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &session),
            Some(5000)
        );
        let events = recover_available_combat_turns(&state)
            .await
            .expect("focused scheduler recovery succeeds");
        assert!(events
            .iter()
            .any(|event| { event.type_name == "combat.pass" && event.actor_id == Some(5001) }));
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.combat_current_actor_id(encounter_id), Some(5000));
        drop(runtime);

        let journal = read_action_journal(&path).expect("focused recovery journal");
        assert!(journal.iter().any(|record| {
            record.action.kind == CW_ACTION_COMBAT_PASS
                && record.action.actor_id == 5001
                && record.origin == JournalOrigin::System
                && record.focused_encounter.is_some()
        }));
        let mut replayed = replay_base
            .into_runtime()
            .expect("focused recovery checkpoint restores");
        for record in &journal {
            assert_eq!(replayed.apply_journal_record(record).0, CW_OK);
        }
        assert_eq!(replayed.combat_current_actor_id(encounter_id), Some(5000));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn completed_combat_project_clears_combat_actions() {
        let mut runtime = RuntimeWorld::seeded();
        let mut create = CwAction::default();
        create.kind = CW_ACTION_CREATE_ACTOR;
        create.actor_id = 5000;
        create.location_id = MOONLIT_TRAIL_LOCATION_ID;
        let mut create_record = JournalRecord::new(create, 7180);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Calm Resolver".to_string(),
                speech_mode: "prose".to_string(),
                title: "Echo Peacemaker".to_string(),
                description: "A test avatar checking combat affordances after project resolution."
                    .to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

        discover_seed_exit_pair_for_test(&mut runtime, MOONLIT_TRAIL_LOCATION_ID, 2);
        let active = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(active
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "attack"));
        assert!(active
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "defend"));
        assert!(active
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "flee"));

        let encounter_id = combat_encounter_id(MOONLIT_JOB_ID);
        let start = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_START,
                actor_id: 5000,
                target_actor_id: 1004,
                content_id: encounter_id,
                ..CwAction::default()
            },
            7181,
        )
        .into_system();
        assert_eq!(runtime.apply_journal_record(&start).0, CW_OK);
        assert!(runtime.active_combat_encounter(encounter_id).is_some());

        let mut complete_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7182,
        )
        .into_system();
        complete_record
            .projection_mutations
            .push(ProjectionMutation::AdvanceClock {
                clock_id: MOONLIT_PROGRESS_CLOCK_ID.to_string(),
                amount: 4,
                reason: "test_complete".to_string(),
            });
        assert_eq!(runtime.apply_journal_record(&complete_record).0, CW_OK);

        let completed = runtime.state_response(Some(5000), &AccessContext::default());
        assert_eq!(
            completed
                .jobs
                .iter()
                .find(|job| job.id == "moonlit-trail:quiet-the-echo")
                .map(|job| job.status.as_str()),
            Some("completed")
        );
        assert_eq!(
            runtime
                .combat_encounter(encounter_id)
                .map(|encounter| encounter.status),
            Some(CW_COMBAT_ENCOUNTER_RESOLVED)
        );
        assert!(runtime.active_combat_encounter(encounter_id).is_none());
        assert!(completed.combat.is_none());
        assert!(!completed
            .primary_action
            .options
            .iter()
            .any(|option| matches!(option.kind.as_str(), "attack" | "defend" | "flee")));
        assert!(!completed
            .action_offers
            .iter()
            .any(|offer| matches!(offer.kind.as_str(), "attack" | "defend" | "flee")));
        let replayed = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("quiet encounter snapshot restores");
        let replayed_state = replayed.state_response(Some(5000), &AccessContext::default());
        assert!(replayed_state.combat.is_none());
        assert!(!replayed_state
            .action_offers
            .iter()
            .any(|offer| matches!(offer.kind.as_str(), "attack" | "defend" | "flee")));

        let natural_job_id = natural_investigation_job_id(MOONLIT_TRAIL_LOCATION_ID);
        let natural_job = runtime
            .jobs
            .get_mut(&natural_job_id)
            .expect("Moonlit Trail natural investigation exists");
        natural_job.status = "active".to_string();
        natural_job.participant_ids.push(1004);
        natural_job.participant_ids.sort_unstable();
        natural_job.participant_ids.dedup();
        let natural_progress_clock_id = natural_job.progress_clock_id.clone();
        let natural_progress = runtime
            .clocks
            .get_mut(&natural_progress_clock_id)
            .expect("natural investigation progress exists");
        natural_progress.filled = 0;
        natural_progress.status = "active".to_string();
        assert_eq!(
            runtime.job_status(&runtime.jobs[&natural_job_id]),
            "active",
            "the non-combat investigation models the stress-path overlap"
        );
        assert!(
            runtime.combat_job_for_actor(5000, None).is_none(),
            "contributors to an unrelated active project are not combat targets"
        );
        assert!(!runtime.location_has_unresolved_combat(MOONLIT_TRAIL_LOCATION_ID));
        let overlapping_project = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(!overlapping_project
            .action_offers
            .iter()
            .any(|offer| matches!(offer.kind.as_str(), "attack" | "defend" | "flee")));

        let item_count = runtime.world.item_count;
        let tonic = runtime.world.items[..item_count]
            .iter_mut()
            .find(|item| item.id == 2001)
            .expect("Hearth Tonic exists");
        tonic.holder_actor_id = 5000;
        tonic.location_id = 0;
        tonic.charges = 1;
        let actor_count = runtime.world.actor_count;
        runtime.world.actors[..actor_count]
            .iter_mut()
            .find(|actor| actor.id == 1004)
            .expect("Coach exists")
            .damage = 3;
        let wounded_quieted = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(wounded_quieted
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "use_item"));

        for command in ["attack Coach", "defend", "flee"] {
            let resolved = runtime
                .resolve_command(&command_request(5000, command), &AccessContext::default())
                .expect("combat command still resolves to a disabled action");
            assert!(
                matches!(
                    resolved.dispatch,
                    CommandDispatch::Disabled { status: 409, .. }
                ),
                "{command} should be disabled after the combat project resolves"
            );
        }
    }
}
