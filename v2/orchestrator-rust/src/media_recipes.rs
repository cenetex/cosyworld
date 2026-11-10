use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[allow(dead_code)]
mod assets;
pub(crate) mod media_verdict;

#[derive(Clone, Debug)]
pub(super) struct ReplicateAvatarArtConfig {
    pub(super) api_token: String,
    pub(super) model: String,
    pub(super) version: Option<String>,
    pub(super) lora_url: Option<String>,
    pub(super) lora_input_key: String,
    pub(super) lora_scale_input_key: String,
    pub(super) lora_scale: f64,
    pub(super) prompt_prefix: String,
    pub(super) output_format: String,
    pub(super) provider_defaults: serde_json::Map<String, serde_json::Value>,
}

impl ReplicateAvatarArtConfig {}

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
    input_shape: String,
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
    required_prompt_prefix: Option<String>,
    provider_defaults: serde_json::Map<String, serde_json::Value>,
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
    pub(super) reference_input_shape: String,
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
    pub(super) required_prompt_prefix: Option<String>,
    pub(super) provider_defaults: serde_json::Map<String, serde_json::Value>,
    pub(super) lora: Option<MediaLoraInputs>,
    pub(super) output_normalization: String,
    pub(super) stable_storage: String,
}

impl MediaRecipeRuntimeControls {}

impl MediaRecipeRegistry {
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
            reference_input_shape: recipe.references.input_shape.clone(),
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
            required_prompt_prefix: recipe.required_prompt_prefix.clone(),
            provider_defaults: recipe.provider_defaults.clone(),
            lora: recipe.lora.clone(),
            output_normalization: recipe.output.normalization.clone(),
            stable_storage: recipe.output.stable_storage.clone(),
        })
    }
}

impl ResolvedMediaJob {}

fn validate_job(recipe: &MediaRecipe, request: &MediaJobRequest) -> Result<(), String> {
    if let Some(prefix) = recipe.required_prompt_prefix.as_deref() {
        if !request.prompt.starts_with(prefix) {
            return Err(format!(
                "media recipe {} requires prompt prefix {prefix:?}",
                recipe.id
            ));
        }
    }
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
