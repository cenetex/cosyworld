use super::*;
use sha2::{Digest, Sha256};

pub(super) const STORY_METRICS_SCHEMA_VERSION: u32 = 2;
pub(super) const WORLD_BEAT_PRESENTATION_CONTRACT_VERSION: u32 = 1;
pub(super) const DEFAULT_STORY_METRICS_RETENTION_DAYS: u64 = 400;
const MAX_STORY_METRICS_RETENTION_DAYS: u64 = 3_650;
const STORY_METRICS_DAY_MS: u64 = 86_400_000;
const STORY_METRICS_BACKFILL_KEY: &str = "world_events_v1";
const STORY_METRICS_NAMESPACE: &str = "cosyworld.story-metrics/2";
const WORLD_BEAT_EXPOSURE_PREFIX: &str = "world-beat:v1:";
const RETURN_WINDOW_DAYS: u64 = 30;
const HEALTH_WINDOW_DAYS: u64 = 7;
const STALLED_EVENT_GAP: u64 = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct StoryMetricsRetention {
    pub(super) days: Option<u64>,
}

impl StoryMetricsRetention {
    pub(super) fn from_env() -> io::Result<Self> {
        let days = match std::env::var("COSYWORLD_STORY_METRICS_RETENTION_DAYS") {
            Ok(value) => {
                let value = value.trim();
                if value.eq_ignore_ascii_case("off")
                    || value.eq_ignore_ascii_case("none")
                    || value.eq_ignore_ascii_case("disabled")
                {
                    None
                } else {
                    let parsed = value.parse::<u64>().map_err(|_| {
                        io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "COSYWORLD_STORY_METRICS_RETENTION_DAYS must be a positive number of days or off",
                        )
                    })?;
                    if parsed == 0 {
                        None
                    } else {
                        Some(parsed.min(MAX_STORY_METRICS_RETENTION_DAYS))
                    }
                }
            }
            Err(_) => Some(DEFAULT_STORY_METRICS_RETENTION_DAYS),
        };
        Ok(Self { days })
    }

    fn cutoff_ms(self, now_ms: u64) -> Option<u64> {
        self.days
            .map(|days| now_ms.saturating_sub(days.saturating_mul(STORY_METRICS_DAY_MS)))
    }
}

