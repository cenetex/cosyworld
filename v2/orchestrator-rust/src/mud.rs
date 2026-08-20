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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) error_kind: Option<CommandErrorKind>,
    pub(crate) action: Option<CommandActionView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) receipt: Option<CanonicalCommandReceipt>,
    pub(crate) events: Vec<EventView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CommandRequest {
    pub(crate) actor_id: u64,
    pub(crate) actor_session: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) offer_id: Option<String>,
    pub(crate) wallet_session: Option<String>,
    #[serde(default)]
    pub(crate) envelope: Option<CanonicalCommandEnvelope>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CommandErrorKind {
    ParseFailure,
    ProseRetired,
    InvalidOfferId,
    StaleOffer,
    UnknownOffer,
    DisabledOffer,
    StaleActorVersion,
    StaleLocationVersion,
    StaleEntityVersion,
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
    Pass {
        think: ActionHandPassView,
    },
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
    Scout {
        destination_location_id: u64,
    },
    Flee {
        destination_location_id: u64,
    },
    OpenThreshold {
        action: Box<CwAction>,
    },
    NoticeActor {
        target_actor_id: u64,
    },
    Check,
    Study,
    Discover {
        procedure: String,
        slot_id: String,
        receipt_id: String,
    },
    Chat {
        target_actor_id: u64,
    },
    ModelInteraction {
        target_actor_id: u64,
    },
    Influence {
        target_actor_id: u64,
    },
    CastSpell {
        item_id: u64,
        target_actor_id: u64,
    },
    PickUp {
        item_id: u64,
        exchange_item_id: Option<u64>,
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
    Contribute {
        job_id: String,
        strategy_id: String,
        action_kind: String,
    },
    Work,
    Help,
    Governance {
        action: GovernanceAction,
    },
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
    pub(crate) kind: CommandErrorKind,
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

const ADVANCEMENT_NEXT_STEP: &str =
    "Try listen or study; a successful discovery banks advancement automatically.";

fn advancement_gate_output(subject: &str) -> String {
    format!("{subject} needs one banked advancement point. {ADVANCEMENT_NEXT_STEP}")
}

pub(crate) fn command_submission_identity(payload: &CommandRequest) -> String {
    payload
        .offer_id
        .as_deref()
        .map(str::trim)
        .map(|offer_id| format!("offer_id:{offer_id}"))
        .unwrap_or_else(|| "offer_id:".to_string())
}

pub(crate) fn command_verb_and_rest(command: &str) -> (String, &str) {
    command
        .split_once(' ')
        .map(|(verb, rest)| (verb.to_lowercase(), rest.trim()))
        .unwrap_or_else(|| (command.to_lowercase(), ""))
}

fn strip_ascii_command_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let head = value.get(..prefix.len())?;
    let tail = value.get(prefix.len()..)?;
    head.eq_ignore_ascii_case(prefix)
        .then_some(tail)
        .filter(|tail| tail.is_empty() || tail.starts_with(char::is_whitespace))
        .map(str::trim)
}

pub(crate) fn canonical_command_verb(verb: &str) -> String {
    if canonical_direction(verb).is_some() {
        return "go".to_string();
    }
    match verb {
        "l" | "look" | "examine" | "inspect" => "look",
        "search" | "find" => "search",
        "i" | "inv" | "inventory" | "deck" | "pack" => "inventory",
        "who" | "where" => "who",
        "go" | "move" | "travel" => "go",
        "open" | "unlock" | "unseal" => "open",
        "scout" | "explore" => "scout",
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
        "talk" | "chat" => "chat",
        "influence" | "persuade" => "influence",
        "cast" | "magic" => "cast",
        "prepare-spell" => "prepare-spell",
        "unprepare-spell" => "unprepare-spell",
        "listen" | "check" => "listen",
        "study" | "analyze" => "study",
        "prepare" | "ready" => "prepare",
        "contribute" => "contribute",
        "work" | "repair" => "work",
        "assist" | "aid" => "assist",
        "choice" | "choices" | "decision" | "projects" => "governance",
        "support" | "vote" | "back" => "support",
        "choose" | "select" => "choose",
        "delegate" => "delegate",
        "rest" | "breathe" | "catch" => "rest",
        "shuffle" | "deal" | "more" | "redraw" | "draw" => "redeal-retired",
        "grow" | "bank" | "review" | "advance" => "bank",
        "bracelet" => "bracelet",
        "wear" | "equip" => "wear",
        "unwear" | "unequip" | "remove" => "unwear",
        "wield" | "sling" => "equip-item",
        "unwield" | "unsling" => "unequip-item",
        "stow" => "stow",
        "unstow" | "unpack" => "unstow",
        "skill" | "train" | "practice" => "skill",
        "bond" | "relationship" | "friendship" => "bond",
        "calling" | "drive" | "purpose" | "revise" => "calling",
        "remember" | "resolve" | "settle" => "resolve",
        "hit" | "attack" | "strike" => "attack",
        "guard" | "defend" => "defend",
        "run" | "flee" | "escape" => "flee",
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
        kind: CommandErrorKind::ParseFailure,
    }
}

pub(crate) fn offer_command_error(
    _offer_id: &str,
    kind: CommandErrorKind,
    status: u32,
    output: impl Into<String>,
) -> CommandError {
    CommandError {
        command: String::new(),
        verb: String::new(),
        status,
        output: output.into(),
        kind,
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
        error_kind: None,
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
        return "Reconnect your account to restore this same avatar; the world will not replace it."
            .to_string();
    }
    if status >= 500 {
        return "That choice got lost before the room could answer. Try once more.".to_string();
    }
    match &resolved.dispatch {
        CommandDispatch::Pass { .. } => "That Think is no longer current. Refresh the scene.",
        CommandDispatch::Move { .. } => "That path is not open from here right now.",
        CommandDispatch::Scout { .. } => "That route can no longer be scouted from here.",
        CommandDispatch::Flee { .. } => "The room has calmed; flee is not needed.",
        CommandDispatch::OpenThreshold { .. } => {
            "That threshold method changed while you were choosing. Look again."
        }
        CommandDispatch::NoticeActor { .. } => {
            "That observable fact changed while you were choosing. Look again."
        }
        CommandDispatch::Check => "The room did not catch that Listen. Try once more.",
        CommandDispatch::Study => "There is no authored subject to Study here now.",
        CommandDispatch::Discover { .. } => {
            "That discovery claim changed while you were choosing. Look again."
        }
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
        CommandDispatch::Contribute { .. } => "That contribution strategy is no longer available.",
        CommandDispatch::Work => "That work is not ready for you right now.",
        CommandDispatch::Help => "No one needs that kind of help here right now.",
        CommandDispatch::Governance { .. } => {
            "That shared choice changed while you were choosing; try choice again."
        }
        CommandDispatch::Rest => "You are already fresh enough to keep going.",
        CommandDispatch::UnlockCharmSlot => {
            "That loadout need changed. Check Pack & Loadout for a specific charm."
        }
        CommandDispatch::SetCharmEquipped { .. } => {
            "That charm loadout changed while you were choosing. Check your Pack."
        }
        CommandDispatch::SetSpellPrepared { .. } => {
            "That spell loadout changed while you were choosing. Check Prepared spells."
        }
        CommandDispatch::SetItemEquipped { .. } => {
            "That equipment slot changed while you were choosing. Check your Pack."
        }
        CommandDispatch::SetItemContained { .. } => {
            "Those container contents changed while you were choosing. Check your Pack."
        }
        CommandDispatch::ReviseCalling { .. } => "That purpose cannot change just now.",
        CommandDispatch::Chat { .. } => "That conversation is no longer within reach.",
        CommandDispatch::ModelInteraction { .. } => {
            "That model interaction is no longer within reach."
        }
        CommandDispatch::CreateBond { .. } => "There is not a friendship ready to grow just now.",
        CommandDispatch::ReviseBond { .. } => "That friendship cannot change right now.",
        CommandDispatch::TrainSkill { .. } => {
            "Earn advancement through play, then you can practice that knack."
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
        error_kind: None,
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
    if let Some(receipt) = events.iter().rev().find_map(|event| {
        crate::semantic_receipts::semantic_story_receipt(event)
            .filter(|_| actor_id.is_none() || event.actor_id == actor_id)
    }) {
        return Some(receipt.text);
    }
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
    let crafted = output_events
        .iter()
        .any(|event| event.type_name == "item.crafted" && event.success);
    let studied = output_events
        .iter()
        .any(|event| event.type_name == "study.resolved");
    for event in &output_events {
        if crafted && event.type_name == "item.created" {
            continue;
        }
        if studied && event.type_name == "ability_check.rolled" {
            continue;
        }
        if matches!(
            event.type_name.as_str(),
            "clock.updated" | "clock.threshold" | "job.updated"
        ) && (causal_job_contribution(&output_events, event).is_some()
            || physical_delivery_for_event(&output_events, event).is_some())
        {
            continue;
        }
        let line = if event.type_name == "job.contribution.resolved" {
            job_contribution_receipt(event, &output_events)
        } else if event.type_name == "world.logistics.completed" {
            physical_delivery_receipt(event, &output_events)
        } else {
            command_event_output(event)
        };
        let Some(line) = line else {
            continue;
        };
        if !lines.iter().any(|existing| existing == &line) {
            lines.push(line);
        }
    }
    (!lines.is_empty()).then(|| lines.join("\n"))
}

fn causal_job_contribution<'a>(
    events: &'a [&EventView],
    event: &EventView,
) -> Option<&'a EventView> {
    let mut cause = event.caused_by_event_seq?;
    for _ in 0..events.len() {
        let parent = events
            .iter()
            .copied()
            .find(|candidate| candidate.seq == cause)?;
        if parent.type_name == "job.contribution.resolved" {
            return Some(parent);
        }
        cause = parent.caused_by_event_seq?;
    }
    None
}

fn job_contribution_receipt(event: &EventView, events: &[&EventView]) -> Option<String> {
    let trace = event
        .content
        .as_deref()
        .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())?;
    let descendants = events
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.seq != event.seq
                && causal_job_contribution(events, candidate)
                    .is_some_and(|root| root.seq == event.seq)
        })
        .collect::<Vec<_>>();
    let clock = descendants.iter().copied().find(|candidate| {
        candidate.type_name == "clock.updated"
            && candidate.clock_id.as_deref() == Some(trace.clock_id.as_str())
    });
    let threshold = descendants
        .iter()
        .copied()
        .find(|candidate| candidate.type_name == "clock.threshold");
    let settled = descendants
        .iter()
        .any(|candidate| candidate.type_name == "job.updated");
    let headway = if trace.total_progress == 1 {
        "1 step".to_string()
    } else {
        format!("{} steps", trace.total_progress)
    };
    let outcome = if trace.outcome == "failure" {
        " The attempt falls short, but the careful groundwork still counts."
    } else {
        ""
    };
    let progress = clock
        .and_then(|clock| clock.clock_filled.zip(clock.clock_segments))
        .map(|(filled, segments)| format!(" Progress: {filled}/{segments}."))
        .unwrap_or_default();
    let credit = clock
        .is_some()
        .then_some(" Your contribution is remembered here.")
        .unwrap_or_default();
    let revelation = threshold
        .and_then(|threshold| threshold.content.as_deref())
        .map(|text| format!(" {}", text.trim().trim_end_matches('.')))
        .filter(|text| !text.trim().is_empty())
        .map(|text| format!("{text}."))
        .unwrap_or_default();
    let completion = settled
        .then_some(" The shared question is settled.")
        .unwrap_or_default();
    Some(format!(
        "You try to {} at {}; the shared work gains {headway}.{progress}{credit}{outcome}{revelation}{completion}",
        trace.strategy_label.to_lowercase(),
        trace.target.label
    ))
}

