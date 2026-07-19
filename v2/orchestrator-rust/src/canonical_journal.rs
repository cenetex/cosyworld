use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::Path,
    time::Duration,
};

const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct AuthorityLease {
    pub(super) world_id: String,
    pub(super) partition_key: String,
    pub(super) owner_id: String,
    pub(super) fencing_epoch: u64,
    pub(super) lease_expires_at_ms: u64,
}

#[derive(Clone, Debug)]
pub(super) struct CanonicalCommitRow<'a> {
    pub(super) commit_id: &'a str,
    pub(super) world_id: &'a str,
    pub(super) world_epoch: u64,
    pub(super) first_world_seq: u64,
    pub(super) last_world_seq: u64,
    pub(super) intent_id: Option<&'a str>,
    pub(super) request_hash: Option<&'a str>,
    pub(super) owner_id: &'a str,
    pub(super) owner_fencing_epoch: u64,
    pub(super) partitions_json: &'a str,
    pub(super) entity_versions_json: &'a str,
    pub(super) claims_json: &'a str,
    pub(super) action_journal_seq: u64,
    pub(super) created_at_ms: u64,
}

#[derive(Clone, Debug)]
pub(super) struct CanonicalReceiptRow<'a> {
    pub(super) world_id: &'a str,
    pub(super) intent_id: &'a str,
    pub(super) request_hash: &'a str,
    pub(super) response_json: &'a str,
    pub(super) commit_id: &'a str,
    pub(super) world_epoch: u64,
    pub(super) world_seq: u64,
    pub(super) owner_id: &'a str,
    pub(super) owner_fencing_epoch: u64,
    pub(super) created_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CanonicalProcessRoute {
    pub(super) owner_id: String,
    pub(super) process_id: String,
    pub(super) base_url: String,
    pub(super) heartbeat_expires_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CanonicalInvite {
    pub(super) invite_id: String,
    pub(super) world_id: String,
    pub(super) actor_ref: String,
    pub(super) created_location_ref: String,
    pub(super) created_world_seq: u64,
    pub(super) created_at_ms: u64,
    pub(super) expires_at_ms: u64,
}

pub(super) fn init_canonical_journal(
    conn: &Connection,
    world_id: &str,
    world_epoch: u64,
) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS canonical_world_state (
            world_id TEXT PRIMARY KEY,
            world_epoch INTEGER NOT NULL,
            committed_seq INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_partition_leases (
            world_id TEXT NOT NULL,
            partition_key TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            fencing_epoch INTEGER NOT NULL,
            lease_expires_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, partition_key)
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_partition_leases_owner
            ON canonical_partition_leases(world_id, owner_id, lease_expires_at_ms);
        CREATE TABLE IF NOT EXISTS canonical_entity_versions (
            world_id TEXT NOT NULL,
            entity_ref TEXT NOT NULL,
            entity_version INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, entity_ref)
        );
        CREATE TABLE IF NOT EXISTS canonical_claims (
            world_id TEXT NOT NULL,
            claim_kind TEXT NOT NULL,
            claim_key TEXT NOT NULL,
            source_intent_id TEXT,
            source_world_seq INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, claim_kind, claim_key)
        );
        CREATE TABLE IF NOT EXISTS canonical_commits (
            commit_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            first_world_seq INTEGER NOT NULL,
            last_world_seq INTEGER NOT NULL,
            intent_id TEXT,
            request_hash TEXT,
            owner_id TEXT NOT NULL,
            owner_fencing_epoch INTEGER NOT NULL,
            partitions_json TEXT NOT NULL,
            entity_versions_json TEXT NOT NULL,
            claims_json TEXT NOT NULL,
            action_journal_seq INTEGER NOT NULL UNIQUE,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_commits_world_seq
            ON canonical_commits(world_id, world_epoch, last_world_seq);
        CREATE INDEX IF NOT EXISTS idx_canonical_commits_intent
            ON canonical_commits(world_id, intent_id);
        CREATE TABLE IF NOT EXISTS canonical_process_routes (
            world_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            process_id TEXT NOT NULL,
            base_url TEXT NOT NULL,
            heartbeat_expires_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_process_routes_live
            ON canonical_process_routes(world_id, heartbeat_expires_at_ms, process_id);
        CREATE TABLE IF NOT EXISTS canonical_invites (
            invite_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            actor_ref TEXT NOT NULL,
            created_location_ref TEXT NOT NULL,
            created_world_seq INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_invites_actor
            ON canonical_invites(world_id, actor_ref, expires_at_ms);",
    )
    .map_err(sqlite_error)?;

    for (column, alter_sql) in [
        (
            "commit_id",
            "ALTER TABLE canonical_command_receipts ADD COLUMN commit_id TEXT",
        ),
        (
            "world_epoch",
            "ALTER TABLE canonical_command_receipts ADD COLUMN world_epoch INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "world_seq",
            "ALTER TABLE canonical_command_receipts ADD COLUMN world_seq INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "owner_id",
            "ALTER TABLE canonical_command_receipts ADD COLUMN owner_id TEXT",
        ),
        (
            "owner_fencing_epoch",
            "ALTER TABLE canonical_command_receipts ADD COLUMN owner_fencing_epoch INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "finalized",
            "ALTER TABLE canonical_command_receipts ADD COLUMN finalized INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "updated_at_ms",
            "ALTER TABLE canonical_command_receipts ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        ensure_column(
            conn,
            "canonical_command_receipts",
            column,
            alter_sql,
        )?;
    }

    let max_seq = conn
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) FROM world_events",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    conn.execute(
        "INSERT OR IGNORE INTO canonical_world_state
            (world_id, world_epoch, committed_seq, updated_at_ms)
         VALUES (?1, ?2, ?3, 0)",
        params![world_id, as_i64(world_epoch)?, max_seq],
    )
    .map_err(sqlite_error)?;
    // Read the cursor, durable suffix, and commit count in one SQLite snapshot.
    // Separate autocommit SELECTs can straddle another process's commit and
    // briefly pair the new cursor with the old event maximum.
    let (stored_epoch, committed_seq, durable_max_seq, commit_count) = conn
        .query_row(
            "SELECT state.world_epoch,
                    state.committed_seq,
                    (SELECT COALESCE(MAX(seq), 0) FROM world_events),
                    (SELECT COUNT(*) FROM canonical_commits WHERE world_id = ?1)
             FROM canonical_world_state AS state
             WHERE state.world_id = ?1",
            params![world_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(sqlite_error)?;
    if stored_epoch != as_i64(world_epoch)? {
        return Err(invalid_data(format!(
            "canonical world epoch mismatch: storage has {stored_epoch}, runtime expects {world_epoch}"
        )));
    }
    if commit_count == 0 {
        conn.execute(
            "UPDATE canonical_world_state
             SET committed_seq = MAX(committed_seq, ?2)
             WHERE world_id = ?1",
            params![world_id, durable_max_seq],
        )
        .map_err(sqlite_error)?;
    } else {
        let committed_seq = as_u64(committed_seq, "committed world sequence")?;
        let durable_max_seq = as_u64(durable_max_seq, "maximum world event sequence")?;
        if committed_seq != durable_max_seq {
            return Err(invalid_data(format!(
                "canonical world cursor {committed_seq} does not match durable event suffix {durable_max_seq}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn acquire_partition_lease(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    partition_key: &str,
    owner_id: &str,
    now_ms: u64,
    ttl_ms: u64,
) -> io::Result<AuthorityLease> {
    let mut conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let lease = acquire_partition_lease_in_transaction(
        &tx,
        world_id,
        partition_key,
        owner_id,
        now_ms,
        ttl_ms,
    )?;
    tx.commit().map_err(sqlite_error)?;
    Ok(lease)
}

pub(super) fn acquire_partition_leases(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    partition_keys: &BTreeSet<String>,
    owner_id: &str,
    now_ms: u64,
    ttl_ms: u64,
) -> io::Result<BTreeMap<String, AuthorityLease>> {
    let mut conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let mut leases = BTreeMap::new();
    for partition_key in partition_keys {
        let lease = acquire_partition_lease_in_transaction(
            &tx,
            world_id,
            partition_key,
            owner_id,
            now_ms,
            ttl_ms,
        )?;
        leases.insert(partition_key.clone(), lease);
    }
    tx.commit().map_err(sqlite_error)?;
    Ok(leases)
}

pub(super) fn acquire_partition_lease_in_transaction(
    conn: &Connection,
    world_id: &str,
    partition_key: &str,
    owner_id: &str,
    now_ms: u64,
    ttl_ms: u64,
) -> io::Result<AuthorityLease> {
    let existing = conn
        .query_row(
            "SELECT owner_id, fencing_epoch, lease_expires_at_ms
             FROM canonical_partition_leases
             WHERE world_id = ?1 AND partition_key = ?2",
            params![world_id, partition_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(sqlite_error)?;
    let next_expiry = now_ms.saturating_add(ttl_ms.max(1));
    let fencing_epoch = match existing {
        None => 1,
        Some((ref current_owner, current_epoch, current_expiry))
            if current_owner == owner_id && current_expiry > as_i64(now_ms)? =>
        {
            as_u64(current_epoch, "fencing_epoch")?
        }
        Some((_, current_epoch, current_expiry)) if current_expiry <= as_i64(now_ms)? => {
            as_u64(current_epoch, "fencing_epoch")?.saturating_add(1)
        }
        Some((current_owner, current_epoch, current_expiry)) => {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                format!(
                    "partition {partition_key} is leased by {current_owner} at fence {current_epoch} until {current_expiry}"
                ),
            ));
        }
    };
    conn.execute(
        "INSERT INTO canonical_partition_leases
            (world_id, partition_key, owner_id, fencing_epoch, lease_expires_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(world_id, partition_key) DO UPDATE SET
            owner_id = excluded.owner_id,
            fencing_epoch = excluded.fencing_epoch,
            lease_expires_at_ms = excluded.lease_expires_at_ms,
            updated_at_ms = excluded.updated_at_ms",
        params![
            world_id,
            partition_key,
            owner_id,
            as_i64(fencing_epoch)?,
            as_i64(next_expiry)?,
            as_i64(now_ms)?
        ],
    )
    .map_err(sqlite_error)?;
    Ok(AuthorityLease {
        world_id: world_id.to_string(),
        partition_key: partition_key.to_string(),
        owner_id: owner_id.to_string(),
        fencing_epoch,
        lease_expires_at_ms: next_expiry,
    })
}

pub(super) fn current_partition_lease(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    partition_key: &str,
    now_ms: u64,
) -> io::Result<Option<AuthorityLease>> {
    let conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    conn.query_row(
        "SELECT owner_id, fencing_epoch, lease_expires_at_ms
         FROM canonical_partition_leases
         WHERE world_id = ?1 AND partition_key = ?2 AND lease_expires_at_ms > ?3",
        params![world_id, partition_key, as_i64(now_ms)?],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )
    .optional()
    .map_err(sqlite_error)?
    .map(|(owner_id, fencing_epoch, lease_expires_at_ms)| {
        Ok(AuthorityLease {
            world_id: world_id.to_string(),
            partition_key: partition_key.to_string(),
            owner_id,
            fencing_epoch: as_u64(fencing_epoch, "fencing_epoch")?,
            lease_expires_at_ms: as_u64(lease_expires_at_ms, "lease_expires_at_ms")?,
        })
    })
    .transpose()
}

pub(super) fn upsert_process_route(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    route: &CanonicalProcessRoute,
    updated_at_ms: u64,
) -> io::Result<()> {
    let conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    conn.execute(
        "INSERT INTO canonical_process_routes
            (world_id, owner_id, process_id, base_url, heartbeat_expires_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(world_id, owner_id) DO UPDATE SET
            process_id = excluded.process_id,
            base_url = excluded.base_url,
            heartbeat_expires_at_ms = excluded.heartbeat_expires_at_ms,
            updated_at_ms = excluded.updated_at_ms",
        params![
            world_id,
            route.owner_id,
            route.process_id,
            route.base_url,
            as_i64(route.heartbeat_expires_at_ms)?,
            as_i64(updated_at_ms)?
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

pub(super) fn process_route_for_owner(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    owner_id: &str,
    now_ms: u64,
) -> io::Result<Option<CanonicalProcessRoute>> {
    let conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    conn.query_row(
        "SELECT owner_id, process_id, base_url, heartbeat_expires_at_ms
         FROM canonical_process_routes
         WHERE world_id = ?1 AND owner_id = ?2 AND heartbeat_expires_at_ms > ?3",
        params![world_id, owner_id, as_i64(now_ms)?],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    )
    .optional()
    .map_err(sqlite_error)?
    .map(
        |(owner_id, process_id, base_url, heartbeat_expires_at_ms)| {
            Ok(CanonicalProcessRoute {
                owner_id,
                process_id,
                base_url,
                heartbeat_expires_at_ms: as_u64(
                    heartbeat_expires_at_ms,
                    "heartbeat_expires_at_ms",
                )?,
            })
        },
    )
    .transpose()
}

pub(super) fn active_process_routes(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    now_ms: u64,
) -> io::Result<Vec<CanonicalProcessRoute>> {
    let conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    let mut stmt = conn
        .prepare(
            "SELECT owner_id, process_id, base_url, heartbeat_expires_at_ms
             FROM canonical_process_routes
             WHERE world_id = ?1 AND heartbeat_expires_at_ms > ?2
             ORDER BY process_id, owner_id",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![world_id, as_i64(now_ms)?], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(sqlite_error)?;
    rows.map(|row| {
        let (owner_id, process_id, base_url, heartbeat_expires_at_ms) =
            row.map_err(sqlite_error)?;
        Ok(CanonicalProcessRoute {
            owner_id,
            process_id,
            base_url,
            heartbeat_expires_at_ms: as_u64(heartbeat_expires_at_ms, "heartbeat_expires_at_ms")?,
        })
    })
    .collect()
}

pub(super) fn insert_canonical_invite(
    path: &Path,
    world_epoch: u64,
    invite: &CanonicalInvite,
) -> io::Result<bool> {
    let conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, &invite.world_id, world_epoch)?;
    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO canonical_invites
                (invite_id, world_id, actor_ref, created_location_ref,
                 created_world_seq, created_at_ms, expires_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                invite.invite_id,
                invite.world_id,
                invite.actor_ref,
                invite.created_location_ref,
                as_i64(invite.created_world_seq)?,
                as_i64(invite.created_at_ms)?,
                as_i64(invite.expires_at_ms)?
            ],
        )
        .map_err(sqlite_error)?;
    Ok(inserted == 1)
}

pub(super) fn read_canonical_invite(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    invite_id: &str,
    now_ms: u64,
) -> io::Result<Option<CanonicalInvite>> {
    let conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    conn.query_row(
        "SELECT invite_id, world_id, actor_ref, created_location_ref,
                created_world_seq, created_at_ms, expires_at_ms
         FROM canonical_invites
         WHERE invite_id = ?1 AND world_id = ?2 AND expires_at_ms > ?3",
        params![invite_id, world_id, as_i64(now_ms)?],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        },
    )
    .optional()
    .map_err(sqlite_error)?
    .map(
        |(
            invite_id,
            world_id,
            actor_ref,
            created_location_ref,
            created_world_seq,
            created_at_ms,
            expires_at_ms,
        )| {
            Ok(CanonicalInvite {
                invite_id,
                world_id,
                actor_ref,
                created_location_ref,
                created_world_seq: as_u64(created_world_seq, "created_world_seq")?,
                created_at_ms: as_u64(created_at_ms, "created_at_ms")?,
                expires_at_ms: as_u64(expires_at_ms, "expires_at_ms")?,
            })
        },
    )
    .transpose()
}

pub(super) fn validate_and_renew_partition_lease(
    conn: &Connection,
    lease: &AuthorityLease,
    now_ms: u64,
    ttl_ms: u64,
) -> io::Result<AuthorityLease> {
    let next_expiry = now_ms.saturating_add(ttl_ms.max(1));
    let changed = conn
        .execute(
            "UPDATE canonical_partition_leases
             SET lease_expires_at_ms = ?5, updated_at_ms = ?4
             WHERE world_id = ?1 AND partition_key = ?2
               AND owner_id = ?3 AND fencing_epoch = ?6
               AND lease_expires_at_ms > ?4",
            params![
                lease.world_id,
                lease.partition_key,
                lease.owner_id,
                as_i64(now_ms)?,
                as_i64(next_expiry)?,
                as_i64(lease.fencing_epoch)?
            ],
        )
        .map_err(sqlite_error)?;
    if changed != 1 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "authority for partition {} is expired or fenced by a newer owner",
                lease.partition_key
            ),
        ));
    }
    let mut renewed = lease.clone();
    renewed.lease_expires_at_ms = next_expiry;
    Ok(renewed)
}

pub(super) fn current_world_seq(conn: &Connection, world_id: &str) -> io::Result<u64> {
    let value = conn
        .query_row(
            "SELECT committed_seq FROM canonical_world_state WHERE world_id = ?1",
            params![world_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    as_u64(value, "committed_seq")
}

pub(super) fn bootstrap_legacy_world_sequence(
    conn: &Connection,
    world_id: &str,
    baseline_seq: u64,
    updated_at_ms: u64,
) -> io::Result<bool> {
    if baseline_seq == 0 {
        return Ok(false);
    }
    let changed = conn
        .execute(
            "UPDATE canonical_world_state
             SET committed_seq = ?2, updated_at_ms = ?3
             WHERE world_id = ?1 AND committed_seq = 0
               AND NOT EXISTS (
                   SELECT 1 FROM canonical_commits WHERE world_id = ?1
               )
               AND NOT EXISTS (SELECT 1 FROM world_events)",
            params![world_id, as_i64(baseline_seq)?, as_i64(updated_at_ms)?],
        )
        .map_err(sqlite_error)?;
    Ok(changed == 1)
}

pub(super) fn validate_next_world_sequence(
    conn: &Connection,
    world_id: &str,
    event_seqs: &[u64],
) -> io::Result<(u64, u64)> {
    let committed = current_world_seq(conn, world_id)?;
    if event_seqs.is_empty() {
        return Ok((committed, committed));
    }
    let mut expected = committed.saturating_add(1);
    for seq in event_seqs {
        if *seq != expected {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "canonical world sequence is stale or discontinuous: expected {expected}, proposed {seq}"
                ),
            ));
        }
        expected = expected.saturating_add(1);
    }
    Ok((event_seqs[0], *event_seqs.last().unwrap_or(&committed)))
}

pub(super) fn advance_world_sequence(
    conn: &Connection,
    world_id: &str,
    expected_previous_seq: u64,
    next_seq: u64,
    updated_at_ms: u64,
) -> io::Result<()> {
    let changed = conn
        .execute(
            "UPDATE canonical_world_state
             SET committed_seq = ?3, updated_at_ms = ?4
             WHERE world_id = ?1 AND committed_seq = ?2",
            params![
                world_id,
                as_i64(expected_previous_seq)?,
                as_i64(next_seq)?,
                as_i64(updated_at_ms)?
            ],
        )
        .map_err(sqlite_error)?;
    if changed != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "canonical world sequence changed during commit",
        ));
    }
    Ok(())
}

pub(super) fn reconcile_entity_versions(
    conn: &Connection,
    world_id: &str,
    before: &BTreeMap<String, u64>,
    after: &BTreeMap<String, u64>,
    updated_at_ms: u64,
) -> io::Result<BTreeMap<String, u64>> {
    let stored_count = conn
        .query_row(
            "SELECT COUNT(*) FROM canonical_entity_versions WHERE world_id = ?1",
            params![world_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    if stored_count == 0 {
        for (entity_ref, version) in before {
            conn.execute(
                "INSERT OR IGNORE INTO canonical_entity_versions
                    (world_id, entity_ref, entity_version, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    world_id,
                    entity_ref,
                    as_i64(*version)?,
                    as_i64(updated_at_ms)?
                ],
            )
            .map_err(sqlite_error)?;
        }
    }

    let changed = after
        .iter()
        .filter(|(entity_ref, version)| before.get(*entity_ref) != Some(*version))
        .map(|(entity_ref, version)| (entity_ref.clone(), *version))
        .collect::<BTreeMap<_, _>>();
    for (entity_ref, next_version) in &changed {
        match before.get(entity_ref).copied() {
            Some(previous_version) => {
                if *next_version <= previous_version {
                    return Err(invalid_data(format!(
                        "entity version for {entity_ref} did not increase"
                    )));
                }
                conn.execute(
                    "INSERT OR IGNORE INTO canonical_entity_versions
                        (world_id, entity_ref, entity_version, updated_at_ms)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        world_id,
                        entity_ref,
                        as_i64(previous_version)?,
                        as_i64(updated_at_ms)?
                    ],
                )
                .map_err(sqlite_error)?;
                let updated = conn
                    .execute(
                        "UPDATE canonical_entity_versions
                         SET entity_version = ?4, updated_at_ms = ?5
                         WHERE world_id = ?1 AND entity_ref = ?2 AND entity_version = ?3",
                        params![
                            world_id,
                            entity_ref,
                            as_i64(previous_version)?,
                            as_i64(*next_version)?,
                            as_i64(updated_at_ms)?
                        ],
                    )
                    .map_err(sqlite_error)?;
                if updated != 1 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("stale entity version for {entity_ref}"),
                    ));
                }
            }
            None => {
                let inserted = conn
                    .execute(
                        "INSERT OR IGNORE INTO canonical_entity_versions
                            (world_id, entity_ref, entity_version, updated_at_ms)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![
                            world_id,
                            entity_ref,
                            as_i64(*next_version)?,
                            as_i64(updated_at_ms)?
                        ],
                    )
                    .map_err(sqlite_error)?;
                if inserted != 1 {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!("canonical entity {entity_ref} was concurrently created"),
                    ));
                }
            }
        }
    }
    Ok(changed)
}

