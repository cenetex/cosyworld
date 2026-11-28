use super::{create_geography::Geography, pack_state::Catalog};
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn crossing_open(
    world: &Value,
    geo: &Geography,
    actor: &str,
    pack: &str,
    crossing: &Value,
) -> Option<bool> {
    let from = crossing["from"].as_str()?;
    let to = crossing["to"].as_str()?;
    let saved = &world["crossings"][crossing["id"].as_str()?];
    if (crossing["retired"] == true && saved["discovered"] != true)
        || !geo.entity_active(world, from)?
        || !geo.entity_active(world, to)?
    {
        return Some(false);
    }
    if let Some(transport) = crossing["transport"].as_str() {
        let ship = &world["transports"][transport];
        if ship["dock"] != from || ship["phase"] == "sea" {
            return Some(false);
        }
        let mut signals = geo
            .packs()
            .flat_map(|pack| entries(&pack["crossings"]))
            .filter(|entry| {
                entry["transport"] == transport
                    && (entry.get("signal").is_some() || entry.get("unlockWhen").is_some())
            })
            .peekable();
        if signals.peek().is_some()
            && !signals.any(|entry| {
                entry["id"]
                    .as_str()
                    .is_some_and(|id| world["crossings"][id]["discovered"] == true)
            })
        {
            return Some(false);
        }
        return None;
    }
    if let Some(signal) = crossing.get("signal") {
        let window = if signal["opens"].is_null() {
            saved["phase"].as_u64()? == signal["steps"].as_array()?.len() as u64
        } else {
            world["turn"].as_u64()? < saved["until"].as_u64()?
        };
        if !window || !geo.crossing_conditions(world, pack, &signal["while"], None)? {
            return Some(false);
        }
    }
    geo.crossing_conditions(world, pack, &crossing["requires"], Some(actor))
}

fn blocked(world: &Value, geo: &Geography, actor: &str, post: &str, beyond: &str) -> Option<bool> {
    let life = &geo.files()["v2/card-game/world-life.json"];
    for (id, record) in world["actors"].as_object()? {
        if id == actor || record["place"] != post || record["guarding"] != beyond {
            continue;
        }
        if geo.human_present(world, id) && geo.entity_active(world, id)? {
            return Some(true);
        }
        if life["residents"][id]["guards"].is_string() {
            for pack in geo.packs().filter(|pack| pack["avatars"].get(id).is_some()) {
                let pass = pack["avatars"][id].get("passWhen");
                if geo.entity_active(world, id)?
                    && (pass.is_none()
                        || !geo.conditions_met(world, pack["id"].as_str()?, pass?, Some(actor))?)
                {
                    return Some(true);
                }
            }
        }
    }
    Some(false)
}

pub(super) fn exits<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    from: &str,
) -> Option<BTreeSet<&'a str>> {
    let mut ways = BTreeSet::new();
    let mut personal = BTreeSet::new();
    let mut allowed = BTreeSet::new();
    let base = geo.base_exits(from)?;
    for exit in base {
        ways.insert(exit.as_str()?);
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    for route in entries(&forest["reflectionRoutes"]).filter(|route| route["from"] == from) {
        if geo.reflection_open(world, route)? {
            ways.insert(route["to"].as_str()?);
        }
    }
    for pack in geo.packs() {
        if pack["transports"]
            .as_object()
            .is_some_and(|ships| ships.values().any(|ship| ship["place"] == from))
        {
            return None;
        }
        let id = pack["id"].as_str()?;
        for crossing in entries(&pack["crossings"]).filter(|crossing| crossing["from"] == from) {
            if crossing_open(world, geo, actor, id, crossing)? {
                ways.insert(crossing["to"].as_str()?);
            }
        }
        for route in entries(&pack["routes"]).filter(|route| route["from"] == from) {
            let to = route["to"].as_str()?;
            if entries(&route["travelerRequires"]).next().is_some() {
                personal.insert(to);
            }
            if geo.route_open(world, id, route)?
                && geo.conditions_met(world, id, &route["travelerRequires"], Some(actor))?
            {
                allowed.insert(to);
                ways.insert(to);
            }
        }
    }
    for (post, beyond) in entries(&geo.files()["v2/card-game/world-life.json"]["guardable"])
        .filter_map(|route| Some((route["from"].as_str()?, route["to"].as_str()?)))
        .filter(|&(post, beyond)| post == from || beyond == from)
    {
        let to = if post == from { beyond } else { post };
        if blocked(world, geo, actor, post, beyond)? {
            ways.remove(to);
        } else {
            ways.insert(to);
        }
    }
    if from == "station" {
        let mut admitted = BTreeSet::new();
        for road in base {
            let road = road.as_str()?;
            if geo.entity_active(world, road)? {
                admitted.insert(road);
                if admitted.len() == 3 {
                    break;
                }
            }
        }
        admitted.extend(
            world["stationExitOrder"]
                .as_array()?
                .iter()
                .take(3 - admitted.len())
                .map(Value::as_str)
                .collect::<Option<Vec<_>>>()?,
        );
        ways.retain(|to| admitted.contains(to));
    }
    let mut visited = BTreeSet::new();
    for to in ways {
        if (!personal.contains(to) || allowed.contains(to)) && geo.entity_active(world, to)? {
            visited.insert(to);
        }
    }
    Some(visited)
}

pub(super) fn reachable<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    here: &str,
) -> Option<BTreeSet<&'a str>> {
    if world["hidden"]["actor"] != actor
        || world["actors"][actor]["place"] != here
        || !geo.visiting_resident(world, actor)
    {
        return None;
    }
    let mut found = BTreeSet::new();
    let mut queue = VecDeque::from([here]);
    while let Some(from) = queue.pop_front() {
        for to in exits(world, geo, actor, from)? {
            if to != here && found.insert(to) {
                queue.push_back(to);
            }
        }
    }
    Some(found)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let files = content.get("files")?;
    let catalog = Catalog::from_files(files)?;
    let geo = Geography::new(files, catalog.packs())?;
    let world = request.get("world")?;
    let actor = world["hidden"]["actor"].as_str()?;
    let places = reachable(
        world,
        &geo,
        actor,
        world["actors"][actor]["place"].as_str()?,
    )?;
    Some(json!({"ok": true, "places": places}))
}
