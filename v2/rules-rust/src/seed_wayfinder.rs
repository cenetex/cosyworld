use super::{pack_state::Catalog, seed::hash};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const WAYFINDER: &str = "elysium-wayfinder";
type Links<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

fn used(world: &Value, item: &str) -> bool {
    world["usedUp"]
        .as_array()
        .is_some_and(|items| items.iter().any(|id| id == item))
}

fn room<'a>(world: &'a Value, item: &str, here: &'a str) -> Option<&'a str> {
    let mut holder = world["items"][item]["holder"].as_str()?;
    let mut seen = BTreeSet::new();
    while let Some(next) = world["items"].get(holder) {
        if !seen.insert(holder) {
            return None;
        }
        holder = next["holder"].as_str()?;
    }
    if holder == "vale" {
        return Some(here);
    }
    Some(world["actors"][holder]["place"].as_str().unwrap_or(holder))
}

fn gate(world: &Value, here: &str, condition: &Value) -> Option<bool> {
    match condition["kind"].as_str()? {
        "shared_world" | "connected_humans" | "sound" => Some(false),
        "not" => Some(!gate(world, here, &condition["condition"])?),
        "any" => {
            for condition in condition["conditions"].as_array()? {
                if gate(world, here, condition)? {
                    return Some(true);
                }
            }
            Some(false)
        }
        "holding" => {
            let actor = if condition["role"] == "actor" {
                "vale"
            } else {
                condition["actor"].as_str()?
            };
            let item = condition["item"].as_str()?;
            Some(!used(world, item) && world["items"][item]["holder"] == actor)
        }
        "item_near" | "item_present" => {
            let item = condition["item"].as_str()?;
            Some(!used(world, item) && room(world, item, here)? == condition["place"].as_str()?)
        }
        "light" if condition["item"] == "lamp" => {
            let lamp = &world["items"]["lamp"];
            let place = room(world, "lamp", here)?;
            let covered = condition["uncovered"] == true
                && world["items"]
                    .as_object()?
                    .values()
                    .any(|item| item["holder"] == "lamp");
            Some(
                !used(world, "lamp")
                    && lamp["lit"].as_bool()?
                    && lamp["fuel"].as_u64()? > 0
                    && condition["at"].as_array()?.iter().any(|at| at == place)
                    && !covered,
            )
        }
        _ => None,
    }
}

fn open(world: &Value, here: &str, route: &Value) -> Option<bool> {
    for required in route["requires"].as_array()? {
        if !gate(world, here, required)? {
            return Some(false);
        }
    }
    Some(true)
}

fn quiet_opening(world: &Value) -> Option<()> {
    if world["schema"] != 8
        || world["turn"] != 0
        || world["revision"] != 0
        || world["opening"]["crossed"] != false
        || world["actors"]["vale"]["place"] != "attic"
        || world["items"]["lamp"]["holder"] != "vale"
        || world["items"]["bell"]["ringing"] != 0
        || [
            "sharedVersion",
            "playerActorId",
            "controlledActors",
            "presentActors",
            "disabledPacks",
        ]
        .iter()
        .any(|key| world.get(*key).is_some())
        || used(world, WAYFINDER)
    {
        return None;
    }
    for state in world["packs"].as_object()?.values() {
        if state["sounds"]
            .as_object()?
            .values()
            .any(|until| until != 0)
        {
            return None;
        }
    }
    Some(())
}

fn hub_links<'a>(world: &Value, files: &'a Value) -> Option<Links<'a>> {
    let forest = files.get("v2/card-game/forest.json")?;
    let places = forest["places"].as_object()?;
    let mut links = Links::new();
    for (from, place) in places {
        let exits = place["exits"]
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<BTreeSet<_>>>()?;
        if exits.iter().any(|to| !places.contains_key(*to)) {
            return None;
        }
        links.insert(from.as_str(), exits);
    }
    if files["v2/card-game/world-life.json"]["guardable"]
        .as_array()?
        .iter()
        .any(|route| {
            ["from", "to"].iter().any(|end| {
                route[*end]
                    .as_str()
                    .is_some_and(|place| places.contains_key(place))
            })
        })
    {
        return None;
    }
    for route in forest["reflectionRoutes"].as_array()? {
        let from = route["from"].as_str()?;
        let to = route["to"].as_str()?;
        if !places.contains_key(to) {
            return None;
        }
        if open(world, from, route)? {
            links.get_mut(from)?.insert(to);
        }
    }
    if links.get("station")?.len() > 3 {
        return None;
    }
    Some(links)
}

fn reachable<'a>(links: &Links<'a>) -> Option<BTreeSet<&'a str>> {
    let mut seen = BTreeSet::from(["station"]);
    let mut queue = vec!["station"];
    let mut index = 0;
    while let Some(&place) = queue.get(index) {
        for &neighbor in links.get(place)? {
            if links.get(neighbor)?.contains(place) && seen.insert(neighbor) {
                queue.push(neighbor);
            }
        }
        index += 1;
    }
    Some(seen)
}

fn open_pack_route(world: &Value, here: &str, crossing: &Value) -> Option<bool> {
    if crossing.get("transport").is_some() {
        return Some(false);
    }
    if crossing["retired"] == true
        && world["crossings"][crossing["id"].as_str()?]["discovered"] != true
    {
        return Some(false);
    }
    if crossing["signal"].is_object() {
        let state = &world["crossings"][crossing["id"].as_str()?];
        if state["phase"] != 0
            || state["until"] != 0
            || crossing["signal"]["steps"].as_array()?.is_empty()
        {
            return None;
        }
        return Some(false);
    }
    open(world, here, crossing)
}

pub(super) fn place(
    world: &mut Value,
    files: &Value,
    catalog: &Catalog<'_>,
    seed: u32,
) -> Option<()> {
    quiet_opening(world)?;
    let links = hub_links(world, files)?;
    let landings = reachable(&links)?;
    let owner = catalog
        .packs()
        .find(|pack| pack["items"].get(WAYFINDER).is_some())?;
    let wayfinder = &owner["items"][WAYFINDER];
    let holder = world["items"][WAYFINDER]["holder"].as_str()?;
    if !links.contains_key(holder)
        || ["requires", "appearsWhen"]
            .iter()
            .any(|key| wayfinder.get(*key).is_some())
        || ["sections", "specials", "release"]
            .iter()
            .any(|key| owner.get(*key).is_some())
    {
        return None;
    }
    for pack in catalog.packs() {
        let id = pack["id"].as_str()?;
        world["packs"].get(id)?;
        for route in pack["routes"].as_array().into_iter().flatten() {
            if landings.contains(route["from"].as_str()?) {
                return None;
            }
        }
        for crossing in pack["crossings"].as_array()? {
            let from = crossing["from"].as_str()?;
            if landings.contains(from) && open_pack_route(world, from, crossing)? {
                return None;
            }
        }
    }
    let index = hash(&format!("{seed}:{WAYFINDER}:0")) as usize % landings.len();
    let holder = landings.into_iter().nth(index)?;
    world
        .get_mut("items")?
        .get_mut(WAYFINDER)?
        .as_object_mut()?
        .insert("holder".into(), json!(holder));
    Some(())
}
