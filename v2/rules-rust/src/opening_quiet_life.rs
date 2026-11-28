use super::{
    create_geography::Geography,
    initial_wants::{People, Person},
    opening_visitor_routes,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn ranged(world: &Value, geo: &Geography, id: &str, person: &Person) -> Option<bool> {
    let authored = person.data;
    if person.pack == "hub"
        || id == "boardyai"
        || authored["journey"].is_object()
        || authored["personalQuests"] == true
    {
        return Some(false);
    }
    Some(
        !authored["stayUntil"].is_array()
            || !geo.conditions_met(world, person.pack, &authored["stayUntil"], Some(id))?,
    )
}

fn home<'a>(world: &Value, geo: &Geography, id: &str, person: &Person<'a>) -> Option<&'a str> {
    if let Some(next) = person.data.get("homeWhen") {
        if geo.conditions_met(world, person.pack, &next["requires"], Some(id))? {
            return next["place"].as_str();
        }
    }
    person.data["home"]
        .as_str()
        .or_else(|| person.data["place"].as_str())
}

fn attic_interior<'a>(geo: &Geography<'a>) -> Option<BTreeSet<&'a str>> {
    let mut found = BTreeSet::from(["attic"]);
    let mut queue = VecDeque::from(["attic"]);
    while let Some(from) = queue.pop_front() {
        let mut neighbor = |to| {
            if to != "pond" && found.insert(to) {
                queue.push_back(to);
            }
        };
        for to in geo.base_exits(from)? {
            neighbor(to.as_str()?);
        }
        for pack in geo.packs() {
            let land = entries(&pack["crossings"]).filter(|edge| edge["transport"].is_null());
            for edge in entries(&pack["routes"])
                .chain(land)
                .filter(|edge| edge["from"] == from)
            {
                neighbor(edge["to"].as_str()?);
            }
        }
    }
    Some(found)
}

fn can_walk_home<'a>(
    world: &mut Value,
    geo: &Geography<'a>,
    id: &str,
    from: &str,
    home: &str,
) -> Option<bool> {
    let interior = attic_interior(geo)?;
    if interior.contains(from)
        || interior.contains(home)
        || world["routeKnowledge"].get(id).is_some()
    {
        return None;
    }
    let mut found = BTreeSet::from([from]);
    let mut queue = VecDeque::from([from]);
    while let Some(here) = queue.pop_front() {
        if here == home {
            return Some(true);
        }
        let slot = world.get_mut("actors")?.get_mut(id)?.get_mut("place")?;
        let previous = std::mem::replace(slot, json!(here));
        let exits = opening_visitor_routes::exits(world, geo, id, here);
        world["actors"][id]["place"] = previous;
        for to in exits? {
            if found.insert(to) {
                queue.push_back(to);
            }
        }
    }
    Some(false)
}

pub(super) fn verify(world: &mut Value, geo: &Geography) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    if turn != 1
        || world.get("began").is_some_and(|t| t != 0)
        || world["sharedVersion"] != 1
        || world["actors"]["vale"]["place"] != "attic"
        || world["items"]["lamp"]["holder"] != "vale"
        || !world["actors"]["vale"]["arcana"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| {
                world
                    .get(key)
                    .is_some_and(|actors| actors != &json!(["vale"]))
            })
        || world.get("playerActorId").is_some_and(|id| id != "vale")
    {
        return None;
    }
    let people = People::new(geo.files(), geo.packs())?;
    for (&id, person) in &people.people {
        if id == "vale" || !geo.entity_active(world, id)? {
            continue;
        }
        let actor = world["actors"].get(id)?;
        let here = actor["place"].as_str()?;
        if here == "attic" || home_level_due(world, geo, id, person)? {
            return None;
        }
        if person.data["roamingQuest"] == "latest-completion" {
            continue;
        }
        let sleeping = &actor["sleeping"];
        if actor["homeward"] == true
            || sleeping.get("until").is_some_and(|until| {
                until.as_u64().is_none_or(|t| t <= turn) || sleeping["place"] != here
            })
        {
            return None;
        }
        if people.humans.contains(id)
            || !sleeping.is_null()
            || actor["dwellUntil"].as_u64().unwrap_or(0) > turn
            || world["peaceUntil"][id].as_u64()? > turn
            || !ranged(world, geo, id, person)?
        {
            continue;
        }
        let home = home(world, geo, id, person)?;
        if here == home || !geo.entity_active(world, home)? {
            continue;
        }
        let here = here.to_owned();
        if can_walk_home(world, geo, id, &here, home)? {
            return None;
        }
    }
    Some(())
}

fn home_level_due(world: &Value, geo: &Geography, id: &str, person: &Person) -> Option<bool> {
    let actor = &world["actors"][id];
    if person.data["levelAtHome"] != true || !actor["level"].is_number() {
        return Some(false);
    }
    let rank = u128::from(actor["level"].as_u64()?);
    let xp = u128::from(actor["xp"].as_u64()?);
    if xp < rank * (rank + 1) / 2 {
        return Some(false);
    }
    let place = actor["place"].as_str()?;
    Some(person.data["home"] == place && geo.entity_active(world, place)?)
}
