use super::*;
use rusqlite::params;

#[test]
fn repeated_commands_keep_canonical_identity_versions_bounded() {
    let actor_id = 5000;
    let item_id = 990_001;
    let location_id = 990_002;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Stable Reference Tester",
    );
    runtime.ensure_location(location_id, 0);
    runtime
        .locations
        .insert(location_id, "Stable Reference Room".to_string());
    runtime.ensure_item(item_id, CW_ITEM_KEEPSAKE, location_id, 0);
    runtime.ensure_canonical_identities(79_999);
    let actor_ref = runtime
        .canonical_ref("actor", actor_id)
        .expect("dynamic actor canonical ref")
        .to_string();
    let journal_ref = runtime
        .canonical_ref("journal", actor_id)
        .expect("dynamic actor journal ref")
        .to_string();
    let item_ref = runtime
        .canonical_ref("item", item_id)
        .expect("dynamic item canonical ref")
        .to_string();
    let location_ref = runtime
        .canonical_ref("location", location_id)
        .expect("dynamic location canonical ref")
        .to_string();
    let expected_refs = runtime.canonical_identities.reachable_entity_refs();

    for index in 0..64_u64 {
        let content_id = 90_000 + index;
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id,
                content_id,
                ..CwAction::default()
            },
            80_000 + index,
        );
        record
            .content_upserts
            .insert(content_id, format!("stable canonical command {index}"));
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert_eq!(
            runtime.canonical_ref("actor", actor_id),
            Some(actor_ref.as_str())
        );
        assert_eq!(
            runtime.canonical_ref("journal", actor_id),
            Some(journal_ref.as_str())
        );
        assert_eq!(
            runtime.canonical_ref("item", item_id),
            Some(item_ref.as_str())
        );
        assert_eq!(
            runtime.canonical_ref("location", location_id),
            Some(location_ref.as_str())
        );
        assert_eq!(
            runtime
                .canonical_identities
                .entity_versions
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            expected_refs
        );
    }
}

#[test]
fn snapshots_prune_unreachable_canonical_entity_versions() {
    let mut runtime = RuntimeWorld::seeded();
    let runtime_stale_ref = opaque_runtime_ref("actor", "legacy-runtime-stale");
    runtime
        .canonical_identities
        .entity_versions
        .insert(runtime_stale_ref.clone(), 1);

    let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
    assert!(!snapshot
        .canonical_identities
        .entity_versions
        .contains_key(&runtime_stale_ref));

    let snapshot_stale_ref = opaque_runtime_ref("journal", "legacy-snapshot-stale");
    snapshot
        .canonical_identities
        .entity_versions
        .insert(snapshot_stale_ref.clone(), 1);
    let restored = snapshot.into_runtime().expect("restore legacy snapshot");
    assert!(!restored
        .canonical_identities
        .entity_versions
        .contains_key(&snapshot_stale_ref));
    assert_eq!(
        restored
            .canonical_identities
            .entity_versions
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        restored.canonical_identities.reachable_entity_refs()
    );
}

