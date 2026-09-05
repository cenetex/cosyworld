use super::*;
use crate::media_recipes::media_verdict::{
    prepare_media_candidate, record_media_provider_failure, MediaCandidateInput,
    MediaVerdictDisposition, MEDIA_BRIEF_CONSTRAINT_LIMIT,
};
use axum::{response::IntoResponse as _, routing::post, Router};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use sha2::{Digest as _, Sha256};
use std::{
    io::Cursor,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};

fn create_test_human(runtime: &mut RuntimeWorld, actor_id: u64, location_id: u64, name: &str) {
    crate::test_support::create_test_human(runtime, actor_id, location_id, name);
    let level = runtime
        .actor_by_id(actor_id)
        .map(|actor| actor.stats.level.max(1))
        .unwrap_or(1);
    let memory = runtime
        .entity_memories
        .entry(WorldEntityRef::avatar(actor_id).key())
        .or_default();
    memory
        .identity_by_level
        .entry(level)
        .or_default()
        .appearance =
        "A round-faced traveler with copper curls, brown eyes, and a moss-green coat.".to_string();
    memory
        .descriptions_by_level
        .insert(level, "A complete test persona description.".to_string());
}

fn test_avatar_level_identity(appearance: &str) -> AvatarLevelIdentity {
    AvatarLevelIdentity {
        persona: "I am curious about the shared world around me.".to_string(),
        appearance: appearance.to_string(),
        continuity: "I remain recognizably myself as I grow.".to_string(),
    }
}

#[test]
fn direct_avatar_portrait_can_be_funded_before_its_async_level_description() {
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Portrait Author",
    );

    let pending = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("the Orb timeline can be funded before the persona responds");
    assert!(runtime.avatar_requires_self_description(5000, 1));
    assert!(runtime.avatar_can_redescribe_appearance(5000, 1));
    assert_eq!(pending.required_orbs, 1);

    let appearance =
        "A freckled traveler with short copper curls, grey eyes, and a moss-green wool coat.";
    let identity = test_avatar_level_identity(appearance);
    let content_id = 91_001;
    runtime
        .content
        .insert(content_id, avatar_level_identity_content(&identity));
    runtime
        .append_avatar_self_description_projection(
            5000,
            &AvatarSelfDescriptionProjection {
                content_id,
                location_id: COSY_COTTAGE_LOCATION_ID,
                level: 1,
                caused_by_event_seq: None,
                source_world_tick: runtime.world.tick,
                observed_through_seq: runtime.world.next_event_seq.saturating_sub(1),
                identity,
            },
        )
        .expect("the first appearance at this level commits");

    let plan = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("the described avatar can fund a portrait");
    assert!(plan.prompt.contains(appearance));
    assert!(plan.persisted_visual_description.contains("copper curls"));
}

#[test]
fn a_new_level_description_replaces_the_frozen_brief_and_reopens_funded_art() {
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Retry Portrait",
    );
    let old_plan = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("initial portrait plan");
    fund_test_community_art(&mut runtime, 5000, &old_plan, "old-portrait", 91_010);
    let key = community_art_generation_key("actor", 5000, 1);
    let generation = runtime
        .community_art_generations
        .get_mut(&key)
        .expect("funded generation");
    generation.status = "policy_rejected".to_string();
    generation.provider_attempts = MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS;
    generation.review_attempts = MAX_COMMUNITY_ART_REVIEW_ATTEMPTS;
    generation.last_error_code = Some("community_art_policy_rejected".to_string());
    generation.frozen_plan = Some(old_plan);

    let appearance =
        "A blue-skinned traveler with silver braids, dark eyes, and a saffron wrap coat.";
    let identity = test_avatar_level_identity(appearance);
    let content_id = 91_011;
    runtime
        .content
        .insert(content_id, avatar_level_identity_content(&identity));
    let projection = AvatarSelfDescriptionProjection {
        content_id,
        location_id: COSY_COTTAGE_LOCATION_ID,
        level: 1,
        caused_by_event_seq: None,
        source_world_tick: runtime.world.tick,
        observed_through_seq: runtime.world.next_event_seq.saturating_sub(1),
        identity,
    };
    runtime
        .append_avatar_self_description_projection(5000, &projection)
        .expect("replacement appearance commits");

    let generation = &runtime.community_art_generations[&key];
    assert_eq!(generation.status, "funded");
    assert_eq!(generation.provider_attempts, 0);
    assert_eq!(generation.review_attempts, 0);
    assert!(generation.last_error_code.is_none());
    assert!(generation.frozen_plan.is_none());
    assert!(runtime
        .append_avatar_self_description_projection(5000, &projection)
        .is_none());
    let replacement = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("replacement portrait plan");
    assert!(replacement.prompt.contains(appearance));
}

#[test]
fn an_elysium_void_can_use_its_exact_text_model_to_describe_itself() {
    let registry = ContentRegistry::from_json(
        &fs::read_to_string(configured_content_root().join("elysium-only/registry.json"))
            .expect("Elysium registry reads"),
        content_engine_version(),
    )
    .expect("Elysium registry mounts");
    let content = registry.content();
    let actor_id = content
        .actor_model_bindings
        .iter()
        .find(|binding| {
            binding.input_modalities.iter().any(|mode| mode == "text")
                && binding.output_modalities.iter().any(|mode| mode == "text")
        })
        .map(|binding| binding.actor_id)
        .expect("Elysium has a text-capable Void");

    assert!(self_authored_avatar_has_text_binding(
        "self_authored",
        actor_id,
        &content.actor_model_bindings,
    ));
    assert!(!self_authored_avatar_has_text_binding(
        "authored",
        actor_id,
        &content.actor_model_bindings,
    ));
}

#[test]
fn a_direct_avatar_can_be_queued_for_its_current_level_appearance() {
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Level Look",
    );

    assert!(runtime.avatar_requires_self_description(5000, 1));
    assert!(runtime.avatar_can_redescribe_appearance(5000, 1));
}

#[test]
fn an_inference_avatar_without_an_exact_binding_can_use_the_server_description_route() {
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Unbound Portrait Author",
    );
    runtime.actor_autonomy.entry(5000).or_default().control_mode = ActorControlMode::ReactiveAi;

    assert!(!active_content()
        .actor_model_bindings
        .iter()
        .any(|binding| binding.actor_id == 5000));
    assert!(runtime.avatar_requires_self_description(5000, 1));
    assert!(runtime.avatar_can_redescribe_appearance(5000, 1));
    runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("an unbound inference avatar can queue a private server description");
}

#[tokio::test]
async fn a_fully_funded_portrait_queues_one_persona_description_before_generation() {
    let event_store_path = std::env::temp_dir().join(format!(
        "cosyworld-avatar-persona-description-{}-{}.sqlite",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_file(&event_store_path);
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Level Look",
    );
    let plan = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("the undescribed portrait can accept Orb funding");
    fund_test_community_art(
        &mut runtime,
        5000,
        &plan,
        "fully-funded-persona-timeline",
        91_012,
    );
    let state = test_app_state(runtime, Some(event_store_path.clone()));
    continue_community_art_generation(&state, 5000, plan.clone()).await;
    continue_community_art_generation(&state, 5000, plan).await;

    let conn = open_event_store(&event_store_path).expect("open persona description store");
    let queued: i64 = conn
        .query_row("SELECT COUNT(*) FROM actor_jobs", [], |row| row.get(0))
        .expect("count persona description jobs");
    assert_eq!(queued, 1);
    let claimed =
        claim_next_actor_job_of_kind(&event_store_path, ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION)
            .expect("claim persona description job")
            .expect("one persona description was queued");
    let ActorJobPayload::AvatarSelfDescription(job) = claimed.payload else {
        panic!("appearance request queued the wrong job kind");
    };
    assert_eq!(job.actor_id, 5000);
    let runtime = state.inner.lock().await;
    let generation =
        &runtime.community_art_generations[&community_art_generation_key("actor", 5000, 1)];
    assert_eq!(generation.status, "funded");
    assert_eq!(generation.provider_attempts, 0);
    drop(runtime);
    drop(conn);
    drop(state);
    let _ = fs::remove_file(event_store_path);
}

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
        provider_defaults: serde_json::Map::new(),
    }
}

