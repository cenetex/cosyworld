//! What a character notices this moment (P3): the one or two events the
//! narrator ranked as most about it, its arrival compared with its last
//! visit, and a pull toward its want (perception.mjs). Ids and indices only,
//! checked here; the wording comes in a later change.
use super::{kind, Context};
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
