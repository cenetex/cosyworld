use rusqlite::Connection;
use std::io;

const DEFAULT_MAX_GUESTS: usize = 4;
const DEFAULT_MAX_PARTIES_PER_GUEST: usize = 4;
const DEFAULT_SESSION_TTL_SECS: u64 = 2 * 60 * 60;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RendezvousPartyConfig {
    pub(super) max_guests: usize,
    pub(super) max_parties_per_guest: usize,
    pub(super) session_ttl_ms: u64,
}

impl RendezvousPartyConfig {}

impl Default for RendezvousPartyConfig {
    fn default() -> Self {
        Self {
            max_guests: DEFAULT_MAX_GUESTS,
            max_parties_per_guest: DEFAULT_MAX_PARTIES_PER_GUEST,
            session_ttl_ms: DEFAULT_SESSION_TTL_SECS * 1_000,
        }
    }
}

pub(super) fn init_hosted_access_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS canonical_hosted_parties (
            party_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            host_actor_ref TEXT NOT NULL,
            formed_location_ref TEXT NOT NULL,
            max_guests INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            revoked_at_ms INTEGER,
            revocation_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_hosted_parties_host
            ON canonical_hosted_parties(world_id, host_actor_ref, expires_at_ms);
        CREATE TABLE IF NOT EXISTS canonical_hosted_party_members (
            party_id TEXT NOT NULL,
            guest_actor_ref TEXT NOT NULL,
            joined_at_ms INTEGER NOT NULL,
            removed_at_ms INTEGER,
            removal_reason TEXT,
            PRIMARY KEY (party_id, guest_actor_ref),
            FOREIGN KEY (party_id) REFERENCES canonical_hosted_parties(party_id)
        );
        CREATE INDEX IF NOT EXISTS idx_hosted_party_members_guest
            ON canonical_hosted_party_members(guest_actor_ref, removed_at_ms);
        CREATE TABLE IF NOT EXISTS canonical_hosted_access_entries (
            party_id TEXT NOT NULL,
            guest_actor_ref TEXT NOT NULL,
            location_ref TEXT NOT NULL,
            required_grant_id TEXT NOT NULL,
            entered_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            invalid_since_ms INTEGER,
            status TEXT NOT NULL,
            status_reason TEXT,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (party_id, guest_actor_ref, location_ref),
            FOREIGN KEY (party_id, guest_actor_ref)
                REFERENCES canonical_hosted_party_members(party_id, guest_actor_ref)
        );
        CREATE INDEX IF NOT EXISTS idx_hosted_access_entries_active
            ON canonical_hosted_access_entries(status, expires_at_ms);
        CREATE TABLE IF NOT EXISTS canonical_hosted_access_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            schema_version INTEGER NOT NULL DEFAULT 1,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            party_id TEXT,
            host_actor_ref TEXT,
            guest_actor_ref TEXT NOT NULL,
            location_ref TEXT NOT NULL,
            required_grant_id TEXT,
            access_mode TEXT NOT NULL,
            outcome TEXT NOT NULL,
            reason_code TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hosted_access_events_time
            ON canonical_hosted_access_events(world_id, created_at_ms);",
    )
    .map_err(sqlite_error)
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}
