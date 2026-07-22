use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap},
    response::{Html, IntoResponse},
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{io, path::Path, time::Duration};
use tracing::{error, info, warn};

use crate::kernel::CW_ACTOR_HUMAN;
use crate::{
    active_actor_ids_for_state, clear_actor_sessions_for_actor, commit_presence_event,
    delete_actor_sessions_for_actor, delete_actor_suspension, deployment_config_error,
    event_replay_limit, event_store_scan_limit, init_event_store, no_store_headers, now_millis,
    now_unix_secs, open_event_store, persist_actor_suspension, read_economy_audit,
    read_event_store, resolve_economy_reconciliation, sqlite_error, tail_event_replay,
    ActorSuspension, AiUsageLedgerAuditView, AppState, AvatarPackOpeningView,
    EconomyReconciliationView, EventView, OrbLedgerAuditView, WoodenBoxReceiptView,
    MAX_EVENT_STORE_SCAN, MODERATION_HTML,
};

pub(crate) const MAX_REPORT_REASON_CHARS: usize = 500;
pub(crate) const MAX_REPORT_RESOLUTION_NOTE_CHARS: usize = 500;
pub(crate) const MAX_MODERATOR_LABEL_CHARS: usize = 80;
pub(crate) const DEFAULT_MODERATION_REPORT_RETENTION_DAYS: u64 = 90;
pub(crate) const MODERATION_RETENTION_SWEEP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

const MAX_MODERATION_REPORT_RETENTION_DAYS: u64 = 3650;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ModerationReportRetention {
    pub(crate) days: Option<u64>,
}

impl ModerationReportRetention {
    pub(crate) fn from_env() -> io::Result<Self> {
        let days = match std::env::var("COSYWORLD_MODERATION_REPORT_RETENTION_DAYS") {
            Ok(value) => {
                let trimmed = value.trim();
                if trimmed.is_empty()
                    || matches!(
                        trimmed.to_ascii_lowercase().as_str(),
                        "off" | "none" | "disabled"
                    )
                {
                    None
                } else {
                    let parsed = trimmed.parse::<u64>().map_err(|_| {
                        deployment_config_error(
                            "COSYWORLD_MODERATION_REPORT_RETENTION_DAYS must be a positive number of days, 0, or off",
                        )
                    })?;
                    if parsed == 0 {
                        None
                    } else {
                        Some(parsed.min(MAX_MODERATION_REPORT_RETENTION_DAYS))
                    }
                }
            }
            Err(_) => Some(DEFAULT_MODERATION_REPORT_RETENTION_DAYS),
        };
        Ok(Self { days })
    }

