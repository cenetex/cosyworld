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

pub(super) fn facts(context: &Context, speaker: &str) -> Vec<String> {
    let Some(outcome) = &context.outcome else {
        return vec![];
    };
    let mut facts = Vec::new();
    let actor = context.acting_avatar.as_deref().unwrap_or("vale");
    if outcome.card.kind == "give" {
        if let (Some(item), Some(target)) = (&outcome.card.item, &outcome.card.target) {
            if speaker == target {
                facts.push(format!("I received {} from {}.", name(item), name(actor)));
            } else if speaker == actor {
                facts.push(format!("I gave {} to {}.", name(item), name(target)));
            }
        }
    }
    for item in &outcome.items {
        if let Some(owner) = holder(outcome, &item.id) {
            facts.push(format!(
                "Final custody: {} — {}. Location: {}.",
                name(&item.id),
                name(owner),
                name(&item.location)
            ));
        }
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