impl Default for StoryMetricsRetention {
    fn default() -> Self {
        Self {
            days: Some(DEFAULT_STORY_METRICS_RETENTION_DAYS),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub(super) struct StoryMetricsReport {
    schema_version: u32,
    definitions_version: &'static str,
    funnel: Vec<VisitFunnelCohort>,
    return_comparisons: Vec<ReturnComparison>,
    health: StoryHealthReport,
    recent_events: Vec<StoryMetricEventView>,
    unsupported_schema_event_count: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct StoryMetricDeletionResponse {
    ok: bool,
    status: u32,
    player_ref: String,
    deleted_event_count: usize,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct VisitFunnelCohort {
    cohort: String,
    first_visit_players: u64,
    second_visit_players: u64,
    third_visit_players: u64,
    seventh_visit_players: u64,
    first_to_second_rate: Option<f64>,
    first_to_third_rate: Option<f64>,
    first_to_seventh_rate: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
struct ReturnComparison {
    signal: String,
    exposed_players: u64,
    complete_window_players: u64,
    pending_window_players: u64,
    returned_players: u64,
    return_rate: Option<f64>,
    return_window_days: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
struct StoryHealthReport {
    generated_at_ms: u64,
    unanswered_beat_count: u64,
    unanswered_beat_refs: Vec<String>,
    stalled_job_count: usize,
    stalled_job_refs: Vec<String>,
    stranded_unique_item_count: u64,
    stranded_unique_item_refs: Vec<String>,
    rooms_without_meaningful_action_count: usize,
    room_refs_without_meaningful_action: Vec<String>,
    health_window_days: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct StoryMetricEventView {
    event_id: String,
    schema_version: u32,
    world_ref: String,
    player_ref: String,
    session_ref: String,
    pub(super) event_kind: String,
    source_event_seq: Option<u64>,
    location_ref: Option<String>,
    target_player_ref: Option<String>,
    subject_ref: Option<String>,
    attributes: serde_json::Value,
    occurred_at_ms: u64,
}

#[derive(Clone, Debug)]
struct NewStoryMetric<'a> {
    event_id: String,
    player_ref: &'a str,
    session_ref: &'a str,
    event_kind: &'a str,
    source_event_seq: Option<u64>,
    location_ref: Option<&'a str>,
    target_player_ref: Option<&'a str>,
    subject_ref: Option<&'a str>,
    attributes: serde_json::Value,
    occurred_at_ms: u64,
}

pub(super) fn init_story_metrics_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS story_metric_events (
            event_id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL,
            world_ref TEXT NOT NULL,
            player_ref TEXT NOT NULL,
            session_ref TEXT NOT NULL,
            event_kind TEXT NOT NULL,
            source_event_seq INTEGER,
            location_ref TEXT,
            target_player_ref TEXT,
            subject_ref TEXT,
            attributes_json TEXT NOT NULL,
            occurred_at_ms INTEGER NOT NULL,
            ingested_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_story_metrics_player_time
            ON story_metric_events(player_ref, occurred_at_ms);
        CREATE INDEX IF NOT EXISTS idx_story_metrics_kind_time
            ON story_metric_events(event_kind, occurred_at_ms);
        CREATE INDEX IF NOT EXISTS idx_story_metrics_session_kind
            ON story_metric_events(session_ref, event_kind);
        CREATE INDEX IF NOT EXISTS idx_story_metrics_subject
            ON story_metric_events(subject_ref, event_kind, occurred_at_ms);
        CREATE TABLE IF NOT EXISTS story_metric_backfills (
            backfill_key TEXT PRIMARY KEY,
            created_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(sqlite_error)?;
    backfill_story_metrics_from_world_events(conn)
}

pub(super) fn story_world_ref() -> String {
    story_opaque_ref(
        "world",
        &format!("{}:{}", OFFICIAL_WORLD_ID, OFFICIAL_WORLD_EPOCH),
    )
}

pub(super) fn story_player_ref(actor_id: u64) -> String {
    story_opaque_ref(
        "player",
        &format!("{}:{}:{actor_id}", OFFICIAL_WORLD_ID, OFFICIAL_WORLD_EPOCH),
    )
}

fn story_session_ref(player_ref: &str, day_index: u64) -> String {
    story_opaque_ref("visit", &format!("{player_ref}:{day_index}"))
}

fn story_location_ref(location_id: u64) -> String {
    story_opaque_ref(
        "location",
        &format!(
            "{}:{}:{location_id}",
            OFFICIAL_WORLD_ID, OFFICIAL_WORLD_EPOCH
        ),
    )
}

fn story_subject_ref(kind: &str, value: impl std::fmt::Display) -> String {
    story_opaque_ref(kind, &value.to_string())
}

fn story_opaque_ref(kind: &str, raw: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(STORY_METRICS_NAMESPACE.as_bytes());
    digest.update([0]);
    digest.update(kind.as_bytes());
    digest.update([0]);
    digest.update(raw.as_bytes());
    format!("{kind}:v1:{:x}", digest.finalize())
}

fn story_event_id(parts: &[&str]) -> String {
    let raw = parts.join("\0");
    story_opaque_ref("event", &raw)
}

fn story_day_index(now_ms: u64) -> u64 {
    now_ms / STORY_METRICS_DAY_MS
}

pub(super) fn record_story_visit(state: &AppState, actor_id: u64) {
    let Some(path) = state.event_store_path.as_deref() else {
        return;
    };
    if let Err(error) = record_story_visit_at(path, actor_id, now_millis()) {
        warn!(
            "failed to append CosyWorld story visit metric to {}: {}",
            path.display(),
            error
        );
    }
}

fn record_story_visit_at(path: &Path, actor_id: u64, now_ms: u64) -> io::Result<()> {
    init_event_store(path)?;
    let mut conn = open_event_store(path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let player_ref = story_player_ref(actor_id);
    let day_index = story_day_index(now_ms);
    let session_ref = story_session_ref(&player_ref, day_index);
    let visit_number = count_player_visits(&tx, &player_ref)?.saturating_add(1);
    let inserted = insert_story_metric(
        &tx,
        NewStoryMetric {
            event_id: story_event_id(&["visit_started", &player_ref, &day_index.to_string()]),
            player_ref: &player_ref,
            session_ref: &session_ref,
            event_kind: "visit_started",
            source_event_seq: None,
            location_ref: None,
            target_player_ref: None,
            subject_ref: None,
            attributes: serde_json::json!({
                "day_index": day_index,
                "visit_number": visit_number,
            }),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;
    if inserted && visit_number == 7 {
        insert_story_metric(
            &tx,
            NewStoryMetric {
                event_id: story_event_id(&["seventh_visit_reached", &player_ref]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind: "seventh_visit_reached",
                source_event_seq: None,
                location_ref: None,
                target_player_ref: None,
                subject_ref: None,
                attributes: serde_json::json!({ "visit_number": 7 }),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
    }
    tx.commit().map_err(sqlite_error)
}

fn count_player_visits(conn: &Connection, player_ref: &str) -> io::Result<u64> {
    let count = conn
        .query_row(
            "SELECT COUNT(*) FROM story_metric_events
             WHERE schema_version = ?1 AND player_ref = ?2 AND event_kind = 'visit_started'",
            params![STORY_METRICS_SCHEMA_VERSION, player_ref],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    Ok(count.max(0) as u64)
}

fn insert_story_metric(
    conn: &Connection,
    metric: NewStoryMetric<'_>,
    ingested_at_ms: u64,
) -> io::Result<bool> {
    if metric.event_kind == "world_beat_answered" {
        let Some(subject_ref) = metric.subject_ref else {
            return Ok(false);
        };
        let has_seen = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM story_metric_events
                    WHERE schema_version = ?1
                      AND event_kind = 'world_beat_seen'
                      AND player_ref = ?2
                      AND subject_ref = ?3
                 )",
                params![STORY_METRICS_SCHEMA_VERSION, metric.player_ref, subject_ref],
                |row| row.get::<_, bool>(0),
            )
            .map_err(sqlite_error)?;
        if !has_seen {
            return Ok(false);
        }
    }
    let attributes_json = serde_json::to_string(&metric.attributes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO story_metric_events
                (event_id, schema_version, world_ref, player_ref, session_ref,
                 event_kind, source_event_seq, location_ref, target_player_ref,
                 subject_ref, attributes_json, occurred_at_ms, ingested_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                metric.event_id,
                STORY_METRICS_SCHEMA_VERSION,
                story_world_ref(),
                metric.player_ref,
                metric.session_ref,
                metric.event_kind,
                metric.source_event_seq.map(|value| value as i64),
                metric.location_ref,
                metric.target_player_ref,
                metric.subject_ref,
                attributes_json,
                metric.occurred_at_ms as i64,
                ingested_at_ms as i64,
            ],
        )
        .map_err(sqlite_error)?;
    Ok(changed == 1)
}

pub(super) fn purge_expired_story_metrics_for_retention(
    path: &Path,
    retention: StoryMetricsRetention,
) -> io::Result<usize> {
    let Some(cutoff_ms) = retention.cutoff_ms(now_millis()) else {
        return Ok(0);
    };
    let conn = open_event_store(path)?;
    init_story_metrics_store(&conn)?;
    conn.execute(
        "DELETE FROM story_metric_events WHERE occurred_at_ms < ?1",
        params![cutoff_ms as i64],
    )
    .map_err(sqlite_error)
}

pub(super) fn record_story_metrics_for_journal_in_transaction(
    conn: &Connection,
    runtime: &RuntimeWorld,
    record: &JournalRecord,
    events: &[EventView],
    co_present_human_count: usize,
    now_ms: u64,
) -> io::Result<()> {
    let actor_id = record.action.actor_id;
    let Some(actor) = runtime
        .actor_by_id(actor_id)
        .filter(|actor| actor.kind == CW_ACTOR_HUMAN)
    else {
        return Ok(());
    };
    let player_ref = story_player_ref(actor_id);
    let session_ref = story_session_ref(&player_ref, story_day_index(now_ms));
    let location_id = events
        .iter()
        .find_map(|event| event.destination_location_id.or(event.location_id))
        .unwrap_or(actor.location_id);
    let location_ref = story_location_ref(location_id);

    if let Some(grant) = record.hosted_access_grant.as_ref() {
        let hosted_location_ref = location_ref.clone();
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[
                    "hosted_guest_entry",
                    &player_ref,
                    &grant.candidate.party_id,
                    &hosted_location_ref,
                ]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind: "hosted_guest_entry",
                source_event_seq: events.iter().map(|event| event.seq).max(),
                location_ref: Some(&hosted_location_ref),
                target_player_ref: None,
                subject_ref: Some(&story_subject_ref("party", &grant.candidate.party_id)),
                attributes: serde_json::json!({ "access_mode": "hosted_guest" }),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
    }

    if record.origin == JournalOrigin::System && record.action.kind == CW_ACTION_DROP_ITEM {
        let item_ref = story_subject_ref("item", record.action.item_id);
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[
                    "item_stranded",
                    &item_ref,
                    &events
                        .iter()
                        .map(|event| event.seq)
                        .max()
                        .unwrap_or_default()
                        .to_string(),
                ]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind: "item_stranded",
                source_event_seq: events.iter().map(|event| event.seq).max(),
                location_ref: Some(&location_ref),
                target_player_ref: None,
                subject_ref: Some(&item_ref),
                attributes: serde_json::json!({ "reason_code": "inactive_holder_release" }),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
        return Ok(());
    }

    if !matches!(
        record.origin,
        JournalOrigin::PlayerCard | JournalOrigin::Speech
    ) {
        return Ok(());
    }
    let Some(primary) = events
        .iter()
        .find(|event| story_event_counts_as_meaningful(event, actor_id))
    else {
        return Ok(());
    };
    let action_category = story_action_category(primary);
    let source_seq = primary.seq;
    insert_story_metric(
        conn,
        NewStoryMetric {
            event_id: story_event_id(&[
                "meaningful_action_completed",
                &player_ref,
                &source_seq.to_string(),
            ]),
            player_ref: &player_ref,
            session_ref: &session_ref,
            event_kind: "meaningful_action_completed",
            source_event_seq: Some(source_seq),
            location_ref: Some(&location_ref),
            target_player_ref: None,
            subject_ref: None,
            attributes: serde_json::json!({
                "action_category": action_category,
                "co_present_human_count": co_present_human_count,
            }),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;
    insert_story_metric(
        conn,
        NewStoryMetric {
            event_id: story_event_id(&[
                "public_trace_created",
                &player_ref,
                &source_seq.to_string(),
            ]),
            player_ref: &player_ref,
            session_ref: &session_ref,
            event_kind: "public_trace_created",
            source_event_seq: Some(source_seq),
            location_ref: Some(&location_ref),
            target_player_ref: None,
            subject_ref: None,
            attributes: serde_json::json!({ "trace_kind": action_category }),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;

    if co_present_human_count >= 2 {
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[
                    "co_presence_observed",
                    &player_ref,
                    &source_seq.to_string(),
                ]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind: "co_presence_observed",
                source_event_seq: Some(source_seq),
                location_ref: Some(&location_ref),
                target_player_ref: None,
                subject_ref: None,
                attributes: serde_json::json!({
                    "active_human_count": co_present_human_count,
                }),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
    }

    let target_player_ref = events.iter().find_map(|event| {
        let target_id = event.target_actor_id?;
        runtime
            .actor_by_id(target_id)
            .filter(|target| target.kind == CW_ACTOR_HUMAN)
            .map(|_| story_player_ref(target_id))
    });
    if let Some(target_player_ref) = target_player_ref.as_deref() {
        insert_story_interaction_and_reciprocity(
            conn,
            &player_ref,
            target_player_ref,
            &session_ref,
            &location_ref,
            source_seq,
            now_ms,
        )?;
    }

    if events.iter().any(|event| {
        matches!(
            event.type_name.as_str(),
            "bond.created" | "bond.deepened" | "bond.revised" | "bond.resolved"
        )
    }) {
        insert_signal_metric(
            conn,
            "friend_bond_change",
            &player_ref,
            &session_ref,
            &location_ref,
            source_seq,
            now_ms,
        )?;
    }
    if events
        .iter()
        .any(|event| event.type_name == "item.crafted" && event.success)
    {
        insert_signal_metric(
            conn,
            "pact_contribution",
            &player_ref,
            &session_ref,
            &location_ref,
            source_seq,
            now_ms,
        )?;
    }
    if events
        .iter()
        .any(|event| event.type_name == "job.updated" && event.success)
    {
        insert_signal_metric(
            conn,
            "job_front_contribution",
            &player_ref,
            &session_ref,
            &location_ref,
            source_seq,
            now_ms,
        )?;
    }
    if record.action.kind == CW_ACTION_PICK_UP_ITEM {
        record_item_recovered_if_stranded(
            conn,
            &player_ref,
            &session_ref,
            &location_ref,
            record.action.item_id,
            source_seq,
            now_ms,
        )?;
    }
    record_world_beat_answer_if_seen(
        conn,
        &player_ref,
        &session_ref,
        &location_ref,
        source_seq,
        now_ms,
    )
}

fn insert_signal_metric(
    conn: &Connection,
    event_kind: &str,
    player_ref: &str,
    session_ref: &str,
    location_ref: &str,
    source_seq: u64,
    now_ms: u64,
) -> io::Result<()> {
    insert_story_metric(
        conn,
        NewStoryMetric {
            event_id: story_event_id(&[event_kind, player_ref, &source_seq.to_string()]),
            player_ref,
            session_ref,
            event_kind,
            source_event_seq: Some(source_seq),
            location_ref: Some(location_ref),
            target_player_ref: None,
            subject_ref: None,
            attributes: serde_json::json!({}),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;
    Ok(())
}

fn insert_story_interaction_and_reciprocity(
    conn: &Connection,
    player_ref: &str,
    target_player_ref: &str,
    session_ref: &str,
    location_ref: &str,
    source_seq: u64,
    now_ms: u64,
) -> io::Result<()> {
    let reciprocal_source = conn
        .query_row(
            "SELECT source_event_seq FROM story_metric_events
             WHERE schema_version = ?1 AND event_kind = 'interaction_completed'
               AND player_ref = ?2 AND target_player_ref = ?3
               AND occurred_at_ms >= ?4
             ORDER BY occurred_at_ms DESC LIMIT 1",
            params![
                STORY_METRICS_SCHEMA_VERSION,
                target_player_ref,
                player_ref,
                now_ms.saturating_sub(RETURN_WINDOW_DAYS * STORY_METRICS_DAY_MS) as i64,
            ],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(sqlite_error)?
        .flatten()
        .map(|value| value.max(0) as u64);
    insert_story_metric(
        conn,
        NewStoryMetric {
            event_id: story_event_id(&[
                "interaction_completed",
                player_ref,
                target_player_ref,
                &source_seq.to_string(),
            ]),
            player_ref,
            session_ref,
            event_kind: "interaction_completed",
            source_event_seq: Some(source_seq),
            location_ref: Some(location_ref),
            target_player_ref: Some(target_player_ref),
            subject_ref: None,
            attributes: serde_json::json!({}),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;
    if let Some(reciprocal_source) = reciprocal_source {
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[
                    "reciprocal_interaction",
                    player_ref,
                    target_player_ref,
                    &reciprocal_source.to_string(),
                    &source_seq.to_string(),
                ]),
                player_ref,
                session_ref,
                event_kind: "reciprocal_interaction",
                source_event_seq: Some(source_seq),
                location_ref: Some(location_ref),
                target_player_ref: Some(target_player_ref),
                subject_ref: None,
                attributes: serde_json::json!({
                    "responded_to_event_seq": reciprocal_source,
                }),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
    }
    Ok(())
}

fn record_item_recovered_if_stranded(
    conn: &Connection,
    player_ref: &str,
    session_ref: &str,
    location_ref: &str,
    item_id: u64,
    source_seq: u64,
    now_ms: u64,
) -> io::Result<()> {
    let item_ref = story_subject_ref("item", item_id);
    let open_stranded = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM story_metric_events stranded
                WHERE stranded.schema_version = ?1
                  AND stranded.event_kind = 'item_stranded'
                  AND stranded.subject_ref = ?2
                  AND NOT EXISTS (
                    SELECT 1 FROM story_metric_events recovered
                    WHERE recovered.schema_version = ?1
                      AND recovered.event_kind = 'item_recovered'
                      AND recovered.subject_ref = stranded.subject_ref
                      AND recovered.occurred_at_ms >= stranded.occurred_at_ms
                  )
             )",
            params![STORY_METRICS_SCHEMA_VERSION, item_ref],
            |row| row.get::<_, bool>(0),
        )
        .map_err(sqlite_error)?;
    if open_stranded {
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&["item_recovered", &item_ref, &source_seq.to_string()]),
                player_ref,
                session_ref,
                event_kind: "item_recovered",
                source_event_seq: Some(source_seq),
                location_ref: Some(location_ref),
                target_player_ref: None,
                subject_ref: Some(&item_ref),
                attributes: serde_json::json!({}),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
    }
    Ok(())
}

fn record_world_beat_answer_if_seen(
    conn: &Connection,
    player_ref: &str,
    session_ref: &str,
    location_ref: &str,
    source_seq: u64,
    now_ms: u64,
) -> io::Result<()> {
    let seen_beat = conn
        .query_row(
            "SELECT source_event_seq, subject_ref FROM story_metric_events seen
             WHERE seen.schema_version = ?1 AND seen.event_kind = 'world_beat_seen'
               AND seen.player_ref = ?2 AND seen.location_ref = ?3
               AND seen.source_event_seq IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM story_metric_events answered
                 WHERE answered.schema_version = ?1
                   AND answered.event_kind = 'world_beat_answered'
                   AND answered.player_ref = seen.player_ref
                   AND answered.subject_ref = seen.subject_ref
               )
             ORDER BY seen.occurred_at_ms DESC LIMIT 1",
            params![STORY_METRICS_SCHEMA_VERSION, player_ref, location_ref],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(sqlite_error)?;
    if let Some((beat_seq, beat_ref)) = seen_beat {
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&["world_beat_answered", player_ref, &beat_ref]),
                player_ref,
                session_ref,
                event_kind: "world_beat_answered",
                source_event_seq: Some(source_seq),
                location_ref: Some(location_ref),
                target_player_ref: None,
                subject_ref: Some(&beat_ref),
                attributes: serde_json::json!({
                    "beat_event_seq": beat_seq.max(0) as u64,
                    "response_event_seq": source_seq,
                }),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )?;
    }
    Ok(())
}

pub(super) fn world_beat_exposure_id(source_event_seq: u64) -> String {
    format!("{WORLD_BEAT_EXPOSURE_PREFIX}{source_event_seq}")
}

pub(super) fn world_beat_exposure_seq(exposure_id: &str) -> Option<u64> {
    let source_event_seq = exposure_id
        .strip_prefix(WORLD_BEAT_EXPOSURE_PREFIX)?
        .parse::<u64>()
        .ok()?;
    (source_event_seq > 0 && world_beat_exposure_id(source_event_seq) == exposure_id)
        .then_some(source_event_seq)
}

pub(super) fn world_beat_is_renderable(event: &EventView) -> bool {
    event.seq > 0
        && event.success
        && event.location_id.is_some()
        && event
            .content
            .as_deref()
            .is_some_and(|content| !content.trim().is_empty())
        && matches!(
            event.type_name.as_str(),
            "world.weather.shifted"
                | "world.weather.held"
                | "world.trade.flowed"
                | "world.trade.disrupted"
                | "world.faction.influence_shifted"
                | "world.conflict.pressure_grew"
                | "world.conflict.pressure_eased"
                | "world.conflict.escalated"
        )
}

pub(super) fn valid_world_beat_transport(transport: &str) -> bool {
    matches!(transport, "browser" | "cli" | "agent")
}

pub(super) fn record_world_beat_exposure_at(
    path: &Path,
    actor_id: u64,
    event: &EventView,
    exposure_id: &str,
    transport: &str,
    state_revision: u64,
    now_ms: u64,
) -> io::Result<bool> {
    if !world_beat_is_renderable(event)
        || world_beat_exposure_seq(exposure_id) != Some(event.seq)
        || !valid_world_beat_transport(transport)
        || state_revision < event.seq
    {
        return Ok(false);
    }
    let location_id = event.location_id.expect("renderable beat has a location");
    init_event_store(path)?;
    let mut conn = open_event_store(path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let player_ref = story_player_ref(actor_id);
    let session_ref = story_session_ref(&player_ref, story_day_index(now_ms));
    let location_ref = story_location_ref(location_id);
    let beat_ref = story_subject_ref("beat", exposure_id);
    let inserted = insert_story_metric(
        &tx,
        NewStoryMetric {
            event_id: story_event_id(&["world_beat_seen", &player_ref, &beat_ref]),
            player_ref: &player_ref,
            session_ref: &session_ref,
            event_kind: "world_beat_seen",
            source_event_seq: Some(event.seq),
            location_ref: Some(&location_ref),
            target_player_ref: None,
            subject_ref: Some(&beat_ref),
            attributes: serde_json::json!({
                "beat_kind": story_world_beat_kind(&event.type_name),
                "exposure_id": exposure_id,
                "presentation_contract_version": WORLD_BEAT_PRESENTATION_CONTRACT_VERSION,
                "state_revision": state_revision,
                "transport": transport,
            }),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;
    tx.commit().map_err(sqlite_error)?;
    Ok(inserted)
}

pub(super) fn record_story_access_outcome(
    path: &Path,
    guest_actor_id: u64,
    location_id: u64,
    access_mode: &str,
    outcome: &str,
    now_ms: u64,
) -> io::Result<()> {
    if access_mode != "denied" || outcome != "denied" {
        return Ok(());
    }
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let player_ref = story_player_ref(guest_actor_id);
    let session_ref = story_session_ref(&player_ref, story_day_index(now_ms));
    let location_ref = story_location_ref(location_id);
    insert_story_metric(
        &conn,
        NewStoryMetric {
            event_id: story_event_id(&[
                "entitlement_denial",
                &player_ref,
                &session_ref,
                &location_ref,
            ]),
            player_ref: &player_ref,
            session_ref: &session_ref,
            event_kind: "entitlement_denial",
            source_event_seq: None,
            location_ref: Some(&location_ref),
            target_player_ref: None,
            subject_ref: None,
            attributes: serde_json::json!({ "access_mode": "denied" }),
            occurred_at_ms: now_ms,
        },
        now_ms,
    )?;
    Ok(())
}

fn story_event_counts_as_meaningful(event: &EventView, actor_id: u64) -> bool {
    event.success
        && event.actor_id == Some(actor_id)
        && !matches!(
            event.type_name.as_str(),
            "actor.created"
                | "actor.moved"
                | "actor.entered_location"
                | "actor.presence"
                | "hand.shuffled"
                | "ability_check.rolled"
                | "action.receipt"
                | "turn.ping_started"
                | "turn.pong"
                | "turn.ping_skipped"
                | "turn.timeout_requested"
                | "turn.timeout_passed"
                | "turn.waiting"
                | "world.bootstrapped"
                | "world.reset"
        )
        && !event.type_name.starts_with("world.")
}

fn story_action_category(event: &EventView) -> &'static str {
    match event.type_name.as_str() {
        "message.created" => "social",
        type_name if type_name.starts_with("bond.") => "friendship",
        "job.updated" | "clock.updated" => "shared_work",
        type_name if type_name.starts_with("item.") => "item_care",
        type_name if type_name.starts_with("combat.") => "conflict",
        "feature.searched" | "location.searched" | "exit.discovered" | "avatar.discovered" => {
            "discovery"
        }
        "ledger.marked" | "ledger.banked" | "advancement.spent" | "skill.stepped" => "growth",
        _ => "world_action",
    }
}

fn story_world_beat_kind(type_name: &str) -> &'static str {
    if type_name.starts_with("world.trade.") {
        "trade"
    } else if type_name.starts_with("world.faction.") {
        "faction"
    } else if type_name.starts_with("world.conflict.") {
        "conflict"
    } else if type_name == "world.weather.shifted" {
        "weather"
    } else {
        "world"
    }
}

pub(super) fn read_story_metrics_report(
    path: &Path,
    runtime: &RuntimeWorld,
    limit: usize,
    now_ms: u64,
) -> io::Result<StoryMetricsReport> {
    let conn = open_event_store(path)?;
    init_story_metrics_store(&conn)?;
    Ok(StoryMetricsReport {
        schema_version: STORY_METRICS_SCHEMA_VERSION,
        definitions_version: STORY_METRICS_NAMESPACE,
        funnel: read_visit_funnel(&conn)?,
        return_comparisons: read_return_comparisons(&conn, now_ms)?,
        health: read_story_health(&conn, runtime, now_ms)?,
        recent_events: read_recent_story_metrics(&conn, limit)?,
        unsupported_schema_event_count: count_unsupported_story_metric_schemas(&conn)?,
    })
}

pub(super) async fn delete_story_metrics_for_player(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(player_ref): AxumPath<String>,
) -> Json<StoryMetricDeletionResponse> {
    if !moderation_authorized(&state, &headers) {
        return Json(StoryMetricDeletionResponse {
            ok: false,
            status: 403,
            player_ref,
            deleted_event_count: 0,
            error: Some("moderation bearer token required".to_string()),
        });
    }
    if !valid_story_player_ref(&player_ref) {
        return Json(StoryMetricDeletionResponse {
            ok: false,
            status: 400,
            player_ref,
            deleted_event_count: 0,
            error: Some("invalid story metric player reference".to_string()),
        });
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(StoryMetricDeletionResponse {
            ok: false,
            status: 503,
            player_ref,
            deleted_event_count: 0,
            error: Some("event store is required for story metric deletion".to_string()),
        });
    };
    let result = delete_story_metrics_for_player_at(path, &player_ref);
    match result {
        Ok(deleted_event_count) => Json(StoryMetricDeletionResponse {
            ok: true,
            status: 200,
            player_ref,
            deleted_event_count,
            error: None,
        }),
        Err(error) => Json(StoryMetricDeletionResponse {
            ok: false,
            status: 500,
            player_ref,
            deleted_event_count: 0,
            error: Some(error.to_string()),
        }),
    }
}

fn delete_story_metrics_for_player_at(path: &Path, player_ref: &str) -> io::Result<usize> {
    let conn = open_event_store(path)?;
    init_story_metrics_store(&conn)?;
    conn.execute(
        "DELETE FROM story_metric_events
         WHERE player_ref = ?1 OR target_player_ref = ?1",
        params![player_ref],
    )
    .map_err(sqlite_error)
}

fn valid_story_player_ref(value: &str) -> bool {
    value.strip_prefix("player:v1:").is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn read_visit_funnel(conn: &Connection) -> io::Result<Vec<VisitFunnelCohort>> {
    let mut stmt = conn
        .prepare(
            "SELECT player_ref, occurred_at_ms
             FROM story_metric_events
             WHERE schema_version = ?1 AND event_kind = 'visit_started'
             ORDER BY player_ref, occurred_at_ms",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![STORY_METRICS_SCHEMA_VERSION], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(sqlite_error)?;
    let mut players = BTreeMap::<String, Vec<u64>>::new();
    for row in rows {
        let (player_ref, occurred_at_ms) = row.map_err(sqlite_error)?;
        players
            .entry(player_ref)
            .or_default()
            .push(occurred_at_ms.max(0) as u64);
    }
    let mut cohorts = BTreeMap::<u64, [u64; 4]>::new();
    for visits in players.values() {
        let Some(first_visit_ms) = visits.first().copied() else {
            continue;
        };
        let utc_week = story_day_index(first_visit_ms) / 7;
        let counts = cohorts.entry(utc_week).or_default();
        counts[0] = counts[0].saturating_add(1);
        if visits.len() >= 2 {
            counts[1] = counts[1].saturating_add(1);
        }
        if visits.len() >= 3 {
            counts[2] = counts[2].saturating_add(1);
        }
        if visits.len() >= 7 {
            counts[3] = counts[3].saturating_add(1);
        }
    }
    Ok(cohorts
        .into_iter()
        .map(|(utc_week, counts)| VisitFunnelCohort {
            cohort: format!("utc_week:{utc_week}"),
            first_visit_players: counts[0],
            second_visit_players: counts[1],
            third_visit_players: counts[2],
            seventh_visit_players: counts[3],
            first_to_second_rate: story_ratio(counts[1], counts[0]),
            first_to_third_rate: story_ratio(counts[2], counts[0]),
            first_to_seventh_rate: story_ratio(counts[3], counts[0]),
        })
        .collect())
}

fn read_return_comparisons(conn: &Connection, now_ms: u64) -> io::Result<Vec<ReturnComparison>> {
    [
        ("solo_play", "meaningful_action_completed", true),
        ("co_presence", "co_presence_observed", false),
        ("pact_contribution", "pact_contribution", false),
        ("friend_bond_change", "friend_bond_change", false),
        ("world_beat_response", "world_beat_answered", false),
    ]
    .into_iter()
    .map(|(label, event_kind, solo_only)| {
        read_return_comparison(conn, label, event_kind, solo_only, now_ms)
    })
    .collect()
}

fn read_return_comparison(
    conn: &Connection,
    label: &str,
    event_kind: &str,
    solo_only: bool,
    now_ms: u64,
) -> io::Result<ReturnComparison> {
    let solo_predicate = if solo_only {
        "AND NOT EXISTS (
            SELECT 1 FROM story_metric_events co
            WHERE co.schema_version = exposure.schema_version
              AND co.event_kind = 'co_presence_observed'
              AND co.session_ref = exposure.session_ref
        )"
    } else {
        ""
    };
    let query = format!(
        "WITH first_exposure AS (
            SELECT exposure.player_ref, MIN(exposure.occurred_at_ms) AS exposed_at_ms
            FROM story_metric_events exposure
            WHERE exposure.schema_version = ?1 AND exposure.event_kind = ?2
              {solo_predicate}
            GROUP BY exposure.player_ref
         ), complete_window AS (
            SELECT player_ref, exposed_at_ms FROM first_exposure
            WHERE exposed_at_ms <= ?4
         ), returned AS (
            SELECT DISTINCT complete_window.player_ref
            FROM complete_window
            JOIN story_metric_events visit
              ON visit.player_ref = complete_window.player_ref
             AND visit.schema_version = ?1
             AND visit.event_kind = 'visit_started'
             AND visit.occurred_at_ms > complete_window.exposed_at_ms
             AND visit.occurred_at_ms <= complete_window.exposed_at_ms + ?3
         )
         SELECT (SELECT COUNT(*) FROM first_exposure),
                (SELECT COUNT(*) FROM complete_window),
                (SELECT COUNT(*) FROM returned)"
    );
    let (exposed, complete_window, returned) = conn
        .query_row(
            &query,
            params![
                STORY_METRICS_SCHEMA_VERSION,
                event_kind,
                (RETURN_WINDOW_DAYS * STORY_METRICS_DAY_MS) as i64,
                now_ms.saturating_sub(RETURN_WINDOW_DAYS * STORY_METRICS_DAY_MS) as i64,
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(sqlite_error)?;
    let exposed = exposed.max(0) as u64;
    let complete_window = complete_window.max(0) as u64;
    let returned = returned.max(0) as u64;
    Ok(ReturnComparison {
        signal: label.to_string(),
        exposed_players: exposed,
        complete_window_players: complete_window,
        pending_window_players: exposed.saturating_sub(complete_window),
        returned_players: returned,
        return_rate: story_ratio(returned, complete_window),
        return_window_days: RETURN_WINDOW_DAYS,
    })
}

fn read_story_health(
    conn: &Connection,
    runtime: &RuntimeWorld,
    now_ms: u64,
) -> io::Result<StoryHealthReport> {
    let unanswered_beat_refs = read_unanswered_beat_refs(conn, 50)?;
    let stranded_unique_item_refs = read_stranded_item_refs(conn, 50)?;
    let stalled_job_refs = stalled_job_refs(runtime);
    let room_refs_without_meaningful_action =
        rooms_without_recent_meaningful_action(conn, runtime, now_ms)?;
    Ok(StoryHealthReport {
        generated_at_ms: now_ms,
        unanswered_beat_count: count_unanswered_beats(conn)?,
        unanswered_beat_refs,
        stalled_job_count: stalled_job_refs.len(),
        stalled_job_refs,
        stranded_unique_item_count: count_stranded_items(conn)?,
        stranded_unique_item_refs,
        rooms_without_meaningful_action_count: room_refs_without_meaningful_action.len(),
        room_refs_without_meaningful_action,
        health_window_days: HEALTH_WINDOW_DAYS,
    })
}

fn count_unanswered_beats(conn: &Connection) -> io::Result<u64> {
    let count = conn
        .query_row(
            "SELECT COUNT(DISTINCT seen.subject_ref)
             FROM story_metric_events seen
             WHERE seen.schema_version = ?1 AND seen.event_kind = 'world_beat_seen'
               AND seen.subject_ref IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM story_metric_events answered
                 WHERE answered.schema_version = ?1
                   AND answered.event_kind = 'world_beat_answered'
                   AND answered.player_ref = seen.player_ref
                   AND answered.subject_ref = seen.subject_ref
               )",
            params![STORY_METRICS_SCHEMA_VERSION],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    Ok(count.max(0) as u64)
}

fn count_stranded_items(conn: &Connection) -> io::Result<u64> {
    let count = conn
        .query_row(
            "SELECT COUNT(DISTINCT stranded.subject_ref)
             FROM story_metric_events stranded
             WHERE stranded.schema_version = ?1 AND stranded.event_kind = 'item_stranded'
               AND stranded.subject_ref IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM story_metric_events recovered
                 WHERE recovered.schema_version = ?1
                   AND recovered.event_kind = 'item_recovered'
                   AND recovered.subject_ref = stranded.subject_ref
                   AND recovered.occurred_at_ms >= stranded.occurred_at_ms
               )",
            params![STORY_METRICS_SCHEMA_VERSION],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    Ok(count.max(0) as u64)
}

fn read_unanswered_beat_refs(conn: &Connection, limit: usize) -> io::Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT seen.subject_ref
             FROM story_metric_events seen
             WHERE seen.schema_version = ?1 AND seen.event_kind = 'world_beat_seen'
               AND seen.subject_ref IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM story_metric_events answered
                 WHERE answered.schema_version = ?1
                   AND answered.event_kind = 'world_beat_answered'
                   AND answered.player_ref = seen.player_ref
                   AND answered.subject_ref = seen.subject_ref
               )
             ORDER BY seen.occurred_at_ms DESC LIMIT ?2",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![STORY_METRICS_SCHEMA_VERSION, limit as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn read_stranded_item_refs(conn: &Connection, limit: usize) -> io::Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT stranded.subject_ref
             FROM story_metric_events stranded
             WHERE stranded.schema_version = ?1 AND stranded.event_kind = 'item_stranded'
               AND stranded.subject_ref IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM story_metric_events recovered
                 WHERE recovered.schema_version = ?1
                   AND recovered.event_kind = 'item_recovered'
                   AND recovered.subject_ref = stranded.subject_ref
                   AND recovered.occurred_at_ms >= stranded.occurred_at_ms
               )
             ORDER BY stranded.occurred_at_ms DESC LIMIT ?2",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![STORY_METRICS_SCHEMA_VERSION, limit as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn stalled_job_refs(runtime: &RuntimeWorld) -> Vec<String> {
    runtime
        .jobs
        .values()
        .filter(|job| !matches!(job.status.as_str(), "resolved" | "complete" | "completed"))
        .filter(|job| {
            let last_update = [&job.progress_clock_id, &job.danger_clock_id]
                .into_iter()
                .filter_map(|clock_id| runtime.clocks.get(clock_id))
                .filter_map(|clock| clock.updated_event_seq.or(clock.created_event_seq))
                .max()
                .unwrap_or_default();
            runtime.world.next_event_seq.saturating_sub(last_update) > STALLED_EVENT_GAP
        })
        .map(|job| story_subject_ref("job", &job.id))
        .collect()
}

fn rooms_without_recent_meaningful_action(
    conn: &Connection,
    runtime: &RuntimeWorld,
    now_ms: u64,
) -> io::Result<Vec<String>> {
    let cutoff_ms = now_ms.saturating_sub(HEALTH_WINDOW_DAYS * STORY_METRICS_DAY_MS);
    let mut missing = Vec::new();
    for location in &runtime.world.locations[..runtime.world.location_count] {
        let location_ref = story_location_ref(location.id);
        let has_recent = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM story_metric_events
                    WHERE schema_version = ?1
                      AND event_kind = 'meaningful_action_completed'
                      AND location_ref = ?2 AND occurred_at_ms >= ?3
                 )",
                params![STORY_METRICS_SCHEMA_VERSION, location_ref, cutoff_ms as i64],
                |row| row.get::<_, bool>(0),
            )
            .map_err(sqlite_error)?;
        if !has_recent {
            missing.push(location_ref);
        }
    }
    Ok(missing)
}

pub(super) fn read_recent_story_metrics(
    conn: &Connection,
    limit: usize,
) -> io::Result<Vec<StoryMetricEventView>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT event_id, schema_version, world_ref, player_ref, session_ref,
                    event_kind, source_event_seq, location_ref, target_player_ref,
                    subject_ref, attributes_json, occurred_at_ms
             FROM story_metric_events
             WHERE schema_version = ?1
             ORDER BY occurred_at_ms DESC, event_id DESC LIMIT ?2",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![STORY_METRICS_SCHEMA_VERSION, limit as i64], |row| {
            let attributes_json: String = row.get(10)?;
            Ok(StoryMetricEventView {
                event_id: row.get(0)?,
                schema_version: row.get::<_, i64>(1)?.max(0) as u32,
                world_ref: row.get(2)?,
                player_ref: row.get(3)?,
                session_ref: row.get(4)?,
                event_kind: row.get(5)?,
                source_event_seq: row
                    .get::<_, Option<i64>>(6)?
                    .map(|value| value.max(0) as u64),
                location_ref: row.get(7)?,
                target_player_ref: row.get(8)?,
                subject_ref: row.get(9)?,
                attributes: serde_json::from_str(&attributes_json)
                    .unwrap_or_else(|_| serde_json::json!({})),
                occurred_at_ms: row.get::<_, i64>(11)?.max(0) as u64,
            })
        })
        .map_err(sqlite_error)?;
    let mut events = rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?;
    events.reverse();
    Ok(events)
}

fn count_unsupported_story_metric_schemas(conn: &Connection) -> io::Result<u64> {
    let count = conn
        .query_row(
            "SELECT COUNT(*) FROM story_metric_events WHERE schema_version != ?1",
            params![STORY_METRICS_SCHEMA_VERSION],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    Ok(count.max(0) as u64)
}

fn backfill_story_metrics_from_world_events(conn: &Connection) -> io::Result<()> {
    let world_events_exists = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'world_events'
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(sqlite_error)?;
    if !world_events_exists {
        return Ok(());
    }
    let already_ran = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM story_metric_backfills WHERE backfill_key = ?1
             )",
            params![STORY_METRICS_BACKFILL_KEY],
            |row| row.get::<_, bool>(0),
        )
        .map_err(sqlite_error)?;
    if already_ran {
        return Ok(());
    }
    conn.execute_batch("SAVEPOINT story_metrics_world_events_v1")
        .map_err(sqlite_error)?;
    match backfill_story_metric_rows(conn) {
        Ok(()) => conn
            .execute_batch("RELEASE story_metrics_world_events_v1")
            .map_err(sqlite_error),
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO story_metrics_world_events_v1;
                 RELEASE story_metrics_world_events_v1;",
            );
            Err(error)
        }
    }
}

fn backfill_story_metric_rows(conn: &Connection) -> io::Result<()> {
    let mut stmt = conn
        .prepare("SELECT payload_json, created_at_ms FROM world_events ORDER BY seq")
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(sqlite_error)?;
    let mut events = Vec::new();
    let mut human_actor_ids = BTreeSet::new();
    for row in rows {
        let (payload_json, created_at_ms) = row.map_err(sqlite_error)?;
        let Ok(event) = serde_json::from_str::<EventView>(&payload_json) else {
            continue;
        };
        if event.success && event.type_name == "actor.created" {
            if let Some(actor_id) = event.actor_id {
                human_actor_ids.insert(actor_id);
            }
        }
        events.push((event, created_at_ms.max(0) as u64));
    }
    for (event, occurred_at_ms) in events {
        let Some(actor_id) = event.actor_id.filter(|id| human_actor_ids.contains(id)) else {
            continue;
        };
        if !story_event_counts_as_meaningful(&event, actor_id) {
            continue;
        }
        let player_ref = story_player_ref(actor_id);
        let session_ref = story_session_ref(&player_ref, story_day_index(occurred_at_ms));
        let location_ref = event
            .destination_location_id
            .or(event.location_id)
            .map(story_location_ref);
        let action_category = story_action_category(&event);
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[
                    "meaningful_action_completed",
                    &player_ref,
                    &event.seq.to_string(),
                ]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind: "meaningful_action_completed",
                source_event_seq: Some(event.seq),
                location_ref: location_ref.as_deref(),
                target_player_ref: None,
                subject_ref: None,
                attributes: serde_json::json!({
                    "action_category": action_category,
                    "source": "world_events_backfill",
                }),
                occurred_at_ms,
            },
            now_millis(),
        )?;
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[
                    "public_trace_created",
                    &player_ref,
                    &event.seq.to_string(),
                ]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind: "public_trace_created",
                source_event_seq: Some(event.seq),
                location_ref: location_ref.as_deref(),
                target_player_ref: None,
                subject_ref: None,
                attributes: serde_json::json!({
                    "trace_kind": action_category,
                    "source": "world_events_backfill",
                }),
                occurred_at_ms,
            },
            now_millis(),
        )?;
        let signal = match event.type_name.as_str() {
            "bond.created" | "bond.deepened" | "bond.revised" | "bond.resolved" => {
                Some("friend_bond_change")
            }
            "item.crafted" => Some("pact_contribution"),
            "job.updated" => Some("job_front_contribution"),
            _ => None,
        };
        if let (Some(signal), Some(location_ref)) = (signal, location_ref.as_deref()) {
            insert_signal_metric(
                conn,
                signal,
                &player_ref,
                &session_ref,
                location_ref,
                event.seq,
                occurred_at_ms,
            )?;
        }
    }
    conn.execute(
        "INSERT OR IGNORE INTO story_metric_backfills (backfill_key, created_at_ms)
         VALUES (?1, ?2)",
        params![STORY_METRICS_BACKFILL_KEY, now_millis() as i64],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn story_ratio(part: u64, whole: u64) -> Option<f64> {
    (whole > 0).then_some(part as f64 / whole as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_story_db(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cosyworld-story-metrics-{name}-{}-{}.sqlite",
            std::process::id(),
            rand::random::<u64>()
        ))
    }

    fn insert_test_signal(
        conn: &Connection,
        actor_id: u64,
        event_kind: &str,
        day_index: u64,
        source_seq: u64,
    ) {
        let player_ref = story_player_ref(actor_id);
        let session_ref = story_session_ref(&player_ref, day_index);
        let location_ref = story_location_ref(COSY_COTTAGE_LOCATION_ID);
        let beat_ref = (event_kind == "world_beat_answered")
            .then(|| story_subject_ref("beat", format!("synthetic-{source_seq}")));
        if let Some(beat_ref) = beat_ref.as_deref() {
            insert_story_metric(
                conn,
                NewStoryMetric {
                    event_id: story_event_id(&[
                        "world_beat_seen",
                        &player_ref,
                        &source_seq.to_string(),
                    ]),
                    player_ref: &player_ref,
                    session_ref: &session_ref,
                    event_kind: "world_beat_seen",
                    source_event_seq: Some(source_seq.saturating_sub(1)),
                    location_ref: Some(&location_ref),
                    target_player_ref: None,
                    subject_ref: Some(beat_ref),
                    attributes: serde_json::json!({}),
                    occurred_at_ms: day_index * STORY_METRICS_DAY_MS + 999,
                },
                day_index * STORY_METRICS_DAY_MS + 999,
            )
            .expect("insert synthetic seen prerequisite");
        }
        insert_story_metric(
            conn,
            NewStoryMetric {
                event_id: story_event_id(&[event_kind, &player_ref, &source_seq.to_string()]),
                player_ref: &player_ref,
                session_ref: &session_ref,
                event_kind,
                source_event_seq: Some(source_seq),
                location_ref: Some(&location_ref),
                target_player_ref: None,
                subject_ref: beat_ref.as_deref(),
                attributes: serde_json::json!({}),
                occurred_at_ms: day_index * STORY_METRICS_DAY_MS + 1_000,
            },
            day_index * STORY_METRICS_DAY_MS + 1_000,
        )
        .expect("insert synthetic signal");
    }

    #[test]
    fn synthetic_first_to_seventh_journey_reports_funnel_and_return_signals() {
        let path = temp_story_db("seventh-journey");
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize story metric store");
        let base_day = 70;

        for offset in 0..7 {
            record_story_visit_at(
                &path,
                5000,
                (base_day + offset) * STORY_METRICS_DAY_MS + 500,
            )
            .expect("record synthetic visit");
        }
        let conn = open_event_store(&path).expect("open synthetic journey store");
        insert_test_signal(&conn, 5000, "meaningful_action_completed", base_day, 101);
        for (offset, signal) in [
            "co_presence_observed",
            "pact_contribution",
            "friend_bond_change",
            "world_beat_answered",
        ]
        .into_iter()
        .enumerate()
        {
            insert_test_signal(
                &conn,
                5000,
                signal,
                base_day + offset as u64 + 1,
                102 + offset as u64,
            );
        }
        insert_test_signal(&conn, 5000, "job_front_contribution", base_day + 5, 106);
        let player_ref = story_player_ref(5000);
        let other_player_ref = story_player_ref(5001);
        let location_ref = story_location_ref(COSY_COTTAGE_LOCATION_ID);
        let other_session_ref = story_session_ref(&other_player_ref, base_day);
        insert_story_interaction_and_reciprocity(
            &conn,
            &other_player_ref,
            &player_ref,
            &other_session_ref,
            &location_ref,
            107,
            base_day * STORY_METRICS_DAY_MS + 2_000,
        )
        .unwrap();
        let player_session_ref = story_session_ref(&player_ref, base_day + 1);
        insert_story_interaction_and_reciprocity(
            &conn,
            &player_ref,
            &other_player_ref,
            &player_session_ref,
            &location_ref,
            108,
            (base_day + 1) * STORY_METRICS_DAY_MS + 2_000,
        )
        .unwrap();
        drop(conn);

        let runtime = RuntimeWorld::seeded();
        let report =
            read_story_metrics_report(&path, &runtime, 100, (base_day + 40) * STORY_METRICS_DAY_MS)
                .expect("read synthetic story report");
        assert_eq!(report.schema_version, STORY_METRICS_SCHEMA_VERSION);
        assert_eq!(report.funnel.len(), 1);
        let cohort = &report.funnel[0];
        assert_eq!(cohort.first_visit_players, 1);
        assert_eq!(cohort.second_visit_players, 1);
        assert_eq!(cohort.third_visit_players, 1);
        assert_eq!(cohort.seventh_visit_players, 1);
        assert_eq!(cohort.first_to_seventh_rate, Some(1.0));
        assert_eq!(report.return_comparisons.len(), 5);
        assert!(report
            .return_comparisons
            .iter()
            .all(|comparison| comparison.return_rate == Some(1.0)
                && comparison.complete_window_players == 1
                && comparison.pending_window_players == 0));
        assert!(report
            .recent_events
            .iter()
            .any(|event| event.event_kind == "seventh_visit_reached"));
        assert!(report
            .recent_events
            .iter()
            .any(|event| event.event_kind == "reciprocal_interaction"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn visits_and_metric_retries_are_idempotent_and_unknown_schemas_are_quarantined() {
        let path = temp_story_db("idempotency");
        let _ = fs::remove_file(&path);
        let now = 42 * STORY_METRICS_DAY_MS;
        record_story_visit_at(&path, 5000, now).expect("record visit");
        record_story_visit_at(&path, 5000, now + 1_000).expect("retry visit");
        let conn = open_event_store(&path).expect("open story metric store");
        assert_eq!(
            count_player_visits(&conn, &story_player_ref(5000)).unwrap(),
            1
        );

        conn.execute(
            "INSERT INTO story_metric_events
                (event_id, schema_version, world_ref, player_ref, session_ref,
                 event_kind, attributes_json, occurred_at_ms, ingested_at_ms)
             VALUES ('future-schema', 99, 'world', 'player', 'visit',
                     'future_event', '{}', ?1, ?1)",
            params![now as i64],
        )
        .expect("insert unsupported schema fixture");
        assert_eq!(count_unsupported_story_metric_schemas(&conn).unwrap(), 1);
        assert!(read_recent_story_metrics(&conn, 10)
            .unwrap()
            .iter()
            .all(|event| event.schema_version == STORY_METRICS_SCHEMA_VERSION));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn backfill_never_copies_private_prose_or_raw_player_identity() {
        let path = temp_story_db("privacy");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).expect("open privacy fixture");
        conn.execute_batch(
            "CREATE TABLE world_events (
                seq INTEGER PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
            );",
        )
        .expect("create world event fixture");
        let created = EventView {
            seq: 1,
            type_name: "actor.created".to_string(),
            success: true,
            actor_id: Some(5000),
            actor_name: Some("Private Player Name".to_string()),
            ..EventView::default()
        };
        let message = EventView {
            seq: 2,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(5000),
            actor_name: Some("Private Player Name".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            content: Some("raw private chat must not enter metrics".to_string()),
            ..EventView::default()
        };
        for event in [&created, &message] {
            conn.execute(
                "INSERT INTO world_events (seq, event_type, payload_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    event.seq as i64,
                    event.type_name,
                    serde_json::to_string(event).unwrap(),
                    1_000_i64 + event.seq as i64,
                ],
            )
            .expect("insert world event fixture");
        }
        init_story_metrics_store(&conn).expect("backfill privacy fixture");
        let serialized = serde_json::to_string(&read_recent_story_metrics(&conn, 10).unwrap())
            .expect("serialize story metrics");
        assert!(!serialized.contains("Private Player Name"));
        assert!(!serialized.contains("raw private chat"));
        assert!(!serialized.contains("actor_id"));
        assert!(serialized.contains(&story_player_ref(5000)));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn backfill_is_atomic_and_retryable_after_an_insert_failure() {
        let path = temp_story_db("backfill-atomicity");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).expect("open atomic backfill fixture");
        conn.execute_batch(
            "CREATE TABLE world_events (
                seq INTEGER PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
            );",
        )
        .expect("create atomic backfill world events");
        init_story_metrics_store(&conn).expect("initialize empty story store");
        conn.execute(
            "DELETE FROM story_metric_backfills WHERE backfill_key = ?1",
            params![STORY_METRICS_BACKFILL_KEY],
        )
        .unwrap();
        let created = EventView {
            seq: 1,
            type_name: "actor.created".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let message = EventView {
            seq: 2,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(5000),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            ..EventView::default()
        };
        for event in [&created, &message] {
            conn.execute(
                "INSERT INTO world_events (seq, event_type, payload_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    event.seq as i64,
                    event.type_name,
                    serde_json::to_string(event).unwrap(),
                    1_000_i64 + event.seq as i64,
                ],
            )
            .unwrap();
        }
        conn.execute_batch(
            "CREATE TRIGGER reject_story_backfill
             BEFORE INSERT ON story_metric_events
             BEGIN
               SELECT RAISE(ABORT, 'forced story backfill failure');
             END;",
        )
        .unwrap();

        let error = backfill_story_metrics_from_world_events(&conn).unwrap_err();
        assert!(error.to_string().contains("forced story backfill failure"));
        assert!(conn.is_autocommit());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM story_metric_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM story_metric_backfills", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );

        conn.execute_batch("DROP TRIGGER reject_story_backfill")
            .unwrap();
        backfill_story_metrics_from_world_events(&conn).expect("retry atomic backfill");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM story_metric_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM story_metric_backfills", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn health_report_closes_answered_beats_and_recovered_items() {
        let path = temp_story_db("health");
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize health store");
        let conn = open_event_store(&path).expect("open health store");
        let player_ref = story_player_ref(5000);
        let session_ref = story_session_ref(&player_ref, 1);
        let location_ref = story_location_ref(COSY_COTTAGE_LOCATION_ID);
        let beat_ref = story_subject_ref("beat", 700);
        let item_ref = story_subject_ref("item", 4000);
        for (kind, subject, seq) in [
            ("world_beat_seen", beat_ref.as_str(), 700_u64),
            ("item_stranded", item_ref.as_str(), 701_u64),
        ] {
            insert_story_metric(
                &conn,
                NewStoryMetric {
                    event_id: story_event_id(&[kind, subject]),
                    player_ref: &player_ref,
                    session_ref: &session_ref,
                    event_kind: kind,
                    source_event_seq: Some(seq),
                    location_ref: Some(&location_ref),
                    target_player_ref: None,
                    subject_ref: Some(subject),
                    attributes: serde_json::json!({}),
                    occurred_at_ms: STORY_METRICS_DAY_MS,
                },
                STORY_METRICS_DAY_MS,
            )
            .unwrap();
        }
        let runtime = RuntimeWorld::seeded();
        let health = read_story_health(&conn, &runtime, STORY_METRICS_DAY_MS * 2).unwrap();
        assert_eq!(health.unanswered_beat_count, 1);
        assert_eq!(health.stranded_unique_item_count, 1);

        for (kind, subject, seq) in [
            ("world_beat_answered", beat_ref.as_str(), 702_u64),
            ("item_recovered", item_ref.as_str(), 703_u64),
        ] {
            insert_story_metric(
                &conn,
                NewStoryMetric {
                    event_id: story_event_id(&[kind, subject]),
                    player_ref: &player_ref,
                    session_ref: &session_ref,
                    event_kind: kind,
                    source_event_seq: Some(seq),
                    location_ref: Some(&location_ref),
                    target_player_ref: None,
                    subject_ref: Some(subject),
                    attributes: serde_json::json!({}),
                    occurred_at_ms: STORY_METRICS_DAY_MS + 1_000,
                },
                STORY_METRICS_DAY_MS + 1_000,
            )
            .unwrap();
        }
        let health = read_story_health(&conn, &runtime, STORY_METRICS_DAY_MS * 2).unwrap();
        assert_eq!(health.unanswered_beat_count, 0);
        assert_eq!(health.stranded_unique_item_count, 0);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn retention_and_player_deletion_remove_only_the_scoped_metric_rows() {
        let path = temp_story_db("lifecycle");
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize lifecycle store");
        let conn = open_event_store(&path).expect("open lifecycle store");
        let now_ms = now_millis();
        let old_ms = now_ms.saturating_sub(401 * STORY_METRICS_DAY_MS);
        insert_test_signal(
            &conn,
            5000,
            "meaningful_action_completed",
            story_day_index(old_ms),
            800,
        );
        insert_test_signal(
            &conn,
            5001,
            "meaningful_action_completed",
            story_day_index(now_ms),
            801,
        );
        insert_test_signal(
            &conn,
            5003,
            "meaningful_action_completed",
            story_day_index(now_ms),
            802,
        );
        let interacting_player_ref = story_player_ref(5002);
        let deleted_target_ref = story_player_ref(5001);
        let interaction_session_ref =
            story_session_ref(&interacting_player_ref, story_day_index(now_ms));
        insert_story_metric(
            &conn,
            NewStoryMetric {
                event_id: story_event_id(&["interaction_completed", "lifecycle-target"]),
                player_ref: &interacting_player_ref,
                session_ref: &interaction_session_ref,
                event_kind: "interaction_completed",
                source_event_seq: Some(803),
                location_ref: None,
                target_player_ref: Some(&deleted_target_ref),
                subject_ref: None,
                attributes: serde_json::json!({}),
                occurred_at_ms: now_ms,
            },
            now_ms,
        )
        .unwrap();
        drop(conn);

        assert_eq!(
            purge_expired_story_metrics_for_retention(
                &path,
                StoryMetricsRetention { days: Some(400) },
            )
            .unwrap(),
            1
        );
        assert_eq!(
            delete_story_metrics_for_player_at(&path, &story_player_ref(5001)).unwrap(),
            2
        );
        let conn = open_event_store(&path).expect("reopen lifecycle store");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM story_metric_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(valid_story_player_ref(&story_player_ref(5001)));
        assert!(!valid_story_player_ref("5001"));

        let _ = fs::remove_file(path);
    }
}
