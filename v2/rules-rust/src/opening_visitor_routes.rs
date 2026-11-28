use super::{
    create_geography::Geography, opening, opening_content, opening_visitor_transport,
    pack_state::Catalog,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

pub(super) fn crossing_open(
    world: &Value,
    geo: &Geography,
    actor: &str,
    pack: &str,
    crossing: &Value,
) -> Option<bool> {
    crossing_open_for(world, geo, Some(actor), pack, crossing)
}

fn crossing_open_for(
    world: &Value,
    geo: &Geography,
    actor: Option<&str>,
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
        if ship["version"] != 3 {
            return None;
        }
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
        return geo.crossing_conditions(world, pack, &crossing["requires"], actor);
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
    geo.crossing_conditions(world, pack, &crossing["requires"], actor)
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

fn add<'a>(ways: &mut Vec<&'a str>, to: &'a str) {
    if !ways.contains(&to) {
        ways.push(to);
    }
}

fn ordinary_exits<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    from: &str,
    previous: Option<&str>,
) -> Option<Vec<&'a str>> {
    let mut ways = Vec::new();
    let mut personal = BTreeSet::new();
    let mut allowed = BTreeSet::new();
    for exit in geo.base_exits(from)? {
        add(&mut ways, exit.as_str()?);
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    for route in entries(&forest["reflectionRoutes"]).filter(|route| route["from"] == from) {
        if geo.reflection_open(world, route)? {
            add(&mut ways, route["to"].as_str()?);
        }
    }
    for (pack, crossing) in geo.crossings_from(from) {
        if crossing_open(world, geo, actor, pack["id"].as_str()?, crossing)? {
            if let Some(transport) = crossing["transport"].as_str() {
                if let Some(ship) =
                    opening_visitor_transport::board(world, geo, actor, transport, from)?
                {
                    add(&mut ways, ship);
                }
            } else {
                add(&mut ways, crossing["to"].as_str()?);
            }
        }
    }
    for to in opening_visitor_transport::exits(world, geo, actor, from, previous)? {
        add(&mut ways, to);
    }
    for (pack, route) in geo.routes_from(from) {
        let pack = pack["id"].as_str()?;
        let to = route["to"].as_str()?;
        if entries(&route["travelerRequires"]).next().is_some() {
            personal.insert(to);
        }
        if geo.route_open(world, pack, route)?
            && geo.conditions_met(world, pack, &route["travelerRequires"], Some(actor))?
        {
            allowed.insert(to);
            add(&mut ways, to);
        }
    }
    let guardable = &geo.files()["v2/card-game/world-life.json"]["guardable"];
    for (here, there) in [("from", "to"), ("to", "from")] {
        for route in entries(guardable).filter(|route| route[here] == from) {
            let post = route["from"].as_str()?;
            let beyond = route["to"].as_str()?;
            let to = route[there].as_str()?;
            if blocked(world, geo, actor, post, beyond)? {
                ways.retain(|way| *way != to);
            } else {
                add(&mut ways, to);
            }
        }
    }
    let mut visited = Vec::new();
    for to in ways {
        if (!personal.contains(to) || allowed.contains(to)) && geo.entity_active(world, to)? {
            visited.push(to);
        }
    }
    Some(visited)
}

pub(super) fn exits<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    from: &str,
) -> Option<BTreeSet<&'a str>> {
    if geo.packs().any(|pack| {
        pack["transports"]
            .as_object()
            .is_some_and(|ships| ships.values().any(|ship| ship["place"] == from))
    }) {
        return None;
    }
    let mut ways = ordinary_exits(world, geo, actor, from, None)?;
    if from == "station" {
        let mut admitted = BTreeSet::new();
        for road in geo.base_exits(from)? {
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
    Some(ways.into_iter().collect())
}

fn station_exits<'a>(world: &Value, geo: &Geography<'a>) -> Option<Vec<&'a str>> {
    let station = "station";
    if entries(&geo.files()["v2/card-game/forest.json"]["reflectionRoutes"])
        .any(|route| route["from"] == station)
        || geo.routes_from(station).next().is_some()
    {
        return None;
    }
    let mut roads = Vec::new();
    for road in geo.base_exits(station)? {
        let road = road.as_str()?;
        if geo.entity_active(world, road)? {
            add(&mut roads, road);
        }
    }
    let mut visitors = vec![None];
    for (actor, a) in world["actors"].as_object()? {
        if a["place"] == station
            && (!opening::is_seat(actor)
                || geo.human_present(world, actor)
                || geo.visiting_resident(world, actor))
            && geo.entity_active(world, actor)?
        {
            visitors.push(Some(actor.as_str()));
        }
    }
    let mut available = Vec::new();
    for (pack, crossing) in geo.crossings_from(station) {
        let pack = pack["id"].as_str()?;
        if crossing.get("transport").is_some() {
            return None;
        }
        let to = crossing["to"].as_str()?;
        if roads.contains(&to) {
            continue;
        }
        for &visitor in &visitors {
            if crossing_open_for(world, geo, visitor, pack, crossing)? {
                add(&mut available, to);
                break;
            }
        }
    }
    for saved in world["stationExitOrder"].as_array()? {
        if let Some(&to) = available.iter().find(|&&to| saved == to) {
            add(&mut roads, to);
        }
    }
    for to in available {
        add(&mut roads, to);
    }
    roads.truncate(3);
    Some(roads)
}

