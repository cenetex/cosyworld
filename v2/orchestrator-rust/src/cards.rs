use super::*;
use serde::ser::SerializeStruct;

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ActionHandView {
    pub(super) schema_version: u8,
    pub(super) capacity: u8,
    pub(super) deck_size: u16,
    pub(super) draw_available: bool,
    pub(super) generation: u64,
    pub(super) pass: ActionHandPassView,
    pub(super) entries: Vec<ActionHandEntryView>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ActionHandPassView {
    pub(super) offer_id: String,
    pub(super) label: String,
    pub(super) state_revision: u64,
    pub(super) generation: u64,
    pub(super) scene_key: String,
    pub(super) slot: String,
    pub(super) replaces_offer_id: String,
    pub(super) free: bool,
    pub(super) consumes_turn: bool,
    pub(super) available: bool,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ActionHandEntryView {
    pub(super) card_id: String,
    pub(super) entity_kind: String,
    pub(super) entity_id: u64,
    pub(super) label: String,
    pub(super) offer_ids: Vec<String>,
    // The first exact action remains an internal representative for resident
    // planning and older command paths. It is not the noun card's identity.
    pub(super) offer_id: String,
    pub(super) kind: String,
    pub(super) intention: String,
    pub(super) provider: ActionProviderView,
    pub(super) slot: String,
    pub(super) card_type: String,
    pub(super) suit: String,
    pub(super) verb: String,
    pub(super) think: ActionHandPassView,
    pub(super) replacement_count: u16,
}

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
}

impl Serialize for CommunityArtView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("CommunityArtView", 5)?;
        out.serialize_field("level", &self.level)?;
        out.serialize_field("required_orbs", &self.required_orbs)?;
        out.serialize_field("funded_orbs", &self.funded_orbs)?;
        out.serialize_field("remaining_orbs", &self.remaining_orbs)?;
        out.serialize_field("viewer_contributed", &self.viewer_contributed)?;
        out.end()
    }
}

impl RuntimeWorld {}

impl RuntimeWorld {}

impl RuntimeWorld {}

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

impl RuntimeWorld {}
