use super::{
    authored_order::Order, initial_wants::root_in, lamp_state, opening, opening_content,
    opening_pickups::item_as_named, opening_pond_view::offer, opening_roster::known_actors,
    opening_station_move, opening_view, opening_visitor_routes, pack_state::Catalog, profiles,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const STATION: &str = "station";
const POND: &str = "pond";
const EXITS: [&str; 2] = [POND, "behind-station"];
const LAMP: &str = "lamp";
const WAYFINDER: &str = "elysium-wayfinder";
const BEANIE: &str = "ratiradio-red-beanie";
const ITEMS: [(&str, &str); 5] = [
    (LAMP, VALE),
    ("oil", KEEPER),
    ("bell", STATION),
    ("cloth", PIP),
    ("keeper-log", STATION),
];

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn records(value: &Value) -> impl Iterator<Item = &Value> {
    value
        .as_object()
        .into_iter()
        .flat_map(serde_json::Map::values)
}

fn is_move(event: &Value, actor: &str, from: &str, to: &str) -> bool {
    event["kind"] == "action"
        && event["generated"] != true
        && event["verb"] == "move"
        && event["actorId"] == actor
        && event["fromLocationId"] == from
        && event["locationId"] == to
        && event["targetId"] == to
}

fn chronology(world: &Value) -> Option<u64> {
    let seq = opening_station_move::arrival(world)?;
    (world["arrival"] == json!({"seq":seq,"fromLocationId":POND,"locationId":STATION}))
        .then_some(seq)
}

fn station_paths(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let files = geo.files();
    let forest = &files["v2/card-game/forest.json"];
    let speech = &files["v2/card-game/speech.json"];
    let life = &files["v2/card-game/world-life.json"];
    if forest["places"][STATION]["exits"] != json!(EXITS)
        || entries(&forest["reflectionRoutes"]).any(|route| route["from"] == STATION)
        || entries(&life["guardable"]).any(|way| way["from"] == STATION || way["to"] == STATION)
        || speech["action"] != json!(["actor"])
        || speech["first_meeting"] != json!(["newcomer"])
        || [PIP, KEEPER].iter().any(|id| {
            let resident = &forest["people"][*id];
            resident["travels"] == false
                || resident["keepsForGood"] == true
                || !life["residents"][*id]["guards"].is_null()
        })
    {
        return None;
    }
    let mut train = false;
    for pack in geo.packs() {
        if pack["places"].get(STATION).is_some()
            || [VALE, PIP, KEEPER]
                .iter()
                .any(|id| pack["avatars"].get(*id).is_some())
            || ITEMS.iter().any(|(id, _)| pack["items"].get(*id).is_some())
            || entries(&pack["routes"]).any(|route| route["from"] == STATION)
            || entries(&pack["choices"]).any(|choice| {
                choice["at"] == STATION
                    || (choice["on"] == "give"
                        && (choice["subject"] == PIP || choice["subject"] == KEEPER))
            })
            || ["fixtures", "transports"].iter().any(|key| {
                records(&pack[*key]).any(|entry| {
                    entry["at"] == STATION
                        || entry["place"] == STATION
                        || entries(&entry["docks"]).any(|dock| dock == STATION)
                })
            })
            || records(&pack["items"]).any(|item| {
                (item["holder"] == STATION && item["sealed"].is_object())
                    || (item["home"] == STATION && item["locked"].is_object())
            })
        {
            return None;
        }
        for crossing in entries(&pack["crossings"]).filter(|crossing| crossing["from"] == STATION) {
            let to = crossing["to"].as_str()?;
            let conditions = &crossing["requires"];
            if pack["id"] == "shared-homes"
                && world["doors"][to]
                    .as_str()
                    .is_some_and(|place| place != STATION)
                && entries(conditions)
                    .any(|cond| *cond == json!({"kind":"home_door","home":to,"place":STATION}))
            {
                continue;
            }
            if train
                || pack["id"] != "shared-homes"
                || to != "train"
                || crossing["sealed"] != json!({})
                || *conditions
                    != json!([
                        {"kind":"shared_world"},
                        {"kind":"home_door","home":"train","place":STATION},
                        {"kind":"item_near","item":"routes","place":STATION}
                    ])
                || geo.crossing_conditions(world, "shared-homes", conditions, Some(VALE))?
            {
                return None;
            }
            train = true;
        }
    }
    let open = opening_visitor_routes::exits(world, geo, VALE, STATION)?;
    (train && open.len() == 2 && EXITS.iter().all(|exit| open.contains(exit))).then_some(())
}

fn station_scene<'a>(
    world: &Value,
    geo: &Geography<'_>,
    actor_order: &[&'a str],
) -> Option<Vec<&'a str>> {
    let turn = world["turn"].as_u64()?;
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    let lamp = &world["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world.get("began").is_some()
        || !(turn..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["opening"]["crossed"] != true
        || world["opening"]["met"][KEEPER] != turn
        || world["opening"]["met"][PIP] != turn.checked_sub(1)?
        || !world["disabledPacks"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["pondLampLoan"].is_null()
        || !world["defeats"][VALE].is_null()
        || !world["placeMet"][STATION].is_null()
        || world["doors"]["train"] != STATION
        || ["usedUp", "gone"]
            .iter()
            .any(|key| entries(&world[*key]).any(|id| id == WAYFINDER || id == "routes"))
        || vale["waitSpeech"] != json!({"place":STATION,"turn":null})
        || ["want", "closed", "arcana"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || lamp["lit"] != false
        || fuel.fuel_place != STATION
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0))
    {
        return None;
    }
    for id in [VALE, PIP, KEEPER] {
        let actor = actors.get(id)?;
        if actor["place"] != STATION
            || !actor["sleeping"].is_null()
            || !actor["under"].is_null()
            || !actor["talked"].as_array()?.is_empty()
            || world["peaceUntil"][id].as_u64()? > turn
        {
            return None;
        }
    }
    let known = known_actors(world, geo, actor_order, Some(STATION))?;
    if known.len() != 3 || [VALE, PIP, KEEPER].iter().any(|id| !known.contains(id)) {
        return None;
    }
    let items = world["items"].as_object()?;
    for (id, holder) in ITEMS {
        if items.get(id)?["holder"] != holder || !geo.entity_active(world, id)? {
            return None;
        }
    }
    for (id, item) in items {
        if [STATION, VALE, PIP, KEEPER].contains(&root_in(items, id)?)
            && !ITEMS.iter().any(|(allowed, _)| id == allowed)
            && !(item["holder"] == STATION && [WAYFINDER, BEANIE].contains(&id.as_str()))
        {
            return None;
        }
    }
    let wayfinder_here = items.get(WAYFINDER)?["holder"] == STATION;
    let place_card = &world["placeCard"][STATION];
    if (wayfinder_here && !place_card.is_null()) || (!wayfinder_here && place_card != WAYFINDER) {
        return None;
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    if forest["things"]["keeper-log"]["lifecycle"] != "fixed"
        || entries(&forest["things"]["keeper-log"]["claims"])
            .next()
            .is_none()
    {
        return None;
    }
    Some(known.into_iter().filter(|id| *id != VALE).collect())
}

fn actions(
    world: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    profiles: &Value,
    company: &[&str],
) -> Option<Vec<Value>> {
    let name = |id: &str| profiles[id]["name"].as_str();
    let vale = name(VALE)?;
    let lamp = item_as_named(name(LAMP)?);
    let station = name(STATION)?;
    let wait = format!("{vale} waits one turn.");
    let mut out = vec![offer("wait", None, None, wait, &[])];
    for to in EXITS {
        let destination = name(to)?;
        for &other in company {
            let text = format!(
                "{vale} asks {} to accompany them to {destination}.",
                name(other)?
            );
            let mut card = offer("accompany", None, Some(other), text, &[other, to]);
            card["destination"] = json!(to);
            card["key"] = json!(format!("accompany:{VALE}::{other}:{to}"));
            out.push(card);
        }
        let go = format!("{vale} goes to {destination}.");
        out.push(offer("move", None, Some(to), go, &[to]));
        let carry = format!("{vale} carries {lamp} to {destination}.");
        out.push(offer("move", Some(LAMP), Some(to), carry, &[LAMP, to]));
    }
    for &other in company {
        let resident = name(other)?;
        let stake = if other == PIP { "cloth" } else { "oil" };
        let thing = item_as_named(name(stake)?);
        let threat = format!("{vale} threatens {resident} over {thing}.");
        out.push(offer(
            "threaten",
            Some(stake),
            Some(other),
            threat,
            &[other],
        ));
        let talk = format!("{vale} has a conversation with {resident}.");
        out.push(offer("talk", None, Some(other), talk, &[other]));
    }
    let mut trades = Vec::new();
    for id in authored.items.iter().map(String::as_str) {
        let holder = world["items"][id]["holder"].as_str()?;
        match (id, holder) {
            (LAMP, VALE) => {
                let drop = format!("{vale} puts {lamp} in {station}.");
                out.push(offer("drop", Some(LAMP), Some(STATION), drop, &[LAMP]));
                for &other in company {
                    out.push(offer(
                        "give",
                        Some(LAMP),
                        Some(other),
                        format!("{vale} gives {lamp} to {}.", name(other)?),
                        &[LAMP, other],
                    ));
                }
            }
            ("bell" | WAYFINDER | BEANIE, STATION) if geo.entity_active(world, id)? => {
                let take = format!("{vale} takes {}.", item_as_named(name(id)?));
                out.push(offer("take", Some(id), None, take, &[id]));
                if id == "bell" {
                    let ring =
                        format!("{vale} rings the Bell. The sound carries across the shore.");
                    out.push(offer("ring", Some(id), None, ring, &[id]));
                }
            }
            ("oil" | "cloth", KEEPER | PIP) => {
                let resident = name(holder)?;
                let item = name(id)?;
                out.push(offer(
                    "ask",
                    Some(id),
                    Some(holder),
                    format!("{vale} asks {resident} for {}.", item_as_named(item)),
                    &[id, holder],
                ));
                let mut trade = offer(
                    "trade",
                    Some(LAMP),
                    Some(holder),
                    format!("{vale} trades {lamp} for {resident}’s {item}."),
                    &[LAMP, id],
                );
                trade["receive"] = json!(id);
                trade["key"] = json!(format!("trade:{VALE}:{LAMP}:{holder}:{id}"));
                trades.push(trade);
            }
            ("keeper-log", STATION) => {
                let text = format!("{vale} reads {}.", item_as_named(name(id)?));
                let mut read = offer("read", Some(id), None, text, &[id]);
                read["label"] = json!("Read");
                out.push(read);
            }
            _ => {}
        }
    }
    out.extend(trades);
    let text = format!("{vale} accepts the closed box's quest.");
    let mut train = offer("accept", None, None, text, &[]);
    train["box"] = json!("train");
    train["key"] = json!("accept:vale::box:train");
    out.push(train);
    if world["placeCard"][STATION] == WAYFINDER {
        let text = format!("{vale} accepts {station}'s quest.");
        let mut place = offer("accept", None, None, text, &[]);
        place["place"] = json!(STATION);
        place["key"] = json!("accept:vale::place:station");
        out.push(place);
    }
    Some(out)
}

fn station_projection(
    world: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    actor_order: &[&str],
) -> Option<(Vec<Value>, Value)> {
    let company = station_scene(world, geo, actor_order)?;
    station_paths(world, geo)?;
    let profiles = profiles::project(geo.files())?;
    Some((
        actions(world, geo, authored, &profiles, &company)?,
        profiles,
    ))
}

fn generated_station_line(event: &Value) -> bool {
    let voice = &event["actorId"];
    event["locationId"] == STATION
        && event.get("elysiumName").is_none()
        && match event["kind"].as_str() {
            Some("dialogue") => (voice == VALE || voice == KEEPER) && event["entityId"] == *voice,
            Some("narration") => voice.is_null() && event["entityId"] == STATION,
            _ => false,
        }
}

fn arrival_events(world: &Value, before_seq: u64, allow_speech: bool) -> Option<Vec<&Value>> {
    let events: Vec<_> = entries(&world["log"])
        .filter(|entry| entry["seq"].as_u64().is_some_and(|seq| seq > before_seq))
        .collect();
    let follows = events.get(1)?;
    let mut speech_started = false;
    if !is_move(follows, PIP, POND, STATION)
        || !follows["itemId"].is_null()
        || events.last()?["seq"] != world["eventSeq"]
        || events.iter().enumerate().any(|(index, event)| {
            if event["seq"].as_u64() != before_seq.checked_add(index as u64 + 1)
                || event["turn"] != world["turn"]
            {
                return true;
            }
            if event["generated"] == true {
                speech_started = true;
                !allow_speech || !generated_station_line(event)
            } else {
                speech_started
                    || (index > 1
                        && (event["locationId"] == STATION || event["fromLocationId"] == STATION))
            }
        })
    {
        return None;
    }
    Some(events)
}

pub(super) fn settled_first_arrival(
    world: &Value,
    geo: &Geography<'_>,
    order: &[&str],
) -> Option<()> {
    if world["turn"] != 2 {
        return None;
    }
    arrival_events(world, chronology(world)?.checked_sub(1)?, true)?;
    station_scene(world, geo, order)?;
    station_paths(world, geo)
}

pub fn completed_station_response(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    actor_order: &[&str],
    present: &[&str],
) -> Option<Value> {
    if present != [VALE] || chronology(&world)? != before_seq.checked_add(1)? {
        return None;
    }
    let (plans, profiles) = station_projection(&world, geo, authored, actor_order)?;
    let events = arrival_events(&world, before_seq, false)?
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    world
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(VALE.into(), json!([VALE, KEEPER]));
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = json!(events);
    Some(response)
}

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    let world = request.get("world")?;
    if request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || world["speechVoices"][VALE] != json!([VALE, KEEPER])
    {
        return None;
    }
    arrival_events(
        world,
        chronology(world)?.checked_sub(1)?,
        world["turn"] == 2,
    )?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let actor_order = super::opening_roster::actor_order(request, world)?;
    let (plans, profiles) = station_projection(world, &geo, &authored, &actor_order)?;
    let projected = opening_view::private_world(world, request)?;
    Some(station_response(
        json!({"ok":true,"world":projected}),
        plans,
        profiles,
    ))
}

fn station_response(mut response: Value, plans: Vec<Value>, profiles: Value) -> Value {
    response["actor"] = json!(VALE);
    response["room"] = json!(STATION);
    response["exits"] = json!(EXITS);
    response["actions"] = json!(plans);
    response["profiles"] = profiles;
    response
}

#[cfg(test)]
#[path = "opening_station_view_test.rs"]
mod tests;
