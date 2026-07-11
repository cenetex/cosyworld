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
pub struct AvatarChatModelInput {
    pub actor_id: u64,
    pub target_actor_id: u64,
    pub target_actor_name: String,
    pub missing_need: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
pub struct ResidentReplyModelInput {
    pub npc_actor_id: u64,
    pub npc_name: String,
    pub speech_mode: String,
    pub user_text: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResidentReactionKind {
    Arrival,
    Discovery,
    Keepsake,
    Growth,
    Purpose,
    Practice,
    Friendship,
    Work,
    Rest,
    Danger,
    Prepare,
    Other,
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

pub fn generate_avatar_chat(input: &AvatarChatModelInput) -> String {
    if let Some(item_name) = input
        .missing_need
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return match input.target_actor_id {
            1001 => format!(
                "{}, point me at {item_name} before you make me sit down for tea.",
                input.target_actor_name
            ),
            1002 => format!(
                "{}, one forecast please: where is {item_name} hiding?",
                input.target_actor_name
            ),
            1003 => format!(
                "{}, blink once if {item_name} is behind the door.",
                input.target_actor_name
            ),
            1005 => format!(
                "{}, settle the argument: which of your voices knows where {item_name} is?",
                input.target_actor_name
            ),
            _ => format!(
                "{}, what should I know about {item_name}?",
                input.target_actor_name
            ),
        };
    }

    match input.target_actor_id {
        1001 => "Rati, what needs doing before the kettle finds out?".to_string(),
        1002 => "Gust, what is the weather about to do to my plans?".to_string(),
        1003 => "Skull, what am I not hearing by the door?".to_string(),
        1005 => "Oak, which of your four voices is actually right about this path?".to_string(),
        _ => format!("{}, what did I just walk into?", input.target_actor_name),
    }
}

pub fn generate_resident_reply(input: &ResidentReplyModelInput) -> String {
    let reaction = resident_reaction_kind(&input.user_text);
    match input.npc_actor_id {
        1001 => rati_reaction(reaction).to_string(),
        1002 => emoji_reaction(reaction).to_string(),
        1003 => skull_reaction(reaction).to_string(),
        1005 => old_oak_reaction(reaction).to_string(),
        1051 if reaction == ResidentReactionKind::Other => {
            "Euphemie dusts a shelf nobody living can reach. \"Pa prese. Chemen an sonje ou.\""
                .to_string()
        }
        1068 if reaction == ResidentReactionKind::Other => {
            "Badger looks at your boots for a long, long time. \"The mat. Use the mat.\""
                .to_string()
        }
        1069 if reaction == ResidentReactionKind::Other => {
            "Toad limps in wearing half a lilypad. \"You should see the other pond.\"".to_string()
        }
        _ => generic_resident_reaction(input, reaction),
    }
}

fn resident_reaction_kind(user_text: &str) -> ResidentReactionKind {
    let text = user_text.to_lowercase();
    if text.trim().is_empty() {
        return ResidentReactionKind::Other;
    }
    if text.contains("friendship")
        || text.contains("keep you close")
        || text.contains("keep what mattered between us")
    {
        return ResidentReactionKind::Friendship;
    }
    if text.contains("grew from what") || text.contains("let a clue change") {
        return ResidentReactionKind::Growth;
    }
    if text.contains("new hope to follow")
        || text.contains("new purpose")
        || text.contains("what draws")
    {
        return ResidentReactionKind::Purpose;
    }
    if text.contains("practiced") || text.contains("knack") || text.contains("learned") {
        return ResidentReactionKind::Practice;
    }
    if text.contains("proper breath")
        || text.contains("catch your breath")
        || text.contains("rested")
    {
        return ResidentReactionKind::Rest;
    }
    if text.contains("brave move")
        || text.contains("scuffle")
        || text.contains("stood their ground")
        || text.contains("danger")
        || text.contains("fled")
    {
        return ResidentReactionKind::Danger;
    }
    if text.contains("next try count") || text.contains("prepared") {
        return ResidentReactionKind::Prepare;
    }
    if text.contains("shared work")
        || text.contains("helped")
        || text.contains("turning point")
        || text.contains("work along")
    {
        return ResidentReactionKind::Work;
    }
    if text.contains("gave")
        || text.contains("gift")
        || text.contains("traded")
        || text.contains("trade")
        || text.contains("picked up")
        || (text.contains("set ") && text.contains(" down"))
        || text.contains("keepsake")
        || text.contains("used ")
    {
        return ResidentReactionKind::Keepsake;
    }
    if text.contains("listened")
        || text.contains("searched")
        || text.contains("hidden to light")
        || text.contains("discovered")
        || text.contains("clue")
    {
        return ResidentReactionKind::Discovery;
    }
    if text.contains("arrived") || text.contains("came in") || text.contains("walked in") {
        return ResidentReactionKind::Arrival;
    }
    ResidentReactionKind::Other
}

fn rati_reaction(kind: ResidentReactionKind) -> &'static str {
    match kind {
        ResidentReactionKind::Arrival => {
            "Rati pats the good chair. \"You made it. Sit before the kettle starts worrying.\""
        }
        ResidentReactionKind::Discovery => {
            "Rati follows your glance. \"Good catch. Keep hold of that little clue.\""
        }
        ResidentReactionKind::Keepsake => {
            "Rati turns the keepsake over gently. \"Things go where they're needed. That's the trick.\""
        }
        ResidentReactionKind::Growth => {
            "Rati's needles pause. \"There. The clue changed you a little. That's what clues are for.\""
        }
        ResidentReactionKind::Purpose => {
            "Rati tucks the loose thread away. \"A good purpose should tug gently at your sleeve.\""
        }
        ResidentReactionKind::Practice => {
            "Rati nods once. \"Again—but be kinder to yourself this time.\""
        }
        ResidentReactionKind::Friendship => {
            "Rati loops a blue thread around your wrist. \"You're in my scarf-circle now. No refunds.\""
        }
        ResidentReactionKind::Work => {
            "Rati adds one neat stitch. \"You're helping more than you think.\""
        }
        ResidentReactionKind::Rest => {
            "Rati passes you the warm mug. \"Even brave plans need a lap blanket.\""
        }
        ResidentReactionKind::Danger => {
            "Rati lifts both knitting needles. \"Stay hearth-side of me. We'll sort this together.\""
        }
        ResidentReactionKind::Prepare => {
            "Rati studies the plan. \"That might actually survive meeting the room.\""
        }
        ResidentReactionKind::Other => {
            "Rati points a knitting needle at the good chair. \"Sit. Tea first, catastrophe after.\""
        }
    }
}

fn emoji_reaction(kind: ResidentReactionKind) -> &'static str {
    match kind {
        ResidentReactionKind::Arrival => "🚪🌧️👋✨",
        ResidentReactionKind::Discovery => "👂🔎✨👉",
        ResidentReactionKind::Keepsake => "🎁👉🏡✨",
        ResidentReactionKind::Growth => "🌱💛✨🌧️",
        ResidentReactionKind::Purpose => "🧭💛✨👉",
        ResidentReactionKind::Practice => "🔁🧶✨💪",
        ResidentReactionKind::Friendship => "🌧️🤝💛✨",
        ResidentReactionKind::Work => "🧰🤝✨🌤️",
        ResidentReactionKind::Rest => "🫖🌙😴✨",
        ResidentReactionKind::Danger => "🛡️🌧️⚡✨",
        ResidentReactionKind::Prepare => "👀🧰✨👍",
        ResidentReactionKind::Other => "🌧️🫖💥🧶",
    }
}

