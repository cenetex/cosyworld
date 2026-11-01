use super::{bounded, kind, Context};
use serde::{Deserialize, Serialize};

/// A fact selected by the game for one saved Talk event.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Disclosure {
    fact_id: String,
    speaker: String,
    listener: String,
    pub text: String,
    event_seq: u64,
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn sentences(text: &str) -> impl Iterator<Item = &str> {
    text.split(['.', '!', '?', '。', '！', '？'])
        .map(str::trim)
        .filter(|sentence| !words(sentence).is_empty())
}

pub(super) fn valid(context: &Context) -> bool {
    context.disclosures.len() <= 1
        && context.disclosures.iter().all(|fact| {
            bounded(&fact.fact_id, 160)
                && bounded(&fact.text, 180)
                && sentences(&fact.text).count() == 1
                && words(&fact.text).len() >= 3
                && fact
                    .text
                    .trim_end_matches(['"', '\'', '’', '”'])
                    .ends_with(['.', '!', '?', '。', '！', '？'])
                && fact.event_seq > 0
                && fact.event_seq <= 9_007_199_254_740_991
                && fact.speaker != fact.listener
                && context.speakers.contains(&fact.speaker)
                && [&fact.speaker, &fact.listener].iter().all(|id| {
                    kind(id, "avatar") && context.entities.iter().any(|entity| &entity.id == *id)
                })
        })
}

pub(super) fn directions(context: &Context, id: &str) -> Vec<String> {
    let cast: Vec<String> = context.entities.iter().map(|e| super::name(&e.id)).collect();
    context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .map(|fact| {
            format!(
                "I tell {} this as one sentence: {} I may add one short sentence of my own.",
                super::name(&fact.listener),
                spoken(
                    &fact.text,
                    &super::name(&fact.speaker),
                    &super::name(&fact.listener),
                    &cast,
                )
            )
        })
        .collect()
}

/// The fact in the speaker's own voice and in the past, so a small model can
/// say it as it stands without narrating it as this beat (#1537): "Vale takes
/// the Lamp." becomes "I took the Lamp." for Vale.
fn spoken(text: &str, speaker: &str, listener: &str, cast: &[String]) -> String {
    let mut out = String::new();
    let mut rest = text;
    let mut subject = None;
    while !rest.is_empty() {
        let start = out.is_empty() || out.trim_end().ends_with(['.', '!', '?']);
        // Another named subject's verb is told in the past too.
        let other = cast.iter().filter(|n| start && !n.is_empty()).find(|n| {
            rest.starts_with(n.as_str())
                && !rest[n.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '\'' || c == '’')
                && n.as_str() != speaker
                && n.as_str() != listener
        });
        if let Some(named) = other {
            out.push_str(named);
            rest = &rest[named.len()..];
            subject = Some("It");
            continue;
        }
        let person = [
            (speaker, ["I", "me", "My", "my"]),
            (listener, ["You", "you", "Your", "your"]),
        ]
        .into_iter()
        .find(|(name, ..)| {
            !name.is_empty()
                && rest.starts_with(name)
                && !rest[name.len()..].starts_with(char::is_alphanumeric)
        });
        if let Some((name, [upper, lower, upper_own, own])) = person {
            rest = &rest[name.len()..];
            if let Some(after) = rest.strip_prefix("’s").or_else(|| rest.strip_prefix("'s")) {
                rest = after;
                out.push_str(if start { upper_own } else { own });
            } else if start {
                out.push_str(upper);
                subject = Some(upper);
            } else {
                out.push_str(lower);
            }
            continue;
        }
        let c = rest.chars().next().unwrap();
        // A word boundary carries one whole word across.
        let len = if c.is_alphanumeric() {
            rest.find(|c: char| !c.is_alphanumeric())
                .unwrap_or(rest.len())
        } else {
            c.len_utf8()
        };
        let word = &rest[..len];
        rest = &rest[len..];
        match subject.take() {
            Some(person) if word.chars().all(char::is_alphanumeric) => {
                out.push_str(&past(word, person))
            }
            Some(person) if word == " " => {
                out.push(' ');
                subject = Some(person);
            }
            _ => out.push_str(word),
        }
    }
    out
}

