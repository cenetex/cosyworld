use super::*;

#[derive(Clone, Debug)]
pub(super) struct ActorJob {
    pub(super) id: i64,
    pub(super) kind: String,
    pub(super) actor_id: u64,
    pub(super) attempts: u32,
    pub(super) payload: ActorJobPayload,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "payload_kind", content = "payload", rename_all = "snake_case")]
pub(super) enum ActorJobPayload {
    PlayerTick(PlayerTickObservation),
    OrbChat(OrbChatJob),
    ModelInteraction(ModelInteractionJob),
    AvatarReflection(AvatarReflectionJob),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct OrbChatJob {
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) plan: AvatarChatPlan,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) queue_event_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_world_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) observed_through_seq: Option<u64>,
}

pub(super) const ACTOR_JOB_KIND_PLAYER_TICK: &str = "player_tick_observation";
pub(super) const ACTOR_JOB_KIND_ORB_CHAT: &str = "orb_chat";
pub(super) const ACTOR_JOB_KIND_MODEL_INTERACTION: &str = "model_interaction";
pub(super) const ACTOR_JOB_KIND_AVATAR_REFLECTION: &str = "avatar_reflection";
pub(super) const ACTOR_JOB_LEASE_MS: u64 = 120_000;
pub(super) const ACTOR_JOB_MAX_ATTEMPTS: u32 = 3;
pub(super) const ACTOR_JOB_IDLE_POLL: Duration = Duration::from_secs(2);
pub(super) const CARD_REACTION_HEARTBEAT_DELAY_MS: u64 = 3_000;
pub(super) const ROOM_INITIATIVE_CHAIN_LIMIT: usize = CW_MAX_ACTORS;
pub(super) const ACTOR_JOB_MALFORMED_PAYLOAD_RETRY_DELAY_MS: i64 = 30_000;
pub(super) const ACTOR_JOB_MALFORMED_PAYLOAD_ERROR: &str = "actor_job_payload_invalid";

fn room_handoff_from_observation(observation: &PlayerTickObservation) -> Option<(u64, u64, u64)> {
    observation
        .source_events
        .iter()
        .rev()
        .find(|event| {
            event.success
                && event.type_name == "room.turn.advanced"
                && event.location_id == observation.source_location_id
        })
        .and_then(|event| Some((event.location_id?, event.actor_id?, event.content_id?)))
}

pub(super) fn room_initiative_needs_actor_job(
    runtime: &RuntimeWorld,
    location_id: u64,
    active_direct_actor_ids: &BTreeSet<u64>,
) -> bool {
    let has_active_direct_actor = active_direct_actor_ids.iter().any(|actor_id| {
        runtime.actor_by_id(*actor_id).is_some_and(|actor| {
            RuntimeWorld::actor_can_act(actor)
                && actor.location_id == location_id
                && !runtime.actor_uses_inference(actor.id)
        })
    });
    has_active_direct_actor
        && current_room_initiative_actor(runtime, location_id, active_direct_actor_ids)
            .and_then(|actor_id| runtime.actor_by_id(actor_id))
            .is_some_and(|actor| runtime.actor_uses_inference(actor.id))
}

impl RuntimeWorld {
    fn room_card_reaction_plan_for_actor(
        &self,
        speaker_actor_id: u64,
        responder_actor_id: u64,
        events: &[EventView],
    ) -> Option<AvatarReplyPlan> {
        if events.iter().any(|event| {
            matches!(
                event.type_name.as_str(),
                "bond.created" | "bond.revised" | "bond.resolved"
            )
        }) {
            return None;
        }
        let speaker = self.actor_by_id(speaker_actor_id)?;
        let responder = self.actor_by_id(responder_actor_id)?;
        if !Self::actor_can_act(speaker)
            || !Self::actor_can_act(responder)
            || speaker.location_id != responder.location_id
            || !self.actor_uses_inference(responder_actor_id)
            || !resident_reply_target_available(self, responder_actor_id)
        {
            return None;
        }
        let actor_name = self
            .actor_name(speaker_actor_id)
            .unwrap_or_else(|| "The visitor".to_string());
        let reaction_event = self.card_reaction_event(speaker_actor_id, events)?;
        let action_text = self.card_reaction_action_text(&actor_name, reaction_event);
        self.resident_reaction_plan_for_target(speaker_actor_id, responder_actor_id, &action_text)
    }

