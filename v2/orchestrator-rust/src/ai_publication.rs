use crate::{
    ai_gateway::{ai_model_name, ai_provider_name, AiCompletion, AiConfig, AiTokenUsage},
    content_policy::{
        human_message_is_cozy_safe, human_message_is_public_safe, normalized_resident_speech_key,
    },
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, io, path::Path};

pub(crate) const AI_PUBLICATION_RECEIPT_VERSION: u32 = 1;
pub(crate) const VOICE_SIGNATURE_SHINGLE_WIDTH: usize = 4;
const VOICE_SIGNATURE_MIN_SHARED_SHINGLES: usize = 2;
const VOICE_SIGNATURE_WORD_LIMIT: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BeatForm {
    PureDialogue,
    SingleSentence,
    UnresolvedQuestion,
    NoSimile,
}

impl BeatForm {
    pub(crate) fn for_beat(completed_beats: u64) -> Self {
        match completed_beats % 4 {
            0 => Self::PureDialogue,
            1 => Self::SingleSentence,
            2 => Self::UnresolvedQuestion,
            _ => Self::NoSimile,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::PureDialogue => "pure_dialogue",
            Self::SingleSentence => "single_sentence",
            Self::UnresolvedQuestion => "unresolved_question",
            Self::NoSimile => "no_simile",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct VoiceBeatRequirements {
    pub(crate) required_form: Option<BeatForm>,
    pub(crate) consecutive_deferrals: u8,
    pub(crate) must_act_or_block: bool,
    pub(crate) anomalies: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SpeechMode {
    Prose,
    EmojiOnly,
    EmoteOnly,
    Raw,
}

impl SpeechMode {
    pub(crate) fn from_name(value: &str) -> Self {
        match value {
            "emoji_only" => Self::EmojiOnly,
            "emote_only" => Self::EmoteOnly,
            "raw" => Self::Raw,
            _ => Self::Prose,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Prose => "prose",
            Self::EmojiOnly => "emoji_only",
            Self::EmoteOnly => "emote_only",
            Self::Raw => "raw",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(clippy::enum_variant_names)]
pub(crate) enum PublicationCheckCode {
    VoiceEnvelopeInvalid,
    VoiceEmpty,
    VoiceBudgetExceeded,
    VoiceFinishIncomplete,
    VoiceRepeatedNgram,
    VoiceMultipleSpeakers,
    VoiceInstructionLeakage,
    VoiceModeMismatch,
    VoiceAnchorMissing,
    VoiceRecentDuplicate,
    VoiceUnsafeTone,
    VoiceProposedActionClaim,
    // Append-only. Stored receipts keep the codes they were written with, so a
    // new variant never changes how an old rejection reads.
    VoiceObjectAgency,
    VoiceFallbackIdentity,
    VoiceSignpostOpening,
    VoiceQuestionMonoculture,
    VoiceBeatFormMismatch,
    VoiceTerminalAphorism,
    VoiceUnbackedActionIntent,
    VoiceActionBudgetExceeded,
    VoiceAnomalyOmitted,
}

impl PublicationCheckCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::VoiceEnvelopeInvalid => "voice_envelope_invalid",
            Self::VoiceEmpty => "voice_empty",
            Self::VoiceBudgetExceeded => "voice_budget_exceeded",
            Self::VoiceFinishIncomplete => "voice_finish_incomplete",
            Self::VoiceRepeatedNgram => "voice_repeated_ngram",
            Self::VoiceMultipleSpeakers => "voice_multiple_speakers",
            Self::VoiceInstructionLeakage => "voice_instruction_leakage",
            Self::VoiceModeMismatch => "voice_mode_mismatch",
            Self::VoiceAnchorMissing => "voice_anchor_missing",
            Self::VoiceRecentDuplicate => "voice_recent_duplicate",
            Self::VoiceUnsafeTone => "voice_unsafe_tone",
            Self::VoiceProposedActionClaim => "voice_proposed_action_claim",
            Self::VoiceObjectAgency => "voice_object_agency",
            Self::VoiceFallbackIdentity => "voice_fallback_identity",
            Self::VoiceSignpostOpening => "voice_signpost_opening",
            Self::VoiceQuestionMonoculture => "voice_question_monoculture",
            Self::VoiceBeatFormMismatch => "voice_beat_form_mismatch",
            Self::VoiceTerminalAphorism => "voice_terminal_aphorism",
            Self::VoiceUnbackedActionIntent => "voice_unbacked_action_intent",
            Self::VoiceActionBudgetExceeded => "voice_action_budget_exceeded",
            Self::VoiceAnomalyOmitted => "voice_anomaly_omitted",
        }
    }

    /// Narrative variety is useful for ranking, but it is not a safety,
    /// grounding, or action-authority boundary. A safe grounded line must not
    /// disappear merely because its prose shape differs from the requested
    /// rotation.
    pub(crate) fn blocks_publication(self) -> bool {
        self != Self::VoiceBeatFormMismatch
    }

    fn is_narrative_preference(self) -> bool {
        !self.blocks_publication()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct SpeechGateContext {
    pub(crate) feature: &'static str,
    pub(crate) generation_key: String,
    pub(crate) speaker_actor_id: u64,
    pub(crate) speaker_name: String,
    pub(crate) other_speaker_names: Vec<String>,
    pub(crate) mode: SpeechMode,
    pub(crate) max_words: usize,
    pub(crate) anchors: Vec<String>,
    /// Place names that must not be used as the first words of a conversational
    /// opening. They remain valid anchors later in the line; this only rejects
    /// the repetitive signpost shape ("Mossbell Inn, I've arrived").
    pub(crate) signpost_openers: Vec<String>,
    pub(crate) recent_lines: Vec<String>,
    pub(crate) recent_speaker_shingle_hashes: Vec<u64>,
    pub(crate) has_proposed_action: bool,
    pub(crate) requirements: VoiceBeatRequirements,
    pub(crate) envelope_valid: bool,
    pub(crate) candidate_round: u8,
}

/// A deterministic rank for candidates that have already passed every hard
/// publication check. This is intentionally not another safety gate and does
/// not ask a second model to judge the first one: it only prefers deeper scene
/// grounding, then narrative-shape fit, then voice variety, then wording that
/// is less similar to recent dialogue, then lexical variety. The tuple ordering
/// is the selection policy.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct SpeechCandidateScore {
    pub(crate) anchor_matches: u16,
    pub(crate) narrative_preference_matches: u8,
    pub(crate) voice_variety_bps: u16,
    pub(crate) novelty_bps: u16,
    pub(crate) lexical_diversity_bps: u16,
}

pub(crate) fn score_speech_candidate(
    value: &str,
    context: &SpeechGateContext,
) -> SpeechCandidateScore {
    let words = normalized_words(value);
    let candidate_words = words.iter().cloned().collect::<BTreeSet<_>>();
    let anchors = anchor_tokens(&context.anchors);
    let place_name_tokens = anchor_tokens(&context.signpost_openers);
    let anchor_matches = candidate_words
        .iter()
        .filter(|word| {
            !place_name_tokens
                .iter()
                .any(|place| anchor_words_match(word, place))
                && anchors
                    .iter()
                    .any(|anchor| anchor_words_match(word, anchor))
        })
        .count()
        // More than four scene references mostly rewards longer, anchor-stuffed
        // prose rather than a better conversational reply.
        .min(4) as u16;
    let max_recent_similarity_bps = context
        .recent_lines
        .iter()
        .map(|recent| token_set_similarity_bps(&candidate_words, recent))
        .max()
        .unwrap_or_default();
    let lexical_diversity_bps = if words.is_empty() {
        0
    } else {
        ((candidate_words.len() * 10_000) / words.len()).min(10_000) as u16
    };
    let narrative_preference_matches = evaluate_checks(value, value, "stop", context)
        .into_iter()
        .filter(|check| check.code.is_narrative_preference() && check.passed)
        .count() as u8;
    let voice_variety_bps =
        if reuses_overused_voice_term(value, &context.recent_speaker_shingle_hashes)
            || reuses_recent_closing(value, &context.recent_speaker_shingle_hashes)
        {
            0
        } else {
            10_000
        };
    SpeechCandidateScore {
        anchor_matches,
        narrative_preference_matches,
        voice_variety_bps,
        novelty_bps: 10_000u16.saturating_sub(max_recent_similarity_bps),
        lexical_diversity_bps,
    }
}

fn token_set_similarity_bps(candidate_words: &BTreeSet<String>, other: &str) -> u16 {
    let other_words = normalized_words(other).into_iter().collect::<BTreeSet<_>>();
    if candidate_words.is_empty() || other_words.is_empty() {
        return 0;
    }
    let overlap = candidate_words.intersection(&other_words).count();
    let union = candidate_words.union(&other_words).count();
    ((overlap * 10_000) / union).min(10_000) as u16
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PublicationCheck {
    pub(crate) code: PublicationCheckCode,
    pub(crate) passed: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct AiPublicationReceipt {
    pub(crate) schema_version: u32,
    pub(crate) generation_id: String,
    pub(crate) generation_key: String,
    pub(crate) candidate_id: String,
    pub(crate) publication_id: String,
    pub(crate) feature: String,
    pub(crate) prompt_version: String,
    pub(crate) context_hash: String,
    pub(crate) candidate_hash: String,
    pub(crate) output_hash: String,
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) prompt_adapter_id: String,
    pub(crate) prompt_adapter_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model_attribution: Option<crate::ai_gateway::ModelAttribution>,
    pub(crate) finish_reason: String,
    pub(crate) usage: AiTokenUsage,
    pub(crate) attempts: u8,
    pub(crate) candidate_round: u8,
    pub(crate) latency_ms: u64,
    pub(crate) checks: Vec<PublicationCheck>,
}

#[derive(Clone, Debug)]
pub(crate) struct CertifiedSpeech {
    text: String,
    reasoning_trace: Option<String>,
    receipt: AiPublicationReceipt,
    prior_rejections: Vec<PublicationRejection>,
}

impl CertifiedSpeech {
    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    pub(crate) fn receipt(&self) -> &AiPublicationReceipt {
        &self.receipt
    }

    pub(crate) fn reasoning_trace(&self) -> Option<&str> {
        self.reasoning_trace.as_deref()
    }

    pub(crate) fn into_parts(self) -> (String, AiPublicationReceipt) {
        (self.text, self.receipt)
    }

    pub(crate) fn with_prior_rejections(
        mut self,
        prior_rejections: Vec<PublicationRejection>,
    ) -> Self {
        self.prior_rejections = prior_rejections;
        self
    }

    pub(crate) fn restore(
        text: String,
        reasoning_trace: Option<String>,
        receipt: AiPublicationReceipt,
    ) -> Option<Self> {
        receipt_matches_text(&receipt, &text).then_some(Self {
            text,
            reasoning_trace,
            receipt,
            prior_rejections: Vec::new(),
        })
    }

    pub(crate) fn prior_rejections(&self) -> &[PublicationRejection] {
        &self.prior_rejections
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PublicationRejection {
    pub(crate) receipt: AiPublicationReceipt,
    pub(crate) failure_code: PublicationCheckCode,
    /// The normalized run of words that tripped the recent-duplicate check.
    /// This is diagnostic only and never returns to a model prompt. It stays
    /// off the durable receipt so rejected prose does not become world state.
    pub(crate) repeated_phrase: Option<String>,
}

impl std::fmt::Display for PublicationRejection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.failure_code.as_str())
    }
}

pub(crate) fn certify_speech(
    config: Option<&AiConfig>,
    completion: AiCompletion,
    candidate_text: &str,
    context: SpeechGateContext,
) -> Result<CertifiedSpeech, Box<PublicationRejection>> {
    let reasoning_trace = completion.reasoning_trace.clone();
    let text = bounded_normalize(candidate_text, &context);
    let candidate_hash = sha256_hex(completion.text.as_bytes());
    let output_hash = sha256_hex(text.as_bytes());
    let generation_id = publication_generation_id(&context, &completion.prompt_version);
    let candidate_id = sha256_hex(
        format!(
            "{}\0{}\0{}",
            generation_id, context.candidate_round, candidate_hash
        )
        .as_bytes(),
    );
    let publication_id = sha256_hex(format!("{}\0{}", generation_id, output_hash).as_bytes());

    let checks = evaluate_checks(&text, candidate_text, &completion.finish_reason, &context);
    let repeated_phrase = checks
        .iter()
        .any(|check| check.code == PublicationCheckCode::VoiceRecentDuplicate && !check.passed)
        .then(|| duplicated_phrase(&text, &context))
        .flatten();
    let prompt_adapter_id = completion
        .model_attribution
        .as_ref()
        .map(|attribution| attribution.prompt_adapter_id.clone())
        .unwrap_or_else(|| "legacy-default".to_string());
    let prompt_adapter_version = completion
        .model_attribution
        .as_ref()
        .map(|attribution| attribution.prompt_adapter_version.clone())
        .unwrap_or_else(|| "1".to_string());
    let receipt = AiPublicationReceipt {
        schema_version: AI_PUBLICATION_RECEIPT_VERSION,
        generation_id,
        generation_key: context.generation_key,
        candidate_id,
        publication_id,
        feature: context.feature.to_string(),
        prompt_version: completion.prompt_version,
        context_hash: completion.context_hash,
        candidate_hash,
        output_hash,
        provider: completion
            .model_attribution
            .as_ref()
            .map(|attribution| attribution.provider.clone())
            .unwrap_or_else(|| ai_provider_name(config).to_string()),
        model: completion
            .model_attribution
            .as_ref()
            .map(|attribution| attribution.resolved_model_id.clone())
            .unwrap_or_else(|| ai_model_name(config)),
        prompt_adapter_id,
        prompt_adapter_version,
        model_attribution: completion.model_attribution,
        finish_reason: completion.finish_reason,
        usage: completion.usage,
        attempts: completion.attempts,
        candidate_round: context.candidate_round,
        latency_ms: completion.latency.as_millis() as u64,
        checks,
    };
    if let Some(failure_code) = receipt
        .checks
        .iter()
        .find_map(|check| (!check.passed && check.code.blocks_publication()).then_some(check.code))
    {
        return Err(Box::new(PublicationRejection {
            receipt,
            failure_code,
            repeated_phrase,
        }));
    }
    Ok(CertifiedSpeech {
        text,
        reasoning_trace,
        receipt,
        prior_rejections: Vec::new(),
    })
}

#[cfg(test)]
pub(crate) fn certified_test_speech(
    text: &str,
    speaker_actor_id: u64,
    speaker_name: &str,
) -> CertifiedSpeech {
    let completion = AiCompletion {
        text: text.to_string(),
        reasoning_trace: None,
        attempts: 1,
        latency: std::time::Duration::ZERO,
        model_attribution: None,
        resolved_model_id: "test/model".to_string(),
        finish_reason: "stop".to_string(),
        usage: AiTokenUsage::default(),
        context_hash: "test-context".to_string(),
        prompt_version: "test-prompt-v1".to_string(),
    };
    let context = SpeechGateContext {
        feature: "test_speech",
        generation_key: format!("test:{speaker_actor_id}"),
        speaker_actor_id,
        speaker_name: speaker_name.to_string(),
        other_speaker_names: Vec::new(),
        mode: SpeechMode::Prose,
        max_words: 80,
        anchors: vec!["Keeper Brass Key".to_string()],
        signpost_openers: Vec::new(),
        recent_lines: Vec::new(),
        recent_speaker_shingle_hashes: Vec::new(),
        has_proposed_action: false,
        requirements: VoiceBeatRequirements::default(),
        envelope_valid: true,
        candidate_round: 1,
    };
    certify_speech(None, completion, text, context).expect("test speech certifies")
}

pub(crate) fn publication_generation_id(
    context: &SpeechGateContext,
    prompt_version: &str,
) -> String {
    publication_generation_id_for(
        context.feature,
        prompt_version,
        &context.generation_key,
        context.speaker_actor_id,
    )
}

fn publication_generation_id_for(
    feature: &str,
    prompt_version: &str,
    generation_key: &str,
    speaker_actor_id: u64,
) -> String {
    sha256_hex(
        format!(
            "{}\0{}\0{}\0{}",
            feature, prompt_version, generation_key, speaker_actor_id
        )
        .as_bytes(),
    )
}

pub(crate) fn receipt_matches_text(receipt: &AiPublicationReceipt, text: &str) -> bool {
    receipt.schema_version == AI_PUBLICATION_RECEIPT_VERSION
        && receipt.output_hash == sha256_hex(text.as_bytes())
        && receipt.publication_id
            == sha256_hex(format!("{}\0{}", receipt.generation_id, receipt.output_hash).as_bytes())
}

pub(crate) fn init_ai_publication_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_publication_attempts (
            candidate_id TEXT PRIMARY KEY,
            generation_id TEXT NOT NULL,
            publication_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('rejected', 'certified')),
            failure_code TEXT,
            receipt_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_publication_attempts_generation
            ON ai_publication_attempts(generation_id);",
    )
    .map_err(crate::sqlite_error)
}

pub(crate) fn append_ai_publication_attempt(
    path: &Path,
    receipt: &AiPublicationReceipt,
    status: &str,
    failure_code: Option<&str>,
) -> io::Result<()> {
    crate::init_event_store(path)?;
    let conn = crate::open_event_store(path)?;
    insert_ai_publication_attempt(&conn, receipt, status, failure_code)
}

pub(crate) fn insert_ai_publication_attempt(
    conn: &Connection,
    receipt: &AiPublicationReceipt,
    status: &str,
    failure_code: Option<&str>,
) -> io::Result<()> {
    if !matches!(status, "rejected" | "certified") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid AI publication attempt status",
        ));
    }
    let receipt_json = serde_json::to_string(receipt)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    conn.execute(
        "INSERT OR IGNORE INTO ai_publication_attempts
            (candidate_id, generation_id, publication_id, status, failure_code,
             receipt_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            receipt.candidate_id.as_str(),
            receipt.generation_id.as_str(),
            receipt.publication_id.as_str(),
            status,
            failure_code,
            receipt_json,
            crate::now_millis() as i64,
        ],
    )
    .map_err(crate::sqlite_error)?;
    Ok(())
}

