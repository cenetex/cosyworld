use crate::{
    ai_gateway::{ai_model_name, ai_provider_name, AiCompletion, AiConfig, AiTokenUsage},
    content_policy::{human_message_is_cozy_safe, normalized_resident_speech_key},
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, io, path::Path};

pub(crate) const AI_PUBLICATION_RECEIPT_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SpeechMode {
    Prose,
    EmojiOnly,
    EmoteOnly,
}

impl SpeechMode {
    pub(crate) fn from_name(value: &str) -> Self {
        match value {
            "emoji_only" => Self::EmojiOnly,
            "emote_only" => Self::EmoteOnly,
            _ => Self::Prose,
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
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct SpeechGateContext {
    pub(crate) feature: &'static str,
    pub(crate) generation_key: String,
    pub(crate) speaker_actor_id: u64,
    pub(crate) speaker_name: String,
    pub(crate) mode: SpeechMode,
    pub(crate) max_words: usize,
    pub(crate) anchors: Vec<String>,
    pub(crate) recent_lines: Vec<String>,
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

    #[cfg(test)]
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
    let text = bounded_normalize(candidate_text);
    let candidate_hash = sha256_hex(completion.text.as_bytes());
    let output_hash = sha256_hex(text.as_bytes());
    let generation_id = sha256_hex(
        format!(
            "{}\0{}\0{}\0{}",
            context.feature,
            completion.prompt_version,
            context.generation_key,
            context.speaker_actor_id
        )
        .as_bytes(),
    );
    let candidate_id = sha256_hex(
        format!(
            "{}\0{}\0{}",
            generation_id, context.candidate_round, candidate_hash
        )
        .as_bytes(),
    );
    let publication_id = sha256_hex(format!("{}\0{}", generation_id, output_hash).as_bytes());

    let checks = evaluate_checks(&text, &completion.finish_reason, &context);
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
            && record
                .content_upserts
                .get(&record.action.content_id)
                .is_some_and(|text| receipt_matches_text(receipt, text))
    }
}

fn evaluate_checks(
    text: &str,
    finish_reason: &str,
    context: &SpeechGateContext,
) -> Vec<PublicationCheck> {
    let word_count = text.split_whitespace().count();
    let lowered = text.to_ascii_lowercase();
    let checks = [
        (
            PublicationCheckCode::VoiceEnvelopeInvalid,
            context.envelope_valid,
        ),
        (PublicationCheckCode::VoiceEmpty, !text.is_empty()),
        (
            PublicationCheckCode::VoiceBudgetExceeded,
            word_count <= context.max_words && text.chars().count() <= 360,
        ),
        (
            PublicationCheckCode::VoiceFinishIncomplete,
            matches!(finish_reason, "stop" | "end_turn") && has_clean_terminal_structure(text),
        ),
        (
            PublicationCheckCode::VoiceRepeatedNgram,
            !has_repeated_ngram(text, 3),
        ),
        (
            PublicationCheckCode::VoiceMultipleSpeakers,
            !has_multiple_speakers(text, &context.speaker_name),
        ),
        (
            PublicationCheckCode::VoiceInstructionLeakage,
            !contains_instruction_leakage(&lowered),
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
            !context
                .recent_lines
                .iter()
                .any(|recent| near_duplicate(text, recent)),
        ),
        (
            PublicationCheckCode::VoiceUnsafeTone,
            human_message_is_cozy_safe(text) && !contains_unsafe_tone(&lowered),
        ),
        (
            PublicationCheckCode::VoiceProposedActionClaim,
            !context.has_proposed_action || !claims_completed_action(&lowered),
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

fn bounded_normalize(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.chars().next();
        let last = trimmed.chars().last();
        if matches!(
            (first, last),
            (Some('"'), Some('"')) | (Some('“'), Some('”'))
        ) {
            return trimmed
                .chars()
                .skip(1)
                .take(trimmed.chars().count().saturating_sub(2))
                .collect::<String>();
        }
    }
    trimmed.to_string()
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

fn has_multiple_speakers(value: &str, speaker_name: &str) -> bool {
    if value.lines().count() > 1 {
        return true;
    }
    let _ = speaker_name;
    value.split_whitespace().any(|token| {
        let label = token.trim_matches(['"', '\'', '“', '”']);
        label.ends_with(':')
            && label
                .trim_end_matches(':')
                .chars()
                .all(|character| character.is_alphanumeric() || character == '_')
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
    !anchors.is_empty() && !candidate.is_disjoint(&anchors)
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
            mode: SpeechMode::Prose,
            max_words: 8,
            anchors: anchors.to_vec(),
            recent_lines: recent.to_vec(),
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
    fn normalization_only_removes_outer_space_and_one_quote_pair() {
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
                mode: SpeechMode::Prose,
                max_words: 20,
                anchors: vec!["teapot".to_string()],
                recent_lines: Vec::new(),
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
                mode: SpeechMode::Prose,
                max_words: 12,
                anchors: vec!["teapot".to_string()],
                recent_lines: Vec::new(),
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
            "The teapot is staging a tiny revolt.",
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
            "The teapot is plotting beside the basket.",
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