fn gate_png_with_dimensions(width: u32, height: u32) -> Vec<u8> {
    let pixels = ImageBuffer::from_fn(width, height, |x, y| {
        Rgba([
            (x as u8).wrapping_mul(17),
            (y as u8).wrapping_mul(29),
            (x as u8 ^ y as u8).wrapping_mul(11),
            255,
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(pixels)
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("encode gate PNG");
    bytes.into_inner()
}

fn gate_png() -> Vec<u8> {
    gate_png_with_dimensions(16, 9)
}

fn square_gate_png() -> Vec<u8> {
    gate_png_with_dimensions(16, 16)
}

/// Mirrors the production location plan: `community_art_plan` joins the
/// per-trait bounded output of `stable_art_traits` into a single visual
/// description, so the description is a multiple of the component budget rather
/// than a single component.
fn location_art_plan(
    subject_id: u64,
    aspect_ratio: &'static str,
    reviewed_landscape_brief: &str,
) -> CommunityArtPlan {
    let persisted_identity = "Foxglove Turn — Newly Found Path".to_string();
    let subject_details = format!(
        "biome: chalk downs. terrain: chalk lane, reed bed, river stones. reviewed landscape brief: {reviewed_landscape_brief}"
    );
    let stable_traits = stable_art_traits("location", &persisted_identity, &subject_details);
    let persisted_visual_description = stable_traits.join(". ");
    CommunityArtPlan {
        subject_kind: "location".to_string(),
        subject_id,
        level: 1,
        generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        history_through_seq: 99,
        prompt: "A quiet chalk lane with no figures.".to_string(),
        aspect_ratio: aspect_ratio.to_string(),
        image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
        persisted_identity,
        persisted_visual_description,
        stable_traits,
        public_history: Vec::new(),
        evolution_job: None,
    }
}

fn long_reviewed_landscape_brief() -> String {
    "chalk lanes climb between reed beds and river stones under a wide pale sky, ".repeat(6)
}

#[test]
fn higher_level_without_prior_art_uses_a_base_generation_catch_up() {
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-community-art-base-catch-up-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let mut plan = location_art_plan(8901, "16:9", "a lantern-lit forest inn");
    plan.level = 2;
    plan.required_orbs = 2;

    freeze_community_art_evolution(&generated_dir, &mut plan)
        .expect("missing prior art should use a base generation at the funded level");
    assert!(
        plan.evolution_job.is_none(),
        "catch-up generation must not invent a prior-level lineage"
    );
    let _ = fs::remove_dir_all(generated_dir);
}

fn review_failed_generation(review_attempts: u8) -> CommunityArtGenerationState {
    CommunityArtGenerationState {
        subject_kind: "actor".to_string(),
        subject_id: 906_220_117_126,
        level: 1,
        generation_profile_version: community_art_generation_profile_version("actor"),
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        funded_orbs: 1,
        contributions: BTreeMap::from([(992_630_739_740, 1)]),
        funding_intent_ids: BTreeSet::from(["web-image:review-cap".to_string()]),
        status: "review_failed".to_string(),
        history_through_seq: 6_625,
        revision: 3,
        provider_attempts: 1,
        review_attempts,
        last_prediction_id: Some("928bg416f9rmy0czx1g8wa77c4".to_string()),
        last_error_code: Some("community_art_policy_review_failed".to_string()),
        status_event_seq: None,
        evolution_job: None,
        frozen_plan: None,
    }
}

/// A saved candidate whose review failed used to be retryable forever. One
/// Lonely Forest job re-ran 975 times over seven days because the reviewer was
/// paused by the daily spend cap and nothing counted the attempts.
#[test]
fn a_failed_review_stops_retrying_once_its_attempts_are_spent() {
    for attempts in 0..MAX_COMMUNITY_ART_REVIEW_ATTEMPTS {
        assert!(
            community_art_generation_retryable(&review_failed_generation(attempts), true),
            "attempt {attempts} is still within the review budget",
        );
    }
    assert!(
        !community_art_generation_retryable(
            &review_failed_generation(MAX_COMMUNITY_ART_REVIEW_ATTEMPTS),
            true,
        ),
        "a spent review budget must not keep re-running a funded job",
    );
    assert_eq!(
        review_failed_generation(MAX_COMMUNITY_ART_REVIEW_ATTEMPTS).funded_orbs,
        1,
        "the paid Orb stays with the job; only the retrying stops",
    );
}

/// A newer generation profile is the documented way back in, and it must still
/// reopen a job whose review budget is spent.
#[test]
fn a_newer_generation_profile_reopens_a_spent_review_budget() {
    let spent = review_failed_generation(MAX_COMMUNITY_ART_REVIEW_ATTEMPTS);
    assert!(community_art_generation_retryable_for_profile(
        &spent,
        true,
        spent.generation_profile_version.saturating_add(1),
    ));
}

/// Every state written before this counter existed belongs to a job that was
/// already looping, so it loads as exhausted rather than earning a new budget.
#[test]
fn a_legacy_state_without_the_counter_loads_as_exhausted() {
    let mut value = serde_json::to_value(review_failed_generation(0)).expect("serialize");
    value
        .as_object_mut()
        .expect("object")
        .remove("review_attempts");
    let restored: CommunityArtGenerationState =
        serde_json::from_value(value).expect("legacy state loads");
    assert_eq!(restored.review_attempts, MAX_COMMUNITY_ART_REVIEW_ATTEMPTS);
    assert!(!community_art_generation_retryable(&restored, true));
}

#[test]
fn actor_item_profile_reopens_paid_policy_exhaustion_with_stronger_typography_guards() {
    let exhausted = CommunityArtGenerationState {
        subject_kind: "actor".to_string(),
        subject_id: 9030,
        level: 1,
        generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        funded_orbs: 1,
        contributions: BTreeMap::from([(9030, 1)]),
        funding_intent_ids: BTreeSet::from(["project89-paid-image".to_string()]),
        status: "policy_rejected".to_string(),
        history_through_seq: 1_041,
        revision: 3,
        provider_attempts: MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS,
        review_attempts: 0,
        last_prediction_id: Some("third-policy-rejected-candidate".to_string()),
        last_error_code: Some("community_art_policy_rejected".to_string()),
        status_event_seq: Some(1_041),
        evolution_job: None,
        frozen_plan: None,
    };
    assert!(!community_art_generation_retryable(&exhausted, false));
    assert_eq!(
        community_art_generation_profile_version("actor"),
        ACTOR_ITEM_GENERATION_PROFILE_VERSION
    );
    assert_eq!(
        community_art_generation_profile_version("item"),
        ACTOR_ITEM_GENERATION_PROFILE_VERSION
    );
    assert!(community_art_generation_retryable_for_profile(
        &exhausted,
        false,
        ACTOR_ITEM_GENERATION_PROFILE_VERSION
    ));

    let prompt = build_community_art_prompt(
        "actor",
        "Project 89",
        "World Traveler",
        "A stable public portrait.",
        1,
        "Established identity and clothing.",
        "No recent visual changes.",
        None,
    );
    for guard in [
        "No words",
        "lettering",
        "signatures",
        "artist marks",
        "logo",
        "brand mark",
        "watermark",
        "typography-like shapes",
        "text-like marks",
    ] {
        assert!(prompt.contains(guard), "missing {guard}: {prompt}");
    }
}

fn fund_test_community_art(
    runtime: &mut RuntimeWorld,
    actor_id: u64,
    plan: &CommunityArtPlan,
    intent_id: &str,
    seed: u64,
) {
    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..CwAction::default()
        },
        seed,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: plan.subject_kind.clone(),
            subject_id: plan.subject_id,
            level: plan.level,
            required_orbs: plan.required_orbs,
            contributor_actor_id: actor_id,
            intent_id: intent_id.to_string(),
            amount: plan.required_orbs,
            history_through_seq: plan.history_through_seq,
            evolution_job: plan.evolution_job.clone(),
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);
}

async fn wait_for_community_art_status(
    state: &AppState,
    key: &str,
    expected_status: &str,
) -> CommunityArtGenerationState {
    for _ in 0..200 {
        let generation = {
            let runtime = state.inner.lock().await;
            runtime.community_art_generations.get(key).cloned()
        };
        if generation
            .as_ref()
            .map(|generation| generation.status.as_str())
            == Some(expected_status)
        {
            return generation.expect("matching generation exists");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let generation = {
        let runtime = state.inner.lock().await;
        runtime.community_art_generations.get(key).cloned()
    };
    panic!(
        "community art generation {key} did not reach {expected_status}; last state: {generation:?}"
    );
}

fn community_image_usage_count(path: &Path) -> i64 {
    let conn = open_event_store(path).expect("open community-art usage ledger");
    conn.query_row(
        "SELECT COUNT(*) FROM ai_usage_ledger WHERE feature LIKE 'community_image_%'",
        [],
        |row| row.get(0),
    )
    .expect("count community-art usage rows")
}

fn test_candidate_paths(root: &Path, plan: &CommunityArtPlan) -> [PathBuf; 3] {
    let stem = root
        .join("community-art-candidates")
        .join(&plan.subject_kind)
        .join(plan.subject_id.to_string())
        .join(format!("level-{}", plan.level));
    [
        stem.with_extension("image"),
        stem.with_extension("content-type"),
        stem.with_extension("metadata.json"),
    ]
}

fn test_candidate_quarantine_marker(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    let stem = root
        .join("community-art-candidates")
        .join(&plan.subject_kind)
        .join(plan.subject_id.to_string())
        .join(format!("level-{}", plan.level));
    stem.with_extension("quarantine.json")
}

fn test_candidate_quarantine_root(root: &Path, plan: &CommunityArtPlan) -> PathBuf {
    root.join("community-art-candidate-quarantine")
        .join(&plan.subject_kind)
        .join(plan.subject_id.to_string())
        .join(format!("level-{}", plan.level))
}

#[test]
fn funded_generation_retries_reuse_the_journaled_frozen_plan() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Frozen Plan Patron",
    );
    let original = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("initial actor plan");
    fund_test_community_art(&mut runtime, 5000, &original, "frozen-plan", 8801);
    runtime
        .apply_begin_community_art_generation_projection(
            5000,
            "actor",
            5000,
            1,
            true,
            original.generation_profile_version,
            &original.generation_policy,
            Some(&original),
        )
        .expect("begin generation freezes the plan");

    runtime.callings.insert(
        5000,
        CallingState {
            actor_id: 5000,
            statement: "I now carry changing world details.".to_string(),
            source_event_seq: Some(8802),
        },
    );
    runtime.world.next_event_seq = runtime.world.next_event_seq.saturating_add(50);
    let retry = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("retry plan");
    assert_eq!(retry.prompt, original.prompt);
    assert_eq!(retry.history_through_seq, original.history_through_seq);
    assert_eq!(
        community_art_media_brief(&retry).digest().unwrap(),
        community_art_media_brief(&original).digest().unwrap()
    );

    let restored: BTreeMap<String, CommunityArtGenerationState> =
        serde_json::from_slice(&serde_json::to_vec(&runtime.community_art_generations).unwrap())
            .unwrap();
    assert!(restored[&community_art_generation_key("actor", 5000, 1)]
        .frozen_plan
        .is_some());
}

#[test]
fn policy_preflight_fixture_is_a_real_sized_png() {
    let encoded = POLICY_PREFLIGHT_IMAGE_URL
        .strip_prefix("data:image/png;base64,")
        .expect("preflight fixture is an inline PNG");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("preflight fixture decodes");
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(&bytes[12..16], b"IHDR");
    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 64);
    assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 64);
}

#[test]
fn funded_avatar_generation_is_selected_for_boot_resumption() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Restarted Art Patron",
    );
    let plan = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("active patron can fund their visible avatar");
    fund_test_community_art(
        &mut runtime,
        5000,
        &plan,
        "test-boot-community-art-resumption",
        9001,
    );
    let key = community_art_generation_key("actor", 5000, plan.level);
    let generation = runtime
        .community_art_generations
        .get_mut(&key)
        .expect("funded avatar generation");
    generation.status = "generating".to_string();
    generation.provider_attempts = 1;

    let asset_root = std::env::temp_dir().join(format!(
        "cosyworld-community-art-resume-{}-{}",
        std::process::id(),
        now_seed()
    ));
    std::fs::create_dir_all(&asset_root).expect("create temporary generated-asset root");
    let resumptions = pending_community_art_resumption_plans(&runtime, &asset_root);
    assert_eq!(resumptions.len(), 1);
    assert_eq!(resumptions[0].0, 5000);
    assert_eq!(resumptions[0].1.subject_kind, "actor");
    assert_eq!(resumptions[0].1.subject_id, 5000);

    let generation = runtime
        .community_art_generations
        .get_mut(&key)
        .expect("stale-brief generation");
    generation.status = "policy_rejected".to_string();
    generation.last_error_code = Some("community_art_policy_rejected".to_string());
    assert_eq!(
        pending_community_art_resumption_plans(&runtime, &asset_root).len(),
        1,
        "the durable budget worker resumes a retryable policy rejection on boot"
    );

    let generation = runtime
        .community_art_generations
        .get_mut(&key)
        .expect("stale-brief generation");
    generation.status = "failed".to_string();
    generation.last_error_code = Some("community_art_storage_failed".to_string());
    let stale_brief_resumptions = pending_community_art_resumption_plans(&runtime, &asset_root);
    assert_eq!(
        stale_brief_resumptions.len(),
        1,
        "a legacy frozen-brief failure is repaired automatically on boot"
    );
    let _ = std::fs::remove_dir_all(asset_root);
}

#[test]
fn a_fully_funded_rejected_avatar_without_a_level_description_resumes_at_the_persona_stage() {
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Recovered Persona",
    );
    let plan = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("the undescribed avatar can fill its Orb slot");
    fund_test_community_art(&mut runtime, 5000, &plan, "rejected-persona-recovery", 9002);
    let generation = runtime
        .community_art_generations
        .get_mut(&community_art_generation_key("actor", 5000, 1))
        .expect("funded avatar generation");
    generation.status = "policy_rejected".to_string();
    generation.provider_attempts = MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS;
    generation.last_error_code = Some("community_art_policy_rejected".to_string());

    let asset_root = std::env::temp_dir().join(format!(
        "cosyworld-community-art-persona-resume-{}-{}",
        std::process::id(),
        now_seed()
    ));
    std::fs::create_dir_all(&asset_root).expect("create generated-asset root");
    let resumptions = pending_community_art_resumption_plans(&runtime, &asset_root);
    assert_eq!(resumptions.len(), 1);
    assert_eq!(resumptions[0].1.subject_kind, "actor");
    assert_eq!(resumptions[0].1.subject_id, 5000);
    assert!(runtime.avatar_requires_self_description(5000, 1));
    let _ = std::fs::remove_dir_all(asset_root);
}

