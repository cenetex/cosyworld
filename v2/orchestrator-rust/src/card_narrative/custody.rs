use super::{kind, listener, name, person, Context, Entity, TurnOutcome};

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

// The committed inventory survives the optional fact list's length limit.
// Covered objects keep only their existing unnamed sense description.
pub(super) fn carrying(context: &Context, entity: &Entity) -> Option<String> {
    let fact = entity.facts.iter().find(|f| f.starts_with("Holding: "));
    let Some((outcome, avatar)) = context.outcome.as_ref().and_then(|outcome| {
        outcome
            .avatars
            .iter()
            .find(|avatar| avatar.id == entity.id)
            .map(|avatar| (outcome, avatar))
    }) else {
        return fact
            .and_then(|f| person::fact(f, &entity.id, true))
            .map(|text| {
                text.replace("I'm holding ", "I'm carrying ")
                    .replace("My hands are empty.", "I'm carrying nothing.")
            });
    };
    let hidden = |id: &String| context.concealed.contains(id) || context.covered.contains(id);
    let obscured = context
        .concealed
        .iter()
        .chain(&context.covered)
        .any(|id| kind(id, "item"));
    let mut things: Vec<_> = avatar
        .holding
        .iter()
        .filter(|id| {
            !hidden(id) && holder(outcome, id).is_none_or(|owner| owner == entity.id.as_str())
        })
        .map(|id| person::the(&name(id)))
        .collect();
    things.extend(
        fact.into_iter()
            .flat_map(|f| {
                f.trim_start_matches("Holding: ")
                    .trim_end_matches('.')
                    .split(", ")
            })
            .filter(|thing| obscured && thing.starts_with("something "))
            .map(String::from),
    );
    if things.is_empty() {
        return (!obscured).then(|| "I'm carrying nothing.".into());
    }
    Some(format!("I'm carrying {}.", person::list(&things)))
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

pub(super) fn hand(context: &Context, speaker: &str) -> Option<String> {
    let outcome = context.outcome.as_ref()?;
    let avatar = outcome.avatars.iter().find(|a| a.id == speaker)?;
    let item = avatar.held_item.as_ref()?;
    (!context.concealed.contains(item)
        && !context.covered.contains(item)
        && outcome
            .items
            .iter()
            .any(|i| &i.id == item && i.holder == speaker))
    .then(|| format!("I'm holding {}.", person::the(&name(item))))
}

pub(super) fn visible_holder<'a>(
    context: &'a Context,
    speaker: &str,
    item: &str,
) -> Option<&'a str> {
    let outcome = context.outcome.as_ref()?;
    let observer = outcome.avatars.iter().find(|a| a.id == speaker)?;
    let owner = outcome
        .avatars
        .iter()
        .find(|a| a.held_item.as_deref() == Some(item))?;
    let visible = |id: &str| {
        !context
            .concealed
            .iter()
            .chain(&context.covered)
            .any(|hidden| hidden == id)
    };
    (owner.id != speaker
        && observer.location == context.location
        && owner.location == context.location
        && visible(item)
        && visible(&owner.id)
        && outcome
            .items
            .iter()
            .any(|i| i.id == item && i.holder == owner.id && i.location == owner.location))
    .then_some(owner.id.as_str())
}

pub(super) fn visible_item(context: &Context, speaker: &str, item: &str) -> bool {
    if context
        .concealed
        .iter()
        .chain(&context.covered)
        .any(|id| id == item)
    {
        return false;
    }
    context.outcome.as_ref().is_none_or(|outcome| {
        holder(outcome, item) == Some(speaker)
            || visible_holder(context, speaker, item).is_some()
            || outcome
                .items
                .iter()
                .any(|i| i.id == item && i.holder == context.location)
                && outcome
                    .avatars
                    .iter()
                    .any(|a| a.id == speaker && a.location == context.location)
    })
}

