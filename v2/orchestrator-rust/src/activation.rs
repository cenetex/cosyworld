use super::*;

const ACTIVATION_DAY_MS: i64 = 86_400_000;
pub(super) const ACTIVATION_METRICS_SCHEMA_VERSION: u32 = 4;
pub(super) const ACTIVATION_METRICS_DEFINITIONS_VERSION: &str = "cosyworld.activation/4";
const WORLD_EVENTS_BACKFILL_KEY: &str = "world_events_v4_activation_funnel";

const ACTIVATION_FUNNEL_STEPS: &[(&str, &str)] = &[
    ("avatar_created", "avatar_created"),
    ("first_tale_notice_presented", "first_tale_notice_presented"),
    ("first_tale_notice_completed", "first_tale_notice_completed"),
    ("first_turn_committed", "first_turn_committed"),
    ("first_growth_settled", "first_growth_settled"),
    (
        "first_growth_feedback_presented",
        "first_growth_feedback_presented",
    ),
    (
        "first_tale_follow_lead_presented",
        "first_tale_follow_lead_presented",
    ),
    (
        "first_tale_destination_reached",
        "first_tale_destination_reached",
    ),
    (
        "first_tale_contribute_presented",
        "first_tale_contribute_presented",
    ),
    (
        "first_tale_contribution_committed",
        "first_tale_contribution_committed",
    ),
    ("first_tale_completed", "first_tale_completed"),
    (
        "first_tale_return_to_lead_presented",
        "first_tale_return_to_lead_presented",
    ),
    (
        "first_tale_return_to_destination_presented",
        "first_tale_return_to_destination_presented",
    ),
    ("first_tale_travel_presented", "first_tale_travel_presented"),
    (
        "first_tale_arrived_presented",
        "first_tale_arrived_presented",
    ),
    (
        "first_tale_accepted_presented",
        "first_tale_accepted_presented",
    ),
    (
        "first_tale_completion_presented",
        "first_tale_completion_presented",
    ),
    ("journal_opened_after_growth", "journal_opened_after_growth"),
];