#[test]
fn a_funded_avatar_recovers_its_description_without_the_old_contributor_nearby() {
    let mut runtime = RuntimeWorld::seeded();
    crate::test_support::create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Portrait Subject",
    );
    create_test_human(
        &mut runtime,
        5001,
        COSY_COTTAGE_LOCATION_ID,
        "Departed Patron",
    );
    let plan = runtime
        .community_art_plan(5001, "actor", 5000)
        .expect("a nearby patron can fund the undescribed avatar");
    fund_test_community_art(&mut runtime, 5001, &plan, "detached-persona-recovery", 9003);
    let patron_index = runtime.world.actors[..runtime.world.actor_count]
        .iter()
        .position(|actor| actor.id == 5001)
        .expect("patron exists");
    runtime.world.actors[patron_index].location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
    runtime.world.actors[patron_index].status = CW_ACTOR_KNOCKED_OUT;

    assert_eq!(
        pending_avatar_self_description_actor_ids(&runtime),
        vec![5000],
        "the subject owns persona recovery even after the patron leaves"
    );
    let asset_root = std::env::temp_dir().join(format!(
        "cosyworld-community-art-detached-persona-{}-{}",
        std::process::id(),
        now_seed()
    ));
    std::fs::create_dir_all(&asset_root).expect("create generated-asset root");
    assert!(
        pending_community_art_resumption_plans(&runtime, &asset_root).is_empty(),
        "image-plan recovery still requires a visible contributor"
    );
    let _ = std::fs::remove_dir_all(asset_root);
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
    assert_eq!(
        response.error_code.as_deref(),
        Some("community_art_reviewer_unavailable")
    );
    assert!(response.events.is_empty());
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("location", waypoint_id, 1)));
}

#[tokio::test]
async fn actor_and_item_funding_fail_before_debit_without_publication_reviewer() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-art-preflight-ledger-{nonce}.sqlite"));
    let generated_dir =
        std::env::temp_dir().join(format!("cosyworld-art-preflight-assets-{nonce}"));
    let _ = fs::remove_file(&event_store_path);
    let _ = fs::remove_dir_all(&generated_dir);

    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Universal Preflight Patron",
    );
    let item = runtime.world.items[..runtime.world.item_count]
        .iter_mut()
        .find(|item| item.id == 8403)
        .expect("pending-art item is mounted");
    item.holder_actor_id = 5000;
    item.location_id = 0;

    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    assert!(state.ai_config.as_ref().is_none());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    for (subject_kind, subject_id) in [("actor", 5000), ("item", 8403)] {
        let response = fund_community_image(
            ConnectInfo("127.0.0.1:44994".parse().expect("client address")),
            State(state.clone()),
            Json(FundCommunityImageRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
                subject_kind: subject_kind.to_string(),
                subject_id,
                intent_id: format!("test-{subject_kind}-reviewer-unavailable"),
            }),
        )
        .await
        .0;

        assert!(!response.ok, "{subject_kind} funding must fail closed");
        assert_eq!(response.status, 503);
        assert_eq!(
            response.error_code.as_deref(),
            Some("community_art_reviewer_unavailable")
        );
        assert!(response.events.is_empty());
    }

    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("actor", 5000, 1)));
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("item", 8403, 1)));
    drop(runtime);

    let conn = open_event_store(&event_store_path).expect("open preflight usage ledger");
    let failures: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ai_usage_ledger
             WHERE feature = 'community_image_publication_preflight'
               AND status = 'failed'
               AND orb_delta = 0
               AND error_code = 'community_art_reviewer_unavailable'",
            [],
            |row| row.get(0),
        )
        .expect("count typed publication-preflight failures");
    assert_eq!(failures, 2);

    let _ = fs::remove_dir_all(generated_dir);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn full_funding_atomically_enqueues_one_durable_media_job() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-art-media-job-{nonce}.sqlite"));
    let generated_dir =
        std::env::temp_dir().join(format!("cosyworld-art-media-job-assets-{nonce}"));
    let _ = fs::remove_file(&event_store_path);
    let _ = fs::remove_dir_all(&generated_dir);

    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Queued Art Patron",
    );
    let item = runtime.world.items[..runtime.world.item_count]
        .iter_mut()
        .find(|item| item.id == 8403)
        .expect("pending-art item is mounted");
    item.holder_actor_id = 5000;
    item.location_id = 0;
    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "unused-by-local-enqueue".to_string(),
        base_url: "http://127.0.0.1:1".to_string(),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44990".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "item".to_string(),
            subject_id: 8403,
            intent_id: "test-atomic-media-job".to_string(),
        }),
    )
    .await
    .0;

    assert!(response.ok, "full funding should be accepted: {response:?}");
    let funded_event = response
        .events
        .iter()
        .find(|event| event.type_name == "community_art.funded")
        .expect("funding event is committed");
    let conn = open_event_store(&event_store_path).expect("open durable media queue");
    let (jobs, source_event_seq, status): (i64, Option<i64>, String) = conn
        .query_row(
            "SELECT COUNT(*), MAX(source_event_seq), MIN(status) FROM media_jobs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("read enqueued media job");
    assert_eq!(jobs, 1);
    assert_eq!(source_event_seq, Some(funded_event.seq as i64));
    assert_eq!(status, "pending");
    let debits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orb_ledger
             WHERE reason = 'community_image_generation' AND delta = -1",
            [],
            |row| row.get(0),
        )
        .expect("read matching Orb debit");
    assert_eq!(debits, 1);

    let _ = fs::remove_dir_all(generated_dir);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn candidate_storage_preflight_fails_before_orb_debit() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let generated_root =
        std::env::temp_dir().join(format!("cosyworld-unwritable-art-root-{nonce}"));
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-storage-preflight-{nonce}.sqlite"));
    let _ = fs::remove_file(&generated_root);
    let _ = fs::remove_file(&event_store_path);
    fs::write(
        &generated_root,
        b"this file blocks generated-media directories",
    )
    .expect("create blocked generated-media root");

    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Storage Preflight Patron",
    );
    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: "http://127.0.0.1:1".to_string(),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    state.generated_asset_dir = Arc::new(generated_root.clone());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44997".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            intent_id: "test-storage-preflight".to_string(),
        }),
    )
    .await
    .0;

    assert!(!response.ok);
    assert_eq!(response.status, 503);
    assert_eq!(
        response.error_code.as_deref(),
        Some("community_art_storage_failed")
    );
    assert!(response.events.is_empty());
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("actor", 5000, 1)));
    drop(runtime);

    let conn = open_event_store(&event_store_path).expect("open storage-preflight ledger");
    let failures: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ai_usage_ledger
             WHERE feature = 'community_image_publication_preflight'
               AND error_code = 'community_art_storage_failed'
               AND orb_delta = 0",
            [],
            |row| row.get(0),
        )
        .expect("count typed storage-preflight failure");
    assert_eq!(failures, 1);

    let _ = fs::remove_file(generated_root);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn incomplete_candidate_quarantine_fails_before_orb_debit() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let generated_dir =
        std::env::temp_dir().join(format!("cosyworld-quarantine-preflight-assets-{nonce}"));
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-quarantine-preflight-{nonce}.sqlite"));
    let _ = fs::remove_dir_all(&generated_dir);
    let _ = fs::remove_file(&event_store_path);

    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Quarantine Preflight Patron",
    );
    let plan = runtime
        .community_art_plan(5000, "actor", 5000)
        .expect("visible avatar has a community-art plan");
    let marker = test_candidate_quarantine_marker(&generated_dir, &plan);
    fs::create_dir_all(marker.parent().expect("quarantine marker parent"))
        .expect("create candidate directory");
    fs::write(&marker, b"incomplete quarantine transaction")
        .expect("stage incomplete quarantine marker");

    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: "http://127.0.0.1:1".to_string(),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44998".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            intent_id: "test-quarantine-preflight".to_string(),
        }),
    )
    .await
    .0;

    assert!(!response.ok);
    assert_eq!(response.status, 503);
    assert_eq!(
        response.error_code.as_deref(),
        Some(COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE)
    );
    assert!(response.events.is_empty());
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS);
    assert!(!runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("actor", 5000, 1)));
    drop(runtime);

    let conn = open_event_store(&event_store_path).expect("open quarantine-preflight ledger");
    let failures: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ai_usage_ledger
             WHERE feature = 'community_image_publication_preflight'
               AND error_code = 'community_art_candidate_quarantine_failed'
               AND orb_delta = 0",
            [],
            |row| row.get(0),
        )
        .expect("count typed quarantine-preflight failure");
    assert_eq!(failures, 1);

    let _ = fs::remove_dir_all(generated_dir);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn concurrent_location_funding_coalesces_without_paid_policy_preflight() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Two Tab Patron",
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
    let mut discovery = JournalRecord::new(search, 7050);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];

    let policy_requests = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let policy_requests = policy_requests.clone();
            move || {
                let policy_requests = policy_requests.clone();
                async move {
                    policy_requests.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Json(serde_json::json!({
                        "choices": [{
                            "message": {
                                "content": r#"{"allowed":true,"violations":[],"summary":"Known-safe preflight accepted."}"#
                            }
                        }]
                    }))
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind coalesced policy preflight fixture");
    let address = listener
        .local_addr()
        .expect("coalesced policy preflight address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    let (actor_session, _) = issue_actor_session(&state, 5000);
    let request = |intent_id: &str| {
        fund_community_image(
            ConnectInfo("127.0.0.1:44993".parse().expect("client address")),
            State(state.clone()),
            Json(FundCommunityImageRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
                subject_kind: "location".to_string(),
                subject_id: waypoint_id,
                intent_id: intent_id.to_string(),
            }),
        )
    };

    let (first, second) = tokio::join!(
        request("test-location-two-tabs-a"),
        request("test-location-two-tabs-b")
    );
    let first = first.0;
    let second = second.0;
    assert!(first.ok && second.ok, "{first:?} {second:?}");
    assert_eq!(
        first
            .events
            .iter()
            .chain(second.events.iter())
            .filter(|event| event.type_name == "community_art.funded")
            .count(),
        1
    );
    assert_eq!(
        policy_requests.load(Ordering::SeqCst),
        0,
        "funding only performs local validation; paid review belongs to the worker"
    );

    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS - 1);
    let generation = &runtime.community_art_generations
        [&community_art_generation_key("location", waypoint_id, 1)];
    assert_eq!(generation.funded_orbs, 1);
    assert_eq!(generation.funding_intent_ids.len(), 1);
    drop(runtime);
    server.abort();
}

#[tokio::test]
async fn item_funding_reaches_reviewed_publication_without_a_second_orb_debit() {
    let review_requests = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let review_requests = review_requests.clone();
            move |Json(body): Json<serde_json::Value>| {
                let review_requests = review_requests.clone();
                async move {
                    review_requests.fetch_add(1, Ordering::SeqCst);
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    assert!(image_url.starts_with("data:image/png;base64,"));
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    Json(serde_json::json!({
                        "choices": [{
                            "message": {
                                "content": r#"{"allowed":true,"violations":[],"summary":"The item candidate satisfies the frozen publication brief."}"#
                            }
                        }]
                    }))
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind item publication reviewer");
    let address = listener.local_addr().expect("item reviewer address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-item-publication-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Item Art Patron",
    );
    let item = runtime.world.items[..runtime.world.item_count]
        .iter_mut()
        .find(|item| item.id == 8403)
        .expect("pending-art item is mounted");
    item.holder_actor_id = 5000;
    item.location_id = 0;
    let plan = runtime
        .community_art_plan(5000, "item", 8403)
        .expect("held pending-art item can be funded");
    let candidate_bytes = square_gate_png();
    let prediction_id = "saved-item-candidate";
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: candidate_bytes.clone(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/item-candidate.png".to_string(),
            prediction_id: Some(prediction_id.to_string()),
        },
    )
    .expect("store paid item candidate before funding recovery");

    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44995".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "item".to_string(),
            subject_id: 8403,
            intent_id: "test-item-reviewed-publication".to_string(),
        }),
    )
    .await
    .0;

    assert!(response.ok, "item funding should be accepted: {response:?}");
    assert_eq!(response.status, CW_OK);
    assert!(response.error_code.is_none());
    assert_eq!(
        response
            .events
            .iter()
            .filter(|event| event.type_name == "community_art.funded")
            .count(),
        1
    );

    let key = community_art_generation_key("item", 8403, 1);
    let generation = wait_for_community_art_status(&state, &key, "ready").await;
    assert_eq!(generation.funded_orbs, 1);
    assert_eq!(generation.provider_attempts, 0);
    assert_eq!(
        generation.last_prediction_id.as_deref(),
        Some(prediction_id)
    );
    assert_eq!(review_requests.load(Ordering::SeqCst), 1);
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS - 1);
    drop(runtime);

    let mut canonical = None;
    for _ in 0..100 {
        canonical = canonical_community_media_asset_bytes(
            &generated_dir,
            "item",
            8403,
            1,
            Some(prediction_id),
        )
        .ok();
        if canonical.is_some() && !community_art_candidate_exists(&generated_dir, &plan) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let (published_bytes, published_type) = canonical.expect("item asset becomes canonical");
    assert_eq!(published_bytes, candidate_bytes);
    assert_eq!(published_type, "image/png");
    assert!(!community_art_candidate_exists(&generated_dir, &plan));

    let record_id = format!("{:x}", Sha256::digest(key.as_bytes()));
    let verdict: serde_json::Value = serde_json::from_slice(
        &fs::read(
            generated_dir
                .join("media-verdicts/v1")
                .join(record_id)
                .join("record.json"),
        )
        .expect("read persisted item verdict"),
    )
    .expect("parse persisted item verdict");
    assert!(
        verdict["candidates"][0]["visual"]["latency_ms"]
            .as_u64()
            .is_some_and(|latency| latency > 0),
        "review latency must survive into the verdict audit"
    );

    let _ = fs::remove_dir_all(generated_dir);
    server.abort();
}