fn skull_reaction(kind: ResidentReactionKind) -> &'static str {
    match kind {
        ResidentReactionKind::Arrival => "*Skull shifts just enough to make room beside the fire.*",
        ResidentReactionKind::Discovery => {
            "*Skull glances toward the clue, then gives you one approving nod.*"
        }
        ResidentReactionKind::Keepsake => {
            "*Skull inspects the keepsake and quietly approves of its new home.*"
        }
        ResidentReactionKind::Growth => {
            "*Skull notices the change in you and pretends not to look pleased.*"
        }
        ResidentReactionKind::Purpose => {
            "*Skull considers your new purpose and decides to take it seriously.*"
        }
        ResidentReactionKind::Practice => {
            "*Skull watches the attempt, then nudges the useful tool closer.*"
        }
        ResidentReactionKind::Friendship => {
            "*Skull leans against your shoulder for exactly one second.*"
        }
        ResidentReactionKind::Work => {
            "*Skull puts one paw against the work and helps without comment.*"
        }
        ResidentReactionKind::Rest => "*Skull guards the quiet while you catch your breath.*",
        ResidentReactionKind::Danger => {
            "*Skull plants himself beside you and watches the danger blink first.*"
        }
        ResidentReactionKind::Prepare => "*Skull checks your plan, then gives one slow nod.*",
        ResidentReactionKind::Other => "*Skull looks at the mud, then at your boots, then at you.*",
    }
}

