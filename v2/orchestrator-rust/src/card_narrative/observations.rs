use super::Context;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::OnceLock};

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Observation {
    pub id: String,
    pub value: bool,
}

#[derive(Deserialize)]
struct Definition {
    id: String,
    entity: String,
    subjects: Vec<String>,
    values: Values,
    note: Option<String>,
}
#[derive(Deserialize)]
struct Values {
    #[serde(rename = "true")]
    yes: Meaning,
    #[serde(rename = "false")]
    no: Meaning,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meaning {
    fact: String,
    claims: Vec<String>,
    legacy_token: Option<String>,
}
impl Definition {
    fn meaning(&self, value: bool) -> &Meaning {
        if value {
            &self.values.yes
        } else {
            &self.values.no
        }
    }
    fn current(&self, context: &Context) -> Option<bool> {
        if let Some(value) = context
            .outcome
            .as_ref()
            .and_then(|o| o.observations.iter().find(|v| v.id == self.id))
        {
            return Some(value.value);
        }
        // Earlier browser releases send observable states as fact tokens.
        let entity = context.entities.iter().find(|e| e.id == self.entity)?;
        [true, false].into_iter().find(|value| {
            self.meaning(*value)
                .legacy_token
                .as_ref()
                .is_some_and(|token| {
                    entity.facts.iter().any(|fact| {
                        fact.trim_end_matches('.')
                            .split("; ")
                            .any(|field| field == token)
                    })
                })
        })
    }
}

fn definitions() -> &'static Vec<Definition> {
    static DEFINITIONS: OnceLock<Vec<Definition>> = OnceLock::new();
    DEFINITIONS.get_or_init(|| {
        let packs: Value = serde_json::from_str(include_str!("../../../card-game/packs.json"))
            .expect("compiled card packs");
        std::iter::once(&packs["hub"])
            .chain(packs["packs"].as_array().expect("packs"))
            .flat_map(|pack| pack["observations"].as_array().into_iter().flatten())
            .map(|value| serde_json::from_value(value.clone()).expect("compiled observation"))
            .collect()
    })
}

pub(super) fn valid(context: &Context) -> bool {
    let Some(outcome) = &context.outcome else {
        return true;
    };
    let values = &outcome.observations;
    values.len() <= 32
        && values.iter().map(|v| &v.id).collect::<BTreeSet<_>>().len() == values.len()
        && values.iter().all(|v| {
            definitions().iter().any(|d| {
                d.id == v.id
                    && (outcome.items.iter().any(|i| i.id == d.entity)
                        || outcome.avatars.iter().any(|a| a.id == d.entity))
            })
        })
}

pub(super) fn facts(context: &Context) -> Value {
    json!(definitions()
        .iter()
        .filter_map(|d| d.current(context).map(
            |value| json!({"id": d.id, "entity": d.entity, "value": value,
            "fact": d.meaning(value).fact, "note": d.note})
        ))
        .collect::<Vec<_>>())
}

pub(super) fn consistent(text: &str, context: &Context) -> bool {
    definitions().iter().all(|d| {
        d.current(context)
            .is_none_or(|value| matches_state(text, d, value))
    })
}