fn physical_delivery_for_event<'a>(
    events: &'a [&EventView],
    event: &EventView,
) -> Option<&'a EventView> {
    let cause = event.caused_by_event_seq?;
    events.iter().copied().find(|candidate| {
        candidate.type_name == "world.logistics.completed"
            && candidate.caused_by_event_seq == Some(cause)
    })
}

fn physical_delivery_receipt(event: &EventView, events: &[&EventView]) -> Option<String> {
    let summary = event
        .content
        .as_deref()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
        .and_then(|evidence| {
            evidence
                .get("summary")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })?;
    let progress = event.caused_by_event_seq.and_then(|cause| {
        events
            .iter()
            .copied()
            .find(|candidate| {
                candidate.type_name == "clock.updated"
                    && candidate.caused_by_event_seq == Some(cause)
            })
            .and_then(|clock| clock.clock_filled.zip(clock.clock_segments))
    });
    Some(match progress {
        Some((filled, segments)) => format!(
            "{} The need is answered ({filled}/{segments}), and the contribution is remembered here.",
            summary.trim().trim_end_matches('.')
        ),
        None => summary,
    })
}

pub(crate) fn command_event_output(event: &EventView) -> Option<String> {
    match event.type_name.as_str() {
        "message.created" => event.content.clone(),
        "avatar.thought" => event
            .content
            .as_ref()
            .map(|content| format!("You think: {content}")),
        "avatar.dream" => event
            .content
            .as_ref()
            .map(|content| format!("You dream: {content}")),
        "avatar.self_description" => event.content.as_ref().map(|content| {
            format!(
                "At level {}, you describe yourself: {content}",
                event.total.unwrap_or(1)
            )
        }),
        "transfer.offer_created"
        | "transfer.offer_declined"
        | "transfer.offer_withdrawn"
        | "transfer.offer_unchanged"
        | "gift.requested"
        | "actor.safety_changed" => event.content.clone(),
        "hand.shuffled" => Some("Your Story Hand changes.".to_string()),
        "hand.thought" => Some("You Think and replace one card.".to_string()),
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
        "item.revealed" => Some(format!(
            "You reveal {}.",
            event.item_name.as_deref().unwrap_or("an item")
        )),
        "exit.unlocked" => Some(event.content.clone().unwrap_or_else(|| {
            format!(
                "The way to {} opens.",
                event
                    .destination_location_name
                    .as_deref()
                    .unwrap_or("somewhere new")
            )
        })),
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
        "item.crafted" => event.content.clone().or_else(|| {
            Some(match event.target_item_name.as_deref() {
                Some(second) => format!(
                    "You craft with {} and {second}.",
                    event.item_name.as_deref().unwrap_or("one item")
                ),
                None => format!(
                    "You craft with {}.",
                    event.item_name.as_deref().unwrap_or("one item")
                ),
            })
        }),
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
            "You prepare {} in Prepared spells.",
            event.item_name.as_deref().unwrap_or("a spell card")
        )),
        "spell.unprepared" => Some(format!(
            "You remove {} from Prepared spells.",
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
        "notice.fact_revealed" => event.content.clone(),
        "study.resolved" => Some(
            if event
                .content
                .as_deref()
                .is_some_and(|content| content.contains("yielded"))
            {
                "You study the signs and understand their meaning."
            } else {
                "You study the signs, but their meaning stays unclear."
            }
            .to_string(),
        ),
        "ability_check.rolled" => Some(match (event.content.as_deref(), event.success) {
            (Some("think"), true) => {
                "Your Intelligence check succeeds; a thought is forming asynchronously.".to_string()
            }
            (Some("think"), false) => {
                "Your Intelligence check misses; no thought is generated this time.".to_string()
            }
            (Some("dream"), true) => {
                "Your Wisdom check succeeds; a dream is forming asynchronously.".to_string()
            }
            (Some("dream"), false) => {
                "Your Wisdom check misses; no dream is generated this time.".to_string()
            }
            (Some("study"), true) => {
                "You study the signs and understand their meaning.".to_string()
            }
            (Some("study"), false) => {
                "You study the signs, but their meaning stays unclear.".to_string()
            }
            (_, true) => "You check carefully, and the room answers.".to_string(),
            (_, false) => "You check carefully, but the room keeps its secret.".to_string(),
        }),
        "job.contribution.resolved" => event
            .content
            .as_deref()
            .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
            .map(|trace| {
                let headway = if trace.total_progress == 1 {
                    "1 step".to_string()
                } else {
                    format!("{} steps", trace.total_progress)
                };
                let outcome = if trace.outcome == "failure" {
                    " The attempt falls short, but the careful groundwork still counts."
                } else {
                    ""
                };
                format!(
                    "You try to {} at {}; the shared work gains {headway}.{outcome}",
                    trace.strategy_label.to_lowercase(),
                    trace.target.label
                )
            })
            .or_else(|| Some("Your approach changes the shared work.".to_string())),
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
        "clock.threshold" => event.content.clone(),
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
        "rule.rejected" => Some(
            event
                .content
                .as_deref()
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .unwrap_or_else(|| kernel_rejection_message(event.reason))
                .to_string(),
        ),
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
    pub(crate) fn item_can_be_equipped(&self, item: &CwItem) -> bool {
        matches!(item.role, CW_ITEM_ROLE_WEAPON | CW_ITEM_ROLE_CONTAINER)
            || (item.role == CW_ITEM_ROLE_TOOL
                && self
                    .seed_item_contract_for_instance(item.id)
                    .is_some_and(|contract| {
                        contract
                            .capabilities
                            .iter()
                            .any(|capability| capability == CAMP_SHELTER_ITEM_CAPABILITY)
                    }))
    }

    #[cfg(test)]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::create_test_human;

    fn command_request(command: &str) -> CommandRequest {
        CommandRequest {
            actor_id: 5000,
            actor_session: None,
            command: command.to_string(),
            offer_id: None,
            wallet_session: None,
            envelope: None,
        }
    }

    fn disabled_output(runtime: &RuntimeWorld, command: &str) -> String {
        let resolved = runtime
            .resolve_command(&command_request(command), &AccessContext::default())
            .unwrap_or_else(|error| panic!("{command} should resolve: {error:?}"));
        match resolved.dispatch {
            CommandDispatch::Disabled { status, output } => {
                assert_eq!(status, 409, "{command} should be advancement-gated");
                output
            }
            other => panic!("{command} should be disabled, got {other:?}"),
        }
    }

    fn assert_actionable_advancement_gate(output: &str) {
        assert!(output.contains("one banked advancement point"));
        assert!(output.contains("listen or study"));
        assert!(output.contains("banks advancement automatically"));
        assert!(!output.contains("Grow first"));
    }

    #[test]
    fn zero_point_social_and_calling_gates_name_a_reachable_next_action() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "New Friend");
        assert_eq!(runtime.advancement_points_available(5000), 0);

        let chat = runtime
            .resolve_command(&command_request("chat Rati"), &AccessContext::default())
            .expect("free Chat should resolve without advancement");
        assert!(
            matches!(
                chat.dispatch,
                CommandDispatch::Chat {
                    target_actor_id: RATI_ACTOR_ID
                }
            ),
            "Chat is conversation, not an advancement-spending friendship action"
        );

        for command in [
            "purpose I listen for odd jobs.",
            "friendship Rati: I bring small kindnesses to Rati.",
        ] {
            assert_actionable_advancement_gate(&disabled_output(&runtime, command));
        }

        let friendship_id = bond_id(5000, RATI_ACTOR_ID);
        runtime.bonds.insert(
            friendship_id.clone(),
            BondState {
                id: friendship_id,
                actor_id: 5000,
                target_actor_id: RATI_ACTOR_ID,
                statement: "I bring small kindnesses to Rati.".to_string(),
                strength: 1,
                status: "active".to_string(),
                source_event_seq: Some(90_407),
                updated_event_seq: Some(90_407),
                dialogue_status: String::new(),
                dialogue_event_seq: None,
            },
        );
        assert_actionable_advancement_gate(&disabled_output(
            &runtime,
            "friendship Rati: I listen when Rati needs company.",
        ));
    }

    #[test]
    fn retired_growth_aliases_are_actionable_but_absent_from_help() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Journal Reader",
        );

        for command in ["grow", "bank"] {
            let resolved = runtime
                .resolve_command(&command_request(command), &AccessContext::default())
                .unwrap_or_else(|error| panic!("{command} should resolve: {error:?}"));
            match resolved.dispatch {
                CommandDispatch::Read { output } => {
                    assert!(output.contains("has retired"));
                    assert!(output.contains("listen or study"));
                    assert!(output.contains("banks advancement automatically"));
                }
                other => panic!("{command} should explain its retirement, got {other:?}"),
            }
        }

        let help = runtime
            .resolve_command(&command_request("help"), &AccessContext::default())
            .expect("help should resolve");
        match help.dispatch {
            CommandDispatch::Read { output } => {
                assert!(!output.contains(", grow"));
                assert!(!output.contains(", bank"));
            }
            other => panic!("help should be read-only, got {other:?}"),
        }
    }

    #[test]
    fn semantic_model_commands_consume_case_insensitive_phrases_without_losing_target_case() {
        assert_eq!(
            strip_ascii_command_prefix("Resonance Echo Prime", "resonance"),
            Some("Echo Prime")
        );
        assert_eq!(
            strip_ascii_command_prefix("ECHOES Model Seven", "echoes"),
            Some("Model Seven")
        );
        assert_eq!(
            strip_ascii_command_prefix("resonances Echo", "resonance"),
            None
        );
        assert_eq!(canonical_command_verb("speak"), "speak");
    }
}
