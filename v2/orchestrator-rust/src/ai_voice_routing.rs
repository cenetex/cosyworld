use crate::{
    ai_context::{PromptBudgetTelemetry, PromptEnvelope, PromptSegmentKind},
    ai_gateway::{
        request_chat_completion_with_selection, AiCompletion, AiConfig, AiGatewayError,
        ChatCompletionRequest, ModelCapability, PinnedModelSelection,
    },
    ai_publication::{
        append_ai_publication_attempt, certify_speech, publication_generation_id,
        score_speech_candidate, AiPublicationReceipt, CertifiedSpeech, PublicationCheckCode,
        PublicationRejection, SpeechCandidateScore, SpeechGateContext, SpeechMode,
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet, future::Future, io, path::Path, pin::Pin, sync::Arc, time::Duration,
};
use tokio::{task::JoinSet, time::Instant};

pub(crate) const VOICE_MAX_ATTEMPTS_ENV: &str = "COSYWORLD_AI_VOICE_MAX_ATTEMPTS";
pub(crate) const VOICE_HEDGE_WIDTH_ENV: &str = "COSYWORLD_AI_VOICE_HEDGE_WIDTH";
pub(crate) const VOICE_LATENCY_CEILING_MS_ENV: &str = "COSYWORLD_AI_VOICE_LATENCY_CEILING_MS";
pub(crate) const VOICE_SPEND_CEILING_MICRODOLLARS_ENV: &str =
    "COSYWORLD_AI_VOICE_SPEND_CEILING_MICRODOLLARS";
pub(crate) const VOICE_UNKNOWN_COST_MICRODOLLARS_ENV: &str =
    "COSYWORLD_AI_VOICE_UNKNOWN_COST_MICRODOLLARS";
pub(crate) const VOICE_EXPLORATION_FLOOR_BPS_ENV: &str = "COSYWORLD_AI_VOICE_EXPLORATION_FLOOR_BPS";

const MAX_VOICE_ATTEMPTS: u8 = 10;
const MAX_JOB_LEASE_RETRIES: u32 = 1;
const VOICE_RETRY_FEEDBACK_RESERVE_TOKENS: u32 = 96;

#[derive(Clone, Debug)]
pub(crate) struct VoiceRoutingConfig {
    pub(crate) max_attempts: u8,
    pub(crate) hedge_width: u8,
    pub(crate) latency_ceiling: Duration,
    pub(crate) spend_ceiling_microdollars: u64,
    pub(crate) unknown_cost_microdollars: u64,
    pub(crate) exploration_floor: f64,
}

impl Default for VoiceRoutingConfig {
    fn default() -> Self {
        Self {
            max_attempts: 2,
            hedge_width: 1,
            latency_ceiling: Duration::from_secs(12),
            spend_ceiling_microdollars: 2_000,
            unknown_cost_microdollars: 250,
            exploration_floor: 0.05,
        }
    }
}

impl VoiceRoutingConfig {
    pub(crate) fn from_env() -> Result<Self, String> {
        let defaults = Self::default();
        let max_attempts = env_integer(
            VOICE_MAX_ATTEMPTS_ENV,
            defaults.max_attempts as u64,
            1,
            MAX_VOICE_ATTEMPTS as u64,
        )? as u8;
        let hedge_width = env_integer(
            VOICE_HEDGE_WIDTH_ENV,
            defaults.hedge_width as u64,
            1,
            MAX_VOICE_ATTEMPTS as u64,
        )? as u8;
        if hedge_width > max_attempts {
            return Err(format!(
                "{VOICE_HEDGE_WIDTH_ENV} must not exceed {VOICE_MAX_ATTEMPTS_ENV}"
            ));
        }
        let latency_ceiling = Duration::from_millis(env_integer(
            VOICE_LATENCY_CEILING_MS_ENV,
            defaults.latency_ceiling.as_millis() as u64,
            100,
            60_000,
        )?);
        let spend_ceiling_microdollars = env_integer(
            VOICE_SPEND_CEILING_MICRODOLLARS_ENV,
            defaults.spend_ceiling_microdollars,
            1,
            1_000_000,
        )?;
        let unknown_cost_microdollars = env_integer(
            VOICE_UNKNOWN_COST_MICRODOLLARS_ENV,
            defaults.unknown_cost_microdollars,
            1,
            1_000_000,
        )?;
        let exploration_floor_bps = env_integer(
            VOICE_EXPLORATION_FLOOR_BPS_ENV,
            (defaults.exploration_floor * 10_000.0) as u64,
            1,
            5_000,
        )?;
        Ok(Self {
            max_attempts,
            hedge_width,
            latency_ceiling,
            spend_ceiling_microdollars,
            unknown_cost_microdollars,
            exploration_floor: exploration_floor_bps as f64 / 10_000.0,
        })
    }
}

fn env_integer(name: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
    let Some(raw) = std::env::var(name).ok() else {
        return Ok(default);
    };
    let value = raw
        .trim()
        .parse::<u64>()
        .map_err(|_| format!("{name} must be an integer from {min} to {max}"))?;
    if !(min..=max).contains(&value) {
        return Err(format!("{name} must be from {min} to {max}"));
    }
    Ok(value)
}

#[derive(Clone, Debug)]
pub(crate) struct VoiceAttemptRequest {
    pub(crate) feature: &'static str,
    pub(crate) prompt_version: &'static str,
    pub(crate) prompt: PromptEnvelope,
    pub(crate) temperature: f64,
    pub(crate) max_tokens: u32,
    pub(crate) referer: &'static str,
    pub(crate) model_binding: Option<crate::content_load::SeedActorModelBinding>,
    pub(crate) room_id: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct VoiceRoutingError {
    code: &'static str,
    rejections: Vec<PublicationRejection>,
}

impl VoiceRoutingError {
    pub(crate) fn code(&self) -> &'static str {
        self.code
    }

    pub(crate) fn rejections(&self) -> &[PublicationRejection] {
        &self.rejections
    }
}

impl std::fmt::Display for VoiceRoutingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct VoiceSelectionDecision {
    pub(crate) ordinal: u8,
    pub(crate) requested_model_id: String,
    pub(crate) provider: String,
    pub(crate) model_id: String,
    pub(crate) model_revision: String,
    pub(crate) family: String,
    pub(crate) prompt_adapter_id: String,
    pub(crate) prompt_adapter_version: String,
    pub(crate) feature: String,
    pub(crate) speech_mode: String,
    pub(crate) content_passed: u64,
    pub(crate) content_failed: u64,
    pub(crate) beta_pass_probability: f64,
    pub(crate) affinity: f64,
    pub(crate) novelty: f64,
    pub(crate) provider_health: f64,
    pub(crate) latency_weight: f64,
    pub(crate) cost_weight: f64,
    pub(crate) exploration_floor: f64,
    pub(crate) final_weight: f64,
    pub(crate) random_unit: f64,
    pub(crate) weighted_key: f64,
    pub(crate) estimated_cost_microdollars: u64,
    #[serde(default)]
    pub(crate) prompt_budget: PromptBudgetTelemetry,
    pub(crate) selected: bool,
    /// True when this attempt reuses an already-planned model to fill the
    /// attempt budget, because the registry pinned fewer distinct candidates
    /// than the budget allows. Recorded so telemetry can tell a genuinely
    /// diverse cast apart from a thin pool being resampled.
    ///
    /// Defaulted so `decision_json` rows written before this field existed
    /// still deserialize.
    #[serde(default)]
    pub(crate) resampled: bool,
    pub(crate) excluded_reason: Option<String>,
}

#[derive(Clone)]
struct PlannedCandidate {
    selection: PinnedModelSelection,
    decision: VoiceSelectionDecision,
    retry_feedback_cost_microdollars: u64,
}

struct RankedCertifiedCandidate {
    candidate: PlannedCandidate,
    speech: CertifiedSpeech,
    score: SpeechCandidateScore,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct ContentEvidence {
    passed: u64,
    failed: u64,
}

#[derive(Clone, Debug, Default)]
struct ProviderHealth {
    consecutive_failures: u64,
    cooldown_until_ms: u64,
}

type VoiceAttemptFuture =
    Pin<Box<dyn Future<Output = Result<AiCompletion, AiGatewayError>> + Send>>;

trait VoiceAttemptBackend: Send + Sync {
    fn attempt(
        &self,
        selection: PinnedModelSelection,
        request: VoiceAttemptRequest,
        timeout: Duration,
    ) -> VoiceAttemptFuture;
}

#[derive(Clone)]
struct GatewayVoiceBackend {
    config: AiConfig,
}

impl VoiceAttemptBackend for GatewayVoiceBackend {
    fn attempt(
        &self,
        selection: PinnedModelSelection,
        request: VoiceAttemptRequest,
        timeout: Duration,
    ) -> VoiceAttemptFuture {
        let config = self.config.clone();
        Box::pin(async move {
            let rendered = request
                .prompt
                .render_for(selection.candidate().context_limit(), request.max_tokens);
            request_chat_completion_with_selection(
                &config,
                ChatCompletionRequest {
                    feature: request.feature,
                    prompt_version: request.prompt_version,
                    capability: ModelCapability::Voice,
                    system: &rendered.system,
                    user: &rendered.user,
                    temperature: request.temperature,
                    max_tokens: request.max_tokens,
                    timeout,
                    max_attempts: 1,
                    referer: request.referer,
                    response_format: None,
                    room_id: request.room_id,
                },
                &selection,
            )
            .await
        })
    }
}

pub(crate) async fn route_certified_voice(
    config: &AiConfig,
    store_path: Option<&Path>,
    request: VoiceAttemptRequest,
    gate: SpeechGateContext,
) -> Result<CertifiedSpeech, VoiceRoutingError> {
    let backend = Arc::new(GatewayVoiceBackend {
        config: config.clone(),
    });
    route_certified_voice_with(config, store_path, request, gate, backend).await
}

async fn route_certified_voice_with(
    config: &AiConfig,
    store_path: Option<&Path>,
    request: VoiceAttemptRequest,
    gate: SpeechGateContext,
    backend: Arc<dyn VoiceAttemptBackend>,
) -> Result<CertifiedSpeech, VoiceRoutingError> {
    let generation_id = publication_generation_id(&gate, request.prompt_version);
    let owner = crate::random_hex(12);
    if let Some(path) = store_path {
        match claim_voice_job(
            path,
            &generation_id,
            &gate.generation_key,
            request.feature,
            gate.mode.as_str(),
            &owner,
            &config.voice_routing,
        )
        .map_err(|_| routing_error("voice_job_store_unavailable", Vec::new()))?
        {
            JobClaim::Acquired => {}
            JobClaim::Accepted(speech) => return Ok(*speech),
            JobClaim::InFlight => {
                return Err(routing_error("voice_generation_in_flight", Vec::new()))
            }
            JobClaim::Unavailable(code) => {
                return Err(routing_error(stable_terminal_code(code), Vec::new()))
            }
        }
    }

    let candidates = match request.model_binding.as_ref() {
        Some(binding) => vec![config
            .pin_actor_model(binding)
            .map_err(|_| routing_error("voice_no_eligible_candidates", Vec::new()))?],
        None => config
            .pin_models(ModelCapability::Voice)
            .map_err(|_| routing_error("voice_no_eligible_candidates", Vec::new()))?,
    };
    let (planned, decisions) = build_voice_plan(
        store_path,
        &generation_id,
        gate.speaker_actor_id,
        gate.mode.as_str(),
        &request,
        &config.voice_routing,
        candidates,
    )
    .map_err(|_| routing_error("voice_job_store_unavailable", Vec::new()))?;
    if let Some(path) = store_path {
        persist_voice_plan(path, &generation_id, &decisions)
            .map_err(|_| routing_error("voice_job_store_unavailable", Vec::new()))?;
    }
    if planned.is_empty() {
        let code = if decisions
            .iter()
            .any(|decision| decision.excluded_reason.as_deref() == Some("spend_ceiling"))
        {
            "voice_spend_exhausted"
        } else {
            "voice_no_eligible_candidates"
        };
        finish_voice_job_unavailable(store_path, &generation_id, &owner, code);
        return Err(routing_error(code, Vec::new()));
    }

    let started = Instant::now();
    let mut rejections = Vec::new();
    let mut provider_failures = 0usize;
    let mut next_candidate = 0usize;
    let mut first_batch = true;
    let mut certified_candidates = Vec::new();
    'generation: while next_candidate < planned.len() {
        let remaining_candidates = planned.len() - next_candidate;
        let available_to_batch =
            if first_batch && (config.voice_routing.hedge_width as usize) < remaining_candidates {
                remaining_candidates - 1
            } else {
                remaining_candidates
            };
        let batch_width = (config.voice_routing.hedge_width as usize)
            .min(available_to_batch)
            .max(1);
        let batch_end = next_candidate + batch_width;
        let batch = &planned[next_candidate..batch_end];
        next_candidate = batch_end;
        first_batch = false;
        let elapsed = started.elapsed();
        let Some(remaining) = config.voice_routing.latency_ceiling.checked_sub(elapsed) else {
            mark_timed_out_batch(store_path, &generation_id, batch, &BTreeSet::new());
            if !certified_candidates.is_empty() {
                break 'generation;
            }
            let code = "voice_latency_exhausted";
            finish_voice_job_unavailable(store_path, &generation_id, &owner, code);
            return Err(routing_error(code, rejections));
        };
        let mut attempts = JoinSet::new();
        let mut completed_ordinals = BTreeSet::new();
        for candidate in batch.iter().cloned() {
            let backend = Arc::clone(&backend);
            let request = request_with_retry_feedback(&request, &rejections, &gate);
            attempts.spawn(async move {
                let result = backend
                    .attempt(candidate.selection.clone(), request, remaining)
                    .await;
                (candidate, result)
            });
        }

        while !attempts.is_empty() {
            let elapsed = started.elapsed();
            let Some(remaining) = config.voice_routing.latency_ceiling.checked_sub(elapsed) else {
                attempts.abort_all();
                mark_timed_out_batch(store_path, &generation_id, batch, &completed_ordinals);
                if !certified_candidates.is_empty() {
                    break 'generation;
                }
                let code = "voice_latency_exhausted";
                finish_voice_job_unavailable(store_path, &generation_id, &owner, code);
                return Err(routing_error(code, rejections));
            };
            let joined = tokio::time::timeout(remaining, attempts.join_next()).await;
            let Some(joined) = joined.ok().flatten() else {
                attempts.abort_all();
                mark_timed_out_batch(store_path, &generation_id, batch, &completed_ordinals);
                if !certified_candidates.is_empty() {
                    break 'generation;
                }
                let code = "voice_latency_exhausted";
                finish_voice_job_unavailable(store_path, &generation_id, &owner, code);
                return Err(routing_error(code, rejections));
            };
            let Ok((candidate, result)) = joined else {
                provider_failures += 1;
                tracing::warn!(
                    generation_id = %generation_id,
                    feature = request.feature,
                    "AI voice attempt task did not complete (panicked or was aborted)"
                );
                continue;
            };
            completed_ordinals.insert(candidate.decision.ordinal);
            match result {
                Err(error) => {
                    provider_failures += 1;
                    // The aggregate `voice_provider_unavailable`/`voice_candidates_exhausted`
                    // codes logged by the caller say a generation failed, not why. Without
                    // this, diagnosing a real outage versus a client-side bug means
                    // reproducing the failure locally instead of reading a log line.
                    tracing::warn!(
                        generation_id = %generation_id,
                        feature = request.feature,
                        candidate_round = candidate.decision.ordinal,
                        provider = %candidate.decision.provider,
                        requested_model = %candidate.decision.requested_model_id,
                        error_code = error.code(),
                        error = %error,
                        "AI voice attempt failed at the provider"
                    );
                    if error.affects_provider_health() {
                        record_provider_failure(
                            store_path,
                            &candidate.decision.provider,
                            &candidate.decision.requested_model_id,
                            error.code(),
                        );
                    }
                    record_decision_result(
                        store_path,
                        &generation_id,
                        candidate.decision.ordinal,
                        "provider_failure",
                        Some(error.code()),
                    );
                }
                Ok(completion) => {
                    record_provider_success(
                        store_path,
                        &candidate.decision.provider,
                        &candidate.decision.requested_model_id,
                    );
                    let mut candidate_gate = gate.clone();
                    candidate_gate.candidate_round = candidate.decision.ordinal;
                    let text = completion.text.clone();
                    match certify_speech(Some(config), completion, &text, candidate_gate) {
                        Err(rejection) => {
                            if let Some(path) = store_path {
                                let _ = append_ai_publication_attempt(
                                    path,
                                    &rejection.receipt,
                                    "rejected",
                                    Some(rejection.failure_code.as_str()),
                                );
                            }
                            record_content_result(
                                store_path,
                                &candidate.decision,
                                rejection.receipt.model_attribution.as_ref(),
                                false,
                            );
                            record_decision_result(
                                store_path,
                                &generation_id,
                                candidate.decision.ordinal,
                                "rejected",
                                Some(rejection.failure_code.as_str()),
                            );
                            rejections.push(*rejection);
                        }
                        Ok(speech) => {
                            if let Some(path) = store_path {
                                let _ = append_ai_publication_attempt(
                                    path,
                                    speech.receipt(),
                                    "certified",
                                    None,
                                );
                            }
                            record_content_result(
                                store_path,
                                &candidate.decision,
                                speech.receipt().model_attribution.as_ref(),
                                true,
                            );
                            let score = score_speech_candidate(speech.text(), &gate);
                            tracing::info!(
                                generation_id = %generation_id,
                                candidate_round = candidate.decision.ordinal,
                                anchor_matches = score.anchor_matches,
                                narrative_preference_matches = score.narrative_preference_matches,
                                novelty_bps = score.novelty_bps,
                                lexical_diversity_bps = score.lexical_diversity_bps,
                                "AI voice candidate passed the gate and entered ranking"
                            );
                            record_decision_result(
                                store_path,
                                &generation_id,
                                candidate.decision.ordinal,
                                "certified",
                                None,
                            );
                            certified_candidates.push(RankedCertifiedCandidate {
                                candidate,
                                speech,
                                score,
                            });
                        }
                    }
                }
            }
        }
        if !certified_candidates.is_empty() {
            break 'generation;
        }
    }

    if !certified_candidates.is_empty() {
        let certified_pool_size = certified_candidates.len();
        let winner_index = certified_candidates
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| {
                left.score.cmp(&right.score).then_with(|| {
                    right
                        .speech
                        .receipt()
                        .candidate_id
                        .cmp(&left.speech.receipt().candidate_id)
                })
            })
            .map(|(index, _)| index)
            .expect("non-empty certified candidate pool has a winner");
        let winner = certified_candidates.swap_remove(winner_index);
        for loser in certified_candidates {
            record_decision_result(
                store_path,
                &generation_id,
                loser.candidate.decision.ordinal,
                "certified_loser",
                None,
            );
        }
        let speech = winner.speech.with_prior_rejections(rejections.clone());
        tracing::info!(
            generation_id = %generation_id,
            candidate_round = winner.candidate.decision.ordinal,
            certified_pool_size,
            anchor_matches = winner.score.anchor_matches,
            narrative_preference_matches = winner.score.narrative_preference_matches,
            novelty_bps = winner.score.novelty_bps,
            lexical_diversity_bps = winner.score.lexical_diversity_bps,
            "selected the highest-ranked certified AI voice candidate"
        );
        if accept_voice_job(
            store_path,
            &generation_id,
            &owner,
            &winner.candidate.decision.family,
            &speech,
        ) {
            record_decision_result(
                store_path,
                &generation_id,
                winner.candidate.decision.ordinal,
                "accepted",
                None,
            );
            return Ok(speech);
        }
        record_decision_result(
            store_path,
            &generation_id,
            winner.candidate.decision.ordinal,
            "certified_loser",
            None,
        );
        if let Some(cached) = load_accepted_voice_job(store_path, &generation_id) {
            return Ok(cached);
        }
        let code = "voice_job_store_unavailable";
        finish_voice_job_unavailable(store_path, &generation_id, &owner, code);
        return Err(routing_error(code, rejections));
    }

    let code = if provider_failures == planned.len() {
        "voice_provider_unavailable"
    } else {
        "voice_candidates_exhausted"
    };
    finish_voice_job_unavailable(store_path, &generation_id, &owner, code);
    Err(routing_error(code, rejections))
}