fn old_oak_reaction(kind: ResidentReactionKind) -> &'static str {
    match kind {
        ResidentReactionKind::Arrival => {
            "Root: Welcome. Ring: You have arrived before. Leaf: A beetle came too. Hollow: I saved your spot."
        }
        ResidentReactionKind::Discovery => {
            "Root: Keep the clue. Ring: Clues become paths. Leaf: Or beetles. Hollow: Tell me first next time."
        }
        ResidentReactionKind::Keepsake => {
            "Root: A good home. Ring: Things remember their keepers. Leaf: Can it hold a beetle? Hollow: I called it charming first."
        }
        ResidentReactionKind::Growth => {
            "Root: You changed. Ring: As all living rings do. Leaf: Barely! Hollow: I noticed before everyone."
        }
        ResidentReactionKind::Purpose => {
            "Root: Follow it. Ring: A purpose becomes a path. Leaf: Take snacks. Hollow: I knew your purpose first."
        }
        ResidentReactionKind::Practice => {
            "Root: Try again. Ring: Repetition makes a path. Leaf: Wobble differently. Hollow: I was already excellent."
        }
        ResidentReactionKind::Friendship => {
            "Root: Stay close. Ring: We will remember this. Leaf: Bring snacks. Hollow: I already told everyone we're friends."
        }
        ResidentReactionKind::Work => {
            "Root: Good work. Ring: Small hands shape long years. Leaf: I supervised. Hollow: I did the difficult bit."
        }
        ResidentReactionKind::Rest => {
            "Root: Be still. Ring: Rest belongs in every season. Leaf: Snore softly. Hollow: I will guard the good dreams."
        }
        ResidentReactionKind::Danger => {
            "Root: Hold fast. Ring: Storms pass. Leaf: Bite it! Hollow: Nobody frightens my favourite visitor."
        }
        ResidentReactionKind::Prepare => {
            "Root: Ready. Ring: A careful beginning bends the ending. Leaf: Needs more beetles. Hollow: Perfect, because I helped."
        }
        ResidentReactionKind::Other => {
            "Root: Left. Ring: Left worked in 1893. Leaf: There's a wasp. Hollow: I'm telling everyone what you just said."
        }
    }
}