#[derive(Clone, Debug, Serialize, Default)]
pub(super) struct ActivationMetricsSummary {
    avatar_created_count: u64,
    actors_with_first_turn_committed: u64,
    first_turn_committed_rate: Option<f64>,
    actors_with_first_public_trace: u64,
    first_public_trace_rate: Option<f64>,
    actors_with_first_banked_ledger: u64,
    first_banked_ledger_rate: Option<f64>,
    actors_with_day_1_return: u64,
    day_1_return_rate: Option<f64>,
    actors_with_day_7_return: u64,
    day_7_return_rate: Option<f64>,
    median_time_to_first_turn_committed_ms: Option<u64>,
    median_time_to_first_public_trace_ms: Option<u64>,
    median_time_to_first_banked_ledger_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub(super) struct ActivationMetricsDimensions {
    metrics_schema_version: u32,
    metrics_definitions_version: String,
    release_version: String,
    deployment_profile: String,
    worldpack_id: String,
    worldpack_version: u32,
    worldpack_bundle_hash: String,
    first_tale_schema_version: Option<u8>,
}

impl ActivationMetricsDimensions {
    fn current(deployment_profile: impl Into<String>) -> Self {
        let manifest = &active_content().manifest;
        Self {
            metrics_schema_version: ACTIVATION_METRICS_SCHEMA_VERSION,
            metrics_definitions_version: ACTIVATION_METRICS_DEFINITIONS_VERSION.to_string(),
            release_version: env!("CARGO_PKG_VERSION").to_string(),
            deployment_profile: deployment_profile.into(),
            worldpack_id: manifest.id.clone(),
            worldpack_version: manifest.version,
            worldpack_bundle_hash: manifest.bundle_hash.clone(),
            first_tale_schema_version: manifest
                .first_tale
                .as_ref()
                .map(|first_tale| first_tale.schema_version),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActivationStepMetrics {
    step: String,
    actor_count: u64,
    rate_from_avatar_created: Option<f64>,
    median_time_from_avatar_created_ms: Option<u64>,
    p75_time_from_avatar_created_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActivationRejectionMetrics {
    phase: String,
    status: u32,
    actor_count: u64,
    rejection_count: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActivationEventView {
    actor_id: u64,
    event_kind: String,
    event_key: String,
    created_at_ms: u64,
    metadata: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActivationMetricsResponse {
    ok: bool,
    status: u32,
    dimensions: ActivationMetricsDimensions,
    summary: ActivationMetricsSummary,
    steps: Vec<ActivationStepMetrics>,
    first_tale_action_rejections: Vec<ActivationRejectionMetrics>,
    recent_events: Vec<ActivationEventView>,
    story_metrics: StoryMetricsReport,
    error: Option<String>,
}

pub(super) fn init_activation_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activation_events (
            actor_id INTEGER NOT NULL,
            event_kind TEXT NOT NULL,
            event_key TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY (actor_id, event_key)
        );
        CREATE INDEX IF NOT EXISTS idx_activation_events_kind
            ON activation_events(event_kind, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_activation_events_actor_kind
            ON activation_events(actor_id, event_kind, created_at_ms);
        CREATE TABLE IF NOT EXISTS activation_backfills (
            backfill_key TEXT PRIMARY KEY,
            created_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(sqlite_error)?;
    backfill_activation_from_world_events(conn)
}

pub(super) fn record_avatar_created(state: &AppState, actor_id: u64) {
    record_activation_event(
        state,
        actor_id,
        "avatar_created",
        "avatar_created",
        serde_json::json!({}),
    );
}

pub(super) fn record_daily_visit(state: &AppState, actor_id: u64) {
    let now = now_millis();
    let day_index = now / ACTIVATION_DAY_MS as u64;
    record_activation_event_at(
        state,
        actor_id,
        "daily_visit",
        &format!("daily_visit:{day_index}"),
        serde_json::json!({ "day_index": day_index }),
        now,
    );
    record_story_visit(state, actor_id);
}

pub(super) fn record_first_ledger_banked(state: &AppState, actor_id: u64, event_seq: u64) {
    for (event_kind, event_key) in [
        ("first_ledger_banked", "first_ledger_banked"),
        ("first_growth_settled", "first_growth_settled"),
    ] {
        record_activation_event(
            state,
            actor_id,
            event_kind,
            event_key,
            serde_json::json!({ "event_seq": event_seq }),
        );
    }
}

pub(super) fn record_first_public_trace(state: &AppState, actor_id: u64, event_seq: u64) {
    for (event_kind, event_key) in [
        ("first_public_trace", "first_public_trace"),
        ("first_tale_completed", "first_tale_completed"),
    ] {
        record_activation_event(
            state,
            actor_id,
            event_kind,
            event_key,
            serde_json::json!({ "event_seq": event_seq }),
        );
    }
}

pub(super) fn record_first_turn_committed(state: &AppState, actor_id: u64, event_seq: u64) {
    record_activation_event(
        state,
        actor_id,
        "first_turn_committed",
        "first_turn_committed",
        serde_json::json!({ "event_seq": event_seq }),
    );
}

fn record_first_tale_notice_completed(state: &AppState, actor_id: u64, event_seq: u64) {
    record_activation_event(
        state,
        actor_id,
        "first_tale_notice_completed",
        "first_tale_notice_completed",
        serde_json::json!({ "event_seq": event_seq }),
    );
}

fn record_first_tale_destination_reached(state: &AppState, actor_id: u64, event_seq: u64) {
    record_activation_event(
        state,
        actor_id,
        "first_tale_destination_reached",
        "first_tale_destination_reached",
        serde_json::json!({ "event_seq": event_seq }),
    );
}

fn record_first_tale_contribution_committed(state: &AppState, actor_id: u64, event_seq: u64) {
    record_activation_event(
        state,
        actor_id,
        "first_tale_contribution_committed",
        "first_tale_contribution_committed",
        serde_json::json!({ "event_seq": event_seq }),
    );
}

pub(super) fn record_canonical_activation_milestones(
    state: &AppState,
    actor_id: u64,
    events: &[EventView],
) {
    if let Some(event) = events
        .iter()
        .find(|event| {
            event_counts_as_first_committed_turn(event) && event.actor_id == Some(actor_id)
        })
        .or_else(|| {
            events
                .iter()
                .find(|event| event_counts_as_first_committed_turn(event))
        })
    {
        record_first_turn_committed(state, actor_id, event.seq);
    }
    if let Some(event) = events
        .iter()
        .find(|event| event_is_first_tale_notice_completed(event, actor_id))
    {
        record_first_tale_notice_completed(state, actor_id, event.seq);
    }
    if let Some(event) = events
        .iter()
        .find(|event| event_is_first_tale_destination_reached(event, actor_id))
    {
        record_first_tale_destination_reached(state, actor_id, event.seq);
    }
    if let Some(event) = events
        .iter()
        .find(|event| event_is_first_tale_contribution(event, actor_id))
    {
        record_first_tale_contribution_committed(state, actor_id, event.seq);
    }
    if let Some(event) = events.iter().find(|event| {
        event.type_name == "ledger.banked" && event.success && event.actor_id == Some(actor_id)
    }) {
        record_first_ledger_banked(state, actor_id, event.seq);
    }
    if let Some(event) = events
        .iter()
        .find(|event| event_is_first_tale_completed(event, actor_id))
    {
        record_first_public_trace(state, actor_id, event.seq);
    }
}

pub(super) fn record_first_tale_action_rejection(
    state: &AppState,
    actor_id: u64,
    phase: &str,
    status: u32,
    source_event_seq: Option<u64>,
) {
    if !valid_first_tale_phase(phase) || status == CW_OK {
        return;
    }
    let event_key = source_event_seq.map_or_else(
        || format!("first_tale_action_rejected:{phase}:{status}"),
        |event_seq| format!("first_tale_action_rejected:{phase}:{status}:{event_seq}"),
    );
    record_activation_event(
        state,
        actor_id,
        "first_tale_action_rejected",
        &event_key,
        serde_json::json!({
            "phase": phase,
            "status": status,
            "source_event_seq": source_event_seq,
        }),
    );
}

#[allow(clippy::too_many_arguments)]
pub(super) fn record_first_tale_presentation_at(
    path: &Path,
    actor_id: u64,
    phase: &str,
    interaction: &str,
    exposure_id: &str,
    transport: &str,
    state_revision: u64,
    now_ms: u64,
) -> io::Result<bool> {
    if !valid_first_tale_phase(phase)
        || !matches!(
            interaction,
            "phase_seen"
                | "growth_feedback_seen"
                | "completion_memory_seen"
                | "journal_opened_after_growth"
        )
        || !matches!(transport, "browser" | "cli" | "agent")
        || !valid_activation_exposure_id(exposure_id)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid first-tale presentation receipt",
        ));
    }
    let event_kind = match interaction {
        "phase_seen" => match phase {
            "notice" => "first_tale_notice_presented",
            "follow_lead" => "first_tale_follow_lead_presented",
            "contribute" => "first_tale_contribute_presented",
            "complete" => "first_tale_complete_presented",
            "return_to_lead" => "first_tale_return_to_lead_presented",
            "return_to_destination" => "first_tale_return_to_destination_presented",
            "travel" => "first_tale_travel_presented",
            "arrived" => "first_tale_arrived_presented",
            "accepted" => "first_tale_accepted_presented",
            _ => unreachable!("phase was allowlisted"),
        },
        "growth_feedback_seen" => "first_growth_feedback_presented",
        "completion_memory_seen" => "first_tale_completion_presented",
        "journal_opened_after_growth" => "journal_opened_after_growth",
        _ => unreachable!("interaction was allowlisted"),
    };
    let event_key = format!("presentation:{interaction}:{phase}:{exposure_id}");
    append_activation_event_at(
        path,
        actor_id,
        event_kind,
        &event_key,
        with_static_activation_dimensions(serde_json::json!({
            "phase": phase,
            "interaction": interaction,
            "exposure_id": exposure_id,
            "transport": transport,
            "state_revision": state_revision,
            "source": "presentation_receipt",
        })),
        now_ms,
    )
}

fn valid_first_tale_phase(phase: &str) -> bool {
    matches!(
        phase,
        "notice"
            | "follow_lead"
            | "contribute"
            | "complete"
            | "return_to_lead"
            | "return_to_destination"
            | "travel"
            | "arrived"
            | "accepted"
    )
}

fn valid_activation_exposure_id(exposure_id: &str) -> bool {
    !exposure_id.is_empty()
        && exposure_id.len() <= 160
        && exposure_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
}

fn record_activation_event(
    state: &AppState,
    actor_id: u64,
    event_kind: &str,
    event_key: &str,
    metadata: serde_json::Value,
) {
    record_activation_event_at(
        state,
        actor_id,
        event_kind,
        event_key,
        metadata,
        now_millis(),
    );
}

fn record_activation_event_at(
    state: &AppState,
    actor_id: u64,
    event_kind: &str,
    event_key: &str,
    metadata: serde_json::Value,
    created_at_ms: u64,
) {
    let Some(path) = state.event_store_path.as_deref() else {
        return;
    };
    let metadata = with_live_activation_dimensions(state, metadata);
    if let Err(error) = append_activation_event_at(
        path,
        actor_id,
        event_kind,
        event_key,
        metadata,
        created_at_ms,
    ) {
        warn!(
            "failed to append CosyWorld v2 activation event to {}: {}",
            path.display(),
            error
        );
    }
}

fn append_activation_event_at(
    path: &Path,
    actor_id: u64,
    event_kind: &str,
    event_key: &str,
    metadata: serde_json::Value,
    created_at_ms: u64,
) -> io::Result<bool> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    // The event-store schema version can already be current while a newer
    // activation-only backfill has not run. Check that version key here
    // without reacquiring schema locks for every polled activation receipt.
    backfill_activation_from_world_events(&conn)?;
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO activation_events
            (actor_id, event_kind, event_key, metadata_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                actor_id as i64,
                event_kind,
                event_key,
                metadata_json,
                created_at_ms as i64
            ],
        )
        .map_err(sqlite_error)?;
    Ok(changed == 1)
}

fn with_live_activation_dimensions(
    state: &AppState,
    metadata: serde_json::Value,
) -> serde_json::Value {
    let mut metadata = with_static_activation_dimensions(metadata);
    if let Some(object) = metadata.as_object_mut() {
        object.insert(
            "deployment_profile".to_string(),
            serde_json::json!(state.deployment.profile.as_str()),
        );
    }
    metadata
}

fn with_static_activation_dimensions(metadata: serde_json::Value) -> serde_json::Value {
    let manifest = &active_content().manifest;
    let mut object = metadata.as_object().cloned().unwrap_or_default();
    object.insert(
        "metrics_schema_version".to_string(),
        serde_json::json!(ACTIVATION_METRICS_SCHEMA_VERSION),
    );
    object.insert(
        "metrics_definitions_version".to_string(),
        serde_json::json!(ACTIVATION_METRICS_DEFINITIONS_VERSION),
    );
    object.insert(
        "release_version".to_string(),
        serde_json::json!(env!("CARGO_PKG_VERSION")),
    );
    object.insert("worldpack_id".to_string(), serde_json::json!(manifest.id));
    object.insert(
        "worldpack_version".to_string(),
        serde_json::json!(manifest.version),
    );
    object.insert(
        "worldpack_bundle_hash".to_string(),
        serde_json::json!(manifest.bundle_hash),
    );
    object.insert(
        "first_tale_schema_version".to_string(),
        serde_json::json!(manifest
            .first_tale
            .as_ref()
            .map(|first_tale| first_tale.schema_version)),
    );
    serde_json::Value::Object(object)
}

fn backfill_activation_from_world_events(conn: &Connection) -> io::Result<()> {
    let already_ran: Option<String> = conn
        .query_row(
            "SELECT backfill_key FROM activation_backfills WHERE backfill_key = ?1",
            params![WORLD_EVENTS_BACKFILL_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(sqlite_error)?;
    if already_ran.is_some() {
        return Ok(());
    }

    let mut created_actors = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT actor_id
                 FROM activation_events
                 WHERE event_kind = 'avatar_created'",
            )
            .map_err(sqlite_error)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(sqlite_error)?;
        let mut actors = BTreeSet::new();
        for row in rows {
            actors.insert(row.map_err(sqlite_error)?.max(0) as u64);
        }
        actors
    };
    let mut stmt = conn
        .prepare(
            "SELECT payload_json, created_at_ms
             FROM world_events
             ORDER BY seq ASC",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?.max(0) as u64,
            ))
        })
        .map_err(sqlite_error)?;

