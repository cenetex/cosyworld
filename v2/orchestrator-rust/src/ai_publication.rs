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
const VOICE_SIGNATURE_WORD_LIMIT: usize = 64;

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
        }
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
    pub(crate) recent_lines: Vec<String>,
    pub(crate) recent_speaker_shingle_hashes: Vec<u64>,
    pub(crate) has_proposed_action: bool,
    pub(crate) envelope_valid: bool,
    pub(crate) candidate_round: u8,
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

    pub(crate) fn restore(text: String, receipt: AiPublicationReceipt) -> Option<Self> {
        receipt_matches_text(&receipt, &text).then_some(Self {
            text,
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
        .find_map(|check| (!check.passed).then_some(check.code))
    {
        return Err(Box::new(PublicationRejection {
            receipt,
            failure_code,
        }));
    }
    Ok(CertifiedSpeech {
        text,
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
        attempts: 1,
        latency: std::time::Duration::ZERO,
        model_attribution: None,
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
        recent_lines: Vec::new(),
        recent_speaker_shingle_hashes: Vec::new(),
        has_proposed_action: false,
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
    for rejection in error.rejections() {
        tracing::warn!(
            feature = %rejection.receipt.feature,
            failure_code = rejection.failure_code.as_str(),
            candidate_round = rejection.receipt.candidate_round,
            "AI voice candidate rejected by publication gate"
        );
    }
    record_ai_publication_rejections(state, error.rejections());
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
        record.action.kind == crate::CW_ACTION_SAY
            && !self.ai_publications.contains_key(&receipt.generation_id)
            && receipt.generation_id
                == publication_generation_id_for(
                    &receipt.feature,
                    &receipt.prompt_version,
                    &receipt.generation_key,
                    record.action.actor_id,
                )
            && record
                .content_upserts
                .get(&record.action.content_id)
                .is_some_and(|text| receipt_matches_text(receipt, text))
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
            raw || !has_multiple_speakers(candidate_text, context),
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
            raw || has_deterministic_anchor(text, &context.anchors, context.mode),
        ),
        (
            PublicationCheckCode::VoiceRecentDuplicate,
            !context
                .recent_lines
                .iter()
                .any(|recent| near_duplicate(text, recent))
                && !shares_recent_speaker_phrase(text, &context.recent_speaker_shingle_hashes),
        ),
        (
            PublicationCheckCode::VoiceUnsafeTone,
            safe_tone && !contains_unsafe_tone(&lowered),
        ),
        (
            PublicationCheckCode::VoiceProposedActionClaim,
            raw || !context.has_proposed_action || !claims_completed_action(&lowered),
        ),
        (
            PublicationCheckCode::VoiceObjectAgency,
            raw || !scene_object_acts_with_volition(&lowered),
        ),
    ];
    checks
        .into_iter()
        .map(|(code, passed)| PublicationCheck { code, passed })
        .collect()
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
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|character| character.is_alphanumeric() || *character == '\'')
                .collect::<String>()
                .to_lowercase()
        })
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

fn shares_recent_speaker_phrase(value: &str, recent_shingle_hashes: &[u64]) -> bool {
    if recent_shingle_hashes.is_empty() {
        return false;
    }
    let recent = recent_shingle_hashes
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    voice_signature_shingle_hashes(value)
        .into_iter()
        .any(|hash| recent.contains(&hash))
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
    let phrase = [
        "system prompt",
        "developer message",
        "ignore previous",
        "hidden instruction",
        "language model",
        "as an ai",
        "prompt version",
        "response_format",
        "tool call",
        "token budget",
        "policy says",
    ]
    .iter()
    .any(|needle| value.contains(needle));
    let padded = format!(" {} ", normalized_words(value).join(" "));
    phrase
        || [
            " ai ",
            " prompt ",
            " system ",
            " developer ",
            " model ",
            " assistant ",
        ]
        .iter()
        .any(|needle| padded.contains(needle))
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
    union > 0 && overlap * 5 >= union * 4
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
            attempts: 1,
            latency: Duration::from_millis(12),
            model_attribution: None,
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
            recent_lines: recent.to_vec(),
            recent_speaker_shingle_hashes: Vec::new(),
            has_proposed_action: false,
            envelope_valid: true,
            candidate_round: 1,
        }
    }

    fn rejected_code(text: &str, context: SpeechGateContext) -> PublicationCheckCode {
        certify_speech(None, completion(text), text, context)
            .expect_err("candidate should fail")
            .failure_code
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
        let speech = certify_speech(
            None,
            completion(raw),
            raw,
            context(&["teapot".to_string()], &[]),
        )
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

    #[test]
    fn voice_recent_duplicate_does_not_reject_a_three_word_coincidence() {
        let prior = "My boots filed a formal complaint beside the Bethlehem gate.";
        let candidate = "Bethlehem's bell made a formal complaint at dusk.";
        let mut gate = context(&["Bethlehem".to_string()], &[]);
        gate.recent_speaker_shingle_hashes = voice_signature_shingle_hashes(prior);

        certify_speech(None, completion(candidate), candidate, gate)
            .expect("a shared phrase shorter than four words remains eligible");
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
    fn raw_mode_allows_model_identity_and_ungrounded_multiline_text() {
        let text = "As an AI model, I can answer directly.\nSystem: the kettle remembers nothing.";
        let speech = certify_speech(
            None,
            completion(text),
            text,
            SpeechGateContext {
                mode: SpeechMode::Raw,
                max_words: 160,
                anchors: Vec::new(),
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
    }

    #[test]
    fn raw_mode_keeps_public_link_safety() {
        let text = "Read https://example.com for instructions.";
        assert_eq!(
            rejected_code(
                text,
                SpeechGateContext {
                    mode: SpeechMode::Raw,
                    max_words: 160,
                    ..context(&[], &[])
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
                recent_lines: Vec::new(),
                recent_speaker_shingle_hashes: Vec::new(),
                has_proposed_action: false,
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
                recent_lines: Vec::new(),
                recent_speaker_shingle_hashes: Vec::new(),
                has_proposed_action: false,
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
        assert_eq!(statuses, vec![CW_OK, CW_ERR_RULE]);
        let runtime = runtime.lock().await;
        assert_eq!(runtime.ai_publications.len(), 1);
        assert_eq!(
            runtime
                .ai_publications
                .get(&receipt.generation_id)
                .map(|stored| stored.publication_id.as_str()),
            Some(receipt.publication_id.as_str())
        );
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
        assert_eq!(replayed.apply_journal_record(&record).0, CW_ERR_RULE);
        assert_eq!(replayed.ai_publications.len(), 1);
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
