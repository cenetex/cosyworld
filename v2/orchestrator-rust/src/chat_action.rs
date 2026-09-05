use super::*;

static CHAT_ACTION_LOCKS: OnceLock<StdMutex<BTreeMap<String, Weak<Mutex<()>>>>> = OnceLock::new();
const CHAT_TERMINAL_STATUS_PENDING_PREFIX: &str = "chat_terminal_status_pending:";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CommittedOrbChatLine {
    pub(super) seq: u64,
    pub(super) speaker_actor_id: u64,
    pub(super) content: String,
}

pub(super) const MAX_CHAT_FLOOR_ROUNDS: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ChatContinuationRejection {
    StaleSourceSequence,
    InitiatorMissing,
    TargetMissing,
    InitiatorUnavailable,
    TargetUnavailable,
    InitiatorMoved,
    TargetMoved,
    TargetInferenceUnsupported,
    TargetTextReplyUnsupported,
    PairBlocked,
    TargetMuted,
}

impl ChatContinuationRejection {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::StaleSourceSequence => "stale_source_sequence",
            Self::InitiatorMissing => "initiator_missing",
            Self::TargetMissing => "target_missing",
            Self::InitiatorUnavailable => "initiator_unavailable",
            Self::TargetUnavailable => "target_unavailable",
            Self::InitiatorMoved => "initiator_moved",
            Self::TargetMoved => "target_moved",
            Self::TargetInferenceUnsupported => "target_inference_unsupported",
            Self::TargetTextReplyUnsupported => "target_text_reply_unsupported",
            Self::PairBlocked => "pair_blocked",
            Self::TargetMuted => "target_muted",
        }
    }

    pub(super) fn player_reason(self) -> &'static str {
        match self {
            Self::StaleSourceSequence => {
                "the conversation ended because its starting moment is no longer current"
            }
            Self::InitiatorMissing | Self::TargetMissing => {
                "the conversation ended because a participant is no longer present"
            }
            Self::InitiatorUnavailable | Self::TargetUnavailable => {
                "the conversation ended because a participant became unavailable"
            }
            Self::InitiatorMoved => "the conversation ended because you moved away",
            Self::TargetMoved => "the conversation ended because the other participant moved away",
            Self::TargetInferenceUnsupported | Self::TargetTextReplyUnsupported => {
                "the conversation ended because that resident can no longer reply here"
            }
            Self::PairBlocked | Self::TargetMuted => {
                "the conversation ended because its safety settings changed"
            }
        }
    }

    pub(super) fn from_code(code: &str) -> Option<Self> {
        Some(match code {
            "stale_source_sequence" => Self::StaleSourceSequence,
            "initiator_missing" => Self::InitiatorMissing,
            "target_missing" => Self::TargetMissing,
            "initiator_unavailable" => Self::InitiatorUnavailable,
            "target_unavailable" => Self::TargetUnavailable,
            "initiator_moved" => Self::InitiatorMoved,
            "target_moved" => Self::TargetMoved,
            "target_inference_unsupported" => Self::TargetInferenceUnsupported,
            "target_text_reply_unsupported" => Self::TargetTextReplyUnsupported,
            "pair_blocked" => Self::PairBlocked,
            "target_muted" => Self::TargetMuted,
            _ => return None,
        })
    }
}

pub(super) fn pending_chat_context_rejection(error: &str) -> Option<ChatContinuationRejection> {
    let code = error
        .strip_prefix(CHAT_TERMINAL_STATUS_PENDING_PREFIX)?
        .split(':')
        .next()?;
    ChatContinuationRejection::from_code(code)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AvatarOpeningCommitFailure {
    Storage(io::ErrorKind),
    Status(u32),
    Empty,
}

impl AvatarOpeningCommitFailure {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::Storage(_) => "storage_failure",
            Self::Status(CW_ERR_FULL) => "commit_full",
            Self::Status(CW_ERR_RULE) => "commit_rule",
            Self::Status(CW_ERR_INVALID) => "commit_invalid",
            Self::Status(CW_ERR_NOT_FOUND) => "commit_not_found",
            Self::Status(_) => "commit_status_unknown",
            Self::Empty => "commit_empty",
        }
    }

    pub(super) fn retryable(self) -> bool {
        matches!(self, Self::Storage(_) | Self::Status(CW_ERR_FULL))
    }

    pub(super) fn commit_status(self) -> Option<u32> {
        match self {
            Self::Status(status) => Some(status),
            Self::Storage(_) | Self::Empty => None,
        }
    }

    pub(super) fn error_kind(self) -> Option<io::ErrorKind> {
        match self {
            Self::Storage(kind) => Some(kind),
            Self::Status(_) | Self::Empty => None,
        }
    }
}

pub(super) enum AvatarOpeningPublication {
    Committed {
        content_id: u64,
        events: Vec<EventView>,
    },
    ContextRejected(ChatContinuationRejection),
    CommitFailed(AvatarOpeningCommitFailure),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ChatFloorPresentation {
    pub(super) schema_version: u8,
    pub(super) round: u8,
    pub(super) seat: usize,
    pub(super) seats: usize,
    pub(super) decision: String,
}

impl ChatFloorPresentation {
    pub(super) fn new(round: u8, seat: usize, seats: usize, decision: &str) -> Self {
        Self {
            schema_version: 1,
            round,
            seat,
            seats,
            decision: decision.to_string(),
        }
    }

