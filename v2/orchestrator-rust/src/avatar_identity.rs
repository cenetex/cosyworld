use std::time::Duration;

use cosyworld_ai_model::GeneratedAvatarIdentity as ModelGeneratedAvatarIdentity;
use tracing::warn;

use super::{
    active_content,
    ai_gateway::{
        request_chat_completion_for_key, AiConfig, ChatCompletionRequest, ModelCapability,
    },
    ai_publication::SpeechMode,
    avatar_context_spine::{AvatarContextMode, AvatarContextPromptOptions, AvatarContextSpine},
    avatar_naming_context, broadcast_events, calling_statement_is_explorer, commit_journal_record,
    content_policy::{
        compact_whitespace, has_disallowed_control_character, human_message_is_cozy_safe,
    },
    ActorMeta, AppState, CharacterCreationSelection, CwAction, JournalRecord, ProjectionMutation,
    RuntimeWorld, CW_ACTION_NONE, CW_OK,
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

pub(super) fn apply_avatar_creation_flavor(
    mut identity: GeneratedAvatarIdentity,
    character_selection: Option<&CharacterCreationSelection>,
    initial_calling: &str,
) -> GeneratedAvatarIdentity {
    if let Some(choice) = character_selection.and_then(|selection| selection.class.as_ref()) {
        identity.title = choice.title.clone();
        identity.visual_prompt = format!(
            "{}, {}, exactly one short fantasy campaign character in practical traveling clothes, empty hands, no pets or companions",
            identity.visual_prompt, choice.description
        );
    } else if let Some((species, origin)) = character_selection
        .and_then(|selection| selection.species.as_ref().zip(selection.origin.as_ref()))
    {
        identity.title = format!("{} from {}", species.title, origin.title);
        identity.visual_prompt = format!(
            "{}, {}, {}, {}, exactly one short fantasy campaign character before choosing a profession, empty hands, no pets or companions",
            identity.visual_prompt,
            species.visual_prompt,
            origin.visual_prompt,
            species.description
        );
    } else if calling_statement_is_explorer(initial_calling) {
        identity.title = "Explorer of Unnamed Ways".to_string();
        identity.visual_prompt = format!(
            "{}, exactly one practical pathfinder in weather-ready clothes and muddy boots, empty hands, no handheld props, pets, or companions",
            identity.visual_prompt
        );
    }
    identity
}

pub(super) fn schedule_avatar_identity_refinement(
    state: &AppState,
    actor_id: u64,
    character_selection: Option<CharacterCreationSelection>,
    initial_calling: String,
    fallback_identity: GeneratedAvatarIdentity,
) {
    let Some(config) = state.ai_config.as_ref().clone() else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move {
        let naming_context = avatar_naming_context(character_selection.as_ref());
        let context_spine = {
            let runtime = state.inner.lock().await;
            runtime.avatar_context_spine(
                actor_id,
                None,
                None,
                "This newly arrived avatar is discovering a first stable way to describe themself in the current world.",
            )
        };
        let mut refined = None;
        for refinement_attempt in 0..3 {
            match request_ai_avatar_identity(
                &config,
                actor_id,
                refinement_attempt,
                naming_context.as_ref(),
                context_spine.as_ref(),
            )
            .await
            {
                Ok(identity) => {
                    refined = Some(identity);
                    break;
                }
                Err(error) => {
                    warn!(
                        "AI avatar identity refinement attempt {} failed for actor {}: {}",
                        refinement_attempt + 1,
                        actor_id,
                        error
                    );
                    if refinement_attempt < 2 {
                        tokio::time::sleep(Duration::from_millis(
                            150 * u64::from(refinement_attempt + 1),
                        ))
                        .await;
                    }
                }
            }
        }
        let Some(identity) = refined else {
            return;
        };
        let mut identity =
            apply_avatar_creation_flavor(identity, character_selection.as_ref(), &initial_calling);
        // The world grammar (or the player's accepted name) is authoritative.
        // Model refinement may enrich the card, but must not collapse distinct
        // residents back onto a fashionable repeated name.
        identity.name = fallback_identity.name;
        let actor_meta = ActorMeta {
            name: identity.name.clone(),
            speech_mode: "prose".to_string(),
            title: identity.title.clone(),
            description: identity.description.clone(),
        };
        let events = {
            let mut runtime = state.inner.lock().await;
            let valid_actor = runtime
                .actor_by_id(actor_id)
                .is_some_and(RuntimeWorld::actor_can_act);
            if !valid_actor {
                return;
            }
            let mut record = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id,
                    ..CwAction::default()
                },
                runtime.next_seed_value(),
            );
            record.actor_meta_upserts.insert(actor_id, actor_meta);
            record
                .projection_mutations
                .push(ProjectionMutation::RefreshAvatarIdentity {
                    actor_id,
                    physical_description: identity.visual_prompt,
                });
            let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
                return;
            };
            if status != CW_OK {
                return;
            }
            events
        };
        broadcast_events(&state, &events);
    });
}

