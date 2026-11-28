use super::{
    create_geography::Geography,
    elysium,
    initial_wants::{same_terms, People, Person},
    opening_candidates,
};
use serde_json::Value;
use std::collections::BTreeSet;

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn is_stalled(world: &Value, id: &str, person: &Person, turn: u64) -> Option<bool> {
    let actor = &world["actors"][id];
    let want = &actor["want"];
    if want.is_null() || want["step"]["verb"] == "call" {
        return Some(false);
    }
    let meetings = if person.pack == "hub" {
        &world["opening"]["met"]
    } else {
        &world["packs"][person.pack]["met"]
    };
    let met = if meetings.is_null() {
        Some(0)
    } else {
        meetings[id].as_u64()
    };
    let began = want["since"]
        .as_u64()?
        .max(met.unwrap_or(0))
        .max(actor["dwellUntil"].as_u64().unwrap_or(0).saturating_sub(29));
    let authored = match person.data["wants"].as_array() {
        Some(stages) => stages.iter().any(|entry| same_terms(&entry["want"], want)),
        None => same_terms(&person.data["want"], want),
    };
    Some(turn.saturating_sub(began) >= 48 && (met.is_some() || !authored))
}

fn can_abandon_earlier(
    world: &Value,
    geo: &Geography,
    id: &str,
    person: &Person,
    human: bool,
) -> Option<bool> {
    let travels = human
        || id == "boardyai"
        || (person.pack == "hub" && person.data["travels"] != false)
        || person.data["personalQuests"] == true
        || person.data.get("roamingQuest").is_some()
        || (person.data["stayUntil"].is_array()
            && geo.conditions_met(world, person.pack, &person.data["stayUntil"], Some(id))?);
    let actor = &world["actors"][id];
    if !travels {
        return Some(actor["place"] == "attic");
    }
    let want = &actor["want"];
    let target = want["target"].as_str()?;
    Some(match want["kind"].as_str()? {
        "place" => want["target"] != actor["place"],
        "person" => {
            !geo.entity_active(world, target)?
                || (human && world["actors"][target]["place"] != actor["place"])
        }
        _ => false,
    })
}

pub(super) fn revise(world: &mut Value, geo: &Geography, people: &People, turn: u64) -> Option<()> {
    let actors = world["actors"].as_object()?;
    let accepted: BTreeSet<_> = actors
        .values()
        .filter(|actor| !actor["want"].is_null())
        .flat_map(|actor| std::iter::once(&actor["want"]).chain(entries(&actor["under"])))
        .filter_map(|want| want["from"].as_str()?.strip_prefix("quest:from:"))
        .collect();
    let mut stalled = BTreeSet::new();
    for (&id, person) in &people.people {
        if id == "vale"
            || accepted.contains(id)
            || !is_stalled(world, id, person, turn)?
            || !geo.entity_active(world, id)?
        {
            continue;
        }
        let human = people.humans.contains(id);
        if can_abandon_earlier(world, geo, id, person, human)? {
            return None;
        }
        if !human && !elysium::model_waiting(world, id) {
            stalled.insert(id);
        }
    }
    if !stalled.is_empty() {
        opening_candidates::replace(world, geo, people, geo.files(), &stalled)?;
    }
    Some(())
}

pub(super) fn fill_due(
    world: &mut Value,
    geo: &Geography,
    people: &People,
    turn: u64,
) -> Option<()> {
    for (&id, person) in &people.people {
        let actor = &world["actors"][id];
        if id != "vale"
            && person.data["wants"] != false
            && actor["want"].is_null()
            && !actor["completedQuest"].is_object()
            && !elysium::model_waiting(world, id)
            && turn.saturating_sub(actor["metTurn"].as_u64().unwrap_or(0)) >= 24
            && geo.entity_active(world, id)?
        {
            return opening_candidates::fill_due(world, geo, people, geo.files());
        }
    }
    Some(())
}
