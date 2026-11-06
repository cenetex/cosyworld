//! What a character notices this moment (P3), in its own words: where it
//! has just come from, one authored line of the place, what it holds, the
//! one or two changes the narrator ranked as most about it, a pull toward
//! its want, and last the person it is talking with. No rosters, no exit
//! lists and no "I'm at". The narrator chooses (perception.mjs); this words.
use super::{
    custody, kind, name, observations, person, profiles, seed_sentence, sentence, Context, Entity,
    Section,
};
use serde::{Deserialize, Serialize};

/// The narrator's choice for one speaker. Every field is optional, because
/// a tab from an older release sends none of it.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Perception {
    /// Indices into the scene's events, the most involving first.
    #[serde(default)]
    pub changes: Vec<usize>,
    #[serde(default)]
    pub arrival: Option<Arrival>,
    /// A place my want points to, one path away.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull: Option<String>,
}

/// My latest arrival compared with the visit before it.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Arrival {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub first: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub came: Option<String>,
}

/// About this many tokens (chars / 4) at most.
pub(super) const TOKENS: usize = 70;

pub(super) fn valid(context: &Context, p: &Perception) -> bool {
    let entity = |id: &String| ["avatar", "item"].iter().any(|k| kind(id, k));
    p.changes.len() <= 2
        && p.changes.iter().all(|i| *i < context.events.len())
        && p.pull.as_ref().is_none_or(|id| kind(id, "location"))
        && p.arrival.as_ref().is_none_or(|a| {
            a.gone.as_ref().is_none_or(entity) && a.came.as_ref().is_none_or(entity)
        })
}

/// Ids this view names beyond the scene's own.
pub(super) fn named(p: &Perception) -> impl Iterator<Item = &String> {
    let arrival = p.arrival.iter().flat_map(|a| a.gone.iter().chain(&a.came));
    arrival.chain(&p.pull)
}

/// Keep the chosen events in step when unauthored ones are left out.
pub(super) fn reindex(p: &mut Perception, kept: &[bool]) {
    p.changes = p
        .changes
        .iter()
        .filter(|i| kept.get(**i) == Some(&true))
        .map(|i| kept[..*i].iter().filter(|k| **k).count())
        .collect();
}

/// One authored sense of the place: its `sense` line, or for now the first
/// sentence of its description when that is plainly a scene.
pub(super) fn anchor(place: &str) -> Option<String> {
    let profile = &profiles()[place];
    if let Some(sense) = profile["sense"].as_str() {
        return Some(sense.to_string());
    }
    let persona = profile["persona"].as_str()?;
    let first = persona.split_inclusive(". ").next()?.trim();
    let meta = ["This ", "A shared road", "Describe", "The keeper tells"];
    (first.ends_with('.') && first.len() <= 90 && !meta.iter().any(|m| first.starts_with(m)))
        .then(|| first.to_string())
}

/// "Pip, a moth" from the seed "Pip, a moth.", articles lowered.
fn who(id: &str) -> String {
    let seed = seed_sentence(id);
    let seed = seed.trim_end_matches('.');
    match ["The ", "A ", "An "].iter().find(|a| seed.starts_with(**a)) {
        Some(a) => format!("{}{}", a.to_lowercase(), &seed[a.len()..]),
        None => seed.to_string(),
    }
}

/// The pack's state sentences for things I or my listener hold, as
/// "My Lamp is burning and uncovered." or "Vale's Lamp is burning."
fn states(context: &Context, id: &str, listener: Option<&str>) -> Vec<String> {
    let Some(outcome) = &context.outcome else {
        return vec![];
    };
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for fact in observations::facts(context)
        .as_array()
        .into_iter()
        .flatten()
    {
        let (Some(entity), Some(text)) = (fact["entity"].as_str(), fact["fact"].as_str()) else {
            continue;
        };
        let Some(item) = outcome.items.iter().find(|i| i.id == entity) else {
            continue;
        };
        let whose = if item.holder == id {
            "My".to_string()
        } else if Some(item.holder.as_str()) == listener {
            format!("{}'s", name(&item.holder))
        } else {
            continue;
        };
        let text = text.trim_end_matches('.').trim_end_matches(" now");
        let subject = sentence(person::the(&name(entity)));
        let Some(state) = text.strip_prefix(&format!("{subject} is ")) else {
            continue;
        };
        let thing = subject.strip_prefix("The ").unwrap_or(&subject).to_string();
        let lead = format!("{whose} {thing}");
        match out.iter_mut().find(|(l, _)| *l == lead) {
            Some((_, all)) => all.push(state.to_string()),
            None => out.push((lead, vec![state.to_string()])),
        }
    }
    out.into_iter()
        .take(2)
        .map(|(lead, all)| format!("{lead} is {}.", person::list(&all)))
        .collect()
}

/// The thing I want, when someone here holds it.
fn wanted(context: &Context, entity: &Entity, id: &str) -> Option<String> {
    let outcome = context.outcome.as_ref()?;
    let desire = entity.desire.as_ref()?;
    desire.items.iter().find_map(|item| {
        let held = outcome.items.iter().find(|i| &i.id == item)?;
        (held.holder != id && kind(&held.holder, "avatar") && held.location == context.location)
            .then(|| {
                format!(
                    "{} is holding {}.",
                    name(&held.holder),
                    person::the(&name(item))
                )
            })
    })
}