    pub(crate) fn cutoff_ms(self, now_ms: u64) -> Option<u64> {
        let days = self.days?;
        let retention_ms = days.saturating_mul(24 * 60 * 60 * 1000);
        Some(now_ms.saturating_sub(retention_ms))
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct ModerationReportsQuery {
    pub(crate) after: Option<u64>,
    pub(crate) limit: Option<usize>,
    pub(crate) status: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ModerationReportsResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) reports: Vec<ModerationReportView>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct ModerationReportView {
    pub(crate) report_id: u64,
    pub(crate) status: String,
    pub(crate) reporter_actor_id: u64,
    pub(crate) reporter_actor_name: String,
    pub(crate) reporter_actor_kind: String,
    pub(crate) reporter_suspended: bool,
    pub(crate) target_actor_id: u64,
    pub(crate) target_actor_name: String,
    pub(crate) target_actor_kind: String,
    pub(crate) target_suspended: bool,
    pub(crate) location_id: u64,
    pub(crate) location_name: String,
    pub(crate) reason: String,
    pub(crate) created_at_ms: u64,
    pub(crate) resolved_at_ms: Option<u64>,
    pub(crate) resolved_by: Option<String>,
    pub(crate) resolution_note: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModerationReportStatusFilter {
    Open,
    Resolved,
    All,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReportRequest {
    pub(crate) actor_id: u64,
    pub(crate) actor_session: Option<String>,
    pub(crate) target_actor_id: u64,
    pub(crate) reason: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReportResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) report: Option<ModerationReportView>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResolveReportRequest {
    pub(crate) moderator: Option<String>,
    pub(crate) note: Option<String>,
}

pub(crate) enum DeleteModerationReportOutcome {
    Deleted(ModerationReportView),
    NotResolved(ModerationReportView),
    NotFound,
}

pub(crate) fn normalize_report_reason(reason: &str) -> Option<String> {
    if reason
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
    {
        return None;
    }
    let normalized = reason.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() || normalized.chars().count() > MAX_REPORT_REASON_CHARS {
        None
    } else {
        Some(normalized)
    }
}

pub(crate) fn normalize_report_resolution_note(note: Option<&str>) -> Option<Option<String>> {
    let Some(note) = note else {
        return Some(None);
    };
    if note
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
    {
        return None;
    }
    let normalized = note.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() > MAX_REPORT_RESOLUTION_NOTE_CHARS {
        None
    } else if normalized.is_empty() {
        Some(None)
    } else {
        Some(Some(normalized))
    }
}

pub(crate) fn normalize_moderator_label(label: Option<&str>) -> Option<String> {
    let Some(label) = label else {
        return Some("moderator".to_string());
    };
    if label
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
    {
        return None;
    }
    let normalized = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() > MAX_MODERATOR_LABEL_CHARS {
        None
    } else if normalized.is_empty() {
        Some("moderator".to_string())
    } else {
        Some(normalized)
    }
}

pub(crate) fn moderation_report_status_filter(
    status: Option<&str>,
) -> Result<ModerationReportStatusFilter, &'static str> {
    let normalized = status.unwrap_or("open").trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "open" => Ok(ModerationReportStatusFilter::Open),
        "resolved" => Ok(ModerationReportStatusFilter::Resolved),
        "all" => Ok(ModerationReportStatusFilter::All),
        _ => Err("Report status must be open, resolved, or all."),
    }
}

pub(crate) fn report_response(
    ok: bool,
    status: u16,
    report: Option<ModerationReportView>,
    error: impl Into<String>,
) -> Json<ReportResponse> {
    Json(ReportResponse {
        ok,
        status,
        report,
        error: (!ok).then(|| error.into()),
    })
}

pub(crate) fn persist_moderation_report(
    path: &Path,
    report: &ModerationReportView,
) -> io::Result<ModerationReportView> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.execute(
        "INSERT INTO moderation_reports
            (status, reporter_actor_id, reporter_actor_name, reporter_actor_kind,
             target_actor_id, target_actor_name, target_actor_kind,
             location_id, location_name, reason, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            report.status.as_str(),
            report.reporter_actor_id as i64,
            report.reporter_actor_name.as_str(),
            report.reporter_actor_kind.as_str(),
            report.target_actor_id as i64,
            report.target_actor_name.as_str(),
            report.target_actor_kind.as_str(),
            report.location_id as i64,
            report.location_name.as_str(),
            report.reason.as_str(),
            report.created_at_ms as i64,
        ],
    )
    .map_err(sqlite_error)?;
    let mut stored = report.clone();
    stored.report_id = conn.last_insert_rowid().max(0) as u64;
    Ok(stored)
}

pub(crate) fn read_moderation_reports(
    path: &Path,
    after: Option<u64>,
    limit: usize,
    status_filter: ModerationReportStatusFilter,
) -> io::Result<ModerationReportsResponse> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let scan_limit = limit.min(MAX_EVENT_STORE_SCAN) as i64;
    let after = after.unwrap_or(0) as i64;
    let mut reports = match status_filter {
        ModerationReportStatusFilter::All => {
            let mut stmt = conn
                .prepare(
                    "SELECT report_id, status, reporter_actor_id, reporter_actor_name,
                            reporter_actor_kind, target_actor_id, target_actor_name,
                            target_actor_kind, location_id, location_name, reason, created_at_ms,
                            resolved_at_ms, resolved_by, resolution_note
                     FROM moderation_reports
                     WHERE report_id > ?1
                     ORDER BY report_id DESC
                     LIMIT ?2",
                )
                .map_err(sqlite_error)?;
            let rows = stmt
                .query_map(params![after, scan_limit], moderation_report_from_row)
                .map_err(sqlite_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?
        }
        ModerationReportStatusFilter::Open | ModerationReportStatusFilter::Resolved => {
            let status = match status_filter {
                ModerationReportStatusFilter::Open => "open",
                ModerationReportStatusFilter::Resolved => "resolved",
                ModerationReportStatusFilter::All => unreachable!(),
            };
            let mut stmt = conn
                .prepare(
                    "SELECT report_id, status, reporter_actor_id, reporter_actor_name,
                            reporter_actor_kind, target_actor_id, target_actor_name,
                            target_actor_kind, location_id, location_name, reason, created_at_ms,
                            resolved_at_ms, resolved_by, resolution_note
                     FROM moderation_reports
                     WHERE report_id > ?1 AND status = ?2
                     ORDER BY report_id DESC
                     LIMIT ?3",
                )
                .map_err(sqlite_error)?;
            let rows = stmt
                .query_map(
                    params![after, status, scan_limit],
                    moderation_report_from_row,
                )
                .map_err(sqlite_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?
        }
    };
    reports.reverse();
    Ok(ModerationReportsResponse {
        ok: true,
        status: 200,
        reports,
        error: None,
    })
}

pub(crate) fn resolve_moderation_report(
    path: &Path,
    report_id: u64,
    resolved_by: &str,
    resolution_note: Option<&str>,
) -> io::Result<Option<ModerationReportView>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let resolved_at_ms = now_millis() as i64;
    let changed = conn
        .execute(
            "UPDATE moderation_reports
             SET status = 'resolved',
                 resolved_at_ms = ?2,
                 resolved_by = ?3,
                 resolution_note = ?4
             WHERE report_id = ?1",
            params![
                report_id as i64,
                resolved_at_ms,
                resolved_by,
                resolution_note,
            ],
        )
        .map_err(sqlite_error)?;
    if changed == 0 {
        return Ok(None);
    }
    read_moderation_report_by_id(&conn, report_id)
}

pub(crate) fn delete_resolved_moderation_report(
    path: &Path,
    report_id: u64,
) -> io::Result<DeleteModerationReportOutcome> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let Some(report) = read_moderation_report_by_id(&conn, report_id)? else {
        return Ok(DeleteModerationReportOutcome::NotFound);
    };
    if report.status != "resolved" {
        return Ok(DeleteModerationReportOutcome::NotResolved(report));
    }
    conn.execute(
        "DELETE FROM moderation_reports WHERE report_id = ?1 AND status = 'resolved'",
        params![report_id as i64],
    )
    .map_err(sqlite_error)?;
    Ok(DeleteModerationReportOutcome::Deleted(report))
}

