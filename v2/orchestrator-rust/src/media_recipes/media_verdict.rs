use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    moderation_authorized, request_community_art_candidate_replacement,
    request_room_scene_candidate_replacement, AppState, DownloadedReplicateImage,
};

const MEDIA_VERDICT_SCHEMA_VERSION: u8 = 1;
const MEDIA_CHECKER_VERSION: &str = "cosyworld.media-deterministic/1";
const MEDIA_OPERATOR_REVIEWER_VERSION: &str = "cosyworld.media-operator/1";
const MEDIA_VERDICT_DIR: &str = "media-verdicts/v1";
/// Maximum length, in bytes, of any single frozen-brief constraint. Producers
/// must bound each constraint they build to this budget; `validate` rejects the
/// whole brief otherwise.
pub(crate) const MEDIA_BRIEF_CONSTRAINT_LIMIT: usize = 240;
/// Maximum persisted UTF-8 byte length for a visual-review summary. The
/// provider response parser and durable verdict builder both normalize through
/// `bounded_visual_verdict_summary`, so multi-byte punctuation cannot pass one
/// boundary and fail the next.
pub(crate) const MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT: usize = 240;
const MAX_CANDIDATES_PER_JOB: usize = 4;
const MAX_REVIEW_FAILURES: u8 = 3;
const PROVIDER_COOLDOWN_FAILURES: u8 = 3;
const PROVIDER_COOLDOWN_MS: u64 = 5 * 60 * 1000;

static MEDIA_VERDICT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Bound every producer-authored constraint to the byte budget enforced by
/// `FrozenMediaBrief::validate`. `bounded_component` cuts only at UTF-8
/// boundaries; constraints with no content after trimming are omitted.
pub(crate) fn bounded_brief_constraints(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| crate::bounded_component(&value))
        .filter(|value| !value.trim().is_empty())
        .collect()
}

