use super::*;

#[derive(Debug, Serialize)]
pub(super) struct AccountView {
    pub(super) wallet_address: Option<String>,
    pub(super) owned_cards: Vec<CardView>,
    pub(super) active_box_ids: Vec<String>,
    pub(super) unopened_pack_ids: Vec<String>,
    pub(super) recent_box_receipts: Vec<WoodenBoxReceiptView>,
    pub(super) recent_pack_openings: Vec<AvatarPackOpeningView>,
    pub(super) materialization_receipts: Vec<MaterializationReceiptState>,
}

#[derive(Debug, Serialize)]
pub(super) struct CardRegistryView {
    pub(super) actors: BTreeMap<u64, CardView>,
    pub(super) items: BTreeMap<u64, CardView>,
    pub(super) locations: BTreeMap<u64, CardView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CardRefView {
    pub(super) card_id: String,
    pub(super) kind: String,
    pub(super) subject_id: u64,
    pub(super) display_name: String,
}

#[derive(Debug, Serialize)]
pub(super) struct CardTransactionView {
    pub(super) subject: CardRefView,
    pub(super) predicate: String,
    pub(super) object: CardRefView,
    pub(super) location_id: Option<u64>,
    pub(super) observed: bool,
    pub(super) source_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CardView {
    pub(super) pack_id: Option<String>,
    pub(super) card_id: String,
    pub(super) display_name: String,
    pub(super) role: String,
    pub(super) rarity: String,
    pub(super) title: String,
    pub(super) blurb: String,
    pub(super) level: u8,
    pub(super) evolved: bool,
    pub(super) aspect: String,
    pub(super) source: String,
    pub(super) asset_status: String,
    pub(super) set_number: Option<String>,
    pub(super) profile_id: Option<String>,
    pub(super) subject: Option<String>,
    pub(super) biome: Option<String>,
    pub(super) terrain: Vec<String>,
    pub(super) image_url: Option<String>,
    pub(super) chain_image_uri: Option<String>,
    pub(super) requires_ownership: bool,
    pub(super) owned: bool,
    pub(super) accessible: bool,
    pub(super) access_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) community_art: Option<CommunityArtView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CommunityArtView {
    pub(super) level: u8,
    pub(super) required_orbs: i32,
    pub(super) funded_orbs: i32,
    pub(super) remaining_orbs: i32,
    pub(super) status: String,
    pub(super) history_through_seq: u64,
}

#[derive(Debug, Serialize)]
pub(super) struct AccessView {
    pub(super) mode: String,
    pub(super) shared_world: bool,
    pub(super) owner_wallet_address: Option<String>,
    pub(super) owned_card_ids: Vec<String>,
    pub(super) owned_box_ids: Vec<String>,
    pub(super) unopened_pack_ids: Vec<String>,
    pub(super) granted_entitlement_ids: Vec<String>,
    pub(super) accessible_card_ids: Vec<String>,
    pub(super) locked_card_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct PackOpenRequest {
    pub(super) wallet_session: Option<String>,
    pub(super) pack_id: String,
}

#[derive(Debug, Serialize)]
pub(super) struct PackOpenResponse {
    pub(super) ok: bool,
    pub(super) status: u16,
    pub(super) opening: Option<AvatarPackOpeningView>,
    pub(super) error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct AvatarPackOpeningView {
    pub(super) idempotency_key: String,
    pub(super) owner_wallet_address: String,
    pub(super) box_asset_address: Option<String>,
    pub(super) pack_id: String,
    pub(super) reveal_seed: String,
    pub(super) catalog_hash: String,
    pub(super) card_ids: Vec<String>,
    pub(super) provenance_json: String,
    pub(super) created_at_ms: u64,
}

pub(super) fn pack_id_for_box(box_asset_address: &str) -> String {
    format!(
        "cosy-pack-{}",
        stable_hash_hex(&["box-pack", box_asset_address])
    )
}

pub(super) fn pack_opening_idempotency_key(pack_id: &str) -> String {
    format!("pack-open:{pack_id}")
}

pub(super) fn avatar_pack_catalog() -> &'static [&'static str] {
    &[
        "rati",
        "cosy-whiskerwind",
        "cosy-skull",
        "lyra",
        "sami",
        "ravi",
        "indra",
        "captain-null",
    ]
}

pub(super) fn avatar_pack_catalog_hash() -> String {
    stable_hash_hex(&[
        "avatar-pack-catalog-v2-weighted",
        &avatar_pack_catalog().join("|"),
    ])
}

pub(super) fn reveal_seed_for_pack(
    owner_wallet_address: &str,
    pack_id: &str,
    box_asset_address: Option<&str>,
) -> String {
    stable_hash_hex(&[
        "avatar-pack-reveal-v2-weighted",
        owner_wallet_address,
        pack_id,
        box_asset_address.unwrap_or("external-pack"),
    ])
}

pub(super) fn avatar_pack_card_rarity(card_id: &str) -> &str {
    external_card_spec(card_id)
        .map(|card| card.rarity.as_str())
        .or_else(|| seed_card_rarity_for_card_id(card_id))
        .unwrap_or("common")
}

pub(super) fn seed_card_rarity_for_card_id(card_id: &str) -> Option<&'static str> {
    active_content()
        .cards
        .iter()
        .find(|card| card.card_id == card_id)
        .map(|card| card.rarity.as_str())
}

pub(super) fn avatar_pack_card_weight(card_id: &str) -> u64 {
    match avatar_pack_card_rarity(card_id)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "ultra-rare" | "ultra_rare" | "ultrarare" | "mythic" | "legendary" => 4,
        "super-rare" | "super_rare" | "superrare" => 10,
        "rare" => 25,
        "uncommon" => 40,
        _ => 60,
    }
}

pub(super) fn deterministic_pack_cards(
    reveal_seed: &str,
    already_owned: &BTreeSet<String>,
) -> Vec<String> {
    let catalog = avatar_pack_catalog();
    let count = 3.min(catalog.len());
    let mut cards = Vec::with_capacity(count);
    let mut nonce = 0_u64;
    while cards.len() < count {
        let mut candidates = catalog
            .iter()
            .copied()
            .filter(|card_id| !cards.iter().any(|chosen| chosen == card_id))
            .filter(|card_id| !already_owned.contains(*card_id))
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            candidates = catalog
                .iter()
                .copied()
                .filter(|card_id| !cards.iter().any(|chosen| chosen == card_id))
                .collect();
        }
        if candidates.is_empty() {
            break;
        }
        let total_weight = candidates
            .iter()
            .map(|card_id| avatar_pack_card_weight(card_id))
            .sum::<u64>()
            .max(1);
        let nonce_text = nonce.to_string();
        let mut roll =
            stable_hash_u64(&["weighted-avatar-pack", reveal_seed, &nonce_text]) % total_weight;
        let mut selected = candidates[0];
        for card_id in candidates {
            let weight = avatar_pack_card_weight(card_id);
            if roll < weight {
                selected = card_id;
                break;
            }
            roll = roll.saturating_sub(weight);
        }
        cards.push(selected.to_string());
        nonce = nonce.saturating_add(1);
    }
    cards
}