pub(crate) fn purge_expired_moderation_reports_for_retention(
    path: &Path,
    retention: ModerationReportRetention,
) -> io::Result<usize> {
    let Some(cutoff_ms) = retention.cutoff_ms(now_millis()) else {
        return Ok(0);
    };
    let purged = purge_resolved_moderation_reports_before(path, cutoff_ms)?;
    if purged > 0 {
        info!(
            "purged {} resolved CosyWorld moderation report(s) older than {} day(s)",
            purged,
            retention.days.unwrap_or_default()
        );
    }
    Ok(purged)
}

pub(crate) fn purge_resolved_moderation_reports_before(
    path: &Path,
    cutoff_ms: u64,
) -> io::Result<usize> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.execute(
        "DELETE FROM moderation_reports
         WHERE status = 'resolved'
           AND resolved_at_ms IS NOT NULL
           AND resolved_at_ms < ?1",
        params![cutoff_ms as i64],
    )
    .map_err(sqlite_error)
}

fn read_moderation_report_by_id(
    conn: &Connection,
    report_id: u64,
) -> io::Result<Option<ModerationReportView>> {
    conn.query_row(
        "SELECT report_id, status, reporter_actor_id, reporter_actor_name,
                reporter_actor_kind, target_actor_id, target_actor_name,
                target_actor_kind, location_id, location_name, reason, created_at_ms,
                resolved_at_ms, resolved_by, resolution_note
         FROM moderation_reports
         WHERE report_id = ?1",
        params![report_id as i64],
        moderation_report_from_row,
    )
    .optional()
    .map_err(sqlite_error)
}