    fn ripple_record_for_room_actor(
        &mut self,
        context: &RippleContext,
        actor_id: u64,
        seed: u64,
    ) -> Option<JournalRecord> {
        self.refresh_beliefs_for_autonomy();
        let mut record = self.resident_ripple_record_for_actor(context, actor_id, seed)?;
        record.origin = JournalOrigin::ActorConsequence;
        record.source_world_tick = Some(self.world.tick);
        record.caused_by_event_seq = context.source_event_seqs.iter().copied().max();
        record.ripple_source = Some(context.to_source());
        Some(record)
    }
}

pub(super) fn player_tick_observation(
    runtime: &RuntimeWorld,
    location_id: Option<u64>,
    actor_id: u64,
    status: u32,
    events: &[EventView],
) -> Option<PlayerTickObservation> {
    if status != CW_OK || events.is_empty() {
        return None;
    }
    if !events
        .iter()
        .any(|event| event.success && event.actor_id == Some(actor_id))
    {
        return None;
    }

    let source_action_kind = ripple_action_kind_from_events(actor_id, events);
    let ripple_source = runtime
        .ripple_context_for_player_turn(actor_id, source_action_kind, events)
        .map(|context| context.to_source());
    let caused_by_event_seq = events
        .iter()
        .filter(|event| event.success && event.actor_id == Some(actor_id))
        .map(|event| event.seq)
        .max();
    let source_location_id = location_id.or_else(|| {
        ripple_source
            .as_ref()
            .and_then(|source| source.source_location_id)
    });
    let allow_ordinary_speech = !matches!(
        source_action_kind,
        CW_ACTION_GIVE_ITEM | CW_ACTION_TRADE_ITEM
    ) && !events.iter().any(|event| event.type_name == "chat.queued")
        && !events.iter().any(|event| {
            matches!(
                event.type_name.as_str(),
                "bond.created" | "bond.revised" | "bond.resolved"
            )
        });

    Some(PlayerTickObservation {
        source_actor_id: actor_id,
        source_world_tick: runtime.world.tick,
        caused_by_event_seq,
        observed_through_seq: runtime.world.next_event_seq.saturating_sub(1),
        source_location_id,
        allow_ordinary_speech,
        source_events: events.to_vec(),
        ripple_source,
        relationship_reply: relationship_reply_expectation(runtime, actor_id, events),
    })
}

pub(super) async fn complete_player_tick_observation(
    state: &AppState,
    observation: PlayerTickObservation,
) -> Result<
    (
        Option<AvatarReplyPlan>,
        Option<RelationshipReplyExpectation>,
        Option<PlayerTickObservation>,
    ),
    String,