impl RuntimeWorld {
    pub(super) fn normalize_card_zones(&mut self) {
        for item in &mut self.world.items[..self.world.item_count] {
            if item.zone == 0 {
                item.zone = if item.holder_actor_id != 0 {
                    if item.charges == 0
                        && matches!(item.role, CW_ITEM_ROLE_CONSUMABLE | CW_ITEM_ROLE_SPELL)
                    {
                        CW_CARD_ZONE_EXHAUSTED
                    } else {
                        CW_CARD_ZONE_CARRIED
                    }
                } else if item.location_id != 0 {
                    CW_CARD_ZONE_WORLD
                } else {
                    0
                };
            }
            if item.zone != CW_CARD_ZONE_CONTAINED {
                item.container_item_id = 0;
            }
        }
        for (actor_id, item_ids) in &self.equipped_charms {
            for item_id in item_ids {
                if let Some(item) = self.world.items[..self.world.item_count]
                    .iter_mut()
                    .find(|item| item.id == *item_id && item.holder_actor_id == *actor_id)
                {
                    item.zone = CW_CARD_ZONE_EQUIPPED;
                }
            }
        }
        for (actor_id, item_ids) in &self.prepared_spells {
            for item_id in item_ids {
                if let Some(item) = self.world.items[..self.world.item_count]
                    .iter_mut()
                    .find(|item| item.id == *item_id && item.holder_actor_id == *actor_id)
                {
                    item.zone = if item.charges == 0 {
                        CW_CARD_ZONE_EXHAUSTED
                    } else {
                        CW_CARD_ZONE_SPELL_DECK
                    };
                }
            }
        }
        for item in &self.world.items[..self.world.item_count] {
            self.item_provenance
                .entry(item.id)
                .or_insert_with(|| ItemProvenanceState {
                    item_id: item.id,
                    origin: "seed_pack".to_string(),
                    acquisition: if item.holder_actor_id != 0 {
                        "carried".to_string()
                    } else {
                        "world".to_string()
                    },
                    previous_holder_actor_id: None,
                    current_holder_actor_id: opt_id(item.holder_actor_id),
                    current_location_id: opt_id(item.location_id),
                    transfer_count: 0,
                    source_event_seq: None,
                    possession_journey: None,
                });
        }
    }

    pub(super) fn set_item_zone(&mut self, item_id: u64, zone: u8, container_item_id: u64) -> bool {
        unsafe {
            cw_world_set_item_zone(&mut self.world, item_id, zone, container_item_id) == CW_OK
        }
    }

    pub(super) fn reconcile_card_zones(&mut self) {
        let items = self.world.items[..self.world.item_count].to_vec();
        for item in &items {
            if item.zone != CW_CARD_ZONE_CONTAINED {
                continue;
            }
            let valid_container = items.iter().find(|candidate| {
                candidate.id == item.container_item_id
                    && candidate.role == CW_ITEM_ROLE_CONTAINER
                    && candidate.holder_actor_id == item.holder_actor_id
                    && candidate.zone != CW_CARD_ZONE_CONTAINED
            });
            if valid_container.is_none() {
                let zone = if item.charges == 0
                    && matches!(item.role, CW_ITEM_ROLE_CONSUMABLE | CW_ITEM_ROLE_SPELL)
                {
                    CW_CARD_ZONE_EXHAUSTED
                } else {
                    CW_CARD_ZONE_CARRIED
                };
                let _ = self.set_item_zone(item.id, zone, 0);
            }
        }
        self.equipped_charms.retain(|actor_id, item_ids| {
            item_ids.retain(|item_id| {
                items.iter().any(|item| {
                    item.id == *item_id
                        && item.holder_actor_id == *actor_id
                        && item.role == CW_ITEM_ROLE_SKILL_CHARM
                        && item.zone == CW_CARD_ZONE_EQUIPPED
                })
            });
            !item_ids.is_empty()
        });
        self.prepared_spells.retain(|actor_id, item_ids| {
            item_ids.retain(|item_id| {
                items.iter().any(|item| {
                    item.id == *item_id
                        && item.holder_actor_id == *actor_id
                        && item.role == CW_ITEM_ROLE_SPELL
                        && matches!(item.zone, CW_CARD_ZONE_SPELL_DECK | CW_CARD_ZONE_EXHAUSTED)
                })
            });
            !item_ids.is_empty()
        });
    }
}