    pub(super) fn content(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CommittedChatFloorDecision {
    pub(super) seq: u64,
    pub(super) speaker_actor_id: u64,
    pub(super) round: u8,
    pub(super) seat: usize,
    pub(super) decision: String,
}

impl RuntimeWorld {
    pub(super) fn room_chat_initiative_order(
        &self,
        location_id: u64,
        initiator_actor_id: u64,
    ) -> Vec<u64> {
        let location = location_id.to_string();
        let initiator = initiator_actor_id.to_string();
        let event_seed = self.world.next_event_seq.to_string();
        let mut initiative = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| {
                actor.id != initiator_actor_id
                    && actor.location_id == location_id
                    && Self::actor_can_act(*actor)
                    && self.actor_uses_inference(actor.id)
                    && resident_supports_text_reply(actor.id)
                    && !self.actors_blocked(initiator_actor_id, actor.id)
                    && !self.actor_muted(initiator_actor_id, actor.id)
            })
            .map(|actor| {
                let actor_id = actor.id.to_string();
                let roll = 1
                    + (stable_hash_u64(&[
                        "room-chat-initiative-v1",
                        &location,
                        &initiator,
                        &actor_id,
                        &event_seed,
                    ]) % 20) as i16;
                let score = roll.saturating_add(ability_score_modifier(actor.stats.dexterity));
                (actor.id, score)
            })
            .collect::<Vec<_>>();
        initiative.sort_by(|(left_id, left_score), (right_id, right_score)| {
            right_score
                .cmp(left_score)
                .then_with(|| left_id.cmp(right_id))
        });
        initiative
            .into_iter()
            .map(|(actor_id, _)| actor_id)
            .collect()
    }
}

pub(super) fn orb_chat_attempt_stage(stage: &str, attempt: u32) -> String {
    format!("{stage}:attempt:{}", attempt.max(1))
}

pub(super) fn chat_continuation_rejection(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
) -> Option<ChatContinuationRejection> {
    chat_continuation_rejection_with(
        runtime,
        actor_id,
        target_actor_id,
        location_id,
        resident_supports_text_reply,
    )
}

fn chat_continuation_rejection_with(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
    supports_text_reply: impl Fn(u64) -> bool,
) -> Option<ChatContinuationRejection> {
    let Some(actor) = runtime.actor_by_id(actor_id) else {
        return Some(ChatContinuationRejection::InitiatorMissing);
    };
    let Some(target) = runtime.actor_by_id(target_actor_id) else {
        return Some(ChatContinuationRejection::TargetMissing);
    };
    if !RuntimeWorld::actor_can_act(actor) {
        return Some(ChatContinuationRejection::InitiatorUnavailable);
    }
    if !RuntimeWorld::actor_can_act(target) {
        return Some(ChatContinuationRejection::TargetUnavailable);
    }
    if actor.location_id != location_id {
        return Some(ChatContinuationRejection::InitiatorMoved);
    }
    if target.location_id != location_id {
        return Some(ChatContinuationRejection::TargetMoved);
    }
    if !runtime.actor_uses_inference(target_actor_id) {
        return Some(ChatContinuationRejection::TargetInferenceUnsupported);
    }
    if !supports_text_reply(target_actor_id) {
        return Some(ChatContinuationRejection::TargetTextReplyUnsupported);
    }
    if runtime.actors_blocked(actor_id, target_actor_id) {
        return Some(ChatContinuationRejection::PairBlocked);
    }
    if runtime.actor_muted(actor_id, target_actor_id) {
        return Some(ChatContinuationRejection::TargetMuted);
    }
    None
}

#[allow(clippy::too_many_arguments)]
pub(super) fn durable_chat_source_rejection(
    state: &AppState,
    actor_job: Option<&ActorJob>,
    actor_id: u64,
    target_actor_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    location_id: u64,
) -> io::Result<Option<ChatContinuationRejection>> {
    let Some(actor_job) = actor_job else {
        return Ok(None);
    };
    let row_matches_payload = actor_job.kind == ACTOR_JOB_KIND_ORB_CHAT
        && actor_job.actor_id == actor_id
        && actor_job.cause_event_seq == queue_event_id
        && source_world_tick == Some(actor_job.source_tick)
        && observed_through_seq == Some(actor_job.observed_through_seq)
        && actor_job.location_id == Some(location_id)
        && queue_event_id == observed_through_seq;
    let (Some(path), Some(queue_event_id)) = (state.event_store_path.as_deref(), queue_event_id)
    else {
        return Ok(Some(ChatContinuationRejection::StaleSourceSequence));
    };
    if !row_matches_payload {
        return Ok(Some(ChatContinuationRejection::StaleSourceSequence));
    }
    let source_event = read_event_store_event(path, queue_event_id)?;
    let source_is_current = source_event.is_some_and(|event| {
        event.seq == queue_event_id
            && event.type_name == "chat.queued"
            && event.success
            && event.actor_id == Some(actor_id)
            && event.target_actor_id == Some(target_actor_id)
            && event.location_id == Some(location_id)
    });
    Ok((!source_is_current).then_some(ChatContinuationRejection::StaleSourceSequence))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn log_avatar_opening_rejection(
    actor_job: Option<&ActorJob>,
    attempt: u32,
    actor_id: u64,
    target_actor_id: u64,
    source_event_id: Option<u64>,
    location_id: u64,
    failure_stage: &str,
    rejection_reason: &str,
    retry_decision: &str,
    commit_status: Option<u32>,
    commit_error_kind: Option<io::ErrorKind>,
) {
    let commit_status = commit_status
        .map(|status| status.to_string())
        .unwrap_or_default();
    let commit_error_kind = commit_error_kind
        .map(|kind| format!("{kind:?}").to_ascii_lowercase())
        .unwrap_or_default();
    warn!(
        event = "avatar_opening_publication_rejected",
        actor_job_id = actor_job.map(|job| job.id).unwrap_or_default(),
        actor_attempt = attempt,
        actor_id,
        target_actor_id,
        source_event_id = source_event_id.unwrap_or_default(),
        location_id,
        failure_stage,
        rejection_reason,
        retry_decision,
        commit_status,
        commit_error_kind,
        "avatar opening was not published"
    );
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn commit_chat_status_result(
    state: &AppState,
    actor_id: u64,
    target_actor_id: u64,
    status: &str,
    reason: &str,
    caused_by_event_seq: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    source_location_id: Option<u64>,
) -> io::Result<(u32, Vec<EventView>)> {
    let mut runtime = state.inner.lock().await;
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.caused_by_event_seq = caused_by_event_seq;
    record.source_world_tick = source_world_tick;
    record.observed_through_seq = observed_through_seq;
    record.source_location_id = source_location_id;
    record
        .projection_mutations
        .push(ProjectionMutation::ChatStatus {
            target_actor_id,
            status: status.to_string(),
            reason: reason.to_string(),
        });
    let (commit_status, events) = commit_journal_record(state, &mut runtime, record)?;
    drop(runtime);
    if commit_status == CW_OK {
        broadcast_events(state, &events);
    }
    Ok((commit_status, events))
}

pub(super) async fn commit_chat_status(
    state: &AppState,
    actor_id: u64,
    target_actor_id: u64,
    status: &str,
    reason: &str,
    caused_by_event_seq: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    source_location_id: Option<u64>,
) -> Vec<EventView> {
    match commit_chat_status_result(
        state,
        actor_id,
        target_actor_id,
        status,
        reason,
        caused_by_event_seq,
        source_world_tick,
        observed_through_seq,
        source_location_id,
    )
    .await
    {
        Ok((CW_OK, events)) => events,
        Ok(_) | Err(_) => Vec::new(),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn complete_chat_after_context_rejection(
    state: &AppState,
    actor_job: Option<&ActorJob>,
    attempt: u32,
    actor_id: u64,
    target_actor_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    source_location_id: u64,
    failure_stage: &str,
    rejection: ChatContinuationRejection,
) -> Result<(), String> {
    let completed_already = {
        let runtime = state.inner.lock().await;
        orb_chat_status_already_committed(
            &runtime,
            actor_id,
            target_actor_id,
            "completed",
            source_location_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
        )
    };
    if completed_already {
        return Ok(());
    }

    log_avatar_opening_rejection(
        actor_job,
        attempt,
        actor_id,
        target_actor_id,
        queue_event_id,
        source_location_id,
        failure_stage,
        rejection.code(),
        "terminal",
        None,
        None,
    );
    let status_retrying = state.event_store_path.is_some() && attempt < ACTOR_JOB_MAX_ATTEMPTS;
    match commit_chat_status_result(
        state,
        actor_id,
        target_actor_id,
        "completed",
        rejection.player_reason(),
        queue_event_id,
        source_world_tick,
        observed_through_seq,
        Some(source_location_id),
    )
    .await
    {
        Ok((CW_OK, events)) if !events.is_empty() => Ok(()),
        Ok((status, _)) => {
            log_avatar_opening_rejection(
                actor_job,
                attempt,
                actor_id,
                target_actor_id,
                queue_event_id,
                source_location_id,
                "terminal_status_commit",
                "terminal_status_commit_rejected",
                if status_retrying { "retry" } else { "terminal" },
                Some(status),
                None,
            );
            Err(format!(
                "{CHAT_TERMINAL_STATUS_PENDING_PREFIX}{}:commit_status_{status}",
                rejection.code(),
            ))
        }
        Err(error) => {
            log_avatar_opening_rejection(
                actor_job,
                attempt,
                actor_id,
                target_actor_id,
                queue_event_id,
                source_location_id,
                "terminal_status_commit",
                "storage_failure",
                if status_retrying { "retry" } else { "terminal" },
                None,
                Some(error.kind()),
            );
            Err(format!(
                "{CHAT_TERMINAL_STATUS_PENDING_PREFIX}{}:storage_{:?}",
                rejection.code(),
                error.kind()
            ))
        }
    }
}

pub(super) async fn announce_chat_typing(
    state: &AppState,
    speaker_actor_id: u64,
    listener_actor_id: u64,
    caused_by_event_seq: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    source_location_id: Option<u64>,
) {
    let _ = commit_chat_status(
        state,
        speaker_actor_id,
        listener_actor_id,
        "typing",
        "the next line is being composed",
        caused_by_event_seq,
        source_world_tick,
        observed_through_seq,
        source_location_id,
    )
    .await;
}

async fn complete_queued_orb_chat(
    state: &AppState,
    actor_id: u64,
    target_actor_id: u64,
    plan: AvatarChatPlan,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
) -> Result<(), String> {
    complete_queued_orb_chat_attempt(
        state,
        actor_id,
        target_actor_id,
        plan,
        queue_event_id,
        source_world_tick,
        observed_through_seq,
        None,
        1,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn complete_queued_orb_chat_attempt(
    state: &AppState,
    actor_id: u64,
    target_actor_id: u64,
    plan: AvatarChatPlan,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    actor_job: Option<&ActorJob>,
    attempt: u32,
) -> Result<(), String> {
    let mut plan = plan.with_publication_beat(
        &orb_chat_attempt_stage("avatar-chat", attempt),
        queue_event_id,
        source_world_tick,
    );
    if plan.initiative_order.is_empty() {
        plan.initiative_order.push(target_actor_id);
    }
    let will_retry = state.event_store_path.is_some() && attempt < ACTOR_JOB_MAX_ATTEMPTS;
    let started_at = Instant::now();
    let usage_config = state.ai_config.as_ref().clone();
    let terminal_status_already_committed = {
        let runtime = state.inner.lock().await;
        orb_chat_terminal_status_already_committed(
            &runtime,
            actor_id,
            target_actor_id,
            plan.location_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
        )
    };
    if terminal_status_already_committed {
        return Ok(());
    }
    if let Some(rejection) = actor_job
        .and_then(|job| job.last_error.as_deref())
        .and_then(pending_chat_context_rejection)
    {
        return complete_chat_after_context_rejection(
            state,
            actor_job,
            attempt,
            actor_id,
            target_actor_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
            plan.location_id,
            "terminal_status_retry",
            rejection,
        )
        .await;
    }
    let committed_lines = {
        let runtime = state.inner.lock().await;
        committed_orb_chat_lines(
            &runtime,
            actor_id,
            target_actor_id,
            plan.location_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
            &plan.initiative_order,
        )?
    };
    if committed_lines.is_empty() {
        match durable_chat_source_rejection(
            state,
            actor_job,
            actor_id,
            target_actor_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
            plan.location_id,
        ) {
            Ok(Some(rejection)) => {
                return complete_chat_after_context_rejection(
                    state,
                    actor_job,
                    attempt,
                    actor_id,
                    target_actor_id,
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    plan.location_id,
                    "source_validation",
                    rejection,
                )
                .await;
            }
            Ok(None) => {}
            Err(error) => {
                log_avatar_opening_rejection(
                    actor_job,
                    attempt,
                    actor_id,
                    target_actor_id,
                    queue_event_id,
                    plan.location_id,
                    "source_validation",
                    "storage_failure",
                    if will_retry { "retry" } else { "terminal" },
                    None,
                    Some(error.kind()),
                );
                let _ = commit_chat_status_result(
                    state,
                    actor_id,
                    target_actor_id,
                    if will_retry { "retrying" } else { "failed" },
                    if will_retry {
                        "the conversation could not be checked safely; retrying"
                    } else {
                        "the conversation could not be checked safely; try talking again"
                    },
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    Some(plan.location_id),
                )
                .await;
                return Err(format!(
                    "avatar opening source validation failed ({:?})",
                    error.kind()
                ));
            }
        }
        let context_rejection = {
            let runtime = state.inner.lock().await;
            chat_continuation_rejection(&runtime, actor_id, target_actor_id, plan.location_id)
        };
        if let Some(rejection) = context_rejection {
            return complete_chat_after_context_rejection(
                state,
                actor_job,
                attempt,
                actor_id,
                target_actor_id,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                plan.location_id,
                "pre_inference",
                rejection,
            )
            .await;
        }
        announce_chat_typing(
            state,
            actor_id,
            target_actor_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
            Some(plan.location_id),
        )
        .await;
        if state.avatar_chat_delay > Duration::ZERO {
            tokio::time::sleep(state.avatar_chat_delay).await;
        }
        let certified = match avatar_chat_text(state, &plan).await {
            Ok(content) => content,
            Err(error) => {
                let config = state.ai_config.as_ref().as_ref();
                let will_retry = will_retry
                    && !chat_target_route_is_permanently_unavailable(config, target_actor_id);
                warn!("queued AI avatar inference failed: {}", error);
                log_avatar_opening_rejection(
                    actor_job,
                    attempt,
                    actor_id,
                    target_actor_id,
                    queue_event_id,
                    plan.location_id,
                    "inference",
                    error.code(),
                    if will_retry { "retry" } else { "terminal" },
                    None,
                    None,
                );
                record_rejected_ai_publication(state, &error);
                commit_chat_status(
                    state,
                    actor_id,
                    target_actor_id,
                    if will_retry { "retrying" } else { "failed" },
                    if will_retry {
                        "the reply got lost; retrying the conversation"
                    } else {
                        "the reply got lost; try talking again"
                    },
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    Some(plan.location_id),
                )
                .await;
                record_ai_usage(
                    state,
                    Some(actor_id),
                    "avatar_chat",
                    "cosyworld_system",
                    usage_config.as_ref(),
                    "failed",
                    queue_event_id,
                    0,
                    Some(error.code()),
                    started_at.elapsed(),
                );
                return Err(error.to_string());
            }
        };
        let (content, publication_receipt) = into_recorded_speech_parts(state, certified);
        let publication = {
            let mut runtime = state.inner.lock().await;
            if let Some(rejection) =
                chat_continuation_rejection(&runtime, actor_id, target_actor_id, plan.location_id)
            {
                AvatarOpeningPublication::ContextRejected(rejection)
            } else {
                let content_id = runtime.next_content_id_value();
                let mut record = JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_SAY,
                        actor_id,
                        content_id,
                        ..CwAction::default()
                    },
                    runtime.next_seed_value(),
                );
                record.caused_by_event_seq = queue_event_id;
                record.source_world_tick = source_world_tick;
                record.observed_through_seq = observed_through_seq;
                record.source_location_id = Some(plan.location_id);
                record.content_upserts.insert(content_id, content.clone());
                record.ai_publication = Some(publication_receipt);
                match commit_journal_record(state, &mut runtime, record) {
                    Ok((CW_OK, events)) if !events.is_empty() => {
                        AvatarOpeningPublication::Committed { content_id, events }
                    }
                    Ok((CW_OK, _)) => {
                        AvatarOpeningPublication::CommitFailed(AvatarOpeningCommitFailure::Empty)
                    }
                    Ok((status, _)) => AvatarOpeningPublication::CommitFailed(
                        AvatarOpeningCommitFailure::Status(status),
                    ),
                    Err(error) => AvatarOpeningPublication::CommitFailed(
                        AvatarOpeningCommitFailure::Storage(error.kind()),
                    ),
                }
            }
        };

        let (content_id, events) = match publication {
            AvatarOpeningPublication::Committed { content_id, events } => (content_id, events),
            AvatarOpeningPublication::ContextRejected(rejection) => {
                record_ai_usage(
                    state,
                    Some(actor_id),
                    "avatar_chat",
                    "cosyworld_system",
                    usage_config.as_ref(),
                    "failed",
                    queue_event_id,
                    0,
                    Some(rejection.code()),
                    started_at.elapsed(),
                );
                return complete_chat_after_context_rejection(
                    state,
                    actor_job,
                    attempt,
                    actor_id,
                    target_actor_id,
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    plan.location_id,
                    "post_inference",
                    rejection,
                )
                .await;
            }
            AvatarOpeningPublication::CommitFailed(failure) => {
                let retrying = failure.retryable() && will_retry;
                log_avatar_opening_rejection(
                    actor_job,
                    attempt,
                    actor_id,
                    target_actor_id,
                    queue_event_id,
                    plan.location_id,
                    "opening_commit",
                    failure.code(),
                    if retrying { "retry" } else { "terminal" },
                    failure.commit_status(),
                    failure.error_kind(),
                );
                let status_commit = commit_chat_status_result(
                    state,
                    actor_id,
                    target_actor_id,
                    if retrying { "retrying" } else { "failed" },
                    if retrying {
                        "the conversation could not be saved; retrying from its last committed line"
                    } else {
                        "the conversation could not be published safely; try talking again"
                    },
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    Some(plan.location_id),
                )
                .await;
                let status_persisted =
                    matches!(&status_commit, Ok((CW_OK, events)) if !events.is_empty());
                match &status_commit {
                    Ok((CW_OK, events)) if !events.is_empty() => {}
                    Ok((status, _)) => log_avatar_opening_rejection(
                        actor_job,
                        attempt,
                        actor_id,
                        target_actor_id,
                        queue_event_id,
                        plan.location_id,
                        "failure_status_commit",
                        "failure_status_commit_rejected",
                        if will_retry { "retry" } else { "terminal" },
                        Some(*status),
                        None,
                    ),
                    Err(error) => log_avatar_opening_rejection(
                        actor_job,
                        attempt,
                        actor_id,
                        target_actor_id,
                        queue_event_id,
                        plan.location_id,
                        "failure_status_commit",
                        "storage_failure",
                        if will_retry { "retry" } else { "terminal" },
                        None,
                        Some(error.kind()),
                    ),
                }
                record_ai_usage(
                    state,
                    Some(actor_id),
                    "avatar_chat",
                    "cosyworld_system",
                    usage_config.as_ref(),
                    "failed",
                    queue_event_id,
                    0,
                    Some(failure.code()),
                    started_at.elapsed(),
                );
                if failure.retryable() || !status_persisted {
                    return Err(format!(
                        "avatar opening publication failed: {}",
                        failure.code()
                    ));
                }
                return Ok(());
            }
        };
        broadcast_events(state, &events);
        record_ai_usage(
            state,
            Some(actor_id),
            "avatar_chat",
            "cosyworld_system",
            usage_config.as_ref(),
            "ok",
            queue_event_id.or_else(|| source_event_id_for_chat(&events, actor_id, content_id)),
            0,
            None,
            started_at.elapsed(),
        );
    }
    let exchange_result = complete_orb_chat_exchange(
        state,
        actor_id,
        target_actor_id,
        plan.clone(),
        queue_event_id,
        source_world_tick,
        observed_through_seq,
        attempt,
    )
    .await;
    if let Err(error) = exchange_result {
        if let Some(rejection) = error
            .strip_prefix("chat_context_changed:")
            .and_then(ChatContinuationRejection::from_code)
        {
            complete_chat_after_context_rejection(
                state,
                actor_job,
                attempt,
                actor_id,
                target_actor_id,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                plan.location_id,
                "exchange_publication",
                rejection,
            )
            .await?;
            return Ok(());
        }
        let config = state.ai_config.as_ref().as_ref();
        let will_retry =
            will_retry && !chat_target_route_is_permanently_unavailable(config, target_actor_id);
        warn!("bounded avatar chat ended early: {}", error);
        commit_chat_status(
            state,
            actor_id,
            target_actor_id,
            if will_retry { "retrying" } else { "failed" },
            if will_retry {
                "the conversation ended early; retrying from its last line"
            } else {
                "the conversation ended early; try talking again"
            },
            queue_event_id,
            source_world_tick,
            observed_through_seq,
            Some(plan.location_id),
        )
        .await;
        return Err(error);
    }
    let completed_already = {
        let runtime = state.inner.lock().await;
        orb_chat_status_already_committed(
            &runtime,
            actor_id,
            target_actor_id,
            "completed",
            plan.location_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
        )
    };
    if completed_already {
        return Ok(());
    }
    let completed_events = commit_completed_chat(
        state,
        actor_id,
        target_actor_id,
        queue_event_id,
        source_world_tick,
        observed_through_seq,
        plan.location_id,
    )
    .await;
    if completed_events.is_empty() {
        return Err("the completed conversation status could not be committed".to_string());
    }
    Ok(())
}

fn orb_chat_event_matches_job(
    event: &EventView,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    location_id: u64,
) -> bool {
    let cause_matches = match queue_event_id {
        Some(queue_event_id) => event.caused_by_event_seq == Some(queue_event_id),
        None => {
            event.caused_by_event_seq.is_none()
                && event.seq > observed_through_seq.unwrap_or_default()
        }
    };
    cause_matches
        && source_world_tick.is_none_or(|tick| event.source_world_tick == Some(tick))
        && event.source_location_id == Some(location_id)
}

pub(super) fn committed_orb_chat_lines(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    initiative_order: &[u64],
) -> Result<Vec<CommittedOrbChatLine>, String> {
    let allowed_speakers = std::iter::once(actor_id)
        .chain(std::iter::once(target_actor_id))
        .chain(initiative_order.iter().copied())
        .collect::<BTreeSet<_>>();
    let mut lines = runtime
        .event_log
        .iter()
        .filter(|event| {
            event.type_name == "message.created"
                && event.success
                && event
                    .actor_id
                    .is_some_and(|speaker_actor_id| allowed_speakers.contains(&speaker_actor_id))
                && orb_chat_event_matches_job(
                    event,
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    location_id,
                )
        })
        .filter_map(|event| {
            Some(CommittedOrbChatLine {
                seq: event.seq,
                speaker_actor_id: event.actor_id?,
                content: event.content.clone()?,
            })
        })
        .collect::<Vec<_>>();
    lines.sort_by_key(|line| line.seq);
    let max_lines = 2usize.saturating_add(
        initiative_order
            .len()
            .saturating_mul(usize::from(MAX_CHAT_FLOOR_ROUNDS)),
    );
    if lines.len() > max_lines
        || lines
            .first()
            .is_some_and(|line| line.speaker_actor_id != actor_id)
        || lines
            .get(1)
            .is_some_and(|line| line.speaker_actor_id != target_actor_id)
        || lines
            .iter()
            .skip(2)
            .any(|line| !initiative_order.contains(&line.speaker_actor_id))
    {
        return Err("the durable Chat transcript has an invalid turn sequence".to_string());
    }
    Ok(lines)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn committed_chat_floor_decisions(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    initiative_order: &[u64],
) -> Result<Vec<CommittedChatFloorDecision>, String> {
    let mut decisions = runtime
        .event_log
        .iter()
        .filter(|event| {
            matches!(event.type_name.as_str(), "chat.spoke" | "chat.passed")
                && event.success
                && orb_chat_event_matches_job(
                    event,
                    queue_event_id,
                    source_world_tick,
                    observed_through_seq,
                    location_id,
                )
        })
        .map(|event| {
            let presentation = event
                .content
                .as_deref()
                .and_then(|content| serde_json::from_str::<ChatFloorPresentation>(content).ok())
                .filter(|presentation| presentation.schema_version == 1)
                .ok_or_else(|| {
                    "the durable Chat floor has an invalid decision marker".to_string()
                })?;
            if presentation.round == 0
                || presentation.round > MAX_CHAT_FLOOR_ROUNDS
                || presentation.seats != initiative_order.len()
                || presentation.seat >= initiative_order.len()
                || initiative_order[presentation.seat] != event.actor_id.unwrap_or_default()
            {
                return Err("the durable Chat floor has an invalid initiative seat".to_string());
            }
            let decision = match event.type_name.as_str() {
                "chat.spoke" if presentation.decision == "chat" => "chat",
                "chat.passed" if presentation.decision == "pass" => "pass",
                _ => {
                    return Err(
                        "the durable Chat floor marker disagrees with its decision".to_string()
                    )
                }
            };
            Ok(CommittedChatFloorDecision {
                seq: event.seq,
                speaker_actor_id: event.actor_id.unwrap_or_default(),
                round: presentation.round,
                seat: presentation.seat,
                decision: decision.to_string(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    decisions.sort_by_key(|decision| (decision.round, decision.seat, decision.seq));
    if decisions
        .windows(2)
        .any(|pair| pair[0].round == pair[1].round && pair[0].seat == pair[1].seat)
    {
        return Err("the durable Chat floor has duplicate initiative decisions".to_string());
    }
    if initiative_order.contains(&actor_id) || !initiative_order.contains(&target_actor_id) {
        return Err("the durable Chat floor has an invalid participant order".to_string());
    }
    Ok(decisions)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn orb_chat_status_already_committed(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    status: &str,
    location_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
) -> bool {
    let event_type = format!("chat.{status}");
    runtime.event_log.iter().any(|event| {
        event.type_name == event_type
            && event.success
            && event.actor_id == Some(actor_id)
            && event.target_actor_id == Some(target_actor_id)
            && orb_chat_event_matches_job(
                event,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                location_id,
            )
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn orb_chat_terminal_status_already_committed(
    runtime: &RuntimeWorld,
    actor_id: u64,
    target_actor_id: u64,
    location_id: u64,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
) -> bool {
    runtime.event_log.iter().any(|event| {
        matches!(event.type_name.as_str(), "chat.completed" | "chat.failed")
            && event.actor_id == Some(actor_id)
            && event.target_actor_id == Some(target_actor_id)
            && orb_chat_event_matches_job(
                event,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                location_id,
            )
    })
}

pub(super) async fn chat(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "chat-actor",
        CHAT_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }

    let chat_lock = chat_action_lock(&state, payload.actor_id);
    let _chat_guard = chat_lock.lock().await;
    {
        let runtime = state.inner.lock().await;
        if !client_actor_authorized_for_state(
            &runtime,
            &state,
            payload.actor_id,
            payload.actor_session.as_deref(),
        ) {
            return client_actor_rejected_response();
        }
    }
    if !chat_target_route_is_configured(state.ai_config.as_ref().as_ref(), payload.target_actor_id)
    {
        return Json(ActionResponse {
            ok: false,
            status: 503,
            events: vec![EventView {
                type_name: "chat.failed".to_string(),
                actor_id: Some(payload.actor_id),
                target_actor_id: Some(payload.target_actor_id),
                content: Some(
                    "That model route is resting right now. Choose another action; nothing was spent."
                        .to_string(),
                ),
                ..EventView::default()
            }],
        });
    }
    if let Some(path) = state.event_store_path.as_deref() {
        match active_orb_chat_target(path, payload.actor_id) {
            Ok(Some(active_target_actor_id))
                if active_target_actor_id == payload.target_actor_id =>
            {
                return Json(ActionResponse {
                    ok: true,
                    status: CW_OK,
                    events: Vec::new(),
                });
            }
            Ok(Some(_)) => {
                return Json(ActionResponse {
                    ok: false,
                    status: 409,
                    events: vec![EventView {
                        type_name: "chat.failed".to_string(),
                        actor_id: Some(payload.actor_id),
                        target_actor_id: Some(payload.target_actor_id),
                        content: Some(
                            "Let the current conversation settle before starting another."
                                .to_string(),
                        ),
                        ..EventView::default()
                    }],
                });
            }
            Ok(None) => {}
            Err(error) => {
                warn!("could not inspect the durable Chat queue: {error}");
                return Json(ActionResponse {
                    ok: false,
                    status: 503,
                    events: vec![EventView {
                        type_name: "chat.failed".to_string(),
                        actor_id: Some(payload.actor_id),
                        target_actor_id: Some(payload.target_actor_id),
                        content: Some(
                            "The conversation could not start safely; try again.".to_string(),
                        ),
                        ..EventView::default()
                    }],
                });
            }
        }
    }

    let mut runtime = state.inner.lock().await;
    let active_direct_actor_ids = active_actor_ids_for_state(&state);
    let actor_location_id = runtime
        .actor_by_id(payload.actor_id)
        .map(|actor| actor.location_id)
        .unwrap_or_default();
    let turn = room_turn_view_for_runtime(
        &state,
        &runtime,
        actor_location_id,
        Some(payload.actor_id),
        &active_direct_actor_ids,
    );
    if turn.enabled && !turn.is_current_actor {
        return Json(ActionResponse {
            ok: false,
            status: 423,
            events: vec![EventView {
                type_name: "room.turn.waiting".to_string(),
                success: false,
                actor_id: turn.current_actor_id,
                actor_name: turn.current_actor_name,
                location_id: Some(turn.room_id),
                content: turn.explanation,
                ..EventView::default()
            }],
        });
    }
    let target_is_available = runtime.actor_uses_inference(payload.target_actor_id)
        && resident_supports_text_reply(payload.target_actor_id)
        && !runtime.actors_blocked(payload.actor_id, payload.target_actor_id)
        && !runtime.actor_muted(payload.actor_id, payload.target_actor_id);
    let Some(plan) = target_is_available
        .then(|| runtime.avatar_chat_plan_for(payload.actor_id, payload.target_actor_id))
        .flatten()
    else {
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: vec![EventView {
                type_name: "chat.failed".to_string(),
                actor_id: Some(payload.actor_id),
                target_actor_id: Some(payload.target_actor_id),
                content: Some("That conversation is no longer within reach.".to_string()),
                ..EventView::default()
            }],
        });
    };

    let source_world_tick = runtime.world.tick;
    let observed_through_seq = runtime.world.next_event_seq.saturating_sub(1);
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: payload.actor_id,
            target_actor_id: payload.target_actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_player_card();
    record.offer_kind = Some("chat".to_string());
    record
        .projection_mutations
        .push(ProjectionMutation::ChatStatus {
            target_actor_id: payload.target_actor_id,
            status: "queued".to_string(),
            reason: "the conversation is unfolding".to_string(),
        });
    record.queued_actor_job = Some(ActorJobPayload::OrbChat(Box::new(OrbChatJob {
        actor_id: payload.actor_id,
        target_actor_id: payload.target_actor_id,
        plan: plan.clone(),
        queue_event_id: None,
        source_world_tick: None,
        observed_through_seq: None,
    })));
    let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: vec![EventView {
                type_name: "chat.failed".to_string(),
                actor_id: Some(payload.actor_id),
                target_actor_id: Some(payload.target_actor_id),
                content: Some("The conversation could not be saved; try again.".to_string()),
                ..EventView::default()
            }],
        });
    };
    drop(runtime);

    broadcast_events(&state, &events);
    if status == CW_OK {
        let queue_event_id = events
            .iter()
            .find(|event| event.type_name == "chat.queued" && event.success)
            .map(|event| event.seq);
        if state.event_store_path.is_some() {
            state.actor_job_notify.notify_waiters();
        } else {
            let chat_state = state.clone();
            tokio::spawn(async move {
                if let Err(error) = complete_queued_orb_chat(
                    &chat_state,
                    payload.actor_id,
                    payload.target_actor_id,
                    plan,
                    queue_event_id,
                    Some(source_world_tick),
                    Some(observed_through_seq),
                )
                .await
                {
                    warn!("in-memory Chat job failed: {error}");
                }
            });
        }
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events,
    })
}

pub(super) async fn commit_completed_chat(
    state: &AppState,
    actor_id: u64,
    target_actor_id: u64,
    caused_by_event_seq: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    source_location_id: u64,
) -> Vec<EventView> {
    let mut runtime = state.inner.lock().await;
    let source_event_seq = runtime.world.next_event_seq;
    let target_name = runtime
        .actor_name(target_actor_id)
        .unwrap_or_else(|| "a neighbour".to_string());
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.caused_by_event_seq = caused_by_event_seq;
    record.source_world_tick = source_world_tick;
    record.observed_through_seq = observed_through_seq;
    record.source_location_id = Some(source_location_id);
    record
        .projection_mutations
        .push(ProjectionMutation::ChatStatus {
            target_actor_id,
            status: "completed".to_string(),
            reason: "the conversation settled".to_string(),
        });
    record
        .projection_mutations
        .push(ProjectionMutation::MarkVisitLedger(
            projection_ledger::MarkVisitLedger {
                category: "witness".to_string(),
                label: format!("shared a little chat with {target_name}."),
                source_event_seq,
                reason: format!("chat:{actor_id}:{target_actor_id}"),
            },
        ));
    let Ok((status, events)) = commit_journal_record(state, &mut runtime, record) else {
        return Vec::new();
    };
    drop(runtime);
    if status == CW_OK {
        broadcast_events(state, &events);
        events
    } else {
        Vec::new()
    }
}

#[allow(clippy::too_many_arguments)]
async fn commit_chat_floor_pass(
    state: &AppState,
    speaker_actor_id: u64,
    initiator_actor_id: u64,
    marker: &ChatFloorPresentation,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    location_id: u64,
) -> Result<(), String> {
    let events = commit_chat_status(
        state,
        speaker_actor_id,
        initiator_actor_id,
        "passed",
        &marker.content(),
        queue_event_id,
        source_world_tick,
        observed_through_seq,
        Some(location_id),
    )
    .await;
    (!events.is_empty())
        .then_some(())
        .ok_or_else(|| "the Chat floor pass could not be committed".to_string())
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn complete_orb_chat_exchange(
    state: &AppState,
    actor_id: u64,
    target_actor_id: u64,
    chat_plan: AvatarChatPlan,
    queue_event_id: Option<u64>,
    source_world_tick: Option<u64>,
    observed_through_seq: Option<u64>,
    attempt: u32,
) -> Result<(), String> {
    let initiative_order = if chat_plan.initiative_order.is_empty() {
        vec![target_actor_id]
    } else {
        chat_plan.initiative_order.clone()
    };
    let load_lines = || async {
        let runtime = state.inner.lock().await;
        committed_orb_chat_lines(
            &runtime,
            actor_id,
            target_actor_id,
            chat_plan.location_id,
            queue_event_id,
            source_world_tick,
            observed_through_seq,
            &initiative_order,
        )
    };
    let mut lines = load_lines().await?;
    if lines.is_empty() {
        return Err("the committed Chat opening could not be recovered".to_string());
    }

    if lines.len() == 1 {
        let opening = lines[0].clone();
        let first_reply_plan = {
            let runtime = state.inner.lock().await;
            if let Some(rejection) = chat_continuation_rejection(
                &runtime,
                actor_id,
                target_actor_id,
                chat_plan.location_id,
            ) {
                return Err(format!("chat_context_changed:{}", rejection.code()));
            }
            let reply_plan = runtime
                .resident_reply_plan_for_target(actor_id, target_actor_id, &opening.content)
                .map(|mut reply_plan| {
                    if let Some(turn) = reply_plan.incoming_turn.as_mut() {
                        turn.source_event_seq = Some(opening.seq);
                    }
                    reply_plan.with_publication_causality(
                        &orb_chat_attempt_stage("avatar-chat-reply", attempt),
                        queue_event_id,
                        source_world_tick,
                        Some(observed_through_seq.unwrap_or_default().max(opening.seq)),
                        Some(chat_plan.location_id),
                    )
                });
            reply_plan.map(|plan| runtime.prepare_card_policy_objective_plan(plan))
        }
        .ok_or_else(|| "the target could not answer the opening line".to_string())?;
        announce_chat_typing(
            state,
            target_actor_id,
            actor_id,
            first_reply_plan.caused_by_event_seq,
            first_reply_plan.source_world_tick,
            first_reply_plan.observed_through_seq,
            first_reply_plan.source_location_id,
        )
        .await;
        let first_proposal = avatar_reply_intent(state, &first_reply_plan)
            .await
            .map_err(|error| {
                record_rejected_ai_publication(state, &error);
                error.to_string()
            })?;
        let first_reply_events = {
            let mut runtime = state.inner.lock().await;
            if let Some(rejection) = chat_continuation_rejection(
                &runtime,
                actor_id,
                target_actor_id,
                chat_plan.location_id,
            ) {
                return Err(format!("chat_context_changed:{}", rejection.code()));
            }
            commit_resident_reply_record(
                state,
                &mut runtime,
                &first_reply_plan,
                first_proposal,
                None,
                None,
            )
        }
        .ok_or_else(|| "resident_reply_commit_rejected".to_string())?;
        broadcast_events(state, &first_reply_events);
        lines = load_lines().await?;
    }
    if lines.len() < 2 {
        return Err("the opening back-and-forth did not finish".to_string());
    }

    for round in 1..=MAX_CHAT_FLOOR_ROUNDS {
        let mut decisions = {
            let runtime = state.inner.lock().await;
            committed_chat_floor_decisions(
                &runtime,
                actor_id,
                target_actor_id,
                chat_plan.location_id,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                &initiative_order,
            )?
            .into_iter()
            .filter(|decision| decision.round == round)
            .collect::<Vec<_>>()
        };
        decisions.sort_by_key(|decision| decision.seat);
        if decisions
            .iter()
            .enumerate()
            .any(|(seat, decision)| decision.seat != seat)
        {
            return Err("the durable Chat floor skipped an initiative seat".to_string());
        }
        if decisions.len() == initiative_order.len() {
            if decisions.iter().all(|decision| decision.decision == "pass") {
                return Ok(());
            }
            continue;
        }
        if decisions.is_empty() {
            let marker = ChatFloorPresentation::new(round, 0, initiative_order.len(), "round");
            let _ = commit_chat_status(
                state,
                actor_id,
                target_actor_id,
                "round",
                &marker.content(),
                queue_event_id,
                source_world_tick,
                lines.last().map(|line| line.seq),
                Some(chat_plan.location_id),
            )
            .await;
        }

        for seat in decisions.len()..initiative_order.len() {
            let speaker_actor_id = initiative_order[seat];
            let marker_for = |decision: &str| {
                ChatFloorPresentation::new(round, seat, initiative_order.len(), decision)
            };
            let (speaker_name, available_targets, source_line) = {
                let runtime = state.inner.lock().await;
                let speaker_name = runtime
                    .actor_by_id(speaker_actor_id)
                    .filter(|speaker| {
                        RuntimeWorld::actor_can_act(*speaker)
                            && speaker.location_id == chat_plan.location_id
                            && runtime.actor_uses_inference(speaker.id)
                            && resident_supports_text_reply(speaker.id)
                    })
                    .map(|_| {
                        runtime
                            .actor_name(speaker_actor_id)
                            .unwrap_or_else(|| format!("Avatar {speaker_actor_id}"))
                    });
                let available_targets = std::iter::once(actor_id)
                    .chain(initiative_order.iter().copied())
                    .filter(|candidate_id| *candidate_id != speaker_actor_id)
                    .filter_map(|candidate_id| {
                        let actor = runtime.actor_by_id(candidate_id)?;
                        (RuntimeWorld::actor_can_act(actor)
                            && actor.location_id == chat_plan.location_id
                            && !runtime.actors_blocked(speaker_actor_id, candidate_id)
                            && !runtime.actor_muted(speaker_actor_id, candidate_id))
                        .then(|| {
                            (
                                candidate_id,
                                runtime
                                    .actor_name(candidate_id)
                                    .unwrap_or_else(|| format!("Avatar {candidate_id}")),
                            )
                        })
                    })
                    .collect::<Vec<_>>();
                let source_line = lines
                    .iter()
                    .rev()
                    .find(|line| line.speaker_actor_id != speaker_actor_id)
                    .cloned();
                (speaker_name, available_targets, source_line)
            };

            let Some(speaker_name) = speaker_name else {
                commit_chat_floor_pass(
                    state,
                    speaker_actor_id,
                    actor_id,
                    &marker_for("pass"),
                    queue_event_id,
                    source_world_tick,
                    lines.last().map(|line| line.seq),
                    chat_plan.location_id,
                )
                .await?;
                continue;
            };
            let deciding_marker = marker_for("deciding");
            let _ = commit_chat_status(
                state,
                speaker_actor_id,
                actor_id,
                "deciding",
                &deciding_marker.content(),
                queue_event_id,
                source_world_tick,
                lines.last().map(|line| line.seq),
                Some(chat_plan.location_id),
            )
            .await;
            let choice = if round == MAX_CHAT_FLOOR_ROUNDS || available_targets.is_empty() {
                ChatFloorChoice::Pass
            } else if let Some(config) = state.ai_config.as_ref().as_ref() {
                request_chat_floor_choice(
                    config,
                    chat_plan.location_id,
                    speaker_actor_id,
                    &speaker_name,
                    round,
                    &available_targets,
                    &lines,
                )
                .await
                .unwrap_or(ChatFloorChoice::Pass)
            } else {
                ChatFloorChoice::Pass
            };
            let ChatFloorChoice::Chat = choice else {
                commit_chat_floor_pass(
                    state,
                    speaker_actor_id,
                    actor_id,
                    &marker_for("pass"),
                    queue_event_id,
                    source_world_tick,
                    lines.last().map(|line| line.seq),
                    chat_plan.location_id,
                )
                .await?;
                continue;
            };
            let Some(source_line) = source_line else {
                commit_chat_floor_pass(
                    state,
                    speaker_actor_id,
                    actor_id,
                    &marker_for("pass"),
                    queue_event_id,
                    source_world_tick,
                    lines.last().map(|line| line.seq),
                    chat_plan.location_id,
                )
                .await?;
                continue;
            };
            let observed_through_line_seq =
                lines.last().map(|line| line.seq).unwrap_or(source_line.seq);
            let listener_actor_id = source_line.speaker_actor_id;
            let reply_plan = {
                let runtime = state.inner.lock().await;
                let transcript = lines
                    .iter()
                    .rev()
                    .take(6)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .map(|line| {
                        format!(
                            "{} said: {}",
                            runtime
                                .actor_name(line.speaker_actor_id)
                                .unwrap_or_else(|| format!("Avatar {}", line.speaker_actor_id)),
                            line.content,
                        )
                    })
                    .collect::<Vec<_>>();
                let reply_plan = runtime
                    .resident_reply_plan_for_target(
                        listener_actor_id,
                        speaker_actor_id,
                        &source_line.content,
                    )
                    .map(|mut reply_plan| {
                        reply_plan.recent_activity = transcript;
                        if let Some(turn) = reply_plan.incoming_turn.as_mut() {
                            turn.source_event_seq = Some(source_line.seq);
                        }
                        reply_plan.with_publication_causality(
                            &orb_chat_attempt_stage(&format!("chat-floor-{round}-{seat}"), attempt),
                            queue_event_id,
                            source_world_tick,
                            Some(observed_through_line_seq),
                            Some(chat_plan.location_id),
                        )
                    });
                reply_plan.map(|plan| runtime.prepare_card_policy_objective_plan(plan))
            };
            let Some(reply_plan) = reply_plan else {
                commit_chat_floor_pass(
                    state,
                    speaker_actor_id,
                    actor_id,
                    &marker_for("pass"),
                    queue_event_id,
                    source_world_tick,
                    Some(observed_through_line_seq),
                    chat_plan.location_id,
                )
                .await?;
                continue;
            };
            announce_chat_typing(
                state,
                speaker_actor_id,
                listener_actor_id,
                queue_event_id,
                source_world_tick,
                Some(observed_through_line_seq),
                Some(chat_plan.location_id),
            )
            .await;
            let proposal = match avatar_reply_intent(state, &reply_plan).await {
                Ok(proposal) => proposal,
                Err(error) => {
                    warn!("Chat floor speaker passed after voice inference failed: {error}");
                    record_rejected_ai_publication(state, &error);
                    commit_chat_floor_pass(
                        state,
                        speaker_actor_id,
                        actor_id,
                        &marker_for("pass"),
                        queue_event_id,
                        source_world_tick,
                        Some(observed_through_line_seq),
                        chat_plan.location_id,
                    )
                    .await?;
                    continue;
                }
            };
            let marker = marker_for("chat");
            let spoke_events = {
                let mut runtime = state.inner.lock().await;
                commit_resident_reply_record(
                    state,
                    &mut runtime,
                    &reply_plan,
                    proposal,
                    None,
                    Some((&marker, listener_actor_id)),
                )
            };
            let Some(spoke_events) = spoke_events else {
                commit_chat_floor_pass(
                    state,
                    speaker_actor_id,
                    actor_id,
                    &marker_for("pass"),
                    queue_event_id,
                    source_world_tick,
                    Some(observed_through_line_seq),
                    chat_plan.location_id,
                )
                .await?;
                continue;
            };
            broadcast_events(state, &spoke_events);
            lines = load_lines().await?;
        }

        let round_decisions = {
            let runtime = state.inner.lock().await;
            committed_chat_floor_decisions(
                &runtime,
                actor_id,
                target_actor_id,
                chat_plan.location_id,
                queue_event_id,
                source_world_tick,
                observed_through_seq,
                &initiative_order,
            )?
            .into_iter()
            .filter(|decision| decision.round == round)
            .collect::<Vec<_>>()
        };
        if round_decisions.len() != initiative_order.len() {
            return Err("the Chat floor round did not commit every initiative choice".to_string());
        }
        if round_decisions
            .iter()
            .all(|decision| decision.decision == "pass")
        {
            return Ok(());
        }
    }
    Err("the bounded Chat floor did not reach a full round of passes".to_string())
}

fn chat_action_lock(state: &AppState, actor_id: u64) -> Arc<Mutex<()>> {
    let key = format!("{:p}:{actor_id}", Arc::as_ptr(&state.inner));
    let mut locks = CHAT_ACTION_LOCKS
        .get_or_init(|| StdMutex::new(BTreeMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

fn active_orb_chat_target(path: &Path, actor_id: u64) -> io::Result<Option<u64>> {
    let conn = open_event_store(path)?;
    let mut stmt = conn
        .prepare(
            "SELECT context_json FROM actor_jobs
             WHERE kind = ?1 AND actor_id = ?2 AND status IN ('pending', 'running')",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![ACTOR_JOB_KIND_ORB_CHAT, actor_id as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(sqlite_error)?;
    for row in rows {
        let payload = row.map_err(sqlite_error)?;
        let Ok(ActorJobPayload::OrbChat(job)) = serde_json::from_str::<ActorJobPayload>(&payload)
        else {
            continue;
        };
        return Ok(Some(job.target_actor_id));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};

    #[test]
    fn bounded_chat_names_each_exact_context_rejection() {
        let mut baseline = RuntimeWorld::seeded();
        create_test_human(&mut baseline, 5000, COSY_COTTAGE_LOCATION_ID, "Room Anchor");
        assert_eq!(
            chat_continuation_rejection(&baseline, 5000, RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID,),
            None,
        );
        assert_eq!(
            chat_continuation_rejection(
                &baseline,
                999_998,
                RATI_ACTOR_ID,
                COSY_COTTAGE_LOCATION_ID,
            ),
            Some(ChatContinuationRejection::InitiatorMissing),
        );
        assert_eq!(
            chat_continuation_rejection(&baseline, 5000, 999_999, COSY_COTTAGE_LOCATION_ID,),
            Some(ChatContinuationRejection::TargetMissing),
        );

        let mut initiator_unavailable = baseline.clone();
        initiator_unavailable.world.actors[..initiator_unavailable.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("Chat initiator")
            .status = CW_ACTOR_KNOCKED_OUT;
        assert_eq!(
            chat_continuation_rejection(
                &initiator_unavailable,
                5000,
                RATI_ACTOR_ID,
                COSY_COTTAGE_LOCATION_ID,
            ),
            Some(ChatContinuationRejection::InitiatorUnavailable),
        );

        let mut target_unavailable = baseline.clone();
        target_unavailable.world.actors[..target_unavailable.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Chat target")
            .status = CW_ACTOR_KNOCKED_OUT;
        assert_eq!(
            chat_continuation_rejection(
                &target_unavailable,
                5000,
                RATI_ACTOR_ID,
                COSY_COTTAGE_LOCATION_ID,
            ),
            Some(ChatContinuationRejection::TargetUnavailable),
        );

        for (actor_id, expected) in [
            (5000, ChatContinuationRejection::InitiatorMoved),
            (RATI_ACTOR_ID, ChatContinuationRejection::TargetMoved),
        ] {
            let mut moved = baseline.clone();
            moved.world.actors[..moved.world.actor_count]
                .iter_mut()
                .find(|actor| actor.id == actor_id)
                .expect("Chat participant")
                .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
            assert_eq!(
                chat_continuation_rejection(&moved, 5000, RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID,),
                Some(expected),
            );
        }

        let mut unsupported_inference = baseline.clone();
        unsupported_inference
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        assert_eq!(
            chat_continuation_rejection(
                &unsupported_inference,
                5000,
                RATI_ACTOR_ID,
                COSY_COTTAGE_LOCATION_ID,
            ),
            Some(ChatContinuationRejection::TargetInferenceUnsupported),
        );

        assert_eq!(
            chat_continuation_rejection_with(
                &baseline,
                5000,
                RATI_ACTOR_ID,
                COSY_COTTAGE_LOCATION_ID,
                |_| false,
            ),
            Some(ChatContinuationRejection::TargetTextReplyUnsupported),
        );

        let mut blocked = baseline.clone();
        blocked
            .actor_safety
            .entry(RATI_ACTOR_ID)
            .or_default()
            .blocked_actor_ids
            .insert(5000);
        assert_eq!(
            chat_continuation_rejection(&blocked, 5000, RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID,),
            Some(ChatContinuationRejection::PairBlocked),
        );

        let mut muted = baseline;
        muted
            .actor_safety
            .entry(5000)
            .or_default()
            .muted_actor_ids
            .insert(RATI_ACTOR_ID);
        assert_eq!(
            chat_continuation_rejection(&muted, 5000, RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID,),
            Some(ChatContinuationRejection::TargetMuted),
        );
    }

    #[test]
    fn chat_initiative_includes_every_eligible_room_resident_once() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Initiative Anchor",
        );
        let first = runtime.room_chat_initiative_order(COSY_COTTAGE_LOCATION_ID, 5000);
        let second = runtime.room_chat_initiative_order(COSY_COTTAGE_LOCATION_ID, 5000);
        assert_eq!(
            first, second,
            "initiative must be stable for the queued beat"
        );
        assert!(!first.contains(&5000));
        assert_eq!(
            first.iter().copied().collect::<BTreeSet<_>>().len(),
            first.len()
        );
        assert_eq!(
            first.iter().copied().collect::<BTreeSet<_>>(),
            [RATI_ACTOR_ID, WHISKERWIND_ACTOR_ID, SKULL_ACTOR_ID]
                .into_iter()
                .collect(),
            "every eligible inference-controlled avatar in the room gets one seat",
        );
    }

    #[tokio::test]
    async fn chat_endpoint_queues_a_bounded_exchange_without_spending_advancement() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-action-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: "http://127.0.0.1:9".to_string(),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
        }
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = chat(
            ConnectInfo("127.0.0.1:44001".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;

        assert!(response.ok);
        assert_eq!(response.status, CW_OK);
        assert!(response.events.iter().any(|event| {
            event.type_name == "chat.queued"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
        }));
        assert!(!response
            .events
            .iter()
            .any(|event| event.type_name == "advancement.spent"));
        let unauthorized_retry = chat(
            ConnectInfo("127.0.0.1:44002".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some("not-the-actor-session".to_string()),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(
            !unauthorized_retry.ok,
            "an active Chat job must not bypass actor authorization"
        );
        let overlapping_target = chat(
            ConnectInfo("127.0.0.1:44001".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
                target_actor_id: WHISKERWIND_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(!overlapping_target.ok);
        assert_eq!(overlapping_target.status, 409);
        assert!(overlapping_target.events.iter().any(|event| {
            event.type_name == "chat.failed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(WHISKERWIND_ACTOR_ID)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("current conversation"))
        }));
        let retry = chat(
            ConnectInfo("127.0.0.1:44001".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(retry.ok);
        assert!(
            retry.events.is_empty(),
            "retrying an active Chat must reuse the durable exchange"
        );
        let queued = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("inspect Chat outbox")
            .expect("Chat queued one durable job");
        let ActorJobPayload::OrbChat(job) = queued.payload else {
            panic!("Chat queued the wrong actor job");
        };
        assert_eq!(job.actor_id, 5000);
        assert_eq!(job.target_actor_id, RATI_ACTOR_ID);
        complete_actor_job(&path, queued.id).expect("complete inspected Chat job");
        assert!(
            claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
                .expect("inspect deduplicated Chat outbox")
                .is_none(),
            "a rapid Chat retry must not queue a second exchange"
        );
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
        assert_eq!(runtime.advancement_points_available(5000), 0);
        assert!(runtime.active_bond(5000, RATI_ACTOR_ID).is_none());
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| { event.type_name == "message.created" && event.actor_id == Some(5000) }));
        drop(runtime);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn co_present_chat_never_waits_for_internal_room_initiative() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-concurrent-chat-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Current Player",
        );
        create_test_human(
            &mut runtime,
            5001,
            COSY_COTTAGE_LOCATION_ID,
            "Waiting Chatter",
        );
        let mut state = test_app_state(runtime, Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: "http://127.0.0.1:9".to_string(),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
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

        let (before_tick, current_actor_id) = {
            let runtime = state.inner.lock().await;
            let active_direct_actors = active_actor_ids_for_state(&state);
            let turn = room_turn_view_for_runtime(
                &state,
                &runtime,
                COSY_COTTAGE_LOCATION_ID,
                Some(5000),
                &active_direct_actors,
            );
            assert!(!turn.enabled);
            (
                runtime.world.tick,
                current_room_initiative_actor(
                    &runtime,
                    COSY_COTTAGE_LOCATION_ID,
                    &active_direct_actors,
                )
                .expect("internal current room actor"),
            )
        };
        let session_for = |actor_id| {
            if actor_id == 5000 {
                session_5000.clone()
            } else {
                session_5001.clone()
            }
        };
        let waiting_actor_id = if current_actor_id == 5000 { 5001 } else { 5000 };
        let waiting = chat(
            ConnectInfo("127.0.0.1:44002".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: waiting_actor_id,
                actor_session: Some(session_for(waiting_actor_id)),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(waiting.ok, "either co-present player can queue Chat");
        assert_ne!(waiting.status, 423);

        let response = chat(
            ConnectInfo("127.0.0.1:44003".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: current_actor_id,
                actor_session: Some(session_for(current_actor_id)),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(response.ok, "the current avatar can play Chat");
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "chat.queued"));

        let runtime = state.inner.lock().await;
        let active_direct_actors = active_actor_ids_for_state(&state);
        let turn = room_turn_view_for_runtime(
            &state,
            &runtime,
            COSY_COTTAGE_LOCATION_ID,
            Some(5000),
            &active_direct_actors,
        );
        assert_eq!(runtime.world.tick, before_tick + 2);
        for actor_id in [5000, 5001] {
            assert_eq!(runtime.advancement_points_available(actor_id), 0);
            assert!(runtime.active_bond(actor_id, RATI_ACTOR_ID).is_none());
        }
        assert!(!turn.enabled);
        assert_eq!(turn.scene_kind, None);
        drop(runtime);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn unavailable_inference_commits_a_visible_chat_failure() {
        let state = test_app_state(RuntimeWorld::seeded(), None);
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };

        let result = complete_queued_orb_chat(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(41),
            Some(7),
            Some(40),
        )
        .await;
        assert!(
            result.is_err(),
            "unconfigured inference must fail the Chat job"
        );

        let runtime = state.inner.lock().await;
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.failed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("try talking again"))
        }));
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "message.created"));
    }

    #[tokio::test]
    async fn stale_durable_source_survives_snapshot_restart_without_inference() {
        let event_store_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-stale-chat-source-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-stale-chat-source-{}-{}.json",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&event_store_path);
        let _ = fs::remove_file(&snapshot_path);
        let mut state = test_app_state(RuntimeWorld::seeded(), Some(event_store_path.clone()));
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "must-not-be-used".to_string(),
            base_url: "http://127.0.0.1:9".to_string(),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Stale Source Tester",
            );
        }
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let response = chat(
            ConnectInfo("127.0.0.1:44100".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(response.ok);
        assert!(
            snapshot_path.exists(),
            "the queued beat writes a restart snapshot"
        );
        let claimed = claim_next_actor_job_of_kind(&event_store_path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("claim durable Chat job")
            .expect("queued durable Chat job");
        let ActorJobPayload::OrbChat(job) = claimed.payload.clone() else {
            panic!("queued the wrong durable job kind");
        };
        assert_eq!(
            durable_chat_source_rejection(
                &state,
                Some(&claimed),
                job.actor_id,
                job.target_actor_id,
                job.queue_event_id,
                job.source_world_tick,
                job.observed_through_seq,
                job.plan.location_id,
            )
            .expect("read durable source"),
            None,
        );

        let restored = rebuild_runtime_from_durable_state(&state, &event_store_path)
            .expect("restart from snapshot and journal");
        let canonical_owner_id = state.canonical_owner_id.clone();
        drop(state);
        let mut restarted = test_app_state(*restored, Some(event_store_path.clone()));
        restarted.canonical_owner_id = canonical_owner_id;
        let stale_observation = job
            .observed_through_seq
            .map(|sequence| sequence.saturating_sub(1));
        complete_queued_orb_chat_attempt(
            &restarted,
            job.actor_id,
            job.target_actor_id,
            job.plan,
            job.queue_event_id,
            job.source_world_tick,
            stale_observation,
            Some(&claimed),
            claimed.attempts,
        )
        .await
        .expect("stale source is an intentional terminal outcome");

        let runtime = restarted.inner.lock().await;
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.completed"
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("starting moment is no longer current"))
        }));
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "message.created"));
        drop(runtime);
        complete_actor_job(&event_store_path, claimed.id).expect("complete stale Chat job");
        let _ = fs::remove_file(event_store_path.with_extension("sqlite-wal"));
        let _ = fs::remove_file(event_store_path.with_extension("sqlite-shm"));
        let _ = fs::remove_file(event_store_path);
        let _ = fs::remove_file(snapshot_path);
    }

    #[tokio::test]
    async fn opening_storage_failure_is_visible_and_retryable_without_stale_dialogue() {
        let event_store_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-storage-retry-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&event_store_path);
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let calls = calls.clone();
                move |Json(_request): Json<serde_json::Value>| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    async move {
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {
                                    "content": "I found a quiet minute. How is the cottage treating you?"
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind storage retry inference server");
        let address = listener.local_addr().expect("storage retry server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(event_store_path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        let plan = {
            let mut runtime = state.inner.lock().await;
            let create = CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            };
            let mut record = JournalRecord::new(create, 75_000);
            record.actor_meta_upserts.insert(
                5000,
                ActorMeta {
                    name: "Storage Retry Tester".to_string(),
                    speech_mode: "prose".to_string(),
                    title: "Relay Test Avatar".to_string(),
                    description: "A durable test avatar.".to_string(),
                },
            );
            assert_eq!(
                commit_journal_record(&state, &mut runtime, record)
                    .expect("persist test avatar")
                    .0,
                CW_OK,
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };
        let conn = open_event_store(&event_store_path).expect("open storage retry store");
        conn.execute_batch(
            "CREATE TRIGGER reject_avatar_opening
             BEFORE INSERT ON world_events
             WHEN NEW.event_type = 'message.created'
             BEGIN SELECT RAISE(ABORT, 'injected avatar opening storage failure'); END;",
        )
        .expect("inject opening storage failure");

        let error = complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(61),
            Some(9),
            Some(60),
            None,
            1,
        )
        .await
        .expect_err("storage failure keeps the durable attempt retryable");
        assert!(error.contains("storage_failure"), "exact error: {error}");
        assert!(calls.load(std::sync::atomic::Ordering::SeqCst) > 0);
        let runtime = state.inner.lock().await;
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.retrying"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("could not be saved") && content.contains("retrying")
                })
        }));
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "message.created"));
        drop(runtime);
        conn.execute_batch("DROP TRIGGER reject_avatar_opening;")
            .expect("remove opening storage failure");
        drop(conn);
        server.abort();
        let _ = fs::remove_file(event_store_path.with_extension("sqlite-wal"));
        let _ = fs::remove_file(event_store_path.with_extension("sqlite-shm"));
        let _ = fs::remove_file(event_store_path);
    }

    #[tokio::test]
    async fn moving_during_opening_inference_completes_chat_without_a_false_failure() {
        let inference_started = Arc::new(Notify::new());
        let inference_released = Arc::new(Notify::new());
        let released = Arc::new(AtomicU8::new(0));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let inference_started = inference_started.clone();
                let inference_released = inference_released.clone();
                let released = released.clone();
                let calls = calls.clone();
                move |Json(_request): Json<serde_json::Value>| {
                    let inference_started = inference_started.clone();
                    let inference_released = inference_released.clone();
                    let released = released.clone();
                    let calls = calls.clone();
                    async move {
                        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        inference_started.notify_one();
                        while released.load(AtomicOrdering::SeqCst) == 0 {
                            inference_released.notified().await;
                        }
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {
                                    "content": "I found a quiet minute. How is the cottage treating you?"
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind moving Chat inference server");
        let address = listener
            .local_addr()
            .expect("moving Chat inference server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };

        let worker_state = state.clone();
        let worker_plan = plan.clone();
        let worker = tokio::spawn(async move {
            complete_queued_orb_chat(
                &worker_state,
                5000,
                RATI_ACTOR_ID,
                worker_plan,
                Some(71),
                Some(10),
                Some(70),
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(2), inference_started.notified())
            .await
            .expect("opening inference starts");
        {
            let mut runtime = state.inner.lock().await;
            let actor_count = runtime.world.actor_count;
            runtime.world.actors[..actor_count]
                .iter_mut()
                .find(|actor| actor.id == 5000)
                .expect("Chat initiator exists")
                .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        }
        released.store(1, AtomicOrdering::SeqCst);
        inference_released.notify_waiters();

        tokio::time::timeout(Duration::from_secs(10), worker)
            .await
            .expect("moved Chat worker finishes")
            .expect("moved Chat worker joins")
            .expect("moving ends the queued Chat cleanly");

        let calls_after_terminal_status = calls.load(std::sync::atomic::Ordering::SeqCst);
        complete_queued_orb_chat(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(71),
            Some(10),
            Some(70),
        )
        .await
        .expect("a reclaimed terminal conversation stays complete");
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            calls_after_terminal_status,
            "a deterministically invalid context must not trigger another paid inference",
        );

        let runtime = state.inner.lock().await;
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.completed"
                && event.caused_by_event_seq == Some(71)
                && event.content.as_deref() == Some("the conversation ended because you moved away")
        }));
        assert!(!runtime.event_log.iter().any(|event| {
            matches!(event.type_name.as_str(), "chat.retrying" | "chat.failed")
                && event.caused_by_event_seq == Some(71)
        }));
        assert!(!runtime.event_log.iter().any(|event| {
            event.type_name == "message.created" && event.caused_by_event_seq == Some(71)
        }));
        drop(runtime);
        server.abort();
    }

    #[tokio::test]
    async fn terminal_context_status_retry_never_replays_inference_after_context_recovers() {
        let event_store_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-terminal-retry-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&event_store_path);
        let inference_started = Arc::new(Notify::new());
        let inference_released = Arc::new(Notify::new());
        let released = Arc::new(AtomicU8::new(0));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let inference_started = inference_started.clone();
                let inference_released = inference_released.clone();
                let released = released.clone();
                let calls = calls.clone();
                move |Json(_request): Json<serde_json::Value>| {
                    let inference_started = inference_started.clone();
                    let inference_released = inference_released.clone();
                    let released = released.clone();
                    let calls = calls.clone();
                    async move {
                        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        inference_started.notify_one();
                        while released.load(AtomicOrdering::SeqCst) == 0 {
                            inference_released.notified().await;
                        }
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {
                                    "content": "I found a quiet minute. How is the cottage treating you?"
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind terminal status retry inference server");
        let address = listener
            .local_addr()
            .expect("terminal status retry inference server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(event_store_path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        {
            let mut runtime = state.inner.lock().await;
            let create = CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            };
            let mut record = JournalRecord::new(create, 76_000);
            record.actor_meta_upserts.insert(
                5000,
                ActorMeta {
                    name: "Terminal Retry Tester".to_string(),
                    speech_mode: "prose".to_string(),
                    title: "Durable Retry Avatar".to_string(),
                    description: "A durable terminal-status retry test avatar.".to_string(),
                },
            );
            assert_eq!(
                commit_journal_record(&state, &mut runtime, record)
                    .expect("persist terminal retry test avatar")
                    .0,
                CW_OK,
            );
        }
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let response = chat(
            ConnectInfo("127.0.0.1:44101".parse().expect("client address")),
            State(state.clone()),
            Json(ChatRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;
        assert!(response.ok);
        let claimed = claim_next_actor_job_of_kind(&event_store_path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("claim durable Chat job")
            .expect("queued durable Chat job");
        let ActorJobPayload::OrbChat(chat_job) = claimed.payload.clone() else {
            panic!("queued the wrong durable job kind");
        };

        let conn = open_event_store(&event_store_path).expect("open terminal retry store");
        conn.execute_batch(
            "CREATE TRIGGER reject_terminal_chat_status
             BEFORE INSERT ON world_events
             WHEN NEW.event_type = 'chat.completed'
             BEGIN SELECT RAISE(ABORT, 'injected terminal Chat status failure'); END;",
        )
        .expect("inject terminal Chat status failure");

        let worker_state = state.clone();
        let worker_job = claimed.clone();
        let worker_chat = chat_job.clone();
        let worker = tokio::spawn(async move {
            complete_queued_orb_chat_attempt(
                &worker_state,
                worker_chat.actor_id,
                worker_chat.target_actor_id,
                worker_chat.plan.clone(),
                worker_chat.queue_event_id,
                worker_chat.source_world_tick,
                worker_chat.observed_through_seq,
                Some(&worker_job),
                worker_job.attempts,
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(2), inference_started.notified())
            .await
            .expect("opening inference starts");
        {
            let mut runtime = state.inner.lock().await;
            let actor_count = runtime.world.actor_count;
            runtime.world.actors[..actor_count]
                .iter_mut()
                .find(|actor| actor.id == 5000)
                .expect("Chat initiator exists")
                .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        }
        released.store(1, AtomicOrdering::SeqCst);
        inference_released.notify_waiters();

        let error = tokio::time::timeout(Duration::from_secs(10), worker)
            .await
            .expect("terminal status worker finishes")
            .expect("terminal status worker joins")
            .expect_err("the failed terminal status stays retryable");
        assert_eq!(
            pending_chat_context_rejection(&error),
            Some(ChatContinuationRejection::InitiatorMoved),
            "the durable retry error preserves the terminal context reason",
        );
        fail_actor_job_for_runtime_state(&event_store_path, &state, &claimed, &error, 0)
            .expect("persist terminal status retry");

        conn.execute_batch("DROP TRIGGER reject_terminal_chat_status;")
            .expect("restore terminal Chat status persistence");
        conn.execute(
            "UPDATE actor_jobs SET available_at_ms = 0 WHERE id = ?1",
            params![claimed.id],
        )
        .expect("make terminal status retry immediately available");
        {
            let mut runtime = state.inner.lock().await;
            let actor_count = runtime.world.actor_count;
            runtime.world.actors[..actor_count]
                .iter_mut()
                .find(|actor| actor.id == 5000)
                .expect("Chat initiator exists")
                .location_id = COSY_COTTAGE_LOCATION_ID;
        }

        let retry = claim_next_actor_job_of_kind(&event_store_path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("claim terminal status retry")
            .expect("terminal status retry exists");
        assert_eq!(
            retry
                .last_error
                .as_deref()
                .and_then(pending_chat_context_rejection),
            Some(ChatContinuationRejection::InitiatorMoved),
        );
        let calls_before_retry = calls.load(std::sync::atomic::Ordering::SeqCst);
        let ActorJobPayload::OrbChat(retry_chat) = retry.payload.clone() else {
            panic!("retried the wrong durable job kind");
        };
        complete_queued_orb_chat_attempt(
            &state,
            retry_chat.actor_id,
            retry_chat.target_actor_id,
            retry_chat.plan,
            retry_chat.queue_event_id,
            retry_chat.source_world_tick,
            retry_chat.observed_through_seq,
            Some(&retry),
            retry.attempts,
        )
        .await
        .expect("retry commits only the remembered terminal status");
        complete_actor_job(&event_store_path, retry.id).expect("complete terminal status retry");
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            calls_before_retry,
            "recovering the old context must not trigger another paid inference",
        );

        let runtime = state.inner.lock().await;
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.completed"
                && event.caused_by_event_seq == chat_job.queue_event_id
                && event.content.as_deref() == Some("the conversation ended because you moved away")
        }));
        assert!(!runtime.event_log.iter().any(|event| {
            event.type_name == "message.created"
                && event.caused_by_event_seq == chat_job.queue_event_id
        }));
        drop(runtime);
        drop(conn);
        server.abort();
        let _ = fs::remove_file(event_store_path.with_extension("sqlite-wal"));
        let _ = fs::remove_file(event_store_path.with_extension("sqlite-shm"));
        let _ = fs::remove_file(event_store_path);
    }

    const CHAT_SCRIPT: [&str; 4] = [
        "I found a quiet minute. How is the cottage treating you?",
        "Kindly enough, though the kettle has opinions about punctuality.",
        "Then I will keep one ear on the kettle and one on your story.",
        "A sensible arrangement. Come back before the kettle starts whistling secrets.",
    ];

    #[tokio::test]
    async fn chat_floor_can_speak_then_ends_after_a_full_round_of_passes() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let requests = Arc::new(StdMutex::new(Vec::<serde_json::Value>::new()));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let calls = calls.clone();
                let requests = requests.clone();
                move |Json(request): Json<serde_json::Value>| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let payload = request.to_string();
                    let index = CHAT_SCRIPT
                        .iter()
                        .rposition(|line| payload.contains(line))
                        .map(|position| position + 1)
                        .unwrap_or_default();
                    requests
                        .lock()
                        .expect("capture Chat inference request")
                        .push(request);
                    async move {
                        let content = if payload.contains("Initiative round: 1") {
                            serde_json::json!({
                                "decision": "chat",
                                "target_actor_id": 5000,
                            })
                            .to_string()
                        } else if payload.contains("Initiative round: 2") {
                            serde_json::json!({ "decision": "pass" }).to_string()
                        } else {
                            CHAT_SCRIPT
                                .get(index)
                                .copied()
                                .unwrap_or("The conversation has already settled.")
                                .to_string()
                        };
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": { "content": content }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bounded Chat inference server");
        let address = listener
            .local_addr()
            .expect("Chat inference server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            let mut plan = runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target");
            plan.initiative_order = vec![RATI_ACTOR_ID];
            plan
        };

        let source_world_tick = plan.context_spine.world_tick;
        let observed_through_seq = plan.context_spine.observed_through_seq;
        complete_queued_orb_chat(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(51),
            Some(source_world_tick),
            Some(observed_through_seq),
        )
        .await
        .expect("the scripted bounded Chat completes");

        let runtime = state.inner.lock().await;
        let speakers = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "message.created")
            .filter_map(|event| event.actor_id)
            .collect::<Vec<_>>();
        let event_diagnostic = runtime
            .event_log
            .iter()
            .map(|event| {
                (
                    event.type_name.clone(),
                    event.actor_id,
                    event.content.clone(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            speakers,
            vec![5000, RATI_ACTOR_ID, RATI_ACTOR_ID],
            "the opening pair may continue through the initiative floor; calls={}, events={event_diagnostic:?}",
            calls.load(std::sync::atomic::Ordering::SeqCst),
        );
        let messages = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "message.created")
            .collect::<Vec<_>>();
        for pair in messages.windows(2) {
            assert!(
                pair[1].observed_through_seq.unwrap_or_default() >= pair[0].seq,
                "each reply must causally observe the committed line it answers: {pair:?}"
            );
        }
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.spoke"
                && event.actor_id == Some(RATI_ACTOR_ID)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("\"round\":1"))
        }));
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.passed"
                && event.actor_id == Some(RATI_ACTOR_ID)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("\"round\":2"))
        }));
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "chat.completed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
        }));
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "chat.failed"));
        drop(runtime);
        let captured = requests.lock().expect("inspect Chat inference requests");
        let last_user_prompt = |request: &serde_json::Value| -> Option<String> {
            request["messages"].as_array().and_then(|messages| {
                messages.iter().rev().find_map(|message| {
                    (message["role"].as_str() == Some("user"))
                        .then(|| message["content"].as_str())
                        .flatten()
                        .map(str::to_string)
                })
            })
        };
        let floor_prompts = captured
            .iter()
            .filter_map(last_user_prompt)
            .filter(|prompt| {
                prompt.contains("Choose whether this speaker has something worthwhile")
            })
            .collect::<Vec<_>>();
        assert!(floor_prompts
            .iter()
            .any(|prompt| prompt.contains("Initiative round: 1")));
        assert!(floor_prompts
            .iter()
            .any(|prompt| prompt.contains("Initiative round: 2")));
        server.abort();
    }

    #[test]
    fn orb_chat_provider_retry_waits_for_health_but_stops_at_the_attempt_budget() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-retry-floor-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Retry Timer");
        let plan = runtime
            .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
            .expect("co-present inference resident is a Chat target");
        let mut state = test_app_state(runtime, Some(path.clone()));
        state.ai_config = Arc::new(Some(AiConfig::default()));
        let queued = OrbChatJob {
            actor_id: 5000,
            target_actor_id: RATI_ACTOR_ID,
            plan,
            queue_event_id: Some(71),
            source_world_tick: Some(10),
            observed_through_seq: Some(70),
        };
        let conn = open_event_store(&path).expect("open Chat retry store");
        assert!(insert_orb_chat_job(&conn, &queued, 10, Some(71)).expect("queue Chat job"));
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_ORB_CHAT)
            .expect("claim Chat job")
            .expect("queued Chat job exists");

        let retry_floor = actor_job_retry_floor_ms(&state, &claimed, "voice_provider_unavailable");
        assert_eq!(retry_floor, 2_250);
        let mut unrelated = claimed.clone();
        unrelated.kind = ACTOR_JOB_KIND_PLAYER_TICK.to_string();
        assert_eq!(
            actor_job_retry_floor_ms(&state, &unrelated, "voice_provider_unavailable"),
            0,
            "provider cooldown must not slow unrelated actor jobs"
        );

        let before = now_millis();
        fail_or_retry_actor_job(&path, &claimed, "voice_provider_unavailable", retry_floor)
            .expect("persist Chat retry");
        let (status, available_at_ms, last_error): (String, i64, Option<String>) = conn
            .query_row(
                "SELECT status, available_at_ms, last_error FROM actor_jobs WHERE id = ?1",
                params![claimed.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read persisted Chat retry");
        assert_eq!(status, "pending");
        assert_eq!(last_error.as_deref(), Some("voice_provider_unavailable"));
        assert!(available_at_ms as u64 >= before.saturating_add(2_000));

        let mut probing = AiConfig::default();
        probing.readiness =
            crate::ai_readiness::AiReadiness::probing_with_low_credit_threshold(5.0);
        state.ai_config = Arc::new(Some(probing));
        let mut exhausted = claimed.clone();
        exhausted.attempts = ACTOR_JOB_MAX_ATTEMPTS;
        fail_actor_job_for_runtime_state(
            &path,
            &state,
            &exhausted,
            "voice_provider_unavailable",
            retry_floor,
        )
        .expect("exhausted Chat retry becomes terminal even while readiness is probing");
        let status: String = conn
            .query_row(
                "SELECT status FROM actor_jobs WHERE id = ?1",
                params![claimed.id],
                |row| row.get(0),
            )
            .expect("read exhausted Chat retry status");
        assert_eq!(status, "dead");
        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn retry_resumes_across_snapshot_restart_without_replaying_the_opening() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-resume-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-chat-resume-{}-{}.json",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&snapshot_path);
        let fail_after_opening = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let fail_after_opening = fail_after_opening.clone();
                let calls = calls.clone();
                move |Json(request): Json<serde_json::Value>| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let payload = request.to_string();
                    let index = CHAT_SCRIPT
                        .iter()
                        .rposition(|line| payload.contains(line))
                        .map(|position| position + 1)
                        .unwrap_or_default();
                    let fail =
                        index > 0 && fail_after_opening.load(std::sync::atomic::Ordering::SeqCst);
                    async move {
                        if fail {
                            return Json(serde_json::json!({
                                "model": "test-chat-model",
                                "choices": []
                            }));
                        }
                        Json(serde_json::json!({
                            "model": "test-chat-model",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {
                                    "content": CHAT_SCRIPT
                                        .get(index)
                                        .copied()
                                        .unwrap_or("The conversation has already settled.")
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind resumable Chat inference server");
        let address = listener
            .local_addr()
            .expect("resumable Chat inference server address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-chat-model".to_string(),
            ..AiConfig::default()
        }));
        let plan = {
            let mut runtime = state.inner.lock().await;
            create_test_human(
                &mut runtime,
                5000,
                COSY_COTTAGE_LOCATION_ID,
                "Inference Tester",
            );
            runtime
                .avatar_chat_plan_for(5000, RATI_ACTOR_ID)
                .expect("co-present inference resident is a Chat target")
        };

        let source_world_tick = plan.context_spine.world_tick;
        let observed_through_seq = plan.context_spine.observed_through_seq;
        let first = complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan.clone(),
            Some(61),
            Some(source_world_tick),
            Some(observed_through_seq),
            None,
            1,
        )
        .await;
        assert!(
            first.is_err(),
            "the injected resident outage ends attempt one"
        );
        {
            let runtime = state.inner.lock().await;
            let messages = runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "message.created")
                .collect::<Vec<_>>();
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0].actor_id, Some(5000));
            assert_eq!(messages[0].content.as_deref(), Some(CHAT_SCRIPT[0]));
            assert!(runtime.event_log.iter().any(|event| {
                event.type_name == "chat.retrying"
                    && event.caused_by_event_seq == Some(61)
                    && event
                        .content
                        .as_deref()
                        .is_some_and(|content| content.contains("retrying"))
            }));
            runtime
                .save_snapshot(&snapshot_path)
                .expect("snapshot the partially committed Chat transcript");
        }

        let restored = rebuild_runtime_from_durable_state(&state, &path)
            .expect("restart from the partial Chat snapshot and journal");
        let canonical_owner_id = state.canonical_owner_id.clone();
        let ai_config = state.ai_config.clone();
        drop(state);
        let mut state = test_app_state(*restored, Some(path.clone()));
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.canonical_owner_id = canonical_owner_id;
        state.ai_config = ai_config;

        fail_after_opening.store(false, std::sync::atomic::Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(2_100)).await;
        complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan.clone(),
            Some(61),
            Some(source_world_tick),
            Some(observed_through_seq),
            None,
            2,
        )
        .await
        .expect("attempt two resumes and completes the durable transcript");
        let calls_after_completion = calls.load(std::sync::atomic::Ordering::SeqCst);
        complete_queued_orb_chat_attempt(
            &state,
            5000,
            RATI_ACTOR_ID,
            plan,
            Some(61),
            Some(source_world_tick),
            Some(observed_through_seq),
            None,
            3,
        )
        .await
        .expect("reclaim after completion is idempotent");

        let runtime = state.inner.lock().await;
        let messages = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "message.created")
            .collect::<Vec<_>>();
        assert_eq!(
            messages.len(),
            2,
            "the resumed opening pair is followed by a durable all-pass floor round"
        );
        assert_eq!(
            messages
                .iter()
                .filter(|event| event.content.as_deref() == Some(CHAT_SCRIPT[0]))
                .count(),
            1,
            "the committed opening must not be generated or published twice"
        );
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "chat.completed")
                .count(),
            1,
            "a reclaimed completed job must not duplicate its terminal event"
        );
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            calls_after_completion,
            "a reclaimed completed job must not call inference again"
        );
        drop(runtime);
        server.abort();
        let _ = fs::remove_file(path.with_extension("sqlite-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite-shm"));
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(snapshot_path);
    }
}
