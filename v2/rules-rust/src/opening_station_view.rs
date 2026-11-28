use super::{
    authored_order::Order,
    initial_wants::root_in,
    lamp_state, opening, opening_content,
    opening_pickups::item_as_named,
    opening_pond_view::offer,
    opening_roster::known_actors,
    opening_station_move::{self, rue_arrived},
    opening_view, opening_visitor_routes,
    pack_state::Catalog,
    profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const RUE: &str = "rue";
const STATION: &str = "station";
const POND: &str = "pond";
const ROUTES: &str = "routes";
pub(super) const ACCEPT_TRAIN: &str = "accept:vale::box:train";
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

fn rue_meeting(world: &Value) -> Option<()> {
    let rue = &world["actors"][RUE];
    if rue["crossed"] != 1
        || rue["visited"] != json!(["train", STATION])
        || rue.get("heldItem") != Some(&Value::Null)
        || rue["want"]["kind"] != "person"
        || !matches!(rue["want"]["target"].as_str(), Some(VALE | PIP))
        || rue["want"]["since"] != 0
        || rue["want"]["refusals"] != 0
        || world["items"]["routes"]["holder"] != "train"
    {
        return None;
    }
    Some(())
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
    let rue = rue_arrived(world);
    let mut train = false;
    for pack in geo.packs() {
        if pack["places"].get(STATION).is_some()
            || [VALE, PIP, KEEPER]
                .iter()
                .any(|id| pack["avatars"].get(*id).is_some())
            || (rue && pack["id"] != "shared-homes" && pack["avatars"].get(RUE).is_some())
            || ITEMS.iter().any(|(id, _)| pack["items"].get(*id).is_some())
            || entries(&pack["routes"]).any(|route| route["from"] == STATION)
            || entries(&pack["choices"]).any(|choice| {
                choice["at"] == STATION
                    || (choice["on"] == "give"
                        && (choice["subject"] == PIP
                            || choice["subject"] == KEEPER
                            || (rue && choice["subject"] == RUE)))
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
    train_accepted: bool,
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
        || ["closed", "arcana"].iter().any(|key| !vale[*key].is_null())
        || lamp["lit"] != false
        || fuel.fuel_place != STATION
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0))
    {
        return None;
    }
    if train_accepted {
        if rue_arrived(world)
            || vale["want"] != train_want(turn)
            || vale.get("content").is_some()
            || world["items"].get(ROUTES).is_none()
        {
            return None;
        }
    } else if !vale["want"].is_null() {
        return None;
    }
    let mut cast = vec![VALE, PIP, KEEPER];
    if rue_arrived(world) {
        rue_meeting(world)?;
        cast.push(RUE);
    }
    for id in &cast {
        let actor = actors.get(*id)?;
        if actor["place"] != STATION
            || !actor["sleeping"].is_null()
            || !actor["under"].is_null()
            || !actor["talked"].as_array()?.is_empty()
            || world["peaceUntil"][*id].as_u64()? > turn
        {
            return None;
        }
    }
    let known = known_actors(world, geo, actor_order, Some(STATION))?;
    if known.len() != cast.len() || cast.iter().any(|id| !known.contains(id)) {
        return None;
    }
    let items = world["items"].as_object()?;
    for (id, holder) in ITEMS {
        if items.get(id)?["holder"] != holder || !geo.entity_active(world, id)? {
            return None;
        }
    }
    for (id, item) in items {
        let holder = root_in(items, id)?;
        if (holder == RUE && cast.contains(&RUE))
            || ((holder == STATION || cast.contains(&holder))
                && !ITEMS.iter().any(|(allowed, _)| id == allowed)
                && !(item["holder"] == STATION && [WAYFINDER, BEANIE].contains(&id.as_str())))
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
    train_accepted: bool,
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
        let stake = match other {
            PIP => Some("cloth"),
            KEEPER => Some("oil"),
            RUE => None,
            _ => return None,
        };
        let threat = if let Some(id) = stake {
            format!(
                "{vale} threatens {resident} over {}.",
                item_as_named(name(id)?)
            )
        } else {
            format!("{vale} threatens {resident}.")
        };
        out.push(offer("threaten", stake, Some(other), threat, &[other]));
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
    if !train_accepted {
        let text = format!("{vale} accepts the closed box's quest.");
        let mut train = offer("accept", None, None, text, &[]);
        train["box"] = json!("train");
        train["key"] = json!(ACCEPT_TRAIN);
        out.push(train);
    }
    if world["placeCard"][STATION] == WAYFINDER {
        let text = format!("{vale} accepts {station}'s quest.");
        let mut place = offer("accept", None, None, text, &[]);
        place["place"] = json!(STATION);
        place["key"] = json!("accept:vale::place:station");
        out.push(place);
    }
    if train_accepted {
        let board = name(ROUTES)?;
        let text = format!("{vale} abandons their quest to bring {board} to {station}.");
        let mut abandon = offer("drop", None, None, text, &[]);
        abandon["quest"] = json!(0);
        abandon["key"] = json!("drop:vale:::0");
        out.push(abandon);
    }
    Some(out)
}

fn station_projection(
    world: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    actor_order: &[&str],
    train_accepted: bool,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<(Vec<Value>, Value)> {
    let company = station_scene(world, geo, actor_order, train_accepted)?;
    station_paths(world, geo)?;
    let profiles = profile_source()?;
    Some((
        actions(world, geo, authored, &profiles, &company, train_accepted)?,
        profiles,
    ))
}

fn voices(world: &Value) -> &'static [&'static str] {
    if rue_arrived(world) {
        &[VALE, KEEPER, RUE]
    } else {
        &[VALE, KEEPER]
    }
}

fn generated_station_line(event: &Value, voices: &[&str]) -> bool {
    let voice = &event["actorId"];
    event["generated"] == true
        && event["locationId"] == STATION
        && event.get("elysiumName").is_none()
        && match event["kind"].as_str() {
            Some("dialogue") => {
                event["entityId"] == *voice && voice.as_str().is_some_and(|id| voices.contains(&id))
            }
            Some("narration") => voice.is_null() && event["entityId"] == STATION,
            _ => false,
        }
}

fn arrival_events(world: &Value, before_seq: u64, allow_speech: bool) -> Option<Vec<&Value>> {
    let events: Vec<_> = entries(&world["log"])
        .filter(|entry| entry["seq"].as_u64().is_some_and(|seq| seq > before_seq))
        .collect();
    let first_line = events
        .iter()
        .position(|event| event["generated"] == true)
        .unwrap_or(events.len());
    let (committed, lines) = events.split_at(first_line);
    let follows = committed.get(1)?;
    if !is_move(follows, PIP, POND, STATION)
        || !follows["itemId"].is_null()
        || events.last()?["seq"] != world["eventSeq"]
        || (!lines.is_empty()
            && (!allow_speech
                || !lines
                    .iter()
                    .all(|event| generated_station_line(event, voices(world)))))
        || events.iter().enumerate().any(|(index, event)| {
            event["seq"].as_u64() != before_seq.checked_add(index as u64 + 1)
                || event["turn"] != world["turn"]
        })
    {
        return None;
    }
    let mut local = committed
        .iter()
        .skip(2)
        .filter(|event| event["locationId"] == STATION || event["fromLocationId"] == STATION);
    if rue_arrived(world) {
        let enters = local.next()?;
        let cast = enters["cast"].as_array()?;
        if !is_move(enters, RUE, "train", STATION)
            || !enters["itemId"].is_null()
            || cast.len() != 4
            || ![VALE, PIP, KEEPER, RUE]
                .iter()
                .all(|id| cast.iter().any(|actor| actor == *id))
        {
            return None;
        }
    }
    if local.next().is_some() {
        return None;
    }
    Some(events)
}

pub(super) fn settled_first_arrival(
    world: &Value,
    geo: &Geography<'_>,
    order: &[&str],
) -> Option<()> {
    (settled_speech_voices(world, geo, order)? == [VALE, KEEPER]).then_some(())
}

pub(super) fn settled_speech_voices(
    world: &Value,
    geo: &Geography<'_>,
    order: &[&str],
) -> Option<&'static [&'static str]> {
    if world["turn"] != 2 {
        return None;
    }
    let events = arrival_events(world, chronology(world)?.checked_sub(1)?, true)?;
    let named = voices(world);
    if named.contains(&RUE)
        && !events.iter().any(|entry| {
            is_move(entry, RUE, "train", STATION)
                && entry["witnesses"] == json!([RUE, "routes"])
                && entry["light"] == false
        })
    {
        return None;
    }
    station_scene(world, geo, order, false)?;
    station_paths(world, geo)?;
    Some(named)
}

pub fn completed_station_response(
    world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    actor_order: &[&str],
    present: &[&str],
) -> Option<Value> {
    completed_station_response_with_profiles(
        world,
        geo,
        authored,
        before_seq,
        actor_order,
        present,
        || profiles::project(geo.files()),
    )
}

pub(super) fn completed_station_response_with_profiles(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    actor_order: &[&str],
    present: &[&str],
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    if present != [VALE] || chronology(&world)? != before_seq.checked_add(1)? {
        return None;
    }
    let (plans, profiles) =
        station_projection(&world, geo, authored, actor_order, false, profile_source)?;
    let events = arrival_events(&world, before_seq, false)?
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    let voices = json!(voices(&world));
    world
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(VALE.into(), voices);
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = Value::Array(events);
    Some(response)
}

fn train_want(turn: u64) -> Value {
    json!({
        "kind":"item", "target":ROUTES, "since":turn, "refusals":0, "story":true,
        "step":{"verb":"bring","at":STATION}, "from":"quest:box:train",
    })
}

pub(super) fn accept_train(request: &Value) -> Option<Value> {
    let world = request.get("world")?;
    let action = &request["action"];
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
        || action.as_str().or_else(|| action["key"].as_str()) != Some(ACCEPT_TRAIN)
        || action["kind"] == "pack"
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || !(request["elysiumPortraits"].is_null()
            || request["elysiumPortraits"]
                .as_array()
                .is_some_and(Vec::is_empty))
        || world["speechVoices"][VALE] != json!([VALE, KEEPER])
        || !world["actors"][VALE]["want"].is_null()
    {
        return None;
    }
    let turn = world["turn"].as_u64()?;
    let revision = world["revision"].as_u64()?.checked_add(1)?;
    if revision <= turn || revision > opening::MAX_REVISION {
        return None;
    }
    arrival_events(
        world,
        chronology(world)?.checked_sub(1)?,
        world["turn"] == 2,
    )?;
    let order = super::opening_roster::actor_order(request, world)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = world.clone();
    let vale = world["actors"][VALE].as_object_mut()?;
    vale.remove("content");
    vale.insert("want".into(), train_want(turn));
    world["revision"] = revision.into();
    let (plans, profiles) = station_projection(&world, &geo, &authored, &order, true, || {
        profiles::project(geo.files())
    })?;
    super::opening_held_items::settle(&mut world, &geo, None)?;
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = json!([]);
    Some(response)
}

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    let world = request.get("world")?;
    let train_accepted = !world["actors"][VALE]["want"].is_null();
    if request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || ((rue_arrived(world) || train_accepted) && present != [VALE])
        || world["speechVoices"][VALE] != json!(voices(world))
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
    let (plans, profiles) =
        station_projection(world, &geo, &authored, &actor_order, train_accepted, || {
            profiles::project(geo.files())
        })?;
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
