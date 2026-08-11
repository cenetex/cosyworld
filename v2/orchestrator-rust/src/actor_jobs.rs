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
pub(super) const ACTOR_JOB_MALFORMED_PAYLOAD_RETRY_DELAY_MS: i64 = 30_000;
pub(super) const ACTOR_JOB_MALFORMED_PAYLOAD_ERROR: &str = "actor_job_payload_invalid";

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
                   WHERE active.actor_id = actor_jobs.actor_id
                     AND active.kind = actor_jobs.kind
                     AND active.id != actor_jobs.id
                     AND active.status = 'running'
                     AND active.lease_until_ms > ?1
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
               AND lease_until_ms IS ?8 AND available_at_ms = ?9",
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
