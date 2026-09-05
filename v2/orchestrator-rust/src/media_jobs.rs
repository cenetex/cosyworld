use super::*;

pub(super) const MEDIA_JOB_KIND_COMMUNITY_ART: &str = "community_art";
const MEDIA_JOB_LEASE_MS: u64 = 5 * 60 * 1_000;
const MEDIA_JOB_IDLE_POLL: Duration = Duration::from_secs(2);
const MEDIA_JOB_RETRY_BASE_MS: u64 = 5_000;
const DEFAULT_MEDIA_DAILY_LIMIT_MICROUSD: u64 = 1_000_000;
const DEFAULT_COMMUNITY_IMAGE_ESTIMATED_COST_MICROUSD: u64 = 50_000;
const MEDIA_DAILY_LIMIT_ENV: &str = "COSYWORLD_MEDIA_DAILY_LIMIT_MICROUSD";
const COMMUNITY_IMAGE_COST_ENV: &str = "COSYWORLD_COMMUNITY_IMAGE_ESTIMATED_COST_MICROUSD";

fn default_community_image_estimated_cost_microusd() -> u64 {
    media_budget_env(
        COMMUNITY_IMAGE_COST_ENV,
        DEFAULT_COMMUNITY_IMAGE_ESTIMATED_COST_MICROUSD,
    )
    .max(1)
}

#[derive(Clone, Copy, Debug)]
pub(super) struct MediaBudgetConfig {
    pub(super) daily_limit_microusd: u64,
    pub(super) community_image_estimated_cost_microusd: u64,
}

impl MediaBudgetConfig {
    pub(super) fn from_env() -> Self {
        Self {
            daily_limit_microusd: media_budget_env(
                MEDIA_DAILY_LIMIT_ENV,
                DEFAULT_MEDIA_DAILY_LIMIT_MICROUSD,
            ),
            community_image_estimated_cost_microusd:
                default_community_image_estimated_cost_microusd(),
        }
    }
}

fn media_budget_env(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|value| value.min(i64::MAX as u64))
        .unwrap_or(default)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub(super) enum MediaJobPayload {
    CommunityArt {
        actor_id: u64,
        plan: Box<CommunityArtPlan>,
        #[serde(default = "default_community_image_estimated_cost_microusd")]
        estimated_cost_microusd: u64,
    },
}

impl MediaJobPayload {
    fn job_key(&self) -> String {
        match self {
            Self::CommunityArt { plan, .. } => {
                community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level)
            }
        }
    }

    fn dedupe_key(&self) -> String {
        match self {
            Self::CommunityArt { plan, .. } => format!(
                "community-art:{}:profile:{}",
                self.job_key(),
                plan.generation_profile_version
            ),
        }
    }

    fn actor_id(&self) -> u64 {
        match self {
            Self::CommunityArt { actor_id, .. } => *actor_id,
        }
    }

    fn subject(&self) -> (&str, u64, u8) {
        match self {
            Self::CommunityArt { plan, .. } => (&plan.subject_kind, plan.subject_id, plan.level),
        }
    }

    fn estimated_cost_microusd(&self) -> u64 {
        match self {
            Self::CommunityArt {
                estimated_cost_microusd,
                ..
            } => *estimated_cost_microusd,
        }
    }
}

pub(super) fn community_art_media_job_after_funding(
    runtime: &RuntimeWorld,
    actor_id: u64,
    plan: &CommunityArtPlan,
    funded_orbs: i32,
    candidate_availability: CommunityArtCandidateAvailability,
) -> Option<MediaJobPayload> {
    (funded_orbs >= plan.required_orbs
        && !(plan.subject_kind == "actor"
            && runtime.avatar_requires_self_description(plan.subject_id, plan.level)))
    .then(|| MediaJobPayload::CommunityArt {
        actor_id,
        plan: Box::new(plan.clone()),
        estimated_cost_microusd: if candidate_availability
            == CommunityArtCandidateAvailability::Valid
        {
            0
        } else {
            MediaBudgetConfig::from_env().community_image_estimated_cost_microusd
        },
    })
}

#[derive(Clone, Debug)]
pub(super) struct MediaJob {
    pub(super) id: i64,
    pub(super) attempts: u32,
    pub(super) payload: MediaJobPayload,
}