impl RuntimeWorld {
    pub(super) fn card_registry_for(
        &self,
        location: &LocationView,
        actors: &[ActorView],
        items: &[ItemView],
        exits: &[ExitView],
        access: &AccessContext,
    ) -> CardRegistryView {
        let mut locations = BTreeMap::new();
        locations.insert(
            location.id,
            apply_location_access(
                self.decorate_community_art_card(
                    card_for_location(
                        location.id,
                        location.name.as_str(),
                        Some(&self.location_meta_for(location.id)),
                    ),
                    "location",
                    location.id,
                ),
                location.id,
                access,
            ),
        );
        for exit in exits {
            locations.insert(
                exit.destination_location_id,
                apply_location_access(
                    self.decorate_community_art_card(
                        card_for_location(
                            exit.destination_location_id,
                            exit.destination_location_name.as_str(),
                            Some(&self.location_meta_for(exit.destination_location_id)),
                        ),
                        "location",
                        exit.destination_location_id,
                    ),
                    exit.destination_location_id,
                    access,
                ),
            );
        }

        CardRegistryView {
            actors: actors
                .iter()
                .map(|actor| {
                    (
                        actor.id,
                        self.decorate_community_art_card(
                            card_for_actor(
                                actor.id,
                                actor.name.as_str(),
                                actor.title.as_str(),
                                actor.description.as_str(),
                                actor.stats.level,
                            ),
                            "actor",
                            actor.id,
                        ),
                    )
                })
                .collect(),
            items: items
                .iter()
                .map(|item| {
                    (
                        item.id,
                        self.decorate_community_art_card(
                            card_for_item(item.id, item.name.as_str(), item.description.as_str()),
                            "item",
                            item.id,
                        ),
                    )
                })
                .collect(),
            locations,
        }
    }

    pub(super) fn card_transaction_views(
        &self,
        location_id: u64,
        actors: &[ActorView],
        items: &[ItemView],
        exits: &[ExitView],
        cards: &CardRegistryView,
    ) -> Vec<CardTransactionView> {
        let mut transactions = Vec::new();
        let Some(location_card) = cards.locations.get(&location_id) else {
            return transactions;
        };
        let location_ref = card_ref_view("location", location_id, location_card);

        for exit in exits.iter().filter(|exit| exit.accessible && !exit.locked) {
            if let Some(destination_card) = cards.locations.get(&exit.destination_location_id) {
                transactions.push(card_transaction_view(
                    location_ref.clone(),
                    "connected_to",
                    card_ref_view("location", exit.destination_location_id, destination_card),
                    Some(location_id),
                ));
            }
        }

        for actor in actors
            .iter()
            .filter(|actor| actor.location_id == location_id)
        {
            if let Some(actor_card) = cards.actors.get(&actor.id) {
                transactions.push(card_transaction_view(
                    card_ref_view("actor", actor.id, actor_card),
                    "in",
                    location_ref.clone(),
                    Some(location_id),
                ));
            }
        }

        for item in items {
            if item.location_id == Some(location_id) {
                if let Some(item_card) = cards.items.get(&item.id) {
                    transactions.push(card_transaction_view(
                        card_ref_view("item", item.id, item_card),
                        "in",
                        location_ref.clone(),
                        Some(location_id),
                    ));
                }
            }
            let Some(holder_actor_id) = item.holder_actor_id else {
                continue;
            };
            if let (Some(actor_card), Some(item_card)) = (
                cards.actors.get(&holder_actor_id),
                cards.items.get(&item.id),
            ) {
                transactions.push(card_transaction_view(
                    card_ref_view("actor", holder_actor_id, actor_card),
                    "holds",
                    card_ref_view("item", item.id, item_card),
                    Some(location_id),
                ));
            }
        }

        transactions
    }
}

pub(super) fn non_empty_pack_id(pack_id: &str) -> Option<String> {
    (!pack_id.trim().is_empty()).then(|| pack_id.to_string())
}

pub(super) fn seed_pack_id_for_actor(actor_id: u64) -> Option<String> {
    active_content()
        .actors
        .iter()
        .find(|actor| actor.id == actor_id)
        .and_then(|actor| non_empty_pack_id(&actor.pack_id))
}

pub(super) fn seed_pack_id_for_item(item_id: u64) -> Option<String> {
    active_content()
        .items
        .iter()
        .find(|item| item.id == item_id)
        .and_then(|item| non_empty_pack_id(&item.pack_id))
}

pub(super) fn seed_pack_id_for_location(location_id: u64) -> Option<String> {
    active_content()
        .locations
        .iter()
        .find(|location| location.id == location_id)
        .and_then(|location| non_empty_pack_id(&location.pack_id))
}

pub(super) fn location_id_for_card_id(card_id: &str) -> Option<u64> {
    active_content()
        .cards
        .iter()
        .find(|card| {
            card.subject_kind == "location"
                && (card.card_id == card_id || card.external_card_id.as_deref() == Some(card_id))
        })
        .map(|card| card.subject_id)
}

pub(super) fn generated_seed_card_image_url(card_id: &str) -> String {
    format!("/assets/generated/cards/{card_id}.webp")
}

pub(super) fn apply_location_access(
    mut card: CardView,
    location_id: u64,
    access: &AccessContext,
) -> CardView {
    let rule = location_access_rule(location_id);
    let owned = access.owns_card(&card.card_id)
        || rule
            .required_grant_id
            .map(|grant_id| access.has_grant(grant_id))
            .or_else(|| {
                rule.required_card_id
                    .map(|card_id| access.owns_card(card_id))
            })
            .unwrap_or(false);
    card.requires_ownership = rule.required_grant_id.is_some() || rule.required_card_id.is_some();
    card.owned = owned;
    card.accessible = location_access_allowed(location_id, access);
    card.access_reason = if card.accessible {
        None
    } else {
        rule.reason.map(ToString::to_string)
    };
    card
}

