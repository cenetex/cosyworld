use serde::{Deserialize, Serialize};

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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CommandErrorKind {
    ParseFailure,
    InvalidRequest,
    InvalidOfferId,
    StaleOffer,
    UnknownOffer,
    DisabledOffer,
    StaleActorVersion,
    StaleLocationVersion,
    StaleEntityVersion,
    ServerOverloaded,
    ServerUnavailable,
    ResponseEncodingFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CommandActionView {
    pub(crate) kind: String,
    pub(crate) label: String,
    pub(crate) command: String,
}

pub(crate) fn normalize_command_text(input: &str) -> String {
    input
        .trim()
        .trim_start_matches('/')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
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

impl RuntimeWorld {}
