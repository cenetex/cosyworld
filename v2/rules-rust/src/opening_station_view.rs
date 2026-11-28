use super::{
    authored_order::Order,
    initial_wants::root_in,
    lamp_state, opening, opening_content,
    opening_evidence::keeper_call_goal,
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
    opening_station_keeper_gift::settle_keeper_abandon_gift,
    opening_station_move::{self, rue_arrived},
    opening_station_quest_drop_learning::confirm_pip_wait,
    opening_station_read::{after_first_log, first_log_history, keeper_book_claim},
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
pub(super) const ACCEPT_KEEPER: &str = "accept:vale::keeper";
pub(super) const ACCEPT_TRAIN: &str = "accept:vale::box:train";
pub(super) const ABANDON_QUEST: &str = "drop:vale:::0";
const KEEPER_QUEST: &str = "quest:keeper:pond";
const KEEPER_FROM: &str = "quest:from:keeper";
const KEEPER_TERMS: &str =
    r#"["place","pond",[["crossing","pond-greek-harbor"],["verb","call"]],null]"#;
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

pub(super) fn abandon_offer(text: String) -> Value {
    let mut action = offer("drop", None, None, text, &[]);
    action["quest"] = json!(0);
    action["key"] = json!(ABANDON_QUEST);
    action
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

fn historic_awake_station(world: &Value) -> bool {
    historic_station(world)
        && matches!(world["run"]["seed"].as_u64(), Some(17 | 99))
        && world["actors"][PIP]["place"] == STATION
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
    if world["eventSeq"] != seq.checked_add(1)? {
        return None;
    }
    witnessed_read_wait(world, read, wait, seq)?;
    Some([read, wait])
}

fn witnessed_read_wait(world: &Value, read: &Value, wait: &Value, seq: u64) -> Option<()> {
    let learned = &world["knowledge"]["known"][VALE][KEEPER_QUEST];
    (read["seq"] == seq
        && wait["seq"] == seq.checked_add(1)?
        && wait["turn"] == 3
        && wait["kind"] == "action"
        && wait["verb"] == "wait"
        && wait["actorId"] == PIP
        && wait["locationId"] == STATION
        && wait["generated"] != true
        && wait["witnesses"] == read["witnesses"]
        && wait["cast"] == read["cast"]
        && *learned == keeper_read_fact(seq))
    .then_some(())
}

fn keeper_read_fact(seq: u64) -> Value {
    json!({"kind":"read","teller":null,"eventSeq":seq,"learnedTurn":3,"book":"keeper-log"})
}

pub(super) fn keeper_want(world: &Value, geo: &Geography) -> Option<Value> {
    let [read, _] = settled_first_read(world)?;
    keeper_want_from_read(world, geo, read["seq"].as_u64()?)
}

pub(super) fn keeper_want_from_read(world: &Value, geo: &Geography, seq: u64) -> Option<Value> {
    let claim = keeper_book_claim(world, geo)?;
    let id = format!("claim:hub:keeper-log:{}", claim["id"].as_str()?);
    let forest = &geo.files()["v2/card-game/forest.json"];
    let keeper = forest["people"][KEEPER]["name"].as_str()?;
    let goal = keeper_call_goal(
        forest["things"]["cloth"]["name"].as_str()?,
        forest["places"][POND]["name"].as_str()?,
        forest["things"][LAMP]["name"].as_str()?,
    );
    let facts = &world["knowledge"]["facts"];
    let known = &world["knowledge"]["known"][VALE];
    if world["knowledge"]["version"] != 1
        || !world["knowledge"]["pending"].as_array()?.is_empty()
        || known[KEEPER_QUEST] != keeper_read_fact(seq)
        || facts[KEEPER_QUEST]
            != json!({
                "id":KEEPER_QUEST,"text":format!("{keeper} wants you to {goal}."),"source":{
                    "kind":"quest","eventSeq":2,"turn":0,"actorId":KEEPER,
                    "locationId":STATION,"witnesses":[VALE],"topic":null,
                },
            })
        || known[&id] != known[KEEPER_QUEST]
        || facts[&id]
            != json!({
                "id":id,"text":claim["text"],"source":{
                    "kind":"claim","eventSeq":seq,"turn":3,"actorId":VALE,
                    "locationId":STATION,"witnesses":[VALE],"topic":null,"book":"keeper-log",
                    "claim":claim["id"],"author":KEEPER,"about":claim["about"],
                },
            })
    {
        return None;
    }
    let mut want = forest["people"][KEEPER]["want"].clone();
    want["since"] = json!(3);
    want["refusals"] = json!(0);
    want["from"] = json!(KEEPER_FROM);
    Some(want)
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

fn historic_awake_residents(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let pip = &world["actors"][PIP];
    let keeper = &world["actors"][KEEPER];
    (geo.files()["v2/card-game/world-history.json"]["turns"] == world["began"]
        && pip["visited"] == json!([POND, STATION])
        && pip["heldItem"] == "cloth"
        && pip["lastTalk"] == 481
        && pip["want"] == json!({"kind":"item","target":LAMP,"since":0,"refusals":1,"lit":true})
        && keeper["heldItem"] == "oil"
        && keeper["want"]["step"]["verb"] == "call"
        && world["items"]["bell"]["ringing"] == 0)
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
    awake_historic: bool,
) -> Option<Vec<&'a str>> {
    let turn = world["turn"].as_u64()?;
    let met_keeper = world["opening"]["met"][KEEPER].as_u64()?;
    let after_read = turn == 3 && met_keeper == 2 && settled_first_read(world).is_some();
    let arrival_turn = turn - u64::from(train_abandoned(world));
    let after_gift = keeper_abandoned(world);
    let historic = historic_station(world);
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    let lamp = &world["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || (world.get("began").is_some() && !historic)
        || (awake_historic && (!historic || rue_arrived(world)))
        || !(turn..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["opening"]["crossed"] != true
        || (met_keeper != arrival_turn && !after_read && !(after_gift && met_keeper == 2))
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
        || (!vale["closed"].is_null() && !train_abandoned(world) && !after_gift)
        || lamp["lit"] != false
        || fuel.fuel_place != STATION
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(if after_gift {
            vale["heldItem"] == "cloth" && actors.get(PIP)?["heldItem"].is_null()
        } else {
            vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0)
        })
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
    } else if !vale["want"].is_null()
        && (!after_read
            || vale.get("content").is_some()
            || vale.get("offered").is_some()
            || vale["want"] != keeper_want(world, geo)?)
    {
        return None;
    }
    let mut cast = vec![VALE, KEEPER];
    if awake_historic {
        historic_awake_residents(world, geo)?;
        cast.push(PIP);
    } else if historic {
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
            || (!actor["sleeping"].is_null() && !(historic && !awake_historic && *id == KEEPER))
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
        let holder = if after_gift && id == "cloth" {
            VALE
        } else {
            holder
        };
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
    let station = name(STATION)?;
    let items = authored.items.iter().map(String::as_str);
    let owned: Vec<_> = items
        .clone()
        .filter(|id| world["items"][*id]["holder"] == VALE)
        .collect();
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
        for &id in &owned {
            let item = item_as_named(name(id)?);
            let carry = format!("{vale} carries {item} to {destination}.");
            out.push(offer("move", Some(id), Some(to), carry, &[id, to]));
        }
    }
    for &other in company {
        let resident = name(other)?;
        let stake = match other {
            PIP => (world["items"]["cloth"]["holder"] == PIP).then_some("cloth"),
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
    let mut wanted = Vec::new();
    for id in items {
        let holder = world["items"][id]["holder"].as_str()?;
        match (id, holder) {
            (LAMP | "cloth", VALE) => {
                let item = item_as_named(name(id)?);
                let drop = format!("{vale} puts {item} in {station}.");
                out.push(offer("drop", Some(id), Some(STATION), drop, &[id]));
                for &other in company {
                    out.push(offer(
                        "give",
                        Some(id),
                        Some(other),
                        format!("{vale} gives {item} to {}.", name(other)?),
                        &[id, other],
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
                wanted.push((id, holder, item, resident));
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
    for payment in owned {
        let item = item_as_named(name(payment)?);
        for &(id, holder, reward, resident) in &wanted {
            let mut trade = offer(
                "trade",
                Some(payment),
                Some(holder),
                format!("{vale} trades {item} for {resident}’s {reward}."),
                &[payment, id],
            );
            trade["receive"] = json!(id);
            trade["key"] = json!(format!("trade:{VALE}:{payment}:{holder}:{id}"));
            out.push(trade);
        }
    }
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
        out.push(abandon_offer(text));
    }
    Some(out)
}

fn station_projection(
    world: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    actor_order: &[&str],
    train_accepted: bool,
    awake_historic: bool,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<(Vec<Value>, Value)> {
    let company = station_scene(world, geo, actor_order, train_accepted, awake_historic)?;
    station_paths(world, geo)?;
    let profiles = profile_source()?;
    let mut plans = actions(world, geo, authored, &profiles, &company, train_accepted)?;
    if world["turn"] == 3
        && world["opening"]["met"][KEEPER] == 2
        && settled_first_read(world).is_some()
    {
        let vale = profiles[VALE]["name"].as_str()?;
        if world["actors"][VALE]["want"]["from"] == KEEPER_FROM {
            let cloth = profiles["cloth"]["name"].as_str()?;
            let pond = profiles[POND]["name"].as_str()?;
            let lamp = profiles[LAMP]["name"].as_str()?;
            let goal = keeper_call_goal(cloth, pond, lamp);
            let text = format!("{vale} abandons their quest to {goal}.");
            plans.push(abandon_offer(text));
        } else {
            let index = plans.iter().position(|plan| plan["key"] == ACCEPT_TRAIN)?;
            let keeper = profiles[KEEPER]["name"].as_str()?;
            let text = format!("{vale} accepts {keeper}'s quest.");
            plans.insert(index, offer("accept", None, Some(KEEPER), text, &[]));
        }
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

fn awake_arrival_events(world: &Value, committed: &[&Value]) -> Option<()> {
    let [primary, follow, offstage @ .., wake] = committed else {
        return None;
    };
    if !is_move(primary, VALE, POND, STATION)
        || follow["seq"].as_u64()? != opening_station_move::historic_follow(world)?
        || follow["witnesses"] != json!([PIP, "ratiradio-station-key", "cloth"])
        || ![VALE, PIP, "cloth"]
            .iter()
            .all(|id| entries(&primary["witnesses"]).any(|witness| witness == *id))
        || wake["kind"] != "narration"
        || wake["speaker"] != "World"
        || wake["actorId"] != KEEPER
        || wake["locationId"] != STATION
        || wake["text"] != "The keeper wakes."
        || ["verb", "witnesses", "fromLocationId", "itemId", "targetId"]
            .iter()
            .any(|key| !wake[*key].is_null())
        || wake["cast"] != follow["cast"]
        || wake["cast"].as_array()?.len() != 3
        || ![VALE, PIP, KEEPER]
            .iter()
            .all(|id| entries(&wake["cast"]).any(|actor| actor == *id))
        || wake["items"] != follow["items"]
        || wake["light"] != false
    {
        return None;
    }
    match offstage {
        [] => Some(()),
        [entry] if is_move(entry, "orin", "pavilion", "willows-bank") => (entry["itemId"]
            .is_null()
            && entry["cast"] == json!(["orin"])
            && entry["witnesses"] == json!(["orin", "board"])
            && world["actors"]["orin"]["place"] == "willows-bank"
            && world["items"]["board"]["holder"] == "pavilion")
            .then_some(()),
        _ => None,
    }
}

fn arrival_events(
    world: &Value,
    before_seq: u64,
    allow_speech: bool,
    awake_historic: bool,
) -> Option<Vec<&Value>> {
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
        if awake_historic {
            awake_arrival_events(world, committed)?;
            return Some(events);
        }
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
    settled_arrival_voices(world, geo, order)
}

pub(super) fn settled_arrival_voices(
    world: &Value,
    geo: &Geography<'_>,
    order: &[&str],
) -> Option<&'static [&'static str]> {
    let awake_historic = historic_awake_station(world);
    let events = arrival_events(
        world,
        response_chronology(world)?.checked_sub(1)?,
        true,
        awake_historic,
    )?;
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
    station_scene(world, geo, order, false, awake_historic)?;
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
    world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    actor_order: &[&str],
    present: &[&str],
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    (present == [VALE]).then_some(())?;
    completed_arrival(
        world,
        geo,
        authored,
        before_seq,
        actor_order,
        false,
        profile_source,
    )
}

pub(super) fn completed_arrival(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    actor_order: &[&str],
    awake_historic: bool,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    if response_chronology(&world)? != before_seq.checked_add(1)? {
        return None;
    }
    let (plans, profiles) = station_projection(
        &world,
        geo,
        authored,
        actor_order,
        false,
        awake_historic,
        profile_source,
    )?;
    let events = arrival_events(&world, before_seq, false, awake_historic)?
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
    let (plans, profiles) = station_projection(
        &world,
        geo,
        authored,
        actor_order,
        false,
        false,
        profile_source,
    )?;
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

fn station_action_world<'a>(request: &'a Value, key: &str) -> Option<&'a Value> {
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
    {
        return None;
    }
    Some(world)
}

fn train_action_world<'a>(request: &'a Value, key: &str) -> Option<&'a Value> {
    let world = station_action_world(request, key)?;
    (world["speechVoices"][VALE] == json!([VALE, KEEPER])).then_some(world)
}

pub(super) fn accept_keeper(request: &Value) -> Option<Value> {
    let before = station_action_world(request, ACCEPT_KEEPER)?;
    let vale = &before["actors"][VALE];
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if !vale["want"].is_null()
        || vale.get("offered").is_some()
        || before["speechVoices"][VALE] != json!([])
        || revision <= before["turn"].as_u64()?
        || revision > opening::MAX_REVISION
    {
        return None;
    }
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let want = keeper_want(before, &geo)?;
    let mut world = before.clone();
    let vale = world["actors"][VALE].as_object_mut()?;
    vale.remove("content");
    vale.insert("want".into(), want);
    world["revision"] = revision.into();
    let (plans, profiles) =
        station_projection(&world, &geo, &authored, &order, false, false, || {
            profiles::project(geo.files())
        })?;
    super::opening_held_items::settle(&mut world, &geo, None)?;
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = json!([]);
    Some(response)
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
        false,
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
    let (plans, profiles) =
        station_projection(&world, &geo, &authored, &order, true, false, || {
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

pub(super) fn keeper_abandoned(world: &Value) -> bool {
    let vale = &world["actors"][VALE];
    world["turn"] == 4
        && world.get("began").is_none()
        && vale["want"].is_null()
        && vale["gaveUp"] == json!({"target":POND,"turn":4})
        && vale["closed"] == json!({(KEEPER_FROM):[4,KEEPER_TERMS]})
}

pub(super) fn keeper_abandon_head(world: &Value) -> Option<u64> {
    let [.., read, wait, drop, gift] = world["log"].as_array()?.as_slice() else {
        return None;
    };
    if !keeper_abandoned(world) || drop["verb"] != "drop" {
        return None;
    }
    let read_seq = first_log_history(world, Some(drop))?;
    witnessed_read_wait(world, read, wait, read_seq)?;
    let seq = read_seq.checked_add(3)?;
    (drop["seq"] == seq.checked_sub(1)?
        && gift["seq"] == seq
        && world["eventSeq"] == seq
        && gift["actorId"] == PIP
        && gift["verb"] == "give"
        && gift["itemId"] == "cloth"
        && gift["targetId"] == VALE
        && gift["accepted"] == true)
        .then_some(seq)
}

fn keeper_abandon_events<'a>(world: &'a Value, geo: &Geography<'_>) -> Option<&'a [Value]> {
    keeper_abandon_head(world)?;
    let log = world["log"].as_array()?;
    let [.., wait, drop, gift] = log.as_slice() else {
        return None;
    };
    keeper_book_claim(world, geo)?;
    let events = log.get(log.len().checked_sub(2)?..)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let vale = forest["people"][VALE]["name"].as_str()?;
    let pip = forest["people"][PIP]["name"].as_str()?;
    let cloth = forest["things"]["cloth"]["name"].as_str()?;
    let goal = keeper_call_goal(
        cloth,
        forest["places"][POND]["name"].as_str()?,
        forest["things"][LAMP]["name"].as_str()?,
    );
    let cast = gift["cast"].as_array()?;
    let cloth_id = |item: &&Value| item["id"] == "cloth";
    (events.iter().all(|event| {
        event["turn"] == 4
            && event["kind"] == "action"
            && event["speaker"] == "World"
            && event["locationId"] == STATION
            && event["generated"] != true
            && event["cast"] == gift["cast"]
            && event["witnesses"] == wait["witnesses"]
            && event["light"] == false
    }) && cast.len() == 3
        && [VALE, PIP, KEEPER]
            .iter()
            .all(|id| cast.iter().any(|member| member == id))
        && drop["text"] == format!("{vale} abandons their quest to {goal}.")
        && entries(&drop["items"]).find(cloth_id)?["holder"] == PIP
        && gift["fromLocationId"] == STATION
        && entries(&gift["items"]).find(cloth_id)?["holder"] == VALE
        && gift["text"] == format!("{pip} gives {} to {vale}.", item_as_named(cloth)))
    .then_some(events)
}

pub fn completed_keeper_abandon(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    before_seq: u64,
    profiles: Value,
) -> Option<Value> {
    let events = keeper_abandon_events(&world, geo)?;
    if events.first()?["seq"] != before_seq.checked_add(1)? {
        return None;
    }
    let events = json!(events);
    let (plans, profiles) = station_projection(&world, geo, authored, order, false, false, || {
        Some(profiles)
    })?;
    world["speechVoices"][VALE] = json!([VALE]);
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = events;
    Some(response)
}

pub(super) fn keeper_abandon_reply(request: &Value) -> Option<Value> {
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
    {
        return None;
    }
    let world = request.get("world")?;
    let order = opening_roster::actor_order(request, world)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    completed_keeper_abandon(
        world.clone(),
        &geo,
        &authored,
        &order,
        request["beforeSeq"].as_u64()?,
        profiles::project(&files)?,
    )
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

fn release_station_quest(
    world: &mut Value,
    turn: u64,
    revision: u64,
    from: &str,
    target: &str,
    terms: &str,
) -> Option<()> {
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
    vale.insert("gaveUp".into(), json!({"target":target,"turn":turn}));
    vale.insert("closed".into(), json!({(from):[turn,terms]}));
    Some(())
}

pub fn begin_keeper_abandon(
    request: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<Value> {
    let before = station_action_world(request, ABANDON_QUEST)?;
    let [read, _] = settled_first_read(before)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision <= 4
        || revision > opening::MAX_REVISION
        || before["speechVoices"][VALE] != json!([])
        || before["actors"][VALE]["want"]["from"] != KEEPER_FROM
    {
        return None;
    }
    station_scene(before, geo, order, false, false)?;
    station_paths(before, geo)?;
    let mut world = before.clone();
    if !world["placeCard"][STATION].is_null()
        && world["knowledge"]["facts"][format!("quest:{STATION}:{WAYFINDER}")].is_null()
    {
        return None;
    }
    observe_place(&mut world, geo, read["seq"].as_u64()?)?;
    release_station_quest(&mut world, 4, revision, KEEPER_FROM, POND, KEEPER_TERMS)?;
    let cast = known_actors(&world, geo, order, Some(STATION))?;
    let items = visible_items(&world, geo, authored, STATION)?;
    let witnesses: Vec<_> = authored
        .actors
        .iter()
        .map(String::as_str)
        .filter(|id| cast.contains(id))
        .chain(items.iter().copied())
        .collect();
    let name = |id: &str| evidence.profile(id)?.get("name")?.as_str();
    let goal = keeper_call_goal(name("cloth")?, name(POND)?, name(LAMP)?);
    let text = format!("{} abandons their quest to {goal}.", name(VALE)?);
    evidence.record(
        &mut world,
        &cast,
        &items,
        json!({
            "speaker":"World","text":text,"kind":"action","actorId":VALE,"verb":"drop",
            "locationId":STATION,"witnesses":witnesses,
        }),
        true,
    )?;
    Some(world)
}

pub(super) fn keeper_abandon_projection(request: &Value) -> Option<Value> {
    let order = opening_roster::actor_order(request, request.get("world")?)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let world = begin_keeper_abandon(request, &geo, &authored, &order, &evidence)?;
    Some(json!({"ok":true,"world":world}))
}

fn abandon_keeper(request: &Value) -> Option<Value> {
    let before = station_action_world(request, ABANDON_QUEST)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = begin_keeper_abandon(request, &geo, &authored, &order, &evidence)?;
    let known = known_actors(&world, &geo, &order, None)?;
    let residents = opening_roster::residents(&world, &geo, &known, VALE)?;
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, None)?;
    let mut world = settle_keeper_abandon_gift(world, &geo, &authored, &order, &evidence)?;
    opening_hub_residents::at_home(&world, &geo, KEEPER, "oil")?;
    opening_second_round::settle_visitors(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    if keeper_abandon_head(&world)? != before_seq.checked_add(2)?
        || world["placeCard"] != before["placeCard"]
        || world["items"]["bell"]["ringing"] != 0
    {
        return None;
    }
    opening_second_attic_tail::settle_quiet_station_before_wants(
        before, &mut world, &geo, &catalog,
    )?;
    opening_wants::settle_station(&mut world, &geo)?;
    opening_second_attic_tail::settle_quiet_station_after_wants(before, &mut world, &geo)?;
    let profiles = evidence.into_profiles();
    completed_keeper_abandon(world, &geo, &authored, &order, before_seq, profiles)
}

pub(super) fn abandon(request: &Value) -> Option<Value> {
    if request["world"]["actors"][VALE]["want"]["from"] == KEEPER_FROM {
        return abandon_keeper(request);
    }
    abandon_train(request)
}

fn abandon_train(request: &Value) -> Option<Value> {
    let before = train_action_world(request, ABANDON_QUEST)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let turn = before["turn"].as_u64()?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision <= turn || revision > opening::MAX_REVISION {
        return None;
    }
    arrival_events(
        before,
        chronology(before)?.checked_sub(1)?,
        turn == 3,
        false,
    )?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let (mut plans, profiles) =
        station_projection(before, &geo, &authored, &order, true, false, || {
            profiles::project(&files)
        })?;
    let abandon = plans.pop()?;
    if abandon["key"] != ABANDON_QUEST
        || before["actors"][KEEPER]["want"]["step"]["verb"] != "call"
        || before["items"]["bell"]["ringing"] != 0
    {
        return None;
    }
    confirm_pip_wait(before, &geo)?;
    opening_hub_residents::at_home(before, &geo, KEEPER, "oil")?;
    let mut world = before.clone();
    release_station_quest(
        &mut world,
        turn,
        revision,
        "quest:box:train",
        ROUTES,
        TRAIN_TERMS,
    )?;
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
    project_private(request, present, historic_awake_station(&request["world"]))
}

fn project_private(request: &Value, present: &[&str], awake_historic: bool) -> Option<Value> {
    let world = request.get("world")?;
    let train_accepted = world["actors"][VALE]["want"]["from"] == "quest:box:train";
    let abandoned = train_abandoned(world);
    let after_gift = keeper_abandoned(world);
    let after_read = world["turn"] == 3 && settled_first_read(world).is_some();
    let named = if after_read {
        &[]
    } else if abandoned || after_gift {
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
    } else if !after_read && !after_gift {
        arrival_events(
            world,
            response_chronology(world)?.checked_sub(1)?,
            world["turn"] == 2 || historic_station(world),
            awake_historic,
        )?;
    }
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    if after_gift {
        keeper_abandon_events(world, &geo)?;
    }
    let actor_order = super::opening_roster::actor_order(request, world)?;
    let (plans, profiles) = station_projection(
        world,
        &geo,
        &authored,
        &actor_order,
        train_accepted,
        awake_historic,
        || profiles::project(geo.files()),
    )?;
    let projected = opening_view::private_world(world, request)?;
    Some(station_response(
        json!({"ok":true,"world":projected}),
        plans,
        profiles,
    ))
}

pub(super) fn historic_awake_projection(request: &Value) -> Option<Value> {
    if request["actor"] != VALE || opening::seats(&request["claimed"])? != [VALE] {
        return None;
    }
    let present = opening::seats(&request["present"])?;
    match request["phase"].as_str()? {
        "private" => project_private(request, &present, true),
        "complete" if present == [VALE] => {
            let world = request.get("world")?;
            let order = opening_roster::actor_order(request, world)?;
            let (files, authored) = opening_content::wait_files(request)?;
            let catalog = Catalog::from_files(&files)?;
            let geo = Geography::new(&files, catalog.packs())?;
            let before_seq = request["beforeSeq"].as_u64()?;
            completed_arrival(
                world.clone(),
                &geo,
                &authored,
                before_seq,
                &order,
                true,
                || profiles::project(&files),
            )
        }
        _ => None,
    }
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