pub(super) fn access_view(
    access: &AccessContext,
    location_cards: &BTreeMap<u64, CardView>,
) -> AccessView {
    let accessible_card_ids = location_cards
        .values()
        .filter(|card| card.accessible)
        .map(|card| card.card_id.clone())
        .collect();
    let locked_card_ids = location_cards
        .values()
        .filter(|card| !card.accessible)
        .map(|card| card.card_id.clone())
        .collect();

    AccessView {
        mode: if access.signed_wallet_session {
            "signed_wallet_entitlements".to_string()
        } else if access.unsigned_wallet_claim {
            "unsigned_dev_wallet".to_string()
        } else {
            "public_cottage".to_string()
        },
        shared_world: true,
        owner_wallet_address: access.owner_wallet_address.clone(),
        owned_card_ids: access.owned_card_ids.iter().cloned().collect(),
        owned_box_ids: access.owned_box_ids.iter().cloned().collect(),
        unopened_pack_ids: access.unopened_pack_ids.iter().cloned().collect(),
        granted_entitlement_ids: access.granted_entitlement_ids.iter().cloned().collect(),
        accessible_card_ids,
        locked_card_ids,
    }
}

pub(super) fn account_view(access: &AccessContext) -> AccountView {
    let owned_cards = access
        .owned_card_ids
        .iter()
        .filter_map(|card_id| owned_account_card(card_id, access))
        .collect();
    AccountView {
        wallet_address: access.owner_wallet_address.clone(),
        owned_cards,
        active_box_ids: access.owned_box_ids.iter().cloned().collect(),
        unopened_pack_ids: access.unopened_pack_ids.iter().cloned().collect(),
        recent_box_receipts: Vec::new(),
        recent_pack_openings: Vec::new(),
        materialization_receipts: Vec::new(),
    }
}

pub(super) fn owned_account_card(card_id: &str, access: &AccessContext) -> Option<CardView> {
    let mut card = active_content()
        .cards
        .iter()
        .find(|card| card.card_id == card_id || card.external_card_id.as_deref() == Some(card_id))
        .map(card_from_seed_content)
        .or_else(|| external_card_by_id(card_id))?;
    if let Some(location_id) = location_id_for_card_id(card_id) {
        card = apply_location_access(card, location_id, access);
    } else {
        card.owned = true;
        card.accessible = true;
        card.access_reason = None;
    }
    Some(card)
}

pub(super) fn parse_card_ids(value: &str) -> Vec<String> {
    value
        .split(|ch: char| matches!(ch, ',' | ' ' | '\n' | '\t' | ';'))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| part.trim_matches('"').trim_matches('\''))
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

pub(super) fn first_json_string(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| map.get(*key))
        .find_map(|value| value.as_str().map(|text| text.trim().to_string()))
        .filter(|text| !text.is_empty())
}

pub(super) fn first_json_cards(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> BTreeSet<String> {
    keys.iter()
        .filter_map(|key| map.get(*key))
        .map(json_card_ids)
        .find(|cards| !cards.is_empty())
        .unwrap_or_default()
}

pub(super) fn first_json_assets(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
    id_keys: &[&str],
) -> BTreeSet<String> {
    keys.iter()
        .filter_map(|key| map.get(*key))
        .map(|value| json_asset_ids(value, id_keys))
        .find(|assets| !assets.is_empty())
        .unwrap_or_default()
}

pub(super) fn json_card_ids(value: &serde_json::Value) -> BTreeSet<String> {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .flat_map(|item| match item {
                serde_json::Value::String(text) => parse_card_ids(text),
                serde_json::Value::Object(map) => json_card_id_from_object(map)
                    .map(|card_id| vec![card_id])
                    .unwrap_or_default(),
                _ => Vec::new(),
            })
            .collect(),
        serde_json::Value::String(text) => parse_card_ids(text).into_iter().collect(),
        serde_json::Value::Object(map) => json_card_id_from_object(map).into_iter().collect(),
        _ => BTreeSet::new(),
    }
}

pub(super) fn json_asset_ids(value: &serde_json::Value, id_keys: &[&str]) -> BTreeSet<String> {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .flat_map(|item| match item {
                serde_json::Value::String(text) => vec![text.trim().to_string()],
                serde_json::Value::Object(map) => json_asset_id_from_object(map, id_keys)
                    .map(|asset_id| vec![asset_id])
                    .unwrap_or_default(),
                _ => Vec::new(),
            })
            .filter(|asset_id| !asset_id.is_empty())
            .collect(),
        serde_json::Value::String(text) => text
            .split([',', ';', '|', ' ', '\n', '\t'])
            .map(str::trim)
            .filter(|asset_id| !asset_id.is_empty())
            .map(ToString::to_string)
            .collect(),
        serde_json::Value::Object(map) => json_asset_id_from_object(map, id_keys)
            .into_iter()
            .collect(),
        _ => BTreeSet::new(),
    }
}

pub(super) fn json_card_id_from_object(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    let status = first_json_string(map, &["status"]).unwrap_or_else(|| "active".to_string());
    if !matches!(status.as_str(), "active" | "minted" | "revealed") {
        return None;
    }
    first_json_string(
        map,
        &[
            "characterId",
            "character_id",
            "cardId",
            "card_id",
            "profileId",
        ],
    )
}

pub(super) fn json_asset_id_from_object(
    map: &serde_json::Map<String, serde_json::Value>,
    id_keys: &[&str],
) -> Option<String> {
    let status = first_json_string(map, &["status"]).unwrap_or_else(|| "active".to_string());
    if !asset_status_is_active(&status) {
        return None;
    }
    first_json_string(map, id_keys)
}

pub(super) fn asset_status_is_active(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "active" | "minted" | "available" | "unopened" | "revealed"
    )
}

