use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{env, io, path::Path};

const DEFAULT_MAX_GUESTS: usize = 4;
const DEFAULT_MAX_PARTIES_PER_GUEST: usize = 4;
const DEFAULT_SESSION_TTL_SECS: u64 = 2 * 60 * 60;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RendezvousPartyConfig {
    pub(super) max_guests: usize,
    pub(super) max_parties_per_guest: usize,
    pub(super) session_ttl_ms: u64,
}

impl RendezvousPartyConfig {
    pub(super) fn from_env() -> Self {
        Self {
            max_guests: env_usize(
                "COSYWORLD_RENDEZVOUS_PARTY_MAX_GUESTS",
                DEFAULT_MAX_GUESTS,
                1,
                16,
            ),
            max_parties_per_guest: env_usize(
                "COSYWORLD_RENDEZVOUS_PARTY_MAX_ACTIVE_PER_GUEST",
                DEFAULT_MAX_PARTIES_PER_GUEST,
                1,
                16,
            ),
            session_ttl_ms: env_u64(
                "COSYWORLD_RENDEZVOUS_PARTY_TTL_SECS",
                DEFAULT_SESSION_TTL_SECS,
                5 * 60,
                24 * 60 * 60,
            )
            .saturating_mul(1_000),
        }
    }
}

