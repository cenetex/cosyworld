use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    io,
};

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

impl CanonicalIdentityState {
    pub(super) fn reachable_entity_refs(&self) -> BTreeSet<String> {
        self.actor_refs
            .values()
            .chain(self.item_refs.values())
            .chain(self.location_refs.values())
            .chain(self.journal_refs.values())
            .chain(self.pact_refs.values())
            .cloned()
            .collect()
    }

    pub(super) fn retain_reachable_entity_versions(&mut self) {
        let reachable = self.reachable_entity_refs();
        self.entity_versions
            .retain(|entity_ref, _| reachable.contains(entity_ref));
    }
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

/// The durable `canonical_command_receipts` table is the source of truth for
/// idempotent retries. This cache only spares a SQLite read on the retries
/// clients actually make, so it is bounded by both entry count and retained
/// response bytes; a stored response carries a full state projection and runs
/// to hundreds of kilobytes.
pub(super) const COMMAND_RECEIPT_CACHE_MAX_ENTRIES: usize = 128;
pub(super) const COMMAND_RECEIPT_CACHE_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Default)]
pub(super) struct CommandReceiptCache {
    entries: BTreeMap<String, StoredCommandResponse>,
    order: VecDeque<String>,
    retained_bytes: usize,
}

impl CommandReceiptCache {
    /// Rebuild the cache from a legacy snapshot that still persisted receipts.
    /// Newer snapshots omit them, and a miss falls through to the durable table.
    pub(super) fn from_persisted(persisted: BTreeMap<String, StoredCommandResponse>) -> Self {
        let mut cache = Self::default();
        for (key, stored) in persisted {
            cache.insert(key, stored);
        }
        cache
    }

    pub(super) fn get(&self, key: &str) -> Option<&StoredCommandResponse> {
        self.entries.get(key)
    }

    pub(super) fn insert(&mut self, key: String, stored: StoredCommandResponse) {
        self.forget(&key);
        self.retained_bytes = self
            .retained_bytes
            .saturating_add(entry_bytes(&key, &stored));
        self.order.push_back(key.clone());
        self.entries.insert(key, stored);
        self.evict_to_capacity();
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub(super) fn retained_bytes(&self) -> usize {
        self.retained_bytes
    }

    #[cfg(test)]
    pub(super) fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.retained_bytes = 0;
    }

    /// Drop the newest-first tail until both bounds hold. The most recently
    /// inserted receipt is always kept, so a single oversized response still
    /// answers its own immediate retry.
    fn evict_to_capacity(&mut self) {
        while self.entries.len() > 1
            && (self.entries.len() > COMMAND_RECEIPT_CACHE_MAX_ENTRIES
                || self.retained_bytes > COMMAND_RECEIPT_CACHE_MAX_BYTES)
        {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.drop_entry(&oldest);
        }
    }

    fn forget(&mut self, key: &str) {
        if self.entries.contains_key(key) {
            self.order.retain(|existing| existing != key);
            self.drop_entry(key);
        }
    }

    fn drop_entry(&mut self, key: &str) {
        if let Some(stored) = self.entries.remove(key) {
            self.retained_bytes = self
                .retained_bytes
                .saturating_sub(entry_bytes(key, &stored));
        }
    }
}

fn entry_bytes(key: &str, stored: &StoredCommandResponse) -> usize {
    key.len() + stored.request_hash.len() + stored.response_json.len()
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
        || value.starts_with("compat:")
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':' | '.'))
    {
        return Err(
            "intent_id must be 1-160 ASCII letters, numbers, '-', '_', ':' or '.' and may not use the reserved 'compat:' prefix",
        );
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

    #[test]
    fn client_intents_cannot_claim_the_server_compatibility_namespace() {
        assert!(validate_intent_id("player:stable-intent").is_ok());
        assert!(validate_intent_id("compat:server-owned").is_err());
    }

    fn stored(index: usize, response_json: String) -> StoredCommandResponse {
        StoredCommandResponse {
            request_hash: format!("sha256:hash-{index}"),
            response_json,
        }
    }

    #[test]
    fn receipt_cache_stays_bounded_across_many_commands() {
        let mut cache = CommandReceiptCache::default();
        for index in 0..(COMMAND_RECEIPT_CACHE_MAX_ENTRIES * 4) {
            cache.insert(
                format!("world://test\u{0}intent-{index}"),
                stored(index, format!("{{\"index\":{index}}}")),
            );
            assert!(
                cache.len() <= COMMAND_RECEIPT_CACHE_MAX_ENTRIES,
                "cache grew to {} entries after {} inserts",
                cache.len(),
                index + 1
            );
            assert!(cache.retained_bytes() <= COMMAND_RECEIPT_CACHE_MAX_BYTES);
        }

        assert!(cache.get("world://test\u{0}intent-0").is_none());
        let newest = COMMAND_RECEIPT_CACHE_MAX_ENTRIES * 4 - 1;
        assert!(cache
            .get(&format!("world://test\u{0}intent-{newest}"))
            .is_some());
    }

    #[test]
    fn receipt_cache_bounds_oversized_responses_by_bytes() {
        let mut cache = CommandReceiptCache::default();
        let oversized = "x".repeat(COMMAND_RECEIPT_CACHE_MAX_BYTES / 4);
        for index in 0..8 {
            cache.insert(
                format!("world://test\u{0}intent-{index}"),
                stored(index, oversized.clone()),
            );
        }
        assert!(cache.retained_bytes() <= COMMAND_RECEIPT_CACHE_MAX_BYTES);
        assert!(cache.len() < 8, "byte bound never evicted: {}", cache.len());

        // A response larger than the whole budget still answers its own retry.
        cache.insert(
            "world://test\u{0}intent-huge".to_string(),
            stored(99, "y".repeat(COMMAND_RECEIPT_CACHE_MAX_BYTES * 2)),
        );
        assert_eq!(cache.len(), 1);
        assert!(cache.get("world://test\u{0}intent-huge").is_some());
    }

    #[test]
    fn reinserting_a_receipt_does_not_double_count_its_bytes() {
        let mut cache = CommandReceiptCache::default();
        cache.insert(
            "world://test\u{0}intent-1".to_string(),
            stored(1, "a".repeat(64)),
        );
        let once = cache.retained_bytes();
        cache.insert(
            "world://test\u{0}intent-1".to_string(),
            stored(1, "a".repeat(64)),
        );
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.retained_bytes(), once);
    }
}
