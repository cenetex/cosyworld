use super::*;
use serde::ser::SerializeStruct;

#[derive(Debug, Serialize)]
pub(super) struct AccountView {
    pub(super) linked_wallet_address: Option<String>,
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

#[allow(dead_code)]
#[derive(Clone, Debug)]
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
    pub(super) generation_policy: Option<GeneratedPolicyBinding>,
    pub(super) community_art: Option<CommunityArtView>,
}

impl Serialize for CardView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("CardView", 12)?;
        out.serialize_field("card_id", &self.card_id)?;
        out.serialize_field("display_name", &self.display_name)?;
        out.serialize_field("role", &self.role)?;
        out.serialize_field("rarity", &self.rarity)?;
        out.serialize_field("title", &self.title)?;
        out.serialize_field("blurb", &self.blurb)?;
        out.serialize_field("level", &self.level)?;
        out.serialize_field("aspect", &self.aspect)?;
        if let Some(value) = &self.biome {
            out.serialize_field("biome", value)?;
        }
        out.serialize_field("terrain", &self.terrain)?;
        if let Some(value) = &self.image_url {
            out.serialize_field("image_url", value)?;
        }
        if let Some(value) = &self.community_art {
            out.serialize_field("community_art", value)?;
        }
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct CommunityArtView {
    pub(super) level: u8,
    pub(super) required_orbs: i32,
    pub(super) funded_orbs: i32,
    pub(super) remaining_orbs: i32,
    pub(super) viewer_contributed: bool,
    pub(super) status: String,
    pub(super) history_through_seq: u64,
    pub(super) provider_attempts: u8,
    pub(super) max_provider_attempts: u8,
    pub(super) retryable_without_orbs: bool,
}

impl Serialize for CommunityArtView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("CommunityArtView", 9)?;
        out.serialize_field("level", &self.level)?;
        out.serialize_field("required_orbs", &self.required_orbs)?;
        out.serialize_field("funded_orbs", &self.funded_orbs)?;
        out.serialize_field("remaining_orbs", &self.remaining_orbs)?;
        out.serialize_field("viewer_contributed", &self.viewer_contributed)?;
        out.serialize_field("status", &self.status)?;
        out.serialize_field("provider_attempts", &self.provider_attempts)?;
        out.serialize_field("max_provider_attempts", &self.max_provider_attempts)?;
        out.serialize_field("retryable_without_orbs", &self.retryable_without_orbs)?;
        out.end()
    }
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

