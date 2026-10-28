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
    context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .map(|fact| {
            format!(
                "I tell {} this recorded fact as one complete sentence, using these words: {} I may add one short sentence in my own voice.",
                super::name(&fact.listener), fact.text
            )
        })
        .collect()
}

pub(super) fn delivered(context: &Context, id: &str, text: &str) -> bool {
    context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .all(|fact| {
            text.split_inclusive(['.', '!', '?', '。', '！', '？'])
                .filter(|sentence| sentence.ends_with(['.', '!', '?', '。', '！', '？']))
                .any(|sentence| words(sentence) == words(&fact.text))
        })
}

/// Only the accepted fact may repeat the prompt or name its own speaker.
pub(super) fn other_words(context: &Context, id: &str, text: &str) -> String {
    let facts: Vec<_> = context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .map(|fact| words(&fact.text))
        .collect();
    if facts.is_empty() || !sentences(text).any(|sentence| facts.contains(&words(sentence))) {
        return text.to_string();
    }
    sentences(text)
        .filter(|sentence| !facts.contains(&words(sentence)))
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
}