pub(super) fn card_for_actor(
    actor_id: u64,
    name: &str,
    title: &str,
    description: &str,
    level: u8,
) -> CardView {
    let card = if let Some(card) = seed_card_for_subject("actor", actor_id) {
        card
    } else {
        let mut card = seed_card(SeedCardSpec {
            card_id: &format!("human-avatar-{actor_id}"),
            display_name: name,
            role: "avatar",
            rarity: "generated",
            title: if title.is_empty() {
                "World Traveler"
            } else {
                title
            },
            blurb: if description.is_empty() {
                "A human avatar generated at the cottage threshold."
            } else {
                description
            },
            aspect: "tall",
            source: "cosyworld_runtime",
            asset_status: "generated_art",
            image_url: None,
        });
        card.image_url = Some(generated_avatar_image_url(actor_id));
        card
    };

    apply_actor_evolution_card(card, actor_id, level)
}

pub(super) fn apply_actor_evolution_card(mut card: CardView, actor_id: u64, level: u8) -> CardView {
    card.level = level;
    card.evolved = level >= 2;
    if level < 2 {
        return card;
    }

    card.rarity = "evolved".to_string();
    match actor_id {
        1001 => {
            card.title = "Storyscarf Weaver".to_string();
            card.blurb =
                "Rati's blue scarf has taken a second pattern, stitched from gifts and stories."
                    .to_string();
        }
        1002 => {
            card.title = "Storm-Symbol Speaker".to_string();
            card.blurb = "Gust's symbols brighten into a wider weather language.".to_string();
        }
        1003 => {
            card.title = "Hearthbound Sentinel".to_string();
            card.blurb = "Skull stands steadier at the low door, quiet and unmistakably changed."
                .to_string();
        }
        _ => {
            card.title = format!("World-Touched {}", card.title);
            card.blurb = format!(
                "{} The world has marked this avatar's next shape.",
                card.blurb
            );
        }
    }
    card
}

pub(super) fn card_for_item(item_id: u64, name: &str, description: &str) -> CardView {
    if let Some(card) = seed_card_for_subject("item", item_id) {
        return card;
    }

    let mut card = seed_card(SeedCardSpec {
        card_id: "cosy-item",
        display_name: name,
        role: "item",
        rarity: "generated",
        title: "Found Item",
        blurb: description,
        aspect: "square",
        source: "cosyworld_runtime",
        asset_status: "pending_art",
        image_url: None,
    });
    card.pack_id = seed_pack_id_for_item(item_id);
    card
}

pub(super) fn card_for_location(
    location_id: u64,
    name: &str,
    meta: Option<&LocationMeta>,
) -> CardView {
    let mut card = seed_card_for_subject("location", location_id)
        .unwrap_or_else(|| unknown_location_card(location_id, name, meta));
    if card.pack_id.is_none() {
        card.pack_id = seed_pack_id_for_location(location_id);
    }
    if let Some(meta) = meta {
        card.biome = (!meta.biome.trim().is_empty()).then(|| meta.biome.clone());
        card.terrain = meta.terrain.clone();
        if card.source == "cosyworld_runtime" {
            card.title = meta.title.clone();
            card.blurb = meta.description.clone();
            card.image_url = meta.image_url.clone();
            card.asset_status = if card.image_url.is_some() {
                "generated_pathway_art".to_string()
            } else {
                "pending_art".to_string()
            };
        }
    }
    card
}

pub(super) fn card_ref_view(kind: &str, subject_id: u64, card: &CardView) -> CardRefView {
    CardRefView {
        card_id: card.card_id.clone(),
        kind: kind.to_string(),
        subject_id,
        display_name: card.display_name.clone(),
    }
}

pub(super) fn community_art_eligible_card(card: &CardView) -> bool {
    matches!(
        card.asset_status.as_str(),
        "pending_art" | "generated_art" | "generated_pathway_art" | "seed_art"
    )
}

pub(super) fn card_transaction_view(
    subject: CardRefView,
    predicate: &str,
    object: CardRefView,
    location_id: Option<u64>,
) -> CardTransactionView {
    CardTransactionView {
        subject,
        predicate: predicate.to_string(),
        object,
        location_id,
        observed: true,
        source_event_seq: None,
    }
}

pub(super) fn seed_card_for_subject(subject_kind: &str, subject_id: u64) -> Option<CardView> {
    active_content()
        .cards
        .iter()
        .find(|card| card.subject_kind == subject_kind && card.subject_id == subject_id)
        .map(card_from_seed_content)
}

impl RuntimeWorld {
    pub(super) fn item_source_collectible(
        &self,
        item_id: u64,
    ) -> Option<ActionSourceCollectibleView> {
        let card = seed_card_for_subject("item", item_id).or_else(|| {
            self.materialization_receipts
                .values()
                .find(|receipt| receipt.item_id == item_id)
                .and_then(|receipt| {
                    active_content()
                        .cards
                        .iter()
                        .find(|card| card.card_id == receipt.card_id)
                        .map(card_from_seed_content)
                })
        })?;
        Some(ActionSourceCollectibleView {
            kind: "item".to_string(),
            instance_id: item_id,
            card_id: card.card_id,
            pack_id: card.pack_id.unwrap_or_else(|| "cosyworld.core".to_string()),
        })
    }
}

pub(super) fn seed_weapon_die_sides(item: &SeedItemContent) -> u8 {
    if item.role != "weapon" {
        return 0;
    }
    item.mechanics
        .as_ref()
        .and_then(|mechanics| mechanics.effect_budget.get("damage_die"))
        .and_then(serde_json::Value::as_str)
        .and_then(|die| die.split_once('d'))
        .and_then(|(_, sides)| sides.parse::<u8>().ok())
        .unwrap_or(6)
}

