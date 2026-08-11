use super::*;

#[tokio::test]
async fn observational_views_do_not_wait_for_the_runtime_lock() {
    let state = test_app_state(RuntimeWorld::seeded(), None);
    let cached_tick = state.projection_cache.read().await.runtime.world.tick;
    let mut runtime = state.inner.lock().await;
    let refreshed_tick = runtime.world.tick.saturating_add(7);
    runtime.world.tick = refreshed_tick;

    let refresh_state = state.clone();
    let refresh = tokio::spawn(async move {
        refresh_projection_cache(&refresh_state).await;
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while state
            .projection_cache
            .refresh_wait_started_at_ms
            .load(AtomicOrdering::Acquire)
            == 0
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("projection refresh starts waiting for the runtime lock");
    tokio::time::sleep(Duration::from_millis(20)).await;

    let metadata = tokio::time::timeout(Duration::from_secs(1), meta(State(state.clone())))
        .await
        .expect("/meta remains available while the runtime lock is held")
        .0;
    assert_eq!(metadata.world.tick, cached_tick);
    assert!(metadata
        .projection
        .current_runtime_lock_wait_ms
        .is_some_and(|wait_ms| wait_ms >= 10));

    let query = StateQuery {
        actor_id: None,
        actor_session: None,
        wallet_session: None,
        openrouter_connected: None,
    };
    let _world = tokio::time::timeout(
        Duration::from_secs(1),
        world_view(State(state.clone()), Query(query)),
    )
    .await
    .expect("/world remains available while the runtime lock is held");

    drop(runtime);
    refresh.await.expect("projection refresh completes");
    let metadata = meta(State(state)).await.0;
    assert_eq!(metadata.world.tick, refreshed_tick);
    assert!(metadata.projection.current_runtime_lock_wait_ms.is_none());
    assert!(metadata.projection.last_runtime_lock_wait_ms >= 10);
}