#[test]
fn durable_entity_versions_rehydrate_replayed_runtime_before_next_write() {
    std::thread::Builder::new()
        .name("durable-version-rehydrate".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(run_durable_entity_version_rehydration)
        .expect("spawn durable version rehydration thread")
        .join()
        .expect("durable version rehydration thread");
}

fn run_durable_entity_version_rehydration() {
    let path = std::env::temp_dir().join(format!(
        "cosyworld-canonical-version-rehydrate-{}-{}.sqlite",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_file(&path);
    let actor_id = 5000;
    let state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
    {
        let mut runtime = state.inner.blocking_lock();
        let mut create = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            71_200,
        );
        create.actor_meta_upserts.insert(
            actor_id,
            ActorMeta {
                name: "Version Traveller".to_string(),
                speech_mode: "prose".to_string(),
                title: "Recovery Tester".to_string(),
                description: "A test avatar crossing a worldpack version boundary.".to_string(),
            },
        );
        assert_eq!(
            commit_journal_record(&state, &mut runtime, create)
                .expect("commit versioned actor")
                .0,
            CW_OK
        );
    }
    let actor_ref = state
        .inner
        .blocking_lock()
        .canonical_ref("actor", actor_id)
        .expect("actor canonical ref")
        .to_string();
    let stale_ref = opaque_runtime_ref("actor", "legacy-durable-stale");
    let durable_version = {
        let conn = open_event_store(&path).expect("open canonical versions");
        let current = conn
            .query_row(
                "SELECT entity_version FROM canonical_entity_versions
                 WHERE world_id = ?1 AND entity_ref = ?2",
                params![OFFICIAL_WORLD_ID, &actor_ref],
                |row| row.get::<_, i64>(0),
            )
            .expect("durable actor version") as u64;
        let advanced = current.saturating_add(10);
        conn.execute(
            "UPDATE canonical_entity_versions SET entity_version = ?3
             WHERE world_id = ?1 AND entity_ref = ?2",
            params![OFFICIAL_WORLD_ID, &actor_ref, advanced as i64],
        )
        .expect("simulate a durable version ahead of replay");
        conn.execute(
            "INSERT INTO canonical_entity_versions
                (world_id, entity_ref, entity_version, updated_at_ms)
             VALUES (?1, ?2, 1, ?3)",
            params![OFFICIAL_WORLD_ID, &stale_ref, now_millis() as i64],
        )
        .expect("seed unreachable legacy entity version");
        advanced
    };

    {
        let mut runtime = state.inner.blocking_lock();
        restore_runtime_from_durable_state(&state, &mut runtime, &path)
            .expect("rehydrate replayed runtime");
        assert_eq!(runtime.entity_version(&actor_ref), durable_version);
        assert!(!runtime
            .canonical_identities
            .entity_versions
            .contains_key(&stale_ref));

        let content_id = runtime.next_content_id;
        runtime.next_content_id = runtime.next_content_id.saturating_add(1);
        let mut say = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id,
                content_id,
                ..CwAction::default()
            },
            71_201,
        );
        say.content_upserts.insert(
            content_id,
            "the durable version is authoritative".to_string(),
        );
        assert_eq!(
            commit_journal_record(&state, &mut runtime, say)
                .expect("commit after canonical rehydration")
                .0,
            CW_OK
        );
        assert_eq!(
            runtime.entity_version(&actor_ref),
            durable_version.saturating_add(1)
        );
    }
    let stored_after = open_event_store(&path)
        .expect("reopen canonical versions")
        .query_row(
            "SELECT entity_version FROM canonical_entity_versions
             WHERE world_id = ?1 AND entity_ref = ?2",
            params![OFFICIAL_WORLD_ID, &actor_ref],
            |row| row.get::<_, i64>(0),
        )
        .expect("advanced durable actor version") as u64;
    assert_eq!(stored_after, durable_version.saturating_add(1));
    assert_eq!(
        state
            .event_store_health
            .lock()
            .expect("event store health")
            .consecutive_append_failures,
        0
    );
    let _ = fs::remove_file(path);
}