/// The view's last paragraph, my present, in at most `TOKENS` tokens: my
/// trip and arrival, the place, what I hold, then what changed, what I want
/// and where it pulls, and last my listener.
pub(super) fn lines(context: &Context, entity: &Entity, p: &Perception) -> Vec<(Section, String)> {
    let id = entity.id.as_str();
    let own = name(id);
    let listener = super::listener(context, id);
    let mut pinned: Vec<String> = Vec::new();
    let mine = context
        .outcome
        .iter()
        .flat_map(|o| &o.avatars)
        .find(|a| a.id == id);
    if let Some(t) = mine.and_then(|a| a.travel.as_ref()) {
        let with = match t.companions.as_slice() {
            [] => String::new(),
            c => format!(" with {}", super::names(c)),
        };
        pinned.push(match t.from == context.location {
            true => format!("I'm leaving {} for {}{with}.", name(&t.from), name(&t.to)),
            false => format!(
                "I've just come to {} from {}{with}.",
                name(&t.to),
                name(&t.from)
            ),
        });
    }
    let thing = |id: &str| match kind(id, "item") {
        true => sentence(person::the(&name(id))),
        false => name(id),
    };
    pinned.extend(
        p.arrival
            .as_ref()
            .and_then(|a| match (a.first, &a.gone, &a.came) {
                (true, ..) => Some("I've never been here before.".to_string()),
                (_, Some(gone), _) => Some(format!("{} was here last time I came.", thing(gone))),
                (_, _, Some(came)) => {
                    Some(format!("{} wasn't here last time I came.", thing(came)))
                }
                _ => None,
            }),
    );
    if !context.concealed.contains(&context.location) {
        pinned.extend(anchor(&context.location));
    }
    let held = entity.facts.iter().find(|f| f.starts_with("Holding: "));
    pinned.extend(held.and_then(|f| person::fact(f, id, true)));
    pinned.extend(
        custody::facts(context, id)
            .into_iter()
            .filter(|f| f.starts_with("I ")),
    );
    // "Between us" may already tell a deed ("Pip threatened me…").
    let between = super::between::lines(context, entity);
    let stem = |line: &str| -> Vec<String> {
        line.split_whitespace()
            .take(2)
            .map(|w| w.chars().take(5).collect())
            .collect()
    };
    let told = |line: &str| between.iter().any(|b| stem(b) == stem(line));
    let changes: Vec<String> = p
        .changes
        .iter()
        .filter_map(|i| context.events.get(*i))
        .map(|e| person::shift(e, &own))
        .filter(|line| !told(line))
        .collect();
    // In order, each with the rank it keeps when the view is too long.
    let mut extra: Vec<(u8, String)> = states(context, id, listener.as_deref())
        .into_iter()
        .zip([4, 2])
        .map(|(line, rank)| (rank, line))
        .collect();
    extra.extend(
        changes
            .into_iter()
            .zip([5, 1])
            .map(|(line, rank)| (rank, line)),
    );
    extra.extend(wanted(context, entity, id).map(|line| (3, line)));
    extra.extend(
        p.pull
            .as_ref()
            .map(|to| (0, format!("The way to {} starts here.", name(to)))),
    );
    let last = match &listener {
        Some(l) => match profiles()[l.as_str()]["pronouns"].as_str() {
            Some(p) => format!(
                "{} is right here; I'm talking with {}.",
                sentence(who(l)),
                p.split('/').nth(1).unwrap_or(p)
            ),
            None => format!("I'm talking with {}.", who(l)),
        },
        None if super::leaving(context, id) => "I'm saying goodbye to those staying.".into(),
        None => super::conversation::presence(context, id),
    };
    let size = |extra: &[(u8, String)]| {
        let all = pinned
            .iter()
            .chain(extra.iter().map(|(_, l)| l))
            .chain([&last]);
        all.map(|l| l.chars().count() + 1)
            .sum::<usize>()
            .div_ceil(4)
    };
    while size(&extra) > TOKENS && !extra.is_empty() {
        let lowest = (0..extra.len()).min_by_key(|i| extra[*i].0).unwrap_or(0);
        extra.remove(lowest);
    }
    let extra = extra.into_iter().map(|(_, line)| line);
    pinned
        .into_iter()
        .chain(extra)
        .chain([last])
        .map(|l| (Section::Now, l))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::{tests::context, valid};
    use super::*;

    #[test]
    fn chosen_events_follow_the_authored_ones_kept() {
        let mut p = Perception {
            changes: vec![2, 0],
            ..Default::default()
        };
        reindex(&mut p, &[true, false, true]);
        assert_eq!(p.changes, vec![1, 0]);
        reindex(&mut p, &[false, true]);
        assert_eq!(p.changes, vec![0]);
    }

    #[test]
    fn a_view_names_only_events_and_entities_that_exist() {
        let mut c = context();
        c.events = vec!["Pip waits one turn.".into()];
        let with = |p: Perception, c: &mut Context| {
            c.entities[0].perception = Some(p);
            valid(c)
        };
        let ok = Perception {
            changes: vec![0],
            arrival: Some(Arrival {
                gone: Some("moth".into()),
                ..Default::default()
            }),
            pull: Some("pond".into()),
        };
        assert!(with(ok, &mut c));
        let late = Perception {
            changes: vec![1],
            ..Default::default()
        };
        assert!(!with(late, &mut c));
        let nowhere = Perception {
            pull: Some("moth".into()),
            ..Default::default()
        };
        assert!(!with(nowhere, &mut c));
    }
}
