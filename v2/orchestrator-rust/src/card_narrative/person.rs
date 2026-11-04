//! A voice prompt is the speaker's own first-person view, with no
//! instructions (owner, 2026-11-03): "We aren't asking llms to do anything
//! except speak as themselves." Rules and browser text name everyone in the
//! third person ("Vale waits one turn.", "Pip threatens Vale."); this
//! rewords it as the speaker knows it ("I wait a moment.", "Pip threatens
//! me."),
//! and a play's turns are moments ("in the prompting lets call them moments
//! instead of turns"). Which facts reach a prompt is decided elsewhere; the
//! captions the table shows keep their own words.
use super::profiles;

/// Words that count a turn of play rather than turn something.
const COUNTED: &[&str] = &[
    "a", "one", "this", "that", "next", "each", "every", "last", "the", "few", "several", "many",
    "some", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "his", "her",
    "my", "your", "their", "its", "our", "another", "same", "any", "no", "per", "first",
];

/// Turns of play as moments: "waits one turn" is "waits a moment", "for
/// two turns" is "for two moments". "Turns its head" stays.
pub(super) fn moments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    // The previous word, lowercased, and where it starts in `out`.
    let (mut previous, mut at) = (String::new(), 0);
    let mut rest = text;
    while let Some(start) = rest.find(char::is_alphanumeric) {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let end = rest
            .find(|c: char| !c.is_alphanumeric())
            .unwrap_or(rest.len());
        let word = &rest[..end];
        let lower = word.to_lowercase();
        let after = rest[end..].trim_start();
        let counted = COUNTED.contains(&previous.as_str())
            || (!previous.is_empty() && previous.chars().all(|c| c.is_ascii_digit()))
            || after.starts_with("ago")
            || after.starts_with("later");
        if counted && (lower == "turn" || lower == "turns") {
            if previous == "one" {
                // "one turn" reads "a moment".
                let a = if out[at..].starts_with('O') { "A" } else { "a" };
                out.replace_range(at..at + 3, a);
            }
            let moment = if lower == "turns" {
                "moments"
            } else {
                "moment"
            };
            if word.starts_with('T') {
                out.push('M');
                out.push_str(&moment[1..]);
            } else {
                out.push_str(moment);
            }
        } else {
            at = out.len();
            out.push_str(word);
        }
        previous = lower;
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// A third-person verb as "I" says it: "waits" is "wait", "is" is "am".
fn conjugate(verb: &str) -> String {
    let irregular = [
        ("is", "am"),
        ("has", "have"),
        ("does", "do"),
        ("goes", "go"),
    ];
    if let Some((_, mine)) = irregular.iter().find(|(theirs, _)| *theirs == verb) {
        return (*mine).into();
    }
    if !verb.chars().all(|c| c.is_ascii_lowercase()) || verb.len() < 3 {
        return verb.into();
    }
    if let Some(stem) = verb.strip_suffix("ies") {
        return format!("{stem}y");
    }
    for ending in ["sses", "shes", "ches", "xes", "zes", "oes"] {
        if verb.ends_with(ending) {
            return verb[..verb.len() - 2].into();
        }
    }
    match verb.strip_suffix('s') {
        Some(stem) if !verb.ends_with("ss") && !verb.ends_with("us") => stem.into(),
        _ => verb.into(),
    }
}

/// Whether `text[at..]` starts a sentence.
fn opens(text: &str, at: usize) -> bool {
    let before = text[..at].trim_end_matches(|c: char| c.is_whitespace() || "\"'“‘(".contains(c));
    before.is_empty() || before.ends_with(['.', '!', '?', ':'])
}

/// The longest known name `text` starts with.
fn named(text: &str) -> Option<String> {
    profiles()
        .as_object()?
        .values()
        .filter_map(|p| p["name"].as_str())
        .filter(|n| text.starts_with(n))
        .max_by_key(|n| n.len())
        .map(str::to_string)
}

/// A rules sentence as the speaker says it: "Vale waits one turn." is "I
/// wait a moment."; "Pip threatens Vale over the Lamp." is "Pip threatens
/// me over the Lamp."; "Pip refused Vale's offer" is "Pip refused my offer".
pub(super) fn shift(text: &str, own: &str) -> String {
    let text = moments(text);
    if own.is_empty() || !text.contains(own) {
        return text;
    }
    let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric());
    let mut out = String::with_capacity(text.len());
    let mut from = 0;
    while let Some(found) = text[from..].find(own) {
        let at = from + found;
        let end = at + own.len();
        out.push_str(&text[from..at]);
        if word(text[..at].chars().next_back()) || word(text[end..].chars().next()) {
            out.push_str(own);
            from = end;
            continue;
        }
        let tail = &text[end..];
        let start = opens(&text, at);
        let possessive = ["'s ", "’s "].iter().find(|p| tail.starts_with(**p));
        if let Some(p) = possessive {
            out.push_str(if start { "My " } else { "my " });
            from = end + p.len();
        } else if start && tail.starts_with(" and ") {
            // "Vale and The Bard talk" is "The Bard and I talk".
            let rest = &tail[5..];
            match named(rest) {
                Some(other) => {
                    out.push_str(&format!("{other} and I"));
                    from = end + 5 + other.len();
                }
                None => {
                    out.push('I');
                    from = end;
                }
            }
        } else if start && tail.starts_with(' ') {
            let verb_end = tail[1..]
                .find(|c: char| !c.is_alphanumeric())
                .map_or(tail.len(), |i| i + 1);
            out.push_str("I ");
            out.push_str(&conjugate(&tail[1..verb_end]));
            from = end + verb_end;
        } else {
            // "The Gate Guard and Vale talk" keeps "I" as a subject.
            let lead = text[..at].trim_end();
            let subject = lead.strip_suffix(" and").is_some_and(|before| {
                named(before.trim_start()).as_deref() == Some(before.trim_start())
            });
            out.push_str(if subject || start { "I" } else { "me" });
            from = end;
        }
    }
    out.push_str(&text[from..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_text_reads_in_the_speakers_first_person() {
        for (text, mine) in [
            ("Vale waits one turn.", "I wait a moment."),
            ("Pip waits one turn.", "Pip waits a moment."),
            (
                "Pip threatens Vale over the Lamp.",
                "Pip threatens me over the Lamp.",
            ),
            (
                "The keeper asks Vale for the Bell. Vale keeps it for now.",
                "The keeper asks me for the Bell. I keep it for now.",
            ),
            (
                "Vale and The Bard talk at last.",
                "The Bard and I talk at last.",
            ),
            (
                "The Gate Guard and Vale talk at last.",
                "The Gate Guard and I talk at last.",
            ),
            (
                "Vale goes to Theban City Gate.",
                "I go to Theban City Gate.",
            ),
            ("Vale carries the Lamp.", "I carry the Lamp."),
            ("Vale has the Lamp at last.", "I have the Lamp at last."),
            (
                "Pip refused Vale's offer of Bell.",
                "Pip refused my offer of Bell.",
            ),
            ("Vale's lamp is lit.", "My lamp is lit."),
            ("Vales of mist.", "Vales of mist."),
            (
                "I witnessed this just now: Vale gives the Lamp to Pip.",
                "I witnessed this just now: I give the Lamp to Pip.",
            ),
            (
                "Something on the far shore turns its head.",
                "Something on the far shore turns its head.",
            ),
        ] {
            assert_eq!(shift(text, "Vale"), mine, "{text}");
        }
        assert_eq!(moments("for two turns"), "for two moments");
        assert_eq!(
            moments("The Bell made no sound this turn: it is silent."),
            "The Bell made no sound this moment: it is silent."
        );
        assert_eq!(moments("One turn later."), "A moment later.");
        assert_eq!(moments("I would turn away."), "I would turn away.");
    }
}
