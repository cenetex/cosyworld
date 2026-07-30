use super::*;

pub(super) fn initialize_test_event_store(path: &Path) {
    init_event_store(path).expect("initialize complete test event-store schema");
    let conn = open_event_store(path).expect("verify test event-store schema");
    for table in [
        "world_events",
        "action_journal",
        "actor_jobs",
        "canonical_store_identity",
        "canonical_commits",
        "canonical_compacted_commit_ranges",
    ] {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1
                 )",
                [table],
                |row| row.get(0),
            )
            .expect("query test event-store schema");
        assert!(exists, "test event-store schema is missing {table}");
    }
}

pub(super) fn spawn_test_app_server(
    listener: TcpListener,
    state: AppState,
    context: &'static str,
) -> tokio::task::JoinHandle<()> {
    let app = routes::app_router(state);
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect(context);
    })
}

pub(super) fn test_app_state(runtime: RuntimeWorld, event_store_path: Option<PathBuf>) -> AppState {
    let (tx, _) = broadcast::channel(32);
    let canonical_fanout_seq = runtime.world.next_event_seq.saturating_sub(1);
    let canonical_region_id = DEFAULT_CANONICAL_REGION_ID.to_string();
    let canonical_store_id = if let Some(path) = event_store_path.as_deref() {
        init_event_store(path).expect("initialize canonical test store");
        let store_id = ensure_canonical_store_identity(
            path,
            OFFICIAL_WORLD_ID,
            OFFICIAL_WORLD_EPOCH,
            &format!("test-store:{}", random_hex(8)),
            now_millis(),
        )
        .expect("canonical test store identity");
        ensure_region_authority(
            path,
            OFFICIAL_WORLD_ID,
            OFFICIAL_WORLD_EPOCH,
            &canonical_region_id,
            now_millis(),
        )
        .expect("canonical test region authority");
        store_id
    } else {
        format!("test-memory:{}", random_hex(8))
    };
    let event_store_keepalive = event_store_path
        .as_deref()
        .map(open_event_store_keepalive)
        .transpose()
        .expect("open test WAL keepalive")
        .map(|connection| Arc::new(StdMutex::new(connection)));
    AppState {
        inner: Arc::new(Mutex::new(runtime)),
        tx,
        deployment: DeploymentConfig::local(),
        snapshot_path: None,
        last_snapshot_at_ms: Arc::new(AtomicU64::new(0)),
        resident_continuity_path: None,
        event_store_path: event_store_path.clone().map(Arc::new),
        _event_store_keepalive: event_store_keepalive,
        event_store_health: Arc::new(StdMutex::new(EventStoreHealth::default())),
        account_auth: AccountAuth::for_test(event_store_path.clone().map(Arc::new)),
        ownership_index: Arc::new(RwLock::new(OwnershipIndex::default())),
        trust_client_card_ids: false,
        dev_reset_enabled: false,
        ai_config: Arc::new(None),
        generation_controls: Arc::new(GenerationControls::default()),
        avatar_art_config: Arc::new(None),
        generated_asset_dir: Arc::new(std::env::temp_dir().join("cosyworld-test-generated")),
        ambient: AmbientConfig {
            quiet_after: Duration::from_secs(1),
        },
        box_burn_verifier: Arc::new(None),
        ownership_feed: Arc::new(OwnershipFeedConfig::default()),
        ownership_feed_health: Arc::new(StdMutex::new(OwnershipFeedHealth::default())),
        hosted_access_config: Arc::new(HostedAccessConfig::default()),
        last_world_event_at: Arc::new(StdMutex::new(Instant::now())),
        wallet_sessions: Arc::new(StdMutex::new(WalletSessions::default())),
        qr_wallet_logins: Arc::new(StdMutex::new(QrWalletLogins::default())),
        wallet_actor_links: Arc::new(StdMutex::new(BTreeMap::new())),
        actor_sessions: Arc::new(StdMutex::new(ActorSessions::default())),
        actor_suspensions: Arc::new(StdMutex::new(BTreeMap::new())),
        rate_limiter: Arc::new(StdMutex::new(RateLimiter::default())),
        inactive_inventory_release_conflicts: Arc::new(StdMutex::new(BTreeSet::new())),
        canonical_command_lock: Arc::new(Mutex::new(())),
        canonical_owner_id: Arc::new(format!("test:{}", random_hex(8))),
        canonical_store_id: Arc::new(canonical_store_id),
        canonical_region_id: Arc::new(canonical_region_id),
        canonical_lease_ttl: DEFAULT_CANONICAL_LEASE_TTL,
        canonical_applied_journal_seq: Arc::new(AtomicU64::new(0)),
        canonical_fanout_seq: Arc::new(AtomicU64::new(canonical_fanout_seq)),
        canonical_fanout_lock: Arc::new(StdMutex::new(())),
        canonical_routing: Arc::new(CanonicalRoutingConfig::default()),
        canonical_recovery: Arc::new(None),
        regional_presence: Arc::new(StdMutex::new(BTreeMap::new())),
        room_memory_cache: Arc::new(StdMutex::new(BTreeMap::new())),
        room_memory_jobs: Arc::new(StdMutex::new(BTreeSet::new())),
        room_chat_heartbeats: Arc::new(StdMutex::new(BTreeSet::new())),
        actor_job_notify: Arc::new(Notify::new()),
        avatar_chat_delay: Duration::ZERO,
        moderation_token: None,
        moderation_report_retention: ModerationReportRetention {
            days: Some(DEFAULT_MODERATION_REPORT_RETENTION_DAYS),
        },
        story_metrics_retention: StoryMetricsRetention::default(),
        command_receipt_retention: CommandReceiptRetention::default(),
        checkpoint_rejections: 0,
        last_checkpoint_rejection: None,
        allow_unsigned_wallet_claims: false,
    }
}

pub(super) fn create_test_human(
    runtime: &mut RuntimeWorld,
    actor_id: u64,
    location_id: u64,
    name: &str,
) {
    let create = CwAction {
        kind: CW_ACTION_CREATE_ACTOR,
        actor_id,
        location_id,
        ..CwAction::default()
    };
    let mut record = JournalRecord::new(create, 70_000 + actor_id);
    record.actor_meta_upserts.insert(
        actor_id,
        ActorMeta {
            name: name.to_string(),
            speech_mode: "prose".to_string(),
            title: "Relay Test Avatar".to_string(),
            description: "A test avatar controlled through the narrative move relay.".to_string(),
        },
    );
    assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
}
