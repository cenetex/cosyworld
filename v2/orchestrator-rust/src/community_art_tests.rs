use super::*;

fn test_art_config() -> ReplicateAvatarArtConfig {
    ReplicateAvatarArtConfig {
        api_token: "test-token".to_string(),
        model: "test/model".to_string(),
        version: None,
        lora_url: None,
        lora_input_key: "lora_weights".to_string(),
        lora_scale_input_key: "lora_scale".to_string(),
        lora_scale: 1.0,
        prompt_prefix: "cozy card art".to_string(),
        output_format: "png".to_string(),
    }
}

#[tokio::test]
async fn location_art_funding_fails_before_debit_without_policy_review() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Careful Patron",
    );
    runtime.callings.insert(
        5000,
        CallingState {
            actor_id: 5000,
            statement: EXPLORER_CALLING_STATEMENT.to_string(),
            source_event_seq: None,
        },
    );
    let (search, mutation, _) = runtime
        .plan_journey_move(5000, MOONLIT_TRAIL_LOCATION_ID)
        .expect("pathway planning succeeds")
        .expect("long route begins with discovery");
    let mut discovery = JournalRecord::new(search, 7049);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];
    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    assert!(state.ai_config.as_ref().is_none());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44991".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            intent_id: "test-location-policy-unconfigured".to_string(),
        }),
    )
    .await
    .0;

    assert!(!response.ok);
    assert_eq!(response.status, 503);
    assert!(response.events.is_empty());
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("location", waypoint_id, 1)));
}

#[tokio::test]
async fn moderation_rejects_pathway_art_to_the_fallback_without_refunding() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Art Ranger",
    );
    runtime.callings.insert(
        5000,
        CallingState {
            actor_id: 5000,
            statement: EXPLORER_CALLING_STATEMENT.to_string(),
            source_event_seq: None,
        },
    );
    let (search, mutation, _) = runtime
        .plan_journey_move(5000, MOONLIT_TRAIL_LOCATION_ID)
        .expect("pathway planning succeeds")
        .expect("long route begins with discovery");
    let mut discovery = JournalRecord::new(search, 7051);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];

    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7052,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "test-pathway-policy-funding".to_string(),
            amount: 1,
            history_through_seq: 7052,
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);
    let mut ready = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7053,
    );
    ready
        .projection_mutations
        .push(ProjectionMutation::SetCommunityArtStatus {
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            level: 1,
            status: "ready".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&ready).0, CW_OK);
    assert_eq!(
        runtime
            .state_response(Some(5000), &AccessContext::default())
            .cards
            .locations[&waypoint_id]
            .image_url
            .as_deref(),
        Some(
            format!("/assets/generated/community/location/{waypoint_id}.image?level=1&revision=1")
                .as_str()
        )
    );
    let before_world_tick = runtime.world.tick;
    let before_exit_count = runtime.world.exit_count;
    let before_journey = runtime.journeys[&5000].clone();

    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-pathway-policy-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let mut state = test_app_state(runtime, None);
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    state.moderation_token = Some(Arc::new("test-moderator".to_string()));
    let image_path = stored_community_art_image_path(&generated_dir, "location", waypoint_id);
    let content_type_path =
        stored_community_art_content_type_path(&generated_dir, "location", waypoint_id);
    fs::create_dir_all(image_path.parent().expect("community art parent"))
        .expect("create community art fixture directory");
    fs::write(&image_path, b"reviewed fixture bytes").expect("write ready art fixture");
    fs::write(&content_type_path, "image/png").expect("write ready art type fixture");
    let legacy_pathway_dir = generated_dir.join("pathways");
    fs::create_dir_all(&legacy_pathway_dir).expect("create legacy pathway directory");
    fs::write(
        legacy_pathway_dir.join(format!("{waypoint_id}.image")),
        b"legacy person-bearing image",
    )
    .expect("write legacy pathway fixture");

    let legacy_response =
        generated_pathway_asset(State(state.clone()), AxumPath(format!("{waypoint_id}.svg")))
            .await
            .into_response();
    assert_eq!(legacy_response.status(), StatusCode::OK);
    assert_eq!(
        legacy_response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("image/svg+xml; charset=utf-8"),
        "legacy pathway bitmaps must never override the deterministic fallback"
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        "Bearer test-moderator".parse().expect("moderation header"),
    );
    let rejected = moderation_reject_community_art(
        headers,
        State(state.clone()),
        AxumPath(("location".to_string(), waypoint_id)),
    )
    .await
    .0;
    assert!(rejected.ok);
    assert_eq!(rejected.art_status.as_deref(), Some("rejected"));
    assert!(rejected.retryable_without_orbs);
    assert!(!image_path.exists());
    assert!(!content_type_path.exists());

    let runtime = state.inner.lock().await;
    let card = &runtime
        .state_response(Some(5000), &AccessContext::default())
        .cards
        .locations[&waypoint_id];
    assert_eq!(card.asset_status, "generated_pathway_art");
    assert_eq!(
        card.image_url.as_deref(),
        Some(format!("/assets/generated/pathways/{waypoint_id}.svg").as_str())
    );
    let generation = &runtime.community_art_generations
        [&community_art_generation_key("location", waypoint_id, 1)];
    assert_eq!(generation.status, "rejected");
    assert_eq!(generation.funded_orbs, generation.required_orbs);
    assert_eq!(generation.revision, 2);
    assert_eq!(runtime.world.tick, before_world_tick);
    assert_eq!(runtime.world.exit_count, before_exit_count);
    let journey = &runtime.journeys[&5000];
    assert_eq!(journey.pathway_id, before_journey.pathway_id);
    assert_eq!(journey.path, before_journey.path);
    assert_eq!(journey.current_step, before_journey.current_step);
    drop(runtime);

    let rejected_asset = generated_community_art_asset(
        State(state),
        AxumPath(("location".to_string(), format!("{waypoint_id}.image"))),
    )
    .await
    .into_response();
    assert_eq!(rejected_asset.status(), StatusCode::NOT_FOUND);
    let _ = fs::remove_dir_all(generated_dir);
}
