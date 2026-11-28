use super::{
    create_geography::Geography,
    initial_wants::{run_hash, People, Person},
    opening_content, opening_quiet_life,
    pack_state::Catalog,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const DAY: i64 = 48;
const SCATTER: i64 = 3;

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn places(region: &Value) -> impl Iterator<Item = &Value> {
    region["places"]
        .as_object()
        .into_iter()
        .flat_map(|map| map.values())
}

fn ships<'a>(geo: &Geography<'a>) -> BTreeSet<&'a str> {
    geo.packs()
        .flat_map(|pack| pack["transports"].as_object().into_iter().flatten())
        .filter_map(|(_, ship)| ship["place"].as_str())
        .collect()
}

fn bedtime(world: &Value, id: &str, schedule: &Value, turn: i64) -> Option<Option<(i64, i64)>> {
    if schedule.is_null() {
        return Some(None);
    }
    let from = schedule["from"].as_i64()?;
    let to = schedule["to"].as_i64()?;
    if !(0..DAY).contains(&from) || !(0..DAY).contains(&to) {
        return None;
    }
    let scatter = |edge, day| {
        i64::from(run_hash(world, &format!("{edge}:{id}:{day}"))) % (2 * SCATTER + 1) - SCATTER
    };
    let day = turn / DAY;
    Some([day - 1, day].into_iter().find_map(|day| {
        let start = day * DAY + from + scatter("sleep", day);
        let end = (day + i64::from(to <= from)) * DAY + to + scatter("wake", day);
        (start <= turn && turn < end).then_some((start, end))
    }))
}

pub(super) fn home<'a>(
    world: &Value,
    geo: &Geography<'a>,
    id: &str,
    person: &Person<'a>,
) -> Option<Option<&'a str>> {
    if person.pack == "hub" {
        return Some(person.data["home"].as_str());
    }
    if let Some(next) = person.data.get("homeWhen") {
        if geo.conditions_met(world, person.pack, &next["requires"], Some(id))? {
            return Some(Some(next["place"].as_str()?));
        }
    }
    Some(
        person.data["home"]
            .as_str()
            .or_else(|| person.data["place"].as_str()),
    )
}

fn seeks_home_when_tired(
    world: &Value,
    geo: &Geography<'_>,
    id: &str,
    person: &Person<'_>,
    human: bool,
) -> Option<bool> {
    if human {
        return Some(true);
    }
    if person.pack == "hub" {
        return Some(id != "vale" && person.data["stops"].is_null());
    }
    let definition = person.data;
    let freed = definition["stayUntil"].is_array()
        && geo.conditions_met(world, person.pack, &definition["stayUntil"], Some(id))?;
    Some(
        id != "boardyai"
            && definition["journey"].is_null()
            && definition["personalQuests"] != true
            && !freed,
    )
}

fn sealed_home(world: &Value, geo: &Geography<'_>, here: &str, home: &str) -> Option<bool> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    if entries(&geo.files()["v2/card-game/world-life.json"]["guardable"])
        .any(|edge| edge["from"] == home || edge["to"] == home)
        || entries(&forest["reflectionRoutes"]).any(|edge| edge["to"] == home)
        || std::iter::once(forest).chain(geo.packs()).any(|region| {
            places(region).any(|place| entries(&place["exits"]).any(|exit| exit == home))
                || entries(&region["crossings"]).any(|edge| edge["to"] == home)
                || region["transports"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, ship)| {
                        ship["place"] == home || entries(&ship["docks"]).any(|dock| dock == home)
                    })
        })
    {
        return Some(false);
    }
    for pack in geo.packs() {
        for route in entries(&pack["routes"]).filter(|route| route["to"] == home) {
            if entries(&route["requires"]).any(|condition| condition["kind"] != "flag")
                || geo.route_open(world, pack["id"].as_str()?, route)?
            {
                return Some(false);
            }
        }
    }
    let interior = opening_quiet_life::attic_interior(geo)?;
    Some(!interior.contains(here) && !interior.contains(home))
}

