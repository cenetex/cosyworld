use super::*;
use crate::*;
use axum::{body::to_bytes, extract::Path as AxumPath};
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use std::{
    io::Cursor,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

const ACTOR_A: u64 = 5000;
const ACTOR_B: u64 = 5001;

struct SceneFixture {
    root: PathBuf,
    runtime: RuntimeWorld,
    event_seq: u64,
    item_id: u64,
    location_prediction: String,
    asset_ids: Vec<String>,
}

fn png() -> Vec<u8> {
    patterned_png(3)
}

fn scene_png() -> Vec<u8> {
    patterned_png(71)
}

fn patterned_png(seed: u8) -> Vec<u8> {
    let pixels = ImageBuffer::from_fn(16, 9, |x, y| {
        Rgba([
            (x as u8)
                .wrapping_mul(17)
                .wrapping_add((y as u8).wrapping_mul(seed)),
            (y as u8)
                .wrapping_mul(29)
                .wrapping_add((x as u8).wrapping_mul(seed)),
            (x as u8 ^ y as u8).wrapping_mul(11).wrapping_add(seed),
            255,
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(pixels)
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("encode PNG fixture");
    bytes.into_inner()
}

fn temp_root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "cosyworld-room-scene-{label}-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&root);
    root
}

fn approve_reference(
    root: &Path,
    kind: &str,
    id: u64,
    level: u8,
    event_seq: u64,
) -> (String, String) {
    let prediction = format!("reference-{kind}-{id}");
    let manifest = &active_content().manifest;
    let asset_id = register_generated_media_asset(
        root,
        kind,
        id,
        level,
        &png(),
        "image/png",
        MediaAssetProvenance {
            pack_id: manifest.id.clone(),
            pack_version: manifest.version.to_string(),
            composition_id: format!("test:{kind}:{id}"),
            composition_revision: event_seq.to_string(),
            provider: "replicate".to_string(),
            model: "test/reference".to_string(),
            model_version: "a".repeat(64),
            prompt_version: "test/reference/1".to_string(),
            seed: None,
            prediction_id: Some(prediction.clone()),
            source_event_seq: Some(event_seq),
            history_through_seq: event_seq,
            ..MediaAssetProvenance::default()
        },
    )
    .expect("register reference");
    assert!(reconcile_community_media_asset_status(
        root,
        kind,
        id,
        level,
        "ready",
        Some(&prediction),
        Some(event_seq),
    )
    .expect("approve reference"));
    (asset_id, prediction)
}

fn scene_fixture(label: &str) -> SceneFixture {
    let root = temp_root(label);
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, ACTOR_A, COSY_COTTAGE_LOCATION_ID, "Aster");
    create_test_human(&mut runtime, ACTOR_B, COSY_COTTAGE_LOCATION_ID, "Bramble");
    let item_id = runtime.world.items[0].id;
    runtime.world.items[0].holder_actor_id = ACTOR_A;
    runtime.world.items[0].location_id = COSY_COTTAGE_LOCATION_ID;
    let event_seq = runtime.world.next_event_seq;
    freeze_legacy_test_levels(&mut runtime);
    let reference_seq = event_seq.saturating_sub(1).max(1);
    let mut asset_ids = Vec::new();
    let (location_asset, location_prediction) = approve_reference(
        &root,
        "location",
        COSY_COTTAGE_LOCATION_ID,
        1,
        reference_seq,
    );
    asset_ids.push(location_asset);
    asset_ids.push(approve_reference(&root, "actor", ACTOR_A, 1, reference_seq).0);
    asset_ids.push(approve_reference(&root, "actor", ACTOR_B, 1, reference_seq).0);
    asset_ids.push(approve_reference(&root, "item", item_id, 1, reference_seq).0);
    runtime.event_log.push(EventView {
        seq: event_seq,
        type_name: "item.shared".to_string(),
        success: true,
        actor_id: Some(ACTOR_A),
        actor_name: Some("Aster".to_string()),
        target_actor_id: Some(ACTOR_B),
        target_actor_name: Some("Bramble".to_string()),
        location_id: Some(COSY_COTTAGE_LOCATION_ID),
        location_name: runtime.location_name(COSY_COTTAGE_LOCATION_ID),
        item_id: Some(item_id),
        item_name: runtime.item_name(item_id),
        content: Some("Aster showed Bramble the well-traveled keepsake.".to_string()),
        ..EventView::default()
    });
    runtime.world.next_event_seq = event_seq.saturating_add(1);
    SceneFixture {
        root,
        runtime,
        event_seq,
        item_id,
        location_prediction,
        asset_ids,
    }
}

#[test]
fn generated_waypoint_scene_brief_bounds_every_constraint_by_bytes() {
    let root = temp_root("generated-waypoint-brief");
    let mut runtime = RuntimeWorld::seeded();
    let pathway = runtime
        .generated_pathway(ACTOR_A, 12, 50, 3)
        .expect("build a real generated pathway");
    let waypoint_id = pathway.waypoints[0].id;
    runtime
        .generated_pathways
        .insert(pathway.id.clone(), pathway.clone());
    runtime.ensure_generated_pathway_edge(&pathway, 12, waypoint_id);
    create_test_human(&mut runtime, ACTOR_A, waypoint_id, "Aster");

    let event_seq = runtime.world.next_event_seq;
    freeze_legacy_test_levels(&mut runtime);
    let reference_seq = event_seq.saturating_sub(1).max(1);
    approve_reference(&root, "location", waypoint_id, 1, reference_seq);
    approve_reference(&root, "actor", ACTOR_A, 1, reference_seq);
    runtime.event_log.push(EventView {
        seq: event_seq,
        type_name: "pathway.arrived".to_string(),
        success: true,
        actor_id: Some(ACTOR_A),
        actor_name: Some("Aster".to_string()),
        location_id: Some(waypoint_id),
        location_name: runtime.location_name(waypoint_id),
        content: Some("Aster reaches the newly discovered crossing.".to_string()),
        ..EventView::default()
    });
    runtime.world.next_event_seq = event_seq.saturating_add(1);

    let job = runtime
        .freeze_room_scene(&root, ACTOR_A, event_seq)
        .expect("freeze a generated-waypoint scene");
    let raw_environment = job
        .environmental_facts
        .iter()
        .find(|fact| fact.starts_with("approved environment:"))
        .expect("generated waypoint preserves its approved art prompt");
    assert!(
        raw_environment.len() > crate::media_recipes::media_verdict::MEDIA_BRIEF_CONSTRAINT_LIMIT,
        "the production waypoint prompt must reproduce the former overflow"
    );

    let brief = room_scene_media_brief(&job);
    brief
        .validate()
        .expect("a real generated-waypoint room scene must pass the media gate");
    for constraint in brief
        .required_subjects
        .iter()
        .chain(&brief.required_environment)
        .chain(brief.required_item_holder.iter())
        .chain(&brief.safe_areas)
        .chain(&brief.forbidden)
        .chain(&brief.pack_negative_constraints)
    {
        assert!(!constraint.trim().is_empty());
        assert!(
            constraint.len() <= crate::media_recipes::media_verdict::MEDIA_BRIEF_CONSTRAINT_LIMIT,
            "constraint is {} bytes: {constraint}",
            constraint.len()
        );
        assert!(constraint.is_char_boundary(constraint.len()));
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn complete_scene_is_byte_traceable_ordered_and_idempotent() {
    assert!(
        serde_json::from_value::<ReviewRoomSceneRequest>(serde_json::json!({
            "approved": true,
            "review_event_seq": 999
        }))
        .is_err()
    );
    let fixture = scene_fixture("complete");
    let job = fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_A, fixture.event_seq)
        .expect("freeze complete scene");
    assert_eq!(job.actors.len(), 2);
    assert_eq!(
        job.selected_item.as_ref().map(|item| item.item_id),
        Some(fixture.item_id)
    );
    assert_eq!(
        job.references
            .iter()
            .map(|reference| reference.slot)
            .collect::<Vec<_>>(),
        vec![
            MediaReferenceSlot::Location,
            MediaReferenceSlot::Actor,
            MediaReferenceSlot::Actor,
            MediaReferenceSlot::Item,
        ]
    );
    assert_eq!(
        job.references
            .iter()
            .map(|reference| reference.reference.asset_id.clone())
            .collect::<Vec<_>>(),
        fixture.asset_ids
    );
    assert!(job.prompt.contains("Image 1 is the authoritative location"));
    assert!(job.prompt.contains("Image 2 is actor Aster only"));
    assert!(job.prompt.contains("Image 3 is actor Bramble only"));
    assert!(job.prompt.contains("Image 4 is the selected item"));
    assert!(job.prompt.contains("do not add, remove, merge, replace"));
    assert_eq!(job.recipe.reference_maximum, 4);
    assert_eq!(job.recipe.reference_ordering, "caller");
    assert_eq!(job.recipe.reference_prompt_semantics, "indexed_image_1");
    assert_eq!(job.funding_principal, ROOM_SCENE_FUNDING_PRINCIPAL);
    assert_eq!(job.funding_policy, ROOM_SCENE_FUNDING);
    assert_eq!(
        job.event_media_intent,
        format!(
            "{}:{}:room_scene:{ROOM_SCENE_PROFILE}:{ROOM_SCENE_USE}",
            job.world_id, fixture.event_seq
        )
    );

    let same_logical_job = fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_B, fixture.event_seq)
        .expect("freeze same server-canonical scene");
    assert_eq!(same_logical_job, job);

    let first = persist_room_scene_job(&fixture.root, job.clone()).expect("persist first job");
    let bytes = fs::read(room_scene_state_path(&fixture.root, &job.job_id))
        .expect("read persisted job bytes");
    let second = persist_room_scene_job(&fixture.root, job.clone()).expect("persist retry");
    assert_eq!(first, second);
    assert_eq!(
        fs::read(room_scene_state_path(&fixture.root, &job.job_id))
            .expect("read idempotent job bytes"),
        bytes
    );

    let mut swapped = job.clone();
    swapped.references.swap(1, 2);
    assert!(swapped.validate().is_err());
    let mut duplicate = job.clone();
    duplicate.actors[1] = duplicate.actors[0].clone();
    assert!(duplicate.validate().is_err());
    let mut over_budget = job.clone();
    let mut extra = over_budget.references[1].clone();
    extra.order = over_budget.references.len();
    extra.reference.subject_id = 9999;
    over_budget.references.push(extra);
    assert!(over_budget
        .validate()
        .expect_err("over-budget scene stays unillustrated")
        .contains("multi-pass"));

    let mut wrong_pack = job;
    wrong_pack.worldpack_id = "foreign.pack".to_string();
    wrong_pack.projection_digest = canonical_digest(&RoomSceneProjection {
        world_id: &wrong_pack.world_id,
        worldpack_id: &wrong_pack.worldpack_id,
        projection_seq: wrong_pack.projection_seq,
        location_id: wrong_pack.location_id,
        location_level: wrong_pack.location_level,
        location_name: &wrong_pack.location_name,
        environmental_facts: &wrong_pack.environmental_facts,
        actors: &wrong_pack.actors,
        selected_item: &wrong_pack.selected_item,
        public_beat_type: &wrong_pack.public_beat_type,
        public_beat: &wrong_pack.public_beat,
    })
    .expect("recompute tampered projection digest");
    assert!(wrong_pack
        .resolve(&fixture.root)
        .expect_err("foreign pack boundary fails closed")
        .contains("worldpack boundary"));
    let _ = fs::remove_dir_all(fixture.root);
}

#[test]
fn projector_removes_absent_actor_and_item_and_rejects_stale_or_combat_boundaries() {
    let mut fixture = scene_fixture("authoritative-removal");
    let other_location = MOONLIT_TRAIL_LOCATION_ID;
    fixture
        .runtime
        .world
        .actors
        .iter_mut()
        .take(fixture.runtime.world.actor_count)
        .find(|actor| actor.id == ACTOR_B)
        .expect("second actor")
        .location_id = other_location;
    fixture
        .runtime
        .world
        .items
        .iter_mut()
        .take(fixture.runtime.world.item_count)
        .find(|item| item.id == fixture.item_id)
        .expect("selected item")
        .holder_actor_id = ACTOR_B;
    let event_seq = fixture.runtime.world.next_event_seq;
    fixture.runtime.event_log.push(EventView {
        seq: event_seq,
        type_name: "item.shared".to_string(),
        success: true,
        actor_id: Some(ACTOR_A),
        target_actor_id: Some(ACTOR_B),
        location_id: Some(COSY_COTTAGE_LOCATION_ID),
        item_id: Some(fixture.item_id),
        content: Some("Aster waved goodbye.".to_string()),
        ..EventView::default()
    });
    fixture.runtime.world.next_event_seq = event_seq + 1;
    let job = fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_A, event_seq)
        .expect("freeze reduced authoritative scene");
    assert_eq!(
        job.actors
            .iter()
            .map(|actor| actor.actor_id)
            .collect::<Vec<_>>(),
        vec![ACTOR_A]
    );
    assert!(job.selected_item.is_none());
    assert_eq!(job.references.len(), 2);
    assert!(!job.prompt.contains("Bramble"));
    assert!(!job.prompt.contains(&fixture.item_id.to_string()));
    assert!(fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_A, event_seq - 1)
        .expect_err("stale projection rejected")
        .contains("stale"));

    let combat_seq = fixture.runtime.world.next_event_seq;
    fixture.runtime.event_log.push(EventView {
        seq: combat_seq,
        type_name: "combat.attack".to_string(),
        success: true,
        actor_id: Some(ACTOR_A),
        target_actor_id: Some(ACTOR_B),
        location_id: Some(COSY_COTTAGE_LOCATION_ID),
        damage: Some(1),
        ..EventView::default()
    });
    fixture.runtime.world.next_event_seq = combat_seq + 1;
    assert!(fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_A, combat_seq)
        .expect_err("combat tableau is out of scope")
        .contains("combat"));
    let _ = fs::remove_dir_all(fixture.root);
}