#[tokio::test]
async fn evolution_endpoint_freezes_prior_and_pools_without_extra_orb_or_turn() {
    let app = Router::new().route(
        "/chat/completions",
        post(|| async {
            Json(serde_json::json!({
                "choices": [{
                    "message": {
                        "content": r#"{"allowed":true,"violations":[],"summary":"Known-safe publication preflight accepted."}"#
                    }
                }]
            }))
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind evolution publication preflight fixture");
    let address = listener
        .local_addr()
        .expect("evolution publication preflight address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Art Patron");
    runtime.world.actors[..runtime.world.actor_count]
        .iter_mut()
        .find(|actor| actor.id == 5000)
        .expect("test avatar exists")
        .stats
        .level = 2;
    runtime
        .entity_memories
        .entry(WorldEntityRef::avatar(5000).key())
        .or_default()
        .identity_by_level
        .insert(
            2,
            AvatarLevelIdentity {
                appearance: "Copper curls threaded with silver, a steadier gaze, and a deep green travel coat."
                    .to_string(),
                ..AvatarLevelIdentity::default()
            },
        );
    let before_tick = runtime.world.tick;
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-evolution-endpoint-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let mut state = test_app_state(runtime, None);
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    let prior_bytes = BASE64_STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XqgWAAAAAElFTkSuQmCC")
        .expect("decode prior-level PNG");
    let prior_prediction = "prior-level-prediction";
    let prior_asset = register_generated_media_asset(
        &state.generated_asset_dir,
        "actor",
        5000,
        1,
        &prior_bytes,
        "image/png",
        MediaAssetProvenance {
            pack_id: "cosyworld.core".to_string(),
            pack_version: "1.0.0".to_string(),
            composition_id: "community-art:actor:5000:level:1".to_string(),
            composition_revision: "1".to_string(),
            provider: "replicate".to_string(),
            model: "black-forest-labs/flux-dev-lora".to_string(),
            model_version: "pinned-flux1".to_string(),
            prompt_version: "community-art/3".to_string(),
            prediction_id: Some(prior_prediction.to_string()),
            source_event_seq: Some(1),
            history_through_seq: 1,
            ..MediaAssetProvenance::default()
        },
    )
    .expect("stage prior-level asset");
    assert!(reconcile_community_media_asset_status(
        &state.generated_asset_dir,
        "actor",
        5000,
        1,
        "ready",
        Some(prior_prediction),
        Some(2),
    )
    .expect("approve prior-level asset"));
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let fund = |session: String, intent_id: &str| {
        fund_community_image(
            ConnectInfo("127.0.0.1:44991".parse().expect("client address")),
            State(state.clone()),
            Json(FundCommunityImageRequest {
                actor_id: 5000,
                actor_session: Some(session),
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                intent_id: intent_id.to_string(),
            }),
        )
    };
    let response = fund(actor_session.clone(), "test-community-endpoint-1")
        .await
        .0;
    assert!(
        response.ok,
        "evolution funding should be accepted: {response:?}"
    );
    assert!(response
        .events
        .iter()
        .any(|event| event.type_name == "community_art.funded"));
    let duplicate = fund(actor_session.clone(), "test-community-endpoint-1")
        .await
        .0;
    assert!(duplicate.ok);
    assert!(duplicate.events.is_empty());
    let repeated_contributor = fund(actor_session, "test-community-endpoint-2").await.0;
    assert!(
        repeated_contributor.ok,
        "one patron with enough Orbs may complete the pool: {repeated_contributor:?}"
    );
    assert!(repeated_contributor
        .events
        .iter()
        .any(|event| event.type_name == "community_art.funded"));

    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS - 2);
    assert_eq!(runtime.world.tick, before_tick);
    let generation =
        &runtime.community_art_generations[&community_art_generation_key("actor", 5000, 2)];
    assert_eq!(generation.funded_orbs, 2);
    assert_eq!(generation.required_orbs, 2);
    assert_eq!(generation.contributions.get(&5000), Some(&2));
    assert_ne!(generation.status, "funding");
    let evolution = generation
        .evolution_job
        .as_ref()
        .expect("evolution job is durably frozen on first funding");
    assert_eq!(evolution.prior_asset_id, prior_asset);
    assert_eq!(
        evolution.prior_asset_digest,
        format!("{:x}", Sha256::digest(&prior_bytes))
    );
    let _ = fs::remove_dir_all(generated_dir);
    server.abort();
}

#[tokio::test]
async fn community_art_preflight_uses_the_frozen_publication_policy_with_a_safe_fixture() {
    let capability_contract_seen = Arc::new(AtomicBool::new(false));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let capability_contract_seen = capability_contract_seen.clone();
            move |Json(body): Json<serde_json::Value>| {
                let capability_contract_seen = capability_contract_seen.clone();
                async move {
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let review = body
                        .pointer("/messages/1/content/0/text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    capability_contract_seen.store(
                        body.get("model").and_then(serde_json::Value::as_str)
                            == Some("test-vision-model")
                            && body
                                .pointer("/response_format/json_schema/name")
                                .and_then(serde_json::Value::as_str)
                                == Some("cosyworld_image_policy")
                            && image_url == POLICY_PREFLIGHT_IMAGE_URL
                            && review.contains("uniform solid-green square")
                            && review.contains("Production policy:")
                            && review.contains("Publish only a landscape")
                            && review.contains("Foxglove Turn"),
                        Ordering::SeqCst,
                    );
                    Json(serde_json::json!({
                        "choices": [{
                            "message": {
                                "content": r#"{"allowed":true,"violations":[],"summary":"The known-safe capability fixture matches."}"#
                            }
                        }]
                    }))
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind successful policy preflight fixture");
    let address = listener
        .local_addr()
        .expect("successful policy preflight address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let config = AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    };

    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-community-art-capability-preflight-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let plan = location_art_plan(181_727, "16:9", "chalk lanes and reed beds");
    let mut stale_plan = plan.clone();
    stale_plan.generation_profile_version = plan.generation_profile_version.saturating_sub(1);
    let stale_brief = community_art_media_brief(&stale_plan);
    record_media_provider_failure(&generated_dir, stale_brief.clone(), "primary")
        .expect("persist obsolete provider-failure record");
    preflight_community_art_funding(&test_art_config(), Some(&config), &generated_dir, &plan)
        .await
        .expect("known-safe preflight migrates the obsolete record and is accepted");

    assert!(capability_contract_seen.load(Ordering::SeqCst));
    let retired = generated_dir
        .join("media-verdicts/v1")
        .join(format!(
            "{:x}",
            Sha256::digest(stale_brief.job_key.as_bytes())
        ))
        .join("retired")
        .join(format!("{}.json", stale_brief.digest().unwrap()));
    assert!(retired.is_file(), "obsolete frozen brief remains auditable");
    let _ = fs::remove_dir_all(generated_dir);
    server.abort();
}

#[test]
fn location_generation_replaces_portrait_prompt_without_disabling_the_style_lora() {
    let mut config = test_art_config();
    config.prompt_prefix = "MRQ, cozy storybook trading-card portrait".to_string();
    config.lora_url = Some("immanencer/mirquo".to_string());
    let history = community_art_prompt_history(
        "location",
        &[
            "a newly opened path cuts through the chalk".to_string(),
            "river stones show recent careful tending".to_string(),
        ],
    );
    let plan = CommunityArtPlan {
        subject_kind: "location".to_string(),
        subject_id: 181_730,
        level: 1,
        generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        history_through_seq: 99,
        prompt: build_community_art_prompt(
            "location",
            "Quiet Rise",
            "Newly Found Path",
            "Chalky lanes meet a reed-fringed river.",
            1,
            "chalky lanes, reed beds, river stones",
            &history,
            Some(CommunityArtImagePolicy::LocationLandscape),
        ),
        aspect_ratio: "16:9".to_string(),
        image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
        persisted_identity: "Quiet Rise".to_string(),
        persisted_visual_description: "chalky lanes and reed beds".to_string(),
        stable_traits: vec!["chalky lanes".to_string()],
        public_history: Vec::new(),
        evolution_job: None,
    };

    let prompt = community_art_generation_request(&config, &plan);

    assert!(prompt.starts_with(LOCATION_LANDSCAPE_PROMPT_PREFIX));
    assert!(!prompt.contains("trading-card portrait"));
    for publication_guardrail in [
        "uninhabited environment",
        "No people",
        "animals",
        "creatures",
        "signatures",
        "artist marks",
        "watermarks",
    ] {
        assert!(
            prompt.contains(publication_guardrail),
            "missing {publication_guardrail}: {prompt}"
        );
    }
    for portrait_leak in [
        "Collectible card art",
        "titled",
        "Mara Bramblebrook",
        "chalk in my boots",
    ] {
        assert!(!prompt.contains(portrait_leak), "{portrait_leak}: {prompt}");
    }
    assert_eq!(config.lora_url.as_deref(), Some("immanencer/mirquo"));
}

#[tokio::test]
async fn location_funding_does_not_call_the_paid_policy_reviewer_inline() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        RAIN_SOFT_GARDEN_LOCATION_ID,
        "Preflight Patron",
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
    let mut discovery = JournalRecord::new(search, 7054);
    discovery.projection_mutations.push(mutation);
    assert_eq!(runtime.apply_journal_record(&discovery).0, CW_OK);
    let waypoint_id = runtime.journeys[&5000].path[1];

    let policy_requests = Arc::new(AtomicUsize::new(0));
    let preflight_shape_seen = Arc::new(AtomicBool::new(false));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let policy_requests = policy_requests.clone();
            let preflight_shape_seen = preflight_shape_seen.clone();
            move |Json(body): Json<serde_json::Value>| {
                let policy_requests = policy_requests.clone();
                let preflight_shape_seen = preflight_shape_seen.clone();
                async move {
                    policy_requests.fetch_add(1, Ordering::SeqCst);
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    preflight_shape_seen.store(
                        body.get("model").and_then(serde_json::Value::as_str)
                            == Some("test-vision-model")
                            && body
                                .pointer("/response_format/json_schema/name")
                                .and_then(serde_json::Value::as_str)
                                == Some("cosyworld_image_policy")
                            && image_url.starts_with("data:image/png;base64,"),
                        Ordering::SeqCst,
                    );
                    (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({
                            "error": {
                                "message": "configured model cannot combine image_url and json_schema"
                            }
                        })),
                    )
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind policy preflight fixture");
    let address = listener.local_addr().expect("policy preflight address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.ai_config = Arc::new(Some(AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    }));
    let (actor_session, _) = issue_actor_session(&state, 5000);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44992".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id: 5000,
            actor_session: Some(actor_session),
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            intent_id: "test-location-policy-400".to_string(),
        }),
    )
    .await
    .0;

    assert!(response.ok);
    assert_eq!(response.status, CW_OK);
    assert_eq!(
        response
            .events
            .iter()
            .filter(|event| event.type_name == "community_art.funded")
            .count(),
        1
    );
    assert_eq!(policy_requests.load(Ordering::SeqCst), 0);
    assert!(!preflight_shape_seen.load(Ordering::SeqCst));
    let runtime = state.inner.lock().await;
    assert_eq!(runtime.orb_balance(5000), STARTING_ORBS - 1);
    assert!(runtime
        .community_art_generations
        .contains_key(&community_art_generation_key("location", waypoint_id, 1)));
    drop(runtime);
    assert!(!community_art_candidate_exists(
        &state.generated_asset_dir,
        &CommunityArtPlan {
            subject_kind: "location".to_string(),
            subject_id: waypoint_id,
            level: 1,
            generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
            generation_policy: GeneratedPolicyBinding::default(),
            required_orbs: 1,
            history_through_seq: 0,
            prompt: String::new(),
            aspect_ratio: "16:9".to_string(),
            image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
            persisted_identity: "test location".to_string(),
            persisted_visual_description: "test landscape".to_string(),
            stable_traits: vec!["test landscape".to_string()],
            public_history: Vec::new(),
            evolution_job: None,
        }
    ));
    server.abort();
}

#[tokio::test]
async fn policy_retry_reuses_the_saved_candidate_without_calling_replicate() {
    let policy_requests = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/chat/completions",
        post({
            let policy_requests = policy_requests.clone();
            move |Json(body): Json<serde_json::Value>| {
                let policy_requests = policy_requests.clone();
                async move {
                    let image_url = body
                        .pointer("/messages/1/content/1/image_url/url")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    assert!(image_url.starts_with("data:image/png;base64,"));
                    if policy_requests.fetch_add(1, Ordering::SeqCst) == 0 {
                        return Json(serde_json::json!({
                            "choices": [{
                                "message": { "content": "temporary malformed verdict" }
                            }]
                        }))
                        .into_response();
                    }
                    Json(serde_json::json!({
                        "choices": [{
                            "message": {
                                "content": r#"{"allowed":true,"violations":[],"summary":"An empty landscape contains no forbidden subjects."}"#
                            }
                        }]
                    }))
                    .into_response()
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind retained candidate fixture");
    let address = listener.local_addr().expect("retained candidate address");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-retained-candidate-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let plan = CommunityArtPlan {
        subject_kind: "location".to_string(),
        subject_id: 181_728,
        level: 1,
        generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 1,
        history_through_seq: 99,
        prompt: "A quiet rain-soft path with no figures.".to_string(),
        aspect_ratio: "16:9".to_string(),
        image_policy: Some(CommunityArtImagePolicy::LocationLandscape),
        persisted_identity: "Quiet Rise".to_string(),
        persisted_visual_description: "rain-soft path".to_string(),
        stable_traits: vec!["rain-soft path".to_string()],
        public_history: Vec::new(),
        evolution_job: None,
    };
    let image_bytes = gate_png();
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: image_bytes.clone(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/test.png".to_string(),
            prediction_id: Some("prediction-retained-1".to_string()),
        },
    )
    .expect("persist candidate before review");
    let policy_config = AiConfig {
        api_key: "test".to_string(),
        base_url: format!("http://{address}"),
        model: "test-model".to_string(),
        vision_model: "test-vision-model".to_string(),
        reasoning_effort: None,
        vision_reasoning_effort: None,
        ..AiConfig::default()
    };

    let first = generate_and_store_community_art(
        &test_art_config(),
        Some(&policy_config),
        &generated_dir,
        &plan,
    )
    .await;
    assert!(first.reused_candidate);
    assert!(
        first.provider_executions.is_empty(),
        "reviewing a saved candidate does not execute Replicate"
    );
    assert_eq!(
        first.prediction_id.as_deref(),
        Some("prediction-retained-1")
    );
    assert!(matches!(
        first.result,
        Err(CommunityArtGenerationError::PolicyReview(_))
    ));
    assert!(community_art_candidate_exists(&generated_dir, &plan));
    assert!(!stored_community_art_image_path(&generated_dir, "location", plan.subject_id).exists());

    let second = generate_and_store_community_art(
        &test_art_config(),
        Some(&policy_config),
        &generated_dir,
        &plan,
    )
    .await;
    assert!(second.reused_candidate);
    assert!(
        second.provider_executions.is_empty(),
        "the successful review retry still does not execute Replicate"
    );
    assert!(second.result.is_ok());
    assert!(
        second.asset_id.is_some(),
        "publication stages an immutable asset before the ready journal transition"
    );
    assert_eq!(policy_requests.load(Ordering::SeqCst), 2);
    assert_eq!(
        fs::read(stored_community_art_image_path(
            &generated_dir,
            "location",
            plan.subject_id
        ))
        .expect("read published retained candidate"),
        image_bytes
    );

    remove_community_art_candidate(&generated_dir, &plan).expect("remove retained fixture");
    let _ = fs::remove_dir_all(generated_dir);
    server.abort();
}

#[test]
fn rollback_and_incumbent_routes_quarantine_a_stored_canary_before_publication() {
    let frozen = FrozenCommunityArtEvolutionJob::freeze(
        "actor",
        5000,
        "Rollback Patron",
        "a rust-red fox with a green scarf",
        vec!["green scarf".to_string(), "rust-red fur".to_string()],
        &[PublicArtHistoryEvent {
            seq: 72,
            summary: "The patron planted a public moonflower.".to_string(),
        }],
        1,
        "media-prior-level".to_string(),
        "a".repeat(64),
        "image/png".to_string(),
        70,
        72,
        2,
        1,
        "2:3",
    )
    .expect("freeze rollback fixture");
    let plan = CommunityArtPlan {
        subject_kind: "actor".to_string(),
        subject_id: 5000,
        level: 2,
        generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
        generation_policy: GeneratedPolicyBinding::default(),
        required_orbs: 2,
        history_through_seq: 72,
        prompt: "incumbent prompt".to_string(),
        aspect_ratio: "2:3".to_string(),
        image_policy: None,
        persisted_identity: "Rollback Patron".to_string(),
        persisted_visual_description: "a rust-red fox with a green scarf".to_string(),
        stable_traits: vec!["green scarf".to_string(), "rust-red fur".to_string()],
        public_history: vec![PublicArtHistoryEvent {
            seq: 72,
            summary: "The patron planted a public moonflower.".to_string(),
        }],
        evolution_job: Some(frozen),
    };
    let prior = DownloadedReplicateImage {
        bytes: b"prior-approved-incumbent".to_vec(),
        content_type: "image/png".to_string(),
        source_url: "https://replicate.delivery/pbxt/prior.png".to_string(),
        prediction_id: Some("prior-approved".to_string()),
    };
    let canary = DownloadedReplicateImage {
        bytes: b"unapproved-flux2-canary".to_vec(),
        content_type: "image/png".to_string(),
        source_url: "https://replicate.delivery/pbxt/canary.png".to_string(),
        prediction_id: Some("canary-pending-review".to_string()),
    };

    for (route, label) in [
        (
            EvolutionRolloutRoute::AutomaticRollback,
            "automatic-rollback",
        ),
        (EvolutionRolloutRoute::Incumbent, "incumbent"),
    ] {
        let generated_dir = std::env::temp_dir().join(format!(
            "cosyworld-route-candidate-{label}-{}-{}",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_dir_all(&generated_dir);
        store_community_art_image(&generated_dir, &plan, &prior).expect("store prior public image");
        store_community_art_candidate_with_route(&generated_dir, &plan, &canary, true)
            .expect("store pending canary candidate");

        assert!(
            load_route_compatible_community_art_candidate(&generated_dir, &plan, route)
                .expect("route compatibility check")
                .is_none(),
            "{label} must continue through incumbent generation"
        );
        assert!(!community_art_candidate_exists(&generated_dir, &plan));
        assert!(
            publish_community_art_candidate(&generated_dir, &plan).is_err(),
            "{label} cannot publish the quarantined canary"
        );
        assert_eq!(
            fs::read(stored_community_art_image_path(
                &generated_dir,
                "actor",
                plan.subject_id
            ))
            .expect("read unchanged public image"),
            prior.bytes
        );
        assert_eq!(
            fs::read(
                generated_dir
                    .join("media-evolution-shadow")
                    .join("actor")
                    .join(plan.subject_id.to_string())
                    .join("level-2.image")
            )
            .expect("read privately retained canary"),
            canary.bytes
        );
        let _ = fs::remove_dir_all(generated_dir);
    }
}

#[test]
fn provider_attempt_budget_is_journaled_and_survives_serialization() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Budget Patron",
    );
    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7055,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "test-provider-budget".to_string(),
            amount: 1,
            history_through_seq: 7055,
            evolution_job: None,
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);

    for attempt in 1..=MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7055 + u64::from(attempt),
        );
        record
            .projection_mutations
            .push(ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                provider_attempt: true,
                generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
                generation_policy: GeneratedPolicyBinding::default(),
                frozen_plan: None,
            });
        record
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                status: "failed".to_string(),
                prediction_id: Some(format!("prediction-{attempt}")),
                error_code: Some("community_art_generation_failed".to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    let key = community_art_generation_key("actor", 5000, 1);
    let generation = &runtime.community_art_generations[&key];
    assert_eq!(
        generation.provider_attempts,
        MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    );
    assert_eq!(
        generation.last_prediction_id.as_deref(),
        Some("prediction-3")
    );
    assert!(!community_art_generation_retryable(generation, false));

    let serialized =
        serde_json::to_string(&runtime.community_art_generations).expect("serialize art budget");
    let restored: BTreeMap<String, CommunityArtGenerationState> =
        serde_json::from_str(&serialized).expect("restore art budget");
    assert_eq!(
        restored[&key].provider_attempts,
        MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    );
    assert!(!community_art_generation_retryable(&restored[&key], false));
}

#[test]
fn failed_evolution_retries_charge_no_extra_orbs_and_keep_prior_art_public() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Evolving Patron",
    );
    runtime.world.actors[..runtime.world.actor_count]
        .iter_mut()
        .find(|actor| actor.id == 5000)
        .expect("evolving actor")
        .stats
        .level = 2;
    let frozen = FrozenCommunityArtEvolutionJob::freeze(
        "actor",
        5000,
        "Evolving Patron — World Traveler",
        "a rust-red fox with a green scarf",
        vec!["green scarf".to_string(), "rust-red fur".to_string()],
        &[PublicArtHistoryEvent {
            seq: 72,
            summary: "The patron planted a public moonflower.".to_string(),
        }],
        1,
        "media-prior-level".to_string(),
        "a".repeat(64),
        "image/png".to_string(),
        70,
        72,
        2,
        1,
        "2:3",
    )
    .expect("freeze test evolution");

    let mut prior = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        70,
    );
    prior
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "prior-level".to_string(),
            amount: 1,
            history_through_seq: 69,
            evolution_job: None,
        });
    prior
        .projection_mutations
        .push(ProjectionMutation::SetCommunityArtStatus {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 1,
            status: "ready".to_string(),
        });
    assert_eq!(runtime.apply_journal_record(&prior).0, CW_OK);

    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        72,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "actor".to_string(),
            subject_id: 5000,
            level: 2,
            required_orbs: 2,
            contributor_actor_id: 5000,
            intent_id: "evolution-level".to_string(),
            amount: 2,
            history_through_seq: 72,
            evolution_job: Some(frozen.clone()),
        });
    funding.orb_deltas.push(OrbDelta {
        actor_id: 5000,
        delta: -2,
        reason: "community_image_generation".to_string(),
    });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);
    let balance_after_funding = runtime.orb_balance(5000);

    for attempt in 1..=MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS {
        let mut failure = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            72 + u64::from(attempt),
        );
        failure
            .projection_mutations
            .push(ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 2,
                provider_attempt: true,
                generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
                generation_policy: GeneratedPolicyBinding::default(),
                frozen_plan: None,
            });
        failure
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 2,
                status: "failed".to_string(),
                prediction_id: Some(format!("flux2-failed-{attempt}")),
                error_code: Some("community_art_generation_failed".to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&failure).0, CW_OK);
        assert_eq!(runtime.orb_balance(5000), balance_after_funding);
    }

    let generation =
        &runtime.community_art_generations[&community_art_generation_key("actor", 5000, 2)];
    assert_eq!(generation.evolution_job.as_ref(), Some(&frozen));
    assert_eq!(generation.funded_orbs, 2);
    assert_eq!(generation.status, "failed");
    let card = &runtime
        .state_response(Some(5000), &AccessContext::default())
        .cards
        .actors[&5000];
    assert_eq!(
        card.image_url.as_deref(),
        Some("/assets/generated/community/actor/5000.image?level=1&revision=1")
    );
    let public_art = serde_json::to_value(
        card.community_art
            .as_ref()
            .expect("the public card keeps its Orb contract"),
    )
    .expect("serialize public Orb contract");
    for internal in [
        "status",
        "history_through_seq",
        "provider_attempts",
        "max_provider_attempts",
        "retryable_without_orbs",
        "appearance",
        "appearance_due",
        "appearance_required",
    ] {
        assert!(
            public_art.get(internal).is_none(),
            "public cards must not expose internal portrait field {internal}"
        );
    }
}

