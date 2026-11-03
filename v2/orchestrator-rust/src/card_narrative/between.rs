//! "Between us" (#2078): on a return visit, a speaker sees a little of its
//! history with the person it faces: an incident it knows of, a keepsake
//! that person gave it, and the last thing each said to the other. The
//! rules build every entry from committed facts (`between-us.mjs`); it
//! decides nothing and only shapes the line. Local scenes verify it like
//! any other field (`untrusted.rs`).
use super::{bounded, kind, listener, name, Context, Entity, Envelope};
use serde::{Deserialize, Serialize};

/// At most this many lines and characters, so a prompt stays near #1537's
/// 350 tokens.
const LINES: usize = 3;
const CHARS: usize = 240;
pub(super) const LABEL: &str = "Between us:";

/// What the speaker shares with one other voice in the scene.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Between {
    pub(super) with: String,
    /// Rules-built sentences: the incident and the keepsake.
    #[serde(default)]
    pub(super) facts: Vec<String>,
    /// Signed words, as the service wrote them.
    #[serde(default)]
    pub(super) said: Vec<Said>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Said {
    pub(super) actor_id: String,
    pub(super) text: String,
    pub(super) turn: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) signed: Option<Envelope>,
}

pub(super) fn valid(context: &Context, entity: &Entity) -> bool {
    let list = &entity.between;
    list.is_empty()
        || (kind(&entity.id, "avatar")
            && list.len() <= 2
            && list.iter().enumerate().all(|(i, b)| {
                b.with != entity.id
                    && kind(&b.with, "avatar")
                    && list[..i].iter().all(|other| other.with != b.with)
                    && b.facts.len() <= 2
                    && b.facts.iter().all(|f| bounded(f, 240))
                    && b.said.len() <= 2
                    && b.said.iter().all(|s| {
                        (s.actor_id == entity.id || s.actor_id == b.with)
                            && bounded(&s.text, 400)
                            && s.turn <= context.turn
                    })
            }))
}

/// How long ago, in the words knowledge facts use (`ageText`).
fn ago(turns: u64) -> &'static str {
    match turns {
        0..=1 => "just now",
        2..=5 => "a little while ago",
        6..=20 => "some time ago",
        _ => "long ago",
    }
}

/// The entry for the person this speaker faces.
fn faced<'a>(context: &Context, entity: &'a Entity) -> Option<(String, &'a Between)> {
    let other = listener(context, &entity.id)?;
    let between = entity.between.iter().find(|b| b.with == other)?;
    Some((other, between))
}

/// The words quoted from either side: parroting one is a repeat, as for
/// the talk here.
pub(super) fn quoted(context: &Context, entity: &Entity) -> Vec<String> {
    faced(context, entity).map_or_else(Vec::new, |(_, b)| {
        b.said.iter().map(|s| s.text.clone()).collect()
    })
}

