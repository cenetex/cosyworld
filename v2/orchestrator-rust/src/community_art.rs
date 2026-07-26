use std::{
    fs, io,
    path::{Path, PathBuf},
    time::Duration,
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};

use crate::{
    is_safe_image_content_type, now_millis, request_image_policy_decision, request_replicate_art,
    AiConfig, AppState, CommunityArtPlan, DownloadedReplicateImage, ImagePolicyRequest,
    ReplicateAvatarArtConfig,
};

const POLICY_GENERATION_ATTEMPTS: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CommunityArtImagePolicy {
    LocationLandscape,
}

impl CommunityArtImagePolicy {
    pub(super) fn prompt(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Landscape only. No people, human figures, humanoids, characters, animals, creatures, silhouettes, faces, body parts, statues, portraits, text, letters, numbers, logos, watermarks, UI, or card borders."
            }
        }
    }

    fn review(self) -> &'static str {
        match self {
            Self::LocationLandscape => {
                "Publish only a landscape with no visible or implied people, human figures, humanoids, characters, animals, creatures, silhouettes, faces, body parts, statues, portraits, readable text, letters, numbers, logos, or watermarks."
            }
        }
    }
}

#[derive(Debug)]
pub(super) enum CommunityArtGenerationError {
    Provider(String),
    PolicyUnavailable,
    PolicyReview(String),
    PolicyRejected(Vec<String>),
    Storage(String),
}

impl CommunityArtGenerationError {
    pub(super) fn status(&self) -> &'static str {
        match self {
            Self::PolicyRejected(_) => "rejected",
            _ => "failed",
        }
    }

    pub(super) fn code(&self) -> &'static str {
        match self {
            Self::Provider(_) => "community_art_generation_failed",
            Self::PolicyUnavailable => "community_art_policy_unconfigured",
            Self::PolicyReview(_) => "community_art_policy_review_failed",
            Self::PolicyRejected(_) => "community_art_policy_rejected",
            Self::Storage(_) => "community_art_storage_failed",
        }
    }

    pub(super) fn message(&self) -> String {
        match self {
            Self::Provider(error) => format!("provider generation failed: {error}"),
            Self::PolicyUnavailable => {
                "location art policy review is not configured; output withheld".to_string()
            }
            Self::PolicyReview(error) => format!("image policy review failed: {error}"),
            Self::PolicyRejected(violations) => format!(
                "image policy rejected all candidates: {}",
                if violations.is_empty() {
                    "unspecified violation".to_string()
                } else {
                    violations.join(", ")
                }
            ),
            Self::Storage(error) => format!("validated image storage failed: {error}"),
        }
    }
}

pub(super) async fn generate_and_store_community_art(
    config: &ReplicateAvatarArtConfig,
    policy_config: Option<&AiConfig>,
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
) -> Result<(), CommunityArtGenerationError> {
    let attempts = if plan.image_policy.is_some() {
        POLICY_GENERATION_ATTEMPTS
    } else {
        1
    };
    let mut last_violations = Vec::new();
    for attempt in 1..=attempts {
        let retry_constraint = if attempt > 1 {
            "The previous candidate failed publication review. Keep the scene strictly empty of every forbidden subject."
        } else {
            ""
        };
        let prompt = crate::compact_whitespace(&format!(
            "{}, {} {}",
            config.prompt_prefix, plan.prompt, retry_constraint
        ));
        let image = request_replicate_art(config, prompt, plan.aspect_ratio)
            .await
            .map_err(CommunityArtGenerationError::Provider)?;
        if let Some(policy) = plan.image_policy {
            let policy_config =
                policy_config.ok_or(CommunityArtGenerationError::PolicyUnavailable)?;
            let decision = request_image_policy_decision(
                policy_config,
                ImagePolicyRequest {
                    feature: "media.location_image_policy",
                    image_url: &image.source_url,
                    policy: policy.review(),
                    timeout: Duration::from_secs(30),
                    max_attempts: 2,
                    referer: "https://cosyworld.fly.dev",
                },
            )
            .await
            .map_err(|error| CommunityArtGenerationError::PolicyReview(error.to_string()))?;
            if !decision.allowed {
                last_violations = decision.violations;
                continue;
            }
        }
        store_community_art_image(generated_asset_dir, plan, image)
            .map_err(CommunityArtGenerationError::Storage)?;
        return Ok(());
    }
    Err(CommunityArtGenerationError::PolicyRejected(last_violations))
}

