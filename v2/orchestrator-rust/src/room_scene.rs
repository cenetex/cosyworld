use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    future::Future,
    io,
    path::{Path, PathBuf},
    sync::{Mutex as StdMutex, MutexGuard, OnceLock},
    time::Duration,
};

use axum::{
    extract::{ConnectInfo, Path as AxumPath, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::media_recipes::media_verdict::{
    bounded_brief_constraints, make_visual_verdict, media_candidate_approved,
    media_candidate_violations, media_provider_route_available, prepare_media_candidate,
    record_media_provider_failure, record_media_visual_verdict, FrozenMediaBrief,
    MediaCandidateInput, MediaVerdictDisposition, MediaViolation,
};
use crate::{
    active_content, allow_actor_mutation, client_actor_authorized_for_state,
    event_visible_in_location, execute_replicate_art, freeze_approved_community_media_reference,
    immutable_media_asset_bytes, is_safe_image_content_type, moderation_authorized,
    reconcile_community_media_asset_status, register_derived_room_scene_media_asset,
    resolve_frozen_media_reference, AppState, DownloadedReplicateImage, FrozenMediaAssetReference,
    MediaAssetProvenance, MediaIntent, MediaJobRequest, MediaOperation, MediaRecipeRegistry,
    MediaRecipeRuntimeControls, MediaReferenceSlot, ReplicateAvatarArtConfig, ResolvedMediaJob,
    RuntimeWorld, CHAT_ACTION_LIMIT,
};

const ROOM_SCENE_SCHEMA_VERSION: u8 = 1;
const ROOM_SCENE_PROFILE: &str = "cosyworld.community-art.reference/1";
const ROOM_SCENE_USE: &str = "public_room_scene";
const ROOM_SCENE_VISIBILITY: &str = "public_room";
const ROOM_SCENE_FUNDING_PRINCIPAL: &str = "cosyworld-server";
const ROOM_SCENE_FUNDING: &str = "server_sponsored_no_orb_debit/1";
const ROOM_SCENE_MAX_ACTORS: usize = 2;
const ROOM_SCENE_MAX_REFERENCES: usize = 4;
static ROOM_SCENE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreateRoomSceneRequest {
    actor_id: u64,
    actor_session: Option<String>,
    event_seq: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ReviewRoomSceneRequest {
    approved: bool,
    reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct RoomSceneResponse {
    ok: bool,
    status: u16,
    job_id: Option<String>,
    lifecycle: Option<RoomSceneLifecycle>,
    media_intent: Option<String>,
    image_url: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RoomSceneLifecycle {
    Pending,
    Generating,
    ReviewPending,
    Ready,
    Rejected,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FrozenRoomSceneActor {
    actor_id: u64,
    name: String,
    grounded_pose: Option<String>,
    grounded_attention: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FrozenRoomSceneItem {
    item_id: u64,
    name: String,
    holder_actor_id: Option<u64>,
    on_room_floor: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FrozenRoomSceneReference {
    order: usize,
    slot: MediaReferenceSlot,
    reference: FrozenMediaAssetReference,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FrozenRoomSceneRecipe {
    profile: String,
    recipe_id: String,
    model_owner: String,
    model_name: String,
    model_revision: String,
    prompt_template_version: String,
    reference_maximum: usize,
    reference_ordering: String,
    reference_prompt_semantics: String,
    timeout_seconds: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FrozenRoomSceneJob {
    schema_version: u8,
    job_id: String,
    world_id: String,
    worldpack_id: String,
    worldpack_version: String,
    event_media_intent: String,
    projection_seq: u64,
    projection_digest: String,
    location_id: u64,
    location_level: u8,
    location_name: String,
    environmental_facts: Vec<String>,
    actors: Vec<FrozenRoomSceneActor>,
    selected_item: Option<FrozenRoomSceneItem>,
    public_beat_type: String,
    public_beat: String,
    intended_use: String,
    aspect_ratio: String,
    crop: String,
    safe_areas: Vec<String>,
    funding_principal: String,
    funding_policy: String,
    visibility: String,
    forbidden_facts: Vec<String>,
    style_constraints: Vec<String>,
    composition_plan: String,
    references: Vec<FrozenRoomSceneReference>,
    recipe: FrozenRoomSceneRecipe,
    prompt: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedRoomScene {
    schema_version: u8,
    job: FrozenRoomSceneJob,
    lifecycle: RoomSceneLifecycle,
    provider_attempts: u8,
    candidate_digest: Option<String>,
    prediction_id: Option<String>,
    published_asset_id: Option<String>,
    review_event_seq: Option<u64>,
    review_reason: Option<String>,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct RoomSceneCandidateMetadata {
    schema_version: u8,
    content_type: String,
    source_url: String,
    prediction_id: Option<String>,
    digest: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct RoomSceneProviderLease {
    schema_version: u8,
    attempt: u8,
    created_at_ms: u64,
    expires_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct RoomSceneProjection<'a> {
    world_id: &'a str,
    worldpack_id: &'a str,
    projection_seq: u64,
    location_id: u64,
    location_level: u8,
    location_name: &'a str,
    environmental_facts: &'a [String],
    actors: &'a [FrozenRoomSceneActor],
    selected_item: &'a Option<FrozenRoomSceneItem>,
    public_beat_type: &'a str,
    public_beat: &'a str,
}

fn room_scene_media_brief(job: &FrozenRoomSceneJob) -> FrozenMediaBrief {
    let mut brief = FrozenMediaBrief::new(
        job.job_id.clone(),
        format!(
            "{}/{}",
            job.recipe.recipe_id, job.recipe.prompt_template_version
        ),
        job.intended_use.clone(),
        &job.prompt,
        job.aspect_ratio.clone(),
    );
    brief.required_subjects = bounded_brief_constraints(
        job.actors
            .iter()
            .map(|actor| format!("actor {} ({})", actor.actor_id, actor.name)),
    );
    brief.required_environment = bounded_brief_constraints(
        std::iter::once(job.location_name.clone()).chain(job.environmental_facts.iter().cloned()),
    );
    brief.required_item_holder = job.selected_item.as_ref().and_then(|item| {
        bounded_brief_constraints([format!(
            "item {} ({}) held by {}",
            item.item_id,
            item.name,
            item.holder_actor_id
                .map(|actor_id| actor_id.to_string())
                .unwrap_or_else(|| "room floor".to_string())
        )])
        .into_iter()
        .next()
    });
    brief.crop = job.crop.clone();
    brief.safe_areas = bounded_brief_constraints(job.safe_areas.iter().cloned());
    brief.forbidden.extend(bounded_brief_constraints(
        job.forbidden_facts.iter().cloned(),
    ));
    brief.pack_negative_constraints =
        bounded_brief_constraints(job.style_constraints.iter().cloned());
    brief.approved_reference_digests = job
        .references
        .iter()
        .map(|reference| reference.reference.content_digest.clone())
        .collect();
    brief
}

fn prepare_room_scene_verdict(
    root: &Path,
    job: &FrozenRoomSceneJob,
    image: &DownloadedReplicateImage,
) -> Result<MediaVerdictDisposition, String> {
    let prior_public = job.references.first().and_then(|reference| {
        immutable_media_asset_bytes(root, &reference.reference.asset_id)
            .ok()
            .map(|(bytes, _)| bytes)
    });
    let digest = candidate_digest(image);
    prepare_media_candidate(
        root,
        room_scene_media_brief(job),
        MediaCandidateInput {
            image,
            provider: "replicate",
            model: &format!("{}/{}", job.recipe.model_owner, job.recipe.model_name),
            claimed_digest: Some(&digest),
            prior_public_bytes: prior_public.as_deref(),
        },
    )
}

impl FrozenRoomSceneRecipe {
    fn from_resolved(resolved: &ResolvedMediaJob) -> Self {
        Self {
            profile: resolved.profile.clone(),
            recipe_id: resolved.recipe_id.clone(),
            model_owner: resolved.model_owner.clone(),
            model_name: resolved.model_name.clone(),
            model_revision: resolved.model_revision.clone(),
            prompt_template_version: resolved.prompt_template_version.clone(),
            reference_maximum: resolved.reference_maximum,
            reference_ordering: resolved.reference_ordering.clone(),
            reference_prompt_semantics: resolved.reference_prompt_semantics.clone(),
            timeout_seconds: resolved.timeout_seconds,
        }
    }
}

impl FrozenRoomSceneJob {
    pub(super) fn digest(&self) -> Result<String, String> {
        self.validate()?;
        canonical_digest(self)
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if self.references.len() > ROOM_SCENE_MAX_REFERENCES {
            return Err(
                "room-scene remains unillustrated: explicit multi-pass review is required"
                    .to_string(),
            );
        }
        if self.schema_version != ROOM_SCENE_SCHEMA_VERSION
            || self.job_id.len() != 64
            || !self.job_id.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.projection_seq == 0
            || self.location_id == 0
            || self.location_level == 0
            || self.world_id.trim().is_empty()
            || self.worldpack_id.trim().is_empty()
            || self.event_media_intent.trim().is_empty()
            || self.intended_use != ROOM_SCENE_USE
            || self.visibility != ROOM_SCENE_VISIBILITY
            || self.funding_principal != ROOM_SCENE_FUNDING_PRINCIPAL
            || self.funding_policy != ROOM_SCENE_FUNDING
            || self.aspect_ratio != "16:9"
            || self.composition_plan != "single_pass_complete_set"
            || self.actors.is_empty()
            || self.actors.len() > ROOM_SCENE_MAX_ACTORS
            || self.references.len() < 2
        {
            return Err("room-scene job violates the bounded template".to_string());
        }
        if canonical_digest(&self.event_media_intent)? != self.job_id {
            return Err("room-scene job id does not match its event/media intent".to_string());
        }
        if self.public_beat_type.contains("combat")
            || self.public_beat_type.contains("attack")
            || self.public_beat_type.contains("theft")
        {
            return Err("crowds and combat tableaux are outside room-scene v1".to_string());
        }
        let actor_ids = self
            .actors
            .iter()
            .map(|actor| actor.actor_id)
            .collect::<BTreeSet<_>>();
        if actor_ids.len() != self.actors.len() {
            return Err("room-scene cast contains duplicate actors".to_string());
        }
        let expected_slots = std::iter::once((MediaReferenceSlot::Location, self.location_id))
            .chain(
                self.actors
                    .iter()
                    .map(|actor| (MediaReferenceSlot::Actor, actor.actor_id)),
            )
            .chain(
                self.selected_item
                    .iter()
                    .map(|item| (MediaReferenceSlot::Item, item.item_id)),
            )
            .collect::<Vec<_>>();
        if expected_slots.len() != self.references.len()
            || self.references.iter().zip(expected_slots).enumerate().any(
                |(order, (reference, (slot, subject_id)))| {
                    reference.order != order
                        || reference.slot != slot
                        || reference.reference.subject_id != subject_id
                        || reference.reference.subject_kind
                            != match slot {
                                MediaReferenceSlot::Location => "location",
                                MediaReferenceSlot::Actor => "actor",
                                MediaReferenceSlot::Item => "item",
                                _ => "",
                            }
                },
            )
        {
            return Err("room-scene typed reference order does not match its cast".to_string());
        }
        if self.recipe.profile != ROOM_SCENE_PROFILE
            || self.recipe.reference_maximum < self.references.len()
            || self.recipe.reference_ordering != "caller"
            || self.recipe.reference_prompt_semantics != "indexed_image_1"
            || self.recipe.model_revision.len() != 64
            || self.recipe.timeout_seconds == 0
        {
            return Err("room-scene exact recipe cannot represent the complete set".to_string());
        }
        let projection = RoomSceneProjection {
            world_id: &self.world_id,
            worldpack_id: &self.worldpack_id,
            projection_seq: self.projection_seq,
            location_id: self.location_id,
            location_level: self.location_level,
            location_name: &self.location_name,
            environmental_facts: &self.environmental_facts,
            actors: &self.actors,
            selected_item: &self.selected_item,
            public_beat_type: &self.public_beat_type,
            public_beat: &self.public_beat,
        };
        if canonical_digest(&projection)? != self.projection_digest
            || room_scene_prompt(self) != self.prompt
        {
            return Err("room-scene projection or prompt changed after freezing".to_string());
        }
        Ok(())
    }

    fn resolve(&self, root: &Path) -> Result<ResolvedMediaJob, String> {
        self.validate()?;
        if self.worldpack_id != active_content().manifest.id {
            return Err("room-scene worldpack boundary is no longer active".to_string());
        }
        let references = self
            .references
            .iter()
            .map(|reference| {
                resolve_frozen_media_reference(
                    root,
                    &reference.reference,
                    reference.slot,
                    self.projection_seq,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let resolved = MediaRecipeRegistry::embedded()?.resolve(
            &MediaRecipeRuntimeControls::from_env()?,
            MediaJobRequest {
                job_key: self.job_id.clone(),
                profile: self.recipe.profile.clone(),
                operation: MediaOperation::MultiReference,
                intent: MediaIntent::RoomScene,
                prompt: self.prompt.clone(),
                references,
                aspect_ratio: self.aspect_ratio.clone(),
                output_format: "png".to_string(),
                mask_url: None,
                seed: None,
            },
        )?;
        if FrozenRoomSceneRecipe::from_resolved(&resolved) != self.recipe
            || resolved.references.len() != self.references.len()
            || resolved
                .references
                .iter()
                .zip(&self.references)
                .any(|(resolved, frozen)| {
                    resolved.slot != frozen.slot
                        || resolved.asset_id != frozen.reference.asset_id
                        || resolved.digest != frozen.reference.content_digest
                })
        {
            return Err("room-scene retry did not resolve its exact frozen recipe".to_string());
        }
        Ok(resolved)
    }
}

impl RuntimeWorld {
    pub(super) fn freeze_room_scene(
        &self,
        root: &Path,
        initiating_actor_id: u64,
        event_seq: u64,
    ) -> Result<FrozenRoomSceneJob, String> {
        let latest_seq = self.world.next_event_seq.saturating_sub(1);
        if event_seq == 0 || event_seq != latest_seq {
            return Err(format!(
                "stale room-scene projection {event_seq}; current committed boundary is {latest_seq}"
            ));
        }
        let initiator = self
            .actor_by_id(initiating_actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
            .ok_or_else(|| "room-scene initiator is not active".to_string())?;
        let event = self
            .event_log
            .iter()
            .find(|event| event.seq == event_seq)
            .filter(|event| event.success)
            .ok_or_else(|| "room-scene boundary has no successful committed event".to_string())?;
        let location_id = event
            .location_id
            .or(event.destination_location_id)
            .filter(|location_id| event_visible_in_location(event, *location_id))
            .ok_or_else(|| "room-scene event has no public room boundary".to_string())?;
        if initiator.location_id != location_id {
            return Err(
                "room-scene initiator is not present at the committed boundary".to_string(),
            );
        }
        if event.type_name.contains("combat")
            || event.type_name.contains("attack")
            || event.type_name.contains("theft")
            || event.damage.is_some()
        {
            return Err("crowds and combat tableaux are outside room-scene v1".to_string());
        }

        let mut actor_ids = Vec::new();
        for actor_id in [event.actor_id, event.target_actor_id]
            .into_iter()
            .flatten()
        {
            if !actor_ids.contains(&actor_id)
                && self.actor_by_id(actor_id).is_some_and(|actor| {
                    Self::actor_is_present(actor) && actor.location_id == location_id
                })
            {
                actor_ids.push(actor_id);
            }
        }
        if actor_ids.is_empty() || actor_ids.len() > ROOM_SCENE_MAX_ACTORS {
            return Err(
                "room-scene v1 requires one or two authoritative present actors".to_string(),
            );
        }
        let actors = actor_ids
            .iter()
            .map(|actor_id| FrozenRoomSceneActor {
                actor_id: *actor_id,
                name: self
                    .actor_name(*actor_id)
                    .unwrap_or_else(|| format!("Actor {actor_id}")),
                grounded_pose: (event.actor_id == Some(*actor_id))
                    .then(|| "performing the committed public beat".to_string()),
                grounded_attention: (event.target_actor_id == Some(*actor_id))
                    .then(|| "attending to the other committed participant".to_string()),
            })
            .collect::<Vec<_>>();
        let selected_item = event
            .item_id
            .or(event.target_item_id)
            .and_then(|item_id| self.item_by_id(item_id))
            .filter(|item| {
                (item.holder_actor_id == 0 && item.location_id == location_id)
                    || actor_ids.contains(&item.holder_actor_id)
            })
            .map(|item| FrozenRoomSceneItem {
                item_id: item.id,
                name: self
                    .item_name(item.id)
                    .unwrap_or_else(|| format!("Item {}", item.id)),
                holder_actor_id: (item.holder_actor_id != 0).then_some(item.holder_actor_id),
                on_room_floor: item.holder_actor_id == 0,
            });
        let location_level = self
            .community_art_subject_level("location", location_id)
            .ok_or_else(|| "room-scene location is not eligible for media".to_string())?;
        let location_name = self
            .location_name(location_id)
            .ok_or_else(|| "room-scene location is missing".to_string())?;
        let meta = self.location_meta_for(location_id);
        let mut environmental_facts = Vec::new();
        if !meta.description.trim().is_empty() {
            environmental_facts.push(meta.description.clone());
        }
        if !meta.persona.trim().is_empty() {
            environmental_facts.push(meta.persona.clone());
        }
        if !meta.biome.trim().is_empty() {
            environmental_facts.push(format!("biome: {}", meta.biome));
        }
        if !meta.terrain.is_empty() {
            environmental_facts.push(format!("terrain: {}", meta.terrain.join(", ")));
        }
        if let Some(art_prompt) = meta.art_prompt.filter(|value| !value.trim().is_empty()) {
            environmental_facts.push(format!("approved environment: {art_prompt}"));
        }
        environmental_facts.extend(
            self.media_location_evidence(location_id)
                .into_iter()
                .map(|evidence| evidence.text),
        );
        let public_beat = event
            .content
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(crate::compact_whitespace)
            .unwrap_or_else(|| event.type_name.replace('.', " "));
        let manifest = &active_content().manifest;
        let world_id = event.world_id.clone();
        let event_media_intent = format!(
            "{}:{event_seq}:room_scene:{ROOM_SCENE_PROFILE}:{ROOM_SCENE_USE}",
            event.world_id
        );
        let job_id = canonical_digest(&event_media_intent)?;
        let safe_areas = vec![
            "keep the central 60% readable at card crop".to_string(),
            "keep faces and the selected item outside edge-safe gutters".to_string(),
        ];
        let forbidden_facts = vec![
            "unlisted actors, crowds, bystanders, or creatures".to_string(),
            "unlisted items, changed holders, or invented inventory".to_string(),
            "invented relationships, locations, outcomes, text, logos, or game mechanics"
                .to_string(),
        ];
        let style_constraints = vec![
            format!("worldpack {}", manifest.id),
            "preserve the established approved reference styles".to_string(),
            "cozy storybook room tableau; no unconstrained combat tableau".to_string(),
        ];
        let mut frozen_references = Vec::new();
        let mut push_reference =
            |slot: MediaReferenceSlot, kind: &str, id: u64, level: u8| -> Result<(), String> {
                let reference =
                    freeze_approved_community_media_reference(root, kind, id, level, event_seq)?;
                frozen_references.push(FrozenRoomSceneReference {
                    order: frozen_references.len(),
                    slot,
                    reference,
                });
                Ok(())
            };
        push_reference(
            MediaReferenceSlot::Location,
            "location",
            location_id,
            location_level,
        )?;
        for actor_id in &actor_ids {
            let level = self
                .community_art_subject_level("actor", *actor_id)
                .ok_or_else(|| format!("room-scene actor {actor_id} is not media eligible"))?;
            push_reference(MediaReferenceSlot::Actor, "actor", *actor_id, level)?;
        }
        if let Some(item) = selected_item.as_ref() {
            let level = self
                .community_art_subject_level("item", item.item_id)
                .ok_or_else(|| format!("room-scene item {} is not media eligible", item.item_id))?;
            push_reference(MediaReferenceSlot::Item, "item", item.item_id, level)?;
        }
        if frozen_references.len() > ROOM_SCENE_MAX_REFERENCES {
            return Err(
                "room-scene remains unillustrated: explicit multi-pass review is required"
                    .to_string(),
            );
        }

        let mut job = FrozenRoomSceneJob {
            schema_version: ROOM_SCENE_SCHEMA_VERSION,
            job_id,
            world_id,
            worldpack_id: manifest.id.clone(),
            worldpack_version: manifest.version.to_string(),
            event_media_intent,
            projection_seq: event_seq,
            projection_digest: String::new(),
            location_id,
            location_level,
            location_name,
            environmental_facts,
            actors,
            selected_item,
            public_beat_type: event.type_name.clone(),
            public_beat,
            intended_use: ROOM_SCENE_USE.to_string(),
            aspect_ratio: "16:9".to_string(),
            crop: "wide room establishing image".to_string(),
            safe_areas,
            funding_principal: ROOM_SCENE_FUNDING_PRINCIPAL.to_string(),
            funding_policy: ROOM_SCENE_FUNDING.to_string(),
            visibility: ROOM_SCENE_VISIBILITY.to_string(),
            forbidden_facts,
            style_constraints,
            composition_plan: "single_pass_complete_set".to_string(),
            references: frozen_references,
            recipe: FrozenRoomSceneRecipe {
                profile: ROOM_SCENE_PROFILE.to_string(),
                recipe_id: String::new(),
                model_owner: String::new(),
                model_name: String::new(),
                model_revision: String::new(),
                prompt_template_version: String::new(),
                reference_maximum: 0,
                reference_ordering: String::new(),
                reference_prompt_semantics: String::new(),
                timeout_seconds: 0,
            },
            prompt: String::new(),
        };
        job.projection_digest = canonical_digest(&RoomSceneProjection {
            world_id: &job.world_id,
            worldpack_id: &job.worldpack_id,
            projection_seq: job.projection_seq,
            location_id: job.location_id,
            location_level: job.location_level,
            location_name: &job.location_name,
            environmental_facts: &job.environmental_facts,
            actors: &job.actors,
            selected_item: &job.selected_item,
            public_beat_type: &job.public_beat_type,
            public_beat: &job.public_beat,
        })?;
        job.prompt = room_scene_prompt(&job);
        let references = job
            .references
            .iter()
            .map(|reference| {
                resolve_frozen_media_reference(
                    root,
                    &reference.reference,
                    reference.slot,
                    event_seq,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let resolved = MediaRecipeRegistry::embedded()?.resolve(
            &MediaRecipeRuntimeControls::from_env()?,
            MediaJobRequest {
                job_key: job.job_id.clone(),
                profile: ROOM_SCENE_PROFILE.to_string(),
                operation: MediaOperation::MultiReference,
                intent: MediaIntent::RoomScene,
                prompt: job.prompt.clone(),
                references,
                aspect_ratio: job.aspect_ratio.clone(),
                output_format: "png".to_string(),
                mask_url: None,
                seed: None,
            },
        )?;
        job.recipe = FrozenRoomSceneRecipe::from_resolved(&resolved);
        job.validate()?;
        Ok(job)
    }
}

fn room_scene_prompt(job: &FrozenRoomSceneJob) -> String {
    let indexed = job
        .references
        .iter()
        .map(|reference| {
            let image = reference.order + 1;
            match reference.slot {
                MediaReferenceSlot::Location => format!(
                    "Image {image} is the authoritative location plate for {}.",
                    job.location_name
                ),
                MediaReferenceSlot::Actor => {
                    let actor = job
                        .actors
                        .iter()
                        .find(|actor| actor.actor_id == reference.reference.subject_id)
                        .expect("validated actor reference");
                    format!(
                        "Image {image} is actor {} only; preserve identity. Pose: {} Attention: {}",
                        actor.name,
                        actor.grounded_pose.as_deref().unwrap_or("neutral"),
                        actor.grounded_attention.as_deref().unwrap_or("within the committed beat")
                    )
                }
                MediaReferenceSlot::Item => {
                    let item = job.selected_item.as_ref().expect("validated item reference");
                    format!(
                        "Image {image} is the selected item {} only; keep its recorded holder unchanged.",
                        item.name
                    )
                }
                _ => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    crate::compact_whitespace(&format!(
        "{indexed} Scene: {} at projection {} — {} Place: {}, level {}; {} \
         Wide composition: {} Style: {} Exclude: {} Complete reference set only; do not add, \
         remove, merge, replace, or reinterpret any subject, holder, relationship, location, or \
         outcome; no text, logo, or invented mechanic.",
        job.public_beat_type,
        job.projection_seq,
        job.public_beat,
        job.location_name,
        job.location_level,
        job.environmental_facts.join("; "),
        job.safe_areas.join("; "),
        job.style_constraints.join("; "),
        job.forbidden_facts.join("; "),
    ))
}

fn room_scene_lock() -> Result<MutexGuard<'static, ()>, String> {
    ROOM_SCENE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .map_err(|_| "room-scene generation lock is poisoned".to_string())
}

fn claim_room_scene_generation(
    root: &Path,
    job_id: &str,
    attempt: u8,
    timeout: Duration,
) -> Result<bool, String> {
    let path = room_scene_claim_path(root, job_id);
    let now = crate::now_millis();
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let lease = RoomSceneProviderLease {
                schema_version: ROOM_SCENE_SCHEMA_VERSION,
                attempt,
                created_at_ms: now,
                expires_at_ms: now
                    .saturating_add(timeout.as_millis() as u64)
                    .saturating_add(5_000),
            };
            serde_json::to_writer(&mut file, &lease).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let lease = fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<RoomSceneProviderLease>(&bytes).ok());
            if lease.is_none_or(|lease| lease.expires_at_ms > now) {
                return Ok(false);
            }
            let stale = path.with_extension(format!("stale-{}-{now}", std::process::id()));
            if fs::rename(&path, &stale).is_err() {
                return Ok(false);
            }
            let _ = fs::remove_file(stale);
            claim_room_scene_generation(root, job_id, attempt, timeout)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn release_room_scene_generation(root: &Path, job_id: &str, attempt: u8) -> Result<(), String> {
    let path = room_scene_claim_path(root, job_id);
    let lease = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RoomSceneProviderLease>(&bytes).ok());
    if lease.is_none_or(|lease| lease.attempt != attempt) {
        return Ok(());
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn persist_room_scene_job(
    root: &Path,
    job: FrozenRoomSceneJob,
) -> Result<PersistedRoomScene, String> {
    let _claim = room_scene_lock()?;
    job.validate()?;
    let path = room_scene_state_path(root, &job.job_id);
    if path.exists() {
        let existing = load_room_scene(root, &job.job_id)?;
        if existing.job != job {
            return Err("room-scene media intent already names a different frozen job".to_string());
        }
        return Ok(existing);
    }
    let state = PersistedRoomScene {
        schema_version: ROOM_SCENE_SCHEMA_VERSION,
        job,
        lifecycle: RoomSceneLifecycle::Pending,
        provider_attempts: 0,
        candidate_digest: None,
        prediction_id: None,
        published_asset_id: None,
        review_event_seq: None,
        review_reason: None,
        last_error: None,
    };
    store_room_scene(root, &state)?;
    Ok(state)
}

pub(super) async fn generate_room_scene_candidate(
    config: &ReplicateAvatarArtConfig,
    root: &Path,
    job_id: &str,
) -> Result<bool, String> {
    let state = load_room_scene(root, job_id)?;
    let timeout = Duration::from_secs(state.job.recipe.timeout_seconds);
    generate_room_scene_candidate_with(root, job_id, timeout, |resolved| async move {
        execute_replicate_art(config, &resolved).await
    })
    .await
}

async fn generate_room_scene_candidate_with<F, Fut>(
    root: &Path,
    job_id: &str,
    timeout: Duration,
    provider: F,
) -> Result<bool, String>
where
    F: FnOnce(ResolvedMediaJob) -> Fut,
    Fut: Future<Output = Result<DownloadedReplicateImage, String>>,
{
    let (resolved, attempt) = {
        let _claim = room_scene_lock()?;
        let mut state = load_room_scene(root, job_id)?;
        state.job.validate()?;
        if state.lifecycle == RoomSceneLifecycle::Ready {
            return Ok(true);
        }
        if state.lifecycle == RoomSceneLifecycle::Rejected {
            return Err("rejected room-scene jobs cannot be regenerated".to_string());
        }
        if let Some(candidate) = load_room_scene_candidate(root, &state.job)? {
            let disposition = prepare_room_scene_verdict(root, &state.job, &candidate)?;
            state.lifecycle = if disposition == MediaVerdictDisposition::Rejected {
                RoomSceneLifecycle::Rejected
            } else {
                RoomSceneLifecycle::ReviewPending
            };
            state.candidate_digest = Some(candidate_digest(&candidate));
            state.prediction_id = candidate.prediction_id;
            state.last_error = (disposition == MediaVerdictDisposition::Rejected).then(|| {
                media_candidate_violations(
                    root,
                    &state.job.job_id,
                    state.candidate_digest.as_deref().unwrap_or_default(),
                )
                .unwrap_or_else(|error| vec![error])
                .join(", ")
            });
            store_room_scene(root, &state)?;
            return Ok(true);
        }
        if !media_provider_route_available(root, &state.job.job_id)? {
            return Err("room-scene provider route is cooling down or disabled".to_string());
        }
        let resolved = state.job.resolve(root)?;
        let attempt = state.provider_attempts.saturating_add(1);
        if !claim_room_scene_generation(root, job_id, attempt, timeout)? {
            return Ok(true);
        }
        if state.provider_attempts >= resolved.maximum_attempts {
            release_room_scene_generation(root, job_id, attempt)?;
            return Err("room-scene provider attempt budget is exhausted".to_string());
        }
        state.provider_attempts = attempt;
        state.lifecycle = RoomSceneLifecycle::Generating;
        state.last_error = None;
        if let Err(error) = store_room_scene(root, &state) {
            let _ = release_room_scene_generation(root, job_id, attempt);
            return Err(error);
        }
        (resolved, attempt)
    };
    let image = match tokio::time::timeout(timeout, provider(resolved)).await {
        Ok(Ok(image)) => image,
        Ok(Err(error)) => {
            let state = load_room_scene(root, job_id)?;
            let _ = record_media_provider_failure(
                root,
                room_scene_media_brief(&state.job),
                "replicate-primary",
            );
            fail_room_scene_generation(root, job_id, attempt, &error)?;
            return Err(error);
        }
        Err(_) => {
            let error = "room-scene provider timed out".to_string();
            let state = load_room_scene(root, job_id)?;
            let _ = record_media_provider_failure(
                root,
                room_scene_media_brief(&state.job),
                "replicate-primary",
            );
            fail_room_scene_generation(root, job_id, attempt, &error)?;
            return Err(error);
        }
    };
    let _claim = room_scene_lock()?;
    let mut state = load_room_scene(root, job_id)?;
    if state.lifecycle != RoomSceneLifecycle::Generating || state.provider_attempts != attempt {
        return Err("room-scene generation claim changed before provider completion".to_string());
    }
    if let Err(error) = store_room_scene_candidate(root, &state.job, &image) {
        let _ = remove_room_scene_candidate(root, &state.job);
        state.lifecycle = RoomSceneLifecycle::Failed;
        state.last_error = Some(error.clone());
        let stored = store_room_scene(root, &state);
        let released = release_room_scene_generation(root, job_id, attempt);
        stored?;
        released?;
        return Err(error);
    }
    state.candidate_digest = Some(candidate_digest(&image));
    state.prediction_id = image.prediction_id.clone();
    let disposition = prepare_room_scene_verdict(root, &state.job, &image)?;
    if disposition == MediaVerdictDisposition::Rejected {
        state.lifecycle = RoomSceneLifecycle::Rejected;
        state.last_error = Some(
            media_candidate_violations(
                root,
                &state.job.job_id,
                state.candidate_digest.as_deref().unwrap_or_default(),
            )?
            .join(", "),
        );
    } else {
        state.lifecycle = RoomSceneLifecycle::ReviewPending;
        state.last_error = None;
    }
    let stored = store_room_scene(root, &state);
    let released = release_room_scene_generation(root, job_id, attempt);
    stored?;
    released?;
    Ok(false)
}

fn fail_room_scene_generation(
    root: &Path,
    job_id: &str,
    attempt: u8,
    error: &str,
) -> Result<(), String> {
    let _claim = room_scene_lock()?;
    let mut state = load_room_scene(root, job_id)?;
    if state.provider_attempts != attempt {
        return Ok(());
    }
    state.lifecycle = RoomSceneLifecycle::Failed;
    state.last_error = Some(error.to_string());
    let stored = store_room_scene(root, &state);
    let released = release_room_scene_generation(root, job_id, attempt);
    stored?;
    released
}

fn review_room_scene_candidate(
    root: &Path,
    job_id: &str,
    approved: bool,
    review_event_seq: u64,
    reason: &str,
) -> Result<PersistedRoomScene, String> {
    let _claim = room_scene_lock()?;
    let mut state = load_room_scene(root, job_id)?;
    if state.lifecycle == RoomSceneLifecycle::Ready && approved {
        return Ok(state);
    }
    if state.lifecycle != RoomSceneLifecycle::ReviewPending {
        return Err("room-scene candidate is not awaiting review".to_string());
    }
    if review_event_seq < state.job.projection_seq {
        return Err("room-scene review cannot precede the frozen projection".to_string());
    }
    let review_reason = crate::compact_whitespace(reason);
    let image = load_room_scene_candidate(root, &state.job)?
        .ok_or_else(|| "room-scene candidate bytes are missing".to_string())?;
    let digest = candidate_digest(&image);
    let brief = room_scene_media_brief(&state.job);
    let verdict = make_visual_verdict(
        &brief,
        digest.clone(),
        "operator",
        "cosyworld.room-scene-moderation/1",
        approved,
        (!approved)
            .then_some(MediaViolation::OperatorRejected)
            .into_iter()
            .collect(),
        review_reason.clone(),
        1,
        0,
        0,
    )?;
    let disposition = record_media_visual_verdict(root, &state.job.job_id, verdict)?;
    if !approved {
        state.lifecycle = RoomSceneLifecycle::Rejected;
        state.review_event_seq = Some(review_event_seq);
        state.review_reason = Some(review_reason.clone());
        state.last_error = Some(review_reason);
        store_room_scene(root, &state)?;
        return Ok(state);
    }
    if disposition != MediaVerdictDisposition::Approved
        || !media_candidate_approved(root, &state.job.job_id, &digest)?
    {
        return Err("room-scene candidate has no durable approving verdict".to_string());
    }
    let references = state
        .job
        .references
        .iter()
        .map(|reference| (reference.slot, reference.reference.clone()))
        .collect::<Vec<_>>();
    let manifest = &active_content().manifest;
    let asset_id = register_derived_room_scene_media_asset(
        root,
        state.job.location_id,
        state.job.location_level,
        &image.bytes,
        &image.content_type,
        &references,
        &state.job.crop,
        MediaAssetProvenance {
            pack_id: manifest.id.clone(),
            pack_version: manifest.version.to_string(),
            composition_id: format!("room-scene:{}", state.job.job_id),
            composition_revision: state.job.digest()?,
            provider: "replicate".to_string(),
            model: format!(
                "{}/{}",
                state.job.recipe.model_owner, state.job.recipe.model_name
            ),
            model_version: state.job.recipe.model_revision.clone(),
            prompt_version: state.job.recipe.prompt_template_version.clone(),
            seed: None,
            prediction_id: image.prediction_id.clone(),
            source_event_seq: Some(review_event_seq),
            history_through_seq: state.job.projection_seq,
        },
    )?;
    reconcile_community_media_asset_status(
        root,
        "location",
        state.job.location_id,
        state.job.location_level,
        "ready",
        image.prediction_id.as_deref(),
        Some(review_event_seq),
    )?;
    state.lifecycle = RoomSceneLifecycle::Ready;
    state.published_asset_id = Some(asset_id);
    state.review_event_seq = Some(review_event_seq);
    state.review_reason = Some(review_reason);
    state.last_error = None;
    store_room_scene(root, &state)?;
    remove_room_scene_candidate(root, &state.job)?;
    Ok(state)
}

pub(super) async fn create_room_scene(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<CreateRoomSceneRequest>,
) -> Response {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "room-scene-actor",
        CHAT_ACTION_LIMIT,
    ) {
        return room_scene_json(StatusCode::TOO_MANY_REQUESTS, None, None, "rate limited");
    }
    let Some(config) = state.avatar_art_config.as_ref().clone() else {
        return room_scene_json(
            StatusCode::SERVICE_UNAVAILABLE,
            None,
            None,
            "image provider unavailable",
        );
    };
    let job = {
        let runtime = state.inner.lock().await;
        if !client_actor_authorized_for_state(
            &runtime,
            &state,
            payload.actor_id,
            payload.actor_session.as_deref(),
        ) {
            return room_scene_json(StatusCode::FORBIDDEN, None, None, "actor session rejected");
        }
        match runtime.freeze_room_scene(
            &state.generated_asset_dir,
            payload.actor_id,
            payload.event_seq,
        ) {
            Ok(job) => job,
            Err(error) => return room_scene_json(StatusCode::CONFLICT, None, None, &error),
        }
    };
    let persisted = match persist_room_scene_job(&state.generated_asset_dir, job.clone()) {
        Ok(persisted) => persisted,
        Err(error) => return room_scene_json(StatusCode::CONFLICT, None, None, &error),
    };
    if matches!(
        persisted.lifecycle,
        RoomSceneLifecycle::Pending | RoomSceneLifecycle::Failed
    ) {
        let root = state.generated_asset_dir.clone();
        tokio::spawn(async move {
            if let Err(error) = generate_room_scene_candidate(&config, &root, &job.job_id).await {
                tracing::warn!("room-scene generation {} failed: {error}", job.job_id);
            }
        });
    }
    room_scene_ok(&persisted, StatusCode::ACCEPTED)
}

pub(super) async fn room_scene_status(
    State(state): State<AppState>,
    AxumPath(job_id): AxumPath<String>,
) -> Response {
    match load_room_scene(&state.generated_asset_dir, &job_id) {
        Ok(scene) => room_scene_ok(&scene, StatusCode::OK),
        Err(error) => room_scene_json(StatusCode::NOT_FOUND, None, None, &error),
    }
}

pub(super) async fn review_room_scene(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(job_id): AxumPath<String>,
    Json(payload): Json<ReviewRoomSceneRequest>,
) -> Response {
    if !moderation_authorized(&state, &headers) {
        return room_scene_json(
            StatusCode::FORBIDDEN,
            Some(job_id),
            None,
            "moderation bearer token required",
        );
    }
    let reason = payload.reason.as_deref().unwrap_or("room-scene review");
    let review_event_seq = {
        let runtime = state.inner.lock().await;
        runtime.world.next_event_seq.saturating_sub(1)
    };
    match review_room_scene_candidate(
        &state.generated_asset_dir,
        &job_id,
        payload.approved,
        review_event_seq,
        reason,
    ) {
        Ok(scene) => room_scene_ok(&scene, StatusCode::OK),
        Err(error) => room_scene_json(StatusCode::CONFLICT, Some(job_id), None, &error),
    }
}

pub(super) async fn generated_room_scene_asset(
    State(state): State<AppState>,
    AxumPath(asset_file): AxumPath<String>,
) -> Response {
    let Some(job_id) = asset_file.strip_suffix(".image") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(scene) = load_room_scene(&state.generated_asset_dir, job_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if scene.lifecycle != RoomSceneLifecycle::Ready || scene.job.visibility != ROOM_SCENE_VISIBILITY
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(asset_id) = scene.published_asset_id else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok((bytes, content_type)) =
        immutable_media_asset_bytes(&state.generated_asset_dir, &asset_id)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !is_safe_image_content_type(&content_type) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut response = bytes.into_response();
    *response.status_mut() = StatusCode::OK;
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    response
}

fn room_scene_response(
    scene: &PersistedRoomScene,
    status: u16,
    error: Option<String>,
) -> RoomSceneResponse {
    RoomSceneResponse {
        ok: error.is_none(),
        status,
        job_id: Some(scene.job.job_id.clone()),
        lifecycle: Some(scene.lifecycle),
        media_intent: Some(scene.job.event_media_intent.clone()),
        image_url: (scene.lifecycle == RoomSceneLifecycle::Ready)
            .then(|| format!("/assets/generated/room-scenes/{}.image", scene.job.job_id)),
        error,
    }
}

fn room_scene_ok(scene: &PersistedRoomScene, status: StatusCode) -> Response {
    (
        status,
        Json(room_scene_response(scene, status.as_u16(), None)),
    )
        .into_response()
}

fn room_scene_json(
    status: StatusCode,
    job_id: Option<String>,
    lifecycle: Option<RoomSceneLifecycle>,
    error: &str,
) -> Response {
    (
        status,
        Json(RoomSceneResponse {
            ok: false,
            status: status.as_u16(),
            job_id,
            lifecycle,
            media_intent: None,
            image_url: None,
            error: Some(error.to_string()),
        }),
    )
        .into_response()
}

fn load_room_scene(root: &Path, job_id: &str) -> Result<PersistedRoomScene, String> {
    validate_job_id(job_id)?;
    let scene = serde_json::from_slice::<PersistedRoomScene>(
        &fs::read(room_scene_state_path(root, job_id)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if scene.schema_version != ROOM_SCENE_SCHEMA_VERSION || scene.job.job_id != job_id {
        return Err("room-scene persisted identity is invalid".to_string());
    }
    scene.job.validate()?;
    Ok(scene)
}

fn store_room_scene(root: &Path, scene: &PersistedRoomScene) -> Result<(), String> {
    scene.job.validate()?;
    atomic_write(
        &room_scene_state_path(root, &scene.job.job_id),
        &serde_json::to_vec(scene).map_err(|error| error.to_string())?,
    )
}

fn store_room_scene_candidate(
    root: &Path,
    job: &FrozenRoomSceneJob,
    image: &DownloadedReplicateImage,
) -> Result<(), String> {
    if !is_safe_image_content_type(&image.content_type) {
        return Err("room-scene provider returned an unsafe content type".to_string());
    }
    let metadata = RoomSceneCandidateMetadata {
        schema_version: ROOM_SCENE_SCHEMA_VERSION,
        content_type: image.content_type.clone(),
        source_url: image.source_url.clone(),
        prediction_id: image.prediction_id.clone(),
        digest: candidate_digest(image),
    };
    atomic_write(&room_scene_candidate_path(root, job), &image.bytes)?;
    atomic_write(
        &room_scene_candidate_metadata_path(root, job),
        &serde_json::to_vec(&metadata).map_err(|error| error.to_string())?,
    )
}

fn load_room_scene_candidate(
    root: &Path,
    job: &FrozenRoomSceneJob,
) -> Result<Option<DownloadedReplicateImage>, String> {
    let path = room_scene_candidate_path(root, job);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let metadata = serde_json::from_slice::<RoomSceneCandidateMetadata>(
        &fs::read(room_scene_candidate_metadata_path(root, job))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if metadata.schema_version != ROOM_SCENE_SCHEMA_VERSION
        || !is_safe_image_content_type(&metadata.content_type)
        || metadata.digest != format!("{:x}", Sha256::digest(&bytes))
    {
        return Err("room-scene candidate metadata does not match its bytes".to_string());
    }
    Ok(Some(DownloadedReplicateImage {
        bytes,
        content_type: metadata.content_type,
        source_url: metadata.source_url,
        prediction_id: metadata.prediction_id,
    }))
}

fn remove_room_scene_candidate(root: &Path, job: &FrozenRoomSceneJob) -> Result<(), String> {
    for path in [
        room_scene_candidate_path(root, job),
        room_scene_candidate_metadata_path(root, job),
    ] {
        if let Err(error) = fs::remove_file(path) {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error.to_string());
            }
        }
    }
    Ok(())
}

pub(super) fn request_room_scene_candidate_replacement(
    root: &Path,
    job_id: &str,
    reason: &str,
) -> Result<bool, String> {
    if validate_job_id(job_id).is_err() || !room_scene_state_path(root, job_id).exists() {
        return Ok(false);
    }
    let _claim = room_scene_lock()?;
    let mut state = load_room_scene(root, job_id)?;
    if state.lifecycle == RoomSceneLifecycle::Ready {
        return Err("a published room scene requires a new frozen job".to_string());
    }
    remove_room_scene_candidate(root, &state.job)?;
    state.lifecycle = RoomSceneLifecycle::Failed;
    state.candidate_digest = None;
    state.prediction_id = None;
    state.last_error = Some(crate::compact_whitespace(reason));
    store_room_scene(root, &state)?;
    Ok(true)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "room-scene storage path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("tmp-{}", crate::now_millis()));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn validate_job_id(job_id: &str) -> Result<(), String> {
    if job_id.len() != 64 || !job_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("room-scene job id is invalid".to_string());
    }
    Ok(())
}

fn room_scene_dir(root: &Path, job_id: &str) -> PathBuf {
    root.join("room-scenes").join(job_id)
}

fn room_scene_state_path(root: &Path, job_id: &str) -> PathBuf {
    room_scene_dir(root, job_id).join("state.json")
}

fn room_scene_claim_path(root: &Path, job_id: &str) -> PathBuf {
    room_scene_dir(root, job_id).join("provider.claim")
}

fn room_scene_candidate_path(root: &Path, job: &FrozenRoomSceneJob) -> PathBuf {
    room_scene_dir(root, &job.job_id).join("candidate.image")
}

fn room_scene_candidate_metadata_path(root: &Path, job: &FrozenRoomSceneJob) -> PathBuf {
    room_scene_dir(root, &job.job_id).join("candidate.metadata.json")
}

fn canonical_digest(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_vec(value)
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
        .map_err(|error| error.to_string())
}

fn candidate_digest(image: &DownloadedReplicateImage) -> String {
    format!("{:x}", Sha256::digest(&image.bytes))
}

#[cfg(test)]
#[path = "room_scene_tests.rs"]
mod tests;
