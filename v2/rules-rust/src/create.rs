use super::pack_state::{self, Catalog};
use super::{
    create_geography::Geography, initial_wants::People, opening_candidates, opening_evidence,
    opening_history, opening_view, seed, validate, Lamp, LampPosition,
};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

type Edge<'a> = (&'a str, &'a str);

pub(super) fn mount(files: &Value) -> Option<Value> {
    let mut world = hub(files)?;
    pack_state::mount(&mut world, files)?;
    let catalog = Catalog::from_files(files)?;
    progress(&mut world, files, catalog.packs())?;
    let geography = Geography::new(files, catalog.packs())?;
    let people = People::new(files, catalog.packs())?;
    world["doors"] = seed::place_doors(files, 0, None)?;
    people.install(&mut world, &geography)?;
    seed::place_wayfinder(&mut world, files)?;
    opening_candidates::fill(&mut world, &geography, &people, files)?;
    Some(world)
}

fn hub(files: &Value) -> Option<Value> {
    let forest = files.get("v2/card-game/forest.json")?;
    let mut world = forest["initialState"].as_object()?.clone();
    let opening = forest["opening"].as_object()?;
    for field in ["actors", "items"] {
        let records = world.get_mut(field)?.as_object_mut()?;
        for (id, fields) in opening.get(field)?.as_object()? {
            records
                .get_mut(id)?
                .as_object_mut()?
                .extend(fields.as_object()?.clone());
        }
    }
    world.extend(
        json!({
            "schema": 8,
            "turn": 0,
            "revision": 0,
            "eventSeq": 1,
            "conversations": [],
            "opening": opening.get("discovery")?,
            "log": opening.get("log")?,
        })
        .as_object()?
        .clone(),
    );
    Some(Value::Object(world))
}

fn progress<'a>(
    world: &mut Value,
    files: &'a Value,
    packs: impl Iterator<Item = &'a Value> + Clone,
) -> Option<()> {
    let forest = files.get("v2/card-game/forest.json")?;
    let people = forest["people"].as_object()?;
    let cast = files["v2/card-game/shared-cast.json"]["avatars"].as_array()?;
    let mut grievances = Map::new();
    let mut lives = Map::new();
    let mut used_up = BTreeSet::new();
    let mut journeys = Map::new();
    for (id, person) in people {
        grievances.insert(id.clone(), json!([]));
        if person["travels"] != false {
            lives.insert(id.clone(), new_life());
        }
    }
    for pack in packs.clone() {
        let pack_id = pack["id"].as_str()?;
        for (id, person) in pack["avatars"].as_object()? {
            grievances.insert(id.clone(), json!([]));
            if person["personalQuests"] == true
                || person.get("roamingQuest").is_some()
                || cast.iter().any(|avatar| avatar["id"] == id.as_str())
            {
                lives.insert(id.clone(), new_life());
            }
            if let Some(journey) = person.get("journey") {
                let agreement = journey["after"].as_str()?;
                if world["packs"][pack_id]["receipts"].get(agreement).is_some() {
                    let step = journey["path"]
                        .as_array()?
                        .iter()
                        .position(|place| place == &world["actors"][id]["place"])?;
                    journeys.insert(id.clone(), json!({"agreement": agreement, "step": step}));
                }
            }
        }
        if let Some(items) = pack.get("items") {
            for (id, item) in items.as_object()? {
                if item["startsUsed"] == true
                    && world["items"][id]["holder"] == item["holder"]
                    && empty_history(&world["items"][id])
                {
                    used_up.insert(id);
                }
            }
        }
    }
    world["usedUp"] = json!(used_up);
    world["motives"] = json!({"version": 1, "grievances": grievances});
    world["life"] = json!({"version": 3, "actors": lives});
    world["journeyProgress"] = json!(journeys);
    world["routeKnowledge"] = initial_routes(world, forest, packs)?;
    Some(())
}

fn new_life() -> Value {
    json!({"experiences": [], "attachments": {}, "company": {}})
}