#[derive(Debug)]
enum MediaJobClaim {
    Claimed(MediaJob),
    BudgetDeferred {
        job_key: String,
        available_at_ms: u64,
    },
    Empty,
}

#[derive(Debug)]
pub(super) enum MediaJobExecution {
    Completed {
        charge_reserved: bool,
    },
    Retry {
        error: String,
        charge_reserved: bool,
        estimated_cost_microusd: u64,
    },
    Deferred {
        error: String,
        available_at_ms: u64,
        charge_reserved: bool,
        estimated_cost_microusd: u64,
    },
    Dead {
        error: String,
        charge_reserved: bool,
    },
}

pub(super) fn init_media_job_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            job_key TEXT NOT NULL,
            actor_id INTEGER NOT NULL,
            subject_kind TEXT NOT NULL,
            subject_id INTEGER NOT NULL,
            subject_level INTEGER NOT NULL,
            source_event_seq INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            lease_until_ms INTEGER,
            available_at_ms INTEGER NOT NULL DEFAULT 0,
            estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
            reserved_day_utc INTEGER,
            reserved_microusd INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_jobs_ready
            ON media_jobs(status, available_at_ms, lease_until_ms,
                          estimated_cost_microusd, id);
        CREATE INDEX IF NOT EXISTS idx_media_jobs_subject
            ON media_jobs(subject_kind, subject_id, subject_level, status);
        CREATE TABLE IF NOT EXISTS media_budget_days (
            day_utc INTEGER PRIMARY KEY,
            limit_microusd INTEGER NOT NULL,
            reserved_microusd INTEGER NOT NULL DEFAULT 0,
            spent_microusd INTEGER NOT NULL DEFAULT 0,
            updated_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(sqlite_error)
}

pub(super) fn insert_media_job_payload(
    conn: &Connection,
    payload: &MediaJobPayload,
    source_event_seq: Option<u64>,
) -> io::Result<bool> {
    let payload_json = serde_json::to_string(payload)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let (subject_kind, subject_id, subject_level) = payload.subject();
    let now = now_millis() as i64;
    let inserted = conn
        .execute(
            "INSERT INTO media_jobs
                (kind, job_key, actor_id, subject_kind, subject_id, subject_level,
                 source_event_seq, status, attempts, lease_until_ms, available_at_ms,
                 estimated_cost_microusd, reserved_day_utc, reserved_microusd,
                 payload_json, dedupe_key, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, NULL, 0,
                     ?8, NULL, 0, ?9, ?10, ?11, ?11)
             ON CONFLICT(dedupe_key) DO UPDATE SET
                 actor_id = excluded.actor_id,
                 source_event_seq = COALESCE(excluded.source_event_seq, media_jobs.source_event_seq),
                 status = 'pending',
                 attempts = 0,
                 lease_until_ms = NULL,
                 available_at_ms = 0,
                 estimated_cost_microusd = excluded.estimated_cost_microusd,
                 reserved_day_utc = NULL,
                 reserved_microusd = 0,
                 payload_json = excluded.payload_json,
                 last_error = NULL,
                 updated_at_ms = excluded.updated_at_ms
             WHERE media_jobs.payload_json <> excluded.payload_json
               AND media_jobs.status IN ('pending', 'completed', 'dead')",
            params![
                MEDIA_JOB_KIND_COMMUNITY_ART,
                payload.job_key(),
                payload.actor_id() as i64,
                subject_kind,
                subject_id as i64,
                subject_level as i64,
                source_event_seq.map(|seq| seq as i64),
                payload.estimated_cost_microusd() as i64,
                payload_json,
                payload.dedupe_key(),
                now,
            ],
        )
        .map_err(sqlite_error)?;
    Ok(inserted > 0)
}

