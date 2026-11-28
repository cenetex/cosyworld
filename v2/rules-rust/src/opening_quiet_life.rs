use super::{
    create_geography::Geography,
    initial_wants::{People, Person},
    opening_content, opening_mirror_move, opening_play, opening_station_move,
    opening_visitor_routes,
    pack_state::Catalog,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};

pub(super) fn ranged(world: &Value, geo: &Geography, id: &str, person: &Person) -> Option<bool> {
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

fn can_walk_home<'a>(
    world: &mut Value,
    geo: &Geography<'a>,
    id: &str,
    from: &str,
    home: &str,
) -> Option<bool> {
    let interior = geo.attic_interior()?;
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
    if world["turn"].as_u64()? != 1 {
        return None;
    }
    verify_opening_day(world, geo)
}

pub(super) fn verify_second_attic(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    opening_play::second_attic_plays(world)?;
    verify_opening_day(world, geo)
}

pub(super) fn verify_second_pond(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    opening_mirror_move::second_arrival(world)?;
    verify_opening_day(world, geo)
}

pub(super) fn verify_station(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let followed = opening_station_move::arrival(world)?.checked_add(1)?;
    if ["moth", "keeper"]
        .iter()
        .any(|id| world["actors"][*id]["place"] != "station")
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| {
                !world[*key]
                    .as_array()
                    .is_some_and(|seats| seats.len() == 1 && seats[0] == "vale")
            })
        || world["playerActorId"] != "vale"
        || !world["log"].as_array()?.iter().any(|event| {
            event["seq"] == followed
                && event["turn"] == world["turn"]
                && event["kind"] == "action"
                && event["actorId"] == "moth"
                && event["verb"] == "move"
                && event["itemId"].is_null()
                && event["fromLocationId"] == "pond"
                && event["targetId"] == "station"
                && event["locationId"] == "station"
                && event["generated"] != true
        })
    {
        return None;
    }
    verify_opening_day(world, geo)
}

fn verify_opening_day(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let room = world["actors"]["vale"]["place"].as_str()?.to_owned();
    let cast: &[&str] = match room.as_str() {
        "attic" => &[],
        "pond" => &["moth"],
        "station" if opening_station_move::rue_arrived(world) => &["moth", "keeper", "rue"],
        "station" => &["moth", "keeper"],
        _ => return None,
    };
    if world.get("began").is_some_and(|t| t != 0)
        || world["sharedVersion"] != 1
        || (room != "attic" && world["items"]["lamp"]["holder"] != "vale")
        || !matches!(
            world["items"]["lamp"]["holder"].as_str(),
            Some("vale" | "attic")
        )
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
        if (here == room && !cast.contains(&id)) || home_level_due(world, geo, id, person)? {
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

pub(super) fn opening_day_projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    match request["op"].as_str()? {
        "opening_second_attic_life" => verify_second_attic(&mut world, &geo)?,
        "opening_second_pond_life" => verify_second_pond(&mut world, &geo)?,
        "opening_station_life" => verify_station(&mut world, &geo)?,
        _ => return None,
    }
    Some(json!({"ok":true, "world":world}))
}

pub(super) fn verify_home_levels(world: &Value, geo: &Geography) -> Option<()> {
    let people = People::new(geo.files(), geo.packs())?;
    for (id, person) in people.people {
        if home_level_due(world, geo, id, &person)? && geo.entity_active(world, id)? {
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
