use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::*;

fn default_daily_journal_update_kind() -> String {
    "moment".to_string()
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct AvatarDailyJournalState {
    #[serde(default)]
    pub(super) observed_through_seq: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) hidden_updates: Vec<DailyJournalHiddenUpdate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) pending_chat_excerpts: Vec<DailyJournalChatExcerpt>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(super) pages: BTreeMap<u64, DailyJournalPageState>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalHiddenUpdate {
    pub(super) source_event_seqs: Vec<u64>,
    #[serde(default = "default_daily_journal_update_kind")]
    pub(super) kind: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalChatExcerpt {
    pub(super) source_event_seq: u64,
    pub(super) speaker_actor_id: u64,
    pub(super) speaker_name: String,
    pub(super) location_id: u64,
    pub(super) location_name: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalPageState {
    pub(super) day_index: u64,
    pub(super) artifact_id: String,
    pub(super) actor_id: u64,
    pub(super) avatar_name: String,
    pub(super) location_id: u64,
    pub(super) location_name: String,
    pub(super) requested_event_seq: u64,
    pub(super) source_event_seqs: Vec<u64>,
    pub(super) hidden_updates: Vec<DailyJournalHiddenUpdate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) chat_excerpts: Vec<DailyJournalChatExcerpt>,
    pub(super) status: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) entry: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) image_content_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) image_digest: String,
    pub(super) style_revision: String,
    pub(super) prompt_version: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct DailyJournalView {
    protocol: &'static str,
    pages: Vec<DailyJournalPageView>,
}

#[derive(Clone, Debug, Serialize)]
struct DailyJournalPageView {
    actor_id: u64,
    day_index: u64,
    page_index: usize,
    artifact_id: String,
    rest_kind: &'static str,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_alt: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    chat_excerpts: Vec<DailyJournalChatExcerpt>,
    style_revision: String,
}

impl RuntimeWorld {}
