use super::{kind, listener, name, Context, TurnOutcome};

fn holder<'a>(outcome: &'a TurnOutcome, item: &str) -> Option<&'a str> {
    let mut current = item;
    for _ in 0..=outcome.items.len() {
        let entry = outcome.items.iter().find(|entry| entry.id == current)?;
        if !kind(&entry.holder, "item") {
            return Some(&entry.holder);
        }
        current = &entry.holder;
    }
    None
}

pub(super) fn held_item_text(context: &Context, speaker: &str) -> Vec<String> {
    let Some(outcome) = context.outcome.as_ref().filter(|_| !context.waking) else {
        return vec![];
    };
    let Some(avatar) = outcome.avatars.iter().find(|avatar| avatar.id == speaker) else {
        return vec![];
    };
    avatar
        .holding
        .iter()
        .filter(|id| !context.covered.contains(id) && holder(outcome, id) == Some(speaker))
        .filter_map(|id| {
            let text = super::profiles()[id]["text"].as_str()?.trim();
            let passage: String = text.chars().take(240).collect();
            Some(format!("From {}: {passage}", super::person::the(&name(id))))
        })
        .collect()
}

pub(super) fn facts(context: &Context, speaker: &str) -> Vec<String> {
    let Some(outcome) = &context.outcome else {
        return vec![];
    };
    let mut facts = Vec::new();
    let actor = context.acting_avatar.as_deref().unwrap_or("vale");
    if outcome.card.kind == "give" && outcome.card.accepted != Some(false) {
        if let (Some(item), Some(target)) = (&outcome.card.item, &outcome.card.target) {
            if speaker == target {
                facts.push(format!(
                    "I received {} from {}.",
                    super::person::the(&name(item)),
                    name(actor)
                ));
            } else if speaker == actor {
                facts.push(format!(
                    "I gave {} to {}.",
                    super::person::the(&name(item)),
                    name(target)
                ));
            }
        }
    }
    // Who holds what, each holder once: "The keeper is holding the Oil
    // flask and the Bell."
    let mut held: Vec<(&str, &str, Vec<String>)> = Vec::new();
    for item in &outcome.items {
        if let Some(owner) = holder(outcome, &item.id) {
            let relevant = context
                .entities
                .iter()
                .any(|entity| entity.id == item.id || entity.id == owner)
                || outcome.card.item.as_deref() == Some(&item.id)
                || outcome.card.receive.as_deref() == Some(&item.id);
            // My own hands and the ground here are said with where I am.
            if !relevant || owner == speaker || owner == context.location {
                continue;
            }
            let thing = super::person::the(&name(&item.id));
            match held
                .iter_mut()
                .find(|(o, at, _)| *o == owner && *at == item.location)
            {
                Some((_, _, things)) => things.push(thing),
                None => held.push((owner, &item.location, vec![thing])),
            }
        }
    }
    for (owner, at, things) in held {
        let things = super::person::list(&things);
        facts.push(super::sentence(if kind(owner, "location") {
            let verb = if things.contains(" and ") {
                "are"
            } else {
                "is"
            };
            format!("{things} {verb} at {}.", name(owner))
        } else if at == context.location {
            format!("{} is holding {things}.", name(owner))
        } else {
            format!("{} has {things} at {}.", name(owner), name(at))
        }));
    }
    facts
}

// Check explicit present custody statements against the resolved world.
// Historical accounts and questions keep their separate meanings.
pub(super) fn consistent(text: &str, context: &Context, speaker: &str) -> bool {
    let Some(outcome) = &context.outcome else {
        return true;
    };
    let addressed = listener(context, speaker);
    for sentence in text.split_inclusive(['.', '!', '?', ';', '\n']) {
        if sentence.trim_end().ends_with('?') {
            continue;
        }
        let statement = sentence.trim().to_lowercase().replace('\u{2019}', "'");
        let statement = statement
            .trim_start_matches("now, ")
            .trim_start_matches("well, ");
        for item in &outcome.items {
            let label = name(&item.id).to_lowercase();
            let label = label.strip_prefix("the ").unwrap_or(&label);
            let item_subjects = [
                format!("{label} is "),
                format!("the {label} is "),
                format!("{label}'s "),
                format!("the {label}'s "),
            ];
            let possession = item_subjects
                .iter()
                .find_map(|prefix| statement.strip_prefix(prefix))
                .map(|tail| tail.strip_prefix("now ").unwrap_or(tail));
            let starts_word = |tail: &str, word: &str| {
                tail.strip_prefix(word)
                    .is_some_and(|rest| rest.chars().next().is_none_or(|c| !c.is_alphanumeric()))
            };
            let claimed = if possession.is_some_and(|tail| starts_word(tail, "mine"))
                || [
                    format!("i am holding the {label}"),
                    format!("i'm holding the {label}"),
                ]
                .iter()
                .any(|prefix| starts_word(statement, prefix))
            {
                Some(speaker)
            } else if possession.is_some_and(|tail| starts_word(tail, "yours"))
                || [
                    format!("you are holding the {label}"),
                    format!("you're holding the {label}"),
                ]
                .iter()
                .any(|prefix| starts_word(statement, prefix))
            {
                addressed.as_deref()
            } else {
                None
            };
            if claimed.is_some_and(|claimed| {
                holder(outcome, &item.id).is_some_and(|actual| actual != claimed)
            }) {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::super::{conversation, entity, known, messages, tests, Context, ItemOutcome, Part};

    #[test]
    fn held_item_story_follows_the_gift_in_talk_thoughts_and_dreams() {
        let mut context = tests::context();
        let mut outcome = tests::solo_departure();
        let id = "willows-pipe";
        let passage = "It's their sound.";
        outcome.card.kind = "talk".into();
        outcome.card.target = Some("moth".into());
        outcome.avatars[0].holding.push(id.into());
        outcome.avatars[1].location = "station".into();
        outcome.avatars[1].travel = None;
        outcome.items.push(ItemOutcome {
            id: id.into(),
            holder: "vale".into(),
            location: "station".into(),
        });
        context.outcome = Some(outcome);

        let sees_story = |context: &Context, speaker: &str, part| {
            messages(context, entity(context, speaker), part)
                .assistant
                .contains(passage)
        };
        for part in [Part::Line, Part::Thought, Part::Dream] {
            assert!(sees_story(&context, "vale", part));
            assert!(!sees_story(&context, "moth", part));
        }
        let swede = "willows-swede";
        assert!(known(&context, entity(&context, "vale")).contains(swede));
        assert!(!known(&context, entity(&context, "moth")).contains(swede));
        let heard = conversation::with_line(&context, "vale", "The Swede heard it too.").unwrap();
        assert!(known(&heard, entity(&heard, "moth")).contains(swede));

        let outcome = context.outcome.as_mut().unwrap();
        outcome.avatars[0].holding.clear();
        outcome.avatars[1].holding.push(id.into());
        outcome.items.last_mut().unwrap().holder = "moth".into();
        for part in [Part::Line, Part::Thought, Part::Dream] {
            assert!(!sees_story(&context, "vale", part));
            assert!(sees_story(&context, "moth", part));
        }
        context.covered.push(id.into());
        for part in [Part::Line, Part::Thought, Part::Dream] {
            assert!(!sees_story(&context, "moth", part));
        }
    }
}
