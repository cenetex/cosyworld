use super::*;

const PROXIM8_EXTENSION_ID: &str = "x-cosyworld-actor-materialization";
const PROXIM8_RECEIPT_PREFIX: &str = "project89:proxim8:";
const PROXIM8_COLLECTION_ADDRESS: &str = "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf";
const PROXIM8_ENTRY_LOCATION_ID: u64 = 8900;
const PROXIM8_PILOT_ASSET_ID: &str = "Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo";

pub(super) fn is_materialized_actor_receipt(
    runtime: &RuntimeWorld,
    receipt: &MaterializationReceiptState,
) -> bool {
    let expected_receipt_id = proxim8_receipt_id(&receipt.card_id);
    let expected_item_id = materialized_item_id(&format!("{expected_receipt_id}:memory"));
    let expected_actor_name = proxim8_name(&receipt.card_id);
    let expected_origin = format!("collection:{}", receipt.card_id);
    let Some(actor) = runtime.actor_by_id(receipt.actor_id) else {
        return false;
    };
    let Some(actor_meta) = runtime.actors.get(&receipt.actor_id) else {
        return false;
    };
    let Some(item) = runtime.item_by_id(receipt.item_id) else {
        return false;
    };
    let Some(item_meta) = runtime.items.get(&receipt.item_id) else {
        return false;
    };

    receipt.id == expected_receipt_id
        && receipt.item_id == expected_item_id
        && receipt.status == "materialized"
        && receipt
            .source_wallet
            .as_deref()
            .is_some_and(|wallet| !wallet.trim().is_empty())
        && actor.kind == CW_ACTOR_NPC
        && runtime.actor_control_mode(receipt.actor_id) == ActorControlMode::LocalAi
        && actor_meta.name == expected_actor_name
        && actor_meta.title == "Materialized Proxim8"
        && item.kind == CW_ITEM_KEEPSAKE
        && item.role == CW_ITEM_ROLE_RELIC
        && item_meta
            .description
            .contains(&format!("asset {}", receipt.card_id))
        && runtime
            .item_provenance
            .get(&receipt.item_id)
            .is_some_and(|provenance| provenance.origin == expected_origin)
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Proxim8MaterializationConfig {
    schema_version: u32,
    status: String,
    trigger: String,
    entry_location_id: u64,
    collection: Proxim8CollectionConfig,
    ownership: Proxim8OwnershipConfig,
    pilot: Proxim8PilotConfig,
    actor_kind: String,
    custody_changes_control: bool,
    ambient_autonomy: bool,
    direct_actor_session: bool,
    goal: String,
    dynamic_item: Proxim8MemoryItemConfig,
    media: Proxim8MediaConfig,
}

#[derive(Clone, Debug, Deserialize)]
struct Proxim8CollectionConfig {
    name: String,
    address: String,
    chain: String,
    standard: String,
}

#[derive(Clone, Debug, Deserialize)]
struct Proxim8OwnershipConfig {
    authority: String,
    wallet_signature_proves_ownership: bool,
    collection_membership_must_be_verified: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct Proxim8PilotConfig {
    actor_id: u64,
    asset_id: String,
    name: String,
    already_materialized: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct Proxim8MemoryItemConfig {
    name: String,
    kind: String,
    role: String,
}

#[derive(Clone, Debug, Deserialize)]
struct Proxim8MediaConfig {
    base_profile: String,
    base_model: String,
    lora: String,
    trigger_word: String,
    lora_strength: f32,
    style: String,
    refinement_profile: String,
    refinement_model: String,
    refinement_purpose: String,
}

pub(super) fn active_proxim8_materialization_config() -> Option<Proxim8MaterializationConfig> {
    active_content().manifest.packs.iter().find_map(|pack| {
        pack.extensions
            .get(PROXIM8_EXTENSION_ID)
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
    })
}

fn configured_proxim8_asset_ids(
    ownership: &OwnershipIndex,
    wallet_address: &str,
    config: &Proxim8MaterializationConfig,
) -> Vec<String> {
    let prefix = verified_collection_asset_key(&config.collection.address, "");
    ownership
        .cards_for_wallet(wallet_address)
        .into_iter()
        .filter_map(|card_id| card_id.strip_prefix(&prefix).map(str::to_string))
        .filter(|asset_id| asset_id != &config.pilot.asset_id)
        .collect()
}

fn proxim8_receipt_id(asset_id: &str) -> String {
    format!("{PROXIM8_RECEIPT_PREFIX}{asset_id}")
}

fn proxim8_name(asset_id: &str) -> String {
    let short_id = asset_id.get(..8).unwrap_or(asset_id);
    format!("Proxim8 {short_id}")
}

pub(super) fn proxim8_materialization_record(
    runtime: &RuntimeWorld,
    wallet_address: &str,
    asset_id: &str,
    config: &Proxim8MaterializationConfig,
) -> Option<JournalRecord> {
    if config.schema_version != 1
        || config.status != "active"
        || config.trigger != "first_verified_wallet_connection"
        || config.actor_kind != "independent_proxim8"
        || config.custody_changes_control
        || !config.ambient_autonomy
        || config.direct_actor_session
        || config.ownership.authority != "trusted_server_feed"
        || config.ownership.wallet_signature_proves_ownership
        || !config.ownership.collection_membership_must_be_verified
        || config.collection.name != "PROXIM8"
        || config.collection.chain != "solana"
        || config.collection.standard != "metaplex_core"
        || !config.pilot.already_materialized
        || config.pilot.actor_id == 0
        || config.pilot.name.trim().is_empty()
        || config.dynamic_item.kind != "keepsake"
        || config.dynamic_item.role != "relic"
        || config.media.base_model != "flux-1"
        || config.media.lora != "ratimics/project89"
        || config.media.trigger_word != "P89"
        || (config.media.lora_strength - 1.0).abs() > f32::EPSILON
        || config.media.style != "washed-out watercolor anime style"
        || config.media.refinement_model != "flux-2"
        || config.media.base_profile.trim().is_empty()
        || config.media.refinement_profile.trim().is_empty()
        || config.media.refinement_purpose.trim().is_empty()
        || asset_id == config.pilot.asset_id
    {
        return None;
    }
    let receipt_id = proxim8_receipt_id(asset_id);
    if runtime.materialization_receipts.contains_key(&receipt_id)
        || runtime.world.actor_count >= CW_MAX_ACTORS
        || runtime.world.item_count >= CW_MAX_ITEMS
    {
        return None;
    }
    let actor_id = runtime.next_actor_id;
    let item_id = materialized_item_id(&format!("{receipt_id}:memory"));
    if runtime.actor_by_id(actor_id).is_some() || runtime.item_by_id(item_id).is_some() {
        return None;
    }
    let name = proxim8_name(asset_id);
    let receipt = MaterializationReceiptState {
        id: receipt_id,
        actor_id,
        card_id: asset_id.to_string(),
        item_id,
        status: "materialized".to_string(),
        source_wallet: Some(wallet_address.to_string()),
        source_event_seq: runtime.world.next_event_seq,
    };
    let memory_item = CwItem {
        id: item_id,
        kind: CW_ITEM_KEEPSAKE,
        charges: 1,
        max_charges: 1,
        weight_tenths: 1,
        size_class: CW_ITEM_SIZE_TINY,
        role: CW_ITEM_ROLE_RELIC,
        zone: CW_CARD_ZONE_CARRIED,
        holder_actor_id: actor_id,
        held_since_tick: runtime.world.tick,
        ..CwItem::default()
    };
    let memory_meta = ItemMeta {
        name: format!("{} · {}", config.dynamic_item.name, name),
        description: format!(
            "A private continuity seed for {name}. It records verified arrival from asset {asset_id}; custody grants no right to command this actor."
        ),
        skill_id: None,
        skill_bonus: 0,
        mechanics: None,
    };
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id,
            location_id: config.entry_location_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.origin = JournalOrigin::System;
    record.initial_calling = Some(config.goal.clone());
    record.actor_meta_upserts.insert(
        actor_id,
        ActorMeta {
            name: name.clone(),
            speech_mode: "prose".to_string(),
            title: "Materialized Proxim8".to_string(),
            description: format!(
                "{name} arrived at Threshold 8900 after a verified owner connection. They are an independent actor searching for other Proxim8s; wallet custody records provenance, never control."
            ),
        },
    );
    record
        .projection_mutations
        .push(ProjectionMutation::MaterializeProxim8Actor {
            receipt,
            memory_item,
            memory_meta,
            collection_address: config.collection.address.clone(),
            goal: config.goal.clone(),
        });
    Some(record)
}

impl RuntimeWorld {
    pub(super) fn proxim8_materialization_record_preconditions_hold(
        &self,
        record: &JournalRecord,
    ) -> bool {
        let mutations = record
            .projection_mutations
            .iter()
            .filter_map(|mutation| match mutation {
                ProjectionMutation::MaterializeProxim8Actor {
                    receipt,
                    memory_item,
                    collection_address,
                    ..
                } => Some((receipt, memory_item, collection_address)),
                _ => None,
            })
            .collect::<Vec<_>>();
        if mutations.is_empty() {
            return true;
        }
        if mutations.len() != 1 || record.action.kind != CW_ACTION_CREATE_ACTOR {
            return false;
        }
        let (receipt, memory_item, collection_address) = mutations[0];
        receipt.id == proxim8_receipt_id(&receipt.card_id)
            && receipt.actor_id == record.action.actor_id
            && receipt.item_id == memory_item.id
            && receipt.status == "materialized"
            && receipt
                .source_wallet
                .as_deref()
                .is_some_and(|wallet| !wallet.trim().is_empty())
            && collection_address == PROXIM8_COLLECTION_ADDRESS
            && receipt.card_id != PROXIM8_PILOT_ASSET_ID
            && record.action.location_id == PROXIM8_ENTRY_LOCATION_ID
            && memory_item.holder_actor_id == receipt.actor_id
            && memory_item.kind == CW_ITEM_KEEPSAKE
            && memory_item.role == CW_ITEM_ROLE_RELIC
            && self.actor_by_id(receipt.actor_id).is_none()
            && self.item_by_id(receipt.item_id).is_none()
            && !self.materialization_receipts.contains_key(&receipt.id)
            && self.world.actor_count < CW_MAX_ACTORS
            && self.world.item_count < CW_MAX_ITEMS
    }

    pub(super) fn apply_proxim8_materialization(
        &mut self,
        receipt: &MaterializationReceiptState,
        memory_item: CwItem,
        memory_meta: &ItemMeta,
        collection_address: &str,
        goal: &str,
    ) -> Vec<EventView> {
        let Some(actor) = self.world.actors[..self.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == receipt.actor_id)
        else {
            return Vec::new();
        };
        actor.kind = CW_ACTOR_NPC;
        self.actor_autonomy.insert(
            receipt.actor_id,
            ActorAutonomyState {
                control_mode: ActorControlMode::LocalAi,
                current_desires: vec![goal.to_string()],
                attention_credits: 1,
                ..ActorAutonomyState::default()
            },
        );
        let mut events = self.materialize_item(
            receipt.clone(),
            memory_item,
            memory_meta.clone(),
            "proxim8_agent_memory_seed",
        );
        if events.is_empty() {
            return events;
        }
        events.push(self.append_async_job_event(
            "actor.materialized",
            receipt.actor_id,
            None,
            Some(format!(
                "PROXIM8 asset {} joined from verified collection {} as an independent local-AI actor; custody grants no direct control.",
                receipt.card_id, collection_address
            )),
        ));
        events
    }
}

pub(super) async fn materialize_wallet_proxim8s(
    state: &AppState,
    wallet_address: &str,
) -> Vec<EventView> {
    let Some(config) = active_proxim8_materialization_config() else {
        return Vec::new();
    };
    let ownership = state.ownership_snapshot().await;
    let asset_ids = configured_proxim8_asset_ids(&ownership, wallet_address, &config);
    if asset_ids.is_empty() {
        return Vec::new();
    }

    let mut runtime = state.inner.lock().await;
    let mut committed_events = Vec::new();
    for asset_id in asset_ids {
        let Some(record) =
            proxim8_materialization_record(&runtime, wallet_address, &asset_id, &config)
        else {
            continue;
        };
        match commit_journal_record(state, &mut runtime, record) {
            Ok((CW_OK, events)) => committed_events.extend(events),
            Ok(_) => warn!("verified Proxim8 materialization was rejected for {asset_id}"),
            Err(error) => {
                warn!("verified Proxim8 materialization failed for {asset_id}: {error}");
                break;
            }
        }
    }
    drop(runtime);
    if !committed_events.is_empty() {
        broadcast_events(state, &committed_events);
    }
    committed_events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_config() -> Proxim8MaterializationConfig {
        let pack: serde_json::Value = serde_json::from_str(include_str!(
            "../../content/project89-operation-liberation/pack.json"
        ))
        .expect("Project89 pack");
        serde_json::from_value(pack["extensions"][PROXIM8_EXTENSION_ID].clone())
            .expect("Project89 Proxim8 policy")
    }

    #[test]
    fn trusted_feed_requires_verified_collection_membership() {
        let wallet = "DcXxMstZHwnEMjLTF1Aa2kHB95NBif77nPUEZqD4ZTue";
        let verified_asset = PROXIM8_PILOT_ASSET_ID;
        let rejected_asset = wallet;
        let collection = PROXIM8_COLLECTION_ADDRESS;
        let feed = serde_json::json!({
            "wallets": [{
                "wallet": wallet,
                "collectionAssets": [
                    {"assetId": verified_asset, "collectionAddress": collection, "verified": true},
                    {"assetId": rejected_asset, "collectionAddress": collection, "verified": false}
                ]
            }]
        });
        let ownership = OwnershipIndex::parse(&feed.to_string());
        let cards = ownership.cards_for_wallet(wallet);
        assert!(cards.contains(&verified_collection_asset_key(collection, verified_asset)));
        assert!(!cards.contains(&verified_collection_asset_key(collection, rejected_asset)));
    }

    #[test]
    fn selected_project89_registry_seeds_callum_as_the_first_finder() {
        let Some(config) = active_proxim8_materialization_config() else {
            return;
        };
        let runtime = RuntimeWorld::seeded();
        let callum = runtime
            .actor_by_id(config.pilot.actor_id)
            .expect("Callum is already materialized");
        assert_eq!(callum.kind, CW_ACTOR_NPC);
        assert_eq!(callum.location_id, config.entry_location_id);
        assert_eq!(
            runtime.actor_control_mode(callum.id),
            ActorControlMode::LocalAi
        );
        assert!(runtime
            .actors
            .get(&callum.id)
            .is_some_and(|meta| meta.description.contains("others of his collection")));
    }

    #[test]
    fn verified_owner_materialization_is_independent_exactly_once_and_snapshot_safe() {
        let config = project_config();
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(PROXIM8_ENTRY_LOCATION_ID, 0);
        let asset_id = "8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd";
        let wallet = "DcXxMstZHwnEMjLTF1Aa2kHB95NBif77nPUEZqD4ZTue";
        let record = proxim8_materialization_record(&runtime, wallet, asset_id, &config)
            .expect("first materialization");
        let actor_id = record.action.actor_id;
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "actor.materialized"));
        assert_eq!(runtime.actor_by_id(actor_id).unwrap().kind, CW_ACTOR_NPC);
        assert_eq!(
            runtime.actor_control_mode(actor_id),
            ActorControlMode::LocalAi
        );
        let item_inventory = materialization_retirement::receipt_inventory(&runtime);
        assert_eq!(item_inventory.total, 0);
        assert_eq!(item_inventory.retained_actor_materialization, 1);
        assert!(proxim8_materialization_record(&runtime, wallet, asset_id, &config).is_none());

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores");
        assert_eq!(restored.actor_by_id(actor_id).unwrap().kind, CW_ACTOR_NPC);
        assert_eq!(
            restored.actor_control_mode(actor_id),
            ActorControlMode::LocalAi
        );
        assert!(proxim8_materialization_record(&restored, wallet, asset_id, &config).is_none());
    }
}
