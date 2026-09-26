//! Worldpack-declared linked avatars.
//!
//! A world lists the NFTs that may join it as avatars: whole collections,
//! specific assets, or both, each with an arrival place:
//!
//! ```json
//! "linked_avatars": {
//!   "schema_version": 1,
//!   "sources": [
//!     { "id": "proxim8", "name": "Proxim8",
//!       "collections": ["5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf"],
//!       "arrival_location": "cosyworld.core:location/1" }
//!   ]
//! }
//! ```
//!
//! When a wallet is linked, the server reads the wallet's assets (Helius, or
//! the trusted ownership feed), keeps those a source admits, and gives each
//! asset exactly one durable actor. The standard is whatever DAS reports;
//! admission checks only the verified collection or the asset id.
//!
//! Records reuse the Proxim8 materialization mutation with receipts named
//! `linked-avatar:<asset>`. Their replay preconditions read only the record,
//! so later worldpack edits never break journal replay. An asset already
//! joined through the Project 89 pilot never joins twice.

use super::*;

pub(crate) const LINKED_AVATAR_RECEIPT_PREFIX: &str = "linked-avatar:";
const DEFAULT_GOAL: &str = "Find your footing here and meet the people who live nearby.";
const MAX_NAME_CHARS: usize = 40;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct LinkedAvatarsConfig {
    pub(crate) schema_version: u32,
    pub(crate) sources: Vec<LinkedAvatarSource>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct LinkedAvatarSource {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) collections: Vec<String>,
    #[serde(default)]
    pub(crate) assets: Vec<String>,
    pub(crate) arrival_location: String,
    #[serde(default)]
    pub(crate) goal: Option<String>,
}

impl LinkedAvatarSource {
    fn admits(&self, asset: &helius::OwnedAsset) -> bool {
        self.assets.iter().any(|id| id == &asset.id)
            || asset
                .collection
                .as_deref()
                .is_some_and(|collection| self.collections.iter().any(|c| c == collection))
    }

    pub(crate) fn arrival_location_id(&self) -> Option<u64> {
        self.arrival_location.rsplit('/').next()?.parse().ok()
    }
}

fn is_solana_address(text: &str) -> bool {
    bs58::decode(text)
        .into_vec()
        .is_ok_and(|bytes| bytes.len() == 32)
}

/// Check a world's `linked_avatars` block against its locations.
pub(crate) fn validate_linked_avatars(
    config: &LinkedAvatarsConfig,
    location_exists: impl Fn(u64) -> bool,
) -> Result<(), String> {
    if config.schema_version != 1 {
        return Err("linked_avatars schema_version must be 1".to_string());
    }
    if config.sources.is_empty() {
        return Err("linked_avatars must list at least one source".to_string());
    }
    let mut ids = BTreeSet::new();
    for source in &config.sources {
        let id_ok = (1..=32).contains(&source.id.len())
            && source
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !id_ok || !ids.insert(source.id.as_str()) {
            return Err(format!(
                "linked_avatars source id {:?} is invalid or repeated",
                source.id
            ));
        }
        if source.name.trim().is_empty() || source.name.chars().count() > MAX_NAME_CHARS {
            return Err(format!(
                "linked_avatars source {} needs a short name",
                source.id
            ));
        }
        if source.collections.is_empty() && source.assets.is_empty() {
            return Err(format!(
                "linked_avatars source {} admits nothing",
                source.id
            ));
        }
        if let Some(bad) = source
            .collections
            .iter()
            .chain(&source.assets)
            .find(|address| !is_solana_address(address))
        {
            return Err(format!(
                "linked_avatars source {} has an invalid address {bad}",
                source.id
            ));
        }
        if !source.arrival_location_id().is_some_and(&location_exists) {
            return Err(format!(
                "linked_avatars source {} arrives at unknown location {}",
                source.id, source.arrival_location
            ));
        }
    }
    Ok(())
}

