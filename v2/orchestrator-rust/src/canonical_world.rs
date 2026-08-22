use super::*;

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

// --- moved from main.rs: canonical identity/version RuntimeWorld methods ---
impl crate::RuntimeWorld {
    pub(crate) fn ensure_canonical_identities(&mut self, mint_seed: u64) {
        let generated_location_refs = self
            .generated_pathways
            .values()
            .flat_map(|pathway| {
                pathway
                    .waypoints
                    .iter()
                    .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
            })
            .filter(|(_, canonical_id)| !canonical_id.is_empty())
            .collect::<BTreeMap<_, _>>();
        let actor_ids = self.world.actors[..self.world.actor_count]
            .iter()
            .map(|actor| actor.id)
            .collect::<Vec<_>>();
        let item_ids = self.world.items[..self.world.item_count]
            .iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        let location_ids = self.world.locations[..self.world.location_count]
            .iter()
            .map(|location| location.id)
            .chain(
                self.generated_pathways
                    .values()
                    .flat_map(|pathway| pathway.waypoints.iter().map(|waypoint| waypoint.id)),
            )
            .collect::<BTreeSet<_>>();

        for actor_id in actor_ids {
            let candidate_ref = content_registry()
                .content_reference("actor", actor_id)
                .map(|entry| entry.canonical_ref.clone())
                .unwrap_or_else(|| opaque_runtime_ref("actor", &format!("{actor_id}:{mint_seed}")));
            let canonical_ref = self
                .canonical_identities
                .actor_refs
                .entry(actor_id)
                .or_insert(candidate_ref)
                .clone();
            self.canonical_identities
                .entity_versions
                .entry(canonical_ref.clone())
                .or_insert(1);
            let journal_ref = self
                .canonical_identities
                .journal_refs
                .entry(actor_id)
                .or_insert_with(|| opaque_runtime_ref("journal", &canonical_ref))
                .clone();
            self.canonical_identities
                .entity_versions
                .entry(journal_ref)
                .or_insert(1);
        }
        for item_id in item_ids {
            let candidate_ref = content_registry()
                .content_reference("item", item_id)
                .map(|entry| entry.canonical_ref.clone())
                .unwrap_or_else(|| opaque_runtime_ref("item", &format!("{item_id}:{mint_seed}")));
            let canonical_ref = self
                .canonical_identities
                .item_refs
                .entry(item_id)
                .or_insert(candidate_ref)
                .clone();
            self.canonical_identities
                .entity_versions
                .entry(canonical_ref)
                .or_insert(1);
        }
        for location_id in location_ids {
            let candidate_ref = content_registry()
                .content_reference("location", location_id)
                .map(|entry| entry.canonical_ref.clone())
                .or_else(|| generated_location_refs.get(&location_id).cloned())
                .unwrap_or_else(|| {
                    opaque_runtime_ref("location", &format!("{location_id}:{mint_seed}"))
                });
            let canonical_ref = self
                .canonical_identities
                .location_refs
                .entry(location_id)
                .or_insert(candidate_ref)
                .clone();
            self.canonical_identities
                .entity_versions
                .entry(canonical_ref)
                .or_insert(1);
        }
        for bond_id in self.bonds.keys() {
            let canonical_ref = opaque_runtime_ref("pact", bond_id);
            self.canonical_identities
                .pact_refs
                .entry(bond_id.clone())
                .or_insert_with(|| canonical_ref.clone());
            self.canonical_identities
                .entity_versions
                .entry(canonical_ref)
                .or_insert(1);
        }
    }

    pub(crate) fn canonical_ref(&self, kind: &str, runtime_handle: u64) -> Option<&str> {
        match kind {
            "actor" => self.canonical_identities.actor_refs.get(&runtime_handle),
            "item" => self.canonical_identities.item_refs.get(&runtime_handle),
            "location" => self.canonical_identities.location_refs.get(&runtime_handle),
            "journal" => self.canonical_identities.journal_refs.get(&runtime_handle),
            _ => None,
        }
        .map(String::as_str)
    }

    pub(crate) fn runtime_handle_for_canonical_ref(
        &self,
        kind: &str,
        canonical_ref: &str,
    ) -> Option<u64> {
        let refs = match kind {
            "actor" => &self.canonical_identities.actor_refs,
            "item" => &self.canonical_identities.item_refs,
            "location" => &self.canonical_identities.location_refs,
            "journal" => &self.canonical_identities.journal_refs,
            _ => return None,
        };
        refs.iter()
            .find_map(|(runtime_handle, value)| (value == canonical_ref).then_some(*runtime_handle))
    }

    pub(crate) fn canonical_pact_ref(&self, bond_id: &str) -> Option<&str> {
        self.canonical_identities
            .pact_refs
            .get(bond_id)
            .map(String::as_str)
    }

    pub(crate) fn entity_version(&self, canonical_ref: &str) -> u64 {
        self.canonical_identities
            .entity_versions
            .get(canonical_ref)
            .copied()
            .unwrap_or(0)
    }

    pub(crate) fn event_entity_refs(&self, event: &EventView) -> BTreeSet<String> {
        [
            ("actor", event.actor_id),
            ("actor", event.target_actor_id),
            ("location", event.location_id),
            ("location", event.destination_location_id),
            ("location", event.source_location_id),
            ("item", event.item_id),
            ("item", event.target_item_id),
        ]
        .into_iter()
        .filter_map(|(kind, handle)| handle.and_then(|handle| self.canonical_ref(kind, handle)))
        .map(ToString::to_string)
        .collect()
    }

    pub(crate) fn bump_entity_versions_for_events(&mut self, events: &[EventView]) {
        let mut affected = events
            .iter()
            .filter(|event| event.success)
            .flat_map(|event| self.event_entity_refs(event))
            .collect::<BTreeSet<_>>();
        for actor_id in events
            .iter()
            .filter(|event| event.success)
            .flat_map(|event| {
                [event.actor_id, event.target_actor_id]
                    .into_iter()
                    .flatten()
            })
        {
            if let Some(journal_ref) = self.canonical_ref("journal", actor_id) {
                affected.insert(journal_ref.to_string());
            }
        }
        if events.iter().any(|event| {
            event.success
                && matches!(
                    event.type_name.as_str(),
                    "bond.created" | "bond.revised" | "bond.deepened" | "bond.resolved"
                )
        }) {
            affected.extend(self.canonical_identities.pact_refs.values().cloned());
        }
        for canonical_ref in affected {
            let version = self
                .canonical_identities
                .entity_versions
                .entry(canonical_ref)
                .or_insert(1);
            *version = version.saturating_add(1);
        }
    }

    pub(crate) fn refresh_canonical_events(&mut self, events: &mut [EventView]) {
        for event in events.iter_mut() {
            event.world_id = official_world_id();
            event.world_epoch = official_world_epoch();
        }
        for event in events.iter().filter(|event| event.seq > 0) {
            if let Some(logged) = self
                .event_log
                .iter_mut()
                .rev()
                .find(|logged| logged.seq == event.seq)
            {
                *logged = event.clone();
            }
        }
    }

    pub(crate) fn refresh_all_canonical_events(&mut self) {
        for event in &mut self.event_log {
            event.world_id = official_world_id();
            event.world_epoch = official_world_epoch();
        }
    }
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
