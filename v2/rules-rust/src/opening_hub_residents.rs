use super::{create_geography::Geography, opening, opening_content, pack_state::Catalog};
use serde_json::{json, Map, Value};

const ATTIC: &str = "attic";
const MOTH: &str = "moth";
const KEEPER: &str = "keeper";
const HUB: [(&str, &str, &str); 2] = [
    (MOTH, "cloth", "wait:moth::"),
    (KEEPER, "oil", "wait:keeper::"),
];

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn empty_record(value: &Value) -> bool {
    value.is_null() || value.as_object().is_some_and(Map::is_empty)
}

fn at_home(world: &Value, geo: &Geography, id: &str, held: &str) -> Option<()> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    let definition = forest["people"].get(id)?;
    let home = definition["home"].as_str()?;
    let resident = world["actors"].get(id)?;
    let mut wanted = definition["want"].as_object()?.clone();
    wanted.insert("since".into(), json!(0));
    wanted.insert("refusals".into(), json!(0));
    if resident["place"] != home
        || resident["want"] != Value::Object(wanted)
        || resident["heldItem"] != held
        || resident.get("sleeping").is_some()
        || resident["dwellUntil"]
            .as_u64()
            .is_some_and(|until| until >= 1)
        || world["routeKnowledge"].get(id).is_some()
        || !entries(&resident["visited"]).any(|place| place == home)
        || forest["places"][home]["sanctuary"] == true
        || world["peaceUntil"][id] != 0
        || world["items"][held]["holder"] != id
        || world["items"]
            .as_object()?
            .iter()
            .any(|(item, state)| state["holder"] == id && item != held)
        || !["claims", "records", "teachesQuest"]
            .iter()
            .all(|key| forest["things"][held][*key].is_null())
        || !world["memories"][id]["learning"].is_null()
        || !geo.entity_active(world, id)?
        || !geo.entity_active(world, held)?
    {
        return None;
    }
    Some(())
}

fn attic_unreachable(world: &Value, geo: &Geography) -> Option<()> {
    let files = geo.files();
    let forest = &files["v2/card-game/forest.json"];
    for route in entries(&forest["reflectionRoutes"]).filter(|route| route["to"] == ATTIC) {
        let conditions = route["requires"].as_array()?;
        if conditions
            .iter()
            .any(|condition| condition["kind"] != "light" || condition["item"] != "lamp")
            || geo.reflection_open(world, route)?
        {
            return None;
        }
    }
    if entries(&files["v2/card-game/world-life.json"]["guardable"])
        .any(|way| way["from"] == ATTIC || way["to"] == ATTIC)
    {
        return None;
    }
    for region in std::iter::once(forest).chain(geo.packs()) {
        if region["places"]
            .as_object()?
            .values()
            .any(|place| entries(&place["exits"]).any(|exit| exit == ATTIC))
            || entries(&region["routes"]).any(|route| route["to"] == ATTIC)
            || entries(&region["crossings"]).any(|crossing| {
                crossing["to"] == ATTIC
                    && (crossing["travelers"] != "player" || crossing.get("transport").is_some())
            })
            || region["transports"]
                .as_object()
                .into_iter()
                .flatten()
                .any(|(_, ship)| {
                    ship["place"] == ATTIC || entries(&ship["docks"]).any(|dock| dock == ATTIC)
                })
            || region["avatars"].get(MOTH).is_some()
            || region["avatars"].get(KEEPER).is_some()
            || ["lamp", "cloth", "oil", "bell"]
                .iter()
                .any(|item| region["items"].get(item).is_some())
        {
            return None;
        }
    }
    Some(())
}

fn solo(value: &Value) -> bool {
    value.is_null() || *value == json!(["vale"])
}

pub(super) fn confirm_idle(world: &Value, geo: &Geography) -> Option<()> {
    idle_plans(world, geo).map(|_| ())
}

fn idle_plans(world: &Value, geo: &Geography) -> Option<[Option<&'static str>; 2]> {
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    if world["turn"].as_u64()? != began.checked_add(1)?
        || world["sharedVersion"] != 1
        || world["opening"]["crossed"] != false
        || !world["standoffs"].as_array()?.is_empty()
        || !empty_record(&world["defeats"])
        || !world["disabledPacks"].is_null()
        || !(world["playerActorId"].is_null() || world["playerActorId"] == "vale")
        || !["heldActors", "presentActors", "controlledActors"]
            .iter()
            .all(|field| solo(&world[*field]))
        || world["actors"]["vale"]["place"] != ATTIC
        || !matches!(
            world["items"]["lamp"]["holder"].as_str(),
            Some("vale" | "attic")
        )
        || world["items"]["bell"]["holder"] != "station"
        || world["items"]["bell"]["ringing"] != 0
        || world["actors"][MOTH]["place"] != "pond"
        || world["actors"][KEEPER]["place"] != "station"
        || world["actors"][MOTH]["want"]["kind"] != "item"
        || world["actors"][MOTH]["want"]["target"] != "lamp"
        || !world["actors"][MOTH]["want"]["step"].is_null()
        || world["actors"][KEEPER]["want"]["kind"] != "place"
        || world["actors"][KEEPER]["want"]["step"]["verb"] != "call"
        || !geo.entity_active(world, "lamp")?
        || geo.entity_active(world, "boardyai")?
        || geo.entity_active(world, "boardyai-calling-card")?
    {
        return None;
    }
    let mut plans = [None, None];
    for (slot, (resident, held, wait)) in plans.iter_mut().zip(HUB) {
        if let Some(until) = world["actors"][resident]["sleeping"].get("until") {
            until.as_u64()?;
        } else {
            at_home(world, geo, resident, held)?;
            *slot = Some(wait);
        }
    }
    attic_unreachable(world, geo)?;
    Some(plans)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let world = opening::supported_world(request)?;
    if request["actor"] != "vale"
        || request["claimed"] != json!(["vale"])
        || request["present"] != json!(["vale"])
    {
        return None;
    }
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut next = world.clone();
    let turn = opening::unplayed_turn(world)?.checked_add(1)?;
    if turn > opening::MAX_REVISION {
        return None;
    }
    next["turn"] = json!(turn);
    let plans = idle_plans(&next, &geo)?;
    let actors: Map<_, _> = HUB
        .iter()
        .map(|(id, _, _)| ((*id).into(), world["actors"][*id].clone()))
        .collect();
    let memories: Map<_, _> = HUB
        .iter()
        .map(|(id, _, _)| ((*id).into(), world["memories"][*id].clone()))
        .collect();
    Some(json!({
        "ok":true,
        "plans":plans,
        "actors":actors, "memories":memories, "events":[],
    }))
}