fn canonical_version_test_offer_request(
    runtime: &mut RuntimeWorld,
    actor_id: u64,
    actor_session: &str,
    intent_id: &str,
) -> CommandRequest {
    let actor = runtime
        .actor_by_id(actor_id)
        .expect("canonical version test actor");
    let actor_ref = runtime
        .canonical_ref("actor", actor_id)
        .expect("canonical version test actor ref")
        .to_string();
    let location_ref = runtime
        .canonical_ref("location", actor.location_id)
        .expect("canonical version test location ref")
        .to_string();
    let offer_id = runtime
        .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
            offer.kind == "search"
        })
        .expect("search rotates into the canonical version test hand")
        .offer_id;
    CommandRequest {
        actor_id,
        actor_session: Some(actor_session.to_string()),
        command: "offer identity selects the action".to_string(),
        offer_id: Some(offer_id),
        wallet_session: None,
        envelope: Some(CanonicalCommandEnvelope {
            world_id: OFFICIAL_WORLD_ID.to_string(),
            intent_id: intent_id.to_string(),
            actor_ref: actor_ref.clone(),
            observed: CanonicalObservedVersions {
                actor_version: Some(runtime.entity_version(&actor_ref)),
                location_version: Some(runtime.entity_version(&location_ref)),
                entities: BTreeMap::new(),
            },
            last_world_seq: runtime.world.next_event_seq.saturating_sub(1),
        }),
    }
}

#[tokio::test]
async fn stale_canonical_entity_versions_fail_closed_with_typed_errors() {
    let actor_id = 5000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Versioned Neighbour",
    );
    let state = test_app_state(runtime, None);
    let actor_session = create_actor_session(&state.actor_sessions, actor_id).0;
    let first_request = {
        let mut runtime = state.inner.lock().await;
        canonical_version_test_offer_request(
            &mut runtime,
            actor_id,
            &actor_session,
            "test:advance-version",
        )
    };
    let mut stale_request = first_request.clone();
    stale_request
        .envelope
        .as_mut()
        .expect("canonical envelope")
        .intent_id = "test:stale-version".to_string();
    let client = ConnectInfo("127.0.0.1:45130".parse().expect("client address"));

    let first = command(client, State(state.clone()), Json(first_request))
        .await
        .0;
    assert!(first.ok, "{first:?}");
    let event_count_after_first = state.inner.lock().await.event_log.len();
    let stale = command(client, State(state.clone()), Json(stale_request.clone()))
        .await
        .0;
    assert_eq!(stale.error_kind, Some(CommandErrorKind::StaleActorVersion));

    let mut stale_location_request = stale_request.clone();
    {
        let runtime = state.inner.lock().await;
        let actor = runtime.actor_by_id(actor_id).expect("versioned actor");
        let actor_ref = runtime.canonical_ref("actor", actor_id).unwrap();
        let location_ref = runtime
            .canonical_ref("location", actor.location_id)
            .unwrap();
        let envelope = stale_location_request.envelope.as_mut().unwrap();
        envelope.intent_id = "test:stale-location-version".to_string();
        envelope.observed.actor_version = Some(runtime.entity_version(actor_ref));
        envelope.observed.location_version =
            Some(runtime.entity_version(location_ref).saturating_add(1));
    }
    let stale_location = command(client, State(state.clone()), Json(stale_location_request))
        .await
        .0;
    assert_eq!(
        stale_location.error_kind,
        Some(CommandErrorKind::StaleLocationVersion)
    );

    let mut stale_entity_request = stale_request;
    {
        let runtime = state.inner.lock().await;
        let actor = runtime.actor_by_id(actor_id).expect("versioned actor");
        let actor_ref = runtime.canonical_ref("actor", actor_id).unwrap();
        let location_ref = runtime
            .canonical_ref("location", actor.location_id)
            .unwrap();
        let envelope = stale_entity_request.envelope.as_mut().unwrap();
        envelope.intent_id = "test:stale-entity-version".to_string();
        envelope.observed.actor_version = Some(runtime.entity_version(actor_ref));
        envelope.observed.location_version = Some(runtime.entity_version(location_ref));
        envelope.observed.entities.insert(
            actor_ref.to_string(),
            runtime.entity_version(actor_ref).saturating_add(1),
        );
    }
    let stale_entity = command(client, State(state.clone()), Json(stale_entity_request))
        .await
        .0;
    assert_eq!(
        stale_entity.error_kind,
        Some(CommandErrorKind::StaleEntityVersion)
    );
    assert_eq!(
        state.inner.lock().await.event_log.len(),
        event_count_after_first
    );
}
