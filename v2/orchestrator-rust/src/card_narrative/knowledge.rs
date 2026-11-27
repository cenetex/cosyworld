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
    let point = |i: usize| {
        text[..i].ends_with(char::is_numeric) && text[i + 1..].starts_with(char::is_numeric)
    };
    let (mut from, mut out) = (0, Vec::new());
    for (i, c) in text.char_indices() {
        if ['.', '!', '?', '。', '！', '？'].contains(&c) && !(c == '.' && point(i)) {
            out.push(&text[from..i]);
            from = i + c.len_utf8();
        }
    }
    out.push(&text[from..]);
    out.into_iter()
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

pub(super) fn background(context: &Context, id: &str) -> Vec<String> {
    context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .map(|fact| fact.text.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::{Check, Part};
    use super::*;
    use serde_json::json;

    const FACT: &str = "Pip hopes to see the lamp beside the pond.";

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
                "text":FACT,"eventSeq":12}]
        }))
        .unwrap()
    }

    #[test]
    fn only_its_speaker_receives_the_original_fact_as_background() {
        let context = context();
        assert!(valid(&context));
        assert_eq!(background(&context, "moth"), [FACT]);
        assert!(background(&context, "vale").is_empty());
        assert!(background(&context, "station").is_empty());
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

    #[test]
    fn a_model_can_paraphrase_or_leave_out_the_fact() {
        let context = context();
        let check = Check::new(&context, &context.entities[1], Part::Line);
        for reply in ["I wanted a light by the water.", "I am listening."] {
            assert_eq!(check.clean(reply, true), Ok(reply.into()));
        }
        assert!(check.flags(FACT).contains(&"self-narration"));
    }

    #[test]
    fn a_model_name_with_a_decimal_can_be_part_of_a_fact() {
        let mut context = context();
        context.disclosures[0].text = "Ledger (Opus 4.7) wants the Bell.".into();
        assert!(valid(&context));
        assert_eq!(
            background(&context, "moth"),
            ["Ledger (Opus 4.7) wants the Bell."]
        );
    }
}
