use super::*;

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
    let projection_cache = Arc::new(ProjectionCache::new(&runtime));
    AppState {
        inner: Arc::new(Mutex::new(runtime)),
        projection_cache,
        tx,
        deployment: DeploymentConfig::local(),
        snapshot_path: None,
        last_snapshot_at_ms: Arc::new(AtomicU64::new(0)),
        resident_continuity_path: None,
        snapshot_writer: None,
        event_store_path: event_store_path.clone().map(Arc::new),
        event_store_writer: event_store_keepalive,
        event_store_health: Arc::new(StdMutex::new(EventStoreHealth::default())),
        account_auth: AccountAuth::for_test(event_store_path.clone().map(Arc::new)),
        ownership_index: Arc::new(RwLock::new(OwnershipIndex::default())),
        trust_client_card_ids: false,
        dev_reset_enabled: false,
        card_policy: None,
        ai_config: Arc::new(None),
        transient_openrouter_keys: Arc::new(StdMutex::new(BTreeMap::new())),
        generation_controls: Arc::new(GenerationControls::default()),
        avatar_art_config: Arc::new(None),
        generated_asset_dir: Arc::new(std::env::temp_dir().join("cosyworld-test-generated")),
        ownership_feed: Arc::new(OwnershipFeedConfig::default()),
        rendezvous_party_config: Arc::new(RendezvousPartyConfig::default()),
        wallet_sessions: Arc::new(StdMutex::new(WalletSessions::default())),
        qr_wallet_logins: Arc::new(StdMutex::new(QrWalletLogins::default())),
        wallet_actor_links: Arc::new(StdMutex::new(BTreeMap::new())),
        avatar_creation_lock: Arc::new(Mutex::new(())),
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
        room_memory_retries: Arc::new(StdMutex::new(BTreeMap::new())),
        room_chat_heartbeats: Arc::new(StdMutex::new(BTreeSet::new())),
        actor_job_notify: Arc::new(Notify::new()),
        actor_job_generation: Arc::new(AtomicU64::new(0)),
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