> {
    let relationship_reply = observation.relationship_reply.clone();
    let active_direct_actor_ids = active_actor_ids_for_state(state);
    let (ripple_events, reply_plan, next_observation) = {
        let mut runtime = state.inner.lock().await;
        // A worker may be reclaimed after its reaction committed but before the
        // outbox row was acknowledged. Match the exact triggering event rather
        // than a persisted world-tick watermark: restored worlds can legitimately
        // resume behind an actor's historical last_acted_tick.
        if relationship_reply
            .as_ref()
            .is_some_and(|expectation| !runtime.relationship_reply_pending(expectation))
        {
            return Ok((None, relationship_reply, None));
        }
        if relationship_reply.is_none()
            && runtime.player_tick_already_has_autonomous_result(&observation)
        {
            return Ok((None, None, None));
        }
        runtime.observe_player_tick_for_autonomy(&observation);
        let initiative_actor_id = observation.source_location_id.and_then(|location_id| {
            current_room_initiative_actor(&runtime, location_id, &active_direct_actor_ids)
        });
        if let Some((location_id, expected_actor_id, expected_activation)) =
            room_handoff_from_observation(&observation)
        {
            let handoff_is_current =
                runtime
                    .room_initiatives
                    .get(&location_id)
                    .is_some_and(|initiative| {
                        initiative.activation == expected_activation
                            && initiative.current_actor_id() == Some(expected_actor_id)
                    });
            if !handoff_is_current
                || !room_initiative_needs_actor_job(&runtime, location_id, &active_direct_actor_ids)
            {
                return Ok((None, relationship_reply, None));
            }
        }
        let card_reaction_plan = if relationship_reply.is_some() {
            runtime.relationship_reply_plan(&observation)
        } else if observation.allow_ordinary_speech {
            match initiative_actor_id {
                Some(responder_actor_id) => runtime.room_card_reaction_plan_for_actor(
                    observation.source_actor_id,
                    responder_actor_id,
                    &observation.source_events,
                ),
                None => runtime.next_room_card_reaction_plan(
                    observation.source_actor_id,
                    &observation.source_events,
                    Some(&active_direct_actor_ids),
                ),
            }
            .map(|plan| plan.with_observation(&observation).requesting_planner())
        } else {
            runtime.direct_observation_reply_plan(&observation)
        }
        .filter(|plan| {
            runtime
                .actor_by_id(plan.speaker_actor_id)
                .is_some_and(|actor| {
                    !runtime.actor_uses_inference(actor.id)
                        || runtime.autonomy_allows_action(plan.speaker_actor_id, CW_ACTION_SAY)
                })
        });
        let source_action_kind = observation
            .ripple_source
            .as_ref()
            .map(|source| source.source_action_kind)
            .unwrap_or(CW_ACTION_NONE);
        let ripple = if initiative_actor_id.is_none()
            && matches!(
                source_action_kind,
                CW_ACTION_GIVE_ITEM | CW_ACTION_TRADE_ITEM
            ) {
            None
        } else {
            observation.ripple_source.as_ref().and_then(|source| {
                let seed = runtime.next_seed_value();
                let context = source.to_context();
                let record = match initiative_actor_id {
                    Some(actor_id) => {
                        runtime.ripple_record_for_room_actor(&context, actor_id, seed)
                    }
                    None => runtime.ripple_record_for_player_turn(&context, seed),
                };
                record
                    .filter(|record| {
                        (initiative_actor_id.is_some()
                            || runtime
                                .autonomy_allows_action(record.action.actor_id, record.action.kind)
                            || record.offer_kind.as_deref() == Some("pass"))
                            && runtime.kernel_offer_allows_action(&record.action)
                    })
                    .map(|mut record| {
                        record.origin = JournalOrigin::ActorConsequence;
                        record.source_world_tick = Some(observation.source_world_tick);
                        record.caused_by_event_seq = observation.caused_by_event_seq;
                        record.observed_through_seq = Some(observation.observed_through_seq);
                        record.source_location_id = observation.source_location_id;
                        record
                    })
            })
        };
        match ripple {
            None => (Vec::new(), card_reaction_plan, None),
            Some(record) => {
                let action = record.action;
                match commit_journal_record(state, &mut runtime, record) {
                    Ok((CW_OK, events)) if !events.is_empty() => {
                        let next_observation = (state.event_store_path.is_none()
                            && observation.source_location_id.is_some_and(|location_id| {
                                room_initiative_needs_actor_job(
                                    &runtime,
                                    location_id,
                                    &active_direct_actor_ids,
                                )
                            }))
                        .then(|| {
                            player_tick_observation(
                                &runtime,
                                observation.source_location_id,
                                action.actor_id,
                                CW_OK,
                                &events,
                            )
                        })
                        .flatten();
                        let ripple_reply_plan = observation
                            .allow_ordinary_speech
                            .then(|| runtime.resident_economy_action_reply_plan(&action))
                            .flatten()
                            .map(|plan| plan.with_observation(&observation));
                        // The initiative actor's committed action is the beat.
                        // Narrate that outcome instead of letting a generic
                        // reaction from the same heartbeat hide it.
                        // A room-initiative seat commits exactly one certified
                        // action. The old reaction path would start a second AI
                        // narration after the action had already advanced the
                        // room, leaving its durable job holding the room lock
                        // while the next seat was visible. Relationship beats
                        // keep their dedicated reply contract; ordinary room
                        // actions are fully represented by their committed
                        // events.
                        let reply = if initiative_actor_id.is_some() && relationship_reply.is_none()
                        {
                            None
                        } else {
                            ripple_reply_plan.or(card_reaction_plan)
                        };
                        (events, reply, next_observation)
                    }
                    Ok((_status, _events)) => (Vec::new(), card_reaction_plan, None),
                    Err(error) => {
                        warn!(
                            "failed to commit player-tick actor consequence for event {:?}: {}",
                            observation.caused_by_event_seq, error
                        );
                        return Err(error.to_string());
                    }
                }
            }
        }
    };
    if !ripple_events.is_empty() {
        broadcast_events(state, &ripple_events);
    }
    Ok((reply_plan, relationship_reply, next_observation))
}