pub(super) fn insert_new_claims(
    conn: &Connection,
    world_id: &str,
    before: &BTreeMap<String, BTreeSet<String>>,
    after: &BTreeMap<String, BTreeSet<String>>,
    source_intent_id: Option<&str>,
    source_world_seq: u64,
    created_at_ms: u64,
) -> io::Result<BTreeMap<String, BTreeSet<String>>> {
    let stored_count = conn
        .query_row(
            "SELECT COUNT(*) FROM canonical_claims WHERE world_id = ?1",
            params![world_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    if stored_count == 0 {
        for (kind, claim_keys) in before {
            for claim_key in claim_keys {
                conn.execute(
                    "INSERT OR IGNORE INTO canonical_claims
                        (world_id, claim_kind, claim_key, source_intent_id, source_world_seq, created_at_ms)
                     VALUES (?1, ?2, ?3, NULL, 0, ?4)",
                    params![world_id, kind, claim_key, as_i64(created_at_ms)?],
                )
                .map_err(sqlite_error)?;
            }
        }
    }
    let mut inserted_claims = BTreeMap::new();
    for (kind, after_keys) in after {
        let before_keys = before.get(kind);
        for claim_key in after_keys
            .iter()
            .filter(|claim_key| !before_keys.is_some_and(|keys| keys.contains(*claim_key)))
        {
            let inserted = conn
                .execute(
                    "INSERT OR IGNORE INTO canonical_claims
                        (world_id, claim_kind, claim_key, source_intent_id, source_world_seq, created_at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        world_id,
                        kind,
                        claim_key,
                        source_intent_id,
                        as_i64(source_world_seq)?,
                        as_i64(created_at_ms)?
                    ],
                )
                .map_err(sqlite_error)?;
            if inserted != 1 {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!("canonical claim {kind}:{claim_key} already exists"),
                ));
            }
            inserted_claims
                .entry(kind.clone())
                .or_insert_with(BTreeSet::new)
                .insert(claim_key.clone());
        }
    }
    Ok(inserted_claims)
}

