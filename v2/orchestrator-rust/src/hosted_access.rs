use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{env, io, path::Path};

const DEFAULT_MAX_GUESTS: usize = 4;
const DEFAULT_MAX_PARTIES_PER_GUEST: usize = 4;
const DEFAULT_SESSION_TTL_SECS: u64 = 2 * 60 * 60;
const DEFAULT_GRACE_SECS: u64 = 60;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct HostedAccessConfig {
    pub(super) max_guests: usize,
    pub(super) max_parties_per_guest: usize,
    pub(super) session_ttl_ms: u64,
    pub(super) grace_ms: u64,
}

impl HostedAccessConfig {
    pub(super) fn from_env() -> Self {
        Self {
            max_guests: env_usize(
                "COSYWORLD_HOSTED_PARTY_MAX_GUESTS",
                DEFAULT_MAX_GUESTS,
                1,
                16,
            ),
            max_parties_per_guest: env_usize(
                "COSYWORLD_HOSTED_PARTY_MAX_ACTIVE_PER_GUEST",
                DEFAULT_MAX_PARTIES_PER_GUEST,
                1,
                16,
            ),
            session_ttl_ms: env_u64(
                "COSYWORLD_HOSTED_ACCESS_TTL_SECS",
                DEFAULT_SESSION_TTL_SECS,
                5 * 60,
                24 * 60 * 60,
            )
            .saturating_mul(1_000),
            grace_ms: env_u64(
                "COSYWORLD_HOSTED_ACCESS_GRACE_SECS",
                DEFAULT_GRACE_SECS,
                0,
                5 * 60,
            )
            .saturating_mul(1_000),
        }
    }
}

