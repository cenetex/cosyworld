use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) const EVOLUTION_JOB_SCHEMA_VERSION: u8 = 1;
pub(super) const EVOLUTION_REFERENCE_PROFILE: &str = "cosyworld.community-art.reference/1";
pub(super) const EVOLUTION_INCUMBENT_RECIPE: &str = "replicate.flux1-dev-lora.base";
pub(super) const EVOLUTION_CANARY_RECIPE: &str = "replicate.flux2-dev.references";
pub(super) const EVOLUTION_CANARY_MODEL_REVISION: &str =
    "7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050";

const EMBEDDED_EVOLUTION_CANARY: &str = include_str!("../../media/evolution-canary.json");
const MAX_STABLE_TRAITS: usize = 16;
const MAX_PUBLIC_DELTA_EVENTS: usize = 12;
const MAX_CONSTRAINTS: usize = 16;
const MAX_COMPONENT_LENGTH: usize = 240;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct PublicArtHistoryEvent {
    pub(super) seq: u64,
    pub(super) summary: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FrozenCommunityArtEvolutionJob {
    pub(super) schema_version: u8,
    pub(super) job_key: String,
    pub(super) evaluation_profile: String,
    pub(super) subject_kind: String,
    pub(super) subject_id: u64,
    pub(super) persisted_identity: String,
    pub(super) persisted_visual_description: String,
    pub(super) stable_traits: Vec<String>,
    pub(super) requested_changes: Vec<String>,
    pub(super) negative_constraints: Vec<String>,
    pub(super) prior_level: u8,
    pub(super) prior_asset_id: String,
    pub(super) prior_asset_digest: String,
    pub(super) prior_mime_type: String,
    pub(super) prior_history_through_seq: u64,
    pub(super) history_from_seq: u64,
    pub(super) history_through_seq: u64,
    pub(super) target_level: u8,
    pub(super) target_revision: u32,
    pub(super) crop: String,
    pub(super) aspect_ratio: String,
    pub(super) profile: String,
    pub(super) recipe_id: String,
    pub(super) model_revision: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum EvolutionRolloutRoute {
    Incumbent,
    Shadow,
    Canary,
    AutomaticRollback,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EvolutionCanaryDocument {
    schema_version: u8,
    reference_profile: String,
    incumbent_recipe: String,
    candidate_recipe: String,
    candidate_model_revision: String,
    rollout: EvolutionRollout,
    thresholds: BTreeMap<String, EvolutionThresholds>,
    corpus: Vec<EvolutionCorpusCase>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EvolutionRollout {
    completed_stages: Vec<String>,
    active_stage: String,
    canary_percent: u8,
    minimum_runtime_observations: u32,
    automatic_disable: bool,
    rollback_route: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EvolutionThresholds {
    stable_trait_min: f64,
    requested_change_min: f64,
    style_min: f64,
    invention_max: f64,
    composition_min: f64,
    safety_min: f64,
    blind_preference_min: f64,
    latency_p95_max_ms: u64,
    cost_ratio_max: f64,
    error_rate_max: f64,
    retry_spend_ratio_max: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EvolutionCorpusCase {
    id: String,
    subject_kind: String,
    evaluation_profile: String,
    delta_size: String,
    lighting: String,
    reviewer_count: u32,
    incumbent: EvolutionMetrics,
    candidate: EvolutionMetrics,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EvolutionMetrics {
    stable_trait: f64,
    requested_change: f64,
    style: f64,
    invention: f64,
    composition: f64,
    safety: f64,
    blind_preference: f64,
    latency_p95_ms: u64,
    cost_ratio: f64,
    error_rate: f64,
    retry_spend_ratio: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EvolutionRuntimeObservation {
    pub(super) sample_count: u32,
    pub(super) stable_trait: f64,
    pub(super) requested_change: f64,
    pub(super) style: f64,
    pub(super) invention: f64,
    pub(super) composition: f64,
    pub(super) safety: f64,
    pub(super) blind_preference: f64,
    pub(super) latency_p95_ms: u64,
    pub(super) cost_ratio: f64,
    pub(super) error_rate: f64,
    pub(super) retry_spend_ratio: f64,
}

impl FrozenCommunityArtEvolutionJob {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn freeze(
        subject_kind: &str,
        subject_id: u64,
        persisted_identity: &str,
        persisted_visual_description: &str,
        stable_traits: Vec<String>,
        public_history: &[PublicArtHistoryEvent],
        prior_level: u8,
        prior_asset_id: String,
        prior_asset_digest: String,
        prior_mime_type: String,
        prior_history_through_seq: u64,
        history_through_seq: u64,
        target_level: u8,
        target_revision: u32,
        aspect_ratio: &str,
    ) -> Result<Self, String> {
        let history_from_seq = prior_history_through_seq.saturating_add(1);
        let requested_changes = public_history
            .iter()
            .filter(|event| event.seq >= history_from_seq && event.seq <= history_through_seq)
            .take(MAX_PUBLIC_DELTA_EVENTS)
            .map(|event| bounded_component(&event.summary))
            .filter(|summary| !summary.is_empty())
            .collect::<Vec<_>>();
        let stable_traits = stable_traits
            .into_iter()
            .take(MAX_STABLE_TRAITS)
            .map(|trait_text| bounded_component(&trait_text))
            .filter(|trait_text| !trait_text.is_empty())
            .collect::<Vec<_>>();
        let negative_constraints = evolution_negative_constraints(subject_kind)
            .into_iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let evaluation_profile =
            evaluation_profile(subject_kind, aspect_ratio, persisted_visual_description);
        let job_key = format!(
            "{subject_kind}:{subject_id}:level:{target_level}:revision:{target_revision}:prior:{}",
            &prior_asset_digest[..prior_asset_digest.len().min(12)]
        );
        let job = Self {
            schema_version: EVOLUTION_JOB_SCHEMA_VERSION,
            job_key,
            evaluation_profile,
            subject_kind: subject_kind.to_string(),
            subject_id,
            persisted_identity: bounded_component(persisted_identity),
            persisted_visual_description: bounded_component(persisted_visual_description),
            stable_traits,
            requested_changes,
            negative_constraints,
            prior_level,
            prior_asset_id,
            prior_asset_digest,
            prior_mime_type,
            prior_history_through_seq,
            history_from_seq,
            history_through_seq,
            target_level,
            target_revision,
            crop: aspect_ratio.to_string(),
            aspect_ratio: aspect_ratio.to_string(),
            profile: EVOLUTION_REFERENCE_PROFILE.to_string(),
            recipe_id: EVOLUTION_CANARY_RECIPE.to_string(),
            model_revision: EVOLUTION_CANARY_MODEL_REVISION.to_string(),
        };
        job.validate()?;
        Ok(job)
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if self.schema_version != EVOLUTION_JOB_SCHEMA_VERSION
            || !matches!(self.subject_kind.as_str(), "actor" | "item" | "location")
            || self.subject_id == 0
            || self.persisted_identity.trim().is_empty()
            || self.persisted_visual_description.trim().is_empty()
            || self.stable_traits.is_empty()
            || self.stable_traits.len() > MAX_STABLE_TRAITS
            || self.requested_changes.len() > MAX_PUBLIC_DELTA_EVENTS
            || self.negative_constraints.is_empty()
            || self.negative_constraints.len() > MAX_CONSTRAINTS
            || self.prior_level == 0
            || self.target_level <= self.prior_level
            || self.target_revision == 0
            || self.prior_asset_id.trim().is_empty()
            || !valid_sha256(&self.prior_asset_digest)
            || !crate::is_safe_image_content_type(&self.prior_mime_type)
            || self.history_from_seq != self.prior_history_through_seq.saturating_add(1)
            || self.history_through_seq < self.prior_history_through_seq
            || self.profile != EVOLUTION_REFERENCE_PROFILE
            || self.recipe_id != EVOLUTION_CANARY_RECIPE
            || self.model_revision != EVOLUTION_CANARY_MODEL_REVISION
            || self.aspect_ratio != self.crop
        {
            return Err("invalid frozen community-art evolution job".to_string());
        }
        if self
            .stable_traits
            .iter()
            .chain(&self.requested_changes)
            .chain(&self.negative_constraints)
            .any(|value| value.is_empty() || value.len() > MAX_COMPONENT_LENGTH)
        {
            return Err("evolution job contains an empty or overlong prompt component".to_string());
        }
        Ok(())
    }

    pub(super) fn prompt(&self) -> Result<String, String> {
        self.validate()?;
        let delta = if self.requested_changes.is_empty() {
            "No visible public change was committed after the prior image; make only a restrained level refinement."
                .to_string()
        } else {
            self.requested_changes.join("; ")
        };
        Ok(crate::compact_whitespace(&format!(
            "Evolve image 1 only. It is the approved prior-level image whose identity and composition are authoritative. Subject identity: {}. Persisted visual description: {}. Stable traits that must remain recognizable and unchanged: {}. Depict only this committed public history delta: {}. Target level {}, revision {}, crop {}. Do not infer game mechanics, unlisted possessions, relationships, locations, or off-snapshot facts. Negative constraints: {}.",
            self.persisted_identity,
            self.persisted_visual_description,
            self.stable_traits.join("; "),
            delta,
            self.target_level,
            self.target_revision,
            self.crop,
            self.negative_constraints.join("; "),
        )))
    }

    pub(super) fn digest(&self) -> Result<String, String> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|error| error.to_string())?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    pub(super) fn assert_prior_reference(
        &self,
        asset_id: &str,
        digest: &str,
    ) -> Result<(), String> {
        if self.prior_asset_id != asset_id || self.prior_asset_digest != digest {
            return Err(
                "approved prior-level asset changed after the evolution job was frozen".to_string(),
            );
        }
        Ok(())
    }
}

pub(super) fn evolution_rollout_route(
    job: &FrozenCommunityArtEvolutionJob,
    observation: Option<&EvolutionRuntimeObservation>,
) -> Result<EvolutionRolloutRoute, String> {
    job.validate()?;
    let document = evolution_canary_document()?;
    validate_canary_document(&document)?;
    let threshold = document
        .thresholds
        .get(&job.evaluation_profile)
        .ok_or_else(|| {
            format!(
                "evolution profile {} has no reviewed threshold",
                job.evaluation_profile
            )
        })?;
    if !corpus_profile_passes(&document, &job.evaluation_profile, threshold) {
        return Ok(EvolutionRolloutRoute::AutomaticRollback);
    }
    if let Some(observation) = observation {
        if observation.sample_count >= document.rollout.minimum_runtime_observations
            && document.rollout.automatic_disable
            && !metrics_pass(observation, threshold)
        {
            return Ok(EvolutionRolloutRoute::AutomaticRollback);
        }
    }
    match document.rollout.active_stage.as_str() {
        "off" => Ok(EvolutionRolloutRoute::Incumbent),
        "shadow" => Ok(EvolutionRolloutRoute::Shadow),
        "canary" => {
            let bucket = Sha256::digest(job.job_key.as_bytes())[0] % 100;
            if bucket < document.rollout.canary_percent {
                Ok(EvolutionRolloutRoute::Canary)
            } else {
                Ok(EvolutionRolloutRoute::Incumbent)
            }
        }
        stage => Err(format!("unknown evolution rollout stage {stage}")),
    }
}

pub(super) fn evolution_runtime_observation(
    profile: &str,
) -> Result<Option<EvolutionRuntimeObservation>, String> {
    let Ok(raw) = std::env::var("COSYWORLD_MEDIA_EVOLUTION_OBSERVATIONS_JSON") else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let observations: BTreeMap<String, EvolutionRuntimeObservation> = serde_json::from_str(&raw)
        .map_err(|error| format!("COSYWORLD_MEDIA_EVOLUTION_OBSERVATIONS_JSON: {error}"))?;
    Ok(observations.get(profile).cloned())
}

pub(super) fn stable_art_traits(
    subject_kind: &str,
    persisted_identity: &str,
    subject_details: &str,
) -> Vec<String> {
    let allowed_prefixes: &[&str] = match subject_kind {
        "actor" => &[
            "species:",
            "species appearance:",
            "origin:",
            "origin details:",
            "stable physical description:",
        ],
        "item" => &["item type:", "equipment role:", "size:"],
        "location" => &[
            "biome:",
            "terrain:",
            "reviewed landscape brief:",
            "defining aspects:",
        ],
        _ => &[],
    };
    let mut traits = subject_details
        .split(". ")
        .map(bounded_component)
        .filter(|component| {
            let normalized = component.to_ascii_lowercase();
            allowed_prefixes
                .iter()
                .any(|prefix| normalized.starts_with(prefix))
        })
        .take(MAX_STABLE_TRAITS.saturating_sub(1))
        .collect::<Vec<_>>();
    traits.insert(
        0,
        format!(
            "persisted identity: {}",
            bounded_component(persisted_identity)
        ),
    );
    traits
}

fn evolution_canary_document() -> Result<EvolutionCanaryDocument, String> {
    serde_json::from_str(EMBEDDED_EVOLUTION_CANARY)
        .map_err(|error| format!("embedded evolution canary: {error}"))
}

fn validate_canary_document(document: &EvolutionCanaryDocument) -> Result<(), String> {
    if document.schema_version != 1
        || document.reference_profile != EVOLUTION_REFERENCE_PROFILE
        || document.incumbent_recipe != EVOLUTION_INCUMBENT_RECIPE
        || document.candidate_recipe != EVOLUTION_CANARY_RECIPE
        || document.candidate_model_revision != EVOLUTION_CANARY_MODEL_REVISION
        || document.rollout.canary_percent > 100
        || document.rollout.minimum_runtime_observations == 0
        || !document.rollout.automatic_disable
        || document.rollout.rollback_route != "incumbent"
        || !document
            .rollout
            .completed_stages
            .iter()
            .any(|stage| stage == "shadow")
        || document.thresholds.is_empty()
        || document.corpus.is_empty()
    {
        return Err("invalid embedded evolution canary contract".to_string());
    }
    for case in &document.corpus {
        if case.id.trim().is_empty()
            || !matches!(case.subject_kind.as_str(), "actor" | "item" | "location")
            || !matches!(case.delta_size.as_str(), "small" | "large")
            || !matches!(case.lighting.as_str(), "dark" | "light")
            || case.reviewer_count < 3
            || !document.thresholds.contains_key(&case.evaluation_profile)
        {
            return Err(format!("invalid evolution corpus case {}", case.id));
        }
    }
    for (profile, threshold) in &document.thresholds {
        if !corpus_profile_passes(document, profile, threshold) {
            return Err(format!(
                "evolution candidate does not pass reviewed profile {profile}"
            ));
        }
    }
    Ok(())
}

fn corpus_profile_passes(
    document: &EvolutionCanaryDocument,
    profile: &str,
    threshold: &EvolutionThresholds,
) -> bool {
    let cases = document
        .corpus
        .iter()
        .filter(|case| case.evaluation_profile == profile)
        .collect::<Vec<_>>();
    if cases.len() < 2
        || !cases.iter().any(|case| case.delta_size == "small")
        || !cases.iter().any(|case| case.delta_size == "large")
    {
        return false;
    }
    cases.iter().all(|case| {
        candidate_metrics_pass(&case.candidate, threshold)
            && case.candidate.stable_trait >= case.incumbent.stable_trait
            && case.candidate.requested_change > case.incumbent.requested_change
            && case.candidate.blind_preference > case.incumbent.blind_preference
    })
}

fn candidate_metrics_pass(metrics: &EvolutionMetrics, threshold: &EvolutionThresholds) -> bool {
    metrics.stable_trait >= threshold.stable_trait_min
        && metrics.requested_change >= threshold.requested_change_min
        && metrics.style >= threshold.style_min
        && metrics.invention <= threshold.invention_max
        && metrics.composition >= threshold.composition_min
        && metrics.safety >= threshold.safety_min
        && metrics.blind_preference >= threshold.blind_preference_min
        && metrics.latency_p95_ms <= threshold.latency_p95_max_ms
        && metrics.cost_ratio <= threshold.cost_ratio_max
        && metrics.error_rate <= threshold.error_rate_max
        && metrics.retry_spend_ratio <= threshold.retry_spend_ratio_max
}

fn metrics_pass(metrics: &EvolutionRuntimeObservation, threshold: &EvolutionThresholds) -> bool {
    metrics.stable_trait >= threshold.stable_trait_min
        && metrics.requested_change >= threshold.requested_change_min
        && metrics.style >= threshold.style_min
        && metrics.invention <= threshold.invention_max
        && metrics.composition >= threshold.composition_min
        && metrics.safety >= threshold.safety_min
        && metrics.blind_preference >= threshold.blind_preference_min
        && metrics.latency_p95_ms <= threshold.latency_p95_max_ms
        && metrics.cost_ratio <= threshold.cost_ratio_max
        && metrics.error_rate <= threshold.error_rate_max
        && metrics.retry_spend_ratio <= threshold.retry_spend_ratio_max
}

fn evaluation_profile(subject_kind: &str, aspect_ratio: &str, description: &str) -> String {
    let composition = match (subject_kind, aspect_ratio) {
        ("actor", "2:3" | "3:4" | "4:5" | "9:16") => "portrait",
        ("item", "1:1") => "square",
        ("location", "16:9" | "3:2") => "wide",
        _ => "card",
    };
    let normalized = description.to_ascii_lowercase();
    let lighting = if ["dark", "night", "moon", "shadow", "cave"]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        "dark"
    } else {
        "light"
    };
    format!("{subject_kind}:{composition}:{lighting}")
}

fn evolution_negative_constraints(subject_kind: &str) -> Vec<&'static str> {
    let mut constraints = vec![
        "no text, letters, numbers, logos, watermark, UI, or card border",
        "no invented possessions, companions, relationships, or locations",
        "no game statistics, mechanics, rarity, class powers, or invisible state",
        "no identity, species, material, silhouette, or geography replacement",
        "no gore or photorealism",
    ];
    if subject_kind == "location" {
        constraints.push("no people, humanoids, characters, animals, or creatures");
    }
    constraints
}

fn bounded_component(value: &str) -> String {
    crate::compact_whitespace(value)
        .chars()
        .take(MAX_COMPONENT_LENGTH)
        .collect()
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> FrozenCommunityArtEvolutionJob {
        FrozenCommunityArtEvolutionJob::freeze(
            "actor",
            5000,
            "Moss, fox traveler",
            "rust-red fox with a white muzzle and green scarf",
            vec![
                "rust-red fur".to_string(),
                "white muzzle".to_string(),
                "green scarf".to_string(),
            ],
            &[
                PublicArtHistoryEvent {
                    seq: 18,
                    summary: "Moss wore a blue hat before the prior image.".to_string(),
                },
                PublicArtHistoryEvent {
                    seq: 20,
                    summary: "Moss planted a moonflower in public.".to_string(),
                },
                PublicArtHistoryEvent {
                    seq: 23,
                    summary: "Moss repaired the lantern arch.".to_string(),
                },
            ],
            1,
            "media-prior".to_string(),
            "a".repeat(64),
            "image/png".to_string(),
            19,
            23,
            2,
            1,
            "2:3",
        )
        .expect("freeze evolution job")
    }

    #[test]
    fn frozen_job_binds_prior_digest_public_delta_and_stable_traits() {
        let frozen = job();
        assert_eq!(frozen.history_from_seq, 20);
        assert_eq!(frozen.requested_changes.len(), 2);
        assert!(!frozen
            .requested_changes
            .iter()
            .any(|change| change.contains("blue hat")));
        assert!(frozen.prompt().unwrap().contains("Evolve image 1 only"));
        assert!(frozen.prompt().unwrap().contains("green scarf"));
        assert!(!frozen.prompt().unwrap().contains("game statistics:"));
        assert!(frozen
            .assert_prior_reference("media-prior", &"a".repeat(64))
            .is_ok());
        assert!(frozen
            .assert_prior_reference("media-other", &"a".repeat(64))
            .is_err());
    }

    #[test]
    fn stable_traits_exclude_mechanics_possessions_relationships_and_location() {
        let traits = stable_art_traits(
            "actor",
            "Moss — World Traveler",
            "authoritative level 4. species: Fox. species appearance: rust-red fur. stable physical description: white muzzle and green scarf. class gear and bearing: silver sword. calling: guard the baker. current setting: Moon Cave. carried and equipped items: crown",
        );
        let joined = traits.join(" | ");
        assert!(joined.contains("rust-red fur"));
        assert!(joined.contains("white muzzle and green scarf"));
        for excluded in [
            "level 4",
            "silver sword",
            "guard the baker",
            "Moon Cave",
            "crown",
        ] {
            assert!(
                !joined.contains(excluded),
                "{excluded} leaked into {joined}"
            );
        }
    }

    #[test]
    fn embedded_corpus_gates_every_profile_without_global_averaging() {
        let document = evolution_canary_document().expect("canary document");
        validate_canary_document(&document).expect("all profiles pass");
        assert!(document.thresholds.len() >= 6);
        for profile in document.thresholds.keys() {
            assert!(document
                .corpus
                .iter()
                .any(|case| case.evaluation_profile == *profile && case.delta_size == "small"));
            assert!(document
                .corpus
                .iter()
                .any(|case| case.evaluation_profile == *profile && case.delta_size == "large"));
        }
    }

    #[test]
    fn weak_runtime_profile_automatically_rolls_back_without_affecting_others() {
        let frozen = job();
        let weak = EvolutionRuntimeObservation {
            sample_count: 40,
            stable_trait: 0.40,
            requested_change: 0.95,
            style: 0.95,
            invention: 0.0,
            composition: 0.95,
            safety: 1.0,
            blind_preference: 0.80,
            latency_p95_ms: 40_000,
            cost_ratio: 1.0,
            error_rate: 0.0,
            retry_spend_ratio: 0.0,
        };
        assert_eq!(
            evolution_rollout_route(&frozen, Some(&weak)).unwrap(),
            EvolutionRolloutRoute::AutomaticRollback
        );
        let pending = EvolutionRuntimeObservation {
            sample_count: 1,
            ..weak
        };
        assert_ne!(
            evolution_rollout_route(&frozen, Some(&pending)).unwrap(),
            EvolutionRolloutRoute::AutomaticRollback
        );
    }

    #[test]
    fn malformed_or_unfrozen_jobs_fail_closed() {
        let mut frozen = job();
        frozen.prior_asset_digest = "not-a-digest".to_string();
        assert!(frozen.validate().is_err());
        frozen = job();
        frozen.history_from_seq += 1;
        assert!(frozen.validate().is_err());
        frozen = job();
        frozen.recipe_id = EVOLUTION_INCUMBENT_RECIPE.to_string();
        assert!(frozen.validate().is_err());
    }
}