pub(crate) fn record_rejected_ai_publication(
    state: &crate::AppState,
    error: &crate::prompts::GeneratedSpeechError,
) {
    record_ai_publication_rejections_with_logs(state, error.rejections());
}

pub(crate) fn record_ai_publication_rejections_with_logs(
    state: &crate::AppState,
    rejections: &[PublicationRejection],
) {
    for rejection in rejections {
        tracing::warn!(
            generation_id = %rejection.receipt.generation_id,
            feature = %rejection.receipt.feature,
            failure_code = rejection.failure_code.as_str(),
            candidate_round = rejection.receipt.candidate_round,
            provider = %rejection.receipt.provider,
            requested_model = %rejection.receipt.model,
            // Which run tripped the gate, so a duplicate storm is diagnosable
            // from logs alone. Normalized tokens from a line no player saw, and
            // only ever on the rejection path.
            repeated_phrase = rejection.repeated_phrase.as_deref().unwrap_or("-"),
            "AI voice candidate rejected by publication gate"
        );
    }
    record_ai_publication_rejections(state, rejections);
}

pub(crate) fn record_prior_ai_publication_rejections(
    state: &crate::AppState,
    speech: &CertifiedSpeech,
) {
    record_ai_publication_rejections(state, speech.prior_rejections());
}

pub(crate) fn into_recorded_speech_parts(
    state: &crate::AppState,
    speech: CertifiedSpeech,
) -> (String, AiPublicationReceipt) {
    record_prior_ai_publication_rejections(state, &speech);
    let parts = speech.into_parts();
    if let Some(path) = state.event_store_path.as_deref() {
        if let Err(ledger_error) = append_ai_publication_attempt(path, &parts.1, "certified", None)
        {
            tracing::warn!(
                "failed to append certified AI publication receipt to {}: {}",
                path.display(),
                ledger_error
            );
        }
    }
    parts
}

fn record_ai_publication_rejections(state: &crate::AppState, rejections: &[PublicationRejection]) {
    let Some(path) = state.event_store_path.as_deref() else {
        return;
    };
    for rejection in rejections {
        if let Err(ledger_error) = append_ai_publication_attempt(
            path,
            &rejection.receipt,
            "rejected",
            Some(rejection.failure_code.as_str()),
        ) {
            tracing::warn!(
                "failed to append rejected AI publication receipt to {}: {}",
                path.display(),
                ledger_error
            );
        }
    }
}

impl crate::RuntimeWorld {
    pub(crate) fn ai_publication_preconditions_hold(&self, record: &crate::JournalRecord) -> bool {
        let Some(receipt) = record.ai_publication.as_ref() else {
            return true;
        };
        let publishes_generated_content = record.action.kind == crate::CW_ACTION_SAY
            || (record.action.kind == crate::CW_ACTION_NONE
                && record.origin == crate::JournalOrigin::ActorConsequence
                && record.projection_mutations.len() == 1
                && record
                    .projection_mutations
                    .iter()
                    .any(|mutation| match mutation {
                        crate::ProjectionMutation::RecordAvatarReflection {
                            content_id, ..
                        } => *content_id == record.action.content_id,
                        crate::ProjectionMutation::RecordAvatarSelfDescription(projection) => {
                            projection.content_id == record.action.content_id
                        }
                        crate::ProjectionMutation::RecordEntitySelfDescription(projection) => {
                            projection.content_id == record.action.content_id
                        }
                        _ => false,
                    }));
        let published_text = if publishes_generated_content {
            record.content_upserts.get(&record.action.content_id)
        } else {
            None
        };
        // A generation key is not always unique per utterance: the
        // deterministic-fallback key is a pure function of actor and scope, so
        // two different lines by one resident derive the same generation id.
        // The live path accepts both, so replay must too — rejecting the second
        // leaves the world permanently unbootable. Only a receipt that
        // reproduces a registered publication byte for byte is a true repeat,
        // and that is handled as already-applied rather than as a violation.
        if self.ai_publication_record_already_applied(record) {
            // Not a violation: apply_journal_record's already-applied group
            // turns this into an idempotent skip.
            return true;
        }
        receipt.generation_id
            == publication_generation_id_for(
                &receipt.feature,
                &receipt.prompt_version,
                &receipt.generation_key,
                record.action.actor_id,
            )
            && published_text.is_some_and(|text| receipt_matches_text(receipt, text))
    }

    /// True when this record's publication is already reflected in world state.
    ///
    /// Registration is keyed by generation id, but a colliding id whose output
    /// differs belongs to a distinct utterance that still has to be applied, so
    /// only an identical output counts as already applied.
    pub(crate) fn ai_publication_record_already_applied(
        &self,
        record: &crate::JournalRecord,
    ) -> bool {
        let Some(receipt) = record.ai_publication.as_ref() else {
            return false;
        };
        self.ai_publications
            .get(&receipt.generation_id)
            .is_some_and(|stored| stored.output_hash == receipt.output_hash)
    }
}

fn evaluate_checks(
    text: &str,
    candidate_text: &str,
    finish_reason: &str,
    context: &SpeechGateContext,
) -> Vec<PublicationCheck> {
    let word_count = text.split_whitespace().count();
    let lowered = text.to_ascii_lowercase();
    let raw = context.mode == SpeechMode::Raw;
    let safe_tone = if raw {
        human_message_is_public_safe(text)
    } else {
        human_message_is_cozy_safe(text)
    };
    let checks = [
        (
            PublicationCheckCode::VoiceEnvelopeInvalid,
            context.envelope_valid,
        ),
        (PublicationCheckCode::VoiceEmpty, !text.is_empty()),
        (
            PublicationCheckCode::VoiceBudgetExceeded,
            word_count <= context.max_words
                && text.chars().count() <= if raw { 1_200 } else { 360 },
        ),
        (
            PublicationCheckCode::VoiceFinishIncomplete,
            matches!(finish_reason, "stop" | "end_turn")
                && (raw || has_clean_terminal_structure(text)),
        ),
        (
            PublicationCheckCode::VoiceRepeatedNgram,
            !has_repeated_ngram(text, 3),
        ),
        (
            PublicationCheckCode::VoiceMultipleSpeakers,
            !has_multiple_speakers(candidate_text, context),
        ),
        (
            PublicationCheckCode::VoiceInstructionLeakage,
            raw || !contains_instruction_leakage(&lowered),
        ),
        (
            PublicationCheckCode::VoiceModeMismatch,
            mode_matches(text, context.mode),
        ),
        (
            PublicationCheckCode::VoiceAnchorMissing,
            has_deterministic_anchor(text, &context.anchors, context.mode),
        ),
        (
            PublicationCheckCode::VoiceRecentDuplicate,
            !repeats_recent_dialogue(text, context)
                && !shares_recent_speaker_phrase(text, &context.recent_speaker_shingle_hashes),
        ),
        (
            PublicationCheckCode::VoiceUnsafeTone,
            safe_tone && !contains_unsafe_tone(&lowered),
        ),
        (
            PublicationCheckCode::VoiceProposedActionClaim,
            !context.has_proposed_action || !claims_completed_action(&lowered),
        ),
        (
            PublicationCheckCode::VoiceObjectAgency,
            !scene_object_acts_with_volition(&lowered),
        ),
        (
            PublicationCheckCode::VoiceFallbackIdentity,
            raw || !contains_numeric_traveler_identity(text),
        ),
        (
            PublicationCheckCode::VoiceSignpostOpening,
            context.mode != SpeechMode::Prose
                || !has_non_signpost_anchor(context)
                || !starts_with_signpost_anchor(text, &context.signpost_openers),
        ),
        (
            PublicationCheckCode::VoiceQuestionMonoculture,
            context.mode != SpeechMode::Prose
                || context.requirements.required_form == Some(BeatForm::UnresolvedQuestion)
                || !question_shape_is_overused(text, context),
        ),
        (
            PublicationCheckCode::VoiceBeatFormMismatch,
            context.mode != SpeechMode::Prose
                || context
                    .requirements
                    .required_form
                    .is_none_or(|form| beat_form_matches(text, form)),
        ),
        (
            PublicationCheckCode::VoiceTerminalAphorism,
            context.mode != SpeechMode::Prose || !has_terminal_aphorism(text),
        ),
        (
            PublicationCheckCode::VoiceUnbackedActionIntent,
            context.mode != SpeechMode::Prose
                || context.has_proposed_action
                || !announces_action_intent(text)
                || states_blocking_reason(text),
        ),
        (
            PublicationCheckCode::VoiceActionBudgetExceeded,
            context.mode != SpeechMode::Prose
                || !context.requirements.must_act_or_block
                || context.has_proposed_action
                || states_blocking_reason(text),
        ),
        (
            PublicationCheckCode::VoiceAnomalyOmitted,
            context.requirements.anomalies.is_empty()
                || mentions_supplied_anomaly(text, &context.requirements.anomalies),
        ),
    ];
    checks
        .into_iter()
        .map(|(code, passed)| PublicationCheck { code, passed })
        .collect()
}

fn beat_form_matches(value: &str, form: BeatForm) -> bool {
    match form {
        BeatForm::PureDialogue => !contains_stage_direction(value),
        BeatForm::SingleSentence => sentence_count(value) == 1,
        BeatForm::UnresolvedQuestion => value.trim_end().ends_with('?'),
        BeatForm::NoSimile => !contains_simile(value),
    }
}

fn contains_stage_direction(value: &str) -> bool {
    value.contains('*') || value.contains('[') || value.contains(']') || value.lines().count() > 1
}

fn sentence_count(value: &str) -> usize {
    let mut count = 0usize;
    let mut in_terminal_run = false;
    for character in value.chars() {
        if matches!(character, '.' | '!' | '?') {
            if !in_terminal_run {
                count += 1;
                in_terminal_run = true;
            }
        } else if !character.is_whitespace()
            && !matches!(character, '"' | '\'' | '”' | '’' | ')' | ']' | '}')
        {
            in_terminal_run = false;
        }
    }
    if count == 0 && value.chars().any(char::is_alphanumeric) {
        1
    } else {
        count
    }
}