fn initial_routes<'a>(
    world: &Value,
    forest: &'a Value,
    packs: impl Iterator<Item = &'a Value> + Clone,
) -> Option<Value> {
    let edges = authored_edges(forest, packs.clone())?;
    let mut regions = BTreeMap::new();
    for pack in packs.clone() {
        let id = pack["id"].as_str()?;
        for place in pack["places"].as_object()?.keys() {
            regions.insert(place.as_str(), id);
        }
    }
    let mut knowledge = Map::new();
    for pack in packs {
        let region = pack["id"].as_str()?;
        for (actor, person) in pack["avatars"].as_object()? {
            if person["roamingQuest"] != "latest-completion" {
                continue;
            }
            let here = world["actors"][actor]["place"].as_str()?;
            let mut known: Vec<_> = edges
                .iter()
                .filter(|((from, _), retired)| {
                    !*retired && (*from == here || regions.get(from) == Some(&region))
                })
                .map(|(edge, _)| edge)
                .collect();
            known.sort_by_cached_key(|(from, to)| format!("{from}>{to}"));
            knowledge.insert(actor.clone(), json!(known));
        }
    }
    Some(Value::Object(knowledge))
}

pub(super) fn authored_edges<'a>(
    forest: &'a Value,
    packs: impl Iterator<Item = &'a Value> + Clone,
) -> Option<BTreeMap<Edge<'a>, bool>> {
    let mut edges = BTreeMap::new();
    let mut transports = BTreeMap::new();
    for pack in packs.clone() {
        if let Some(entries) = pack.get("transports") {
            for (id, transport) in entries.as_object()? {
                transports.insert(id.as_str(), transport["place"].as_str()?);
            }
        }
    }
    for region in std::iter::once(forest).chain(packs.clone()) {
        for (from, place) in region["places"].as_object()? {
            for to in place["exits"].as_array()? {
                edges.entry((from.as_str(), to.as_str()?)).or_insert(false);
            }
        }
        for field in ["reflectionRoutes", "routes"] {
            if let Some(routes) = region.get(field) {
                for route in routes.as_array()? {
                    edges.entry(edge(route)?).or_insert(false);
                }
            }
        }
        if let Some(crossings) = region.get("crossings") {
            for crossing in crossings.as_array()? {
                let (from, to) = edge(crossing)?;
                if let Some(transport) = crossing.get("transport") {
                    let ship = *transports.get(transport.as_str()?)?;
                    for edge in [(from, ship), (ship, from)] {
                        edges.entry(edge).or_insert(false);
                    }
                } else {
                    *edges.entry((from, to)).or_default() |= crossing["retired"] == true;
                }
            }
        }
    }
    Some(edges)
}

fn edge(route: &Value) -> Option<Edge<'_>> {
    Some((route["from"].as_str()?, route["to"].as_str()?))
}

fn empty_history(item: &Value) -> bool {
    item["history"].as_array().is_some_and(Vec::is_empty)
}

fn begin_shared(world: &mut Value, files: &Value) -> Option<()> {
    for avatar in files["v2/card-game/shared-cast.json"]["avatars"].as_array()? {
        let id = avatar["id"].as_str()?;
        if id == "vale" {
            continue;
        }
        let home = avatar["home"]["id"].as_str()?;
        let at_home = world["actors"][id]["place"] == home;
        let item = world["items"].get_mut(avatar["item"]["id"].as_str()?)?;
        if at_home && item["holder"] == id && empty_history(item) {
            item["holder"] = json!(home);
        }
    }
    world["sharedVersion"] = json!(1);
    world["playerActorId"] = json!("vale");
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!(["vale"]);
    }
    Some(())
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    if !request["save"].is_null() {
        return validate::import_refusal(request);
    }
    if !request["seed"].is_null()
        || !request["hidden"].is_null()
        || !request["homecoming"].is_null()
        || !(request["absent"].is_null() || request["absent"] == json!([]))
        || !matches!(request["actor"].as_str(), None | Some("vale" | ""))
    {
        return None;
    }
    if !request["actor"].is_null() && !request["actor"].is_string() {
        return None;
    }
    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let files = content.get("files")?;
    let world = fresh(files, None, request["history"] == true)?;
    opening_view::create_response(world, files, "vale")
}

