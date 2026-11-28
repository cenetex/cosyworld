use super::{
    authored_order::Order, opening_content, opening_crossings, opening_hub_residents,
    opening_pickups, opening_place_cards::Deck, opening_pond_call_view::cloth_arrival,
    opening_roster, opening_second_round, opening_station_move,
    opening_station_quest_drop_learning::confirm_pond_ask_trial,
    opening_station_read::keeper_want_from_read, pack_state::Catalog,
    resident_evidence::ResidentEvidence, seed, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const STATION: &str = "station";

fn cloth_wait_receipt(world: &Value, geo: &Geography<'_>, trials: &[Value]) -> Option<()> {
    let (arrival, read) = cloth_arrival(world, false)?;
    let [ask, wait, gift] = trials else {
        return None;
    };
    let goal = json!({"kind":"ask","target":VALE,"item":"lamp","destination":null});
    let gift_seq = gift["seq"].as_u64()?;
    if world["eventSeq"] != arrival
        || world["actors"][VALE]["want"] != keeper_want_from_read(world, geo, read)?
        || world["life"]["actors"][VALE]["attachments"] != json!({"cloth":{"from":PIP,"turn":5}})
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
    let cloth_given = turn == 6;
    let hand = if cloth_given {
        Value::Null
    } else {
        json!("cloth")
    };
    let cloth_holder = if cloth_given { VALE } else { PIP };
    let dwell = 2 + 24 + u64::from(seed::hash("moth@2") % 6);
    if pip["place"] != STATION
        || pip["heldItem"] != hand
        || pip["want"] != json!({"kind":"item","target":"lamp","since":0,"refusals":1,"lit":true})
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
        || lamp["holder"] != VALE
        || lamp["fuelPlace"] != world["actors"][VALE]["place"]
        || lamp["lit"] != false
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
        (6, trials) => cloth_wait_receipt(world, geo, trials),
        _ => None,
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
    let turn = opening_station_move::departure_turn(world)?;
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
        || world["actors"][KEEPER]["want"]["step"]["verb"] != "call"
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
    opening_hub_residents::at_home(world, geo, KEEPER, "oil")?;
    opening_crossings::no_crossing_unlocks(world, geo)?;
    let seq = world["eventSeq"].as_u64()?;
    opening_second_round::settle_visitors(world, geo, authored, order, evidence, deck, residents)?;
    (world["eventSeq"] == seq).then_some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let working = request.get("world")?;
    let order = opening_roster::actor_order(request, working)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let known = opening_roster::known_actors(working, &geo, &order, None)?;
    let residents = opening_roster::residents_at(working, &geo, &known, STATION)?;
    let mut world = working.clone();
    let deck = Deck::new(&world, &geo)?;
    settle(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
