//! A reply that speaks in quotes, reduced to its speaker's own words.
//!
//! After a heard line the local model continues an opening quote, and a
//! small model often goes on as the one it heard: `It wants quiet,” Pip
//! repeats. “Mostly it wants quiet.”` Those spans are Pip's, not mine.

/// The speaker's own quoted words, and whether any span was someone else's.
#[derive(Debug, PartialEq)]
pub(super) struct Speech {
    pub(super) text: String,
    /// A quote closed, so the reply finished its words.
    pub(super) closed: bool,
    /// A span was tagged to someone else ("…,” Pip says).
    pub(super) other: bool,
    /// A dialogue tag followed a span ("…,” I say): the reply is prose.
    pub(super) tagged: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Who {
    Me,
    Other,
}

/// Verbs a dialogue tag opens with, by stem ("says", "asked", "repeats").
const SAYS: &[&str] = &[
    "say", "said", "ask", "repeat", "repl", "answer", "murmur", "whisper", "mutter", "grunt",
    "rasp", "chirp", "add", "continu", "echo", "agree", "insist", "call", "sigh", "hum", "tell",
    "told", "laugh", "snap", "growl", "croak", "shout", "cry", "cries", "cried", "breath",
];

/// Whether a quote mark opens the text.
pub(super) fn opens(text: &str) -> bool {
    text.trim_start().starts_with(['\u{201c}', '"'])
}

/// My quoted spans, joined. `others` are the names of everyone else who
/// speaks; `heard` is the line I answer. I tag my own words "I say"; a
/// span tagged with another's name or "he", "she" or "they", or one that
/// says the heard line back, is theirs, as are the untagged spans after it
/// until I act again ("I nod."). A span left open is dropped once a quote
/// has closed.
pub(super) fn own_words(text: &str, others: &[String], heard: Option<&str>) -> Speech {
    let text = text.trim_start().trim_start_matches(['\u{201c}', '"']);
    let mut parts: Vec<&str> = text.split(['\u{201c}', '\u{201d}', '"']).collect();
    let closed = parts.len() > 1;
    let open = (closed && parts.len() % 2 == 1)
        .then(|| parts.pop())
        .flatten();
    let forms = name_forms(others);
    let heard = heard.map(words).unwrap_or_default();
    // The heard line, or a run of it, said back is not my reply.
    let echoes = |span: &str| {
        let span = words(span);
        !span.is_empty()
            && span.len() >= heard.len().min(3)
            && heard.windows(span.len()).any(|run| run == span.as_slice())
    };
    let mut speaker = Who::Me;
    let mut mine = Vec::new();
    let (mut other, mut tagged) = (false, false);
    for (i, span) in parts.iter().enumerate().step_by(2) {
        let before = (i > 0).then(|| last_sentence(parts[i - 1]));
        let after = parts.get(i + 1).and_then(|n| tag(span, n, &forms));
        tagged |= after.is_some();
        // Narration before a span says who goes on ("I nod. “Yes.”").
        speaker = match before.and_then(|s| subject(s, &forms)) {
            Some(Who::Me) => Who::Me,
            Some(Who::Other) => Who::Other,
            _ => speaker,
        };
        speaker = match after {
            Some(who) => who,
            None if echoes(span) => Who::Other,
            None => speaker,
        };
        if speaker == Who::Other {
            other = true;
        } else if !span.trim().is_empty() {
            mine.push(span.trim());
        }
    }
    // A reply cut off mid-quote keeps the sentences it finished there when
    // it said nothing else of its own.
    let cut = open
        .filter(|_| mine.is_empty())
        .filter(|_| subject(last_sentence(parts[parts.len() - 1]), &forms) == Some(Who::Me))
        .and_then(|o| {
            o.rfind(['.', '!', '?', '\u{2026}'])
                .map(|at| o[..=at].trim())
        })
        .filter(|o| !o.is_empty() && !echoes(o));
    mine.extend(cut);
    Speech {
        text: join(&mine, closed),
        closed,
        other,
        tagged,
    }
}

/// Spans as one line: a comma before a new sentence ends it ("Still,
/// yes,” I say. “It’s good.” is "Still, yes. It’s good."), and a closed
/// reply ends on a full stop rather than a comma.
fn join(spans: &[&str], closed: bool) -> String {
    let mut said = String::new();
    for (i, span) in spans.iter().enumerate() {
        let next_opens = spans
            .get(i + 1)
            .and_then(|n| n.chars().next())
            .is_some_and(char::is_uppercase);
        match span.strip_suffix(',') {
            Some(head) if next_opens || (closed && i + 1 == spans.len()) => {
                said.push_str(head);
                said.push('.');
            }
            _ => said.push_str(span),
        }
        if i + 1 < spans.len() {
            said.push(' ');
        }
    }
    said
}

/// Each other speaker as a tag may name them: "dione the baker", "dione";
/// "the keeper", "keeper".
fn name_forms(others: &[String]) -> Vec<String> {
    let mut forms = Vec::new();
    for name in others {
        let lower = name.to_lowercase();
        let bare = lower.strip_prefix("the ").unwrap_or(&lower).to_string();
        let first = bare
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        forms.extend([lower.clone(), format!("the {bare}"), bare, first]);
    }
    forms.retain(|f| !f.is_empty() && f != "the ");
    forms.sort_by_key(|f| std::cmp::Reverse(f.len()));
    forms.dedup();
    forms
}

/// Who a dialogue tag right after a span names: `,” Pip says`, `” I
/// murmur`, `?” I tilt my head`, `” he grunts`. Narration on a new line,
/// or a new sentence that says nothing ("” I shift."), is no tag.
fn tag(span: &str, narration: &str, forms: &[String]) -> Option<Who> {
    let narration = narration.trim_start_matches([' ', '\t']);
    if narration.starts_with(['\n', '\r']) {
        return None;
    }
    let lower = narration
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
        .replace('\u{2019}', "'");
    let verb = |rest: &str| {
        let word = rest.split_whitespace().next().unwrap_or_default();
        SAYS.iter().any(|stem| word.starts_with(stem))
    };
    if let Some(rest) = lower.strip_prefix("i ") {
        let trails = span
            .trim_end()
            .ends_with([',', '?', '!', '\u{2026}', '-', '\u{2014}']);
        return (trails || verb(rest)).then_some(Who::Me);
    }
    if let Some(rest) = ["he ", "she ", "they "]
        .iter()
        .find_map(|p| lower.strip_prefix(p))
    {
        return verb(rest).then_some(Who::Other);
    }
    forms
        .iter()
        .find_map(|f| lower.strip_prefix(f.as_str()))
        .filter(|rest| rest.starts_with(' ') && verb(rest))
        .map(|_| Who::Other)
}

/// Who a sentence of narration is about by its first word: "I shift." is
/// me, "Pip shivers." and "He nods." are someone else.
fn subject(sentence: &str, forms: &[String]) -> Option<Who> {
    let lower = sentence
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
        .replace('\u{2019}', "'");
    let first = lower.split_whitespace().next()?;
    if ["i", "i'm", "i've", "i'd", "my"].contains(&first) {
        return Some(Who::Me);
    }
    if ["he", "she", "they", "his", "her", "their"].contains(&first)
        || forms.iter().any(|f| {
            lower
                .strip_prefix(f.as_str())
                .is_some_and(|r| r.starts_with([' ', '\'']))
        })
    {
        return Some(Who::Other);
    }
    None
}

/// The narration's last sentence, which leads into the next span.
fn last_sentence(narration: &str) -> &str {
    let narration = narration.trim().trim_end_matches(['.', '!', '?', ',', ' ']);
    narration
        .rfind(['.', '!', '?', '\n'])
        .map_or(narration, |at| narration[at + 1..].trim())
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '\u{2019}')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase().replace('\u{2019}', "'"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speak(text: &str, heard: &str) -> Speech {
        let others = [
            "Pip".to_string(),
            "The keeper".into(),
            "Dione the Baker".into(),
        ];
        own_words(text, &others, Some(heard))
    }

    #[test]
    fn another_speakers_spans_go() {
        // The heard line said back as Pip's, then Pip's next span.
        let echo = "It wants quiet,\u{201d} Pip repeats. He shivers. \u{201c}Mostly it wants quiet.\u{201d}\n\nI shift the Lamp.";
        let speech = speak(echo, "It wants quiet. Mostly it wants quiet.");
        assert_eq!((speech.text.as_str(), speech.other), ("", true));
        // My own words after it stay.
        let reply = format!("{echo} \u{201c}Then quiet it gets.\u{201d}");
        let speech = speak(&reply, "It wants quiet. Mostly it wants quiet.");
        assert_eq!(speech.text, "Then quiet it gets.");
        assert!(speech.other && speech.closed);
        // "Quiet," Dione says: the whole name or its first word.
        let dione =
            "Quiet,\u{201d} Dione says, wiping her hands. I nod. \u{201c}Quiet it is.\u{201d}";
        assert_eq!(speak(dione, "Quiet.").text, "Quiet it is.");
        assert!(speak("Tired,\u{201d} the Keeper rasps.", "Tired.").other);
        // She goes on as Dione; the rest of the heard line is still hers.
        let goes_on = "Quiet,\u{201d} Dione says. She frowns. \u{201c}We listen,\u{201d} she says.";
        assert_eq!(speak(goes_on, "Quiet.").text, "");
        let rest = "Then stay,\u{201d} Pip says. My hand tightens. \u{201c}I like company in the dark.\u{201d}";
        assert_eq!(
            speak(rest, "Then stay. I like company in the dark.").text,
            ""
        );
    }

    #[test]
    fn a_third_person_tag_is_someone_elses() {
        let heard = "Tired is a kind word for it.";
        let echo = speak("Tired is a kind word for it,\u{201d} he grunts.", heard);
        assert_eq!((echo.text.as_str(), echo.other), ("", true));
        // "Trust,” he says: a word of Pip's, as Vale tells it.
        let word = speak(
            "Trust,\u{201d} he says. I frown. \u{201c}Then trust me.\u{201d}",
            heard,
        );
        assert_eq!((word.text.as_str(), word.other), ("Then trust me.", true));
        let own = speak("Mind the oil,\u{201d} I say", heard);
        assert_eq!((own.text.as_str(), own.other), ("Mind the oil.", false));
    }

    #[test]
    fn my_spans_join_as_sentences() {
        let reply = "Still, yes,\u{201d} I murmur. \u{201c}It\u{2019}s good for seeing.\u{201d} I";
        assert_eq!(
            speak(reply, "Is it still?").text,
            "Still, yes. It\u{2019}s good for seeing."
        );
        let tagged = "Mind it,\u{201d} I say, \u{201c}and the wick.\u{201d} He \u{201c}Then";
        let speech = speak(tagged, "Hm?");
        assert_eq!(speech.text, "Mind it, and the wick.");
        assert!(speech.closed && speech.tagged && !speech.other);
        // A quotation inside speech has no tag.
        assert!(!speak("Keep it lit,\u{201d} my mother said.", "Hm?").tagged);
        // Never closed: the open words are all there is.
        let open = speak("Mind the oil, and", "Hm?");
        assert_eq!(
            (open.text.as_str(), open.closed),
            ("Mind the oil, and", false)
        );
        // My open words after another's span stay, unfinished.
        let cut = speak(
            "Then stay,\u{201d} Pip says. I nod. \u{201c}I will. For a",
            "Then stay.",
        );
        assert_eq!((cut.text.as_str(), cut.other), ("I will.", true));
        let words = speak(
            "Then stay,\u{201d} Pip says. I nod. \u{201c}I will, for a",
            "Then stay.",
        );
        assert_eq!(words.text, "");
    }
}