#[test]
fn newer_location_prompt_profile_reopens_a_paid_exhausted_job() {
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        5000,
        COSY_COTTAGE_LOCATION_ID,
        "Recovered Patron",
    );
    let subject_id = 181_730;
    let mut funding = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7060,
    );
    funding
        .projection_mutations
        .push(ProjectionMutation::FundCommunityArt {
            subject_kind: "location".to_string(),
            subject_id,
            level: 1,
            required_orbs: 1,
            contributor_actor_id: 5000,
            intent_id: "test-paid-location-recovery".to_string(),
            amount: 1,
            history_through_seq: 7060,
            evolution_job: None,
        });
    assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);

    let key = community_art_generation_key("location", subject_id, 1);
    runtime
        .community_art_generations
        .get_mut(&key)
        .expect("funded generation")
        .generation_profile_version = LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION;
    for attempt in 1..=MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7060 + u64::from(attempt),
        );
        record
            .projection_mutations
            .push(ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "location".to_string(),
                subject_id,
                level: 1,
                provider_attempt: true,
                generation_profile_version: LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION,
                generation_policy: runtime
                    .generated_pathway_for_location(subject_id)
                    .map(|pathway| pathway.generation_policy.clone())
                    .unwrap_or_default(),
                frozen_plan: None,
            });
        record
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "location".to_string(),
                subject_id,
                level: 1,
                status: "policy_rejected".to_string(),
                prediction_id: Some(format!("legacy-prediction-{attempt}")),
                error_code: Some("community_art_policy_rejected".to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    let exhausted = &runtime.community_art_generations[&key];
    assert_eq!(exhausted.funded_orbs, exhausted.required_orbs);
    assert_eq!(
        exhausted.provider_attempts,
        MAX_COMMUNITY_ART_PROVIDER_ATTEMPTS
    );
    assert!(!community_art_generation_retryable(exhausted, false));
    assert!(community_art_generation_retryable_for_profile(
        exhausted,
        false,
        LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION
    ));

    let mut retry = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        },
        7064,
    );
    retry
        .projection_mutations
        .push(ProjectionMutation::BeginCommunityArtGeneration {
            subject_kind: "location".to_string(),
            subject_id,
            level: 1,
            provider_attempt: true,
            generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
            generation_policy: runtime
                .generated_pathway_for_location(subject_id)
                .map(|pathway| pathway.generation_policy.clone())
                .unwrap_or_default(),
            frozen_plan: None,
        });
    assert_eq!(runtime.apply_journal_record(&retry).0, CW_OK);

    let recovered = &runtime.community_art_generations[&key];
    assert_eq!(
        recovered.generation_profile_version,
        LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION
    );
    assert_eq!(recovered.provider_attempts, 1);
    assert_eq!(recovered.funded_orbs, recovered.required_orbs);
    assert_eq!(recovered.status, "generating");
}