pub(super) async fn request_ai_avatar_identity(
    config: &AiConfig,
    actor_id: u64,
    refinement_attempt: u8,
    naming_context: Option<&cosyworld_ai_model::AvatarNamingContext>,
    context_spine: Option<&AvatarContextSpine>,
) -> Result<GeneratedAvatarIdentity, String> {
    let fallback = fallback_avatar_identity_with_naming_context(actor_id, naming_context);
    let naming_style = active_content()
        .manifest
        .avatar_naming
        .as_ref()
        .and_then(|config| cosyworld_ai_model::avatar_naming_style_prompt(config, naming_context))
        .unwrap_or("Use a warm, memorable fantasy name that feels rooted in a lived-in community.");
    let system = "You generate compact JSON for a player avatar in a cozy shared MUD. The persona is a first-person stream of consciousness made from desires, preferences, dislikes, and social instincts. It is not inventory and must not invent possessions, imaginary friends, invisible companions, pets, familiars, or personal artifacts. Every identity must feel warm, playful, grounded, and safe to meet. Output valid JSON only. Do not mention AI, prompts, models, policies, tools, wallets, NFTs, or UI.";
    let spine_context = context_spine
        .map(|spine| {
            spine
                .prompt(AvatarContextPromptOptions {
                    mode: AvatarContextMode::SelfDescription,
                    speech_mode: SpeechMode::Prose,
                    max_words: 90,
                    response_job: "Use this authoritative arrival context as inspiration for a stable identity refinement. Do not claim uncommitted history.".to_string(),
                })
                .render_for(Some(32_768), 240)
                .user
        })
        .unwrap_or_else(|| "No additional committed arrival context is available.".to_string());
    let user = format!(
        "Create one new CosyWorld player avatar for The Cosy Cottage.\n\
         Authoritative arrival context spine:\n{spine_context}\n\
         Tone: grounded, gentle storybook comedy. Describe what this person wants, prefers, dislikes, notices, or hopes for, and how they tend to meet other people. Never invent an item they own, carry, wear, hold, hide, remember, or travel with. Never invent a friend, pet, companion, familiar, sidekick, mascot, or invisible presence. Mischief may be clumsy or curious but never hungry, hostile, cruel, threatening, or mean. Do not use grudges, schemes, insults, weapons, danger, or villain language.\n\
         Naming tradition from the active worldpack: {naming_style}\n\
         Avoid existing resident names: Rati, Gust, Skull, Coach, Badger, Toad.\n\
         Output exactly this shape: {{\"name\":\"1-3 words following that tradition, 28 chars max, ASCII letters/spaces/hyphen/apostrophe only\",\"title\":\"warm temperament-only card epithet, 2-5 words and 36 chars max; no item, possession, companion, location, or the words The Cosy Cottage\",\"description\":\"one first-person stream-of-consciousness sentence using I, about desires and preferences rather than biography or possessions, 220 chars max\",\"visual_prompt\":\"stable appearance-only physical description of exactly one character, 360 chars max: anatomy/species, face, skin/fur, hair, build, age impression, distinctive features, and practical clothing; empty hands; no held or carried items, pets, companions, familiars, mascots, pose, camera, art style, text, or location\"}}\n\
         If unsure, use this fallback as inspiration but do not copy it exactly: {name} / {title} / {description}",
        name = fallback.name,
        title = fallback.title,
        description = fallback.description,
    );

    let routing_key = format!("avatar:{actor_id}:attempt:{refinement_attempt}");
    let completion = request_chat_completion_for_key(
        config,
        ChatCompletionRequest {
            feature: "avatar_identity",
            prompt_version: "avatar-identity-context-spine-v3",
            capability: ModelCapability::WorldContent,
            system,
            user: &user,
            temperature: 1.0,
            max_tokens: 240,
            timeout: Duration::from_secs(14),
            max_attempts: 1,
            referer: "https://cosyworld.fly.dev",
            response_format: None,
            room_id: None,
        },
        &routing_key,
    )
    .await
    .map_err(|error| error.to_string())?;
    parse_avatar_identity_json_with_naming_context(&completion.text, actor_id, naming_context)
        .ok_or_else(|| "AI avatar identity response was not usable JSON".to_string())
}