pub(super) fn insert_journal_background_jobs(
    conn: &Connection,
    record: &JournalRecord,
    source_tick: u64,
    events: &[EventView],
) -> io::Result<bool> {
    let actor_job_inserted = match record.queued_actor_job.as_ref() {
        Some(ActorJobPayload::OrbChat(job)) => insert_orb_chat_job(
            conn,
            job,
            source_tick,
            events
                .iter()
                .find(|event| event.type_name == "chat.queued" && event.success)
                .map(|event| event.seq),
        )?,
        Some(ActorJobPayload::ModelInteraction(job)) => insert_model_interaction_job(
            conn,
            job,
            source_tick,
            events
                .iter()
                .find(|event| event.type_name == "model_interaction.queued" && event.success)
                .map(|event| event.seq),
        )?,
        Some(ActorJobPayload::AvatarReflection(job)) => {
            insert_avatar_reflection_job(conn, job, events)?
        }
        Some(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "journal queued an unsupported actor job payload",
            ));
        }
        None => false,
    };
    let media_job_inserted = record
        .queued_media_job
        .as_ref()
        .map(|job| {
            insert_media_job_payload(
                conn,
                job,
                events
                    .iter()
                    .find(|event| event.type_name == "community_art.funded" && event.success)
                    .map(|event| event.seq),
            )
        })
        .transpose()?
        .unwrap_or(false);
    Ok(actor_job_inserted || media_job_inserted)
}

pub(super) fn enqueue_media_job(
    path: &Path,
    payload: &MediaJobPayload,
    source_event_seq: Option<u64>,
) -> io::Result<bool> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    insert_media_job_payload(&conn, payload, source_event_seq)
}

