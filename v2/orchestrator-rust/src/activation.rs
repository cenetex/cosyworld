use super::*;

const ACTIVATION_DAY_MS: i64 = 86_400_000;
const WORLD_EVENTS_BACKFILL_KEY: &str = "world_events_v2";

#[derive(Clone, Debug, Serialize, Default)]
pub(super) struct ActivationMetricsSummary {
    avatar_created_count: u64,
    actors_with_first_turn_committed: u64,
    first_turn_committed_rate: Option<f64>,
    actors_with_first_banked_ledger: u64,
    first_banked_ledger_rate: Option<f64>,
    actors_with_day_1_return: u64,
    day_1_return_rate: Option<f64>,
    actors_with_day_7_return: u64,
    day_7_return_rate: Option<f64>,
    median_time_to_first_turn_committed_ms: Option<u64>,
    median_time_to_first_banked_ledger_ms: Option<u64>,
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
    summary: ActivationMetricsSummary,
    recent_events: Vec<ActivationEventView>,
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
}

pub(super) fn record_first_ledger_banked(state: &AppState, actor_id: u64, event_seq: u64) {
    record_activation_event(
        state,
        actor_id,
        "first_ledger_banked",
        "first_ledger_banked",
        serde_json::json!({ "event_seq": event_seq }),
    );
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
) -> io::Result<()> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
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

    let mut created_actors = BTreeSet::new();
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
                    serde_json::json!({ "source_event_seq": event.seq, "source": "world_events_backfill" }),
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
        let day_index = created_at_ms / ACTIVATION_DAY_MS as u64;
        insert_activation_event_conn(
            conn,
            actor_id,
            "daily_visit",
            &format!("daily_visit:{day_index}"),
            serde_json::json!({
                "day_index": day_index,
                "source_event_seq": event.seq,
                "source": "world_events_backfill"
            }),
            created_at_ms,
        )?;
        if event.type_name == "ledger.banked" && event.success {
            insert_activation_event_conn(
                conn,
                actor_id,
                "first_ledger_banked",
                "first_ledger_banked",
                serde_json::json!({ "event_seq": event.seq, "source": "world_events_backfill" }),
                created_at_ms,
            )?;
        }
        if event_counts_as_first_committed_turn(&event) {
            insert_activation_event_conn(
                conn,
                actor_id,
                "first_turn_committed",
                "first_turn_committed",
                serde_json::json!({
                    "event_seq": event.seq,
                    "event_type": event.type_name,
                    "source": "world_events_backfill"
                }),
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

fn event_counts_as_first_committed_turn(event: &EventView) -> bool {
    event.success
        && event.actor_id.is_some()
        && !matches!(
            event.type_name.as_str(),
            "actor.created"
                | "actor.presence"
                | "turn.ping_started"
                | "turn.pong"
                | "turn.ping_skipped"
                | "turn.timeout_requested"
                | "turn.timeout_passed"
                | "turn.waiting"
                | "world.bootstrapped"
                | "world.reset"
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
    if !moderation_authorized(&state, &headers) {
        return Json(ActivationMetricsResponse {
            ok: false,
            status: 403,
            summary: ActivationMetricsSummary::default(),
            recent_events: Vec::new(),
            error: Some("moderation bearer token required".to_string()),
        });
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(ActivationMetricsResponse {
            ok: false,
            status: 503,
            summary: ActivationMetricsSummary::default(),
            recent_events: Vec::new(),
            error: Some("event store is required for activation metrics".to_string()),
        });
    };
    match read_activation_metrics(path, event_replay_limit(query.limit)) {
        Ok(response) => Json(response),
        Err(error) => {
            warn!(
                "failed to read CosyWorld v2 activation metrics from {}: {}",
                path.display(),
                error
            );
            Json(ActivationMetricsResponse {
                ok: false,
                status: 500,
                summary: ActivationMetricsSummary::default(),
                recent_events: Vec::new(),
                error: Some(error.to_string()),
            })
        }
    }
}

fn read_activation_metrics(path: &Path, limit: usize) -> io::Result<ActivationMetricsResponse> {
    let conn = open_event_store(path)?;
    init_activation_store(&conn)?;
    let avatar_created_count = count_distinct_actors(&conn, "avatar_created")?;
    let actors_with_first_turn_committed = count_distinct_actors(&conn, "first_turn_committed")?;
    let actors_with_first_banked_ledger = count_distinct_actors(&conn, "first_ledger_banked")?;
    let actors_with_day_1_return = count_returning_actors(&conn, 1)?;
    let actors_with_day_7_return = count_returning_actors(&conn, 7)?;
    let median_time_to_first_turn_committed_ms =
        median_u64(first_event_deltas(&conn, "first_turn_committed")?);
    let median_time_to_first_banked_ledger_ms =
        median_u64(first_event_deltas(&conn, "first_ledger_banked")?);
    let recent_events = read_recent_activation_events(&conn, limit)?;
    Ok(ActivationMetricsResponse {
        ok: true,
        status: 200,
        summary: ActivationMetricsSummary {
            avatar_created_count,
            actors_with_first_turn_committed,
            first_turn_committed_rate: ratio(
                actors_with_first_turn_committed,
                avatar_created_count,
            ),
            actors_with_first_banked_ledger,
            first_banked_ledger_rate: ratio(actors_with_first_banked_ledger, avatar_created_count),
            actors_with_day_1_return,
            day_1_return_rate: ratio(actors_with_day_1_return, avatar_created_count),
            actors_with_day_7_return,
            day_7_return_rate: ratio(actors_with_day_7_return, avatar_created_count),
            median_time_to_first_turn_committed_ms,
            median_time_to_first_banked_ledger_ms,
        },
        recent_events,
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
            "first_ledger_banked",
            "first_ledger_banked",
            serde_json::json!({ "event_seq": 42 }),
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

        let response = read_activation_metrics(&path, 10).expect("read activation metrics");
        assert!(response.ok);
        assert_eq!(response.summary.avatar_created_count, 2);
        assert_eq!(response.summary.actors_with_first_turn_committed, 1);
        assert_eq!(response.summary.first_turn_committed_rate, Some(0.5));
        assert_eq!(response.summary.actors_with_first_banked_ledger, 1);
        assert_eq!(response.summary.actors_with_day_7_return, 1);
        assert_eq!(
            response.summary.median_time_to_first_turn_committed_ms,
            Some(30_000)
        );
        assert_eq!(
            response.summary.median_time_to_first_banked_ledger_ms,
            Some(70_000)
        );
        assert_eq!(response.recent_events.len(), 6);

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
            );",
        )
        .expect("create historical world_events table");

        let created = EventView {
            seq: 10,
            type_name: "actor.created".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let presence = EventView {
            seq: 11,
            type_name: "actor.presence".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let first_turn = EventView {
            seq: 12,
            type_name: "feature.searched".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let banked = EventView {
            seq: 13,
            type_name: "ledger.banked".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        let later_visit = EventView {
            seq: 14,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        };
        for (event, created_at_ms) in [
            (&created, 1_000_u64),
            (&presence, 2_000_u64),
            (&first_turn, 31_000_u64),
            (&banked, 61_000_u64),
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

        init_activation_store(&conn).expect("backfill activation");
        init_activation_store(&conn).expect("second backfill is no-op");
        drop(conn);

        let response = read_activation_metrics(&path, 10).expect("read backfilled metrics");
        assert_eq!(response.summary.avatar_created_count, 1);
        assert_eq!(response.summary.actors_with_first_turn_committed, 1);
        assert_eq!(response.summary.actors_with_first_banked_ledger, 1);
        assert_eq!(response.summary.actors_with_day_7_return, 1);
        assert_eq!(
            response.summary.median_time_to_first_turn_committed_ms,
            Some(30_000)
        );
        assert_eq!(
            response.summary.median_time_to_first_banked_ledger_ms,
            Some(60_000)
        );
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