#[test]
fn legacy_begin_generation_journal_defaults_to_the_original_prompt_profile() {
    let mutation: ProjectionMutation = serde_json::from_value(serde_json::json!({
        "kind": "begin_community_art_generation",
        "subject_kind": "location",
        "subject_id": 181730,
        "level": 1,
        "provider_attempt": true
    }))
    .expect("legacy begin-generation journal remains readable");

    let ProjectionMutation::BeginCommunityArtGeneration {
        generation_profile_version,
        ..
    } = mutation
    else {
        panic!("legacy mutation retains its variant");
    };
    assert_eq!(
        generation_profile_version,
        LEGACY_COMMUNITY_ART_GENERATION_PROFILE_VERSION
    );
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
            evolution_job: None,
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
    runtime
        .community_art_generations
        .get_mut(&community_art_generation_key("location", waypoint_id, 1))
        .expect("ready community art generation")
        .last_prediction_id = Some("pathway-approved-prediction".to_string());
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
    let reviewed_bytes = base64::engine::general_purpose::STANDARD
        .decode(
            POLICY_PREFLIGHT_IMAGE_URL
                .strip_prefix("data:image/png;base64,")
                .expect("fixture prefix"),
        )
        .expect("decode reviewed PNG fixture");
    fs::write(&image_path, &reviewed_bytes).expect("write ready art fixture");
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

    let ready_asset = generated_community_art_asset(
        State(state.clone()),
        AxumPath(("location".to_string(), format!("{waypoint_id}.image"))),
        Query(BTreeMap::new()),
    )
    .await
    .into_response();
    assert_eq!(ready_asset.status(), StatusCode::OK);
    let immutable_object = fs::read_dir(generated_dir.join("media-assets/objects/sha256"))
        .expect("immutable object directory")
        .next()
        .expect("one immutable object")
        .expect("immutable object entry")
        .path();
    assert_eq!(
        fs::read(&immutable_object).expect("read immutable object"),
        reviewed_bytes
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
    assert!(
        immutable_object.exists(),
        "rejection removes mutable aliases but preserves immutable evidence"
    );
    let graph = fs::read_to_string(generated_dir.join("media-assets/graph-v1.json"))
        .expect("read immutable graph after rejection");
    assert!(graph.contains("\"state\": \"rejected\""));
    assert!(graph.contains("\"canonical\": {}"));

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
        Query(BTreeMap::new()),
    )
    .await
    .into_response();
    assert_eq!(rejected_asset.status(), StatusCode::NOT_FOUND);
    let _ = fs::remove_dir_all(generated_dir);
}

#[test]
fn location_brief_truncates_the_joined_stable_traits_instead_of_failing_validation() {
    assert_eq!(
        bounded_component(&"a".repeat(MEDIA_BRIEF_CONSTRAINT_LIMIT * 4)).len(),
        MEDIA_BRIEF_CONSTRAINT_LIMIT,
        "the shared component helper must bound to the budget the frozen-brief gate measures"
    );

    let plan = location_art_plan(157_216, "16:9", &long_reviewed_landscape_brief());

    // Production shape: every trait is individually bounded, so the reviewed
    // landscape brief lands exactly on the component budget and the join of all
    // four traits is unconditionally over it.
    assert!(
        plan.stable_traits
            .iter()
            .any(|value| value.len() == MEDIA_BRIEF_CONSTRAINT_LIMIT),
        "the reviewed landscape brief fills one whole component: {:?}",
        plan.stable_traits
    );
    assert!(
        plan.persisted_visual_description.len() > MEDIA_BRIEF_CONSTRAINT_LIMIT,
        "joined traits are {} bytes",
        plan.persisted_visual_description.len()
    );

    let brief = community_art_media_brief(&plan);
    brief
        .validate()
        .expect("a frozen brief built from an over-long trait join must still validate");

    let mut unbounded = brief.clone();
    unbounded.required_environment = vec![
        plan.persisted_identity.clone(),
        plan.persisted_visual_description.clone(),
    ];
    assert!(
        unbounded.validate().is_err(),
        "the unbounded join is exactly what the frozen-brief gate rejects"
    );

    assert!(brief.required_subjects.is_empty());
    assert_eq!(brief.required_environment.len(), 2);
    assert_eq!(brief.required_environment[0], plan.persisted_identity);
    let environment = &brief.required_environment[1];
    assert_eq!(
        environment.len(),
        MEDIA_BRIEF_CONSTRAINT_LIMIT,
        "the over-long description is truncated to the budget, not dropped"
    );
    assert!(
        plan.persisted_visual_description
            .starts_with(environment.as_str()),
        "the kept constraint is a prefix of the authored description"
    );

    assert!(
        brief.pack_negative_constraints.is_empty(),
        "positive identity traits must never be inverted into negative constraints"
    );
    for constraint in brief
        .required_subjects
        .iter()
        .chain(&brief.required_environment)
        .chain(&brief.forbidden)
        .chain(&brief.pack_negative_constraints)
    {
        assert!(!constraint.trim().is_empty());
        assert!(
            constraint.len() <= MEDIA_BRIEF_CONSTRAINT_LIMIT,
            "constraint is {} bytes: {constraint}",
            constraint.len()
        );
    }
}

#[test]
fn a_missing_visual_description_is_omitted_instead_of_freezing_an_empty_constraint() {
    let mut plan = location_art_plan(157_217, "16:9", "chalk lanes and reed beds");
    plan.persisted_visual_description = String::new();
    plan.stable_traits = Vec::new();

    let brief = community_art_media_brief(&plan);
    brief
        .validate()
        .expect("an absent visual description must not freeze an empty constraint");
    assert_eq!(
        brief.required_environment,
        vec![plan.persisted_identity.clone()]
    );
    assert!(brief.pack_negative_constraints.is_empty());

    let mut empty_entry = brief.clone();
    empty_entry.required_environment = vec![plan.persisted_identity.clone(), String::new()];
    assert!(
        empty_entry.validate().is_err(),
        "an empty-after-trim constraint is rejected just like an over-long one"
    );
}

#[test]
fn multi_byte_constraints_are_bounded_by_bytes_without_slicing_a_codepoint() {
    let identity = format!("ab{}", "🌿".repeat(100));
    assert!(
        identity.chars().take(MEDIA_BRIEF_CONSTRAINT_LIMIT).count() <= MEDIA_BRIEF_CONSTRAINT_LIMIT
            && identity
                .chars()
                .take(MEDIA_BRIEF_CONSTRAINT_LIMIT)
                .collect::<String>()
                .len()
                > MEDIA_BRIEF_CONSTRAINT_LIMIT,
        "a character-counted bound alone still overflows the byte budget the gate measures"
    );

    let mut plan = location_art_plan(157_218, "16:9", &long_reviewed_landscape_brief());
    plan.persisted_identity = identity.clone();
    plan.stable_traits = stable_art_traits(
        "location",
        &identity,
        &format!(
            "biome: {}. reviewed landscape brief: {}",
            "🌿".repeat(120),
            long_reviewed_landscape_brief()
        ),
    );
    plan.persisted_visual_description = plan.stable_traits.join(". ");

    let brief = community_art_media_brief(&plan);
    brief
        .validate()
        .expect("multi-byte constraints must be bounded, not rejected");

    let bounded_identity = &brief.required_environment[0];
    assert!(bounded_identity.len() <= MEDIA_BRIEF_CONSTRAINT_LIMIT);
    assert!(
        bounded_identity.len() > MEDIA_BRIEF_CONSTRAINT_LIMIT - 4,
        "the cut lands on the last whole character that fits: {} bytes",
        bounded_identity.len()
    );
    assert!(identity.starts_with(bounded_identity.as_str()));
    for constraint in brief
        .required_environment
        .iter()
        .chain(&brief.pack_negative_constraints)
    {
        assert!(!constraint.trim().is_empty());
        assert!(constraint.len() <= MEDIA_BRIEF_CONSTRAINT_LIMIT);
        assert!(constraint.is_char_boundary(constraint.len()));
    }
}