fn moderation_report_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModerationReportView> {
    let resolved_at_ms = row
        .get::<_, Option<i64>>(12)?
        .map(|value| value.max(0) as u64);
    Ok(ModerationReportView {
        report_id: row.get::<_, i64>(0)?.max(0) as u64,
        status: row.get(1)?,
        reporter_actor_id: row.get::<_, i64>(2)?.max(0) as u64,
        reporter_actor_name: row.get(3)?,
        reporter_actor_kind: row.get(4)?,
        reporter_suspended: false,
        target_actor_id: row.get::<_, i64>(5)?.max(0) as u64,
        target_actor_name: row.get(6)?,
        target_actor_kind: row.get(7)?,
        target_suspended: false,
        location_id: row.get::<_, i64>(8)?.max(0) as u64,
        location_name: row.get(9)?,
        reason: row.get(10)?,
        created_at_ms: row.get::<_, i64>(11)?.max(0) as u64,
        resolved_at_ms,
        resolved_by: row.get(13)?,
        resolution_note: row.get(14)?,
    })
}

// ---------------------------------------------------------------------------
// HTTP handlers and auth (extracted from main.rs)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub(crate) struct ModerationEventsQuery {
    pub(crate) after: Option<u64>,
    pub(crate) limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ModerationEventsResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) events: Vec<EventView>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ModerationEconomyResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) orb_ledger: Vec<OrbLedgerAuditView>,
    pub(crate) ai_usage_ledger: Vec<AiUsageLedgerAuditView>,
    pub(crate) wooden_box_receipts: Vec<WoodenBoxReceiptView>,
    pub(crate) avatar_pack_openings: Vec<AvatarPackOpeningView>,
    pub(crate) economy_reconciliations: Vec<EconomyReconciliationView>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResolveEconomyReconciliationRequest {
    pub(crate) moderator: Option<String>,
    pub(crate) note: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct EconomyReconciliationResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) reconciliation: Option<EconomyReconciliationView>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ModerationSuspendRequest {
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ModerationActorResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) actor_id: u64,
    pub(crate) suspended: bool,
    pub(crate) reason: Option<String>,
    pub(crate) suspended_at_unix: Option<u64>,
    pub(crate) error: Option<String>,
}

pub(crate) async fn moderation_events_view(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(query): Query<ModerationEventsQuery>,
) -> Json<ModerationEventsResponse> {
    if !moderation_authorized(&state, &headers) {
        return Json(ModerationEventsResponse {
            ok: false,
            status: 403,
            events: Vec::new(),
        });
    }
    let replay_limit = event_replay_limit(query.limit);
    if replay_limit == 0 {
        return Json(ModerationEventsResponse {
            ok: true,
            status: 200,
            events: Vec::new(),
        });
    }
    if let Some(path) = state.event_store_path.as_deref() {
        match read_event_store(
            path,
            query.after,
            event_store_scan_limit(query.after, replay_limit),
        ) {
            Ok(events) => {
                state.record_event_store_read_success();
                return Json(ModerationEventsResponse {
                    ok: true,
                    status: 200,
                    events: tail_event_replay(events, replay_limit),
                });
            }
            Err(error) => {
                state.record_event_store_read_failure(&error);
                error!(
                    "failed to read CosyWorld v2 moderation event store {}: {}",
                    path.display(),
                    error
                );
            }
        }
    }

    let runtime = state.inner.lock().await;
    let events = runtime
        .event_log
        .iter()
        .filter(|event| query.after.map(|after| event.seq > after).unwrap_or(true))
        .cloned()
        .collect::<Vec<_>>();
    Json(ModerationEventsResponse {
        ok: true,
        status: 200,
        events: tail_event_replay(events, replay_limit),
    })
}

