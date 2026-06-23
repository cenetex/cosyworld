use axum::Json;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{io, path::Path, time::Duration};
use tracing::info;

use crate::{
    deployment_config_error, init_event_store, now_millis, open_event_store, sqlite_error,
    MAX_EVENT_STORE_SCAN,
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
