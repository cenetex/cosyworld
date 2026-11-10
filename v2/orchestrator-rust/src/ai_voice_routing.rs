use rusqlite::Connection;
use std::{io, time::Duration};

pub(crate) const VOICE_MAX_ATTEMPTS_ENV: &str = "COSYWORLD_AI_VOICE_MAX_ATTEMPTS";
pub(crate) const VOICE_HEDGE_WIDTH_ENV: &str = "COSYWORLD_AI_VOICE_HEDGE_WIDTH";
pub(crate) const VOICE_LATENCY_CEILING_MS_ENV: &str = "COSYWORLD_AI_VOICE_LATENCY_CEILING_MS";
pub(crate) const VOICE_SPEND_CEILING_MICRODOLLARS_ENV: &str =
    "COSYWORLD_AI_VOICE_SPEND_CEILING_MICRODOLLARS";
pub(crate) const VOICE_UNKNOWN_COST_MICRODOLLARS_ENV: &str =
    "COSYWORLD_AI_VOICE_UNKNOWN_COST_MICRODOLLARS";
pub(crate) const VOICE_EXPLORATION_FLOOR_BPS_ENV: &str = "COSYWORLD_AI_VOICE_EXPLORATION_FLOOR_BPS";

const MAX_VOICE_ATTEMPTS: u8 = 10;

#[derive(Clone, Debug)]
pub(crate) struct VoiceRoutingConfig {
    pub(crate) max_attempts: u8,
    pub(crate) hedge_width: u8,
    pub(crate) latency_ceiling: Duration,
    pub(crate) spend_ceiling_microdollars: u64,
    pub(crate) unknown_cost_microdollars: u64,
    pub(crate) exploration_floor: f64,
}

impl Default for VoiceRoutingConfig {
    fn default() -> Self {
        Self {
            max_attempts: 2,
            hedge_width: 1,
            latency_ceiling: Duration::from_secs(12),
            spend_ceiling_microdollars: 2_000,
            unknown_cost_microdollars: 250,
            exploration_floor: 0.05,
        }
    }
}

impl VoiceRoutingConfig {
    pub(crate) fn from_env() -> Result<Self, String> {
        let defaults = Self::default();
        let max_attempts = env_integer(
            VOICE_MAX_ATTEMPTS_ENV,
            defaults.max_attempts as u64,
            1,
            MAX_VOICE_ATTEMPTS as u64,
        )? as u8;
        let hedge_width = env_integer(
            VOICE_HEDGE_WIDTH_ENV,
            defaults.hedge_width as u64,
            1,
            MAX_VOICE_ATTEMPTS as u64,
        )? as u8;
        if hedge_width > max_attempts {
            return Err(format!(
                "{VOICE_HEDGE_WIDTH_ENV} must not exceed {VOICE_MAX_ATTEMPTS_ENV}"
            ));
        }
        let latency_ceiling = Duration::from_millis(env_integer(
            VOICE_LATENCY_CEILING_MS_ENV,
            defaults.latency_ceiling.as_millis() as u64,
            100,
            60_000,
        )?);
        let spend_ceiling_microdollars = env_integer(
            VOICE_SPEND_CEILING_MICRODOLLARS_ENV,
            defaults.spend_ceiling_microdollars,
            1,
            1_000_000,
        )?;
        let unknown_cost_microdollars = env_integer(
            VOICE_UNKNOWN_COST_MICRODOLLARS_ENV,
            defaults.unknown_cost_microdollars,
            1,
            1_000_000,
        )?;
        let exploration_floor_bps = env_integer(
            VOICE_EXPLORATION_FLOOR_BPS_ENV,
            (defaults.exploration_floor * 10_000.0) as u64,
            1,
            5_000,
        )?;
        Ok(Self {
            max_attempts,
            hedge_width,
            latency_ceiling,
            spend_ceiling_microdollars,
            unknown_cost_microdollars,
            exploration_floor: exploration_floor_bps as f64 / 10_000.0,
        })
    }
}

fn env_integer(name: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
    let Some(raw) = std::env::var(name).ok() else {
        return Ok(default);
    };
    let value = raw
        .trim()
        .parse::<u64>()
        .map_err(|_| format!("{name} must be an integer from {min} to {max}"))?;
    if !(min..=max).contains(&value) {
        return Err(format!("{name} must be from {min} to {max}"));
    }
    Ok(value)
}

pub(crate) fn init_ai_voice_routing_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_voice_jobs (
            generation_id TEXT PRIMARY KEY,
            generation_key TEXT NOT NULL,
            feature TEXT NOT NULL,
            speech_mode TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'unavailable')),
            lease_owner TEXT,
            lease_expires_ms INTEGER NOT NULL DEFAULT 0,
            lease_retries INTEGER NOT NULL DEFAULT 0,
            policy_json TEXT NOT NULL,
            decisions_json TEXT,
            accepted_text TEXT,
            accepted_reasoning_trace TEXT,
            accepted_receipt_json TEXT,
            terminal_code TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_voice_attempt_decisions (
            generation_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            requested_model_id TEXT NOT NULL,
            decision_json TEXT NOT NULL,
            result TEXT NOT NULL DEFAULT 'selected',
            result_code TEXT,
            PRIMARY KEY(generation_id, ordinal)
        );
        CREATE TABLE IF NOT EXISTS ai_voice_content_evidence (
            model_id TEXT NOT NULL,
            model_revision TEXT NOT NULL,
            prompt_adapter_id TEXT NOT NULL,
            prompt_adapter_version TEXT NOT NULL,
            speech_mode TEXT NOT NULL,
            feature TEXT NOT NULL,
            passed INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(model_id, model_revision, prompt_adapter_id,
                        prompt_adapter_version, speech_mode, feature)
        );
        CREATE TABLE IF NOT EXISTS ai_voice_provider_health (
            provider TEXT NOT NULL,
            requested_model_id TEXT NOT NULL,
            successes INTEGER NOT NULL DEFAULT 0,
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            cooldown_until_ms INTEGER NOT NULL DEFAULT 0,
            last_error_code TEXT,
            PRIMARY KEY(provider, requested_model_id)
        );
        CREATE TABLE IF NOT EXISTS ai_voice_family_accepts (
            generation_id TEXT PRIMARY KEY,
            family TEXT NOT NULL,
            accepted_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_voice_family_accepts_family
            ON ai_voice_family_accepts(family);",
    )
    .map_err(crate::sqlite_error)?;
    ensure_ai_voice_job_column(
        conn,
        "accepted_reasoning_trace",
        "ALTER TABLE ai_voice_jobs ADD COLUMN accepted_reasoning_trace TEXT",
    )
}

fn ensure_ai_voice_job_column(conn: &Connection, column: &str, alter_sql: &str) -> io::Result<()> {
    let mut statement = conn
        .prepare("PRAGMA table_info(ai_voice_jobs)")
        .map_err(crate::sqlite_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(crate::sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(crate::sqlite_error)?;
    if !columns.iter().any(|existing| existing == column) {
        conn.execute_batch(alter_sql).map_err(crate::sqlite_error)?;
    }
    Ok(())
}
