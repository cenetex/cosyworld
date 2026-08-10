use super::*;

const PROJECTION_REFRESH_INTERVAL: Duration = Duration::from_secs(2);
const PROJECTION_LOCK_WAIT_WARN_AFTER: Duration = Duration::from_millis(250);

pub(super) struct ProjectionCache {
    runtime: RwLock<Arc<RuntimeWorld>>,
    refreshed_at_ms: AtomicU64,
    pub(super) refresh_wait_started_at_ms: AtomicU64,
    last_runtime_lock_wait_ms: AtomicU64,
    last_refresh_duration_ms: AtomicU64,
}

pub(super) struct ProjectionRead {
    pub(super) runtime: Arc<RuntimeWorld>,
    cache_age_ms: u64,
    cache_lock_wait_ms: u64,
    current_runtime_lock_wait_ms: Option<u64>,
    last_runtime_lock_wait_ms: u64,
    last_refresh_duration_ms: u64,
}

#[derive(Debug, serde::Serialize)]
pub(super) struct MetaResponse {
    pub(super) ok: bool,
    pub(super) service: &'static str,
    pub(super) version: &'static str,
    pub(super) build_profile: &'static str,
    pub(super) deployment: MetaDeployment,
    pub(super) projection: MetaProjection,
    pub(super) features: MetaFeatureFlags,
    pub(super) ai: MetaAi,
    pub(super) persistence: MetaPersistence,
    pub(super) ownership_feed: MetaOwnershipFeed,
    pub(super) nft: MetaNftConfig,
    pub(super) combat: MetaCombat,
    pub(super) worldpack: MetaWorldpack,
    pub(super) world: MetaWorldCounters,
}

#[derive(Debug, serde::Serialize)]
pub(super) struct MetaProjection {
    refresh_interval_ms: u64,
    source_world_seq: u64,
    cache_age_ms: u64,
    cache_lock_wait_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) current_runtime_lock_wait_ms: Option<u64>,
    pub(super) last_runtime_lock_wait_ms: u64,
    last_refresh_duration_ms: u64,
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

    pub(super) async fn read(&self) -> ProjectionRead {
        let lock_started = Instant::now();
        let runtime = self.runtime.read().await.clone();
        let cache_lock_wait_ms = duration_millis(lock_started.elapsed());
        let now = now_millis();
        let refresh_wait_started_at_ms = self
            .refresh_wait_started_at_ms
            .load(AtomicOrdering::Acquire);
        ProjectionRead {
            runtime,
            cache_age_ms: now.saturating_sub(self.refreshed_at_ms.load(AtomicOrdering::Acquire)),
            cache_lock_wait_ms,
            current_runtime_lock_wait_ms: (refresh_wait_started_at_ms > 0)
                .then(|| now.saturating_sub(refresh_wait_started_at_ms)),
            last_runtime_lock_wait_ms: self.last_runtime_lock_wait_ms.load(AtomicOrdering::Acquire),
            last_refresh_duration_ms: self.last_refresh_duration_ms.load(AtomicOrdering::Acquire),
        }
    }
}

impl ProjectionRead {
    pub(super) fn telemetry(&self, source_world_seq: u64) -> MetaProjection {
        MetaProjection {
            refresh_interval_ms: duration_millis(PROJECTION_REFRESH_INTERVAL),
            source_world_seq,
            cache_age_ms: self.cache_age_ms,
            cache_lock_wait_ms: self.cache_lock_wait_ms,
            current_runtime_lock_wait_ms: self.current_runtime_lock_wait_ms,
            last_runtime_lock_wait_ms: self.last_runtime_lock_wait_ms,
            last_refresh_duration_ms: self.last_refresh_duration_ms,
        }
    }
}

pub(super) fn refresh_actor_session_for_read(state: &AppState, actor_session: Option<&str>) {
    if let Some(token) = actor_session {
        if let Err(error) = refresh_actor_session_from_store(state, token) {
            tracing::warn!(
                "failed to refresh actor session for canonical read: {}",
                error
            );
        }
    }
}

pub(super) async fn refresh_projection_cache(state: &AppState) {
    let refresh_started = Instant::now();
    state
        .projection_cache
        .refresh_wait_started_at_ms
        .store(now_millis(), AtomicOrdering::Release);
    let lock_started = Instant::now();
    let runtime = state.inner.lock().await;
    let runtime_lock_wait = lock_started.elapsed();
    let runtime_lock_wait_ms = duration_millis(runtime_lock_wait);
    state
        .projection_cache
        .refresh_wait_started_at_ms
        .store(0, AtomicOrdering::Release);
    state
        .projection_cache
        .last_runtime_lock_wait_ms
        .store(runtime_lock_wait_ms, AtomicOrdering::Release);
    if runtime_lock_wait >= PROJECTION_LOCK_WAIT_WARN_AFTER {
        tracing::warn!(
            runtime_lock_wait_ms,
            endpoints = "/world,/meta",
            "observational projection refresh waited for the authoritative runtime lock"
        );
    }
    let projection = Arc::new(runtime.clone());
    drop(runtime);

    *state.projection_cache.runtime.write().await = projection;
    state
        .projection_cache
        .refreshed_at_ms
        .store(now_millis(), AtomicOrdering::Release);
    state.projection_cache.last_refresh_duration_ms.store(
        duration_millis(refresh_started.elapsed()),
        AtomicOrdering::Release,
    );
}

pub(super) fn start_projection_refresh_scheduler(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(PROJECTION_REFRESH_INTERVAL).await;
            refresh_projection_cache(&state).await;
        }
    })
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}
