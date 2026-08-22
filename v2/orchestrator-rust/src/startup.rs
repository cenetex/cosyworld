use super::*;

const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:3102";

pub(super) async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let boot_started = Instant::now();
    initialize_tracing();

    configured_content_registry().map_err(io::Error::other)?;
    let drain_budget = configured_shutdown_drain_budget()?;
    let state = AppState::bootstrap().await?;
    let shutdown_state = state.clone();
    let _background_services = BackgroundServices::start(&state);

    let report = serve(state, boot_started, drain_budget).await?;
    let snapshot_started = Instant::now();
    persist_final_snapshot(&shutdown_state).await;
    let snapshot_elapsed = snapshot_started.elapsed();
    info!(
        event = "shutdown_complete",
        signal = report.first_signal.as_str(),
        signal_count = report.signal_count,
        drain_elapsed_ms = report.drain_elapsed.as_millis() as u64,
        drain_budget_ms = drain_budget.as_millis() as u64,
        forced_drain_count = report.forced_drain_count,
        forced_drain_reason = report.forced_drain_reason,
        active_streams_at_signal = report.active_streams_at_signal,
        streams_notified = report.streams_notified,
        streams_remaining = report.streams_remaining,
        final_snapshot_elapsed_ms = snapshot_elapsed.as_millis() as u64,
    );

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

#[derive(Clone, Copy, Debug)]
struct ShutdownReport {
    first_signal: ShutdownReason,
    signal_count: u64,
    drain_elapsed: Duration,
    forced_drain_count: u64,
    forced_drain_reason: &'static str,
    active_streams_at_signal: u64,
    streams_notified: u64,
    streams_remaining: u64,
}

async fn serve(
    state: AppState,
    boot_started: Instant,
    drain_budget: Duration,
) -> Result<ShutdownReport, Box<dyn std::error::Error>> {
    let addr = configured_listen_addr()?;
    let listener = TcpListener::bind(addr).await?;
    info!(
        "CosyWorld v2 orchestrator listening on http://{addr} after {}ms",
        boot_started.elapsed().as_millis()
    );

    let (trigger, shutdown) = shutdown_channel();
    let include_sigint = !env_flag("COSYWORLD_DISABLE_CTRL_C_SHUTDOWN");
    let signal_task = tokio::spawn(relay_shutdown_signals(trigger, include_sigint));
    let result = serve_until_shutdown(listener, state, shutdown, drain_budget).await;
    signal_task.abort();
    result.map_err(Into::into)
}