#[tokio::test]
async fn an_invalid_frozen_brief_fails_before_any_provider_call() {
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-invalid-brief-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let subject_id = 157_219;
    let job_key = community_art_generation_key("location", subject_id, 1);
    let valid = location_art_plan(subject_id, "16:9", "chalk lanes and reed beds");
    let invalid = location_art_plan(subject_id, "16x9", "chalk lanes and reed beds");

    // Close the provider route for this job key first. A regression that spends
    // before validating would stop at the cooldown gate with a Provider error
    // instead of reaching the network, so the two orderings stay hermetically
    // distinguishable.
    let cooldown_brief = community_art_media_brief(&valid);
    cooldown_brief
        .validate()
        .expect("the control brief is valid");
    for _ in 0..3 {
        crate::media_recipes::media_verdict::record_media_provider_failure(
            &generated_dir,
            cooldown_brief.clone(),
            "replicate-primary",
        )
        .expect("record a provider failure against the job key");
    }
    assert!(
        !crate::media_recipes::media_verdict::media_provider_route_available(
            &generated_dir,
            &job_key
        )
        .expect("read the provider route"),
        "the provider route is cooling down before the run"
    );

    let outcome =
        generate_and_store_community_art(&test_art_config(), None, &generated_dir, &invalid).await;

    match &outcome.result {
        Err(CommunityArtGenerationError::BriefInvalid(error)) => {
            assert!(error.contains("aspect ratio"), "{error}");
        }
        other => panic!("expected a pre-flight frozen-brief rejection, got {other:?}"),
    }
    let error = outcome.result.expect_err("the run fails");
    assert_eq!(error.code(), COMMUNITY_ART_BRIEF_INVALID_CODE);
    assert_ne!(error.code(), "community_art_generation_failed");
    assert!(outcome.prediction_id.is_none());
    assert!(!outcome.reused_candidate);
    assert!(outcome.asset_id.is_none());
    assert!(
        outcome.provider_executions.is_empty(),
        "preflight rejection has no provider execution to record"
    );
    assert!(
        !community_art_candidate_exists(&generated_dir, &invalid),
        "no provider image is bought or written for an invalid brief"
    );
    let _ = fs::remove_dir_all(generated_dir);
}

#[tokio::test]
async fn scheduler_preflight_failure_spends_no_attempt_and_records_no_provider_usage() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-invalid-brief-ledger-{nonce}.sqlite"));
    let generated_dir =
        std::env::temp_dir().join(format!("cosyworld-invalid-brief-ledger-{nonce}"));
    let _ = fs::remove_file(&event_store_path);
    let _ = fs::remove_dir_all(&generated_dir);

    let actor_id = 5000;
    let plan = location_art_plan(181_731, "16x9", "chalk lanes and reed beds");
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Brief Ledger Patron",
    );
    fund_test_community_art(
        &mut runtime,
        actor_id,
        &plan,
        "test-invalid-brief-ledger",
        7080,
    );
    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());

    schedule_community_art_generation(&state, actor_id, plan);
    let generation = wait_for_community_art_status(&state, &key, "failed").await;

    assert_eq!(
        generation.last_error_code.as_deref(),
        Some(COMMUNITY_ART_BRIEF_INVALID_CODE)
    );
    assert_eq!(
        generation.provider_attempts, 0,
        "the durable provider budget is untouched"
    );
    assert_eq!(
        community_image_usage_count(&event_store_path),
        0,
        "preflight-only work must not be reported as provider usage"
    );

    let _ = fs::remove_dir_all(generated_dir);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn frozen_brief_conflict_stops_the_worker_and_preserves_paid_work() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-brief-conflict-{nonce}.sqlite"));
    let generated_dir = std::env::temp_dir().join(format!("cosyworld-brief-conflict-{nonce}"));
    let actor_id = 5000;
    let mut plan = location_art_plan(181_734, "16:9", "chalk lanes and reed beds");
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let image = DownloadedReplicateImage {
        bytes: gate_png(),
        content_type: "image/png".to_string(),
        source_url: "https://provider.invalid/saved-candidate.png".to_string(),
        prediction_id: Some("saved-conflicting-candidate".to_string()),
    };
    store_community_art_candidate(&generated_dir, &plan, &image).unwrap();
    assert_eq!(
        prepare_media_candidate(
            &generated_dir,
            community_art_media_brief(&plan),
            MediaCandidateInput {
                image: &image,
                provider: "fixture-provider",
                model: "fixture-model",
                claimed_digest: None,
                prior_public_bytes: None,
            },
        )
        .unwrap(),
        MediaVerdictDisposition::ReviewPending
    );
    let record_id = format!("{:x}", Sha256::digest(key.as_bytes()));
    let record_path = generated_dir
        .join("media-verdicts/v1")
        .join(record_id)
        .join("record.json");
    let original_record = fs::read(&record_path).unwrap();
    plan.prompt = "A changed view of the chalk lane.".to_string();
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Conflict Patron",
    );
    fund_test_community_art(&mut runtime, actor_id, &plan, "brief-conflict", 7090);
    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());

    assert!(matches!(
        execute_community_art_media_job(&state, actor_id, plan.clone()).await,
        MediaJobExecution::Dead {
            charge_reserved: false,
            ..
        }
    ));
    let seq_after_failure = {
        let runtime = state.inner.lock().await;
        let generation = &runtime.community_art_generations[&key];
        assert_eq!(
            generation.last_error_code.as_deref(),
            Some(COMMUNITY_ART_BRIEF_CONFLICT_CODE)
        );
        assert_eq!(generation.provider_attempts, 0);
        runtime.world.next_event_seq
    };
    for _ in 0..3 {
        assert!(matches!(
            execute_community_art_media_job(&state, actor_id, plan.clone()).await,
            MediaJobExecution::Completed {
                charge_reserved: false
            }
        ));
    }
    assert_eq!(
        state.inner.lock().await.world.next_event_seq,
        seq_after_failure
    );
    assert_eq!(community_image_usage_count(&event_store_path), 0);
    assert_eq!(fs::read(record_path).unwrap(), original_record);
    assert!(community_art_candidate_exists(&generated_dir, &plan));
    let candidate = generated_dir.join("community-art-candidates/location/181734/level-1.image");
    assert_eq!(fs::read(candidate).unwrap(), image.bytes);
    let _ = fs::remove_dir_all(generated_dir);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn scheduler_candidate_review_retry_records_no_provider_attempt_or_usage() {
    let nonce = format!("{}-{}", std::process::id(), now_seed());
    let event_store_path =
        std::env::temp_dir().join(format!("cosyworld-candidate-review-ledger-{nonce}.sqlite"));
    let generated_dir =
        std::env::temp_dir().join(format!("cosyworld-candidate-review-ledger-{nonce}"));
    let _ = fs::remove_file(&event_store_path);
    let _ = fs::remove_dir_all(&generated_dir);

    let actor_id = 5000;
    let plan = location_art_plan(181_732, "16:9", "chalk lanes and reed beds");
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Candidate Ledger Patron",
    );
    fund_test_community_art(
        &mut runtime,
        actor_id,
        &plan,
        "test-candidate-review-ledger",
        7081,
    );
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: gate_png(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/saved-candidate.png".to_string(),
            prediction_id: Some("saved-candidate-prediction".to_string()),
        },
    )
    .expect("store the paid candidate before its review retry");
    let mut state = test_app_state(runtime, Some(event_store_path.clone()));
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());

    schedule_community_art_generation(&state, actor_id, plan.clone());
    let generation = wait_for_community_art_status(&state, &key, "review_unavailable").await;

    assert_eq!(
        generation.provider_attempts, 0,
        "reviewing a saved candidate is not a provider generation attempt"
    );
    assert_eq!(
        generation.last_error_code.as_deref(),
        Some("community_art_reviewer_unavailable")
    );
    assert!(
        community_art_candidate_exists(&generated_dir, &plan),
        "the paid candidate remains available for a later review retry"
    );
    assert_eq!(
        community_image_usage_count(&event_store_path),
        0,
        "candidate-only review work must not be reported as provider usage"
    );

    let _ = fs::remove_dir_all(generated_dir);
    let _ = fs::remove_file(event_store_path);
}

#[tokio::test]
async fn durable_worker_deferral_keeps_the_saved_candidate_and_review_attempt() {
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-durable-review-deferral-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let actor_id = 5000;
    let plan = location_art_plan(181_733, "16:9", "chalk lanes and reed beds");
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Deferred Review Patron",
    );
    fund_test_community_art(
        &mut runtime,
        actor_id,
        &plan,
        "test-durable-review-deferral",
        7085,
    );
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: gate_png(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/deferred-candidate.png".to_string(),
            prediction_id: Some("deferred-candidate".to_string()),
        },
    )
    .expect("store candidate before reviewer deferral");
    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    assert!(state.ai_config.as_ref().is_none());

    let execution = execute_community_art_media_job(&state, actor_id, plan.clone()).await;
    assert!(matches!(execution, MediaJobExecution::Deferred { .. }));
    let generation = {
        let runtime = state.inner.lock().await;
        runtime.community_art_generations[&key].clone()
    };
    assert_eq!(generation.status, "reviewing");
    assert_eq!(generation.review_attempts, 0);
    assert_eq!(generation.provider_attempts, 0);
    assert!(community_art_candidate_exists(&generated_dir, &plan));

    let _ = fs::remove_dir_all(generated_dir);
}

#[tokio::test]
async fn fully_funded_candidate_retry_never_debits_or_calls_the_provider_again() {
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-funded-candidate-endpoint-retry-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let actor_id = 5000;
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Already Funded Patron",
    );
    let plan = runtime
        .community_art_plan(actor_id, "actor", actor_id)
        .expect("visible avatar has a community-art plan");
    let key = community_art_generation_key("actor", actor_id, plan.level);
    fund_test_community_art(&mut runtime, actor_id, &plan, "already-funded-intent", 7084);
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: gate_png_with_dimensions(16, 24),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/already-funded.png".to_string(),
            prediction_id: Some("already-funded-prediction".to_string()),
        },
    )
    .expect("store the recoverable paid candidate");

    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    let (actor_session, _) = issue_actor_session(&state, actor_id);
    let balance_before = state.inner.lock().await.orb_balance(actor_id);

    let response = fund_community_image(
        ConnectInfo("127.0.0.1:44996".parse().expect("client address")),
        State(state.clone()),
        Json(FundCommunityImageRequest {
            actor_id,
            actor_session: Some(actor_session),
            subject_kind: "actor".to_string(),
            subject_id: actor_id,
            intent_id: "retry-must-not-fund-again".to_string(),
        }),
    )
    .await
    .0;

    assert!(response.ok);
    assert_eq!(response.status, CW_OK);
    assert!(response.events.is_empty());
    assert!(response.error_code.is_none());
    let generation = wait_for_community_art_status(&state, &key, "review_unavailable").await;
    assert_eq!(generation.provider_attempts, 0);
    assert_eq!(generation.funded_orbs, generation.required_orbs);
    assert!(!generation
        .funding_intent_ids
        .contains("retry-must-not-fund-again"));
    assert_eq!(
        state.inner.lock().await.orb_balance(actor_id),
        balance_before
    );
    assert!(community_art_candidate_exists(&generated_dir, &plan));

    let _ = fs::remove_dir_all(generated_dir);
}

