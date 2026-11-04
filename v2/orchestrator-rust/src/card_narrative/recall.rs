//! What a character remembers of the person it faces (P4): when it last
//! saw them and at most two earlier deeds or talks between them, chosen by
//! the narrator (recall.mjs) from the committed log. Ids only, checked here.
use super::{between::ago, kind, listener, name, person::the, sentence, Context, Entity};
use serde::{Deserialize, Serialize};

/// The narrator's choice for one speaker. Optional: an older tab sends none.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Recall {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reunion: Option<Reunion>,
    #[serde(default)]
    pub acts: Vec<Act>,
}

/// The last time we were together before we parted.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Reunion {
    pub place: String,
    pub turn: u64,
    pub visits: u64,
}

/// One deed between us, or the topics of our last talk.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Act {
    pub verb: String,
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub refused: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topics: Vec<String>,
    pub turn: u64,
}

const VERBS: [&str; 7] = [
    "ask",
    "give",
    "trade",
    "threaten",
    "attack",
    "accompany",
    "talk",
];

pub(super) fn valid(context: &Context, id: &str, r: &Recall) -> bool {
    let known = |id: &String| super::profiles().get(id).is_some();
    r.reunion
        .as_ref()
        .is_none_or(|m| kind(&m.place, "location") && m.turn <= context.turn && m.visits <= 99)
        && r.acts.len() <= 2
        && r.acts.iter().all(|a| {
            VERBS.contains(&a.verb.as_str())
                && (a.by == id || kind(&a.by, "avatar"))
                && a.item.as_ref().is_none_or(|i| kind(i, "item"))
                && a.topics.len() <= 2
                && a.topics.iter().all(known)
                && (a.verb == "talk") != a.topics.is_empty()
                && a.turn <= context.turn
        })
}

/// Ids this memory names beyond the scene's own.
pub(super) fn named(r: &Recall) -> impl Iterator<Item = &String> {
    let acts = r
        .acts
        .iter()
        .flat_map(|a| std::iter::once(&a.by).chain(&a.item).chain(&a.topics));
    r.reunion.iter().map(|m| &m.place).chain(acts)
}

/// About this many tokens (chars / 4) at most.
pub(super) const TOKENS: usize = 60;

/// "the Lamp" for a thing, a name for anyone or anywhere else.
fn thing(id: &str) -> String {
    match kind(id, "item") {
        true => the(&name(id)),
        false => name(id),
    }
}

/// One deed in my own words, from my side ("Pip asked me for the Lamp,
/// and I kept it.").
fn deed(a: &Act, me: &str, x: &str) -> String {
    let t = a.item.as_deref().map(thing).unwrap_or_default();
    let over = a
        .item
        .as_ref()
        .map_or(String::new(), |_| format!(" over {t}"));
    let (mine, no) = (a.by == me, a.refused);
    match (a.verb.as_str(), mine) {
        ("ask", true) if no => format!("I asked {x} for {t}, and {x} said no."),
        ("ask", true) => format!("I asked {x} for {t}, and {x} gave it to me."),
        ("ask", false) if no => format!("{x} asked me for {t}, and I kept it."),
        ("ask", false) => format!("{x} asked me for {t}, and I gave it."),
        ("give", true) if no => format!("I offered {x} {t}, and {x} said no."),
        ("give", true) => format!("I gave {x} {t}."),
        ("give", false) if no => format!("{x} offered me {t}, and I said no."),
        ("give", false) => format!("{x} gave me {t}."),
        ("trade", true) if no => format!("{x} wouldn't trade with me."),
        ("trade", true) => format!("I traded with {x}."),
        ("trade", false) if no => format!("I wouldn't trade with {x}."),
        ("trade", false) => format!("{x} traded with me."),
        ("threaten", true) => format!("I threatened {x}{over}."),
        ("threaten", false) => format!("{x} threatened me{over}."),
        ("attack", true) => format!("I attacked {x}."),
        ("attack", false) => format!("{x} attacked me."),
        ("accompany", true) if no => format!("I asked {x} to come along, and {x} said no."),
        ("accompany", true) => format!("I asked {x} to come along, and {x} came."),
        ("accompany", false) if no => format!("{x} asked me to come along, and I said no."),
        ("accompany", false) => format!("{x} asked me to come along, and I went."),
        _ => {
            let topics: Vec<String> = a.topics.iter().map(|t| thing(t)).collect();
            format!("{x} and I talked about {}.", super::person::list(&topics))
        }
    }
}

/// My memory of the one I face, before my present: the reunion, then the
/// deeds, each with its age, in at most `TOKENS` tokens.
pub(super) fn lines(context: &Context, entity: &Entity, r: &Recall) -> Vec<String> {
    let Some(other) = listener(context, &entity.id) else {
        return Vec::new();
    };
    let x = name(&other);
    let when = |turn: u64| ago(context.turn.saturating_sub(turn));
    let mut out = Vec::new();
    if let Some(m) = &r.reunion {
        if m.visits >= 3 {
            out.push(format!("I've met {x} a few times."));
        }
        out.push(format!(
            "I last saw {x} at {}, {}.",
            name(&m.place),
            when(m.turn)
        ));
    }
    for a in &r.acts {
        out.push(sentence(format!(
            "{}, {}",
            when(a.turn),
            deed(a, &entity.id, &x)
        )));
    }
    let size = |out: &[String]| {
        out.iter()
            .map(|l| l.chars().count() + 1)
            .sum::<usize>()
            .div_ceil(4)
    };
    while out.len() > 1 && size(&out) > TOKENS {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::{tests::context, valid};
    use super::*;
    use serde_json::json;

    #[test]
    fn a_memory_names_only_real_deeds_places_and_things() {
        let mut c = context();
        let with = |r: serde_json::Value, c: &mut Context| {
            c.entities[0].recall = Some(serde_json::from_value(r).unwrap());
            valid(c)
        };
        let ask = json!({"verb": "ask", "by": "moth", "item": "lamp", "refused": true, "turn": 0});
        let talk = json!({"verb": "talk", "by": "vale", "topics": ["keeper"], "turn": 0});
        let met = json!({"place": "station", "turn": 0, "visits": 3});
        assert!(with(json!({"reunion": met, "acts": [ask, talk]}), &mut c));
        assert!(!with(
            json!({"acts": [{"verb": "sing", "by": "moth", "turn": 0}]}),
            &mut c
        ));
        assert!(!with(
            json!({"acts": [{"verb": "talk", "by": "moth", "turn": 0}]}),
            &mut c
        ));
        assert!(!with(
            json!({"reunion": {"place": "moth", "turn": 0, "visits": 1}}),
            &mut c
        ));
        assert!(!with(
            json!({"acts": [ask.clone(), ask.clone(), ask]}),
            &mut c
        ));
    }
}
