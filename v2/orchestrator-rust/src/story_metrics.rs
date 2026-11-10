use super::*;
use sha2::{Digest, Sha256};

pub(super) const STORY_METRICS_SCHEMA_VERSION: u32 = 2;
pub(super) const DEFAULT_STORY_METRICS_RETENTION_DAYS: u64 = 400;
const STORY_METRICS_DAY_MS: u64 = 86_400_000;
const STORY_METRICS_BACKFILL_KEY: &str = "world_events_v1";
const STORY_METRICS_NAMESPACE: &str = "cosyworld.story-metrics/2";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct StoryMetricsRetention {
    pub(super) days: Option<u64>,
}

impl StoryMetricsRetention {}

impl Default for StoryMetricsRetention {
    fn default() -> Self {
        Self {
            days: Some(DEFAULT_STORY_METRICS_RETENTION_DAYS),
        }
    }
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

fn insert_story_metric(
    conn: &Connection,
    metric: NewStoryMetric<'_>,
    ingested_at_ms: u64,
) -> io::Result<bool> {
    if metric.event_kind == "world_beat_answered" {
        let Some(subject_ref) = metric.subject_ref else {
            return Ok(false);
        };
        let Some(response_event_seq) = metric.source_event_seq else {
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
                      AND source_event_seq IS NOT NULL
                      AND source_event_seq < ?4
                 )",
                params![
                    STORY_METRICS_SCHEMA_VERSION,
                    metric.player_ref,
                    subject_ref,
                    response_event_seq as i64,
                ],
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
                | "hand.thought"
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
        "first_tale.public_trace"
        | "job.contribution.resolved"
        | "clock.updated"
        | "clock.threshold"
        | "job.updated" => "shared_work",
        type_name if type_name.starts_with("item.") => "item_care",
        type_name if type_name.starts_with("combat.") => "conflict",
        "feature.searched" | "location.searched" | "exit.discovered" | "avatar.discovered" => {
            "discovery"
        }
        "ledger.marked" | "ledger.banked" | "advancement.spent" | "skill.stepped" => "growth",
        _ => "world_action",
    }
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