/// The section's lines for the person this speaker faces: the incident,
/// the keepsake, their last words, then mine, while they fit. Words already
/// in the talk here are left out.
pub(super) fn lines(context: &Context, entity: &Entity) -> Vec<String> {
    let Some((other, between)) = faced(context, entity) else {
        return Vec::new();
    };
    let heard = |text: &str| context.conversation.iter().any(|l| l.text == text);
    let other = name(&other);
    let (other, heard) = (&other, &heard);
    let said = |mine: bool| {
        between
            .said
            .iter()
            .filter(move |s| (s.actor_id == entity.id) == mine && !heard(&s.text))
            .map(move |s| {
                let when = ago(context.turn.saturating_sub(s.turn));
                if mine {
                    format!("I last said to {}, {when}: {}", other, s.text)
                } else {
                    format!("{} last said to me, {when}: {}", other, s.text)
                }
            })
    };
    let mut out: Vec<String> = Vec::new();
    let mut chars = 0;
    for line in between
        .facts
        .iter()
        .cloned()
        .chain(said(false))
        .chain(said(true))
    {
        let size = line.chars().count();
        if out.len() < LINES && chars + size <= CHARS {
            chars += size;
            out.push(line);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::authored::{authored, Budget, Field};
    use super::super::tests::context;
    use super::super::{conversation, untrusted, valid, Check, Part};
    use super::*;
    use serde_json::{json, Value};

    /// Vale faces Pip with `between`, as the rules sent it.
    fn facing(between: Value) -> Context {
        let mut c = context();
        c.entities[0].between = serde_json::from_value(between).unwrap();
        assert!(valid(&c));
        c
    }

    /// The system message's "Between us" section, or `None`.
    fn section(c: &Context) -> Option<String> {
        let (system, _) = conversation::messages(c, &c.entities[0], 0);
        let (_, rest) = system.split_once("Between us:\n")?;
        Some(rest.split("\n\n").next().unwrap().to_string())
    }

    const INCIDENT: &str =
        "I witnessed this some time ago at Empty station: Pip threatens Vale over the Lamp.";

    #[test]
    fn the_section_shows_only_shared_history() {
        // No history: no section, and the prompt is unchanged.
        let plain = context();
        assert_eq!(section(&plain), None);
        assert_eq!(section(&facing(json!([]))), None);
        // A grievance's incident, as Vale knows it.
        let c = facing(json!([{"with": "moth", "facts": [INCIDENT]}]));
        assert_eq!(section(&c).unwrap(), INCIDENT);
        let (system, _) = conversation::messages(&c, &c.entities[0], 0);
        assert!(system.find("What I know:").unwrap() < system.find("Between us:").unwrap());
        // A keepsake and the last words each way; words the talk here
        // already shows are left out.
        let c = facing(json!([{"with": "moth",
        "facts": ["Pip gave me this Black cloth. I'm keeping it."],
        "said": [
            {"actorId": "vale", "text": "I'll be back before dark.", "turn": 1},
            {"actorId": "moth", "text": "Bring the lamp next time.", "turn": 3}
        ]}]));
        let mut c = c;
        assert_eq!(
            section(&c).unwrap(),
            "Pip gave me this Black cloth. I'm keeping it.\n\
             Pip last said to me, just now: Bring the lamp next time.\n\
             I last said to Pip, a little while ago: I'll be back before dark."
        );
        c.conversation.push(super::super::SpokenLine {
            witnesses: None,
            actor_id: "moth".into(),
            text: "Bring the lamp next time.".into(),
            signed: None,
        });
        assert!(!section(&c).unwrap().contains("Pip last said"));
        // Someone Vale is not facing has no say.
        let c = facing(json!([{"with": "keeper", "facts": [INCIDENT]}]));
        assert_eq!(section(&c), None);
    }

    #[test]
    fn the_section_stays_small() {
        let long = "Bring the lamp next time, and the oil, and the bell, and the cloth, \
                    and the keeper too, if he will come, because the dark is long.";
        let c = facing(json!([{"with": "moth",
            "facts": [INCIDENT, "Pip gave me this Black cloth. I'm keeping it."],
            "said": [{"actorId": "moth", "text": long, "turn": 3},
                     {"actorId": "vale", "text": "Soon.", "turn": 3}]}]));
        let shown = section(&c).unwrap();
        assert_eq!(shown.lines().count(), LINES);
        assert!(shown.chars().count() <= CHARS + LINES);
        assert!(!shown.contains(long) && shown.ends_with("Soon."));
        // Too many entries, a quote from a third person, or a later turn is
        // not a valid scene.
        for bad in [
            json!([{"with": "moth", "said": [{"actorId": "keeper", "text": "Hi.", "turn": 1}]}]),
            json!([{"with": "moth", "said": [{"actorId": "moth", "text": "Hi.", "turn": 9}]}]),
            json!([{"with": "vale"}]),
            json!([{"with": "moth"}, {"with": "moth"}]),
        ] {
            let mut c = context();
            c.entities[0].between = serde_json::from_value(bad).unwrap();
            assert!(!valid(&c));
        }
    }

    /// Using the history in one's own words is speech; reciting a line of it
    /// or parroting the words it quotes is not.
    #[test]
    fn a_recital_is_caught_but_a_reference_is_not() {
        let c = facing(json!([{"with": "moth",
            "facts": ["Pip gave me this Black cloth. I'm keeping it."],
            "said": [{"actorId": "moth", "text": "Bring the lamp with you next time.", "turn": 1}]}]));
        let check = Check::new(&c, &c.entities[0], Part::Line);
        let fine = "You gave me this cloth, Pip, and I'm still keeping it.";
        assert_eq!(check.clean(fine, true), Ok(fine.into()));
        for (reply, reason) in [
            (
                "Pip gave me this Black cloth. I'm keeping it.",
                "echoed brief",
            ),
            ("Between us: you gave me the cloth.", "echoed brief"),
            ("You said bring the lamp with you next time.", "repeat"),
        ] {
            assert_eq!(check.clean(reply, true), Err(reason), "{reply}");
        }
        // "Between us" in speech is just words.
        let fine = "That cloth still sits between us, Pip.";
        assert_eq!(check.clean(fine, true), Ok(fine.into()));
    }

    /// A shared world's narrator and a browser save build the same section
    /// from the same world: the shared one on the server, the local one
    /// through its signed and checked request.
    #[test]
    fn shared_and_local_play_agree() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let output = std::process::Command::new("node")
            .current_dir(root)
            .args([
                "--input-type=module",
                "-e",
                "import { returnVisitWorld } from './test/fixtures/card-voice-eval-cases.mjs'; \
                 import { narrativeContext } from './v2/card-game/narrative.mjs'; \
                 const world = returnVisitWorld(); \
                 console.log(JSON.stringify({ world, context: narrativeContext(world) }));",
            ])
            .output()
            .expect("Node builds the return visit");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let built: Value = serde_json::from_slice(&output.stdout).unwrap();
        let shared = crate::card_shared::narrator_context(&json!({
            "world": built["world"], "actor": "vale"
        }))
        .unwrap();
        let mut shared: Context = serde_json::from_value(shared).unwrap();
        let local: Context = serde_json::from_value(built["context"].clone()).unwrap();
        // Its facts are the rules' own fact text.
        let mut budget = Budget::new();
        for fact in local
            .entities
            .iter()
            .flat_map(|e| &e.between)
            .flat_map(|b| &b.facts)
        {
            assert_eq!(
                authored(fact, 240, Field::Facts, &mut budget),
                Ok(true),
                "{fact}"
            );
        }
        let mut local = untrusted::trusted(untrusted::signed(&local)).unwrap();
        for c in [&mut shared, &mut local] {
            c.acting_avatar = Some("vale".into());
        }
        let shown = |c: &Context, id: &str| {
            let entity = c.entities.iter().find(|e| e.id == id).unwrap();
            lines(c, entity)
        };
        let unsigned = |c: &Context| {
            let mut all: Vec<Between> = c.entities.iter().flat_map(|e| e.between.clone()).collect();
            all.iter_mut()
                .flat_map(|b| &mut b.said)
                .for_each(|s| s.signed = None);
            json!(all)
        };
        assert_eq!(unsigned(&shared), unsigned(&local));
        for id in ["vale", "moth"] {
            assert!(!shown(&shared, id).is_empty(), "{id}");
            assert_eq!(shown(&shared, id), shown(&local, id), "{id}");
        }
    }
}