fn store_community_art_image(
    generated_asset_dir: &Path,
    plan: &CommunityArtPlan,
    image: DownloadedReplicateImage,
) -> Result<(), String> {
    let path =
        stored_community_art_image_path(generated_asset_dir, &plan.subject_kind, plan.subject_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content_type_path = stored_community_art_content_type_path(
        generated_asset_dir,
        &plan.subject_kind,
        plan.subject_id,
    );
    let temporary_suffix = format!("{}-{}", std::process::id(), now_millis());
    let temporary_image_path =
        path.with_file_name(format!(".{}.image.tmp-{temporary_suffix}", plan.subject_id));
    let temporary_content_type_path = content_type_path.with_file_name(format!(
        ".{}.content-type.tmp-{temporary_suffix}",
        plan.subject_id
    ));
    let stored = (|| -> io::Result<()> {
        fs::write(&temporary_image_path, image.bytes)?;
        fs::write(&temporary_content_type_path, image.content_type)?;
        fs::rename(&temporary_content_type_path, &content_type_path)?;
        fs::rename(&temporary_image_path, &path)?;
        Ok(())
    })();
    if let Err(error) = stored {
        let _ = fs::remove_file(&temporary_image_path);
        let _ = fs::remove_file(&temporary_content_type_path);
        return Err(error.to_string());
    }
    Ok(())
}

fn community_art_dir(root: &Path, subject_kind: &str) -> PathBuf {
    root.join("community-art").join(subject_kind)
}

pub(super) fn stored_community_art_image_path(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> PathBuf {
    community_art_dir(root, subject_kind).join(format!("{subject_id}.image"))
}

pub(super) fn stored_community_art_content_type_path(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> PathBuf {
    community_art_dir(root, subject_kind).join(format!("{subject_id}.content-type"))
}

pub(super) fn stored_community_art_content_type(
    root: &Path,
    subject_kind: &str,
    subject_id: u64,
) -> String {
    fs::read_to_string(stored_community_art_content_type_path(
        root,
        subject_kind,
        subject_id,
    ))
    .ok()
    .map(|value| value.trim().to_ascii_lowercase())
    .filter(|value| is_safe_image_content_type(value))
    .unwrap_or_else(|| "image/png".to_string())
}

pub(super) fn community_art_image_url(
    subject_kind: &str,
    subject_id: u64,
    level: u8,
    revision: u32,
) -> String {
    format!(
        "/assets/generated/community/{subject_kind}/{subject_id}.image?level={level}&revision={revision}"
    )
}

pub(super) async fn generated_community_art_asset(
    State(state): State<AppState>,
    AxumPath((subject_kind, asset_file)): AxumPath<(String, String)>,
) -> Response {
    if !matches!(subject_kind.as_str(), "actor" | "item" | "location") {
        return (StatusCode::NOT_FOUND, "unknown community artwork").into_response();
    }
    let Some(subject_id) = asset_file
        .strip_suffix(".image")
        .and_then(|value| value.parse::<u64>().ok())
    else {
        return (StatusCode::NOT_FOUND, "unknown community artwork").into_response();
    };
    let ready = {
        let runtime = state.inner.lock().await;
        runtime
            .community_art_subject_level(&subject_kind, subject_id)
            .and_then(|level| {
                runtime
                    .community_art_generations
                    .get(&crate::community_art_generation_key(
                        &subject_kind,
                        subject_id,
                        level,
                    ))
            })
            .is_some_and(|generation| generation.status == "ready")
    };
    if !ready {
        return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
    }
    let path =
        stored_community_art_image_path(&state.generated_asset_dir, &subject_kind, subject_id);
    let Ok(bytes) = fs::read(path) else {
        return (StatusCode::NOT_FOUND, "community artwork is not ready").into_response();
    };
    let content_type =
        stored_community_art_content_type(&state.generated_asset_dir, &subject_kind, subject_id);
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (
                header::CACHE_CONTROL,
                "public, no-cache, must-revalidate".to_string(),
            ),
        ],
        bytes,
    )
        .into_response()
}