fn request_with_retry_feedback(
    request: &VoiceAttemptRequest,
    rejections: &[PublicationRejection],
    gate: &SpeechGateContext,
) -> VoiceAttemptRequest {
    let mut request = request.clone();
    if let Some(instruction) = retry_instruction(rejections, gate, request.max_tokens) {
        request.prompt = if gate.mode == SpeechMode::Raw {
            request
                .prompt
                .user(instruction, PromptSegmentKind::Envelope, u8::MAX, true)
        } else {
            request.prompt.system(instruction)
        };
    }
    request
}

fn retry_instruction(
    rejections: &[PublicationRejection],
    gate: &SpeechGateContext,
    max_tokens: u32,
) -> Option<String> {
    let failed = rejections
        .iter()
        .flat_map(|rejection| rejection.receipt.checks.iter())
        .filter_map(|check| (!check.passed).then_some(check.code))
        .collect::<BTreeSet<_>>();
    if failed.is_empty()
        || failed
            .iter()
            .all(|code| *code == PublicationCheckCode::VoiceEnvelopeInvalid)
    {
        return None;
    }

    let mut clauses = Vec::new();
    let needs_complete_shape = failed.iter().any(|code| {
        matches!(
            code,
            PublicationCheckCode::VoiceEmpty
                | PublicationCheckCode::VoiceBudgetExceeded
                | PublicationCheckCode::VoiceFinishIncomplete
        )
    });
    if needs_complete_shape {
        clauses.push(match gate.mode {
            SpeechMode::Prose => {
                format!("one short complete line · at most {} words", gate.max_words)
            }
            SpeechMode::EmojiOnly => "3–6 emoji only".to_string(),
            SpeechMode::EmoteOnly => {
                format!("one complete *emote* · at most {} words", gate.max_words)
            }
            SpeechMode::Raw => {
                let conservative_words = gate.max_words.min((max_tokens as usize / 2).clamp(8, 64));
                format!("one complete response · at most {conservative_words} words")
            }
        });
    }
    // Repetition is enforced only by the deterministic publication gate.
    // Rejected wording never goes back into the model prompt.
    if failed.contains(&PublicationCheckCode::VoiceMultipleSpeakers) {
        clauses.push("one voice · no speaker labels".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceInstructionLeakage) {
        clauses.push("spoken words only · no meta".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceModeMismatch) && !needs_complete_shape {
        clauses.push(
            match gate.mode {
                SpeechMode::Prose => "spoken prose only",
                SpeechMode::EmojiOnly => "emoji only",
                SpeechMode::EmoteOnly => "one emote only",
                SpeechMode::Raw => "plain response only",
            }
            .to_string(),
        );
    }
    if failed.contains(&PublicationCheckCode::VoiceAnchorMissing) {
        clauses.push("touch something already present".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceUnsafeTone) {
        clauses.push("keep it gentle".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceProposedActionClaim) {
        clauses.push("intention, not completed action".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceObjectAgency) {
        clauses.push("objects don't think or choose".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceSignpostOpening) {
        clauses.push("start with a person, object, action, or sensation · mention the place later only if it matters".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceQuestionMonoculture) {
        clauses.push("make a concrete statement, observation, intention, joke, or disagreement · no rhetorical question".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceBeatFormMismatch) {
        if let Some(form) = gate.requirements.required_form {
            clauses.push(format!("beat form {}", form.as_str()));
        }
    }
    if failed.contains(&PublicationCheckCode::VoiceTerminalAphorism) {
        clauses.push("no closing maxim".to_string());
    }
    if failed.contains(&PublicationCheckCode::VoiceUnbackedActionIntent)
        || failed.contains(&PublicationCheckCode::VoiceActionBudgetExceeded)
    {
        clauses.push(
            "announce an action only when the action exists; otherwise name the blocker"
                .to_string(),
        );
    }
    if failed.contains(&PublicationCheckCode::VoiceAnomalyOmitted) {
        clauses.push("state each supplied anomaly plainly".to_string());
    }
    (!clauses.is_empty()).then(|| format!("again · {}", clauses.join(" · ")))
}

fn routing_error(code: &'static str, rejections: Vec<PublicationRejection>) -> VoiceRoutingError {
    VoiceRoutingError { code, rejections }
}

fn stable_terminal_code(value: String) -> &'static str {
    match value.as_str() {
        "voice_spend_exhausted" => "voice_spend_exhausted",
        "voice_latency_exhausted" => "voice_latency_exhausted",
        "voice_provider_unavailable" => "voice_provider_unavailable",
        "voice_candidates_exhausted" => "voice_candidates_exhausted",
        "voice_job_retry_exhausted" => "voice_job_retry_exhausted",
        _ => "voice_no_eligible_candidates",
    }
}

fn build_voice_plan(
    store_path: Option<&Path>,
    generation_id: &str,
    actor_id: u64,
    speech_mode: &str,
    request: &VoiceAttemptRequest,
    config: &VoiceRoutingConfig,
    candidates: Vec<PinnedModelSelection>,
) -> io::Result<(Vec<PlannedCandidate>, Vec<VoiceSelectionDecision>)> {
    let now = crate::now_millis();
    let mut decisions = candidates
        .into_iter()
        .map(|selection| {
            let candidate = selection.candidate();
            let concrete = candidate.concrete_model();
            let model_id = concrete
                .map(|identity| identity.model_id.clone())
                .unwrap_or_else(|| selection.requested_model_id().to_string());
            let model_revision = concrete
                .and_then(|identity| identity.revision.clone())
                .unwrap_or_default();
            let adapter = candidate.prompt_adapter();
            let evidence = content_evidence(
                store_path,
                &model_id,
                &model_revision,
                &adapter.id,
                &adapter.version,
                speech_mode,
                request.feature,
            )?;
            let observed = candidate.observations();
            let history = observed.gate_history.get(&ModelCapability::Voice);
            let passed = evidence.passed + history.map(|value| value.passed).unwrap_or_default();
            let failed = evidence.failed + history.map(|value| value.failed).unwrap_or_default();
            let beta_pass_probability = (passed as f64 + 1.0) / (passed + failed + 2) as f64;
            let family = candidate
                .family()
                .unwrap_or(selection.requested_model_id())
                .to_string();
            let family_accepts = accepted_family_count(store_path, &family)?;
            let novelty = 1.0 / (1.0 + family_accepts as f64 * 0.25);
            let affinity = stable_affinity(actor_id, &family);
            let health = provider_health(
                store_path,
                candidate.provider(),
                selection.requested_model_id(),
            )?;
            let availability = observed.availability_ratio.unwrap_or(1.0);
            let provider_health = availability / (1.0 + health.consecutive_failures as f64 * 0.5);
            let latency_ms = observed.latency_p50_ms.unwrap_or(1_000).max(1) as f64;
            let ceiling_ms = config.latency_ceiling.as_millis().max(1) as f64;
            let latency_weight = ceiling_ms / (ceiling_ms + latency_ms);
            let rendered = request
                .prompt
                .render_for(candidate.context_limit(), request.max_tokens);
            let estimated_cost_microdollars = estimated_cost(
                observed.input_cost_per_million,
                observed.output_cost_per_million,
                request,
                &rendered.telemetry,
                config.unknown_cost_microdollars,
            );
            let spend = config.spend_ceiling_microdollars.max(1) as f64;
            let cost_weight = spend / (spend + estimated_cost_microdollars as f64);
            let raw_weight = beta_pass_probability
                * affinity
                * novelty
                * provider_health
                * latency_weight
                * cost_weight;
            let final_weight = raw_weight.max(config.exploration_floor);
            let random_unit = stable_random_unit(
                generation_id,
                selection.requested_model_id(),
                request.feature,
            );
            let weighted_key = -random_unit.ln() / final_weight;
            let excluded_reason =
                (health.cooldown_until_ms > now).then(|| "provider_cooldown".to_string());
            Ok((
                selection.clone(),
                VoiceSelectionDecision {
                    ordinal: 0,
                    requested_model_id: candidate.requested_model_id().to_string(),
                    provider: candidate.provider().to_string(),
                    model_id,
                    model_revision,
                    family,
                    prompt_adapter_id: adapter.id.clone(),
                    prompt_adapter_version: adapter.version.clone(),
                    feature: request.feature.to_string(),
                    speech_mode: speech_mode.to_string(),
                    content_passed: passed,
                    content_failed: failed,
                    beta_pass_probability,
                    affinity,
                    novelty,
                    provider_health,
                    latency_weight,
                    cost_weight,
                    exploration_floor: config.exploration_floor,
                    final_weight,
                    random_unit,
                    weighted_key,
                    estimated_cost_microdollars,
                    prompt_budget: rendered.telemetry,
                    selected: false,
                    resampled: false,
                    excluded_reason,
                },
            ))
        })
        .collect::<io::Result<Vec<_>>>()?;
    decisions.sort_by(|left, right| {
        left.1
            .weighted_key
            .total_cmp(&right.1.weighted_key)
            .then_with(|| left.1.requested_model_id.cmp(&right.1.requested_model_id))
    });

    let mut planned = Vec::new();
    let mut all = Vec::with_capacity(decisions.len());
    for (selection, mut decision) in decisions {
        if decision.excluded_reason.is_none() && planned.len() < config.max_attempts as usize {
            decision.selected = true;
            decision.ordinal = planned.len() as u8 + 1;
            let candidate = PlannedCandidate {
                retry_feedback_cost_microdollars: estimated_retry_feedback_cost(
                    selection.candidate().observations().input_cost_per_million,
                ),
                selection,
                decision: decision.clone(),
            };
            let mut prospective = planned.clone();
            prospective.push(candidate.clone());
            if planned_spend_microdollars(&prospective, config.hedge_width)
                <= config.spend_ceiling_microdollars
            {
                planned.push(candidate);
            } else {
                decision.selected = false;
                decision.ordinal = 0;
                decision.excluded_reason = Some("spend_ceiling".to_string());
            }
        } else if decision.excluded_reason.is_none() {
            decision.excluded_reason = Some("attempt_budget".to_string());
        }
        all.push(decision);
    }

    // A thin candidate pool must not silence a resident. Every publication gate
    // gets its verdict from one sampled completion, so a single rejection is a
    // property of that sample rather than of the model. When the registry pins
    // fewer distinct models than the attempt budget allows, resample the best
    // planned candidate to fill the remaining attempts. The gates still judge
    // every sample independently and no rejected bytes become observable; this
    // only stops one unlucky sample from being terminal. Still bounded by the
    // spend ceiling, so the cost envelope is unchanged.
    if !planned.is_empty() && planned.len() < config.max_attempts as usize {
        let mut ordinal = planned.len() as u8;
        while planned.len() < config.max_attempts as usize {
            let source = planned[0].clone();
            ordinal += 1;
            let mut decision = source.decision.clone();
            decision.selected = true;
            decision.ordinal = ordinal;
            decision.resampled = true;
            let candidate = PlannedCandidate {
                selection: source.selection.clone(),
                decision: decision.clone(),
                retry_feedback_cost_microdollars: source.retry_feedback_cost_microdollars,
            };
            let mut prospective = planned.clone();
            prospective.push(candidate.clone());
            if planned_spend_microdollars(&prospective, config.hedge_width)
                > config.spend_ceiling_microdollars
            {
                break;
            }
            planned.push(candidate);
            all.push(decision);
        }
    }

    Ok((planned, all))
}

fn estimated_cost(
    input_rate: Option<f64>,
    output_rate: Option<f64>,
    request: &VoiceAttemptRequest,
    prompt_budget: &PromptBudgetTelemetry,
    unknown: u64,
) -> u64 {
    let (Some(input_rate), Some(output_rate)) = (input_rate, output_rate) else {
        return unknown;
    };
    let input_tokens = prompt_budget.estimated_prompt_tokens.max(1) as usize;
    (input_rate * input_tokens as f64 + output_rate * request.max_tokens as f64)
        .ceil()
        .max(1.0) as u64
}

fn estimated_retry_feedback_cost(input_rate: Option<f64>) -> u64 {
    input_rate
        .map(|rate| {
            (rate * VOICE_RETRY_FEEDBACK_RESERVE_TOKENS as f64)
                .ceil()
                .max(0.0) as u64
        })
        .unwrap_or_default()
}

fn planned_spend_microdollars(planned: &[PlannedCandidate], hedge_width: u8) -> u64 {
    let first_batch_width = match planned.len() {
        0 => 0,
        1 => 1,
        len => (hedge_width as usize).min(len - 1).max(1),
    };
    planned
        .iter()
        .enumerate()
        .fold(0u64, |spent, (index, candidate)| {
            let feedback_cost = if index < first_batch_width {
                0
            } else {
                candidate.retry_feedback_cost_microdollars
            };
            spent
                .saturating_add(candidate.decision.estimated_cost_microdollars)
                .saturating_add(feedback_cost)
        })
}

fn stable_affinity(actor_id: u64, family: &str) -> f64 {
    let value = stable_u64(&format!("affinity\0{actor_id}\0{family}")) % 31;
    0.85 + value as f64 / 100.0
}

fn stable_random_unit(generation_id: &str, model: &str, feature: &str) -> f64 {
    let value = stable_u64(&format!("{generation_id}\0{model}\0{feature}"));
    (value as f64 + 1.0) / (u64::MAX as f64 + 2.0)
}

fn stable_u64(value: &str) -> u64 {
    let digest = Sha256::digest(value.as_bytes());
    u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 prefix"))
}

enum JobClaim {
    Acquired,
    Accepted(Box<CertifiedSpeech>),
    InFlight,
    Unavailable(String),
}

pub(crate) fn init_ai_voice_routing_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_voice_jobs (
            generation_id TEXT PRIMARY KEY,
            generation_key TEXT NOT NULL,
            feature TEXT NOT NULL,
            speech_mode TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'unavailable')),
            lease_owner TEXT,
            lease_expires_ms INTEGER NOT NULL DEFAULT 0,
            lease_retries INTEGER NOT NULL DEFAULT 0,
            policy_json TEXT NOT NULL,
            decisions_json TEXT,
            accepted_text TEXT,
            accepted_reasoning_trace TEXT,
            accepted_receipt_json TEXT,
            terminal_code TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_voice_attempt_decisions (
            generation_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            requested_model_id TEXT NOT NULL,
            decision_json TEXT NOT NULL,
            result TEXT NOT NULL DEFAULT 'selected',
            result_code TEXT,
            PRIMARY KEY(generation_id, ordinal)
        );
        CREATE TABLE IF NOT EXISTS ai_voice_content_evidence (
            model_id TEXT NOT NULL,
            model_revision TEXT NOT NULL,
            prompt_adapter_id TEXT NOT NULL,
            prompt_adapter_version TEXT NOT NULL,
            speech_mode TEXT NOT NULL,
            feature TEXT NOT NULL,
            passed INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(model_id, model_revision, prompt_adapter_id,
                        prompt_adapter_version, speech_mode, feature)
        );
        CREATE TABLE IF NOT EXISTS ai_voice_provider_health (
            provider TEXT NOT NULL,
            requested_model_id TEXT NOT NULL,
            successes INTEGER NOT NULL DEFAULT 0,
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            cooldown_until_ms INTEGER NOT NULL DEFAULT 0,
            last_error_code TEXT,
            PRIMARY KEY(provider, requested_model_id)
        );
        CREATE TABLE IF NOT EXISTS ai_voice_family_accepts (
            generation_id TEXT PRIMARY KEY,
            family TEXT NOT NULL,
            accepted_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_voice_family_accepts_family
            ON ai_voice_family_accepts(family);",
    )
    .map_err(crate::sqlite_error)?;
    ensure_ai_voice_job_column(
        conn,
        "accepted_reasoning_trace",
        "ALTER TABLE ai_voice_jobs ADD COLUMN accepted_reasoning_trace TEXT",
    )
}

fn ensure_ai_voice_job_column(conn: &Connection, column: &str, alter_sql: &str) -> io::Result<()> {
    let mut statement = conn
        .prepare("PRAGMA table_info(ai_voice_jobs)")
        .map_err(crate::sqlite_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(crate::sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(crate::sqlite_error)?;
    if !columns.iter().any(|existing| existing == column) {
        conn.execute_batch(alter_sql).map_err(crate::sqlite_error)?;
    }
    Ok(())
}

fn claim_voice_job(
    path: &Path,
    generation_id: &str,
    generation_key: &str,
    feature: &str,
    speech_mode: &str,
    owner: &str,
    policy: &VoiceRoutingConfig,
) -> io::Result<JobClaim> {
    crate::init_event_store(path)?;
    let mut conn = crate::open_event_store(path)?;
    let tx = conn.transaction().map_err(crate::sqlite_error)?;
    let now = crate::now_millis();
    let lease_expires = now.saturating_add(policy.latency_ceiling.as_millis() as u64 + 2_000);
    let policy_json = serde_json::json!({
        "max_attempts": policy.max_attempts,
        "hedge_width": policy.hedge_width,
        "latency_ceiling_ms": policy.latency_ceiling.as_millis(),
        "spend_ceiling_microdollars": policy.spend_ceiling_microdollars,
        "unknown_cost_microdollars": policy.unknown_cost_microdollars,
        "exploration_floor": policy.exploration_floor,
    })
    .to_string();
    let inserted = tx
        .execute(
            "INSERT OR IGNORE INTO ai_voice_jobs
                (generation_id, generation_key, feature, speech_mode, status,
                 lease_owner, lease_expires_ms, policy_json, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, ?8)",
            params![
                generation_id,
                generation_key,
                feature,
                speech_mode,
                owner,
                lease_expires as i64,
                policy_json,
                now as i64
            ],
        )
        .map_err(crate::sqlite_error)?;
    if inserted == 1 {
        tx.commit().map_err(crate::sqlite_error)?;
        return Ok(JobClaim::Acquired);
    }
    let row = tx
        .query_row(
            "SELECT status, lease_expires_ms, lease_retries, accepted_text,
                    accepted_reasoning_trace, accepted_receipt_json, terminal_code
             FROM ai_voice_jobs WHERE generation_id = ?1",
            params![generation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, u32>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .map_err(crate::sqlite_error)?;
    match row.0.as_str() {
        "accepted" => {
            let speech = restored_speech(row.3, row.4, row.5)?;
            tx.commit().map_err(crate::sqlite_error)?;
            Ok(JobClaim::Accepted(Box::new(speech)))
        }
        "unavailable" => {
            tx.commit().map_err(crate::sqlite_error)?;
            Ok(JobClaim::Unavailable(row.6.unwrap_or_else(|| {
                "voice_candidates_exhausted".to_string()
            })))
        }
        _ if row.1 as u64 > now => {
            tx.commit().map_err(crate::sqlite_error)?;
            Ok(JobClaim::InFlight)
        }
        _ if row.2 >= MAX_JOB_LEASE_RETRIES => {
            tx.execute(
                "UPDATE ai_voice_jobs
                 SET status = 'unavailable', terminal_code = 'voice_job_retry_exhausted',
                     updated_at_ms = ?2
                 WHERE generation_id = ?1 AND status = 'pending'",
                params![generation_id, now as i64],
            )
            .map_err(crate::sqlite_error)?;
            tx.commit().map_err(crate::sqlite_error)?;
            Ok(JobClaim::Unavailable(
                "voice_job_retry_exhausted".to_string(),
            ))
        }
        _ => {
            let updated = tx
                .execute(
                    "UPDATE ai_voice_jobs
                     SET lease_owner = ?2, lease_expires_ms = ?3,
                         lease_retries = lease_retries + 1, updated_at_ms = ?4
                     WHERE generation_id = ?1 AND status = 'pending'
                       AND lease_expires_ms <= ?4",
                    params![generation_id, owner, lease_expires as i64, now as i64],
                )
                .map_err(crate::sqlite_error)?;
            tx.commit().map_err(crate::sqlite_error)?;
            Ok(if updated == 1 {
                JobClaim::Acquired
            } else {
                JobClaim::InFlight
            })
        }
    }
}

fn restored_speech(
    text: Option<String>,
    reasoning_trace: Option<String>,
    receipt_json: Option<String>,
) -> io::Result<CertifiedSpeech> {
    let text =
        text.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "accepted text missing"))?;
    let receipt = serde_json::from_str::<AiPublicationReceipt>(
        receipt_json
            .as_deref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "receipt missing"))?,
    )
    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    CertifiedSpeech::restore(text, reasoning_trace, receipt)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "accepted receipt mismatch"))
}

fn persist_voice_plan(
    path: &Path,
    generation_id: &str,
    decisions: &[VoiceSelectionDecision],
) -> io::Result<()> {
    let mut conn = crate::open_event_store(path)?;
    let tx = conn.transaction().map_err(crate::sqlite_error)?;
    let json = serde_json::to_string(decisions)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    tx.execute(
        "UPDATE ai_voice_jobs SET decisions_json = ?2, updated_at_ms = ?3
         WHERE generation_id = ?1",
        params![generation_id, json, crate::now_millis() as i64],
    )
    .map_err(crate::sqlite_error)?;
    for decision in decisions.iter().filter(|decision| decision.selected) {
        tx.execute(
            "INSERT OR REPLACE INTO ai_voice_attempt_decisions
                (generation_id, ordinal, requested_model_id, decision_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                generation_id,
                decision.ordinal,
                decision.requested_model_id,
                serde_json::to_string(decision)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
            ],
        )
        .map_err(crate::sqlite_error)?;
    }
    tx.commit().map_err(crate::sqlite_error)
}

fn content_evidence(
    path: Option<&Path>,
    model: &str,
    revision: &str,
    adapter_id: &str,
    adapter_version: &str,
    speech_mode: &str,
    feature: &str,
) -> io::Result<ContentEvidence> {
    let Some(path) = path else {
        return Ok(ContentEvidence::default());
    };
    let conn = crate::open_event_store(path)?;
    conn.query_row(
        "SELECT passed, failed FROM ai_voice_content_evidence
         WHERE model_id = ?1 AND model_revision = ?2 AND prompt_adapter_id = ?3
           AND prompt_adapter_version = ?4 AND speech_mode = ?5 AND feature = ?6",
        params![
            model,
            revision,
            adapter_id,
            adapter_version,
            speech_mode,
            feature
        ],
        |row| {
            Ok(ContentEvidence {
                passed: row.get(0)?,
                failed: row.get(1)?,
            })
        },
    )
    .optional()
    .map(|value| value.unwrap_or_default())
    .map_err(crate::sqlite_error)
}

fn provider_health(path: Option<&Path>, provider: &str, model: &str) -> io::Result<ProviderHealth> {
    let Some(path) = path else {
        return Ok(ProviderHealth::default());
    };
    let conn = crate::open_event_store(path)?;
    conn.query_row(
        "SELECT consecutive_failures, cooldown_until_ms
         FROM ai_voice_provider_health
         WHERE provider = ?1 AND requested_model_id = ?2",
        params![provider, model],
        |row| {
            Ok(ProviderHealth {
                consecutive_failures: row.get(0)?,
                cooldown_until_ms: row.get::<_, i64>(1)? as u64,
            })
        },
    )
    .optional()
    .map(|value| value.unwrap_or_default())
    .map_err(crate::sqlite_error)
}

fn accepted_family_count(path: Option<&Path>, family: &str) -> io::Result<u64> {
    let Some(path) = path else {
        return Ok(0);
    };
    let conn = crate::open_event_store(path)?;
    conn.query_row(
        "SELECT COUNT(*) FROM ai_voice_family_accepts WHERE family = ?1",
        params![family],
        |row| row.get(0),
    )
    .map_err(crate::sqlite_error)
}

fn record_provider_failure(path: Option<&Path>, provider: &str, model: &str, code: &str) {
    let Some(path) = path else {
        return;
    };
    let Ok(conn) = crate::open_event_store(path) else {
        return;
    };
    let failures = provider_health(Some(path), provider, model)
        .map(|health| health.consecutive_failures.saturating_add(1))
        .unwrap_or(1);
    let backoff_ms = 1_000u64
        .saturating_mul(1u64 << failures.saturating_sub(1).min(6))
        .min(60_000);
    let _ = conn.execute(
        "INSERT INTO ai_voice_provider_health
            (provider, requested_model_id, consecutive_failures,
             cooldown_until_ms, last_error_code)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(provider, requested_model_id) DO UPDATE SET
             consecutive_failures = excluded.consecutive_failures,
             cooldown_until_ms = excluded.cooldown_until_ms,
             last_error_code = excluded.last_error_code",
        params![
            provider,
            model,
            failures,
            crate::now_millis().saturating_add(backoff_ms) as i64,
            code
        ],
    );
}

fn record_provider_success(path: Option<&Path>, provider: &str, model: &str) {
    let Some(path) = path else {
        return;
    };
    let Ok(conn) = crate::open_event_store(path) else {
        return;
    };
    let _ = conn.execute(
        "INSERT INTO ai_voice_provider_health
            (provider, requested_model_id, successes, consecutive_failures,
             cooldown_until_ms)
         VALUES (?1, ?2, 1, 0, 0)
         ON CONFLICT(provider, requested_model_id) DO UPDATE SET
             successes = successes + 1, consecutive_failures = 0,
             cooldown_until_ms = 0, last_error_code = NULL",
        params![provider, model],
    );
}

fn record_content_result(
    path: Option<&Path>,
    decision: &VoiceSelectionDecision,
    attribution: Option<&crate::ai_gateway::ModelAttribution>,
    passed: bool,
) {
    let Some(path) = path else {
        return;
    };
    let Ok(conn) = crate::open_event_store(path) else {
        return;
    };
    let model = attribution
        .map(|value| value.resolved_model_id.as_str())
        .unwrap_or(&decision.model_id);
    let revision = attribution
        .and_then(|value| value.resolved_revision.as_deref())
        .unwrap_or(&decision.model_revision);
    let adapter_id = attribution
        .map(|value| value.prompt_adapter_id.as_str())
        .unwrap_or(&decision.prompt_adapter_id);
    let adapter_version = attribution
        .map(|value| value.prompt_adapter_version.as_str())
        .unwrap_or(&decision.prompt_adapter_version);
    let _ = conn.execute(
        "INSERT INTO ai_voice_content_evidence
            (model_id, model_revision, prompt_adapter_id, prompt_adapter_version,
             speech_mode, feature, passed, failed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(model_id, model_revision, prompt_adapter_id,
                     prompt_adapter_version, speech_mode, feature) DO UPDATE SET
             passed = passed + excluded.passed,
             failed = failed + excluded.failed",
        params![
            model,
            revision,
            adapter_id,
            adapter_version,
            decision.speech_mode,
            decision.feature,
            u8::from(passed),
            u8::from(!passed)
        ],
    );
}

fn accept_voice_job(
    path: Option<&Path>,
    generation_id: &str,
    owner: &str,
    family: &str,
    speech: &CertifiedSpeech,
) -> bool {
    let Some(path) = path else {
        return true;
    };
    let Ok(mut conn) = crate::open_event_store(path) else {
        return false;
    };
    let Ok(tx) = conn.transaction() else {
        return false;
    };
    let Ok(receipt_json) = serde_json::to_string(speech.receipt()) else {
        return false;
    };
    let now = crate::now_millis();
    let updated = tx
        .execute(
            "UPDATE ai_voice_jobs
             SET status = 'accepted', accepted_text = ?3,
                 accepted_reasoning_trace = ?4,
                 accepted_receipt_json = ?5, updated_at_ms = ?6
             WHERE generation_id = ?1 AND status = 'pending' AND lease_owner = ?2",
            params![
                generation_id,
                owner,
                speech.text(),
                speech.reasoning_trace(),
                receipt_json,
                now as i64
            ],
        )
        .unwrap_or_default();
    if updated == 1 {
        let _ = tx.execute(
            "INSERT OR IGNORE INTO ai_voice_family_accepts
                (generation_id, family, accepted_at_ms)
             VALUES (?1, ?2, ?3)",
            params![generation_id, family, now as i64],
        );
    }
    tx.commit().is_ok() && updated == 1
}

fn load_accepted_voice_job(path: Option<&Path>, generation_id: &str) -> Option<CertifiedSpeech> {
    let path = path?;
    let conn = crate::open_event_store(path).ok()?;
    let (text, reasoning_trace, receipt) = conn
        .query_row(
            "SELECT accepted_text, accepted_reasoning_trace, accepted_receipt_json FROM ai_voice_jobs
             WHERE generation_id = ?1 AND status = 'accepted'",
            params![generation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .ok()??;
    restored_speech(text, reasoning_trace, receipt).ok()
}

fn finish_voice_job_unavailable(path: Option<&Path>, generation_id: &str, owner: &str, code: &str) {
    let Some(path) = path else {
        return;
    };
    let Ok(conn) = crate::open_event_store(path) else {
        return;
    };
    let _ = conn.execute(
        "UPDATE ai_voice_jobs
         SET status = 'unavailable', terminal_code = ?3, updated_at_ms = ?4
         WHERE generation_id = ?1 AND status = 'pending' AND lease_owner = ?2",
        params![generation_id, owner, code, crate::now_millis() as i64],
    );
}

fn record_decision_result(
    path: Option<&Path>,
    generation_id: &str,
    ordinal: u8,
    result: &str,
    code: Option<&str>,
) {
    let Some(path) = path else {
        return;
    };
    let Ok(conn) = crate::open_event_store(path) else {
        return;
    };
    let _ = conn.execute(
        "UPDATE ai_voice_attempt_decisions SET result = ?3, result_code = ?4
         WHERE generation_id = ?1 AND ordinal = ?2",
        params![generation_id, ordinal, result, code],
    );
}

fn mark_timed_out_batch(
    path: Option<&Path>,
    generation_id: &str,
    batch: &[PlannedCandidate],
    completed_ordinals: &BTreeSet<u8>,
) {
    for candidate in batch
        .iter()
        .filter(|candidate| !completed_ordinals.contains(&candidate.decision.ordinal))
    {
        record_provider_failure(
            path,
            &candidate.decision.provider,
            &candidate.decision.requested_model_id,
            "inference_timeout",
        );
        record_decision_result(
            path,
            generation_id,
            candidate.decision.ordinal,
            "provider_failure",
            Some("inference_timeout"),
        );
    }
}

#[cfg(test)]
pub(crate) fn voice_family_accept_counts(
    path: &Path,
) -> io::Result<std::collections::BTreeMap<String, u64>> {
    let conn = crate::open_event_store(path)?;
    let mut statement = conn
        .prepare(
            "SELECT family, COUNT(*) FROM ai_voice_family_accepts
             GROUP BY family ORDER BY family",
        )
        .map_err(crate::sqlite_error)?;
    let counts = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(crate::sqlite_error)?
        .collect::<Result<std::collections::BTreeMap<_, _>, _>>()
        .map_err(crate::sqlite_error)?;
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ai_gateway::{AiTokenUsage, CapabilityRegistrySnapshot, DataPolicyMode},
        CwAction, JournalRecord, RuntimeWorld, CW_ACTION_SAY,
    };
    use serde_json::{json, Value};
    use std::{
        collections::{BTreeMap, BTreeSet, VecDeque},
        fs,
        sync::Mutex as StdMutex,
    };

    #[derive(Clone)]
    struct MockOutput {
        text: String,
        reasoning_trace: Option<String>,
        delay: Duration,
        finish_reason: String,
    }

    #[derive(Clone, Default)]
    struct MockBackend {
        outputs: Arc<StdMutex<BTreeMap<String, VecDeque<MockOutput>>>>,
        calls: Arc<StdMutex<Vec<String>>>,
        systems: Arc<StdMutex<Vec<String>>>,
        users: Arc<StdMutex<Vec<String>>>,
    }

    impl MockBackend {
        fn with_outputs(
            outputs: impl IntoIterator<Item = (&'static str, &'static str, u64)>,
        ) -> Self {
            let backend = Self::default();
            let mut configured = backend.outputs.lock().unwrap();
            for (model, text, delay_ms) in outputs {
                configured
                    .entry(model.to_string())
                    .or_default()
                    .push_back(MockOutput {
                        text: text.to_string(),
                        reasoning_trace: None,
                        delay: Duration::from_millis(delay_ms),
                        finish_reason: "stop".to_string(),
                    });
            }
            drop(configured);
            backend
        }

        fn with_finished_outputs(
            outputs: impl IntoIterator<Item = (&'static str, &'static str, &'static str, u64)>,
        ) -> Self {
            let backend = Self::default();
            let mut configured = backend.outputs.lock().unwrap();
            for (model, text, finish_reason, delay_ms) in outputs {
                configured
                    .entry(model.to_string())
                    .or_default()
                    .push_back(MockOutput {
                        text: text.to_string(),
                        reasoning_trace: None,
                        delay: Duration::from_millis(delay_ms),
                        finish_reason: finish_reason.to_string(),
                    });
            }
            drop(configured);
            backend
        }

        fn with_reasoning_output(
            model: &'static str,
            text: &'static str,
            trace: &'static str,
        ) -> Self {
            let backend = Self::default();
            backend
                .outputs
                .lock()
                .unwrap()
                .entry(model.to_string())
                .or_default()
                .push_back(MockOutput {
                    text: text.to_string(),
                    reasoning_trace: Some(trace.to_string()),
                    delay: Duration::ZERO,
                    finish_reason: "stop".to_string(),
                });
            backend
        }

        fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }

        fn requested_models(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }

        fn rendered_prompts(&self) -> (Vec<String>, Vec<String>) {
            (
                self.systems.lock().unwrap().clone(),
                self.users.lock().unwrap().clone(),
            )
        }
    }

    impl VoiceAttemptBackend for MockBackend {
        fn attempt(
            &self,
            selection: PinnedModelSelection,
            request: VoiceAttemptRequest,
            _timeout: Duration,
        ) -> VoiceAttemptFuture {
            let model = selection.requested_model_id().to_string();
            self.calls.lock().unwrap().push(model.clone());
            let rendered = request.prompt.render_for_test();
            self.systems.lock().unwrap().push(rendered.system);
            self.users.lock().unwrap().push(rendered.user);
            let output = self
                .outputs
                .lock()
                .unwrap()
                .get_mut(&model)
                .and_then(VecDeque::pop_front)
                .unwrap_or(MockOutput {
                    text: "Teapot ready.".to_string(),
                    reasoning_trace: None,
                    delay: Duration::ZERO,
                    finish_reason: "stop".to_string(),
                });
            Box::pin(async move {
                tokio::time::sleep(output.delay).await;
                let model_attribution = selection
                    .attribute_response(Some(&model))
                    .expect("fixed test model attributes");
                Ok(AiCompletion {
                    text: output.text,
                    reasoning_trace: output.reasoning_trace,
                    attempts: 1,
                    latency: output.delay,
                    model_attribution: Some(model_attribution),
                    resolved_model_id: model,
                    finish_reason: output.finish_reason,
                    usage: AiTokenUsage {
                        prompt_tokens: Some(20),
                        completion_tokens: Some(6),
                        total_tokens: Some(26),
                    },
                    context_hash: "routing-context".to_string(),
                    prompt_version: request.prompt_version.to_string(),
                })
            })
        }
    }

    fn candidate(
        requested: &str,
        provider: &str,
        concrete: &str,
        family: &str,
        revision: &str,
        privacy_ok: bool,
    ) -> Value {
        json!({
            "requested_model_id": requested,
            "provider": provider,
            "concrete_model": { "model_id": concrete, "revision": revision },
            "family": family,
            "size_class": "1b",
            "input_modalities": ["text"],
            "output_modalities": ["text"],
            "supported_parameters": { "stop": true },
            "data_policy": if privacy_ok {
                json!({ "retention": "none", "training": "prohibited" })
            } else {
                json!({ "retention": "unknown", "training": "unknown" })
            },
            "prompt_adapter": { "id": "cosy-chat", "version": "3" },
            "sampling": { "temperature": 0.7, "hard_output_cap": 96 },
            "capabilities": ["voice"],
            "observations": {
                "latency_p50_ms": 150,
                "availability_ratio": 0.99,
                "gate_history": {
                    "voice": { "passed": 2, "failed": 1, "last_gate_version": "voice-gate-1" }
                }
            }
        })
    }

    fn priced_candidate(
        requested: &str,
        provider: &str,
        input_cost_per_million: f64,
        output_cost_per_million: f64,
    ) -> Value {
        let mut value = candidate(requested, provider, requested, requested, "r1", true);
        value["observations"]["input_cost_per_million"] = json!(input_cost_per_million);
        value["observations"]["output_cost_per_million"] = json!(output_cost_per_million);
        value
    }

    fn config(values: Vec<Value>, routing: VoiceRoutingConfig) -> AiConfig {
        let registry = CapabilityRegistrySnapshot::from_json(
            &json!({
                "schema_version": 1,
                "snapshot_version": "routing-test-v1",
                "declared": values,
                "discovered": []
            })
            .to_string(),
        )
        .expect("test registry");
        AiConfig {
            api_key: "test-key".to_string(),
            base_url: "http://127.0.0.1:9".to_string(),
            model: "provider/tiny-a".to_string(),
            registry: Some(Arc::new(registry)),
            data_policy_mode: DataPolicyMode::Production,
            voice_routing: routing,
            ..AiConfig::default()
        }
    }

    fn three_candidates(routing: VoiceRoutingConfig) -> AiConfig {
        config(
            vec![
                candidate(
                    "provider/tiny-a",
                    "provider-a",
                    "tiny/a",
                    "tiny-a",
                    "r1",
                    true,
                ),
                candidate(
                    "provider/tiny-b",
                    "provider-b",
                    "tiny/b",
                    "tiny-b",
                    "r4",
                    true,
                ),
                candidate(
                    "provider/small-c",
                    "provider-c",
                    "small/c",
                    "small-c",
                    "r2",
                    true,
                ),
            ],
            routing,
        )
    }

    fn request(feature: &'static str) -> VoiceAttemptRequest {
        VoiceAttemptRequest {
            feature,
            prompt_version: "routing-test-prompt-v1",
            prompt: PromptEnvelope::default()
                .system("Write one short anchored line.")
                .user(
                    "The teapot rattled.",
                    crate::PromptSegmentKind::UniqueEvidence,
                    100,
                    true,
                ),
            temperature: 0.7,
            max_tokens: 70,
            referer: "http://127.0.0.1:3102",
            model_binding: None,
            room_id: None,
        }
    }

    fn hoppycat_bindings() -> Vec<crate::content_load::SeedActorModelBinding> {
        serde_json::from_str::<Vec<crate::content_load::SeedActorModelBinding>>(include_str!(
            "../../content/hoppycat-archive/actor_model_bindings.json"
        ))
        .expect("Hoppycat actor model bindings")
    }

    fn gate(key: &str) -> SpeechGateContext {
        SpeechGateContext {
            feature: "dialogue_avatar",
            generation_key: key.to_string(),
            speaker_actor_id: 5_000,
            speaker_name: "Tiny Tester".to_string(),
            other_speaker_names: vec!["Gust".to_string()],
            mode: crate::ai_publication::SpeechMode::Prose,
            max_words: 20,
            anchors: vec!["teapot".to_string()],
            signpost_openers: Vec::new(),
            recent_lines: Vec::new(),
            recent_speaker_shingle_hashes: Vec::new(),
            has_proposed_action: false,
            requirements: crate::ai_publication::VoiceBeatRequirements::default(),
            envelope_valid: true,
            candidate_round: 1,
        }
    }

    fn test_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "cosyworld-ai-routing-{label}-{}-{}.sqlite",
            std::process::id(),
            crate::now_seed()
        ))
    }

    #[test]
    fn version_two_event_store_migrates_the_reasoning_trace_column() {
        let path = test_path("reasoning-trace-migration");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).expect("create a version-two event store");
        conn.execute_batch(
            "CREATE TABLE ai_voice_jobs (
                generation_id TEXT PRIMARY KEY,
                accepted_text TEXT,
                accepted_receipt_json TEXT
            );
            PRAGMA user_version = 2;",
        )
        .expect("create the legacy voice-job schema");
        drop(conn);

        crate::init_event_store(&path).expect("migrate the voice-job schema");
        let conn = crate::open_event_store(&path).expect("open the migrated event store");
        let columns = conn
            .prepare("PRAGMA table_info(ai_voice_jobs)")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<BTreeSet<_>, _>>()
            })
            .expect("read the migrated voice-job columns");
        assert!(columns.contains("accepted_reasoning_trace"));
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read the migrated schema version");
        assert_eq!(version, crate::EVENT_STORE_SCHEMA_VERSION);
        drop(conn);
        let _ = fs::remove_file(path);
    }

    fn single_candidate(routing: VoiceRoutingConfig) -> AiConfig {
        config(
            vec![candidate(
                "provider/tiny-a",
                "provider-a",
                "tiny/a",
                "tiny-a",
                "r1",
                true,
            )],
            routing,
        )
    }

    #[test]
    fn a_thin_candidate_pool_still_fills_the_attempt_budget_by_resampling() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 3,
            ..VoiceRoutingConfig::default()
        });
        let candidates = config.pin_models(ModelCapability::Voice).unwrap();
        assert_eq!(candidates.len(), 1, "the pool pins exactly one model");

        let (planned, _) = build_voice_plan(
            None,
            "generation-thin",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            candidates,
        )
        .unwrap();

        // One pinned model previously produced one attempt, so any single
        // publication rejection was terminal and the resident fell silent.
        assert_eq!(planned.len(), 3, "the attempt budget is reachable");
        assert!(
            planned
                .iter()
                .all(|entry| entry.decision.requested_model_id == "provider/tiny-a"),
            "a thin pool resamples the same model rather than inventing one",
        );
        let ordinals = planned
            .iter()
            .map(|entry| entry.decision.ordinal)
            .collect::<Vec<_>>();
        assert_eq!(ordinals, vec![1, 2, 3], "ordinals stay unique and ordered");
        assert_eq!(
            planned
                .iter()
                .filter(|entry| entry.decision.resampled)
                .count(),
            2,
            "only the filler attempts are marked as resampled",
        );
    }

    #[tokio::test]
    async fn hoppycat_exact_actor_bindings_never_fall_back_to_the_generic_pool() {
        let mut config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 1,
            spend_ceiling_microdollars: u64::MAX,
            ..VoiceRoutingConfig::default()
        });
        config.base_url = "https://openrouter.ai/api/v1".to_string();
        let bindings = hoppycat_bindings();
        assert_eq!(bindings.len(), 7);
        for binding in bindings {
            let expected_model = binding.requested_model_id.clone();
            let backend = MockBackend::default();
            backend.outputs.lock().unwrap().insert(
                expected_model.clone(),
                ["unanchored one", "unanchored two", "unanchored three"]
                    .into_iter()
                    .map(|text| MockOutput {
                        text: text.to_string(),
                        reasoning_trace: None,
                        delay: Duration::ZERO,
                        finish_reason: "stop".to_string(),
                    })
                    .collect(),
            );
            let mut exact_request = request("dialogue_resident_raw");
            exact_request.model_binding = Some(binding);
            let mut exact_gate = gate("hoppycat-exact-model-exhausted");
            exact_gate.mode = SpeechMode::Raw;
            exact_gate.anchors = vec!["teapot".to_string()];

            let error = route_certified_voice_with(
                &config,
                None,
                exact_request,
                exact_gate,
                Arc::new(backend.clone()),
            )
            .await
            .expect_err("the exact model exhausts without substitution");

            assert_eq!(error.code(), "voice_candidates_exhausted");
            assert_eq!(backend.requested_models(), vec![expected_model; 3]);
        }
    }

    #[test]
    fn attempt_budget_can_build_a_ten_response_pool() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 10,
            hedge_width: 10,
            spend_ceiling_microdollars: u64::MAX,
            ..VoiceRoutingConfig::default()
        });
        let (planned, _) = build_voice_plan(
            None,
            "generation-ten-response-pool",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();

        assert_eq!(planned.len(), 10);
        assert_eq!(
            planned
                .iter()
                .filter(|candidate| candidate.decision.resampled)
                .count(),
            9,
        );
    }

    #[test]
    fn resampling_never_exceeds_the_spend_ceiling() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 4,
            spend_ceiling_microdollars: 1,
            unknown_cost_microdollars: 1,
            ..VoiceRoutingConfig::default()
        });
        let candidates = config.pin_models(ModelCapability::Voice).unwrap();
        let (planned, _) = build_voice_plan(
            None,
            "generation-thin-budget",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            candidates,
        )
        .unwrap();
        assert_eq!(
            planned.len(),
            1,
            "the spend ceiling still bounds the attempt budget",
        );
    }

    #[test]
    fn lonely_forest_ceiling_covers_four_attempts_for_the_priciest_raw_binding() {
        const LONELY_FOREST_SPEND_CEILING: u64 = 650_000;
        let config = config(
            vec![priced_candidate(
                "provider/priciest-raw",
                "provider-a",
                150.0,
                600.0,
            )],
            VoiceRoutingConfig {
                max_attempts: 4,
                spend_ceiling_microdollars: LONELY_FOREST_SPEND_CEILING,
                ..VoiceRoutingConfig::default()
            },
        );
        let mut raw_request = request("dialogue_resident_raw");
        raw_request.max_tokens = 160;
        raw_request.prompt = PromptEnvelope::default().user(
            "x".repeat(1_200),
            PromptSegmentKind::UniqueEvidence,
            100,
            true,
        );

        let (planned, _) = build_voice_plan(
            None,
            "generation-priciest-raw",
            5_000,
            "raw",
            &raw_request,
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();

        assert_eq!(planned.len(), 4);
        assert!(
            planned_spend_microdollars(&planned, config.voice_routing.hedge_width)
                <= LONELY_FOREST_SPEND_CEILING
        );
    }

    #[test]
    fn weighted_plan_is_deterministic_without_replacement_and_keeps_a_floor() {
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            ..VoiceRoutingConfig::default()
        });
        let candidates = config.pin_models(ModelCapability::Voice).unwrap();
        let first = build_voice_plan(
            None,
            "generation-one",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            candidates.clone(),
        )
        .unwrap();
        let second = build_voice_plan(
            None,
            "generation-one",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            candidates,
        )
        .unwrap();
        let first_ids = first
            .0
            .iter()
            .map(|candidate| candidate.decision.requested_model_id.clone())
            .collect::<Vec<_>>();
        let second_ids = second
            .0
            .iter()
            .map(|candidate| candidate.decision.requested_model_id.clone())
            .collect::<Vec<_>>();
        assert_eq!(first_ids, second_ids);
        assert_eq!(first_ids.len(), 3);
        assert_eq!(first_ids.iter().collect::<BTreeSet<_>>().len(), 3);
        assert!(first
            .1
            .iter()
            .all(|decision| decision.final_weight >= config.voice_routing.exploration_floor));
        assert!(first.1.iter().all(|decision| {
            decision.prompt_budget.estimated_prompt_tokens > 0
                && decision.prompt_budget.context_limit
                    > decision.prompt_budget.estimated_prompt_tokens
        }));
    }

    #[test]
    fn declared_data_policy_preserves_both_voice_candidates() {
        let config = config(
            vec![
                candidate("provider/good", "one", "shared/tiny", "tiny", "r1", true),
                candidate(
                    "provider/private",
                    "two",
                    "shared/tiny",
                    "tiny",
                    "r1",
                    false,
                ),
            ],
            VoiceRoutingConfig::default(),
        );
        let pinned = config.pin_models(ModelCapability::Voice).unwrap();
        assert_eq!(pinned.len(), 2);
        assert_eq!(pinned[0].requested_model_id(), "provider/good");
        assert_eq!(pinned[1].requested_model_id(), "provider/private");
    }

    #[test]
    fn content_evidence_is_dimensioned_and_failure_never_removes_the_floor() {
        let path = test_path("evidence");
        let _ = fs::remove_file(&path);
        crate::init_event_store(&path).unwrap();
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            ..VoiceRoutingConfig::default()
        });
        let baseline = build_voice_plan(
            Some(&path),
            "evidence-before",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();
        let target = baseline.1[0].clone();
        for _ in 0..12 {
            record_content_result(Some(&path), &target, None, false);
        }
        let after = build_voice_plan(
            Some(&path),
            "evidence-before",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();
        let lowered = after
            .1
            .iter()
            .find(|decision| decision.requested_model_id == target.requested_model_id)
            .unwrap();
        assert!(lowered.final_weight < target.final_weight);
        assert!(lowered.final_weight >= config.voice_routing.exploration_floor);
        assert_eq!(
            content_evidence(
                Some(&path),
                &target.model_id,
                &target.model_revision,
                &target.prompt_adapter_id,
                &target.prompt_adapter_version,
                "emote_only",
                "dialogue_avatar",
            )
            .unwrap(),
            ContentEvidence::default()
        );
        assert_eq!(
            content_evidence(
                Some(&path),
                &target.model_id,
                &target.model_revision,
                &target.prompt_adapter_id,
                &target.prompt_adapter_version,
                "prose",
                "dialogue_avatar_followup",
            )
            .unwrap(),
            ContentEvidence::default()
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn endpoint_cooldown_is_separate_from_shared_model_content_evidence() {
        let path = test_path("provider");
        let _ = fs::remove_file(&path);
        crate::init_event_store(&path).unwrap();
        let config = config(
            vec![
                candidate("a/shared", "provider-a", "shared/tiny", "tiny", "r1", true),
                candidate("b/shared", "provider-b", "shared/tiny", "tiny", "r1", true),
            ],
            VoiceRoutingConfig {
                max_attempts: 2,
                ..VoiceRoutingConfig::default()
            },
        );
        record_provider_failure(Some(&path), "provider-a", "a/shared", "inference_timeout");
        let (_, decisions) = build_voice_plan(
            Some(&path),
            "provider-separation",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();
        let a = decisions
            .iter()
            .find(|decision| decision.requested_model_id == "a/shared")
            .unwrap();
        let b = decisions
            .iter()
            .find(|decision| decision.requested_model_id == "b/shared")
            .unwrap();
        assert_eq!(a.excluded_reason.as_deref(), Some("provider_cooldown"));
        assert!(b.selected);
        assert_eq!(a.content_failed, 1);
        assert_eq!(b.content_failed, 1);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn attempt_and_spend_budgets_bound_the_plan() {
        let routing = VoiceRoutingConfig {
            max_attempts: 3,
            spend_ceiling_microdollars: 200,
            unknown_cost_microdollars: 100,
            ..VoiceRoutingConfig::default()
        };
        let config = three_candidates(routing);
        let (planned, decisions) = build_voice_plan(
            None,
            "budgeted",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();
        assert_eq!(planned.len(), 2);
        assert_eq!(decisions.iter().filter(|value| value.selected).count(), 2);
        assert!(decisions
            .iter()
            .any(|value| value.excluded_reason.as_deref() == Some("spend_ceiling")));
    }

    #[test]
    fn retry_feedback_cost_is_bounded() {
        let prompt_budget = PromptBudgetTelemetry {
            estimated_prompt_tokens: 10,
            ..PromptBudgetTelemetry::default()
        };
        let request = request("dialogue_avatar");
        assert_eq!(
            estimated_cost(Some(1.0), Some(1.0), &request, &prompt_budget, 250),
            80,
        );
        assert_eq!(
            estimated_retry_feedback_cost(Some(1.0)),
            VOICE_RETRY_FEEDBACK_RESERVE_TOKENS as u64,
        );
        assert_eq!(estimated_retry_feedback_cost(None), 0);
    }

    #[test]
    fn sequential_retries_each_fit_their_own_feedback_cost() {
        let generous = config(
            vec![priced_candidate(
                "provider/cheap",
                "provider-cheap",
                1.0,
                0.0,
            )],
            VoiceRoutingConfig {
                max_attempts: 3,
                hedge_width: 1,
                spend_ceiling_microdollars: u64::MAX,
                ..VoiceRoutingConfig::default()
            },
        );
        let request = request("dialogue_avatar");
        let (generous_plan, _) = build_voice_plan(
            None,
            "sequential-retry-cost-baseline",
            5_000,
            "prose",
            &request,
            &generous.voice_routing,
            generous.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();
        let base_cost = generous_plan[0].decision.estimated_cost_microdollars;
        let feedback_cost = estimated_retry_feedback_cost(Some(1.0));
        let ceiling_with_only_one_feedback =
            base_cost.saturating_mul(3).saturating_add(feedback_cost);
        let bounded = config(
            vec![priced_candidate(
                "provider/cheap",
                "provider-cheap",
                1.0,
                0.0,
            )],
            VoiceRoutingConfig {
                max_attempts: 3,
                hedge_width: 1,
                spend_ceiling_microdollars: ceiling_with_only_one_feedback,
                ..VoiceRoutingConfig::default()
            },
        );
        let (planned, _) = build_voice_plan(
            None,
            "sequential-retry-cost-bounded",
            5_000,
            "prose",
            &request,
            &bounded.voice_routing,
            bounded.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();

        assert_eq!(planned.len(), 2);
        assert_eq!(
            planned_spend_microdollars(&planned, 1),
            base_cost.saturating_mul(2).saturating_add(feedback_cost)
        );
    }

    #[test]
    fn unused_expensive_candidate_does_not_tax_a_cheap_retry() {
        let path = test_path("candidate-specific-retry-cost");
        let _ = fs::remove_file(&path);
        crate::init_event_store(&path).unwrap();
        let routing = VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            spend_ceiling_microdollars: 50,
            ..VoiceRoutingConfig::default()
        };
        let config = config(
            vec![
                priced_candidate("provider/cheap", "provider-cheap", 0.1, 0.0),
                priced_candidate("provider/expensive", "provider-expensive", 100.0, 0.0),
            ],
            routing,
        );
        record_provider_failure(
            Some(&path),
            "provider-expensive",
            "provider/expensive",
            "inference_provider_error",
        );
        let (planned, decisions) = build_voice_plan(
            Some(&path),
            "candidate-specific-retry-cost",
            5_000,
            "prose",
            &request("dialogue_avatar"),
            &config.voice_routing,
            config.pin_models(ModelCapability::Voice).unwrap(),
        )
        .unwrap();

        assert_eq!(planned.len(), 2, "the cheap model can still be retried");
        assert!(planned
            .iter()
            .all(|candidate| candidate.decision.requested_model_id == "provider/cheap"));
        assert_eq!(
            decisions
                .iter()
                .find(|decision| decision.requested_model_id == "provider/expensive")
                .and_then(|decision| decision.excluded_reason.as_deref()),
            Some("provider_cooldown")
        );
        assert!(planned_spend_microdollars(&planned, 1) <= 50);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn rejection_feedback_reaches_only_later_attempts() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            ..VoiceRoutingConfig::default()
        });
        let rejected = "Gust: Teapot plan:";
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", rejected, 0),
            ("provider/tiny-a", "Teapot ready.", 0),
        ]);

        let certified = route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            gate("feedback-beat"),
            Arc::new(backend.clone()),
        )
        .await
        .expect("the corrected retry certifies");

        assert_eq!(certified.text(), "Teapot ready.");
        assert_eq!(certified.prior_rejections().len(), 1);
        assert_eq!(
            certified.prior_rejections()[0].failure_code,
            PublicationCheckCode::VoiceFinishIncomplete,
            "the receipt keeps the first failed check even when feedback covers every failed check",
        );
        let (systems, users) = backend.rendered_prompts();
        assert_eq!(systems.len(), 2);
        assert_eq!(systems[0], "Write one short anchored line.");
        assert_eq!(
            systems[1],
            "Write one short anchored line.\nagain · one short complete line · at most 20 words · one voice · no speaker labels",
        );
        assert_eq!(users, vec!["The teapot rattled."; 2]);
        assert!(systems
            .iter()
            .chain(&users)
            .all(|prompt| !prompt.contains(rejected)));
    }

    /// Duplicate wording is a code-only rejection. A later sample gets no copy
    /// of the rejected line or a prose reminder about repetition.
    #[tokio::test]
    async fn a_duplicate_retry_resamples_without_prompt_feedback() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            ..VoiceRoutingConfig::default()
        });
        let rejected = "White moths crowd the cold lamp cages again.";
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", rejected, 0),
            ("provider/tiny-a", "Teapot ready.", 0),
        ]);
        let mut publication_gate = gate("duplicate-beat");
        publication_gate.anchors = vec!["teapot".to_string(), "moths".to_string()];
        publication_gate.recent_speaker_shingle_hashes =
            crate::ai_publication::voice_signature_shingle_hashes(
                "White moths crowd the cold lamp cages tonight.",
            );

        let certified = route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            publication_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the corrected retry certifies");

        assert_eq!(certified.text(), "Teapot ready.");
        let (systems, users) = backend.rendered_prompts();
        assert_eq!(systems[1], "Write one short anchored line.");
        assert!(
            systems
                .iter()
                .chain(&users)
                .all(|prompt| !prompt.contains(rejected)
                    && !prompt.contains("fresh wording")
                    && !prompt.contains("do not reuse")),
            "anti-repetition must stay outside the prompt",
        );
    }

    /// Even several duplicate rounds must not build a prompt-side blocklist.
    #[tokio::test]
    async fn duplicate_rejections_never_accumulate_a_prompt_blocklist() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 1,
            spend_ceiling_microdollars: u64::MAX,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            (
                "provider/tiny-a",
                "White moths crowd the cold lamp cages again.",
                0,
            ),
            (
                "provider/tiny-a",
                "I keep my small plans close beside the teapot.",
                0,
            ),
            ("provider/tiny-a", "Teapot ready.", 0),
        ]);
        let mut publication_gate = gate("accumulating-beat");
        publication_gate.anchors = vec!["teapot".to_string(), "moths".to_string()];
        publication_gate.recent_speaker_shingle_hashes = [
            crate::ai_publication::voice_signature_shingle_hashes(
                "White moths crowd the cold lamp cages tonight.",
            ),
            crate::ai_publication::voice_signature_shingle_hashes(
                "I keep my small plans close until morning.",
            ),
        ]
        .concat();

        let certified = route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            publication_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the third attempt certifies");

        assert_eq!(certified.text(), "Teapot ready.");
        let (systems, _) = backend.rendered_prompts();
        assert_eq!(systems, vec!["Write one short anchored line."; 3]);
    }

    #[tokio::test]
    async fn every_passing_candidate_is_ranked_before_one_is_accepted() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 3,
            spend_ceiling_microdollars: u64::MAX,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "Teapot ready.", 0),
            ("provider/tiny-a", "Teapot waits beside the window.", 10),
            ("provider/tiny-a", "Teapot and biscuit ready.", 0),
        ]);
        let mut publication_gate = gate("ranked-pool-beat");
        publication_gate.anchors = vec!["teapot".to_string(), "biscuit".to_string()];

        let certified = route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            publication_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the best passing candidate is selected");

        assert_eq!(backend.call_count(), 3);
        assert_eq!(certified.text(), "Teapot and biscuit ready.");
    }

    #[tokio::test]
    async fn raw_retry_keeps_feedback_in_the_single_user_envelope() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            (
                "provider/tiny-a",
                "teapot rattles and teapot rattles and",
                0,
            ),
            ("provider/tiny-a", "A clean answer.", 0),
        ]);
        let mut raw_request = request("dialogue_resident_raw");
        raw_request.prompt = PromptEnvelope::default().user(
            "raw scene",
            PromptSegmentKind::UniqueEvidence,
            100,
            true,
        );
        let mut raw_gate = gate("raw-feedback-beat");
        raw_gate.mode = SpeechMode::Raw;
        raw_gate.anchors = vec!["answer".to_string()];

        let certified = route_certified_voice_with(
            &config,
            None,
            raw_request,
            raw_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the raw retry certifies");

        assert_eq!(certified.text(), "A clean answer.");
        let (systems, users) = backend.rendered_prompts();
        assert_eq!(systems, vec![""; 2]);
        assert_eq!(users[0], "raw scene");
        assert_eq!(
            users[1],
            "raw scene\nagain · touch something already present"
        );
    }

    #[tokio::test]
    async fn raw_length_retry_uses_a_conservative_word_cap() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_finished_outputs([
            ("provider/tiny-a", "still going", "length", 0),
            ("provider/tiny-a", "A complete answer.", "stop", 0),
        ]);
        let mut raw_request = request("dialogue_resident_raw");
        raw_request.max_tokens = 160;
        raw_request.prompt = PromptEnvelope::default().user(
            "raw scene",
            PromptSegmentKind::UniqueEvidence,
            100,
            true,
        );
        let mut raw_gate = gate("raw-length-feedback-beat");
        raw_gate.mode = SpeechMode::Raw;
        raw_gate.max_words = 400;
        raw_gate.anchors = vec!["answer".to_string()];

        route_certified_voice_with(
            &config,
            None,
            raw_request,
            raw_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the length-corrected raw retry certifies");

        let (systems, users) = backend.rendered_prompts();
        assert_eq!(systems, vec![""; 2]);
        assert_eq!(users[0], "raw scene");
        assert_eq!(
            users[1],
            "raw scene\nagain · one complete response · at most 64 words · touch something already present"
        );
    }

    #[tokio::test]
    async fn place_signpost_retry_names_a_non_location_way_to_begin() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "Moonlit Trail at last!", 0),
            ("provider/tiny-a", "The teapot is warm.", 0),
        ]);
        let mut publication_gate = gate("signpost-feedback-beat");
        publication_gate.anchors = vec!["Moonlit Trail".to_string(), "teapot".to_string()];
        publication_gate.signpost_openers = vec!["Moonlit Trail".to_string()];

        let certified = route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            publication_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the signpost-corrected retry certifies");

        assert_eq!(certified.text(), "The teapot is warm.");
        let (systems, _) = backend.rendered_prompts();
        assert_eq!(
            systems[1],
            "Write one short anchored line.\nagain · start with a person, object, action, or sensation · mention the place later only if it matters"
        );
    }

    #[tokio::test]
    async fn retry_shape_feedback_respects_emoji_mode() {
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 2,
            hedge_width: 1,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "unfinished:", 0),
            ("provider/tiny-a", "☕🌧️😤", 0),
        ]);
        let mut emoji_gate = gate("emoji-feedback-beat");
        emoji_gate.mode = SpeechMode::EmojiOnly;

        route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            emoji_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect("the emoji retry certifies");

        let (systems, _) = backend.rendered_prompts();
        assert_eq!(
            systems[1],
            "Write one short anchored line.\nagain · 3–6 emoji only · touch something already present"
        );
    }

    #[tokio::test]
    async fn hedge_race_accepts_once_and_duplicate_reuses_the_durable_job() {
        let path = test_path("race");
        let _ = fs::remove_file(&path);
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 2,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "Teapot from tiny a.", 30),
            ("provider/tiny-b", "Teapot from tiny b.", 5),
            ("provider/small-c", "Teapot from small c.", 15),
        ]);
        let certified = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            gate("race-beat"),
            Arc::new(backend.clone()),
        )
        .await
        .expect("one hedge certifies");
        assert!(certified.text().contains("Teapot"));
        assert_eq!(
            backend.call_count(),
            2,
            "both hedged candidates are compared before the durable winner is accepted"
        );
        let cached_backend = MockBackend::default();
        let cached = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            gate("race-beat"),
            Arc::new(cached_backend.clone()),
        )
        .await
        .expect("duplicate reuses accepted job");
        assert_eq!(cached.text(), certified.text());
        assert_eq!(cached_backend.call_count(), 0);
        let counts = voice_family_accept_counts(&path).unwrap();
        assert_eq!(counts.values().sum::<u64>(), 1);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn accepted_reasoning_trace_survives_the_durable_voice_cache() {
        let path = test_path("reasoning-trace");
        let _ = fs::remove_file(&path);
        let config = single_candidate(VoiceRoutingConfig {
            max_attempts: 1,
            hedge_width: 1,
            spend_ceiling_microdollars: u64::MAX,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_reasoning_output(
            "provider/tiny-a",
            "Teapot ready.",
            "I checked the warm kettle before speaking.",
        );
        let certified = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            gate("reasoning-trace-beat"),
            Arc::new(backend),
        )
        .await
        .expect("reasoning-bearing speech certifies");
        assert_eq!(
            certified.reasoning_trace(),
            Some("I checked the warm kettle before speaking.")
        );

        let cached = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            gate("reasoning-trace-beat"),
            Arc::new(MockBackend::default()),
        )
        .await
        .expect("accepted speech restores from the durable cache");
        assert_eq!(cached.reasoning_trace(), certified.reasoning_trace());
        let stored: String = crate::open_event_store(&path)
            .unwrap()
            .query_row(
                "SELECT accepted_reasoning_trace FROM ai_voice_jobs",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "I checked the warm kettle before speaking.");
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn exhaustion_is_bounded_and_rejected_bytes_never_enter_the_store() {
        let path = test_path("exhausted");
        let _ = fs::remove_file(&path);
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 2,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "raw-secret-a", 0),
            ("provider/tiny-b", "raw-secret-b", 0),
            ("provider/small-c", "raw-secret-c", 0),
        ]);
        let error = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            gate("exhausted-beat"),
            Arc::new(backend.clone()),
        )
        .await
        .expect_err("all candidates fail the anchor gate");
        assert_eq!(error.code(), "voice_candidates_exhausted");
        assert_eq!(error.rejections().len(), 3);
        assert_eq!(backend.call_count(), 3);
        let conn = crate::open_event_store(&path).unwrap();
        let receipts: String = conn
            .query_row(
                "SELECT GROUP_CONCAT(receipt_json, '') FROM ai_publication_attempts",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!receipts.contains("raw-secret"));
        let status: String = conn
            .query_row("SELECT status FROM ai_voice_jobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(status, "unavailable");
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn repeated_signature_phrase_exhaustion_stays_inside_the_attempt_budget() {
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 2,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            (
                "provider/tiny-a",
                "Bethlehem at last, my biscuit survived the journey beneath clear bells.",
                0,
            ),
            (
                "provider/tiny-b",
                "Bethlehem at last, my biscuit survived the journey through silver rain.",
                0,
            ),
            (
                "provider/small-c",
                "Bethlehem at last, my biscuit survived the journey beside warm lanterns.",
                0,
            ),
        ]);
        let mut publication_gate = gate("signature-exhausted-beat");
        publication_gate.max_words = 24;
        publication_gate.anchors = vec!["Bethlehem".to_string()];
        publication_gate.recent_speaker_shingle_hashes =
            crate::ai_publication::voice_signature_shingle_hashes(
                "Bethlehem at last! My biscuit survived the journey, though my knees are filing a formal complaint.",
            );

        let error = route_certified_voice_with(
            &config,
            None,
            request("dialogue_avatar"),
            publication_gate,
            Arc::new(backend.clone()),
        )
        .await
        .expect_err("every candidate repeats the same speaker's signature phrase");

        assert_eq!(error.code(), "voice_candidates_exhausted");
        assert_eq!(error.rejections().len(), 3);
        assert!(error.rejections().iter().all(|rejection| {
            rejection.failure_code
                == crate::ai_publication::PublicationCheckCode::VoiceRecentDuplicate
        }));
        assert_eq!(
            backend.call_count(),
            3,
            "phrase rejection never creates an unbounded retry loop"
        );
    }

    #[tokio::test]
    async fn latency_ceiling_cancels_only_the_bounded_hedge_and_cools_endpoints() {
        let path = test_path("latency");
        let _ = fs::remove_file(&path);
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 3,
            hedge_width: 2,
            latency_ceiling: Duration::from_millis(20),
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "Teapot late a.", 200),
            ("provider/tiny-b", "Teapot late b.", 200),
            ("provider/small-c", "Teapot late c.", 200),
        ]);
        let error = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            gate("latency-beat"),
            Arc::new(backend.clone()),
        )
        .await
        .expect_err("overall deadline wins");
        assert_eq!(error.code(), "voice_latency_exhausted");
        assert_eq!(backend.call_count(), 2);
        let conn = crate::open_event_store(&path).unwrap();
        let cooled: u64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_voice_provider_health
                 WHERE cooldown_until_ms > 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cooled, 2);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn accepted_line_replays_without_rerunning_selection() {
        let path = test_path("replay");
        let _ = fs::remove_file(&path);
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 1,
            ..VoiceRoutingConfig::default()
        });
        let backend = MockBackend::with_outputs([
            ("provider/tiny-a", "Teapot replay a.", 0),
            ("provider/tiny-b", "Teapot replay b.", 0),
            ("provider/small-c", "Teapot replay c.", 0),
        ]);
        let mut replay_gate = gate("replay-beat");
        replay_gate.speaker_actor_id = 1001;
        replay_gate.speaker_name = "Rati".to_string();
        let certified = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            replay_gate.clone(),
            Arc::new(backend),
        )
        .await
        .unwrap();
        let receipt = certified.receipt().clone();
        let content_id = 99_391;
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id: 1001,
                content_id,
                ..CwAction::default()
            },
            39_100,
        );
        record
            .content_upserts
            .insert(content_id, certified.text().to_string());
        record.ai_publication = Some(receipt.clone());
        crate::append_action_journal(&path, &record).unwrap();
        let replayed = RuntimeWorld::from_action_journal(&path).unwrap();
        assert!(replayed
            .ai_publications
            .contains_key(&receipt.generation_id));

        let replay_backend = MockBackend::default();
        let cached = route_certified_voice_with(
            &config,
            Some(&path),
            request("dialogue_avatar"),
            replay_gate,
            Arc::new(replay_backend.clone()),
        )
        .await
        .unwrap();
        assert_eq!(cached.text(), certified.text());
        assert_eq!(replay_backend.call_count(), 0);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn diversity_metrics_observe_more_than_one_accepted_family() {
        let path = test_path("diversity");
        let _ = fs::remove_file(&path);
        let config = three_candidates(VoiceRoutingConfig {
            max_attempts: 1,
            ..VoiceRoutingConfig::default()
        });
        for index in 0..12 {
            let backend = MockBackend::default();
            route_certified_voice_with(
                &config,
                Some(&path),
                request("dialogue_avatar"),
                gate(&format!("diversity-beat-{index}")),
                Arc::new(backend),
            )
            .await
            .unwrap();
        }
        let counts = voice_family_accept_counts(&path).unwrap();
        assert!(counts.len() >= 2, "{counts:?}");
        assert_eq!(counts.values().sum::<u64>(), 12);
        let _ = fs::remove_file(path);
    }
}
