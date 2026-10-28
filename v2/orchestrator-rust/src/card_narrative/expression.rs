use serde_json::Value;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Mode {
    Speech,
    Movement,
    Emoji,
}

pub(super) fn mode(profile: &Value) -> Mode {
    match profile["expression"].as_str() {
        Some("movement") => Mode::Movement,
        Some("emoji") => Mode::Emoji,
        _ => Mode::Speech,
    }
}

fn symbols() -> &'static BTreeMap<String, String> {
    static SYMBOLS: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    SYMBOLS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/emoji-symbols.json"))
            .expect("authored emoji names")
    })
}

pub(super) fn direction(mode: Mode, own: &str) -> String {
    match mode {
        Mode::Speech => "My next reply is one or two short sentences in my own voice. I speak only my next words. My voice samples show my style; the current scene supplies my facts.".into(),
        Mode::Movement => format!("My next reply is one short description of {own}'s observable body language, beginning with {own}'s name. Use a small gesture of ears, eyes, head, paws, tail, or posture. Describe the gesture in plain third-person narration. The current scene supplies the facts. Keep world positions, custody, and outcomes as recorded."),
        Mode::Emoji => format!("My next reply contains two to five of these symbols only: {}. Choose symbols for my reaction to the current facts. Use their order to carry the meaning.", symbols().keys().cloned().collect::<Vec<_>>().join(" ")),
    }
}

pub(super) fn clean(
    mode: Mode,
    raw: &str,
    own: &str,
    limit: usize,
    finished: bool,
) -> Result<String, &'static str> {
    let text = raw.trim();
    if !finished
        || text.is_empty()
        || text.chars().count() > limit
        || text.chars().any(char::is_control)
    {
        return Err("expression");
    }
    match mode {
        Mode::Emoji => {
            let mut rest = text;
            let mut parts = Vec::new();
            while !rest.is_empty() {
                let symbol = symbols()
                    .keys()
                    .filter(|symbol| rest.starts_with(symbol.as_str()))
                    .max_by_key(|symbol| symbol.len())
                    .ok_or("expression")?;
                if parts.len() == 5 {
                    return Err("expression");
                }
                parts.push(symbol.as_str());
                rest = rest[symbol.len()..].trim_start();
            }
            if parts.len() < 2 {
                return Err("expression");
            }
            Ok(parts.join(""))
        }
        Mode::Movement => {
            let body = text.strip_prefix(&format!("{own} ")).ok_or("expression")?;
            let verb = body.split_whitespace().next().ok_or("expression")?;
            let verbs = [
                "lowers",
                "raises",
                "tilts",
                "blinks",
                "flicks",
                "cocks",
                "inclines",
                "pricks",
                "twitches",
                "wags",
                "dips",
                "shifts",
                "turns",
                "rests",
                "settles",
                "leans",
                "curls",
                "stretches",
                "tucks",
                "sniffs",
                "yawns",
                "watches",
                "looks",
            ];
            let forbidden = [
                "say", "says", "speak", "speaks", "ask", "asks", "reply", "replies", "whisper",
                "whispers", "shout", "shouts", "tell", "tells", "i", "me", "my",
            ];
            if !verbs.contains(&verb)
                || text.contains(['"', '“', '”'])
                || text
                    .split(|c: char| !c.is_alphabetic())
                    .any(|word| forbidden.contains(&word.to_lowercase().as_str()))
            {
                return Err("expression");
            }
            Ok(text.into())
        }
        Mode::Speech => unreachable!("speech uses its existing checker"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trusted_profiles_select_the_expression() {
        assert_eq!(mode(&json!({})), Mode::Speech);
        assert_eq!(mode(&json!({"expression":"movement"})), Mode::Movement);
        assert_eq!(mode(&json!({"expression":"emoji"})), Mode::Emoji);
    }

    #[test]
    fn emoji_replies_have_known_symbols_and_a_small_complete_shape() {
        assert_eq!(
            clean(Mode::Emoji, "🌧️ 🐾 🏠 ☕", "Whiskerwind", 400, true),
            Ok("🌧️🐾🏠☕".into())
        );
        for text in ["hello 🌳", "🌳", "🌳👀🏠☕🌙⭐", "🌳<script>"] {
            assert!(
                clean(Mode::Emoji, text, "Whiskerwind", 400, true).is_err(),
                "{text}"
            );
        }
        assert!(clean(Mode::Emoji, "🌳👀", "Whiskerwind", 400, false).is_err());
    }

    #[test]
    fn movement_replies_keep_the_named_characters_body_language() {
        assert_eq!(
            clean(
                Mode::Movement,
                "Skull lowers his head beside the cup.",
                "Skull",
                400,
                true
            ),
            Ok("Skull lowers his head beside the cup.".into())
        );
        for text in [
            "I lower my head.",
            "Skull says hello.",
            "Skull raises his head. I agree.",
            "Skull takes the lamp.",
            "Skull tilts his head. \"Hello.\"",
        ] {
            assert!(
                clean(Mode::Movement, text, "Skull", 400, true).is_err(),
                "{text}"
            );
        }
    }
}