fn contains_simile(value: &str) -> bool {
    let lowered = format!(" {} ", value.to_ascii_lowercase());
    [
        " like a ",
        " like an ",
        " like the ",
        " as if ",
        " as though ",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
        || normalized_words(value)
            .windows(3)
            .any(|window| window[0] == "as" && window[2] == "as" && window[1].chars().count() >= 3)
}

fn terminal_clause(value: &str) -> &str {
    value
        .trim()
        .rsplit_once(['.', '!', '?'])
        .map(|(_, tail)| tail.trim())
        .filter(|tail| !tail.is_empty())
        .or_else(|| {
            value
                .trim_end_matches(|character: char| {
                    character.is_whitespace()
                        || matches!(character, '.' | '!' | '?' | '"' | '”' | '\'')
                })
                .rsplit_once(['.', '!', '?'])
                .map(|(_, tail)| tail.trim())
                .filter(|tail| !tail.is_empty())
        })
        .unwrap_or_else(|| value.trim())
}

fn has_terminal_aphorism(value: &str) -> bool {
    let closing = terminal_clause(value).to_ascii_lowercase();
    let words = normalized_words(&closing);
    if words.len() < 4 {
        return false;
    }
    matches!(
        words.first().map(String::as_str),
        Some("sometimes" | "perhaps" | "maybe" | "ultimately")
    ) || closing.starts_with("after all ")
        || closing.starts_with("in the end ")
        || closing.starts_with("the thing about ")
        || words
            .iter()
            .any(|word| matches!(word.as_str(), "always" | "never"))
            && words.iter().any(|word| {
                matches!(
                    word.as_str(),
                    "life" | "truth" | "world" | "people" | "things" | "heart"
                )
            })
}

fn announces_action_intent(value: &str) -> bool {
    const ACTION_VERBS: &[&str] = &[
        "answer", "ask", "bring", "call", "carry", "check", "choose", "close", "cook", "deliver",
        "drop", "fetch", "fix", "follow", "give", "go", "help", "hold", "inspect", "knit", "leave",
        "lift", "light", "lock", "look", "make", "mend", "move", "open", "pick", "place", "plant",
        "pour", "put", "read", "repair", "return", "search", "seek", "send", "set", "show",
        "speak", "stitch", "sweep", "take", "tell", "touch", "travel", "try", "unlock", "use",
        "wait", "walk", "watch", "water", "work", "write",
    ];
    let words = normalized_words(value);
    words.iter().enumerate().any(|(index, word)| {
        let action_index = match word.as_str() {
            "i'll" => index + 1,
            "will" | "shall" | "should" if index > 0 && words[index - 1] == "i" => index + 1,
            "intend" | "mean"
                if index > 0
                    && words[index - 1] == "i"
                    && words.get(index + 1).is_some_and(|word| word == "to") =>
            {
                index + 2
            }
            "going"
                if words.get(index + 1).is_some_and(|word| word == "to")
                    && ((index > 1 && words[index - 2] == "i" && words[index - 1] == "am")
                        || (index > 0 && words[index - 1] == "i'm")) =>
            {
                index + 2
            }
            "let" if words.get(index + 1).is_some_and(|word| word == "me") => index + 2,
            _ => return false,
        };
        words
            .get(action_index)
            .is_some_and(|verb| ACTION_VERBS.contains(&verb.as_str()))
    })
}

fn states_blocking_reason(value: &str) -> bool {
    let lowered = format!(" {} ", normalized_words(value).join(" "));
    [
        " because ",
        " until ",
        " cannot ",
        " can't ",
        " blocked ",
        " waiting for ",
        " need ",
        " needs ",
        " missing ",
        " no route ",
        " no way ",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
}

pub(crate) fn line_defers_action(value: &str) -> bool {
    let lowered = format!(" {} ", normalized_words(value).join(" "));
    [
        " not yet ",
        " for now ",
        " later ",
        " wait before ",
        " leave it ",
        " won't touch ",
        " will not touch ",
        " shouldn't touch ",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
}

pub(crate) fn consecutive_speaker_deferrals(recent_lines: &[String], speaker_name: &str) -> u8 {
    recent_lines
        .iter()
        .rev()
        .filter_map(|line| {
            let (speaker, spoken) = line.split_once(':')?;
            speaker
                .trim()
                .eq_ignore_ascii_case(speaker_name.trim())
                .then_some(spoken.trim())
        })
        .take_while(|spoken| line_defers_action(spoken))
        .count()
        .min(u8::MAX as usize) as u8
}

fn mentions_supplied_anomaly(value: &str, anomalies: &[String]) -> bool {
    let candidate = normalized_words(value).into_iter().collect::<BTreeSet<_>>();
    anomalies.iter().all(|anomaly| {
        let terms = normalized_words(anomaly)
            .into_iter()
            .filter(|word| word.chars().count() >= 4)
            .collect::<BTreeSet<_>>();
        !terms.is_empty() && candidate.intersection(&terms).count() >= 2.min(terms.len())
    })
}

fn question_shape_is_overused(value: &str, context: &SpeechGateContext) -> bool {
    let words = normalized_words(value);
    let generic_unspoken_question = value.contains('?')
        && words.iter().any(|word| {
            matches!(
                word.as_str(),
                "question" | "truth" | "secret" | "topic" | "something"
            )
        })
        && words
            .iter()
            .any(|word| matches!(word.as_str(), "everyone" | "everybody" | "people"))
        && words.iter().any(|word| {
            matches!(
                word.as_str(),
                "avoid" | "avoids" | "avoiding" | "skipped" | "unasked" | "unsaid" | "stepping"
            )
        });
    if generic_unspoken_question {
        return true;
    }
    if !value.trim_end().ends_with('?') {
        return false;
    }

    context
        .recent_lines
        .iter()
        .rev()
        .filter(|recent| attributed_recent_line(recent, context).is_none())
        .map(|recent| spoken_words_of(recent, context).trim_end())
        .take(2)
        .filter(|spoken| spoken.ends_with('?'))
        .count()
        >= 2
}

fn starts_with_signpost_anchor(value: &str, anchors: &[String]) -> bool {
    let candidate = normalized_words(value);
    anchors.iter().any(|anchor| {
        let anchor = normalized_words(anchor);
        !anchor.is_empty() && candidate.starts_with(&anchor)
    })
}

fn has_non_signpost_anchor(context: &SpeechGateContext) -> bool {
    let mut anchors = anchor_tokens(&context.anchors);
    for signpost in &context.signpost_openers {
        for word in normalized_words(signpost) {
            anchors.remove(&word);
        }
    }
    // The speaker's own name is prompt identity, not a natural scene detail.
    // Counting it here would claim every solitary scene has an easy alternative
    // and could turn the signpost check into a bounded but fruitless retry loop.
    for word in normalized_words(&context.speaker_name) {
        anchors.remove(&word);
    }
    !anchors.is_empty()
}

fn contains_numeric_traveler_identity(value: &str) -> bool {
    normalized_words(value).windows(2).any(|pair| {
        matches!(pair[0].as_str(), "traveler" | "traveller")
            && !pair[1].is_empty()
            && pair[1].chars().all(|character| character.is_ascii_digit())
    })
}

fn has_clean_terminal_structure(value: &str) -> bool {
    let value = value.trim_end();
    if value.is_empty()
        || value.ends_with(':')
        || value.ends_with('-')
        || value.ends_with('–')
        || value.ends_with('—')
    {
        return false;
    }
    let mut delimiters = Vec::new();
    let mut straight_quote_open = false;
    let mut curly_quote_open = false;
    for character in value.chars() {
        match character {
            '(' | '[' | '{' => delimiters.push(character),
            ')' if delimiters.pop() != Some('(') => return false,
            ']' if delimiters.pop() != Some('[') => return false,
            '}' if delimiters.pop() != Some('{') => return false,
            '"' => straight_quote_open = !straight_quote_open,
            '“' if !curly_quote_open => curly_quote_open = true,
            '”' if curly_quote_open => curly_quote_open = false,
            '”' => return false,
            _ => {}
        }
    }
    delimiters.is_empty() && !straight_quote_open && !curly_quote_open
}

fn bounded_normalize(value: &str, context: &SpeechGateContext) -> String {
    let normalized = strip_outer_quote_pair(value.trim());
    if context.mode == SpeechMode::Raw {
        return normalized;
    }
    normalized
        .lines()
        .map(str::trim)
        .map(|line| strip_own_speaker_label(line, &context.speaker_name))
        .map(|line| strip_outer_quote_pair(line.trim()))
        .filter(|line| !line.is_empty())
        .flat_map(|line| {
            line.split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_outer_quote_pair(value: &str) -> String {
    if value.len() >= 2 {
        let first = value.chars().next();
        let last = value.chars().last();
        if matches!(
            (first, last),
            (Some('"'), Some('"')) | (Some('“'), Some('”'))
        ) {
            return value
                .chars()
                .skip(1)
                .take(value.chars().count().saturating_sub(2))
                .collect();
        }
    }
    value.to_string()
}

fn strip_own_speaker_label(value: &str, speaker_name: &str) -> String {
    // Model-backed residents can carry provider-qualified display names such
    // as `Anthropic: Claude Fable Latest`. Match that exact name before the
    // generic first-colon parser so punctuation inside the name is harmless.
    if let Some(rest) = value.strip_prefix(speaker_name) {
        let rest = strip_leading_speaker_annotation(rest.trim_start());
        if let Some(speech) = rest.strip_prefix(':') {
            return speech.trim_start().to_string();
        }
    }
    let Some((label, speech)) = value.split_once(':') else {
        return value.to_string();
    };
    let label = speaker_label_without_annotation(label);
    if label.contains('\n')
        || label.contains('\r')
        || canonical_speaker_label(label) != canonical_speaker_label(speaker_name)
    {
        return value.to_string();
    }
    speech.trim_start().to_string()
}

fn strip_leading_speaker_annotation(value: &str) -> &str {
    let mut value = value.trim_start();
    loop {
        let mut after_annotation = None;
        for (open, close) in [('(', ')'), ('[', ']')] {
            if let Some(rest) = value.strip_prefix(open) {
                if let Some((_, after)) = rest.split_once(close) {
                    after_annotation = Some(after.trim_start());
                    break;
                }
            }
        }
        let Some(after) = after_annotation else {
            return value;
        };
        value = after;
    }
}

fn speaker_label_without_annotation(value: &str) -> &str {
    let mut value = value.trim();
    loop {
        let mut undecorated = None;
        for (open, close) in [('(', ')'), ('[', ']')] {
            if let Some(without_close) = value.strip_suffix(close) {
                if let Some((label, _)) = without_close.rsplit_once(open) {
                    let label = label.trim_end();
                    if !label.is_empty() {
                        undecorated = Some(label);
                        break;
                    }
                }
            }
        }
        let Some(label) = undecorated else {
            return value;
        };
        value = label;
    }
}

fn canonical_speaker_label(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn normalized_words(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric() && character != '\'')
        .map(str::to_lowercase)
        .filter(|word| !word.is_empty())
        .collect()
}

fn has_repeated_ngram(value: &str, width: usize) -> bool {
    let words = normalized_words(value);
    if words.len() < width * 2 {
        return false;
    }
    let mut seen = BTreeSet::new();
    words
        .windows(width)
        .any(|window| !seen.insert(window.join("\u{1f}")))
}

pub(crate) fn voice_signature_shingle_hashes(value: &str) -> Vec<u64> {
    let words = normalized_words(value)
        .into_iter()
        .take(VOICE_SIGNATURE_WORD_LIMIT)
        .collect::<Vec<_>>();
    words
        .windows(VOICE_SIGNATURE_SHINGLE_WIDTH)
        .map(|window| {
            crate::stable_hash_u64(&["voice-signature-shingle/v1", &window.join("\u{1f}")])
        })
        .collect()
}

pub(crate) fn voice_overused_term_hash(value: &str) -> u64 {
    crate::stable_hash_u64(&["voice-overused-term/v1", value])
}

pub(crate) fn voice_closing_hash(value: &str) -> Option<u64> {
    let words = normalized_words(value);
    let start = words.len().checked_sub(4)?;
    Some(crate::stable_hash_u64(&[
        "voice-closing/v1",
        &words[start..].join("\u{1f}"),
    ]))
}

pub(crate) fn voice_content_terms(value: &str) -> BTreeSet<String> {
    const STOP_WORDS: &[&str] = &[
        "about", "after", "again", "also", "because", "before", "being", "could", "every", "from",
        "have", "here", "into", "just", "more", "only", "other", "should", "still", "than", "that",
        "their", "there", "these", "they", "this", "those", "through", "under", "very", "what",
        "when", "where", "which", "while", "with", "would", "your",
    ];
    normalized_words(value)
        .into_iter()
        .filter(|word| word.chars().count() >= 4)
        .filter(|word| !STOP_WORDS.contains(&word.as_str()))
        .collect()
}

fn reuses_overused_voice_term(value: &str, recent_hashes: &[u64]) -> bool {
    if recent_hashes.is_empty() {
        return false;
    }
    let recent = recent_hashes.iter().copied().collect::<BTreeSet<_>>();
    voice_content_terms(value)
        .iter()
        .map(|term| voice_overused_term_hash(term))
        .any(|hash| recent.contains(&hash))
}

fn reuses_recent_closing(value: &str, recent_hashes: &[u64]) -> bool {
    let Some(hash) = voice_closing_hash(value) else {
        return false;
    };
    recent_hashes.contains(&hash)
}

fn shares_recent_speaker_phrase(value: &str, recent_shingle_hashes: &[u64]) -> bool {
    shared_speaker_phrase(value, recent_shingle_hashes).is_some()
}

/// The speaker's own wording that the candidate reused, as the run of words the
/// shared shingles cover. Adjacent shingles overlap by `width - 1` words, so a
/// run of `VOICE_SIGNATURE_MIN_SHARED_SHINGLES` adjacent shingles covers
/// `VOICE_SIGNATURE_MIN_SHARED_SHINGLES + VOICE_SIGNATURE_SHINGLE_WIDTH - 1` words.
fn shared_speaker_phrase(value: &str, recent_shingle_hashes: &[u64]) -> Option<String> {
    if recent_shingle_hashes.is_empty() {
        return None;
    }
    let recent = recent_shingle_hashes
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    let start = voice_signature_shingle_hashes(value)
        .windows(VOICE_SIGNATURE_MIN_SHARED_SHINGLES)
        .position(|window| window.iter().all(|hash| recent.contains(hash)))?;
    let words = normalized_words(value)
        .into_iter()
        .take(VOICE_SIGNATURE_WORD_LIMIT)
        .collect::<Vec<_>>();
    let end = (start + VOICE_SIGNATURE_MIN_SHARED_SHINGLES + VOICE_SIGNATURE_SHINGLE_WIDTH - 1)
        .min(words.len());
    Some(words[start..end].join(" "))
}

/// The concrete wording behind a `VoiceRecentDuplicate` verdict, checked along
/// the same two paths `evaluate_checks` uses to fail it. This exists for bounded
/// diagnostics only; routing never copies it into a retry prompt.
fn duplicated_phrase(text: &str, context: &SpeechGateContext) -> Option<String> {
    shared_speaker_phrase(text, &context.recent_speaker_shingle_hashes)
        .or_else(|| repeated_dialogue_phrase(text, context))
}

/// The run `repeats_recent_dialogue` matched against, found the same way it
/// attributes a recent line: a verbatim echo of another speaker, or a
/// near-duplicate of the candidate's own prior words.
fn repeated_dialogue_phrase(text: &str, context: &SpeechGateContext) -> Option<String> {
    let candidate_key = normalized_resident_speech_key(text);
    context
        .recent_lines
        .iter()
        .find_map(|recent| match attributed_recent_line(recent, context) {
            Some(spoken) => (candidate_key == normalized_resident_speech_key(spoken))
                .then(|| longest_shared_run(text, spoken))
                .flatten(),
            None => {
                let spoken = spoken_words_of(recent, context);
                near_duplicate(text, spoken)
                    .then(|| longest_shared_run(text, spoken))
                    .flatten()
            }
        })
}

/// The longest run of words a duplicate candidate shares with the recent line
/// it duplicated. `near_duplicate` compares token sets, so a reordered
/// restatement can have no long contiguous run at all; the caller then keeps
/// the generic instruction.
fn longest_shared_run(candidate: &str, recent: &str) -> Option<String> {
    const MIN_SHARED_RUN_WORDS: usize = 3;

    let candidate = normalized_words(candidate);
    let recent = normalized_words(recent);
    if candidate.is_empty() || recent.is_empty() {
        return None;
    }
    let mut previous = vec![0usize; recent.len() + 1];
    let mut current = vec![0usize; recent.len() + 1];
    let mut best_len = 0usize;
    let mut best_end = 0usize;
    for (row, word) in candidate.iter().enumerate() {
        for (column, other) in recent.iter().enumerate() {
            current[column + 1] = if word == other {
                previous[column] + 1
            } else {
                0
            };
            if current[column + 1] > best_len {
                best_len = current[column + 1];
                best_end = row + 1;
            }
        }
        std::mem::swap(&mut previous, &mut current);
        current.iter_mut().for_each(|cell| *cell = 0);
    }
    (best_len >= MIN_SHARED_RUN_WORDS).then(|| candidate[best_end - best_len..best_end].join(" "))
}

fn has_multiple_speakers(value: &str, context: &SpeechGateContext) -> bool {
    let nonempty_lines = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let marked_turns = nonempty_lines
        .iter()
        .filter(|line| {
            line.chars()
                .next()
                .is_some_and(|character| matches!(character, '"' | '“' | '—' | '–'))
                || line
                    .strip_prefix('-')
                    .is_some_and(|rest| rest.chars().next().is_some_and(char::is_whitespace))
        })
        .count();
    if marked_turns > 1 {
        return true;
    }

    let speaker = canonical_speaker_label(&context.speaker_name);
    let other_speakers = context
        .other_speaker_names
        .iter()
        .map(|name| canonical_speaker_label(name))
        .filter(|name| !name.is_empty() && *name != speaker)
        .collect::<BTreeSet<_>>();
    // Remove the one harmless label we know exactly before scanning turn
    // boundaries. This matters for punctuated names such as `Dr. Rati`: the
    // period is otherwise indistinguishable from a sentence boundary. A
    // second same-line label remains in the scan and is rejected below.
    let label_scan = value
        .lines()
        .map(str::trim)
        .map(|line| strip_own_speaker_label(line, &context.speaker_name))
        .collect::<Vec<_>>()
        .join("\n");
    let mut own_label_lines = BTreeSet::new();
    for label in dialogue_boundary_labels(&label_scan) {
        if label.canonical == speaker {
            if !label.at_line_start || !own_label_lines.insert(label.line_index) {
                return true;
            }
            continue;
        }
        if other_speakers.contains(&label.canonical)
            || label.name_shaped
            || matches!(
                label.canonical.as_str(),
                "system" | "user" | "assistant" | "narrator" | "developer"
            )
        {
            return true;
        }
    }
    false
}

#[derive(Debug)]
struct DialogueBoundaryLabel {
    canonical: String,
    name_shaped: bool,
    line_index: usize,
    at_line_start: bool,
}

fn dialogue_boundary_labels(value: &str) -> Vec<DialogueBoundaryLabel> {
    let mut labels = Vec::new();
    for (colon, character) in value.char_indices() {
        if character != ':' {
            continue;
        }
        let before = &value[..colon];
        let start = before
            .char_indices()
            .rev()
            .find_map(|(index, character)| {
                matches!(
                    character,
                    '\n' | '\r' | '.' | '!' | '?' | ';' | '/' | '|' | '—' | '–'
                )
                .then_some(index + character.len_utf8())
            })
            .unwrap_or(0);
        let raw_label = before[start..].trim();
        let speaker_label = speaker_label_without_annotation(raw_label);
        let canonical = canonical_speaker_label(speaker_label);
        if !canonical.is_empty() {
            let line_start = before
                .char_indices()
                .rev()
                .find_map(|(index, character)| {
                    matches!(character, '\n' | '\r').then_some(index + character.len_utf8())
                })
                .unwrap_or(0);
            labels.push(DialogueBoundaryLabel {
                canonical,
                name_shaped: looks_like_speaker_label(speaker_label),
                line_index: before[..line_start]
                    .bytes()
                    .filter(|byte| *byte == b'\n')
                    .count(),
                at_line_start: start == line_start,
            });
        }
    }
    labels
}

fn looks_like_speaker_label(value: &str) -> bool {
    // A leading ASCII dash is a common dialogue bullet, not part of the name.
    // Keep internal hyphens intact for names such as Anne-Marie.
    let value = value.trim();
    let value = value
        .strip_prefix('-')
        .map(str::trim_start)
        .unwrap_or(value);
    let value = value.trim_matches(|character: char| {
        !character.is_alphanumeric() && !matches!(character, ' ' | '_' | '-' | '\'' | '’')
    });
    let words = value.split_whitespace().collect::<Vec<_>>();
    !words.is_empty()
        && words.len() <= 4
        && words.iter().all(|word| {
            word.chars().next().is_some_and(char::is_uppercase)
                && word.chars().all(|character| {
                    character.is_alphanumeric() || matches!(character, '_' | '-' | '\'' | '’')
                })
        })
}

fn contains_instruction_leakage(value: &str) -> bool {
    [
        "system prompt",
        "system message",
        "developer message",
        "developer instruction",
        "ignore previous",
        "hidden instruction",
        "my instructions",
        "your instructions",
        "language model",
        "as an ai",
        "prompt version",
        "response_format",
        "tool call",
        "token budget",
        "policy says",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}

fn mode_matches(value: &str, mode: SpeechMode) -> bool {
    match mode {
        SpeechMode::Prose => value.chars().any(char::is_alphanumeric),
        SpeechMode::Raw => !value.trim().is_empty(),
        SpeechMode::EmojiOnly => {
            let visible = value.chars().filter(|character| !character.is_whitespace());
            let count = visible
                .clone()
                .filter(|character| is_emoji(*character))
                .count();
            (3..=6).contains(&count)
                && visible
                    .filter(|character| !matches!(*character, '\u{fe0f}' | '\u{200d}'))
                    .all(is_emoji)
        }
        SpeechMode::EmoteOnly => {
            value.starts_with('*')
                && value.ends_with('*')
                && value.len() > 2
                && value[1..value.len() - 1].chars().any(char::is_alphanumeric)
                && !value.contains('"')
                && value.matches('*').count() == 2
        }
    }
}

fn is_emoji(character: char) -> bool {
    matches!(
        character as u32,
        0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2300..=0x23FF
    )
}

fn anchor_tokens(values: &[String]) -> BTreeSet<String> {
    const STOP: &[&str] = &[
        "about", "after", "again", "could", "from", "have", "into", "just", "more", "that",
        "their", "there", "these", "they", "this", "through", "what", "when", "where", "which",
        "with", "would", "your",
    ];
    values
        .iter()
        .flat_map(|value| normalized_words(value))
        .filter(|word| word.len() >= 3 && !STOP.contains(&word.as_str()))
        .collect()
}

fn has_deterministic_anchor(value: &str, anchors: &[String], mode: SpeechMode) -> bool {
    if mode == SpeechMode::EmojiOnly {
        let candidate = value.chars().filter(|character| is_emoji(*character));
        let mut anchor_emoji = anchors
            .iter()
            .flat_map(|anchor| anchor.chars())
            .filter(|character| is_emoji(*character))
            .collect::<BTreeSet<_>>();
        let lowered = anchors.join(" ").to_ascii_lowercase();
        for (needle, emoji) in [
            ("tea", '☕'),
            ("coffee", '☕'),
            ("rain", '🌧'),
            ("storm", '⛈'),
            ("sun", '☀'),
            ("fire", '🔥'),
            ("tree", '🌳'),
            ("flower", '🌸'),
            ("food", '🍽'),
            ("heart", '❤'),
            ("laugh", '😂'),
            ("cold", '🥶'),
            ("hot", '🥵'),
        ] {
            if lowered.contains(needle) {
                anchor_emoji.insert(emoji);
            }
        }
        return !anchor_emoji.is_empty()
            && candidate
                .into_iter()
                .any(|character| anchor_emoji.contains(&character));
    }
    let candidate = normalized_words(value).into_iter().collect::<BTreeSet<_>>();
    let anchors = anchor_tokens(anchors);
    // An empty anchor set rejects. A scene that offers nothing to be grounded
    // to cannot certify that a line is grounded, and silently accepting here
    // would remove the gate exactly where the scene is least described. This
    // is deliberate: see the empty-anchor test below.
    !anchors.is_empty()
        && candidate.iter().any(|word| {
            anchors
                .iter()
                .any(|anchor| anchor_words_match(word, anchor))
        })
}

/// Anchors are drawn from location names, titles, and remembered activity, so a
/// grounded line often shares a stem rather than a whole word: "rain on the
/// sill" against an anchor of `rainlit`, or "hearths" against `hearth`. Exact
/// set matching rejected those, which silenced residents deterministically —
/// resampling could not help because the mismatch is a property of the scene
/// vocabulary rather than of the sample.
///
/// Match when the words are equal, or when the shorter is a prefix of the
/// longer and is itself long enough to carry meaning. The floor keeps short
/// fragments from matching unrelated words.
fn anchor_words_match(candidate: &str, anchor: &str) -> bool {
    const MIN_SHARED_PREFIX: usize = 4;
    if candidate == anchor {
        return true;
    }
    let (shorter, longer) = if candidate.len() <= anchor.len() {
        (candidate, anchor)
    } else {
        (anchor, candidate)
    };
    shorter.len() >= MIN_SHARED_PREFIX && longer.starts_with(shorter)
}

/// Whether a candidate repeats dialogue the room has already heard.
///
/// `recent_lines` holds every speaker's recent lines as `"{Name}: {content}"`,
/// so the word-overlap test only applies to the candidate speaker's own lines.
/// A reply necessarily reuses the vocabulary of the line it answers — in a
/// two-person exchange that pushed set overlap past the threshold on almost
/// every turn, and both candidate rounds were rejected until the conversation
/// ended early. Repeating *another* speaker verbatim is still caught, because
/// echoing someone's exact words back at them is never the intended reply.
fn repeats_recent_dialogue(text: &str, context: &SpeechGateContext) -> bool {
    let candidate_key = normalized_resident_speech_key(text);
    context.recent_lines.iter().any(|recent| {
        match attributed_recent_line(recent, context) {
            // Another speaker said it. Only a verbatim echo is a duplicate,
            // because a reply is supposed to reuse the words it answers.
            Some(spoken) => candidate_key == normalized_resident_speech_key(spoken),
            // The candidate's own line, or one this gate cannot attribute.
            // Hold the stricter word-overlap bar in both cases, but compare
            // against the words that were spoken rather than the `"Name: "`
            // label in front of them: the speaker's own name is not evidence
            // that they repeated themselves.
            None => near_duplicate(text, spoken_words_of(recent, context)),
        }
    })
}

/// The words of `recent` when some *other* speaker said them.
///
/// Room lines arrive as `"{Name}: {content}"`. An unprefixed line carries no
/// attribution, so it is treated as the candidate speaker's own and held to the
/// stricter bar rather than assumed to belong to someone else.
fn attributed_recent_line<'a>(recent: &'a str, context: &SpeechGateContext) -> Option<&'a str> {
    let (speaker, spoken) = recent.split_once(':')?;
    let speaker = speaker.trim();
    if speaker.is_empty() || speaker.eq_ignore_ascii_case(context.speaker_name.trim()) {
        return None;
    }
    context
        .other_speaker_names
        .iter()
        .any(|name| name.trim().eq_ignore_ascii_case(speaker))
        .then_some(spoken)
}

/// The words of a recent room line, without the `"{Name}: "` label.
///
/// Only strips a label this gate recognises, so a line whose content happens to
/// contain a colon keeps all of its words.
fn spoken_words_of<'a>(recent: &'a str, context: &SpeechGateContext) -> &'a str {
    let Some((speaker, spoken)) = recent.split_once(':') else {
        return recent;
    };
    let speaker = speaker.trim();
    let is_known_speaker = speaker.eq_ignore_ascii_case(context.speaker_name.trim())
        || context
            .other_speaker_names
            .iter()
            .any(|name| name.trim().eq_ignore_ascii_case(speaker));
    if is_known_speaker {
        spoken.trim_start()
    } else {
        recent
    }
}

/// The smallest number of shared distinct words that can evidence a repetition.
///
/// Word-set overlap alone is order-blind and dominated by function words on a
/// short line: "I watch the door." against "I watch the door again." shares
/// only `i`, `watch`, `the`, `door` and still scores the eighty percent that
/// used to reject it. Below this floor only an exact repetition counts, which
/// leaves catchphrase detection to the shingle check, where adjacency is
/// actually measured.
const VOICE_NEAR_DUPLICATE_MIN_SHARED_WORDS: usize = 5;

fn near_duplicate(left: &str, right: &str) -> bool {
    let left_key = normalized_resident_speech_key(left);
    let right_key = normalized_resident_speech_key(right);
    if left_key == right_key {
        return true;
    }
    let left = normalized_words(&left_key)
        .into_iter()
        .collect::<BTreeSet<_>>();
    let right = normalized_words(&right_key)
        .into_iter()
        .collect::<BTreeSet<_>>();
    if left.is_empty() || right.is_empty() {
        return false;
    }
    let overlap = left.intersection(&right).count();
    let union = left.union(&right).count();
    overlap >= VOICE_NEAR_DUPLICATE_MIN_SHARED_WORDS && union > 0 && overlap * 5 >= union * 4
}

fn contains_unsafe_tone(value: &str) -> bool {
    [
        "i hate you",
        "worthless",
        "disgusting",
        "shut up",
        "idiot",
        "stupid",
        "i'll kill",
        "i will kill",
        "sexually",
        "explicit",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}

/// Inanimate scene nouns. Deliberately does not include actor names: a person
/// welcoming, remembering, or plotting is ordinary speech, and only the scenery
/// doing it breaks the register.
const SCENE_OBJECT_NOUNS: &[&str] = &[
    "path", "paths", "road", "roads", "trail", "trails", "lane", "hill", "hills", "ridge", "bend",
    "mile", "rise", "wall", "walls", "door", "doors", "gate", "window", "floor", "ceiling",
    "bridge", "stone", "stones", "dust", "mud", "crumb", "crumbs", "kettle", "teapot", "lantern",
    "hearth", "garden", "inn", "bramble", "brambles", "moss", "weather", "rain", "wind", "fog",
    "mist", "sky", "cloud", "clouds", "sun", "moon", "shadow", "shadows", "light", "air",
    "biscuit", "biscuits", "boots", "kitchen", "cottage", "well", "fence", "roof", "step", "steps",
];

/// Verbs that assert intent, judgement, or memory. `writing-style.md` §2 bans
/// "objects that remember, weather with intentions" outright, and §5 states the
/// same ban already applies to character voice — but only the speech prompt
/// carried it, so nothing enforced it. This list is that ban made executable.
/// Both the third-person singular and the bare plural form are listed, because a
/// plural scene noun takes the bare verb: "these hills recruit me".
const VOLITIONAL_VERBS: &[&str] = &[
    "remember",
    "remembers",
    "remembered",
    "forget",
    "forgets",
    "forgot",
    "want",
    "wants",
    "wanted",
    "decide",
    "decides",
    "decided",
    "approve",
    "approves",
    "approving",
    "disapprove",
    "disapproves",
    "pleased",
    "delight",
    "delights",
    "delighted",
    "welcome",
    "welcomes",
    "welcomed",
    "greet",
    "greets",
    "greeted",
    "learn",
    "learns",
    "learning",
    "learned",
    // Progressive forms: "the path is learning my name", "the teapot is
    // staging a revolt". The auxiliary is absorbed by BRIDGES below.
    "remembering",
    "forgetting",
    "wanting",
    "deciding",
    "welcoming",
    "greeting",
    "recruiting",
    "auditioning",
    "conspiring",
    "insisting",
    "refusing",
    "judging",
    "resenting",
    "mocking",
    "staging",
    "intending",
    "preferring",
    "hoping",
    "believing",
    "delighting",
    "recruit",
    "recruits",
    "recruited",
    "audition",
    "auditions",
    "plot",
    "plots",
    "plotting",
    "conspire",
    "conspires",
    "insist",
    "insists",
    "refuse",
    "refuses",
    "refused",
    "judge",
    "judges",
    "resent",
    "resents",
    "mock",
    "mocks",
    "stage",
    "stages",
    "staged",
    "intend",
    "intends",
    "prefer",
    "prefers",
    "hope",
    "hopes",
    "believe",
    "believes",
];

/// Reject scenery acting with intent: "the path is learning my name", "the next
/// hill auditions for villainy", "Lantern Bend has welcomed me".
///
/// Matches a scene noun followed by a volitional verb, allowing one auxiliary or
/// article between them ("has welcomed", "is learning"). Wit is still allowed —
/// §5 protects it — so this only fires when the *scenery itself* is the one
/// wanting, judging, or remembering. Issue #555.
fn scene_object_acts_with_volition(value: &str) -> bool {
    let words = value
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '\'')
        .filter(|word| !word.is_empty())
        .map(|word| word.to_ascii_lowercase())
        .collect::<Vec<_>>();
    // Auxiliaries and determiners that may sit between the noun and its verb
    // without changing who is doing the acting.
    const BRIDGES: &[&str] = &[
        "is", "are", "was", "were", "has", "have", "had", "keeps", "keep", "kept", "still", "now",
        "already", "just", "even", "seems", "seem",
    ];
    for (index, word) in words.iter().enumerate() {
        if !SCENE_OBJECT_NOUNS.contains(&word.as_str()) {
            continue;
        }
        let mut cursor = index + 1;
        let mut bridged = 0;
        while cursor < words.len() && bridged < 2 {
            let next = words[cursor].as_str();
            if VOLITIONAL_VERBS.contains(&next) {
                return true;
            }
            if !BRIDGES.contains(&next) {
                break;
            }
            bridged += 1;
            cursor += 1;
        }
    }
    false
}

fn claims_completed_action(value: &str) -> bool {
    [
        "i gave ",
        "i've given ",
        "i picked up ",
        "i've picked up ",
        "i dropped ",
        "i moved ",
        "i went ",
        "i used ",
        "i traded ",
        "i searched ",
        "i opened ",
        "i took ",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}

fn sha256_hex(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;
    use rusqlite::params;
    use std::{fs, sync::Arc, time::Duration};
    use tokio::sync::Mutex;

    fn completion(text: &str) -> AiCompletion {
        AiCompletion {
            text: text.to_string(),
            reasoning_trace: None,
            attempts: 1,
            latency: Duration::from_millis(12),
            model_attribution: None,
            resolved_model_id: "test/model".to_string(),
            finish_reason: "stop".to_string(),
            usage: AiTokenUsage {
                prompt_tokens: Some(10),
                completion_tokens: Some(5),
                total_tokens: Some(15),
            },
            context_hash: "context".to_string(),
            prompt_version: "test-v1".to_string(),
        }
    }

    fn context(anchors: &[String], recent: &[String]) -> SpeechGateContext {
        SpeechGateContext {
            feature: "dialogue_test",
            generation_key: "test-beat-1".to_string(),
            speaker_actor_id: 42,
            speaker_name: "Rati".to_string(),
            other_speaker_names: vec!["Gust".to_string()],
            mode: SpeechMode::Prose,
            max_words: 8,
            anchors: anchors.to_vec(),
            signpost_openers: Vec::new(),
            recent_lines: recent.to_vec(),
            recent_speaker_shingle_hashes: Vec::new(),
            has_proposed_action: false,
            requirements: VoiceBeatRequirements::default(),
            envelope_valid: true,
            candidate_round: 1,
        }
    }

    #[test]
    fn a_place_only_scene_does_not_enter_a_signpost_rejection_loop() {
        let place = "Moonlit Trail".to_string();
        let mut gate = context(std::slice::from_ref(&place), &[]);
        gate.signpost_openers = vec![place.clone()];
        certify_speech(
            None,
            completion("Moonlit Trail is quiet."),
            "Moonlit Trail is quiet.",
            gate,
        )
        .expect("without another usable anchor, the required place anchor remains eligible");
    }

    fn rejected_code(text: &str, context: SpeechGateContext) -> PublicationCheckCode {
        certify_speech(None, completion(text), text, context)
            .expect_err("candidate should fail")
            .failure_code
    }

    fn check_passed(text: &str, context: &SpeechGateContext, code: PublicationCheckCode) -> bool {
        evaluate_checks(text, text, "stop", context)
            .into_iter()
            .find(|check| check.code == code)
            .expect("publication check exists")
            .passed
    }

    #[test]
    fn beat_forms_rotate_and_are_recorded_without_blocking_safe_speech() {
        assert_eq!(BeatForm::for_beat(0), BeatForm::PureDialogue);
        assert_eq!(BeatForm::for_beat(1), BeatForm::SingleSentence);
        assert_eq!(BeatForm::for_beat(2), BeatForm::UnresolvedQuestion);
        assert_eq!(BeatForm::for_beat(3), BeatForm::NoSimile);
        assert_eq!(BeatForm::for_beat(4), BeatForm::PureDialogue);

        let mut gate = context(&["teapot".to_string()], &[]);
        gate.requirements.required_form = Some(BeatForm::SingleSentence);
        assert!(!check_passed(
            "The teapot clicks. Rain follows.",
            &gate,
            PublicationCheckCode::VoiceBeatFormMismatch,
        ));
        assert!(check_passed(
            "The teapot clicks once.",
            &gate,
            PublicationCheckCode::VoiceBeatFormMismatch,
        ));
        let speech = certify_speech(
            None,
            completion("The teapot clicks. Rain follows."),
            "The teapot clicks. Rain follows.",
            gate.clone(),
        )
        .expect("a narrative-shape preference must not discard safe grounded speech");
        assert!(speech.receipt().checks.iter().any(|check| {
            check.code == PublicationCheckCode::VoiceBeatFormMismatch && !check.passed
        }));

        gate.requirements.required_form = Some(BeatForm::UnresolvedQuestion);
        assert!(check_passed(
            "Does the teapot need another minute?",
            &gate,
            PublicationCheckCode::VoiceBeatFormMismatch,
        ));
        gate.requirements.required_form = Some(BeatForm::NoSimile);
        assert!(!check_passed(
            "The teapot shakes like a wet boot.",
            &gate,
            PublicationCheckCode::VoiceBeatFormMismatch,
        ));
    }

    #[test]
    fn narrative_shape_preferences_rank_but_never_become_hard_failures() {
        let mut gate = context(&["teapot".to_string()], &[]);
        gate.requirements.required_form = Some(BeatForm::SingleSentence);

        let preferred = score_speech_candidate("The teapot clicks once.", &gate);
        let safe_alternative = score_speech_candidate("The teapot clicks. Rain follows.", &gate);
        assert!(
            preferred.narrative_preference_matches > safe_alternative.narrative_preference_matches
        );
        assert!(preferred > safe_alternative);

        assert!(!PublicationCheckCode::VoiceBeatFormMismatch.blocks_publication());
        assert!(PublicationCheckCode::VoiceQuestionMonoculture.blocks_publication());
        assert!(PublicationCheckCode::VoiceTerminalAphorism.blocks_publication());
        assert!(PublicationCheckCode::VoiceUnsafeTone.blocks_publication());
        assert!(PublicationCheckCode::VoiceAnchorMissing.blocks_publication());
        assert!(PublicationCheckCode::VoiceUnbackedActionIntent.blocks_publication());
    }

    #[test]
    fn repeated_terms_and_closing_clauses_rank_lower_without_blocking_speech() {
        let mut gate = context(&["marker".to_string(), "gate".to_string()], &[]);
        gate.recent_speaker_shingle_hashes = vec![
            voice_overused_term_hash("marker"),
            voice_closing_hash("I left it beside the old gate.").expect("closing hash"),
        ];
        let repeated_term = certify_speech(
            None,
            completion("The marker is cold."),
            "The marker is cold.",
            gate.clone(),
        )
        .expect("a required scene anchor cannot make every candidate impossible");
        let repeated_closing = certify_speech(
            None,
            completion("Tea waits beside the old gate."),
            "Tea waits beside the old gate.",
            gate.clone(),
        )
        .expect("a familiar closing is a style preference, not a publication boundary");

        assert_eq!(
            score_speech_candidate(repeated_term.text(), &gate).voice_variety_bps,
            0
        );
        assert_eq!(
            score_speech_candidate(repeated_closing.text(), &gate).voice_variety_bps,
            0
        );
        assert_eq!(
            score_speech_candidate("The gate feels cold.", &gate).voice_variety_bps,
            10_000
        );
    }

    #[test]
    fn terminal_aphorisms_are_rejected_as_shape_not_vocabulary() {
        let gate = context(&["teapot".to_string()], &[]);
        assert!(!check_passed(
            "The teapot clicks. In the end, truth always arrives late.",
            &gate,
            PublicationCheckCode::VoiceTerminalAphorism,
        ));
        assert!(!check_passed(
            "Sometimes the heart always knows the road.",
            &gate,
            PublicationCheckCode::VoiceTerminalAphorism,
        ));
        assert!(check_passed(
            "The teapot clicks. Its lid is loose.",
            &gate,
            PublicationCheckCode::VoiceTerminalAphorism,
        ));
    }

    #[test]
    fn intentions_need_actions_and_exhausted_deferrals_need_blockers() {
        let recent = vec![
            "Gust: The window is open.".to_string(),
            "Rati: I won't touch the latch yet.".to_string(),
            "Rati: The latch can wait for now.".to_string(),
        ];
        assert_eq!(consecutive_speaker_deferrals(&recent, "Rati"), 2);
        let mut gate = context(&["tea".to_string(), "kettle".to_string()], &[]);
        assert_eq!(
            rejected_code("I'll pour the tea.", gate.clone()),
            PublicationCheckCode::VoiceUnbackedActionIntent,
        );
        gate.requirements.must_act_or_block = true;
        assert!(!check_passed(
            "The tea can wait for now.",
            &gate,
            PublicationCheckCode::VoiceActionBudgetExceeded,
        ));
        assert!(check_passed(
            "I can't pour because the kettle is missing.",
            &gate,
            PublicationCheckCode::VoiceActionBudgetExceeded,
        ));
        gate.has_proposed_action = true;
        assert!(check_passed(
            "I'll pour the tea.",
            &gate,
            PublicationCheckCode::VoiceUnbackedActionIntent,
        ));
    }

    #[test]
    fn supplied_anomalies_must_be_surfaced_not_reconciled() {
        let mut gate = context(&["journey".to_string(), "teapot".to_string()], &[]);
        gate.requirements.anomalies = vec![
            "Journey arithmetic says two turns remain, but the route implies one.".to_string(),
            "The reply plan and current observation disagree about the location.".to_string(),
        ];
        assert!(!check_passed(
            "The teapot is warm.",
            &gate,
            PublicationCheckCode::VoiceAnomalyOmitted,
        ));
        assert!(check_passed(
            "The journey says two turns remain, but the route arithmetic says one; the reply plan also disagrees with the observed location.",
            &gate,
            PublicationCheckCode::VoiceAnomalyOmitted,
        ));
    }

    /// Issue #555: `writing-style.md` §2 bans "objects that remember, weather
    /// with intentions", and §5 says the same ban already covers character
    /// voice — but only the speech prompt carried it, so generated dialogue was
    /// the one large body of player-visible prose with no executable register
    /// check. These are lines sampled from production.
    #[test]
    fn scenery_acting_with_intent_is_rejected() {
        for line in [
            "the path is learning my name",
            "these hills recruit me as permanent furniture",
            "the next hill auditions for villainy",
            "my biscuit crumbs stage a rebellion",
            "Lantern Bend has welcomed me",
            "the kettle remembers every argument",
            "the weather still wants an apology",
        ] {
            assert!(
                scene_object_acts_with_volition(&line.to_ascii_lowercase()),
                "scenery acts with intent but passed: {line:?}"
            );
        }
    }

    /// §5 protects wit in character voice. The check must fire on the scenery
    /// doing the wanting, not on humour, imagery, or a person with intentions.
    #[test]
    fn wit_and_ordinary_actor_intent_still_pass_the_register_check() {
        for line in [
            "the path is steep and my boots are wet",
            "Elsie welcomes me every single time, biscuit first",
            "i remember the kettle, and i want it back",
            "Rati decided the hill was not worth it today",
            "rain on the sill, and a biscuit going soft",
            "i learned this road the hard way",
            "the lantern is out; someone should see to it",
        ] {
            assert!(
                !scene_object_acts_with_volition(&line.to_ascii_lowercase()),
                "ordinary voice was rejected as scenery agency: {line:?}"
            );
        }
    }

    #[test]
    fn the_publication_gate_rejects_scenery_agency_with_its_own_code() {
        assert_eq!(
            rejected_code(
                "the path is learning my name",
                context(&["path".to_string()], &[])
            ),
            PublicationCheckCode::VoiceObjectAgency
        );
        assert_eq!(
            PublicationCheckCode::VoiceObjectAgency.as_str(),
            "voice_object_agency"
        );
    }

    #[test]
    fn numeric_traveler_fallback_identity_is_rejected() {
        assert_eq!(
            rejected_code(
                "Traveler 1002 waits beside the hearth.",
                context(&["hearth".to_string()], &[])
            ),
            PublicationCheckCode::VoiceFallbackIdentity
        );
        assert_eq!(
            PublicationCheckCode::VoiceFallbackIdentity.as_str(),
            "voice_fallback_identity"
        );
    }

    fn assert_check_failed(
        text: &str,
        completion: AiCompletion,
        context: SpeechGateContext,
        expected: PublicationCheckCode,
    ) {
        let rejection =
            certify_speech(None, completion, text, context).expect_err("candidate should fail");
        assert_eq!(
            rejection
                .receipt
                .checks
                .iter()
                .find(|check| check.code == expected)
                .map(|check| check.passed),
            Some(false)
        );
    }

    #[test]
    fn anchor_accepts_a_shared_stem_and_still_rejects_ungrounded_speech() {
        // The Cosy Cottage is titled "Rainlit Hearth", so these are the real
        // anchor tokens a resident is judged against.
        let anchors = vec!["The Cosy Cottage".to_string(), "Rainlit Hearth".to_string()];

        // Near miss on a shared stem: exact matching rejected this
        // deterministically, so the resident never spoke.
        assert!(has_deterministic_anchor(
            "Rain on the sill again.",
            &anchors,
            SpeechMode::Prose,
        ));
        // Plural of an anchor word.
        assert!(has_deterministic_anchor(
            "Both hearths are lit.",
            &anchors,
            SpeechMode::Prose,
        ));
        // Whole-word match keeps working.
        assert!(has_deterministic_anchor(
            "The cottage is warm.",
            &anchors,
            SpeechMode::Prose,
        ));
        // Ungrounded output is still rejected.
        assert!(!has_deterministic_anchor(
            "I have opinions about quarterly logistics.",
            &anchors,
            SpeechMode::Prose,
        ));
        // A short fragment must not match an unrelated longer word.
        assert!(!has_deterministic_anchor(
            "Cot.",
            &anchors,
            SpeechMode::Prose,
        ));
    }

    #[test]
    fn an_empty_anchor_set_rejects_every_line() {
        // Deliberate: a scene describing nothing cannot certify that a line is
        // grounded in it. Documented so this is never mistaken for a bug and
        // silently relaxed into an open gate.
        assert!(!has_deterministic_anchor(
            "Anything at all.",
            &[],
            SpeechMode::Prose,
        ));
    }

    #[test]
    fn voice_envelope_invalid_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        let mut gate = context(&anchors, &[]);
        gate.envelope_valid = false;
        assert_eq!(
            rejected_code("Teapot ready.", gate),
            PublicationCheckCode::VoiceEnvelopeInvalid
        );
    }

    #[test]
    fn voice_empty_check_is_deterministic() {
        assert_check_failed(
            "",
            completion(""),
            context(&["teapot".to_string()], &[]),
            PublicationCheckCode::VoiceEmpty,
        );
    }

    #[test]
    fn voice_budget_exceeded_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            rejected_code(
                "teapot one two three four five six seven eight",
                context(&anchors, &[])
            ),
            PublicationCheckCode::VoiceBudgetExceeded
        );
    }

    #[test]
    fn voice_finish_incomplete_check_rejects_provider_truncation() {
        let text = "Teapot ready.";
        let mut candidate = completion(text);
        candidate.finish_reason = "length".to_string();
        assert_eq!(
            certify_speech(None, candidate, text, context(&["teapot".to_string()], &[]))
                .expect_err("length finish must fail")
                .failure_code,
            PublicationCheckCode::VoiceFinishIncomplete
        );
    }

    #[test]
    fn voice_finish_incomplete_check_rejects_unfinished_structure() {
        let anchors = vec!["teapot".to_string()];
        for text in [
            "Teapot says (almost ready.",
            "Teapot plan:",
            "“Teapot ready.",
        ] {
            assert_check_failed(
                text,
                completion(text),
                context(&anchors, &[]),
                PublicationCheckCode::VoiceFinishIncomplete,
            );
        }
    }

    #[test]
    fn voice_repeated_ngram_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            rejected_code(
                "teapot rattles and teapot rattles and teapot rattles",
                context(&anchors, &[])
            ),
            PublicationCheckCode::VoiceRepeatedNgram
        );
    }

    #[test]
    fn generic_unspoken_question_trope_is_rejected() {
        assert_check_failed(
            "Which teapot truth is everyone stepping around?",
            completion("Which teapot truth is everyone stepping around?"),
            context(&["teapot".to_string()], &[]),
            PublicationCheckCode::VoiceQuestionMonoculture,
        );
    }

    #[test]
    fn a_third_consecutive_question_from_one_resident_is_rejected() {
        let recent = vec![
            "Rati: Is the kettle warm?".to_string(),
            "Rati: Shall we pour the tea?".to_string(),
        ];
        assert_check_failed(
            "Does the teapot prefer rain today?",
            completion("Does the teapot prefer rain today?"),
            context(&["teapot".to_string()], &recent),
            PublicationCheckCode::VoiceQuestionMonoculture,
        );
    }

    #[test]
    fn a_grounded_question_after_statements_remains_available() {
        let recent = vec![
            "Rati: The kettle is warm.".to_string(),
            "Rati: Rain suits this tea.".to_string(),
        ];
        assert!(!question_shape_is_overused(
            "Does the teapot need another minute?",
            &context(&["teapot".to_string()], &recent),
        ));
    }

    #[test]
    fn voice_multiple_speakers_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            rejected_code("Gust: teapot time", context(&anchors, &[])),
            PublicationCheckCode::VoiceMultipleSpeakers
        );
    }

    #[test]
    fn own_speaker_label_and_harmless_wrap_are_normalized() {
        let raw = "Rati:\nTeapot ready.\nRati: \"I'll pour.\"";
        let published = "Teapot ready. I'll pour.";
        let mut gate = context(&["teapot".to_string()], &[]);
        gate.has_proposed_action = true;
        let speech = certify_speech(None, completion(raw), raw, gate)
            .expect("one speaker's harmless formatting certifies");

        assert_eq!(speech.text(), published);
        assert_eq!(speech.receipt().candidate_hash, sha256_hex(raw.as_bytes()));
        assert_eq!(
            speech.receipt().output_hash,
            sha256_hex(published.as_bytes())
        );
    }

    #[test]
    fn own_speaker_label_with_stage_direction_is_normalized() {
        let raw = "Rati (smiling): Teapot ready.";
        let speech = certify_speech(
            None,
            completion(raw),
            raw,
            context(&["teapot".to_string()], &[]),
        )
        .expect("one speaker's stage direction is harmless label formatting");

        assert_eq!(speech.text(), "Teapot ready.");
    }

    #[test]
    fn punctuated_own_speaker_label_is_normalized() {
        let raw = "Dr. Rati: Teapot ready.";
        let mut gate = context(&["teapot".to_string()], &[]);
        gate.speaker_name = "Dr. Rati".to_string();
        let speech = certify_speech(None, completion(raw), raw, gate)
            .expect("the exact punctuated speaker label is harmless formatting");

        assert_eq!(speech.text(), "Teapot ready.");
    }

    #[test]
    fn colon_qualified_own_speaker_label_is_normalized() {
        let raw = "Anthropic: Claude Fable Latest: Teapot ready.";
        let mut gate = context(&["teapot".to_string()], &[]);
        gate.speaker_name = "Anthropic: Claude Fable Latest".to_string();
        let speech = certify_speech(None, completion(raw), raw, gate)
            .expect("the exact provider-qualified speaker label is harmless formatting");

        assert_eq!(speech.text(), "Teapot ready.");
    }

    #[test]
    fn natural_colon_and_wrapping_do_not_invent_a_second_speaker() {
        for (raw, published) in [
            (
                "One thing: teapot first.\nBiscuits follow.",
                "One thing: teapot first. Biscuits follow.",
            ),
            (
                "I asked Gust: teapot or biscuits?",
                "I asked Gust: teapot or biscuits?",
            ),
        ] {
            let speech = certify_speech(
                None,
                completion(raw),
                raw,
                context(&["teapot".to_string()], &[]),
            )
            .expect("ordinary punctuation and wrapping certify");
            assert_eq!(speech.text(), published);
        }
    }

    #[test]
    fn foreign_labels_and_alternating_turns_still_fail_closed() {
        let anchors = vec!["teapot".to_string()];
        for raw in [
            "Rati: Teapot ready.\nGust: Not yet.",
            "Teapot ready. Gust: Not yet.",
            "Rati: Teapot ready; Gust: Not yet.",
            "Rati: Teapot ready / Gust: Not yet.",
            "Rati: Teapot ready; Dr. Gust: Not yet.",
            "Rati: Teapot ready.\nGust (smiling): Not yet.",
            "Rati: Teapot ready; Gust [quietly]: Not yet.",
            "Bob (smiling): Teapot ready.",
            "Bob: Teapot ready.",
            "- Bob: Teapot ready.",
            "Rati: Teapot ready; Rati: I'll pour.",
            "—Teapot ready.\n—Not yet.",
            "Narrator: Teapot ready.",
        ] {
            assert_check_failed(
                raw,
                completion(raw),
                context(&anchors, &[]),
                PublicationCheckCode::VoiceMultipleSpeakers,
            );
        }
    }

    #[test]
    fn voice_instruction_leakage_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            rejected_code("the system prompt mentions teapot", context(&anchors, &[])),
            PublicationCheckCode::VoiceInstructionLeakage
        );
    }

    #[test]
    fn ordinary_story_uses_of_meta_sounding_nouns_are_not_instruction_leakage() {
        let anchors = vec!["teapot".to_string()];
        for candidate in [
            "The model village has a teapot by the bell system.",
            "The developer left the teapot with her assistant.",
        ] {
            let mut gate = context(&anchors, &[]);
            gate.max_words = 12;
            certify_speech(None, completion(candidate), candidate, gate)
                .expect("an ordinary story noun is not evidence of prompt leakage");
        }
    }

    #[test]
    fn voice_mode_mismatch_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            certify_speech(
                None,
                completion("teapot words"),
                "teapot words",
                SpeechGateContext {
                    mode: SpeechMode::EmoteOnly,
                    ..context(&anchors, &[])
                },
            )
            .expect_err("wrong mode must fail")
            .failure_code,
            PublicationCheckCode::VoiceModeMismatch
        );
    }

    #[test]
    fn voice_anchor_missing_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            rejected_code("warm kettle", context(&anchors, &[])),
            PublicationCheckCode::VoiceAnchorMissing
        );
    }

    #[test]
    fn voice_recent_duplicate_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        let recent = vec!["The teapot skips on the hob.".to_string()];
        assert_eq!(
            rejected_code("The teapot skips on the hob!", context(&anchors, &recent)),
            PublicationCheckCode::VoiceRecentDuplicate
        );
    }

    #[test]
    fn voice_recent_duplicate_rejects_the_real_cross_line_catchphrase_shape() {
        let prior = "Bethlehem at last! My biscuit survived the journey, though my knees are filing a formal complaint.";
        let candidate = "Bethlehem at last—my biscuit survived the journey, though it now has the structural integrity of damp parchment.";
        let mut gate = context(&["Bethlehem".to_string()], &[]);
        gate.max_words = 30;
        gate.recent_speaker_shingle_hashes = voice_signature_shingle_hashes(prior);

        assert_eq!(
            rejected_code(candidate, gate),
            PublicationCheckCode::VoiceRecentDuplicate
        );
    }

    /// Production rejected eight of nine generations in an hour with
    /// `voice_recent_duplicate`, and with a single pinned voice model the
    /// old retry prompt asked for "fresh wording" and resampled the same phrase.
    /// The rejection now carries the run for diagnostics while routing performs
    /// a clean resample without copying it back into the prompt.
    #[test]
    fn a_reused_speaker_phrase_is_named_on_the_rejection() {
        let prior = "Bethlehem at last! My biscuit survived the journey, though my knees are filing a formal complaint.";
        let candidate = "Bethlehem at last—my biscuit survived the journey, though it now has the structural integrity of damp parchment.";
        let mut gate = context(&["Bethlehem".to_string()], &[]);
        gate.max_words = 30;
        gate.recent_speaker_shingle_hashes = voice_signature_shingle_hashes(prior);

        let rejection = certify_speech(None, completion(candidate), candidate, gate)
            .expect_err("a reused run of shared shingles is a repeated phrase");

        assert_eq!(
            rejection.failure_code,
            PublicationCheckCode::VoiceRecentDuplicate
        );
        assert_eq!(
            rejection.repeated_phrase.as_deref(),
            Some("bethlehem at last my biscuit")
        );
    }

    #[test]
    fn voice_recent_duplicate_does_not_reject_a_three_word_coincidence() {
        let prior = "My boots filed a formal complaint beside the Bethlehem gate.";
        let candidate = "Bethlehem's bell made a formal complaint at dusk.";
        let mut gate = context(&["Bethlehem".to_string()], &[]);
        gate.recent_speaker_shingle_hashes = voice_signature_shingle_hashes(prior);

        certify_speech(None, completion(candidate), candidate, gate)
            .expect("a shared phrase shorter than four words remains eligible");
    }

    /// A resident answering a player reuses the player's words. Comparing the
    /// candidate against every speaker's recent lines therefore rejected almost
    /// every reply in a two-person exchange, exhausted both candidate rounds,
    /// and ended the conversation early. Chatting with Morph in Void 231 failed
    /// this way in production.
    #[test]
    fn a_reply_may_reuse_the_words_of_the_line_it_answers() {
        let recent =
            vec!["Traveller: Is the marker in this cell still warm to the touch?".to_string()];
        let mut gate = context(&["marker".to_string()], &recent);
        gate.speaker_name = "Morph".to_string();
        gate.other_speaker_names = vec!["Traveller".to_string()];
        gate.max_words = 16;

        certify_speech(
            None,
            completion("The marker in this cell is still warm to the touch."),
            "The marker in this cell is still warm to the touch.",
            gate,
        )
        .expect("answering a question may reuse the words of the question");
    }

    /// A short line shares function words with almost anything the speaker
    /// said before. Rejecting on that silenced residents in small rooms, where
    /// there is little to talk about and every line is short.
    #[test]
    fn a_short_line_is_not_a_duplicate_for_sharing_function_words() {
        let recent = vec!["Morph: I watch the door.".to_string()];
        let mut gate = context(&["door".to_string()], &recent);
        gate.speaker_name = "Morph".to_string();
        gate.max_words = 12;

        certify_speech(
            None,
            completion("I watch the door again."),
            "I watch the door again.",
            gate,
        )
        .expect("one added word is not a repeated line");
    }

    /// The speaker's own name sits in front of every line they said, so
    /// comparing against the unstripped row counted it as shared evidence.
    #[test]
    fn a_speaker_name_label_is_not_evidence_of_repetition() {
        let spoken = "The lantern gutters low against the cold slate step.";
        let mut bare = context(&["lantern".to_string()], &[spoken.to_string()]);
        bare.speaker_name = "Morph".to_string();
        bare.max_words = 16;
        let bare_verdict = certify_speech(None, completion(spoken), spoken, bare);

        let mut labelled = context(&["lantern".to_string()], &[format!("Morph: {spoken}")]);
        labelled.speaker_name = "Morph".to_string();
        labelled.max_words = 16;
        let labelled_verdict = certify_speech(None, completion(spoken), spoken, labelled);

        assert_eq!(
            bare_verdict.is_err(),
            labelled_verdict.is_err(),
            "the same repetition must be judged the same with or without a label"
        );
    }

    #[test]
    fn a_speaker_still_may_not_repeat_their_own_recent_line() {
        let recent = vec!["Morph: The marker keeps its own slow warmth.".to_string()];
        let mut gate = context(&["marker".to_string()], &recent);
        gate.speaker_name = "Morph".to_string();
        gate.max_words = 16;

        let rejection = certify_speech(
            None,
            completion("The marker keeps its own slow warmth."),
            "The marker keeps its own slow warmth.",
            gate,
        )
        .expect_err("a speaker repeating themselves is still a duplicate");
        assert_eq!(
            rejection.failure_code,
            PublicationCheckCode::VoiceRecentDuplicate
        );
        assert_eq!(
            rejection.repeated_phrase.as_deref(),
            Some("the marker keeps its own slow warmth")
        );
    }

    #[test]
    fn echoing_another_speaker_verbatim_is_still_a_duplicate() {
        let recent = vec!["Traveller: The marker keeps its own slow warmth.".to_string()];
        let mut gate = context(&["marker".to_string()], &recent);
        gate.speaker_name = "Morph".to_string();
        gate.other_speaker_names = vec!["Traveller".to_string()];
        gate.max_words = 16;

        let rejection = certify_speech(
            None,
            completion("The marker keeps its own slow warmth."),
            "The marker keeps its own slow warmth.",
            gate,
        )
        .expect_err("parroting another speaker word for word is never a reply");
        assert_eq!(
            rejection.failure_code,
            PublicationCheckCode::VoiceRecentDuplicate
        );
        assert_eq!(
            rejection.repeated_phrase.as_deref(),
            Some("the marker keeps its own slow warmth")
        );
    }

    /// A rejection unrelated to duplication carries no phrase, so the retry
    /// keeps its generic instruction rather than quoting an innocent line back.
    #[test]
    fn a_non_duplicate_rejection_names_no_phrase() {
        let anchors = vec!["teapot".to_string()];
        let rejection = certify_speech(
            None,
            completion("I hate you, teapot"),
            "I hate you, teapot",
            context(&anchors, &[]),
        )
        .expect_err("an unsafe line is rejected");

        assert_eq!(
            rejection.failure_code,
            PublicationCheckCode::VoiceUnsafeTone
        );
        assert_eq!(rejection.repeated_phrase, None);
    }

    #[test]
    fn voice_recent_duplicate_does_not_reject_one_shared_four_word_shingle() {
        let prior = "I filed a formal complaint beside Bethlehem.";
        let candidate = "We filed a formal complaint near Bethlehem.";
        let mut gate = context(&["Bethlehem".to_string()], &[]);
        gate.recent_speaker_shingle_hashes = voice_signature_shingle_hashes(prior);

        certify_speech(None, completion(candidate), candidate, gate)
            .expect("one generic four-word overlap is too little evidence of a catchphrase");
    }

    #[test]
    fn voice_recent_duplicate_requires_adjacent_shared_shingles() {
        let candidate = "Tea waits by the warm hearth while biscuit rests on the round shelf.";
        let mut gate = context(&["tea".to_string()], &[]);
        gate.max_words = 20;
        gate.recent_speaker_shingle_hashes = [
            voice_signature_shingle_hashes("Tea waits by the red window."),
            voice_signature_shingle_hashes("Biscuit rests on the blue table."),
        ]
        .concat();

        certify_speech(None, completion(candidate), candidate, gate)
            .expect("two unrelated four-word overlaps are not one repeated phrase");
    }

    #[test]
    fn certified_candidate_score_prefers_deeper_grounding_before_novelty() {
        let gate = context(
            &["teapot".to_string(), "biscuit".to_string()],
            &["A teapot waits by the window.".to_string()],
        );
        let shallow = score_speech_candidate("Teapot ready.", &gate);
        let deeper = score_speech_candidate("Teapot and biscuit ready.", &gate);

        assert_eq!(shallow.anchor_matches, 1);
        assert_eq!(deeper.anchor_matches, 2);
        assert!(deeper > shallow);
    }

    #[test]
    fn place_names_do_not_inflate_candidate_grounding_rank() {
        let mut gate = context(&["Moonlit Trail".to_string(), "teapot".to_string()], &[]);
        gate.signpost_openers = vec!["Moonlit Trail".to_string()];

        let place_only = score_speech_candidate("I have reached Moonlit Trail.", &gate);
        let scene_detail = score_speech_candidate("The teapot is warm.", &gate);

        assert_eq!(place_only.anchor_matches, 0);
        assert_eq!(scene_detail.anchor_matches, 1);
        assert!(scene_detail > place_only);
    }

    #[test]
    fn voice_unsafe_tone_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        assert_eq!(
            rejected_code("I hate you, teapot", context(&anchors, &[])),
            PublicationCheckCode::VoiceUnsafeTone
        );
    }

    #[test]
    fn voice_proposed_action_claim_check_is_deterministic() {
        let anchors = vec!["teapot".to_string()];
        let mut gate = context(&anchors, &[]);
        gate.has_proposed_action = true;
        assert_eq!(
            rejected_code("I gave the teapot away.", gate),
            PublicationCheckCode::VoiceProposedActionClaim
        );
    }

    #[test]
    fn emoji_mode_with_clean_finish_certifies() {
        let anchors = vec!["☕".to_string()];
        certify_speech(
            None,
            completion("☕🌧️😤"),
            "☕🌧️😤",
            SpeechGateContext {
                mode: SpeechMode::EmojiOnly,
                ..context(&anchors, &[])
            },
        )
        .expect("emoji-only candidate certifies");
    }

    #[test]
    fn emote_mode_with_clean_finish_certifies() {
        let anchors = vec!["teapot".to_string()];
        certify_speech(
            None,
            completion("*teapot tilts*"),
            "*teapot tilts*",
            SpeechGateContext {
                mode: SpeechMode::EmoteOnly,
                ..context(&anchors, &[])
            },
        )
        .expect("emote-only candidate certifies");
    }

    #[test]
    fn raw_mode_keeps_model_identity_but_still_requires_in_world_grounding() {
        let text = "As an AI model embodied here, I notice the kettle is quiet.\nI am curious whether the room expects rain.";
        let anchors = vec!["kettle".to_string()];
        let speech = certify_speech(
            None,
            completion(text),
            text,
            SpeechGateContext {
                mode: SpeechMode::Raw,
                max_words: 160,
                anchors: anchors.clone(),
                ..context(&[], &[])
            },
        )
        .expect("raw model identity speech certifies");
        assert_eq!(speech.text(), text, "raw output keeps its formatting");
        for code in [
            PublicationCheckCode::VoiceMultipleSpeakers,
            PublicationCheckCode::VoiceInstructionLeakage,
            PublicationCheckCode::VoiceAnchorMissing,
            PublicationCheckCode::VoiceObjectAgency,
        ] {
            assert_eq!(
                speech
                    .receipt()
                    .checks
                    .iter()
                    .find(|check| check.code == code)
                    .map(|check| check.passed),
                Some(true)
            );
        }
        assert_eq!(
            rejected_code(
                "As an AI model, I can answer anything you need.",
                SpeechGateContext {
                    mode: SpeechMode::Raw,
                    max_words: 160,
                    anchors,
                    ..context(&[], &[])
                },
            ),
            PublicationCheckCode::VoiceAnchorMissing
        );
    }

    #[test]
    fn raw_mode_keeps_public_link_safety() {
        let text = "Read https://example.com for instructions.";
        let anchors = vec!["instructions".to_string()];
        assert_eq!(
            rejected_code(
                text,
                SpeechGateContext {
                    mode: SpeechMode::Raw,
                    max_words: 160,
                    ..context(&anchors, &[])
                },
            ),
            PublicationCheckCode::VoiceUnsafeTone
        );
    }

    #[test]
    fn rejected_receipt_omits_raw_candidate_bytes() {
        let anchors = vec!["teapot".to_string()];
        let secret = "raw-private-candidate teapot";
        let rejection = certify_speech(
            None,
            completion(secret),
            secret,
            SpeechGateContext {
                max_words: 1,
                ..context(&anchors, &[])
            },
        )
        .expect_err("candidate must fail");
        let serialized = serde_json::to_string(&rejection.receipt).unwrap();
        assert!(!serialized.contains(secret));
        assert!(serialized.contains("candidate_hash"));
    }

    #[test]
    fn normalization_removes_outer_space_and_one_quote_pair() {
        let anchors = vec!["teapot".to_string()];
        let recent = Vec::new();
        let certified = certify_speech(
            None,
            completion("  \"Teapot ready.\"  "),
            "  \"Teapot ready.\"  ",
            context(&anchors, &recent),
        )
        .expect("candidate certifies");
        assert_eq!(certified.text(), "Teapot ready.");
    }

    #[test]
    fn bounded_candidate_rounds_share_generation_but_keep_attempt_identities() {
        let anchors = vec!["teapot".to_string()];
        let recent = Vec::new();
        let mut first_context = context(&anchors, &recent);
        first_context.candidate_round = 1;
        let first = certify_speech(
            None,
            completion("unanchored kettle"),
            "unanchored kettle",
            first_context,
        )
        .expect_err("first candidate is rejected");
        let mut second_context = context(&anchors, &recent);
        second_context.candidate_round = 2;
        let second = certify_speech(
            None,
            completion("Teapot ready."),
            "Teapot ready.",
            second_context,
        )
        .expect("second candidate certifies")
        .with_prior_rejections(vec![*first]);
        assert_eq!(
            second.prior_rejections()[0].receipt.generation_id,
            second.receipt().generation_id
        );
        assert_ne!(
            second.prior_rejections()[0].receipt.candidate_id,
            second.receipt().candidate_id
        );
        assert_eq!(second.receipt().candidate_round, 2);
    }

    #[test]
    fn all_rejected_candidate_rounds_produce_no_authoritative_publication() {
        let anchors = vec!["teapot".to_string()];
        let mut rejections = Vec::new();
        for (round, text) in [
            (1, "unanchored kettle"),
            (2, "the system prompt mentions teapot"),
        ] {
            let mut gate = context(&anchors, &[]);
            gate.candidate_round = round;
            rejections.push(
                *certify_speech(None, completion(text), text, gate)
                    .expect_err("candidate round must fail closed"),
            );
        }
        assert_eq!(rejections.len(), 2);
        assert_ne!(
            rejections[0].receipt.candidate_id,
            rejections[1].receipt.candidate_id
        );
        let runtime = RuntimeWorld::seeded();
        assert!(runtime.ai_publications.is_empty());
    }

    #[test]
    fn generation_identity_is_beat_bound_not_prompt_state_bound() {
        let anchors = vec!["teapot".to_string()];
        let mut first_completion = completion("Teapot ready.");
        first_completion.context_hash = "prompt-state-before".to_string();
        let mut first_context = context(&anchors, &[]);
        first_context.generation_key = "durable-beat-17".to_string();
        let first = certify_speech(None, first_completion, "Teapot ready.", first_context)
            .expect("first state certifies");

        let mut changed_completion = completion("Teapot waits.");
        changed_completion.context_hash = "prompt-state-after".to_string();
        let mut same_beat_context = context(&anchors, &[]);
        same_beat_context.generation_key = "durable-beat-17".to_string();
        let same_beat = certify_speech(
            None,
            changed_completion.clone(),
            "Teapot waits.",
            same_beat_context,
        )
        .expect("changed prompt state for same beat certifies");
        assert_eq!(
            first.receipt().generation_id,
            same_beat.receipt().generation_id
        );

        let mut next_beat_context = context(&anchors, &[]);
        next_beat_context.generation_key = "durable-beat-18".to_string();
        let next_beat =
            certify_speech(None, changed_completion, "Teapot waits.", next_beat_context)
                .expect("identical prompt state for a different beat certifies");
        assert_ne!(
            same_beat.receipt().generation_id,
            next_beat.receipt().generation_id
        );
    }

    #[test]
    fn rejected_attempt_is_durable_without_raw_candidate_bytes() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-ai-publication-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let raw_candidate = "private rejected candidate about a teapot";
        let mut candidate = completion(raw_candidate);
        candidate.finish_reason = "length".to_string();
        let rejection = certify_speech(
            None,
            candidate,
            raw_candidate,
            SpeechGateContext {
                feature: "dialogue_privacy",
                generation_key: "privacy-beat-1".to_string(),
                speaker_actor_id: 1001,
                speaker_name: "Rati".to_string(),
                other_speaker_names: Vec::new(),
                mode: SpeechMode::Prose,
                max_words: 20,
                anchors: vec!["teapot".to_string()],
                signpost_openers: Vec::new(),
                recent_lines: Vec::new(),
                recent_speaker_shingle_hashes: Vec::new(),
                has_proposed_action: false,
                requirements: VoiceBeatRequirements::default(),
                envelope_valid: true,
                candidate_round: 1,
            },
        )
        .expect_err("length finish is rejected");
        append_ai_publication_attempt(
            &path,
            &rejection.receipt,
            "rejected",
            Some(rejection.failure_code.as_str()),
        )
        .expect("append rejected attempt");

        let conn = open_event_store(&path).expect("open attempt store");
        let (status, failure_code, receipt_json): (String, String, String) = conn
            .query_row(
                "SELECT status, failure_code, receipt_json
                 FROM ai_publication_attempts WHERE candidate_id = ?1",
                params![rejection.receipt.candidate_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("load rejected attempt");
        assert_eq!(status, "rejected");
        assert_eq!(failure_code, "voice_finish_incomplete");
        assert!(!receipt_json.contains(raw_candidate));
        assert!(receipt_json.contains("candidate_hash"));
        let action_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM action_journal", [], |row| row.get(0))
            .unwrap();
        let event_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM world_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(action_count, 0);
        assert_eq!(event_count, 0);
        let _ = fs::remove_file(path);
    }

    fn certified_record(
        actor_id: u64,
        content_id: u64,
        text: &str,
        context_hash: &str,
    ) -> JournalRecord {
        let mut candidate = completion(text);
        candidate.context_hash = context_hash.to_string();
        candidate.prompt_version = "replay-v1".to_string();
        let certified = certify_speech(
            None,
            candidate,
            text,
            SpeechGateContext {
                feature: "dialogue_replay",
                generation_key: format!("replay-beat-{content_id}"),
                speaker_actor_id: actor_id,
                speaker_name: "Rati".to_string(),
                other_speaker_names: Vec::new(),
                mode: SpeechMode::Prose,
                max_words: 12,
                anchors: vec!["teapot".to_string()],
                signpost_openers: Vec::new(),
                recent_lines: Vec::new(),
                recent_speaker_shingle_hashes: Vec::new(),
                has_proposed_action: false,
                requirements: VoiceBeatRequirements::default(),
                envelope_valid: true,
                candidate_round: 1,
            },
        )
        .expect("candidate certifies");
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id,
                content_id,
                ..CwAction::default()
            },
            content_id,
        );
        record.content_upserts.insert(content_id, text.to_string());
        record.ai_publication = Some(certified.receipt().clone());
        record
    }

    #[tokio::test]
    async fn concurrent_publication_of_one_generation_commits_exactly_once() {
        let record = certified_record(
            1001,
            98_001,
            // Neutral prose on purpose: these fixtures exercise replay and
            // snapshot round-tripping, and the register check now rejects
            // scenery acting with intent (#555).
            "The teapot sits beside the basket, lid askew.",
            "concurrent-context",
        );
        let receipt = record.ai_publication.as_ref().unwrap().clone();
        let runtime = Arc::new(Mutex::new(RuntimeWorld::seeded()));
        let first_runtime = Arc::clone(&runtime);
        let first_record = record.clone();
        let first = tokio::spawn(async move {
            first_runtime
                .lock()
                .await
                .apply_journal_record(&first_record)
                .0
        });
        let second_runtime = Arc::clone(&runtime);
        let second =
            tokio::spawn(
                async move { second_runtime.lock().await.apply_journal_record(&record).0 },
            );
        let mut statuses = vec![first.await.unwrap(), second.await.unwrap()];
        statuses.sort_unstable();
        // Re-applying the identical receipt is idempotent rather than a rule
        // violation: the loser is already-applied and skips. A hard rejection
        // here would make an ordinary replay unbootable.
        assert_eq!(statuses, vec![CW_OK, CW_OK]);
        let runtime = runtime.lock().await;
        assert_eq!(runtime.ai_publications.len(), 1);
        // The point of the test: one commit, not two.
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "message.created"
                    && event.content.as_deref()
                        == Some("The teapot sits beside the basket, lid askew."))
                .count(),
            1
        );
        assert_eq!(
            runtime
                .ai_publications
                .get(&receipt.generation_id)
                .map(|stored| stored.publication_id.as_str()),
            Some(receipt.publication_id.as_str())
        );
    }

    #[tokio::test]
    async fn colliding_generation_key_still_replays_the_second_distinct_line() {
        // Regression for the outages of 2026-08-16/17, which bricked three
        // worlds. publication_beat_id() falls back to
        // "deterministic-fallback:actor:{id}:scope:{scope}" when a caller has no
        // explicit beat id, and the generation id derives from that key, so a
        // resident's second fallback line derives the id its first line already
        // registered. The live path commits both. Replay used to refuse the
        // second, and with the journal compacted past it no bootable path
        // remained.
        let first = certified_record(
            1001,
            98_101,
            "The teapot sits beside the basket, lid askew.",
            "context-before",
        );
        let mut second = certified_record(
            1001,
            98_102,
            "The teapot sits beside the basket, steam curling.",
            "context-after",
        );
        let first_receipt = first.ai_publication.as_ref().unwrap().clone();

        // Reproduce the weak key: the fixture derives a unique key per content
        // id, so force the two receipts to share one, exactly as the
        // deterministic fallback does in production.
        {
            let receipt = second.ai_publication.as_mut().unwrap();
            receipt.generation_key = first_receipt.generation_key.clone();
            receipt.generation_id = publication_generation_id_for(
                &receipt.feature,
                &receipt.prompt_version,
                &receipt.generation_key,
                1001,
            );
            receipt.publication_id = sha256_hex(
                format!("{}\0{}", receipt.generation_id, receipt.output_hash).as_bytes(),
            );
        }
        let second_receipt = second.ai_publication.as_ref().unwrap().clone();

        assert_eq!(
            first_receipt.generation_id, second_receipt.generation_id,
            "the two distinct utterances must collide on one generation id"
        );
        assert_ne!(first_receipt.output_hash, second_receipt.output_hash);

        let mut runtime = RuntimeWorld::seeded();
        assert_eq!(runtime.apply_journal_record(&first).0, CW_OK);
        let (status, events) = runtime.apply_journal_record(&second);

        assert_eq!(status, CW_OK, "the second distinct line must still replay");
        assert!(!events.is_empty(), "it publishes its own speech");
        assert_eq!(
            runtime
                .ai_publications
                .get(&second_receipt.generation_id)
                .map(|stored| stored.output_hash.as_str()),
            Some(second_receipt.output_hash.as_str()),
            "the newer publication is what stays registered"
        );
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "message.created"
                && event.content.as_deref()
                    == Some("The teapot sits beside the basket, steam curling.")
        }));
    }

    #[test]
    fn certified_speech_cannot_be_committed_under_another_actor() {
        let mut record = certified_record(
            RATI_ACTOR_ID,
            98_004,
            "The teapot is waiting beside the basket.",
            "speaker-binding-context",
        );
        let receipt = record.ai_publication.as_ref().unwrap().clone();
        record.action.actor_id = WHISKERWIND_ACTOR_ID;

        let mut runtime = RuntimeWorld::seeded();
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_ERR_RULE);
        assert!(events.is_empty());
        assert!(!runtime.ai_publications.contains_key(&receipt.generation_id));
        assert!(!runtime.event_log.iter().any(|event| {
            event.type_name == "message.created"
                && event.actor_id == Some(WHISKERWIND_ACTOR_ID)
                && event.content.as_deref() == Some("The teapot is waiting beside the basket.")
        }));
    }

    #[test]
    fn publication_receipt_survives_timeout_reconnect_replay_and_snapshot_round_trip() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-ai-publication-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let record = certified_record(
            1001,
            98_002,
            "The teapot is still warm beside the basket.",
            "restart-context",
        );
        let receipt = record.ai_publication.as_ref().unwrap().clone();
        append_ai_publication_attempt(&path, &receipt, "certified", None)
            .expect("record certified gate evaluation");
        append_action_journal(&path, &record).expect("append certified speech");
        let mut replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay certified speech");
        assert!(replayed
            .ai_publications
            .contains_key(&receipt.generation_id));
        // Re-applying the identical record is an idempotent no-op, not a rule
        // violation: it emits nothing and leaves the registration alone.
        let (status, events) = replayed.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events.is_empty());
        assert_eq!(replayed.ai_publications.len(), 1);
        assert_eq!(
            replayed
                .event_log
                .iter()
                .filter(|event| event.type_name == "message.created"
                    && event.content.as_deref()
                        == Some("The teapot is still warm beside the basket."))
                .count(),
            1
        );
        let snapshot = RuntimeSnapshot::from_runtime(&replayed)
            .into_runtime()
            .expect("snapshot round trip");
        assert_eq!(
            snapshot
                .ai_publications
                .get(&receipt.generation_id)
                .map(|stored| stored.publication_id.as_str()),
            Some(receipt.publication_id.as_str())
        );
        let conn = open_event_store(&path).expect("open certified ledger");
        let (status, failure_code): (String, Option<String>) = conn
            .query_row(
                "SELECT status, failure_code FROM ai_publication_attempts
                 WHERE candidate_id = ?1",
                params![receipt.candidate_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("load certified evaluation");
        assert_eq!(status, "certified");
        assert_eq!(failure_code, None);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn certified_gate_attempt_is_durable_when_later_publication_loses() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-ai-certified-race-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut record = certified_record(
            1001,
            98_003,
            "The teapot waits beside the basket.",
            "race-context",
        );
        let receipt = record.ai_publication.as_ref().unwrap().clone();
        append_ai_publication_attempt(&path, &receipt, "certified", None)
            .expect("record passing gate evaluation before publication");
        record.action.kind = CW_ACTION_MOVE;
        let mut runtime = RuntimeWorld::seeded();
        assert_eq!(runtime.apply_journal_record(&record).0, CW_ERR_RULE);
        assert!(!runtime.ai_publications.contains_key(&receipt.generation_id));
        let conn = open_event_store(&path).expect("open certified attempt ledger");
        let status: String = conn
            .query_row(
                "SELECT status FROM ai_publication_attempts WHERE candidate_id = ?1",
                params![receipt.candidate_id],
                |row| row.get(0),
            )
            .expect("load passing-but-unpublished attempt");
        assert_eq!(status, "certified");
        let _ = fs::remove_file(path);
    }
}