#[test]
fn missing_rejected_and_rights_ineligible_references_fail_before_persistence() {
    let missing = scene_fixture("missing-reference");
    fs::remove_dir_all(missing.root.join("media-assets")).expect("remove reference graph");
    let error = missing
        .runtime
        .freeze_room_scene(&missing.root, ACTOR_A, missing.event_seq)
        .expect_err("missing reference fails before job persistence");
    assert!(error.contains("no approved canonical media asset"));
    assert!(!missing.root.join("room-scenes").exists());
    let _ = fs::remove_dir_all(missing.root);

    let rejected = scene_fixture("rejected-reference");
    assert!(reconcile_community_media_asset_status(
        &rejected.root,
        "actor",
        ACTOR_B,
        1,
        "rejected",
        Some(&format!("reference-actor-{ACTOR_B}")),
        Some(rejected.event_seq),
    )
    .expect("reject actor reference"));
    assert!(rejected
        .runtime
        .freeze_room_scene(&rejected.root, ACTOR_A, rejected.event_seq)
        .expect_err("rejected reference fails")
        .contains("no approved canonical media asset"));
    assert!(!rejected.root.join("room-scenes").exists());
    let _ = fs::remove_dir_all(rejected.root);

    let rights = scene_fixture("rights-reference");
    let graph_path = rights.root.join("media-assets/graph-v1.json");
    let mut graph: serde_json::Value =
        serde_json::from_slice(&fs::read(&graph_path).expect("read graph for rights fixture"))
            .expect("parse graph");
    graph["assets"][&rights.asset_ids[2]]["rights"]["reference_reuse_permitted"] =
        serde_json::Value::Bool(false);
    fs::write(
        &graph_path,
        serde_json::to_vec(&graph).expect("serialize rights fixture"),
    )
    .expect("write rights fixture");
    assert!(rights
        .runtime
        .freeze_room_scene(&rights.root, ACTOR_A, rights.event_seq)
        .expect_err("rights-ineligible reference fails")
        .contains("not licensed"));
    assert!(!rights.root.join("room-scenes").exists());
    let _ = fs::remove_dir_all(rights.root);
}

