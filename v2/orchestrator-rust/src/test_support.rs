use super::*;

pub(super) fn test_app_state(event_store_path: Option<PathBuf>) -> AppState {
    if let Some(path) = event_store_path.as_deref() {
        init_event_store(path).expect("initialize test event store");
    }
    let event_store_keepalive = event_store_path
        .as_deref()
        .map(open_event_store_keepalive)
        .transpose()
        .expect("open test WAL keepalive")
        .map(|connection| Arc::new(StdMutex::new(connection)));
    AppState {
        deployment: DeploymentConfig::local(),
        event_store_path: event_store_path.clone().map(Arc::new),
        event_store_writer: event_store_keepalive,
        event_store_health: Arc::new(StdMutex::new(EventStoreHealth::default())),
        account_auth: AccountAuth::for_test(event_store_path.clone().map(Arc::new)),
        ai_config: Arc::new(None),
        generated_asset_dir: Arc::new(std::env::temp_dir().join("cosyworld-test-generated")),
        rate_limiter: Arc::new(StdMutex::new(RateLimiter::default())),
        moderation_token: None,
    }
}
