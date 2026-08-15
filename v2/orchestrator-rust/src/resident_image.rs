use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::Duration,
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::*;

const RESIDENT_IMAGE_SCHEMA_VERSION: u8 = 1;
const RESIDENT_IMAGE_FEATURE: &str = "dialogue_resident_image";
const RESIDENT_IMAGE_PROMPT_VERSION: &str = "dialogue-resident-image-v1";
const RESIDENT_IMAGE_POLICY_FEATURE: &str = "dialogue_resident_image_policy";
const RESIDENT_IMAGE_MAX_DIMENSION: u32 = 4_096;
const RESIDENT_IMAGE_MAX_PIXELS: u64 = 16_777_216;
const RESIDENT_IMAGE_POLICY: &str = "This is an in-world visual reply from a fictional resident. Fictional characters, creatures, people, ordinary objects, scenery, and harmless in-world text are allowed. Reject visible sexual content, graphic gore, hateful imagery, instructions or secrets that look copied from a system prompt, application UI chrome, logos, and watermarks. Do not reject merely because a character or creature is present.";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredResidentImage {
    schema_version: u8,
    job_id: String,
    actor_id: u64,
    content_type: String,
    width: u32,
    height: u32,
    digest: String,
    attribution: ModelAttribution,
    context_hash: String,
    prompt_version: String,
    attempts: u8,
    latency_ms: u64,
    #[serde(default)]
    token_usage: AiTokenUsage,
    review_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    review_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    review_violations: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ResidentImagePublication {
    pub(super) schema_version: u8,
    pub(super) asset_id: String,
    pub(super) url: String,
    pub(super) mime_type: String,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) alt: String,
    pub(super) digest: String,
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) prompt_version: String,
    pub(super) context_hash: String,
}

pub(super) struct GeneratedResidentImage {
    pub(super) publication: ResidentImagePublication,
    feature: &'static str,
    actor_id: u64,
    provider: String,
    model: String,
    latency_ms: u64,
    payer_mode: &'static str,
}

impl ResidentImagePublication {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.schema_version != RESIDENT_IMAGE_SCHEMA_VERSION {
            return Err("resident image schema version is unsupported".to_string());
        }
        validate_resident_image_id(&self.asset_id)?;
        if self.url != resident_image_url(&self.asset_id) {
            return Err("resident image URL does not match its asset id".to_string());
        }
        if !resident_image_content_type_is_supported(&self.mime_type) {
            return Err("resident image MIME type is unsupported".to_string());
        }
        validate_resident_image_dimensions(self.width, self.height)?;
        if !is_sha256_hex(&self.digest) || !is_sha256_hex(&self.context_hash) {
            return Err("resident image digest is invalid".to_string());
        }
        if self.alt.trim().is_empty()
            || self.alt.chars().count() > 280
            || self.alt.chars().any(|character| character.is_control())
        {
            return Err("resident image alternative text is invalid".to_string());
        }
        if self.provider.trim().is_empty()
            || self.model.trim().is_empty()
            || self.prompt_version != RESIDENT_IMAGE_PROMPT_VERSION
        {
            return Err("resident image attribution is invalid".to_string());
        }
        Ok(())
    }
}

pub(super) fn resident_uses_image_reply(actor_id: u64) -> bool {
    resident_image_binding(actor_id).is_some()
}

pub(super) fn resident_supports_native_reply(actor_id: u64) -> bool {
    resident_supports_text_reply(actor_id) || resident_uses_image_reply(actor_id)
}

pub(super) fn resident_reply_target_available(runtime: &RuntimeWorld, actor_id: u64) -> bool {
    !runtime.actor_uses_inference(actor_id) || resident_supports_native_reply(actor_id)
}

pub(super) fn card_reaction_responder_available(
    runtime: &RuntimeWorld,
    actor: CwActor,
    location_id: u64,
    active_direct_actor_ids: Option<&BTreeSet<u64>>,
) -> bool {
    RuntimeWorld::actor_can_act(actor)
        && actor.location_id == location_id
        && if runtime.actor_uses_inference(actor.id) {
            resident_supports_native_reply(actor.id)
        } else {
            active_direct_actor_ids.is_none_or(|active_ids| active_ids.contains(&actor.id))
        }
}

pub(super) fn native_reaction_responders(
    runtime: &RuntimeWorld,
    location_id: u64,
    active_direct_actor_ids: Option<&BTreeSet<u64>>,
) -> Vec<CwActor> {
    runtime.world.actors[..runtime.world.actor_count]
        .iter()
        .copied()
        .filter(|actor| {
            card_reaction_responder_available(runtime, *actor, location_id, active_direct_actor_ids)
        })
        .collect()
}

