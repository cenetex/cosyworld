use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fmt, io};

const LEGACY_IMPORT_SCHEMA_VERSION: u32 = 1;
const MAX_SOURCE_RECORDS: usize = 10_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum LegacyProjectionKind {
    Account,
    AvatarHistory,
    Location,
    Resident,
    Item,
    Balance,
    Claim,
    Pact,
    PublicEvent,
}

impl LegacyProjectionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Account => "account",
            Self::AvatarHistory => "avatar_history",
            Self::Location => "location",
            Self::Resident => "resident",
            Self::Item => "item",
            Self::Balance => "balance",
            Self::Claim => "claim",
            Self::Pact => "pact",
            Self::PublicEvent => "public_event",
        }
    }

    fn is_eligible_projection(self) -> bool {
        matches!(self, Self::Account | Self::AvatarHistory)
    }

    fn has_canonical_entity_target(self) -> bool {
        matches!(
            self,
            Self::Location | Self::Resident | Self::Item | Self::Balance | Self::Pact
        )
    }
}

impl fmt::Display for LegacyProjectionKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum LegacyTransformStrategy {
    Project,
    MapExisting,
    Archive,
    MarkConsumed,
    Discard,
}

impl LegacyTransformStrategy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::MapExisting => "map_existing",
            Self::Archive => "archive",
            Self::MarkConsumed => "mark_consumed",
            Self::Discard => "discard",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacySourceRecord {
    pub(super) kind: LegacyProjectionKind,
    pub(super) source_id: String,
    pub(super) payload: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacySaveSource {
    pub(super) schema_version: u32,
    pub(super) composition_hash: String,
    pub(super) records: Vec<LegacySourceRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacyReviewedTransform {
    pub(super) review_id: String,
    pub(super) reviewed_by: String,
    pub(super) transform_version: String,
    pub(super) rationale: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacyCanonicalClaim {
    pub(super) kind: String,
    pub(super) key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacyImportTransform {
    pub(super) kind: LegacyProjectionKind,
    pub(super) source_id: String,
    pub(super) strategy: LegacyTransformStrategy,
    #[serde(default)]
    pub(super) target_ref: Option<String>,
    #[serde(default)]
    pub(super) canonical_claim: Option<LegacyCanonicalClaim>,
    #[serde(default)]
    pub(super) reviewed_transform: Option<LegacyReviewedTransform>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacyCompositionTransform {
    pub(super) old_hash: String,
    pub(super) new_hash: String,
    pub(super) reviewed_transform: LegacyReviewedTransform,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacySaveImportRequest {
    pub(super) schema_version: u32,
    pub(super) installation_id: String,
    pub(super) legacy_shard_id: String,
    pub(super) save_id: String,
    pub(super) source: LegacySaveSource,
    pub(super) composition_transform: LegacyCompositionTransform,
    pub(super) transforms: Vec<LegacyImportTransform>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum LegacyImportStatus {
    Applied,
    NoOp,
    Conflicted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct LegacyImportConflict {
    pub(super) code: String,
    pub(super) source_ref: Option<String>,
    pub(super) target_ref: Option<String>,
    pub(super) detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct LegacyImportReport {
    pub(super) status: LegacyImportStatus,
    pub(super) receipt_id: String,
    pub(super) source_namespace: String,
    pub(super) source_hash: String,
    pub(super) plan_hash: String,
    pub(super) old_composition_hash: String,
    pub(super) new_composition_hash: String,
    pub(super) mapping_count: usize,
    pub(super) projection_count: usize,
    pub(super) conflicts: Vec<LegacyImportConflict>,
}

#[derive(Clone)]
struct NormalizedImport {
    namespace: String,
    source_hash: String,
    plan_hash: String,
    receipt_id: String,
    source: LegacySaveSource,
    transforms: Vec<LegacyImportTransform>,
}

pub(super) fn init_legacy_import_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS canonical_legacy_import_receipts (
            source_namespace TEXT PRIMARY KEY,
            receipt_id TEXT NOT NULL UNIQUE,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            source_hash TEXT NOT NULL,
            plan_hash TEXT NOT NULL,
            old_composition_hash TEXT NOT NULL,
            new_composition_hash TEXT NOT NULL,
            review_id TEXT NOT NULL,
            reviewed_by TEXT NOT NULL,
            mapping_count INTEGER NOT NULL,
            projection_count INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_legacy_import_mappings (
            source_ref TEXT PRIMARY KEY,
            source_namespace TEXT NOT NULL,
            world_id TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_record_hash TEXT NOT NULL,
            strategy TEXT NOT NULL,
            target_ref TEXT,
            review_id TEXT,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (source_namespace)
                REFERENCES canonical_legacy_import_receipts(source_namespace)
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_import_mappings_target
            ON canonical_legacy_import_mappings(world_id, source_kind, target_ref);
        CREATE TABLE IF NOT EXISTS canonical_legacy_import_projections (
            source_ref TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            projection_kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            active INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (source_ref)
                REFERENCES canonical_legacy_import_mappings(source_ref)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_import_active_projection_target
            ON canonical_legacy_import_projections(world_id, projection_kind, target_ref)
            WHERE active = 1;
        CREATE TABLE IF NOT EXISTS canonical_legacy_composition_migrations (
            receipt_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            source_namespace TEXT NOT NULL,
            old_composition_hash TEXT NOT NULL,
            new_composition_hash TEXT NOT NULL,
            review_id TEXT NOT NULL,
            reviewed_by TEXT NOT NULL,
            transform_version TEXT NOT NULL,
            rationale TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_legacy_import_reports (
            report_id TEXT PRIMARY KEY,
            source_namespace TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            plan_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            report_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_import_reports_source
            ON canonical_legacy_import_reports(source_namespace, created_at_ms);",
    )
    .map_err(sqlite_error)
}

pub(super) fn apply_legacy_import_transaction(
    tx: &Transaction<'_>,
    world_id: &str,
    world_epoch: u64,
    active_composition_hash: &str,
    current_world_seq: u64,
    request: &LegacySaveImportRequest,
    created_at_ms: u64,
) -> io::Result<LegacyImportReport> {
    let normalized = normalize_import(request)?;
    if let Some(existing) = existing_receipt(tx, &normalized.namespace)? {
        if existing.source_hash == normalized.source_hash
            && existing.plan_hash == normalized.plan_hash
        {
            return Ok(LegacyImportReport {
                status: LegacyImportStatus::NoOp,
                receipt_id: existing.receipt_id,
                source_namespace: normalized.namespace,
                source_hash: normalized.source_hash,
                plan_hash: normalized.plan_hash,
                old_composition_hash: existing.old_composition_hash,
                new_composition_hash: existing.new_composition_hash,
                mapping_count: existing.mapping_count,
                projection_count: existing.projection_count,
                conflicts: Vec::new(),
            });
        }
        let report = conflict_report(
            &normalized,
            request,
            vec![LegacyImportConflict {
                code: "source_namespace_reused".to_string(),
                source_ref: None,
                target_ref: None,
                detail: format!(
                    "{} already has immutable receipt {} for a different source or plan hash",
                    normalized.namespace, existing.receipt_id
                ),
            }],
        );
        persist_report(tx, &report, created_at_ms)?;
        return Ok(report);
    }

    let records = normalized
        .source
        .records
        .iter()
        .map(|record| ((record.kind, record.source_id.as_str()), record))
        .collect::<BTreeMap<_, _>>();
    let mut conflicts = Vec::new();

    if request.composition_transform.old_hash != normalized.source.composition_hash {
        conflicts.push(LegacyImportConflict {
            code: "composition_source_mismatch".to_string(),
            source_ref: None,
            target_ref: None,
            detail: "the reviewed old composition hash does not match the source save".to_string(),
        });
    }
    if request.composition_transform.new_hash != active_composition_hash {
        conflicts.push(LegacyImportConflict {
            code: "composition_target_mismatch".to_string(),
            source_ref: None,
            target_ref: None,
            detail: "the reviewed new composition hash is not the active canonical composition"
                .to_string(),
        });
    }

    let mut planned_targets: BTreeMap<
        (LegacyProjectionKind, String),
        (String, String, LegacyTransformStrategy),
    > = BTreeMap::new();
    for transform in &normalized.transforms {
        let record = records
            .get(&(transform.kind, transform.source_id.as_str()))
            .expect("normalization guarantees transform coverage");
        let source_ref = source_ref(&normalized.namespace, transform.kind, &transform.source_id);
        let record_hash = json_hash(record)?;
        let target_ref = effective_target_ref(transform);

        if let Some(target_ref) = target_ref.as_deref() {
            let target_key = (transform.kind, target_ref.to_string());
            if let Some((other_source_ref, other_hash, other_strategy)) =
                planned_targets.get(&target_key)
            {
                let incompatible = matches!(transform.strategy, LegacyTransformStrategy::Project)
                    || matches!(*other_strategy, LegacyTransformStrategy::Project)
                    || record_hash != *other_hash;
                if incompatible {
                    conflicts.push(LegacyImportConflict {
                        code: "plan_target_collision".to_string(),
                        source_ref: Some(source_ref.clone()),
                        target_ref: Some(target_ref.to_string()),
                        detail: format!(
                            "the plan also maps {other_source_ref} to this target with incompatible history"
                        ),
                    });
                }
            } else if !matches!(transform.strategy, LegacyTransformStrategy::Archive) {
                planned_targets.insert(
                    target_key,
                    (source_ref.clone(), record_hash.clone(), transform.strategy),
                );
            }
        }

        if matches!(transform.strategy, LegacyTransformStrategy::MapExisting)
            && transform.kind.has_canonical_entity_target()
            && !canonical_entity_exists(tx, world_id, target_ref.as_deref().unwrap_or_default())?
        {
            conflicts.push(LegacyImportConflict {
                code: "canonical_target_missing".to_string(),
                source_ref: Some(source_ref.clone()),
                target_ref: target_ref.clone(),
                detail: "map_existing requires a durable canonical entity target".to_string(),
            });
        }

        if !matches!(
            transform.strategy,
            LegacyTransformStrategy::Archive | LegacyTransformStrategy::Discard
        ) {
            for existing in mappings_for_target(
                tx,
                world_id,
                transform.kind,
                target_ref.as_deref().unwrap_or_default(),
            )? {
                let incompatible = matches!(transform.strategy, LegacyTransformStrategy::Project)
                    || existing.strategy == "project"
                    || existing.source_record_hash != record_hash;
                if incompatible {
                    conflicts.push(LegacyImportConflict {
                        code: "divergent_target_history".to_string(),
                        source_ref: Some(source_ref.clone()),
                        target_ref: target_ref.clone(),
                        detail: format!(
                            "target already maps from {} with a different or exclusive projection",
                            existing.source_ref
                        ),
                    });
                }
            }
        }

        if let Some(claim) = transform
            .canonical_claim
            .as_ref()
            .filter(|_| matches!(transform.strategy, LegacyTransformStrategy::MarkConsumed))
        {
            if canonical_claim_exists(tx, world_id, &claim.kind, &claim.key)? {
                conflicts.push(LegacyImportConflict {
                    code: "canonical_claim_already_consumed".to_string(),
                    source_ref: Some(source_ref),
                    target_ref,
                    detail: format!(
                        "canonical claim {}:{} is already consumed; importing it again would replay a reward",
                        claim.kind, claim.key
                    ),
                });
            }
        }
    }

    if !conflicts.is_empty() {
        let report = conflict_report(&normalized, request, conflicts);
        persist_report(tx, &report, created_at_ms)?;
        return Ok(report);
    }

    let projection_count = normalized
        .transforms
        .iter()
        .filter(|transform| {
            matches!(
                transform.strategy,
                LegacyTransformStrategy::Project | LegacyTransformStrategy::Archive
            )
        })
        .count();
    let review = &request.composition_transform.reviewed_transform;
    tx.execute(
        "INSERT INTO canonical_legacy_import_receipts
            (source_namespace, receipt_id, world_id, world_epoch,
             source_hash, plan_hash, old_composition_hash, new_composition_hash,
             review_id, reviewed_by, mapping_count, projection_count, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            normalized.namespace,
            normalized.receipt_id,
            world_id,
            as_i64(world_epoch)?,
            normalized.source_hash,
            normalized.plan_hash,
            request.composition_transform.old_hash,
            request.composition_transform.new_hash,
            review.review_id,
            review.reviewed_by,
            as_i64(normalized.transforms.len() as u64)?,
            as_i64(projection_count as u64)?,
            as_i64(created_at_ms)?,
        ],
    )
    .map_err(sqlite_error)?;

    tx.execute(
        "INSERT INTO canonical_legacy_composition_migrations
            (receipt_id, world_id, world_epoch, source_namespace,
             old_composition_hash, new_composition_hash, review_id, reviewed_by,
             transform_version, rationale, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            normalized.receipt_id,
            world_id,
            as_i64(world_epoch)?,
            normalized.namespace,
            request.composition_transform.old_hash,
            request.composition_transform.new_hash,
            review.review_id,
            review.reviewed_by,
            review.transform_version,
            review.rationale,
            as_i64(created_at_ms)?,
        ],
    )
    .map_err(sqlite_error)?;

    for transform in &normalized.transforms {
        let record = records
            .get(&(transform.kind, transform.source_id.as_str()))
            .expect("normalization guarantees transform coverage");
        let source_ref = source_ref(&normalized.namespace, transform.kind, &transform.source_id);
        let record_hash = json_hash(record)?;
        let target_ref = effective_target_ref(transform);
        tx.execute(
            "INSERT INTO canonical_legacy_import_mappings
                (source_ref, source_namespace, world_id, source_kind, source_id,
                 source_record_hash, strategy, target_ref, review_id, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                source_ref,
                normalized.namespace,
                world_id,
                transform.kind.as_str(),
                transform.source_id,
                record_hash,
                transform.strategy.as_str(),
                target_ref,
                transform
                    .reviewed_transform
                    .as_ref()
                    .map(|review| review.review_id.as_str()),
                as_i64(created_at_ms)?,
            ],
        )
        .map_err(sqlite_error)?;

        if matches!(
            transform.strategy,
            LegacyTransformStrategy::Project | LegacyTransformStrategy::Archive
        ) {
            let payload_json = serde_json::to_string(&record.payload).map_err(json_error)?;
            tx.execute(
                "INSERT INTO canonical_legacy_import_projections
                    (source_ref, world_id, projection_kind, target_ref,
                     payload_json, payload_hash, active, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    source_ref,
                    world_id,
                    transform.kind.as_str(),
                    target_ref.as_deref().unwrap_or_default(),
                    payload_json,
                    json_hash(&record.payload)?,
                    i64::from(matches!(
                        transform.strategy,
                        LegacyTransformStrategy::Project
                    )),
                    as_i64(created_at_ms)?,
                ],
            )
            .map_err(sqlite_error)?;
        }

        if let Some(claim) = transform
            .canonical_claim
            .as_ref()
            .filter(|_| matches!(transform.strategy, LegacyTransformStrategy::MarkConsumed))
        {
            tx.execute(
                "INSERT INTO canonical_claims
                    (world_id, claim_kind, claim_key, source_intent_id,
                     source_world_seq, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    world_id,
                    claim.kind,
                    claim.key,
                    normalized.receipt_id,
                    as_i64(current_world_seq)?,
                    as_i64(created_at_ms)?,
                ],
            )
            .map_err(sqlite_error)?;
        }
    }

    Ok(LegacyImportReport {
        status: LegacyImportStatus::Applied,
        receipt_id: normalized.receipt_id,
        source_namespace: normalized.namespace,
        source_hash: normalized.source_hash,
        plan_hash: normalized.plan_hash,
        old_composition_hash: request.composition_transform.old_hash.clone(),
        new_composition_hash: request.composition_transform.new_hash.clone(),
        mapping_count: normalized.transforms.len(),
        projection_count,
        conflicts: Vec::new(),
    })
}

fn normalize_import(request: &LegacySaveImportRequest) -> io::Result<NormalizedImport> {
    if request.schema_version != LEGACY_IMPORT_SCHEMA_VERSION
        || request.source.schema_version != LEGACY_IMPORT_SCHEMA_VERSION
    {
        return Err(invalid_input("unsupported legacy import schema version"));
    }
    for (label, value) in [
        ("installation_id", request.installation_id.as_str()),
        ("legacy_shard_id", request.legacy_shard_id.as_str()),
        ("save_id", request.save_id.as_str()),
    ] {
        validate_component(value, label)?;
    }
    validate_hash(&request.source.composition_hash, "source composition hash")?;
    validate_hash(
        &request.composition_transform.old_hash,
        "old composition hash",
    )?;
    validate_hash(
        &request.composition_transform.new_hash,
        "new composition hash",
    )?;
    validate_review(&request.composition_transform.reviewed_transform)?;
    if request.source.records.len() > MAX_SOURCE_RECORDS {
        return Err(invalid_input(format!(
            "legacy save has more than {MAX_SOURCE_RECORDS} records"
        )));
    }
    if request.source.records.len() != request.transforms.len() {
        return Err(invalid_input(
            "every source record must have exactly one import transform",
        ));
    }

    let mut source = request.source.clone();
    source.records.sort_by(|left, right| {
        (left.kind, left.source_id.as_str()).cmp(&(right.kind, right.source_id.as_str()))
    });
    for pair in source.records.windows(2) {
        if pair[0].kind == pair[1].kind && pair[0].source_id == pair[1].source_id {
            return Err(invalid_input(format!(
                "duplicate legacy source record {}:{}",
                pair[0].kind, pair[0].source_id
            )));
        }
    }
    for record in &source.records {
        validate_component(&record.source_id, "legacy source id")?;
    }

    let mut transforms = request.transforms.clone();
    transforms.sort_by(|left, right| {
        (left.kind, left.source_id.as_str()).cmp(&(right.kind, right.source_id.as_str()))
    });
    for pair in transforms.windows(2) {
        if pair[0].kind == pair[1].kind && pair[0].source_id == pair[1].source_id {
            return Err(invalid_input(format!(
                "duplicate legacy transform {}:{}",
                pair[0].kind, pair[0].source_id
            )));
        }
    }
    for (record, transform) in source.records.iter().zip(&transforms) {
        if record.kind != transform.kind || record.source_id != transform.source_id {
            return Err(invalid_input(
                "every source record must have one matching kind/source_id transform",
            ));
        }
        validate_transform(transform)?;
    }

    let namespace = format!(
        "legacy://{}/{}/{}",
        request.installation_id, request.legacy_shard_id, request.save_id
    );
    let source_hash = json_hash(&source)?;
    let plan_hash = json_hash(&(request.composition_transform.clone(), transforms.clone()))?;
    let receipt_id = hash_bytes(
        format!("{namespace}\n{source_hash}\n{plan_hash}").as_bytes(),
        "legacy-import",
    );
    Ok(NormalizedImport {
        namespace,
        source_hash,
        plan_hash,
        receipt_id,
        source,
        transforms,
    })
}

fn validate_transform(transform: &LegacyImportTransform) -> io::Result<()> {
    validate_component(&transform.source_id, "legacy transform source id")?;
    if !transform.kind.is_eligible_projection() && transform.reviewed_transform.is_none() {
        return Err(invalid_input(format!(
            "{} transforms require explicit review evidence",
            transform.kind
        )));
    }
    if let Some(review) = &transform.reviewed_transform {
        validate_review(review)?;
    }
    match (transform.kind, transform.strategy) {
        (kind, LegacyTransformStrategy::Project) if kind.is_eligible_projection() => {}
        (kind, LegacyTransformStrategy::Archive) if !kind.is_eligible_projection() => {}
        (_, LegacyTransformStrategy::MapExisting | LegacyTransformStrategy::Discard) => {}
        (LegacyProjectionKind::Claim, LegacyTransformStrategy::MarkConsumed) => {}
        _ => {
            return Err(invalid_input(format!(
                "strategy {} is not valid for {}",
                transform.strategy.as_str(),
                transform.kind
            )));
        }
    }

    let needs_target = matches!(
        transform.strategy,
        LegacyTransformStrategy::Project
            | LegacyTransformStrategy::MapExisting
            | LegacyTransformStrategy::Archive
    );
    if needs_target {
        validate_target_ref(
            transform
                .target_ref
                .as_deref()
                .ok_or_else(|| invalid_input("the selected transform strategy needs target_ref"))?,
        )?;
    } else if transform.target_ref.is_some() {
        return Err(invalid_input(
            "discard and mark_consumed transforms must not set target_ref",
        ));
    }

    match transform.strategy {
        LegacyTransformStrategy::MarkConsumed => {
            let claim = transform.canonical_claim.as_ref().ok_or_else(|| {
                invalid_input("mark_consumed requires canonical_claim kind and key")
            })?;
            if !matches!(claim.kind.as_str(), "rpg" | "orb_reward" | "listen_attempt") {
                return Err(invalid_input(
                    "canonical claim kind must be rpg, orb_reward, or listen_attempt",
                ));
            }
            validate_component(&claim.key, "canonical claim key")?;
        }
        _ if transform.canonical_claim.is_some() => {
            return Err(invalid_input(
                "canonical_claim is only valid with mark_consumed",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn validate_review(review: &LegacyReviewedTransform) -> io::Result<()> {
    validate_component(&review.review_id, "review id")?;
    validate_component(&review.reviewed_by, "reviewer")?;
    validate_component(&review.transform_version, "transform version")?;
    let rationale = review.rationale.trim();
    if rationale.len() < 8 || rationale.len() > 2_000 {
        return Err(invalid_input(
            "review rationale must contain 8-2000 characters",
        ));
    }
    Ok(())
}

fn validate_component(value: &str, label: &str) -> io::Result<()> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(invalid_input(format!(
            "{label} must use 1-256 ASCII letters, digits, dot, dash, underscore, or colon"
        )));
    }
    Ok(())
}

fn validate_hash(value: &str, label: &str) -> io::Result<()> {
    if value.len() != 71
        || !value.starts_with("sha256:")
        || !value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid_input(format!("{label} must be a sha256: digest")));
    }
    Ok(())
}

fn validate_target_ref(value: &str) -> io::Result<()> {
    if value.len() > 512
        || !(value.starts_with("world://") || value.starts_with("pack://"))
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(invalid_input(
            "target_ref must be a world:// or pack:// canonical reference",
        ));
    }
    Ok(())
}

fn source_ref(namespace: &str, kind: LegacyProjectionKind, source_id: &str) -> String {
    format!("{namespace}/{kind}/{source_id}")
}

fn effective_target_ref(transform: &LegacyImportTransform) -> Option<String> {
    transform.target_ref.clone().or_else(|| {
        transform.canonical_claim.as_ref().map(|claim| {
            format!(
                "world://cosyworld/official/claim/{}/{}",
                claim.kind, claim.key
            )
        })
    })
}

fn json_hash(value: &impl Serialize) -> io::Result<String> {
    let bytes = serde_json::to_vec(value).map_err(json_error)?;
    Ok(hash_bytes(&bytes, "sha256"))
}

fn hash_bytes(bytes: &[u8], prefix: &str) -> String {
    let digest = Sha256::digest(bytes);
    format!("{prefix}:{digest:x}")
}

struct StoredReceipt {
    receipt_id: String,
    source_hash: String,
    plan_hash: String,
    old_composition_hash: String,
    new_composition_hash: String,
    mapping_count: usize,
    projection_count: usize,
}

fn existing_receipt(
    tx: &Transaction<'_>,
    source_namespace: &str,
) -> io::Result<Option<StoredReceipt>> {
    tx.query_row(
        "SELECT receipt_id, source_hash, plan_hash, old_composition_hash,
                new_composition_hash, mapping_count, projection_count
         FROM canonical_legacy_import_receipts WHERE source_namespace = ?1",
        params![source_namespace],
        |row| {
            Ok(StoredReceipt {
                receipt_id: row.get(0)?,
                source_hash: row.get(1)?,
                plan_hash: row.get(2)?,
                old_composition_hash: row.get(3)?,
                new_composition_hash: row.get(4)?,
                mapping_count: row.get::<_, i64>(5)?.try_into().unwrap_or(usize::MAX),
                projection_count: row.get::<_, i64>(6)?.try_into().unwrap_or(usize::MAX),
            })
        },
    )
    .optional()
    .map_err(sqlite_error)
}

struct StoredMapping {
    source_ref: String,
    source_record_hash: String,
    strategy: String,
}

fn mappings_for_target(
    tx: &Transaction<'_>,
    world_id: &str,
    kind: LegacyProjectionKind,
    target_ref: &str,
) -> io::Result<Vec<StoredMapping>> {
    if target_ref.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = tx
        .prepare(
            "SELECT source_ref, source_record_hash, strategy
             FROM canonical_legacy_import_mappings
             WHERE world_id = ?1 AND source_kind = ?2 AND target_ref = ?3
               AND strategy NOT IN ('archive', 'discard')",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![world_id, kind.as_str(), target_ref], |row| {
            Ok(StoredMapping {
                source_ref: row.get(0)?,
                source_record_hash: row.get(1)?,
                strategy: row.get(2)?,
            })
        })
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn canonical_entity_exists(
    tx: &Transaction<'_>,
    world_id: &str,
    target_ref: &str,
) -> io::Result<bool> {
    tx.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM canonical_entity_versions
            WHERE world_id = ?1 AND entity_ref = ?2
        )",
        params![world_id, target_ref],
        |row| row.get(0),
    )
    .map_err(sqlite_error)
}

fn canonical_claim_exists(
    tx: &Transaction<'_>,
    world_id: &str,
    kind: &str,
    key: &str,
) -> io::Result<bool> {
    tx.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM canonical_claims
            WHERE world_id = ?1 AND claim_kind = ?2 AND claim_key = ?3
        )",
        params![world_id, kind, key],
        |row| row.get(0),
    )
    .map_err(sqlite_error)
}

fn conflict_report(
    normalized: &NormalizedImport,
    request: &LegacySaveImportRequest,
    conflicts: Vec<LegacyImportConflict>,
) -> LegacyImportReport {
    LegacyImportReport {
        status: LegacyImportStatus::Conflicted,
        receipt_id: normalized.receipt_id.clone(),
        source_namespace: normalized.namespace.clone(),
        source_hash: normalized.source_hash.clone(),
        plan_hash: normalized.plan_hash.clone(),
        old_composition_hash: request.composition_transform.old_hash.clone(),
        new_composition_hash: request.composition_transform.new_hash.clone(),
        mapping_count: 0,
        projection_count: 0,
        conflicts,
    }
}

fn persist_report(
    tx: &Transaction<'_>,
    report: &LegacyImportReport,
    created_at_ms: u64,
) -> io::Result<()> {
    let report_json = serde_json::to_string(report).map_err(json_error)?;
    let report_id = hash_bytes(report_json.as_bytes(), "legacy-report");
    tx.execute(
        "INSERT OR IGNORE INTO canonical_legacy_import_reports
            (report_id, source_namespace, source_hash, plan_hash,
             status, report_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            report_id,
            report.source_namespace,
            report.source_hash,
            report.plan_hash,
            match report.status {
                LegacyImportStatus::Applied => "applied",
                LegacyImportStatus::NoOp => "no_op",
                LegacyImportStatus::Conflicted => "conflicted",
            },
            report_json,
            as_i64(created_at_ms)?,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn as_i64(value: u64) -> io::Result<i64> {
    i64::try_from(value).map_err(|_| invalid_input("numeric value exceeds SQLite range"))
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

fn json_error(error: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}

fn invalid_input(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::TransactionBehavior;

    const WORLD: &str = "world://cosyworld/official";
    const OLD_HASH: &str =
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const NEW_HASH: &str =
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn review(id: &str) -> LegacyReviewedTransform {
        LegacyReviewedTransform {
            review_id: id.to_string(),
            reviewed_by: "operator.one".to_string(),
            transform_version: "v1".to_string(),
            rationale: "Reviewed deterministic fixture transform.".to_string(),
        }
    }

    fn request(save_id: &str, records: Vec<LegacySourceRecord>) -> LegacySaveImportRequest {
        let transforms = records
            .iter()
            .map(|record| LegacyImportTransform {
                kind: record.kind,
                source_id: record.source_id.clone(),
                strategy: if record.kind.is_eligible_projection() {
                    LegacyTransformStrategy::Project
                } else {
                    LegacyTransformStrategy::Archive
                },
                target_ref: Some(format!(
                    "world://cosyworld/official/{}/{}-{save_id}",
                    record.kind, record.source_id
                )),
                canonical_claim: None,
                reviewed_transform: (!record.kind.is_eligible_projection())
                    .then(|| review(&format!("review-{save_id}"))),
            })
            .collect();
        LegacySaveImportRequest {
            schema_version: 1,
            installation_id: "install-a".to_string(),
            legacy_shard_id: "shard-a".to_string(),
            save_id: save_id.to_string(),
            source: LegacySaveSource {
                schema_version: 1,
                composition_hash: OLD_HASH.to_string(),
                records,
            },
            composition_transform: LegacyCompositionTransform {
                old_hash: OLD_HASH.to_string(),
                new_hash: NEW_HASH.to_string(),
                reviewed_transform: review(&format!("composition-{save_id}")),
            },
            transforms,
        }
    }

    fn source(kind: LegacyProjectionKind, id: &str, value: Value) -> LegacySourceRecord {
        LegacySourceRecord {
            kind,
            source_id: id.to_string(),
            payload: value,
        }
    }

    fn store() -> Connection {
        let conn = Connection::open_in_memory().expect("legacy import fixture db");
        conn.execute_batch(
            "CREATE TABLE canonical_entity_versions (
                world_id TEXT NOT NULL,
                entity_ref TEXT NOT NULL,
                entity_version INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (world_id, entity_ref)
             );
             CREATE TABLE canonical_claims (
                world_id TEXT NOT NULL,
                claim_kind TEXT NOT NULL,
                claim_key TEXT NOT NULL,
                source_intent_id TEXT,
                source_world_seq INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                PRIMARY KEY (world_id, claim_kind, claim_key)
             );",
        )
        .expect("canonical fixture tables");
        init_legacy_import_store(&conn).expect("legacy import schema");
        conn
    }

    fn apply(conn: &mut Connection, request: &LegacySaveImportRequest) -> LegacyImportReport {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("import transaction");
        let report = apply_legacy_import_transaction(&tx, WORLD, 1, NEW_HASH, 9, request, 100)
            .expect("apply import");
        tx.commit().expect("commit import");
        report
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("table count")
    }

    #[test]
    fn repeated_import_is_an_exact_receipt_no_op() {
        let mut conn = store();
        let request = request(
            "save-1",
            vec![
                source(
                    LegacyProjectionKind::Account,
                    "7",
                    serde_json::json!({"account": "legacy-seven"}),
                ),
                source(
                    LegacyProjectionKind::AvatarHistory,
                    "7",
                    serde_json::json!({"visits": [1, 2, 3]}),
                ),
            ],
        );
        let first = apply(&mut conn, &request);
        let second = apply(&mut conn, &request);
        assert_eq!(first.status, LegacyImportStatus::Applied);
        assert_eq!(second.status, LegacyImportStatus::NoOp);
        assert_eq!(first.receipt_id, second.receipt_id);
        assert_eq!(count(&conn, "canonical_legacy_import_receipts"), 1);
        assert_eq!(count(&conn, "canonical_legacy_import_mappings"), 2);
        assert_eq!(count(&conn, "canonical_legacy_import_projections"), 2);
    }

    #[test]
    fn colliding_numeric_ids_from_two_saves_stay_namespaced() {
        let mut conn = store();
        let west = request(
            "west-save",
            vec![source(
                LegacyProjectionKind::Item,
                "42",
                serde_json::json!({"name": "west lantern"}),
            )],
        );
        let east = request(
            "east-save",
            vec![source(
                LegacyProjectionKind::Item,
                "42",
                serde_json::json!({"name": "east lantern"}),
            )],
        );
        assert_eq!(apply(&mut conn, &west).status, LegacyImportStatus::Applied);
        assert_eq!(apply(&mut conn, &east).status, LegacyImportStatus::Applied);
        let mut stmt = conn
            .prepare("SELECT source_ref FROM canonical_legacy_import_mappings ORDER BY source_ref")
            .unwrap();
        let refs = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(refs.len(), 2);
        assert!(refs[0].contains("east-save/item/42"));
        assert!(refs[1].contains("west-save/item/42"));
    }

    #[test]
    fn divergent_item_histories_conflict_without_partial_projection() {
        let mut conn = store();
        let target = "world://cosyworld/official/item/shared-lantern";
        conn.execute(
            "INSERT INTO canonical_entity_versions
                (world_id, entity_ref, entity_version, updated_at_ms)
             VALUES (?1, ?2, 3, 1)",
            params![WORLD, target],
        )
        .unwrap();

        let west: LegacySaveImportRequest =
            serde_json::from_str(include_str!("../fixtures/legacy-import/west-save.json"))
                .expect("west legacy save fixture");
        assert_eq!(apply(&mut conn, &west).status, LegacyImportStatus::Applied);

        let east: LegacySaveImportRequest =
            serde_json::from_str(include_str!("../fixtures/legacy-import/east-save.json"))
                .expect("east legacy save fixture");
        let before_projections = count(&conn, "canonical_legacy_import_projections");
        let before_mappings = count(&conn, "canonical_legacy_import_mappings");
        let report = apply(&mut conn, &east);
        assert_eq!(report.status, LegacyImportStatus::Conflicted);
        assert!(report
            .conflicts
            .iter()
            .any(|conflict| conflict.code == "divergent_target_history"));
        assert_eq!(count(&conn, "canonical_legacy_import_receipts"), 1);
        assert_eq!(
            count(&conn, "canonical_legacy_import_projections"),
            before_projections
        );
        assert_eq!(
            count(&conn, "canonical_legacy_import_mappings"),
            before_mappings
        );
        assert_eq!(count(&conn, "canonical_legacy_import_reports"), 1);
    }

    #[test]
    fn composition_mismatch_reports_without_partial_canonical_mutation() {
        let mut conn = store();
        let mut import = request(
            "wrong-composition",
            vec![source(
                LegacyProjectionKind::Account,
                "5000",
                serde_json::json!({"account": "legacy-five-thousand"}),
            )],
        );
        import.composition_transform.new_hash =
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc".to_string();

        let report = apply(&mut conn, &import);
        assert_eq!(report.status, LegacyImportStatus::Conflicted);
        assert!(report
            .conflicts
            .iter()
            .any(|conflict| conflict.code == "composition_target_mismatch"));
        assert_eq!(count(&conn, "canonical_legacy_import_receipts"), 0);
        assert_eq!(count(&conn, "canonical_legacy_import_mappings"), 0);
        assert_eq!(count(&conn, "canonical_legacy_import_projections"), 0);
        assert_eq!(count(&conn, "canonical_legacy_composition_migrations"), 0);
        assert_eq!(count(&conn, "canonical_legacy_import_reports"), 1);
    }

    #[test]
    fn consumed_claim_cannot_be_replayed_by_another_save() {
        let mut conn = store();
        let mut first = request(
            "claim-one",
            vec![source(
                LegacyProjectionKind::Claim,
                "reward-9",
                serde_json::json!({"claimed": true}),
            )],
        );
        first.transforms[0].strategy = LegacyTransformStrategy::MarkConsumed;
        first.transforms[0].target_ref = None;
        first.transforms[0].canonical_claim = Some(LegacyCanonicalClaim {
            kind: "orb_reward".to_string(),
            key: "legacy-reward-9".to_string(),
        });
        assert_eq!(apply(&mut conn, &first).status, LegacyImportStatus::Applied);

        let mut second = request(
            "claim-two",
            vec![source(
                LegacyProjectionKind::Claim,
                "reward-9",
                serde_json::json!({"claimed": true, "divergent": true}),
            )],
        );
        second.transforms[0].strategy = LegacyTransformStrategy::MarkConsumed;
        second.transforms[0].target_ref = None;
        second.transforms[0].canonical_claim = Some(LegacyCanonicalClaim {
            kind: "orb_reward".to_string(),
            key: "legacy-reward-9".to_string(),
        });
        let report = apply(&mut conn, &second);
        assert_eq!(report.status, LegacyImportStatus::Conflicted);
        assert_eq!(count(&conn, "canonical_claims"), 1);
        assert_eq!(count(&conn, "canonical_legacy_import_receipts"), 1);
    }
}
