use super::{
    authored_order::Order,
    initial_wants::root_in,
    lamp_state, opening, opening_content,
    opening_full_wait::visible_items,
    opening_hub_residents,
    opening_pickups::item_as_named,
    opening_place_cards::Deck,
    opening_pond_view::offer,
    opening_quiet_life,
    opening_resident_sleep::sleeping_pip_at_pond,
    opening_roaming,
    opening_roster::{self, known_actors},
    opening_second_attic_lamp, opening_second_attic_tail, opening_second_round, opening_settlement,
    opening_station_move::{self, rue_arrived},
    opening_station_quest_drop_learning::confirm_pip_wait,
    opening_station_read::after_first_log,
    opening_station_read_wait::{observe_place, record_wait_learning},
    opening_view, opening_visitor_routes, opening_wants,
    pack_state::Catalog,
    profiles,
    resident_evidence::ResidentEvidence,
    Geography,
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
pub(super) const ABANDON_TRAIN: &str = "drop:vale:::0";
const TRAIN_TERMS: &str = r#"["item","routes",[["at","station"],["verb","bring"]],null]"#;
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

pub(super) fn historic_station(world: &Value) -> bool {
    world["began"] == 480 && world["turn"] == 482
}

fn response_chronology(world: &Value) -> Option<u64> {
    if historic_station(world) {
        opening_station_move::historic_arrival(world)
    } else {
        chronology(world)
    }
}

fn settled_first_read(world: &Value) -> Option<[&Value; 2]> {
    let seq = after_first_log(world)?;
    let [.., read, wait] = world["log"].as_array()?.as_slice() else {
        return None;
    };
    let next = seq.checked_add(1)?;
    let learned = &world["knowledge"]["known"][VALE]["quest:keeper:pond"];
    (read["seq"] == seq
        && wait["seq"] == next
        && world["eventSeq"] == next
        && wait["turn"] == world["turn"]
        && wait["kind"] == "action"
        && wait["verb"] == "wait"
        && wait["actorId"] == PIP
        && wait["locationId"] == STATION
        && wait["generated"] != true
        && wait["witnesses"] == read["witnesses"]
        && wait["cast"] == read["cast"]
        && *learned
            == json!({
                "kind":"read","teller":null,"eventSeq":seq,"learnedTurn":3,"book":"keeper-log"
            }))
    .then_some([read, wait])
}

fn historic_sleepers(world: &Value, geo: &Geography<'_>) -> Option<()> {
    if geo.files()["v2/card-game/world-history.json"]["turns"] != 480 {
        return None;
    }
    sleeping_pip_at_pond(world, geo, world["arrival"]["seq"].as_u64()?)?;
    let keeper = &world["actors"][KEEPER]["sleeping"];
    (keeper.is_null()
        || (keeper.as_object()?.len() == 3
            && keeper["since"] == 481
            && keeper["place"] == STATION
            && keeper["until"].as_u64()? > 482))
        .then_some(())
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
    let met_keeper = world["opening"]["met"][KEEPER].as_u64()?;
    let after_read = turn == 3 && met_keeper == 2 && settled_first_read(world).is_some();
    let arrival_turn = turn - u64::from(train_abandoned(world));
    let historic = historic_station(world);
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    let lamp = &world["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || (world.get("began").is_some() && !historic)
        || !(turn..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["opening"]["crossed"] != true
        || (met_keeper != arrival_turn && !after_read)
        || world["opening"]["met"][PIP] != met_keeper.checked_sub(1)?
        || !world["disabledPacks"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["pondLampLoan"].is_null()
        || !world["defeats"][VALE].is_null()
        || world["doors"]["train"] != STATION
        || ["usedUp", "gone"]
            .iter()
            .any(|key| entries(&world[*key]).any(|id| id == WAYFINDER || id == "routes"))
        || vale["waitSpeech"] != json!({"place":STATION,"turn":null})
        || !vale["arcana"].is_null()
        || (!vale["closed"].is_null() && !train_abandoned(world))
        || lamp["lit"] != false
        || fuel.fuel_place != STATION
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0))
    {
        return None;
    }
    if train_accepted {
        if historic
            || after_read
            || rue_arrived(world)
            || vale["want"] != train_want(turn)
            || vale.get("content").is_some()
            || world["items"].get(ROUTES).is_none()
        {
            return None;
        }
    } else if !vale["want"].is_null() {
        return None;
    }
    let mut cast = vec![VALE, KEEPER];
    if historic {
        historic_sleepers(world, geo)?;
    } else {
        cast.push(PIP);
        if rue_arrived(world) {
            rue_meeting(world)?;
            cast.push(RUE);
        }
    }
    for id in &cast {
        let actor = actors.get(*id)?;
        if actor["place"] != STATION
            || (!actor["sleeping"].is_null() && !(historic && *id == KEEPER))
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
    let place_met = &world["placeMet"][STATION];
    if historic && wayfinder_here {
        if *place_met != json!([WAYFINDER]) {
            return None;
        }
    } else if !place_met.is_null() {
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
            if !world["actors"][other]["sleeping"].is_null() {
                continue;
            }
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
            ("oil" | "cloth", KEEPER | PIP)
                if company.contains(&holder) && world["actors"][holder]["sleeping"].is_null() =>
            {
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
    if !train_accepted && !train_abandoned(world) {
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
        abandon["key"] = json!(ABANDON_TRAIN);
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
    let mut plans = actions(world, geo, authored, &profiles, &company, train_accepted)?;
    if world["turn"] == 3
        && world["opening"]["met"][KEEPER] == 2
        && settled_first_read(world).is_some()
    {
        let index = plans.iter().position(|plan| plan["key"] == ACCEPT_TRAIN)?;
        let vale = profiles[VALE]["name"].as_str()?;
        let keeper = profiles[KEEPER]["name"].as_str()?;
        let text = format!("{vale} accepts {keeper}'s quest.");
        plans.insert(index, offer("accept", None, Some(KEEPER), text, &[]));
    }
    Some((plans, profiles))
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
    if events.last()?["seq"] != world["eventSeq"]
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
    if historic_station(world) {
        let [move_event] = committed else {
            return None;
        };
        return (is_move(move_event, VALE, POND, STATION)
            && [VALE, PIP, "cloth"]
                .iter()
                .all(|id| entries(&move_event["witnesses"]).any(|witness| witness == *id)))
        .then_some(events);
    }
    let follows = committed.get(1)?;
    if !is_move(follows, PIP, POND, STATION) || !follows["itemId"].is_null() {
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
    (world["turn"] == 2 && settled_speech_voices(world, geo, order)? == [VALE, KEEPER])
        .then_some(())
}

pub(super) fn settled_speech_voices(
    world: &Value,
    geo: &Geography<'_>,
    order: &[&str],
) -> Option<&'static [&'static str]> {
    if world["turn"] != 2 && !historic_station(world) {
        return None;
    }
    let events = arrival_events(world, response_chronology(world)?.checked_sub(1)?, true)?;
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
    if present != [VALE] || response_chronology(&world)? != before_seq.checked_add(1)? {
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

pub(super) fn completed_read_response(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    actor_order: &[&str],
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    let [read, wait] = settled_first_read(&world)?;
    if read["seq"] != before_seq.checked_add(1)? {
        return None;
    }
    let events = vec![read.clone(), wait.clone()];
    let (plans, profiles) =
        station_projection(&world, geo, authored, actor_order, false, profile_source)?;
    world["speechVoices"][VALE] = json!([]);
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

fn train_action_world<'a>(request: &'a Value, key: &str) -> Option<&'a Value> {
    let world = request.get("world")?;
    let action = &request["action"];
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
        || action.as_str().or_else(|| action["key"].as_str()) != Some(key)
        || action["kind"] == "pack"
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || !(request["elysiumPortraits"].is_null()
            || request["elysiumPortraits"]
                .as_array()
                .is_some_and(Vec::is_empty))
        || world["speechVoices"][VALE] != json!([VALE, KEEPER])
    {
        return None;
    }
    Some(world)
}

pub(super) fn accept_train(request: &Value) -> Option<Value> {
    let world = train_action_world(request, ACCEPT_TRAIN)?;
    if !world["actors"][VALE]["want"].is_null() {
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

fn train_abandoned(world: &Value) -> bool {
    let vale = &world["actors"][VALE];
    let turn = &world["turn"];
    matches!(turn.as_u64(), Some(3 | 4))
        && vale["want"].is_null()
        && vale["gaveUp"] == json!({"target":ROUTES,"turn":turn})
        && vale["closed"] == json!({"quest:box:train":[turn,TRAIN_TERMS]})
}

fn abandonment_events(world: &Value) -> Option<&[Value]> {
    let log = world["log"].as_array()?;
    let events = log.get(log.len().checked_sub(2)?..)?;
    let [drop, wait] = events else { return None };
    (drop["actorId"] == VALE
        && drop["verb"] == "drop"
        && wait["actorId"] == PIP
        && wait["verb"] == "wait"
        && wait["sleep"].is_null()
        && wait["guards"].is_null()
        && wait["seq"] == world["eventSeq"]
        && drop["seq"].as_u64()?.checked_add(1) == wait["seq"].as_u64()
        && events.iter().all(|event| {
            event["turn"] == world["turn"]
                && event["kind"] == "action"
                && event["locationId"] == STATION
                && event["generated"] != true
        }))
    .then_some(events)
}

pub(super) fn abandon_train(request: &Value) -> Option<Value> {
    let before = train_action_world(request, ABANDON_TRAIN)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let turn = before["turn"].as_u64()?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision <= turn || revision > opening::MAX_REVISION {
        return None;
    }
    arrival_events(before, chronology(before)?.checked_sub(1)?, turn == 3)?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let (mut plans, profiles) = station_projection(before, &geo, &authored, &order, true, || {
        profiles::project(&files)
    })?;
    let abandon = plans.pop()?;
    if abandon["key"] != ABANDON_TRAIN
        || before["actors"][KEEPER]["want"]["step"]["verb"] != "call"
        || before["items"]["bell"]["ringing"] != 0
    {
        return None;
    }
    confirm_pip_wait(before, &geo)?;
    opening_hub_residents::at_home(before, &geo, KEEPER, "oil")?;
    let mut world = before.clone();
    world["turn"] = turn.into();
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let vale = world["actors"][VALE].as_object_mut()?;
    for field in ["under", "offered", "guarding"] {
        vale.remove(field);
    }
    vale.insert("want".into(), Value::Null);
    vale.insert("gaveUp".into(), json!({"target":ROUTES,"turn":turn}));
    vale.insert(
        "closed".into(),
        json!({"quest:box:train":[turn,TRAIN_TERMS]}),
    );
    let cast = known_actors(&world, &geo, &order, Some(STATION))?;
    let items = visible_items(&world, &geo, &authored, STATION)?;
    let witnesses: Vec<_> = authored
        .actors
        .iter()
        .map(String::as_str)
        .filter(|id| cast.contains(id))
        .chain(items.iter().copied())
        .collect();
    let evidence = ResidentEvidence::new(&files)?;
    let waiting = format!("{} waits one turn.", profiles[PIP]["name"].as_str()?);
    for (by, verb, text) in [
        (VALE, "drop", abandon["text"].as_str()?),
        (PIP, "wait", &waiting),
    ] {
        evidence.record(
            &mut world,
            &cast,
            &items,
            json!({
                "speaker":"World","text":text,"kind":"action","actorId":by,
                "locationId":STATION,"verb":verb,"witnesses":witnesses,
            }),
            true,
        )?;
        if by == VALE {
            observe_place(&mut world, &geo, before_seq.checked_add(1)?)?;
        } else {
            record_wait_learning(&mut world, text)?;
        }
    }
    let known = known_actors(&world, &geo, &order, None)?;
    let residents = opening_roster::residents(&world, &geo, &known, VALE)?;
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, None)?;
    opening_second_round::settle_visitors(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    if world["eventSeq"].as_u64()? != before_seq.checked_add(2)?
        || world["placeCard"][STATION] != before["placeCard"][STATION]
        || !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty()
    {
        return None;
    }
    opening_settlement::decay_bell(&mut world)?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_opening_day(&mut world, &geo)?;
    opening_second_attic_tail::verify_stops(&world, &geo)?;
    opening_second_attic_tail::verify_wake(&world)?;
    opening_second_attic_lamp::settle_station(&mut world, &geo)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_wants::settle_station(&mut world, &geo)?;
    opening_second_attic_tail::verify_quiet_facts(before, &world, &geo)?;
    opening_second_attic_tail::verify_wayfinder(&world, &geo)?;
    opening_second_attic_tail::verify_station_order(&world, &geo)?;
    world["speechVoices"][VALE] = json!([VALE]);
    let events = json!(abandonment_events(&world)?);
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = events;
    Some(response)
}

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    let world = request.get("world")?;
    let train_accepted = !world["actors"][VALE]["want"].is_null();
    let abandoned = train_abandoned(world);
    let after_read = world["turn"] == 3 && settled_first_read(world).is_some();
    let named = if after_read {
        &[]
    } else if abandoned {
        &[VALE]
    } else {
        voices(world)
    };
    if request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || ((rue_arrived(world) || train_accepted || abandoned) && present != [VALE])
        || world["speechVoices"][VALE] != json!(named)
    {
        return None;
    }
    if abandoned {
        opening_station_move::abandoned_train_arrival(world)?;
        abandonment_events(world)?;
    } else if !after_read {
        arrival_events(
            world,
            response_chronology(world)?.checked_sub(1)?,
            world["turn"] == 2 || historic_station(world),
        )?;
    }
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