#[test]
fn corrupt_candidate_components_are_quarantined_before_provider_preparation() {
    for (offset, corruption) in [
        (0_u64, "image"),
        (1, "content-type"),
        (2, "metadata"),
        (3, "schema"),
        (4, "missing-metadata"),
    ] {
        let generated_dir = std::env::temp_dir().join(format!(
            "cosyworld-candidate-corruption-{corruption}-{}-{}",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_dir_all(&generated_dir);
        let plan = location_art_plan(181_740 + offset, "16:9", "chalk lanes and reed beds");
        let public_image = DownloadedReplicateImage {
            bytes: gate_png(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/prior-public.png".to_string(),
            prediction_id: Some("prior-public-prediction".to_string()),
        };
        let candidate = DownloadedReplicateImage {
            bytes: gate_png(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/corruptible-candidate.png".to_string(),
            prediction_id: Some(format!("candidate-{corruption}")),
        };
        store_community_art_image(&generated_dir, &plan, &public_image)
            .expect("store the approved public incumbent");
        store_community_art_candidate(&generated_dir, &plan, &candidate)
            .expect("store the candidate before corrupting it");
        assert_eq!(
            community_art_candidate_availability(&generated_dir, &plan),
            CommunityArtCandidateAvailability::Valid
        );

        let [image_path, content_type_path, metadata_path] =
            test_candidate_paths(&generated_dir, &plan);
        match corruption {
            "image" => {
                let mut corrupt_bytes = candidate.bytes.clone();
                corrupt_bytes.push(0);
                fs::write(&image_path, corrupt_bytes).expect("corrupt candidate image digest");
            }
            "content-type" => {
                fs::write(&content_type_path, "text/html").expect("corrupt candidate content type");
            }
            "metadata" => {
                fs::write(&metadata_path, b"{not-json").expect("corrupt candidate metadata JSON");
            }
            "schema" => {
                let mut metadata: serde_json::Value = serde_json::from_slice(
                    &fs::read(&metadata_path).expect("read candidate metadata"),
                )
                .expect("parse candidate metadata");
                metadata["schema_version"] = serde_json::json!(99);
                fs::write(
                    &metadata_path,
                    serde_json::to_vec(&metadata).expect("encode mismatched schema"),
                )
                .expect("corrupt candidate schema version");
            }
            "missing-metadata" => {
                fs::remove_file(&metadata_path).expect("remove candidate metadata component");
            }
            other => panic!("unknown corruption fixture {other}"),
        }
        assert_eq!(
            community_art_candidate_availability(&generated_dir, &plan),
            CommunityArtCandidateAvailability::RecoveryRequired,
            "{corruption} must not count as an available paid candidate"
        );
        assert!(!community_art_candidate_exists(&generated_dir, &plan));

        let prepared = prepare_community_art_generation(&test_art_config(), &generated_dir, &plan)
            .unwrap_or_else(|error| {
                panic!(
                    "{corruption} should quarantine and continue to provider preparation: {}",
                    error.message()
                )
            });
        assert!(
            prepared.provider_attempt(),
            "{corruption} recovers through one bounded provider attempt"
        );
        assert_eq!(
            community_art_candidate_availability(&generated_dir, &plan),
            CommunityArtCandidateAvailability::Absent
        );
        assert!(
            test_candidate_paths(&generated_dir, &plan)
                .iter()
                .all(|path| !path.exists()),
            "no corrupt component remains on an active candidate path"
        );
        assert!(!test_candidate_quarantine_marker(&generated_dir, &plan).exists());
        assert_eq!(
            fs::read(stored_community_art_image_path(
                &generated_dir,
                &plan.subject_kind,
                plan.subject_id
            ))
            .expect("read the unchanged approved public incumbent"),
            public_image.bytes,
            "quarantining {corruption} never touches approved public art"
        );
        let quarantines = fs::read_dir(test_candidate_quarantine_root(&generated_dir, &plan))
            .expect("read candidate quarantine")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect candidate quarantine");
        assert_eq!(quarantines.len(), 1);
        assert!(
            quarantines[0].path().join("quarantine.json").is_file(),
            "the audit reason is archived with the invalid bundle"
        );

        let _ = fs::remove_dir_all(generated_dir);
    }
}

#[tokio::test]
async fn quarantined_candidate_recovery_journals_one_provider_attempt_across_restart() {
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-candidate-recovery-budget-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let actor_id = 5000;
    let plan = location_art_plan(181_746, "16:9", "chalk lanes and reed beds");
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Recovery Budget Patron",
    );
    fund_test_community_art(
        &mut runtime,
        actor_id,
        &plan,
        "test-corrupt-candidate-recovery",
        7082,
    );
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: gate_png(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/recovery-candidate.png".to_string(),
            prediction_id: Some("recovery-candidate".to_string()),
        },
    )
    .expect("store recovery candidate");
    let [image_path, _, _] = test_candidate_paths(&generated_dir, &plan);
    fs::write(&image_path, b"tampered candidate").expect("tamper candidate image");

    let prepared = prepare_community_art_generation(&test_art_config(), &generated_dir, &plan)
        .unwrap_or_else(|error| panic!("quarantine prepares regeneration: {}", error.message()));
    assert!(prepared.provider_attempt());
    let mut state = test_app_state(runtime, None);
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    assert_eq!(
        begin_community_art_generation(&state, actor_id, &plan, prepared.provider_attempt()).await,
        Some(true)
    );

    let generation = {
        let runtime = state.inner.lock().await;
        runtime.community_art_generations[&key].clone()
    };
    assert_eq!(generation.status, "generating");
    assert_eq!(generation.provider_attempts, 1);
    let serialized = serde_json::to_string(&BTreeMap::from([(key.clone(), generation)]))
        .expect("serialize recovered provider budget");
    let restored: BTreeMap<String, CommunityArtGenerationState> =
        serde_json::from_str(&serialized).expect("restore recovered provider budget");
    assert_eq!(restored[&key].provider_attempts, 1);
    assert!(
        community_art_generation_retryable(&restored[&key], false),
        "restart preserves the remaining bounded provider budget"
    );

    let _ = fs::remove_dir_all(generated_dir);
}

#[tokio::test]
async fn incomplete_candidate_quarantine_is_terminal_and_actionable() {
    let generated_dir = std::env::temp_dir().join(format!(
        "cosyworld-candidate-quarantine-failure-{}-{}",
        std::process::id(),
        now_seed()
    ));
    let _ = fs::remove_dir_all(&generated_dir);
    let actor_id = 5000;
    let plan = location_art_plan(181_747, "16:9", "chalk lanes and reed beds");
    store_community_art_candidate(
        &generated_dir,
        &plan,
        &DownloadedReplicateImage {
            bytes: gate_png(),
            content_type: "image/png".to_string(),
            source_url: "https://replicate.delivery/pbxt/stuck-candidate.png".to_string(),
            prediction_id: Some("stuck-candidate".to_string()),
        },
    )
    .expect("store candidate before simulating interrupted quarantine");
    let marker = test_candidate_quarantine_marker(&generated_dir, &plan);
    fs::write(&marker, br#"{"schema_version":1,"reason":"interrupted"}"#)
        .expect("install interrupted quarantine marker");

    let error = match prepare_community_art_generation(&test_art_config(), &generated_dir, &plan) {
        Err(error) => error,
        Ok(_) => panic!("an incomplete quarantine must block provider preparation"),
    };
    assert!(matches!(
        &error,
        CommunityArtGenerationError::CandidateQuarantine(_)
    ));
    assert_eq!(error.code(), COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE);
    assert!(
        error.message().contains(&marker.display().to_string()),
        "the operator-facing error names the blocking marker"
    );

    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        actor_id,
        COSY_COTTAGE_LOCATION_ID,
        "Quarantine Failure Patron",
    );
    fund_test_community_art(
        &mut runtime,
        actor_id,
        &plan,
        "test-candidate-quarantine-failure",
        7083,
    );
    let key = community_art_generation_key(&plan.subject_kind, plan.subject_id, plan.level);
    let mut state = test_app_state(runtime, None);
    state.avatar_art_config = Arc::new(Some(test_art_config()));
    state.generated_asset_dir = Arc::new(generated_dir.clone());
    schedule_community_art_generation(&state, actor_id, plan.clone());
    let generation = wait_for_community_art_status(&state, &key, "failed").await;
    assert_eq!(
        generation.last_error_code.as_deref(),
        Some(COMMUNITY_ART_CANDIDATE_QUARANTINE_FAILED_CODE)
    );
    assert_eq!(generation.provider_attempts, 0);
    assert!(!community_art_generation_retryable(&generation, true));
    let terminal_event_seq = generation.status_event_seq;
    schedule_community_art_generation(&state, actor_id, plan.clone());
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let generations = {
        let runtime = state.inner.lock().await;
        runtime.community_art_generations.clone()
    };
    assert_eq!(
        generations[&key].status_event_seq, terminal_event_seq,
        "the terminal marker does not schedule another completion"
    );
    let serialized = serde_json::to_string(&generations).expect("serialize terminal state");
    let restored: BTreeMap<String, CommunityArtGenerationState> =
        serde_json::from_str(&serialized).expect("restore terminal state");
    assert!(!community_art_generation_retryable(&restored[&key], true));
    assert!(
        !community_art_generation_retryable_for_profile(
            &restored[&key],
            true,
            restored[&key].generation_profile_version.saturating_add(1)
        ),
        "a prompt-profile bump cannot repair an incomplete filesystem quarantine"
    );

    remove_community_art_candidate(&generated_dir, &plan)
        .expect("operator cleanup removes the marker and active remnants");
    let _ = fs::remove_dir_all(generated_dir);
}

#[test]
fn brief_failures_are_terminal_across_replay_and_snapshots() {
    for error_code in [
        COMMUNITY_ART_BRIEF_INVALID_CODE,
        COMMUNITY_ART_BRIEF_CONFLICT_CODE,
    ] {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Brief Patron");
        let mut funding = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7075,
        );
        funding
            .projection_mutations
            .push(ProjectionMutation::FundCommunityArt {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                required_orbs: 1,
                contributor_actor_id: 5000,
                intent_id: "test-brief-invalid".to_string(),
                amount: 1,
                history_through_seq: 7075,
                evolution_job: None,
            });
        assert_eq!(runtime.apply_journal_record(&funding).0, CW_OK);

        let mut completion = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            7076,
        );
        completion
            .projection_mutations
            .push(ProjectionMutation::CompleteCommunityArtGeneration {
                subject_kind: "actor".to_string(),
                subject_id: 5000,
                level: 1,
                status: "failed".to_string(),
                prediction_id: None,
                error_code: Some(error_code.to_string()),
            });
        assert_eq!(runtime.apply_journal_record(&completion).0, CW_OK);

        let key = community_art_generation_key("actor", 5000, 1);
        let generation = runtime.community_art_generations[&key].clone();
        assert_eq!(generation.status, "failed");
        assert_eq!(generation.last_error_code.as_deref(), Some(error_code));
        assert_eq!(
            generation.provider_attempts, 0,
            "preflight rejection leaves the provider budget untouched"
        );
        assert!(!community_art_generation_retryable(&generation, false));
        assert!(
            !community_art_generation_retryable(&generation, true),
            "a saved candidate must not reopen a deterministically invalid brief"
        );

        let serialized =
            serde_json::to_string(&runtime.community_art_generations).expect("serialize art state");
        let restored: BTreeMap<String, CommunityArtGenerationState> =
            serde_json::from_str(&serialized).expect("restore art state");
        assert!(!community_art_generation_retryable(&restored[&key], true));

        let mut provider_failure = restored[&key].clone();
        provider_failure.last_error_code = Some("community_art_generation_failed".to_string());
        assert!(
            community_art_generation_retryable(&provider_failure, true),
            "an ordinary provider failure keeps its existing retry behavior"
        );

        assert_eq!(
            community_art_generation_retryable_for_profile(
                &restored[&key],
                false,
                generation.generation_profile_version + 1
            ),
            error_code == COMMUNITY_ART_BRIEF_INVALID_CODE,
            "a stored brief conflict requires operator reconciliation even after a profile upgrade"
        );
    }
}
