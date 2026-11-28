use super::{
    authored_order::Order, opening_content, opening_crossings, opening_hub_residents,
    opening_pickups, opening_place_cards::Deck, opening_pond_call_view::cloth_arrival,
    opening_pond_lamp_drop::grounded_fuel, opening_pond_ship_board, opening_pond_ship_disembark,
    opening_pond_ship_settlement::course_before_sailing, opening_pond_ship_wait, opening_roster,
    opening_second_round, opening_station_move,
    opening_station_quest_drop_learning::confirm_pond_ask_trial,
    opening_station_read::keeper_want_from_read, opening_visitor_play::dwell_until,
    pack_state::Catalog, resident_evidence::ResidentEvidence, seed, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const STATION: &str = "station";
const POND: &str = "pond";
const SHIP: &str = "greek-ship";
const ADA: &str = "ada";
const HARBOR: &str = "greek-harbor";

fn follows_ashore(primary: &Value) -> Option<bool> {
    match primary["witnesses"].as_array()?.as_slice() {
        [vale, cloth] if vale == VALE && cloth == "cloth" => Some(false),
        [vale, ada, cloth] if vale == VALE && ada == ADA && cloth == "cloth" => Some(true),
        _ => None,
    }
}

fn harbor_transport(world: &Value, ada_aboard: bool) -> bool {
    let (phase, since, riders): (_, _, &[&str]) = if ada_aboard {
        ("arrived", 10, &[ADA])
    } else {
        ("docked", 11, &[])
    };
    world["transports"][SHIP]
        == json!({
            "version":3,"phase":phase,"dock":HARBOR,"destination":null,
            "riders":riders,"since":since,"recall":null,
        })
}

pub(super) fn ship_disembark_head(world: &Value) -> Option<u64> {
    let primary = opening_pond_ship_disembark::arrival_event(world)?;
    let first = primary["seq"].as_u64()?;
    let follows = follows_ashore(primary)?;
    let seq = first.checked_add(u64::from(follows))?;
    let event = world["log"].as_array()?.last()?;
    let ada = &world["actors"][ADA];
    if event["seq"] != seq || world["eventSeq"] != seq || !harbor_transport(world, false) {
        return None;
    }
    if !follows {
        return (ada["place"] == "loft").then_some(seq);
    }
    let cast = event["cast"].as_array()?;
    (event["kind"] == "action"
        && event["generated"] != true
        && event["actorId"] == ADA
        && opening_station_move::move_between(event, 11, SHIP, HARBOR)
        && event["itemId"].is_null()
        && event["witnesses"] == json!([ADA])
        && event["items"] == primary["items"]
        && event["light"] == primary["light"]
        && cast.len() == 3
        && [ADA, VALE, "greek-shipmaster"]
            .iter()
            .all(|id| cast.iter().any(|actor| actor == *id))
        && ada["place"] == HARBOR
        && ada["crossed"] == 2
        && ada["dwellUntil"] == dwell_until(ADA, 11)
        && ada["visited"] == json!(["loft", SHIP, HARBOR]))
    .then_some(seq)
}

fn cloth_wait_receipt(world: &Value, geo: &Geography<'_>, trials: &[Value]) -> Option<()> {
    let vale = &world["actors"][VALE];
    let arrival = match world["turn"].as_u64()? {
        stage @ 8..=11 => {
            vale["want"].is_null().then_some(())?;
            match stage {
                8 => opening_pond_ship_board::arrival(world)?,
                9 => course_before_sailing(world)?,
                10 => opening_pond_ship_wait::before_docking(world)?,
                _ => opening_pond_ship_disembark::arrival_event(world)?["seq"].as_u64()?,
            }
        }
        _ => {
            let (arrival, read) = cloth_arrival(world, false)?;
            (vale["want"] == keeper_want_from_read(world, geo, read)?).then_some(())?;
            arrival
        }
    };
    let [ask, wait, gift] = trials else {
        return None;
    };
    let goal = json!({"kind":"ask","target":VALE,"item":"lamp","destination":null});
    let gift_seq = gift["seq"].as_u64()?;
    if world["life"]["actors"][VALE]["attachments"] != json!({"cloth":{"from":PIP,"turn":5}})
        || !geo.entity_active(world, "cloth")?
        || [ask, wait, gift].iter().any(|trial| {
            trial["version"] != 2
                || trial["goal"] != goal
                || trial["intent"] != r#"["item","lamp"]"#
        })
        || ask["turn"] != 1
        || ask["action"]["kind"] != "ask"
        || wait["turn"] != 3
        || wait["action"]["kind"] != "wait"
        || gift["turn"] != 5
        || gift["action"]["kind"] != "give"
        || gift["action"]["item"] != "cloth"
        || gift["action"]["target"] != VALE
        || gift_seq >= arrival
    {
        return None;
    }
    world["log"]
        .as_array()?
        .iter()
        .any(|entry| {
            entry["seq"] == gift_seq
                && entry["turn"] == 5
                && entry["actorId"] == PIP
                && entry["kind"] == "action"
                && entry["generated"] != true
                && entry["locationId"] == STATION
                && entry["verb"] == "give"
                && entry["itemId"] == "cloth"
                && entry["targetId"] == VALE
                && entry["accepted"] == true
        })
        .then_some(())
}

pub(super) fn pip_dwells(world: &Value, geo: &Geography<'_>, turn: u64) -> Option<()> {
    let pip = &world["actors"][PIP];
    let forest = &geo.files()["v2/card-game/forest.json"];
    let lamp = &world["items"]["lamp"];
    let boarded = matches!(turn, 8..=11);
    let cloth_given = turn == 6 || boarded;
    let hand = if cloth_given {
        Value::Null
    } else {
        json!("cloth")
    };
    let cloth_holder = if cloth_given { VALE } else { PIP };
    let lamp_ready = if boarded {
        grounded_fuel(lamp)?
    } else {
        lamp["holder"] == VALE
            && lamp["fuelPlace"] == world["actors"][VALE]["place"]
            && lamp["lit"] == false
    };
    let refusals = u8::from(!boarded);
    let dwell = 2 + 24 + u64::from(seed::hash("moth@2") % 6);
    if pip["place"] != STATION
        || pip["heldItem"] != hand
        || pip["want"]
            != json!({"kind":"item","target":"lamp","since":0,"refusals":refusals,"lit":true})
        || pip["visited"] != json!(["pond", STATION])
        || pip["dwellUntil"] != dwell
        || pip["xp"] != 0
        || [
            "sleeping", "homeward", "level", "under", "guarding", "attend",
        ]
        .iter()
        .any(|field| !pip[*field].is_null())
        || !world["routeKnowledge"][PIP].is_null()
        || world["peaceUntil"][PIP] != 0
        || !world["defeats"][PIP].is_null()
        || opening_pickups::resting(pip, turn)
        || !geo.entity_active(world, PIP)?
        || !geo.entity_active(world, "lamp")?
        || world["items"]["cloth"]["holder"] != cloth_holder
        || !lamp_ready
        || forest["people"][PIP]["want"] != json!({"kind":"item","target":"lamp","lit":true})
        || forest["people"][PIP]["levelAtHome"] == true
        || ["claims", "records", "teachesQuest"]
            .iter()
            .any(|field| !forest["things"]["cloth"][*field].is_null())
        || geo.packs().any(|pack| {
            pack["avatars"].get(PIP).is_some()
                || pack["items"].get("cloth").is_some()
                || pack["items"].get("lamp").is_some()
        })
        || world["items"].as_object()?.iter().any(|(id, item)| {
            (item["holder"] == PIP && (cloth_given || id != "cloth")) || item["holder"] == "lamp"
        })
        || !world["log"].as_array()?.iter().any(|event| {
            event["actorId"] == PIP
                && event["kind"] == "action"
                && event["generated"] != true
                && event["itemId"].is_null()
                && opening_station_move::move_event(event, 2, "pond", STATION)
        })
    {
        return None;
    }
    let trials = world["memories"][PIP]["learning"].as_array()?;
    match (turn, trials.as_slice()) {
        (3, [ask]) => confirm_pond_ask_trial(world, ask, 1),
        (4, [ask, wait])
            if wait["turn"] == 3
                && wait["goal"] == ask["goal"]
                && wait["action"]["kind"] == "wait" =>
        {
            confirm_pond_ask_trial(world, ask, 1)
        }
        (6 | 8..=11, trials) => cloth_wait_receipt(world, geo, trials),
        _ => None,
    }
}

fn keeper_wait(world: &Value, geo: &Geography<'_>, turn: u64) -> Option<()> {
    let keeper = &world["actors"][KEEPER];
    if matches!(turn, 8..=11) {
        let completed = &keeper["completedQuest"];
        if keeper["place"] != STATION
            || !keeper["want"].is_null()
            || keeper["content"] != true
            || completed["by"] != VALE
            || completed["turn"] != 7
            || completed["want"]["target"] != POND
            || completed["want"]["step"]["verb"] != "call"
            || completed["want"]["step"]["crossing"] != "pond-greek-harbor"
        {
            return None;
        }
        opening_hub_residents::held_at_home(world, geo, KEEPER, "oil")
    } else {
        (keeper["want"]["step"]["verb"] == "call").then_some(())?;
        opening_hub_residents::at_home(world, geo, KEEPER, "oil")
    }
}

pub(super) fn settle(
    world: &mut Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    deck: &Deck<'_>,
    residents: &[&str],
) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    if matches!(turn, 8..=11) {
        match turn {
            8 | 9 => {
                let (phase, destination) = if turn == 8 {
                    opening_pond_ship_board::arrival(world)?;
                    ("docked", None)
                } else {
                    course_before_sailing(world)?;
                    ("course", Some("greek-harbor"))
                };
                if world["transports"][SHIP]
                    != json!({"version":3,"phase":phase,"dock":POND,"destination":destination,"riders":[],"since":turn,"recall":null})
                {
                    return None;
                }
            }
            10 => {
                opening_pond_ship_wait::before_docking(world)?;
            }
            _ => {
                let primary = opening_pond_ship_disembark::arrival_event(world)?;
                let actors = [
                    PIP, KEEPER, ADA, "ash", "mara", "nell", "orin", "rue", "tavi",
                ];
                if world["eventSeq"] != primary["seq"]
                    || world["log"].as_array()?.last()? != primary
                    || residents.len() != actors.len()
                    || actors.iter().any(|id| !residents.contains(id))
                    || !harbor_transport(world, follows_ashore(primary)?)
                {
                    return None;
                }
            }
        }
        if world["actors"][VALE]["heldItem"] != "cloth"
            || world["crossings"]["pond-greek-harbor"]
                != json!({"discovered":true,"method":"pond-lamp"})
        {
            return None;
        }
    } else {
        opening_station_move::departure_turn(world)?;
    }
    if (!world["began"].is_null() && world["began"] != 0)
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || !opening_station_move::quiet_opening(world)
        || !world["disabledPacks"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || world["items"]["bell"]["holder"] != STATION
        || world["items"]["bell"]["ringing"] != 0
        || geo.entity_active(world, "boardyai")?
        || ![PIP, KEEPER].iter().all(|id| residents.contains(id))
        || geo.packs().any(|pack| {
            pack["transports"]
                .as_object()
                .is_some_and(|ships| ships.values().any(|ship| ship["place"] == STATION))
        })
    {
        return None;
    }
    pip_dwells(world, geo, turn)?;
    keeper_wait(world, geo, turn)?;
    opening_crossings::no_crossing_unlocks(world, geo)?;
    let seq = world["eventSeq"].as_u64()?;
    opening_second_round::settle_visitors(world, geo, authored, order, evidence, deck, residents)?;
    if turn == 11 {
        return ship_disembark_head(world).map(|_| ());
    }
    (world["eventSeq"] == seq).then_some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let working = request.get("world")?;
    let from = match (request["op"].as_str()?, working["turn"].as_u64()?) {
        ("opening_ship_board_residents", 8) => POND,
        ("opening_ship_course_residents", 9) => SHIP,
        ("opening_ship_wait_residents", 10) => SHIP,
        ("opening_ship_disembark_residents", 11) => SHIP,
        ("opening_station_departure_residents", 3 | 4 | 6) => STATION,
        _ => return None,
    };
    let order = opening_roster::actor_order(request, working)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let known = opening_roster::known_actors(working, &geo, &order, None)?;
    let residents = opening_roster::residents_at(working, &geo, &known, from)?;
    let mut world = working.clone();
    let deck = Deck::new(&world, &geo)?;
    settle(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