pub(super) fn schedule_player_tick_observation(
    state: &AppState,
    observation: PlayerTickObservation,
) {
    if state.event_store_path.is_some() {
        // The observation was inserted in the same SQLite transaction as the
        // card journal and events. This call only wakes the durable worker;
        // its available_at timestamp supplies the room-chat heartbeat delay.
        state.actor_job_notify.notify_waiters();
        return;
    }
    let Some(location_id) = observation.source_location_id else {
        return;
    };
    let dedicated_relationship_heartbeat = observation.relationship_reply.is_some();
    let initiative_heartbeat = room_handoff_from_observation(&observation).is_some();
    let heartbeat_armed = dedicated_relationship_heartbeat
        || initiative_heartbeat
        || state
            .room_chat_heartbeats
            .lock()
            .map(|mut rooms| rooms.insert(location_id))
            .unwrap_or(false);
    if !heartbeat_armed {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        let mut next_observation = Some(observation);
        for _ in 0..ROOM_INITIATIVE_CHAIN_LIMIT {
            let Some(current_observation) = next_observation.take() else {
                break;
            };
            tokio::time::sleep(Duration::from_millis(CARD_REACTION_HEARTBEAT_DELAY_MS)).await;
            match complete_player_tick_observation(&state, current_observation.clone()).await {
                Ok((plan, relationship_reply, followup)) => {
                    if let Err(error) = complete_player_tick_reply(
                        &state,
                        &current_observation,
                        plan,
                        relationship_reply,
                    )
                    .await
                    {
                        warn!("asynchronous resident dialogue failed: {}", error);
                        break;
                    }
                    next_observation = followup;
                }
                Err(error) => {
                    warn!("resident turn failed: {}", error);
                    break;
                }
            }
        }
        if !dedicated_relationship_heartbeat && !initiative_heartbeat {
            if let Ok(mut rooms) = state.room_chat_heartbeats.lock() {
                rooms.remove(&location_id);
            }
        }
    });
}

#[cfg(test)]
pub(super) fn claim_next_actor_job(path: &Path) -> io::Result<Option<ActorJob>> {
    claim_next_actor_job_filtered(path, None)
}

pub(super) fn claim_next_actor_job_of_kind(
    path: &Path,
    kind: &str,
) -> io::Result<Option<ActorJob>> {
    claim_next_actor_job_filtered(path, Some(kind))
}

fn claim_next_actor_job_filtered(
    path: &Path,
    claimed_kind: Option<&str>,
) -> io::Result<Option<ActorJob>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let now = now_millis() as i64;
    let row = conn
        .query_row(
            "SELECT id, kind, actor_id, attempts, context_json,
                    status, lease_until_ms, available_at_ms
             FROM actor_jobs
             WHERE ((status = 'pending' AND available_at_ms <= ?1)
                OR (status = 'running' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?1))
               AND (?2 IS NULL OR actor_jobs.kind = ?2)
               AND NOT EXISTS (
                   SELECT 1 FROM actor_jobs AS active
                   WHERE active.id != actor_jobs.id
                     AND active.status = 'running'
                     AND active.lease_until_ms > ?1
                     AND (
                         (actor_jobs.location_id IS NOT NULL
                          AND active.location_id = actor_jobs.location_id)
                         OR (actor_jobs.location_id IS NULL
                             AND active.actor_id = actor_jobs.actor_id)
                     )
               )
             ORDER BY source_tick ASC, id ASC
             LIMIT 1",
            params![now, claimed_kind],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()
        .map_err(sqlite_error)?;
    let Some((
        id,
        kind,
        actor_id,
        attempts,
        context_json,
        selected_status,
        selected_lease_until,
        selected_available_at,
    )) = row
    else {
        return Ok(None);
    };
    let payload = serde_json::from_str(&context_json).or_else(|primary_error| {
        if kind == ACTOR_JOB_KIND_PLAYER_TICK {
            serde_json::from_str::<PlayerTickObservation>(&context_json)
                .map(ActorJobPayload::PlayerTick)
        } else {
            Err(primary_error)
        }
    });
    let payload = match payload {
        Ok(payload) => payload,
        Err(_) => {
            let available_at = now.saturating_add(ACTOR_JOB_MALFORMED_PAYLOAD_RETRY_DELAY_MS);
            let deferred = conn
                .execute(
                    "UPDATE actor_jobs
                     SET status = 'pending', lease_until_ms = NULL, available_at_ms = ?2,
                         last_error = ?3, updated_at_ms = ?4
                     WHERE id = ?1
                       AND ((status = 'pending' AND available_at_ms <= ?4)
                         OR (status = 'running' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?4))
                       AND status = ?5 AND attempts = ?6 AND context_json = ?7
                       AND lease_until_ms IS ?8 AND available_at_ms = ?9",
                    params![
                        id,
                        available_at,
                        ACTOR_JOB_MALFORMED_PAYLOAD_ERROR,
                        now,
                        selected_status,
                        attempts,
                        context_json,
                        selected_lease_until,
                        selected_available_at,
                    ],
                )
                .map_err(sqlite_error)?;
            if deferred == 0 {
                return Ok(None);
            }
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("actor job {id} payload is malformed and was deferred"),
            ));
        }
    };
    let next_attempt = attempts.max(0).saturating_add(1);
    let lease_until = now.saturating_add(ACTOR_JOB_LEASE_MS as i64);
    let claimed = conn
        .execute(
            "UPDATE actor_jobs
             SET status = 'running', attempts = ?2, lease_until_ms = ?3, updated_at_ms = ?4
             WHERE id = ?1
               AND ((status = 'pending' AND available_at_ms <= ?4)
                 OR (status = 'running' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?4))
               AND status = ?5 AND attempts = ?6 AND context_json = ?7
               AND lease_until_ms IS ?8 AND available_at_ms = ?9
               AND NOT EXISTS (
                   SELECT 1 FROM actor_jobs AS active
                   WHERE active.id != actor_jobs.id
                     AND active.status = 'running'
                     AND active.lease_until_ms > ?4
                     AND (
                         (actor_jobs.location_id IS NOT NULL
                          AND active.location_id = actor_jobs.location_id)
                         OR (actor_jobs.location_id IS NULL
                             AND active.actor_id = actor_jobs.actor_id)
                     )
               )",
            params![
                id,
                next_attempt,
                lease_until,
                now,
                selected_status,
                attempts,
                context_json,
                selected_lease_until,
                selected_available_at,
            ],
        )
        .map_err(sqlite_error)?;
    if claimed == 0 {
        return Ok(None);
    }
    Ok(Some(ActorJob {
        id,
        kind,
        actor_id: actor_id.max(0) as u64,
        attempts: next_attempt.max(0) as u32,
        payload,
    }))
}

