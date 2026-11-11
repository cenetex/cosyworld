// The hosted server boots card-only (#1652): the card table, accounts, shared
// worlds, dialogue, voices, authoring, play metrics, `/meta` and `/health`.
// The retired classic world is gone; its rows stay in the event store, unread.
mod account_auth;
mod account_avatars;
mod account_revision;
mod ai_bench;
mod ai_gateway;
mod ai_readiness;
mod authoring_draft;
mod canonical_journal;
mod card_authoring;
mod card_boot;
mod card_shared;
mod config;
mod content_policy;
mod generated_asset_budget;
#[allow(dead_code)]
mod moderation;
mod rate_limit;
mod routes;
mod shutdown;
mod startup;
mod storage_report;
#[cfg(test)]
mod test_support;
mod util;
use account_auth::*;
use ai_gateway::*;
use ai_readiness::*;
use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use canonical_journal::*;
pub(crate) use config::{deployment_config_error, DeploymentConfig};
use content_policy::*;
use rate_limit::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use shutdown::*;
use std::{
    collections::BTreeMap,
    fs, io,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(test)]
use test_support::*;
use tokio::net::TcpListener;
use tracing::{error, info, warn};
pub(crate) use util::*;

#[derive(Clone)]
struct AppState {
    deployment: DeploymentConfig,
    event_store_path: Option<Arc<PathBuf>>,
    event_store_writer: Option<Arc<StdMutex<Connection>>>,
    event_store_health: Arc<StdMutex<EventStoreHealth>>,
    account_auth: Arc<AccountAuth>,
    ai_config: Arc<Option<AiConfig>>,
    generated_asset_dir: Arc<PathBuf>,
    rate_limiter: Arc<StdMutex<RateLimiter>>,
    moderation_token: Option<Arc<String>>,
}

#[derive(Clone, Debug, Default)]
struct EventStoreHealth {
    last_append_success_at_unix: Option<u64>,
    last_read_success_at_unix: Option<u64>,
    last_failure_at_unix: Option<u64>,
    consecutive_append_failures: u32,
    consecutive_read_failures: u32,
    last_error_code: Option<String>,
}

impl EventStoreHealth {
    fn status(&self, configured: bool) -> &'static str {
        if !configured {
            "disabled"
        } else if self.consecutive_append_failures > 0 || self.consecutive_read_failures > 0 {
            "degraded"
        } else if self.last_append_success_at_unix.is_some()
            || self.last_read_success_at_unix.is_some()
        {
            "healthy"
        } else {
            "pending"
        }
    }

    fn record_append_success(&mut self) {
        self.last_append_success_at_unix = Some(now_unix_secs());
        self.consecutive_append_failures = 0;
        self.refresh_error_code();
    }

    fn refresh_error_code(&mut self) {
        if self.consecutive_append_failures == 0 && self.consecutive_read_failures == 0 {
            self.last_error_code = None;
        }
    }
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct MetaEventStoreHealth {
    status: &'static str,
    last_append_success_at_unix: Option<u64>,
    last_read_success_at_unix: Option<u64>,
    last_failure_at_unix: Option<u64>,
    consecutive_append_failures: u32,
    consecutive_read_failures: u32,
    pending_event_count: usize,
    last_error_code: Option<String>,
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    startup::run().await
}

impl AppState {
    fn allow_rate_limit(&self, key: impl Into<String>, limit: RateLimit) -> bool {
        self.rate_limiter
            .lock()
            .map(|mut limiter| limiter.allow(key.into(), limit, Instant::now()))
            .unwrap_or(false)
    }
}

fn event_store_readiness(state: &AppState) -> Result<(), String> {
    if state.event_store_path.is_none() {
        return Ok(());
    }
    let health = state
        .event_store_health
        .lock()
        .map_err(|_| "event store health is unavailable".to_string())?;
    if health.status(true) == "healthy" {
        Ok(())
    } else {
        Err(format!("event store is {}", health.status(true)))
    }
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    if let Err(error) = event_store_readiness(&state) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                ok: false,
                service: "cosyworld-orchestrator",
                status: "not_ready",
                error: Some(error),
            }),
        );
    }
    if let Err(error) = required_processes_ready(&required_health_urls_from_env()).await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                ok: false,
                service: "cosyworld-orchestrator",
                status: "not_ready",
                error: Some(error),
            }),
        );
    }
    (
        StatusCode::OK,
        Json(HealthResponse {
            ok: true,
            service: "cosyworld-orchestrator",
            status: "ready",
            error: None,
        }),
    )
}

async fn health_live() -> (StatusCode, Json<HealthResponse>) {
    (
        StatusCode::OK,
        Json(HealthResponse {
            ok: true,
            service: "cosyworld-orchestrator",
            status: "alive",
            error: None,
        }),
    )
}
/// (issue #886). Set only for the maintenance-window deploy; unset after.
fn one_time_auto_vacuum_requested() -> bool {
    std::env::var("COSYWORLD_ONE_TIME_AUTO_VACUUM")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn event_store_path_from_env() -> Option<PathBuf> {
    match std::env::var("COSYWORLD_V2_EVENT_DB_PATH") {
        Ok(value) if value.trim().is_empty() => None,
        Ok(value) if value.eq_ignore_ascii_case("off") || value.eq_ignore_ascii_case("none") => {
            None
        }
        Ok(value) => Some(PathBuf::from(value)),
        Err(_) => Some(PathBuf::from(".runtime/cosyworld-v2-events.sqlite")),
    }
}

/// Schema version stamped after DDL runs. Bump it when a table is added so
/// existing stores self-heal once on their next initialization.
const EVENT_STORE_SCHEMA_VERSION: i64 = 7;

/// Ensures the schema exists without taking its write lock on steady-state
/// commits. Missing, replaced, and older stores rerun the idempotent DDL.
fn init_event_store(path: &Path) -> io::Result<()> {
    if path.exists() {
        let conn = open_event_store(path)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(sqlite_error)?;
        if version >= EVENT_STORE_SCHEMA_VERSION {
            return Ok(());
        }
    }
    initialize_event_store_schema(path)
}

/// Creates the tables the card table and accounts need. The classic world's
/// tables are no longer created; existing stores keep them on disk, unread.
fn initialize_event_store_schema(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let conn = open_canonical_store_for_initialization(path)?;
    conn.pragma_update(None, "user_version", EVENT_STORE_SCHEMA_VERSION)
        .map_err(sqlite_error)?;
    conn.execute_batch(account_avatars::SCHEMA)
        .map_err(sqlite_error)?;
    Ok(())
}
