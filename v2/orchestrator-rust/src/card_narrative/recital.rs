use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Poem {
    pub title: String,
    pub stanzas: Vec<Stanza>,
    pub new_lines: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Stanza {
    pub id: String,
    pub turn: u64,
    pub author_id: Option<String>,
    pub author_name: String,
    pub lines: Vec<String>,
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

// Authored poem data remains exact. The voice's response uses the ordinary
// speech checks and can reflect on any part of this context.
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
        let Some(verse) = verses.iter().find(|verse| verse["choice"] == stanza.id) else {
            return false;
        };
        if !seen.insert(&stanza.id)
            || stanza.turn > turn
            || !super::bounded(&stanza.author_name, 160)
            || stanza
                .author_id
                .as_deref()
                .is_some_and(|id| !super::kind(id, "avatar"))
            || ![&verse["lines"], &verse["after"]["lines"]]
                .iter()
                .any(|lines| **lines == serde_json::json!(stanza.lines))
        {
            return false;
        }
    }
    let latest = poem.stanzas.iter().map(|stanza| stanza.turn).max();
    let new_lines: Vec<_> = poem
        .stanzas
        .iter()
        .filter(|stanza| Some(stanza.turn) == latest)
        .flat_map(|stanza| stanza.lines.iter())
        .collect();
    new_lines == poem.new_lines.iter().collect::<Vec<_>>()
}

pub(super) fn prompt_lines(poem: &Poem) -> Vec<String> {
    let mut lines = vec![format!("My earned poem: {}", poem.title)];
    lines.extend(
        poem.stanzas
            .iter()
            .map(|stanza| format!("{}: {}", stanza.author_name, stanza.lines.join(" "))),
    );
    lines.push(format!(
        "These are the new lines: {}",
        poem.new_lines.join(" ")
    ));
    lines
}

// Quoting an earned line again is a valid choice during another conversation.
pub(super) fn earned_quote(text: &str, poem: Option<&Poem>) -> bool {
    let Some(poem) = poem else { return false };
    let key = |value: &str| {
        value
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let text = key(text);
    !text.is_empty()
        && poem.stanzas.iter().any(|stanza| {
            stanza.lines.iter().any(|line| key(line) == text)
                || key(&stanza.lines.join(" ")) == text
        })
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
