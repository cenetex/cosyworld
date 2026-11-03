//! Anonymous play counts (#2052): daily totals of a fixed set of counters.
//!
//! The card table posts `{day, counters: {name: count}}`. Nothing here keeps
//! who sent it: no IP, account, world, install or session id, and no text.
//! The IP is used only in memory for the rate limit, and the request log
//! names the route and status, never the body. Rows are `(day, name, count)`
//! and are purged after `RETENTION_DAYS`. The counts are diagnostics only:
//! nothing reads them back into play.
use std::collections::BTreeMap;
use std::{net::SocketAddr, path::Path, time::Duration};

use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::json;

use crate::{
    canonical_journal::event_store_writer,
    moderation::moderation_authorized,
    rate_limit::{client_ip_key, rate_limit_key, RateLimit},
    util::now_millis,
    AppState,
};

/// Every counter the server accepts. The client mirrors this list in
/// `v2/card-game/metrics.mjs`; a name outside it refuses the whole batch.
pub(crate) const COUNTERS: &str = "\
    session.start session.end play.accompany play.ask play.attack \
    play.choose play.course play.cover play.drop play.give play.guard \
    play.intercept play.light play.move play.refuel play.retreat play.ring \
    play.sleep play.snuff play.take play.talk play.threaten play.trade \
    play.use play.wait play.other quest.accept quest.abandon quest.met \
    line.skip line.finish_early scrollback.open voice.line.lt2s \
    voice.line.2to5s voice.line.5to10s voice.line.10to20s voice.line.gt20s \
    voice.silent voice.failed travel defeat intro.skip intro.wake \
    error.network error.timeout error.rules_reject error.storage \
    error.script error.other";

fn known(name: &str) -> bool {
    COUNTERS.split_whitespace().any(|known| known == name)
}

pub(crate) const RETENTION_DAYS: i64 = 400;
/// One tab flushes once a minute and on pagehide; a batch never needs more.
pub(crate) const MAX_COUNT: u32 = 1_000;
const MAX_BODY_BYTES: usize = 4 * 1024;
const SUMMARY_DAYS: i64 = 7;
pub(crate) const METRICS_LIMIT: RateLimit = RateLimit {
    max_hits: 12,
    window: Duration::from_secs(60),
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Batch {
    day: i64,
    counters: BTreeMap<String, u32>,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/card-game/metrics",
            post(record).layer(DefaultBodyLimit::max(MAX_BODY_BYTES)),
        )
        .route("/moderation/play-metrics", get(summary))
}

fn utc_day(now_ms: u64) -> i64 {
    (now_ms / 86_400_000) as i64
}

/// Parse and check one batch: a known day near today, known names only,
/// and each count within the cap. Zero counts are dropped.
pub(crate) fn parse(body: &[u8], today: i64) -> Option<Batch> {
    let mut batch: Batch = serde_json::from_slice(body).ok()?;
    if (batch.day - today).abs() > 1 || batch.counters.len() > COUNTERS.split_whitespace().count() {
        return None;
    }
    if batch
        .counters
        .iter()
        .any(|(name, count)| !known(name) || *count > MAX_COUNT)
    {
        return None;
    }
    batch.counters.retain(|_, count| *count > 0);
    Some(batch)
}

fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS play_metrics_daily (
            day INTEGER NOT NULL,
            name TEXT NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY (day, name)
        ) WITHOUT ROWID",
    )
}

/// Add a batch to the daily totals and drop days past retention.
pub(crate) fn store(conn: &mut Connection, batch: &Batch, today: i64) -> rusqlite::Result<()> {
    ensure_table(conn)?;
    let tx = conn.transaction()?;
    for (name, count) in &batch.counters {
        tx.execute(
            "INSERT INTO play_metrics_daily (day, name, count) VALUES (?1, ?2, ?3)
             ON CONFLICT (day, name) DO UPDATE SET count = count + excluded.count",
            params![batch.day, name, count],
        )?;
    }
    tx.execute(
        "DELETE FROM play_metrics_daily WHERE day < ?1",
        params![today - RETENTION_DAYS],
    )?;
    tx.commit()
}

/// Totals for the last `SUMMARY_DAYS` days, newest first.
pub(crate) fn read_summary(
    conn: &Connection,
    today: i64,
) -> rusqlite::Result<Vec<serde_json::Value>> {
    ensure_table(conn)?;
    let mut stmt = conn.prepare(
        "SELECT day, name, count FROM play_metrics_daily WHERE day > ?1 ORDER BY day DESC, name",
    )?;
    let rows = stmt.query_map(params![today - SUMMARY_DAYS], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let mut days: Vec<(i64, serde_json::Map<String, serde_json::Value>)> = Vec::new();
    for row in rows {
        let (day, name, count) = row?;
        if days.last().is_none_or(|(last, _)| *last != day) {
            days.push((day, serde_json::Map::new()));
        }
        days.last_mut().unwrap().1.insert(name, count.into());
    }
    Ok(days
        .into_iter()
        .map(|(day, counters)| json!({ "day": day, "counters": counters }))
        .collect())
}

fn with_store<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Option<tokio::task::JoinHandle<Option<T>>> {
    let path = state.event_store_path.clone()?;
    let shared = state.event_store_writer.clone();
    Some(tokio::task::spawn_blocking(move || {
        let mut conn = event_store_writer(shared.as_deref(), Path::new(path.as_ref())).ok()?;
        work(&mut conn).ok()
    }))
}

async fn record(
    ConnectInfo(client): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !crate::routes::card_game::narrative::same_origin(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !state.allow_rate_limit(
        rate_limit_key("play-metrics-ip", client_ip_key(client)),
        METRICS_LIMIT,
    ) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let today = utc_day(now_millis());
    let Some(batch) = parse(&body, today) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if batch.counters.is_empty() {
        return StatusCode::NO_CONTENT.into_response();
    }
    let Some(job) = with_store(&state, move |conn| store(conn, &batch, today)) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match job.await {
        Ok(Some(())) => StatusCode::NO_CONTENT.into_response(),
        _ => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn summary(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !moderation_authorized(&state, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let today = utc_day(now_millis());
    let Some(job) = with_store(&state, move |conn| read_summary(conn, today)) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match job.await {
        Ok(Some(days)) => {
            Json(json!({ "ok": true, "retentionDays": RETENTION_DAYS, "days": days }))
                .into_response()
        }
        _ => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
#[path = "play_metrics_tests.rs"]
mod tests;
