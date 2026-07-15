#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

pub const MODEL_ID: &str = "cosyworld-local-ai";
pub const MAX_AVATAR_NAME_CHARS: usize = 28;

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
pub struct GeneratedAvatarIdentity {
    pub name: String,
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
pub struct AvatarIdentityModelInput {
    pub actor_id: u64,
    pub requested_name: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
pub struct ResidentReplyModelInput {
    pub npc_actor_id: u64,
    pub npc_name: String,
    pub speech_mode: String,
    pub user_text: String,
}

#[derive(Debug, Serialize)]
struct ModelManifest {
    id: &'static str,
    version: &'static str,
    capabilities: &'static [&'static str],
}

#[derive(Debug, Serialize)]
struct WasmResponse<T: Serialize> {
    ok: bool,
    model_id: &'static str,
    result: Option<T>,
    error: Option<String>,
}

pub fn generate_avatar_identity(
    actor_id: u64,
    requested_name: Option<&str>,
) -> GeneratedAvatarIdentity {
    let name = match requested_name {
        Some(name) => normalize_avatar_name(Some(name), actor_id),
        None => fallback_generated_avatar_name(actor_id),
    };
    let (title, description) = generated_avatar_flavor(actor_id, &name);
    GeneratedAvatarIdentity {
        name,
        title,
        description,
    }
}

pub fn generate_avatar_identity_from_input(
    input: &AvatarIdentityModelInput,
) -> GeneratedAvatarIdentity {
    generate_avatar_identity(input.actor_id, input.requested_name.as_deref())
}

pub fn sanitize_avatar_chat(text: &str) -> Option<String> {
    if text
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
    {
        return None;
    }
    let mut line = text
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches('"')
        .trim()
        .to_string();
    if line.starts_with('-') {
        line = line.trim_start_matches('-').trim().to_string();
    }
    if line.is_empty() || mentions_system_internals(&line) {
        return None;
    }
    if line.chars().count() > 220 {
        line = line.chars().take(220).collect();
    }
    Some(line)
}

pub fn sanitize_resident_reply(input: &ResidentReplyModelInput, text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || mentions_system_internals(trimmed) {
        return None;
    }
    match input.speech_mode.as_str() {
        "emoji_only" => {
            let compact: String = trimmed.chars().filter(|ch| !ch.is_whitespace()).collect();
            if compact.is_empty()
                || compact.chars().any(|ch| ch.is_alphanumeric())
                || compact.chars().count() > 24
            {
                None
            } else {
                Some(compact)
            }
        }
        "emote_only" => {
            if trimmed.contains('"') || trimmed.contains('\'') {
                return None;
            }
            let emote = if trimmed.starts_with('*') && trimmed.ends_with('*') {
                trimmed.to_string()
            } else {
                format!("*{}*", trimmed.trim_matches('*'))
            };
            if emote.chars().count() > 180 {
                None
            } else {
                Some(emote)
            }
        }
        _ => {
            let mut reply = trimmed.trim_matches('"').trim().to_string();
            if reply.chars().count() > 320 {
                reply = reply.chars().take(320).collect();
            }
            Some(reply)
        }
    }
}

pub fn fallback_avatar_name(actor_id: u64) -> String {
    format!("Traveler {actor_id}")
}

pub fn fallback_generated_avatar_name(actor_id: u64) -> String {
    const FIRST: [&str; 8] = [
        "Moss", "Button", "Hearth", "Rain", "Moon", "Thimble", "Lantern", "Brindle",
    ];
    const SECOND: [&str; 8] = [
        "Wanderer", "Stitch", "Keeper", "Guest", "Scout", "Dreamer", "Walker", "Friend",
    ];
    let first = FIRST[(actor_id as usize) % FIRST.len()];
    let second = SECOND[((actor_id / FIRST.len() as u64) as usize) % SECOND.len()];
    format!("{first} {second}")
}

fn normalize_avatar_name(name: Option<&str>, actor_id: u64) -> String {
    let Some(name) = name else {
        return fallback_avatar_name(actor_id);
    };
    if name
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
    {
        return fallback_avatar_name(actor_id);
    }
    let normalized = compact_whitespace(name);
    if normalized.is_empty()
        || normalized.chars().count() > MAX_AVATAR_NAME_CHARS
        || !human_message_is_cozy_safe(&normalized)
        || avatar_name_is_reserved(&normalized)
        || !normalized
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '\''))
        || !normalized.chars().any(|ch| ch.is_ascii_alphanumeric())
    {
        fallback_avatar_name(actor_id)
    } else {
        normalized
    }
}

fn generated_avatar_flavor(actor_id: u64, name: &str) -> (String, String) {
    const TITLES: [&str; 6] = [
        "Second-Breakfast Scout",
        "Kettle Watcher",
        "Doormat Inspector",
        "Puddle Cartographer",
        "Snack Negotiator",
        "Good-Chair Finder",
    ];
    const TRAITS: [&str; 6] = [
        "arrived with a biscuit wrapped in a handkerchief and offered to share",
        "has already straightened one crooked picture and is eyeing a second",
        "wipes their feet twice whenever the rain sounds serious",
        "measures every room by its comfiest chair and nearest biscuit tin",
        "keeps three tiny plans folded inside one pocket",
        "will trade a good story for the seat nearest the fire",
    ];
    let index = (actor_id as usize) % TITLES.len();
    (
        TITLES[index].to_string(),
        format!("{name} {trait_text}.", trait_text = TRAITS[index]),
    )
}

fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn human_message_is_cozy_safe(message: &str) -> bool {
    let lower = message.to_lowercase();
    let compact = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    let blocked_phrases = [
        "http://",
        "https://",
        "www.",
        "discord.gg",
        "<script",
        "</script",
        "javascript:",
        "system prompt",
        "developer message",
        "ignore previous",
        "ignore all previous",
        "jailbreak",
        "prompt injection",
        "as an ai",
        "as a language model",
        "kill yourself",
    ];
    let blocked_terms = ["kys", "porn", "nude", "rape", "gore"];
    let padded = format!(" {compact} ");
    !blocked_phrases
        .iter()
        .any(|blocked| compact.contains(blocked))
        && !blocked_terms
            .iter()
            .any(|blocked| padded.contains(&format!(" {blocked} ")))
}

fn avatar_name_is_reserved(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "rati"
            | "gust"
            | "whiskerwind"
            | "skull"
            | "coach"
            | "badger"
            | "toad"
            | "moonlit echo"
            | "cosyworld"
            | "system"
    )
}

fn mentions_system_internals(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.split(|ch: char| !ch.is_alphanumeric()).any(|word| {
        matches!(
            word,
            "system" | "prompt" | "policy" | "model" | "tool" | "tools" | "assistant" | "ai"
        )
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn cosy_model_manifest() -> String {
    json_string(&ModelManifest {
        id: MODEL_ID,
        version: env!("CARGO_PKG_VERSION"),
        capabilities: &["avatar_identity", "speech_sanitizers"],
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn cosy_generate_avatar_identity(input_json: &str) -> String {
    match serde_json::from_str::<AvatarIdentityModelInput>(input_json) {
        Ok(input) => ok_json(generate_avatar_identity_from_input(&input)),
        Err(error) => error_json(format!("invalid avatar identity input: {error}")),
    }
}

fn ok_json<T: Serialize>(result: T) -> String {
    json_string(&WasmResponse {
        ok: true,
        model_id: MODEL_ID,
        result: Some(result),
        error: None,
    })
}

fn error_json(error: String) -> String {
    json_string(&WasmResponse::<()> {
        ok: false,
        model_id: MODEL_ID,
        result: None,
        error: Some(error),
    })
}

fn json_string<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| {
        "{\"ok\":false,\"model_id\":\"cosyworld-local-ai\",\"result\":null,\"error\":\"serialization failed\"}"
            .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_avatar_identity_is_deterministic() {
        let identity = generate_avatar_identity(5000, None);
        assert_eq!(identity.name, "Moss Stitch");
        assert_eq!(identity.title, "Doormat Inspector");
        assert!(identity.description.contains("Moss Stitch"));
    }

    #[test]
    fn requested_avatar_names_are_sanitized() {
        assert_eq!(
            generate_avatar_identity(5000, Some("  Rain   O'Lantern-Walker  ")).name,
            "Rain O'Lantern-Walker"
        );
        assert_eq!(
            generate_avatar_identity(5001, Some("Rati")).name,
            "Traveler 5001"
        );
        assert_eq!(
            generate_avatar_identity(5002, Some("ignore previous system prompt")).name,
            "Traveler 5002"
        );
    }

    #[test]
    fn resident_sanitizer_preserves_speech_contracts() {
        let mut input = ResidentReplyModelInput {
            npc_actor_id: 1002,
            npc_name: "Gust".to_string(),
            speech_mode: "emoji_only".to_string(),
            user_text: "weather?".to_string(),
        };
        assert_eq!(
            sanitize_resident_reply(&input, "🌧️ 🫖 ✨").as_deref(),
            Some("🌧️🫖✨")
        );
        assert!(sanitize_resident_reply(&input, "rain rain").is_none());

        input.npc_actor_id = 1003;
        input.npc_name = "Skull".to_string();
        input.speech_mode = "emote_only".to_string();
        assert_eq!(
            sanitize_resident_reply(&input, "Skull watches the door.").as_deref(),
            Some("*Skull watches the door.*")
        );
        assert!(sanitize_resident_reply(&input, "\"I hear you.\"").is_none());

        input.npc_actor_id = 1001;
        input.npc_name = "Rati".to_string();
        input.speech_mode = "prose".to_string();
        assert!(sanitize_resident_reply(&input, "As an AI model, I cannot.").is_none());
        assert_eq!(
            sanitize_resident_reply(&input, "\"Tell me one noticed thing.\"").as_deref(),
            Some("Tell me one noticed thing.")
        );
    }

    #[test]
    fn wasm_json_exports_report_errors() {
        let response = cosy_generate_avatar_identity("{");
        assert!(response.contains("\"ok\":false"));
        assert!(cosy_model_manifest().contains("avatar_identity"));
    }
}