// A bounded check for direct present-tense claims authored by the pack.
// General English scope rules preserve questions, memories and wishes.
fn matches_state(text: &str, definition: &Definition, current: bool) -> bool {
    let text = text.to_lowercase().replace('’', "'");
    text.split_inclusive(['.', '!', '?', ';', '\n'])
        .all(|sentence| {
            if sentence.ends_with('?') || sentence.contains(['"', '“', '”']) {
                return true;
            }
            sentence
                .split(',')
                .flat_map(|clause| clause.split(" but "))
                .all(|clause| {
                    let words: Vec<_> = clause
                        .split(|c: char| !c.is_alphabetic() && c != '\'')
                        .filter(|s| !s.is_empty())
                        .collect();
                    (0..words.len()).all(|index| {
                        if words[..index].iter().any(|w| {
                            matches!(
                                *w,
                                "if" | "unless"
                                    | "when"
                                    | "once"
                                    | "whether"
                                    | "wish"
                                    | "hope"
                                    | "remember"
                                    | "remembered"
                                    | "said"
                                    | "thought"
                                    | "dream"
                                    | "dreamed"
                                    | "imagine"
                                    | "imagined"
                                    | "suppose"
                                    | "perhaps"
                                    | "maybe"
                                    | "think"
                            )
                        }) {
                            return true;
                        }
                        definition.subjects.iter().all(|subject| {
                            let subject: Vec<_> = subject.split_whitespace().collect();
                            if index + subject.len() > words.len() {
                                return true;
                            }
                            let actual = &words[index..index + subject.len()];
                            let contraction = actual.last().is_some_and(|w| w.ends_with("'s"));
                            if !actual.iter().zip(&subject).enumerate().all(|(i, (a, b))| {
                                (if i + 1 == subject.len() {
                                    a.trim_end_matches("'s")
                                } else {
                                    a
                                }) == *b
                            }) {
                                return true;
                            }
                            let tail: Vec<_> = contraction
                                .then_some("is")
                                .into_iter()
                                .chain(words[index + subject.len()..].iter().copied())
                                .filter(|w| {
                                    !matches!(
                                        *w,
                                        "now"
                                            | "still"
                                            | "currently"
                                            | "already"
                                            | "finally"
                                            | "really"
                                    )
                                })
                                .collect();
                            // The longest phrase wins: "burns out" outranks "burns".
                            let matched = [true, false]
                                .into_iter()
                                .flat_map(|value| {
                                    let tail = &tail;
                                    definition.meaning(value).claims.iter().filter_map(
                                        move |claim| {
                                            let claim: Vec<_> = claim.split_whitespace().collect();
                                            tail.starts_with(&claim).then_some((claim.len(), value))
                                        },
                                    )
                                })
                                .max_by_key(|(length, _)| *length);
                            matched.is_none_or(|(_, value)| value == current)
                        })
                    })
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_claims_preserve_scope_and_check_both_states() {
        let lamp = definitions().iter().find(|d| d.id == "lamp-flame").unwrap();
        for text in [
            "The lamp burns now.",
            "The lamp is lit.",
            "Your lamp is still burning.",
            "The lamp's alight.",
            "The lamp isn't unlit.",
        ] {
            assert!(matches_state(text, lamp, true), "{text}");
            assert!(!matches_state(text, lamp, false), "{text}");
        }
        for text in [
            "I just want some warmth, but the lamp is not lit.",
            "The lamp is unlit.",
            "The lamp isn't burning.",
            "The lamp’s out.",
            "The lamp burns out.",
        ] {
            assert!(matches_state(text, lamp, false), "{text}");
            assert!(!matches_state(text, lamp, true), "{text}");
        }
        for text in [
            "If the lamp is lit, I will stay.",
            "I hope the lamp burns again.",
            "Is the lamp lit?",
            "The lamp is lit?",
            "The lamp was lit yesterday.",
            "The lamp will be lit soon.",
            "The lamp might be lit later.",
            "You said the lamp is lit.",
            "You said, “the lamp is lit.”",
            "The lamp lit the room yesterday.",
            "The lamp is not mine.",
        ] {
            for value in [true, false] {
                assert!(matches_state(text, lamp, value), "{text}");
            }
        }
    }

    #[test]
    fn mounted_avatar_and_new_item_use_the_same_checker() {
        let badger = definitions()
            .iter()
            .find(|d| d.id == "badger-awake")
            .unwrap();
        assert!(!matches_state("Badger is sleeping.", badger, true));
        assert!(!matches_state("Grumpy Badger is awake.", badger, false));
        // An author's new item needs data only, including its chosen vocabulary.
        let gate: Definition = serde_json::from_value(json!({
            "id":"test-gate", "entity":"test-gate", "subjects":["iron gate"],
            "values":{"true":{"fact":"The gate is open.","claims":["is open"]},
                      "false":{"fact":"The gate is closed.","claims":["is closed"]}}
        }))
        .unwrap();
        assert!(!matches_state("The iron gate is closed.", &gate, true));
        assert!(matches_state("The iron gate is open.", &gate, true));
    }
}