pub(crate) fn linked_avatar_receipt_id(asset_id: &str) -> String {
    format!("{LINKED_AVATAR_RECEIPT_PREFIX}{asset_id}")
}

/// A display name from metadata, if it is plain enough to use; metadata is
/// cosmetic and never reaches prompts beyond the actor's name.
fn cosmetic_name(name: Option<&str>) -> Option<String> {
    let name = name?.split_whitespace().collect::<Vec<_>>().join(" ");
    let ok = !name.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && name.chars().all(|c| !c.is_control());
    ok.then_some(name)
}

fn fallback_name(source: &LinkedAvatarSource, asset_id: &str) -> String {
    format!("{} {}", source.name, asset_id.get(..6).unwrap_or(asset_id))
}

/// The Project 89 pilot Proxim8 is seeded as Callum Synclaire in worlds that
/// carry him; there his asset already has its actor.
const PILOT_ACTOR_ID: u64 = 8961;
const PILOT_ACTOR_NAME: &str = "Callum Synclaire";

/// True when `asset_id` already has an actor, through either path.
fn already_joined(runtime: &RuntimeWorld, asset_id: &str) -> bool {
    runtime
        .materialization_receipts
        .contains_key(&linked_avatar_receipt_id(asset_id))
        || runtime
            .materialization_receipts
            .contains_key(&proxim8_receipt_id(asset_id))
        || (asset_id == PROXIM8_PILOT_ASSET_ID
            && runtime
                .actors
                .get(&PILOT_ACTOR_ID)
                .is_some_and(|meta| meta.name == PILOT_ACTOR_NAME))
}

/// The journal record that brings `asset` into the world, or None when it
/// already joined, the world is full, or the arrival place is missing.
pub(crate) fn linked_avatar_record(
    runtime: &RuntimeWorld,
    wallet_address: &str,
    asset: &helius::OwnedAsset,
    source: &LinkedAvatarSource,
) -> Option<JournalRecord> {
    let location_id = source.arrival_location_id()?;
    if already_joined(runtime, &asset.id)
        || wallet_address.trim().is_empty()
        || runtime.world.actor_count >= CW_MAX_ACTORS
        || runtime.world.item_count >= CW_MAX_ITEMS
        || !runtime.world.locations[..runtime.world.location_count]
            .iter()
            .any(|location| location.id == location_id)
    {
        return None;
    }
    let receipt_id = linked_avatar_receipt_id(&asset.id);
    let actor_id = runtime.next_actor_id;
    let item_id = materialized_item_id(&format!("{receipt_id}:memory"));
    if runtime.actor_by_id(actor_id).is_some() || runtime.item_by_id(item_id).is_some() {
        return None;
    }
    let name =
        cosmetic_name(asset.name.as_deref()).unwrap_or_else(|| fallback_name(source, &asset.id));
    let goal = source
        .goal
        .clone()
        .unwrap_or_else(|| DEFAULT_GOAL.to_string());
    let receipt = MaterializationReceiptState {
        id: receipt_id,
        actor_id,
        card_id: asset.id.clone(),
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
        name: format!("Continuity seed · {name}"),
        description: format!(
            "Records that {name} arrived from {} asset {} ({}).",
            source.name, asset.id, asset.interface
        ),
        skill_id: None,
        skill_bonus: 0,
        mechanics: None,
    };
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id,
            location_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.origin = JournalOrigin::System;
    record.initial_calling = Some(goal.clone());
    record.actor_meta_upserts.insert(
        actor_id,
        ActorMeta {
            name: name.clone(),
            speech_mode: "prose".to_string(),
            title: format!("Linked {}", source.name),
            description: format!(
                "{name} arrived after its holder linked a verified wallet. The same asset always returns as this same character."
            ),
        },
    );
    record
        .projection_mutations
        .push(ProjectionMutation::MaterializeProxim8Actor {
            receipt,
            memory_item,
            memory_meta,
            collection_address: asset.collection.clone().unwrap_or_default(),
            goal,
        });
    Some(record)
}