pub(super) fn fresh(files: &Value, seed: Option<u32>, history: bool) -> Option<Value> {
    if seed.is_some() {
        return None;
    }
    let mut world = mount(files)?;
    let catalog = Catalog::from_files(files)?;
    let geo = Geography::new(files, catalog.packs())?;
    let people = People::new(files, catalog.packs())?;
    opening_evidence::install(&mut world, files)?;
    settle_guards(&mut world, &geo, &people)?;
    settle_hands_and_lamp(&mut world, &geo)?;
    settle_station(&mut world, files, &geo)?;
    if history {
        opening_history::begin(&mut world, files)?;
    }
    begin_shared(&mut world, files)?;
    opening_candidates::fill(&mut world, &geo, &people, files)?;
    settle_hands_and_lamp(&mut world, &geo)?;
    settle_station(&mut world, files, &geo)?;
    Some(world)
}

fn settle_guards(world: &mut Value, geo: &Geography, people: &People) -> Option<()> {
    for (id, life) in people.life["residents"].as_object()? {
        if let Some(guarding) = life["guards"].as_str() {
            let person = people.people.get(id.as_str())?;
            let home = person.data["home"]
                .as_str()
                .or_else(|| person.data["place"].as_str())?;
            if world["actors"][id]["place"] == home
                && geo.entity_active(world, id)?
                && !geo.pack_route_open(world, home, guarding)?
            {
                world["actors"][id]["guarding"] = json!(guarding);
            }
        }
    }
    Some(())
}

fn settle_hands_and_lamp(world: &mut Value, geo: &Geography) -> Option<()> {
    let mut hands = BTreeMap::<String, Vec<String>>::new();
    for (id, item) in world["items"].as_object()? {
        let holder = item["holder"].as_str()?;
        if world["actors"].get(holder).is_some() && geo.entity_enabled(world, id)? {
            hands.entry(holder.into()).or_default().push(id.clone());
        }
    }
    for (id, actor) in world["actors"].as_object_mut()? {
        if actor.get("heldItem") == Some(&Value::Null) {
            continue;
        }
        let saved = actor["heldItem"].as_str();
        let options = hands.get(id);
        if !options.is_some_and(|items| items.iter().any(|id| Some(id.as_str()) == saved)) {
            actor["heldItem"] = json!(options.and_then(|items| items.first()));
        }
    }
    let owner = world["items"]["lamp"]["holder"].as_str()?;
    let place = world["actors"][owner]["place"].as_str()?;
    let position = LampPosition {
        place: place.into(),
        held: world["actors"][owner]["heldItem"] == "lamp",
        grounded: false,
    };
    let lamp = if world["items"]["lamp"].get("fuelRooms").is_some() {
        super::lamp_state(&world["items"]["lamp"]).ok()?
    } else {
        let fuel = u8::try_from(world["items"]["lamp"]["fuel"].as_u64()?).ok()?;
        if fuel > 12 {
            return None;
        }
        Lamp {
            fuel_rooms: fuel.div_ceil(4),
            fuel_place: place.into(),
            fuel_visit: true,
            lit: false,
        }
    };
    lamp.settle(position).write(&mut world["items"]["lamp"]);
    Some(())
}

fn settle_station(world: &mut Value, files: &Value, geo: &Geography) -> Option<()> {
    let station = "station";
    let forest = &files["v2/card-game/forest.json"];
    if forest["reflectionRoutes"]
        .as_array()?
        .iter()
        .any(|route| route["from"] == station)
    {
        return None;
    }
    let mut extra = Vec::new();
    let base = geo.base_exits(station)?;
    for pack in geo.packs() {
        let pack_id = pack["id"].as_str()?;
        for crossing in pack["crossings"]
            .as_array()?
            .iter()
            .filter(|c| c["from"] == station)
        {
            if crossing["retired"] == true
                || (crossing["travelers"] == "player"
                    && world["actors"]["vale"]["place"] != station)
            {
                continue;
            }
            if crossing.get("signal").is_some()
                || crossing.get("transport").is_some()
                || crossing.get("unlockWhen").is_some()
            {
                return None;
            }
            let to = crossing["to"].as_str()?;
            if !base.contains(&crossing["to"])
                && geo.entity_active(world, to)?
                && geo.conditions_met(world, pack_id, &crossing["requires"], Some("vale"))?
            {
                extra.push(to);
            }
        }
        for route in pack["routes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|r| r["from"] == station)
        {
            let to = route["to"].as_str()?;
            if !base.contains(&route["to"])
                && geo.entity_active(world, to)?
                && geo.route_open(world, pack_id, route)?
            {
                extra.push(to);
            }
        }
    }
    if !extra.is_empty() {
        return None;
    }
    world["stationExitOrder"] = json!([]);
    Some(())
}