#[cfg(test)]
pub(super) fn insert_avatar_pack_opening(
    path: &Path,
    owner_wallet_address: &str,
    box_asset_address: Option<&str>,
    pack_id: &str,
    reveal_seed: &str,
    catalog_hash: &str,
    card_ids: &[String],
    provenance_json: &str,
) -> io::Result<()> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let card_ids_json = serde_json::to_string(card_ids)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    conn.execute(
        "INSERT INTO avatar_pack_openings
            (idempotency_key, owner_wallet_address, box_asset_address, pack_id, reveal_seed,
             catalog_hash, card_ids_json, provenance_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            format!("pack-open:{pack_id}"),
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
    Ok(())
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
            cw_world_set_item_zone(&mut *self.world, item_id, zone, container_item_id) == CW_OK
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
    pub(super) fn decorate_generated_location_card(
        &self,
        mut card: CardView,
        location_id: u64,
    ) -> CardView {
        card.generation_policy = self
            .generated_pathway_for_location(location_id)
            .map(|pathway| pathway.generation_policy.clone());
        card
    }

    pub(super) fn card_registry_for(
        &self,
        location: &LocationView,
        actors: &[ActorView],
        items: &[ItemView],
        exits: &[ExitView],
        access: &AccessContext,
        viewer_actor_id: Option<u64>,
    ) -> CardRegistryView {
        let mut locations = BTreeMap::new();
        locations.insert(
            location.id,
            apply_location_access(
                self.decorate_community_art_card(
                    self.decorate_generated_location_card(
                        card_for_location(
                            location.id,
                            location.name.as_str(),
                            Some(&self.location_meta_for(location.id)),
                        ),
                        location.id,
                    ),
                    "location",
                    location.id,
                    viewer_actor_id,
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
                        self.decorate_generated_location_card(
                            card_for_location(
                                exit.destination_location_id,
                                exit.destination_location_name.as_str(),
                                Some(&self.location_meta_for(exit.destination_location_id)),
                            ),
                            exit.destination_location_id,
                        ),
                        "location",
                        exit.destination_location_id,
                        viewer_actor_id,
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
                            viewer_actor_id,
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
                            viewer_actor_id,
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

pub(super) fn generated_seed_card_image_url(card_id: &str) -> String {
    format!("/assets/generated/cards/{card_id}.webp")
}

pub(super) fn apply_location_access(
    card: CardView,
    _location_id: u64,
    _access: &AccessContext,
) -> CardView {
    card
}

pub(super) fn account_view(access: &AccessContext) -> AccountView {
    AccountView {
        linked_wallet_address: access.owner_wallet_address.clone(),
    }
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
        generation_policy: None,
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
        generation_policy: None,
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
        generation_policy: None,
        community_art: None,
    }
}

impl RuntimeWorld {
    pub(super) fn actor_held_items(&self, actor_id: u64) -> Vec<CwItem> {
        let mut items: Vec<_> = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| item.holder_actor_id == actor_id)
            .collect();
        items.sort_by_key(|item| item.id);
        items
    }

    pub(super) fn default_spell_card(&self, actor_id: u64) -> Option<CwItem> {
        let prepared = self.prepared_spells.get(&actor_id)?;
        self.actor_held_items(actor_id).into_iter().find(|item| {
            item.role == CW_ITEM_ROLE_SPELL
                && item.zone == CW_CARD_ZONE_SPELL_DECK
                && item.charges > 0
                && prepared.contains(&item.id)
        })
    }

    pub(super) fn equipped_weapon_item(&self, actor_id: u64) -> Option<CwItem> {
        self.actor_held_items(actor_id)
            .into_iter()
            .find(|item| item.role == CW_ITEM_ROLE_WEAPON && item.zone == CW_CARD_ZONE_EQUIPPED)
    }

    pub(super) fn charm_slot_count(&self, actor_id: u64) -> u8 {
        self.charm_slots
            .get(&actor_id)
            .copied()
            .unwrap_or(BASE_CHARM_SLOTS)
            .clamp(BASE_CHARM_SLOTS, MAX_CHARM_SLOTS)
    }

    pub(super) fn equipped_charm_items(&self, actor_id: u64) -> Vec<CwItem> {
        self.equipped_charms
            .get(&actor_id)
            .into_iter()
            .flat_map(|item_ids| item_ids.iter())
            .filter_map(|item_id| self.item_by_id(*item_id))
            .filter(|item| {
                item.holder_actor_id == actor_id
                    && item.role == CW_ITEM_ROLE_SKILL_CHARM
                    && item.zone == CW_CARD_ZONE_EQUIPPED
            })
            .take(usize::from(self.charm_slot_count(actor_id)))
            .collect()
    }

    pub(super) fn charm_slot_expansion_candidate(&self, actor_id: u64) -> Option<CwItem> {
        let slots = self.charm_slot_count(actor_id);
        if slots >= MAX_CHARM_SLOTS
            || self.advancement_points_available(actor_id) < usize::from(CHARM_SLOT_COST)
        {
            return None;
        }
        let equipped = self.equipped_charm_items(actor_id);
        if equipped.len() != usize::from(slots) {
            return None;
        }
        let equipped_ids = equipped
            .into_iter()
            .map(|item| item.id)
            .collect::<BTreeSet<_>>();
        self.actor_held_items(actor_id).into_iter().find(|item| {
            item.role == CW_ITEM_ROLE_SKILL_CHARM
                && item.zone != CW_CARD_ZONE_EQUIPPED
                && !equipped_ids.contains(&item.id)
        })
    }

    pub(super) fn deck_view(&self, actor_id: Option<u64>) -> DeckView {
        let Some(actor_id) = actor_id else {
            return DeckView {
                actor_id: None,
                carried_cards: Vec::new(),
                carried_weight_tenths: 0,
                base_carrying_capacity_tenths: 0,
                container_capacity_tenths: 0,
                carrying_capacity_tenths: 0,
                bracelet_slots: 0,
                equipped_charms: Vec::new(),
                available_charms: Vec::new(),
                charm_slot_expansion: None,
                spell_cards: Vec::new(),
                prepared_spell_cards: Vec::new(),
                exhausted_spell_cards: Vec::new(),
                exhausted_cards: Vec::new(),
                spell_deck_slots: 0,
                equipped_weapon: None,
                equipped_containers: Vec::new(),
                containers: Vec::new(),
                zone_counts: BTreeMap::new(),
                validation_errors: Vec::new(),
                bag_previews: Vec::new(),
            };
        };
        let carried = self.actor_held_items(actor_id);
        let charm_slot_expansion =
            self.charm_slot_expansion_candidate(actor_id).map(|charm| {
                let name = self
                    .item_name(charm.id)
                    .unwrap_or_else(|| format!("Item {}", charm.id));
                let description = self
                    .items
                    .get(&charm.id)
                    .map(|meta| meta.description.trim())
                    .filter(|description| !description.is_empty())
                    .unwrap_or("This charm could add another knack to your bracelet.");
                let advancement = self.advancement_points_available(actor_id);
                CharmSlotExpansionView {
                    charm: self.item_view(charm),
                    label: format!("Make room for {name}"),
                    explanation: format!(
                        "{description} Your Journal holds {advancement} earned advancement; spend {CHARM_SLOT_COST} to open one slot. The charm stays carried until you choose to wear it."
                    ),
                    advancement_cost: CHARM_SLOT_COST,
                }
            });
        let equipped_ids = self
            .equipped_charm_items(actor_id)
            .into_iter()
            .map(|item| item.id)
            .collect::<BTreeSet<_>>();
        let equipped_weapon = carried
            .iter()
            .copied()
            .find(|item| item.role == CW_ITEM_ROLE_WEAPON && item.zone == CW_CARD_ZONE_EQUIPPED)
            .map(|item| self.item_view(item));
        let equipped_containers = carried
            .iter()
            .copied()
            .filter(|item| {
                item.role == CW_ITEM_ROLE_CONTAINER && item.zone == CW_CARD_ZONE_EQUIPPED
            })
            .map(|item| self.item_view(item))
            .collect::<Vec<_>>();
        let containers = carried
            .iter()
            .copied()
            .filter(|item| item.role == CW_ITEM_ROLE_CONTAINER)
            .map(|container| {
                let contract = self.seed_item_contract_for_instance(container.id);
                ContainerDeckView {
                    container: self.item_view(container),
                    contents: carried
                        .iter()
                        .copied()
                        .filter(|item| item.container_item_id == container.id)
                        .map(|item| self.item_view(item))
                        .collect(),
                    opening_size: contract
                        .and_then(|seed| seed.container_opening_size.clone())
                        .unwrap_or_else(|| "none".to_string()),
                    allowed_contents: contract
                        .map(|seed| seed.allowed_contents.clone())
                        .unwrap_or_default(),
                    equipped: container.zone == CW_CARD_ZONE_EQUIPPED,
                    active_capacity_tenths: if container.zone == CW_CARD_ZONE_EQUIPPED {
                        container.container_capacity_tenths
                    } else {
                        0
                    },
                }
            })
            .collect::<Vec<_>>();
        let mut zone_counts = BTreeMap::new();
        for item in &carried {
            *zone_counts
                .entry(card_zone(item.zone, item.holder_actor_id, item.location_id).to_string())
                .or_insert(0) += 1;
        }
        let carried_weight = self.actor_carried_weight_tenths(actor_id);
        let carrying_capacity = self
            .actor_carrying_capacity_tenths(actor_id)
            .unwrap_or_default();
        let mut validation_errors = Vec::new();
        if carried_weight > carrying_capacity {
            let over = carried_weight.saturating_sub(carrying_capacity);
            let heaviest = carried
                .iter()
                .max_by_key(|item| effective_item_weight_tenths(**item))
                .and_then(|item| self.item_name(item.id))
                .unwrap_or_else(|| "a carried card".to_string());
            validation_errors.push(format!(
                "over capacity by {:.1} lb; {heaviest} is the heaviest carried card and only equipped, uncontained bags add capacity",
                over as f64 / 10.0
            ));
        }
        let bag_previews = carried
            .iter()
            .filter(|item| {
                item.role == CW_ITEM_ROLE_CONTAINER
                    && item.zone == CW_CARD_ZONE_CARRIED
                    && item.container_item_id == 0
            })
            .map(|item| {
                let preview_capacity =
                    carrying_capacity + u32::from(item.container_capacity_tenths);
                format!(
                    "equip {}: capacity becomes {:.1} lb and the Pack would be {}",
                    self.item_name(item.id)
                        .unwrap_or_else(|| format!("Item {}", item.id)),
                    preview_capacity as f64 / 10.0,
                    if carried_weight <= preview_capacity {
                        "legal"
                    } else {
                        "overweight"
                    }
                )
            })
            .collect();
        DeckView {
            actor_id: Some(actor_id),
            carried_cards: carried
                .iter()
                .copied()
                .map(|item| self.item_view(item))
                .collect(),
            carried_weight_tenths: carried_weight,
            base_carrying_capacity_tenths: self
                .actor_base_carrying_capacity_tenths(actor_id)
                .unwrap_or_default(),
            container_capacity_tenths: self.actor_container_capacity_tenths(actor_id),
            carrying_capacity_tenths: carrying_capacity,
            bracelet_slots: self.charm_slot_count(actor_id),
            equipped_charms: carried
                .iter()
                .copied()
                .filter(|item| equipped_ids.contains(&item.id))
                .map(|item| self.item_view(item))
                .collect(),
            available_charms: carried
                .iter()
                .copied()
                .filter(|item| {
                    item.role == CW_ITEM_ROLE_SKILL_CHARM && !equipped_ids.contains(&item.id)
                })
                .map(|item| self.item_view(item))
                .collect(),
            charm_slot_expansion,
            spell_cards: carried
                .iter()
                .copied()
                .filter(|item| item.role == CW_ITEM_ROLE_SPELL)
                .map(|item| self.item_view(item))
                .collect(),
            prepared_spell_cards: carried
                .iter()
                .copied()
                .filter(|item| {
                    item.role == CW_ITEM_ROLE_SPELL
                        && item.charges > 0
                        && self
                            .prepared_spells
                            .get(&actor_id)
                            .is_some_and(|prepared| prepared.contains(&item.id))
                })
                .map(|item| self.item_view(item))
                .collect(),
            exhausted_spell_cards: carried
                .iter()
                .copied()
                .filter(|item| item.role == CW_ITEM_ROLE_SPELL && item.charges == 0)
                .map(|item| self.item_view(item))
                .collect(),
            exhausted_cards: carried
                .iter()
                .copied()
                .filter(|item| item.zone == CW_CARD_ZONE_EXHAUSTED)
                .map(|item| self.item_view(item))
                .collect(),
            spell_deck_slots: 3,
            equipped_weapon,
            equipped_containers,
            containers,
            zone_counts,
            validation_errors,
            bag_previews,
        }
    }

    pub(super) fn loose_items_at_location(&self, location_id: u64) -> Vec<CwItem> {
        let mut items = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| {
                item.holder_actor_id == 0
                    && item.location_id == location_id
                    && item.zone == CW_CARD_ZONE_WORLD
                    && !self.forgotten_search_item_at_location(*item, location_id)
            })
            .collect::<Vec<_>>();
        items.sort_by_key(|item| item.id);
        items
    }

    pub(super) fn room_floor_empty(&self, location_id: u64) -> bool {
        self.loose_items_at_location(location_id).is_empty()
    }
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
