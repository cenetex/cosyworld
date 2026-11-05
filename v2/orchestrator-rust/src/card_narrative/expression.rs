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

/// The reply shape a body-language or emoji voice keeps. Speech has none:
/// the speaker only speaks as itself (owner, 2026-11-03).
pub(super) fn direction(mode: Mode, own: &str) -> String {
    match mode {
        Mode::Speech => String::new(),
        Mode::Movement => format!("My next reply is one short description of {own}'s observable body language, beginning with {own}'s name. Use a small gesture of ears, eyes, head, paws, tail, or posture. Describe the gesture in plain third-person narration. The current scene supplies the facts. Keep world positions, custody, and outcomes as recorded."),
        Mode::Emoji => format!("My next reply contains two to five of these symbols only: {}. Choose symbols for my reaction to the current facts. Use their order to carry the meaning.", symbols().keys().cloned().collect::<Vec<_>>().join(" ")),
    }
}

/// One emoji as a reader sees it: a base with its presentation selectors,
/// skin tone, keycap and tag marks, joined by ZWJ to the next, or a pair of
/// regional indicators (a flag). Other characters stand alone.
fn clusters(text: &str) -> Vec<&str> {
    let joins = |c: char| matches!(c, '\u{FE0E}' | '\u{FE0F}' | '\u{20E3}' | '\u{1F3FB}'..='\u{1F3FF}' | '\u{E0020}'..='\u{E007F}');
    let regional = |c: char| ('\u{1F1E6}'..='\u{1F1FF}').contains(&c);
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some((start, first)) = chars.next() {
        let mut end = start + first.len_utf8();
        if regional(first) {
            if let Some(&(at, next)) = chars.peek().filter(|(_, c)| regional(*c)) {
                chars.next();
                end = at + next.len_utf8();
            }
        } else {
            while let Some(&(at, next)) = chars.peek() {
                if joins(next) {
                    chars.next();
                    end = at + next.len_utf8();
                } else if next == '\u{200D}' {
                    chars.next();
                    end = at + next.len_utf8();
                    if let Some((at, joined)) = chars.next() {
                        end = at + joined.len_utf8();
                    }
                } else {
                    break;
                }
            }
        }
        out.push(&text[start..end]);
    }
    out
}

/// The authored symbol a cluster shows, read without its presentation
/// selector and, for a single symbol, without its skin tone ("👋🏽" is the
/// authored wave). A ZWJ sequence is one symbol: whole or not at all.
fn authored(cluster: &str) -> Option<&'static str> {
    let bare = |text: &str, tone: bool| -> String {
        text.chars()
            .filter(|c| !matches!(c, '\u{FE0E}' | '\u{FE0F}'))
            .filter(|c| !tone || !('\u{1F3FB}'..='\u{1F3FF}').contains(c))
            .collect()
    };
    let key = bare(cluster, !cluster.contains('\u{200D}'));
    symbols()
        .keys()
        .find(|symbol| bare(symbol, false) == key)
        .map(String::as_str)
}

/// The instruction scan reads presentation marks as syntax only inside an
/// authored emoji cluster. Hidden marks in words stay visible to its guard.
pub(super) fn instruction_text(text: &str) -> String {
    clusters(text)
        .into_iter()
        .flat_map(|cluster| {
            let symbol = authored(cluster).is_some();
            cluster
                .chars()
                .filter(move |c| !symbol || !matches!(c, '\u{FE0E}' | '\u{FE0F}'))
        })
        .collect()
}

/// An emoji voice's reply (Whiskerwind) as the rules accept it: two to five
/// authored symbols. Code, not the prompt, keeps that shape: words,
/// punctuation and symbols the table cannot name fall away, the first five
/// symbols stay, and a reply with fewer than two left is silent ("…").
/// The bool says whether anything fell away.
pub(super) fn emoji(raw: &str) -> Result<(String, bool), &'static str> {
    let mut parts = Vec::new();
    let mut dropped = false;
    for cluster in clusters(raw) {
        match authored(cluster) {
            Some(symbol) if parts.len() < 5 => parts.push(symbol),
            Some(_) => dropped = true,
            None => dropped |= !cluster.chars().all(char::is_whitespace),
        }
    }
    if parts.len() < 2 {
        return Err("expression");
    }
    Ok((parts.concat(), dropped))
}

pub(super) fn clean(
    mode: Mode,
    raw: &str,
    own: &str,
    limit: usize,
    finished: bool,
) -> Result<String, &'static str> {
    if mode == Mode::Emoji {
        return emoji(raw).map(|(text, _)| text);
    }
    let text = raw.trim();
    if !finished
        || text.is_empty()
        || text.chars().count() > limit
        || text.chars().any(char::is_control)
    {
        return Err("expression");
    }
    match mode {
        Mode::Emoji => unreachable!("emoji replies are reduced above"),
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
    fn emoji_only_replies_pass_with_spacing_and_punctuation_dropped() {
        assert_eq!(emoji("🌧️ 🐾 🏠 ☕"), Ok(("🌧️🐾🏠☕".into(), false)));
        assert_eq!(emoji("  🌧️🐾\n"), Ok(("🌧️🐾".into(), false)));
        assert_eq!(emoji("🌧️… 🐾!"), Ok(("🌧️🐾".into(), true)));
        // A selector the model left off still names the authored symbol.
        assert_eq!(emoji("🌧 ❤"), Ok(("🌧️❤️".into(), false)));
        // Even unfinished, a complete symbol is complete.
        assert_eq!(
            clean(Mode::Emoji, "🌳👀", "Whiskerwind", 400, false),
            Ok("🌳👀".into())
        );
    }

    #[test]
    fn emoji_sequences_stay_whole_symbols() {
        // A skin tone is one wave, not a wave and a stray tone.
        assert_eq!(emoji("👋🏽 🙏🏿"), Ok(("👋🙏".into(), false)));
        // A ZWJ sequence is one symbol: a black cat is not the authored
        // cat, and a family is not three people.
        assert_eq!(emoji("🐈‍⬛ 🌙 ⭐"), Ok(("🌙⭐".into(), true)));
        assert_eq!(emoji("👨‍👩‍👧 🏠"), Err("expression"));
        assert_eq!(clusters("👩🏽‍🦰🇬🇧🐾"), vec!["👩🏽‍🦰", "🇬🇧", "🐾"]);
    }

    #[test]
    fn worded_emoji_replies_reduce_to_their_symbols_or_fall_silent() {
        assert_eq!(
            emoji("I watch the rain 🌧️ and follow the paw prints 🐾 home 🏠."),
            Ok(("🌧️🐾🏠".into(), true))
        );
        assert_eq!(emoji("🌳👀🏠☕🌙⭐"), Ok(("🌳👀🏠☕🌙".into(), true)));
        for text in ["hello 🌳", "🌳", "", "The rain is soft.", "🌳<script>"] {
            assert_eq!(emoji(text), Err("expression"), "{text}");
        }
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
