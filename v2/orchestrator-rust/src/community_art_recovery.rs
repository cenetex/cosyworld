use super::{
    community_art_generation_key, community_art_image_url, stored_community_art_content_type_path,
    stored_community_art_image_path, COMMUNITY_ART_BRIEF_CONFLICT_CODE,
};
use crate::{
    broadcast_events, commit_journal_record,
    media_recipes::media_verdict::with_approved_media_recovery, moderation_authorized,
    reconcile_community_media_asset_status, AppState, CwAction, JournalRecord, ProjectionMutation,
    CW_ACTION_NONE, CW_OK,
};
use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;

#[derive(Deserialize)]
pub(crate) struct PortraitRecoveryRequest {
    pub(crate) level: u8,
    pub(crate) revision: u32,
    pub(crate) image_digest: String,
    #[serde(default = "preview_by_default")]
    pub(crate) dry_run: bool,
}

fn preview_by_default() -> bool {
    true
}

pub(crate) async fn moderation_recover_portrait(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(subject_id): AxumPath<u64>,
    Json(request): Json<PortraitRecoveryRequest>,
) -> Response {
    if !moderation_authorized(&state, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match recover_portrait(&state, subject_id, request).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "error": error})),
        )
            .into_response(),
    }
}

async fn recover_portrait(
    state: &AppState,
    subject_id: u64,
    request: PortraitRecoveryRequest,
) -> Result<serde_json::Value, String> {
    let mut runtime = state.inner.lock().await;
    if request.level == 0
        || runtime.community_art_subject_level("actor", subject_id) != Some(request.level)
    {
        return Err("portrait recovery requires the avatar's current level".to_string());
    }
    let key = community_art_generation_key("actor", subject_id, request.level);
    let generation = runtime
        .community_art_generations
        .get(&key)
        .cloned()
        .ok_or_else(|| "funded portrait record is missing".to_string())?;
    let already_ready = generation.status == "ready";
    if !already_ready
        && (generation.status != "failed"
            || generation.last_error_code.as_deref() != Some(COMMUNITY_ART_BRIEF_CONFLICT_CODE)
            || generation.revision != request.revision)
    {
        return Err(
            "portrait state changed; inspect the current record before recovery".to_string(),
        );
    }
    if generation.funded_orbs < generation.required_orbs {
        return Err("portrait recovery requires completed funding".to_string());
    }
    if runtime.avatar_requires_self_description(subject_id, request.level) {
        return Err("portrait appearance is still being prepared".to_string());
    }
    let root = state.generated_asset_dir.as_path();
    let image_path = stored_community_art_image_path(root, "actor", subject_id);
    let bytes = fs::read(&image_path).map_err(|_| "saved portrait image is missing".to_string())?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    if digest != request.image_digest {
        return Err("saved portrait differs from the inspected image".to_string());
    }
    let content_type = fs::read_to_string(stored_community_art_content_type_path(
        root, "actor", subject_id,
    ))
    .map_err(|_| "saved portrait content type is missing".to_string())?;
    let events =
        with_approved_media_recovery(root, &key, &bytes, content_type.trim(), |prediction_id| {
            if request.dry_run || already_ready {
                return Ok(Vec::new());
            }
            let mut record = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: 0,
                    ..CwAction::default()
                },
                runtime.next_seed_value(),
            );
            record
                .projection_mutations
                .push(ProjectionMutation::CompleteCommunityArtGeneration {
                    subject_kind: "actor".to_string(),
                    subject_id,
                    level: request.level,
                    status: "ready".to_string(),
                    prediction_id: prediction_id.map(ToString::to_string),
                    error_code: None,
                });
            let (status, events) = commit_journal_record(state, &mut runtime, record)
                .map_err(|_| "portrait recovery could not be committed".to_string())?;
            if status != CW_OK || events.is_empty() {
                return Err("portrait recovery was rejected by the journal".to_string());
            }
            Ok(events)
        })?;
    let recovered = runtime.community_art_generations[&key].clone();
    drop(runtime);
    broadcast_events(state, &events);
    if !request.dry_run {
        reconcile_community_media_asset_status(
            root,
            "actor",
            subject_id,
            recovered.level,
            "ready",
            recovered.last_prediction_id.as_deref(),
            recovered.status_event_seq,
        )?;
    }
    Ok(json!({
        "ok": true,
        "subject_id": subject_id,
        "level": recovered.level,
        "revision": recovered.revision,
        "dry_run": request.dry_run,
        "restored": !events.is_empty(),
        "already_ready": already_ready,
        "image_digest": digest,
        "image_url": community_art_image_url("actor", subject_id, recovered.level, recovered.revision),
        "status_event_seq": recovered.status_event_seq,
        "funded_orbs": recovered.funded_orbs,
        "required_orbs": recovered.required_orbs,
    }))
}