    let mut parsed_events = Vec::new();
    for row in rows {
        let (payload, created_at_ms) = row.map_err(sqlite_error)?;
        let Ok(event) = serde_json::from_str::<EventView>(&payload) else {
            continue;
        };
        if event.type_name == "actor.created" && event.success {
            if let Some(actor_id) = event.actor_id {
                created_actors.insert(actor_id);
                insert_activation_event_conn(
                    conn,
                    actor_id,
                    "avatar_created",
                    "avatar_created",
                    with_static_activation_dimensions(serde_json::json!({
                        "source_event_seq": event.seq,
                        "source": "world_events_backfill",
                        "dimension_source": "backfill_runtime"
                    })),
                    created_at_ms,
                )?;
            }
        }
        parsed_events.push((event, created_at_ms));
    }

    for (event, created_at_ms) in parsed_events {
        let Some(actor_id) = event.actor_id else {
            continue;
        };
        if !created_actors.contains(&actor_id) {
            continue;
        }
        if event.type_name == "actor.presence" && event.success {
            let day_index = created_at_ms / ACTIVATION_DAY_MS as u64;
            insert_activation_event_conn(
                conn,
                actor_id,
                "daily_visit",
                &format!("daily_visit:{day_index}"),
                with_static_activation_dimensions(serde_json::json!({
                    "day_index": day_index,
                    "source_event_seq": event.seq,
                    "source": "world_events_backfill",
                    "dimension_source": "backfill_runtime",
                    "visit_evidence": "actor.presence"
                })),
                created_at_ms,
            )?;
        }
        if event.type_name == "ledger.banked" && event.success {
            for (event_kind, event_key) in [
                ("first_ledger_banked", "first_ledger_banked"),
                ("first_growth_settled", "first_growth_settled"),
            ] {
                insert_activation_event_conn(
                    conn,
                    actor_id,
                    event_kind,
                    event_key,
                    backfill_event_metadata(event.seq),
                    created_at_ms,
                )?;
            }
        }
        if event_is_first_tale_notice_completed(&event, actor_id) {
            insert_activation_event_conn(
                conn,
                actor_id,
                "first_tale_notice_completed",
                "first_tale_notice_completed",
                backfill_event_metadata(event.seq),
                created_at_ms,
            )?;
        }
        if event_is_first_tale_destination_reached(&event, actor_id) {
            insert_activation_event_conn(
                conn,
                actor_id,
                "first_tale_destination_reached",
                "first_tale_destination_reached",
                backfill_event_metadata(event.seq),
                created_at_ms,
            )?;
        }
        if event_is_first_tale_contribution(&event, actor_id) {
            insert_activation_event_conn(
                conn,
                actor_id,
                "first_tale_contribution_committed",
                "first_tale_contribution_committed",
                backfill_event_metadata(event.seq),
                created_at_ms,
            )?;
        }
        if event_is_first_tale_completed(&event, actor_id) {
            for (event_kind, event_key) in [
                ("first_public_trace", "first_public_trace"),
                ("first_tale_completed", "first_tale_completed"),
            ] {
                insert_activation_event_conn(
                    conn,
                    actor_id,
                    event_kind,
                    event_key,
                    backfill_event_metadata(event.seq),
                    created_at_ms,
                )?;
            }
        }
        if event_counts_as_first_committed_turn(&event) {
            insert_activation_event_conn(
                conn,
                actor_id,
                "first_turn_committed",
                "first_turn_committed",
                with_static_activation_dimensions(serde_json::json!({
                    "event_seq": event.seq,
                    "event_type": event.type_name,
                    "source": "world_events_backfill",
                    "dimension_source": "backfill_runtime"
                })),
                created_at_ms,
            )?;
        }
    }