impl Default for RendezvousPartyConfig {
    fn default() -> Self {
        Self {
            max_guests: DEFAULT_MAX_GUESTS,
            max_parties_per_guest: DEFAULT_MAX_PARTIES_PER_GUEST,
            session_ttl_ms: DEFAULT_SESSION_TTL_SECS * 1_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RendezvousPartyTerms {
    pub(super) eligible: bool,
    pub(super) scope: String,
    pub(super) max_guests: usize,
    pub(super) expires_at_ms: u64,
    pub(super) restrictions: Vec<String>,
    pub(super) explanation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RendezvousPartyView {
    pub(super) party_id: String,
    pub(super) host_actor_ref: String,
    pub(super) formed_location_ref: String,
    pub(super) guest_actor_ref: String,
    pub(super) guest_count: usize,
    pub(super) max_guests: usize,
    pub(super) joined_at_ms: u64,
    pub(super) expires_at_ms: u64,
    pub(super) status: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct HostedAccessCandidate {
    pub(super) party_id: String,
    pub(super) host_actor_ref: String,
    pub(super) formed_location_ref: String,
    pub(super) expires_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct HostedAccessJournalGrant {
    pub(super) candidate: HostedAccessCandidate,
    pub(super) guest_actor_ref: String,
    pub(super) location_ref: String,
    pub(super) required_grant_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct MovementAccessView {
    pub(super) mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) party_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) host_actor_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) required_grant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) restrictions: Vec<String>,
}

impl MovementAccessView {
    pub(super) fn public() -> Self {
        Self {
            mode: "public".to_string(),
            party_id: None,
            host_actor_ref: None,
            required_grant_id: None,
            expires_at_ms: None,
            reason: None,
            restrictions: Vec::new(),
        }
    }

    pub(super) fn denied(required_grant_id: Option<&str>, reason: impl Into<String>) -> Self {
        Self {
            mode: "denied".to_string(),
            party_id: None,
            host_actor_ref: None,
            required_grant_id: required_grant_id.map(ToString::to_string),
            expires_at_ms: None,
            reason: Some(reason.into()),
            restrictions: Vec::new(),
        }
    }
}

pub(super) fn party_rendezvous_restrictions() -> Vec<String> {
    vec![
        "rendezvous_only".to_string(),
        "no_access_grants".to_string(),
        "no_ownership_transfer".to_string(),
    ]
}

pub(super) fn rendezvous_party_terms(
    config: &RendezvousPartyConfig,
    eligible: bool,
    invite_expires_at_ms: u64,
    now_ms: u64,
) -> RendezvousPartyTerms {
    RendezvousPartyTerms {
        eligible,
        scope: "party_rendezvous".to_string(),
        max_guests: config.max_guests,
        expires_at_ms: invite_expires_at_ms.min(now_ms.saturating_add(config.session_ttl_ms)),
        restrictions: party_rendezvous_restrictions(),
        explanation: if eligible {
            "Accepting forms a bounded rendezvous party. Party membership never grants access or changes ownership."
                .to_string()
        } else {
            "This invite cannot form a rendezvous party because its location is no longer available."
                .to_string()
        },
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

#[allow(clippy::too_many_arguments)]
pub(super) fn join_rendezvous_party(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    party_id: &str,
    host_actor_ref: &str,
    guest_actor_ref: &str,
    formed_location_ref: &str,
    now_ms: u64,
    expires_at_ms: u64,
    config: &RendezvousPartyConfig,
) -> io::Result<RendezvousPartyView> {
    if host_actor_ref == guest_actor_ref {
        return Err(invalid_input(
            "a host cannot join their own party as a guest",
        ));
    }
    let mut conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let existing = tx
        .query_row(
            "SELECT world_id, world_epoch, host_actor_ref, formed_location_ref,
                    max_guests, expires_at_ms, revoked_at_ms
             FROM canonical_hosted_parties WHERE party_id = ?1",
            params![party_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(sqlite_error)?;
    let effective_expiry = expires_at_ms.min(now_ms.saturating_add(config.session_ttl_ms));
    if let Some((
        stored_world,
        stored_epoch,
        stored_host,
        stored_location,
        _,
        stored_expiry,
        revoked_at,
    )) = existing
    {
        if stored_world != world_id
            || as_u64(stored_epoch, "world_epoch")? != world_epoch
            || stored_host != host_actor_ref
            || stored_location != formed_location_ref
        {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "party id is already bound to different immutable terms",
            ));
        }
        if revoked_at.is_some() || as_u64(stored_expiry, "expires_at_ms")? <= now_ms {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "hosted party is revoked or expired",
            ));
        }
    } else {
        tx.execute(
            "INSERT INTO canonical_hosted_parties
                (party_id, world_id, world_epoch, host_actor_ref,
                 formed_location_ref, max_guests, created_at_ms, expires_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                party_id,
                world_id,
                as_i64(world_epoch)?,
                host_actor_ref,
                formed_location_ref,
                as_i64(config.max_guests as u64)?,
                as_i64(now_ms)?,
                as_i64(effective_expiry)?,
            ],
        )
        .map_err(sqlite_error)?;
    }

    let already_joined = tx
        .query_row(
            "SELECT joined_at_ms FROM canonical_hosted_party_members
             WHERE party_id = ?1 AND guest_actor_ref = ?2 AND removed_at_ms IS NULL",
            params![party_id, guest_actor_ref],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(sqlite_error)?;
    if already_joined.is_none() {
        let active_parties = tx
            .query_row(
                "SELECT COUNT(*)
                 FROM canonical_hosted_party_members m
                 JOIN canonical_hosted_parties p ON p.party_id = m.party_id
                 WHERE m.guest_actor_ref = ?1 AND m.removed_at_ms IS NULL
                   AND p.world_id = ?2 AND p.world_epoch = ?3
                   AND p.revoked_at_ms IS NULL AND p.expires_at_ms > ?4",
                params![
                    guest_actor_ref,
                    world_id,
                    as_i64(world_epoch)?,
                    as_i64(now_ms)?,
                ],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sqlite_error)?;
        if as_u64(active_parties, "active party count")? >= config.max_parties_per_guest as u64 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "guest active-party limit reached",
            ));
        }
        let guest_count = active_guest_count(&tx, party_id)?;
        if guest_count >= config.max_guests {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "party guest limit reached",
            ));
        }
        tx.execute(
            "INSERT INTO canonical_hosted_party_members
                (party_id, guest_actor_ref, joined_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(party_id, guest_actor_ref) DO UPDATE SET
                joined_at_ms = excluded.joined_at_ms,
                removed_at_ms = NULL,
                removal_reason = NULL",
            params![party_id, guest_actor_ref, as_i64(now_ms)?],
        )
        .map_err(sqlite_error)?;
    }
    let joined_at_ms = already_joined
        .map(|value| as_u64(value, "joined_at_ms"))
        .transpose()?
        .unwrap_or(now_ms);
    let guest_count = active_guest_count(&tx, party_id)?;
    let (max_guests, stored_expiry) = tx
        .query_row(
            "SELECT max_guests, expires_at_ms FROM canonical_hosted_parties
             WHERE party_id = ?1",
            params![party_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(sqlite_error)?;
    tx.commit().map_err(sqlite_error)?;
    Ok(RendezvousPartyView {
        party_id: party_id.to_string(),
        host_actor_ref: host_actor_ref.to_string(),
        formed_location_ref: formed_location_ref.to_string(),
        guest_actor_ref: guest_actor_ref.to_string(),
        guest_count,
        max_guests: as_usize(max_guests, "max_guests")?,
        joined_at_ms,
        expires_at_ms: as_u64(stored_expiry, "expires_at_ms")?,
        status: "active".to_string(),
    })
}

pub(super) fn rendezvous_party_host(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    party_id: &str,
) -> io::Result<Option<String>> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    conn.query_row(
        "SELECT host_actor_ref FROM canonical_hosted_parties
         WHERE world_id = ?1 AND world_epoch = ?2 AND party_id = ?3",
        params![world_id, as_i64(world_epoch)?, party_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(sqlite_error)
}

pub(super) fn remove_rendezvous_party_member(
    path: &Path,
    party_id: &str,
    guest_actor_ref: &str,
    reason: &str,
    now_ms: u64,
) -> io::Result<bool> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let changed = conn
        .execute(
            "UPDATE canonical_hosted_party_members
             SET removed_at_ms = ?3, removal_reason = ?4
             WHERE party_id = ?1 AND guest_actor_ref = ?2 AND removed_at_ms IS NULL",
            params![party_id, guest_actor_ref, as_i64(now_ms)?, reason],
        )
        .map_err(sqlite_error)?;
    Ok(changed == 1)
}

pub(super) fn revoke_rendezvous_party(
    path: &Path,
    party_id: &str,
    host_actor_ref: &str,
    reason: &str,
    now_ms: u64,
) -> io::Result<bool> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let changed = conn
        .execute(
            "UPDATE canonical_hosted_parties
             SET revoked_at_ms = ?3, revocation_reason = ?4
             WHERE party_id = ?1 AND host_actor_ref = ?2 AND revoked_at_ms IS NULL",
            params![party_id, host_actor_ref, as_i64(now_ms)?, reason],
        )
        .map_err(sqlite_error)?;
    Ok(changed == 1)
}

fn active_guest_count(conn: &Connection, party_id: &str) -> io::Result<usize> {
    let count = conn
        .query_row(
            "SELECT COUNT(*) FROM canonical_hosted_party_members
             WHERE party_id = ?1 AND removed_at_ms IS NULL",
            params![party_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    as_usize(count, "guest count")
}

fn env_u64(name: &str, default: u64, min: u64, max: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

fn env_usize(name: &str, default: usize, min: usize, max: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

fn as_i64(value: u64) -> io::Result<i64> {
    i64::try_from(value).map_err(|_| invalid_input("integer exceeds SQLite range"))
}

fn as_u64(value: i64, label: &str) -> io::Result<u64> {
    u64::try_from(value).map_err(|_| invalid_input(format!("invalid {label}")))
}

fn as_usize(value: i64, label: &str) -> io::Result<usize> {
    usize::try_from(value).map_err(|_| invalid_input(format!("invalid {label}")))
}

fn invalid_input(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn store() -> std::path::PathBuf {
        let path = env::temp_dir().join(format!(
            "cosyworld-hosted-access-{}-{}.sqlite",
            std::process::id(),
            rand::random::<u64>()
        ));
        let conn = Connection::open(&path).unwrap();
        init_hosted_access_store(&conn).unwrap();
        path
    }

    #[test]
    fn public_invite_party_is_durable_bounded_and_idempotent() {
        let path = store();
        let config = RendezvousPartyConfig {
            max_guests: 1,
            max_parties_per_guest: 2,
            session_ttl_ms: 10_000,
        };
        let joined = join_rendezvous_party(
            &path,
            "world://test",
            1,
            "party-1",
            "world://test/actor/host",
            "world://test/actor/guest",
            "world://test/location/public",
            100,
            50_000,
            &config,
        )
        .unwrap();
        assert_eq!(joined.expires_at_ms, 10_100);
        assert_eq!(joined.guest_count, 1);
        let repeated = join_rendezvous_party(
            &path,
            "world://test",
            1,
            "party-1",
            "world://test/actor/host",
            "world://test/actor/guest",
            "world://test/location/public",
            200,
            50_000,
            &config,
        )
        .unwrap();
        assert_eq!(repeated.joined_at_ms, 100);
        let full = join_rendezvous_party(
            &path,
            "world://test",
            1,
            "party-1",
            "world://test/actor/host",
            "world://test/actor/other",
            "world://test/location/public",
            200,
            50_000,
            &config,
        )
        .unwrap_err();
        assert_eq!(full.kind(), io::ErrorKind::PermissionDenied);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rendezvous_membership_removal_and_revocation_are_durable() {
        let path = store();
        let config = RendezvousPartyConfig::default();
        let joined = join_rendezvous_party(
            &path,
            "world://test",
            1,
            "party-2",
            "world://test/actor/host",
            "world://test/actor/guest",
            "world://test/location/public",
            100,
            50_000,
            &config,
        )
        .unwrap();
        assert_eq!(joined.status, "active");
        assert_eq!(
            rendezvous_party_host(&path, "world://test", 1, "party-2").unwrap(),
            Some("world://test/actor/host".to_string())
        );
        assert!(remove_rendezvous_party_member(
            &path,
            "party-2",
            "world://test/actor/guest",
            "guest_left",
            300,
        )
        .unwrap());
        assert!(!remove_rendezvous_party_member(
            &path,
            "party-2",
            "world://test/actor/guest",
            "guest_left",
            301,
        )
        .unwrap());
        assert!(revoke_rendezvous_party(
            &path,
            "party-2",
            "world://test/actor/host",
            "host_revoked",
            400,
        )
        .unwrap());
        fs::remove_file(path).unwrap();
    }
}