pub(super) fn seed_card_rarity_for_subject(
    subject_kind: &str,
    subject_id: u64,
) -> Option<&'static str> {
    active_content()
        .cards
        .iter()
        .find(|card| card.subject_kind == subject_kind && card.subject_id == subject_id)
        .map(|card| card.rarity.as_str())
}

pub(super) fn search_reveal_chance_percent_for_subject(subject_kind: &str, subject_id: u64) -> u8 {
    seed_card_rarity_for_subject(subject_kind, subject_id)
        .map(search_reveal_chance_percent_for_rarity)
        .unwrap_or(55)
}

pub(super) fn search_reveal_chance_percent_for_rarity(rarity: &str) -> u8 {
    match rarity.trim().to_ascii_lowercase().as_str() {
        "free" | "seed" | "common" => 85,
        "uncommon" => 65,
        "generated" | "mystery" | "pack" => 55,
        "rare" => 35,
        "super-rare" | "super_rare" | "superrare" => 20,
        "ultra-rare" | "ultra_rare" | "ultrarare" => 10,
        "mythic" | "legendary" => 6,
        _ => 55,
    }
}

pub(super) fn card_from_seed_content(card: &SeedCardContent) -> CardView {
    let external_card_id = card.external_card_id.as_deref().or_else(|| {
        active_content()
            .card_bindings
            .iter()
            .find(|binding| {
                binding.seed_card_id == card.card_id
                    && binding.subject_kind == card.subject_kind
                    && binding.subject_id == card.subject_id
            })
            .map(|binding| binding.external_card_id.as_str())
    });
    if let Some(external_card_id) = external_card_id {
        if let Some(external_card) = external_card_by_id(external_card_id) {
            return external_card;
        }
    }
    let image_url = card.image_url.clone().or_else(|| {
        (card.source == "cosyworld_seed").then(|| generated_seed_card_image_url(&card.card_id))
    });
    let asset_status = if image_url.is_some() && card.asset_status == "pending_art" {
        "seed_art".to_string()
    } else {
        card.asset_status.clone()
    };
    CardView {
        pack_id: non_empty_pack_id(&card.pack_id),
        card_id: card.card_id.clone(),
        display_name: card.display_name.clone(),
        role: card.role.clone(),
        rarity: card.rarity.clone(),
        title: card.title.clone(),
        blurb: card.blurb.clone(),
        level: 0,
        evolved: false,
        aspect: card.aspect.clone(),
        source: card.source.clone(),
        asset_status,
        set_number: card.set_number.clone(),
        profile_id: card.profile_id.clone(),
        subject: card.subject.clone(),
        biome: None,
        terrain: Vec::new(),
        image_url,
        chain_image_uri: card.chain_image_uri.clone(),
        requires_ownership: card.requires_ownership,
        owned: false,
        accessible: true,
        access_reason: None,
        community_art: None,
    }
}

pub(super) fn unknown_location_card(
    location_id: u64,
    name: &str,
    meta: Option<&LocationMeta>,
) -> CardView {
    seed_card(SeedCardSpec {
        card_id: &format!("cosy-location-{location_id}"),
        display_name: name,
        role: "location",
        rarity: "generated",
        title: meta
            .map(|meta| meta.title.as_str())
            .unwrap_or("Unknown Place"),
        blurb: meta
            .map(|meta| meta.description.as_str())
            .unwrap_or("The shard hums softly."),
        aspect: "wide",
        source: "cosyworld_runtime",
        asset_status: "pending_art",
        image_url: meta.and_then(|meta| meta.image_url.as_deref()),
    })
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct ExternalCardSpec {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) card_id: String,
    pub(super) display_name: String,
    pub(super) role: String,
    pub(super) rarity: String,
    pub(super) title: String,
    pub(super) blurb: String,
    pub(super) aspect: String,
    pub(super) set_number: String,
    pub(super) profile_id: String,
    pub(super) subject: String,
    pub(super) image_url: String,
    pub(super) chain_image_uri: String,
}

pub(super) fn external_card_catalog() -> &'static [ExternalCardSpec] {
    content_registry().external_cards()
}

pub(super) fn external_card_by_id(card_id: &str) -> Option<CardView> {
    external_card_spec(card_id).map(external_card_view)
}

pub(super) fn external_card_spec(card_id: &str) -> Option<&'static ExternalCardSpec> {
    external_card_catalog()
        .iter()
        .find(|spec| spec.card_id == card_id)
}

pub(super) fn external_card_view(spec: &ExternalCardSpec) -> CardView {
    let source = spec
        .pack_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect();
    CardView {
        pack_id: non_empty_pack_id(&spec.pack_id),
        card_id: spec.card_id.clone(),
        display_name: spec.display_name.clone(),
        role: spec.role.clone(),
        rarity: spec.rarity.clone(),
        title: spec.title.clone(),
        blurb: spec.blurb.clone(),
        level: 0,
        evolved: false,
        aspect: spec.aspect.clone(),
        source,
        asset_status: "on_chain".to_string(),
        set_number: Some(spec.set_number.clone()),
        profile_id: Some(spec.profile_id.clone()),
        subject: Some(spec.subject.clone()),
        biome: None,
        terrain: Vec::new(),
        image_url: Some(spec.image_url.clone()),
        chain_image_uri: Some(spec.chain_image_uri.clone()),
        requires_ownership: false,
        owned: false,
        accessible: true,
        access_reason: None,
        community_art: None,
    }
}

pub(super) struct SeedCardSpec<'a> {
    pub(super) card_id: &'a str,
    pub(super) display_name: &'a str,
    pub(super) role: &'a str,
    pub(super) rarity: &'a str,
    pub(super) title: &'a str,
    pub(super) blurb: &'a str,
    pub(super) aspect: &'a str,
    pub(super) source: &'a str,
    pub(super) asset_status: &'a str,
    pub(super) image_url: Option<&'a str>,
}