pub(crate) async fn moderation_economy_view(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(query): Query<ModerationEventsQuery>,
) -> Json<ModerationEconomyResponse> {
    if !moderation_authorized(&state, &headers) {
        return Json(ModerationEconomyResponse {
            ok: false,
            status: 403,
            orb_ledger: Vec::new(),
            ai_usage_ledger: Vec::new(),
            wooden_box_receipts: Vec::new(),
            avatar_pack_openings: Vec::new(),
            economy_reconciliations: Vec::new(),
            error: Some("moderation bearer token required".to_string()),
        });
    }
    let limit = event_replay_limit(query.limit);
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(ModerationEconomyResponse {
            ok: false,
            status: 503,
            orb_ledger: Vec::new(),
            ai_usage_ledger: Vec::new(),
            wooden_box_receipts: Vec::new(),
            avatar_pack_openings: Vec::new(),
            economy_reconciliations: Vec::new(),
            error: Some("event store is required for economy audit".to_string()),
        });
    };
    if limit == 0 {
        return Json(ModerationEconomyResponse {
            ok: true,
            status: 200,
            orb_ledger: Vec::new(),
            ai_usage_ledger: Vec::new(),
            wooden_box_receipts: Vec::new(),
            avatar_pack_openings: Vec::new(),
            economy_reconciliations: Vec::new(),
            error: None,
        });
    }

    match read_economy_audit(path, limit) {
        Ok(response) => Json(response),
        Err(error) => {
            warn!(
                "failed to read CosyWorld v2 economy audit store {}: {}",
                path.display(),
                error
            );
            Json(ModerationEconomyResponse {
                ok: false,
                status: 500,
                orb_ledger: Vec::new(),
                ai_usage_ledger: Vec::new(),
                wooden_box_receipts: Vec::new(),
                avatar_pack_openings: Vec::new(),
                economy_reconciliations: Vec::new(),
                error: Some(error.to_string()),
            })
        }
    }
}

pub(crate) async fn moderation_resolve_economy_reconciliation(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<u64>,
    Json(payload): Json<ResolveEconomyReconciliationRequest>,
) -> Json<EconomyReconciliationResponse> {
    if !moderation_authorized(&state, &headers) {
        return Json(EconomyReconciliationResponse {
            ok: false,
            status: 403,
            reconciliation: None,
            error: Some("moderation bearer token required".to_string()),
        });
    }
    if run_id == 0 {
        return Json(EconomyReconciliationResponse {
            ok: false,
            status: 400,
            reconciliation: None,
            error: Some("Reconciliation run id is required.".to_string()),
        });
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(EconomyReconciliationResponse {
            ok: false,
            status: 503,
            reconciliation: None,
            error: Some("Economy reconciliation requires the event store.".to_string()),
        });
    };
    let Some(moderator) = normalize_moderator_label(payload.moderator.as_deref()) else {
        return Json(EconomyReconciliationResponse {
            ok: false,
            status: 400,
            reconciliation: None,
            error: Some(format!(
                "Moderator label must be under {MAX_MODERATOR_LABEL_CHARS} characters."
            )),
        });
    };
    let Some(note) = normalize_report_resolution_note(payload.note.as_deref()) else {
        return Json(EconomyReconciliationResponse {
            ok: false,
            status: 400,
            reconciliation: None,
            error: Some(format!(
                "Resolution note must be under {MAX_REPORT_RESOLUTION_NOTE_CHARS} characters."
            )),
        });
    };

    match resolve_economy_reconciliation(path, run_id, &moderator, note.as_deref()) {
        Ok(Some(reconciliation)) if reconciliation.status == "clear" => {
            Json(EconomyReconciliationResponse {
                ok: false,
                status: 409,
                reconciliation: Some(reconciliation),
                error: Some("A clear reconciliation run has no anomaly to resolve.".to_string()),
            })
        }
        Ok(Some(reconciliation)) => Json(EconomyReconciliationResponse {
            ok: true,
            status: 200,
            reconciliation: Some(reconciliation),
            error: None,
        }),
        Ok(None) => Json(EconomyReconciliationResponse {
            ok: false,
            status: 404,
            reconciliation: None,
            error: Some("Reconciliation run was not found.".to_string()),
        }),
        Err(error) => {
            warn!(
                "failed to resolve economy reconciliation {} in {}: {}",
                run_id,
                path.display(),
                error
            );
            Json(EconomyReconciliationResponse {
                ok: false,
                status: 500,
                reconciliation: None,
                error: Some("Reconciliation run could not be resolved.".to_string()),
            })
        }
    }
}

