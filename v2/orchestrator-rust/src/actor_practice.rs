use serde::{ser::SerializeStruct, Deserialize, Serialize};

pub(crate) const PRACTICE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DeedCategory {
    Exploration,
    Craft,
    Delivery,
    Stewardship,
    Care,
    Mediation,
    Lore,
}

impl DeedCategory {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct DeedRecord {
    pub schema_version: u32,
    pub id: String,
    pub actor_id: u64,
    #[serde(alias = "actor_kind")]
    pub controller_mode: String,
    pub category: DeedCategory,
    pub source_action: String,
    pub operation: String,
    pub rules_profile: String,
    pub contributing_pack_id: String,
    pub source_event_seqs: Vec<u64>,
    pub target_kind: String,
    pub target_id: String,
    pub location_id: Option<u64>,
    pub durable_public_trace: bool,
    pub claim_key: String,
}

impl DeedRecord {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct ActorPracticeState {
    #[serde(default = "practice_schema_version")]
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary: Option<DeedCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary: Option<DeedCategory>,
    #[serde(default)]
    pub updated_event_seq: u64,
}

fn practice_schema_version() -> u32 {
    PRACTICE_SCHEMA_VERSION
}

impl Default for ActorPracticeState {
    fn default() -> Self {
        Self {
            schema_version: PRACTICE_SCHEMA_VERSION,
            primary: None,
            secondary: None,
            updated_event_seq: 0,
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct ActorPracticeView {
    pub schema_version: u32,
    pub actor_id: u64,
    pub epithet: String,
    pub known_for: String,
    pub primary: String,
    pub secondary: Option<String>,
    pub evidence: Vec<PracticeEvidenceView>,
}

impl Serialize for ActorPracticeView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActorPracticeView", 4)?;
        out.serialize_field("epithet", &self.epithet)?;
        out.serialize_field("known_for", &self.known_for)?;
        out.serialize_field("primary", &self.primary)?;
        out.serialize_field("evidence", &self.evidence)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct PracticeEvidenceView {
    pub category: String,
    pub description: String,
    pub source_event_seqs: Vec<u64>,
    pub target_kind: String,
    pub target_id: String,
    pub location_id: Option<u64>,
}

impl Serialize for PracticeEvidenceView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("PracticeEvidenceView", 3)?;
        out.serialize_field("category", &self.category)?;
        out.serialize_field("target_kind", &self.target_kind)?;
        out.serialize_field("target_id", &self.target_id)?;
        out.end()
    }
}