pub(super) fn set_pending_media_job_estimated_cost(
    path: &Path,
    payload: &MediaJobPayload,
    estimated_cost_microusd: u64,
) -> io::Result<()> {
    let conn = open_event_store(path)?;
    conn.execute(
        "UPDATE media_jobs
         SET estimated_cost_microusd = ?2, updated_at_ms = ?3
         WHERE dedupe_key = ?1 AND status = 'pending'",
        params![
            payload.dedupe_key(),
            estimated_cost_microusd as i64,
            now_millis() as i64,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn utc_day(now_ms: u64) -> u64 {
    now_ms / 86_400_000
}

fn next_utc_day_ms(now_ms: u64) -> u64 {
    utc_day(now_ms).saturating_add(1).saturating_mul(86_400_000)
}

fn settle_reservation(
    conn: &Connection,
    reserved_day_utc: Option<u64>,
    reserved_microusd: u64,
    charge_reserved: bool,
    now_ms: u64,
) -> io::Result<()> {
    let Some(day_utc) = reserved_day_utc.filter(|_| reserved_microusd > 0) else {
        return Ok(());
    };
    conn.execute(
        "UPDATE media_budget_days
         SET reserved_microusd = MAX(0, reserved_microusd - ?2),
             spent_microusd = spent_microusd + ?3,
             updated_at_ms = ?4
         WHERE day_utc = ?1",
        params![
            day_utc as i64,
            reserved_microusd as i64,
            if charge_reserved {
                reserved_microusd as i64
            } else {
                0
            },
            now_ms as i64,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn claim_next_media_job(
    path: &Path,
    budget: MediaBudgetConfig,
    now_ms: u64,
) -> io::Result<MediaJobClaim> {
    init_event_store(path)?;
    let mut conn = open_event_store(path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let row = tx
        .query_row(
            "SELECT id, job_key, attempts, status, lease_until_ms,
                    estimated_cost_microusd, reserved_day_utc, reserved_microusd,
                    payload_json
             FROM media_jobs
             WHERE (status = 'pending' AND available_at_ms <= ?1)
                OR (status = 'running' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?1)
             ORDER BY estimated_cost_microusd ASC, created_at_ms ASC, id ASC
             LIMIT 1",
            params![now_ms as i64],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .optional()
        .map_err(sqlite_error)?;
    let Some((
        id,
        job_key,
        attempts,
        selected_status,
        selected_lease,
        estimated_cost,
        mut reserved_day,
        mut reserved_cost,
        payload_json,
    )) = row
    else {
        tx.commit().map_err(sqlite_error)?;
        return Ok(MediaJobClaim::Empty);
    };
    let payload = match serde_json::from_str::<MediaJobPayload>(&payload_json) {
        Ok(payload) => payload,
        Err(error) => {
            settle_reservation(
                &tx,
                reserved_day.map(|day| day.max(0) as u64),
                reserved_cost.max(0) as u64,
                true,
                now_ms,
            )?;
            tx.execute(
                "UPDATE media_jobs
                 SET status = 'dead', lease_until_ms = NULL,
                     reserved_day_utc = NULL, reserved_microusd = 0,
                     last_error = ?2, updated_at_ms = ?3
                 WHERE id = ?1",
                params![
                    id,
                    format!("malformed media job payload: {error}"),
                    now_ms as i64
                ],
            )
            .map_err(sqlite_error)?;
            tx.commit().map_err(sqlite_error)?;
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("media job {id} payload is malformed"),
            ));
        }
    };
    let current_day = utc_day(now_ms);
    if reserved_cost > 0
        && (selected_status == "running"
            || reserved_day.is_some_and(|day| day.max(0) as u64 != current_day))
    {
        settle_reservation(
            &tx,
            reserved_day.map(|day| day.max(0) as u64),
            reserved_cost.max(0) as u64,
            true,
            now_ms,
        )?;
        reserved_day = None;
        reserved_cost = 0;
    }
    let estimated_cost = estimated_cost.max(0) as u64;
    let has_current_reservation = reserved_day.is_some_and(|day| day.max(0) as u64 == current_day)
        && reserved_cost.max(0) as u64 == estimated_cost;
    if estimated_cost > 0 && !has_current_reservation {
        tx.execute(
            "INSERT INTO media_budget_days
                (day_utc, limit_microusd, reserved_microusd, spent_microusd, updated_at_ms)
             VALUES (?1, ?2, 0, 0, ?3)
             ON CONFLICT(day_utc) DO UPDATE SET
                limit_microusd = excluded.limit_microusd,
                updated_at_ms = excluded.updated_at_ms",
            params![
                current_day as i64,
                budget.daily_limit_microusd as i64,
                now_ms as i64,
            ],
        )
        .map_err(sqlite_error)?;
        let (reserved, spent) = tx
            .query_row(
                "SELECT reserved_microusd, spent_microusd
                 FROM media_budget_days WHERE day_utc = ?1",
                params![current_day as i64],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(sqlite_error)?;
        let admitted = (reserved.max(0) as u64)
            .saturating_add(spent.max(0) as u64)
            .saturating_add(estimated_cost)
            <= budget.daily_limit_microusd;
        if !admitted {
            let available_at_ms = next_utc_day_ms(now_ms);
            tx.execute(
                "UPDATE media_jobs
                 SET status = 'pending', lease_until_ms = NULL,
                     available_at_ms = ?2, last_error = 'media_daily_budget_exhausted',
                     updated_at_ms = ?3
                 WHERE id = ?1",
                params![id, available_at_ms as i64, now_ms as i64],
            )
            .map_err(sqlite_error)?;
            tx.commit().map_err(sqlite_error)?;
            return Ok(MediaJobClaim::BudgetDeferred {
                job_key,
                available_at_ms,
            });
        }
        tx.execute(
            "UPDATE media_budget_days
             SET reserved_microusd = reserved_microusd + ?2,
                 updated_at_ms = ?3
             WHERE day_utc = ?1",
            params![current_day as i64, estimated_cost as i64, now_ms as i64],
        )
        .map_err(sqlite_error)?;
        reserved_day = Some(current_day as i64);
        reserved_cost = estimated_cost as i64;
    }
    let next_attempt = attempts.max(0).saturating_add(1);
    let lease_until = now_ms.saturating_add(MEDIA_JOB_LEASE_MS);
    let claimed = tx
        .execute(
            "UPDATE media_jobs
             SET status = 'running', attempts = ?2, lease_until_ms = ?3,
                 reserved_day_utc = ?4, reserved_microusd = ?5,
                 last_error = NULL, updated_at_ms = ?6
             WHERE id = ?1 AND status = ?7 AND lease_until_ms IS ?8",
            params![
                id,
                next_attempt,
                lease_until as i64,
                reserved_day,
                reserved_cost,
                now_ms as i64,
                selected_status,
                selected_lease,
            ],
        )
        .map_err(sqlite_error)?;
    if claimed == 0 {
        tx.rollback().map_err(sqlite_error)?;
        return Ok(MediaJobClaim::Empty);
    }
    tx.commit().map_err(sqlite_error)?;
    Ok(MediaJobClaim::Claimed(MediaJob {
        id,
        attempts: next_attempt.max(0) as u32,
        payload,
    }))
}

struct MediaJobFinish<'a> {
    status: &'a str,
    error: Option<&'a str>,
    available_at_ms: u64,
    estimated_cost_microusd: u64,
    charge_reserved: bool,
    refund_attempt: bool,
}

fn finish_media_job(path: &Path, job: &MediaJob, finish: MediaJobFinish<'_>) -> io::Result<()> {
    let mut conn = open_event_store(path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let reservation = tx
        .query_row(
            "SELECT reserved_day_utc, reserved_microusd
             FROM media_jobs WHERE id = ?1 AND status = 'running'",
            params![job.id],
            |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(sqlite_error)?;
    let Some((reserved_day, reserved_cost)) = reservation else {
        tx.commit().map_err(sqlite_error)?;
        return Ok(());
    };
    settle_reservation(
        &tx,
        reserved_day.map(|day| day.max(0) as u64),
        reserved_cost.max(0) as u64,
        finish.charge_reserved,
        now_millis(),
    )?;
    tx.execute(
        "UPDATE media_jobs
         SET status = ?2, attempts = MAX(0, attempts - ?3), lease_until_ms = NULL,
             available_at_ms = ?4, estimated_cost_microusd = ?5,
             reserved_day_utc = NULL, reserved_microusd = 0,
             last_error = ?6, updated_at_ms = ?7
         WHERE id = ?1 AND status = 'running'",
        params![
            job.id,
            finish.status,
            if finish.refund_attempt { 1 } else { 0 },
            finish.available_at_ms as i64,
            finish.estimated_cost_microusd as i64,
            finish.error,
            now_millis() as i64,
        ],
    )
    .map_err(sqlite_error)?;
    tx.commit().map_err(sqlite_error)?;
    Ok(())
}

fn retry_delay_ms(attempts: u32) -> u64 {
    MEDIA_JOB_RETRY_BASE_MS.saturating_mul(1u64 << attempts.saturating_sub(1).min(6))
}

async fn run_media_job_worker(state: AppState, budget: MediaBudgetConfig) {
    loop {
        let path = state
            .event_store_path
            .as_deref()
            .expect("media worker requires an event store");
        match claim_next_media_job(path, budget, now_millis()) {
            Ok(MediaJobClaim::Claimed(job)) => {
                let execution = match &job.payload {
                    MediaJobPayload::CommunityArt { actor_id, plan, .. } => {
                        execute_community_art_media_job(&state, *actor_id, plan.as_ref().clone())
                            .await
                    }
                };
                let result = match execution {
                    MediaJobExecution::Completed { charge_reserved } => finish_media_job(
                        path,
                        &job,
                        MediaJobFinish {
                            status: "completed",
                            error: None,
                            available_at_ms: 0,
                            estimated_cost_microusd: 0,
                            charge_reserved,
                            refund_attempt: false,
                        },
                    ),
                    MediaJobExecution::Retry {
                        error,
                        charge_reserved,
                        estimated_cost_microusd,
                    } => finish_media_job(
                        path,
                        &job,
                        MediaJobFinish {
                            status: "pending",
                            error: Some(&error),
                            available_at_ms: now_millis()
                                .saturating_add(retry_delay_ms(job.attempts)),
                            estimated_cost_microusd,
                            charge_reserved,
                            refund_attempt: false,
                        },
                    ),
                    MediaJobExecution::Deferred {
                        error,
                        available_at_ms,
                        charge_reserved,
                        estimated_cost_microusd,
                    } => finish_media_job(
                        path,
                        &job,
                        MediaJobFinish {
                            status: "pending",
                            error: Some(&error),
                            available_at_ms,
                            estimated_cost_microusd,
                            charge_reserved,
                            refund_attempt: true,
                        },
                    ),
                    MediaJobExecution::Dead {
                        error,
                        charge_reserved,
                    } => finish_media_job(
                        path,
                        &job,
                        MediaJobFinish {
                            status: "dead",
                            error: Some(&error),
                            available_at_ms: 0,
                            estimated_cost_microusd: 0,
                            charge_reserved,
                            refund_attempt: false,
                        },
                    ),
                };
                if let Err(error) = result {
                    warn!(
                        job_id = job.id,
                        "could not persist media job outcome: {error}"
                    );
                }
            }
            Ok(MediaJobClaim::BudgetDeferred {
                job_key,
                available_at_ms,
            }) => {
                tracing::info!(
                    job_key,
                    available_at_ms,
                    daily_limit_microusd = budget.daily_limit_microusd,
                    "deferred media job until the next UTC budget window"
                );
            }
            Ok(MediaJobClaim::Empty) => tokio::time::sleep(MEDIA_JOB_IDLE_POLL).await,
            Err(error) => {
                warn!("durable media worker could not claim a job: {error}");
                tokio::time::sleep(MEDIA_JOB_IDLE_POLL).await;
            }
        }
    }
}

pub(super) fn start_media_job_worker(state: AppState) -> Option<tokio::task::JoinHandle<()>> {
    state.event_store_path.as_ref()?;
    state.avatar_art_config.as_ref().as_ref()?;
    let budget = MediaBudgetConfig::from_env();
    Some(tokio::spawn(async move {
        run_media_job_worker(state, budget).await;
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_payload(subject_id: u64) -> MediaJobPayload {
        MediaJobPayload::CommunityArt {
            actor_id: 5000,
            plan: Box::new(CommunityArtPlan {
                subject_kind: "actor".to_string(),
                subject_id,
                level: 1,
                generation_profile_version: 2,
                generation_policy: GeneratedPolicyBinding::default(),
                required_orbs: 1,
                history_through_seq: 10,
                prompt: "portrait".to_string(),
                aspect_ratio: "1:1".to_string(),
                image_policy: None,
                persisted_identity: "Queue Test".to_string(),
                persisted_visual_description: "a queue test subject".to_string(),
                stable_traits: Vec::new(),
                public_history: Vec::new(),
                evolution_job: None,
            }),
            estimated_cost_microusd: 50_000,
        }
    }

    fn test_store(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-media-jobs-{label}-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize media job store");
        path
    }

    #[test]
    fn daily_budget_defers_paid_work_without_claiming_an_attempt() {
        let path = test_store("daily-budget");
        let payload = test_payload(7001);
        enqueue_media_job(&path, &payload, Some(10)).expect("enqueue paid media job");
        let now = 12 * 86_400_000 + 1_000;
        let claim = claim_next_media_job(
            &path,
            MediaBudgetConfig {
                daily_limit_microusd: 49_999,
                community_image_estimated_cost_microusd: 50_000,
            },
            now,
        )
        .expect("defer over-budget media job");
        assert!(matches!(claim, MediaJobClaim::BudgetDeferred { .. }));
        let conn = open_event_store(&path).expect("inspect deferred job");
        let (status, attempts, available_at): (String, i64, i64) = conn
            .query_row(
                "SELECT status, attempts, available_at_ms FROM media_jobs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read deferred job");
        assert_eq!(status, "pending");
        assert_eq!(attempts, 0);
        assert_eq!(available_at as u64, next_utc_day_ms(now));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn zero_cost_review_jobs_run_after_the_generation_budget_is_spent() {
        let path = test_store("review-priority");
        let paid = test_payload(7002);
        let review = test_payload(7003);
        enqueue_media_job(&path, &paid, Some(11)).expect("enqueue paid job");
        enqueue_media_job(&path, &review, Some(12)).expect("enqueue review job");
        let conn = open_event_store(&path).expect("open media queue");
        conn.execute(
            "UPDATE media_jobs SET estimated_cost_microusd = 0 WHERE subject_id = 7003",
            [],
        )
        .expect("mark saved-candidate review free of image spend");
        drop(conn);
        let claim = claim_next_media_job(
            &path,
            MediaBudgetConfig {
                daily_limit_microusd: 0,
                community_image_estimated_cost_microusd: 50_000,
            },
            13 * 86_400_000 + 1_000,
        )
        .expect("claim zero-cost review");
        let MediaJobClaim::Claimed(job) = claim else {
            panic!("saved candidate should be claimed before paid work");
        };
        assert!(matches!(
            job.payload,
            MediaJobPayload::CommunityArt { plan, .. } if plan.subject_id == 7003
        ));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn a_deferred_provider_window_refunds_the_queue_attempt() {
        let path = test_store("attempt-refund");
        enqueue_media_job(&path, &test_payload(7004), Some(13)).expect("enqueue media job");
        let now = 14 * 86_400_000 + 1_000;
        let MediaJobClaim::Claimed(job) = claim_next_media_job(
            &path,
            MediaBudgetConfig {
                daily_limit_microusd: 50_000,
                community_image_estimated_cost_microusd: 50_000,
            },
            now,
        )
        .expect("claim media job") else {
            panic!("media job should be claimed");
        };
        finish_media_job(
            &path,
            &job,
            MediaJobFinish {
                status: "pending",
                error: Some("provider daily budget"),
                available_at_ms: now + 60_000,
                estimated_cost_microusd: 0,
                charge_reserved: true,
                refund_attempt: true,
            },
        )
        .expect("defer media job");
        let conn = open_event_store(&path).expect("inspect deferred media job");
        let attempts: i64 = conn
            .query_row("SELECT attempts FROM media_jobs", [], |row| row.get(0))
            .expect("read attempts");
        assert_eq!(attempts, 0);
        let (reserved, spent): (i64, i64) = conn
            .query_row(
                "SELECT reserved_microusd, spent_microusd FROM media_budget_days",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read media budget ledger");
        assert_eq!(reserved, 0);
        assert_eq!(spent, 50_000);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn an_expired_lease_charges_its_reservation_before_a_replacement_attempt() {
        let path = test_store("expired-lease");
        enqueue_media_job(&path, &test_payload(7006), Some(15)).expect("enqueue media job");
        let now = 15 * 86_400_000 + 1_000;
        let budget = MediaBudgetConfig {
            daily_limit_microusd: 100_000,
            community_image_estimated_cost_microusd: 50_000,
        };
        assert!(matches!(
            claim_next_media_job(&path, budget, now).expect("claim first worker"),
            MediaJobClaim::Claimed(_)
        ));
        let replacement =
            claim_next_media_job(&path, budget, now.saturating_add(MEDIA_JOB_LEASE_MS))
                .expect("reclaim expired worker");
        let MediaJobClaim::Claimed(replacement) = replacement else {
            panic!("replacement worker should fit inside the remaining budget");
        };
        assert_eq!(replacement.attempts, 2);
        let conn = open_event_store(&path).expect("inspect crash accounting");
        let (reserved, spent): (i64, i64) = conn
            .query_row(
                "SELECT reserved_microusd, spent_microusd FROM media_budget_days",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read crash-safe budget ledger");
        assert_eq!(reserved, 50_000);
        assert_eq!(spent, 50_000);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn a_changed_frozen_plan_reopens_a_terminal_job() {
        let path = test_store("changed-plan");
        let original = test_payload(7005);
        enqueue_media_job(&path, &original, Some(14)).expect("enqueue original plan");
        let conn = open_event_store(&path).expect("open media queue");
        conn.execute(
            "UPDATE media_jobs
             SET status = 'dead', attempts = 3, last_error = 'old plan failed'",
            [],
        )
        .expect("make original job terminal");
        drop(conn);

        assert!(
            !enqueue_media_job(&path, &original, None).expect("deduplicate unchanged plan"),
            "an unchanged plan must not reopen terminal work"
        );
        let mut changed = original.clone();
        let MediaJobPayload::CommunityArt { plan, .. } = &mut changed;
        plan.prompt = "portrait with a newly described blue scarf".to_string();
        assert!(
            enqueue_media_job(&path, &changed, None).expect("enqueue changed plan"),
            "a materially changed frozen plan should reopen the job"
        );

        let conn = open_event_store(&path).expect("inspect reopened media job");
        let (status, attempts, error): (String, i64, Option<String>) = conn
            .query_row(
                "SELECT status, attempts, last_error FROM media_jobs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read reopened job");
        assert_eq!(status, "pending");
        assert_eq!(attempts, 0);
        assert!(error.is_none());
        let _ = fs::remove_file(path);
    }
}
