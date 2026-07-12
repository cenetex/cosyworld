use cosyworld_ai_model::GeneratedAvatarIdentity as ModelGeneratedAvatarIdentity;

use super::{
    content_policy::{
        compact_whitespace, has_disallowed_control_character, human_message_is_cozy_safe,
    },
    trim_to_chars,
};

pub(super) const MAX_AVATAR_NAME_CHARS: usize = 28;

#[derive(Clone, Debug)]
pub(super) struct GeneratedAvatarIdentity {
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) visual_prompt: String,
}

impl From<ModelGeneratedAvatarIdentity> for GeneratedAvatarIdentity {
    fn from(identity: ModelGeneratedAvatarIdentity) -> Self {
        let visual_prompt =
            avatar_visual_prompt(&identity.name, &identity.title, &identity.description);
        Self {
            name: identity.name,
            title: identity.title,
            description: identity.description,
            visual_prompt,
        }
    }
}

pub(super) fn fallback_avatar_name(actor_id: u64) -> String {
    format!("Traveler {actor_id}")
}

pub(super) fn normalize_avatar_name(name: Option<&str>, actor_id: u64) -> String {
    let Some(name) = name else {
        return fallback_avatar_name(actor_id);
    };
    if has_disallowed_control_character(name) {
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

pub(super) fn fallback_avatar_identity(actor_id: u64) -> GeneratedAvatarIdentity {
    cosyworld_ai_model::generate_avatar_identity(actor_id, None).into()
}

fn portable_avatar_title(value: &str) -> String {
    let normalized = compact_whitespace(value)
        .trim_end_matches(&['.', '!', '?'][..])
        .trim()
        .to_string();
    for suffix in [
        " at The Cosy Cottage",
        " in The Cosy Cottage",
        " — The Cosy Cottage",
        ", The Cosy Cottage",
    ] {
        let Some(start) = normalized.len().checked_sub(suffix.len()) else {
            continue;
        };
        let Some(tail) = normalized.get(start..) else {
            continue;
        };
        if tail.eq_ignore_ascii_case(suffix) {
            return normalized[..start].trim().to_string();
        }
    }
    normalized
}

pub(super) fn avatar_flavor_is_cozy(value: &str) -> bool {
    let tokens = value
        .to_ascii_lowercase()
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let blocked = [
        "grudge",
        "ravenous",
        "hostile",
        "obsessed",
        "revenge",
        "vengeance",
        "hatred",
        "hateful",
        "cruel",
        "evil",
        "villain",
        "killer",
        "slayer",
        "violent",
        "weapon",
        "murder",
        "bloodthirsty",
        "danger",
        "dangerous",
        "threat",
        "threatening",
        "insult",
        "insults",
        "mean",
    ];
    !tokens.iter().any(|token| {
        blocked.contains(&token.as_str())
            || token.starts_with("schem")
            || matches!(token.as_str(), "hate" | "hates" | "hated")
    })
}

pub(super) fn sanitize_avatar_title(value: Option<&str>, fallback: &str) -> String {
    let normalized = value.map(portable_avatar_title).unwrap_or_default();
    if normalized.is_empty()
        || normalized.chars().count() > 36
        || normalized.split_whitespace().count() > 5
        || normalized.to_ascii_lowercase().contains("the cosy cottage")
        || !human_message_is_cozy_safe(&normalized)
        || !avatar_flavor_is_cozy(&normalized)
        || has_disallowed_control_character(&normalized)
    {
        fallback.to_string()
    } else {
        normalized
    }
}

pub(super) fn sanitize_avatar_description(value: Option<&str>, fallback: &str) -> String {
    let normalized = value.map(compact_whitespace).unwrap_or_default();
    if normalized.is_empty()
        || normalized.chars().count() > 220
        || !human_message_is_cozy_safe(&normalized)
        || !avatar_flavor_is_cozy(&normalized)
        || has_disallowed_control_character(&normalized)
    {
        fallback.to_string()
    } else {
        normalized
    }
}

pub(super) fn align_avatar_description_name(
    value: &str,
    name: &str,
    fallback_name: &str,
) -> String {
    let aligned = if fallback_name != name && value.contains(fallback_name) {
        value.replace(fallback_name, name)
    } else {
        value.to_string()
    };
    if aligned
        .to_ascii_lowercase()
        .contains(&name.to_ascii_lowercase())
    {
        aligned
    } else {
        trim_to_chars(&format!("{name} — {aligned}"), 220)
    }
}

pub(super) fn avatar_visual_prompt(name: &str, title: &str, description: &str) -> String {
    compact_whitespace(&format!(
        "{name}, {title}. {description}. Cozy full-body fantasy avatar portrait, warm cottage light, expressive silhouette, readable trading-card character art, safe for all ages."
    ))
}

fn sanitize_avatar_visual_prompt(value: Option<&str>, fallback: &str) -> String {
    let normalized = value.map(compact_whitespace).unwrap_or_default();
    if normalized.is_empty()
        || normalized.chars().count() > 360
        || !human_message_is_cozy_safe(&normalized)
        || !avatar_flavor_is_cozy(&normalized)
        || has_disallowed_control_character(&normalized)
    {
        fallback.to_string()
    } else {
        normalized
    }
}

pub(super) fn avatar_identity_from_json_value(
    value: &serde_json::Value,
    actor_id: u64,
) -> GeneratedAvatarIdentity {
    let fallback = fallback_avatar_identity(actor_id);
    let raw_name = value.get("name").and_then(|value| value.as_str());
    let normalized_name = raw_name
        .map(|name| normalize_avatar_name(Some(name), actor_id))
        .unwrap_or_else(|| fallback.name.clone());
    let name = if normalized_name == fallback_avatar_name(actor_id) {
        fallback.name.clone()
    } else {
        normalized_name
    };
    let title = sanitize_avatar_title(
        value.get("title").and_then(|value| value.as_str()),
        &fallback.title,
    );
    let description = align_avatar_description_name(
        &sanitize_avatar_description(
            value.get("description").and_then(|value| value.as_str()),
            &fallback.description,
        ),
        &name,
        &fallback.name,
    );
    let fallback_visual_prompt = avatar_visual_prompt(&name, &title, &description);
    GeneratedAvatarIdentity {
        name,
        title,
        description,
        visual_prompt: sanitize_avatar_visual_prompt(
            value.get("visual_prompt").and_then(|value| value.as_str()),
            &fallback_visual_prompt,
        ),
    }
}

pub(super) fn parse_avatar_identity_json(
    text: &str,
    actor_id: u64,
) -> Option<GeneratedAvatarIdentity> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let json_text = if cleaned.starts_with('{') {
        cleaned
    } else {
        let start = cleaned.find('{')?;
        let end = cleaned.rfind('}')?;
        cleaned.get(start..=end)?
    };
    serde_json::from_str::<serde_json::Value>(json_text)
        .ok()
        .map(|value| avatar_identity_from_json_value(&value, actor_id))
}