/// Replay-safe preconditions for a linked-avatar record: facts in the record
/// and the current world, never the worldpack.
pub(crate) fn linked_avatar_record_preconditions_hold(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
    receipt: &MaterializationReceiptState,
    memory_item: &CwItem,
) -> bool {
    receipt.id == linked_avatar_receipt_id(&receipt.card_id)
        && !receipt.card_id.is_empty()
        && receipt.actor_id == record.action.actor_id
        && receipt.item_id == memory_item.id
        && receipt.status == "materialized"
        && receipt
            .source_wallet
            .as_deref()
            .is_some_and(|wallet| !wallet.trim().is_empty())
        && record.action.location_id != 0
        && memory_item.holder_actor_id == receipt.actor_id
        && memory_item.kind == CW_ITEM_KEEPSAKE
        && memory_item.role == CW_ITEM_ROLE_RELIC
        && runtime.actor_by_id(receipt.actor_id).is_none()
        && runtime.item_by_id(receipt.item_id).is_none()
        && !already_joined(runtime, &receipt.card_id)
        && runtime.world.actor_count < CW_MAX_ACTORS
        && runtime.world.item_count < CW_MAX_ITEMS
}

/// A linked avatar's receipt: kept out of the item-materialization
/// retirement. Control mode is not checked, so selecting the avatar later
/// cannot turn its receipt into a retirable item receipt.
pub(crate) fn is_linked_avatar_receipt(
    runtime: &RuntimeWorld,
    receipt: &MaterializationReceiptState,
) -> bool {
    receipt.id == linked_avatar_receipt_id(&receipt.card_id)
        && receipt.status == "materialized"
        && receipt
            .source_wallet
            .as_deref()
            .is_some_and(|wallet| !wallet.trim().is_empty())
        && runtime.actor_by_id(receipt.actor_id).is_some()
        && runtime
            .item_by_id(receipt.item_id)
            .is_some_and(|item| item.kind == CW_ITEM_KEEPSAKE && item.role == CW_ITEM_ROLE_RELIC)
        && runtime
            .item_provenance
            .get(&receipt.item_id)
            .is_some_and(|provenance| {
                provenance.origin == format!("collection:{}", receipt.card_id)
            })
}

/// Assets the trusted ownership feed lists for `wallet`, for worlds without
/// Helius configured.
fn feed_assets(ownership: &OwnershipIndex, wallet: &str) -> Vec<helius::OwnedAsset> {
    ownership
        .cards_for_wallet(wallet)
        .into_iter()
        .filter_map(|key| {
            let rest = key.strip_prefix("collection:")?;
            let (collection, asset) = rest.split_once(':')?;
            Some(helius::OwnedAsset {
                id: asset.to_string(),
                collection: Some(collection.to_string()),
                interface: "feed".to_string(),
                name: None,
            })
        })
        .collect()
}

/// Pair each held asset with the first source that admits it.
pub(crate) fn admitted_assets(
    config: &LinkedAvatarsConfig,
    assets: Vec<helius::OwnedAsset>,
) -> Vec<(helius::OwnedAsset, &LinkedAvatarSource)> {
    let mut seen = BTreeSet::new();
    assets
        .into_iter()
        .filter_map(|asset| {
            let source = config.sources.iter().find(|source| source.admits(&asset))?;
            seen.insert(asset.id.clone()).then_some((asset, source))
        })
        .collect()
}