pub(crate) async fn moderation_reports_view(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(query): Query<ModerationReportsQuery>,
) -> Json<ModerationReportsResponse> {
    if !moderation_authorized(&state, &headers) {
        return Json(ModerationReportsResponse {
            ok: false,
            status: 403,
            reports: Vec::new(),
            error: Some("moderation bearer token required".to_string()),
        });
    }
    let status_filter = match moderation_report_status_filter(query.status.as_deref()) {
        Ok(filter) => filter,
        Err(error) => {
            return Json(ModerationReportsResponse {
                ok: false,
                status: 400,
                reports: Vec::new(),
                error: Some(error.to_string()),
            });
        }
    };
    let limit = event_replay_limit(query.limit);
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(ModerationReportsResponse {
            ok: false,
            status: 503,
            reports: Vec::new(),
            error: Some("event store is required for moderation reports".to_string()),
        });
    };
    if limit == 0 {
        return Json(ModerationReportsResponse {
            ok: true,
            status: 200,
            reports: Vec::new(),
            error: None,
        });
    }

    match read_moderation_reports(path, query.after, limit, status_filter) {
        Ok(mut response) => {
            annotate_moderation_report_suspensions(&state, &mut response.reports);
            Json(response)
        }
        Err(error) => {
            warn!(
                "failed to read CosyWorld v2 moderation reports store {}: {}",
                path.display(),
                error
            );
            Json(ModerationReportsResponse {
                ok: false,
                status: 500,
                reports: Vec::new(),
                error: Some(error.to_string()),
            })
        }
    }
}

pub(crate) fn annotate_moderation_report_suspensions(
    state: &AppState,
    reports: &mut [ModerationReportView],
) {
    let Ok(suspensions) = state.actor_suspensions.lock() else {
        return;
    };
    for report in reports {
        report.reporter_suspended = suspensions.contains_key(&report.reporter_actor_id);
        report.target_suspended = suspensions.contains_key(&report.target_actor_id);
    }
}

pub(crate) async fn moderation_resolve_report(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(report_id): AxumPath<u64>,
    Json(payload): Json<ResolveReportRequest>,
) -> Json<ReportResponse> {
    if !moderation_authorized(&state, &headers) {
        return report_response(false, 403, None, "moderation bearer token required");
    }
    if report_id == 0 {
        return report_response(false, 400, None, "Report id is required.");
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return report_response(
            false,
            503,
            None,
            "Report queue requires the event store to be enabled.",
        );
    };
    let moderator = match normalize_moderator_label(payload.moderator.as_deref()) {
        Some(label) => label,
        None => {
            return report_response(
                false,
                400,
                None,
                format!("Moderator label must be under {MAX_MODERATOR_LABEL_CHARS} characters."),
            );
        }
    };
    let note = match normalize_report_resolution_note(payload.note.as_deref()) {
        Some(note) => note,
        None => {
            return report_response(
                false,
                400,
                None,
                format!(
                    "Resolution note must be under {MAX_REPORT_RESOLUTION_NOTE_CHARS} characters."
                ),
            );
        }
    };

    match resolve_moderation_report(path, report_id, &moderator, note.as_deref()) {
        Ok(Some(report)) => report_response(true, 200, Some(report), ""),
        Ok(None) => report_response(false, 404, None, "Report was not found."),
        Err(error) => {
            warn!(
                "failed to resolve CosyWorld moderation report {} in {}: {}",
                report_id,
                path.display(),
                error
            );
            report_response(false, 500, None, "Report could not be resolved.")
        }
    }
}

pub(crate) async fn moderation_delete_report(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(report_id): AxumPath<u64>,
) -> Json<ReportResponse> {
    if !moderation_authorized(&state, &headers) {
        return report_response(false, 403, None, "moderation bearer token required");
    }
    if report_id == 0 {
        return report_response(false, 400, None, "Report id is required.");
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return report_response(
            false,
            503,
            None,
            "Report queue requires the event store to be enabled.",
        );
    };

    match delete_resolved_moderation_report(path, report_id) {
        Ok(DeleteModerationReportOutcome::Deleted(report)) => {
            report_response(true, 200, Some(report), "")
        }
        Ok(DeleteModerationReportOutcome::NotResolved(report)) => {
            report_response(false, 409, Some(report), "Resolve report before deletion.")
        }
        Ok(DeleteModerationReportOutcome::NotFound) => {
            report_response(false, 404, None, "Report was not found.")
        }
        Err(error) => {
            warn!(
                "failed to delete CosyWorld moderation report {} in {}: {}",
                report_id,
                path.display(),
                error
            );
            report_response(false, 500, None, "Report could not be deleted.")
        }
    }
}