pub(super) fn fail_actor_job_for_runtime_state(
    path: &Path,
    state: &AppState,
    job: &ActorJob,
    error: &str,
    retry_floor_ms: u64,
) -> io::Result<()> {
    if matches!(
        &job.payload,
        ActorJobPayload::ModelInteraction(interaction)
            if model_interaction_batch_poll_pending(interaction, error)
    ) {
        return requeue_actor_job(
            path,
            job,
            error,
            retry_floor_ms.max(MODEL_INTERACTION_BATCH_POLL_DELAY_MS),
        );
    }
    let config = state.ai_config.as_ref().as_ref();
    let (provider_terminal, readiness_retry_floor_ms) = match &job.payload {
        ActorJobPayload::OrbChat(chat) => (
            chat_target_route_is_permanently_unavailable(config, chat.target_actor_id),
            chat_target_route_retry_floor_ms(config, chat.target_actor_id),
        ),
        ActorJobPayload::ModelInteraction(interaction) => (
            model_interaction_route_is_permanently_unavailable(config, &interaction.plan),
            model_interaction_route_retry_floor_ms(config, &interaction.plan),
        ),
        _ => (false, 0),
    };
    if readiness_retry_floor_ms > 0 {
        return requeue_actor_job(
            path,
            job,
            error,
            retry_floor_ms.max(readiness_retry_floor_ms),
        );
    }
    if !provider_terminal {
        return fail_or_retry_actor_job(path, job, error, retry_floor_ms);
    }
    let conn = open_event_store(path)?;
    conn.execute(
        "UPDATE actor_jobs
         SET status = 'dead', lease_until_ms = NULL, available_at_ms = ?2,
             last_error = ?3, updated_at_ms = ?2
         WHERE id = ?1",
        params![job.id, now_millis() as i64, trim_to_chars(error, 500),],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn requeue_actor_job(
    path: &Path,
    job: &ActorJob,
    error: &str,
    retry_floor_ms: u64,
) -> io::Result<()> {
    let conn = open_event_store(path)?;
    let now = now_millis();
    let backoff_ms = 250_u64
        .saturating_mul(1_u64 << job.attempts.saturating_sub(1).min(5))
        .max(retry_floor_ms);
    conn.execute(
        "UPDATE actor_jobs
         SET status = 'pending', lease_until_ms = NULL, available_at_ms = ?2,
             last_error = ?3, updated_at_ms = ?4
         WHERE id = ?1",
        params![
            job.id,
            now.saturating_add(backoff_ms) as i64,
            trim_to_chars(error, 500),
            now as i64,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}