pub(super) fn visible_holding(context: &Context, speaker: &str) -> Vec<String> {
    let Some(outcome) = &context.outcome else {
        return vec![];
    };
    let listener = listener(context, speaker);
    let mut avatars: Vec<_> = outcome.avatars.iter().collect();
    avatars.sort_by_key(|a| Some(&a.id) != listener.as_ref());
    avatars
        .into_iter()
        .filter_map(|avatar| {
            let item = avatar.held_item.as_ref()?;
            let owner = visible_holder(context, speaker, item)?;
            Some(format!(
                "{} is holding {}.",
                name(owner),
                person::the(&name(item))
            ))
        })
        .take(3)
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
    facts.extend(visible_holding(context, speaker));
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
                    format!("i am carrying the {label}"),
                    format!("i'm carrying the {label}"),
                ]
                .iter()
                .any(|prefix| starts_word(statement, prefix))
            {
                Some(speaker)
            } else if possession.is_some_and(|tail| starts_word(tail, "yours"))
                || [
                    format!("you are holding the {label}"),
                    format!("you're holding the {label}"),
                    format!("you are carrying the {label}"),
                    format!("you're carrying the {label}"),
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
    use super::*;

    #[test]
    fn visible_listener_custody_survives_later_talk_and_hides_the_rest() {
        let mut c = tests::context();
        let mut outcome = tests::solo_departure();
        outcome.card.kind = "give".into();
        outcome.card.item = Some("lamp".into());
        outcome.card.target = Some("moth".into());
        outcome.card.accepted = Some(true);
        outcome.avatars[1].location = "station".into();
        outcome.avatars[1].travel = None;
        outcome.avatars[1].held_item = Some("lamp".into());
        outcome.items[0].location = "station".into();
        assert!(super::super::valid_outcome(&outcome));
        c.outcome = Some(outcome);
        let visible = "Pip is holding the Lamp.";
        assert_eq!(visible_holding(&c, "vale"), [visible]);
        let outcome = c.outcome.as_mut().unwrap();
        outcome.card.kind = "talk".into();
        outcome.card.item = None;
        outcome.card.accepted = None;
        let mut c: Context = serde_json::from_value(serde_json::to_value(c).unwrap()).unwrap();
        for perceived in [false, true] {
            c.entities[0].perception = perceived.then(Default::default);
            let prompt = messages(&c, entity(&c, "vale"), Part::Line).assistant;
            assert!(prompt.contains(visible), "{prompt}");
            assert!(!prompt.contains("Pip is holding the Black cloth"));
        }
        assert_eq!(
            carrying(&c, entity(&c, "moth")).as_deref(),
            Some("I'm carrying the Lamp and the Black cloth.")
        );
        assert_eq!(hand(&c, "moth").as_deref(), Some("I'm holding the Lamp."));
        let npc = messages(&c, entity(&c, "moth"), Part::Line).assistant;
        assert!(npc.contains("I'm carrying the Lamp and the Black cloth."));
        assert!(npc.contains("I'm holding the Lamp."));
        let mut crowd: Context = serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
        // The item details have their own bound; a visible hand needs no full entity row.
        let outcome = crowd.outcome.as_mut().unwrap();
        outcome.avatars[2].location = "station".into();
        outcome.avatars[2].held_item = Some("bell".into());
        for item in outcome.items.iter_mut().skip(2) {
            item.location = "station".into();
        }
        assert_eq!(
            visible_holding(&crowd, "vale"),
            [visible, "The keeper is holding the Bell."]
        );
        assert!(!visible_item(&crowd, "vale", "oil"));
        assert!(visible_item(&crowd, "keeper", "oil"));
        crowd.outcome.as_mut().unwrap().avatars[1].held_item = None;
        crowd.outcome.as_mut().unwrap().observations =
            serde_json::from_value(serde_json::json!([{"id":"lamp-flame", "value":true}])).unwrap();
        for perceived in [false, true] {
            crowd.entities[0].perception = perceived.then(Default::default);
            let prompt = messages(&crowd, entity(&crowd, "vale"), Part::Line).assistant;
            assert!(prompt.contains("The keeper is holding the Bell."));
            assert!(!prompt.to_lowercase().contains("lamp is burning"));
        }
        c.outcome.as_mut().unwrap().card.target = None;
        c.speakers = vec!["vale".into()];
        assert_eq!(visible_holding(&c, "vale"), [visible]);
        c.outcome.as_mut().unwrap().card.target = Some("moth".into());
        c.speakers.push("moth".into());
        c.outcome.as_mut().unwrap().avatars[1]
            .holding
            .retain(|id| id != "lamp");
        assert!(!super::super::valid_outcome(c.outcome.as_ref().unwrap()));
        c.outcome.as_mut().unwrap().avatars[1]
            .holding
            .push("lamp".into());
        c.concealed.push("lamp".into());
        assert!(visible_holding(&c, "vale").is_empty());
        c.concealed.clear();
        c.outcome.as_mut().unwrap().avatars[1].location = "pond".into();
        assert!(visible_holding(&c, "vale").is_empty());
        c.outcome.as_mut().unwrap().avatars[1].location = "station".into();
        c.outcome.as_mut().unwrap().items[0].holder = "vale".into();
        assert!(visible_holding(&c, "vale").is_empty());
        assert!(!super::super::valid_outcome(c.outcome.as_ref().unwrap()));
        c.outcome.as_mut().unwrap().avatars[1].held_item = None;
        assert!(visible_holding(&c, "vale").is_empty());
        assert!(super::super::valid_outcome(c.outcome.as_ref().unwrap()));
        c.outcome.as_mut().unwrap().items[0].holder = "station".into();
        c.entities[0].perception = None;
        let ground = "The Lamp is on the ground here.";
        assert!(messages(&c, entity(&c, "vale"), Part::Line)
            .assistant
            .contains(ground));
        c.concealed.push("lamp".into());
        assert!(!messages(&c, entity(&c, "vale"), Part::Line)
            .assistant
            .contains(ground));
    }

    #[test]
    fn committed_inventory_survives_full_facts_and_later_transfer() {
        let mut c = tests::context();
        c.outcome = Some(tests::solo_departure());
        let outcome = c.outcome.as_mut().unwrap();
        outcome.card.kind = "give".into();
        outcome.card.item = Some("lamp".into());
        outcome.card.target = Some("moth".into());
        outcome.card.accepted = Some(true);
        c.speakers = vec!["vale".into(), "moth".into()];
        let moth = c.entities.iter_mut().find(|e| e.id == "moth").unwrap();
        moth.facts = vec!["Location now: Black pond. Company now: alone.".into(); 16];
        moth.facts.push("Holding: Lamp, Black cloth.".into());
        moth.facts.truncate(16);
        for perceived in [false, true] {
            c.entities
                .iter_mut()
                .find(|e| e.id == "moth")
                .unwrap()
                .perception = perceived.then(Default::default);
            for part in [Part::Line, Part::Thought] {
                let prompt = messages(&c, entity(&c, "moth"), part).assistant;
                assert!(
                    prompt.contains("I'm carrying the Lamp and the Black cloth."),
                    "{prompt}"
                );
                assert!(
                    prompt.contains("I received the Lamp from Vale."),
                    "{prompt}"
                );
            }
        }
        let outcome = c.outcome.as_mut().unwrap();
        outcome.items[0].holder = "vale".into();
        outcome.items[0].location = "station".into();
        outcome.avatars[0].holding.push("lamp".into());
        outcome.avatars[1].holding.retain(|id| id != "lamp");
        // Even an older optional fact yields to the current outcome.
        c.entities
            .iter_mut()
            .find(|e| e.id == "moth")
            .unwrap()
            .facts = vec!["Holding: Lamp, Black cloth.".into()];
        let c: Context = serde_json::from_value(serde_json::to_value(c).unwrap()).unwrap();
        assert_eq!(
            carrying(&c, entity(&c, "moth")).as_deref(),
            Some("I'm carrying the Black cloth.")
        );
        assert_eq!(
            carrying(&c, entity(&c, "vale")).as_deref(),
            Some("I'm carrying the Lamp.")
        );
        let prompt = messages(&c, entity(&c, "moth"), Part::Line).assistant;
        assert!(!prompt.contains("I'm carrying the Lamp"), "{prompt}");
        assert!(
            prompt.contains("I received the Lamp from Vale."),
            "{prompt}"
        );
    }

    #[test]
    fn hidden_inventory_keeps_its_unnamed_sense_and_legacy_context() {
        let mut c = tests::context();
        c.outcome = Some(tests::solo_departure());
        c.concealed = vec!["lamp".into(), "cloth".into()];
        c.entities
            .iter_mut()
            .find(|e| e.id == "moth")
            .unwrap()
            .facts = vec!["Holding: something shining I can't make out.".into()];
        let phrase = "I'm carrying something shining I can't make out.";
        assert_eq!(carrying(&c, entity(&c, "moth")).as_deref(), Some(phrase));
        c.entities
            .iter_mut()
            .find(|e| e.id == "moth")
            .unwrap()
            .facts
            .clear();
        assert_eq!(carrying(&c, entity(&c, "moth")), None);
        c.concealed.clear();
        assert_eq!(
            carrying(&c, entity(&c, "vale")).as_deref(),
            Some("I'm carrying nothing.")
        );
        // The item table has its own size cap; the avatar's inventory stays.
        c.outcome.as_mut().unwrap().items.clear();
        assert_eq!(
            carrying(&c, entity(&c, "moth")).as_deref(),
            Some("I'm carrying the Lamp and the Black cloth.")
        );
        c.outcome = None;
        c.entities
            .iter_mut()
            .find(|e| e.id == "moth")
            .unwrap()
            .facts = vec!["Holding: Lamp.".into()];
        assert_eq!(
            carrying(&c, entity(&c, "moth")).as_deref(),
            Some("I'm carrying the Lamp.")
        );
    }

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
