//! Occasional place captions share scene facts while characters keep dialogue.
use super::{mentions, name, observations, profiles, Context, Entity};

pub(super) fn legacy_scenery() -> bool {
    true
}

pub(super) fn voice() -> String {
    "An atmospheric caption: one sentence.".into()
}

pub(super) fn transcript(context: &Context, entity: &Entity) -> String {
    let own = name(&entity.id);
    let setting = profiles()[&entity.id]["persona"]
        .as_str()
        .unwrap_or_default()
        .split_inclusive('.')
        .next()
        .unwrap_or_default()
        .to_string();
    let mut lines = vec![
        "Current scene:".into(),
        format!("{own}."),
        format!("Setting: {setting}"),
        "Visible facts:".into(),
    ];
    lines.extend(entity.facts.iter().cloned());
    for fact in observations::facts(context)
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(text) = fact["fact"].as_str() {
            lines.push(text.into());
        }
    }
    if let Some(previous) = &entity.previous {
        lines.push(format!("Earlier atmosphere: {previous}"));
    }
    lines.push(format!("{own}:"));
    lines.join("\n")
}

pub(super) fn consistent(text: &str) -> bool {
    let personal = text
        .split(|c: char| !c.is_alphabetic())
        .map(str::to_lowercase)
        .any(|word| {
            [
                "i", "my", "mine", "me", "we", "our", "ours", "you", "your", "yours",
            ]
            .contains(&word.as_str())
        });
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
    fn captions_stay_with_physical_details() {
        assert!(consistent("A faint shimmer rests on the water."));
        assert!(consistent("Old boards creak beneath the dust."));
        for text in [
            "My boards creak.",
            "I remember your journey.",
            "You gave away the bell.",
            "Vale gives the keeper a bell.",
            "I’ll remember that.",
        ] {
            assert!(!consistent(text), "{text}");
        }
    }
}