pub(super) fn projected_exits<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    from: &str,
    previous: Option<&str>,
) -> Option<Vec<&'a str>> {
    let ways = ordinary_exits(world, geo, actor, from, previous)?;
    if from == "station" {
        return Some(
            station_exits(world, geo)?
                .into_iter()
                .filter(|to| ways.contains(to))
                .collect(),
        );
    }
    Some(ways)
}

pub(super) fn person_step<'a>(
    world: &mut Value,
    geo: &Geography<'a>,
    actor: &str,
) -> Option<Option<&'a str>> {
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    if began.checked_add(2)? != world["turn"].as_u64()? {
        return None;
    }
    Some(home_person_routes(world, geo, actor)?.direct)
}

#[derive(Default)]
pub(super) struct PersonRoutes<'a> {
    pub(super) direct: Option<&'a str>,
    pub(super) attic: Option<&'a str>,
    pub(super) pond: Option<&'a str>,
}

pub(super) fn home_person_routes<'a>(
    world: &mut Value,
    geo: &Geography<'a>,
    actor: &str,
) -> Option<PersonRoutes<'a>> {
    let avatar = entries(&geo.files()["v2/card-game/shared-cast.json"]["avatars"])
        .find(|avatar| avatar["id"] == actor)?;
    let record = world["actors"].get(actor)?;
    let want = &record["want"];
    let from = record["place"].as_str()?.to_owned();
    let item = avatar["item"]["id"].as_str()?;
    if from != avatar["home"]["id"].as_str()?
        || !geo.visiting_resident(world, actor)
        || entries(&world["heldActors"]).any(|id| id == actor)
        || world["hidden"]["actor"] == actor
        || world["routeKnowledge"].get(actor).is_some()
        || want["kind"] != "person"
        || !want["step"].is_null()
        || world["items"][item]["holder"] != actor
    {
        return None;
    }
    let target = want["target"].as_str()?;
    let target = world["actors"][target]["place"].as_str()?.to_owned();
    if from == target {
        return None;
    }
    search(world, geo, actor, &from, &target)
}

pub(super) fn reaches_from(
    world: &mut Value,
    geo: &Geography,
    actor: &str,
    from: &str,
    target: &str,
) -> Option<bool> {
    Some(from == target || search(world, geo, actor, from, target)?.direct.is_some())
}

fn search<'a>(
    world: &mut Value,
    geo: &Geography<'a>,
    actor: &str,
    from: &str,
    target: &str,
) -> Option<PersonRoutes<'a>> {
    let mut visited = BTreeSet::from([from]);
    let mut queue = VecDeque::from([(from, None, None)]);
    let mut routes = PersonRoutes::default();
    while let Some((here, previous, first)) = queue.pop_front() {
        if here == target {
            routes.direct = first;
            break;
        }
        match here {
            "attic" => routes.attic = first,
            "pond" => routes.pond = first,
            _ => {}
        }
        let slot = world["actors"].get_mut(actor)?.get_mut("place")?;
        let saved = std::mem::replace(slot, json!(here));
        let next = projected_exits(world, geo, actor, here, previous);
        world["actors"][actor]["place"] = saved;
        for to in next? {
            if visited.insert(to) {
                queue.push_back((to, Some(here), first.or(Some(to))));
            }
        }
    }
    Some(routes)
}

pub(super) fn person_step_projection(request: &Value) -> Option<Value> {
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    let step = person_step(&mut world, &geo, request["actor"].as_str()?)?;
    Some(json!({"ok":true,"step":step}))
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
