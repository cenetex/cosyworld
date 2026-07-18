use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io};

pub(super) const OFFICIAL_WORLD_ID: &str = "world://cosyworld/official";
pub(super) const OFFICIAL_WORLD_EPOCH: u64 = 1;
pub(super) const SINGLE_WRITER_FENCING_EPOCH: u64 = 1;

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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CanonicalObservedVersions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) actor_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) location_version: Option<u64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(super) entities: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CanonicalCommandEnvelope {
    pub(super) world_id: String,
    pub(super) intent_id: String,
    pub(super) actor_ref: String,
    #[serde(default)]
    pub(super) observed: CanonicalObservedVersions,
    pub(super) last_world_seq: u64,
}

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

pub(super) fn validate_intent_id(value: &str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':' | '.'))
    {
        return Err("intent_id must be 1-160 ASCII letters, numbers, '-', '_', ':' or '.'");
    }
    Ok(value.to_string())
}

pub(super) fn opaque_runtime_ref(kind: &str, stable_material: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(OFFICIAL_WORLD_ID.as_bytes());
    digest.update([0]);
    digest.update(kind.as_bytes());
    digest.update([0]);
    digest.update(stable_material.as_bytes());
    let opaque = format!("{:x}", digest.finalize());
    format!("{OFFICIAL_WORLD_ID}/{kind}/{}", &opaque[..32])
}

pub(super) fn command_request_hash(
    actor_ref: &str,
    command: &str,
    observed: &CanonicalObservedVersions,
    last_world_seq: u64,
) -> String {
    let mut digest = Sha256::new();
    digest.update(actor_ref.as_bytes());
    digest.update([0]);
    digest.update(command.trim().as_bytes());
    digest.update([0]);
    digest.update(last_world_seq.to_le_bytes());
    digest.update(serde_json::to_vec(observed).unwrap_or_default());
    format!("sha256:{:x}", digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_references_are_process_neutral() {
        let first = opaque_runtime_ref("actor", "creation:42:9001");
        let second = opaque_runtime_ref("actor", "creation:42:9001");
        assert_eq!(first, second);
        assert!(first.starts_with("world://cosyworld/official/actor/"));
        assert!(!first.contains("public-1"));
    }

    #[test]
    fn process_ids_are_capacity_labels() {
        assert_eq!(
            normalize_process_id("api_west-2", "PROCESS").unwrap(),
            "api_west-2"
        );
        assert!(normalize_process_id("world://other", "PROCESS").is_err());
    }
}
