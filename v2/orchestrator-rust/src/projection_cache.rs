use super::*;

pub(super) struct ProjectionCache {
    runtime: RwLock<Arc<RuntimeWorld>>,
    refreshed_at_ms: AtomicU64,
    pub(super) refresh_wait_started_at_ms: AtomicU64,
    last_runtime_lock_wait_ms: AtomicU64,
    last_refresh_duration_ms: AtomicU64,
}

#[derive(Debug, serde::Serialize)]
pub(super) struct MetaVersions {
    version: &'static str,
    /// Short source commit set by the deploy (`COSYWORLD_SOURCE_COMMIT`).
    /// Main and `.dev` keep the last release version between releases, so
    /// this tells their builds apart.
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
    content_engine_version: &'static str,
    #[serde(flatten)]
    game: routes::card_game::metadata::GameMetadata,
}

impl MetaVersions {
    pub(super) fn current() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION"),
            commit: source_commit(std::env::var("COSYWORLD_SOURCE_COMMIT").ok()),
            content_engine_version: content_engine_version(),
            game: routes::card_game::metadata::GameMetadata::current(),
        }
    }
}

/// The first 12 characters of a hex commit id, or none.
pub(super) fn source_commit(value: Option<String>) -> Option<String> {
    let value = value?;
    let value = value.trim();
    (value.len() >= 7 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value[..value.len().min(12)].to_ascii_lowercase())
}

impl ProjectionCache {
    pub(super) fn new(runtime: &RuntimeWorld) -> Self {
        Self {
            runtime: RwLock::new(Arc::new(runtime.clone())),
            refreshed_at_ms: AtomicU64::new(now_millis()),
            refresh_wait_started_at_ms: AtomicU64::new(0),
            last_runtime_lock_wait_ms: AtomicU64::new(0),
            last_refresh_duration_ms: AtomicU64::new(0),
        }
    }
}