    conn.execute(
        "INSERT OR IGNORE INTO activation_backfills (backfill_key, created_at_ms)
         VALUES (?1, ?2)",
        params![WORLD_EVENTS_BACKFILL_KEY, now_millis() as i64],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn backfill_event_metadata(event_seq: u64) -> serde_json::Value {
    with_static_activation_dimensions(serde_json::json!({
        "event_seq": event_seq,
        "source": "world_events_backfill",
        "dimension_source": "backfill_runtime"
    }))
}

fn event_is_first_tale_notice_completed(event: &EventView, actor_id: u64) -> bool {
    let Some(first_tale) = active_first_tale() else {
        return false;
    };
    event.type_name == "ability_check.rolled"
        && event.actor_id == Some(actor_id)
        && event.location_id == Some(first_tale.lead_location_id)
        && event.dc == Some(LISTEN_DC as i16)
}

fn event_is_first_tale_destination_reached(event: &EventView, actor_id: u64) -> bool {
    let Some(first_tale) = active_first_tale() else {
        return false;
    };
    event.success
        && event.type_name == "actor.moved"
        && event.actor_id == Some(actor_id)
        && (event.location_id == Some(first_tale.destination_location_id)
            || event.destination_location_id == Some(first_tale.destination_location_id))
}

fn event_is_first_tale_contribution(event: &EventView, actor_id: u64) -> bool {
    let Some(first_tale) = active_first_tale() else {
        return false;
    };
    event.type_name == "job.contribution.resolved"
        && event.success
        && event.actor_id == Some(actor_id)
        && event.content.as_deref().is_some_and(|content| {
            serde_json::from_str::<serde_json::Value>(content)
                .ok()
                .is_some_and(|trace| {
                    trace.get("job_id").and_then(|value| value.as_str())
                        == Some(first_tale.job_id.as_str())
                })
        })
}

fn event_is_first_tale_completed(event: &EventView, actor_id: u64) -> bool {
    event.success
        && event.actor_id == Some(actor_id)
        && event.type_name == "first_tale.public_trace"
}

fn event_counts_as_first_committed_turn(event: &EventView) -> bool {
    event.success
        && event.actor_id.is_some()
        && matches!(
            event.type_name.as_str(),
            "ability_check.rolled"
                | "actor.moved"
                | "avatar.discovered"
                | "combat.attack.attempt"
                | "combat.defend"
                | "combat.flee.success"
                | "exit.discovered"
                | "feature.searched"
                | "feature.used"
                | "focused.pass"
                | "focused.setup"
                | "hand.shuffled"
                | "item.crafted"
                | "item.dropped"
                | "item.given"
                | "item.picked_up"
                | "item.traded"
                | "item.used"
                | "job.contribution.resolved"
                | "ledger.banked"
                | "location.searched"
                | "project.push.resolved"
                | "rest.completed"
        )
}

fn insert_activation_event_conn(
    conn: &Connection,
    actor_id: u64,
    event_kind: &str,
    event_key: &str,
    metadata: serde_json::Value,
    created_at_ms: u64,
) -> io::Result<()> {
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    conn.execute(
        "INSERT OR IGNORE INTO activation_events
            (actor_id, event_kind, event_key, metadata_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            actor_id as i64,
            event_kind,
            event_key,
            metadata_json,
            created_at_ms as i64
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

pub(super) async fn activation_metrics_view(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(query): Query<ModerationEventsQuery>,
) -> Json<ActivationMetricsResponse> {
    let dimensions =
        ActivationMetricsDimensions::current(state.deployment.profile.as_str().to_string());
    if !moderation_authorized(&state, &headers) {
        return Json(ActivationMetricsResponse {
            ok: false,
            status: 403,
            dimensions,
            summary: ActivationMetricsSummary::default(),
            steps: Vec::new(),
            first_tale_action_rejections: Vec::new(),
            recent_events: Vec::new(),
            story_metrics: StoryMetricsReport::default(),
            error: Some("moderation bearer token required".to_string()),
        });
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(ActivationMetricsResponse {
            ok: false,
            status: 503,
            dimensions,
            summary: ActivationMetricsSummary::default(),
            steps: Vec::new(),
            first_tale_action_rejections: Vec::new(),
            recent_events: Vec::new(),
            story_metrics: StoryMetricsReport::default(),
            error: Some("event store is required for activation metrics".to_string()),
        });
    };
    match read_activation_metrics(path, event_replay_limit(query.limit), dimensions.clone()) {
        Ok(mut response) => {
            let runtime = state.inner.lock().await;
            match read_story_metrics_report(
                path,
                &runtime,
                event_replay_limit(query.limit),
                now_millis(),
            ) {
                Ok(story) => {
                    response.story_metrics = story;
                    Json(response)
                }
                Err(error) => {
                    warn!(
                        "failed to read CosyWorld story metrics from {}: {}",
                        path.display(),
                        error
                    );
                    response.ok = false;
                    response.status = 500;
                    response.error = Some(error.to_string());
                    Json(response)
                }
            }
        }
        Err(error) => {
            warn!(
                "failed to read CosyWorld v2 activation metrics from {}: {}",
                path.display(),
                error
            );
            Json(ActivationMetricsResponse {
                ok: false,
                status: 500,
                dimensions,
                summary: ActivationMetricsSummary::default(),
                steps: Vec::new(),
                first_tale_action_rejections: Vec::new(),
                recent_events: Vec::new(),
                story_metrics: StoryMetricsReport::default(),
                error: Some(error.to_string()),
            })
        }
    }
}

fn read_activation_metrics(
    path: &Path,
    limit: usize,
    dimensions: ActivationMetricsDimensions,
) -> io::Result<ActivationMetricsResponse> {
    let conn = open_event_store(path)?;
    init_activation_store(&conn)?;
    let avatar_created_count = count_distinct_actors(&conn, "avatar_created")?;
    let actors_with_first_turn_committed = count_distinct_actors(&conn, "first_turn_committed")?;
    let actors_with_first_public_trace = count_distinct_actors(&conn, "first_public_trace")?;
    let actors_with_first_banked_ledger = count_distinct_actors(&conn, "first_ledger_banked")?;
    let actors_with_day_1_return = count_returning_actors(&conn, 1)?;
    let actors_with_day_7_return = count_returning_actors(&conn, 7)?;
    let median_time_to_first_turn_committed_ms =
        median_u64(first_event_deltas(&conn, "first_turn_committed")?);
    let median_time_to_first_public_trace_ms =
        median_u64(first_event_deltas(&conn, "first_public_trace")?);
    let median_time_to_first_banked_ledger_ms =
        median_u64(first_event_deltas(&conn, "first_ledger_banked")?);
    let steps = read_activation_steps(&conn, avatar_created_count)?;
    let first_tale_action_rejections = read_first_tale_action_rejections(&conn)?;
    let recent_events = read_recent_activation_events(&conn, limit)?;
    Ok(ActivationMetricsResponse {
        ok: true,
        status: 200,
        dimensions,
        summary: ActivationMetricsSummary {
            avatar_created_count,
            actors_with_first_turn_committed,
            first_turn_committed_rate: ratio(
                actors_with_first_turn_committed,
                avatar_created_count,
            ),
            actors_with_first_public_trace,
            first_public_trace_rate: ratio(actors_with_first_public_trace, avatar_created_count),
            actors_with_first_banked_ledger,
            first_banked_ledger_rate: ratio(actors_with_first_banked_ledger, avatar_created_count),
            actors_with_day_1_return,
            day_1_return_rate: ratio(actors_with_day_1_return, avatar_created_count),
            actors_with_day_7_return,
            day_7_return_rate: ratio(actors_with_day_7_return, avatar_created_count),
            median_time_to_first_turn_committed_ms,
            median_time_to_first_public_trace_ms,
            median_time_to_first_banked_ledger_ms,
        },
        steps,
        first_tale_action_rejections,
        recent_events,
        story_metrics: StoryMetricsReport::default(),
        error: None,
    })
}

fn count_distinct_actors(conn: &Connection, event_kind: &str) -> io::Result<u64> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT actor_id)
             FROM activation_events
             WHERE event_kind = ?1",
            params![event_kind],
            |row| row.get(0),
        )
        .map_err(sqlite_error)?;
    Ok(count.max(0) as u64)
}

fn count_returning_actors(conn: &Connection, day_offset: i64) -> io::Result<u64> {
    let count: i64 = conn
        .query_row(
            "WITH created AS (
                SELECT actor_id, MIN(created_at_ms) AS created_at_ms
                FROM activation_events
                WHERE event_kind = 'avatar_created'
                GROUP BY actor_id
             ),
             visits AS (
                SELECT actor_id, CAST(created_at_ms / ?1 AS INTEGER) AS visit_day
                FROM activation_events
                WHERE event_kind = 'daily_visit'
             )
             SELECT COUNT(DISTINCT created.actor_id)
             FROM created
             JOIN visits ON visits.actor_id = created.actor_id
             WHERE visits.visit_day = CAST(created.created_at_ms / ?1 AS INTEGER) + ?2",
            params![ACTIVATION_DAY_MS, day_offset],
            |row| row.get(0),
        )
        .map_err(sqlite_error)?;
    Ok(count.max(0) as u64)
}

fn first_event_deltas(conn: &Connection, event_kind: &str) -> io::Result<Vec<u64>> {
    let mut stmt = conn
        .prepare(
            "WITH created AS (
                SELECT actor_id, MIN(created_at_ms) AS created_at_ms
                FROM activation_events
                WHERE event_kind = 'avatar_created'
                GROUP BY actor_id
             ),
             first_event AS (
                SELECT actor_id, MIN(created_at_ms) AS created_at_ms
                FROM activation_events
                WHERE event_kind = ?1
                GROUP BY actor_id
             )
             SELECT first_event.created_at_ms - created.created_at_ms
             FROM created
             JOIN first_event ON first_event.actor_id = created.actor_id
             WHERE first_event.created_at_ms >= created.created_at_ms",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![event_kind], |row| row.get::<_, i64>(0))
        .map_err(sqlite_error)?;
    let mut deltas = Vec::new();
    for row in rows {
        deltas.push(row.map_err(sqlite_error)?.max(0) as u64);
    }
    Ok(deltas)
}

fn read_activation_steps(
    conn: &Connection,
    avatar_created_count: u64,
) -> io::Result<Vec<ActivationStepMetrics>> {
    ACTIVATION_FUNNEL_STEPS
        .iter()
        .map(|(step, event_kind)| {
            let actor_count = count_distinct_actors(conn, event_kind)?;
            let deltas = first_event_deltas(conn, event_kind)?;
            Ok(ActivationStepMetrics {
                step: (*step).to_string(),
                actor_count,
                rate_from_avatar_created: ratio(actor_count, avatar_created_count),
                median_time_from_avatar_created_ms: median_u64(deltas.clone()),
                p75_time_from_avatar_created_ms: percentile_u64(deltas, 75),
            })
        })
        .collect()
}

fn read_first_tale_action_rejections(
    conn: &Connection,
) -> io::Result<Vec<ActivationRejectionMetrics>> {
    let mut stmt = conn
        .prepare(
            "SELECT actor_id, metadata_json
             FROM activation_events
             WHERE event_kind = 'first_tale_action_rejected'
             ORDER BY created_at_ms, actor_id",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sqlite_error)?;
    let mut groups = BTreeMap::<(String, u32), (BTreeSet<u64>, u64)>::new();
    for row in rows {
        let (actor_id, metadata_json) = row.map_err(sqlite_error)?;
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata_json).unwrap_or_else(|_| serde_json::json!({}));
        let Some(phase) = metadata.get("phase").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(status) = metadata
            .get("status")
            .and_then(serde_json::Value::as_u64)
            .and_then(|status| u32::try_from(status).ok())
        else {
            continue;
        };
        if !valid_first_tale_phase(phase) {
            continue;
        }
        let group = groups
            .entry((phase.to_string(), status))
            .or_insert_with(|| (BTreeSet::new(), 0));
        group.0.insert(actor_id.max(0) as u64);
        group.1 = group.1.saturating_add(1);
    }
    Ok(groups
        .into_iter()
        .map(
            |((phase, status), (actors, rejection_count))| ActivationRejectionMetrics {
                phase,
                status,
                actor_count: actors.len() as u64,
                rejection_count,
            },
        )
        .collect())
}

fn read_recent_activation_events(
    conn: &Connection,
    limit: usize,
) -> io::Result<Vec<ActivationEventView>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT actor_id, event_kind, event_key, metadata_json, created_at_ms
             FROM activation_events
             ORDER BY created_at_ms DESC, actor_id DESC
             LIMIT ?1",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![limit as i64], |row| {
            let metadata_json: String = row.get(3)?;
            let metadata =
                serde_json::from_str(&metadata_json).unwrap_or_else(|_| serde_json::json!({}));
            Ok(ActivationEventView {
                actor_id: row.get::<_, i64>(0)?.max(0) as u64,
                event_kind: row.get(1)?,
                event_key: row.get(2)?,
                created_at_ms: row.get::<_, i64>(4)?.max(0) as u64,
                metadata,
            })
        })
        .map_err(sqlite_error)?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(sqlite_error)?);
    }
    events.reverse();
    Ok(events)
}