async fn serve_until_shutdown(
    listener: TcpListener,
    state: AppState,
    shutdown: ShutdownSubscription,
    drain_budget: Duration,
) -> io::Result<ShutdownReport> {
    let app = routes::app_router_with_shutdown(state, shutdown.clone());
    let mut first_notice = shutdown.clone();
    let mut graceful_notice = shutdown.clone();

    let server = std::future::IntoFuture::into_future(
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            graceful_notice.wait_after(0).await;
        }),
    );
    tokio::pin!(server);

    let notice = tokio::select! {
        biased;
        notice = first_notice.wait_after(0) => notice,
        result = &mut server => {
            result?;
            return Ok(ShutdownReport {
                first_signal: ShutdownReason::None,
                signal_count: 0,
                drain_elapsed: Duration::ZERO,
                forced_drain_count: 0,
                forced_drain_reason: "none",
                active_streams_at_signal: 0,
                streams_notified: 0,
                streams_remaining: 0,
            });
        }
    };
    let drain_started = Instant::now();
    info!(
        event = "shutdown_drain_started",
        signal = notice.reason.as_str(),
        signal_count = notice.sequence,
        drain_budget_ms = drain_budget.as_millis() as u64,
        active_streams = shutdown.active_streams_at_first_signal(),
    );

    let mut repeated_notice = shutdown.clone();
    let (forced_drain_count, forced_drain_reason) = tokio::select! {
        biased;
        result = &mut server => {
            result?;
            (0, "none")
        }
        repeated = repeated_notice.wait_after(notice.sequence) => {
            warn!(
                event = "shutdown_drain_forced",
                reason = "repeated_signal",
                signal = repeated.reason.as_str(),
                signal_count = repeated.sequence,
            );
            (1, "repeated_signal")
        }
        _ = tokio::time::sleep(drain_budget) => {
            warn!(
                event = "shutdown_drain_forced",
                reason = "deadline",
                signal_count = shutdown.signal_count(),
                drain_budget_ms = drain_budget.as_millis() as u64,
            );
            (1, "deadline")
        }
    };

    Ok(ShutdownReport {
        first_signal: notice.reason,
        signal_count: shutdown.signal_count(),
        drain_elapsed: drain_started.elapsed(),
        forced_drain_count,
        forced_drain_reason,
        active_streams_at_signal: shutdown.active_streams_at_first_signal(),
        streams_notified: shutdown.streams_notified(),
        streams_remaining: shutdown.active_streams(),
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn connected_request(addr: SocketAddr, path: &str) -> tokio::net::TcpStream {
        let mut connection = tokio::net::TcpStream::connect(addr)
            .await
            .expect("connect test server");
        connection
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: keep-alive\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .expect("write test request");
        connection
    }

    async fn read_response_headers(connection: &mut tokio::net::TcpStream) -> String {
        let mut response = Vec::new();
        let mut chunk = [0_u8; 512];
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let read = connection
                    .read(&mut chunk)
                    .await
                    .expect("read response headers");
                assert!(read > 0, "connection closed before response headers");
                response.extend_from_slice(&chunk[..read]);
                if response.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        })
        .await
        .expect("response headers arrive");
        String::from_utf8(response).expect("HTTP response is UTF-8")
    }

    fn snapshot_test_state(reason: ShutdownReason) -> (AppState, PathBuf) {
        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-shutdown-{}-{}-{}.json",
            reason.as_str(),
            std::process::id(),
            random_hex(8)
        ));
        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.snapshot_writer = Some(Arc::new(
            SnapshotWriter::spawn().expect("shutdown snapshot writer"),
        ));
        (state, snapshot_path)
    }

    async fn run_snapshot_shutdown(reason: ShutdownReason) -> ShutdownReport {
        let (state, snapshot_path) = snapshot_test_state(reason);
        let shutdown_state = state.clone();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind shutdown test server");
        let (trigger, shutdown) = shutdown_channel();
        let server = tokio::spawn(async move {
            let report =
                serve_until_shutdown(listener, state, shutdown, Duration::from_millis(250))
                    .await
                    .expect("serve until simulated shutdown");
            persist_final_snapshot(&shutdown_state).await;
            report
        });
        tokio::task::yield_now().await;
        trigger.notify(reason);
        let report = server.await.expect("shutdown server task");
        let persisted = fs::read_to_string(&snapshot_path).expect("final shutdown snapshot");
        assert!(persisted.contains("worldpack_bundle_hash"));
        let _ = fs::remove_file(snapshot_path);
        report
    }

    #[tokio::test]
    async fn sigint_and_sigterm_both_reach_final_snapshot_persistence() {
        for reason in [ShutdownReason::Sigint, ShutdownReason::Sigterm] {
            let report = run_snapshot_shutdown(reason).await;
            assert_eq!(report.first_signal, reason);
            assert_eq!(report.forced_drain_count, 0);
        }
    }

    #[tokio::test]
    async fn active_stream_is_notified_and_finishes_before_the_drain_deadline() {
        let state = test_app_state(RuntimeWorld::seeded(), None);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind stream shutdown server");
        let addr = listener.local_addr().expect("stream server address");
        let (trigger, shutdown) = shutdown_channel();
        let observed = shutdown.clone();
        let server = tokio::spawn(serve_until_shutdown(
            listener,
            state,
            shutdown,
            Duration::from_millis(500),
        ));

        let mut stream = connected_request(addr, "/stream").await;
        let headers = read_response_headers(&mut stream).await;
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        assert_eq!(observed.active_streams(), 1);

        trigger.notify(ShutdownReason::Sigterm);
        let mut tail = Vec::new();
        tokio::time::timeout(Duration::from_millis(400), stream.read_to_end(&mut tail))
            .await
            .expect("SSE connection closes for reconnect")
            .expect("read SSE shutdown tail");
        let report = server
            .await
            .expect("stream shutdown task")
            .expect("stream shutdown server");
        assert_eq!(report.forced_drain_count, 0);
        assert_eq!(report.active_streams_at_signal, 1);
        assert_eq!(report.streams_notified, 1);
        assert_eq!(report.streams_remaining, 0);
    }

    async fn start_blocked_request(
        drain_budget: Duration,
    ) -> (
        ShutdownTrigger,
        tokio::task::JoinHandle<io::Result<ShutdownReport>>,
        tokio::sync::OwnedMutexGuard<RuntimeWorld>,
        tokio::net::TcpStream,
    ) {
        let state = test_app_state(RuntimeWorld::seeded(), None);
        let held = state.inner.clone().lock_owned().await;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind blocked shutdown server");
        let addr = listener.local_addr().expect("blocked server address");
        let (trigger, shutdown) = shutdown_channel();
        let server = tokio::spawn(serve_until_shutdown(
            listener,
            state,
            shutdown,
            drain_budget,
        ));
        let connection = connected_request(addr, "/state").await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        (trigger, server, held, connection)
    }

    #[tokio::test]
    async fn stuck_request_cannot_extend_shutdown_past_the_drain_budget() {
        let budget = Duration::from_millis(100);
        let (trigger, server, held, _connection) = start_blocked_request(budget).await;
        let started = Instant::now();
        trigger.notify(ShutdownReason::Test);
        let report = server
            .await
            .expect("deadline shutdown task")
            .expect("deadline shutdown server");
        drop(held);
        assert_eq!(report.forced_drain_count, 1);
        assert_eq!(report.forced_drain_reason, "deadline");
        assert!(report.drain_elapsed >= budget);
        assert!(started.elapsed() < Duration::from_millis(400));
    }

    #[tokio::test]
    async fn repeated_signal_forces_a_stuck_drain_immediately() {
        let (trigger, server, held, _connection) =
            start_blocked_request(Duration::from_secs(1)).await;
        trigger.notify(ShutdownReason::Sigint);
        tokio::time::sleep(Duration::from_millis(25)).await;
        trigger.notify(ShutdownReason::Sigterm);
        let report = server
            .await
            .expect("repeated shutdown task")
            .expect("repeated shutdown server");
        drop(held);
        assert_eq!(report.signal_count, 2);
        assert_eq!(report.forced_drain_count, 1);
        assert_eq!(report.forced_drain_reason, "repeated_signal");
        assert!(report.drain_elapsed < Duration::from_millis(500));
    }
}