/// A present verb after its subject, told in the past: takes -> took,
/// gives -> gave, is -> was/were. Other words ("can") stay as they are.
/// Every form folds back to the same stem, so `delivered` still matches.
fn past(verb: &str, person: &str) -> String {
    match verb {
        "is" | "am" | "are" | "was" | "were" => {
            return (if person == "You" { "were" } else { "was" }).into()
        }
        "has" | "have" => return "had".into(),
        "does" => return "did".into(),
        "goes" => return "went".into(),
        _ if !verb.ends_with('s') || verb.ends_with("ss") || verb.len() <= 2 => {
            return verb.into()
        }
        _ => {}
    }
    let base = agree(verb, true);
    if let Some((was, _)) = FORMS
        .iter()
        .find(|(was, is)| *is == base && !was.ends_with('s'))
    {
        return (*was).into();
    }
    if ["put", "set", "cut", "hit", "let", "shut"].contains(&base.as_str()) {
        return base;
    }
    let chars: Vec<char> = base.chars().collect();
    let vowel = |c: &char| "aeiou".contains(*c);
    let n = chars.len();
    if base.ends_with('e') {
        format!("{base}d")
    } else if n > 1 && chars[n - 1] == 'y' && !vowel(&chars[n - 2]) {
        format!("{}ied", &base[..base.len() - 1])
    } else if n >= 3
        && !vowel(&chars[n - 1])
        && !"wxy".contains(chars[n - 1])
        && vowel(&chars[n - 2])
        && !vowel(&chars[n - 3])
        && chars.iter().filter(|c| vowel(*c)).count() == 1
    {
        format!("{base}{}ed", chars[n - 1])
    } else {
        format!("{base}ed")
    }
}

/// The verb after "I" or "You": takes -> take, is -> am/are, has -> have.
fn agree(verb: &str, first: bool) -> String {
    match verb {
        "is" => (if first { "am" } else { "are" }).into(),
        "was" if !first => "were".into(),
        "has" => "have".into(),
        "does" => "do".into(),
        "goes" => "go".into(),
        _ if verb.ends_with("ies") && verb.len() > 4 => format!("{}y", &verb[..verb.len() - 3]),
        _ if ["sses", "shes", "ches", "xes", "zes", "oes"]
            .iter()
            .any(|end| verb.ends_with(end)) =>
        {
            verb[..verb.len() - 2].into()
        }
        _ if verb.ends_with('s') && !verb.ends_with("ss") && verb.len() > 2 => {
            verb[..verb.len() - 1].into()
        }
        _ => verb.into(),
    }
}

const ARTICLES: &[&str] = &["a", "an", "the", "s"];
const FORMS: &[(&str, &str)] = &[
    ("me", "i"),
    ("my", "i"),
    ("mine", "i"),
    ("myself", "i"),
    ("your", "you"),
    ("yours", "you"),
    ("yourself", "you"),
    ("is", "be"),
    ("was", "be"),
    ("am", "be"),
    ("are", "be"),
    ("were", "be"),
    ("been", "be"),
    ("m", "be"),
    ("re", "be"),
    ("has", "have"),
    ("had", "have"),
    ("ve", "have"),
    ("does", "do"),
    ("did", "do"),
    ("goes", "go"),
    ("went", "go"),
    ("took", "take"),
    ("gave", "give"),
    ("chose", "choose"),
    ("brought", "bring"),
    ("threw", "throw"),
    ("made", "make"),
    ("saw", "see"),
    ("found", "find"),
    ("held", "hold"),
    ("kept", "keep"),
    ("told", "tell"),
    ("sold", "sell"),
    ("bought", "buy"),
    ("caught", "catch"),
    ("led", "lead"),
    ("fought", "fight"),
    ("rang", "ring"),
    ("ran", "run"),
    ("came", "come"),
    ("said", "say"),
    ("stole", "steal"),
    ("hid", "hide"),
    ("wrote", "write"),
    ("drew", "draw"),
    ("knew", "know"),
    ("fell", "fall"),
    ("sat", "sit"),
    ("stood", "stand"),
    ("sent", "send"),
    ("lost", "lose"),
    ("met", "meet"),
    ("paid", "pay"),
    ("struck", "strike"),
    ("won", "win"),
    ("woke", "wake"),
    ("broke", "break"),
    ("spoke", "speak"),
    ("ate", "eat"),
    ("drank", "drink"),
    ("sang", "sing"),
    ("swore", "swear"),
    ("wore", "wear"),
    ("tore", "tear"),
    ("left", "leave"),
];

/// One word reduced to the form both tellings share. Must match `stem` in
/// v2/card-game/knowledge.mjs.
fn stem(word: &str) -> String {
    let mut w = FORMS
        .iter()
        .find(|(from, _)| *from == word)
        .map_or(word, |(_, to)| to)
        .to_string();
    if w.chars().count() <= 3 {
        return w;
    }
    // The suffixes are ASCII, so their byte lengths cut on char boundaries.
    if w.ends_with("ies") || w.ends_with("ied") {
        w.truncate(w.len() - 3);
        w.push('i');
    } else if w.ends_with("es") || w.ends_with("ed") {
        w.truncate(w.len() - 2);
    } else if w.ends_with('s') && !w.ends_with("ss") {
        w.pop();
    } else if w.ends_with('y') {
        w.pop();
        w.push('i');
    }
    if w.ends_with('e') {
        w.pop();
    }
    let mut last = w.chars().rev();
    if let (Some(b), Some(a)) = (last.next(), last.next()) {
        if a == b && !"aeiou".contains(a) {
            w.pop();
        }
    }
    w
}