fn median_u64(mut values: Vec<u64>) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    let mid = values.len() / 2;
    if values.len() % 2 == 1 {
        Some(values[mid])
    } else {
        Some(values[mid - 1].saturating_add(values[mid]) / 2)
    }
}

fn percentile_u64(mut values: Vec<u64>, percentile: usize) -> Option<u64> {
    if values.is_empty() || percentile == 0 || percentile > 100 {
        return None;
    }
    values.sort_unstable();
    let rank = values.len().saturating_mul(percentile).saturating_add(99) / 100;
    values.get(rank.saturating_sub(1)).copied()
}

fn ratio(part: u64, whole: u64) -> Option<f64> {
    (whole > 0).then_some(part as f64 / whole as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_activation_db(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cosyworld-activation-{name}-{}-{}.sqlite",
            std::process::id(),
            now_millis()
        ))
    }

    fn test_activation_dimensions() -> ActivationMetricsDimensions {
        ActivationMetricsDimensions::current("test")
    }

    #[test]
    fn activation_metrics_report_first_bank_and_day_seven_return() {
        let path = temp_activation_db("summary");
        let _ = fs::remove_file(&path);
        let day = ACTIVATION_DAY_MS as u64;

        append_activation_event_at(
            &path,
            5000,
            "avatar_created",
            "avatar_created",
            serde_json::json!({}),
            10,
        )
        .expect("record avatar creation");
        append_activation_event_at(
            &path,
            5000,
            "daily_visit",
            "daily_visit:0",
            serde_json::json!({ "day_index": 0 }),
            20,
        )
        .expect("record same-day visit");
        append_activation_event_at(
            &path,
            5000,
            "daily_visit",
            "daily_visit:7",
            serde_json::json!({ "day_index": 7 }),
            day * 7 + 20,
        )
        .expect("record day-seven visit");
        append_activation_event_at(
            &path,
            5000,
            "first_turn_committed",
            "first_turn_committed",
            serde_json::json!({ "event_seq": 41 }),
            30_010,
        )
        .expect("record first committed turn");
        append_activation_event_at(
            &path,
            5000,
            "first_public_trace",
            "first_public_trace",
            serde_json::json!({ "event_seq": 42 }),
            50_010,
        )
        .expect("record first public trace");
        append_activation_event_at(
            &path,
            5000,
            "first_ledger_banked",
            "first_ledger_banked",
            serde_json::json!({ "event_seq": 43 }),
            70_010,
        )
        .expect("record first ledger bank");
        append_activation_event_at(
            &path,
            6000,
            "avatar_created",
            "avatar_created",
            serde_json::json!({}),
            100,
        )
        .expect("record second avatar creation");

        let response = read_activation_metrics(&path, 10, test_activation_dimensions())
            .expect("read activation metrics");
        assert!(response.ok);
        assert_eq!(response.summary.avatar_created_count, 2);
        assert_eq!(response.summary.actors_with_first_turn_committed, 1);
        assert_eq!(response.summary.first_turn_committed_rate, Some(0.5));
        assert_eq!(response.summary.actors_with_first_public_trace, 1);
        assert_eq!(response.summary.first_public_trace_rate, Some(0.5));
        assert_eq!(response.summary.actors_with_first_banked_ledger, 1);
        assert_eq!(response.summary.actors_with_day_7_return, 1);
        assert_eq!(
            response.summary.median_time_to_first_turn_committed_ms,
            Some(30_000)
        );
        assert_eq!(
            response.summary.median_time_to_first_public_trace_ms,
            Some(50_000)
        );
        assert_eq!(
            response.summary.median_time_to_first_banked_ledger_ms,
            Some(70_000)
        );
        assert_eq!(response.recent_events.len(), 7);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn activation_events_are_idempotent_per_actor_and_key() {
        let path = temp_activation_db("idempotent");
        let _ = fs::remove_file(&path);
        append_activation_event_at(
            &path,
            5000,
            "daily_visit",
            "daily_visit:1",
            serde_json::json!({ "day_index": 1 }),
            10,
        )
        .expect("record visit once");
        append_activation_event_at(
            &path,
            5000,
            "daily_visit",
            "daily_visit:1",
            serde_json::json!({ "day_index": 1 }),
            20,
        )
        .expect("duplicate visit is ignored");

        let conn = open_event_store(&path).expect("open activation db");
        let count = count_distinct_actors(&conn, "daily_visit").expect("count visits");
        let recent = read_recent_activation_events(&conn, 10).expect("read recent");
        assert_eq!(count, 1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].created_at_ms, 10);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn first_tale_presentations_are_allowlisted_idempotent_and_dimensioned() {
        let path = temp_activation_db("presentations");
        let _ = fs::remove_file(&path);
        let phases = [
            ("notice", "first_tale_notice_presented"),
            ("follow_lead", "first_tale_follow_lead_presented"),
            ("contribute", "first_tale_contribute_presented"),
            ("complete", "first_tale_complete_presented"),
            ("return_to_lead", "first_tale_return_to_lead_presented"),
            (
                "return_to_destination",
                "first_tale_return_to_destination_presented",
            ),
            ("travel", "first_tale_travel_presented"),
            ("arrived", "first_tale_arrived_presented"),
            ("accepted", "first_tale_accepted_presented"),
        ];
        for (index, (phase, expected_kind)) in phases.iter().enumerate() {
            let exposure_id = format!("first-tale:{phase}:5000:{index}");
            assert!(record_first_tale_presentation_at(
                &path,
                5000,
                phase,
                "phase_seen",
                &exposure_id,
                "browser",
                40 + index as u64,
                1_000 + index as u64,
            )
            .expect("record allowlisted phase presentation"));
            assert!(!record_first_tale_presentation_at(
                &path,
                5000,
                phase,
                "phase_seen",
                &exposure_id,
                "browser",
                40 + index as u64,
                2_000 + index as u64,
            )
            .expect("duplicate presentation is ignored"));

            let conn = open_event_store(&path).expect("open presentation db");
            let event = read_recent_activation_events(&conn, 20)
                .expect("read presentations")
                .into_iter()
                .find(|event| event.event_kind == *expected_kind)
                .expect("mapped presentation event kind");
            assert_eq!(event.actor_id, 5000);
            assert_eq!(event.metadata["phase"], *phase);
            assert_eq!(event.metadata["interaction"], "phase_seen");
            assert_eq!(event.metadata["transport"], "browser");
            assert_eq!(
                event.metadata["metrics_schema_version"],
                ACTIVATION_METRICS_SCHEMA_VERSION
            );
            assert_eq!(
                event.metadata["metrics_definitions_version"],
                ACTIVATION_METRICS_DEFINITIONS_VERSION
            );
            assert!(event.metadata["release_version"].is_string());
            assert!(event.metadata["worldpack_id"].is_string());
            assert!(event.metadata["worldpack_version"].is_number());
        }

        for (interaction, expected_kind) in [
            ("growth_feedback_seen", "first_growth_feedback_presented"),
            ("completion_memory_seen", "first_tale_completion_presented"),
            ("journal_opened_after_growth", "journal_opened_after_growth"),
        ] {
            assert!(record_first_tale_presentation_at(
                &path,
                5000,
                "complete",
                interaction,
                &format!("first-tale:complete:{interaction}"),
                "agent",
                80,
                3_000,
            )
            .expect("record allowlisted interaction"));
            let conn = open_event_store(&path).expect("open presentation db");
            assert_eq!(
                count_distinct_actors(&conn, expected_kind).expect("count interaction"),
                1
            );
        }

        for invalid in [
            record_first_tale_presentation_at(
                &path,
                5000,
                "invented",
                "phase_seen",
                "valid-id",
                "browser",
                1,
                4_000,
            ),
            record_first_tale_presentation_at(
                &path, 5000, "notice", "invented", "valid-id", "browser", 1, 4_000,
            ),
            record_first_tale_presentation_at(
                &path,
                5000,
                "notice",
                "phase_seen",
                "contains player prose",
                "browser",
                1,
                4_000,
            ),
            record_first_tale_presentation_at(
                &path,
                5000,
                "notice",
                "phase_seen",
                "valid-id",
                "invented",
                1,
                4_000,
            ),
        ] {
            assert_eq!(
                invalid.expect_err("invalid receipt is rejected").kind(),
                io::ErrorKind::InvalidInput
            );
        }

        let _ = fs::remove_file(path);
    }

    #[test]
    fn activation_steps_report_counts_rates_median_p75_and_rejections() {
        let path = temp_activation_db("funnel");
        let _ = fs::remove_file(&path);
        for (actor_id, delta) in [(5000, 10), (5001, 20), (5002, 30), (5003, 40)] {
            append_activation_event_at(
                &path,
                actor_id,
                "avatar_created",
                "avatar_created",
                serde_json::json!({}),
                1_000,
            )
            .expect("record funnel avatar");
            append_activation_event_at(
                &path,
                actor_id,
                "first_tale_notice_presented",
                "notice",
                serde_json::json!({}),
                1_000 + delta,
            )
            .expect("record funnel step");
        }
        for (actor_id, event_key) in [
            (5000, "failure-1"),
            (5000, "failure-2"),
            (5001, "failure-1"),
        ] {
            append_activation_event_at(
                &path,
                actor_id,
                "first_tale_action_rejected",
                event_key,
                serde_json::json!({ "phase": "notice", "status": 409 }),
                2_000,
            )
            .expect("record action rejection");
        }

        let response = read_activation_metrics(&path, 0, test_activation_dimensions())
            .expect("read funnel metrics");
        let notice = response
            .steps
            .iter()
            .find(|step| step.step == "first_tale_notice_presented")
            .expect("notice presentation step");
        assert_eq!(notice.actor_count, 4);
        assert_eq!(notice.rate_from_avatar_created, Some(1.0));
        assert_eq!(notice.median_time_from_avatar_created_ms, Some(25));
        assert_eq!(notice.p75_time_from_avatar_created_ms, Some(30));
        assert_eq!(response.first_tale_action_rejections.len(), 1);
        assert_eq!(response.first_tale_action_rejections[0].phase, "notice");
        assert_eq!(response.first_tale_action_rejections[0].status, 409);
        assert_eq!(response.first_tale_action_rejections[0].actor_count, 2);
        assert_eq!(response.first_tale_action_rejections[0].rejection_count, 3);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn activation_backfills_from_existing_world_events_once() {
        let path = temp_activation_db("backfill");
        let _ = fs::remove_file(&path);
        let conn = open_event_store(&path).expect("open activation backfill db");
        conn.execute_batch(
            "CREATE TABLE world_events (
                seq INTEGER PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
            );
            CREATE TABLE activation_backfills (
                backfill_key TEXT PRIMARY KEY,
                created_at_ms INTEGER NOT NULL
            );
            CREATE TABLE activation_events (
                actor_id INTEGER NOT NULL,
                event_kind TEXT NOT NULL,
                event_key TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                PRIMARY KEY (actor_id, event_key)
            );
            INSERT INTO activation_events
                (actor_id, event_kind, event_key, metadata_json, created_at_ms)
            VALUES (5000, 'avatar_created', 'avatar_created', '{}', 1000);
            INSERT INTO activation_backfills (backfill_key, created_at_ms)
            VALUES ('world_events_v3', 1);",
        )
        .expect("create historical world_events table");

        let presence = EventView {
            seq: 11,
            type_name: "actor.presence".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let first_turn = EventView {
            seq: 12,
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_id: Some(5000),
            location_id: active_first_tale().map(|first_tale| first_tale.lead_location_id),
            dc: Some(LISTEN_DC as i16),
            ..EventView::default()
        };
        let destination = EventView {
            seq: 13,
            type_name: "actor.moved".to_string(),
            success: true,
            actor_id: Some(5000),
            location_id: active_first_tale().map(|first_tale| first_tale.lead_location_id),
            destination_location_id: active_first_tale()
                .map(|first_tale| first_tale.destination_location_id),
            ..EventView::default()
        };
        let banked = EventView {
            seq: 15,
            type_name: "ledger.banked".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let contribution = EventView {
            seq: 14,
            type_name: "job.contribution.resolved".to_string(),
            success: true,
            actor_id: Some(5000),
            content: Some(
                serde_json::json!({
                    "job_id": active_first_tale()
                        .map(|first_tale| first_tale.job_id.as_str())
                        .unwrap_or(FIRST_TALE_JOB_ID),
                    "total_progress": 1
                })
                .to_string(),
            ),
            ..EventView::default()
        };
        let public_trace = EventView {
            seq: 16,
            type_name: "first_tale.public_trace".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let later_visit = EventView {
            seq: 17,
            type_name: "actor.presence".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let background_message = EventView {
            seq: 18,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        for (event, created_at_ms) in [
            (&presence, 2_000_u64),
            (&first_turn, 31_000_u64),
            (&destination, 40_000_u64),
            (&contribution, 46_000_u64),
            (&banked, 61_000_u64),
            (&public_trace, 76_000_u64),
            (&background_message, ACTIVATION_DAY_MS as u64 + 1_000),
            (&later_visit, ACTIVATION_DAY_MS as u64 * 7 + 1_000),
        ] {
            conn.execute(
                "INSERT INTO world_events (seq, event_type, payload_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    event.seq as i64,
                    event.type_name.as_str(),
                    serde_json::to_string(event).expect("serialize event"),
                    created_at_ms as i64
                ],
            )
            .expect("insert historical world event");
        }
        conn.pragma_update(None, "user_version", EVENT_STORE_SCHEMA_VERSION)
            .expect("mark the historical event store globally current");
        drop(conn);

        append_activation_event_at(
            &path,
            5000,
            "daily_visit",
            "deployment-trigger",
            serde_json::json!({ "source": "test" }),
            77_000,
        )
        .expect("an activation write runs the newer activation-only backfill");
        let conn = open_event_store(&path).expect("reopen backfilled store");
        init_activation_store(&conn).expect("second backfill is no-op");
        drop(conn);

        let response = read_activation_metrics(&path, 100, test_activation_dimensions())
            .expect("read backfilled metrics");
        assert_eq!(response.summary.avatar_created_count, 1);
        assert_eq!(response.summary.actors_with_first_turn_committed, 1);
        assert_eq!(response.summary.actors_with_first_public_trace, 1);
        assert_eq!(response.summary.actors_with_first_banked_ledger, 1);
        assert_eq!(response.summary.actors_with_day_1_return, 0);
        assert_eq!(response.summary.actors_with_day_7_return, 1);
        assert_eq!(
            response.summary.median_time_to_first_turn_committed_ms,
            Some(30_000)
        );
        assert_eq!(
            response.summary.median_time_to_first_public_trace_ms,
            Some(75_000)
        );
        assert_eq!(
            response.summary.median_time_to_first_banked_ledger_ms,
            Some(60_000)
        );
        for step in [
            "first_tale_notice_completed",
            "first_growth_settled",
            "first_tale_destination_reached",
            "first_tale_contribution_committed",
            "first_tale_completed",
        ] {
            assert_eq!(
                response
                    .steps
                    .iter()
                    .find(|candidate| candidate.step == step)
                    .map(|candidate| candidate.actor_count),
                Some(1),
                "missing backfilled activation step {step}"
            );
        }
        assert_eq!(
            response
                .recent_events
                .iter()
                .filter(|event| event.event_kind == "avatar_created")
                .count(),
            1
        );

        let _ = fs::remove_file(path);
    }
}