pub(crate) async fn moderation_suspend_actor(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(actor_id): AxumPath<u64>,
    Json(payload): Json<ModerationSuspendRequest>,
) -> Json<ModerationActorResponse> {
    if !moderation_authorized(&state, &headers) {
        return moderation_actor_response(
            false,
            403,
            actor_id,
            false,
            None,
            None,
            Some("moderation bearer token required".to_string()),
        );
    }
    let runtime = state.inner.lock().await;
    let is_human = runtime
        .actor_by_id(actor_id)
        .map(|actor| actor.kind == CW_ACTOR_HUMAN)
        .unwrap_or(false);
    drop(runtime);
    if !is_human {
        return moderation_actor_response(
            false,
            404,
            actor_id,
            false,
            None,
            None,
            Some("actor was not found or is not a human avatar".to_string()),
        );
    }

    let was_visible_in_presence = active_actor_ids_for_state(&state).contains(&actor_id);
    let reason = normalize_moderation_reason(payload.reason.as_deref());
    let created_at_unix = now_unix_secs();
    let suspension = ActorSuspension {
        reason: reason.clone(),
        created_at_unix,
    };
    if let Ok(mut suspensions) = state.actor_suspensions.lock() {
        suspensions.insert(actor_id, suspension);
    }
    clear_actor_sessions_for_actor(&state.actor_sessions, actor_id);
    if let Some(path) = state.event_store_path.as_deref() {
        if let Err(error) = persist_actor_suspension(path, actor_id, &reason) {
            warn!(
                "failed to persist CosyWorld actor suspension for {}: {}",
                actor_id, error
            );
        }
        if let Err(error) = delete_actor_sessions_for_actor(path, actor_id) {
            warn!(
                "failed to delete CosyWorld actor sessions for suspended actor {}: {}",
                actor_id, error
            );
        }
    }
    if was_visible_in_presence {
        commit_presence_event(&state, actor_id, false).await;
    }
    moderation_actor_response(
        true,
        200,
        actor_id,
        true,
        Some(reason),
        Some(created_at_unix),
        None,
    )
}

pub(crate) async fn moderation_unsuspend_actor(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(actor_id): AxumPath<u64>,
) -> Json<ModerationActorResponse> {
    if !moderation_authorized(&state, &headers) {
        return moderation_actor_response(
            false,
            403,
            actor_id,
            true,
            None,
            None,
            Some("moderation bearer token required".to_string()),
        );
    }
    let removed = state
        .actor_suspensions
        .lock()
        .map(|mut suspensions| suspensions.remove(&actor_id))
        .ok()
        .flatten();
    if let Some(path) = state.event_store_path.as_deref() {
        if let Err(error) = delete_actor_suspension(path, actor_id) {
            warn!(
                "failed to delete CosyWorld actor suspension for {}: {}",
                actor_id, error
            );
        }
    }
    let (reason, suspended_at_unix) = removed
        .map(|entry| (Some(entry.reason), Some(entry.created_at_unix)))
        .unwrap_or((None, None));
    moderation_actor_response(true, 200, actor_id, false, reason, suspended_at_unix, None)
}

pub(crate) fn moderation_actor_response(
    ok: bool,
    status: u16,
    actor_id: u64,
    suspended: bool,
    reason: Option<String>,
    suspended_at_unix: Option<u64>,
    error: Option<String>,
) -> Json<ModerationActorResponse> {
    Json(ModerationActorResponse {
        ok,
        status,
        actor_id,
        suspended,
        reason,
        suspended_at_unix,
        error,
    })
}

pub(crate) fn moderation_authorized(state: &AppState, headers: &HeaderMap) -> bool {
    moderation_authorized_token(
        state.moderation_token.as_deref().map(String::as_str),
        headers,
    )
}

pub(crate) fn moderation_authorized_token(expected: Option<&str>, headers: &HeaderMap) -> bool {
    let Some(expected) = expected else {
        return false;
    };
    let Some(value) = headers.get(header::AUTHORIZATION) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    value.trim() == format!("Bearer {expected}")
}

pub(crate) fn normalize_moderation_reason(reason: Option<&str>) -> String {
    let mut normalized = reason
        .unwrap_or("moderator action")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        normalized = "moderator action".to_string();
    }
    if normalized.chars().count() > 160 {
        normalized = normalized.chars().take(160).collect();
    }
    normalized
}

pub(crate) async fn moderation_console() -> impl IntoResponse {
    (no_store_headers(), Html(MODERATION_HTML))
}