pub(super) fn step_home(
    world: &Value,
    geo: &Geography<'_>,
    id: &str,
    here: &str,
    home: &str,
) -> Option<bool> {
    let pack = geo.resident_pack(id)?;
    if world["routeKnowledge"].get(id).is_some()
        || pack["places"].get(home).is_none()
        || pack["id"] == "elysium"
    {
        return None;
    }
    if !geo.entity_active(world, home)? || sealed_home(world, geo, here, home)? {
        return Some(false);
    }
    if here == "station"
        || pack["places"].get(here).is_none()
        || !pack["avatars"][id]["journey"].is_null()
        || !entries(&pack["places"][here]["exits"]).any(|exit| exit == home)
        || ships(geo).contains(here)
        || ships(geo).contains(home)
    {
        return None;
    }
    let guardable = &geo.files()["v2/card-game/world-life.json"]["guardable"];
    let on_lane = |edge: &&Value| edge["from"] == here && edge["to"] == home;
    if entries(guardable).any(|edge| on_lane(&edge) || (edge["from"] == home && edge["to"] == here))
        || geo.packs().any(|region| {
            entries(&region["routes"])
                .filter(on_lane)
                .any(|edge| entries(&edge["travelerRequires"]).next().is_some())
        })
    {
        return None;
    }
    Some(true)
}

fn no_seeking(world: &Value, person: &Person<'_>, id: &str, turn: i64) -> Option<()> {
    let actor = &world["actors"][id];
    if person.data["levelAtHome"] == true {
        if let Some(rank) = actor["level"].as_u64().map(u128::from) {
            if u128::from(actor["xp"].as_u64()?) >= rank * (rank + 1) / 2 {
                return None;
            }
        }
    }
    let want = &actor["want"];
    if want.is_null()
        || actor["metTurn"].as_i64().is_some_and(|met| {
            (turn - 2..=turn).contains(&met)
                && want["since"].as_i64().is_some_and(|since| since >= met)
        })
    {
        return Some(());
    }
    None
}

pub(super) fn settle(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let turn = world["turn"].as_i64()?;
    if turn != 481
        || world["began"] != 480
        || world["sharedVersion"] != 1
        || world["heldActors"] != json!(["vale"])
        || world["controlledActors"] != json!(["vale"])
        || world["presentActors"] != json!(["vale"])
        || world["actors"]["vale"]["place"] != "attic"
        || world["items"]["lamp"]["holder"] != "vale"
        || !world["standoffs"].as_array()?.is_empty()
        || !["hidden", "absent", "homecoming"]
            .iter()
            .all(|field| world[*field].is_null())
    {
        return None;
    }
    let people = People::new(geo.files(), geo.packs())?;
    let ships = ships(geo);
    for (&id, person) in &people.people {
        let human = people.humans.contains(id);
        if id == "vale"
            || person.data["roamingQuest"] == "latest-completion"
            || (human && !geo.visiting_resident(world, id))
            || !geo.entity_active(world, id)?
        {
            continue;
        }
        let actor = world["actors"].get(id)?;
        let here = actor["place"].as_str()?;
        let home = home(world, geo, id, person)?;
        let at_home = home == Some(here);
        let clear_homeward = at_home && actor["homeward"] == true;
        let sleeping = &actor["sleeping"];
        if let Some(until) = sleeping.get("until") {
            if until.as_i64()? <= turn || sleeping["place"] != here {
                if here == "attic" {
                    return None;
                }
                world["actors"][id].as_object_mut()?.remove("sleeping");
            }
        } else if sleeping.is_null() && !ships.contains(here) {
            let pack_schedule = &people.life["packs"][person.pack]["sleep"];
            let fallback = if human || pack_schedule.is_null() {
                &people.life["defaults"]["sleep"]
            } else {
                pack_schedule
            };
            let schedule = people.life["residents"][id]
                .get("sleep")
                .unwrap_or(fallback);
            if let Some((start, end)) = bedtime(world, id, schedule, turn)? {
                if actor["slept"] != start {
                    if let Some(home) = home.filter(|_| !at_home) {
                        if seeks_home_when_tired(world, geo, id, person, human)? {
                            if step_home(world, geo, id, here, home)? {
                                no_seeking(world, person, id, turn)?;
                                world["actors"][id]["homeward"] = json!(true);
                            }
                            continue;
                        }
                    }
                    if here == "attic" {
                        return None;
                    }
                    let sleep = json!({"since":turn,"place":here,"until":end});
                    world["actors"][id]["slept"] = json!(start);
                    world["actors"][id]["sleeping"] = sleep;
                }
            }
        }
        if clear_homeward {
            world["actors"][id].as_object_mut()?.remove("homeward");
        }
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    settle(&mut world, &geo)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