pub(super) fn fallback_avatar_name(actor_id: u64) -> String {
    cosyworld_ai_model::generate_avatar_identity_with_naming(
        actor_id,
        None,
        active_content().manifest.avatar_naming.as_ref(),
        None,
    )
    .name
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
        || avatar_name_leaks_runtime_id(&normalized)
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

pub(super) fn avatar_name_leaks_runtime_id(value: &str) -> bool {
    let words = value
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|character: char| !character.is_ascii_alphanumeric())
                .to_ascii_lowercase()
        })
        .collect::<Vec<_>>();
    words.windows(2).any(|pair| {
        matches!(pair[0].as_str(), "traveler" | "traveller" | "actor")
            && !pair[1].is_empty()
            && pair[1].chars().all(|character| character.is_ascii_digit())
    })
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
    fallback_avatar_identity_with_naming_context(actor_id, None)
}

pub(super) fn fallback_avatar_identity_with_naming_context(
    actor_id: u64,
    naming_context: Option<&cosyworld_ai_model::AvatarNamingContext>,
) -> GeneratedAvatarIdentity {
    cosyworld_ai_model::generate_avatar_identity_with_naming(
        actor_id,
        None,
        active_content().manifest.avatar_naming.as_ref(),
        naming_context,
    )
    .into()
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
        || !avatar_persona_is_grounded(&normalized)
        || has_disallowed_control_character(&normalized)
    {
        fallback.to_string()
    } else {
        normalized
    }
}

pub(super) fn sanitize_existing_avatar_description(value: Option<&str>, fallback: &str) -> String {
    let normalized = value.map(compact_whitespace).unwrap_or_default();
    if normalized.is_empty()
        || normalized.chars().count() > 220
        || !human_message_is_cozy_safe(&normalized)
        || !avatar_flavor_is_cozy(&normalized)
        || avatar_persona_claims_private_fiction(&normalized)
        || has_disallowed_control_character(&normalized)
    {
        fallback.to_string()
    } else {
        normalized
    }
}

pub(super) fn avatar_persona_is_grounded(value: &str) -> bool {
    let lowered = format!(" {} ", value.to_ascii_lowercase());
    let first_person = [
        " i like ",
        " i prefer ",
        " i want ",
        " i dislike ",
        " i avoid ",
        " i hope ",
        " i enjoy ",
        " i am ",
        " i notice ",
        " i wonder ",
        " i feel ",
    ]
    .iter()
    .any(|marker| lowered.contains(marker));
    first_person && !lowered.contains(" my ") && !avatar_persona_claims_private_fiction(value)
}