pub(super) fn seed_card(spec: SeedCardSpec<'_>) -> CardView {
    let image_url = spec.image_url.map(ToString::to_string).or_else(|| {
        (spec.source == "cosyworld_seed").then(|| generated_seed_card_image_url(spec.card_id))
    });
    let asset_status = if image_url.is_some() && spec.asset_status == "pending_art" {
        "seed_art"
    } else {
        spec.asset_status
    };

    CardView {
        pack_id: None,
        card_id: spec.card_id.to_string(),
        display_name: spec.display_name.to_string(),
        role: spec.role.to_string(),
        rarity: spec.rarity.to_string(),
        title: spec.title.to_string(),
        blurb: spec.blurb.to_string(),
        level: 0,
        evolved: false,
        aspect: spec.aspect.to_string(),
        source: spec.source.to_string(),
        asset_status: asset_status.to_string(),
        set_number: None,
        profile_id: None,
        subject: None,
        biome: None,
        terrain: Vec::new(),
        image_url,
        chain_image_uri: None,
        requires_ownership: false,
        owned: false,
        accessible: true,
        access_reason: None,
        community_art: None,
    }
}

pub(super) async fn pack_open(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<PackOpenRequest>,
) -> Json<PackOpenResponse> {
    if !state.allow_rate_limit(
        rate_limit_key("nft-ip", client_ip_key(client_addr)),
        WALLET_AUTH_LIMIT,
    ) {
        return Json(PackOpenResponse {
            ok: false,
            status: RATE_LIMITED_STATUS as u16,
            opening: None,
            error: Some("NFT action rate limited".to_string()),
        });
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Json(PackOpenResponse {
            ok: false,
            status: 503,
            opening: None,
            error: Some("event store is required for avatar bundle opening".to_string()),
        });
    };
    let Some(wallet_address) = payload
        .wallet_session
        .as_deref()
        .and_then(|token| wallet_for_session(&state.wallet_sessions, token))
    else {
        return Json(PackOpenResponse {
            ok: false,
            status: 401,
            opening: None,
            error: Some("signed wallet session required".to_string()),
        });
    };
    let Some(pack_id) = normalize_asset_id(&payload.pack_id) else {
        return Json(PackOpenResponse {
            ok: false,
            status: 400,
            opening: None,
            error: Some("avatar bundle id is required".to_string()),
        });
    };

    match avatar_pack_opening_by_pack(path, &pack_id) {
        Ok(Some(opening)) if opening.owner_wallet_address == wallet_address => {
            if let Ok(mut ownership) = state.ownership_index.try_write() {
                ownership.apply_pack_opening(&wallet_address, &pack_id, &opening.card_ids);
            }
            return Json(PackOpenResponse {
                ok: true,
                status: 200,
                opening: Some(opening),
                error: None,
            });
        }
        Ok(Some(_)) => {
            return Json(PackOpenResponse {
                ok: false,
                status: 409,
                opening: None,
                error: Some("avatar bundle already opened by another wallet".to_string()),
            });
        }
        Ok(None) => {}
        Err(error) => {
            return Json(PackOpenResponse {
                ok: false,
                status: 500,
                opening: None,
                error: Some(error.to_string()),
            });
        }
    }

    let receipt = match wooden_box_receipt_by_pack(path, &pack_id) {
        Ok(receipt) => receipt,
        Err(error) => {
            return Json(PackOpenResponse {
                ok: false,
                status: 500,
                opening: None,
                error: Some(error.to_string()),
            });
        }
    };
    let ownership = state.ownership_snapshot().await;
    let trusted_pack = ownership
        .packs_for_wallet(&wallet_address)
        .contains(&pack_id);
    if let Some(receipt) = receipt.as_ref() {
        if receipt.owner_wallet_address != wallet_address {
            return Json(PackOpenResponse {
                ok: false,
                status: 403,
                opening: None,
                error: Some("avatar bundle receipt belongs to another wallet".to_string()),
            });
        }
        if receipt.status != "burned" {
            return Json(PackOpenResponse {
                ok: false,
                status: 409,
                opening: None,
                error: Some("avatar bundle is not unopened".to_string()),
            });
        }
    } else if !trusted_pack {
        return Json(PackOpenResponse {
            ok: false,
            status: 403,
            opening: None,
            error: Some("avatar bundle is not active in the trusted ownership feed".to_string()),
        });
    }

    let box_asset_address = receipt
        .as_ref()
        .map(|receipt| receipt.box_asset_address.as_str());
    let reveal_seed = reveal_seed_for_pack(&wallet_address, &pack_id, box_asset_address);
    let catalog_hash = avatar_pack_catalog_hash();
    let already_owned = ownership.cards_for_wallet(&wallet_address);
    let card_ids = deterministic_pack_cards(&reveal_seed, &already_owned);
    let provenance_json = serde_json::json!({
        "version": 1,
        "source": "cosyworld_v2_staging",
        "verification_status": receipt
            .as_ref()
            .map(|receipt| receipt.verification_status.as_str())
            .unwrap_or("trusted_feed_external_pack"),
        "box_asset_address": box_asset_address,
        "pack_id": pack_id,
        "catalog_hash": catalog_hash,
        "reveal_seed": reveal_seed,
    })
    .to_string();

    match insert_avatar_pack_opening(
        path,
        &wallet_address,
        box_asset_address,
        &pack_id,
        &reveal_seed,
        &catalog_hash,
        &card_ids,
        &provenance_json,
    ) {
        Ok(opening) => {
            if receipt.is_some() {
                if let Err(error) = mark_wooden_box_receipt_opened(path, &pack_id) {
                    warn!("failed to mark Wooden Box receipt opened for {pack_id}: {error}");
                }
            }
            if let Ok(mut ownership) = state.ownership_index.try_write() {
                ownership.apply_pack_opening(&wallet_address, &pack_id, &opening.card_ids);
            }
            Json(PackOpenResponse {
                ok: true,
                status: 200,
                opening: Some(opening),
                error: None,
            })
        }
        Err(error) => Json(PackOpenResponse {
            ok: false,
            status: 409,
            opening: None,
            error: Some(error.to_string()),
        }),
    }
}