pub(super) fn insert_canonical_commit(
    conn: &Connection,
    row: &CanonicalCommitRow<'_>,
) -> io::Result<()> {
    conn.execute(
        "INSERT INTO canonical_commits
            (commit_id, world_id, world_epoch, first_world_seq, last_world_seq,
             intent_id, request_hash, owner_id, owner_fencing_epoch,
             partitions_json, entity_versions_json, claims_json,
             action_journal_seq, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            row.commit_id,
            row.world_id,
            as_i64(row.world_epoch)?,
            as_i64(row.first_world_seq)?,
            as_i64(row.last_world_seq)?,
            row.intent_id,
            row.request_hash,
            row.owner_id,
            as_i64(row.owner_fencing_epoch)?,
            row.partitions_json,
            row.entity_versions_json,
            row.claims_json,
            as_i64(row.action_journal_seq)?,
            as_i64(row.created_at_ms)?
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

pub(super) fn insert_atomic_command_receipt(
    conn: &Connection,
    row: &CanonicalReceiptRow<'_>,
) -> io::Result<()> {
    conn.execute(
        "INSERT INTO canonical_command_receipts
            (world_id, intent_id, request_hash, response_json, created_at_ms,
             commit_id, world_epoch, world_seq, owner_id, owner_fencing_epoch,
             finalized, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?5)",
        params![
            row.world_id,
            row.intent_id,
            row.request_hash,
            row.response_json,
            as_i64(row.created_at_ms)?,
            row.commit_id,
            as_i64(row.world_epoch)?,
            as_i64(row.world_seq)?,
            row.owner_id,
            as_i64(row.owner_fencing_epoch)?
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

pub(super) fn finalize_atomic_command_receipt(
    path: &Path,
    world_id: &str,
    intent_id: &str,
    request_hash: &str,
    response_json: &str,
    world_seq: u64,
    updated_at_ms: u64,
) -> io::Result<bool> {
    let conn = open_canonical_store(path)?;
    let updated = conn
        .execute(
            "UPDATE canonical_command_receipts
             SET response_json = ?4, world_seq = ?5, finalized = 1, updated_at_ms = ?6
             WHERE world_id = ?1 AND intent_id = ?2 AND request_hash = ?3",
            params![
                world_id,
                intent_id,
                request_hash,
                response_json,
                as_i64(world_seq)?,
                as_i64(updated_at_ms)?
            ],
        )
        .map_err(sqlite_error)?;
    Ok(updated == 1)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, alter_sql: &str) -> io::Result<()> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&pragma).map_err(sqlite_error)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sqlite_error)?;
    for row in rows {
        if row.map_err(sqlite_error)? == column {
            return Ok(());
        }
    }
    conn.execute(alter_sql, []).map_err(sqlite_error)?;
    Ok(())
}

fn open_canonical_store(path: &Path) -> io::Result<Connection> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(sqlite_error)?;
    Ok(conn)
}

fn as_i64(value: u64) -> io::Result<i64> {
    i64::try_from(value).map_err(|_| invalid_data(format!("value {value} exceeds SQLite INTEGER")))
}

fn as_u64(value: i64, field: &str) -> io::Result<u64> {
    u64::try_from(value).map_err(|_| invalid_data(format!("negative {field} in canonical journal")))
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_db(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "cosyworld-canonical-journal-{name}-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn initialize(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE world_events (
                seq INTEGER PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
             );
             CREATE TABLE canonical_command_receipts (
                world_id TEXT NOT NULL,
                intent_id TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                response_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                PRIMARY KEY (world_id, intent_id)
             );",
        )
        .unwrap();
        init_canonical_journal(&conn, "world://test", 1).unwrap();
    }

    #[test]
    fn newer_fence_rejects_expired_owner() {
        let path = temp_db("fence");
        initialize(&path);
        let old =
            acquire_partition_lease(&path, "world://test", 1, "room:a", "old", 10, 10).unwrap();
        let newer =
            acquire_partition_lease(&path, "world://test", 1, "room:a", "new", 21, 10).unwrap();
        assert!(newer.fencing_epoch > old.fencing_epoch);

        let conn = Connection::open(&path).unwrap();
        let error = validate_and_renew_partition_lease(&conn, &old, 22, 10).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        validate_and_renew_partition_lease(&conn, &newer, 22, 10).unwrap();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn live_partition_owner_cannot_be_preempted() {
        let path = temp_db("live-owner");
        initialize(&path);
        acquire_partition_lease(&path, "world://test", 1, "room:a", "owner-a", 10, 50).unwrap();
        let error = acquire_partition_lease(&path, "world://test", 1, "room:a", "owner-b", 11, 50)
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn entity_compare_and_set_rejects_stale_writer() {
        let path = temp_db("entity-cas");
        initialize(&path);
        let conn = Connection::open(&path).unwrap();
        let before = BTreeMap::from([("actor:a".to_string(), 1)]);
        let after = BTreeMap::from([("actor:a".to_string(), 2)]);
        reconcile_entity_versions(&conn, "world://test", &before, &after, 10).unwrap();
        let error =
            reconcile_entity_versions(&conn, "world://test", &before, &after, 11).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn world_cursor_requires_a_contiguous_suffix() {
        let path = temp_db("cursor");
        initialize(&path);
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            validate_next_world_sequence(&conn, "world://test", &[1, 2]).unwrap(),
            (1, 2)
        );
        advance_world_sequence(&conn, "world://test", 0, 2, 10).unwrap();
        assert!(validate_next_world_sequence(&conn, "world://test", &[2, 3]).is_err());
        assert_eq!(
            validate_next_world_sequence(&conn, "world://test", &[3, 4]).unwrap(),
            (3, 4)
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn process_routes_only_resolve_while_the_exact_owner_is_live() {
        let path = temp_db("process-route");
        initialize(&path);
        let route = CanonicalProcessRoute {
            owner_id: "process-a:boot-1".to_string(),
            process_id: "process-a".to_string(),
            base_url: "http://127.0.0.1:4101".to_string(),
            heartbeat_expires_at_ms: 50,
        };
        upsert_process_route(&path, "world://test", 1, &route, 10).unwrap();

        assert_eq!(
            process_route_for_owner(&path, "world://test", 1, "process-a:boot-1", 49,).unwrap(),
            Some(route.clone())
        );
        assert_eq!(
            active_process_routes(&path, "world://test", 1, 49).unwrap(),
            vec![route]
        );
        assert!(
            process_route_for_owner(&path, "world://test", 1, "process-a:boot-1", 50,)
                .unwrap()
                .is_none()
        );
        assert!(active_process_routes(&path, "world://test", 1, 50)
            .unwrap()
            .is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn canonical_invites_are_durable_unique_and_expire_at_the_boundary() {
        let path = temp_db("invite");
        initialize(&path);
        let invite = CanonicalInvite {
            invite_id: "cw_test_invite".to_string(),
            world_id: "world://test".to_string(),
            actor_ref: "world://test/actor/alice".to_string(),
            created_location_ref: "world://test/location/cottage".to_string(),
            created_world_seq: 42,
            created_at_ms: 100,
            expires_at_ms: 200,
        };

        assert!(insert_canonical_invite(&path, 1, &invite).unwrap());
        assert!(!insert_canonical_invite(&path, 1, &invite).unwrap());
        assert_eq!(
            read_canonical_invite(&path, "world://test", 1, &invite.invite_id, 199).unwrap(),
            Some(invite.clone())
        );
        assert!(
            read_canonical_invite(&path, "world://test", 1, &invite.invite_id, 200)
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_file(path);
    }
}
