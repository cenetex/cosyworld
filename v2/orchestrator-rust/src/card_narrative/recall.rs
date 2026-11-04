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

/// A name inside a sentence: "the Lamp" for a thing, "the Bard" or "Pip"
/// for anyone, "the Wine-Dark Harbor" for a place.
fn thing(id: &str) -> String {
    let n = match kind(id, "item") {
        true => the(&name(id)),
        false => name(id),
    };
    match ["The ", "A ", "An "].iter().find(|a| n.starts_with(**a)) {
        Some(a) => format!("{}{}", a.to_lowercase(), &n[a.len()..]),
        None => n,
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
    let x = thing(&other);
    let when = |turn: u64| ago(context.turn.saturating_sub(turn));
    let mut out = Vec::new();
    if let Some(m) = &r.reunion {
        if m.visits >= 3 {
            out.push(format!("I've met {x} a few times."));
        }
        let place = match m.place == context.location {
            true => "here".to_string(),
            false => format!("at {}", thing(&m.place)),
        };
        out.push(format!("I last saw {x} {place}, {}.", when(m.turn)));
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
    use super::super::{entity, messages, prose, tests::context, valid, voice_eval, Part};
    use super::*;
    use serde_json::json;

    /// M1: Vale meets Pip again after keeping the Lamp from them. The memory
    /// sits just before the present, with no raw lines and no recent talk;
    /// a moment later (C1) it rests.
    #[test]
    fn a_reunion_remembers_the_last_meeting_then_rests() {
        let cases = voice_eval::cases();
        let view = |case: &str, id: &str| {
            let (_, c, said) = cases.iter().find(|(name, ..)| name == case).unwrap();
            let heard = voice_eval::scene_for(c, said, id);
            let c = heard.as_ref().unwrap_or(c);
            let e = entity(c, id);
            if let Some(r) = &e.recall {
                let chars: usize = lines(c, e, r).iter().map(|l| l.chars().count() + 1).sum();
                assert!(chars.div_ceil(4) <= TOKENS, "{case} {id}");
            }
            prose(&messages(c, e, Part::Line).assistant)
        };
        let vale = view("M1 Pip again at the pond", "vale");
        assert!(
            vale.contains(
                "\n\nI last saw Pip here, a little while ago. A little while ago, \
                 Pip asked me for the Lamp, and I kept it.\n\n"
            ),
            "{vale}"
        );
        assert!(vale.ends_with("I'm talking with them."), "{vale}");
        let pip = view("M1 Pip again at the pond", "moth");
        assert!(
            pip.contains("I asked Vale for the Lamp, and Vale said no."),
            "{pip}"
        );
        for view in [&vale, &pip] {
            assert!(
                !view.contains(" said: ") && !view.contains(" said to me"),
                "{view}"
            );
        }
        assert!(view("M2 Pip after many visits", "vale").contains("I've met Pip a few times."));
        assert!(view("M3 Pip after the gift", "vale").contains("I gave Pip the Black cloth."));
        for id in ["vale", "moth"] {
            let next = view("C1 the next moment", id);
            assert!(
                !next.contains("I last saw") && !next.contains(", and "),
                "{next}"
            );
        }
    }

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

    /// Vale remembers Pip in its own words, in about 60 tokens at most.
    #[test]
    fn a_memory_is_told_in_my_own_words() {
        let mut c = context();
        let memory = json!({
            "reunion": {"place": "station", "turn": 4, "visits": 3},
            "acts": [
                {"verb": "ask", "by": "moth", "item": "lamp", "refused": true, "turn": 1},
                {"verb": "give", "by": "vale", "item": "cloth", "turn": 4},
            ],
        });
        c.entities[0].recall = Some(serde_json::from_value(memory).unwrap());
        assert!(valid(&c));
        let told = lines(&c, &c.entities[0], c.entities[0].recall.as_ref().unwrap());
        assert_eq!(
            told,
            [
                "I've met Pip a few times.",
                "I last saw Pip here, just now.",
                "A little while ago, Pip asked me for the Lamp, and I kept it.",
                "Just now, I gave Pip the Black cloth.",
            ]
        );
        let chars: usize = told.iter().map(|l| l.chars().count() + 1).sum();
        assert!(chars.div_ceil(4) <= TOKENS);
    }
}
