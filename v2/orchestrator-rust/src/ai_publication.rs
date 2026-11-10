use crate::ai_gateway::AiTokenUsage;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::io;

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

impl PublicationCheckCode {}

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

impl crate::RuntimeWorld {}
