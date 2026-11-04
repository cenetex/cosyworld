//! Occasional place captions. A place speaks as itself, with no
//! instructions (owner, 2026-11-03): "I am Black pond, a still pond beside
//! the station.", then what is in it now, and the user turn is who is
//! here. Characters keep the dialogue.
use super::{mentions, name, names, observations, person, profiles, Context, Entity};

pub(super) fn legacy_scenery() -> bool {
    true
}

/// A place whose pack gives it a `voice` narrates with that authored voice.
pub(super) fn narrator(id: &str) -> bool {
    profiles()[id]["voice"].is_string()
}

/// "I am Black pond, a still pond beside the station.": the place's name
/// and the first sentence of its persona, then any authored voice.
pub(super) fn voice(id: &str) -> String {
    let own = name(id);
    let setting = profiles()[id]["persona"]
        .as_str()
        .unwrap_or_default()
        .split_inclusive('.')
        .next()
        .unwrap_or_default()
        .trim();
    let mut text = match ["A ", "An ", "The "]
        .iter()
        .find(|a| setting.starts_with(**a))
    {
        Some(article) => format!(
            "I am {own}, {}{}",
            article.to_lowercase(),
            &setting[article.len()..]
        ),
        None if setting.is_empty() => format!("I am {own}."),
        None => format!("I am {own}. {setting}"),
    };
    if let Some(authored) = profiles()[id]["voice"].as_str() {
        text.push_str("\n\n");
        text.push_str(authored);
    }
    text
}

/// A browser fact as the place holds it, or `None` when the user turn says it.
fn fact(text: &str) -> Option<String> {
    if let Some(paths) = text.strip_prefix("Paths visible now: ") {
        let paths: Vec<String> = paths
            .trim_end_matches('.')
            .split(", ")
            .map(str::to_string)
            .collect();
        return (paths != ["none"])
            .then(|| format!("Paths lead from me to {}.", person::list(&paths)));
    }
    if let Some((_, items)) = text.split_once("Items here: ") {
        let items: Vec<String> = items
            .trim_end_matches('.')
            .split(", ")
            .map(person::the)
            .collect();
        let verb = if items.len() == 1 { "is" } else { "are" };
        return (items != ["the none"])
            .then(|| super::sentence(format!("{} {verb} here.", person::list(&items))));
    }
    if let Some(weather) = text.strip_prefix("Weather: ") {
        return Some(format!("The weather is {weather}"));
    }
    Some(text.to_string())
}

/// What the place holds now, for its system message after its voice.
pub(super) fn transcript(context: &Context, entity: &Entity) -> String {
    let mut lines: Vec<String> = entity.facts.iter().filter_map(|f| fact(f)).collect();
    for fact in observations::facts(context)
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(text) = fact["fact"].as_str() {
            lines.push(
                text.strip_suffix(" now.")
                    .map_or(text.into(), |t| format!("{t}.")),
            );
        }
    }
    if let Some(previous) = &entity.previous {
        lines.push(format!("I said: \"{previous}\""));
    }
    person::moments(&lines.join("\n"))
}

/// The user turn: who is here now, and who has just come.
pub(super) fn here(context: &Context) -> String {
    let avatars = context.outcome.iter().flat_map(|o| &o.avatars);
    let here: Vec<String> = avatars
        .clone()
        .filter(|a| a.location == context.location)
        .map(|a| a.id.clone())
        .collect();
    let mut lines = vec![match here.len() {
        0 => "Nobody is here.".to_string(),
        1 => format!("{} is here.", names(&here)),
        _ => format!("{} are here.", names(&here)),
    }];
    for a in avatars {
        if let Some(t) = a
            .travel
            .as_ref()
            .filter(|t| t.to == context.location && t.from != t.to)
        {
            lines.push(format!(
                "{} has just come from {}.",
                name(&a.id),
                name(&t.from)
            ));
        }
    }
    lines.join("\n")
}

pub(super) fn consistent(text: &str) -> bool {
    // A place speaks as itself, "I" or "we", but never addresses anyone.
    let banned: &[&str] = &["you", "your", "yours"];
    let personal = text
        .split(|c: char| !c.is_alphabetic())
        .map(str::to_lowercase)
        .any(|word| banned.contains(&word.as_str()));
    let character = profiles()
        .as_object()
        .into_iter()
        .flatten()
        .any(|(_, profile)| {
            profile["kind"] == "avatar"
                && profile["name"]
                    .as_str()
                    .is_some_and(|name| mentions(text, name))
        });
    !personal && !character
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_place_speaks_as_itself() {
        assert_eq!(
            voice("pond").lines().next(),
            Some("I am Black pond, a still pond beside the station.")
        );
        assert!(voice("willows-camp").contains("first person"));
        for text in [
            "A faint shimmer rests on the water.",
            "My boards creak.",
            "I paced it at supper. Nine now.",
            "We lean to count again.",
        ] {
            assert!(consistent(text), "{text}");
        }
        for text in [
            "I remember your journey.",
            "You gave away the bell.",
            "Vale gives the keeper a bell.",
            "The Swede is frightened.",
        ] {
            assert!(!consistent(text), "{text}");
        }
        assert_eq!(
            fact("Paths visible now: Empty station, Mirror attic.").as_deref(),
            Some("Paths lead from me to Empty station and Mirror attic.")
        );
        assert_eq!(fact("Paths visible now: none."), None);
        assert_eq!(
            fact("At the dialogue scene: Vale, Pip. Items here: Lamp, Black cloth.").as_deref(),
            Some("The Lamp and the Black cloth are here.")
        );
        assert_eq!(fact("At the dialogue scene: Vale. Items here: none."), None);
    }
}