pub(super) fn resident_supports_text_reply(actor_id: u64) -> bool {
    let binding = active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| binding.actor_id == actor_id);
    let Some(binding) = binding else {
        return true;
    };
    binding_supports_text_reply(binding)
}

pub(super) fn binding_supports_text_reply(binding: &SeedActorModelBinding) -> bool {
    exact_actor_interaction_profile_for_binding(
        binding.actor_id,
        &binding.requested_model_id,
        &binding.canonical_slug,
        ActorInteractionKind::Talk,
    )
    .ok()
    .flatten()
    .is_some_and(|exact| {
        exact.profile.ready_before_policy()
            && exact.binding.requested_model_id == binding.requested_model_id
            && exact.binding.canonical_slug == binding.canonical_slug
    }) && PinnedModelSelection::from_actor_binding(binding, DataPolicyMode::Development).is_ok()
}

fn resident_image_binding(actor_id: u64) -> Option<&'static SeedActorModelBinding> {
    active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| {
            binding.actor_id == actor_id
                && binding_uses_image_reply(binding)
                && binding_supports_image_interaction(binding)
        })
}

pub(super) fn binding_supports_image_interaction(binding: &SeedActorModelBinding) -> bool {
    exact_actor_interaction_profile_for_binding(
        binding.actor_id,
        &binding.requested_model_id,
        &binding.canonical_slug,
        ActorInteractionKind::Illustrate,
    )
    .ok()
    .flatten()
    .is_some_and(|exact| {
        exact.profile.ready_before_policy()
            && exact.binding.requested_model_id == binding.requested_model_id
            && exact.binding.canonical_slug == binding.canonical_slug
    }) && PinnedModelSelection::from_actor_image_binding(binding, DataPolicyMode::Development)
        .is_ok()
}

fn binding_uses_image_reply(binding: &SeedActorModelBinding) -> bool {
    binding.input_modalities.iter().any(|value| value == "text")
        && binding
            .output_modalities
            .iter()
            .any(|value| value == "image")
        && !binding
            .output_modalities
            .iter()
            .any(|value| value == "text")
}