/// A sentence's words with the speaker's name as I, the listener's as you,
/// articles dropped and simple tense or person changes folded.
fn fact_words(sentence: &str, speaker: &str, listener: &str) -> Vec<String> {
    let all = words(sentence);
    let people: Vec<(Vec<String>, &str)> = [(words(speaker), "i"), (words(listener), "you")]
        .into_iter()
        .filter(|(name, _)| !name.is_empty())
        .collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < all.len() {
        if let Some((name, as_word)) = people.iter().find(|(name, _)| all[i..].starts_with(name)) {
            out.push(as_word.to_string());
            i += name.len();
            continue;
        }
        if !ARTICLES.contains(&all[i].as_str()) {
            out.push(stem(&all[i]));
        }
        i += 1;
    }
    out
}

/// Whether one spoken sentence tells this fact.
fn tells(fact: &Disclosure, sentence: &str) -> bool {
    let (speaker, listener) = (super::name(&fact.speaker), super::name(&fact.listener));
    fact_words(sentence, &speaker, &listener) == fact_words(&fact.text, &speaker, &listener)
}

pub(super) fn delivered(context: &Context, id: &str, text: &str) -> bool {
    context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .all(|fact| {
            text.split_inclusive(['.', '!', '?', '。', '！', '？'])
                .filter(|sentence| sentence.ends_with(['.', '!', '?', '。', '！', '？']))
                .any(|sentence| tells(fact, sentence))
        })
}

/// Only the accepted fact may repeat the prompt or name its own speaker.
pub(super) fn other_words(context: &Context, id: &str, text: &str) -> String {
    let facts: Vec<_> = context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .collect();
    let told = |sentence: &str| facts.iter().any(|fact| tells(fact, sentence));
    if facts.is_empty() || !sentences(text).any(told) {
        return text.to_string();
    }
    sentences(text)
        .filter(|sentence| !told(sentence))
        .collect::<Vec<_>>()
        .join(". ")
}

#[cfg(test)]
mod tests {
    use super::super::{Check, Part};
    use super::*;
    use serde_json::json;

    fn context() -> Context {
        serde_json::from_value(json!({
            "revision":4,"turn":4,"location":"station","focus":"moth",
            "speakers":["vale","moth"],"action":"Vale talks with Pip.",
            "entities":[
                {"id":"vale","facts":[],"memories":[],"previous":null},
                {"id":"moth","facts":[],"memories":[],"previous":null},
                {"id":"station","facts":[],"memories":[],"previous":null}
            ],
            "disclosures":[{"factId":"test:request","speaker":"moth","listener":"vale",
                "text":"Pip hopes to see the lamp beside the pond.","eventSeq":12}]
        }))
        .unwrap()
    }

    #[test]
    fn a_fact_must_be_a_complete_sentence_in_the_spoken_reply() {
        let context = context();
        assert!(valid(&context));
        assert!(delivered(
            &context,
            "moth",
            "Pip hopes to see the lamp beside the pond. Will you help?"
        ));
        assert!(!delivered(
            &context,
            "moth",
            "It is false that Pip hopes to see the lamp beside the pond."
        ));
        assert!(!delivered(&context, "moth", "Pip hopes to see the lamp."));
        assert!(delivered(&context, "vale", "I am listening."));
    }

    #[test]
    fn only_the_fact_sentence_gets_the_readback_exception() {
        let context = context();
        let pip = &context.entities[1];
        let check = Check::new(&context, pip, Part::Line);
        let text = "Pip hopes to see the lamp beside the pond. Will you help?";
        assert_eq!(check.clean(text, true), Ok(text.into()));
        assert_eq!(check.clean("I am listening.", true), Err("knowledge_fact"));
        assert_eq!(
            check.clean(
                "Pip hopes to see the lamp beside the pond. Pip wants help.",
                true
            ),
            Err("self-narration")
        );
        assert!(Check::new(&context, pip, Part::Thought)
            .clean("I could use a hand.", true)
            .is_ok());
    }

