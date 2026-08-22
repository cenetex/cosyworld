use super::*;

const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:3102";

pub(super) async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let boot_started = Instant::now();
    initialize_tracing();

    configured_content_registry().map_err(io::Error::other)?;
    let state = AppState::bootstrap().await?;
    let shutdown_state = state.clone();
    let _background_services = BackgroundServices::start(&state);

    serve(state, boot_started).await?;
    persist_final_snapshot(&shutdown_state).await;

    Ok(())
}

fn initialize_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "cosyworld_orchestrator=info,tower_http=info".into()),
        )
        .init();
}

struct BackgroundServices {
    _projection_refresh: tokio::task::JoinHandle<()>,
    _canonical_capacity: Option<tokio::task::JoinHandle<()>>,
    _ai_readiness: Option<tokio::task::JoinHandle<()>>,
}

impl BackgroundServices {
    fn start(state: &AppState) -> Self {
        let projection_refresh = start_projection_refresh_scheduler(state.clone());
        let canonical_capacity = start_canonical_capacity_scheduler(state.clone());
        start_focused_encounter_scheduler(state.clone());
        start_actor_job_worker(state.clone());
        resume_pending_community_art_generations(state);
        start_event_store_retry_scheduler(state.clone());
        start_ownership_refresh_scheduler(state.clone());
        start_moderation_retention_scheduler(state.clone());
        start_story_metrics_retention_scheduler(state.clone());
        start_command_receipt_retention_scheduler(state.clone());
        let ai_readiness = start_ai_readiness_scheduler(state.ai_config.as_ref().clone());

        Self {
            _projection_refresh: projection_refresh,
            _canonical_capacity: canonical_capacity,
            _ai_readiness: ai_readiness,
        }
    }
}

async fn serve(state: AppState, boot_started: Instant) -> Result<(), Box<dyn std::error::Error>> {
    let app = routes::app_router(state);
    let addr = configured_listen_addr()?;
    let listener = TcpListener::bind(addr).await?;
    info!(
        "CosyWorld v2 orchestrator listening on http://{addr} after {}ms",
        boot_started.elapsed().as_millis()
    );

    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    );
    if env_flag("COSYWORLD_DISABLE_CTRL_C_SHUTDOWN") {
        // A detached session may survive a stray SIGINT, but SIGTERM must still
        // flush the final snapshot during deploys and composition smoke tests.
        server.with_graceful_shutdown(terminate_signal()).await?;
    } else {
        server.with_graceful_shutdown(shutdown_signal()).await?;
    }

    Ok(())
}

fn configured_listen_addr() -> Result<SocketAddr, std::net::AddrParseError> {
    std::env::var("COSYWORLD_V2_ADDR")
        .unwrap_or_else(|_| DEFAULT_LISTEN_ADDR.to_string())
        .parse()
}

async fn persist_final_snapshot(state: &AppState) {
    // Snapshot writes are coalesced during play, so force the latest runtime to
    // disk on a graceful shutdown and keep the next journal replay inexpensive.
    let runtime = state.inner.lock().await;
    persist_runtime_now(state, &runtime);
}
