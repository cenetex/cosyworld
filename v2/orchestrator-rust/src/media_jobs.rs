use super::*;

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
