pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS account_avatar_links (
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            actor_id INTEGER NOT NULL,
            account_id TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, world_epoch, actor_id)
        );
        CREATE INDEX IF NOT EXISTS idx_account_avatar_owner
            ON account_avatar_links(world_id, world_epoch, account_id, updated_at_ms);";
