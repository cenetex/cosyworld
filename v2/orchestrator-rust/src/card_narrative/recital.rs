use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Poem {
    pub title: String,
    pub stanzas: Vec<Stanza>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Stanza {
    pub id: String,
    pub turn: u64,
    pub author_id: Option<String>,
    pub author_name: String,
}

fn authored_recital(actor: &str) -> Option<&'static Value> {
    static PACKS: OnceLock<Value> = OnceLock::new();
    let packs = PACKS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/packs.json")).expect("card packs")
    });
    packs["packs"]
        .as_array()?
        .iter()
        .find(|pack| pack["recital"]["actor"] == actor)
        .map(|pack| &pack["recital"])
}

// The poem names authored verse ids and their travellers. Couplet text is
// lore in content/<pack>/lore and never reaches the prompt.
pub(super) fn valid(actor: &str, poem: Option<&Poem>, turn: u64) -> bool {
    let Some(poem) = poem else { return true };
    let Some(recital) = authored_recital(actor) else {
        return false;
    };
    let Some(verses) = recital["verses"].as_array() else {
        return false;
    };
    if recital["title"] != poem.title || poem.stanzas.len() > verses.len() {
        return false;
    }
    let mut seen = BTreeSet::new();
    for stanza in &poem.stanzas {
        if !verses.iter().any(|verse| verse["choice"] == stanza.id)
            || !seen.insert(&stanza.id)
            || stanza.turn > turn
            || !super::bounded(&stanza.author_name, 160)
            || stanza
                .author_id
                .as_deref()
                .is_some_and(|id| !super::kind(id, "avatar"))
        {
            return false;
        }
    }
    true
}

pub(super) fn prompt_lines(poem: &Poem) -> Vec<String> {
    let mut names: Vec<&str> = Vec::new();
    for stanza in &poem.stanzas {
        if !names.contains(&stanza.author_name.as_str()) {
            names.push(&stanza.author_name);
        }
    }
    let title = &poem.title;
    vec![match names.is_empty() {
        true => format!("My poem {title} holds no deeds yet."),
        false => format!("My poem {title} holds deeds by {}.", names.join(", ")),
    }]
}

pub(super) fn consistent(text: &str, actor: &str, poem: Option<&Poem>) -> bool {
    let Some(poem) = poem else { return true };
    let Some(claims) = authored_recital(actor).and_then(|recital| recital["claims"].as_array())
    else {
        return true;
    };
    text.split_inclusive(['.', '!', '?', ';']).all(|sentence| {
        let lower = sentence.to_lowercase().replace('\u{2019}', "'");
        if sentence.trim_end().ends_with('?')
            || [
                "if ", "wonder", "wish", "would", "could", "might", "didn't", "did not", "never ",
            ]
            .iter()
            .any(|word| lower.contains(word))
        {
            return true;
        }
        claims.iter().all(|claim| {
            let stated = claim["phrases"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .any(|phrase| lower.contains(phrase));
            let earned = claim["anyChoices"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .any(|choice| poem.stanzas.iter().any(|stanza| stanza.id == choice));
            !stated || earned
        })
    })
}
