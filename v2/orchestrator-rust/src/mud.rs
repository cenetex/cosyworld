use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::*;

#[derive(Debug, Serialize)]
pub(crate) struct CommandResponse {
    pub(crate) ok: bool,
    pub(crate) status: u32,
    pub(crate) command: String,
    pub(crate) verb: String,
    pub(crate) output: Option<String>,
    pub(crate) action: Option<CommandActionView>,
    pub(crate) events: Vec<EventView>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CommandRequest {
    pub(crate) actor_id: u64,
    pub(crate) actor_session: Option<String>,
    pub(crate) command: String,
    pub(crate) wallet_address: Option<String>,
    pub(crate) wallet: Option<String>,
    pub(crate) wallet_session: Option<String>,
    pub(crate) owned_card_ids: Option<String>,
    pub(crate) cards: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
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
    BankLedger,
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
    Chat {
        target_actor_id: u64,
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
    ActiveNpc,
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
        "i" | "inv" | "inventory" => "inventory",
        "who" | "where" => "who",
        "go" | "move" | "travel" => "go",
        "get" | "take" | "pick" => "take",
        "give" | "gift" => "give",
        "trade" | "swap" | "barter" => "trade",
        "craft" | "make" | "combine" => "craft",
        "use" | "drink" | "ring" => "use",
        "talk" | "chat" | "speak" => "chat",
        "listen" | "check" => "listen",
        "prepare" | "ready" => "prepare",
        "work" | "repair" | "study" => "work",
        "assist" | "aid" => "assist",
        "rest" | "breathe" | "catch" => "rest",
        "shuffle" | "deal" | "redraw" => "shuffle",
        "bank" | "review" | "advance" => "bank",
        "skill" | "train" | "practice" => "skill",
        "bond" | "relationship" => "bond",
        "calling" | "drive" | "revise" => "calling",
        "resolve" | "settle" => "resolve",
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
        "out" | "outside" | "exit" => Some("out"),
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
        events: response.events,
    })
}

