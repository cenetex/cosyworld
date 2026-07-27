use super::*;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use std::{
    io::Cursor,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_ROOT: AtomicU64 = AtomicU64::new(1);

fn root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "cosyworld-media-verdict-{label}-{}-{}",
        std::process::id(),
        NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    root
}

fn patterned_png(width: u32, height: u32, seed: u8) -> Vec<u8> {
    let pixels = ImageBuffer::from_fn(width, height, |x, y| {
        Rgba([
            (x as u8).wrapping_mul(17).wrapping_add(seed),
            (y as u8).wrapping_mul(29).wrapping_add(seed),
            (x as u8 ^ y as u8).wrapping_mul(11),
            255,
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(pixels)
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("encode patterned PNG");
    bytes.into_inner()
}

fn solid_png(width: u32, height: u32) -> Vec<u8> {
    let pixels = ImageBuffer::from_pixel(width, height, Rgba([12, 12, 12, 255]));
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(pixels)
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("encode solid PNG");
    bytes.into_inner()
}

fn image(bytes: Vec<u8>, content_type: &str, prediction: &str) -> DownloadedReplicateImage {
    DownloadedReplicateImage {
        bytes,
        content_type: content_type.to_string(),
        source_url: format!("https://provider.invalid/{prediction}"),
        prediction_id: Some(prediction.to_string()),
    }
}

fn brief(job: &str) -> FrozenMediaBrief {
    let mut brief = FrozenMediaBrief::new(
        job,
        "cosyworld.test-recipe/1",
        "public test image",
        "A two-subject scene in a rainy cottage, without text.",
        "16:9",
    );
    brief.required_subjects = vec!["actor 1".to_string(), "actor 2".to_string()];
    brief.required_environment = vec!["rainy cottage".to_string()];
    brief.required_item_holder = Some("lantern held by actor 1".to_string());
    brief.crop = "full room, heads and lantern visible".to_string();
    brief.safe_areas = vec!["faces inside center 80%".to_string()];
    brief.pack_negative_constraints = vec!["no modern electronics".to_string()];
    brief
}

fn prepare(
    root: &Path,
    brief: FrozenMediaBrief,
    image: &DownloadedReplicateImage,
    claimed_digest: Option<&str>,
    prior: Option<&[u8]>,
) -> MediaVerdictDisposition {
    prepare_media_candidate(
        root,
        brief,
        MediaCandidateInput {
            image,
            provider: "fixture-provider",
            model: "fixture-model",
            claimed_digest,
            prior_public_bytes: prior,
        },
    )
    .expect("prepare candidate")
}

#[test]
fn deterministic_gate_rejects_corrupt_blank_format_dimensions_aspect_digest_and_duplicate() {
    struct Case {
        name: &'static str,
        bytes: Vec<u8>,
        content_type: &'static str,
        mutate: fn(&mut FrozenMediaBrief),
        claimed: Option<String>,
        prior: Option<Vec<u8>>,
        violation: MediaViolation,
    }
    let good = patterned_png(16, 9, 3);
    let cases = vec![
        Case {
            name: "corrupt",
            bytes: b"not an image".to_vec(),
            content_type: "image/png",
            mutate: |_| {},
            claimed: None,
            prior: None,
            violation: MediaViolation::Corrupt,
        },
        Case {
            name: "blank",
            bytes: solid_png(16, 9),
            content_type: "image/png",
            mutate: |_| {},
            claimed: None,
            prior: None,
            violation: MediaViolation::Blank,
        },
        Case {
            name: "format",
            bytes: good.clone(),
            content_type: "image/jpeg",
            mutate: |_| {},
            claimed: None,
            prior: None,
            violation: MediaViolation::Format,
        },
        Case {
            name: "dimensions",
            bytes: good.clone(),
            content_type: "image/png",
            mutate: |brief| brief.min_width = 32,
            claimed: None,
            prior: None,
            violation: MediaViolation::Dimensions,
        },
        Case {
            name: "aspect",
            bytes: good.clone(),
            content_type: "image/png",
            mutate: |brief| brief.expected_aspect_ratio = "1:1".to_string(),
            claimed: None,
            prior: None,
            violation: MediaViolation::AspectRatio,
        },
        Case {
            name: "digest",
            bytes: good.clone(),
            content_type: "image/png",
            mutate: |_| {},
            claimed: Some("0".repeat(64)),
            prior: None,
            violation: MediaViolation::Digest,
        },
        Case {
            name: "near-duplicate",
            bytes: good.clone(),
            content_type: "image/png",
            mutate: |_| {},
            claimed: None,
            prior: Some(good),
            violation: MediaViolation::NearDuplicate,
        },
    ];
    for case in cases {
        let root = root(case.name);
        let job = format!("deterministic-{}", case.name);
        let mut frozen = brief(&job);
        (case.mutate)(&mut frozen);
        let candidate = image(case.bytes, case.content_type, case.name);
        assert_eq!(
            prepare(
                &root,
                frozen,
                &candidate,
                case.claimed.as_deref(),
                case.prior.as_deref()
            ),
            MediaVerdictDisposition::Rejected,
            "{} must fail closed",
            case.name
        );
        assert!(
            media_candidate_violations(&root, &job, &sha256_hex(&candidate.bytes))
                .expect("read deterministic verdict")
                .contains(&case.violation.code().to_string()),
            "{} verdict must name {:?}",
            case.name,
            case.violation
        );
        assert!(
            record_dir(&root, &sha256_hex(job.as_bytes()))
                .join("candidates")
                .join(format!("{}.image", sha256_hex(&candidate.bytes)))
                .exists(),
            "failed candidate remains privately inspectable"
        );
    }
}

#[test]
fn visual_verdict_is_versioned_bounded_and_covers_semantic_failure_taxonomy() {
    let root = root("semantic");
    let frozen = brief("semantic-job");
    let candidate = image(patterned_png(16, 9, 8), "image/png", "semantic");
    assert_eq!(
        prepare(&root, frozen.clone(), &candidate, None, None),
        MediaVerdictDisposition::ReviewPending
    );
    let digest = sha256_hex(&candidate.bytes);
    let violations = vec![
        MediaViolation::Safety,
        MediaViolation::Text,
        MediaViolation::Logo,
        MediaViolation::Watermark,
        MediaViolation::SystemLeak,
        MediaViolation::UiChrome,
        MediaViolation::MissingSubject,
        MediaViolation::ExtraSubject,
        MediaViolation::IdentityDrift,
        MediaViolation::MissingItem,
        MediaViolation::WrongHolder,
        MediaViolation::WrongEnvironment,
        MediaViolation::BadCrop,
        MediaViolation::PackNegative,
    ];
    let verdict = make_visual_verdict(
        &frozen,
        digest.clone(),
        "fixture-reviewer",
        "fixture-reviewer/7",
        false,
        violations.clone(),
        "Visible semantic violations against the frozen brief.",
        2,
        170,
        25,
    )
    .expect("build verdict");
    assert_eq!(
        record_media_visual_verdict(&root, "semantic-job", verdict),
        Ok(MediaVerdictDisposition::Rejected)
    );
    let codes = media_candidate_violations(&root, "semantic-job", &digest).unwrap();
    for violation in violations {
        assert!(codes.contains(&violation.code().to_string()));
    }
    let dashboard = media_verdict_dashboard(&root).unwrap();
    assert_eq!(dashboard.review_latency_ms, 170);
    assert_eq!(dashboard.retry_spend_microusd, 12);
    for (dimension, value) in [
        ("model", "fixture-model"),
        ("profile", "cosyworld.test-recipe/1"),
        ("intended_use", "public test image"),
        ("violation", "wrong_holder"),
    ] {
        assert!(dashboard
            .slices
            .iter()
            .any(|slice| slice.dimension == dimension && slice.value == value));
    }
    assert!(!media_candidate_approved(&root, "semantic-job", &digest).unwrap());
}

#[test]
fn approved_verdict_survives_restart_and_is_bound_to_brief_candidate_and_references() {
    let root = root("restart");
    let mut frozen = brief("restart-job");
    frozen.approved_reference_digests = vec!["a".repeat(64), "b".repeat(64)];
    let candidate = image(patterned_png(16, 9, 11), "image/png", "restart");
    assert_eq!(
        prepare(&root, frozen.clone(), &candidate, None, None),
        MediaVerdictDisposition::ReviewPending
    );
    let digest = sha256_hex(&candidate.bytes);
    assert!(
        !media_candidate_approved(&root, "restart-job", &digest).unwrap(),
        "publication is impossible before a persisted visual verdict"
    );
    let verdict = make_visual_verdict(
        &frozen,
        digest.clone(),
        "fixture-reviewer",
        "fixture-reviewer/1",
        true,
        Vec::new(),
        "Candidate matches the frozen brief and both references.",
        1,
        42,
        9,
    )
    .unwrap();
    record_media_visual_verdict(&root, "restart-job", verdict).unwrap();
    assert!(media_candidate_approved(&root, "restart-job", &digest).unwrap());
    let dashboard = media_verdict_dashboard(&root).unwrap();
    assert_eq!(dashboard.pass_rate_basis_points, 10_000);
    assert_eq!(dashboard.cost_per_approved_microusd, 9);
    assert_eq!(dashboard.review_latency_ms, 42);
    assert_eq!(dashboard.retry_spend_microusd, 0);
    assert_eq!(
        prepare(&root, frozen.clone(), &candidate, None, None),
        MediaVerdictDisposition::Approved,
        "idempotent replay reuses the durable verdict"
    );
    let mut changed = frozen.clone();
    changed.crop = "different crop".to_string();
    assert!(prepare_media_candidate(
        &root,
        changed,
        MediaCandidateInput {
            image: &candidate,
            provider: "fixture-provider",
            model: "fixture-model",
            claimed_digest: None,
            prior_public_bytes: None,
        }
    )
    .is_err());
    let mut wrong = make_visual_verdict(
        &frozen,
        "f".repeat(64),
        "fixture-reviewer",
        "fixture-reviewer/1",
        true,
        Vec::new(),
        "Wrong candidate.",
        1,
        0,
        0,
    )
    .unwrap();
    wrong.reference_digests.reverse();
    assert!(record_media_visual_verdict(&root, "restart-job", wrong).is_err());
}

#[test]
fn reviewer_outage_reuses_one_candidate_and_provider_failures_enter_cooldown() {
    let root = root("outage");
    let frozen = brief("outage-job");
    let candidate = image(patterned_png(16, 9, 17), "image/png", "outage");
    assert_eq!(
        prepare(&root, frozen.clone(), &candidate, None, None),
        MediaVerdictDisposition::ReviewPending
    );
    let digest = sha256_hex(&candidate.bytes);
    for attempt in 0..7 {
        record_media_review_unavailable(
            &root,
            "outage-job",
            &digest,
            &format!("review transport unavailable {attempt}"),
        )
        .unwrap();
        assert_eq!(
            prepare(&root, frozen.clone(), &candidate, None, None),
            MediaVerdictDisposition::ReviewPending
        );
    }
    for _ in 0..PROVIDER_COOLDOWN_FAILURES {
        record_media_provider_failure(&root, frozen.clone(), "primary").unwrap();
    }
    assert!(!media_provider_route_available(&root, "outage-job").unwrap());
    let dashboard = media_verdict_dashboard(&root).unwrap();
    assert_eq!(dashboard.candidates, 1);
    assert_eq!(dashboard.review_retries, u64::from(MAX_REVIEW_FAILURES));
    assert_eq!(dashboard.cooldown_routes, 1);
    assert!(dashboard
        .slices
        .iter()
        .any(|slice| slice.dimension == "provider" && slice.value == "fixture-provider"));
}

#[test]
fn operator_can_approve_reject_replace_or_disable_without_publication_side_effects() {
    for (name, action, expected) in [
        (
            "approve",
            MediaVerdictAction::Approve,
            MediaVerdictDisposition::Approved,
        ),
        (
            "reject",
            MediaVerdictAction::Reject,
            MediaVerdictDisposition::Rejected,
        ),
        (
            "replace",
            MediaVerdictAction::Replace,
            MediaVerdictDisposition::ReplaceRequested,
        ),
        (
            "disable",
            MediaVerdictAction::Disable,
            MediaVerdictDisposition::Disabled,
        ),
    ] {
        let root = root(name);
        let job = format!("operator-{name}");
        let frozen = brief(&job);
        let candidate = image(patterned_png(16, 9, name.len() as u8), "image/png", name);
        assert_eq!(
            prepare(&root, frozen, &candidate, None, None),
            MediaVerdictDisposition::ReviewPending
        );
        let digest = sha256_hex(&candidate.bytes);
        let record = apply_operator_action(
            &root,
            &sha256_hex(job.as_bytes()),
            MediaVerdictActionRequest {
                candidate_digest: digest.clone(),
                action,
                reason: format!("operator {name} fixture"),
            },
        )
        .unwrap();
        assert_eq!(
            record
                .candidates
                .iter()
                .find(|candidate| candidate.provenance.digest == digest)
                .unwrap()
                .disposition,
            expected
        );
        if action == MediaVerdictAction::Approve {
            assert!(media_candidate_approved(&root, &job, &digest).unwrap());
        }
        assert!(
            !root.join("media-assets/graph-v1.json").exists(),
            "operator approval is verdict-only; a separate job retry publishes atomically"
        );
    }
}

#[tokio::test]
async fn moderation_dashboard_requires_authentication() {
    let mut state = crate::test_app_state(crate::RuntimeWorld::seeded(), None);
    state.generated_asset_dir = std::sync::Arc::new(root("auth"));
    let response = moderation_media_verdicts(State(state), HeaderMap::new()).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
