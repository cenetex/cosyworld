use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CommandResponse {
    pub(crate) ok: bool,
    pub(crate) status: u32,
    pub(crate) command: String,
    pub(crate) verb: String,
    pub(crate) output: Option<String>,
    pub(crate) action: Option<CommandActionView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) receipt: Option<CanonicalCommandReceipt>,
    pub(crate) events: Vec<EventView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CommandRequest {
    pub(crate) actor_id: u64,
    pub(crate) actor_session: Option<String>,
    pub(crate) command: String,
    pub(crate) wallet_address: Option<String>,
    pub(crate) wallet: Option<String>,
    pub(crate) wallet_session: Option<String>,
    pub(crate) owned_card_ids: Option<String>,
    pub(crate) cards: Option<String>,
    #[serde(default)]
    pub(crate) envelope: Option<CanonicalCommandEnvelope>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CommandActionView {
    pub(crate) kind: String,
    pub(crate) label: String,
    pub(crate) command: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedCommand {
    pub(crate) command: String,
    pub(crate) verb: String,
    pub(crate) action: Option<CommandActionView>,
    pub(crate) dispatch: CommandDispatch,
}

#[derive(Clone, Debug)]
pub(crate) enum CommandDispatch {
    Read {
        output: String,
    },
    Disabled {
        status: u32,
        output: String,
    },
    Move {
        destination_location_id: u64,
    },
    Flee {
        destination_location_id: u64,
    },
    Check,
    Study,
    Influence {
        target_actor_id: u64,
    },
    CastSpell {
        item_id: u64,
        target_actor_id: u64,
    },
    PickUp {
        item_id: u64,
    },
    Drop {
        item_id: u64,
    },
    UseItem {
        item_id: u64,
        target_actor_id: u64,
    },
    SearchFeature {
        location_id: u64,
        feature_key: String,
        feature_name: String,
        output: String,
    },
    UseFeature {
        item_id: u64,
        location_id: u64,
        feature_key: String,
        output: String,
    },
    GiveItem {
        item_id: u64,
        target_actor_id: u64,
    },
    TradeItem {
        item_id: u64,
        target_actor_id: u64,
        target_item_id: u64,
    },
    ResolveTransferOffer {
        offer_id: String,
        decision: String,
    },
    SetActorSafety {
        target_actor_id: u64,
        control: ActorSafetyControl,
        enabled: bool,
    },
    RequestGift {
        offered_by_actor_id: u64,
        item_id: u64,
    },
    Theft {
        item_id: u64,
        target_actor_id: u64,
    },
    Craft {
        recipe_id: u64,
    },
    Attack {
        target_actor_id: u64,
    },
    Defend,
    Prepare,
    Work,
    Help,
    Rest,
    UnlockCharmSlot,
    SetCharmEquipped {
        item_id: u64,
        equipped: bool,
    },
    SetSpellPrepared {
        item_id: u64,
        prepared: bool,
    },
    SetItemEquipped {
        item_id: u64,
        equipped: bool,
    },
    SetItemContained {
        item_id: u64,
        container_item_id: Option<u64>,
    },
    ReviseCalling {
        statement: String,
    },
    CreateBond {
        target_actor_id: u64,
        statement: String,
    },
    ReviseBond {
        target_actor_id: u64,
        statement: String,
    },
    TrainSkill {
        skill_id: String,
    },
    ResolveBond {
        target_actor_id: u64,
    },
    Say {
        content: String,
    },
    Emote {
        content: String,
    },
    Report {
        target_actor_id: u64,
        reason: String,
    },
}

#[derive(Debug)]
pub(crate) struct CommandError {
    pub(crate) command: String,
    pub(crate) verb: String,
    pub(crate) status: u32,
    pub(crate) output: String,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum CommandActorFilter {
    Any,
    ActiveActor,
}

pub(crate) fn normalize_command_text(input: &str) -> String {
    input
        .trim()
        .trim_start_matches('/')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_emote_message(input: &str) -> Option<String> {
    let mut content = normalize_human_message(input)?;
    let has_terminal_punctuation = content
        .chars()
        .last()
        .is_some_and(|ch| matches!(ch, '.' | '!' | '?' | ')' | ']' | '}'));
    if !has_terminal_punctuation && content.chars().count() < MAX_HUMAN_MESSAGE_CHARS {
        content.push('.');
    }
    Some(content)
}

pub(crate) fn command_verb_and_rest(command: &str) -> (String, &str) {
    command
        .split_once(' ')
        .map(|(verb, rest)| (verb.to_lowercase(), rest.trim()))
        .unwrap_or_else(|| (command.to_lowercase(), ""))
}

pub(crate) fn canonical_command_verb(verb: &str) -> String {
    if canonical_direction(verb).is_some() {
        return "go".to_string();
    }
    match verb {
        "l" | "look" | "examine" | "inspect" => "look",
        "search" | "find" => "search",
        "i" | "inv" | "inventory" | "deck" => "inventory",
        "who" | "where" => "who",
        "go" | "move" | "travel" => "go",
        "get" | "take" | "pick" => "take",
        "give" | "gift" => "give",
        "trade" | "swap" | "barter" => "trade",
        "offers" => "offers",
        "request" => "request",
        "accept" => "accept",
        "decline" | "reject" => "decline",
        "withdraw" | "cancel" => "withdraw",
        "mute" => "mute",
        "unmute" => "unmute",
        "block" => "block",
        "unblock" => "unblock",
        "steal" | "pilfer" => "steal",
        "craft" | "make" | "combine" => "craft",
        "use" | "drink" | "ring" => "use",
        "talk" | "chat" | "speak" => "chat",
        "influence" | "persuade" => "influence",
        "cast" | "magic" => "cast",
        "prepare-spell" => "prepare-spell",
        "unprepare-spell" => "unprepare-spell",
        "listen" | "check" => "listen",
        "study" | "analyze" => "study",
        "prepare" | "ready" => "prepare",
        "work" | "repair" => "work",
        "assist" | "aid" => "assist",
        "rest" | "breathe" | "catch" => "rest",
        "shuffle" | "deal" | "more" | "redraw" => "shuffle",
        "grow" | "bank" | "review" | "advance" => "bank",
        "bracelet" | "unlock" => "bracelet",
        "wear" | "equip" => "wear",
        "unwear" | "unequip" | "remove" => "unwear",
        "wield" | "sling" => "equip-item",
        "unwield" | "unsling" => "unequip-item",
        "stow" | "pack" => "stow",
        "unstow" | "unpack" => "unstow",
        "skill" | "train" | "practice" => "skill",
        "bond" | "relationship" | "friendship" => "bond",
        "calling" | "drive" | "purpose" | "revise" => "calling",
        "remember" | "resolve" | "settle" => "resolve",
        "hit" | "attack" | "strike" => "attack",
        "guard" | "defend" => "defend",
        "run" | "flee" | "escape" => "flee",
        "say" => "say",
        "emote" | "me" => "emote",
        "report" | "flag" => "report",
        "drop" => "drop",
        "help" | "?" => "help",
        other => other,
    }
    .to_string()
}

pub(crate) fn canonical_direction(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "n" | "north" => Some("north"),
        "s" | "south" => Some("south"),
        "e" | "east" => Some("east"),
        "w" | "west" => Some("west"),
        "ne" | "northeast" | "north-east" => Some("northeast"),
        "nw" | "northwest" | "north-west" => Some("northwest"),
        "se" | "southeast" | "south-east" => Some("southeast"),
        "sw" | "southwest" | "south-west" => Some("southwest"),
        "u" | "up" => Some("up"),
        "d" | "down" => Some("down"),
        "in" | "inside" | "enter" => Some("in"),
        "out" | "outside" | "exit" | "home" | "homeward" => Some("out"),
        _ => None,
    }
}

pub(crate) fn command_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

pub(crate) fn command_match_score(candidate: &str, query_key: &str) -> Option<u8> {
    let candidate_key = command_key(candidate);
    if candidate_key.is_empty() || query_key.is_empty() {
        None
    } else if candidate_key == query_key {
        Some(0)
    } else if candidate_key.starts_with(query_key) {
        Some(1)
    } else if candidate_key.contains(query_key) {
        Some(2)
    } else {
        None
    }
}

pub(crate) fn trim_command_filler(value: &str) -> &str {
    value
        .trim()
        .trim_start_matches("at ")
        .trim_start_matches("to ")
        .trim_start_matches("with ")
        .trim_start_matches("the ")
        .trim()
}

fn search_query_is_room(query: &str) -> bool {
    let query = trim_command_filler(query);
    query.is_empty()
        || matches!(
            command_key(query).as_str(),
            "room" | "here" | "around" | "location"
        )
}

pub(crate) fn split_direct_indirect<'a>(
    value: &'a str,
    separator: &str,
) -> Option<(&'a str, &'a str)> {
    let needle = format!(" {separator} ");
    value
        .split_once(&needle)
        .map(|(direct, indirect)| (direct.trim(), indirect.trim()))
        .filter(|(direct, indirect)| !direct.is_empty() && !indirect.is_empty())
}

pub(crate) fn command_list_or_none(values: &[String]) -> String {
    if values.is_empty() {
        "none".to_string()
    } else {
        values.join(", ")
    }
}

pub(crate) fn command_action(kind: &str, label: &str, command: &str) -> CommandActionView {
    CommandActionView {
        kind: kind.to_string(),
        label: label.to_string(),
        command: normalize_command_text(command),
    }
}

pub(crate) fn command_error(
    command: &str,
    verb: &str,
    status: u32,
    output: impl Into<String>,
) -> CommandError {
    CommandError {
        command: normalize_command_text(command),
        verb: verb.to_string(),
        status,
        output: output.into(),
    }
}

pub(crate) fn command_action_response_with_events(
    resolved: ResolvedCommand,
    response: ActionResponse,
    leading_events: Vec<EventView>,
) -> Json<CommandResponse> {
    command_action_response_with_prefix_and_events(resolved, response, None, leading_events)
}

pub(crate) fn command_action_response_with_prefix_and_events(
    resolved: ResolvedCommand,
    mut response: ActionResponse,
    prefix: Option<String>,
    leading_events: Vec<EventView>,
) -> Json<CommandResponse> {
    if !leading_events.is_empty() {
        let mut events = leading_events;
        events.extend(response.events);
        response.events = events;
    }
    let output = command_response_output_for_actor(prefix, &response.events, None).or_else(|| {
        (!response.ok).then(|| command_action_failure_output(&resolved, response.status))
    });
    Json(CommandResponse {
        ok: response.ok,
        status: response.status,
        command: resolved.command,
        verb: resolved.verb,
        output,
        action: resolved.action,
        receipt: None,
        events: response.events,
    })
}

pub(crate) fn command_action_failure_output(resolved: &ResolvedCommand, status: u32) -> String {
    if status == RATE_LIMITED_STATUS {
        return "The room needs a breath. Try again in a moment.".to_string();
    }
    if status == 403 {
        return "Your avatar slipped out of reach. Begin again or reconnect your account."
            .to_string();
    }
    if status >= 500 {
        return "That choice got lost before the room could answer. Try once more.".to_string();
    }
    match &resolved.dispatch {
        CommandDispatch::Move { .. } => "That path is not open from here right now.",
        CommandDispatch::Flee { .. } => "The room has calmed; flee is not needed.",
        CommandDispatch::Check => "The room did not catch that Listen. Try once more.",
        CommandDispatch::Study => "There is no authored subject to Study here now.",
        CommandDispatch::Influence { .. } => "That bounded request is no longer available.",
        CommandDispatch::CastSpell { .. } => "That prepared spell cannot be cast right now.",
        CommandDispatch::PickUp { .. } => "Someone moved that item. Look around once more.",
        CommandDispatch::Drop { .. } => "You are not carrying that anymore.",
        CommandDispatch::UseItem { .. } => "That item cannot help there right now.",
        CommandDispatch::GiveItem { .. } => {
            "That gift changed while you were choosing. Check what you carry and who is here."
        }
        CommandDispatch::TradeItem { .. } => {
            "That trade changed while you were choosing. Check what you carry and who is here."
        }
        CommandDispatch::ResolveTransferOffer { .. } => {
            "That transfer offer changed while you were choosing. Check offers again."
        }
        CommandDispatch::SetActorSafety { .. } => {
            "That safety control could not be changed. Check who is nearby."
        }
        CommandDispatch::RequestGift { .. } => "That exact gift request is no longer available.",
        CommandDispatch::Theft { .. } => "That item is no longer a legal theft target.",
        CommandDispatch::Craft { .. } => {
            "That recipe changed. Check what you carry and what is nearby."
        }
        CommandDispatch::Attack { .. } => "There is no need to fight here now.",
        CommandDispatch::ResolveBond { .. } => "There is not a friendship ready to remember yet.",
        CommandDispatch::Defend => "There is no need to guard here now.",
        CommandDispatch::Prepare => "There is nothing here to prepare for right now.",
        CommandDispatch::Work => "That work is not ready for you right now.",
        CommandDispatch::Help => "No one needs that kind of help here right now.",
        CommandDispatch::Rest => "You are already fresh enough to keep going.",
        CommandDispatch::UnlockCharmSlot => {
            "That loadout need changed. Check Deck & Loadout for a specific charm."
        }
        CommandDispatch::SetCharmEquipped { .. } => {
            "That charm loadout changed while you were choosing. Check your carried deck."
        }
        CommandDispatch::SetSpellPrepared { .. } => {
            "That spell loadout changed while you were choosing. Check your spell deck."
        }
        CommandDispatch::SetItemEquipped { .. } => {
            "That equipment slot changed while you were choosing. Check your deck."
        }
        CommandDispatch::SetItemContained { .. } => {
            "Those container contents changed while you were choosing. Check your deck."
        }
        CommandDispatch::ReviseCalling { .. } => "That purpose cannot change just now.",
        CommandDispatch::CreateBond { .. } => "There is not a friendship ready to grow just now.",
        CommandDispatch::ReviseBond { .. } => "That friendship cannot change right now.",
        CommandDispatch::TrainSkill { .. } => {
            "Earn advancement through play, then you can practice that knack."
        }
        CommandDispatch::Say { .. } | CommandDispatch::Emote { .. } => {
            "The room did not hear that. Try once more."
        }
        CommandDispatch::Report { .. } => "That report did not reach us. Try once more.",
        CommandDispatch::Read { .. }
        | CommandDispatch::Disabled { .. }
        | CommandDispatch::SearchFeature { .. }
        | CommandDispatch::UseFeature { .. } => {
            "Nothing happened. Look around and try another choice."
        }
    }
    .to_string()
}

pub(crate) fn command_rate_limited_response_with_events(
    resolved: ResolvedCommand,
    events: Vec<EventView>,
) -> Json<CommandResponse> {
    Json(CommandResponse {
        ok: false,
        status: crate::RATE_LIMITED_STATUS,
        command: resolved.command,
        verb: resolved.verb,
        output: Some("The room needs a breath. Try again in a moment.".to_string()),
        action: resolved.action,
        receipt: None,
        events,
    })
}

#[cfg(test)]
pub(crate) fn command_response_output(
    prefix: Option<String>,
    events: &[EventView],
) -> Option<String> {
    command_response_output_for_actor(prefix, events, None)
}

pub(crate) fn command_response_output_for_actor(
    prefix: Option<String>,
    events: &[EventView],
    actor_id: Option<u64>,
) -> Option<String> {
    let mut lines = Vec::new();
    if let Some(prefix) = prefix.map(|value| value.trim().to_string()) {
        if !prefix.is_empty() {
            lines.push(prefix);
        }
    }
    let scoped_actor_id = actor_id.or_else(|| {
        events
            .iter()
            .find(|event| command_event_output(event).is_some())
            .and_then(|event| event.actor_id)
    });
    let actor_events = scoped_actor_id
        .map(|id| {
            events
                .iter()
                .filter(|event| event.actor_id == Some(id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let output_events: Vec<&EventView> = if actor_events
        .iter()
        .any(|event| command_event_output(event).is_some())
    {
        actor_events
    } else {
        events.iter().collect()
    };
    for event in output_events {
        let Some(line) = command_event_output(event) else {
            continue;
        };
        if !lines.iter().any(|existing| existing == &line) {
            lines.push(line);
        }
    }
    (!lines.is_empty()).then(|| lines.join("\n"))
}

pub(crate) fn command_event_output(event: &EventView) -> Option<String> {
    match event.type_name.as_str() {
        "message.created" => event.content.clone(),
        "transfer.offer_created"
        | "transfer.offer_declined"
        | "transfer.offer_withdrawn"
        | "transfer.offer_unchanged"
        | "gift.requested"
        | "actor.safety_changed" => event.content.clone(),
        "hand.shuffled" => Some("You draw a new hand.".to_string()),
        "feature.searched" => Some(format!(
            "You search {}.",
            event_content_part(event, 0).unwrap_or("a room feature")
        )),
        "location.searched" => Some(format!(
            "You search {}.",
            event.location_name.as_deref().unwrap_or("the location")
        )),
        "exit.discovered" => Some(event.content.clone().unwrap_or_else(|| {
            format!(
                "You discover a way to {}.",
                event
                    .destination_location_name
                    .as_deref()
                    .unwrap_or("somewhere new")
            )
        })),
        "item.found" => Some(format!(
            "You find {}.",
            event.item_name.as_deref().unwrap_or("an item")
        )),
        "actor.moved" => Some(format!(
            "You move from {} to {}.",
            event.location_name.as_deref().unwrap_or("here"),
            event
                .destination_location_name
                .as_deref()
                .unwrap_or("there")
        )),
        "combat.flee.success" => Some(format!(
            "You flee to {}.",
            event
                .destination_location_name
                .as_deref()
                .unwrap_or("safety")
        )),
        "item.picked_up" => Some(format!(
            "You take {}.",
            event.item_name.as_deref().unwrap_or("the item")
        )),
        "item.dropped" => Some(format!(
            "You drop {}.",
            event.item_name.as_deref().unwrap_or("the item")
        )),
        "item.used" => {
            if let Some(content) = event
                .content
                .as_deref()
                .map(strip_feature_use_reason)
                .filter(|content| !content.is_empty())
            {
                return Some(content.to_string());
            }
            let target = event
                .target_actor_name
                .as_deref()
                .map(|name| format!(" on {name}"))
                .unwrap_or_default();
            let recovery = event
                .damage
                .filter(|damage| *damage < 0)
                .map(|_| {
                    format!(
                        " {} looks steadier.",
                        event.target_actor_name.as_deref().unwrap_or("Someone")
                    )
                })
                .unwrap_or_default();
            Some(format!(
                "You use {}{target}.{recovery}",
                event.item_name.as_deref().unwrap_or("the item")
            ))
        }
        "item.given" => {
            let returned = event
                .target_item_name
                .as_deref()
                .map(|item| format!(", who hands you {item} to make room"))
                .unwrap_or_default();
            Some(format!(
                "You give {} to {}{returned}.",
                event.item_name.as_deref().unwrap_or("the item"),
                event.target_actor_name.as_deref().unwrap_or("someone")
            ))
        }
        "item.traded" => Some(format!(
            "You trade {} to {} for {}.",
            event.item_name.as_deref().unwrap_or("the item"),
            event.target_actor_name.as_deref().unwrap_or("someone"),
            event.target_item_name.as_deref().unwrap_or("another item")
        )),
        "item.theft_attempt" if !event.success => Some(format!(
            "You fail to take {} from {}; possession does not change, and the attempt is noticed.",
            event.item_name.as_deref().unwrap_or("the item"),
            event.target_actor_name.as_deref().unwrap_or("the avatar")
        )),
        "item.theft_attempt" => None,
        "item.stolen" => Some(format!(
            "You steal {} from {}; the transfer is recorded and visible.",
            event.item_name.as_deref().unwrap_or("the item"),
            event.target_actor_name.as_deref().unwrap_or("the avatar")
        )),
        "item.crafted" => Some(format!(
            "You craft with {} and {}.",
            event.item_name.as_deref().unwrap_or("one item"),
            event.target_item_name.as_deref().unwrap_or("another item")
        )),
        "item.created" => Some(format!(
            "{} joins the world.",
            event.item_name.as_deref().unwrap_or("Something new")
        )),
        "charm_slot.unlocked" => Some(
            "You open bracelet space for another skill charm; no charm is granted.".to_string(),
        ),
        "skill_charm.equipped" => Some(format!(
            "You wear {} on your bracelet.",
            event.item_name.as_deref().unwrap_or("a skill charm")
        )),
        "skill_charm.unequipped" => Some(format!(
            "You remove {} from your bracelet.",
            event.item_name.as_deref().unwrap_or("a skill charm")
        )),
        "spell.prepared" => Some(format!(
            "You prepare {} in your spell deck.",
            event.item_name.as_deref().unwrap_or("a spell card")
        )),
        "spell.unprepared" => Some(format!(
            "You remove {} from your prepared spell deck.",
            event.item_name.as_deref().unwrap_or("a spell card")
        )),
        "item.equipped" => Some(format!(
            "You equip {}.",
            event.item_name.as_deref().unwrap_or("the item")
        )),
        "item.unequipped" => Some(format!(
            "You unequip {}.",
            event.item_name.as_deref().unwrap_or("the item")
        )),
        "item.contained" => Some(format!(
            "You stow {}.",
            event.item_name.as_deref().unwrap_or("the item")
        )),
        "item.uncontained" => Some(format!(
            "You take {} out.",
            event.item_name.as_deref().unwrap_or("the item")
        )),
        "magic.spell_cast" => Some(format!(
            "You cast {}.",
            event.item_name.as_deref().unwrap_or("the prepared spell")
        )),
        "influence.committed" => event.content.clone(),
        "ability_check.rolled" => Some(if event.success {
            "You listen closely, and the room answers.".to_string()
        } else {
            "You listen closely, but the room keeps its secret.".to_string()
        }),
        "clock.updated" => Some(format!(
            "{} {}.",
            event
                .clock_label
                .as_deref()
                .unwrap_or("Something in the room"),
            if event.clock_filled.unwrap_or(0) >= event.clock_segments.unwrap_or(1) {
                "comes due"
            } else {
                "draws closer"
            }
        )),
        "tag.applied" => Some(format!(
            "You are now {}.",
            event.tag_label.as_deref().unwrap_or("changed")
        )),
        "tag.cleared" => Some(format!(
            "You shake off {}.",
            event.tag_label.as_deref().unwrap_or("what was lingering")
        )),
        "ledger.marked" => Some(format!(
            "A moment stays with you: {}.",
            event_content_part(event, 1).unwrap_or("this visit")
        )),
        "ledger.banked" => Some("You let what happened shape what comes next.".to_string()),
        "advancement.spent" => None,
        "skill.stepped" => {
            let skill = event_content_part(event, 0).unwrap_or("A knack");
            let rank = event_content_part(event, 1)
                .and_then(|value| value.parse::<u8>().ok())
                .unwrap_or(1);
            Some(if rank >= 3 {
                format!("{skill} feels second nature.")
            } else if rank == 2 {
                format!("{skill} grows stronger.")
            } else {
                format!("{skill} grows a little stronger.")
            })
        }
        "calling.set" => Some(format!(
            "You choose what calls you: {}.",
            event_calling_text(event).unwrap_or("a small truth")
        )),
        "calling.revised" => Some(format!(
            "What calls you changes: {}.",
            event_calling_text(event).unwrap_or("a small truth")
        )),
        "bond.deepened" => Some(format!(
            "You grow closer to {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "bond.created" => Some(format!(
            "You become friends with {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "bond.revised" => Some(format!(
            "What {} means to you changes.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "bond.resolved" => Some(format!(
            "You keep what mattered with {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "job.updated" => Some(
            match event
                .content
                .as_deref()
                .and_then(|content| content.rsplitn(3, ':').nth(1))
                .unwrap_or("changed")
            {
                "complete" | "completed" => "The work is done.",
                "active" => "The work begins.",
                "failed" => "The work falls quiet for now.",
                _ => "The work changes.",
            }
            .to_string(),
        ),
        "world.logistics.completed" => event
            .content
            .as_deref()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
            .and_then(|evidence| {
                evidence
                    .get("summary")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| Some("A physical delivery is completed.".to_string())),
        "combat.defend" => Some("You raise a careful guard.".to_string()),
        "combat.encounter.started" => Some(format!(
            "The scuffle with {} begins.",
            event.target_actor_name.as_deref().unwrap_or("the danger")
        )),
        "combat.participant.joined"
        | "combat.initiative.rolled"
        | "combat.turn.started"
        | "combat.turn.ended" => None,
        "combat.dodge" => Some("You focus entirely on staying clear.".to_string()),
        "combat.attack.attempt" => None,
        "combat.attack.hit" => Some(format!(
            "You break through {}'s guard.",
            event.target_actor_name.as_deref().unwrap_or("the target")
        )),
        "combat.attack.miss" => Some(format!(
            "{} turns the strike aside.",
            event.target_actor_name.as_deref().unwrap_or("The target")
        )),
        "combat.knockout" => Some(format!(
            "{}'s light falls quiet for now.",
            event.target_actor_name.as_deref().unwrap_or("The target")
        )),
        "combat.encounter.resolved" => Some(if event.total == Some(1) {
            "The danger yields, and the scuffle is over.".to_string()
        } else {
            "The scuffle is over for now.".to_string()
        }),
        "rule.rejected" => Some("The room will not let that happen just now.".to_string()),
        _ => None,
    }
}

fn strip_feature_use_reason(content: &str) -> &str {
    content.strip_suffix(":use_feature").unwrap_or(content)
}

fn event_content_part(event: &EventView, index: usize) -> Option<&str> {
    event
        .content
        .as_deref()?
        .split(':')
        .nth(index)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn event_calling_text(event: &EventView) -> Option<&str> {
    event
        .content
        .as_deref()
        .map(|content| {
            content
                .rsplit_once(':')
                .map(|(text, _)| text)
                .unwrap_or(content)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

#[derive(Clone, Debug)]
struct FeatureUseResult {
    feature_key: String,
    feature_name: String,
    output: String,
    matched: bool,
}

fn clock_summary(clock: &ClockView) -> String {
    let feeling = if clock.segments > 0 && clock.filled >= clock.segments {
        "comes due"
    } else if clock.filled == 0 {
        "is only just beginning"
    } else if clock.filled.saturating_mul(2) >= clock.segments {
        "draws close"
    } else {
        "is taking shape"
    };
    format!("{} — {feeling}", clock.label)
}

fn room_zone_feeling(zone: &str) -> &'static str {
    match zone {
        ZONE_SANCTUARY => "safe and welcoming",
        ZONE_FRONTIER => "a little wild around the edges",
        _ => "full of its own small character",
    }
}

fn journal_memory_summary(ledger: &VisitLedgerView) -> Option<&'static str> {
    match (
        ledger.unbanked_count > 0,
        ledger.advancement_points > 0,
        ledger.banked_count > 0,
    ) {
        (true, true, _) => Some(
            "Your journal holds something new, and a kept memory is ready to shape what comes next.",
        ),
        (true, false, _) => Some(
            "Your journal holds an older unsettled memory. Your next successful discovery will settle it automatically.",
        ),
        (false, true, _) => {
            Some("A kept memory is ready to shape a knack or friendship.")
        }
        (false, false, true) => {
            Some("Your journal carries the memories that have already shaped you.")
        }
        (false, false, false) => None,
    }
}

fn tag_belongs_in_room_description(tag: &TagView) -> bool {
    !matches!(
        tag.label.trim().to_ascii_lowercase().as_str(),
        "searched location"
            | "frontier travel"
            | "prepared"
            | "spent preparation"
            | "helped"
            | "trained"
            | "purpose changed"
            | "friendship changed"
    )
}

impl RuntimeWorld {
    #[cfg(test)]
    pub(crate) fn resolve_command(
        &self,
        payload: &CommandRequest,
        access: &AccessContext,
    ) -> Result<ResolvedCommand, CommandError> {
        self.resolve_command_with_presence(payload, access, None)
    }

    pub(crate) fn resolve_command_with_presence(
        &self,
        payload: &CommandRequest,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<ResolvedCommand, CommandError> {
        let command = normalize_command_text(&payload.command);
        if command.is_empty() {
            return Err(command_error(
                "",
                "",
                400,
                "Try look, search, who, go Rain-Soft Garden, take Story Button, or chat Rati.",
            ));
        }
        let (raw_verb, rest) = command_verb_and_rest(&command);
        let direction_verb = canonical_direction(&raw_verb);
        let verb = if raw_verb == "revise"
            && rest.trim_start().strip_prefix("bond").is_some_and(|tail| {
                tail.is_empty() || tail.chars().next().is_some_and(char::is_whitespace)
            }) {
            "bond".to_string()
        } else {
            canonical_command_verb(&raw_verb)
        };
        let rest = if verb == "go" && rest.is_empty() {
            direction_verb.unwrap_or(rest)
        } else {
            rest
        };
        let Some(actor) = self.actor_by_id(payload.actor_id) else {
            return Err(command_error(
                &command,
                &verb,
                404,
                "That avatar is not in the world.",
            ));
        };
        if !Self::actor_is_active_avatar(actor) {
            return Err(command_error(
                &command,
                &verb,
                403,
                "Only your active avatar can act here.",
            ));
        }

        match verb.as_str() {
            "help" => Ok(ResolvedCommand {
                command,
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                            output: "Try: look, search, study, who, deck, wear <skill charm>, remove <skill charm>, wield <weapon-or-bag>, unwield <weapon-or-bag>, stow <item> in <bag>, unstow <item>, prepare-spell <spell>, unprepare-spell <spell>, cast <spell>, go <place>, say <message>, emote <action>, take <item>, drop <item>, give <item> to <avatar>, request <item> from <avatar>, trade <item> with <avatar> for <item>, offers, accept <offer>, decline <offer>, withdraw <offer>, mute <avatar>, unmute <avatar>, block <avatar>, unblock <avatar>, use <item> on <target>, chat <avatar>, influence <avatar>, listen, prepare, work, assist, rest, more, purpose <what draws you in>, friendship <avatar>: <why they matter>, remember <avatar>, attack <target>, defend, flee <place>, pass, need time, or report <actor>: <reason>.".to_string(),
                },
            }),
            "look" => Ok(ResolvedCommand {
                command: command.clone(),
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                    output: self
                        .look_command_output(actor, rest, access, active_direct_actor_ids)
                        .map_err(|output| command_error(&command, "look", 404, output))?,
                },
            }),
            "search" => {
                let Some(target) = self.default_search_target(actor.id) else {
                    return Ok(ResolvedCommand {
                        command: command.clone(),
                        verb,
                        action: Some(command_action("search", "Search", &command)),
                        dispatch: CommandDispatch::Read {
                            output: self.search_command_output(actor, rest).map_err(|output| {
                                command_error(&command, "search", 404, output)
                            })?,
                        },
                    });
                };
                let candidates =
                    self.search_reveal_candidates_for_feature(actor.location_id, &target.key);
                if candidates.is_empty() && target.key == "room" {
                    let output = if self.room_floor_empty(actor.location_id) {
                        "This room has shared everything it is ready to share."
                    } else {
                        "Something is already waiting here. Pick it up, use it, or pass it on before looking for another keepsake."
                    };
                    return Ok(ResolvedCommand {
                        command: command.clone(),
                        verb,
                        action: Some(command_action("search", "Search", &command)),
                        dispatch: CommandDispatch::Disabled {
                            status: if self.room_floor_empty(actor.location_id) {
                                404
                            } else {
                                409
                            },
                            output: output.to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("search", "Search", &command)),
                    dispatch: CommandDispatch::SearchFeature {
                        location_id: target.location_id,
                        feature_key: target.key,
                        feature_name: target.name,
                        output: target.output,
                    },
                })
            }
            "inventory" => Ok(ResolvedCommand {
                command,
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                    output: self.inventory_command_output(actor.id),
                },
            }),
            "bracelet" => {
                if rest.trim().is_empty() {
                    return Ok(ResolvedCommand {
                        command: "bracelet".to_string(),
                        verb,
                        action: None,
                        dispatch: CommandDispatch::Read {
                            output: self.inventory_command_output(actor.id),
                        },
                    });
                }
                let Some(charm) = self.charm_slot_expansion_candidate(actor.id) else {
                    return Ok(ResolvedCommand {
                        command: "bracelet unlock".to_string(),
                        verb,
                        action: None,
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Deck & Loadout offers bracelet space only when every current slot is full, you carry a specific unworn charm, earned advancement is ready, and the bracelet is below its cap.".to_string(),
                        },
                    });
                };
                let charm_name = self
                    .item_name(charm.id)
                    .unwrap_or_else(|| format!("Item {}", charm.id));
                let label = format!("Make room for {charm_name}");
                Ok(ResolvedCommand {
                    command: format!("bracelet make room for {charm_name}"),
                    verb,
                    action: Some(command_action(
                        "unlock_charm_slot",
                        &label,
                        &format!("bracelet make room for {charm_name}"),
                    )),
                    dispatch: CommandDispatch::UnlockCharmSlot,
                })
            }
            "wear" | "unwear" => {
                let equipped = verb == "wear";
                let item_query = rest
                    .strip_prefix("charm ")
                    .unwrap_or(rest)
                    .trim();
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                let item_view = self.item_view(item);
                if item_view.role != "skill_charm" {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action(
                            "set_charm_equipped",
                            if equipped { "Wear Charm" } else { "Remove Charm" },
                            &payload.command,
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("{} is not a skill charm.", item_view.name),
                        },
                    });
                }
                let command = format!(
                    "{} {}",
                    if equipped { "wear" } else { "remove" },
                    item_view.name
                );
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action(
                        "set_charm_equipped",
                        if equipped { "Wear Charm" } else { "Remove Charm" },
                        &command,
                    )),
                    dispatch: CommandDispatch::SetCharmEquipped {
                        item_id: item.id,
                        equipped,
                    },
                })
            }
            "prepare-spell" | "unprepare-spell" => {
                let prepared = verb == "prepare-spell";
                let item = self
                    .resolve_held_item(actor.id, rest.trim())
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                let item_view = self.item_view(item);
                if item_view.role != "spell" {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action(
                            "set_spell_prepared",
                            if prepared { "Prepare Spell" } else { "Unprepare Spell" },
                            &payload.command,
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("{} is not a spell card.", item_view.name),
                        },
                    });
                }
                if prepared
                    && self
                        .prepared_spells
                        .get(&actor.id)
                        .is_some_and(|spells| spells.len() >= 3 && !spells.contains(&item.id))
                {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action(
                            "set_spell_prepared",
                            "Prepare Spell",
                            &payload.command,
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Your three spell-deck slots are already prepared.".to_string(),
                        },
                    });
                }
                let command = format!(
                    "{} {}",
                    if prepared { "prepare-spell" } else { "unprepare-spell" },
                    item_view.name
                );
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action(
                        "set_spell_prepared",
                        if prepared { "Prepare Spell" } else { "Unprepare Spell" },
                        &command,
                    )),
                    dispatch: CommandDispatch::SetSpellPrepared {
                        item_id: item.id,
                        prepared,
                    },
                })
            }
            "equip-item" | "unequip-item" => {
                let equipped = verb == "equip-item";
                let item = self
                    .resolve_held_item(actor.id, rest.trim())
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                if !matches!(item.role, CW_ITEM_ROLE_WEAPON | CW_ITEM_ROLE_CONTAINER) {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("set_item_equipped", "Equip", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Only a weapon or container card uses this equipment command."
                                .to_string(),
                        },
                    });
                }
                let item_name = self.item_name(item.id).unwrap_or_else(|| format!("Item {}", item.id));
                let command = format!("{} {item_name}", if equipped { "wield" } else { "unwield" });
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action(
                        "set_item_equipped",
                        if equipped { "Equip" } else { "Unequip" },
                        &command,
                    )),
                    dispatch: CommandDispatch::SetItemEquipped {
                        item_id: item.id,
                        equipped,
                    },
                })
            }
            "stow" => {
                let (item_query, container_query) = split_direct_indirect(rest, "in")
                    .or_else(|| split_direct_indirect(rest, "into"))
                    .ok_or_else(|| command_error(&command, &verb, 400, "Try stow <item> in <bag>."))?;
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                let container = self
                    .resolve_held_item(actor.id, container_query)
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                let item_name = self.item_name(item.id).unwrap_or_else(|| format!("Item {}", item.id));
                let container_name = self.item_name(container.id).unwrap_or_else(|| format!("Item {}", container.id));
                let command = format!("stow {item_name} in {container_name}");
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("set_item_contained", "Stow", &command)),
                    dispatch: CommandDispatch::SetItemContained {
                        item_id: item.id,
                        container_item_id: Some(container.id),
                    },
                })
            }
            "unstow" => {
                let item = self
                    .resolve_held_item(actor.id, rest.trim())
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                let item_name = self.item_name(item.id).unwrap_or_else(|| format!("Item {}", item.id));
                let command = format!("unstow {item_name}");
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("set_item_contained", "Take out", &command)),
                    dispatch: CommandDispatch::SetItemContained {
                        item_id: item.id,
                        container_item_id: None,
                    },
                })
            }
            "who" => Ok(ResolvedCommand {
                command,
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                    output: self.who_command_output(
                        actor.location_id,
                        Some(actor.id),
                        active_direct_actor_ids,
                    ),
                },
            }),
            "go" => {
                let destination = self.resolve_exit_destination(actor, rest, access).map_err(|output| {
                    command_error(&command, "go", 404, output)
                })?;
                Ok(ResolvedCommand {
                    command: format!("go {}", self.location_name(destination).unwrap_or_else(|| destination.to_string())),
                    verb,
                    action: Some(command_action("move", "Travel", &format!("go {}", self.location_name(destination).unwrap_or_else(|| destination.to_string())))),
                    dispatch: CommandDispatch::Move {
                        destination_location_id: destination,
                    },
                })
            }
            "flee" => {
                if !self.location_has_unresolved_combat(actor.location_id) {
                    return Ok(ResolvedCommand {
                        command: "flee".to_string(),
                        verb,
                        action: Some(command_action("flee", "Flee", "flee")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is nothing to flee from here.".to_string(),
                        },
                    });
                }
                let destination = if rest.trim().is_empty() {
                    self.first_accessible_exit(actor.location_id, access)
                        .ok_or_else(|| command_error(&command, "flee", 404, "There is nowhere clear to flee."))?
                } else {
                    self.resolve_exit_destination(actor, rest, access).map_err(|output| {
                        command_error(&command, "flee", 404, output)
                    })?
                };
                Ok(ResolvedCommand {
                    command: format!("flee {}", self.location_name(destination).unwrap_or_else(|| destination.to_string())),
                    verb,
                    action: Some(command_action("flee", "Flee", &format!("flee {}", self.location_name(destination).unwrap_or_else(|| destination.to_string())))),
                    dispatch: CommandDispatch::Flee {
                        destination_location_id: destination,
                    },
                })
            }
            "take" => {
                let item = self
                    .resolve_room_item(actor.location_id, rest)
                    .map_err(|output| command_error(&command, "take", 404, output))?;
                let item_name = self.item_name(item.id).unwrap_or_else(|| item.id.to_string());
                Ok(ResolvedCommand {
                    command: format!("take {item_name}"),
                    verb,
                    action: Some(command_action("pick_up", "Take", &format!("take {item_name}"))),
                    dispatch: CommandDispatch::PickUp { item_id: item.id },
                })
            }
            "drop" => {
                let item = self
                    .resolve_held_item(actor.id, rest)
                    .map_err(|output| command_error(&command, "drop", 404, output))?;
                let item_name = self.item_name(item.id).unwrap_or_else(|| item.id.to_string());
                Ok(ResolvedCommand {
                    command: format!("drop {item_name}"),
                    verb,
                    action: Some(command_action("drop_item", "Drop", &format!("drop {item_name}"))),
                    dispatch: CommandDispatch::Drop { item_id: item.id },
                })
            }
            "request" => {
                let (item_query, holder_query) = split_direct_indirect(rest, "from").ok_or_else(
                    || {
                        command_error(
                            &command,
                            "request",
                            400,
                            "Use: request <item> from <avatar>.",
                        )
                    },
                )?;
                let holder = self
                    .resolve_room_actor(
                        actor,
                        holder_query,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "request", 404, output))?;
                let item = self
                    .resolve_actor_held_item(
                        holder.id,
                        item_query,
                        "That avatar is not holding an item matching your request.",
                    )
                    .map_err(|output| command_error(&command, "request", 404, output))?;
                if self.actors_blocked(actor.id, holder.id)
                    || !self.actor_can_receive_item(actor, item.id)
                {
                    return Err(command_error(
                        &command,
                        "request",
                        409,
                        "That exact gift request is not available.",
                    ));
                }
                let holder_name = self
                    .actor_name(holder.id)
                    .unwrap_or_else(|| format!("Avatar {}", holder.id));
                let item_name = self
                    .item_name(item.id)
                    .unwrap_or_else(|| format!("Item {}", item.id));
                Ok(ResolvedCommand {
                    command: format!("request {item_name} from {holder_name}"),
                    verb,
                    action: Some(command_action(
                        "request_gift",
                        "Request gift",
                        &format!("request {item_name} from {holder_name}"),
                    )),
                    dispatch: CommandDispatch::RequestGift {
                        offered_by_actor_id: holder.id,
                        item_id: item.id,
                    },
                })
            }
            "offers" => {
                let mut offers = self
                    .transfer_offers
                    .values()
                    .filter(|offer| {
                        self.transfer_offer_status(offer) == TransferOfferStatus::Pending
                            && (offer.offered_by_actor_id == actor.id
                                || offer.offered_to_actor_id == actor.id)
                    })
                    .collect::<Vec<_>>();
                offers.sort_by(|left, right| left.id.cmp(&right.id));
                let output = if offers.is_empty() {
                    "You have no pending transfer offers.".to_string()
                } else {
                    offers
                        .into_iter()
                        .map(|offer| {
                            let from = self
                                .actor_name(offer.offered_by_actor_id)
                                .unwrap_or_else(|| {
                                    format!("Avatar {}", offer.offered_by_actor_id)
                                });
                            let to = self
                                .actor_name(offer.offered_to_actor_id)
                                .unwrap_or_else(|| {
                                    format!("Avatar {}", offer.offered_to_actor_id)
                                });
                            let item = self
                                .item_name(offer.offered_item_id)
                                .unwrap_or_else(|| format!("Item {}", offer.offered_item_id));
                            let exchange = offer
                                .requested_item_id
                                .and_then(|id| self.item_name(id))
                                .map(|requested| format!(" for {requested}"))
                                .unwrap_or_default();
                            format!("{}: {from} offers {item}{exchange} to {to}.", offer.id)
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                };
                Ok(ResolvedCommand {
                    command,
                    verb,
                    action: None,
                    dispatch: CommandDispatch::Read { output },
                })
            }
            "accept" | "decline" | "withdraw" => {
                let mut candidates = self
                    .transfer_offers
                    .values()
                    .filter(|offer| {
                        self.transfer_offer_status(offer) == TransferOfferStatus::Pending
                            && if verb == "withdraw" {
                                offer.offered_by_actor_id == actor.id
                            } else {
                                offer.offered_to_actor_id == actor.id
                            }
                    })
                    .filter(|offer| {
                        rest.is_empty()
                            || offer.id.eq_ignore_ascii_case(rest)
                            || offer.id.starts_with(rest)
                    })
                    .collect::<Vec<_>>();
                candidates.sort_by(|left, right| left.id.cmp(&right.id));
                let offer = match candidates.as_slice() {
                    [offer] => *offer,
                    [] => {
                        return Err(command_error(
                            &command,
                            &verb,
                            404,
                            "No matching pending transfer offer was found. Try offers.",
                        ));
                    }
                    _ => {
                        return Err(command_error(
                            &command,
                            &verb,
                            409,
                            "More than one offer matches. Use the full offer id shown by offers.",
                        ));
                    }
                };
                Ok(ResolvedCommand {
                    command: format!("{verb} {}", offer.id),
                    verb: verb.clone(),
                    action: Some(command_action(
                        "transfer_offer",
                        match verb.as_str() {
                            "accept" => "Accept",
                            "decline" => "Decline",
                            _ => "Withdraw",
                        },
                        &format!("{verb} {}", offer.id),
                    )),
                    dispatch: CommandDispatch::ResolveTransferOffer {
                        offer_id: offer.id.clone(),
                        decision: verb,
                    },
                })
            }
            "mute" | "unmute" | "block" | "unblock" => {
                let target = self
                    .resolve_room_actor(
                        actor,
                        rest,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, &verb, 404, output))?;
                if target.id == actor.id {
                    return Err(command_error(
                        &command,
                        &verb,
                        400,
                        "Choose another nearby avatar.",
                    ));
                }
                let control = if verb.contains("mute") {
                    ActorSafetyControl::Mute
                } else {
                    ActorSafetyControl::Block
                };
                let enabled = !verb.starts_with("un");
                let target_name = self
                    .actor_name(target.id)
                    .unwrap_or_else(|| format!("Avatar {}", target.id));
                Ok(ResolvedCommand {
                    command: format!("{verb} {target_name}"),
                    verb: verb.clone(),
                    action: Some(command_action(
                        "actor_safety",
                        if enabled { "Set safety" } else { "Clear safety" },
                        &format!("{verb} {target_name}"),
                    )),
                    dispatch: CommandDispatch::SetActorSafety {
                        target_actor_id: target.id,
                        control,
                        enabled,
                    },
                })
            }
            "give" => {
                let (item_query, target_query) = split_direct_indirect(rest, "to")
                    .ok_or_else(|| command_error(&command, "give", 400, "Use: give <item> to <avatar>."))?;
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, "give", 404, output))?;
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|_| {
                        command_error(
                            &command,
                            "give",
                            404,
                            self.actor_not_nearby_output(
                                actor,
                                target_query,
                                CommandActorFilter::ActiveActor,
                                active_direct_actor_ids,
                            ),
                        )
                    })?;
                let item_name = self.item_name(item.id).unwrap_or_else(|| item.id.to_string());
                let target_name = self.actor_view(target).name;
                Ok(ResolvedCommand {
                    command: format!("give {item_name} to {target_name}"),
                    verb,
                    action: Some(command_action("give_item", "Give Item", &format!("give {item_name} to {target_name}"))),
                    dispatch: CommandDispatch::GiveItem {
                        item_id: item.id,
                        target_actor_id: target.id,
                    },
                })
            }
            "trade" => {
                let (item_query, trade_tail) = split_direct_indirect(rest, "with")
                    .ok_or_else(|| command_error(&command, "trade", 400, "Use: trade <item> with <avatar> for <item>."))?;
                let (target_query, target_item_query) = split_direct_indirect(trade_tail, "for")
                    .ok_or_else(|| command_error(&command, "trade", 400, "Use: trade <item> with <avatar> for <item>."))?;
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, "trade", 404, output))?;
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|_| {
                        command_error(
                            &command,
                            "trade",
                            404,
                            self.actor_not_nearby_output(
                                actor,
                                target_query,
                                CommandActorFilter::ActiveActor,
                                active_direct_actor_ids,
                            ),
                        )
                    })?;
                let target_item = self
                    .resolve_actor_held_item(
                        target.id,
                        target_item_query,
                        "That avatar is not holding an item that matches that command.",
                    )
                    .map_err(|output| command_error(&command, "trade", 404, output))?;
                if self.actor_control_mode(target.id).is_direct_input() {
                    self.actor_trade_is_legal(actor.id, target.id, item.id, target_item.id)
                        .map_err(|output| command_error(&command, "trade", 409, output))?;
                } else {
                    self.resident_trade_is_willing(actor.id, target.id, item.id, target_item.id)
                        .map_err(|output| command_error(&command, "trade", 409, output))?;
                }
                let item_name = self.item_name(item.id).unwrap_or_else(|| item.id.to_string());
                let target_name = self.actor_view(target).name;
                let target_item_name = self
                    .item_name(target_item.id)
                    .unwrap_or_else(|| target_item.id.to_string());
                Ok(ResolvedCommand {
                    command: format!("trade {item_name} with {target_name} for {target_item_name}"),
                    verb,
                    action: Some(command_action(
                        "trade_item",
                        "Trade",
                        &format!("trade {item_name} with {target_name} for {target_item_name}"),
                    )),
                    dispatch: CommandDispatch::TradeItem {
                        item_id: item.id,
                        target_actor_id: target.id,
                        target_item_id: target_item.id,
                    },
                })
            }
            "steal" => {
                let (target, item) = if rest.trim().is_empty() {
                    self.default_theft_candidate(actor.id).ok_or_else(|| {
                        command_error(&command, "steal", 409, "There is no eligible carried item to steal here.")
                    })?
                } else {
                    let (item_query, target_query) = split_direct_indirect(rest, "from")
                        .ok_or_else(|| command_error(&command, "steal", 400, "Use: steal <item> from <avatar>."))?;
                    let target = self
                        .resolve_room_actor(
                            actor,
                            target_query,
                            CommandActorFilter::ActiveActor,
                            active_direct_actor_ids,
                        )
                        .map_err(|output| command_error(&command, "steal", 404, output))?;
                    let item = self
                        .resolve_actor_held_item(
                            target.id,
                            item_query,
                            "That avatar is not carrying an item that matches that command.",
                        )
                        .map_err(|output| command_error(&command, "steal", 404, output))?;
                    let legal = self
                        .default_theft_candidate(actor.id)
                        .is_some_and(|(candidate_target, candidate_item)| {
                            candidate_target.id == target.id && candidate_item.id == item.id
                        });
                    if !legal {
                        return Ok(ResolvedCommand {
                            command,
                            verb,
                            action: Some(command_action("theft", "Steal", &payload.command)),
                            dispatch: CommandDispatch::Disabled {
                                status: 409,
                                output: "That possession is protected, too large, or not the current authored theft target."
                                    .to_string(),
                            },
                        });
                    }
                    (target, item)
                };
                let item_name = self.item_name(item.id).unwrap_or_else(|| format!("Item {}", item.id));
                let target_name = self.actor_name(target.id).unwrap_or_else(|| format!("Avatar {}", target.id));
                let command = format!("steal {item_name} from {target_name}");
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("theft", "Steal", &command)),
                    dispatch: CommandDispatch::Theft {
                        item_id: item.id,
                        target_actor_id: target.id,
                    },
                })
            }
            "craft" => {
                let recipe = if rest.trim().is_empty() {
                    self.default_craft_recipe(actor.id)
                } else {
                    let query_key = command_key(rest);
                    active_content().recipes.iter().find(|recipe| {
                        recipe.id.to_string() == query_key
                            || command_key(&recipe.key) == query_key
                            || command_key(&recipe.name) == query_key
                    })
                }
                .ok_or_else(|| {
                    command_error(
                        &command,
                        "craft",
                        404,
                        "No recipe matches what you carry and what is nearby.",
                    )
                })?;
                if self.craft_action_for_recipe(actor.id, recipe.id).is_none() {
                    return Ok(ResolvedCommand {
                        command: format!("craft {}", recipe.name),
                        verb,
                        action: Some(command_action(
                            "craft",
                            "Craft",
                            &format!("craft {}", recipe.name),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Keep one ingredient with you and leave the other nearby; there also needs to be room for what you make.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("craft {}", recipe.name),
                    verb,
                    action: Some(command_action(
                        "craft",
                        "Craft",
                        &format!("craft {}", recipe.name),
                    )),
                    dispatch: CommandDispatch::Craft {
                        recipe_id: recipe.id,
                    },
                })
            }
            "use" => {
                let (item_query, target_query) = split_direct_indirect(rest, "on")
                    .or_else(|| split_direct_indirect(rest, "with"))
                    .unwrap_or((rest, "self"));
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, "use", 404, output))?;
                let target = if target_query.trim().eq_ignore_ascii_case("self")
                    || target_query.trim().is_empty()
                {
                    actor
                } else if let Some(feature_use) =
                    self.feature_use_result(actor.location_id, target_query, item.id)
                {
                    let item_name = self.item_name(item.id).unwrap_or_else(|| item.id.to_string());
                    let feature_name = feature_use.feature_name.clone();
                    return Ok(ResolvedCommand {
                        command: format!("use {item_name} on {feature_name}"),
                        verb,
                        action: Some(command_action(
                            "use_feature",
                            "Use",
                            &format!("use {item_name} on {feature_name}"),
                        )),
                        dispatch: if feature_use.matched {
                            CommandDispatch::UseFeature {
                                item_id: item.id,
                                location_id: actor.location_id,
                                feature_key: feature_use.feature_key,
                                output: feature_use.output,
                            }
                        } else {
                            CommandDispatch::Read {
                                output: feature_use.output,
                            }
                        },
                    });
                } else {
                    self.resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::Any,
                        active_direct_actor_ids,
                    )
                        .map_err(|output| command_error(&command, "use", 404, output))?
                };
                let item_name = self.item_name(item.id).unwrap_or_else(|| item.id.to_string());
                let target_name = self.actor_view(target).name;
                Ok(ResolvedCommand {
                    command: format!("use {item_name} on {target_name}"),
                    verb,
                    action: Some(command_action("use_item", "Use", &format!("use {item_name} on {target_name}"))),
                    dispatch: CommandDispatch::UseItem {
                        item_id: item.id,
                        target_actor_id: target.id,
                    },
                })
            }
            "chat" => {
                let target = self
                    .resolve_room_actor(
                        actor,
                        rest,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "chat", 404, output))?;
                let target_name = self.actor_view(target).name;
                let chat_command = format!("chat {target_name}");
                if self.active_bond(actor.id, target.id).is_some() {
                    return Ok(ResolvedCommand {
                        command: chat_command.clone(),
                        verb,
                        action: Some(command_action("create_bond", "Chat", &chat_command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!(
                                "You already share a friendship with {target_name}; play another card and let the room answer."
                            ),
                        },
                    });
                }
                if self.advancement_points_available(actor.id) < usize::from(BOND_SLOT_COST) {
                    return Ok(ResolvedCommand {
                        command: chat_command.clone(),
                        verb,
                        action: Some(command_action("create_bond", "Chat", &chat_command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!(
                                "Earn advancement first, then Chat can begin a friendship with {target_name}."
                            ),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: chat_command.clone(),
                    verb,
                    action: Some(command_action("create_bond", "Chat", &chat_command)),
                    dispatch: CommandDispatch::CreateBond {
                        target_actor_id: target.id,
                        statement: default_bond_statement(&target_name),
                    },
                })
            }
            "influence" => {
                if self
                    .contextual_action_contributions(actor.id, "srd5.2.1:influence")
                    .2
                    .is_empty()
                {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("influence", "Influence", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is no authored bounded cooperation to request here. Ordinary chat is still available."
                                .to_string(),
                        },
                    });
                }
                let target = self
                    .resolve_room_actor(
                        actor,
                        rest,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "influence", 404, output))?;
                let target_name = self.actor_view(target).name;
                let command = format!("influence {target_name}");
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("influence", "Ask for a local lead", &command)),
                    dispatch: CommandDispatch::Influence {
                        target_actor_id: target.id,
                    },
                })
            }
            "cast" => {
                let item = if rest.trim().is_empty() {
                    self.default_spell_card(actor.id)
                        .ok_or_else(|| command_error(&command, "cast", 409, "Prepare an unspent spell card first."))?
                } else {
                    self.resolve_held_item(actor.id, rest.trim())
                        .map_err(|output| command_error(&command, "cast", 404, output))?
                };
                let is_prepared = self
                    .prepared_spells
                    .get(&actor.id)
                    .is_some_and(|spells| spells.contains(&item.id));
                if item.role != CW_ITEM_ROLE_SPELL || !is_prepared || item.charges == 0 {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("cast_spell", "Cast", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "That card must be an unspent, prepared spell before it can be cast."
                                .to_string(),
                        },
                    });
                }
                let item_name = self.item_name(item.id).unwrap_or_else(|| format!("Item {}", item.id));
                let command = format!("cast {item_name}");
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("cast_spell", "Cast", &command)),
                    dispatch: CommandDispatch::CastSpell {
                        item_id: item.id,
                        target_actor_id: actor.id,
                    },
                })
            }
            "listen" => {
                let listen_cost = self.listen_cost_orbs(actor.id);
                if listen_cost > 0 && self.orb_balance(actor.id) < listen_cost {
                    return Ok(ResolvedCommand {
                        command: "listen".to_string(),
                        verb,
                        action: Some(command_action("check", "Listen", "listen")),
                        dispatch: CommandDispatch::Disabled {
                            status: 402,
                            output: format!(
                                "Listening again here costs {listen_cost} Orb. Search a feature, talk with someone, or earn more Orbs."
                            ),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "listen".to_string(),
                    verb,
                    action: Some(command_action("check", "Listen", "listen")),
                    dispatch: CommandDispatch::Check,
                })
            }
            "study" => {
                let authored = actor.location_id == MOONLIT_TRAIL_LOCATION_ID
                    || !self
                        .contextual_action_contributions(actor.id, "srd5.2.1:study")
                        .2
                        .is_empty();
                if !authored {
                    return Ok(ResolvedCommand {
                        command: "study".to_string(),
                        verb,
                        action: Some(command_action("study", "Study", "study")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is no authored analytical subject to Study here."
                                .to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "study".to_string(),
                    verb,
                    action: Some(command_action("study", "Study", "study")),
                    dispatch: CommandDispatch::Study,
                })
            }
            "prepare" => {
                if !self.prepare_available(actor.id) {
                    return Ok(ResolvedCommand {
                        command: "prepare".to_string(),
                        verb,
                        action: Some(command_action("prepare", "Prepare", "prepare")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is nothing useful to prepare here right now.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "prepare".to_string(),
                    verb,
                    action: Some(command_action("prepare", "Prepare", "prepare")),
                    dispatch: CommandDispatch::Prepare,
                })
            }
            "work" => {
                if !self.work_available(actor.id) {
                    return Ok(ResolvedCommand {
                        command: "work".to_string(),
                        verb,
                        action: Some(command_action("work", "Work", "work")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is no unfinished work to take on here.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "work".to_string(),
                    verb,
                    action: Some(command_action("work", "Work", "work")),
                    dispatch: CommandDispatch::Work,
                })
            }
            "assist" => {
                if !self.help_available(actor.id) {
                    return Ok(ResolvedCommand {
                        command: "assist".to_string(),
                        verb,
                        action: Some(command_action("help", "Help", "assist")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Nobody here can use that kind of help right now.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "assist".to_string(),
                    verb,
                    action: Some(command_action("help", "Help", "assist")),
                    dispatch: CommandDispatch::Help,
                })
            }
            "rest" => {
                if !self.rest_available(actor.id) {
                    return Ok(ResolvedCommand {
                        command: "rest".to_string(),
                        verb,
                        action: Some(command_action("rest", "Rest", "rest")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "You are already steady enough to keep going.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "rest".to_string(),
                    verb,
                    action: Some(command_action("rest", "Rest", "rest")),
                    dispatch: CommandDispatch::Rest,
                })
            }
            "shuffle" => Ok(ResolvedCommand {
                command: "shuffle".to_string(),
                verb,
                action: Some(command_action("shuffle_hand", "Shuffle", "shuffle")),
                dispatch: CommandDispatch::Read {
                    output: "A fresh hand appears. Nothing in the room changes.".to_string(),
                },
            }),
            "bank" => {
                Ok(ResolvedCommand {
                    command: "bank ledger".to_string(),
                    verb,
                    action: None,
                    dispatch: CommandDispatch::Read {
                        output: "That standalone progress command has retired. A successful Notice or Study records and settles earned advancement in the same action; older unsettled memories join that settlement once.".to_string(),
                    },
                })
            }
            "skill" => {
                let skill_query = rest
                    .strip_prefix("skill ")
                    .or_else(|| rest.strip_prefix("train "))
                    .or_else(|| rest.strip_prefix("practice "))
                    .unwrap_or(rest)
                    .trim();
                let Some(skill_id) = normalize_skill_id(skill_query) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("train_skill", "Practice", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output:
                                "Try: practice listening, lorecraft, nimble hands, lifting, steadiness, or kindness."
                                    .to_string(),
                        },
                    });
                };
                let label = skill_label(skill_id).unwrap_or("Skill");
                let current_rank = self
                    .skills
                    .get(&skill_state_id(actor.id, skill_id))
                    .map(|skill| skill.rank)
                    .unwrap_or(0);
                if current_rank >= MAX_SKILL_RANK {
                    return Ok(ResolvedCommand {
                        command: format!("skill {skill_id}"),
                        verb,
                        action: Some(command_action(
                            "train_skill",
                            "Practice",
                            &format!("skill {skill_id}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("{label} already feels second nature."),
                        },
                    });
                }
                if self.trained_since_rest_tag_active(actor.id) {
                    return Ok(ResolvedCommand {
                        command: format!("skill {skill_id}"),
                        verb,
                        action: Some(command_action(
                            "train_skill",
                            "Practice",
                            &format!("skill {skill_id}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Rest before practicing another knack.".to_string(),
                        },
                    });
                }
                if self.advancement_points_available(actor.id) < usize::from(SKILL_STEP_COST) {
                    return Ok(ResolvedCommand {
                        command: format!("skill {skill_id}"),
                        verb,
                        action: Some(command_action(
                            "train_skill",
                            "Practice",
                            &format!("skill {skill_id}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Earn advancement through play first, then practice a knack."
                                .to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("skill {skill_id}"),
                    verb,
                    action: Some(command_action(
                        "train_skill",
                        "Practice",
                        &format!("skill {skill_id}"),
                    )),
                    dispatch: CommandDispatch::TrainSkill {
                        skill_id: skill_id.to_string(),
                    },
                })
            }
            "calling" => {
                let statement = rest
                    .strip_prefix("calling ")
                    .unwrap_or(rest)
                    .trim();
                let Some(statement) = normalize_calling_statement(statement) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("revise_calling", "Change Purpose", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: "Try: purpose I listen for odd jobs.".to_string(),
                        },
                    });
                };
                if self.advancement_points_available(actor.id) < usize::from(CALLING_REVISION_COST)
                {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("revise_calling", "Change Purpose", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Earn advancement first, then you can choose a new purpose."
                                .to_string(),
                        },
                    });
                }
                if self
                    .callings
                    .get(&actor.id)
                    .map(|calling| calling.statement == statement)
                    .unwrap_or(false)
                {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("revise_calling", "Change Purpose", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "That is already what draws you in.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("calling {statement}"),
                    verb,
                    action: Some(command_action(
                        "revise_calling",
                        "Change Purpose",
                        &format!("calling {statement}"),
                    )),
                    dispatch: CommandDispatch::ReviseCalling { statement },
                })
            }
            "bond" => {
                let rest = rest
                    .strip_prefix("bond with ")
                    .or_else(|| rest.strip_prefix("bond "))
                    .or_else(|| rest.strip_prefix("with "))
                    .unwrap_or(rest)
                    .trim();
                let (target_query, statement) = rest.split_once(':').ok_or_else(|| {
                    command_error(
                        &command,
                        "bond",
                        400,
                        "Try: friendship Rati: I bring small kindnesses to Rati.",
                    )
                })?;
                let Some(statement) = normalize_bond_statement(statement) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action(
                            "revise_bond",
                            "See Differently",
                            &payload.command,
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: "Try: friendship Rati: I bring small kindnesses to Rati."
                                .to_string(),
                        },
                    });
                };
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "bond", 404, output))?;
                if self.actors_blocked(actor.id, target.id) {
                    return Err(command_error(
                        &command,
                        "bond",
                        409,
                        "Targeted social actions between these avatars are blocked.",
                    ));
                }
                let target_name = self.actor_view(target).name;
                let Some(active_bond) = self.active_bond(actor.id, target.id) else {
                    if self.advancement_points_available(actor.id) < usize::from(BOND_SLOT_COST) {
                        return Ok(ResolvedCommand {
                            command: format!("bond {target_name}: {statement}"),
                            verb,
                            action: Some(command_action(
                                "create_bond",
                                "Deepen Friendship",
                                &format!("bond {target_name}: {statement}"),
                            )),
                            dispatch: CommandDispatch::Disabled {
                                status: 409,
                                output: format!(
                                    "Earn advancement first, then you can grow closer to {target_name}."
                                ),
                            },
                        });
                    }
                    return Ok(ResolvedCommand {
                        command: format!("bond {target_name}: {statement}"),
                        verb,
                        action: Some(command_action(
                            "create_bond",
                            "Deepen Friendship",
                            &format!("bond {target_name}: {statement}"),
                        )),
                        dispatch: CommandDispatch::CreateBond {
                            target_actor_id: target.id,
                            statement,
                        },
                    });
                };
                if self.advancement_points_available(actor.id) < usize::from(BOND_REVISION_COST) {
                    return Ok(ResolvedCommand {
                        command: format!("bond {target_name}: {statement}"),
                        verb,
                        action: Some(command_action(
                            "revise_bond",
                            "See Differently",
                            &format!("bond {target_name}: {statement}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Earn advancement first, then you can see this friendship differently."
                                .to_string(),
                        },
                    });
                }
                if active_bond.statement == statement {
                    return Ok(ResolvedCommand {
                        command: format!("bond {target_name}: {statement}"),
                        verb,
                        action: Some(command_action(
                            "revise_bond",
                            "See Differently",
                            &format!("bond {target_name}: {statement}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Those words already describe this friendship.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("bond {target_name}: {statement}"),
                    verb,
                    action: Some(command_action(
                        "revise_bond",
                        "See Differently",
                        &format!("bond {target_name}: {statement}"),
                    )),
                    dispatch: CommandDispatch::ReviseBond {
                        target_actor_id: target.id,
                        statement,
                    },
                })
            }
            "resolve" => {
                let target_query = rest
                    .strip_prefix("bond with ")
                    .or_else(|| rest.strip_prefix("bond "))
                    .unwrap_or(rest)
                    .trim();
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "resolve", 404, output))?;
                let target_name = self.actor_view(target).name;
                let Some(active_bond) = self.active_bond(actor.id, target.id) else {
                    return Ok(ResolvedCommand {
                        command: format!("remember {target_name}"),
                        verb,
                        action: Some(command_action(
                            "resolve_bond",
                            "Remember",
                            &format!("remember {target_name}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("You have not grown close to {target_name} yet."),
                        },
                    });
                };
                if active_bond.strength < BOND_SETTLE_MIN_STRENGTH {
                    return Ok(ResolvedCommand {
                        command: format!("remember {target_name}"),
                        verb,
                        action: Some(command_action(
                            "resolve_bond",
                            "Remember",
                            &format!("remember {target_name}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("Spend a little more time with {target_name} before keeping this memory."),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("remember {target_name}"),
                    verb,
                    action: Some(command_action(
                        "resolve_bond",
                        "Remember",
                        &format!("remember {target_name}"),
                    )),
                    dispatch: CommandDispatch::ResolveBond {
                        target_actor_id: target.id,
                    },
                })
            }
            "attack" => {
                if !self.location_has_unresolved_combat(actor.location_id) {
                    return Ok(ResolvedCommand {
                        command: command.clone(),
                        verb,
                        action: Some(command_action("attack", "Attack", &command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is no need to fight here now.".to_string(),
                        },
                    });
                }
                let target = self
                    .resolve_room_actor(
                        actor,
                        rest,
                        CommandActorFilter::ActiveActor,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "attack", 404, output))?;
                let target_name = self.actor_view(target).name;
                Ok(ResolvedCommand {
                    command: format!("attack {target_name}"),
                    verb,
                    action: Some(command_action("attack", "Attack", &format!("attack {target_name}"))),
                    dispatch: CommandDispatch::Attack {
                        target_actor_id: target.id,
                    },
                })
            }
            "defend" => {
                if !self.location_has_unresolved_combat(actor.location_id) {
                    return Ok(ResolvedCommand {
                        command: "defend".to_string(),
                        verb,
                        action: Some(command_action("defend", "Defend", "defend")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "There is no need to guard here now.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "defend".to_string(),
                    verb,
                    action: Some(command_action("defend", "Defend", "defend")),
                    dispatch: CommandDispatch::Defend,
                })
            }
            "say" => {
                let Some(content) = normalize_human_message(rest) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("say", "Say", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: format!(
                                "Use: say <message>. Keep it cozy and under {MAX_HUMAN_MESSAGE_CHARS} characters."
                            ),
                        },
                    });
                };
                Ok(ResolvedCommand {
                    command: format!("say {content}"),
                    verb,
                    action: Some(command_action("say", "Say", &format!("say {content}"))),
                    dispatch: CommandDispatch::Say { content },
                })
            }
            "emote" => {
                let Some(content) = normalize_emote_message(rest) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("emote", "Emote", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: format!(
                                "Use: emote <action>. Keep it cozy and under {MAX_HUMAN_MESSAGE_CHARS} characters."
                            ),
                        },
                    });
                };
                Ok(ResolvedCommand {
                    command: format!("emote {content}"),
                    verb,
                    action: Some(command_action("emote", "Emote", &format!("emote {content}"))),
                    dispatch: CommandDispatch::Emote { content },
                })
            }
            "report" => {
                let (target_query, reason) = rest
                    .split_once(':')
                    .map(|(target, reason)| (target.trim(), reason.trim()))
                    .filter(|(target, reason)| !target.is_empty() && !reason.is_empty())
                    .ok_or_else(|| {
                        command_error(&command, "report", 400, "Use: report <actor>: <reason>.")
                    })?;
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::Any,
                        active_direct_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "report", 404, output))?;
                let Some(reason) = normalize_report_reason(reason) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("report", "Report", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: format!(
                                "Use: report <actor>: <reason>. Keep the reason under {MAX_REPORT_REASON_CHARS} characters."
                            ),
                        },
                    });
                };
                let target_name = self.actor_view(target).name;
                Ok(ResolvedCommand {
                    command: format!("report {target_name}: {reason}"),
                    verb,
                    action: Some(command_action(
                        "report",
                        "Report",
                        &format!("report {target_name}: {reason}"),
                    )),
                    dispatch: CommandDispatch::Report {
                        target_actor_id: target.id,
                        reason,
                    },
                })
            }
            _ => Err(command_error(
                &command,
                &verb,
                404,
                "I do not know that one yet. Try help, look, search, who, go, say, take, give, chat, listen, practice, purpose, friendship, remember, rest, pass, need time, or more.",
            )),
        }
    }

    fn look_command_output(
        &self,
        actor: CwActor,
        query: &str,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<String, &'static str> {
        let query = trim_command_filler(query);
        if query.is_empty()
            || matches!(
                command_key(query).as_str(),
                "room" | "here" | "around" | "location"
            )
        {
            return Ok(self.room_command_output(actor, access, active_direct_actor_ids));
        }
        if let Some(feature) = self.resolve_room_feature(actor.location_id, query).ok() {
            return Ok(format!("{} - {}", feature.name, feature.look));
        }
        if let Some(actor) = self
            .resolve_room_actor(
                actor,
                query,
                CommandActorFilter::Any,
                active_direct_actor_ids,
            )
            .ok()
        {
            let view = self.actor_view(actor);
            let condition = if actor.status != CW_ACTOR_ACTIVE {
                "quiet for now"
            } else if view.hp >= view.stats.hp_base {
                "steady"
            } else if view.bloodied {
                "hurting"
            } else {
                "a little worn"
            };
            return Ok(format!(
                "{} - {}\n{}\nHow they seem: {condition}.",
                view.name, view.title, view.description
            ));
        }
        if let Some(item) = self
            .resolve_room_item(actor.location_id, query)
            .or_else(|_| self.resolve_held_item(actor.id, query))
            .ok()
        {
            let view = self.item_view(item);
            let where_text = if item.holder_actor_id == actor.id {
                "You are carrying it."
            } else {
                "It is here."
            };
            return Ok(format!(
                "{} - {}\n{where_text}",
                view.name, view.description
            ));
        }
        if let Some(destination) = self.resolve_exit_destination(actor, query, access).ok() {
            let name = self
                .location_name(destination)
                .unwrap_or_else(|| format!("Location {destination}"));
            let meta = self.location_meta_for(destination);
            return Ok(format!("{name} - {}\n{}", meta.title, meta.description));
        }
        Err("Nothing nearby matches that look command.")
    }

    fn search_command_output(&self, _actor: CwActor, query: &str) -> Result<String, &'static str> {
        let query = trim_command_filler(query);
        if search_query_is_room(query) {
            return Ok(
                "You look closely. This room has shared everything it is ready to share."
                    .to_string(),
            );
        }
        Ok("Search the whole room at once. Try: search".to_string())
    }

    fn feature_use_result(
        &self,
        location_id: u64,
        query: &str,
        item_id: u64,
    ) -> Option<FeatureUseResult> {
        let feature = self.resolve_room_feature(location_id, query).ok()?;
        let matching_use = feature
            .uses
            .iter()
            .find(|use_case| use_case.item_id == item_id);
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| format!("Item {item_id}"));
        Some(FeatureUseResult {
            feature_key: feature.key.clone(),
            feature_name: feature.name.clone(),
            output: matching_use
                .map(|use_case| use_case.text.clone())
                .unwrap_or_else(|| {
                    format!(
                        "The {item_name} does not seem to belong with {}.",
                        feature.name
                    )
                }),
            matched: matching_use.is_some(),
        })
    }

    fn room_command_output(
        &self,
        actor: CwActor,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> String {
        let location_id = actor.location_id;
        let location = self.location_view(location_id);
        let actors = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| actor.location_id == location_id && actor.status == CW_ACTOR_ACTIVE)
            .filter(|visible_actor| {
                self.actor_visible_in_projection(
                    *visible_actor,
                    Some(actor.id),
                    active_direct_actor_ids,
                )
            })
            .map(|actor| self.actor_view(actor).name)
            .collect::<Vec<_>>();
        let items = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| item.location_id == location_id)
            .map(|item| self.item_view(item).name)
            .collect::<Vec<_>>();
        let exits = self
            .exit_views(location_id, access)
            .into_iter()
            .filter(|exit| exit.accessible)
            .map(|exit| {
                exit.direction
                    .as_deref()
                    .map(|direction| format!("{direction}: {}", exit.destination_location_name))
                    .unwrap_or(exit.destination_location_name)
            })
            .collect::<Vec<_>>();
        let mut lines = vec![
            format!("{} - {}", location.name, location.title),
            location.description,
            format!("Here: {}.", command_list_or_none(&actors)),
            format!("You notice: {}.", command_list_or_none(&items)),
            format!("Ways onward: {}.", command_list_or_none(&exits)),
        ];

        if let Some(sheet) = self.room_sheet_view(location_id) {
            let aspects = command_list_or_none(&sheet.aspects);
            lines.push(format!(
                "This place feels {}. You notice: {}.",
                room_zone_feeling(&sheet.zone),
                aspects
            ));
        }

        let clocks = self.clock_views(location_id);
        let jobs = self
            .job_views(location_id)
            .into_iter()
            .filter(|job| job.status == "active")
            .map(|job| {
                let progress = clocks
                    .iter()
                    .find(|clock| clock.id == job.progress_clock_id)
                    .map(clock_summary)
                    .unwrap_or_else(|| job.progress_clock_id.clone());
                let danger = clocks
                    .iter()
                    .find(|clock| clock.id == job.danger_clock_id)
                    .map(clock_summary)
                    .unwrap_or_else(|| job.danger_clock_id.clone());
                format!(
                    "{} Stakes: {} Work: {progress}. Trouble: {danger}",
                    job.premise, job.stakes
                )
            })
            .collect::<Vec<_>>();
        if !jobs.is_empty() {
            lines.push(format!("Work here: {}.", jobs.join(" | ")));
        }

        if jobs.is_empty() && !clocks.is_empty() {
            let clock_lines = clocks.iter().map(clock_summary).collect::<Vec<_>>();
            lines.push(format!("Things unfolding: {}.", clock_lines.join(", ")));
        }

        let tags = self
            .tag_views(Some(actor.id), location_id)
            .into_iter()
            .filter(tag_belongs_in_room_description)
            .collect::<Vec<_>>();
        if !tags.is_empty() {
            let tag_lines = tags.into_iter().map(|tag| tag.label).collect::<Vec<_>>();
            lines.push(format!("What lingers: {}.", tag_lines.join(", ")));
        }

        let ledger = self.visit_ledger_view(actor.id);
        if let Some(summary) = journal_memory_summary(&ledger) {
            lines.push(summary.to_string());
        }

        lines.join("\n")
    }

    fn inventory_command_output(&self, actor_id: u64) -> String {
        let deck = self.deck_view(Some(actor_id));
        let items = deck
            .carried_cards
            .iter()
            .map(|item| item.name.clone())
            .collect::<Vec<_>>();
        let carried = if items.is_empty() {
            "Your carried deck is empty.".to_string()
        } else {
            let capacity = deck.carrying_capacity_tenths;
            let weight = deck.carried_weight_tenths;
            let carried = command_list_or_none(&items);
            if capacity > 0 && weight >= capacity {
                format!(
                    "You carry {carried}. Your carried deck is at {:.1}/{:.1} lb.",
                    weight as f64 / 10.0,
                    capacity as f64 / 10.0
                )
            } else {
                format!(
                    "You carry {carried} ({:.1}/{:.1} lb).",
                    weight as f64 / 10.0,
                    capacity as f64 / 10.0
                )
            }
        };
        let charms = deck
            .equipped_charms
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        let charm_summary = if charms.is_empty() {
            "none worn".to_string()
        } else {
            charms.join(", ")
        };
        let prepared_spells = deck
            .prepared_spell_cards
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        let prepared_summary = if prepared_spells.is_empty() {
            "none prepared".to_string()
        } else {
            prepared_spells.join(", ")
        };
        let exhausted_summary = deck
            .exhausted_spell_cards
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let exhausted = if exhausted_summary.is_empty() {
            String::new()
        } else {
            format!(" Exhausted: {exhausted_summary}.")
        };
        format!(
            "{carried} Bracelet: {}/{} charm slots ({charm_summary}). Spell deck: {}/{} prepared ({prepared_summary}).{exhausted}",
            deck.equipped_charms.len(),
            deck.bracelet_slots,
            deck.prepared_spell_cards.len(),
            deck.spell_deck_slots,
        )
    }

    fn who_command_output(
        &self,
        location_id: u64,
        client_actor_id: Option<u64>,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> String {
        let actors = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| actor.location_id == location_id && actor.status == CW_ACTOR_ACTIVE)
            .filter(|actor| {
                self.actor_visible_in_projection(*actor, client_actor_id, active_direct_actor_ids)
            })
            .map(|actor| {
                let view = self.actor_view(actor);
                if client_actor_id == Some(actor.id) {
                    format!("{} (you)", view.name)
                } else {
                    view.name
                }
            })
            .collect::<Vec<_>>();
        format!("Here: {}.", command_list_or_none(&actors))
    }

    fn resolve_room_feature(
        &self,
        location_id: u64,
        query: &str,
    ) -> Result<&'static SeedRoomFeatureContent, &'static str> {
        let candidates = self.room_features(location_id);
        let query = trim_command_filler(query);
        if query.is_empty() && candidates.len() == 1 {
            return candidates
                .first()
                .copied()
                .ok_or("No feature here matches that command.");
        }
        let query_key = command_key(query);
        if query_key.is_empty() {
            return Err("Name a feature to inspect or search.");
        }
        candidates
            .into_iter()
            .filter_map(|feature| {
                command_match_score(&feature.name, &query_key)
                    .or_else(|| command_match_score(&feature.key, &query_key))
                    .or_else(|| {
                        feature
                            .aliases
                            .iter()
                            .filter_map(|alias| command_match_score(alias, &query_key))
                            .min()
                    })
                    .map(|score| (score, feature.name.len(), feature))
            })
            .min_by_key(|(score, len, _)| (*score, *len))
            .map(|(_, _, feature)| feature)
            .ok_or("No feature here matches that command.")
    }

    fn resolve_room_actor(
        &self,
        actor: CwActor,
        query: &str,
        filter: CommandActorFilter,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<CwActor, &'static str> {
        let candidates = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|candidate| {
                candidate.id != actor.id && candidate.location_id == actor.location_id
            })
            .filter(|candidate| {
                self.actor_visible_in_projection(
                    *candidate,
                    Some(actor.id),
                    active_direct_actor_ids,
                )
            })
            .filter(|candidate| match filter {
                CommandActorFilter::Any => true,
                CommandActorFilter::ActiveActor => Self::actor_is_active_avatar(*candidate),
            })
            .collect::<Vec<_>>();
        self.best_actor_match(candidates, query)
            .ok_or("No nearby actor matches that command.")
    }

    fn actor_not_nearby_output(
        &self,
        actor: CwActor,
        query: &str,
        filter: CommandActorFilter,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> String {
        let candidates = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|candidate| candidate.id != actor.id)
            .filter(|candidate| {
                self.actor_visible_in_projection(
                    *candidate,
                    Some(actor.id),
                    active_direct_actor_ids,
                )
            })
            .filter(|candidate| match filter {
                CommandActorFilter::Any => true,
                CommandActorFilter::ActiveActor => Self::actor_is_active_avatar(*candidate),
            })
            .collect::<Vec<_>>();
        if let Some(found) = self.best_actor_match(candidates, query) {
            let found_name = self.actor_view(found).name;
            let current_room = self
                .location_name(actor.location_id)
                .unwrap_or_else(|| "this room".to_string());
            let found_room = self
                .location_name(found.location_id)
                .unwrap_or_else(|| "another room".to_string());
            if found.location_id != actor.location_id {
                return format!(
                    "{found_name} is in {found_room}, not {current_room}. Travel there first."
                );
            }
        }
        "No nearby actor matches that command.".to_string()
    }

    fn best_actor_match(&self, candidates: Vec<CwActor>, query: &str) -> Option<CwActor> {
        let query = trim_command_filler(query);
        if query.is_empty() && candidates.len() == 1 {
            return candidates.first().copied();
        }
        let query_key = command_key(query);
        if query_key.is_empty() {
            return None;
        }
        candidates
            .into_iter()
            .filter_map(|actor| {
                let view = self.actor_view(actor);
                command_match_score(&view.name, &query_key)
                    .or_else(|| command_match_score(&view.title, &query_key))
                    .map(|score| (score, view.name.len(), actor))
            })
            .min_by_key(|(score, len, _)| (*score, *len))
            .map(|(_, _, actor)| actor)
    }

    fn resolve_room_item(&self, location_id: u64, query: &str) -> Result<CwItem, &'static str> {
        let candidates = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| item.location_id == location_id)
            .collect::<Vec<_>>();
        self.best_item_match(candidates, query)
            .ok_or("No item here matches that command.")
    }

    fn resolve_held_item(&self, actor_id: u64, query: &str) -> Result<CwItem, &'static str> {
        self.resolve_actor_held_item(
            actor_id,
            query,
            "You are not carrying an item that matches that command.",
        )
    }

    fn resolve_actor_held_item(
        &self,
        actor_id: u64,
        query: &str,
        missing_message: &'static str,
    ) -> Result<CwItem, &'static str> {
        let candidates = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| item.holder_actor_id == actor_id)
            .collect::<Vec<_>>();
        self.best_item_match(candidates, query)
            .ok_or(missing_message)
    }

    fn best_item_match(&self, candidates: Vec<CwItem>, query: &str) -> Option<CwItem> {
        let query = trim_command_filler(query);
        if query.is_empty() && candidates.len() == 1 {
            return candidates.first().copied();
        }
        let query_key = command_key(query);
        if query_key.is_empty() {
            return None;
        }
        candidates
            .into_iter()
            .filter_map(|item| {
                let view = self.item_view(item);
                command_match_score(&view.name, &query_key)
                    .or_else(|| command_match_score(&view.description, &query_key))
                    .map(|score| (score, view.name.len(), item))
            })
            .min_by_key(|(score, len, _)| (*score, *len))
            .map(|(_, _, item)| item)
    }

    fn resolve_exit_destination(
        &self,
        actor: CwActor,
        query: &str,
        access: &AccessContext,
    ) -> Result<u64, &'static str> {
        let exits = self
            .exit_views(actor.location_id, access)
            .into_iter()
            .filter(|exit| exit.accessible)
            .collect::<Vec<_>>();
        if query.trim().is_empty() && exits.len() == 1 {
            return exits
                .first()
                .map(|exit| exit.destination_location_id)
                .ok_or("No accessible exit matches that command.");
        }
        let query_key = command_key(query);
        if query_key.is_empty() {
            return Err("Name a room to go to.");
        }
        if let Some(direction) = canonical_direction(query) {
            let direction_matches = exits
                .into_iter()
                .filter(|exit| {
                    exit.direction
                        .as_deref()
                        .and_then(canonical_direction)
                        .is_some_and(|candidate| candidate == direction)
                })
                .collect::<Vec<_>>();
            return match direction_matches.as_slice() {
                [] => Err("No accessible exit leads that direction."),
                [exit] => Ok(exit.destination_location_id),
                _ => Err("Multiple accessible exits lead that direction; name the room."),
            };
        }
        exits
            .into_iter()
            .filter_map(|exit| {
                command_match_score(&exit.destination_location_name, &query_key).map(|score| {
                    (
                        score,
                        exit.destination_location_name.len(),
                        exit.destination_location_id,
                    )
                })
            })
            .min_by_key(|(score, len, _)| (*score, *len))
            .map(|(_, _, id)| id)
            .ok_or("No accessible exit matches that command.")
    }

    fn first_accessible_exit(&self, location_id: u64, access: &AccessContext) -> Option<u64> {
        self.exit_views(location_id, access)
            .into_iter()
            .find(|exit| exit.accessible)
            .map(|exit| exit.destination_location_id)
    }
}