pub(super) fn insert_avatar_pack_opening(
    path: &Path,
    owner_wallet_address: &str,
    box_asset_address: Option<&str>,
    pack_id: &str,
    reveal_seed: &str,
    catalog_hash: &str,
    card_ids: &[String],
    provenance_json: &str,
) -> io::Result<AvatarPackOpeningView> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let idempotency_key = pack_opening_idempotency_key(pack_id);
    let card_ids_json = serde_json::to_string(card_ids)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    conn.execute(
        "INSERT INTO avatar_pack_openings
            (idempotency_key, owner_wallet_address, box_asset_address, pack_id, reveal_seed,
             catalog_hash, card_ids_json, provenance_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            idempotency_key,
            owner_wallet_address,
            box_asset_address,
            pack_id,
            reveal_seed,
            catalog_hash,
            card_ids_json,
            provenance_json,
            now_millis() as i64,
        ],
    )
    .map_err(sqlite_error)?;
    avatar_pack_opening_by_pack(path, pack_id)?
        .ok_or_else(|| io::Error::other("avatar pack opening insert did not return a row"))
}

pub(super) fn avatar_pack_opening_by_pack(
    path: &Path,
    pack_id: &str,
) -> io::Result<Option<AvatarPackOpeningView>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT idempotency_key, owner_wallet_address, box_asset_address, pack_id,
                reveal_seed, catalog_hash, card_ids_json, provenance_json, created_at_ms
         FROM avatar_pack_openings
         WHERE pack_id = ?1",
        params![pack_id],
        |row| {
            let card_ids_json: String = row.get(6)?;
            let card_ids = serde_json::from_str(&card_ids_json).unwrap_or_default();
            Ok(AvatarPackOpeningView {
                idempotency_key: row.get(0)?,
                owner_wallet_address: row.get(1)?,
                box_asset_address: row.get(2)?,
                pack_id: row.get(3)?,
                reveal_seed: row.get(4)?,
                catalog_hash: row.get(5)?,
                card_ids,
                provenance_json: row.get(7)?,
                created_at_ms: row.get::<_, i64>(8)?.max(0) as u64,
            })
        },
    )
    .optional()
    .map_err(sqlite_error)
}

pub(super) fn load_account_activity_view(
    path: &Path,
    access: &AccessContext,
    limit: usize,
) -> io::Result<AccountView> {
    let mut account = account_view(access);
    let Some(wallet) = access.owner_wallet_address.as_deref() else {
        return Ok(account);
    };
    let limit = i64::try_from(limit.min(25)).unwrap_or(25);
    init_event_store(path)?;
    let conn = open_event_store(path)?;

    {
        let mut stmt = conn
            .prepare(
                "SELECT box_asset_address, owner_wallet_address, status, burn_signature,
                        verification_status, pack_id, created_at_ms, updated_at_ms
                 FROM wooden_box_receipts
                 WHERE owner_wallet_address = ?1
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT ?2",
            )
            .map_err(sqlite_error)?;
        let rows = stmt
            .query_map(params![wallet, limit], |row| {
                Ok(WoodenBoxReceiptView {
                    box_asset_address: row.get(0)?,
                    owner_wallet_address: row.get(1)?,
                    status: row.get(2)?,
                    burn_signature: row.get(3)?,
                    verification_status: row.get(4)?,
                    pack_id: row.get(5)?,
                    created_at_ms: row.get::<_, i64>(6)?.max(0) as u64,
                    updated_at_ms: row.get::<_, i64>(7)?.max(0) as u64,
                })
            })
            .map_err(sqlite_error)?;
        account.recent_box_receipts = rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT idempotency_key, owner_wallet_address, box_asset_address, pack_id,
                        reveal_seed, catalog_hash, card_ids_json, provenance_json, created_at_ms
                 FROM avatar_pack_openings
                 WHERE owner_wallet_address = ?1
                 ORDER BY created_at_ms DESC
                 LIMIT ?2",
            )
            .map_err(sqlite_error)?;
        let rows = stmt
            .query_map(params![wallet, limit], |row| {
                let card_ids_json: String = row.get(6)?;
                let card_ids = serde_json::from_str(&card_ids_json).unwrap_or_default();
                Ok(AvatarPackOpeningView {
                    idempotency_key: row.get(0)?,
                    owner_wallet_address: row.get(1)?,
                    box_asset_address: row.get(2)?,
                    pack_id: row.get(3)?,
                    reveal_seed: row.get(4)?,
                    catalog_hash: row.get(5)?,
                    card_ids,
                    provenance_json: row.get(7)?,
                    created_at_ms: row.get::<_, i64>(8)?.max(0) as u64,
                })
            })
            .map_err(sqlite_error)?;
        account.recent_pack_openings = rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?;
    }

    Ok(account)
}

pub(super) fn card_zone(zone: u8, holder_actor_id: u64, location_id: u64) -> &'static str {
    match zone {
        CW_CARD_ZONE_WORLD => "world",
        CW_CARD_ZONE_CARRIED => "carried",
        CW_CARD_ZONE_EQUIPPED => "equipped",
        CW_CARD_ZONE_SPELL_DECK => "spell_deck",
        CW_CARD_ZONE_EXHAUSTED => "exhausted",
        CW_CARD_ZONE_CONTAINED => "contained",
        CW_CARD_ZONE_ESCROW => "escrow",
        CW_CARD_ZONE_INSTALLED => "installed",
        _ if holder_actor_id != 0 => "carried",
        _ if location_id != 0 => "world",
        _ => "collection",
    }
}
