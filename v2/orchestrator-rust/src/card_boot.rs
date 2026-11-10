//! The hosted server's card-only boot (#1652).
//!
//! The retired classic game is not loaded at startup: no content registry, no
//! journal replay, no snapshot and no classic schedulers. The classic journal
//! and event rows stay on disk, unread. The card table, accounts, shared
//! worlds, dialogue, generated assets and moderation need only the handful of
//! `AppState` fields set in `bootstrap_card`; every other field is inert.
use super::*;

impl AppState {
    /// Build the state the card table needs. Opens the event database (the
    /// accounts and the shared-world journal live in it) and nothing else of
    /// the classic world.
    pub(super) async fn bootstrap_card() -> io::Result<Self> {
        let deployment = DeploymentConfig::from_env()?;
        let event_store_path = event_store_path_from_env().map(Arc::new);
        let mut event_store_health = EventStoreHealth::default();
        if let Some(path) = event_store_path.as_deref() {
            init_event_store(path)?;
            if one_time_auto_vacuum_requested() {
                match convert_existing_store_to_incremental_auto_vacuum(path) {
                    Ok(converted) => warn!(
                        path = %path.display(),
                        converted,
                        "one-time event store auto_vacuum run complete; unset COSYWORLD_ONE_TIME_AUTO_VACUUM on the next deploy"
                    ),
                    Err(error) => {
                        return Err(deployment_config_error(format!(
                            "one-time event store auto_vacuum conversion failed for {}: {error}; fix the volume before deploying",
                            path.display()
                        )));
                    }
                }
            }
            event_store_health.record_append_success();
            info!("CosyWorld event store ready at {}", path.display());
        }
        let moderation_token = std::env::var("COSYWORLD_MODERATION_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(Arc::new);
        deployment.validate_runtime_options(
            false,
            false,
            false,
            Duration::ZERO,
            event_store_path.is_some(),
            moderation_token.is_some(),
        )?;
        let ai_config = Arc::new(AiConfig::from_env().map_err(deployment_config_error)?);
        let generated_asset_dir = generated_asset_dir_from_env();
        fs::create_dir_all(&generated_asset_dir)?;
        let account_auth = Arc::new(AccountAuth::from_env(
            event_store_path.clone(),
            deployment.profile.is_production(),
        )?);
        let event_store_writer = event_store_path
            .as_deref()
            .map(|path| open_event_store_keepalive(path))
            .transpose()?
            .map(|connection| Arc::new(StdMutex::new(connection)));
        Ok(Self {
            deployment,
            event_store_path,
            event_store_writer,
            event_store_health: Arc::new(StdMutex::new(event_store_health)),
            account_auth,
            ai_config,
            generated_asset_dir: Arc::new(generated_asset_dir),
            rate_limiter: Arc::new(StdMutex::new(RateLimiter::default())),
            moderation_token,
        })
    }
}

/// `/meta` for the card-only server: the build, the card game's source map,
/// the deployment and the storage the card table writes to.
#[derive(Debug, Serialize)]
pub(super) struct CardMeta {
    ok: bool,
    service: &'static str,
    version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
    #[serde(flatten)]
    game: routes::card_game::metadata::GameMetadata,
    build_profile: &'static str,
    deployment: CardMetaDeployment,
    features: CardMetaFeatures,
    ai: MetaAi,
    persistence: CardMetaPersistence,
    /// Text-free counters for card voice calls since this process started.
    card_voice: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct CardMetaDeployment {
    profile: &'static str,
    production: bool,
    world_id: String,
    process_id: String,
}

#[derive(Debug, Serialize)]
struct CardMetaFeatures {
    ai_enabled: bool,
    moderation_audit_enabled: bool,
}

#[derive(Debug, Serialize)]
struct CardMetaPersistence {
    event_store_enabled: bool,
    event_store: MetaEventStoreHealth,
    event_store_bytes: Option<u64>,
    event_store_live_bytes: Option<u64>,
    event_store_reusable_bytes: Option<u64>,
    event_store_auto_vacuum: Option<&'static str>,
    generated_asset_limit_bytes: u64,
    generated_asset_bytes: Option<u64>,
    generated_asset_count: Option<u64>,
}

pub(super) async fn card_meta(State(state): State<AppState>) -> Json<CardMeta> {
    let health = state
        .event_store_health
        .lock()
        .map(|health| health.clone())
        .unwrap_or_default();
    let storage = storage_report::persistence_storage_report(
        state.event_store_path.as_deref().map(PathBuf::as_path),
        Some(state.generated_asset_dir.as_path()),
    );
    Json(CardMeta {
        ok: true,
        service: "cosyworld-orchestrator",
        version: env!("CARGO_PKG_VERSION"),
        commit: source_commit(std::env::var("COSYWORLD_SOURCE_COMMIT").ok()),
        game: routes::card_game::metadata::GameMetadata::for_primary(true),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        deployment: CardMetaDeployment {
            profile: state.deployment.profile.as_str(),
            production: state.deployment.profile.is_production(),
            world_id: state.deployment.world_id.clone(),
            process_id: state.deployment.process_id.clone(),
        },
        features: CardMetaFeatures {
            ai_enabled: state.ai_config.as_ref().is_some(),
            moderation_audit_enabled: state.moderation_token.is_some(),
        },
        ai: MetaAi::from_config(state.ai_config.as_ref().as_ref()),
        persistence: CardMetaPersistence {
            event_store_enabled: state.event_store_path.is_some(),
            event_store: MetaEventStoreHealth {
                status: health.status(state.event_store_path.is_some()),
                last_append_success_at_unix: health.last_append_success_at_unix,
                last_read_success_at_unix: health.last_read_success_at_unix,
                last_failure_at_unix: health.last_failure_at_unix,
                consecutive_append_failures: health.consecutive_append_failures,
                consecutive_read_failures: health.consecutive_read_failures,
                pending_event_count: 0,
                last_error_code: health.last_error_code,
            },
            event_store_bytes: storage.event_store_bytes,
            event_store_live_bytes: storage.event_store_live_bytes,
            event_store_reusable_bytes: storage.event_store_reusable_bytes,
            event_store_auto_vacuum: storage.event_store_auto_vacuum,
            generated_asset_limit_bytes: generated_asset_budget::GENERATED_ASSET_LIMIT_BYTES,
            generated_asset_bytes: storage.generated_asset_bytes,
            generated_asset_count: storage.generated_asset_count,
        },
        card_voice: routes::card_game::narrative::voice_metrics::snapshot(),
    })
}

/// The first 12 characters of a hex commit id, or none.
pub(crate) fn source_commit(value: Option<String>) -> Option<String> {
    let value = value?;
    let value = value.trim();
    (value.len() >= 7 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value[..value.len().min(12)].to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_app_state;
    use axum::Router;
    use tower::ServiceExt;

    async fn get_status(app: &Router, path: &str) -> (StatusCode, Vec<u8>) {
        let response = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, bytes.to_vec())
    }

    #[tokio::test]
    async fn the_card_only_server_serves_the_card_table_and_no_classic_routes() {
        let state = test_app_state(None);
        let app = routes::card_app_router(state, ShutdownSubscription::idle());
        for path in [
            "/",
            "/card-game/forest.json",
            "/auth/account",
            "/health",
            "/health/live",
        ] {
            assert_eq!(get_status(&app, path).await.0, StatusCode::OK, "{path}");
        }
        for path in [
            "/state",
            "/world",
            "/events",
            "/stream",
            "/inspect",
            "/licenses",
            "/content-packs",
            "/moderation",
            "/assets/cosy-cottage.png",
            "/wallet/challenge",
        ] {
            assert_eq!(
                get_status(&app, path).await.0,
                StatusCode::NOT_FOUND,
                "{path}"
            );
        }
        let (status, bytes) = get_status(&app, "/meta").await;
        assert_eq!(status, StatusCode::OK);
        let meta: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(meta["ok"], true);
        assert_eq!(meta["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(meta["primary_game"], "card-table");
        assert_eq!(
            meta["card_game"]["shared_rules_version"],
            crate::card_shared::RULES_VERSION
        );
        assert_eq!(meta["persistence"]["event_store_enabled"], false);
        for classic in [
            "worldpack",
            "world",
            "combat",
            "content_engine_version",
            "metadata_scopes",
            "linked_avatar_adapter",
            "migration_archive",
        ] {
            assert!(meta.get(classic).is_none(), "{classic}");
        }
    }
}