/// Give every admitted asset `wallet` holds its one actor. Safe to call on
/// every link and sign-in: assets that already joined are skipped.
pub(crate) async fn materialize_wallet_linked_avatars(
    state: &AppState,
    wallet_address: &str,
) -> Vec<EventView> {
    let Some(config) = active_content().manifest.linked_avatars.clone() else {
        return Vec::new();
    };
    let assets = match helius::helius_rpc_url() {
        Some(url) => match helius::fetch_owned_assets(&url, wallet_address).await {
            Ok(assets) => assets,
            Err(error) => {
                warn!("linked-avatar discovery failed for {wallet_address}: {error}");
                return Vec::new();
            }
        },
        None => feed_assets(&state.ownership_snapshot().await, wallet_address),
    };
    let admitted = admitted_assets(&config, assets);
    if admitted.is_empty() {
        return Vec::new();
    }
    let mut runtime = state.inner.lock().await;
    let mut committed_events = Vec::new();
    for (asset, source) in admitted {
        let Some(record) = linked_avatar_record(&runtime, wallet_address, &asset, source) else {
            continue;
        };
        match commit_journal_record(state, &mut runtime, record) {
            Ok((CW_OK, events)) => {
                info!(
                    "linked avatar joined: source={} asset={} interface={}",
                    source.id, asset.id, asset.interface
                );
                committed_events.extend(events);
            }
            Ok(_) => warn!(
                "linked-avatar materialization was rejected for {}",
                asset.id
            ),
            Err(error) => {
                warn!(
                    "linked-avatar materialization failed for {}: {error}",
                    asset.id
                );
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

    const WALLET: &str = "DcXxMstZHwnEMjLTF1Aa2kHB95NBif77nPUEZqD4ZTue";
    const PROXIM8: &str = "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf";
    const LISTED: &str = "Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo";

    #[test]
    fn the_official_world_admits_proxim8s_at_its_entry() {
        let config = active_content()
            .manifest
            .linked_avatars
            .clone()
            .expect("official world declares linked avatars");
        let source = config
            .sources
            .iter()
            .find(|source| source.id == "proxim8")
            .expect("Proxim8 source");
        assert_eq!(source.collections, [PROXIM8]);
        assert_eq!(
            source.arrival_location_id(),
            content_registry().entry_location_id()
        );
        let rati = config
            .sources
            .iter()
            .find(|source| source.id == "rati-avatars")
            .expect("RATi Avatar source");
        assert!(
            rati.assets
                .iter()
                .any(|asset| asset == "EM3tciRcUa8VeupDDdKBfZVH484LDRhqRpCZ8YsAGVGA"),
            "Santa Pooz is admitted"
        );
    }

    fn config(arrival: u64) -> LinkedAvatarsConfig {
        serde_json::from_value(serde_json::json!({
            "schema_version": 1,
            "sources": [
                {"id": "proxim8", "name": "Proxim8", "collections": [PROXIM8],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")},
                {"id": "chosen", "name": "Chosen", "assets": ["8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd"],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")}
            ]
        }))
        .unwrap()
    }

    fn asset(id: &str, collection: Option<&str>, name: Option<&str>) -> helius::OwnedAsset {
        helius::OwnedAsset {
            id: id.to_string(),
            collection: collection.map(str::to_string),
            interface: "MplCoreAsset".to_string(),
            name: name.map(str::to_string),
        }
    }

    #[test]
    fn sources_admit_by_collection_or_listed_asset() {
        let config = config(1);
        let admitted = admitted_assets(
            &config,
            vec![
                asset(
                    "CoreAsset11111111111111111111111111111111111",
                    Some(PROXIM8),
                    None,
                ),
                asset("8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd", None, None),
                asset(
                    "Stranger111111111111111111111111111111111111",
                    Some(LISTED),
                    None,
                ),
            ],
        );
        let pairs: Vec<_> = admitted
            .iter()
            .map(|(a, s)| (a.id.as_str(), s.id.as_str()))
            .collect();
        assert_eq!(
            pairs,
            [
                ("CoreAsset11111111111111111111111111111111111", "proxim8"),
                ("8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd", "chosen"),
            ]
        );
    }

    #[test]
    fn world_config_is_validated() {
        assert!(validate_linked_avatars(&config(1), |id| id == 1).is_ok());
        assert!(
            validate_linked_avatars(&config(9), |id| id == 1).is_err(),
            "unknown arrival"
        );
        let mut bad = config(1);
        bad.sources[0].collections = vec!["not-an-address".to_string()];
        assert!(validate_linked_avatars(&bad, |_| true).is_err());
        let mut empty = config(1);
        empty.sources[1].assets.clear();
        assert!(
            validate_linked_avatars(&empty, |_| true).is_err(),
            "a source must admit something"
        );
        let mut repeated = config(1);
        repeated.sources[1].id = "proxim8".to_string();
        assert!(validate_linked_avatars(&repeated, |_| true).is_err());
    }

    #[test]
    fn a_linked_asset_joins_exactly_once_and_survives_replay_and_retirement() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(8901, 0);
        let config = config(8901);
        let held = asset(
            "CoreAsset11111111111111111111111111111111111",
            Some(PROXIM8),
            Some("  Agent\tNova  "),
        );
        let record =
            linked_avatar_record(&runtime, WALLET, &held, &config.sources[0]).expect("first link");
        let actor_id = record.action.actor_id;
        assert_eq!(record.action.location_id, 8901);
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "actor.materialized"));
        assert_eq!(runtime.actors.get(&actor_id).unwrap().name, "Agent Nova");
        assert_eq!(
            runtime.actor_control_mode(actor_id),
            ActorControlMode::LocalAi
        );

        // The same asset never joins twice, even from another wallet.
        assert!(linked_avatar_record(&runtime, "OtherWallet", &held, &config.sources[0]).is_none());
        let (again, _) = runtime.apply_journal_record(&record);
        assert_ne!(
            again, CW_OK,
            "replaying the same record cannot duplicate the actor"
        );

        // The item-materialization retirement leaves it alone.
        let inventory = materialization_retirement::receipt_inventory(&runtime);
        assert_eq!(inventory.total, 0);
        assert_eq!(inventory.retained_actor_materialization, 1);
        materialization_retirement::migrate_legacy_receipts(&mut runtime).expect("migration");
        assert!(runtime.item_materialization_migrations.is_empty());
        assert!(runtime.actor_by_id(actor_id).is_some());

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores");
        assert!(restored.actor_by_id(actor_id).is_some());
        assert!(linked_avatar_record(&restored, WALLET, &held, &config.sources[0]).is_none());
    }

    #[test]
    fn the_pilot_proxim8_joins_only_worlds_without_callum() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(8901, 0);
        let config = config(8901);
        let pilot = asset(PROXIM8_PILOT_ASSET_ID, Some(PROXIM8), None);
        assert!(
            linked_avatar_record(&runtime, WALLET, &pilot, &config.sources[0]).is_some(),
            "a world without Callum lets his holder join"
        );
        runtime.actors.insert(
            PILOT_ACTOR_ID,
            ActorMeta {
                name: PILOT_ACTOR_NAME.to_string(),
                speech_mode: "prose".to_string(),
                title: String::new(),
                description: String::new(),
            },
        );
        assert!(
            linked_avatar_record(&runtime, WALLET, &pilot, &config.sources[0]).is_none(),
            "where Callum is seeded, his asset already has its actor"
        );
    }

    #[test]
    fn metadata_names_are_cosmetic_and_bounded() {
        assert_eq!(
            cosmetic_name(Some(" Proxim8   #12 ")).as_deref(),
            Some("Proxim8 #12")
        );
        assert_eq!(cosmetic_name(Some("")), None);
        assert_eq!(cosmetic_name(Some(&"x".repeat(41))), None);
        assert_eq!(cosmetic_name(Some("bad\u{7}bell")), None);
        let source = &config(1).sources[0];
        assert_eq!(fallback_name(source, "CoreAsset111"), "Proxim8 CoreAs");
    }
}