impl Default for HostedAccessConfig {
    fn default() -> Self {
        Self {
            max_guests: DEFAULT_MAX_GUESTS,
            max_parties_per_guest: DEFAULT_MAX_PARTIES_PER_GUEST,
            session_ttl_ms: DEFAULT_SESSION_TTL_SECS * 1_000,
            grace_ms: DEFAULT_GRACE_SECS * 1_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct HostedAccessTerms {
    pub(super) eligible: bool,
    pub(super) scope: String,
    pub(super) max_guests: usize,
    pub(super) expires_at_ms: u64,
    pub(super) grace_period_ms: u64,
    pub(super) restrictions: Vec<String>,
    pub(super) explanation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct HostedPartyView {
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct HostedAccessEntry {
    pub(super) party_id: String,
    pub(super) host_actor_ref: String,
    pub(super) guest_actor_ref: String,
    pub(super) formed_location_ref: String,
    pub(super) location_ref: String,
    pub(super) required_grant_id: String,
    pub(super) expires_at_ms: u64,
    pub(super) invalid_since_ms: Option<u64>,
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

    pub(super) fn solo(required_grant_id: Option<&str>) -> Self {
        Self {
            mode: "solo_entitled".to_string(),
            party_id: None,
            host_actor_ref: None,
            required_grant_id: required_grant_id.map(ToString::to_string),
            expires_at_ms: None,
            reason: None,
            restrictions: Vec::new(),
        }
    }

    pub(super) fn hosted(candidate: &HostedAccessCandidate, required_grant_id: &str) -> Self {
        Self {
            mode: "hosted_guest".to_string(),
            party_id: Some(candidate.party_id.clone()),
            host_actor_ref: Some(candidate.host_actor_ref.clone()),
            required_grant_id: Some(required_grant_id.to_string()),
            expires_at_ms: Some(candidate.expires_at_ms),
            reason: Some(
                "Your host is sharing entry for this party session and location only.".to_string(),
            ),
            restrictions: hosted_guest_restrictions(),
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

pub(super) fn hosted_guest_restrictions() -> Vec<String> {
    vec![
        "no_permanent_entitlement".to_string(),
        "no_transferable_access".to_string(),
        "no_gated_collectible_claims".to_string(),
        "no_gated_trading_or_minting".to_string(),
        "no_gated_progression_rewards".to_string(),
    ]
}

pub(super) fn hosted_access_terms(
    config: &HostedAccessConfig,
    eligible: bool,
    invite_expires_at_ms: u64,
    now_ms: u64,
) -> HostedAccessTerms {
    HostedAccessTerms {
        eligible,
        scope: "party_session_location".to_string(),
        max_guests: config.max_guests,
        expires_at_ms: invite_expires_at_ms.min(now_ms.saturating_add(config.session_ttl_ms)),
        grace_period_ms: config.grace_ms,
        restrictions: hosted_guest_restrictions(),
        explanation: if eligible {
            "Accepting in this public room forms a bounded party. An active entitled host may share entry while co-present; ownership never transfers."
                .to_string()
        } else {
            "This invite can rendezvous eligible players, but it cannot form hosted access because it was not created in a public room."
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
pub(super) fn join_hosted_party(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    party_id: &str,
    host_actor_ref: &str,
    guest_actor_ref: &str,
    formed_location_ref: &str,
    now_ms: u64,
    expires_at_ms: u64,
    config: &HostedAccessConfig,
) -> io::Result<HostedPartyView> {
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
    Ok(HostedPartyView {
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

pub(super) fn active_hosted_access_candidates(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    guest_actor_ref: &str,
    now_ms: u64,
) -> io::Result<Vec<HostedAccessCandidate>> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT p.party_id, p.host_actor_ref, p.formed_location_ref, p.expires_at_ms
             FROM canonical_hosted_party_members m
             JOIN canonical_hosted_parties p ON p.party_id = m.party_id
             WHERE p.world_id = ?1 AND p.world_epoch = ?2 AND m.guest_actor_ref = ?3
               AND m.removed_at_ms IS NULL AND p.revoked_at_ms IS NULL
               AND p.expires_at_ms > ?4
             ORDER BY p.created_at_ms, p.party_id",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(
            params![
                world_id,
                as_i64(world_epoch)?,
                guest_actor_ref,
                as_i64(now_ms)?,
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(sqlite_error)?;
    rows.map(|row| {
        let (party_id, host_actor_ref, formed_location_ref, expires_at_ms) =
            row.map_err(sqlite_error)?;
        Ok(HostedAccessCandidate {
            party_id,
            host_actor_ref,
            formed_location_ref,
            expires_at_ms: as_u64(expires_at_ms, "expires_at_ms")?,
        })
    })
    .collect()
}

pub(super) fn hosted_party_host(
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

pub(super) fn actor_has_active_hosted_entry(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    guest_actor_ref: &str,
    location_ref: &str,
) -> io::Result<bool> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM canonical_hosted_access_entries e
            JOIN canonical_hosted_parties p ON p.party_id = e.party_id
            WHERE p.world_id = ?1 AND p.world_epoch = ?2
              AND e.guest_actor_ref = ?3 AND e.location_ref = ?4
              AND e.status = 'active'
         )",
        params![
            world_id,
            as_i64(world_epoch)?,
            guest_actor_ref,
            location_ref
        ],
        |row| row.get::<_, bool>(0),
    )
    .map_err(sqlite_error)
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(super) fn activate_hosted_access_entry(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    candidate: &HostedAccessCandidate,
    guest_actor_ref: &str,
    location_ref: &str,
    required_grant_id: &str,
    now_ms: u64,
) -> io::Result<()> {
    let mut conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    activate_hosted_access_entry_in_transaction(
        &tx,
        world_id,
        world_epoch,
        &HostedAccessJournalGrant {
            candidate: candidate.clone(),
            guest_actor_ref: guest_actor_ref.to_string(),
            location_ref: location_ref.to_string(),
            required_grant_id: required_grant_id.to_string(),
        },
        now_ms,
    )?;
    tx.commit().map_err(sqlite_error)
}

pub(super) fn activate_hosted_access_entry_in_transaction(
    conn: &Connection,
    world_id: &str,
    world_epoch: u64,
    grant: &HostedAccessJournalGrant,
    now_ms: u64,
) -> io::Result<()> {
    let stored_expiry = conn
        .query_row(
            "SELECT p.expires_at_ms
             FROM canonical_hosted_parties p
             JOIN canonical_hosted_party_members m ON m.party_id = p.party_id
             WHERE p.party_id = ?1 AND p.world_id = ?2 AND p.world_epoch = ?3
               AND p.host_actor_ref = ?4 AND m.guest_actor_ref = ?5
               AND p.revoked_at_ms IS NULL AND m.removed_at_ms IS NULL
               AND p.expires_at_ms > ?6",
            params![
                grant.candidate.party_id,
                world_id,
                as_i64(world_epoch)?,
                grant.candidate.host_actor_ref,
                grant.guest_actor_ref,
                as_i64(now_ms)?,
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(sqlite_error)?
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "hosted party membership changed before movement committed",
            )
        })?;
    let expires_at_ms = as_u64(stored_expiry, "expires_at_ms")?.min(grant.candidate.expires_at_ms);
    conn.execute(
        "INSERT INTO canonical_hosted_access_entries
            (party_id, guest_actor_ref, location_ref, required_grant_id,
             entered_at_ms, expires_at_ms, status, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?5)
         ON CONFLICT(party_id, guest_actor_ref, location_ref) DO UPDATE SET
            required_grant_id = excluded.required_grant_id,
            entered_at_ms = excluded.entered_at_ms,
            expires_at_ms = excluded.expires_at_ms,
            invalid_since_ms = NULL,
            status = 'active',
            status_reason = NULL,
            updated_at_ms = excluded.updated_at_ms",
        params![
            grant.candidate.party_id,
            grant.guest_actor_ref,
            grant.location_ref,
            grant.required_grant_id,
            as_i64(now_ms)?,
            as_i64(expires_at_ms)?,
        ],
    )
    .map_err(sqlite_error)?;
    record_hosted_access_event(
        conn,
        world_id,
        world_epoch,
        Some(&grant.candidate.party_id),
        Some(&grant.candidate.host_actor_ref),
        &grant.guest_actor_ref,
        &grant.location_ref,
        Some(&grant.required_grant_id),
        "hosted_guest",
        "allowed",
        "active_entitled_host",
        now_ms,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn record_gated_access_outcome(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    guest_actor_ref: &str,
    location_ref: &str,
    required_grant_id: Option<&str>,
    access_mode: &str,
    outcome: &str,
    reason_code: &str,
    now_ms: u64,
) -> io::Result<()> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    record_hosted_access_event(
        &conn,
        world_id,
        world_epoch,
        None,
        None,
        guest_actor_ref,
        location_ref,
        required_grant_id,
        access_mode,
        outcome,
        reason_code,
        now_ms,
    )
}

pub(super) fn remove_hosted_party_member(
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

pub(super) fn revoke_hosted_party(
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

pub(super) fn hosted_access_entries_for_reconciliation(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
) -> io::Result<Vec<HostedAccessEntry>> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT e.party_id, p.host_actor_ref, e.guest_actor_ref,
                    p.formed_location_ref, e.location_ref, e.required_grant_id,
                    MIN(p.expires_at_ms, e.expires_at_ms), e.invalid_since_ms
             FROM canonical_hosted_access_entries e
             JOIN canonical_hosted_parties p ON p.party_id = e.party_id
             JOIN canonical_hosted_party_members m
               ON m.party_id = e.party_id AND m.guest_actor_ref = e.guest_actor_ref
             WHERE p.world_id = ?1 AND p.world_epoch = ?2 AND e.status = 'active'",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![world_id, as_i64(world_epoch)?], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<i64>>(7)?,
            ))
        })
        .map_err(sqlite_error)?;
    rows.map(|row| {
        let (
            party_id,
            host_actor_ref,
            guest_actor_ref,
            formed_location_ref,
            location_ref,
            required_grant_id,
            expires_at_ms,
            invalid_since_ms,
        ) = row.map_err(sqlite_error)?;
        Ok(HostedAccessEntry {
            party_id,
            host_actor_ref,
            guest_actor_ref,
            formed_location_ref,
            location_ref,
            required_grant_id,
            expires_at_ms: as_u64(expires_at_ms, "expires_at_ms")?,
            invalid_since_ms: invalid_since_ms
                .map(|value| as_u64(value, "invalid_since_ms"))
                .transpose()?,
        })
    })
    .collect()
}

pub(super) fn update_hosted_entry_validity(
    path: &Path,
    entry: &HostedAccessEntry,
    valid: bool,
    reason: &str,
    now_ms: u64,
    grace_ms: u64,
) -> io::Result<bool> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    if valid {
        conn.execute(
            "UPDATE canonical_hosted_access_entries
             SET invalid_since_ms = NULL, status_reason = NULL, updated_at_ms = ?4
             WHERE party_id = ?1 AND guest_actor_ref = ?2 AND location_ref = ?3
               AND status = 'active'",
            params![
                entry.party_id,
                entry.guest_actor_ref,
                entry.location_ref,
                as_i64(now_ms)?,
            ],
        )
        .map_err(sqlite_error)?;
        return Ok(false);
    }
    let invalid_since = entry.invalid_since_ms.unwrap_or(now_ms);
    conn.execute(
        "UPDATE canonical_hosted_access_entries
         SET invalid_since_ms = COALESCE(invalid_since_ms, ?4),
             status_reason = ?5, updated_at_ms = ?4
         WHERE party_id = ?1 AND guest_actor_ref = ?2 AND location_ref = ?3
           AND status = 'active'",
        params![
            entry.party_id,
            entry.guest_actor_ref,
            entry.location_ref,
            as_i64(now_ms)?,
            reason,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(invalid_since.saturating_add(grace_ms) <= now_ms)
}

pub(super) fn mark_hosted_entry_evacuated(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    entry: &HostedAccessEntry,
    reason: &str,
    now_ms: u64,
) -> io::Result<()> {
    close_hosted_entry(
        path,
        world_id,
        world_epoch,
        entry,
        "evacuated",
        "evacuated",
        reason,
        now_ms,
    )
}

pub(super) fn mark_hosted_entry_ended(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    entry: &HostedAccessEntry,
    reason: &str,
    now_ms: u64,
) -> io::Result<()> {
    close_hosted_entry(
        path,
        world_id,
        world_epoch,
        entry,
        "ended",
        "ended",
        reason,
        now_ms,
    )
}

#[allow(clippy::too_many_arguments)]
fn close_hosted_entry(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    entry: &HostedAccessEntry,
    status: &str,
    outcome: &str,
    reason: &str,
    now_ms: u64,
) -> io::Result<()> {
    let mut conn = Connection::open(path).map_err(sqlite_error)?;
    init_hosted_access_store(&conn)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let changed = tx
        .execute(
            "UPDATE canonical_hosted_access_entries
         SET status = ?4, status_reason = ?5, updated_at_ms = ?6
         WHERE party_id = ?1 AND guest_actor_ref = ?2 AND location_ref = ?3
           AND status = 'active'",
            params![
                entry.party_id,
                entry.guest_actor_ref,
                entry.location_ref,
                status,
                reason,
                as_i64(now_ms)?,
            ],
        )
        .map_err(sqlite_error)?;
    if changed == 1 {
        record_hosted_access_event(
            &tx,
            world_id,
            world_epoch,
            Some(&entry.party_id),
            Some(&entry.host_actor_ref),
            &entry.guest_actor_ref,
            &entry.location_ref,
            Some(&entry.required_grant_id),
            "hosted_guest",
            outcome,
            reason,
            now_ms,
        )?;
    }
    tx.commit().map_err(sqlite_error)
}

#[allow(clippy::too_many_arguments)]
fn record_hosted_access_event(
    conn: &Connection,
    world_id: &str,
    world_epoch: u64,
    party_id: Option<&str>,
    host_actor_ref: Option<&str>,
    guest_actor_ref: &str,
    location_ref: &str,
    required_grant_id: Option<&str>,
    access_mode: &str,
    outcome: &str,
    reason_code: &str,
    now_ms: u64,
) -> io::Result<()> {
    conn.execute(
        "INSERT INTO canonical_hosted_access_events
            (schema_version, world_id, world_epoch, party_id, host_actor_ref, guest_actor_ref, location_ref,
             required_grant_id, access_mode, outcome, reason_code, created_at_ms)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            world_id,
            as_i64(world_epoch)?,
            party_id,
            host_actor_ref,
            guest_actor_ref,
            location_ref,
            required_grant_id,
            access_mode,
            outcome,
            reason_code,
            as_i64(now_ms)?,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
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
        let config = HostedAccessConfig {
            max_guests: 1,
            max_parties_per_guest: 2,
            session_ttl_ms: 10_000,
            grace_ms: 100,
        };
        let joined = join_hosted_party(
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
        let repeated = join_hosted_party(
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
        let full = join_hosted_party(
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
    fn membership_removal_and_revocation_fail_closed() {
        let path = store();
        let config = HostedAccessConfig::default();
        join_hosted_party(
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
        let candidate = active_hosted_access_candidates(
            &path,
            "world://test",
            1,
            "world://test/actor/guest",
            200,
        )
        .unwrap()
        .remove(0);
        assert!(active_hosted_access_candidates(
            &path,
            "world://test",
            2,
            "world://test/actor/guest",
            200,
        )
        .unwrap()
        .is_empty());
        assert!(remove_hosted_party_member(
            &path,
            "party-2",
            "world://test/actor/guest",
            "guest_left",
            300,
        )
        .unwrap());
        assert!(active_hosted_access_candidates(
            &path,
            "world://test",
            1,
            "world://test/actor/guest",
            301,
        )
        .unwrap()
        .is_empty());
        let rejected = activate_hosted_access_entry(
            &path,
            "world://test",
            1,
            &candidate,
            "world://test/actor/guest",
            "world://test/location/gated",
            "grant-1",
            302,
        )
        .unwrap_err();
        assert_eq!(rejected.kind(), io::ErrorKind::PermissionDenied);
        assert!(revoke_hosted_party(
            &path,
            "party-2",
            "world://test/actor/host",
            "host_revoked",
            400,
        )
        .unwrap());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn invalid_entry_observes_grace_before_evacuation() {
        let path = store();
        let config = HostedAccessConfig::default();
        join_hosted_party(
            &path,
            "world://test",
            1,
            "party-3",
            "world://test/actor/host",
            "world://test/actor/guest",
            "world://test/location/public",
            100,
            50_000,
            &config,
        )
        .unwrap();
        let candidate = active_hosted_access_candidates(
            &path,
            "world://test",
            1,
            "world://test/actor/guest",
            200,
        )
        .unwrap()
        .remove(0);
        activate_hosted_access_entry(
            &path,
            "world://test",
            1,
            &candidate,
            "world://test/actor/guest",
            "world://test/location/gated",
            "grant-1",
            200,
        )
        .unwrap();
        assert!(revoke_hosted_party(
            &path,
            "party-3",
            "world://test/actor/host",
            "host_revoked",
            250,
        )
        .unwrap());
        assert!(actor_has_active_hosted_entry(
            &path,
            "world://test",
            1,
            "world://test/actor/guest",
            "world://test/location/gated",
        )
        .unwrap());
        let entry = hosted_access_entries_for_reconciliation(&path, "world://test", 1)
            .unwrap()
            .remove(0);
        assert!(
            !update_hosted_entry_validity(&path, &entry, false, "host_left", 300, 100).unwrap()
        );
        let entry = hosted_access_entries_for_reconciliation(&path, "world://test", 1)
            .unwrap()
            .remove(0);
        assert!(update_hosted_entry_validity(&path, &entry, false, "host_left", 400, 100).unwrap());
        fs::remove_file(path).unwrap();
    }
}
