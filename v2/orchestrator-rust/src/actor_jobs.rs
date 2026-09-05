use super::*;

#[derive(Clone, Debug)]
pub(super) struct ActorJob {
    pub(super) id: i64,
    pub(super) kind: String,
    pub(super) actor_id: u64,
    pub(super) attempts: u32,
    pub(super) last_error: Option<String>,
    pub(super) cause_event_seq: Option<u64>,
    pub(super) source_tick: u64,
    pub(super) observed_through_seq: u64,
    pub(super) location_id: Option<u64>,
    pub(super) payload: ActorJobPayload,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "payload_kind", content = "payload", rename_all = "snake_case")]
pub(super) enum ActorJobPayload {
    PlayerTick(PlayerTickObservation),
    PlayerTickReply(Box<PlayerTickReplyJob>),
    RoomRope(RoomRopeJob),
    OrbChat(Box<OrbChatJob>),
    ModelInteraction(ModelInteractionJob),
    AvatarReflection(Box<AvatarReflectionJob>),
    AvatarSelfDescription(Box<AvatarReflectionJob>),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct PlayerTickReplyJob {
    pub(super) observation: PlayerTickObservation,
    pub(super) plan: Option<AvatarReplyPlan>,
    pub(super) relationship_reply: Option<RelationshipReplyExpectation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct RoomRopeJob {
    pub(super) location_id: u64,
    pub(super) actor_id: u64,
    pub(super) activation: u64,
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
pub(super) const ACTOR_JOB_KIND_PLAYER_TICK_REPLY: &str = "player_tick_reply";
pub(super) const ACTOR_JOB_KIND_ROOM_ROPE: &str = "room_rope";
pub(super) const ACTOR_JOB_KIND_ORB_CHAT: &str = "orb_chat";
pub(super) const ACTOR_JOB_KIND_MODEL_INTERACTION: &str = "model_interaction";
pub(super) const ACTOR_JOB_KIND_AVATAR_REFLECTION: &str = "avatar_reflection";
pub(super) const ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION: &str = "avatar_self_description";
pub(super) const ACTOR_JOB_LEASE_MS: u64 = 120_000;
pub(super) const ACTOR_JOB_MAX_ATTEMPTS: u32 = 3;
pub(super) const ACTOR_JOB_IDLE_POLL: Duration = Duration::from_secs(2);
const AVATAR_SELF_DESCRIPTION_RETRY_FLOOR_MS: u64 = 60_000;
// Resident reactions still get a brief human-feeling beat, but they should not
// hold the Story Hand for several seconds when there is no dialogue provider.
pub(super) const CARD_REACTION_HEARTBEAT_DELAY_MS: u64 = 750;
pub(super) const ROOM_INITIATIVE_CHAIN_LIMIT: usize = CW_MAX_ACTORS;
/// How long a directly controlled avatar may hold a room-initiative seat
/// without acting before the server commits a certified Pass on its behalf.
pub(super) const ROOM_SEAT_GRACE_MS: u64 = ORDERED_SCENE_BASE_GRACE_MS;
pub(super) const ACTOR_JOB_MALFORMED_PAYLOAD_RETRY_DELAY_MS: i64 = 30_000;
pub(super) const ACTOR_JOB_MALFORMED_PAYLOAD_ERROR: &str = "actor_job_payload_invalid";

pub(super) fn card_reaction_heartbeat_delay_ms() -> u64 {
    std::env::var("COSYWORLD_CARD_REACTION_HEARTBEAT_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.clamp(25, 60_000))
        .unwrap_or(CARD_REACTION_HEARTBEAT_DELAY_MS)
}

pub(super) fn actor_job_idle_poll() -> Duration {
    let milliseconds = std::env::var("COSYWORLD_ACTOR_JOB_IDLE_POLL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.clamp(25, ACTOR_JOB_IDLE_POLL.as_millis() as u64))
        .unwrap_or(ACTOR_JOB_IDLE_POLL.as_millis() as u64);
    Duration::from_millis(milliseconds)
}

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

pub(super) fn insert_room_rope_job(
    conn: &Connection,
    source_tick: u64,
    location_id: u64,
    actor_id: u64,
    activation: u64,
) -> io::Result<bool> {
    let dedupe_key = format!("room-rope:{location_id}:{actor_id}:{activation}");
    let inserted = insert_actor_job_payload(
        conn,
        ACTOR_JOB_KIND_ROOM_ROPE,
        actor_id,
        None,
        source_tick,
        0,
        Some(location_id),
        &dedupe_key,
        &ActorJobPayload::RoomRope(RoomRopeJob {
            location_id,
            actor_id,
            activation,
        }),
        ROOM_SEAT_GRACE_MS,
    )?;
    if inserted {
        return Ok(true);
    }

    // A rope that completed without effect because its holder disconnected
    // must be usable again when that same certified seat resumes later. Older
    // releases could also exhaust the retry budget before the room-pass path
    // was healthy. That terminal row owns the same dedupe key, so revive it as
    // well or the seat can never receive another timer.
    let now = now_millis() as i64;
    let rearmed = conn
        .execute(
            "UPDATE actor_jobs
             SET status = 'pending', attempts = 0, lease_until_ms = NULL,
                 available_at_ms = ?2, last_error = NULL, updated_at_ms = ?3
             WHERE dedupe_key = ?1 AND kind = ?4
               AND status IN ('completed', 'dead')",
            params![
                dedupe_key,
                now.saturating_add(ROOM_SEAT_GRACE_MS as i64),
                now,
                ACTOR_JOB_KIND_ROOM_ROPE,
            ],
        )
        .map_err(sqlite_error)?;
    Ok(rearmed > 0)
}

/// Presence can reconstruct the first room seat without emitting a handoff.
/// Arm that synthesized seat so reconnecting to an existing room cannot leave
/// every waiting Story Hand locked forever.
pub(super) fn schedule_resumed_room_rope(
    state: &AppState,
    runtime: &RuntimeWorld,
    resumed_actor_id: u64,
) -> io::Result<bool> {
    let Some(location_id) = runtime
        .actor_by_id(resumed_actor_id)
        .map(|actor| actor.location_id)
    else {
        return Ok(false);
    };
    let active_direct_actor_ids = active_actor_ids_for_state(state);
    let Some(initiative) =
        reconciled_room_initiative(runtime, location_id, &active_direct_actor_ids)
    else {
        return Ok(false);
    };
    let Some(actor_id) = initiative.current_actor_id() else {
        return Ok(false);
    };
    let actor_is_ropeable = runtime.actor_by_id(actor_id).is_some_and(|actor| {
        RuntimeWorld::actor_can_act(actor)
            && actor.location_id == location_id
            && !runtime.actor_uses_inference(actor.id)
    }) && active_direct_actor_ids.contains(&actor_id);
    if !actor_is_ropeable {
        return Ok(false);
    }

    if let Some(path) = state.event_store_path.as_deref() {
        let conn = open_event_store(path)?;
        let scheduled = insert_room_rope_job(
            &conn,
            runtime.world.tick,
            location_id,
            actor_id,
            initiative.activation,
        )?;
        if scheduled {
            state.actor_job_notify.notify_waiters();
        }
        return Ok(scheduled);
    }

    let rope_state = state.clone();
    let job = RoomRopeJob {
        location_id,
        actor_id,
        activation: initiative.activation,
    };
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(ROOM_SEAT_GRACE_MS)).await;
        if let Err(error) = complete_room_rope_job(&rope_state, &job).await {
            warn!("resumed room initiative rope failed: {}", error);
        }
    });
    Ok(true)
}

/// The seat a fresh `room.turn.advanced` event just handed to a directly
/// controlled avatar, if that avatar can still act in the room.
pub(super) fn room_rope_target_from_events(
    runtime: &RuntimeWorld,
    events: &[EventView],
) -> Option<(u64, u64, u64)> {
    let event = events
        .iter()
        .rev()
        .find(|event| event.success && event.type_name == "room.turn.advanced")?;
    let location_id = event.location_id?;
    let actor_id = event.actor_id?;
    let activation = event.content_id?;
    let actor = runtime.actor_by_id(actor_id)?;
    if !RuntimeWorld::actor_can_act(actor)
        || actor.location_id != location_id
        || runtime.actor_uses_inference(actor.id)
    {
        return None;
    }
    Some((location_id, actor_id, activation))
}

/// The room-initiative rope: when a directly controlled avatar's seat window
/// elapses without a committed action, the server commits one certified Pass
/// on that avatar's behalf and hands initiative onward. The seat certificate
/// is re-checked under the world lock, so a seat that already moved on (the
/// player acted, left, or a later rope fired) completes without any effect.
pub(super) async fn complete_room_rope_job(
    state: &AppState,
    job: &RoomRopeJob,
) -> Result<(), String> {
    let mut runtime = state.inner.lock().await;
    let active_direct_actor_ids = active_actor_ids_for_state(state);
    let seat_still_held =
        reconciled_room_initiative(&runtime, job.location_id, &active_direct_actor_ids)
            .is_some_and(|initiative| {
                initiative.activation == job.activation
                    && initiative.current_actor_id() == Some(job.actor_id)
            });
    if !seat_still_held {
        return Ok(());
    }
    let actor_is_ropeable = runtime.actor_by_id(job.actor_id).is_some_and(|actor| {
        RuntimeWorld::actor_can_act(actor)
            && actor.location_id == job.location_id
            && !runtime.actor_uses_inference(actor.id)
    }) && active_direct_actor_ids.contains(&job.actor_id);
    if !actor_is_ropeable {
        return Ok(());
    }
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: job.actor_id,
            location_id: job.location_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_player_card();
    record.bind_offer_kind("pass");
    record
        .projection_mutations
        .push(ProjectionMutation::ShuffleHand {
            reason: "room_initiative_rope".to_string(),
        });
    let commit = commit_journal_record(state, &mut runtime, record);
    drop(runtime);
    match commit {
        Ok((CW_OK, events)) => {
            broadcast_events(state, &events);
            Ok(())
        }
        Ok((_status, _events)) => Err("room_initiative_rope_rejected".to_string()),
        Err(error) => Err(error.to_string()),
    }
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
        actor_job_generation: 0,
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
        let current_generation = state.actor_job_generation.load(AtomicOrdering::Acquire);
        if current_generation != 0 && observation.actor_job_generation != current_generation {
            return Ok((None, None, None));
        }
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
                        let mut next_observation = (state.event_store_path.is_none()
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
                        if let Some(next) = next_observation.as_mut() {
                            next.actor_job_generation = observation.actor_job_generation;
                        }
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
    mut observation: PlayerTickObservation,
) {
    if observation.actor_job_generation == 0 {
        observation.actor_job_generation = state.actor_job_generation.load(AtomicOrdering::Acquire);
    }
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
            tokio::time::sleep(Duration::from_millis(card_reaction_heartbeat_delay_ms())).await;
            match complete_player_tick_observation(&state, current_observation.clone()).await {
                Ok((plan, relationship_reply, followup)) => {
                    if plan.is_some() || relationship_reply.is_some() {
                        let reply_state = state.clone();
                        tokio::spawn(async move {
                            if let Err(error) = complete_player_tick_reply(
                                &reply_state,
                                &current_observation,
                                plan,
                                relationship_reply,
                            )
                            .await
                            {
                                warn!("asynchronous resident dialogue failed: {}", error);
                            }
                        });
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
                    status, lease_until_ms, available_at_ms,
                    cause_event_seq, source_tick, observed_through_seq, location_id,
                    last_error
             FROM actor_jobs
             WHERE ((status = 'pending' AND available_at_ms <= ?1)
                OR (status = 'running' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?1))
               AND (?2 IS NULL OR actor_jobs.kind = ?2)
               AND NOT EXISTS (
                   SELECT 1 FROM actor_jobs AS active
                   WHERE active.id != actor_jobs.id
                     AND active.status = 'running'
                     AND ((active.kind IN ('player_tick_observation', 'room_rope'))
                          = (actor_jobs.kind IN ('player_tick_observation', 'room_rope')))
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
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                    row.get::<_, Option<String>>(12)?,
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
        cause_event_seq,
        source_tick,
        observed_through_seq,
        location_id,
        last_error,
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
                     AND ((active.kind IN ('player_tick_observation', 'room_rope'))
                          = (actor_jobs.kind IN ('player_tick_observation', 'room_rope')))
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
        last_error,
        cause_event_seq: cause_event_seq.map(|value| value.max(0) as u64),
        source_tick: source_tick.max(0) as u64,
        observed_through_seq: observed_through_seq.max(0) as u64,
        location_id: location_id.map(|value| value.max(0) as u64),
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
        error,
        AI_READINESS_PROBING | AI_RATE_LIMITED | AI_PROVIDER_UNAVAILABLE
    ) {
        let readiness_delay_ms = state
            .ai_config
            .as_ref()
            .as_ref()
            .map(|config| {
                config
                    .recommended_readiness_probe_delay()
                    .as_millis()
                    .min(u64::MAX as u128) as u64
            })
            .unwrap_or(1_000);
        return defer_actor_job_without_attempt(
            path,
            job,
            error,
            retry_floor_ms.max(readiness_delay_ms),
        );
    }
    if matches!(&job.payload, ActorJobPayload::AvatarSelfDescription(_))
        && matches!(
            error,
            "voice_latency_exhausted"
                | "voice_provider_unavailable"
                | "voice_job_retry_exhausted"
                | "voice_no_eligible_candidates"
                | "voice_candidates_exhausted"
                | "voice_generation_in_flight"
        )
    {
        // A funded portrait must not become permanently stranded because all
        // server voice routes were briefly cooling down. Keep its private
        // prerequisite durable, but wait beyond the provider cooldown before
        // trying again so a recovery wave cannot create a request storm.
        return defer_actor_job_without_attempt(
            path,
            job,
            error,
            retry_floor_ms.max(AVATAR_SELF_DESCRIPTION_RETRY_FLOOR_MS),
        );
    }
    if matches!(&job.payload, ActorJobPayload::OrbChat(_))
        && pending_chat_context_rejection(error).is_some()
    {
        return fail_or_retry_actor_job(path, job, error, retry_floor_ms);
    }
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
    if readiness_retry_floor_ms > 0 && job.attempts < ACTOR_JOB_MAX_ATTEMPTS {
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
    log_dead_actor_job(job, "provider_terminal");
    Ok(())
}

pub(super) fn fail_or_retry_actor_job(
    path: &Path,
    job: &ActorJob,
    error: &str,
    retry_floor_ms: u64,
) -> io::Result<()> {
    let conn = open_event_store(path)?;
    let terminal = job.attempts >= ACTOR_JOB_MAX_ATTEMPTS;
    let backoff_ms = 250_u64
        .saturating_mul(1_u64 << job.attempts.saturating_sub(1).min(5))
        .max(retry_floor_ms);
    let now = now_millis();
    let updated = conn
        .execute(
            "UPDATE actor_jobs
         SET status = ?2, lease_until_ms = NULL, available_at_ms = ?3,
             last_error = ?4, updated_at_ms = ?5
         WHERE id = ?1",
            params![
                job.id,
                if terminal { "dead" } else { "pending" },
                now.saturating_add(backoff_ms) as i64,
                trim_to_chars(error, 500),
                now as i64,
            ],
        )
        .map_err(sqlite_error)?;
    if terminal && updated > 0 {
        log_dead_actor_job(job, "attempt_budget_exhausted");
    }
    Ok(())
}

pub(super) fn log_dead_actor_job(job: &ActorJob, disposition: &'static str) {
    error!(
        event = "actor_job_dead",
        actor_job_id = job.id,
        actor_job_kind = job.kind,
        actor_id = job.actor_id,
        actor_attempts = job.attempts,
        disposition,
        "actor job entered the durable dead state"
    );
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

fn defer_actor_job_without_attempt(
    path: &Path,
    job: &ActorJob,
    error: &str,
    retry_floor_ms: u64,
) -> io::Result<()> {
    let conn = open_event_store(path)?;
    let now = now_millis();
    conn.execute(
        "UPDATE actor_jobs
         SET status = 'pending', attempts = MAX(attempts - 1, 0),
             lease_until_ms = NULL, available_at_ms = ?2,
             last_error = ?3, updated_at_ms = ?4
         WHERE id = ?1 AND status = 'running'",
        params![
            job.id,
            now.saturating_add(retry_floor_ms.max(250)) as i64,
            trim_to_chars(error, 500),
            now as i64,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

#[cfg(test)]
mod readiness_retry_tests {
    use super::*;

    #[test]
    fn readiness_deferral_does_not_consume_an_actor_attempt() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-readiness-deferral-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize readiness deferral store");
        let conn = open_event_store(&path).expect("open readiness deferral store");
        let payload = ActorJobPayload::RoomRope(RoomRopeJob {
            location_id: 11,
            actor_id: 22,
            activation: 33,
        });
        assert!(insert_actor_job_payload(
            &conn,
            ACTOR_JOB_KIND_ROOM_ROPE,
            22,
            None,
            1,
            1,
            Some(11),
            "readiness-deferral",
            &payload,
            0,
        )
        .expect("queue readiness deferral job"));
        drop(conn);
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("claim readiness deferral job")
            .expect("readiness deferral job exists");
        assert_eq!(claimed.attempts, 1);
        defer_actor_job_without_attempt(&path, &claimed, AI_READINESS_PROBING, 250)
            .expect("defer readiness job");
        let conn = open_event_store(&path).expect("inspect deferred readiness job");
        let deferred: (String, u32, Option<i64>) = conn
            .query_row(
                "SELECT status, attempts, lease_until_ms FROM actor_jobs WHERE id = ?1",
                params![claimed.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read deferred readiness job");
        assert_eq!(deferred, ("pending".to_string(), 0, None));
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn transient_self_description_route_failure_stays_pending_after_attempt_budget() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-self-description-route-deferral-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize self-description deferral store");
        let runtime = RuntimeWorld::seeded();
        let reflection = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Thought)
            .expect("Gust can describe themself");
        let state = test_app_state(runtime, Some(path.clone()));
        let conn = open_event_store(&path).expect("open self-description deferral store");
        assert!(insert_avatar_self_description_job(&conn, &reflection)
            .expect("queue self-description job"));
        conn.execute(
            "UPDATE actor_jobs SET attempts = ?1, available_at_ms = 0",
            params![ACTOR_JOB_MAX_ATTEMPTS - 1],
        )
        .expect("place the job on its final generic attempt");
        drop(conn);

        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION)
            .expect("claim self-description job")
            .expect("self-description job exists");
        assert_eq!(claimed.attempts, ACTOR_JOB_MAX_ATTEMPTS);
        fail_actor_job_for_runtime_state(&path, &state, &claimed, "voice_candidates_exhausted", 0)
            .expect("defer transient self-description failure");

        let conn = open_event_store(&path).expect("inspect deferred self-description job");
        let deferred: (String, u32, Option<i64>, i64) = conn
            .query_row(
                "SELECT status, attempts, lease_until_ms, available_at_ms
                 FROM actor_jobs WHERE id = ?1",
                params![claimed.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read deferred self-description job");
        assert_eq!(deferred.0, "pending");
        assert_eq!(deferred.1, ACTOR_JOB_MAX_ATTEMPTS - 1);
        assert_eq!(deferred.2, None);
        assert!(deferred.3 >= now_millis() as i64 + 59_000);
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod rope_tests {
    use super::*;

    async fn rope_test_state(suffix: &str) -> (AppState, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-room-rope-{suffix}-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Opal");
        create_test_human(&mut runtime, 5001, RAIN_SOFT_GARDEN_LOCATION_ID, "Fable");
        runtime.actor_autonomy.entry(5000).or_default().control_mode =
            ActorControlMode::DirectInput;
        runtime.actor_autonomy.entry(5001).or_default().control_mode =
            ActorControlMode::DirectInput;
        let state = test_app_state(runtime, Some(path.clone()));
        let (session_5000, _) = issue_actor_session(&state, 5000);
        let (session_5001, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5000, &session_5000),
            Some(false)
        );
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5001, &session_5001),
            Some(false)
        );
        (state, path)
    }

    fn player_pass_record(runtime: &RuntimeWorld, actor_id: u64) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id,
                location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_player_card();
        record.bind_offer_kind("pass");
        record
            .projection_mutations
            .push(ProjectionMutation::ShuffleHand {
                reason: "rope_test".to_string(),
            });
        record
    }

    #[tokio::test]
    async fn a_player_seat_handoff_schedules_and_fires_the_rope() {
        let (state, path) = rope_test_state("fires").await;
        {
            let mut runtime = state.inner.lock().await;
            let record = player_pass_record(&runtime, 5000);
            let (status, events) = commit_journal_record(&state, &mut runtime, record)
                .expect("the opening pass commits");
            assert_eq!(status, CW_OK);
            assert!(events
                .iter()
                .any(|event| event.type_name == "room.turn.advanced"));
        }
        let _ = release_pending_actor_jobs(&path, ACTOR_JOB_KIND_ROOM_ROPE);
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("rope job claim reads the store")
            .expect("the durable handoff scheduled exactly one room rope job");
        let ActorJobPayload::RoomRope(rope) = job.payload else {
            panic!("room rope jobs carry the room rope payload");
        };
        assert_eq!(rope.actor_id, 5001);
        assert_eq!(rope.location_id, RAIN_SOFT_GARDEN_LOCATION_ID);

        complete_room_rope_job(&state, &rope)
            .await
            .expect("the rope commits or no-ops without erroring");

        let runtime = state.inner.lock().await;
        assert!(runtime
            .room_initiatives
            .get(&RAIN_SOFT_GARDEN_LOCATION_ID)
            .is_some_and(|initiative| initiative.current_actor_id() == Some(5000)));
    }

    #[tokio::test]
    async fn a_resumed_room_schedules_and_fires_its_synthesized_first_rope() {
        let (state, path) = rope_test_state("resume-bootstrap").await;
        {
            let mut runtime = state.inner.lock().await;
            assert!(!runtime
                .room_initiatives
                .contains_key(&RAIN_SOFT_GARDEN_LOCATION_ID));
            runtime.append_actor_presence_event(5001, true);
        }

        let events = commit_presence_event(&state, 5001, true).await;
        assert!(
            events.is_empty(),
            "resume may repeat an active presence edge"
        );

        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("release the resumed room rope");
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("resumed room rope claim reads the store")
            .expect("resume schedules the synthesized opening seat");
        let ActorJobPayload::RoomRope(rope) = job.payload else {
            panic!("resumed room rope jobs carry the room rope payload");
        };
        assert_eq!(rope.actor_id, 5000);
        assert_eq!(rope.activation, 1);

        complete_room_rope_job(&state, &rope)
            .await
            .expect("the resumed room rope commits");

        let runtime = state.inner.lock().await;
        assert!(runtime
            .room_initiatives
            .get(&RAIN_SOFT_GARDEN_LOCATION_ID)
            .is_some_and(|initiative| initiative.current_actor_id() == Some(5001)));
    }

    #[tokio::test]
    async fn an_already_active_presence_ping_schedules_the_resumed_room_rope() {
        let (state, path) = rope_test_state("active-resume-bootstrap").await;
        {
            let mut runtime = state.inner.lock().await;
            assert!(!runtime
                .room_initiatives
                .contains_key(&RAIN_SOFT_GARDEN_LOCATION_ID));
            runtime.append_actor_presence_event(5001, true);
        }
        let (actor_session, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5001, &actor_session),
            Some(false),
            "the first heartbeat activates the resumed session"
        );

        let ping = ping_presence(
            State(state.clone()),
            Json(ActorRequest {
                actor_id: 5001,
                actor_session: Some(actor_session),
            }),
        )
        .await
        .0;
        assert!(ping.ok);
        assert!(
            ping.events.is_empty(),
            "an already-active heartbeat must not emit another presence edge"
        );

        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("release the active-session resume rope");
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("active-session resume rope claim reads the store")
            .expect("an already-active resumed session still schedules the opening rope");
        let ActorJobPayload::RoomRope(rope) = job.payload else {
            panic!("active-session resume jobs carry the room rope payload");
        };
        assert_eq!(rope.actor_id, 5000);
        assert_eq!(rope.activation, 1);
    }

    #[tokio::test]
    async fn a_state_resume_does_not_project_or_revive_an_internal_room_rope() {
        let (state, path) = rope_test_state("dead-resume-bootstrap").await;
        {
            let runtime = state.inner.lock().await;
            assert!(schedule_resumed_room_rope(&state, &runtime, 5001)
                .expect("the opening rope is scheduled"));
        }
        let conn = open_event_store(&path).expect("open the rope store");
        conn.execute(
            "UPDATE actor_jobs
             SET status = 'dead', attempts = ?1, last_error = 'old_release_failure'
             WHERE kind = ?2",
            params![ACTOR_JOB_MAX_ATTEMPTS, ACTOR_JOB_KIND_ROOM_ROPE],
        )
        .expect("poison the old rope row");
        drop(conn);

        let projected = {
            let runtime = state.inner.lock().await;
            let active = active_actor_ids_for_state(&state);
            actor_room_turn_view(&state, &runtime, 5001, &active)
                .expect("the player still receives a turn projection")
        };
        assert!(!projected.enabled);
        assert_eq!(projected.scene_kind, None);
        assert_eq!(projected.seat_expires_at_ms, None);

        let conn = open_event_store(&path).expect("inspect the hidden rope");
        let stored: (String, u32, Option<String>) = conn
            .query_row(
                "SELECT status, attempts, last_error
                 FROM actor_jobs WHERE kind = ?1",
                params![ACTOR_JOB_KIND_ROOM_ROPE],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read the hidden rope");
        assert_eq!(
            stored,
            (
                "dead".to_string(),
                ACTOR_JOB_MAX_ATTEMPTS,
                Some("old_release_failure".to_string())
            )
        );
    }

    #[tokio::test]
    async fn a_rope_for_a_moved_seat_completes_without_effect() {
        let (state, _path) = rope_test_state("stale").await;
        {
            let mut runtime = state.inner.lock().await;
            let record = player_pass_record(&runtime, 5000);
            let (status, _) = commit_journal_record(&state, &mut runtime, record)
                .expect("the opening pass commits");
            assert_eq!(status, CW_OK);
        }
        // The activation counter moved past the stale certificate.
        let stale = RoomRopeJob {
            location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            actor_id: 5001,
            activation: 1,
        };
        complete_room_rope_job(&state, &stale)
            .await
            .expect("a stale rope completes silently");
        let runtime = state.inner.lock().await;
        let active = active_actor_ids_for_state(&state);
        assert_eq!(
            current_room_initiative_actor(&runtime, RAIN_SOFT_GARDEN_LOCATION_ID, &active),
            Some(5001),
            "a stale rope never advances the room"
        );
    }

    #[tokio::test]
    async fn an_absent_seat_holder_is_not_rope_passed() {
        let (state, path) = rope_test_state("absent").await;
        {
            let mut runtime = state.inner.lock().await;
            let record = player_pass_record(&runtime, 5000);
            let (status, _) = commit_journal_record(&state, &mut runtime, record)
                .expect("the opening pass commits");
            assert_eq!(status, CW_OK);
        }
        let _ = release_pending_actor_jobs(&path, ACTOR_JOB_KIND_ROOM_ROPE);
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ROOM_ROPE)
            .expect("rope job claim reads the store")
            .expect("the durable handoff scheduled one room rope job");
        let ActorJobPayload::RoomRope(rope) = job.payload else {
            panic!("room rope jobs carry the room rope payload");
        };
        // Drop every active session so the seated avatar is not connected.
        if let Ok(mut sessions) = state.actor_sessions.lock() {
            sessions.sessions.clear();
        }
        complete_room_rope_job(&state, &rope)
            .await
            .expect("an absent holder completes the rope silently");
        let runtime = state.inner.lock().await;
        let empty: BTreeSet<u64> = BTreeSet::new();
        assert!(
            current_room_initiative_actor(&runtime, RAIN_SOFT_GARDEN_LOCATION_ID, &empty)
                .is_none_or(|current| current != rope.actor_id)
        );
    }
}

/// Atomically move the committed observation into the dialogue lane. The same
/// durable row and dedupe key preserve recovery and exactly-once scheduling.
fn handoff_player_tick_reply(
    path: &Path,
    job: &ActorJob,
    observation: &PlayerTickObservation,
    plan: Option<AvatarReplyPlan>,
    relationship_reply: Option<RelationshipReplyExpectation>,
) -> io::Result<()> {
    let payload = ActorJobPayload::PlayerTickReply(Box::new(PlayerTickReplyJob {
        observation: observation.clone(),
        plan,
        relationship_reply,
    }));
    let context = serde_json::to_string(&payload).map_err(io::Error::other)?;
    let conn = open_event_store(path)?;
    conn.execute(
        "UPDATE actor_jobs SET kind = ?2, context_json = ?3, status = 'pending',
             attempts = 0, lease_until_ms = NULL, available_at_ms = 0,
             last_error = NULL, updated_at_ms = ?4
         WHERE id = ?1 AND kind = ?5 AND status = 'running' AND attempts = ?6",
        params![
            job.id,
            ACTOR_JOB_KIND_PLAYER_TICK_REPLY,
            context,
            now_millis() as i64,
            ACTOR_JOB_KIND_PLAYER_TICK,
            job.attempts
        ],
    )
    .map_err(sqlite_error)?;
    // A newer claim or an earlier handoff owns a row that no longer matches.
    Ok(())
}

pub(super) async fn run_actor_job_worker(state: AppState, claimed_kind: &'static str) {
    loop {
        let path = state
            .event_store_path
            .as_deref()
            .expect("actor worker requires an event store");
        match claim_next_actor_job_of_kind(path, claimed_kind) {
            Ok(Some(job)) => {
                let result = match (&job.kind[..], &job.payload) {
                    (ACTOR_JOB_KIND_PLAYER_TICK, ActorJobPayload::PlayerTick(observation))
                        if job.actor_id == observation.source_actor_id =>
                    {
                        match complete_player_tick_observation(&state, observation.clone()).await {
                            Ok((plan, relationship_reply, _next_observation))
                                if plan.is_some() || relationship_reply.is_some() =>
                            {
                                handoff_player_tick_reply(
                                    path,
                                    &job,
                                    observation,
                                    plan,
                                    relationship_reply,
                                )
                                .map(|()| {
                                    state.actor_job_notify.notify_waiters();
                                    false
                                })
                                .map_err(|error| error.to_string())
                            }
                            Ok(_) => Ok(true),
                            Err(error) => Err(error),
                        }
                    }
                    (ACTOR_JOB_KIND_PLAYER_TICK_REPLY, ActorJobPayload::PlayerTickReply(reply))
                        if job.actor_id == reply.observation.source_actor_id =>
                    {
                        complete_player_tick_reply(
                            &state,
                            &reply.observation,
                            reply.plan.clone(),
                            reply.relationship_reply.clone(),
                        )
                        .await
                        .map(|()| true)
                    }
                    (ACTOR_JOB_KIND_ORB_CHAT, ActorJobPayload::OrbChat(chat))
                        if job.actor_id == chat.actor_id =>
                    {
                        complete_queued_orb_chat_attempt(
                            &state,
                            chat.actor_id,
                            chat.target_actor_id,
                            chat.plan.clone(),
                            chat.queue_event_id,
                            chat.source_world_tick,
                            chat.observed_through_seq,
                            Some(&job),
                            job.attempts,
                        )
                        .await
                        .map(|_| true)
                    }
                    (
                        ACTOR_JOB_KIND_MODEL_INTERACTION,
                        ActorJobPayload::ModelInteraction(interaction),
                    ) if job.actor_id == interaction.actor_id => {
                        complete_model_interaction_attempt(
                            &state,
                            interaction.clone(),
                            job.attempts,
                        )
                        .await
                        .map(|_| true)
                    }
                    (ACTOR_JOB_KIND_ROOM_ROPE, ActorJobPayload::RoomRope(rope))
                        if job.actor_id == rope.actor_id =>
                    {
                        complete_room_rope_job(&state, rope).await.map(|_| true)
                    }
                    (
                        ACTOR_JOB_KIND_AVATAR_REFLECTION,
                        ActorJobPayload::AvatarReflection(reflection),
                    ) if job.actor_id == reflection.actor_id => {
                        complete_avatar_reflection(&state, reflection.as_ref().clone())
                            .await
                            .map(|_| true)
                    }
                    (
                        ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION,
                        ActorJobPayload::AvatarSelfDescription(self_description),
                    ) if job.actor_id == self_description.actor_id => {
                        complete_avatar_self_description(&state, self_description.as_ref())
                            .await
                            .map(|_| true)
                    }
                    _ => Err(format!(
                        "unsupported or inconsistent actor job kind {}",
                        job.kind
                    )),
                };
                match result {
                    Ok(true) => {
                        if let Err(error) = complete_actor_job(path, job.id) {
                            warn!("failed to complete actor job {}: {}", job.id, error);
                        }
                    }
                    Ok(false) => {}
                    Err(error) => {
                        warn!("actor job {} failed: {}", job.id, error);
                        let retry_floor_ms = actor_job_retry_floor_ms(&state, &job, &error);
                        if let Err(store_error) = fail_actor_job_for_runtime_state(
                            path,
                            &state,
                            &job,
                            &error.to_string(),
                            retry_floor_ms,
                        ) {
                            warn!(
                                "failed to update retry state for actor job {}: {}",
                                job.id, store_error
                            );
                        }
                    }
                }
            }
            Ok(None) => {
                tokio::select! {
                    _ = state.actor_job_notify.notified() => {},
                    _ = tokio::time::sleep(actor_job_idle_poll()) => {},
                }
            }
            Err(error) => {
                warn!("durable actor worker could not claim a job: {}", error);
                tokio::time::sleep(actor_job_idle_poll()).await;
            }
        }
    }
}

#[cfg(test)]
mod dialogue_lane_tests {
    use super::*;
    use axum::{routing::post, Router};

    #[tokio::test]
    async fn provider_timeout_leaves_gameplay_worker_and_room_turns_available() {
        let started = Arc::new(Notify::new());
        let app = Router::new().route(
            "/chat/completions",
            post({
                let started = started.clone();
                move |Json(_request): Json<serde_json::Value>| {
                    let started = started.clone();
                    async move {
                        started.notify_one();
                        std::future::pending::<Json<serde_json::Value>>().await
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let path = std::env::temp_dir().join(format!(
            "cosyworld-dialogue-timeout-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Lane Player");
        let plan = runtime.avatar_chat_plan_for(5000, RATI_ACTOR_ID).unwrap();
        let queue_event = EventView {
            seq: runtime.world.next_event_seq,
            type_name: "chat.queued".to_string(),
            actor_id: Some(5000),
            target_actor_id: Some(RATI_ACTOR_ID),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            success: true,
            ..Default::default()
        };
        runtime.world.next_event_seq += 1;
        runtime.event_log.push(queue_event.clone());
        let mut state = test_app_state(runtime, Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            voice_routing: crate::ai_voice_routing::VoiceRoutingConfig {
                max_attempts: 1,
                latency_ceiling: Duration::from_secs(2),
                ..Default::default()
            },
            ..AiConfig::default()
        }));
        let (session, _) = issue_actor_session(&state, 5000);
        ping_actor_session_for_actor(&state.actor_sessions, 5000, &session);
        init_event_store(&path).unwrap();
        append_event_store(&path, &[queue_event.clone()]).unwrap();
        let conn = open_event_store(&path).unwrap();
        insert_orb_chat_job(
            &conn,
            &OrbChatJob {
                actor_id: 5000,
                target_actor_id: RATI_ACTOR_ID,
                plan,
                queue_event_id: Some(queue_event.seq),
                source_world_tick: Some(40),
                observed_through_seq: Some(queue_event.seq),
            },
            40,
            Some(queue_event.seq),
        )
        .unwrap();
        let chat_worker =
            tokio::spawn(run_actor_job_worker(state.clone(), ACTOR_JOB_KIND_ORB_CHAT));
        tokio::time::timeout(Duration::from_secs(5), started.notified())
            .await
            .expect("the provider is processing the resident request");

        // The authoritative player action and its room handoff commit while
        // the provider still holds the dialogue request.
        {
            let mut runtime = state.inner.lock().await;
            let mut pass = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: 5000,
                    location_id: COSY_COTTAGE_LOCATION_ID,
                    ..Default::default()
                },
                runtime.next_seed_value(),
            )
            .into_player_card();
            pass.bind_offer_kind("pass");
            pass.projection_mutations
                .push(ProjectionMutation::ShuffleHand {
                    reason: "dialogue_lane_test".to_string(),
                });
            let (status, events) = commit_journal_record(&state, &mut runtime, pass).unwrap();
            assert_eq!(status, CW_OK);
            assert!(events
                .iter()
                .any(|event| event.type_name == "room.turn.advanced"));
        }
        let observation = PlayerTickObservation {
            source_actor_id: 5000,
            source_world_tick: 41,
            actor_job_generation: 0,
            caused_by_event_seq: Some(401),
            observed_through_seq: 401,
            source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
            allow_ordinary_speech: false,
            source_events: Vec::new(),
            ripple_source: None,
            relationship_reply: None,
        };
        append_actor_job(&path, &observation).unwrap();
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).unwrap();
        let gameplay_worker = tokio::spawn(run_actor_job_worker(
            state.clone(),
            ACTOR_JOB_KIND_PLAYER_TICK,
        ));
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let finished: bool = conn.query_row(
                    "SELECT status = 'completed' FROM actor_jobs WHERE kind = ?1 AND cause_event_seq = 401",
                    [ACTOR_JOB_KIND_PLAYER_TICK], |row| row.get(0),
                ).unwrap();
                if finished { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("gameplay completes before the provider timeout");
        let chat_status: String = conn
            .query_row(
                "SELECT status FROM actor_jobs WHERE kind = ?1",
                [ACTOR_JOB_KIND_ORB_CHAT],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(chat_status, "running");
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let running: bool = conn
                    .query_row(
                        "SELECT status = 'running' FROM actor_jobs WHERE kind = ?1",
                        [ACTOR_JOB_KIND_ORB_CHAT],
                        |row| row.get(0),
                    )
                    .unwrap();
                if !running {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the dialogue timeout has a bounded outcome");
        assert!(state.inner.lock().await.event_log.iter().any(|event| {
            matches!(
                event.type_name.as_str(),
                "dialogue.unavailable" | "chat.failed" | "chat.retrying"
            )
        }));
        gameplay_worker.abort();
        chat_worker.abort();
        server.abort();
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn gameplay_jobs_progress_while_chat_waits() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-actor-outbox-lanes-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize actor outbox lanes");
        let mut runtime = RuntimeWorld::seeded();
        crate::test_support::create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Lane Player",
        );
        let plan = runtime
            .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
            .expect("Rati is available for Chat");
        let chat = OrbChatJob {
            actor_id: 5000,
            target_actor_id: RATI_ACTOR_ID,
            plan,
            queue_event_id: None,
            source_world_tick: None,
            observed_through_seq: None,
        };
        let conn = open_event_store(&path).expect("open actor outbox lanes");
        assert!(insert_orb_chat_job(&conn, &chat, 40, Some(400)).expect("queue slow Chat"));
        drop(conn);
        let observation = PlayerTickObservation {
            source_actor_id: 5000,
            source_world_tick: 41,
            actor_job_generation: 0,
            caused_by_event_seq: Some(401),
            observed_through_seq: 401,
            source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
            allow_ordinary_speech: true,
            source_events: Vec::new(),
            ripple_source: None,
            relationship_reply: None,
        };
        assert!(append_actor_job(&path, &observation).expect("queue gameplay turn"));

        let claimed_chat = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("claim Chat lane")
            .expect("Chat is running");
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .expect("release gameplay heartbeat");
        let claimed_gameplay = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .unwrap()
            .expect("gameplay proceeds while Chat holds its provider request");
        let next = PlayerTickObservation {
            source_world_tick: 42,
            caused_by_event_seq: Some(402),
            observed_through_seq: 402,
            ..observation.clone()
        };
        assert!(append_actor_job(&path, &next).unwrap());
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).unwrap();
        assert!(
            claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
                .unwrap()
                .is_none()
        );
        complete_actor_job(&path, claimed_gameplay.id).unwrap();
        let next_gameplay = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .unwrap()
            .expect("the next gameplay job starts while Chat still waits");
        fail_or_retry_actor_job(&path, &claimed_chat, "timeout", 60_000).unwrap();
        let conn = open_event_store(&path).unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM actor_jobs WHERE id = ?1",
                [next_gameplay.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            status, "running",
            "a dialogue timeout preserves the gameplay claim"
        );
        complete_actor_job(&path, next_gameplay.id).unwrap();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn committed_observation_handoff_preserves_reply_and_recovery() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-dialogue-handoff-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let mut runtime = RuntimeWorld::seeded();
        crate::test_support::create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Reply Player",
        );
        let plan = runtime
            .resident_reply_plan_for_target(5000, RATI_ACTOR_ID, "The lantern is lit.")
            .unwrap();
        let observation = PlayerTickObservation {
            source_actor_id: 5000,
            source_world_tick: 41,
            actor_job_generation: 1,
            caused_by_event_seq: Some(401),
            observed_through_seq: 401,
            source_location_id: Some(COSY_COTTAGE_LOCATION_ID),
            allow_ordinary_speech: true,
            source_events: Vec::new(),
            ripple_source: None,
            relationship_reply: None,
        };
        let expectation = RelationshipReplyExpectation {
            actor_id: 5000,
            target_actor_id: RATI_ACTOR_ID,
            relationship_event_seq: 400,
            user_text: "The lantern is lit.".to_string(),
        };
        assert!(append_actor_job(&path, &observation).unwrap());
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).unwrap();
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .unwrap()
            .unwrap();
        let conn = open_event_store(&path).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_handoff BEFORE UPDATE OF kind ON actor_jobs BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;").unwrap();
        assert!(handoff_player_tick_reply(
            &path,
            &claimed,
            &observation,
            Some(plan.clone()),
            Some(expectation.clone())
        )
        .is_err());
        let status: (String, String) = conn
            .query_row(
                "SELECT kind, status FROM actor_jobs WHERE id = ?1",
                [claimed.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            status,
            (
                ACTOR_JOB_KIND_PLAYER_TICK.to_string(),
                "running".to_string()
            )
        );
        conn.execute_batch("DROP TRIGGER fail_handoff;").unwrap();
        handoff_player_tick_reply(
            &path,
            &claimed,
            &observation,
            Some(plan.clone()),
            Some(expectation.clone()),
        )
        .unwrap();
        assert!(!append_actor_job(&path, &observation).unwrap());
        assert!(
            claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
                .unwrap()
                .is_none()
        );
        let reply = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK_REPLY)
            .unwrap()
            .unwrap();
        assert_eq!(reply.id, claimed.id);
        assert_eq!(
            reply.attempts, 1,
            "dialogue receives its own bounded attempt budget"
        );
        // An old gameplay completion cannot replace an already claimed reply.
        handoff_player_tick_reply(&path, &claimed, &observation, None, None).unwrap();
        conn.execute(
            "UPDATE actor_jobs SET lease_until_ms = 0 WHERE id = ?1",
            [reply.id],
        )
        .unwrap();
        let recovered = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK_REPLY)
            .unwrap()
            .unwrap();
        let ActorJobPayload::PlayerTickReply(recovered_payload) = recovered.payload else {
            panic!("durable reply payload");
        };
        assert_eq!(
            serde_json::to_value(recovered_payload.plan).unwrap(),
            serde_json::to_value(Some(plan)).unwrap()
        );
        assert_eq!(
            serde_json::to_value(recovered_payload.relationship_reply).unwrap(),
            serde_json::to_value(Some(expectation)).unwrap()
        );
        assert_eq!(
            serde_json::to_value(recovered_payload.observation).unwrap(),
            serde_json::to_value(observation).unwrap()
        );
        complete_actor_job(&path, reply.id).unwrap();
        let _ = fs::remove_file(path);
    }
}
