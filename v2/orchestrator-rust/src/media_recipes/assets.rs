use super::{
    certified_media_reference, MediaIntent, MediaOperation, MediaRecipeRegistry,
    MediaRecipeRuntimeControls, MediaReference, MediaReferenceSlot, ResolvedMediaJob,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const MEDIA_ASSET_GRAPH_SCHEMA_VERSION: u8 = 1;
const MEDIA_ASSET_GRAPH_PATH: &str = "media-assets/graph-v1.json";
const MEDIA_ASSET_OBJECT_PREFIX: &str = "media-assets/objects/sha256";
const GENERATED_REFERENCE_POLICY: &str = "cosyworld.generated-public-reference/1";

static MEDIA_ASSET_GRAPH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
enum MediaAssetSubjectKind {
    Actor,
    Item,
    Location,
}

impl MediaAssetSubjectKind {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "actor" => Ok(Self::Actor),
            "item" => Ok(Self::Item),
            "location" => Ok(Self::Location),
            other => Err(format!("unsupported media asset subject kind {other}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Actor => "actor",
            Self::Item => "item",
            Self::Location => "location",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum MediaAssetSourceKind {
    Authored,
    OnChain,
    Imported,
    Generated,
    Derived,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum MediaAssetModerationState {
    Pending,
    Approved,
    Rejected,
    Private,
    Deleted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaAssetRights {
    reference_reuse_permitted: bool,
    policy_basis: String,
}

impl MediaAssetRights {
    fn default_for(_source: MediaAssetSourceKind) -> Self {
        Self {
            reference_reuse_permitted: false,
            policy_basis: String::new(),
        }
    }

    fn generated_public_reference() -> Self {
        Self {
            reference_reuse_permitted: true,
            policy_basis: GENERATED_REFERENCE_POLICY.to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct MediaAssetProvenance {
    pub(crate) pack_id: String,
    pub(crate) pack_version: String,
    pub(crate) composition_id: String,
    pub(crate) composition_revision: String,
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) model_version: String,
    pub(crate) prompt_version: String,
    pub(crate) seed: Option<u64>,
    pub(crate) prediction_id: Option<String>,
    pub(crate) source_event_seq: Option<u64>,
    pub(crate) history_through_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaAssetParent {
    parent_asset_id: String,
    parent_digest: String,
    slot: MediaReferenceSlot,
    order: usize,
    crop: Option<String>,
    mask: Option<String>,
    transformation: String,
}

#[derive(Clone, Debug)]
struct MediaAssetParentInput {
    parent_asset_id: String,
    slot: MediaReferenceSlot,
    order: usize,
    crop: Option<String>,
    mask: Option<String>,
    transformation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaAssetRecord {
    asset_id: String,
    content_digest: String,
    width: u32,
    height: u32,
    mime_type: String,
    object_location: String,
    created_at_ms: u64,
    subject_kind: MediaAssetSubjectKind,
    subject_id: u64,
    level: u8,
    revision: u64,
    provenance: MediaAssetProvenance,
    source_kind: MediaAssetSourceKind,
    initial_moderation_state: MediaAssetModerationState,
    rights: MediaAssetRights,
    parents: Vec<MediaAssetParent>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaAssetModerationDecision {
    asset_id: String,
    state: MediaAssetModerationState,
    source_event_seq: Option<u64>,
    decided_at_ms: u64,
    reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaCanonicalRevision {
    subject_key: String,
    previous_asset_id: Option<String>,
    asset_id: Option<String>,
    source_event_seq: Option<u64>,
    changed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaReferenceHold {
    subject_key: String,
    created_at_ms: u64,
    reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaAssetGraph {
    schema_version: u8,
    assets: BTreeMap<String, MediaAssetRecord>,
    canonical: BTreeMap<String, String>,
    moderation: Vec<MediaAssetModerationDecision>,
    canonical_history: Vec<MediaCanonicalRevision>,
    #[serde(default)]
    reference_holds: BTreeMap<String, MediaReferenceHold>,
}

impl Default for MediaAssetGraph {
    fn default() -> Self {
        Self {
            schema_version: MEDIA_ASSET_GRAPH_SCHEMA_VERSION,
            assets: BTreeMap::new(),
            canonical: BTreeMap::new(),
            moderation: Vec::new(),
            canonical_history: Vec::new(),
            reference_holds: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct MediaAssetRegistration {
    subject_kind: MediaAssetSubjectKind,
    subject_id: u64,
    level: u8,
    explicit_revision: Option<u64>,
    bytes: Vec<u8>,
    mime_type: String,
    created_at_ms: u64,
    provenance: MediaAssetProvenance,
    source_kind: MediaAssetSourceKind,
    initial_moderation_state: MediaAssetModerationState,
    rights: MediaAssetRights,
    parents: Vec<MediaAssetParentInput>,
}

#[derive(Clone, Debug)]
pub(crate) struct MediaAssetBackfill {
    pub(crate) subject_kind: String,
    pub(crate) subject_id: u64,
    pub(crate) level: u8,
    pub(crate) revision: u32,
    pub(crate) image_path: PathBuf,
    pub(crate) content_type_path: PathBuf,
    pub(crate) metadata_path: Option<PathBuf>,
    pub(crate) created_at_ms: u64,
    pub(crate) provenance: MediaAssetProvenance,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct FrozenMediaAssetReference {
    pub(crate) subject_kind: String,
    pub(crate) subject_id: u64,
    pub(crate) level: u8,
    pub(crate) asset_id: String,
    pub(crate) content_digest: String,
    pub(crate) mime_type: String,
    pub(crate) history_through_seq: u64,
}

#[derive(Clone, Debug)]
struct MediaReferenceRequirement {
    slot: MediaReferenceSlot,
    subject_kind: MediaAssetSubjectKind,
    subject_id: u64,
    level: u8,
    lifecycle: Option<MediaReferenceLifecycleClaim>,
}

#[derive(Clone, Debug)]
struct MediaReferenceLifecycleClaim {
    status: String,
    prediction_id: Option<String>,
    source_event_seq: Option<u64>,
}

#[derive(Clone, Debug)]
struct MediaAssetReferenceIntent {
    world_snapshot_id: String,
    history_through_seq: u64,
    requirements: Vec<MediaReferenceRequirement>,
}

#[derive(Clone, Debug)]
struct AuthoritativeMediaJobRequest {
    job_key: String,
    profile: String,
    operation: MediaOperation,
    intent: MediaIntent,
    prompt: String,
    reference_intent: MediaAssetReferenceIntent,
    aspect_ratio: String,
    output_format: String,
    mask_url: Option<String>,
    seed: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum MediaAssetResolutionError {
    Graph(String),
    MissingReference(String),
    IneligibleModeration(String),
    RightsIneligible(String),
    CompositionPlanRequired { required: usize, maximum: usize },
    Recipe(String),
}

impl MediaAssetResolutionError {
    fn code(&self) -> &'static str {
        match self {
            Self::Graph(_) => "media_asset_graph_invalid",
            Self::MissingReference(_) => "media_reference_missing",
            Self::IneligibleModeration(_) => "media_reference_moderation_ineligible",
            Self::RightsIneligible(_) => "media_reference_rights_ineligible",
            Self::CompositionPlanRequired { .. } => "media_composition_plan_required",
            Self::Recipe(_) => "media_recipe_ineligible",
        }
    }
}

impl std::fmt::Display for MediaAssetResolutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Graph(error)
            | Self::MissingReference(error)
            | Self::IneligibleModeration(error)
            | Self::RightsIneligible(error)
            | Self::Recipe(error) => formatter.write_str(error),
            Self::CompositionPlanRequired { required, maximum } => write!(
                formatter,
                "{required} references exceed the recipe budget of {maximum}; a composition plan is required"
            ),
        }
    }
}

pub(crate) fn register_generated_media_asset(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    bytes: &[u8],
    mime_type: &str,
    provenance: MediaAssetProvenance,
) -> Result<String, String> {
    register_media_asset(
        root,
        MediaAssetRegistration {
            subject_kind: MediaAssetSubjectKind::parse(subject_kind)?,
            subject_id,
            level,
            explicit_revision: None,
            bytes: bytes.to_vec(),
            mime_type: mime_type.to_ascii_lowercase(),
            created_at_ms: crate::now_millis(),
            provenance,
            source_kind: MediaAssetSourceKind::Generated,
            initial_moderation_state: MediaAssetModerationState::Pending,
            rights: MediaAssetRights::generated_public_reference(),
            parents: Vec::new(),
        },
    )
}

pub(crate) fn backfill_legacy_community_asset(
    root: &Path,
    mut backfill: MediaAssetBackfill,
) -> Result<String, String> {
    let bytes = fs::read(&backfill.image_path).map_err(|error| error.to_string())?;
    let mime_type = fs::read_to_string(&backfill.content_type_path)
        .map_err(|error| error.to_string())?
        .trim()
        .to_ascii_lowercase();
    if let Some(metadata_path) = backfill.metadata_path.as_deref() {
        let metadata: serde_json::Value =
            serde_json::from_slice(&fs::read(metadata_path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        if let Some(expected) = metadata.get("sha256").and_then(|value| value.as_str()) {
            let actual = sha256_hex(&bytes);
            if expected != actual {
                return Err("legacy community-art digest did not match its metadata".to_string());
            }
        }
        if backfill.provenance.prediction_id.is_none() {
            backfill.provenance.prediction_id = metadata
                .get("prediction_id")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
        }
    }
    register_media_asset(
        root,
        MediaAssetRegistration {
            subject_kind: MediaAssetSubjectKind::parse(&backfill.subject_kind)?,
            subject_id: backfill.subject_id,
            level: backfill.level,
            explicit_revision: Some(u64::from(backfill.revision.max(1))),
            bytes,
            mime_type,
            created_at_ms: backfill.created_at_ms,
            provenance: backfill.provenance,
            source_kind: MediaAssetSourceKind::Generated,
            initial_moderation_state: MediaAssetModerationState::Approved,
            rights: MediaAssetRights::generated_public_reference(),
            parents: Vec::new(),
        },
    )
}

pub(crate) fn approve_media_asset(
    root: &Path,
    asset_id: &str,
    source_event_seq: Option<u64>,
    reason: &str,
) -> Result<(), String> {
    update_asset_moderation(
        root,
        asset_id,
        MediaAssetModerationState::Approved,
        source_event_seq,
        reason,
    )
}

fn mark_canonical_media_asset_moderation(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    state: MediaAssetModerationState,
    source_event_seq: Option<u64>,
    reason: &str,
) -> Result<bool, String> {
    let subject_kind = MediaAssetSubjectKind::parse(subject_kind)?;
    let key = canonical_subject_key(subject_kind, subject_id, level);
    with_graph(root, |graph| {
        let Some(asset_id) = graph.canonical.get(&key).cloned() else {
            return Ok(false);
        };
        append_moderation_decision(
            graph,
            &asset_id,
            state,
            source_event_seq,
            reason,
            crate::now_millis(),
        )?;
        Ok(true)
    })
}

pub(crate) fn hold_community_media_asset_references(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    reason: &str,
) -> Result<(), String> {
    let key = canonical_subject_key(
        MediaAssetSubjectKind::parse(subject_kind)?,
        subject_id,
        level,
    );
    with_graph(root, |graph| {
        graph
            .reference_holds
            .entry(key.clone())
            .or_insert_with(|| MediaReferenceHold {
                subject_key: key,
                created_at_ms: crate::now_millis(),
                reason: reason.to_string(),
            });
        Ok(())
    })
}

pub(crate) fn release_community_media_asset_reference_hold(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
) -> Result<(), String> {
    let key = canonical_subject_key(
        MediaAssetSubjectKind::parse(subject_kind)?,
        subject_id,
        level,
    );
    with_graph(root, |graph| {
        graph.reference_holds.remove(&key);
        Ok(())
    })
}

pub(crate) fn reconcile_community_media_asset_status(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    status: &str,
    prediction_id: Option<&str>,
    source_event_seq: Option<u64>,
) -> Result<bool, String> {
    let subject_kind = MediaAssetSubjectKind::parse(subject_kind)?;
    let key = canonical_subject_key(subject_kind, subject_id, level);
    with_graph(root, |graph| {
        let matching_asset = |prediction_id: Option<&str>| {
            graph
                .assets
                .values()
                .filter(|asset| {
                    asset.subject_kind == subject_kind
                        && asset.subject_id == subject_id
                        && asset.level == level
                        && prediction_id.is_none_or(|prediction_id| {
                            asset.provenance.prediction_id.as_deref() == Some(prediction_id)
                        })
                })
                .max_by_key(|asset| (asset.revision, asset.asset_id.clone()))
                .map(|asset| asset.asset_id.clone())
        };
        let target = match prediction_id {
            Some(prediction_id) => matching_asset(Some(prediction_id)),
            None if status == "ready" => matching_asset(None),
            None => graph.canonical.get(&key).cloned(),
        };
        let found = target.is_some();

        match status {
            "ready" => {
                let Some(asset_id) = target else {
                    graph.reference_holds.remove(&key);
                    return Ok(false);
                };
                append_moderation_decision(
                    graph,
                    &asset_id,
                    MediaAssetModerationState::Approved,
                    source_event_seq,
                    "reconciled from durable community-art ready state",
                    crate::now_millis(),
                )?;
            }
            "rejected" | "policy_rejected" => {
                if let Some(asset_id) = target {
                    append_moderation_decision(
                        graph,
                        &asset_id,
                        MediaAssetModerationState::Rejected,
                        source_event_seq,
                        "reconciled from durable community-art rejection state",
                        crate::now_millis(),
                    )?;
                }
            }
            _ => {}
        }
        graph.reference_holds.remove(&key);
        Ok(found)
    })
}

pub(crate) fn immutable_media_asset_bytes(
    root: &Path,
    asset_id: &str,
) -> Result<(Vec<u8>, String), String> {
    let _guard = graph_lock()?;
    let graph = load_graph(root)?;
    let asset = graph
        .assets
        .get(asset_id)
        .ok_or_else(|| format!("unknown immutable media asset {asset_id}"))?;
    let bytes = read_and_verify_object(root, asset)?;
    Ok((bytes, asset.mime_type.clone()))
}

pub(crate) fn canonical_community_media_asset_bytes(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    prediction_id: Option<&str>,
) -> Result<(Vec<u8>, String), String> {
    let key = canonical_subject_key(
        MediaAssetSubjectKind::parse(subject_kind)?,
        subject_id,
        level,
    );
    let _guard = graph_lock()?;
    let graph = load_graph(root)?;
    let asset_id = graph
        .canonical
        .get(&key)
        .ok_or_else(|| format!("no approved canonical media asset for {key}"))?;
    let asset = graph
        .assets
        .get(asset_id)
        .ok_or_else(|| format!("canonical media asset {asset_id} is missing"))?;
    if effective_moderation_state(&graph, asset) != MediaAssetModerationState::Approved
        || prediction_id.is_some_and(|prediction_id| {
            asset.provenance.prediction_id.as_deref() != Some(prediction_id)
        })
    {
        return Err(format!(
            "canonical media asset {asset_id} does not match the approved generation"
        ));
    }
    Ok((
        read_and_verify_object(root, asset)?,
        asset.mime_type.clone(),
    ))
}

pub(crate) fn freeze_approved_community_media_reference(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    history_through_seq: u64,
) -> Result<FrozenMediaAssetReference, String> {
    let subject_kind_value = MediaAssetSubjectKind::parse(subject_kind)?;
    let subject_key = canonical_subject_key(subject_kind_value, subject_id, level);
    let _guard = graph_lock()?;
    let graph = load_graph(root)?;
    if graph.reference_holds.contains_key(&subject_key) {
        return Err(format!(
            "media references for {subject_key} are held pending lifecycle reconciliation"
        ));
    }
    let asset_id = canonical_asset_as_of(&graph, &subject_key, history_through_seq)
        .ok_or_else(|| {
            format!(
                "no approved canonical media asset for {subject_key} at event {history_through_seq}"
            )
        })?
        .to_string();
    let asset = graph
        .assets
        .get(&asset_id)
        .ok_or_else(|| format!("canonical media asset {asset_id} is missing"))?;
    if effective_moderation_state(&graph, asset) != MediaAssetModerationState::Approved {
        return Err(format!("media asset {asset_id} is not approved"));
    }
    if !asset.rights.reference_reuse_permitted {
        return Err(format!(
            "media asset {asset_id} is not licensed for derivation"
        ));
    }
    read_and_verify_object(root, asset)?;
    Ok(FrozenMediaAssetReference {
        subject_kind: subject_kind.to_string(),
        subject_id,
        level,
        asset_id,
        content_digest: asset.content_digest.clone(),
        mime_type: asset.mime_type.clone(),
        history_through_seq: asset.provenance.history_through_seq,
    })
}

pub(crate) fn resolve_frozen_community_media_reference(
    root: &Path,
    frozen: &FrozenMediaAssetReference,
    history_through_seq: u64,
) -> Result<MediaReference, String> {
    resolve_frozen_media_reference(
        root,
        frozen,
        MediaReferenceSlot::PriorLevel,
        history_through_seq,
    )
}

pub(crate) fn resolve_frozen_media_reference(
    root: &Path,
    frozen: &FrozenMediaAssetReference,
    slot: MediaReferenceSlot,
    history_through_seq: u64,
) -> Result<MediaReference, String> {
    let current = freeze_approved_community_media_reference(
        root,
        &frozen.subject_kind,
        frozen.subject_id,
        frozen.level,
        history_through_seq,
    )?;
    if &current != frozen {
        return Err(
            "approved media asset did not match the frozen authoritative reference".to_string(),
        );
    }
    let (bytes, mime_type) = immutable_media_asset_bytes(root, &frozen.asset_id)?;
    let url = format!("data:{mime_type};base64,{}", BASE64_STANDARD.encode(bytes));
    Ok(certified_media_reference(
        slot,
        canonical_subject_key(
            MediaAssetSubjectKind::parse(&frozen.subject_kind)?,
            frozen.subject_id,
            frozen.level,
        ),
        frozen.asset_id.clone(),
        frozen.content_digest.clone(),
        url,
        mime_type
            .trim_start_matches("image/")
            .replace("jpeg", "jpg"),
    ))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn register_derived_community_media_asset(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    bytes: &[u8],
    mime_type: &str,
    prior: &FrozenMediaAssetReference,
    crop: &str,
    provenance: MediaAssetProvenance,
) -> Result<String, String> {
    register_derived_media_asset(
        root,
        MediaAssetSubjectKind::parse(subject_kind)?,
        subject_id,
        level,
        bytes,
        mime_type,
        vec![MediaAssetParentInput {
            parent_asset_id: prior.asset_id.clone(),
            slot: MediaReferenceSlot::PriorLevel,
            order: 0,
            crop: Some(crop.to_string()),
            mask: None,
            transformation: "single-reference identity-preserving evolution".to_string(),
        }],
        provenance,
        crate::now_millis(),
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn register_derived_room_scene_media_asset(
    root: &Path,
    location_id: u64,
    location_level: u8,
    bytes: &[u8],
    mime_type: &str,
    references: &[(MediaReferenceSlot, FrozenMediaAssetReference)],
    crop: &str,
    provenance: MediaAssetProvenance,
) -> Result<String, String> {
    register_derived_media_asset(
        root,
        MediaAssetSubjectKind::Location,
        location_id,
        location_level,
        bytes,
        mime_type,
        references
            .iter()
            .enumerate()
            .map(|(order, (slot, reference))| MediaAssetParentInput {
                parent_asset_id: reference.asset_id.clone(),
                slot: *slot,
                order,
                crop: Some(crop.to_string()),
                mask: None,
                transformation: "bounded authoritative room-scene composition".to_string(),
            })
            .collect(),
        provenance,
        crate::now_millis(),
    )
}

#[allow(clippy::too_many_arguments)]
fn register_source_media_asset(
    root: &Path,
    subject_kind: MediaAssetSubjectKind,
    subject_id: u64,
    level: u8,
    bytes: &[u8],
    mime_type: &str,
    source_kind: MediaAssetSourceKind,
    rights: Option<MediaAssetRights>,
    moderation: MediaAssetModerationState,
    provenance: MediaAssetProvenance,
    created_at_ms: u64,
) -> Result<String, String> {
    register_media_asset(
        root,
        MediaAssetRegistration {
            subject_kind,
            subject_id,
            level,
            explicit_revision: None,
            bytes: bytes.to_vec(),
            mime_type: mime_type.to_string(),
            created_at_ms,
            provenance,
            source_kind,
            initial_moderation_state: moderation,
            rights: rights.unwrap_or_else(|| MediaAssetRights::default_for(source_kind)),
            parents: Vec::new(),
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn register_derived_media_asset(
    root: &Path,
    subject_kind: MediaAssetSubjectKind,
    subject_id: u64,
    level: u8,
    bytes: &[u8],
    mime_type: &str,
    parents: Vec<MediaAssetParentInput>,
    provenance: MediaAssetProvenance,
    created_at_ms: u64,
) -> Result<String, String> {
    register_media_asset(
        root,
        MediaAssetRegistration {
            subject_kind,
            subject_id,
            level,
            explicit_revision: None,
            bytes: bytes.to_vec(),
            mime_type: mime_type.to_string(),
            created_at_ms,
            provenance,
            source_kind: MediaAssetSourceKind::Derived,
            initial_moderation_state: MediaAssetModerationState::Pending,
            rights: MediaAssetRights::generated_public_reference(),
            parents,
        },
    )
}

fn register_media_asset(root: &Path, input: MediaAssetRegistration) -> Result<String, String> {
    validate_registration(&input)?;
    let (width, height) = image_dimensions(&input.bytes, &input.mime_type)?;
    let digest = sha256_hex(&input.bytes);
    with_graph(root, |graph| {
        let parents = resolve_parent_records(graph, &input.parents)?;
        if let Some(existing) = graph.assets.values().find(|asset| {
            asset.content_digest == digest
                && asset.subject_kind == input.subject_kind
                && asset.subject_id == input.subject_id
                && asset.level == input.level
                && asset.source_kind == input.source_kind
                && asset.provenance == input.provenance
                && asset.parents == parents
        }) {
            return Ok(existing.asset_id.clone());
        }
        let revision = input
            .explicit_revision
            .unwrap_or_else(|| media_causal_revision(&input.provenance));
        if revision == 0
            || graph.assets.values().any(|asset| {
                asset.subject_kind == input.subject_kind
                    && asset.subject_id == input.subject_id
                    && asset.level == input.level
                    && asset.revision == revision
            })
        {
            return Err(format!(
                "media asset revision {revision} already exists for {}:{} level {}",
                input.subject_kind.as_str(),
                input.subject_id,
                input.level
            ));
        }
        let asset_id = immutable_asset_id(&input, revision, &digest, &parents);
        let object_location = object_location(&digest);
        let record = MediaAssetRecord {
            asset_id: asset_id.clone(),
            content_digest: digest,
            width,
            height,
            mime_type: input.mime_type.clone(),
            object_location,
            created_at_ms: input.created_at_ms,
            subject_kind: input.subject_kind,
            subject_id: input.subject_id,
            level: input.level,
            revision,
            provenance: input.provenance.clone(),
            source_kind: input.source_kind,
            initial_moderation_state: input.initial_moderation_state,
            rights: input.rights.clone(),
            parents,
        };
        write_immutable_object(root, &record, &input.bytes)?;
        graph.assets.insert(asset_id.clone(), record);
        if input.initial_moderation_state == MediaAssetModerationState::Approved {
            set_canonical_asset(
                graph,
                &asset_id,
                input.provenance.source_event_seq,
                input.created_at_ms,
            )?;
        }
        Ok(asset_id)
    })
}

fn validate_registration(input: &MediaAssetRegistration) -> Result<(), String> {
    if input.subject_id == 0 || input.level == 0 {
        return Err("media asset subject id and level must be positive".to_string());
    }
    if !crate::is_safe_image_content_type(&input.mime_type) {
        return Err(format!("unsafe media asset MIME type {}", input.mime_type));
    }
    if input.provenance.pack_id.trim().is_empty()
        || input.provenance.pack_version.trim().is_empty()
        || input.provenance.composition_id.trim().is_empty()
        || input.provenance.composition_revision.trim().is_empty()
    {
        return Err("media asset pack and composition provenance are required".to_string());
    }
    if input.rights.reference_reuse_permitted && input.rights.policy_basis.trim().is_empty() {
        return Err("derivable media assets require a rights policy basis".to_string());
    }
    if input.source_kind == MediaAssetSourceKind::Derived && input.parents.is_empty() {
        return Err("derived media assets require at least one parent".to_string());
    }
    if input.source_kind != MediaAssetSourceKind::Derived && !input.parents.is_empty() {
        return Err("only derived media assets may declare parents".to_string());
    }
    if input.explicit_revision.is_none() && media_causal_revision(&input.provenance) == 0 {
        return Err(
            "media assets require a positive causal event boundary or explicit revision"
                .to_string(),
        );
    }
    Ok(())
}

fn media_causal_revision(provenance: &MediaAssetProvenance) -> u64 {
    provenance
        .source_event_seq
        .unwrap_or(provenance.history_through_seq)
}

fn resolve_parent_records(
    graph: &MediaAssetGraph,
    inputs: &[MediaAssetParentInput],
) -> Result<Vec<MediaAssetParent>, String> {
    let mut orders = BTreeSet::new();
    let mut parents = Vec::with_capacity(inputs.len());
    for input in inputs {
        if !orders.insert(input.order) {
            return Err(format!(
                "duplicate derived media parent order {}",
                input.order
            ));
        }
        let parent = graph
            .assets
            .get(&input.parent_asset_id)
            .ok_or_else(|| format!("unknown derived media parent {}", input.parent_asset_id))?;
        if effective_moderation_state(graph, parent) != MediaAssetModerationState::Approved {
            return Err(format!(
                "derived media parent {} is not approved",
                input.parent_asset_id
            ));
        }
        if !parent.rights.reference_reuse_permitted {
            return Err(format!(
                "derived media parent {} is not licensed for reference reuse",
                input.parent_asset_id
            ));
        }
        parents.push(MediaAssetParent {
            parent_asset_id: input.parent_asset_id.clone(),
            parent_digest: parent.content_digest.clone(),
            slot: input.slot,
            order: input.order,
            crop: input.crop.clone(),
            mask: input.mask.clone(),
            transformation: input.transformation.clone(),
        });
    }
    parents.sort_by_key(|parent| parent.order);
    if parents
        .iter()
        .enumerate()
        .any(|(expected, parent)| expected != parent.order)
    {
        return Err("derived media parent order must be contiguous from zero".to_string());
    }
    Ok(parents)
}

fn update_asset_moderation(
    root: &Path,
    asset_id: &str,
    state: MediaAssetModerationState,
    source_event_seq: Option<u64>,
    reason: &str,
) -> Result<(), String> {
    with_graph(root, |graph| {
        append_moderation_decision(
            graph,
            asset_id,
            state,
            source_event_seq,
            reason,
            crate::now_millis(),
        )
    })
}

fn append_moderation_decision(
    graph: &mut MediaAssetGraph,
    asset_id: &str,
    state: MediaAssetModerationState,
    source_event_seq: Option<u64>,
    reason: &str,
    decided_at_ms: u64,
) -> Result<(), String> {
    let asset = graph
        .assets
        .get(asset_id)
        .ok_or_else(|| format!("unknown immutable media asset {asset_id}"))?
        .clone();
    let current_state = effective_moderation_state(graph, &asset);
    if state == MediaAssetModerationState::Approved
        && matches!(
            current_state,
            MediaAssetModerationState::Rejected
                | MediaAssetModerationState::Private
                | MediaAssetModerationState::Deleted
        )
    {
        return Err(format!(
            "terminally ineligible media asset {asset_id} cannot be re-approved"
        ));
    }
    if current_state == state {
        if state == MediaAssetModerationState::Approved {
            set_canonical_asset(graph, asset_id, source_event_seq, decided_at_ms)?;
        }
        return Ok(());
    }
    graph.moderation.push(MediaAssetModerationDecision {
        asset_id: asset_id.to_string(),
        state,
        source_event_seq,
        decided_at_ms,
        reason: reason.to_string(),
    });
    if state == MediaAssetModerationState::Approved {
        set_canonical_asset(graph, asset_id, source_event_seq, decided_at_ms)?;
    } else {
        let key = canonical_subject_key(asset.subject_kind, asset.subject_id, asset.level);
        if graph
            .canonical
            .get(&key)
            .is_some_and(|current| current == asset_id)
        {
            graph.canonical.remove(&key);
            graph.canonical_history.push(MediaCanonicalRevision {
                subject_key: key,
                previous_asset_id: Some(asset_id.to_string()),
                asset_id: None,
                source_event_seq,
                changed_at_ms: decided_at_ms,
            });
        }
    }
    Ok(())
}

fn set_canonical_asset(
    graph: &mut MediaAssetGraph,
    asset_id: &str,
    source_event_seq: Option<u64>,
    changed_at_ms: u64,
) -> Result<(), String> {
    let asset = graph
        .assets
        .get(asset_id)
        .ok_or_else(|| format!("unknown immutable media asset {asset_id}"))?;
    if effective_moderation_state(graph, asset) != MediaAssetModerationState::Approved {
        return Err(format!("media asset {asset_id} is not approved"));
    }
    let key = canonical_subject_key(asset.subject_kind, asset.subject_id, asset.level);
    let should_advance = graph
        .canonical
        .get(&key)
        .and_then(|current| graph.assets.get(current))
        .is_none_or(|current| {
            (asset.revision, asset.asset_id.as_str())
                > (current.revision, current.asset_id.as_str())
        });
    let previous = graph.canonical.get(&key).cloned();
    if should_advance {
        graph.canonical.insert(key.clone(), asset_id.to_string());
    }
    if should_advance
        && !graph.canonical_history.iter().any(|entry| {
            entry.subject_key == key
                && entry.asset_id.as_deref() == Some(asset_id)
                && entry.source_event_seq == source_event_seq
        })
    {
        graph.canonical_history.push(MediaCanonicalRevision {
            subject_key: key,
            previous_asset_id: previous,
            asset_id: Some(asset_id.to_string()),
            source_event_seq,
            changed_at_ms,
        });
    }
    Ok(())
}

fn effective_moderation_state(
    graph: &MediaAssetGraph,
    asset: &MediaAssetRecord,
) -> MediaAssetModerationState {
    graph
        .moderation
        .iter()
        .rev()
        .find(|decision| decision.asset_id == asset.asset_id)
        .map(|decision| decision.state)
        .unwrap_or(asset.initial_moderation_state)
}

fn resolve_media_references(
    root: &Path,
    intent: &MediaAssetReferenceIntent,
    maximum_references: usize,
) -> Result<Vec<MediaReference>, MediaAssetResolutionError> {
    if intent.requirements.len() > maximum_references {
        return Err(MediaAssetResolutionError::CompositionPlanRequired {
            required: intent.requirements.len(),
            maximum: maximum_references,
        });
    }
    if intent.world_snapshot_id.trim().is_empty() {
        return Err(MediaAssetResolutionError::Graph(
            "authoritative media intent requires a world snapshot id".to_string(),
        ));
    }
    for requirement in &intent.requirements {
        if let Some(lifecycle) = requirement.lifecycle.as_ref() {
            reconcile_community_media_asset_status(
                root,
                requirement.subject_kind.as_str(),
                requirement.subject_id,
                requirement.level,
                &lifecycle.status,
                lifecycle.prediction_id.as_deref(),
                lifecycle.source_event_seq,
            )
            .map_err(MediaAssetResolutionError::Graph)?;
        }
    }
    let _guard = graph_lock().map_err(MediaAssetResolutionError::Graph)?;
    let graph = load_graph(root).map_err(MediaAssetResolutionError::Graph)?;
    let mut requirements = intent.requirements.clone();
    requirements.sort_by_key(|requirement| {
        (
            reference_slot_order(requirement.slot),
            requirement.subject_kind,
            requirement.subject_id,
            requirement.level,
        )
    });
    let mut sources = BTreeSet::new();
    let mut resolved = Vec::with_capacity(requirements.len());
    for requirement in requirements {
        let source_id = canonical_subject_key(
            requirement.subject_kind,
            requirement.subject_id,
            requirement.level,
        );
        if !sources.insert(source_id.clone()) {
            return Err(MediaAssetResolutionError::Graph(format!(
                "duplicate authoritative media reference {source_id}"
            )));
        }
        if graph.reference_holds.contains_key(&source_id) {
            return Err(MediaAssetResolutionError::IneligibleModeration(format!(
                "media references for {source_id} are held pending lifecycle reconciliation"
            )));
        }
        let asset_id = canonical_asset_as_of(&graph, &source_id, intent.history_through_seq)
            .ok_or_else(|| {
                MediaAssetResolutionError::MissingReference(format!(
                    "no approved canonical media asset for {source_id} at event {}",
                    intent.history_through_seq
                ))
            })?;
        let asset = graph.assets.get(asset_id).ok_or_else(|| {
            MediaAssetResolutionError::Graph(format!("canonical media asset {asset_id} is missing"))
        })?;
        if effective_moderation_state(&graph, asset) != MediaAssetModerationState::Approved {
            return Err(MediaAssetResolutionError::IneligibleModeration(format!(
                "media asset {asset_id} is not approved"
            )));
        }
        if !asset.rights.reference_reuse_permitted {
            return Err(MediaAssetResolutionError::RightsIneligible(format!(
                "media asset {asset_id} is not licensed for derivation"
            )));
        }
        let bytes =
            read_and_verify_object(root, asset).map_err(MediaAssetResolutionError::Graph)?;
        let url = format!(
            "data:{};base64,{}",
            asset.mime_type,
            BASE64_STANDARD.encode(bytes)
        );
        resolved.push(certified_media_reference(
            requirement.slot,
            source_id,
            asset.asset_id.clone(),
            asset.content_digest.clone(),
            url,
            asset
                .mime_type
                .trim_start_matches("image/")
                .replace("jpeg", "jpg"),
        ));
    }
    Ok(resolved)
}

fn canonical_asset_as_of<'a>(
    graph: &'a MediaAssetGraph,
    subject_key: &str,
    history_through_seq: u64,
) -> Option<&'a str> {
    graph
        .canonical_history
        .iter()
        .filter(|entry| {
            entry.subject_key == subject_key
                && entry.source_event_seq.unwrap_or(0) <= history_through_seq
        })
        .max_by(|left, right| {
            let left_revision = left
                .asset_id
                .as_ref()
                .and_then(|asset_id| graph.assets.get(asset_id))
                .map(|asset| asset.revision)
                .unwrap_or(0);
            let right_revision = right
                .asset_id
                .as_ref()
                .and_then(|asset_id| graph.assets.get(asset_id))
                .map(|asset| asset.revision)
                .unwrap_or(0);
            (
                left.source_event_seq.unwrap_or(0),
                left.asset_id.is_none(),
                left_revision,
                left.asset_id.as_deref().unwrap_or(""),
            )
                .cmp(&(
                    right.source_event_seq.unwrap_or(0),
                    right.asset_id.is_none(),
                    right_revision,
                    right.asset_id.as_deref().unwrap_or(""),
                ))
        })
        .and_then(|entry| entry.asset_id.as_deref())
}

impl MediaRecipeRegistry {
    fn resolve_authoritative_job(
        &self,
        controls: &MediaRecipeRuntimeControls,
        asset_root: &Path,
        request: AuthoritativeMediaJobRequest,
    ) -> Result<ResolvedMediaJob, MediaAssetResolutionError> {
        self.validate_controls(controls)
            .map_err(MediaAssetResolutionError::Recipe)?;
        let profile = self.profiles.get(&request.profile).ok_or_else(|| {
            MediaAssetResolutionError::Recipe(format!("unknown media profile {}", request.profile))
        })?;
        let references = resolve_media_references(
            asset_root,
            &request.reference_intent,
            profile.maximum_references,
        )?;
        self.resolve(
            controls,
            super::MediaJobRequest {
                job_key: request.job_key,
                profile: request.profile,
                operation: request.operation,
                intent: request.intent,
                prompt: request.prompt,
                references,
                aspect_ratio: request.aspect_ratio,
                output_format: request.output_format,
                mask_url: request.mask_url,
                seed: request.seed,
            },
        )
        .map_err(MediaAssetResolutionError::Recipe)
    }
}

fn complete_lineage(
    root: &Path,
    asset_id: &str,
) -> Result<BTreeMap<String, MediaAssetRecord>, String> {
    let _guard = graph_lock()?;
    let graph = load_graph(root)?;
    let mut lineage = BTreeMap::new();
    let mut pending = vec![asset_id.to_string()];
    while let Some(current) = pending.pop() {
        if lineage.contains_key(&current) {
            continue;
        }
        let asset = graph
            .assets
            .get(&current)
            .ok_or_else(|| format!("lineage references unknown asset {current}"))?
            .clone();
        pending.extend(
            asset
                .parents
                .iter()
                .map(|parent| parent.parent_asset_id.clone()),
        );
        lineage.insert(current, asset);
    }
    Ok(lineage)
}

fn with_graph<T>(
    root: &Path,
    operation: impl FnOnce(&mut MediaAssetGraph) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = graph_lock()?;
    let mut graph = load_graph(root)?;
    let result = operation(&mut graph)?;
    validate_graph(&graph)?;
    save_graph(root, &graph)?;
    Ok(result)
}

fn graph_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    MEDIA_ASSET_GRAPH_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "media asset graph lock was poisoned".to_string())
}

fn load_graph(root: &Path) -> Result<MediaAssetGraph, String> {
    let path = root.join(MEDIA_ASSET_GRAPH_PATH);
    if !path.exists() {
        return Ok(MediaAssetGraph::default());
    }
    let graph: MediaAssetGraph =
        serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    validate_graph(&graph)?;
    Ok(graph)
}

fn save_graph(root: &Path, graph: &MediaAssetGraph) -> Result<(), String> {
    let path = root.join(MEDIA_ASSET_GRAPH_PATH);
    let parent = path
        .parent()
        .ok_or_else(|| "media asset graph path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(graph).map_err(|error| error.to_string())?;
    let temporary = path.with_file_name(format!(
        ".graph-v1.json.tmp-{}-{}",
        std::process::id(),
        crate::now_millis()
    ));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error.to_string()
    })
}

fn validate_graph(graph: &MediaAssetGraph) -> Result<(), String> {
    if graph.schema_version != MEDIA_ASSET_GRAPH_SCHEMA_VERSION {
        return Err(format!(
            "unsupported media asset graph schema {}",
            graph.schema_version
        ));
    }
    for (asset_id, asset) in &graph.assets {
        if asset_id != &asset.asset_id
            || asset.content_digest.len() != 64
            || !asset
                .content_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || asset.object_location != object_location(&asset.content_digest)
            || asset.width == 0
            || asset.height == 0
            || !crate::is_safe_image_content_type(&asset.mime_type)
        {
            return Err(format!("invalid immutable media asset {asset_id}"));
        }
        for parent in &asset.parents {
            let stored_parent = graph.assets.get(&parent.parent_asset_id).ok_or_else(|| {
                format!(
                    "media asset {} references missing parent {}",
                    asset.asset_id, parent.parent_asset_id
                )
            })?;
            if stored_parent.content_digest != parent.parent_digest {
                return Err(format!(
                    "media asset {} parent digest does not match {}",
                    asset.asset_id, parent.parent_asset_id
                ));
            }
        }
    }
    for (subject_key, asset_id) in &graph.canonical {
        let asset = graph.assets.get(asset_id).ok_or_else(|| {
            format!("canonical media pointer {subject_key} references missing {asset_id}")
        })?;
        if subject_key != &canonical_subject_key(asset.subject_kind, asset.subject_id, asset.level)
            || effective_moderation_state(graph, asset) != MediaAssetModerationState::Approved
        {
            return Err(format!("invalid canonical media pointer {subject_key}"));
        }
    }
    for asset_id in graph.assets.keys() {
        validate_lineage_acyclic(graph, asset_id, &mut BTreeSet::new(), &mut BTreeSet::new())?;
    }
    Ok(())
}

fn validate_lineage_acyclic(
    graph: &MediaAssetGraph,
    asset_id: &str,
    visiting: &mut BTreeSet<String>,
    visited: &mut BTreeSet<String>,
) -> Result<(), String> {
    if visited.contains(asset_id) {
        return Ok(());
    }
    if !visiting.insert(asset_id.to_string()) {
        return Err(format!("media asset lineage cycle reached {asset_id}"));
    }
    let asset = graph
        .assets
        .get(asset_id)
        .ok_or_else(|| format!("media asset lineage references missing {asset_id}"))?;
    for parent in &asset.parents {
        validate_lineage_acyclic(graph, &parent.parent_asset_id, visiting, visited)?;
    }
    visiting.remove(asset_id);
    visited.insert(asset_id.to_string());
    Ok(())
}

fn write_immutable_object(
    root: &Path,
    asset: &MediaAssetRecord,
    bytes: &[u8],
) -> Result<(), String> {
    let path = root.join(&asset.object_location);
    if path.exists() {
        let existing = fs::read(&path).map_err(|error| error.to_string())?;
        if sha256_hex(&existing) == asset.content_digest {
            return Ok(());
        }
        return Err(format!(
            "immutable media object {} has changed bytes",
            asset.content_digest
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "immutable media object path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_file_name(format!(
        ".{}.tmp-{}-{}",
        asset.content_digest,
        std::process::id(),
        crate::now_millis()
    ));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error.to_string()
    })
}

fn read_and_verify_object(root: &Path, asset: &MediaAssetRecord) -> Result<Vec<u8>, String> {
    let bytes = fs::read(root.join(&asset.object_location)).map_err(|error| error.to_string())?;
    if sha256_hex(&bytes) != asset.content_digest {
        return Err(format!(
            "immutable media object {} failed digest verification",
            asset.asset_id
        ));
    }
    Ok(bytes)
}

fn immutable_asset_id(
    input: &MediaAssetRegistration,
    revision: u64,
    digest: &str,
    parents: &[MediaAssetParent],
) -> String {
    let lineage = parents
        .iter()
        .map(|parent| {
            format!(
                "{}:{}:{:?}:{}:{}:{}:{}",
                parent.parent_asset_id,
                parent.parent_digest,
                parent.slot,
                parent.order,
                parent.crop.as_deref().unwrap_or(""),
                parent.mask.as_deref().unwrap_or(""),
                parent.transformation
            )
        })
        .collect::<Vec<_>>()
        .join("\u{1f}");
    let identity = format!(
        concat!(
            "{}\0{}\0{}\0{}\0{}\0{:?}",
            "\0{}\0{}\0{}\0{}\0{}\0{}\0{}",
            "\0{}\0{}\0{}\0{}\0{}\0{}"
        ),
        input.subject_kind.as_str(),
        input.subject_id,
        input.level,
        revision,
        digest,
        input.source_kind,
        input.provenance.pack_id,
        input.provenance.pack_version,
        input.provenance.composition_id,
        input.provenance.composition_revision,
        input.provenance.provider,
        input.provenance.model,
        input.provenance.model_version,
        input.provenance.prompt_version,
        input
            .provenance
            .seed
            .map_or_else(String::new, |seed| seed.to_string()),
        input.provenance.prediction_id.as_deref().unwrap_or(""),
        input.provenance.source_event_seq.unwrap_or(0),
        input.provenance.history_through_seq,
        lineage
    );
    format!("media-{}", sha256_hex(identity.as_bytes()))
}

fn canonical_subject_key(
    subject_kind: MediaAssetSubjectKind,
    subject_id: u64,
    level: u8,
) -> String {
    format!("{}:{subject_id}:level:{level}", subject_kind.as_str())
}

fn object_location(digest: &str) -> String {
    format!("{MEDIA_ASSET_OBJECT_PREFIX}/{digest}.image")
}

fn reference_slot_order(slot: MediaReferenceSlot) -> u8 {
    match slot {
        MediaReferenceSlot::Location => 0,
        MediaReferenceSlot::Actor => 1,
        MediaReferenceSlot::Item => 2,
        MediaReferenceSlot::PriorLevel => 3,
        MediaReferenceSlot::Style => 4,
    }
}

fn sha256_hex(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

fn image_dimensions(bytes: &[u8], mime_type: &str) -> Result<(u32, u32), String> {
    let dimensions = match mime_type {
        "image/png" => png_dimensions(bytes),
        "image/gif" => gif_dimensions(bytes),
        "image/jpeg" => jpeg_dimensions(bytes),
        "image/webp" => webp_dimensions(bytes),
        _ => None,
    };
    dimensions
        .filter(|(width, height)| *width > 0 && *height > 0)
        .ok_or_else(|| format!("could not determine dimensions for {mime_type} media asset"))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 || !matches!(&bytes[..6], b"GIF87a" | b"GIF89a") {
        return None;
    }
    Some((
        u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
        u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
    ))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[..2] != [0xff, 0xd8] {
        return None;
    }
    let mut offset = 2;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        offset += 2;
        if matches!(marker, 0xd8 | 0xd9) {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
        if length < 2 || offset + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 7
        {
            let height = u16::from_be_bytes(bytes[offset + 3..offset + 5].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[offset + 5..offset + 7].try_into().ok()?) as u32;
            return Some((width, height));
        }
        offset += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" => Some((
            1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]),
            1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]),
        )),
        b"VP8 " if bytes.len() >= 30 && bytes[23..26] == [0x9d, 0x01, 0x2a] => Some((
            u16::from_le_bytes(bytes[26..28].try_into().ok()?) as u32 & 0x3fff,
            u16::from_le_bytes(bytes[28..30].try_into().ok()?) as u32 & 0x3fff,
        )),
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes(bytes[21..25].try_into().ok()?);
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

    static NEXT_ROOT: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "cosyworld-media-assets-{label}-{}-{}",
            std::process::id(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        root
    }

    fn png(seed: u8) -> Vec<u8> {
        let mut bytes = BASE64_STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XqgWAAAAAElFTkSuQmCC")
            .expect("decode PNG fixture");
        bytes.extend([seed, seed.wrapping_add(1)]);
        bytes
    }

    fn provenance(pack: &str, event: u64) -> MediaAssetProvenance {
        MediaAssetProvenance {
            pack_id: pack.to_string(),
            pack_version: "1.0.0".to_string(),
            composition_id: "world:test".to_string(),
            composition_revision: "sha256:test-composition".to_string(),
            provider: "replicate".to_string(),
            model: "black-forest-labs/flux-dev-lora".to_string(),
            model_version: "flux1-pinned".to_string(),
            prompt_version: "community-art/3".to_string(),
            seed: Some(42),
            prediction_id: Some(format!("prediction-{event}")),
            source_event_seq: Some(event),
            history_through_seq: event.saturating_sub(1),
        }
    }

    fn requirement(
        slot: MediaReferenceSlot,
        kind: MediaAssetSubjectKind,
        id: u64,
    ) -> MediaReferenceRequirement {
        MediaReferenceRequirement {
            slot,
            subject_kind: kind,
            subject_id: id,
            level: 1,
            lifecycle: None,
        }
    }

    fn intent(requirements: Vec<MediaReferenceRequirement>) -> MediaAssetReferenceIntent {
        MediaAssetReferenceIntent {
            world_snapshot_id: "world:test@event:99".to_string(),
            history_through_seq: 99,
            requirements,
        }
    }

    fn approved_generated(
        root: &Path,
        kind: MediaAssetSubjectKind,
        id: u64,
        bytes: &[u8],
        event: u64,
    ) -> String {
        let asset_id = register_source_media_asset(
            root,
            kind,
            id,
            1,
            bytes,
            "image/png",
            MediaAssetSourceKind::Generated,
            Some(MediaAssetRights::generated_public_reference()),
            MediaAssetModerationState::Approved,
            provenance("pack.test", event),
            event,
        )
        .expect("register approved generated asset");
        assert!(immutable_media_asset_bytes(root, &asset_id).is_ok());
        asset_id
    }

    #[test]
    fn backfills_flux1_output_without_regeneration() {
        let root = temp_root("backfill");
        let legacy_dir = root.join("community-art/actor");
        fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        let image_path = legacy_dir.join("5000.image");
        let content_type_path = legacy_dir.join("5000.content-type");
        let metadata_path = legacy_dir.join("5000.metadata.json");
        let bytes = png(1);
        fs::write(&image_path, &bytes).expect("write legacy image");
        fs::write(&content_type_path, "image/png").expect("write legacy MIME");
        fs::write(
            &metadata_path,
            serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "prediction_id": "legacy-flux1-prediction",
                "sha256": sha256_hex(&bytes)
            }))
            .unwrap(),
        )
        .expect("write legacy metadata");
        let provider_spend = AtomicUsize::new(0);

        let asset_id = backfill_legacy_community_asset(
            &root,
            MediaAssetBackfill {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                revision: 1,
                image_path,
                content_type_path,
                metadata_path: Some(metadata_path),
                created_at_ms: 10,
                provenance: MediaAssetProvenance {
                    prediction_id: None,
                    ..provenance("cosyworld.core", 20)
                },
            },
        )
        .expect("backfill approved FLUX.1 output");

        assert_eq!(provider_spend.load(Ordering::SeqCst), 0);
        let graph = load_graph(&root).expect("reload graph after backfill");
        assert_eq!(
            graph.canonical["actor:5000:level:1"], asset_id,
            "backfill moves the canonical pointer without provider work"
        );
        assert_eq!(
            graph.assets[&asset_id].provenance.prediction_id.as_deref(),
            Some("legacy-flux1-prediction")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn replacement_preserves_old_asset_and_moves_only_the_canonical_pointer() {
        let root = temp_root("replacement");
        let first = approved_generated(&root, MediaAssetSubjectKind::Actor, 5000, &png(2), 21);
        let frozen_intent = MediaAssetReferenceIntent {
            world_snapshot_id: "world:test@event:21".to_string(),
            history_through_seq: 21,
            requirements: vec![requirement(
                MediaReferenceSlot::PriorLevel,
                MediaAssetSubjectKind::Actor,
                5000,
            )],
        };
        let before_replacement = resolve_media_references(&root, &frozen_intent, 1)
            .expect("resolve frozen intent before replacement");
        let second = register_generated_media_asset(
            &root,
            "actor",
            5000,
            1,
            &png(3),
            "image/png",
            provenance("pack.test", 22),
        )
        .expect("register replacement candidate");
        approve_media_asset(&root, &second, Some(23), "moderator approved replacement")
            .expect("approve replacement");

        let graph = load_graph(&root).expect("reload replacement graph");
        assert!(graph.assets.contains_key(&first));
        assert!(graph.assets.contains_key(&second));
        assert_eq!(graph.canonical["actor:5000:level:1"], second);
        assert_eq!(graph.assets[&first].revision, 21);
        assert_eq!(graph.assets[&second].revision, 22);
        assert!(graph.canonical_history.iter().any(|entry| {
            entry.previous_asset_id.as_deref() == Some(first.as_str())
                && entry.asset_id.as_deref() == Some(second.as_str())
        }));
        assert!(immutable_media_asset_bytes(&root, &first).is_ok());
        let after_replacement = resolve_media_references(&root, &frozen_intent, 1)
            .expect("same frozen intent resolves after replacement");
        drop(load_graph(&root).expect("restart graph"));
        let after_restart = resolve_media_references(&root, &frozen_intent, 1)
            .expect("same frozen intent resolves after restart");
        assert_eq!(before_replacement, after_replacement);
        assert_eq!(before_replacement, after_restart);
        assert_eq!(before_replacement[0].asset_id, first);
        assert_eq!(
            resolve_media_references(
                &root,
                &intent(vec![requirement(
                    MediaReferenceSlot::PriorLevel,
                    MediaAssetSubjectKind::Actor,
                    5000,
                )]),
                1,
            )
            .expect("latest intent resolves replacement")[0]
                .asset_id,
            second
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejected_pending_replacement_preserves_the_approved_canonical() {
        let root = temp_root("rejected-replacement");
        let approved = approved_generated(&root, MediaAssetSubjectKind::Actor, 5000, &png(61), 210);
        let pending = register_generated_media_asset(
            &root,
            "actor",
            5000,
            1,
            &png(62),
            "image/png",
            provenance("pack.test", 220),
        )
        .expect("stage replacement");

        assert!(reconcile_community_media_asset_status(
            &root,
            "actor",
            5000,
            1,
            "rejected",
            Some("prediction-220"),
            Some(230),
        )
        .expect("reject matching staged replacement"));

        let graph = load_graph(&root).expect("reload rejected replacement graph");
        assert_eq!(graph.canonical["actor:5000:level:1"], approved);
        assert_eq!(
            effective_moderation_state(&graph, &graph.assets[&pending]),
            MediaAssetModerationState::Rejected
        );
        assert!(immutable_media_asset_bytes(&root, &pending).is_ok());
        let reference_intent = MediaAssetReferenceIntent {
            world_snapshot_id: "world:test@event:999".to_string(),
            history_through_seq: 999,
            requirements: vec![requirement(
                MediaReferenceSlot::Actor,
                MediaAssetSubjectKind::Actor,
                5000,
            )],
        };
        assert_eq!(
            resolve_media_references(&root, &reference_intent, 1)
                .expect("prior approved asset remains referenceable")[0]
                .asset_id,
            approved
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn frozen_prior_level_digest_drives_complete_evolution_lineage() {
        let root = temp_root("frozen-evolution");
        let prior = approved_generated(&root, MediaAssetSubjectKind::Actor, 5000, &png(63), 300);
        let frozen = freeze_approved_community_media_reference(&root, "actor", 5000, 1, 320)
            .expect("freeze approved prior level");
        assert_eq!(frozen.asset_id, prior);
        let reference = resolve_frozen_community_media_reference(&root, &frozen, 320)
            .expect("resolve exact frozen prior");
        assert_eq!(reference.slot, MediaReferenceSlot::PriorLevel);
        assert_eq!(reference.digest, frozen.content_digest);

        let mut derived_provenance = provenance("pack.test", 321);
        derived_provenance.history_through_seq = 320;
        let derived = register_derived_community_media_asset(
            &root,
            "actor",
            5000,
            2,
            &png(64),
            "image/png",
            &frozen,
            "2:3",
            derived_provenance,
        )
        .expect("register derived evolution candidate");
        assert!(reconcile_community_media_asset_status(
            &root,
            "actor",
            5000,
            2,
            "ready",
            Some("prediction-321"),
            Some(322),
        )
        .expect("approve derived evolution"));

        let graph = load_graph(&root).expect("reload evolution graph");
        assert_eq!(graph.canonical["actor:5000:level:1"], prior);
        assert_eq!(graph.canonical["actor:5000:level:2"], derived);
        assert_eq!(graph.assets[&derived].parents.len(), 1);
        assert_eq!(graph.assets[&derived].parents[0].parent_asset_id, prior);
        assert_eq!(
            graph.assets[&derived].parents[0].parent_digest,
            frozen.content_digest
        );
        assert_eq!(
            graph.assets[&derived].parents[0].slot,
            MediaReferenceSlot::PriorLevel
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_or_tampered_prior_level_fails_before_provider_resolution() {
        let root = temp_root("missing-prior");
        assert!(freeze_approved_community_media_reference(&root, "item", 7000, 1, 100,).is_err());
        let _ = approved_generated(&root, MediaAssetSubjectKind::Item, 7000, &png(65), 90);
        let mut frozen = freeze_approved_community_media_reference(&root, "item", 7000, 1, 100)
            .expect("freeze item prior");
        frozen.content_digest = "f".repeat(64);
        assert!(resolve_frozen_community_media_reference(&root, &frozen, 100).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn forward_and_reverse_equal_event_approvals_select_the_causal_newest_revision() {
        let roots = [
            temp_root("approval-order-forward"),
            temp_root("approval-order-reverse"),
        ];
        let mut ids = Vec::new();
        for root in &roots {
            let older = register_generated_media_asset(
                root,
                "actor",
                5000,
                1,
                &png(63),
                "image/png",
                provenance("pack.order", 300),
            )
            .expect("stage older causal revision");
            let newer = register_generated_media_asset(
                root,
                "actor",
                5000,
                1,
                &png(64),
                "image/png",
                provenance("pack.order", 301),
            )
            .expect("stage newer causal revision");
            ids.push((older, newer));
        }
        approve_media_asset(&roots[0], &ids[0].0, Some(400), "approve older")
            .expect("approve older first");
        approve_media_asset(&roots[0], &ids[0].1, Some(400), "approve newer")
            .expect("approve newer second");
        approve_media_asset(&roots[1], &ids[1].1, Some(400), "approve newer")
            .expect("approve newer first");
        approve_media_asset(&roots[1], &ids[1].0, Some(400), "approve older")
            .expect("approve older second as no-op");

        assert_eq!(ids[0], ids[1], "asset IDs are ingestion-order stable");
        let reference_intent = MediaAssetReferenceIntent {
            world_snapshot_id: "world:test@event:400".to_string(),
            history_through_seq: 400,
            requirements: vec![requirement(
                MediaReferenceSlot::Actor,
                MediaAssetSubjectKind::Actor,
                5000,
            )],
        };
        for (root, (_, newer)) in roots.iter().zip(&ids) {
            let graph = load_graph(root).expect("load approval-order graph");
            assert_eq!(graph.canonical["actor:5000:level:1"], *newer);
            assert_eq!(
                resolve_media_references(root, &reference_intent, 1)
                    .expect("resolve equal-event canonical")[0]
                    .asset_id,
                *newer
            );
        }
        assert!(
            !load_graph(&roots[1])
                .expect("reload reverse graph")
                .canonical_history
                .iter()
                .any(|entry| entry.asset_id.as_deref() == Some(ids[1].0.as_str())),
            "approving an older revision after the pointer advanced records no transition"
        );
        for root in roots {
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn derived_asset_exposes_complete_digest_and_role_lineage() {
        let root = temp_root("lineage");
        let location = approved_generated(&root, MediaAssetSubjectKind::Location, 1, &png(4), 30);
        let actor = approved_generated(&root, MediaAssetSubjectKind::Actor, 5000, &png(5), 31);
        let derived = register_derived_media_asset(
            &root,
            MediaAssetSubjectKind::Actor,
            5000,
            2,
            &png(6),
            "image/png",
            vec![
                MediaAssetParentInput {
                    parent_asset_id: location.clone(),
                    slot: MediaReferenceSlot::Location,
                    order: 0,
                    crop: Some("center".to_string()),
                    mask: None,
                    transformation: "fit_reference".to_string(),
                },
                MediaAssetParentInput {
                    parent_asset_id: actor.clone(),
                    slot: MediaReferenceSlot::PriorLevel,
                    order: 1,
                    crop: None,
                    mask: Some("subject".to_string()),
                    transformation: "preserve_identity".to_string(),
                },
            ],
            provenance("pack.test", 32),
            32,
        )
        .expect("register derived asset");
        approve_media_asset(&root, &derived, Some(33), "derived image approved")
            .expect("approve derived asset");

        let lineage = complete_lineage(&root, &derived).expect("resolve full lineage");
        assert_eq!(lineage.len(), 3);
        let edges = &lineage[&derived].parents;
        assert_eq!(edges[0].slot, MediaReferenceSlot::Location);
        assert_eq!(edges[0].parent_digest, lineage[&location].content_digest);
        assert_eq!(edges[1].slot, MediaReferenceSlot::PriorLevel);
        assert_eq!(edges[1].parent_digest, lineage[&actor].content_digest);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authored_on_chain_and_imported_assets_default_to_non_derivable() {
        for (index, source_kind) in [
            MediaAssetSourceKind::Authored,
            MediaAssetSourceKind::OnChain,
            MediaAssetSourceKind::Imported,
        ]
        .into_iter()
        .enumerate()
        {
            let root = temp_root(&format!("rights-{index}"));
            register_source_media_asset(
                &root,
                MediaAssetSubjectKind::Item,
                100 + index as u64,
                1,
                &png(10 + index as u8),
                "image/png",
                source_kind,
                None,
                MediaAssetModerationState::Approved,
                provenance("pack.rights", 40 + index as u64),
                40 + index as u64,
            )
            .expect("register non-generated source");
            let error = resolve_media_references(
                &root,
                &intent(vec![requirement(
                    MediaReferenceSlot::Item,
                    MediaAssetSubjectKind::Item,
                    100 + index as u64,
                )]),
                1,
            )
            .expect_err("default rights must fail closed");
            assert_eq!(error.code(), "media_reference_rights_ineligible");
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn pending_rejected_private_and_deleted_assets_never_resolve() {
        for (index, state) in [
            MediaAssetModerationState::Pending,
            MediaAssetModerationState::Rejected,
            MediaAssetModerationState::Private,
            MediaAssetModerationState::Deleted,
        ]
        .into_iter()
        .enumerate()
        {
            let root = temp_root(&format!("moderation-{index}"));
            let id = 200 + index as u64;
            let asset = register_generated_media_asset(
                &root,
                "actor",
                id,
                1,
                &png(20 + index as u8),
                "image/png",
                provenance("pack.moderation", 50 + index as u64),
            )
            .expect("register pending generated asset");
            if state != MediaAssetModerationState::Pending {
                approve_media_asset(&root, &asset, Some(60), "initial approval")
                    .expect("approve before later moderation");
                mark_canonical_media_asset_moderation(
                    &root,
                    "actor",
                    id,
                    1,
                    state,
                    Some(61),
                    "fixture moderation",
                )
                .expect("append moderation decision");
            }
            let error = resolve_media_references(
                &root,
                &intent(vec![requirement(
                    MediaReferenceSlot::Actor,
                    MediaAssetSubjectKind::Actor,
                    id,
                )]),
                1,
            )
            .expect_err("ineligible moderation must fail closed");
            assert!(matches!(
                error,
                MediaAssetResolutionError::MissingReference(_)
                    | MediaAssetResolutionError::IneligibleModeration(_)
            ));
            let graph = load_graph(&root).expect("reload moderated graph");
            assert!(graph.assets.contains_key(&asset));
            assert!(immutable_media_asset_bytes(&root, &asset).is_ok());
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn restart_replay_mount_order_and_cache_eviction_keep_resolution_stable() {
        let roots = [temp_root("stable-a"), temp_root("stable-b")];
        let registrations = [
            (
                MediaAssetSubjectKind::Location,
                1,
                png(31),
                71,
                MediaReferenceSlot::Location,
            ),
            (
                MediaAssetSubjectKind::Actor,
                5000,
                png(32),
                72,
                MediaReferenceSlot::Actor,
            ),
            (
                MediaAssetSubjectKind::Item,
                90,
                png(33),
                73,
                MediaReferenceSlot::Item,
            ),
        ];
        for registration in &registrations {
            approved_generated(
                &roots[0],
                registration.0,
                registration.1,
                &registration.2,
                registration.3,
            );
        }
        for registration in registrations.iter().rev() {
            approved_generated(
                &roots[1],
                registration.0,
                registration.1,
                &registration.2,
                registration.3,
            );
        }
        let same_subject_revisions = [(png(34), 74), (png(35), 75)];
        let forward_ids = same_subject_revisions
            .iter()
            .map(|(bytes, event)| {
                approved_generated(&roots[0], MediaAssetSubjectKind::Actor, 5001, bytes, *event)
            })
            .collect::<BTreeSet<_>>();
        let reverse_ids = same_subject_revisions
            .iter()
            .rev()
            .map(|(bytes, event)| {
                approved_generated(&roots[1], MediaAssetSubjectKind::Actor, 5001, bytes, *event)
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(
            forward_ids, reverse_ids,
            "causal revisions make same-subject IDs mount-order independent"
        );
        let same_subject_intent = intent(vec![requirement(
            MediaReferenceSlot::Actor,
            MediaAssetSubjectKind::Actor,
            5001,
        )]);
        assert_eq!(
            resolve_media_references(&roots[0], &same_subject_intent, 1)
                .expect("forward same-subject resolution"),
            resolve_media_references(&roots[1], &same_subject_intent, 1)
                .expect("reverse same-subject resolution"),
            "same-subject canonical selection follows causal provenance, not insertion order"
        );
        let requested = registrations
            .iter()
            .rev()
            .map(|registration| requirement(registration.4, registration.0, registration.1))
            .collect::<Vec<_>>();
        let first =
            resolve_media_references(&roots[0], &intent(requested.clone()), 4).expect("resolve A");
        let second =
            resolve_media_references(&roots[1], &intent(requested.clone()), 4).expect("resolve B");
        assert_eq!(
            first, second,
            "pack mount/insertion order cannot affect refs"
        );
        drop(load_graph(&roots[0]).expect("restart reload"));
        let _ = fs::remove_dir_all(roots[0].join("media-assets/cache"));
        let after_restart = resolve_media_references(&roots[0], &intent(requested), 4)
            .expect("resolve after cache");
        assert_eq!(first, after_restart);
        for root in roots {
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn missing_and_over_budget_intents_fail_before_provider_spend() {
        let root = temp_root("no-spend");
        approved_generated(&root, MediaAssetSubjectKind::Actor, 5000, &png(40), 80);
        let registry = MediaRecipeRegistry::embedded().expect("registry");
        let controls = MediaRecipeRuntimeControls::default();
        let spend = AtomicUsize::new(0);
        let job = |requirements| AuthoritativeMediaJobRequest {
            job_key: "reference-job".to_string(),
            profile: "cosyworld.community-art.reference/1".to_string(),
            operation: MediaOperation::MultiReference,
            intent: MediaIntent::Evolution,
            prompt: "compose references".to_string(),
            reference_intent: intent(requirements),
            aspect_ratio: "4:5".to_string(),
            output_format: "png".to_string(),
            mask_url: None,
            seed: Some(1),
        };
        let missing_result = registry.resolve_authoritative_job(
            &controls,
            &root,
            job(vec![
                requirement(
                    MediaReferenceSlot::Actor,
                    MediaAssetSubjectKind::Actor,
                    5000,
                ),
                requirement(MediaReferenceSlot::Item, MediaAssetSubjectKind::Item, 999),
            ]),
        );
        if missing_result.is_ok() {
            spend.fetch_add(1, Ordering::SeqCst);
        }
        let missing = missing_result.expect_err("missing reference");
        assert_eq!(missing.code(), "media_reference_missing");
        let over_budget_result = registry.resolve_authoritative_job(
            &controls,
            &root,
            job((1..=5)
                .map(|id| requirement(MediaReferenceSlot::Actor, MediaAssetSubjectKind::Actor, id))
                .collect()),
        );
        if over_budget_result.is_ok() {
            spend.fetch_add(1, Ordering::SeqCst);
        }
        let over_budget = over_budget_result.expect_err("over budget");
        assert_eq!(over_budget.code(), "media_composition_plan_required");
        assert_eq!(spend.load(Ordering::SeqCst), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn media_graph_changes_no_world_journal_inventory_level_location_or_owner_state() {
        let root = temp_root("world-neutral");
        let runtime = crate::RuntimeWorld::seeded();
        let before = serde_json::to_vec(&crate::RuntimeSnapshot::from_runtime(&runtime))
            .expect("snapshot before asset update");
        approved_generated(&root, MediaAssetSubjectKind::Location, 1, &png(50), 90);
        let after = serde_json::to_vec(&crate::RuntimeSnapshot::from_runtime(&runtime))
            .expect("snapshot after asset update");
        assert_eq!(before, after);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lifecycle_holds_reconcile_idempotently_from_durable_ready_and_rejected_state() {
        let root = temp_root("lifecycle-reconciliation");
        let asset = register_generated_media_asset(
            &root,
            "actor",
            5000,
            1,
            &png(60),
            "image/png",
            provenance("pack.lifecycle", 100),
        )
        .expect("stage pending generated output");
        let mut lifecycle_requirement = requirement(
            MediaReferenceSlot::Actor,
            MediaAssetSubjectKind::Actor,
            5000,
        );
        lifecycle_requirement.lifecycle = Some(MediaReferenceLifecycleClaim {
            status: "ready".to_string(),
            prediction_id: Some("prediction-100".to_string()),
            source_event_seq: Some(101),
        });
        let reference_intent = MediaAssetReferenceIntent {
            world_snapshot_id: "world:test@event:200".to_string(),
            history_through_seq: 200,
            requirements: vec![lifecycle_requirement],
        };
        let unresolved_intent = MediaAssetReferenceIntent {
            requirements: reference_intent
                .requirements
                .iter()
                .cloned()
                .map(|mut requirement| {
                    requirement.lifecycle = None;
                    requirement
                })
                .collect(),
            ..reference_intent.clone()
        };
        assert!(resolve_media_references(&root, &unresolved_intent, 1).is_err());

        drop(load_graph(&root).expect("restart with journal ready but graph pending"));
        let ready = resolve_media_references(&root, &reference_intent, 1)
            .expect("provider boundary reconciles durable ready state after restart");
        assert_eq!(ready[0].asset_id, asset);

        hold_community_media_asset_references(
            &root,
            "actor",
            5000,
            1,
            "moderation transaction in flight",
        )
        .expect("hold before moderation commit");
        assert!(matches!(
            resolve_media_references(&root, &unresolved_intent, 1),
            Err(MediaAssetResolutionError::IneligibleModeration(_))
        ));
        drop(load_graph(&root).expect("restart after crash before moderation commit"));
        assert!(
            resolve_media_references(&root, &reference_intent, 1).is_ok(),
            "provider boundary releases an orphaned hold from durable ready state"
        );

        hold_community_media_asset_references(
            &root,
            "actor",
            5000,
            1,
            "moderation transaction in flight",
        )
        .expect("hold before committed rejection");
        let mut rejected_intent = reference_intent.clone();
        rejected_intent.requirements[0].lifecycle = Some(MediaReferenceLifecycleClaim {
            status: "rejected".to_string(),
            prediction_id: Some("prediction-100".to_string()),
            source_event_seq: Some(102),
        });
        assert!(resolve_media_references(&root, &rejected_intent, 1).is_err());
        drop(load_graph(&root).expect("restart after rejection"));
        assert!(resolve_media_references(&root, &rejected_intent, 1).is_err());
        assert!(
            resolve_media_references(&root, &reference_intent, 1).is_err(),
            "stale ready evidence cannot re-approve a terminal rejection"
        );
        assert!(immutable_media_asset_bytes(&root, &asset).is_ok());
        let _ = fs::remove_dir_all(root);
    }
}