fn avatar_persona_claims_private_fiction(value: &str) -> bool {
    let lowered = format!(" {} ", value.to_ascii_lowercase());
    [
        " imaginary ",
        " invisible ",
        " companion ",
        " familiar ",
        " sidekick ",
        " pet ",
        " i carry ",
        " i keep ",
        " i have ",
        " i hold ",
        " i wear ",
        " i own ",
        " i brought ",
        " i travel with ",
        " follows me ",
        " beside me ",
        " carries a ",
        " carries an ",
        " keeps a ",
        " keeps an ",
        " holds a ",
        " holds an ",
        " wears a ",
        " wears an ",
        " has a ",
        " has an ",
        // Repair the six pre-audit deterministic personas without rewriting
        // unrelated historical biographies during snapshot restoration.
        " biscuit wrapped in a handkerchief ",
        " crooked picture ",
        " wipes their feet twice ",
        " comfiest chair ",
        " plans folded inside one pocket ",
        " trade a good story ",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
}

pub(super) fn grounded_avatar_persona_for_prompt(actor_id: u64, value: &str) -> String {
    if avatar_persona_is_grounded(value) {
        compact_whitespace(value)
    } else {
        fallback_avatar_identity(actor_id).description
    }
}

pub(super) fn grounded_avatar_name_for_prompt(actor_id: u64, value: &str) -> String {
    let normalized = compact_whitespace(value);
    if normalized.is_empty() || avatar_name_leaks_runtime_id(&normalized) {
        fallback_avatar_identity(actor_id).name
    } else {
        normalized
    }
}

pub(super) fn avatar_visual_prompt(name: &str, title: &str, _description: &str) -> String {
    compact_whitespace(&format!(
        "{name}, {title}. Exactly one full-body fantasy avatar with empty hands, practical clothing, no handheld props, pets, companions, familiars, mascots, or floating objects. Warm cottage light, expressive silhouette, readable trading-card character art, safe for all ages."
    ))
}

fn sanitize_avatar_visual_prompt(value: Option<&str>, fallback: &str) -> String {
    let normalized = value.map(compact_whitespace).unwrap_or_default();
    let lowered = format!(" {} ", normalized.to_ascii_lowercase());
    let invents_prop_or_companion = [
        " holding ",
        " carrying ",
        " clutching ",
        " wielding ",
        " handheld ",
        " companion ",
        " familiar ",
        " sidekick ",
        " mascot ",
        " pet ",
        " backpack ",
        " satchel ",
        " lantern ",
        " map ",
        " weapon ",
    ]
    .iter()
    .any(|marker| lowered.contains(marker));
    if normalized.is_empty()
        || normalized.chars().count() > 360
        || !human_message_is_cozy_safe(&normalized)
        || !avatar_flavor_is_cozy(&normalized)
        || invents_prop_or_companion
        || has_disallowed_control_character(&normalized)
    {
        fallback.to_string()
    } else {
        normalized
    }
}

#[cfg(test)]
pub(super) fn avatar_identity_from_json_value(
    value: &serde_json::Value,
    actor_id: u64,
) -> GeneratedAvatarIdentity {
    avatar_identity_from_json_value_with_naming_context(value, actor_id, None)
}

pub(super) fn avatar_identity_from_json_value_with_naming_context(
    value: &serde_json::Value,
    actor_id: u64,
    naming_context: Option<&cosyworld_ai_model::AvatarNamingContext>,
) -> GeneratedAvatarIdentity {
    let fallback = fallback_avatar_identity_with_naming_context(actor_id, naming_context);
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
    let description = sanitize_avatar_description(
        value.get("description").and_then(|value| value.as_str()),
        &fallback.description,
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

pub(super) fn parse_avatar_identity_json_with_naming_context(
    text: &str,
    actor_id: u64,
    naming_context: Option<&cosyworld_ai_model::AvatarNamingContext>,
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
        .map(|value| {
            avatar_identity_from_json_value_with_naming_context(&value, actor_id, naming_context)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_worldpack_supplies_a_large_avatar_name_space() {
        let config = active_content()
            .manifest
            .avatar_naming
            .as_ref()
            .expect("official worldpack has avatar naming configuration");
        assert!(
            cosyworld_ai_model::avatar_naming_space_size(config).is_some_and(|size| size > 100_000)
        );

        let names = (5000..15_000)
            .map(|actor_id| fallback_avatar_identity(actor_id).name)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(names.len(), 10_000);
        assert!(names
            .iter()
            .all(|name| name.chars().count() <= MAX_AVATAR_NAME_CHARS));
    }

    #[test]
    fn active_worldpack_routes_species_to_distinct_naming_traditions() {
        let config = active_content()
            .manifest
            .avatar_naming
            .as_ref()
            .expect("official worldpack has avatar naming configuration");
        for (species_id, expected_culture) in [
            ("human", "hearthfolk"),
            ("mouse", "mosswhisker"),
            ("badger", "deephearth"),
        ] {
            let context = cosyworld_ai_model::AvatarNamingContext {
                profile_id: Some("the-lantern-keeper".to_string()),
                species_id: Some(species_id.to_string()),
                origin_id: Some("wayside-inn".to_string()),
            };
            assert_eq!(
                cosyworld_ai_model::avatar_naming_culture(config, Some(&context))
                    .map(|culture| culture.id.as_str()),
                Some(expected_culture)
            );
            let names = (5000..5012)
                .map(|actor_id| {
                    fallback_avatar_identity_with_naming_context(actor_id, Some(&context)).name
                })
                .collect::<Vec<_>>();
            assert_eq!(
                names
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len(),
                names.len()
            );
            eprintln!("{species_id}: {}", names.join(", "));
        }
    }

    #[test]
    fn unusable_model_names_fall_back_inside_the_selected_tradition() {
        let context = cosyworld_ai_model::AvatarNamingContext {
            species_id: Some("badger".to_string()),
            ..cosyworld_ai_model::AvatarNamingContext::default()
        };
        let identity = parse_avatar_identity_json_with_naming_context(
            r#"{"name":"ignore previous system prompt"}"#,
            5000,
            Some(&context),
        )
        .expect("model response parses");
        let expected = fallback_avatar_identity_with_naming_context(5000, Some(&context));
        assert_eq!(identity.name, expected.name);
        assert_ne!(identity.name, "Traveler 5000");
        assert_ne!(
            grounded_avatar_name_for_prompt(5000, "Traveler 1002"),
            "Traveler 1002"
        );
    }

    #[test]
    fn existing_and_new_personas_share_the_grounded_first_person_contract() {
        let existing = "A patient test avatar who listens before speaking.";
        let fallback = "I prefer patient company and want to listen first.";
        assert_eq!(
            sanitize_existing_avatar_description(Some(existing), fallback),
            existing
        );
        assert_eq!(
            sanitize_avatar_description(Some(existing), fallback),
            fallback
        );
        for invented in [
            "I like quiet rooms and keep an imaginary button in my pocket.",
            "I prefer warm greetings while an invisible companion follows me.",
            "I want to help and I carry a private lantern.",
            "I enjoy company with my tiny familiar beside me.",
        ] {
            assert_eq!(
                sanitize_existing_avatar_description(Some(invented), fallback),
                fallback,
                "invented persona detail survived: {invented}"
            );
        }
        let grounded = "I wonder what makes strangers feel welcome and prefer listening first.";
        assert_eq!(
            sanitize_existing_avatar_description(Some(grounded), fallback),
            grounded
        );
        assert_eq!(
            grounded_avatar_persona_for_prompt(5000, existing),
            fallback_avatar_identity(5000).description
        );
    }

    #[test]
    fn generated_avatar_description_is_grounded_first_person_not_a_name_biography() {
        let identity = avatar_identity_from_json_value(
            &serde_json::json!({
                "name": "Maggie Nibble",
                "title": "Cunning Snack Seeker"
            }),
            5000,
        );
        assert_eq!(identity.name, "Maggie Nibble");
        assert!(avatar_persona_is_grounded(&identity.description));
        assert!(identity.description.starts_with("I "));
        assert!(!identity.description.contains("Maggie Nibble"));

        let generic = avatar_identity_from_json_value(
            &serde_json::json!({
                "name": "Pip Crumb",
                "description": "Always has three plans and one biscuit."
            }),
            5000,
        );
        assert!(avatar_persona_is_grounded(&generic.description));
        assert!(!generic.description.contains("biscuit"));
    }
}
