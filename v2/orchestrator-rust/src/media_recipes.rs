use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};

use reqwest::header;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    community_art::{community_art_generation_key, DownloadedReplicateImage},
    is_safe_image_content_type,
    media_evolution::{
        FrozenCommunityArtEvolutionJob, EVOLUTION_CANARY_MODEL_REVISION, EVOLUTION_CANARY_RECIPE,
    },
    ReplicateAvatarArtConfig,
};

#[allow(dead_code)]
mod assets;
pub(crate) mod media_verdict;
pub(super) use self::assets::{
    backfill_legacy_community_asset, canonical_community_media_asset_bytes,
    freeze_approved_community_media_reference, hold_community_media_asset_references,
    immutable_media_asset_bytes, reconcile_community_media_asset_status,
    register_derived_community_media_asset, register_derived_room_scene_media_asset,
    register_generated_media_asset, release_community_media_asset_reference_hold,
    resolve_frozen_community_media_reference, resolve_frozen_media_reference,
    FrozenMediaAssetReference, MediaAssetBackfill, MediaAssetProvenance,
};

const EMBEDDED_MEDIA_RECIPE_REGISTRY: &str = include_str!("../../media/recipes.json");
pub(super) const BASE_COMMUNITY_ART_PROFILE: &str = "cosyworld.community-art.base/1";
const MAX_REPLICATE_AVATAR_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum MediaOperation {
    BaseGeneration,
    SingleReference,
    MultiReference,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) enum MediaIntent {
    #[serde(rename = "avatar_card_art")]
    Avatar,
    #[serde(rename = "item_card_art")]
    Item,
    #[serde(rename = "location_card_art")]
    Location,
    #[serde(rename = "evolution_card_art")]
    Evolution,
    #[serde(rename = "room_scene")]
    RoomScene,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum MediaReferenceSlot {
    Location,
    Actor,
    Item,
    PriorLevel,
    Style,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum MediaRecipeState {
    Enabled,
    Canary,
    Disabled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct MediaReference {
    pub(super) slot: MediaReferenceSlot,
    pub(super) source_id: String,
    pub(super) asset_id: String,
    pub(super) digest: String,
    pub(super) url: String,
    pub(super) format: String,
    #[serde(skip)]
    authorization: MediaReferenceAuthorization,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct MediaReferenceAuthorization {
    token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaModel {
    owner: String,
    name: String,
    revision: String,
    revision_source: String,
    invocation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaReferenceCapabilities {
    minimum: usize,
    maximum: usize,
    input_field: Option<String>,
    ordering: String,
    prompt_semantics: String,
    supported_slots: Vec<MediaReferenceSlot>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct MediaDimensions {
    minimum: u32,
    maximum: u32,
    multiple: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaRetryPolicy {
    maximum_attempts: u8,
    transient_only: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct MediaLoraInputs {
    weights_input: String,
    scale_input: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaOutputPolicy {
    normalization: String,
    stable_storage: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MediaRecipe {
    id: String,
    profile: String,
    provider: String,
    model: MediaModel,
    state: MediaRecipeState,
    operations: Vec<MediaOperation>,
    intents: Vec<MediaIntent>,
    references: MediaReferenceCapabilities,
    input_formats: Vec<String>,
    aspect_ratios: Vec<String>,
    dimensions: MediaDimensions,
    output_formats: Vec<String>,
    supports_masks: bool,
    seed_behavior: String,
    timeout_seconds: u64,
    cost_class: String,
    concurrency: u8,
    retry: MediaRetryPolicy,
    prompt_template_version: String,
    lora: Option<MediaLoraInputs>,
    output: MediaOutputPolicy,
    fallback_recipe: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct MediaProfile {
    id: String,
    default_recipe: String,
    allowed_recipes: Vec<String>,
    operations: Vec<MediaOperation>,
    intents: Vec<MediaIntent>,
    reference_slots: Vec<MediaReferenceSlot>,
    maximum_references: usize,
}

#[derive(Clone, Debug, Deserialize)]
struct MediaRecipeRegistryDocument {
    schema_version: u8,
    profiles: Vec<MediaProfile>,
    recipes: Vec<MediaRecipe>,
}

#[derive(Clone, Debug)]
pub(super) struct MediaRecipeRegistry {
    profiles: BTreeMap<String, MediaProfile>,
    recipes: BTreeMap<String, MediaRecipe>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MediaRecipeRuntimeControls {
    #[serde(default)]
    disabled_recipes: BTreeSet<String>,
    #[serde(default)]
    profile_overrides: BTreeMap<String, String>,
    #[serde(default)]
    canaries: BTreeMap<String, MediaRecipeCanary>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaRecipeCanary {
    recipe: String,
    percent: u8,
}

#[derive(Clone, Debug)]
pub(super) struct MediaJobRequest {
    pub(super) job_key: String,
    pub(super) profile: String,
    pub(super) operation: MediaOperation,
    pub(super) intent: MediaIntent,
    pub(super) prompt: String,
    pub(super) references: Vec<MediaReference>,
    pub(super) aspect_ratio: String,
    pub(super) output_format: String,
    pub(super) mask_url: Option<String>,
    pub(super) seed: Option<u64>,
}

fn certified_media_reference(
    slot: MediaReferenceSlot,
    source_id: String,
    asset_id: String,
    digest: String,
    url: String,
    format: String,
) -> MediaReference {
    let token = media_reference_authorization(&slot, &asset_id, &digest, &url);
    MediaReference {
        slot,
        source_id,
        asset_id,
        digest,
        url,
        format,
        authorization: MediaReferenceAuthorization { token },
    }
}

fn media_reference_authorization(
    slot: &MediaReferenceSlot,
    asset_id: &str,
    digest: &str,
    url: &str,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{slot:?}\0{asset_id}\0{digest}\0{url}").as_bytes())
    )
}

fn media_reference_is_authorized(reference: &MediaReference) -> bool {
    reference.authorization.token
        == media_reference_authorization(
            &reference.slot,
            &reference.asset_id,
            &reference.digest,
            &reference.url,
        )
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct ResolvedMediaJob {
    pub(super) job_key: String,
    pub(super) profile: String,
    pub(super) recipe_id: String,
    pub(super) provider: String,
    pub(super) model_owner: String,
    pub(super) model_name: String,
    pub(super) model_revision: String,
    pub(super) model_revision_source: String,
    pub(super) model_invocation: String,
    pub(super) operation: MediaOperation,
    pub(super) intent: MediaIntent,
    pub(super) reference_minimum: usize,
    pub(super) reference_maximum: usize,
    pub(super) reference_input_field: Option<String>,
    pub(super) reference_ordering: String,
    pub(super) reference_prompt_semantics: String,
    pub(super) supported_reference_slots: Vec<MediaReferenceSlot>,
    pub(super) references: Vec<MediaReference>,
    pub(super) prompt: String,
    pub(super) supported_input_formats: Vec<String>,
    pub(super) supported_aspect_ratios: Vec<String>,
    pub(super) dimensions: MediaDimensions,
    pub(super) aspect_ratio: String,
    pub(super) supported_output_formats: Vec<String>,
    pub(super) output_format: String,
    pub(super) supports_masks: bool,
    pub(super) mask_url: Option<String>,
    pub(super) seed_behavior: String,
    pub(super) seed: Option<u64>,
    pub(super) timeout_seconds: u64,
    pub(super) cost_class: String,
    pub(super) concurrency: u8,
    pub(super) maximum_attempts: u8,
    pub(super) retry_transient_only: bool,
    pub(super) prompt_template_version: String,
    pub(super) lora: Option<MediaLoraInputs>,
    pub(super) output_normalization: String,
    pub(super) stable_storage: String,
}

#[derive(Debug, Eq, PartialEq)]
struct ReplicatePredictionRequest {
    url: String,
    body: serde_json::Value,
}

impl MediaRecipeRuntimeControls {
    pub(super) fn from_env() -> Result<Self, String> {
        let Ok(raw) = std::env::var("COSYWORLD_MEDIA_RECIPE_CONTROLS_JSON") else {
            return Ok(Self::default());
        };
        if raw.trim().is_empty() {
            return Ok(Self::default());
        }
        Self::from_json(&raw)
    }

    fn from_json(raw: &str) -> Result<Self, String> {
        serde_json::from_str(raw)
            .map_err(|error| format!("COSYWORLD_MEDIA_RECIPE_CONTROLS_JSON: {error}"))
    }
}

impl MediaRecipeRegistry {
    pub(super) fn embedded() -> Result<Self, String> {
        let document: MediaRecipeRegistryDocument =
            serde_json::from_str(EMBEDDED_MEDIA_RECIPE_REGISTRY)
                .map_err(|error| format!("embedded media recipe registry: {error}"))?;
        Self::from_document(document)
    }

    fn from_document(document: MediaRecipeRegistryDocument) -> Result<Self, String> {
        if document.schema_version != 1 {
            return Err(format!(
                "media recipe registry schema {} is unsupported",
                document.schema_version
            ));
        }
        let mut recipes = BTreeMap::new();
        for recipe in document.recipes {
            validate_recipe(&recipe)?;
            let recipe_id = recipe.id.clone();
            if recipes.insert(recipe_id.clone(), recipe).is_some() {
                return Err(format!("duplicate media recipe {recipe_id}"));
            }
        }
        let mut profiles = BTreeMap::new();
        for profile in document.profiles {
            if profile.id.trim().is_empty()
                || profile.allowed_recipes.is_empty()
                || profile.operations.is_empty()
                || profile.intents.is_empty()
            {
                return Err(
                    "media profile id, recipes, operations, and intents are required".to_string(),
                );
            }
            if !profile
                .allowed_recipes
                .iter()
                .any(|recipe| recipe == &profile.default_recipe)
            {
                return Err(format!(
                    "media profile {} default recipe {} is not allowlisted",
                    profile.id, profile.default_recipe
                ));
            }
            for recipe_id in &profile.allowed_recipes {
                if !recipes.contains_key(recipe_id) {
                    return Err(format!(
                        "media profile {} references unknown recipe {recipe_id}",
                        profile.id
                    ));
                }
            }
            let profile_id = profile.id.clone();
            if profiles.insert(profile_id.clone(), profile).is_some() {
                return Err(format!("duplicate media profile {profile_id}"));
            }
        }
        for recipe in recipes.values() {
            if !profiles.contains_key(&recipe.profile) {
                return Err(format!(
                    "media recipe {} references unknown profile {}",
                    recipe.id, recipe.profile
                ));
            }
            if let Some(fallback) = recipe.fallback_recipe.as_deref() {
                if !recipes.contains_key(fallback) {
                    return Err(format!(
                        "media recipe {} references unknown fallback {fallback}",
                        recipe.id
                    ));
                }
            }
        }
        for recipe in recipes.values() {
            let mut visited = BTreeSet::new();
            let mut cursor = recipe;
            while let Some(fallback) = cursor.fallback_recipe.as_deref() {
                if !visited.insert(cursor.id.clone()) {
                    return Err(format!("media recipe fallback cycle reached {}", cursor.id));
                }
                cursor = recipes
                    .get(fallback)
                    .expect("fallback existence was validated");
            }
        }
        for profile in profiles.values() {
            for recipe_id in &profile.allowed_recipes {
                if let Some(fallback) = recipes[recipe_id].fallback_recipe.as_deref() {
                    if !profile
                        .allowed_recipes
                        .iter()
                        .any(|allowed| allowed == fallback)
                    {
                        return Err(format!(
                            "media profile {} does not allow fallback recipe {fallback}",
                            profile.id
                        ));
                    }
                }
            }
        }
        Ok(Self { profiles, recipes })
    }

    fn validate_controls(&self, controls: &MediaRecipeRuntimeControls) -> Result<(), String> {
        for recipe_id in &controls.disabled_recipes {
            if !self.recipes.contains_key(recipe_id) {
                return Err(format!(
                    "media recipe controls reference unknown disabled recipe {recipe_id}"
                ));
            }
        }
        for (profile_id, recipe_id) in &controls.profile_overrides {
            self.validate_control_target("override", profile_id, recipe_id)?;
        }
        for (profile_id, canary) in &controls.canaries {
            if canary.percent > 100 {
                return Err(format!(
                    "media profile {profile_id} canary percent {} exceeds 100",
                    canary.percent
                ));
            }
            self.validate_control_target("canary", profile_id, &canary.recipe)?;
        }
        Ok(())
    }

    fn validate_control_target(
        &self,
        control_kind: &str,
        profile_id: &str,
        recipe_id: &str,
    ) -> Result<(), String> {
        let profile = self.profiles.get(profile_id).ok_or_else(|| {
            format!("media recipe {control_kind} references unknown profile {profile_id}")
        })?;
        if !self.recipes.contains_key(recipe_id) {
            return Err(format!(
                "media recipe {control_kind} references unknown recipe {recipe_id}"
            ));
        }
        if !profile
            .allowed_recipes
            .iter()
            .any(|allowed| allowed == recipe_id)
        {
            return Err(format!(
                "media profile {profile_id} does not allow {control_kind} recipe {recipe_id}"
            ));
        }
        Ok(())
    }

    pub(super) fn resolve(
        &self,
        controls: &MediaRecipeRuntimeControls,
        request: MediaJobRequest,
    ) -> Result<ResolvedMediaJob, String> {
        self.validate_controls(controls)?;
        let profile = self
            .profiles
            .get(&request.profile)
            .ok_or_else(|| format!("unknown media profile {}", request.profile))?;
        validate_profile_job(profile, &request)?;
        let selected = if let Some(recipe) = controls.profile_overrides.get(&profile.id) {
            recipe.clone()
        } else if let Some(canary) = controls.canaries.get(&profile.id) {
            if deterministic_canary_bucket(&request.job_key) < canary.percent {
                canary.recipe.clone()
            } else {
                profile.default_recipe.clone()
            }
        } else {
            profile.default_recipe.clone()
        };
        if !profile
            .allowed_recipes
            .iter()
            .any(|recipe| recipe == &selected)
        {
            return Err(format!(
                "media profile {} does not allow recipe {selected}",
                profile.id
            ));
        }
        let mut recipe = self
            .recipes
            .get(&selected)
            .ok_or_else(|| format!("unknown media recipe {selected}"))?;
        let mut visited = BTreeSet::new();
        while recipe.state == MediaRecipeState::Disabled
            || controls.disabled_recipes.contains(&recipe.id)
        {
            if !visited.insert(recipe.id.clone()) {
                return Err(format!("media recipe fallback cycle reached {}", recipe.id));
            }
            let fallback = recipe.fallback_recipe.as_deref().ok_or_else(|| {
                format!("media recipe {} is disabled with no fallback", recipe.id)
            })?;
            if !profile
                .allowed_recipes
                .iter()
                .any(|recipe| recipe == fallback)
            {
                return Err(format!(
                    "media profile {} does not allow fallback recipe {fallback}",
                    profile.id
                ));
            }
            recipe = self
                .recipes
                .get(fallback)
                .ok_or_else(|| format!("unknown media fallback recipe {fallback}"))?;
        }
        validate_job(recipe, &request)?;
        Ok(ResolvedMediaJob {
            job_key: request.job_key,
            profile: request.profile,
            recipe_id: recipe.id.clone(),
            provider: recipe.provider.clone(),
            model_owner: recipe.model.owner.clone(),
            model_name: recipe.model.name.clone(),
            model_revision: recipe.model.revision.clone(),
            model_revision_source: recipe.model.revision_source.clone(),
            model_invocation: recipe.model.invocation.clone(),
            operation: request.operation,
            intent: request.intent,
            reference_minimum: recipe.references.minimum,
            reference_maximum: recipe.references.maximum,
            reference_input_field: recipe.references.input_field.clone(),
            reference_ordering: recipe.references.ordering.clone(),
            reference_prompt_semantics: recipe.references.prompt_semantics.clone(),
            supported_reference_slots: recipe.references.supported_slots.clone(),
            references: request.references,
            prompt: request.prompt,
            supported_input_formats: recipe.input_formats.clone(),
            supported_aspect_ratios: recipe.aspect_ratios.clone(),
            dimensions: recipe.dimensions.clone(),
            aspect_ratio: request.aspect_ratio,
            supported_output_formats: recipe.output_formats.clone(),
            output_format: request.output_format,
            supports_masks: recipe.supports_masks,
            mask_url: request.mask_url,
            seed_behavior: recipe.seed_behavior.clone(),
            seed: request.seed,
            timeout_seconds: recipe.timeout_seconds,
            cost_class: recipe.cost_class.clone(),
            concurrency: recipe.concurrency,
            maximum_attempts: recipe.retry.maximum_attempts,
            retry_transient_only: recipe.retry.transient_only,
            prompt_template_version: recipe.prompt_template_version.clone(),
            lora: recipe.lora.clone(),
            output_normalization: recipe.output.normalization.clone(),
            stable_storage: recipe.output.stable_storage.clone(),
        })
    }
}

impl ResolvedMediaJob {
    pub(super) fn provider_input(
        &self,
    ) -> Result<serde_json::Map<String, serde_json::Value>, String> {
        let mut input = serde_json::Map::new();
        input.insert(
            "prompt".to_string(),
            serde_json::Value::String(self.prompt.clone()),
        );
        input.insert(
            "aspect_ratio".to_string(),
            serde_json::Value::String(self.aspect_ratio.clone()),
        );
        input.insert(
            "output_format".to_string(),
            serde_json::Value::String(self.output_format.clone()),
        );
        if !self.references.is_empty() {
            let field = self.reference_input_field.as_ref().ok_or_else(|| {
                format!(
                    "media recipe {} has references but no provider input field",
                    self.recipe_id
                )
            })?;
            input.insert(
                field.clone(),
                serde_json::Value::Array(
                    self.references
                        .iter()
                        .map(|reference| serde_json::Value::String(reference.url.clone()))
                        .collect(),
                ),
            );
        }
        if let Some(mask_url) = self.mask_url.as_ref() {
            input.insert(
                "mask".to_string(),
                serde_json::Value::String(mask_url.clone()),
            );
        }
        if let Some(seed) = self.seed {
            input.insert("seed".to_string(), serde_json::Value::Number(seed.into()));
        }
        Ok(input)
    }
}

fn validate_recipe(recipe: &MediaRecipe) -> Result<(), String> {
    if recipe.id.trim().is_empty()
        || recipe.profile.trim().is_empty()
        || recipe.provider.trim().is_empty()
        || recipe.model.owner.trim().is_empty()
        || recipe.model.name.trim().is_empty()
        || recipe.model.revision.len() != 64
        || !recipe
            .model
            .revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || !recipe.model.revision_source.starts_with("https://")
        || !matches!(
            recipe.model.invocation.as_str(),
            "official_model" | "pinned_version"
        )
    {
        return Err(format!(
            "media recipe {} has incomplete exact model identity",
            recipe.id
        ));
    }
    if recipe.operations.is_empty()
        || recipe.intents.is_empty()
        || recipe.aspect_ratios.is_empty()
        || recipe.output_formats.is_empty()
        || recipe.references.minimum > recipe.references.maximum
        || recipe.dimensions.minimum > recipe.dimensions.maximum
        || recipe.dimensions.multiple == 0
        || recipe.timeout_seconds == 0
        || recipe.concurrency == 0
        || recipe.retry.maximum_attempts == 0
        || !recipe.retry.transient_only
        || recipe.references.ordering != "caller"
        || !matches!(
            recipe.references.prompt_semantics.as_str(),
            "none" | "indexed_image_1"
        )
        || !matches!(recipe.seed_behavior.as_str(), "unsupported" | "optional")
        || recipe.output.stable_storage != "required"
        || !matches!(
            recipe.output.normalization.as_str(),
            "first_url" | "single_url"
        )
    {
        return Err(format!(
            "media recipe {} has an incomplete capability contract",
            recipe.id
        ));
    }
    if recipe.references.maximum == 0 && recipe.references.input_field.is_some() {
        return Err(format!(
            "media recipe {} declares a reference input for zero references",
            recipe.id
        ));
    }
    if recipe.references.maximum > 0 && recipe.references.input_field.is_none() {
        return Err(format!(
            "media recipe {} lacks a reference input field",
            recipe.id
        ));
    }
    if let Some(lora) = recipe.lora.as_ref() {
        if lora.weights_input.trim().is_empty() || lora.scale_input.trim().is_empty() {
            return Err(format!(
                "media recipe {} has incomplete LoRA inputs",
                recipe.id
            ));
        }
    }
    Ok(())
}

fn validate_job(recipe: &MediaRecipe, request: &MediaJobRequest) -> Result<(), String> {
    if !recipe.operations.contains(&request.operation) {
        return Err(format!(
            "media recipe {} does not support operation {:?}",
            recipe.id, request.operation
        ));
    }
    if !recipe.intents.contains(&request.intent) {
        return Err(format!(
            "media recipe {} does not support intent {:?}",
            recipe.id, request.intent
        ));
    }
    let reference_count = request.references.len();
    let expected_count = match request.operation {
        MediaOperation::BaseGeneration => 0..=0,
        MediaOperation::SingleReference => 1..=1,
        MediaOperation::MultiReference => 2..=usize::MAX,
    };
    if !expected_count.contains(&reference_count) {
        return Err(format!(
            "media operation {:?} requires a different reference count; got {reference_count}",
            request.operation
        ));
    }
    if reference_count < recipe.references.minimum || reference_count > recipe.references.maximum {
        return Err(format!(
            "media recipe {} supports {}..={} references; got {reference_count}",
            recipe.id, recipe.references.minimum, recipe.references.maximum
        ));
    }
    let mut source_ids = BTreeSet::new();
    for (index, reference) in request.references.iter().enumerate() {
        if reference.source_id.trim().is_empty()
            || reference.asset_id.trim().is_empty()
            || reference.digest.len() != 64
            || !reference
                .digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || !media_reference_is_authorized(reference)
            || !source_ids.insert(&reference.source_id)
        {
            return Err(format!(
                "media reference {} is uncertified, malformed, or duplicates a source id",
                index + 1
            ));
        }
        if !recipe.references.supported_slots.contains(&reference.slot) {
            return Err(format!(
                "media recipe {} does not support reference slot {:?} at index {}",
                recipe.id,
                reference.slot,
                index + 1
            ));
        }
        if !recipe.input_formats.iter().any(|format| {
            format.eq_ignore_ascii_case(reference.format.trim_start_matches("image/"))
        }) {
            return Err(format!(
                "media recipe {} does not support reference format {} at index {}",
                recipe.id,
                reference.format,
                index + 1
            ));
        }
        if !reference.url.starts_with("https://") && !reference.url.starts_with("data:image/") {
            return Err(format!(
                "media reference {} must use an https or image data URL",
                index + 1
            ));
        }
    }
    if !recipe
        .aspect_ratios
        .iter()
        .any(|value| value == &request.aspect_ratio)
    {
        return Err(format!(
            "media recipe {} does not support aspect ratio {}",
            recipe.id, request.aspect_ratio
        ));
    }
    if !recipe
        .output_formats
        .iter()
        .any(|value| value == &request.output_format)
    {
        return Err(format!(
            "media recipe {} does not support output format {}",
            recipe.id, request.output_format
        ));
    }
    if request.mask_url.is_some() && !recipe.supports_masks {
        return Err(format!("media recipe {} does not support masks", recipe.id));
    }
    if request.seed.is_some() && recipe.seed_behavior == "unsupported" {
        return Err(format!("media recipe {} does not support seeds", recipe.id));
    }
    Ok(())
}

fn validate_profile_job(profile: &MediaProfile, request: &MediaJobRequest) -> Result<(), String> {
    if !profile.operations.contains(&request.operation) {
        return Err(format!(
            "media profile {} does not support operation {:?}",
            profile.id, request.operation
        ));
    }
    if !profile.intents.contains(&request.intent) {
        return Err(format!(
            "media profile {} does not support intent {:?}",
            profile.id, request.intent
        ));
    }
    if request.references.len() > profile.maximum_references {
        return Err(format!(
            "media profile {} supports at most {} references; got {}",
            profile.id,
            profile.maximum_references,
            request.references.len()
        ));
    }
    for (index, reference) in request.references.iter().enumerate() {
        if !profile.reference_slots.contains(&reference.slot) {
            return Err(format!(
                "media profile {} does not support reference slot {:?} at index {}",
                profile.id,
                reference.slot,
                index + 1
            ));
        }
    }
    Ok(())
}

fn deterministic_canary_bucket(job_key: &str) -> u8 {
    let digest = Sha256::digest(job_key.as_bytes());
    digest[0] % 100
}

pub(super) async fn request_replicate_art(
    config: &ReplicateAvatarArtConfig,
    prompt: String,
    aspect_ratio: &str,
    subject_kind: &str,
    subject_id: u64,
    level: u8,
) -> Result<DownloadedReplicateImage, String> {
    let intent = match subject_kind {
        "actor" => MediaIntent::Avatar,
        "item" => MediaIntent::Item,
        "location" => MediaIntent::Location,
        other => return Err(format!("unsupported community art subject kind {other}")),
    };
    let registry = MediaRecipeRegistry::embedded()?;
    let controls = MediaRecipeRuntimeControls::from_env()?;
    let resolved = registry.resolve(
        &controls,
        MediaJobRequest {
            job_key: community_art_generation_key(subject_kind, subject_id, level),
            profile: BASE_COMMUNITY_ART_PROFILE.to_string(),
            operation: MediaOperation::BaseGeneration,
            intent,
            prompt,
            references: Vec::new(),
            aspect_ratio: aspect_ratio.to_string(),
            output_format: config.output_format.clone(),
            mask_url: None,
            seed: None,
        },
    )?;
    execute_replicate_art(config, &resolved).await
}

pub(super) async fn request_replicate_evolution_art(
    config: &ReplicateAvatarArtConfig,
    asset_root: &std::path::Path,
    job: &FrozenCommunityArtEvolutionJob,
    frozen_reference: &FrozenMediaAssetReference,
) -> Result<DownloadedReplicateImage, String> {
    job.validate()?;
    job.assert_prior_reference(&frozen_reference.asset_id, &frozen_reference.content_digest)?;
    let reference = resolve_frozen_community_media_reference(
        asset_root,
        frozen_reference,
        job.history_through_seq,
    )?;
    let registry = MediaRecipeRegistry::embedded()?;
    let controls = MediaRecipeRuntimeControls::from_env()?;
    let resolved = registry.resolve(
        &controls,
        MediaJobRequest {
            job_key: job.job_key.clone(),
            profile: job.profile.clone(),
            operation: MediaOperation::SingleReference,
            intent: MediaIntent::Evolution,
            prompt: job.prompt()?,
            references: vec![reference],
            aspect_ratio: job.aspect_ratio.clone(),
            output_format: config.output_format.clone(),
            mask_url: None,
            seed: None,
        },
    )?;
    if resolved.recipe_id != EVOLUTION_CANARY_RECIPE
        || resolved.model_revision != EVOLUTION_CANARY_MODEL_REVISION
        || resolved.references.len() != 1
        || resolved.references[0].slot != MediaReferenceSlot::PriorLevel
    {
        return Err(
            "evolution canary did not resolve to the pinned FLUX.2 single-reference contract"
                .to_string(),
        );
    }
    execute_replicate_art(config, &resolved).await
}

pub(super) async fn execute_replicate_art(
    config: &ReplicateAvatarArtConfig,
    resolved: &ResolvedMediaJob,
) -> Result<DownloadedReplicateImage, String> {
    let legacy_input = if resolved.recipe_id == "replicate.flux1-dev-lora.base" {
        replicate_avatar_input(config)?
    } else {
        serde_json::Map::new()
    };
    let request = replicate_prediction_request(config, resolved, legacy_input)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(resolved.timeout_seconds))
        .build()
        .map_err(|error| error.to_string())?;

    let mut prediction = client
        .post(request.url)
        .bearer_auth(&config.api_token)
        .header("Prefer", "wait=30")
        .json(&request.body)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    for _ in 0..30 {
        if let Some(output_url) = replicate_output_url(&prediction) {
            let prediction_id = prediction
                .get("id")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let mut image = download_replicate_image(&client, &output_url).await?;
            image.prediction_id = prediction_id;
            return Ok(image);
        }
        let status = prediction
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if matches!(status, "failed" | "canceled") {
            let error = prediction
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("prediction failed");
            return Err(error.to_string());
        }
        let Some(get_url) = prediction
            .get("urls")
            .and_then(|urls| urls.get("get"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
        else {
            return Err("Replicate prediction did not include a poll URL".to_string());
        };
        validate_replicate_api_url(&get_url)?;
        tokio::time::sleep(Duration::from_secs(2)).await;
        prediction = client
            .get(get_url)
            .bearer_auth(&config.api_token)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json::<serde_json::Value>()
            .await
            .map_err(|error| error.to_string())?;
    }
    Err("Replicate art prediction timed out".to_string())
}

fn replicate_prediction_request(
    config: &ReplicateAvatarArtConfig,
    resolved: &ResolvedMediaJob,
    legacy_input: serde_json::Map<String, serde_json::Value>,
) -> Result<ReplicatePredictionRequest, String> {
    let legacy_flux1 = resolved.recipe_id == "replicate.flux1-dev-lora.base";
    let mut input = if legacy_flux1 {
        legacy_input
    } else {
        resolved.provider_input()?
    };
    if legacy_flux1 {
        input.insert(
            "prompt".to_string(),
            serde_json::Value::String(resolved.prompt.clone()),
        );
        input.insert(
            "output_format".to_string(),
            serde_json::Value::String(resolved.output_format.clone()),
        );
        input
            .entry("aspect_ratio".to_string())
            .or_insert_with(|| serde_json::Value::String(resolved.aspect_ratio.clone()));
        input
            .entry("num_outputs".to_string())
            .or_insert_with(|| serde_json::Value::Number(1.into()));
        if let Some(lora_url) = config.lora_url.as_deref() {
            input.insert(
                config.lora_input_key.clone(),
                serde_json::Value::String(lora_url.to_string()),
            );
            if let Some(scale) = serde_json::Number::from_f64(config.lora_scale) {
                input.insert(
                    config.lora_scale_input_key.clone(),
                    serde_json::Value::Number(scale),
                );
            }
        }
    }

    let model = if legacy_flux1 {
        config.model.clone()
    } else {
        format!("{}/{}", resolved.model_owner, resolved.model_name)
    };
    let version = if legacy_flux1 {
        config.version.clone()
    } else {
        Some(resolved.model_revision.clone())
    };
    let (url, body) = if let Some(version) = version.as_deref() {
        (
            "https://api.replicate.com/v1/predictions".to_string(),
            serde_json::json!({ "version": version, "input": input }),
        )
    } else {
        (
            format!("https://api.replicate.com/v1/models/{model}/predictions"),
            serde_json::json!({ "input": input }),
        )
    };
    Ok(ReplicatePredictionRequest { url, body })
}

fn replicate_avatar_input(
    config: &ReplicateAvatarArtConfig,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut input = match std::env::var("COSYWORLD_REPLICATE_AVATAR_INPUT_JSON") {
        Ok(value) if !value.trim().is_empty() => {
            match serde_json::from_str::<serde_json::Value>(&value) {
                Ok(serde_json::Value::Object(map)) => map,
                Ok(_) => {
                    return Err(
                        "COSYWORLD_REPLICATE_AVATAR_INPUT_JSON must be a JSON object".to_string(),
                    );
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        _ => serde_json::Map::new(),
    };
    if config.version.is_some() {
        input.remove("version");
    }
    Ok(input)
}

fn replicate_output_url(prediction: &serde_json::Value) -> Option<String> {
    match prediction.get("output")? {
        serde_json::Value::String(url) => Some(url.clone()),
        serde_json::Value::Array(values) => values
            .iter()
            .find_map(|value| value.as_str().map(ToString::to_string)),
        serde_json::Value::Object(map) => map
            .get("url")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .or_else(|| {
                map.values()
                    .find_map(|value| value.as_str().map(ToString::to_string))
            }),
        _ => None,
    }
}

async fn download_replicate_image(
    client: &reqwest::Client,
    output_url: &str,
) -> Result<DownloadedReplicateImage, String> {
    let url = validate_replicate_output_url(output_url)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if response
        .content_length()
        .is_some_and(|len| len > MAX_REPLICATE_AVATAR_IMAGE_BYTES)
    {
        return Err("Replicate avatar image was too large".to_string());
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let content_type = replicate_image_content_type(content_type, output_url)?;
    let bytes = response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_REPLICATE_AVATAR_IMAGE_BYTES {
        return Err("Replicate avatar image was too large".to_string());
    }
    Ok(DownloadedReplicateImage {
        bytes,
        content_type,
        source_url: output_url.to_string(),
        prediction_id: None,
    })
}

pub(super) fn validate_replicate_api_url(value: &str) -> Result<reqwest::Url, String> {
    let url = parse_https_url(value)?;
    let host = url
        .host_str()
        .map(|host| host.to_ascii_lowercase())
        .ok_or_else(|| "Replicate API URL did not include a host".to_string())?;
    if host == "api.replicate.com" {
        Ok(url)
    } else {
        Err(format!("unexpected Replicate API host: {host}"))
    }
}

pub(super) fn validate_replicate_output_url(value: &str) -> Result<reqwest::Url, String> {
    let url = parse_https_url(value)?;
    let host = url
        .host_str()
        .map(|host| host.to_ascii_lowercase())
        .ok_or_else(|| "Replicate output URL did not include a host".to_string())?;
    if host == "replicate.delivery" || host.ends_with(".replicate.delivery") {
        Ok(url)
    } else {
        Err(format!("unexpected Replicate output host: {host}"))
    }
}

fn parse_https_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|error| error.to_string())?;
    if url.scheme() != "https" {
        return Err("Replicate URL must use https".to_string());
    }
    Ok(url)
}

fn replicate_image_content_type(header_value: &str, output_url: &str) -> Result<String, String> {
    let content_type = header_value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if is_safe_image_content_type(&content_type) {
        return Ok(content_type);
    }
    if output_url.contains(".png") {
        return Ok("image/png".to_string());
    }
    if output_url.contains(".webp") {
        return Ok("image/webp".to_string());
    }
    if output_url.contains(".jpg") || output_url.contains(".jpeg") {
        return Ok("image/jpeg".to_string());
    }
    Err(format!(
        "Replicate output was not an image: {}",
        header_value.trim()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(operation: MediaOperation, references: Vec<MediaReference>) -> MediaJobRequest {
        MediaJobRequest {
            job_key: "actor:5000:level:2".to_string(),
            profile: "cosyworld.community-art.reference/1".to_string(),
            operation,
            intent: MediaIntent::Evolution,
            prompt: "Keep image 1's place and image 2's actor.".to_string(),
            references,
            aspect_ratio: "4:5".to_string(),
            output_format: "png".to_string(),
            mask_url: None,
            seed: None,
        }
    }

    fn reference(slot: MediaReferenceSlot, id: &str) -> MediaReference {
        let url = format!("https://assets.example/{id}.png");
        let digest = format!("{:x}", Sha256::digest(id.as_bytes()));
        certified_media_reference(
            slot,
            id.to_string(),
            format!("media-{digest}"),
            digest,
            url,
            "png".to_string(),
        )
    }

    fn art_config() -> ReplicateAvatarArtConfig {
        ReplicateAvatarArtConfig {
            api_token: "test-token".to_string(),
            model: "custom/flux1-lora".to_string(),
            version: None,
            lora_url: Some("owner/style-lora".to_string()),
            lora_input_key: "lora_weights".to_string(),
            lora_scale_input_key: "lora_scale".to_string(),
            lora_scale: 0.85,
            prompt_prefix: "cozy card art".to_string(),
            output_format: "png".to_string(),
        }
    }

    #[test]
    fn embedded_registry_preserves_incumbent_and_pins_flux2_capabilities() {
        let registry = MediaRecipeRegistry::embedded().expect("registry parses");
        let flux1 = &registry.recipes["replicate.flux1-dev-lora.base"];
        assert_eq!(flux1.model.owner, "black-forest-labs");
        assert_eq!(flux1.model.name, "flux-dev-lora");
        assert_eq!(flux1.references.maximum, 0);
        assert_eq!(
            flux1.lora.as_ref().map(|lora| lora.weights_input.as_str()),
            Some("lora_weights")
        );
        let flux2 = &registry.recipes["replicate.flux2-dev.references"];
        assert_eq!(
            flux2.model.revision,
            "7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050"
        );
        assert_eq!(flux2.model.invocation, "pinned_version");
        assert_eq!(flux2.references.maximum, 4);
        assert_eq!(flux2.references.ordering, "caller");
        assert_eq!(flux2.references.prompt_semantics, "indexed_image_1");
        assert_eq!(flux2.dimensions.minimum, 256);
        assert_eq!(flux2.dimensions.maximum, 1440);
        assert_eq!(flux2.dimensions.multiple, 32);
        assert_eq!(flux2.seed_behavior, "optional");
    }

    #[test]
    fn registry_rejects_a_fallback_outside_the_profiles_allowlist() {
        let mut document: MediaRecipeRegistryDocument =
            serde_json::from_str(EMBEDDED_MEDIA_RECIPE_REGISTRY).expect("registry document parses");
        document
            .profiles
            .iter_mut()
            .find(|profile| profile.id == "cosyworld.community-art.reference/1")
            .expect("reference profile")
            .allowed_recipes
            .retain(|recipe| recipe == "replicate.flux2-dev.references");
        assert!(MediaRecipeRegistry::from_document(document)
            .expect_err("disallowed fallback fails")
            .contains("does not allow fallback recipe replicate.flux1-dev-lora.base"));
    }

    #[test]
    fn resolves_zero_one_and_multiple_references_without_reordering() {
        let registry = MediaRecipeRegistry::embedded().expect("registry parses");
        let controls = MediaRecipeRuntimeControls::default();

        let zero = registry
            .resolve(
                &controls,
                request(MediaOperation::BaseGeneration, Vec::new()),
            )
            .expect("zero-reference generation resolves");
        assert!(zero.references.is_empty());

        let one = registry
            .resolve(
                &controls,
                request(
                    MediaOperation::SingleReference,
                    vec![reference(MediaReferenceSlot::PriorLevel, "prior")],
                ),
            )
            .expect("one-reference edit resolves");
        assert_eq!(one.references[0].slot, MediaReferenceSlot::PriorLevel);

        let ordered = vec![
            reference(MediaReferenceSlot::Location, "place"),
            reference(MediaReferenceSlot::Actor, "hero"),
            reference(MediaReferenceSlot::Item, "lantern"),
            reference(MediaReferenceSlot::Style, "style"),
        ];
        let multi = registry
            .resolve(
                &controls,
                request(MediaOperation::MultiReference, ordered.clone()),
            )
            .expect("multi-reference composition resolves");
        assert_eq!(multi.references, ordered);
        assert_eq!(
            multi.model_revision,
            "7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050"
        );
        assert_eq!(multi.reference_minimum, 0);
        assert_eq!(multi.reference_maximum, 4);
        assert_eq!(multi.reference_ordering, "caller");
        assert_eq!(multi.reference_prompt_semantics, "indexed_image_1");
        let record = serde_json::to_value(&multi).expect("resolved job serializes");
        assert_eq!(
            record["model_revision_source"],
            "https://replicate.com/black-forest-labs/flux-2-dev/versions/7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050/api"
        );
        assert_eq!(record["supported_aspect_ratios"][0], "match_input_image");
        assert_eq!(record["dimensions"]["minimum"], 256);
        assert_eq!(record["dimensions"]["maximum"], 1440);
        assert_eq!(record["dimensions"]["multiple"], 32);
        assert_eq!(record["references"][0]["source_id"], "place");
        assert_eq!(record["references"][3]["source_id"], "style");
        assert_eq!(
            multi
                .provider_input()
                .expect("provider input")
                .get("input_images"),
            Some(&serde_json::json!([
                "https://assets.example/place.png",
                "https://assets.example/hero.png",
                "https://assets.example/lantern.png",
                "https://assets.example/style.png"
            ]))
        );
    }

    #[test]
    fn rejects_the_fifth_reference_and_other_incompatible_jobs_before_provider_input() {
        let registry = MediaRecipeRegistry::embedded().expect("registry parses");
        let controls = MediaRecipeRuntimeControls::default();
        let too_many = (0..5)
            .map(|index| reference(MediaReferenceSlot::Actor, &format!("actor-{index}")))
            .collect();
        let over_limit = registry
            .resolve(&controls, request(MediaOperation::MultiReference, too_many))
            .expect_err("over-limit references fail");
        assert!(over_limit.contains("supports at most 4 references"));

        let incompatible = registry
            .resolve(
                &controls,
                MediaJobRequest {
                    profile: BASE_COMMUNITY_ART_PROFILE.to_string(),
                    operation: MediaOperation::SingleReference,
                    intent: MediaIntent::Avatar,
                    ..request(
                        MediaOperation::SingleReference,
                        vec![reference(MediaReferenceSlot::Actor, "hero")],
                    )
                },
            )
            .expect_err("base profile cannot accept references");
        assert!(incompatible.contains("does not support operation"));

        let seeded = registry
            .resolve(
                &controls,
                MediaJobRequest {
                    seed: Some(42),
                    ..request(MediaOperation::BaseGeneration, Vec::new())
                },
            )
            .expect("the pinned recipe accepts a seed");
        assert_eq!(
            seeded
                .provider_input()
                .expect("seeded provider input")
                .get("seed"),
            Some(&serde_json::json!(42))
        );
    }

    #[test]
    fn runtime_controls_canary_disable_fallback_and_rollback_without_state() {
        let registry = MediaRecipeRegistry::embedded().expect("registry parses");
        let base_request = MediaJobRequest {
            job_key: "always-canary".to_string(),
            profile: BASE_COMMUNITY_ART_PROFILE.to_string(),
            operation: MediaOperation::BaseGeneration,
            intent: MediaIntent::Avatar,
            prompt: "A cozy avatar.".to_string(),
            references: Vec::new(),
            aspect_ratio: "1:1".to_string(),
            output_format: "png".to_string(),
            mask_url: None,
            seed: None,
        };
        let canary = MediaRecipeRuntimeControls {
            canaries: BTreeMap::from([(
                BASE_COMMUNITY_ART_PROFILE.to_string(),
                MediaRecipeCanary {
                    recipe: "replicate.flux2-dev.references".to_string(),
                    percent: 100,
                },
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        let selected = registry
            .resolve(&canary, base_request.clone())
            .expect("canary resolves");
        assert_eq!(selected.recipe_id, "replicate.flux2-dev.references");

        let disabled = MediaRecipeRuntimeControls {
            disabled_recipes: BTreeSet::from(["replicate.flux2-dev.references".to_string()]),
            ..canary
        };
        let fallback = registry
            .resolve(&disabled, base_request.clone())
            .expect("disabled canary falls back");
        assert_eq!(fallback.recipe_id, "replicate.flux1-dev-lora.base");

        let rollback = MediaRecipeRuntimeControls {
            profile_overrides: BTreeMap::from([(
                BASE_COMMUNITY_ART_PROFILE.to_string(),
                "replicate.flux1-dev-lora.base".to_string(),
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        let rolled_back = registry
            .resolve(&rollback, base_request)
            .expect("explicit rollback resolves");
        assert_eq!(rolled_back.recipe_id, "replicate.flux1-dev-lora.base");
    }

    #[test]
    fn runtime_controls_reject_unknown_disallowed_and_malformed_configuration() {
        let registry = MediaRecipeRegistry::embedded().expect("registry parses");
        let job = request(MediaOperation::BaseGeneration, Vec::new());

        let unknown_disabled = MediaRecipeRuntimeControls {
            disabled_recipes: BTreeSet::from(["replicate.typo".to_string()]),
            ..MediaRecipeRuntimeControls::default()
        };
        assert!(registry
            .resolve(&unknown_disabled, job.clone())
            .expect_err("unknown disabled recipe fails")
            .contains("unknown disabled recipe replicate.typo"));

        let unknown_profile = MediaRecipeRuntimeControls {
            canaries: BTreeMap::from([(
                "cosyworld.unknown/1".to_string(),
                MediaRecipeCanary {
                    recipe: "replicate.flux2-dev.references".to_string(),
                    percent: 5,
                },
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        assert!(registry
            .resolve(&unknown_profile, job.clone())
            .expect_err("unknown control profile fails")
            .contains("unknown profile cosyworld.unknown/1"));

        let unknown_recipe = MediaRecipeRuntimeControls {
            profile_overrides: BTreeMap::from([(
                "cosyworld.community-art.reference/1".to_string(),
                "replicate.typo".to_string(),
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        assert!(registry
            .resolve(&unknown_recipe, job.clone())
            .expect_err("unknown override recipe fails")
            .contains("unknown recipe replicate.typo"));

        let mut document: MediaRecipeRegistryDocument =
            serde_json::from_str(EMBEDDED_MEDIA_RECIPE_REGISTRY).expect("registry document parses");
        document
            .profiles
            .iter_mut()
            .find(|profile| profile.id == BASE_COMMUNITY_ART_PROFILE)
            .expect("base profile")
            .allowed_recipes
            .retain(|recipe| recipe == "replicate.flux1-dev-lora.base");
        let restricted = MediaRecipeRegistry::from_document(document).expect("restricted registry");
        let disallowed_target = MediaRecipeRuntimeControls {
            canaries: BTreeMap::from([(
                BASE_COMMUNITY_ART_PROFILE.to_string(),
                MediaRecipeCanary {
                    recipe: "replicate.flux2-dev.references".to_string(),
                    percent: 5,
                },
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        let base_job = MediaJobRequest {
            profile: BASE_COMMUNITY_ART_PROFILE.to_string(),
            intent: MediaIntent::Avatar,
            ..job.clone()
        };
        assert!(restricted
            .resolve(&disallowed_target, base_job)
            .expect_err("disallowed canary target fails")
            .contains("does not allow canary recipe replicate.flux2-dev.references"));

        let bad_percent = MediaRecipeRuntimeControls {
            canaries: BTreeMap::from([(
                "cosyworld.community-art.reference/1".to_string(),
                MediaRecipeCanary {
                    recipe: "replicate.flux2-dev.references".to_string(),
                    percent: 101,
                },
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        assert!(registry
            .resolve(&bad_percent, job)
            .expect_err("bad canary percent fails")
            .contains("canary percent 101 exceeds 100"));

        assert!(MediaRecipeRuntimeControls::from_json(
            r#"{"disabled_recipes":[],"unknown_field":true}"#
        )
        .expect_err("unknown top-level field fails")
        .contains("unknown field"));
        assert!(MediaRecipeRuntimeControls::from_json(
            r#"{"canaries":{"cosyworld.community-art.reference/1":{"recipe":"replicate.flux2-dev.references","percent":5,"unknown_field":true}}}"#
        )
        .expect_err("unknown nested field fails")
        .contains("unknown field"));
    }

    #[test]
    fn replicate_adapter_preserves_legacy_flux1_shape_and_pins_flux2_canary() {
        let registry = MediaRecipeRegistry::embedded().expect("registry parses");
        let base_request = MediaJobRequest {
            job_key: "actor:5000:level:2".to_string(),
            profile: BASE_COMMUNITY_ART_PROFILE.to_string(),
            operation: MediaOperation::BaseGeneration,
            intent: MediaIntent::Avatar,
            prompt: "A cozy avatar.".to_string(),
            references: Vec::new(),
            aspect_ratio: "1:1".to_string(),
            output_format: "png".to_string(),
            mask_url: None,
            seed: None,
        };
        let legacy = registry
            .resolve(&MediaRecipeRuntimeControls::default(), base_request.clone())
            .expect("legacy recipe resolves");
        let legacy_request = replicate_prediction_request(
            &art_config(),
            &legacy,
            serde_json::Map::from_iter([("guidance".to_string(), serde_json::json!(3.5))]),
        )
        .expect("legacy provider request builds");
        assert_eq!(
            legacy_request.url,
            "https://api.replicate.com/v1/models/custom/flux1-lora/predictions"
        );
        assert_eq!(
            legacy_request.body,
            serde_json::json!({
                "input": {
                    "guidance": 3.5,
                    "prompt": "A cozy avatar.",
                    "output_format": "png",
                    "aspect_ratio": "1:1",
                    "num_outputs": 1,
                    "lora_weights": "owner/style-lora",
                    "lora_scale": 0.85
                }
            })
        );

        let canary = MediaRecipeRuntimeControls {
            canaries: BTreeMap::from([(
                BASE_COMMUNITY_ART_PROFILE.to_string(),
                MediaRecipeCanary {
                    recipe: "replicate.flux2-dev.references".to_string(),
                    percent: 100,
                },
            )]),
            ..MediaRecipeRuntimeControls::default()
        };
        let flux2 = registry
            .resolve(
                &canary,
                MediaJobRequest {
                    seed: Some(42),
                    ..base_request
                },
            )
            .expect("FLUX.2 canary resolves");
        let flux2_request =
            replicate_prediction_request(&art_config(), &flux2, serde_json::Map::new())
                .expect("FLUX.2 provider request builds");
        assert_eq!(
            flux2_request.url,
            "https://api.replicate.com/v1/predictions"
        );
        assert_eq!(
            flux2_request.body["version"],
            "7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050"
        );
        assert_eq!(flux2_request.body["input"]["seed"], 42);
        assert!(flux2_request.body["input"].get("num_outputs").is_none());
        assert!(flux2_request.body["input"].get("lora_weights").is_none());
    }
}
