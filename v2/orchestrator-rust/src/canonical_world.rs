use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    io,
};

pub(super) const OFFICIAL_WORLD_ID: &str = "world://cosyworld/official";
pub(super) const OFFICIAL_WORLD_EPOCH: u64 = 1;

pub(super) fn official_world_id() -> String {
    OFFICIAL_WORLD_ID.to_string()
}

pub(super) const fn official_world_epoch() -> u64 {
    OFFICIAL_WORLD_EPOCH
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct CanonicalIdentityState {
    #[serde(default)]
    pub(super) actor_refs: BTreeMap<u64, String>,
    #[serde(default)]
    pub(super) item_refs: BTreeMap<u64, String>,
    #[serde(default)]
    pub(super) location_refs: BTreeMap<u64, String>,
    #[serde(default)]
    pub(super) journal_refs: BTreeMap<u64, String>,
    #[serde(default)]
    pub(super) pact_refs: BTreeMap<String, String>,
    #[serde(default)]
    pub(super) entity_versions: BTreeMap<String, u64>,
}

impl CanonicalIdentityState {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct CanonicalCommandReceipt {
    pub(super) world_id: String,
    pub(super) world_epoch: u64,
    pub(super) world_seq: u64,
    pub(super) intent_id: String,
    pub(super) actor_ref: String,
    pub(super) entity_versions: BTreeMap<String, u64>,
    pub(super) owner_fencing_epoch: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(super) compatibility_envelope: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct StoredCommandResponse {
    pub(super) request_hash: String,
    pub(super) response_json: String,
}

#[derive(Clone, Debug, Default)]
pub(super) struct CommandReceiptCache {
    entries: BTreeMap<String, StoredCommandResponse>,
    order: VecDeque<String>,
    retained_bytes: usize,
}

impl CommandReceiptCache {}

pub(super) fn normalize_process_id(value: &str, variable: &str) -> io::Result<String> {
    let process_id = value.trim();
    if process_id.is_empty()
        || process_id.len() > 64
        || !process_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{variable} must be 1-64 ASCII letters, numbers, '-' or '_'"),
        ));
    }
    Ok(process_id.to_string())
}

// --- moved from main.rs: canonical identity/version RuntimeWorld methods ---
impl crate::RuntimeWorld {}