    #[test]
    fn disclosures_require_a_known_pair_and_a_saved_event() {
        let mut context = context();
        context.disclosures[0].listener = "keeper".into();
        assert!(!valid(&context));
        context.disclosures[0].listener = "vale".into();
        context.disclosures[0].event_seq = 0;
        assert!(!valid(&context));
        context.disclosures[0].event_seq = 12;
        context.disclosures[0].text.push_str(" A second fact.");
        assert!(!valid(&context));
    }

    fn vale_saw(text: &str) -> Context {
        let mut context = context();
        context.disclosures[0].speaker = "vale".into();
        context.disclosures[0].listener = "moth".into();
        context.disclosures[0].text = text.into();
        context
    }

    #[test]
    fn the_actor_tells_their_own_deed_in_the_first_person() {
        let context = vale_saw("Vale takes the Lamp.");
        assert!(valid(&context));
        let prompt = directions(&context, "vale").join(" ");
        assert!(prompt.contains("I took the Lamp."), "{prompt}");
        for told in [
            "I take the Lamp.",
            "I took the lamp. It was warm.",
            "Well. Vale takes the Lamp!",
        ] {
            assert!(delivered(&context, "vale", told), "{told}");
        }
        for wrong in [
            "I took the bell.",
            "I took the lamp from Pip.",
            "I never took the lamp.",
            "I took",
            "Pip took the lamp.",
        ] {
            assert!(!delivered(&context, "vale", wrong), "{wrong}");
        }
        let vale = &context.entities[0];
        let check = Check::new(&context, vale, Part::Line);
        assert_eq!(
            check.clean("I took the lamp. It is mine now.", true),
            Ok("I took the lamp. It is mine now.".into())
        );
    }

    #[test]
    fn tense_person_and_pronouns_fold_but_names_and_items_hold() {
        let context = vale_saw("Pip gives the Lamp to Vale.");
        assert_eq!(
            directions(&context, "vale")[0],
            "I tell Pip this as one sentence: You gave the Lamp to me. I may add one short sentence of my own."
        );
        assert!(delivered(&context, "vale", "You gave the lamp to me."));
        assert!(delivered(&context, "vale", "Pip gave the Lamp to me."));
        assert!(!delivered(&context, "vale", "You gave the cloth to me."));
        let context = vale_saw("Vale has Pip's Lamp.");
        assert!(directions(&context, "vale")[0].contains("I had your Lamp."));
        assert!(delivered(&context, "vale", "I had your lamp."));
        assert!(!delivered(&context, "vale", "I had my lamp."));
        let context = vale_saw("Vale is beside the pond.");
        assert!(directions(&context, "vale")[0].contains("I was beside the pond."));
        assert!(delivered(&context, "vale", "I was beside the pond."));
        assert!(!delivered(&context, "vale", "I was beside the attic."));
    }

    #[test]
    fn a_told_deed_is_past_so_it_never_reads_as_this_beat() {
        let context = vale_saw("The keeper attacks Vale. Vale drops the Bell.");
        let prompt = directions(&context, "vale").join(" ");
        assert!(prompt.contains("The keeper attacked me. I dropped the Bell."), "{prompt}");
        assert!(delivered(&context, "vale", "The keeper attacked me. I dropped the bell."));
        for (verb, told) in [
            ("gives", "gave"),
            ("carries", "carried"),
            ("lights", "lighted"),
            ("arrives", "arrived"),
            ("rings", "rang"),
            ("puts", "put"),
            ("can", "can"),
        ] {
            assert_eq!(past(verb, "I"), told, "{verb}");
        }
    }

    #[test]
    fn a_reply_that_misses_its_fact_can_still_be_spoken_untold() {
        let context = vale_saw("Vale takes the Lamp.");
        let vale = &context.entities[0];
        let check = Check::new(&context, vale, Part::Line);
        assert_eq!(check.clean("I am listening.", true), Err("knowledge_fact"));
        assert_eq!(
            check.untold("I am listening.", true),
            Ok("I am listening.".into())
        );
        // Without the fact, naming oneself is narration again.
        assert_eq!(
            check.untold("Vale takes the bell.", true),
            Err("self-narration")
        );
    }

    #[test]
    fn the_matching_rule_agrees_with_the_browser_rules() {
        // The same vectors run against factWords in test/card-knowledge.test.mjs.
        for (sentence, folded) in [
            ("Vale takes the Lamp.", "i tak lamp"),
            ("I took the lamp", "i tak lamp"),
            ("Pip gives the Lamp to Vale.", "you giv lamp to i"),
            ("Vale's dropped shells were mossy.", "i drop shel be mossi"),
            (
                "The Argive mothers seek burial.",
                "argiv mother seek burial",
            ),
        ] {
            assert_eq!(
                fact_words(sentence, "Vale", "Pip").join(" "),
                folded,
                "{sentence}"
            );
        }
    }
}
