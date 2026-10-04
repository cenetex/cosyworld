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
    /// Copies of one character: any listed asset recovers the same actor.
    #[serde(default)]
    pub(crate) characters: Vec<LinkedAvatarCharacter>,
    pub(crate) arrival_location: String,
    #[serde(default)]
    pub(crate) goal: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct LinkedAvatarCharacter {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) assets: Vec<String>,
    /// Lives in the world from boot, whether or not a holder has linked.
    #[serde(default)]
    pub(crate) permanent: bool,
    /// Where this character lives; defaults to the source's arrival.
    #[serde(default)]
    pub(crate) home_location: Option<String>,
    /// Authored bio; NFT metadata never authors the actor's description.
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) personality: Option<String>,
    /// Reviewed artwork for this shared character.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) image_url: Option<String>,
}

const MAX_BIO_CHARS: usize = 400;

impl LinkedAvatarCharacter {
    fn home_location_id(&self, source: &LinkedAvatarSource) -> Option<u64> {
        match self.home_location.as_deref() {
            Some(reference) => reference.rsplit('/').next()?.parse().ok(),
            None => source.arrival_location_id(),
        }
    }

    fn actor_description(&self) -> Option<String> {
        let parts: Vec<&str> = [self.description.as_deref(), self.personality.as_deref()]
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect();
        (!parts.is_empty()).then(|| parts.join(" "))
    }
}

/// What an admitted asset joins as: its own actor, or a shared character.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Admission {
    /// Exactly one actor exists per key: the asset id, or
    /// `character:<source>/<character>`.
    pub(crate) key: String,
    pub(crate) character: Option<LinkedAvatarCharacter>,
}

fn character_key(source: &LinkedAvatarSource, character: &LinkedAvatarCharacter) -> String {
    format!("character:{}/{}", source.id, character.id)
}