#[tokio::test]
async fn candidate_retry_is_exact_and_publication_waits_for_review_with_full_lineage() {
    let fixture = scene_fixture("lifecycle");
    let job = fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_A, fixture.event_seq)
        .expect("freeze lifecycle scene");
    persist_room_scene_job(&fixture.root, job.clone()).expect("persist lifecycle job");
    let calls = Arc::new(AtomicUsize::new(0));
    let primary_calls = calls.clone();
    let duplicate_calls = calls.clone();
    let primary = generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_secs(1),
        move |resolved| {
            let calls = primary_calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                assert_eq!(
                    resolved
                        .references
                        .iter()
                        .map(|reference| reference.slot)
                        .collect::<Vec<_>>(),
                    vec![
                        MediaReferenceSlot::Location,
                        MediaReferenceSlot::Actor,
                        MediaReferenceSlot::Actor,
                        MediaReferenceSlot::Item,
                    ]
                );
                assert_eq!(
                    resolved.provider_input()?["input_images"]
                        .as_array()
                        .map(Vec::len),
                    Some(4)
                );
                tokio::time::sleep(Duration::from_millis(25)).await;
                Ok(DownloadedReplicateImage {
                    bytes: scene_png(),
                    content_type: "image/png".to_string(),
                    source_url: "https://replicate.delivery/pbxt/scene.png".to_string(),
                    prediction_id: Some("room-scene-prediction".to_string()),
                })
            }
        },
    );
    let duplicate = generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_secs(1),
        move |_| {
            let calls = duplicate_calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Err("duplicate provider call".to_string())
            }
        },
    );
    let (primary, duplicate) = tokio::join!(primary, duplicate);
    assert!(!primary.expect("primary candidate generation"));
    assert!(duplicate.expect("duplicate create reuses the generation claim"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let state_after_candidate =
        load_room_scene(&fixture.root, &job.job_id).expect("load candidate");
    assert_eq!(
        state_after_candidate.lifecycle,
        RoomSceneLifecycle::ReviewPending
    );
    assert_eq!(state_after_candidate.provider_attempts, 1);
    assert!(state_after_candidate.published_asset_id.is_none());
    let accepted = room_scene_ok(&state_after_candidate, StatusCode::ACCEPTED);
    assert_eq!(accepted.status(), StatusCode::ACCEPTED);
    let incumbent = canonical_community_media_asset_bytes(
        &fixture.root,
        "location",
        COSY_COTTAGE_LOCATION_ID,
        1,
        Some(&fixture.location_prediction),
    )
    .expect("incumbent remains canonical before review");
    assert_eq!(incumbent.0, png());
    assert!(generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_secs(1),
        |_| async { Err("provider must not run on candidate retry".to_string()) },
    )
    .await
    .expect("reuse exact candidate"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let mut app_state = test_app_state(fixture.runtime, None);
    app_state.generated_asset_dir = Arc::new(fixture.root.clone());
    let pending = generated_room_scene_asset(
        State(app_state.clone()),
        AxumPath(format!("{}.image", job.job_id)),
    )
    .await
    .into_response();
    assert_eq!(pending.status(), StatusCode::NOT_FOUND);

    let ready = review_room_scene_candidate(
        &fixture.root,
        &job.job_id,
        true,
        fixture.event_seq + 1,
        "reviewed composition",
    )
    .expect("approve candidate");
    assert_eq!(ready.lifecycle, RoomSceneLifecycle::Ready);
    assert!(ready.published_asset_id.is_some());
    assert_eq!(ready.review_event_seq, Some(fixture.event_seq + 1));
    assert_eq!(ready.review_reason.as_deref(), Some("reviewed composition"));
    assert!(!room_scene_candidate_path(&fixture.root, &job).exists());
    let published =
        generated_room_scene_asset(State(app_state), AxumPath(format!("{}.image", job.job_id)))
            .await
            .into_response();
    assert_eq!(published.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(published.into_body(), usize::MAX)
            .await
            .expect("read published body")
            .to_vec(),
        scene_png()
    );
    let canonical = canonical_community_media_asset_bytes(
        &fixture.root,
        "location",
        COSY_COTTAGE_LOCATION_ID,
        1,
        Some("room-scene-prediction"),
    )
    .expect("approved room scene becomes ordinary canonical location media");
    assert_eq!(canonical.0, scene_png());
    let graph =
        fs::read_to_string(fixture.root.join("media-assets/graph-v1.json")).expect("read lineage");
    let graph_json: serde_json::Value = serde_json::from_str(&graph).expect("parse lineage");
    let location_key = format!("location:{}:level:1", COSY_COTTAGE_LOCATION_ID);
    assert_eq!(
        graph_json["canonical"][&location_key].as_str(),
        ready.published_asset_id.as_deref()
    );
    for asset_id in &fixture.asset_ids {
        assert!(
            graph.contains(asset_id),
            "lineage contains parent {asset_id}"
        );
    }
    assert!(graph.contains("bounded authoritative room-scene composition"));
    let idempotent = review_room_scene_candidate(
        &fixture.root,
        &job.job_id,
        true,
        fixture.event_seq + 1,
        "same review retry",
    )
    .expect("review retry is idempotent");
    assert_eq!(idempotent.published_asset_id, ready.published_asset_id);
    let _ = fs::remove_dir_all(fixture.root);
}

#[tokio::test]
async fn provider_timeout_is_retryable_without_duplicate_job_or_world_mutation() {
    let fixture = scene_fixture("timeout");
    let before_path = fixture.root.join("world-before.json");
    fixture
        .runtime
        .save_snapshot(&before_path)
        .expect("snapshot before");
    let before_world = fs::read(&before_path).expect("read snapshot before");
    let job = fixture
        .runtime
        .freeze_room_scene(&fixture.root, ACTOR_A, fixture.event_seq)
        .expect("freeze timeout scene");
    persist_room_scene_job(&fixture.root, job.clone()).expect("persist timeout job");
    let error = generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_millis(1),
        |_| async { std::future::pending::<Result<DownloadedReplicateImage, String>>().await },
    )
    .await
    .expect_err("provider timeout");
    assert!(error.contains("timed out"));
    let failed = load_room_scene(&fixture.root, &job.job_id).expect("load failed job");
    assert_eq!(failed.lifecycle, RoomSceneLifecycle::Failed);
    assert_eq!(failed.provider_attempts, 1);
    assert!(!room_scene_candidate_path(&fixture.root, &job).exists());
    let mut orphaned = failed;
    orphaned.lifecycle = RoomSceneLifecycle::Generating;
    store_room_scene(&fixture.root, &orphaned).expect("persist simulated orphan");
    let now = now_millis();
    fs::write(
        room_scene_claim_path(&fixture.root, &job.job_id),
        serde_json::to_vec(&RoomSceneProviderLease {
            schema_version: ROOM_SCENE_SCHEMA_VERSION,
            attempt: 2,
            created_at_ms: now,
            expires_at_ms: now + 60_000,
        })
        .expect("serialize live lease"),
    )
    .expect("persist live lease");
    let blocked_calls = Arc::new(AtomicUsize::new(0));
    let provider_calls = blocked_calls.clone();
    assert!(generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_secs(1),
        move |_| {
            provider_calls.fetch_add(1, Ordering::SeqCst);
            async { Err("provider must remain behind durable claim".to_string()) }
        },
    )
    .await
    .expect("unexpired orphan lease fails closed"));
    assert_eq!(blocked_calls.load(Ordering::SeqCst), 0);
    fs::write(
        room_scene_claim_path(&fixture.root, &job.job_id),
        b"{malformed",
    )
    .expect("persist malformed lease");
    let malformed_calls = blocked_calls.clone();
    assert!(generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_secs(1),
        move |_| {
            malformed_calls.fetch_add(1, Ordering::SeqCst);
            async { Err("malformed lease must fail closed".to_string()) }
        },
    )
    .await
    .expect("malformed orphan lease fails closed"));
    assert_eq!(blocked_calls.load(Ordering::SeqCst), 0);
    fs::write(
        room_scene_claim_path(&fixture.root, &job.job_id),
        serde_json::to_vec(&RoomSceneProviderLease {
            schema_version: ROOM_SCENE_SCHEMA_VERSION,
            attempt: 1,
            created_at_ms: now.saturating_sub(2),
            expires_at_ms: now.saturating_sub(1),
        })
        .expect("serialize expired lease"),
    )
    .expect("persist expired lease");

    assert!(!generate_room_scene_candidate_with(
        &fixture.root,
        &job.job_id,
        Duration::from_secs(1),
        |_| async {
            Ok(DownloadedReplicateImage {
                bytes: scene_png(),
                content_type: "image/png".to_string(),
                source_url: "https://replicate.delivery/pbxt/retry.png".to_string(),
                prediction_id: Some("retry".to_string()),
            })
        },
    )
    .await
    .expect("retry same logical job"));
    let retried = load_room_scene(&fixture.root, &job.job_id).expect("load retry");
    assert_eq!(retried.lifecycle, RoomSceneLifecycle::ReviewPending);
    assert_eq!(retried.provider_attempts, 2);
    assert!(retried.published_asset_id.is_none());
    assert!(!room_scene_claim_path(&fixture.root, &job.job_id).exists());
    let after_path = fixture.root.join("world-after.json");
    fixture
        .runtime
        .save_snapshot(&after_path)
        .expect("snapshot after");
    assert_eq!(
        fs::read(&after_path).expect("read snapshot after"),
        before_world,
        "provider timeout and retry never mutate world or funding state"
    );
    let _ = fs::remove_dir_all(fixture.root);
}