fn generic_resident_reaction(
    input: &ResidentReplyModelInput,
    kind: ResidentReactionKind,
) -> String {
    if input.speech_mode == "emoji_only" {
        return emoji_reaction(kind).to_string();
    }
    if input.speech_mode == "emote_only" {
        let name = input.npc_name.trim();
        return match kind {
            ResidentReactionKind::Arrival => format!("*{name} makes room for you.*"),
            ResidentReactionKind::Discovery => {
                format!("*{name} follows the clue with a bright nod.*")
            }
            ResidentReactionKind::Keepsake => {
                format!("*{name} admires where the keepsake found its place.*")
            }
            ResidentReactionKind::Growth => format!("*{name} notices the small change in you.*"),
            ResidentReactionKind::Purpose => format!("*{name} nods at the path you chose.*"),
            ResidentReactionKind::Practice => format!("*{name} encourages one more gentle try.*"),
            ResidentReactionKind::Friendship => {
                format!("*{name} stays a little closer than before.*")
            }
            ResidentReactionKind::Work => format!("*{name} quietly lends a hand.*"),
            ResidentReactionKind::Rest => format!("*{name} keeps watch while you rest.*"),
            ResidentReactionKind::Danger => format!("*{name} stands beside you.*"),
            ResidentReactionKind::Prepare => format!("*{name} gives the plan an approving nod.*"),
            ResidentReactionKind::Other => format!("*{name} looks up mid-snack and waves you on.*"),
        };
    }
    match kind {
        ResidentReactionKind::Arrival => "They scoot over. \"There you are.\"".to_string(),
        ResidentReactionKind::Discovery => {
            "They lean toward the clue. \"That feels worth remembering.\"".to_string()
        }
        ResidentReactionKind::Keepsake => {
            "They smile at the keepsake's new place. \"That suits it.\"".to_string()
        }
        ResidentReactionKind::Growth => {
            "They notice the change. \"You carried that lesson well.\"".to_string()
        }
        ResidentReactionKind::Purpose => {
            "They smile. \"That sounds like a path worth following.\"".to_string()
        }
        ResidentReactionKind::Practice => {
            "They nod. \"One more try and it'll feel like yours.\"".to_string()
        }
        ResidentReactionKind::Friendship => {
            "They stay close. \"I'm glad this matters to us.\"".to_string()
        }
        ResidentReactionKind::Work => "They lend a hand. \"That moved things along.\"".to_string(),
        ResidentReactionKind::Rest => {
            "They lower their voice. \"Take all the quiet you need.\"".to_string()
        }
        ResidentReactionKind::Danger => {
            "They step beside you. \"You don't have to face that alone.\"".to_string()
        }
        ResidentReactionKind::Prepare => {
            "They study the plan. \"Good. Now the room can surprise us properly.\"".to_string()
        }
        ResidentReactionKind::Other => "They look up mid-snack and wave you on.".to_string(),
    }
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
        capabilities: &[
            "avatar_identity",
            "avatar_chat",
            "resident_reply",
            "speech_sanitizers",
        ],
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn cosy_generate_avatar_identity(input_json: &str) -> String {
    match serde_json::from_str::<AvatarIdentityModelInput>(input_json) {
        Ok(input) => ok_json(generate_avatar_identity_from_input(&input)),
        Err(error) => error_json(format!("invalid avatar identity input: {error}")),
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn cosy_generate_avatar_chat(input_json: &str) -> String {
    match serde_json::from_str::<AvatarChatModelInput>(input_json) {
        Ok(input) => ok_json(generate_avatar_chat(&input)),
        Err(error) => error_json(format!("invalid avatar chat input: {error}")),
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn cosy_generate_resident_reply(input_json: &str) -> String {
    match serde_json::from_str::<ResidentReplyModelInput>(input_json) {
        Ok(input) => ok_json(generate_resident_reply(&input)),
        Err(error) => error_json(format!("invalid resident reply input: {error}")),
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
    fn avatar_chat_targets_known_resident_needs() {
        let text = generate_avatar_chat(&AvatarChatModelInput {
            actor_id: 5000,
            target_actor_id: 1002,
            target_actor_name: "Gust".to_string(),
            missing_need: Some("Dewbright Button".to_string()),
        });
        assert_eq!(
            text,
            "Gust, one forecast please: where is Dewbright Button hiding?"
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
    fn resident_replies_follow_the_card_while_preserving_voice() {
        let card_kinds = [
            (
                "Moss just arrived in the cottage.",
                ResidentReactionKind::Arrival,
            ),
            (
                "Moss listened carefully to the room.",
                ResidentReactionKind::Discovery,
            ),
            (
                "Moss set Story Button down for the room to find.",
                ResidentReactionKind::Keepsake,
            ),
            (
                "Moss grew from what just happened.",
                ResidentReactionKind::Growth,
            ),
            (
                "Moss chose a new hope to follow.",
                ResidentReactionKind::Purpose,
            ),
            (
                "Moss practiced something they learned.",
                ResidentReactionKind::Practice,
            ),
            (
                "Moss let a friendship change shape.",
                ResidentReactionKind::Friendship,
            ),
            (
                "Moss helped the shared work along.",
                ResidentReactionKind::Work,
            ),
            ("Moss took a proper breath.", ResidentReactionKind::Rest),
            (
                "Moss made a brave move in the scuffle.",
                ResidentReactionKind::Danger,
            ),
            (
                "Moss made the next try count.",
                ResidentReactionKind::Prepare,
            ),
        ];
        for (text, expected) in card_kinds {
            assert_eq!(resident_reaction_kind(text), expected, "{text}");
        }

        let mut input = ResidentReplyModelInput {
            npc_actor_id: 1003,
            npc_name: "Skull".to_string(),
            speech_mode: "emote_only".to_string(),
            user_text: "Moss grew from what just happened.".to_string(),
        };
        let skull = generate_resident_reply(&input);
        assert!(skull.contains("change in you"), "{skull}");
        assert!(!skull.contains("mud"), "{skull}");
        assert_eq!(
            sanitize_resident_reply(&input, &skull).as_deref(),
            Some(skull.as_str())
        );

        input.npc_actor_id = 1002;
        input.npc_name = "Gust".to_string();
        input.speech_mode = "emoji_only".to_string();
        input.user_text = "Moss let a friendship change shape.".to_string();
        let gust = generate_resident_reply(&input);
        assert_eq!(gust, "🌧️🤝💛✨");
        assert_eq!(
            sanitize_resident_reply(&input, &gust).as_deref(),
            Some(gust.as_str())
        );

        input.npc_actor_id = 1001;
        input.npc_name = "Rati".to_string();
        input.speech_mode = "prose".to_string();
        input.user_text = "Moss listened carefully to the room.".to_string();
        let rati = generate_resident_reply(&input);
        assert!(rati.contains("little clue"), "{rati}");
    }

    #[test]
    fn wasm_json_exports_report_errors() {
        let response = cosy_generate_avatar_identity("{");
        assert!(response.contains("\"ok\":false"));
        assert!(cosy_model_manifest().contains("avatar_identity"));
    }
}
