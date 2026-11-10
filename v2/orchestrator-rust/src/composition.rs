use super::*;

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActionProviderView {
    pub(super) kind: String,
    pub(super) id: String,
    pub(super) label: String,
    pub(super) reason: String,
    pub(super) priority: u8,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct StoryHandActorState {
    pub(super) scene_key: String,
    pub(super) slot_generations: [u64; 3],
    pub(super) free_think_used: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) location_rotation_after: Option<String>,
}

impl RuntimeWorld {}

impl RuntimeWorld {}

fn spell_effect_suit(effect: Option<&str>) -> Option<&'static str> {
    let effect = effect?.to_ascii_lowercase();
    if ["rest", "recover", "heal", "glow", "train", "grow", "evolve"]
        .iter()
        .any(|term| effect.contains(term))
    {
        Some("heart")
    } else if ["damage", "attack", "defend", "guard", "rescue", "escape"]
        .iter()
        .any(|term| effect.contains(term))
    {
        Some("honor")
    } else if ["reveal", "find", "notice", "inspect", "search", "study"]
        .iter()
        .any(|term| effect.contains(term))
    {
        Some("head")
    } else if ["travel", "move", "return", "cross", "path"]
        .iter()
        .any(|term| effect.contains(term))
    {
        Some("hustle")
    } else if [
        "friend",
        "bond",
        "speak",
        "chat",
        "influence",
        "give",
        "trade",
    ]
    .iter()
    .any(|term| effect.contains(term))
    {
        Some("heart")
    } else if ["make", "craft", "create", "open", "use", "work", "prepare"]
        .iter()
        .any(|term| effect.contains(term))
    {
        Some("hustle")
    } else {
        None
    }
}

/// Exhaustive server-owned mapping from a playable offer to the four Story
/// Hand suits. There is intentionally no utility/danger fallback: a new verb
/// must choose its meaning before it can be published as a card.
pub(super) fn action_card_suit(offer: &RankedActionOffer) -> Result<&'static str, String> {
    if offer.kind == "cast_spell" {
        return spell_effect_suit(offer.effect.as_deref()).ok_or_else(|| {
            format!(
                "spell offer {} has no effect-derived Story Hand suit",
                offer.offer_id
            )
        });
    }
    let intention_suit = match offer.intention.as_str() {
        "notice" | "inspect" | "search" | "study" | "scout" | "listen" | "find_resonance"
        | "rank_echoes" => Some("head"),
        "travel" | "go" | "cross" | "return" | "route" | "routes" => Some("hustle"),
        "chat" | "speak" | "echo" | "befriend" | "remember" | "influence" | "give" | "accept"
        | "trade" => Some("heart"),
        "take" | "drop" | "use" | "open" | "craft" | "prepare" | "work" | "help" | "finish"
        | "illustrate" => Some("hustle"),
        "attack" | "defend" | "flee" | "rescue" | "steal" => Some("honor"),
        "rest" | "bank" | "practice" | "train" | "evolve" | "class" => Some("heart"),
        _ => None,
    };
    let suit = if let Some(suit) = intention_suit {
        suit
    } else {
        match offer.kind.as_str() {
            "check"
            | "search"
            | "study"
            | "explore_path"
            | FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND => "head",
            "move" | ACCOMPANY_OFFER_KIND => "hustle",
            "chat"
            | "influence"
            | "give_item"
            | ACCEPT_TRANSFER_OFFER_KIND
            | "trade_item"
            | "create_bond"
            | "resolve_bond" => "heart",
            "pick_up" | "drop_item" | "use_item" | "use_feature" | "open" | "craft" | "prepare"
            | "work" | "help" => "hustle",
            "attack" | "defend" | "flee" | "theft" => "honor",
            "rest" | "train_skill" | "revise_calling" | "revise_bond" => "heart",
            "model_interaction" => match offer.intention.as_str() {
                "find_resonance" | "rank_echoes" => "head",
                "speak" | "echo" => "heart",
                "illustrate" => "hustle",
                intention => {
                    return Err(format!(
                        "model interaction {} has unmapped intention {intention}",
                        offer.offer_id
                    ));
                }
            },
            kind => {
                return Err(format!(
                    "playable offer {} has unmapped Story Hand kind {kind}",
                    offer.offer_id
                ));
            }
        }
    };
    Ok(suit)
}

fn action_card_provenance(offer: &RankedActionOffer) -> &'static str {
    let pack_id = offer
        .source_collectible
        .as_ref()
        .map(|source| source.pack_id.as_str())
        .unwrap_or(offer.pack_provenance.pack_id.as_str())
        .to_ascii_lowercase();
    if pack_id.contains("legacy") {
        "legacy"
    } else if pack_id.contains("community") || pack_id.contains("ugc") {
        "community"
    } else if pack_id.starts_with("cosyworld.core")
        || pack_id.contains("commons")
        || pack_id.contains("rules-profile")
    {
        "core"
    } else {
        "worldpack"
    }
}

pub(super) fn action_card_presentation(
    offer: &RankedActionOffer,
) -> Result<ActionCardPresentationView, String> {
    let (family, suit) = if offer.kind == "create_avatar" {
        ("ceremony", None)
    } else if offer.kind == "wait" {
        ("control", None)
    } else {
        ("action", Some(action_card_suit(offer)?.to_string()))
    };
    Ok(ActionCardPresentationView {
        family: family.to_string(),
        suit,
        verb: offer.verb.clone(),
        source: ActionCardSourceView {
            kind: offer.provider.kind.clone(),
            id: offer.provider.id.clone(),
            label: offer.provider.label.clone(),
        },
        state: if offer.disabled { "locked" } else { "ready" }.to_string(),
        provenance: action_card_provenance(offer).to_string(),
        // Rarity is a collectible marker, never the action's primary colour or
        // a proxy for strength. Content can author richer values later.
        rarity: "everyday".to_string(),
        power: "standard".to_string(),
        cost: offer.cost.clone(),
        risk: offer.risk.clone(),
        effect: offer.effect.clone(),
    })
}