fn valid_slug(id: &str) -> bool {
    (1..=32).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl LinkedAvatarSource {
    fn admits(&self, asset: &helius::OwnedAsset) -> Option<Admission> {
        if let Some(character) = self
            .characters
            .iter()
            .find(|character| character.assets.iter().any(|id| id == &asset.id))
        {
            return Some(Admission {
                key: character_key(self, character),
                character: Some(character.clone()),
            });
        }
        let direct = self.assets.iter().any(|id| id == &asset.id)
            || asset
                .collection
                .as_deref()
                .is_some_and(|collection| self.collections.iter().any(|c| c == collection));
        direct.then(|| Admission {
            key: asset.id.clone(),
            character: None,
        })
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
        if !valid_slug(&source.id) || !ids.insert(source.id.as_str()) {
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
        if source.collections.is_empty() && source.assets.is_empty() && source.characters.is_empty()
        {
            return Err(format!(
                "linked_avatars source {} admits nothing",
                source.id
            ));
        }
        let mut character_ids = BTreeSet::new();
        let mut listed = BTreeSet::new();
        for character in &source.characters {
            if !valid_slug(&character.id)
                || !character_ids.insert(character.id.as_str())
                || character.name.trim().is_empty()
                || character.name.chars().count() > MAX_NAME_CHARS
                || character.assets.is_empty()
                || !character
                    .home_location_id(source)
                    .is_some_and(&location_exists)
                || character
                    .image_url
                    .as_deref()
                    .is_some_and(|url| !valid_character_image_url(url))
                || [&character.description, &character.personality]
                    .into_iter()
                    .flatten()
                    .any(|text| {
                        text.trim().is_empty()
                            || text.chars().count() > MAX_BIO_CHARS
                            || text.chars().any(char::is_control)
                    })
            {
                return Err(format!(
                    "linked_avatars source {} has an invalid character {:?}",
                    source.id, character.id
                ));
            }
        }
        for asset in source
            .assets
            .iter()
            .chain(source.characters.iter().flat_map(|c| &c.assets))
        {
            if !listed.insert(asset.as_str()) {
                return Err(format!(
                    "linked_avatars source {} lists asset {asset} twice",
                    source.id
                ));
            }
        }
        if let Some(bad) = source
            .collections
            .iter()
            .chain(&source.assets)
            .chain(source.characters.iter().flat_map(|c| &c.assets))
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

fn valid_character_image_url(value: &str) -> bool {
    value.len() <= 2048
        && value.trim() == value
        && !value.chars().any(char::is_control)
        && reqwest::Url::parse(value).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
        })
}

impl RuntimeWorld {
    pub(crate) fn decorate_linked_avatar_card(
        &self,
        mut card: CardView,
        actor_id: u64,
    ) -> CardView {
        let Some(config) = active_content().manifest.linked_avatars.as_ref() else {
            return card;
        };
        let character = self.materialization_receipts.values().find_map(|receipt| {
            if receipt.actor_id != actor_id || !is_linked_avatar_receipt(self, receipt) {
                return None;
            }
            config.sources.iter().find_map(|source| {
                source
                    .characters
                    .iter()
                    .find(|character| receipt.card_id == character_key(source, character))
            })
        });
        if let Some(image_url) = character.and_then(|character| character.image_url.as_ref()) {
            card.image_url = Some(image_url.clone());
            card.asset_status = "seed_art".to_string();
        }
        card
    }
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

/// Everything that decides one linked actor's journal record.
struct JoinSpec {
    key: String,
    name: String,
    title: String,
    location_id: u64,
    description: String,
    goal: String,
    /// The wallet whose link brought it, or None for a permanent resident.
    wallet: Option<String>,
    origin: String,
    collection_address: String,
}

fn actor_record(runtime: &RuntimeWorld, spec: JoinSpec) -> Option<JournalRecord> {
    if already_joined(runtime, &spec.key)
        || runtime.world.actor_count >= CW_MAX_ACTORS
        || runtime.world.item_count >= CW_MAX_ITEMS
        || !runtime.world.locations[..runtime.world.location_count]
            .iter()
            .any(|location| location.id == spec.location_id)
    {
        return None;
    }
    let receipt_id = linked_avatar_receipt_id(&spec.key);
    let actor_id = runtime.next_actor_id;
    let item_id = materialized_item_id(&format!("{receipt_id}:memory"));
    if runtime.actor_by_id(actor_id).is_some() || runtime.item_by_id(item_id).is_some() {
        return None;
    }
    let name = spec.name;
    let receipt = MaterializationReceiptState {
        id: receipt_id,
        actor_id,
        card_id: spec.key,
        item_id,
        status: "materialized".to_string(),
        source_wallet: spec.wallet,
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
        description: format!("Records that {name} {}.", spec.origin),
        skill_id: None,
        skill_bonus: 0,
        mechanics: None,
    };
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id,
            location_id: spec.location_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.origin = JournalOrigin::System;
    record.initial_calling = Some(spec.goal.clone());
    record.actor_meta_upserts.insert(
        actor_id,
        ActorMeta {
            name,
            speech_mode: "prose".to_string(),
            title: spec.title,
            description: spec.description,
        },
    );
    record
        .projection_mutations
        .push(ProjectionMutation::MaterializeProxim8Actor {
            receipt,
            memory_item,
            memory_meta,
            collection_address: spec.collection_address,
            goal: spec.goal,
        });
    Some(record)
}

fn source_goal(source: &LinkedAvatarSource) -> String {
    source
        .goal
        .clone()
        .unwrap_or_else(|| DEFAULT_GOAL.to_string())
}

/// The journal record that brings `asset` into the world, or None when it
/// already joined, the world is full, or the arrival place is missing.
pub(crate) fn linked_avatar_record(
    runtime: &RuntimeWorld,
    wallet_address: &str,
    asset: &helius::OwnedAsset,
    source: &LinkedAvatarSource,
    admission: &Admission,
) -> Option<JournalRecord> {
    if wallet_address.trim().is_empty() || already_joined(runtime, &asset.id) {
        return None;
    }
    let character = admission.character.as_ref();
    let name = match character {
        Some(character) => character.name.clone(),
        None => {
            cosmetic_name(asset.name.as_deref()).unwrap_or_else(|| fallback_name(source, &asset.id))
        }
    };
    let description = character
        .and_then(LinkedAvatarCharacter::actor_description)
        .unwrap_or_else(|| {
            format!(
                "{name} arrived after its holder linked a verified wallet. The same NFT, or any copy of this character, always returns as this same actor."
            )
        });
    actor_record(
        runtime,
        JoinSpec {
            key: admission.key.clone(),
            location_id: match character {
                Some(character) => character.home_location_id(source)?,
                None => source.arrival_location_id()?,
            },
            title: format!("Linked {}", source.name),
            description,
            goal: source_goal(source),
            wallet: Some(wallet_address.to_string()),
            origin: format!(
                "arrived from {} asset {} ({})",
                source.name, asset.id, asset.interface
            ),
            collection_address: asset.collection.clone().unwrap_or_default(),
            name,
        },
    )
}

/// The record that seeds a permanent character with no wallet, or None when
/// it already lives in the world.
pub(crate) fn permanent_character_record(
    runtime: &RuntimeWorld,
    source: &LinkedAvatarSource,
    character: &LinkedAvatarCharacter,
) -> Option<JournalRecord> {
    if !character.permanent {
        return None;
    }
    actor_record(
        runtime,
        JoinSpec {
            key: character_key(source, character),
            name: character.name.clone(),
            title: source.name.clone(),
            location_id: character.home_location_id(source)?,
            description: character.actor_description().unwrap_or_else(|| {
                format!(
                    "{} lives here as one of the {} characters.",
                    character.name, source.name
                )
            }),
            goal: source_goal(source),
            wallet: None,
            origin: format!("is a permanent {} resident", source.name),
            collection_address: String::new(),
        },
    )
}

/// Seed every permanent character the active world declares and does not yet
/// hold. Runs at boot, before background services; each character joins
/// exactly once, through the journal.
pub(crate) async fn seed_permanent_characters(state: &AppState) {
    let Some(config) = active_content().manifest.linked_avatars.clone() else {
        return;
    };
    let mut runtime = state.inner.lock().await;
    let mut committed_events = Vec::new();
    for source in &config.sources {
        for character in &source.characters {
            let Some(record) = permanent_character_record(&runtime, source, character) else {
                continue;
            };
            match commit_journal_record(state, &mut runtime, record) {
                Ok((CW_OK, events)) => {
                    info!(
                        "permanent linked avatar seeded: source={} character={}",
                        source.id, character.id
                    );
                    committed_events.extend(events);
                }
                Ok(_) => warn!("permanent character {} was rejected", character.id),
                Err(error) => {
                    warn!("permanent character {} failed: {error}", character.id);
                    break;
                }
            }
        }
    }
    drop(runtime);
    if !committed_events.is_empty() {
        broadcast_events(state, &committed_events);
    }
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
            .is_none_or(|wallet| !wallet.trim().is_empty())
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
            .is_none_or(|wallet| !wallet.trim().is_empty())
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

/// Pair each held asset with the first source that admits it, once per
/// actor: several copies of one character in a wallet join once.
pub(crate) fn admitted_assets(
    config: &LinkedAvatarsConfig,
    assets: Vec<helius::OwnedAsset>,
) -> Vec<(helius::OwnedAsset, &LinkedAvatarSource, Admission)> {
    let mut seen = BTreeSet::new();
    assets
        .into_iter()
        .filter_map(|asset| {
            let (source, admission) = config
                .sources
                .iter()
                .find_map(|source| source.admits(&asset).map(|admission| (source, admission)))?;
            seen.insert(admission.key.clone())
                .then_some((asset, source, admission))
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
    for (asset, source, admission) in admitted {
        let Some(record) =
            linked_avatar_record(&runtime, wallet_address, &asset, source, &admission)
        else {
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
    const POOZ_A: &str = "EM3tciRcUa8VeupDDdKBfZVH484LDRhqRpCZ8YsAGVGA";
    const POOZ_B: &str = "EPzcJWBhPJJzwzEvNv5JXfhQ7cYaXDWFx9h16nHwzmpc";
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
        let pooz = rati
            .characters
            .iter()
            .find(|character| character.id == "santa-pooz")
            .expect("Santa Pooz");
        assert_eq!(pooz.name, "Santa Pooz");
        assert!(
            pooz.assets
                .iter()
                .any(|asset| asset == "EM3tciRcUa8VeupDDdKBfZVH484LDRhqRpCZ8YsAGVGA"),
            "the launch wallet's Santa Pooz is one of the copies"
        );
        assert_eq!(rati.characters.len(), 38);
        let link_only: Vec<_> = rati
            .characters
            .iter()
            .filter(|character| !character.permanent)
            .map(|character| character.id.as_str())
            .collect();
        assert_eq!(
            link_only,
            [
                "dobby-the-disturbing",
                "duderino-the-dude-jackson",
                "finn-mertens",
                "norva-the-waveshield",
                "potter-haruhiro",
                "vi-the-enforcer"
            ],
            "franchise characters join only when a holder links"
        );
    }

    fn config(arrival: u64) -> LinkedAvatarsConfig {
        serde_json::from_value(serde_json::json!({
            "schema_version": 1,
            "sources": [
                {"id": "proxim8", "name": "Proxim8", "collections": [PROXIM8],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")},
                {"id": "chosen", "name": "Chosen", "assets": ["8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd"],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")},
                {"id": "rati-avatars", "name": "RATi Avatar",
                 "characters": [{"id": "santa-pooz", "name": "Santa Pooz",
                                 "assets": [POOZ_A, POOZ_B]}],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")}
            ]
        }))
        .unwrap()
    }

    fn record_for(
        runtime: &RuntimeWorld,
        wallet: &str,
        asset: &helius::OwnedAsset,
        source: &LinkedAvatarSource,
    ) -> Option<JournalRecord> {
        let admission = source.admits(asset)?;
        linked_avatar_record(runtime, wallet, asset, source, &admission)
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
            .map(|(a, s, _)| (a.id.as_str(), s.id.as_str()))
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
        let record = record_for(&runtime, WALLET, &held, &config.sources[0]).expect("first link");
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
        assert!(record_for(&runtime, "OtherWallet", &held, &config.sources[0]).is_none());
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
        assert!(record_for(&restored, WALLET, &held, &config.sources[0]).is_none());
    }

    #[test]
    fn the_pilot_proxim8_joins_only_worlds_without_callum() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(8901, 0);
        let config = config(8901);
        let pilot = asset(PROXIM8_PILOT_ASSET_ID, Some(PROXIM8), None);
        assert!(
            record_for(&runtime, WALLET, &pilot, &config.sources[0]).is_some(),
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
            record_for(&runtime, WALLET, &pilot, &config.sources[0]).is_none(),
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

    #[test]
    fn copies_of_a_character_share_one_actor() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(8901, 0);
        let config = config(8901);
        // Two copies in one wallet join once.
        let admitted = admitted_assets(
            &config,
            vec![
                asset(POOZ_A, None, Some("Santa Pooz")),
                asset(POOZ_B, None, Some("Santa Pooz")),
            ],
        );
        assert_eq!(admitted.len(), 1);
        assert_eq!(admitted[0].2.key, "character:rati-avatars/santa-pooz");
        let source = &config.sources[2];
        let record = record_for(
            &runtime,
            WALLET,
            &asset(POOZ_A, None, Some("Pooz!!")),
            source,
        )
        .expect("first copy joins");
        let actor_id = record.action.actor_id;
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert_eq!(
            runtime.actors.get(&actor_id).unwrap().name,
            "Santa Pooz",
            "the character name comes from the world, not the NFT"
        );
        // Another copy, from another wallet, is the same character.
        assert!(record_for(&runtime, "OtherWallet", &asset(POOZ_B, None, None), source).is_none());
        assert!(
            materialization_retirement::receipt_inventory(&runtime).retained_actor_materialization
                == 1
        );
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores");
        assert!(record_for(&restored, WALLET, &asset(POOZ_B, None, None), source).is_none());
    }

    #[test]
    fn character_lists_are_validated() {
        let mut twice = config(1);
        twice.sources[2].assets = vec![POOZ_A.to_string()];
        assert!(
            validate_linked_avatars(&twice, |_| true).is_err(),
            "an asset in two places"
        );
        let mut empty = config(1);
        empty.sources[2].characters[0].assets.clear();
        assert!(
            validate_linked_avatars(&empty, |_| true).is_err(),
            "a character with no assets"
        );
        let mut bad = config(1);
        bad.sources[2].characters[0].id = "Santa Pooz".to_string();
        assert!(
            validate_linked_avatars(&bad, |_| true).is_err(),
            "character ids are slugs"
        );
    }

    #[test]
    fn a_permanent_character_lives_in_the_world_once_without_a_wallet() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(8901, 0);
        runtime.ensure_location(8902, 0);
        let mut config = config(8901);
        let source = &mut config.sources[2];
        source.characters[0].permanent = true;
        source.characters[0].home_location = Some("cosyworld.core:location/8902".to_string());
        source.characters[0].description = Some("A round figure in a red suit.".to_string());
        source.characters[0].personality = Some("Generous and easily distracted.".to_string());
        let source = &config.sources[2];
        let character = &source.characters[0];

        let record = permanent_character_record(&runtime, source, character).expect("seeded");
        let actor_id = record.action.actor_id;
        assert_eq!(
            record.action.location_id, 8902,
            "a character lives at its home"
        );
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        let meta = runtime.actors.get(&actor_id).unwrap();
        assert_eq!(meta.name, "Santa Pooz");
        assert_eq!(
            meta.description,
            "A round figure in a red suit. Generous and easily distracted."
        );
        assert!(permanent_character_record(&runtime, source, character).is_none());

        // A holder linking any copy later recovers this same actor.
        assert!(record_for(&runtime, WALLET, &asset(POOZ_B, None, None), source).is_none());
        // The receipt has no wallet and still escapes the item retirement.
        let inventory = materialization_retirement::receipt_inventory(&runtime);
        assert_eq!(inventory.total, 0);
        assert_eq!(inventory.retained_actor_materialization, 1);
        materialization_retirement::migrate_legacy_receipts(&mut runtime).expect("migration");
        assert!(runtime.actor_by_id(actor_id).is_some());
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores");
        assert!(permanent_character_record(&restored, source, character).is_none());
    }

    #[test]
    fn only_permanent_characters_are_seeded() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.ensure_location(8901, 0);
        let config = config(8901);
        let source = &config.sources[2];
        assert!(permanent_character_record(&runtime, source, &source.characters[0]).is_none());
    }

    #[test]
    fn permanent_character_fields_are_validated() {
        let mut far = config(1);
        far.sources[2].characters[0].home_location = Some("cosyworld.core:location/77".to_string());
        assert!(
            validate_linked_avatars(&far, |id| id == 1).is_err(),
            "unknown home"
        );
        let mut long = config(1);
        long.sources[2].characters[0].description = Some("x".repeat(401));
        assert!(
            validate_linked_avatars(&long, |_| true).is_err(),
            "bio too long"
        );
        let mut blank = config(1);
        blank.sources[2].characters[0].personality = Some("  ".to_string());
        assert!(
            validate_linked_avatars(&blank, |_| true).is_err(),
            "blank bio"
        );
    }

    #[test]
    fn character_artwork_uses_a_plain_https_url() {
        let mut config = config(1);
        config.sources[2].characters[0].image_url =
            Some("https://arweave.net/portrait".to_string());
        assert!(validate_linked_avatars(&config, |_| true).is_ok());
        for url in [
            "http://arweave.net/portrait",
            "javascript:alert(1)",
            "https://user:secret@arweave.net/portrait",
            "https://arweave.net/portrait#fragment",
            " https://arweave.net/portrait",
            "https://arweave.net/por\ntrait",
        ] {
            config.sources[2].characters[0].image_url = Some(url.to_string());
            assert!(validate_linked_avatars(&config, |_| true).is_err(), "{url}");
        }
    }

    #[test]
    fn santa_pooz_card_uses_character_art_after_replay_and_snapshot_restore() {
        let config = active_content().manifest.linked_avatars.as_ref().unwrap();
        let source = config
            .sources
            .iter()
            .find(|source| source.id == "rati-avatars")
            .unwrap();
        let character = source
            .characters
            .iter()
            .find(|character| character.id == "santa-pooz")
            .unwrap();
        let expected = "https://arweave.net/dQ_Zh5Ifl7eCIiHKc7qhFI3sranmDZ4PY5F3YlzuEB8";
        assert_eq!(character.image_url.as_deref(), Some(expected));
        let mut runtime = RuntimeWorld::seeded();
        // Actor ids vary with the saved world's history.
        runtime.next_actor_id += 100;
        let record = permanent_character_record(&runtime, source, character).unwrap();
        let actor_id = record.action.actor_id;
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert!(record_for(&runtime, WALLET, &asset(POOZ_B, None, None), source).is_none());
        let initial = runtime.state_response(None, &AccessContext::default());
        assert_eq!(
            initial.cards.actors[&actor_id].image_url.as_deref(),
            Some(expected)
        );
        // Lonely Forest already has published level-one community art.
        runtime.community_art_generations.insert(
            crate::community_art::community_art_generation_key("actor", actor_id, 1),
            serde_json::from_value(serde_json::json!({
                "subject_kind": "actor",
                "subject_id": actor_id,
                "level": 1,
                "required_orbs": 1,
                "funded_orbs": 1,
                "status": "ready",
                "history_through_seq": 0,
                "revision": 3
            }))
            .unwrap(),
        );
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .unwrap();
        for world in [&runtime, &restored] {
            let response = world.state_response(None, &AccessContext::default());
            let card = &response.cards.actors[&actor_id];
            assert_eq!(card.image_url.as_deref(), Some(expected));
            assert_eq!(card.display_name, "Santa Pooz");
            assert_eq!(card.asset_status, "seed_art");
            assert_eq!(card.community_art.as_ref().unwrap().funded_orbs, 1);
            assert_eq!(
                response.cards.actors[&RATI_ACTOR_ID].image_url,
                initial.cards.actors[&RATI_ACTOR_ID].image_url
            );
        }
        // Artwork follows the saved receipt identity.
        let unrelated = card_for_actor(999_999, "Santa Pooz", "RATi Avatar", "", 1);
        let unrelated = runtime.decorate_community_art_card(unrelated, "actor", 999_999, None);
        assert_eq!(
            unrelated.image_url,
            Some(generated_avatar_image_url(999_999))
        );
    }

    #[test]
    fn all_permanent_rati_avatars_seed_into_the_official_world() {
        let config = active_content()
            .manifest
            .linked_avatars
            .clone()
            .expect("official linked avatars");
        let source = config
            .sources
            .iter()
            .find(|source| source.id == "rati-avatars")
            .expect("RATi source");
        let mut runtime = RuntimeWorld::seeded();
        let mut seeded = 0;
        for character in source.characters.iter().filter(|c| c.permanent) {
            let record = permanent_character_record(&runtime, source, character)
                .unwrap_or_else(|| panic!("{} has a home in the official world", character.id));
            let home = character.home_location_id(source).unwrap();
            assert_eq!(record.action.location_id, home);
            assert_eq!(
                runtime.apply_journal_record(&record).0,
                CW_OK,
                "{}",
                character.id
            );
            seeded += 1;
        }
        assert_eq!(seeded, 32);
        for character in &source.characters {
            assert!(permanent_character_record(&runtime, source, character).is_none());
        }
    }

    #[tokio::test]
    async fn boot_seeding_journals_each_permanent_character_once() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-permanent-avatars-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        let journal_rows = || -> i64 {
            open_event_store(&path)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM action_journal", [], |row| row.get(0))
                .unwrap()
        };
        let before = journal_rows();
        let actors_before = state.inner.lock().await.world.actor_count;

        seed_permanent_characters(&state).await;
        assert_eq!(
            journal_rows() - before,
            32,
            "one journal record per resident"
        );
        assert_eq!(
            state.inner.lock().await.world.actor_count - actors_before,
            32
        );

        // A restart runs the seeding again and adds nobody.
        seed_permanent_characters(&state).await;
        assert_eq!(journal_rows() - before, 32);
        assert_eq!(
            state.inner.lock().await.world.actor_count - actors_before,
            32
        );
        let _ = fs::remove_file(&path);
    }
}