pub(super) async fn complete_resident_image_reply(
    state: &AppState,
    plan: &AvatarReplyPlan,
    relationship_reply: Option<&RelationshipReplyExpectation>,
) -> Result<bool, String> {
    let binding = resident_image_binding(plan.speaker_actor_id)
        .ok_or_else(|| "resident has no compatible image-model binding".to_string())?;
    let job_id = resident_image_job_id(plan);
    let generated = generate_moderated_resident_image(
        state,
        None,
        "server",
        binding,
        plan.speaker_actor_id,
        &job_id,
        &resident_image_prompt(plan),
        &format!(
            "{} shares a visual reply.",
            compact_whitespace(&plan.speaker_name)
        ),
        RESIDENT_IMAGE_FEATURE,
    )
    .await?;
    let Some(generated) = generated else {
        return Ok(false);
    };
    let events = {
        let mut runtime = state.inner.lock().await;
        commit_resident_image_record(
            state,
            &mut runtime,
            plan,
            generated.publication.clone(),
            relationship_reply,
        )?
    };
    let Some(events) = events else {
        return Ok(false);
    };
    if events.is_empty() {
        return Ok(true);
    }
    let source_event_id = events
        .iter()
        .find(|event| event.type_name == "image.created")
        .map(|event| event.seq);
    broadcast_events(state, &events);
    generated.record_published(state, source_event_id);
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn generate_moderated_resident_image(
    state: &AppState,
    config_override: Option<&AiConfig>,
    payer_mode: &'static str,
    binding: &SeedActorModelBinding,
    actor_id: u64,
    job_id: &str,
    prompt: &str,
    alt: &str,
    feature: &'static str,
) -> Result<Option<GeneratedResidentImage>, String> {
    validate_resident_image_id(job_id)?;
    let stored = match load_published_resident_image(&state.generated_asset_dir, job_id)? {
        Some(stored) => stored,
        None => {
            let config = config_override
                .or_else(|| state.ai_config.as_ref().as_ref())
                .ok_or_else(|| AiGatewayError::unconfigured(feature).to_string())?;
            config
                .pin_actor_image_model(binding)
                .map_err(|error| error.to_string())?;
            let reference = latest_resident_image_reference(
                state,
                actor_id,
                &binding.requested_model_id,
                job_id,
            )
            .await?;
            let mut candidate =
                match load_resident_image_candidate(&state.generated_asset_dir, job_id)? {
                    Some(candidate) => candidate,
                    None => {
                        let generated = request_image_generation_with_binding(
                            config,
                            binding,
                            ImageGenerationRequest {
                                feature,
                                prompt_version: RESIDENT_IMAGE_PROMPT_VERSION,
                                prompt,
                                reference: reference.as_ref().map(|reference| {
                                    ImageGenerationReference {
                                        bytes: &reference.bytes,
                                        content_type: &reference.content_type,
                                    }
                                }),
                                timeout: Duration::from_secs(90),
                                max_attempts: 2,
                                referer: "https://cosy.world/",
                            },
                        )
                        .await
                        .map_err(|error| {
                            record_ai_usage_for_provider(
                                state,
                                Some(actor_id),
                                feature,
                                payer_mode,
                                &binding.provider,
                                &binding.requested_model_id,
                                "failed",
                                None,
                                0,
                                Some(error.code()),
                                error.latency,
                            );
                            error.to_string()
                        })?;
                        let (image_bytes, content_type) = trim_transparent_image_padding(
                            &generated.bytes,
                            &generated.content_type,
                        )?;
                        let (width, height) =
                            validate_resident_image_bytes(&image_bytes, &content_type)?;
                        let candidate = StoredResidentImage {
                            schema_version: RESIDENT_IMAGE_SCHEMA_VERSION,
                            job_id: job_id.to_string(),
                            actor_id,
                            content_type,
                            width,
                            height,
                            digest: format!("{:x}", Sha256::digest(&image_bytes)),
                            attribution: generated.model_attribution,
                            context_hash: generated.context_hash,
                            prompt_version: generated.prompt_version,
                            attempts: generated.attempts,
                            latency_ms: generated.latency.as_millis() as u64,
                            token_usage: generated.usage,
                            review_status: "pending".to_string(),
                            review_summary: None,
                            review_violations: Vec::new(),
                        };
                        store_resident_image_candidate(
                            &state.generated_asset_dir,
                            &candidate,
                            &image_bytes,
                        )?;
                        candidate
                    }
                };
            if candidate.actor_id != actor_id {
                return Err("resident image actor does not match its durable job".to_string());
            }
            if candidate.review_status == "rejected" {
                return Ok(None);
            }
            let bytes = load_validated_resident_image_bytes(
                &resident_image_candidate_asset_path(&state.generated_asset_dir, job_id),
                &candidate,
            )?;
            let image_url = format!(
                "data:{};base64,{}",
                candidate.content_type,
                BASE64_STANDARD.encode(&bytes)
            );
            let review_started_at = Instant::now();
            let decision = request_image_policy_decision(
                config,
                ImagePolicyRequest {
                    feature: RESIDENT_IMAGE_POLICY_FEATURE,
                    image_url: &image_url,
                    policy: RESIDENT_IMAGE_POLICY,
                    timeout: Duration::from_secs(45),
                    max_attempts: 1,
                    referer: "https://cosy.world/",
                },
            )
            .await
            .map_err(|error| {
                record_ai_usage_for_provider(
                    state,
                    Some(actor_id),
                    RESIDENT_IMAGE_POLICY_FEATURE,
                    payer_mode,
                    ai_provider_name(Some(config)),
                    &config.vision_model,
                    "failed",
                    None,
                    0,
                    Some(error.code()),
                    error.latency,
                );
                error.to_string()
            })?;
            record_ai_usage_for_provider(
                state,
                Some(actor_id),
                RESIDENT_IMAGE_POLICY_FEATURE,
                payer_mode,
                ai_provider_name(Some(config)),
                &config.vision_model,
                if decision.allowed {
                    "approved"
                } else {
                    "rejected"
                },
                None,
                0,
                (!decision.allowed).then_some("image_policy_rejected"),
                review_started_at.elapsed(),
            );
            candidate.review_summary = Some(decision.summary);
            candidate.review_violations = decision.violations;
            if !decision.allowed {
                candidate.review_status = "rejected".to_string();
                store_resident_image_candidate_metadata(&state.generated_asset_dir, &candidate)?;
                record_ai_usage_for_provider(
                    state,
                    Some(actor_id),
                    feature,
                    payer_mode,
                    &candidate.attribution.provider,
                    &candidate.attribution.resolved_model_id,
                    "rejected",
                    None,
                    0,
                    Some("image_policy_rejected"),
                    Duration::from_millis(candidate.latency_ms),
                );
                return Ok(None);
            }
            candidate.review_status = "approved".to_string();
            publish_resident_image(&state.generated_asset_dir, &candidate, &bytes)?;
            candidate
        }
    };
    if stored.actor_id != actor_id {
        return Err("resident image actor does not match its durable job".to_string());
    }
    let publication = resident_image_publication(&stored, alt)?;
    Ok(Some(GeneratedResidentImage {
        publication,
        feature,
        actor_id,
        provider: stored.attribution.provider,
        model: stored.attribution.resolved_model_id,
        latency_ms: stored.latency_ms,
        payer_mode,
    }))
}

impl GeneratedResidentImage {
    pub(super) fn record_published(&self, state: &AppState, source_event_id: Option<u64>) {
        record_ai_usage_for_provider(
            state,
            Some(self.actor_id),
            self.feature,
            self.payer_mode,
            &self.provider,
            &self.model,
            "published",
            source_event_id,
            0,
            None,
            Duration::from_millis(self.latency_ms),
        );
    }
}

struct ResidentImageReference {
    bytes: Vec<u8>,
    content_type: String,
}

async fn latest_resident_image_reference(
    state: &AppState,
    actor_id: u64,
    requested_model_id: &str,
    excluded_job_id: &str,
) -> Result<Option<ResidentImageReference>, String> {
    let asset_ids = {
        let runtime = state.inner.lock().await;
        runtime
            .event_log
            .iter()
            .rev()
            .filter(|event| event.success && event.actor_id == Some(actor_id))
            .filter_map(resident_image_asset_id_from_event)
            .filter(|asset_id| asset_id != excluded_job_id)
            .take(16)
            .collect::<Vec<_>>()
    };
    for asset_id in asset_ids {
        let Some(stored) = load_published_resident_image(&state.generated_asset_dir, &asset_id)?
        else {
            continue;
        };
        if stored.actor_id != actor_id
            || stored.attribution.requested_model_id != requested_model_id
        {
            continue;
        }
        let bytes = load_validated_resident_image_bytes(
            &resident_image_published_asset_path(&state.generated_asset_dir, &asset_id),
            &stored,
        )?;
        return Ok(Some(ResidentImageReference {
            bytes,
            content_type: stored.content_type,
        }));
    }
    Ok(None)
}

fn resident_image_asset_id_from_event(event: &EventView) -> Option<String> {
    let content = event.content.as_deref()?;
    let value = serde_json::from_str::<serde_json::Value>(content).ok()?;
    let asset_id = match event.type_name.as_str() {
        "image.created" => value.get("asset_id").and_then(serde_json::Value::as_str),
        "model_interaction.output" => value
            .get("output_parts")
            .and_then(serde_json::Value::as_array)
            .and_then(|parts| {
                parts.iter().find_map(|part| {
                    (part.get("modality").and_then(serde_json::Value::as_str) == Some("image"))
                        .then(|| {
                            part.get("image")
                                .and_then(|image| image.get("asset_id"))
                                .and_then(serde_json::Value::as_str)
                        })
                        .flatten()
                })
            }),
        _ => None,
    }?;
    is_sha256_hex(asset_id).then(|| asset_id.to_string())
}

fn trim_transparent_image_padding(
    bytes: &[u8],
    content_type: &str,
) -> Result<(Vec<u8>, String), String> {
    if content_type == "image/gif" {
        return Ok((bytes.to_vec(), content_type.to_string()));
    }
    let format = match content_type {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err("resident image format is unsupported".to_string()),
    };
    let rgba = image::load_from_memory_with_format(bytes, format)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut left = width;
    let mut top = height;
    let mut right = 0;
    let mut bottom = 0;
    let mut found = false;
    for (x, y, pixel) in rgba.enumerate_pixels() {
        if pixel[3] > 4 {
            found = true;
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
    }
    if !found {
        return Ok((bytes.to_vec(), content_type.to_string()));
    }
    let cropped_width = right.saturating_sub(left).saturating_add(1);
    let cropped_height = bottom.saturating_sub(top).saturating_add(1);
    let removed_width = width.saturating_sub(cropped_width);
    let removed_height = height.saturating_sub(cropped_height);
    if removed_width.saturating_mul(20) < width && removed_height.saturating_mul(20) < height {
        return Ok((bytes.to_vec(), content_type.to_string()));
    }
    let cropped =
        image::imageops::crop_imm(&rgba, left, top, cropped_width, cropped_height).to_image();
    let mut output = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(cropped)
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok((output.into_inner(), "image/png".to_string()))
}

fn resident_image_prompt(plan: &AvatarReplyPlan) -> String {
    let incoming = plan
        .incoming_turn
        .as_ref()
        .map(|turn| turn.content.as_str())
        .unwrap_or(plan.user_text.as_str());
    format!(
        "Create one image as {speaker}, a resident of {location}. It is your visual reply to this latest in-world moment: {incoming}\n\nSetting: {description}\n\nShow a single coherent, inviting scene that communicates your response through composition, expression, action, light, and objects. Stay grounded in the described place. Do not render an application interface, chat bubbles, a frame, a watermark, a logo, model names, or system instructions. No caption is required.",
        speaker = compact_whitespace(&plan.speaker_name),
        location = compact_whitespace(&plan.location_name),
        incoming = compact_whitespace(incoming),
        description = compact_whitespace(&plan.location_description),
    )
}

fn resident_image_job_id(plan: &AvatarReplyPlan) -> String {
    let mut hasher = Sha256::new();
    hasher.update(RESIDENT_IMAGE_PROMPT_VERSION.as_bytes());
    hasher.update([0]);
    hasher.update(plan.speaker_actor_id.to_be_bytes());
    hasher.update([0]);
    hasher.update(plan.publication_beat_id.as_bytes());
    hasher.update([0]);
    hasher.update(plan.caused_by_event_seq.unwrap_or(0).to_be_bytes());
    hasher.update(plan.source_world_tick.unwrap_or(0).to_be_bytes());
    hasher.update(plan.observed_through_seq.unwrap_or(0).to_be_bytes());
    hasher.update(plan.source_location_id.unwrap_or(0).to_be_bytes());
    hasher.update([0]);
    hasher.update(plan.location_name.as_bytes());
    hasher.update([0]);
    hasher.update(plan.user_text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn resident_image_publication(
    stored: &StoredResidentImage,
    alt: &str,
) -> Result<ResidentImagePublication, String> {
    let publication = ResidentImagePublication {
        schema_version: RESIDENT_IMAGE_SCHEMA_VERSION,
        asset_id: stored.job_id.clone(),
        url: resident_image_url(&stored.job_id),
        mime_type: stored.content_type.clone(),
        width: stored.width,
        height: stored.height,
        alt: compact_whitespace(alt),
        digest: stored.digest.clone(),
        provider: stored.attribution.provider.clone(),
        model: stored.attribution.resolved_model_id.clone(),
        prompt_version: stored.prompt_version.clone(),
        context_hash: stored.context_hash.clone(),
    };
    publication.validate()?;
    Ok(publication)
}

fn commit_resident_image_record(
    state: &AppState,
    runtime: &mut RuntimeWorld,
    plan: &AvatarReplyPlan,
    publication: ResidentImagePublication,
    relationship_reply: Option<&RelationshipReplyExpectation>,
) -> Result<Option<Vec<EventView>>, String> {
    publication.validate()?;
    if runtime.event_log.iter().any(|event| {
        event.success
            && event.type_name == "image.created"
            && event.actor_id == Some(plan.speaker_actor_id)
            && event.caused_by_event_seq == plan.caused_by_event_seq
            && event
                .content
                .as_deref()
                .is_some_and(|content| content.contains(&publication.asset_id))
    }) {
        return Ok(Some(Vec::new()));
    }
    let Some(speaker) = runtime.actor_by_id(plan.speaker_actor_id) else {
        return Ok(None);
    };
    if !RuntimeWorld::actor_can_act(speaker)
        || plan
            .source_location_id
            .is_some_and(|location_id| speaker.location_id != location_id)
    {
        return Ok(None);
    }
    let target_actor_id = plan
        .incoming_turn
        .as_ref()
        .map(|turn| turn.speaker_actor_id);
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: plan.speaker_actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.origin = JournalOrigin::Speech;
    record.caused_by_event_seq = plan.caused_by_event_seq;
    record.source_world_tick = plan.source_world_tick;
    record.observed_through_seq = plan.observed_through_seq;
    record.source_location_id = plan.source_location_id;
    record
        .projection_mutations
        .push(ProjectionMutation::PublishResidentImage {
            publication: Box::new(publication),
            target_actor_id,
        });
    if let Some(expectation) = relationship_reply {
        record
            .projection_mutations
            .push(ProjectionMutation::SetRelationshipDialogueStatus {
                relationship_actor_id: expectation.actor_id,
                target_actor_id: expectation.target_actor_id,
                status: RELATIONSHIP_DIALOGUE_DELIVERED.to_string(),
                reason: "one moderated resident image reply was delivered".to_string(),
            });
    }
    let (status, events) = commit_journal_record(state, runtime, record)
        .map_err(|error| format!("resident image journal commit failed: {error}"))?;
    Ok((status == CW_OK).then_some(events))
}

pub(super) async fn generated_resident_image_asset(
    State(state): State<AppState>,
    AxumPath(asset_file): AxumPath<String>,
) -> Response {
    let Some(job_id) = asset_file.strip_suffix(".image") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(stored)) = load_published_resident_image(&state.generated_asset_dir, job_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(bytes) = load_validated_resident_image_bytes(
        &resident_image_published_asset_path(&state.generated_asset_dir, job_id),
        &stored,
    ) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = bytes.into_response();
    *response.status_mut() = StatusCode::OK;
    if let Ok(value) = HeaderValue::from_str(&stored.content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    response.headers_mut().insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn publish_resident_image(
    root: &Path,
    stored: &StoredResidentImage,
    bytes: &[u8],
) -> Result<(), String> {
    let mut approved = stored.clone();
    approved.review_status = "approved".to_string();
    validate_stored_resident_image(&approved, bytes, "approved")?;
    atomic_write(
        &resident_image_published_asset_path(root, &approved.job_id),
        bytes,
    )?;
    atomic_write(
        &resident_image_published_metadata_path(root, &approved.job_id),
        &serde_json::to_vec(&approved).map_err(|error| error.to_string())?,
    )
}

fn store_resident_image_candidate(
    root: &Path,
    stored: &StoredResidentImage,
    bytes: &[u8],
) -> Result<(), String> {
    validate_stored_resident_image(stored, bytes, "pending")?;
    atomic_write(
        &resident_image_candidate_asset_path(root, &stored.job_id),
        bytes,
    )?;
    store_resident_image_candidate_metadata(root, stored)
}

fn store_resident_image_candidate_metadata(
    root: &Path,
    stored: &StoredResidentImage,
) -> Result<(), String> {
    atomic_write(
        &resident_image_candidate_metadata_path(root, &stored.job_id),
        &serde_json::to_vec(stored).map_err(|error| error.to_string())?,
    )
}

fn load_resident_image_candidate(
    root: &Path,
    job_id: &str,
) -> Result<Option<StoredResidentImage>, String> {
    load_stored_resident_image(
        &resident_image_candidate_metadata_path(root, job_id),
        &resident_image_candidate_asset_path(root, job_id),
        job_id,
        &["pending", "rejected"],
    )
}

fn load_published_resident_image(
    root: &Path,
    job_id: &str,
) -> Result<Option<StoredResidentImage>, String> {
    load_stored_resident_image(
        &resident_image_published_metadata_path(root, job_id),
        &resident_image_published_asset_path(root, job_id),
        job_id,
        &["approved"],
    )
}

fn load_stored_resident_image(
    metadata_path: &Path,
    asset_path: &Path,
    job_id: &str,
    statuses: &[&str],
) -> Result<Option<StoredResidentImage>, String> {
    validate_resident_image_id(job_id)?;
    if !metadata_path.exists() && !asset_path.exists() {
        return Ok(None);
    }
    let stored = serde_json::from_slice::<StoredResidentImage>(
        &fs::read(metadata_path).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let bytes = fs::read(asset_path).map_err(|error| error.to_string())?;
    if stored.job_id != job_id || !statuses.contains(&stored.review_status.as_str()) {
        return Err("resident image persisted identity is invalid".to_string());
    }
    validate_stored_resident_image(&stored, &bytes, &stored.review_status)?;
    Ok(Some(stored))
}

fn validate_stored_resident_image(
    stored: &StoredResidentImage,
    bytes: &[u8],
    expected_status: &str,
) -> Result<(), String> {
    if stored.schema_version != RESIDENT_IMAGE_SCHEMA_VERSION
        || stored.review_status != expected_status
        || stored.actor_id == 0
        || stored.prompt_version != RESIDENT_IMAGE_PROMPT_VERSION
        || stored.digest != format!("{:x}", Sha256::digest(bytes))
        || !is_sha256_hex(&stored.context_hash)
    {
        return Err("resident image metadata does not match its bytes".to_string());
    }
    validate_resident_image_id(&stored.job_id)?;
    let (width, height) = validate_resident_image_bytes(bytes, &stored.content_type)?;
    if (width, height) != (stored.width, stored.height) {
        return Err("resident image dimensions do not match metadata".to_string());
    }
    Ok(())
}

fn load_validated_resident_image_bytes(
    path: &Path,
    stored: &StoredResidentImage,
) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    validate_stored_resident_image(stored, &bytes, &stored.review_status)?;
    Ok(bytes)
}

fn validate_resident_image_bytes(bytes: &[u8], content_type: &str) -> Result<(u32, u32), String> {
    if !resident_image_content_type_is_supported(content_type) {
        return Err("resident image format is unsupported".to_string());
    }
    let expected = match content_type {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        "image/gif" => image::ImageFormat::Gif,
        _ => return Err("resident image format is unsupported".to_string()),
    };
    if image::guess_format(bytes).map_err(|error| error.to_string())? != expected {
        return Err("resident image MIME type does not match its bytes".to_string());
    }
    let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), expected)
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    validate_resident_image_dimensions(width, height)?;
    Ok((width, height))
}

fn validate_resident_image_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > RESIDENT_IMAGE_MAX_DIMENSION
        || height > RESIDENT_IMAGE_MAX_DIMENSION
        || u64::from(width).saturating_mul(u64::from(height)) > RESIDENT_IMAGE_MAX_PIXELS
    {
        return Err("resident image dimensions exceed the publication limit".to_string());
    }
    Ok(())
}

fn resident_image_content_type_is_supported(value: &str) -> bool {
    matches!(
        value,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_resident_image_id(value: &str) -> Result<(), String> {
    if !is_sha256_hex(value) {
        return Err("resident image asset id is invalid".to_string());
    }
    Ok(())
}

fn resident_image_url(job_id: &str) -> String {
    format!("/assets/generated/resident-images/{job_id}.image")
}

fn resident_image_candidate_dir(root: &Path) -> PathBuf {
    root.join("resident-image-candidates")
}

fn resident_image_published_dir(root: &Path) -> PathBuf {
    root.join("resident-images")
}

fn resident_image_candidate_asset_path(root: &Path, job_id: &str) -> PathBuf {
    resident_image_candidate_dir(root).join(format!("{job_id}.image"))
}

fn resident_image_candidate_metadata_path(root: &Path, job_id: &str) -> PathBuf {
    resident_image_candidate_dir(root).join(format!("{job_id}.json"))
}

fn resident_image_published_asset_path(root: &Path, job_id: &str) -> PathBuf {
    resident_image_published_dir(root).join(format!("{job_id}.image"))
}

fn resident_image_published_metadata_path(root: &Path, job_id: &str) -> PathBuf {
    resident_image_published_dir(root).join(format!("{job_id}.json"))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "resident image storage path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("tmp-{}", now_seed()));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elysium_image_binding() -> SeedActorModelBinding {
        serde_json::from_str::<Vec<SeedActorModelBinding>>(include_str!(
            "../../content/elysium/actor_model_bindings.json"
        ))
        .expect("Elysium actor model bindings")
        .into_iter()
        .find(|binding| binding.actor_id == 677_376_455_611)
        .expect("FLUX.2 Klein actor binding")
    }

    #[test]
    fn elysium_flux_klein_is_an_image_reply_resident_not_a_text_reply_resident() {
        let binding = elysium_image_binding();
        assert!(binding_uses_image_reply(&binding));
        assert!(!binding
            .output_modalities
            .iter()
            .any(|value| value == "text"));
    }

    #[test]
    fn every_hoppycat_model_resident_has_an_exact_text_reply_route() {
        let bindings = serde_json::from_str::<Vec<SeedActorModelBinding>>(include_str!(
            "../../content/hoppycat-archive/actor_model_bindings.json"
        ))
        .expect("Hoppycat actor model bindings");
        assert_eq!(bindings.len(), 7);
        assert!(bindings.iter().all(binding_supports_text_reply));

        let mut changed = bindings[0].clone();
        changed.canonical_slug = "anthropic/changed-canonical-slug".to_string();
        assert!(!binding_supports_text_reply(&changed));
    }

    #[test]
    fn recraft_vector_bindings_wait_for_safe_svg_rasterization() {
        let bindings = serde_json::from_str::<Vec<SeedActorModelBinding>>(include_str!(
            "../../content/elysium/actor_model_bindings.json"
        ))
        .expect("Elysium actor model bindings");
        let vector_bindings = bindings
            .iter()
            .filter(|binding| {
                binding.requested_model_id.starts_with("recraft/recraft-v4")
                    && binding.requested_model_id.ends_with("vector")
            })
            .collect::<Vec<_>>();
        assert_eq!(vector_bindings.len(), 4);
        assert!(vector_bindings.iter().all(|binding| {
            let exact = exact_actor_interaction_profile_for_actor(
                binding.actor_id,
                ActorInteractionKind::Illustrate,
            )
            .expect("profile registry")
            .expect("vector illustrate profile");
            !exact.profile.ready_before_policy() && !binding_supports_image_interaction(binding)
        }));
    }

    #[test]
    fn resident_image_asset_ids_are_strict_lowercase_sha256() {
        assert!(validate_resident_image_id(&"a".repeat(64)).is_ok());
        assert!(validate_resident_image_id(&"A".repeat(64)).is_err());
        assert!(validate_resident_image_id("../image").is_err());
    }

    #[test]
    fn transparent_generated_padding_is_removed_before_publication() {
        let mut padded = image::RgbaImage::new(8, 8);
        for x in 0..8 {
            padded.put_pixel(x, 0, image::Rgba([80, 120, 160, 255]));
        }
        let mut encoded = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(padded)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("encode padded PNG");

        let (trimmed, content_type) =
            trim_transparent_image_padding(encoded.get_ref(), "image/png")
                .expect("trim transparent padding");

        assert_eq!(content_type, "image/png");
        assert_eq!(
            validate_resident_image_bytes(&trimmed, &content_type).expect("trimmed dimensions"),
            (8, 1)
        );
    }

    #[test]
    fn image_reference_identity_is_read_from_both_public_event_shapes() {
        let asset_id = "a".repeat(64);
        let direct = EventView {
            type_name: "image.created".to_string(),
            content: Some(serde_json::json!({ "asset_id": asset_id }).to_string()),
            ..EventView::default()
        };
        assert_eq!(
            resident_image_asset_id_from_event(&direct),
            Some("a".repeat(64))
        );

        let model_output = EventView {
            type_name: "model_interaction.output".to_string(),
            content: Some(
                serde_json::json!({
                    "output_parts": [{
                        "modality": "image",
                        "image": { "asset_id": "b".repeat(64) }
                    }]
                })
                .to_string(),
            ),
            ..EventView::default()
        };
        assert_eq!(
            resident_image_asset_id_from_event(&model_output),
            Some("b".repeat(64))
        );
    }

    #[test]
    fn resident_image_projection_publishes_self_contained_room_event() {
        let mut runtime = RuntimeWorld::seeded();
        let asset_id = "a".repeat(64);
        let publication = ResidentImagePublication {
            schema_version: RESIDENT_IMAGE_SCHEMA_VERSION,
            asset_id: asset_id.clone(),
            url: resident_image_url(&asset_id),
            mime_type: "image/png".to_string(),
            width: 1,
            height: 1,
            alt: "Rati shares a visual reply.".to_string(),
            digest: "b".repeat(64),
            provider: "openrouter".to_string(),
            model: "black-forest-labs/flux.2-klein-4b".to_string(),
            prompt_version: RESIDENT_IMAGE_PROMPT_VERSION.to_string(),
            context_hash: "c".repeat(64),
        };
        let events = runtime.apply_projection_mutations(
            &CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                ..CwAction::default()
            },
            &[],
            &[ProjectionMutation::PublishResidentImage {
                publication: Box::new(publication),
                target_actor_id: Some(1002),
            }],
            false,
            false,
            &active_content().manifest.bundle_hash,
        );

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].type_name, "image.created");
        assert_eq!(events[0].actor_id, Some(RATI_ACTOR_ID));
        assert_eq!(events[0].target_actor_id, Some(1002));
        let payload: serde_json::Value =
            serde_json::from_str(events[0].content.as_deref().expect("image event payload"))
                .expect("image event JSON");
        assert_eq!(payload["asset_id"], asset_id);
        assert_eq!(payload["model"], "black-forest-labs/flux.2-klein-4b");
        assert!(payload.get("prompt").is_none());
    }

    #[test]
    fn browser_transcript_has_a_strict_resident_image_renderer() {
        assert!(INDEX_HTML.contains("function residentImageMetadata(event)"));
        assert!(INDEX_HTML.contains("/assets/generated/resident-images/${assetId}.image"));
        assert!(INDEX_HTML.contains("loading=\"lazy\" decoding=\"async\""));
        assert!(INDEX_HTML.contains("[\"message.created\", \"image.created\"]"));
    }

    #[tokio::test]
    async fn only_an_approved_digest_checked_image_is_served_publicly() {
        const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let bytes = BASE64_STANDARD.decode(PNG_1X1).expect("one pixel PNG");
        let binding = elysium_image_binding();
        let attribution =
            PinnedModelSelection::from_actor_image_binding(&binding, DataPolicyMode::Development)
                .expect("image binding selection")
                .attribute_response(None)
                .expect("image binding attribution");
        let job_id = "d".repeat(64);
        let stored = StoredResidentImage {
            schema_version: RESIDENT_IMAGE_SCHEMA_VERSION,
            job_id: job_id.clone(),
            actor_id: binding.actor_id,
            content_type: "image/png".to_string(),
            width: 1,
            height: 1,
            digest: format!("{:x}", Sha256::digest(&bytes)),
            attribution,
            context_hash: "e".repeat(64),
            prompt_version: RESIDENT_IMAGE_PROMPT_VERSION.to_string(),
            attempts: 1,
            latency_ms: 2,
            token_usage: AiTokenUsage::default(),
            review_status: "approved".to_string(),
            review_summary: Some("safe fictional scene".to_string()),
            review_violations: Vec::new(),
        };
        let root = std::env::temp_dir().join(format!("cosyworld-resident-image-{}", now_seed()));
        publish_resident_image(&root, &stored, &bytes).expect("publish approved image");
        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.generated_asset_dir = Arc::new(root.clone());

        let response =
            generated_resident_image_asset(State(state), AxumPath(format!("{job_id}.image"))).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&HeaderValue::from_static("image/png"))
        );
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL),
            Some(&HeaderValue::from_static(
                "public, max-age=31536000, immutable"
            ))
        );
        assert_eq!(
            response.headers().get("x-content-type-options"),
            Some(&HeaderValue::from_static("nosniff"))
        );
        let served = axum::body::to_bytes(response.into_body(), bytes.len())
            .await
            .expect("read approved image response");
        assert_eq!(served.as_ref(), bytes.as_slice());
        fs::remove_dir_all(root).expect("remove resident image test storage");
    }
}
