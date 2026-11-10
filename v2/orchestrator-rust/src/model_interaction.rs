use super::*;

pub(super) fn init_model_interaction_batch_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS model_interaction_batches (
            interaction_id TEXT PRIMARY KEY,
            actor_id INTEGER NOT NULL,
            target_actor_id INTEGER NOT NULL,
            queue_event_seq INTEGER NOT NULL,
            requested_model_id TEXT NOT NULL,
            submission_model_id TEXT NOT NULL,
            custom_id TEXT NOT NULL UNIQUE,
            provider_batch_id TEXT UNIQUE,
            provider_status TEXT NOT NULL,
            result_digest TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_model_interaction_batches_provider
            ON model_interaction_batches(provider_batch_id, provider_status);",
    )
    .map_err(sqlite_error)
}

#[derive(Clone, Debug)]
pub(super) struct TransientOpenRouterKey {
    api_key: String,
    expires_at: Instant,
}

impl RuntimeWorld {}