pub(crate) fn bounded_visual_verdict_summary(value: &str) -> String {
    bounded_text(value, MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct FrozenMediaBrief {
    pub(crate) schema_version: u8,
    pub(crate) job_key: String,
    pub(crate) recipe: String,
    pub(crate) intended_use: String,
    pub(crate) prompt_digest: String,
    pub(crate) expected_content_types: Vec<String>,
    pub(crate) expected_aspect_ratio: String,
    pub(crate) min_width: u32,
    pub(crate) min_height: u32,
    pub(crate) max_width: u32,
    pub(crate) max_height: u32,
    pub(crate) required_subjects: Vec<String>,
    pub(crate) required_environment: Vec<String>,
    pub(crate) required_item_holder: Option<String>,
    pub(crate) crop: String,
    pub(crate) safe_areas: Vec<String>,
    pub(crate) forbidden: Vec<String>,
    pub(crate) pack_negative_constraints: Vec<String>,
    pub(crate) approved_reference_digests: Vec<String>,
}

impl FrozenMediaBrief {
    pub(crate) fn new(
        job_key: impl Into<String>,
        recipe: impl Into<String>,
        intended_use: impl Into<String>,
        prompt: &str,
        expected_aspect_ratio: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: MEDIA_VERDICT_SCHEMA_VERSION,
            job_key: job_key.into(),
            recipe: recipe.into(),
            intended_use: intended_use.into(),
            prompt_digest: sha256_hex(prompt.as_bytes()),
            expected_content_types: vec![
                "image/png".to_string(),
                "image/jpeg".to_string(),
                "image/webp".to_string(),
            ],
            expected_aspect_ratio: expected_aspect_ratio.into(),
            min_width: 1,
            min_height: 1,
            max_width: 8192,
            max_height: 8192,
            required_subjects: Vec::new(),
            required_environment: Vec::new(),
            required_item_holder: None,
            crop: "full_frame".to_string(),
            safe_areas: Vec::new(),
            forbidden: universal_forbidden_constraints(),
            pack_negative_constraints: Vec::new(),
            approved_reference_digests: Vec::new(),
        }
    }

    pub(crate) fn digest(&self) -> Result<String, String> {
        serde_json::to_vec(self)
            .map(|bytes| sha256_hex(&bytes))
            .map_err(|error| error.to_string())
    }

    /// Callers must run this before spending on a provider: every downstream
    /// gate re-validates, so an invalid brief can only ever discard work that
    /// has already been paid for.
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.schema_version != MEDIA_VERDICT_SCHEMA_VERSION
            || self.job_key.trim().is_empty()
            || self.job_key.len() > 240
            || self.recipe.trim().is_empty()
            || self.intended_use.trim().is_empty()
            || self.prompt_digest.len() != 64
            || self.expected_content_types.is_empty()
            || self.expected_content_types.len() > 4
            || self.min_width == 0
            || self.min_height == 0
            || self.max_width < self.min_width
            || self.max_height < self.min_height
        {
            return Err("generated-image frozen brief is invalid".to_string());
        }
        parse_aspect_ratio(&self.expected_aspect_ratio)?;
        for value in self
            .required_subjects
            .iter()
            .chain(&self.required_environment)
            .chain(self.required_item_holder.iter())
            .chain(&self.safe_areas)
            .chain(&self.forbidden)
            .chain(&self.pack_negative_constraints)
        {
            if value.trim().is_empty() || value.len() > MEDIA_BRIEF_CONSTRAINT_LIMIT {
                return Err("generated-image frozen brief has an invalid constraint".to_string());
            }
        }
        if self
            .approved_reference_digests
            .iter()
            .any(|digest| !valid_digest(digest))
        {
            return Err("generated-image frozen brief has an invalid reference digest".to_string());
        }
        Ok(())
    }

    pub(crate) fn review_policy(&self) -> String {
        format!(
            "Frozen brief digest {}. Intended use: {}. Required subjects: [{}]. Required environment: [{}]. Required item/holder: {}. Crop: {}. Safe areas: [{}]. Forbidden: [{}]. Pack negatives: [{}]. References, in frozen order: [{}].",
            self.digest().unwrap_or_else(|_| "invalid".to_string()),
            self.intended_use,
            self.required_subjects.join("; "),
            self.required_environment.join("; "),
            self.required_item_holder.as_deref().unwrap_or("none"),
            self.crop,
            self.safe_areas.join("; "),
            self.forbidden.join("; "),
            self.pack_negative_constraints.join("; "),
            self.approved_reference_digests.join(", "),
        )
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MediaVerdictDisposition {
    ReviewPending,
    Approved,
    Rejected,
    ReplaceRequested,
    Disabled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MediaViolation {
    Corrupt,
    Blank,
    Format,
    Dimensions,
    AspectRatio,
    Digest,
    Safety,
    Text,
    Logo,
    Watermark,
    SystemLeak,
    UiChrome,
    MissingSubject,
    ExtraSubject,
    IdentityDrift,
    MissingItem,
    WrongHolder,
    WrongEnvironment,
    BadCrop,
    NearDuplicate,
    PackNegative,
    OperatorRejected,
}

impl MediaViolation {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Corrupt => "corrupt",
            Self::Blank => "blank",
            Self::Format => "format",
            Self::Dimensions => "dimensions",
            Self::AspectRatio => "aspect_ratio",
            Self::Digest => "digest",
            Self::Safety => "safety",
            Self::Text => "text",
            Self::Logo => "logo",
            Self::Watermark => "watermark",
            Self::SystemLeak => "system_leak",
            Self::UiChrome => "ui_chrome",
            Self::MissingSubject => "missing_subject",
            Self::ExtraSubject => "extra_subject",
            Self::IdentityDrift => "identity_drift",
            Self::MissingItem => "missing_item",
            Self::WrongHolder => "wrong_holder",
            Self::WrongEnvironment => "wrong_environment",
            Self::BadCrop => "bad_crop",
            Self::NearDuplicate => "near_duplicate",
            Self::PackNegative => "pack_negative",
            Self::OperatorRejected => "operator_rejected",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct MediaVisualVerdict {
    pub(crate) schema_version: u8,
    pub(crate) brief_digest: String,
    pub(crate) candidate_digest: String,
    pub(crate) reviewer: String,
    pub(crate) reviewer_version: String,
    pub(crate) approved: bool,
    pub(crate) violations: Vec<MediaViolation>,
    pub(crate) summary: String,
    pub(crate) reference_digests: Vec<String>,
    pub(crate) attempts: u8,
    pub(crate) latency_ms: u64,
    pub(crate) cost_microusd: u64,
    pub(crate) reviewed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct DeterministicMediaVerdict {
    checker_version: String,
    checked_at_ms: u64,
    digest: String,
    width: Option<u32>,
    height: Option<u32>,
    perceptual_hash: Option<u64>,
    violations: Vec<MediaViolation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaCandidateProvenance {
    digest: String,
    content_type: String,
    source_url: String,
    prediction_id: Option<String>,
    provider: String,
    model: String,
    recipe: String,
    received_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaCandidateVerdict {
    provenance: MediaCandidateProvenance,
    deterministic: DeterministicMediaVerdict,
    visual: Option<MediaVisualVerdict>,
    disposition: MediaVerdictDisposition,
    review_failures: u8,
    last_review_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PersistedMediaVerdict {
    schema_version: u8,
    pub(crate) record_id: String,
    pub(crate) brief: FrozenMediaBrief,
    pub(crate) brief_digest: String,
    active_candidate_digest: Option<String>,
    candidates: Vec<MediaCandidateVerdict>,
    provider_failures: u8,
    provider_cooldown_until_ms: Option<u64>,
    provider_route: String,
    disabled: bool,
    updated_at_ms: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct MediaCandidateInput<'a> {
    pub(crate) image: &'a DownloadedReplicateImage,
    pub(crate) provider: &'a str,
    pub(crate) model: &'a str,
    pub(crate) claimed_digest: Option<&'a str>,
    pub(crate) prior_public_bytes: Option<&'a [u8]>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct MediaVerdictSlice {
    dimension: String,
    value: String,
    candidates: u64,
    approved: u64,
    rejected: u64,
    pending: u64,
    review_retries: u64,
    latency_ms: u64,
    cost_microusd: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct MediaVerdictDashboard {
    records: u64,
    candidates: u64,
    approved: u64,
    rejected: u64,
    pending: u64,
    pass_rate_basis_points: u64,
    cost_per_approved_microusd: u64,
    review_latency_ms: u64,
    retry_spend_microusd: u64,
    review_retries: u64,
    provider_failures: u64,
    cooldown_routes: u64,
    slices: Vec<MediaVerdictSlice>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MediaVerdictActionRequest {
    candidate_digest: String,
    action: MediaVerdictAction,
    reason: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum MediaVerdictAction {
    Approve,
    Reject,
    Replace,
    Disable,
}

pub(crate) fn prepare_media_candidate(
    root: &Path,
    brief: FrozenMediaBrief,
    input: MediaCandidateInput<'_>,
) -> Result<MediaVerdictDisposition, String> {
    brief.validate()?;
    let brief_digest = brief.digest()?;
    let digest = sha256_hex(&input.image.bytes);
    let _guard = media_verdict_lock()?;
    let mut record = load_or_create_record(root, brief, &brief_digest)?;
    if record.disabled {
        return Ok(MediaVerdictDisposition::Disabled);
    }
    if let Some(candidate) = record
        .candidates
        .iter()
        .find(|candidate| candidate.provenance.digest == digest)
    {
        return Ok(candidate.disposition);
    }
    let deterministic = deterministic_verdict(&record.brief, &digest, &input)?;
    store_candidate_object(root, &record.record_id, &digest, input.image)?;
    let disposition = if deterministic.violations.is_empty() {
        MediaVerdictDisposition::ReviewPending
    } else {
        MediaVerdictDisposition::Rejected
    };
    record.active_candidate_digest = Some(digest.clone());
    record.provider_failures = 0;
    record.provider_cooldown_until_ms = None;
    record.candidates.push(MediaCandidateVerdict {
        provenance: MediaCandidateProvenance {
            digest,
            content_type: input.image.content_type.to_ascii_lowercase(),
            source_url: input.image.source_url.clone(),
            prediction_id: input.image.prediction_id.clone(),
            provider: input.provider.to_string(),
            model: input.model.to_string(),
            recipe: record.brief.recipe.clone(),
            received_at_ms: crate::now_millis(),
        },
        deterministic,
        visual: None,
        disposition,
        review_failures: 0,
        last_review_error: None,
    });
    if record.candidates.len() > MAX_CANDIDATES_PER_JOB {
        record.candidates.remove(0);
    }
    store_record(root, &record)?;
    Ok(disposition)
}

/// Proves that the exact verdict identity for a frozen brief is compatible
/// with any existing record and that both record and candidate directories can
/// complete the atomic-write lifecycle used after a paid provider response.
/// The probe leaves no verdict record or candidate behind.
pub(crate) fn preflight_media_verdict_storage(
    root: &Path,
    brief: &FrozenMediaBrief,
) -> Result<(), String> {
    brief.validate()?;
    let brief_digest = brief.digest()?;
    let _guard = media_verdict_lock()?;
    let record = load_or_create_record(root, brief.clone(), &brief_digest)?;
    preflight_atomic_write_directory(&record_dir(root, &record.record_id), "record")?;
    preflight_atomic_write_directory(
        &record_dir(root, &record.record_id).join("candidates"),
        "candidate",
    )
}

/// Retires an immutable review record when a legacy retry must adopt a newly
/// frozen brief. Approved or still-pending work remains fail-closed: only an
/// explicitly rejected active candidate or a candidate-free provider-failure
/// record may move to the new brief.
///
/// The retired record is preserved beside the live record for audit. Returning
/// `true` tells the community-art pipeline to remove its staged candidate before
/// spending another capped provider attempt.
pub(crate) fn prepare_rejected_media_candidate_replacement(
    root: &Path,
    brief: FrozenMediaBrief,
) -> Result<bool, String> {
    brief.validate()?;
    let brief_digest = brief.digest()?;
    let _guard = media_verdict_lock()?;
    let record = match load_record_by_job(root, &brief.job_key) {
        Ok(record) => record,
        Err(error) if error.contains("not found") => return Ok(false),
        Err(error) => return Err(error),
    };
    let active_rejected = record
        .active_candidate_digest
        .as_deref()
        .and_then(|digest| {
            record
                .candidates
                .iter()
                .find(|candidate| candidate.provenance.digest == digest)
        })
        .is_some_and(|candidate| {
            matches!(
                candidate.disposition,
                MediaVerdictDisposition::Rejected | MediaVerdictDisposition::ReplaceRequested
            )
        });
    let candidate_free_provider_failure =
        record.candidates.is_empty() && record.provider_failures > 0;
    if record.disabled {
        return Ok(false);
    }
    if record.brief_digest == brief_digest && record.brief == brief {
        return Ok(active_rejected);
    }
    if record.candidates.iter().any(|candidate| {
        matches!(
            candidate.disposition,
            MediaVerdictDisposition::Approved | MediaVerdictDisposition::ReviewPending
        )
    }) {
        return Err("generated-image frozen brief changed for an existing job".to_string());
    }
    if !active_rejected && !candidate_free_provider_failure {
        return Ok(false);
    }
    retire_record(root, &record)?;
    store_record(root, &new_record(brief, &brief_digest))?;
    Ok(true)
}

pub(crate) fn record_media_visual_verdict(
    root: &Path,
    job_key: &str,
    verdict: MediaVisualVerdict,
) -> Result<MediaVerdictDisposition, String> {
    let _guard = media_verdict_lock()?;
    let mut record = load_record_by_job(root, job_key)?;
    validate_visual_verdict(&record, &verdict)?;
    let candidate = find_candidate_mut(&mut record, &verdict.candidate_digest)?;
    candidate.disposition = if verdict.approved {
        MediaVerdictDisposition::Approved
    } else {
        MediaVerdictDisposition::Rejected
    };
    candidate.visual = Some(verdict);
    candidate.last_review_error = None;
    let disposition = candidate.disposition;
    store_record(root, &record)?;
    Ok(disposition)
}

pub(crate) fn record_media_review_unavailable(
    root: &Path,
    job_key: &str,
    candidate_digest: &str,
    error: &str,
) -> Result<(), String> {
    let _guard = media_verdict_lock()?;
    let mut record = load_record_by_job(root, job_key)?;
    let candidate = find_candidate_mut(&mut record, candidate_digest)?;
    if candidate.disposition == MediaVerdictDisposition::ReviewPending {
        candidate.review_failures = candidate
            .review_failures
            .saturating_add(1)
            .min(MAX_REVIEW_FAILURES);
        candidate.last_review_error = Some(bounded_text(error, 240));
    }
    store_record(root, &record)
}

pub(crate) fn media_candidate_digest(root: &Path, job_key: &str) -> Result<Option<String>, String> {
    Ok(load_record_by_job(root, job_key)?.active_candidate_digest)
}

pub(crate) fn media_candidate_approved(
    root: &Path,
    job_key: &str,
    candidate_digest: &str,
) -> Result<bool, String> {
    let record = load_record_by_job(root, job_key)?;
    Ok(record.candidates.iter().any(|candidate| {
        candidate.provenance.digest == candidate_digest
            && candidate.disposition == MediaVerdictDisposition::Approved
            && candidate.visual.is_some()
            && candidate.deterministic.violations.is_empty()
    }))
}

pub(crate) fn media_candidate_violations(
    root: &Path,
    job_key: &str,
    candidate_digest: &str,
) -> Result<Vec<String>, String> {
    let record = load_record_by_job(root, job_key)?;
    let candidate = record
        .candidates
        .iter()
        .find(|candidate| candidate.provenance.digest == candidate_digest)
        .ok_or_else(|| "media verdict candidate was not found".to_string())?;
    Ok(candidate
        .deterministic
        .violations
        .iter()
        .chain(
            candidate
                .visual
                .iter()
                .flat_map(|verdict| &verdict.violations),
        )
        .map(|violation| violation.code().to_string())
        .collect())
}

pub(crate) fn record_media_provider_failure(
    root: &Path,
    brief: FrozenMediaBrief,
    route: &str,
) -> Result<(), String> {
    brief.validate()?;
    let digest = brief.digest()?;
    let _guard = media_verdict_lock()?;
    let mut record = load_or_create_record(root, brief, &digest)?;
    record.provider_route = bounded_text(route, 120);
    record.provider_failures = record.provider_failures.saturating_add(1);
    if record.provider_failures >= PROVIDER_COOLDOWN_FAILURES {
        record.provider_cooldown_until_ms =
            Some(crate::now_millis().saturating_add(PROVIDER_COOLDOWN_MS));
    }
    store_record(root, &record)
}

pub(crate) fn media_provider_route_available(root: &Path, job_key: &str) -> Result<bool, String> {
    match load_record_by_job(root, job_key) {
        Ok(record) => Ok(!record.disabled
            && record
                .provider_cooldown_until_ms
                .is_none_or(|until| until <= crate::now_millis())),
        Err(error) if error.contains("not found") => Ok(true),
        Err(error) => Err(error),
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn make_visual_verdict(
    brief: &FrozenMediaBrief,
    candidate_digest: String,
    reviewer: impl Into<String>,
    reviewer_version: impl Into<String>,
    approved: bool,
    violations: Vec<MediaViolation>,
    summary: impl Into<String>,
    attempts: u8,
    latency_ms: u64,
    cost_microusd: u64,
) -> Result<MediaVisualVerdict, String> {
    Ok(MediaVisualVerdict {
        schema_version: MEDIA_VERDICT_SCHEMA_VERSION,
        brief_digest: brief.digest()?,
        candidate_digest,
        reviewer: reviewer.into(),
        reviewer_version: reviewer_version.into(),
        approved,
        violations,
        summary: bounded_visual_verdict_summary(&summary.into()),
        reference_digests: brief.approved_reference_digests.clone(),
        attempts,
        latency_ms,
        cost_microusd,
        reviewed_at_ms: crate::now_millis(),
    })
}

pub(crate) fn media_verdict_dashboard(root: &Path) -> Result<MediaVerdictDashboard, String> {
    let records = list_records(root)?;
    let mut dashboard = MediaVerdictDashboard {
        records: records.len() as u64,
        ..MediaVerdictDashboard::default()
    };
    let mut slices = BTreeMap::<(String, String), MediaVerdictSlice>::new();
    for record in records {
        dashboard.provider_failures += u64::from(record.provider_failures);
        dashboard.cooldown_routes += u64::from(
            record
                .provider_cooldown_until_ms
                .is_some_and(|until| until > crate::now_millis()),
        );
        for candidate in record.candidates {
            dashboard.candidates += 1;
            dashboard.review_retries += u64::from(candidate.review_failures);
            tally_outcome(
                candidate.disposition,
                &mut dashboard.approved,
                &mut dashboard.rejected,
                &mut dashboard.pending,
            );
            let reviewer = candidate
                .visual
                .as_ref()
                .map(|verdict| verdict.reviewer.as_str())
                .unwrap_or("pending");
            for (dimension, value) in [
                ("provider", candidate.provenance.provider.as_str()),
                ("model", candidate.provenance.model.as_str()),
                ("recipe", candidate.provenance.recipe.as_str()),
                ("profile", record.brief.recipe.as_str()),
                ("intended_use", record.brief.intended_use.as_str()),
                ("reviewer", reviewer),
                ("outcome", disposition_name(candidate.disposition)),
            ] {
                let slice = slices
                    .entry((dimension.to_string(), value.to_string()))
                    .or_insert_with(|| MediaVerdictSlice {
                        dimension: dimension.to_string(),
                        value: value.to_string(),
                        candidates: 0,
                        approved: 0,
                        rejected: 0,
                        pending: 0,
                        review_retries: 0,
                        latency_ms: 0,
                        cost_microusd: 0,
                    });
                slice.candidates += 1;
                slice.review_retries += u64::from(candidate.review_failures);
                tally_outcome(
                    candidate.disposition,
                    &mut slice.approved,
                    &mut slice.rejected,
                    &mut slice.pending,
                );
                if let Some(verdict) = &candidate.visual {
                    slice.latency_ms += verdict.latency_ms;
                    slice.cost_microusd += verdict.cost_microusd;
                }
            }
            for violation in candidate.deterministic.violations.iter().chain(
                candidate
                    .visual
                    .iter()
                    .flat_map(|verdict| &verdict.violations),
            ) {
                let key = ("violation".to_string(), violation.code().to_string());
                let slice = slices
                    .entry(key.clone())
                    .or_insert_with(|| MediaVerdictSlice {
                        dimension: key.0,
                        value: key.1,
                        candidates: 0,
                        approved: 0,
                        rejected: 0,
                        pending: 0,
                        review_retries: 0,
                        latency_ms: 0,
                        cost_microusd: 0,
                    });
                slice.candidates += 1;
                tally_outcome(
                    candidate.disposition,
                    &mut slice.approved,
                    &mut slice.rejected,
                    &mut slice.pending,
                );
            }
            if let Some(verdict) = &candidate.visual {
                dashboard.review_latency_ms += verdict.latency_ms;
                dashboard.cost_per_approved_microusd += verdict.cost_microusd;
                dashboard.retry_spend_microusd += verdict
                    .cost_microusd
                    .saturating_mul(u64::from(verdict.attempts.saturating_sub(1)))
                    / u64::from(verdict.attempts);
            }
        }
    }
    dashboard.pass_rate_basis_points = dashboard
        .approved
        .saturating_mul(10_000)
        .checked_div(dashboard.candidates)
        .unwrap_or(0);
    dashboard.cost_per_approved_microusd = dashboard
        .cost_per_approved_microusd
        .checked_div(dashboard.approved)
        .unwrap_or(0);
    dashboard.slices = slices.into_values().collect();
    Ok(dashboard)
}

pub(crate) async fn moderation_media_verdicts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if !moderation_authorized(&state, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match media_verdict_dashboard(&state.generated_asset_dir) {
        Ok(dashboard) => Json(dashboard).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    }
}

pub(crate) async fn moderation_media_verdict(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(record_id): AxumPath<String>,
) -> Response {
    if !moderation_authorized(&state, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match load_record(&state.generated_asset_dir, &record_id) {
        Ok(record) => Json(record).into_response(),
        Err(error) => (StatusCode::NOT_FOUND, error).into_response(),
    }
}

pub(crate) async fn moderation_update_media_verdict(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(record_id): AxumPath<String>,
    Json(action): Json<MediaVerdictActionRequest>,
) -> Response {
    if !moderation_authorized(&state, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let replace = action.action == MediaVerdictAction::Replace;
    let reason = action.reason.clone();
    match apply_operator_action(&state.generated_asset_dir, &record_id, action) {
        Ok(record) => {
            if replace
                && request_room_scene_candidate_replacement(
                    &state.generated_asset_dir,
                    &record.brief.job_key,
                    &reason,
                )
                .and_then(|room_scene| {
                    if room_scene {
                        Ok(true)
                    } else {
                        request_community_art_candidate_replacement(
                            &state.generated_asset_dir,
                            &record.brief.job_key,
                        )
                    }
                })
                .is_err()
            {
                return (
                    StatusCode::CONFLICT,
                    "replacement could not reset the private candidate",
                )
                    .into_response();
            }
            Json(record).into_response()
        }
        Err(error) => (StatusCode::CONFLICT, error).into_response(),
    }
}

fn apply_operator_action(
    root: &Path,
    record_id: &str,
    action: MediaVerdictActionRequest,
) -> Result<PersistedMediaVerdict, String> {
    // Operator approval records a verdict only. The owning job must retry and
    // atomically publish after `media_candidate_approved`; this endpoint never
    // mutates the public asset graph.
    let _guard = media_verdict_lock()?;
    let mut record = load_record(root, record_id)?;
    let brief = record.brief.clone();
    if matches!(action.action, MediaVerdictAction::Disable) {
        record.disabled = true;
    }
    let candidate = find_candidate_mut(&mut record, &action.candidate_digest)?;
    match action.action {
        MediaVerdictAction::Approve | MediaVerdictAction::Reject => {
            if !candidate.deterministic.violations.is_empty() {
                return Err("operator cannot override deterministic image failures".to_string());
            }
            let approved = matches!(action.action, MediaVerdictAction::Approve);
            let verdict = make_visual_verdict(
                &brief,
                action.candidate_digest,
                "operator",
                MEDIA_OPERATOR_REVIEWER_VERSION,
                approved,
                (!approved)
                    .then_some(MediaViolation::OperatorRejected)
                    .into_iter()
                    .collect(),
                action.reason,
                1,
                0,
                0,
            )?;
            candidate.visual = Some(verdict);
            candidate.disposition = if approved {
                MediaVerdictDisposition::Approved
            } else {
                MediaVerdictDisposition::Rejected
            };
        }
        MediaVerdictAction::Replace => {
            candidate.disposition = MediaVerdictDisposition::ReplaceRequested;
            candidate.last_review_error = Some(bounded_text(&action.reason, 240));
        }
        MediaVerdictAction::Disable => {
            candidate.disposition = MediaVerdictDisposition::Disabled;
        }
    }
    store_record(root, &record)?;
    Ok(record)
}

fn deterministic_verdict(
    brief: &FrozenMediaBrief,
    digest: &str,
    input: &MediaCandidateInput<'_>,
) -> Result<DeterministicMediaVerdict, String> {
    let content_type = input.image.content_type.trim().to_ascii_lowercase();
    let mut violations = Vec::new();
    if input
        .claimed_digest
        .is_some_and(|claimed| claimed != digest)
    {
        violations.push(MediaViolation::Digest);
    }
    let expected_format = format_for_mime(&content_type);
    if !brief.expected_content_types.contains(&content_type) || expected_format.is_none() {
        violations.push(MediaViolation::Format);
    }
    if expected_format.is_some()
        && image::guess_format(&input.image.bytes)
            .ok()
            .is_some_and(|actual| Some(actual) != expected_format)
    {
        violations.push(MediaViolation::Format);
    }
    let decoded = expected_format
        .and_then(|format| image::load_from_memory_with_format(&input.image.bytes, format).ok());
    let (width, height, perceptual_hash) = match decoded.as_ref() {
        Some(image) => {
            let (width, height) = (image.width(), image.height());
            if width < brief.min_width
                || height < brief.min_height
                || width > brief.max_width
                || height > brief.max_height
            {
                violations.push(MediaViolation::Dimensions);
            }
            let (aspect_width, aspect_height) = parse_aspect_ratio(&brief.expected_aspect_ratio)?;
            let expected = f64::from(aspect_width) / f64::from(aspect_height);
            let actual = f64::from(width) / f64::from(height);
            if ((actual - expected) / expected).abs() > 0.03 {
                violations.push(MediaViolation::AspectRatio);
            }
            if image_is_blank(image) {
                violations.push(MediaViolation::Blank);
            }
            (Some(width), Some(height), Some(perceptual_hash64(image)))
        }
        None => {
            violations.push(MediaViolation::Corrupt);
            (None, None, None)
        }
    };
    if let (Some(prior), Some(candidate_hash)) = (input.prior_public_bytes, perceptual_hash) {
        if let Ok(prior_image) = image::load_from_memory(prior) {
            if (candidate_hash ^ perceptual_hash64(&prior_image)).count_ones() <= 2 {
                violations.push(MediaViolation::NearDuplicate);
            }
        }
    }
    violations.sort();
    violations.dedup();
    Ok(DeterministicMediaVerdict {
        checker_version: MEDIA_CHECKER_VERSION.to_string(),
        checked_at_ms: crate::now_millis(),
        digest: digest.to_string(),
        width,
        height,
        perceptual_hash,
        violations,
    })
}

fn validate_visual_verdict(
    record: &PersistedMediaVerdict,
    verdict: &MediaVisualVerdict,
) -> Result<(), String> {
    if verdict.schema_version != MEDIA_VERDICT_SCHEMA_VERSION {
        return Err("visual reviewer verdict has an unsupported schema version".to_string());
    }
    if verdict.brief_digest != record.brief_digest {
        return Err(
            "visual reviewer verdict brief digest does not match the frozen brief".to_string(),
        );
    }
    if verdict.reviewer.trim().is_empty() {
        return Err("visual reviewer verdict reviewer is empty".to_string());
    }
    if verdict.reviewer.len() > 120 {
        return Err("visual reviewer verdict reviewer exceeds 120 UTF-8 bytes".to_string());
    }
    if verdict.reviewer_version.trim().is_empty() {
        return Err("visual reviewer verdict reviewer version is empty".to_string());
    }
    if verdict.reviewer_version.len() > 120 {
        return Err("visual reviewer verdict reviewer version exceeds 120 UTF-8 bytes".to_string());
    }
    if verdict.summary.trim().is_empty() {
        return Err("visual reviewer verdict summary is empty".to_string());
    }
    if verdict.summary.len() > MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT {
        return Err(format!(
            "visual reviewer verdict summary exceeds {MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT} UTF-8 bytes"
        ));
    }
    if verdict.attempts == 0 || verdict.attempts > MAX_REVIEW_FAILURES {
        return Err(format!(
            "visual reviewer verdict attempts must be between 1 and {MAX_REVIEW_FAILURES}"
        ));
    }
    if verdict.approved != verdict.violations.is_empty() {
        return Err("visual reviewer verdict approval contradicts its violation list".to_string());
    }
    if verdict.reference_digests != record.brief.approved_reference_digests {
        return Err(
            "visual reviewer verdict reference digests do not match the frozen brief".to_string(),
        );
    }
    if !record
        .candidates
        .iter()
        .any(|candidate| candidate.provenance.digest == verdict.candidate_digest)
    {
        return Err("visual reviewer verdict names an unknown candidate".to_string());
    }
    Ok(())
}

fn image_is_blank(image: &DynamicImage) -> bool {
    let rgba = image.thumbnail_exact(32, 32).to_rgba8();
    let mut minimum = [u8::MAX; 4];
    let mut maximum = [u8::MIN; 4];
    for pixel in rgba.pixels() {
        for channel in 0..4 {
            minimum[channel] = minimum[channel].min(pixel[channel]);
            maximum[channel] = maximum[channel].max(pixel[channel]);
        }
    }
    (0..3).all(|channel| maximum[channel].saturating_sub(minimum[channel]) <= 2)
}

fn perceptual_hash64(image: &DynamicImage) -> u64 {
    let gray = image.thumbnail_exact(8, 8).to_luma8();
    let average =
        gray.pixels().map(|pixel| u64::from(pixel[0])).sum::<u64>() / gray.pixels().len() as u64;
    gray.pixels()
        .enumerate()
        .fold(0_u64, |hash, (index, pixel)| {
            hash | (u64::from(u64::from(pixel[0]) >= average) << index)
        })
}

fn format_for_mime(content_type: &str) -> Option<ImageFormat> {
    match content_type {
        "image/png" => Some(ImageFormat::Png),
        "image/jpeg" => Some(ImageFormat::Jpeg),
        "image/webp" => Some(ImageFormat::WebP),
        "image/gif" => Some(ImageFormat::Gif),
        _ => None,
    }
}

fn parse_aspect_ratio(value: &str) -> Result<(u32, u32), String> {
    let (width, height) = value
        .split_once(':')
        .ok_or_else(|| "generated-image aspect ratio must be W:H".to_string())?;
    let width = width
        .parse::<u32>()
        .map_err(|_| "generated-image aspect ratio width is invalid".to_string())?;
    let height = height
        .parse::<u32>()
        .map_err(|_| "generated-image aspect ratio height is invalid".to_string())?;
    if width == 0 || height == 0 {
        return Err("generated-image aspect ratio cannot contain zero".to_string());
    }
    Ok((width, height))
}

fn load_or_create_record(
    root: &Path,
    brief: FrozenMediaBrief,
    brief_digest: &str,
) -> Result<PersistedMediaVerdict, String> {
    let record_id = sha256_hex(brief.job_key.as_bytes());
    match load_record(root, &record_id) {
        Ok(record) => {
            if record.brief_digest != brief_digest || record.brief != brief {
                return Err("generated-image frozen brief changed for an existing job".to_string());
            }
            Ok(record)
        }
        Err(error) if error.contains("not found") => Ok(new_record(brief, brief_digest)),
        Err(error) => Err(error),
    }
}

fn new_record(brief: FrozenMediaBrief, brief_digest: &str) -> PersistedMediaVerdict {
    PersistedMediaVerdict {
        schema_version: MEDIA_VERDICT_SCHEMA_VERSION,
        record_id: sha256_hex(brief.job_key.as_bytes()),
        brief,
        brief_digest: brief_digest.to_string(),
        active_candidate_digest: None,
        candidates: Vec::new(),
        provider_failures: 0,
        provider_cooldown_until_ms: None,
        provider_route: "primary".to_string(),
        disabled: false,
        updated_at_ms: crate::now_millis(),
    }
}

fn retire_record(root: &Path, record: &PersistedMediaVerdict) -> Result<(), String> {
    let retired = record_dir(root, &record.record_id)
        .join("retired")
        .join(format!("{}.json", record.brief_digest));
    let parent = retired
        .parent()
        .ok_or_else(|| "retired media verdict path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    atomic_write(
        &retired,
        &serde_json::to_vec(record).map_err(|error| error.to_string())?,
    )
}

fn load_record_by_job(root: &Path, job_key: &str) -> Result<PersistedMediaVerdict, String> {
    load_record(root, &sha256_hex(job_key.as_bytes()))
}

fn load_record(root: &Path, record_id: &str) -> Result<PersistedMediaVerdict, String> {
    if !valid_digest(record_id) {
        return Err("media verdict record id is invalid".to_string());
    }
    let path = record_path(root, record_id);
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "media verdict record not found at {}: {error}",
            path.display()
        )
    })?;
    let record: PersistedMediaVerdict =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if record.schema_version != MEDIA_VERDICT_SCHEMA_VERSION
        || record.record_id != record_id
        || record.brief.digest()? != record.brief_digest
    {
        return Err("media verdict record failed its identity check".to_string());
    }
    Ok(record)
}

fn list_records(root: &Path) -> Result<Vec<PersistedMediaVerdict>, String> {
    let directory = root.join(MEDIA_VERDICT_DIR);
    let Ok(entries) = fs::read_dir(directory) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let Some(record_id) = entry.file_name().to_str().map(ToString::to_string) else {
            continue;
        };
        if valid_digest(&record_id) && entry.path().is_dir() {
            records.push(load_record(root, &record_id)?);
        }
    }
    Ok(records)
}

fn store_record(root: &Path, record: &PersistedMediaVerdict) -> Result<(), String> {
    let mut record = record.clone();
    record.updated_at_ms = crate::now_millis();
    atomic_write(
        &record_path(root, &record.record_id),
        &serde_json::to_vec(&record).map_err(|error| error.to_string())?,
    )
}

fn store_candidate_object(
    root: &Path,
    record_id: &str,
    digest: &str,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    let directory = record_dir(root, record_id).join("candidates");
    atomic_write(&directory.join(format!("{digest}.image")), &image.bytes)?;
    atomic_write(
        &directory.join(format!("{digest}.metadata.json")),
        &serde_json::to_vec(&serde_json::json!({
            "schema_version": MEDIA_VERDICT_SCHEMA_VERSION,
            "digest": digest,
            "content_type": image.content_type,
            "source_url": image.source_url,
            "prediction_id": image.prediction_id,
        }))
        .map_err(|error| error.to_string())?,
    )
}

fn find_candidate_mut<'a>(
    record: &'a mut PersistedMediaVerdict,
    digest: &str,
) -> Result<&'a mut MediaCandidateVerdict, String> {
    record
        .candidates
        .iter_mut()
        .find(|candidate| candidate.provenance.digest == digest)
        .ok_or_else(|| "media verdict candidate was not found".to_string())
}

fn media_verdict_lock() -> Result<MutexGuard<'static, ()>, String> {
    MEDIA_VERDICT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "media verdict lock was poisoned".to_string())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "media verdict path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        crate::now_millis()
    ));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn preflight_atomic_write_directory(directory: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| {
        format!(
            "failed to create media verdict {label} directory {}: {error}",
            directory.display()
        )
    })?;
    let probe = directory.join(format!(
        ".preflight-{label}-{}-{}-{}",
        std::process::id(),
        crate::now_millis(),
        crate::random_hex(6)
    ));
    atomic_write(&probe, b"cosyworld-media-verdict-preflight")?;
    fs::remove_file(&probe).map_err(|error| {
        format!(
            "failed to remove media verdict {label} probe {}: {error}",
            probe.display()
        )
    })
}

fn record_dir(root: &Path, record_id: &str) -> PathBuf {
    root.join(MEDIA_VERDICT_DIR).join(record_id)
}

fn record_path(root: &Path, record_id: &str) -> PathBuf {
    record_dir(root, record_id).join("record.json")
}

fn universal_forbidden_constraints() -> Vec<String> {
    [
        "unsafe or sexual content",
        "visible text",
        "logo",
        "watermark",
        "system prompt or private data",
        "application UI or screenshot chrome",
        "unrequested subjects or props",
    ]
    .into_iter()
    .map(ToString::to_string)
    .collect()
}

fn disposition_name(disposition: MediaVerdictDisposition) -> &'static str {
    match disposition {
        MediaVerdictDisposition::ReviewPending => "review_pending",
        MediaVerdictDisposition::Approved => "approved",
        MediaVerdictDisposition::Rejected => "rejected",
        MediaVerdictDisposition::ReplaceRequested => "replace_requested",
        MediaVerdictDisposition::Disabled => "disabled",
    }
}

fn tally_outcome(
    disposition: MediaVerdictDisposition,
    approved: &mut u64,
    rejected: &mut u64,
    pending: &mut u64,
) {
    match disposition {
        MediaVerdictDisposition::Approved => *approved += 1,
        MediaVerdictDisposition::Rejected => *rejected += 1,
        MediaVerdictDisposition::ReviewPending
        | MediaVerdictDisposition::ReplaceRequested
        | MediaVerdictDisposition::Disabled => *pending += 1,
    }
}

fn bounded_text(value: &str, maximum: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut end = compact.len().min(maximum);
    while !compact.is_char_boundary(end) {
        end -= 1;
    }
    compact[..end].to_string()
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_hex(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

#[cfg(test)]
#[path = "../media_verdict_tests.rs"]
mod tests;
