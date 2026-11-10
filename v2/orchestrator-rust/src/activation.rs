use super::*;

const ACTIVATION_DAY_MS: i64 = 86_400_000;
pub(super) const ACTIVATION_METRICS_SCHEMA_VERSION: u32 = 4;
pub(super) const ACTIVATION_METRICS_DEFINITIONS_VERSION: &str = "cosyworld.activation/4";
const WORLD_EVENTS_BACKFILL_KEY: &str = "world_events_v4_activation_funnel";

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
        && !(event.type_name == "ability_check.rolled" && event.content.as_deref() == Some("think"))
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