pub(crate) fn command_action_failure_output(resolved: &ResolvedCommand, status: u32) -> String {
    if status == RATE_LIMITED_STATUS {
        return "That command is moving too quickly. Try again in a moment.".to_string();
    }
    if status == 403 {
        return "That command needs an active avatar session.".to_string();
    }
    if status >= 500 {
        return "That command could not be committed.".to_string();
    }
    match &resolved.dispatch {
        CommandDispatch::Move { .. } => "You cannot travel there right now.",
        CommandDispatch::Flee { .. } => "The room has calmed; flee is not needed.",
        CommandDispatch::Check => "Listening did not land. Try again from the current room.",
        CommandDispatch::PickUp { .. } => "That item is not loose here anymore.",
        CommandDispatch::Drop { .. } => "That item is not in your pack anymore.",
        CommandDispatch::UseItem { .. } => "That item cannot be used on that target right now.",
        CommandDispatch::GiveItem { .. } => "That gift changed. Check your pack and who is here.",
        CommandDispatch::TradeItem { .. } => "That trade changed. Check your pack and who is here.",
        CommandDispatch::Craft { .. } => {
            "That craft changed. Check your hand, the floor, and the recipe."
        }
        CommandDispatch::Attack { .. } => "The room has calmed; attack is not available.",
        CommandDispatch::ResolveBond { .. } => "That Bond cannot be settled right now.",
        CommandDispatch::Defend => "The room has calmed; defend is not needed.",
        CommandDispatch::Prepare => "Prepare is not available here right now.",
        CommandDispatch::Work => "Work is not available here right now.",
        CommandDispatch::Help => "Assist is not available here right now.",
        CommandDispatch::Rest => "Rest is not available right now.",
        CommandDispatch::BankLedger => "You need memory marks before claiming growth.",
        CommandDispatch::ReviseCalling { .. } => "That Calling change could not be saved.",
        CommandDispatch::CreateBond { .. } => "That Bond cannot be written right now.",
        CommandDispatch::ReviseBond { .. } => "That Bond cannot be revised right now.",
        CommandDispatch::TrainSkill { .. } => "You need a growth point before training that skill.",
        CommandDispatch::Say { .. } | CommandDispatch::Emote { .. } => {
            "That message could not be sent."
        }
        CommandDispatch::Report { .. } => "That report could not be saved.",
        CommandDispatch::Chat { .. } => "That resident cannot answer right now.",
        CommandDispatch::Read { .. }
        | CommandDispatch::Disabled { .. }
        | CommandDispatch::SearchFeature { .. }
        | CommandDispatch::UseFeature { .. } => "That command could not finish.",
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
        output: Some("That command is moving too quickly. Try again in a moment.".to_string()),
        action: resolved.action,
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
        "hand.shuffled" => Some("You draw a new hand.".to_string()),
        "feature.searched" => Some(format!(
            "You search {}.",
            event_content_part(event, 0).unwrap_or("a room feature")
        )),
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
            let healed = event
                .damage
                .filter(|damage| *damage < 0)
                .map(|damage| format!(" Restores {} HP.", damage.abs()))
                .unwrap_or_default();
            Some(format!(
                "You use {}{target}.{healed}",
                event.item_name.as_deref().unwrap_or("the item")
            ))
        }
        "item.given" => Some(format!(
            "You give {} to {}.",
            event.item_name.as_deref().unwrap_or("the item"),
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "item.traded" => Some(format!(
            "You trade {} to {} for {}.",
            event.item_name.as_deref().unwrap_or("the item"),
            event.target_actor_name.as_deref().unwrap_or("someone"),
            event.target_item_name.as_deref().unwrap_or("another item")
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
        "ability_check.rolled" => {
            let total = event
                .total
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string());
            let dc = event
                .dc
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string());
            Some(format!(
                "Listen check: {total} vs DC {dc} ({}).",
                if event.success { "success" } else { "failure" }
            ))
        }
        "clock.updated" => Some(format!(
            "{} advances to {}/{}.",
            event.clock_label.as_deref().unwrap_or("A room clock"),
            event.clock_filled.unwrap_or(0),
            event.clock_segments.unwrap_or(0)
        )),
        "tag.applied" => Some(format!(
            "You gain {}.",
            event.tag_label.as_deref().unwrap_or("a condition")
        )),
        "tag.cleared" => Some(format!(
            "You clear {}.",
            event.tag_label.as_deref().unwrap_or("a condition")
        )),
        "ledger.marked" => Some(format!(
            "Memory mark added: {}.",
            event_content_part(event, 1).unwrap_or("visit")
        )),
        "ledger.banked" => {
            let count = event_content_part(event, 0)
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            Some(format!(
                "GROWTH: {count} mark{} become {count} point{}.",
                if count == 1 { "" } else { "s" },
                if count == 1 { "" } else { "s" }
            ))
        }
        "advancement.spent" => Some(format!(
            "Growth spent: {}.",
            event_content_part(event, 2).unwrap_or("growth")
        )),
        "skill.stepped" => Some(format!(
            "Skill stepped up: {}.",
            event_content_part(event, 0).unwrap_or("skill")
        )),
        "calling.set" => Some(format!(
            "Calling set: {}.",
            event_calling_text(event).unwrap_or("a small truth")
        )),
        "calling.revised" => Some(format!(
            "Calling revised: {}.",
            event_calling_text(event).unwrap_or("a small truth")
        )),
        "bond.deepened" => Some(format!(
            "Bond deepened with {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "bond.created" => Some(format!(
            "Bond written with {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "bond.revised" => Some(format!(
            "Bond revised with {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "bond.resolved" => Some(format!(
            "Bond settled with {}.",
            event.target_actor_name.as_deref().unwrap_or("someone")
        )),
        "job.updated" => Some(format!(
            "Job updated: {}.",
            event_content_part(event, 1).unwrap_or("changed")
        )),
        "combat.defend" => Some("You raise a careful guard.".to_string()),
        "combat.attack.attempt" => Some(format!(
            "Attack roll: {} vs AC {}.",
            event
                .total
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string()),
            event
                .dc
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string())
        )),
        "combat.attack.hit" => Some(format!(
            "You hit {} for {} damage.",
            event.target_actor_name.as_deref().unwrap_or("the target"),
            event.damage.unwrap_or(0)
        )),
        "combat.attack.miss" => Some(format!(
            "{} turns the strike aside.",
            event.target_actor_name.as_deref().unwrap_or("The target")
        )),
        "combat.knockout" => Some(format!(
            "{} is knocked out.",
            event.target_actor_name.as_deref().unwrap_or("The target")
        )),
        "rule.rejected" => Some("That command was rejected by the world rules.".to_string()),
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
    format!("{} {}/{}", clock.label, clock.filled, clock.segments)
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
        active_human_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<ResolvedCommand, CommandError> {
        let command = normalize_command_text(&payload.command);
        if command.is_empty() {
            return Err(command_error("", "", 400, "Try a command like look, who, inventory, go Rain-Soft Garden, take Story Button, or chat Rati."));
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
        if actor.kind != CW_ACTOR_HUMAN || actor.status != CW_ACTOR_ACTIVE {
            return Err(command_error(
                &command,
                &verb,
                403,
                "Only an active player avatar can use MUD commands.",
            ));
        }

        match verb.as_str() {
            "help" => Ok(ResolvedCommand {
                command,
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                            output: "Commands: look, look <thing>, search <feature>, who, inventory, go <room|direction>, say <message>, emote <action>, report <actor>: <reason>, take <item>, drop <item>, give <item> to <resident>, trade <item> with <resident> for <item>, craft [recipe], use <item> on <target>, chat <resident>, listen, prepare, work, assist, rest, shuffle, skill <name>, calling <new drive>, bond <resident>: <relationship>, settle <resident>, attack <target>, defend, flee <room|direction>.".to_string(),
                },
            }),
            "look" => Ok(ResolvedCommand {
                command: command.clone(),
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                    output: self
                        .look_command_output(actor, rest, access, active_human_actor_ids)
                        .map_err(|output| command_error(&command, "look", 404, output))?,
                },
            }),
            "search" => {
                if !self.room_floor_empty(actor.location_id) {
                    return Ok(ResolvedCommand {
                        command: command.clone(),
                        verb,
                        action: Some(command_action("search", "Search", &command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output:
                                "There is already an item here. Take it, use it, or move it before searching."
                                    .to_string(),
                        },
                    });
                }
                if search_query_is_room(rest) {
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
                }
                let feature = self
                    .resolve_room_feature(actor.location_id, rest)
                    .map_err(|output| command_error(&command, "search", 404, output))?;
                Ok(ResolvedCommand {
                    command: command.clone(),
                    verb,
                    action: Some(command_action("search", "Search", &command)),
                    dispatch: CommandDispatch::SearchFeature {
                        location_id: actor.location_id,
                        feature_key: feature.key.clone(),
                        feature_name: feature.name.clone(),
                        output: format!("{} - {}", feature.name, feature.search),
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
            "who" => Ok(ResolvedCommand {
                command,
                verb,
                action: None,
                dispatch: CommandDispatch::Read {
                    output: self.who_command_output(
                        actor.location_id,
                        Some(actor.id),
                        active_human_actor_ids,
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
            "give" => {
                let (item_query, target_query) = split_direct_indirect(rest, "to")
                    .ok_or_else(|| command_error(&command, "give", 400, "Use: give <item> to <resident>."))?;
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, "give", 404, output))?;
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveNpc,
                        active_human_actor_ids,
                    )
                    .map_err(|_| {
                        command_error(
                            &command,
                            "give",
                            404,
                            self.actor_not_nearby_output(
                                actor,
                                target_query,
                                CommandActorFilter::ActiveNpc,
                                active_human_actor_ids,
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
                    .ok_or_else(|| command_error(&command, "trade", 400, "Use: trade <item> with <resident> for <item>."))?;
                let (target_query, target_item_query) = split_direct_indirect(trade_tail, "for")
                    .ok_or_else(|| command_error(&command, "trade", 400, "Use: trade <item> with <resident> for <item>."))?;
                let item = self
                    .resolve_held_item(actor.id, item_query)
                    .map_err(|output| command_error(&command, "trade", 404, output))?;
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveNpc,
                        active_human_actor_ids,
                    )
                    .map_err(|_| {
                        command_error(
                            &command,
                            "trade",
                            404,
                            self.actor_not_nearby_output(
                                actor,
                                target_query,
                                CommandActorFilter::ActiveNpc,
                                active_human_actor_ids,
                            ),
                        )
                    })?;
                let target_item = self
                    .resolve_actor_held_item(
                        target.id,
                        target_item_query,
                        "That resident is not holding an item that matches that command.",
                    )
                    .map_err(|output| command_error(&command, "trade", 404, output))?;
                self.resident_trade_is_willing(actor.id, target.id, item.id, target_item.id)
                    .map_err(|output| command_error(&command, "trade", 409, output))?;
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
            "craft" => {
                let recipe = if rest.trim().is_empty() {
                    self.default_craft_recipe(actor.id)
                } else {
                    let query_key = command_key(rest);
                    seed_content().recipes.iter().find(|recipe| {
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
                        "No recipe matches your current hand and floor.",
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
                            output: "That recipe needs one input in your hand and the other on the floor, with its output slot empty.".to_string(),
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
                        active_human_actor_ids,
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
                        CommandActorFilter::ActiveNpc,
                        active_human_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "chat", 404, output))?;
                let target_name = self.actor_view(target).name;
                Ok(ResolvedCommand {
                    command: format!("chat {target_name}"),
                    verb,
                    action: Some(command_action("chat", "Chat", &format!("chat {target_name}"))),
                    dispatch: CommandDispatch::Chat {
                        target_actor_id: target.id,
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
                            output: "There is no active room project to work on here.".to_string(),
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
                    output: "New cards are drawn locally. Nothing in the room changes.".to_string(),
                },
            }),
            "bank" => {
                let ledger = self.visit_ledger_view(actor.id);
                if ledger.unbanked_count == 0 {
                    return Ok(ResolvedCommand {
                        command: "bank ledger".to_string(),
                        verb,
                        action: Some(command_action("bank_ledger", "Claim Growth", "bank ledger")),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "You have no memory marks ready to claim yet.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: "bank ledger".to_string(),
                    verb,
                    action: Some(command_action("bank_ledger", "Claim Growth", "bank ledger")),
                    dispatch: CommandDispatch::BankLedger,
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
                        action: Some(command_action("train_skill", "Train Skill", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output:
                                "Use: skill listening, lorecraft, nimble hands, lifting, steadiness, or kindness."
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
                            "Train Skill",
                            &format!("skill {skill_id}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("{label} is already master rank."),
                        },
                    });
                }
                if self.advancement_points_available(actor.id) < usize::from(SKILL_STEP_COST) {
                    return Ok(ResolvedCommand {
                        command: format!("skill {skill_id}"),
                        verb,
                        action: Some(command_action(
                            "train_skill",
                            "Train Skill",
                            &format!("skill {skill_id}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Claim growth from memory marks before training a skill.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("skill {skill_id}"),
                    verb,
                    action: Some(command_action(
                        "train_skill",
                        "Train Skill",
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
                        action: Some(command_action("revise_calling", "Revise Calling", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: "Use: calling <a short cozy drive statement>.".to_string(),
                        },
                    });
                };
                if self.advancement_points_available(actor.id) < usize::from(CALLING_REVISION_COST)
                {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action("revise_calling", "Revise Calling", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Claim growth from memory marks before revising your Calling."
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
                        action: Some(command_action("revise_calling", "Revise Calling", &payload.command)),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "That is already your Calling.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("calling {statement}"),
                    verb,
                    action: Some(command_action(
                        "revise_calling",
                        "Revise Calling",
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
                        "Use: bond <resident>: <short relationship statement>.",
                    )
                })?;
                let Some(statement) = normalize_bond_statement(statement) else {
                    return Ok(ResolvedCommand {
                        command,
                        verb,
                        action: Some(command_action(
                            "revise_bond",
                            "Revise Bond",
                            &payload.command,
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 400,
                            output: "Use: bond <resident>: <short cozy relationship statement>."
                                .to_string(),
                        },
                    });
                };
                let target = self
                    .resolve_room_actor(
                        actor,
                        target_query,
                        CommandActorFilter::ActiveNpc,
                        active_human_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "bond", 404, output))?;
                let target_name = self.actor_view(target).name;
                let Some(active_bond) = self.active_bond(actor.id, target.id) else {
                    if self.advancement_points_available(actor.id) < usize::from(BOND_SLOT_COST) {
                        return Ok(ResolvedCommand {
                            command: format!("bond {target_name}: {statement}"),
                            verb,
                            action: Some(command_action(
                                "create_bond",
                                "Write Bond",
                                &format!("bond {target_name}: {statement}"),
                            )),
                            dispatch: CommandDispatch::Disabled {
                                status: 409,
                                output: format!(
                                    "Claim growth from memory marks before writing a new Bond with {target_name}."
                                ),
                            },
                        });
                    }
                    return Ok(ResolvedCommand {
                        command: format!("bond {target_name}: {statement}"),
                        verb,
                        action: Some(command_action(
                            "create_bond",
                            "Write Bond",
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
                            "Revise Bond",
                            &format!("bond {target_name}: {statement}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "Claim growth from memory marks before revising a Bond.".to_string(),
                        },
                    });
                }
                if active_bond.statement == statement {
                    return Ok(ResolvedCommand {
                        command: format!("bond {target_name}: {statement}"),
                        verb,
                        action: Some(command_action(
                            "revise_bond",
                            "Revise Bond",
                            &format!("bond {target_name}: {statement}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: "That Bond already says that.".to_string(),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("bond {target_name}: {statement}"),
                    verb,
                    action: Some(command_action(
                        "revise_bond",
                        "Revise Bond",
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
                        CommandActorFilter::ActiveNpc,
                        active_human_actor_ids,
                    )
                    .map_err(|output| command_error(&command, "resolve", 404, output))?;
                let target_name = self.actor_view(target).name;
                let Some(active_bond) = self.active_bond(actor.id, target.id) else {
                    return Ok(ResolvedCommand {
                        command: format!("settle {target_name}"),
                        verb,
                        action: Some(command_action(
                            "resolve_bond",
                            "Settle",
                            &format!("settle {target_name}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("You do not have an active Bond with {target_name}."),
                        },
                    });
                };
                if active_bond.strength < BOND_SETTLE_MIN_STRENGTH {
                    return Ok(ResolvedCommand {
                        command: format!("settle {target_name}"),
                        verb,
                        action: Some(command_action(
                            "resolve_bond",
                            "Settle",
                            &format!("settle {target_name}"),
                        )),
                        dispatch: CommandDispatch::Disabled {
                            status: 409,
                            output: format!("Deepen your Bond with {target_name} before settling it."),
                        },
                    });
                }
                Ok(ResolvedCommand {
                    command: format!("settle {target_name}"),
                    verb,
                    action: Some(command_action(
                        "resolve_bond",
                        "Settle",
                        &format!("settle {target_name}"),
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
                            output: "The room has calmed; attack is not available.".to_string(),
                        },
                    });
                }
                let target = self
                    .resolve_room_actor(
                        actor,
                        rest,
                        CommandActorFilter::ActiveNpc,
                        active_human_actor_ids,
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
                            output: "The room has calmed; defend is not needed.".to_string(),
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
                        active_human_actor_ids,
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
                "I do not know that command yet. Try help, look, search, who, inventory, go, say, emote, report, take, drop, give, trade, use, chat, listen, prepare, work, assist, rest, skill, calling, bond, settle, attack, defend, or flee.",
            )),
        }
    }

    fn look_command_output(
        &self,
        actor: CwActor,
        query: &str,
        access: &AccessContext,
        active_human_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<String, &'static str> {
        let query = trim_command_filler(query);
        if query.is_empty()
            || matches!(
                command_key(query).as_str(),
                "room" | "here" | "around" | "location"
            )
        {
            return Ok(self.room_command_output(actor, access, active_human_actor_ids));
        }
        if let Some(feature) = self.resolve_room_feature(actor.location_id, query).ok() {
            return Ok(format!("{} - {}", feature.name, feature.look));
        }
        if let Some(actor) = self
            .resolve_room_actor(
                actor,
                query,
                CommandActorFilter::Any,
                active_human_actor_ids,
            )
            .ok()
        {
            let view = self.actor_view(actor);
            let state = if actor.status == CW_ACTOR_ACTIVE {
                "active"
            } else {
                "not active"
            };
            return Ok(format!(
                "{} - {}\n{}\nStatus: {state}. HP: {}/{}.",
                view.name, view.title, view.description, view.hp, view.stats.hp_base
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

    fn search_command_output(&self, actor: CwActor, query: &str) -> Result<String, &'static str> {
        let query = trim_command_filler(query);
        if search_query_is_room(query) {
            let features = self
                .room_features(actor.location_id)
                .into_iter()
                .map(|feature| feature.name.clone())
                .collect::<Vec<_>>();
            if features.is_empty() {
                return Ok(
                    "You search the room, but nothing asks for closer attention yet.".to_string(),
                );
            }
            return Ok(format!(
                "The floor is empty. Searchable features: {}.",
                command_list_or_none(&features)
            ));
        }
        let feature = self.resolve_room_feature(actor.location_id, query)?;
        Ok(format!("{} - {}", feature.name, feature.search))
    }

    fn feature_use_result(
        &self,
        location_id: u64,
        query: &str,
        item_id: u64,
    ) -> Option<FeatureUseResult> {
        let feature = self.resolve_room_feature(location_id, query).ok()?;
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| item_id.to_string());
        if let Some(use_case) = feature
            .uses
            .iter()
            .find(|use_case| use_case.item_id == item_id)
        {
            return Some(FeatureUseResult {
                feature_key: feature.key.clone(),
                feature_name: feature.name.clone(),
                output: format!("{} - {}", feature.name, use_case.text),
                matched: true,
            });
        }
        Some(FeatureUseResult {
            feature_key: feature.key.clone(),
            feature_name: feature.name.clone(),
            output: format!(
                "{} - The {item_name} does not wake anything in this feature yet.",
                feature.name
            ),
            matched: false,
        })
    }

    fn room_command_output(
        &self,
        actor: CwActor,
        access: &AccessContext,
        active_human_actor_ids: Option<&BTreeSet<u64>>,
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
                    active_human_actor_ids,
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
        let features = self
            .room_features(location_id)
            .into_iter()
            .map(|feature| feature.name.clone())
            .collect::<Vec<_>>();
        let mut lines = vec![
            format!("{} - {}", location.name, location.title),
            location.description,
            format!("Here: {}.", command_list_or_none(&actors)),
            format!("Items: {}.", command_list_or_none(&items)),
            format!("Exits: {}.", command_list_or_none(&exits)),
            format!("Features: {}.", command_list_or_none(&features)),
        ];

        if let Some(sheet) = self.room_sheet_view(location_id) {
            let aspects = command_list_or_none(&sheet.aspects);
            lines.push(format!("Room: {} zone. Aspects: {}.", sheet.zone, aspects));
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
                    "{} Stakes: {} Progress: {progress}. Danger: {danger}",
                    job.premise, job.stakes
                )
            })
            .collect::<Vec<_>>();
        if !jobs.is_empty() {
            lines.push(format!("Jobs: {}.", jobs.join(" | ")));
        }

        if !clocks.is_empty() {
            let clock_lines = clocks.iter().map(clock_summary).collect::<Vec<_>>();
            lines.push(format!("Clocks: {}.", clock_lines.join(", ")));
        }

        let tags = self.tag_views(Some(actor.id), location_id);
        if !tags.is_empty() {
            let tag_lines = tags
                .into_iter()
                .map(|tag| format!("{} {}", tag.scope, tag.label))
                .collect::<Vec<_>>();
            lines.push(format!("Tags: {}.", tag_lines.join(", ")));
        }

        let ledger = self.visit_ledger_view(actor.id);
        if ledger.unbanked_count > 0 || ledger.banked_count > 0 || ledger.advancement_points > 0 {
            lines.push(format!(
                "Memory: {} ready mark{}, {} claimed, {} growth point{}.",
                ledger.unbanked_count,
                if ledger.unbanked_count == 1 { "" } else { "s" },
                ledger.banked_count,
                ledger.advancement_points,
                if ledger.advancement_points == 1 {
                    ""
                } else {
                    "s"
                }
            ));
        }

        lines.join("\n")
    }

    fn inventory_command_output(&self, actor_id: u64) -> String {
        let items = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| item.holder_actor_id == actor_id)
            .map(|item| self.item_view(item).name)
            .collect::<Vec<_>>();
        let capacity = self.actor_inventory_capacity(actor_id).unwrap_or(0);
        let count = items.len();
        if items.is_empty() {
            "Your hand is empty.".to_string()
        } else {
            format!(
                "You carry {} in your hand ({count}/{capacity}).",
                command_list_or_none(&items)
            )
        }
    }

    fn who_command_output(
        &self,
        location_id: u64,
        client_actor_id: Option<u64>,
        active_human_actor_ids: Option<&BTreeSet<u64>>,
    ) -> String {
        let actors = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| actor.location_id == location_id && actor.status == CW_ACTOR_ACTIVE)
            .filter(|actor| {
                self.actor_visible_in_projection(*actor, client_actor_id, active_human_actor_ids)
            })
            .map(|actor| {
                let view = self.actor_view(actor);
                format!("{} ({})", view.name, view.kind)
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
        active_human_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<CwActor, &'static str> {
        let candidates = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|candidate| {
                candidate.id != actor.id && candidate.location_id == actor.location_id
            })
            .filter(|candidate| {
                self.actor_visible_in_projection(*candidate, Some(actor.id), active_human_actor_ids)
            })
            .filter(|candidate| match filter {
                CommandActorFilter::Any => true,
                CommandActorFilter::ActiveNpc => {
                    candidate.kind == CW_ACTOR_NPC && candidate.status == CW_ACTOR_ACTIVE
                }
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
        active_human_actor_ids: Option<&BTreeSet<u64>>,
    ) -> String {
        let candidates = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|candidate| candidate.id != actor.id)
            .filter(|candidate| {
                self.actor_visible_in_projection(*candidate, Some(actor.id), active_human_actor_ids)
            })
            .filter(|candidate| match filter {
                CommandActorFilter::Any => true,
                CommandActorFilter::ActiveNpc => {
                    candidate.kind == CW_ACTOR_NPC && candidate.status == CW_ACTOR_ACTIVE
                }
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
