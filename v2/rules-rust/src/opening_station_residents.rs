use super::{
    authored_order::Order, opening_content, opening_crossings, opening_full_wait,
    opening_hub_residents, opening_pickups, opening_roster, opening_wait_response,
    pack_state::Catalog, resident_evidence::ResidentEvidence, seed, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const POND: &str = "pond";
const STATION: &str = "station";
const CLOTH: &str = "cloth";

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn travel(entry: &Value, turn: u64, from: &str, to: &str) -> bool {
    entry["verb"] == "move"
        && entry["turn"] == turn
        && entry["fromLocationId"] == from
        && entry["locationId"] == to
        && entry["targetId"] == to
        && (entry["itemId"].is_null() || entry["itemId"] == "lamp")
}

fn after_vale(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    let log = world["log"].as_array()?;
    let primary = log.last()?;
    let seq = primary["seq"].as_u64()?;
    if !matches!(turn, 2 | 3)
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world.get("began").is_some_and(|began| began != 0)
        || world["opening"]["crossed"] != true
        || world["opening"]["met"][PIP] != turn - 1
        || world["opening"]["met"][KEEPER] != turn
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || world["actors"][VALE]["place"] != STATION
        || world["actors"][VALE]["visited"] != json!(["attic", POND, STATION])
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || ["hidden", "absent", "gone", "disabledPacks", "invitedPlaces"]
            .iter()
            .any(|key| !world[*key].is_null())
        || world["eventSeq"] != seq
        || world["arrival"] != json!({"seq":seq,"fromLocationId":POND,"locationId":STATION})
        || !opening_wait_response::vale_action(primary)
        || !travel(primary, turn, POND, STATION)
    {
        return None;
    }
    let mut plays = log
        .iter()
        .filter(|entry| opening_wait_response::vale_action(entry));
    if turn == 3 {
        let wait = plays.next()?;
        if !opening_wait_response::ordinary_attic_wait(wait) || wait["turn"] != 1 {
            return None;
        }
    }
    let landing = plays.next()?;
    let landing_seq = landing["seq"].as_u64()?;
    if !travel(landing, turn - 1, "attic", POND)
        || plays.next()? != primary
        || plays.next().is_some()
        || !log.iter().any(|entry| {
            entry["turn"] == turn - 1
                && entry["seq"]
                    .as_u64()
                    .is_some_and(|n| landing_seq < n && n < seq)
                && entry["kind"] == "action"
                && entry["actorId"] == PIP
                && entry["verb"] == "ask"
                && entry["itemId"] == "lamp"
                && entry["targetId"] == VALE
                && entry["accepted"] == false
        })
    {
        return None;
    }
    Some(turn)
}

fn quiet_residents(world: &Value, geo: &Geography, turn: u64) -> Option<()> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    let definition = &forest["people"][PIP];
    let pip = &world["actors"][PIP];
    let lamp = &world["items"]["lamp"];
    let mut want = definition["want"].as_object()?.clone();
    want.insert("since".into(), 0.into());
    want.insert("refusals".into(), 1.into());
    if definition["home"] != POND
        || definition["travels"] == false
        || !definition["stops"].is_null()
        || definition["want"] != json!({"kind":"item","target":"lamp","lit":true})
        || pip["want"] != Value::Object(want)
        || pip["place"] != POND
        || pip["lastTalk"] != turn - 1
        || pip["visited"] != json!([POND])
        || pip["heldItem"] != CLOTH
        || [
            "sleeping",
            "homeward",
            "attend",
            "under",
            "guarding",
            "dwellUntil",
        ]
        .iter()
        .any(|key| !pip[*key].is_null())
        || opening_pickups::resting(pip, turn)
        || world["peaceUntil"][PIP] != 0
        || !world["defeats"][PIP].is_null()
        || world["items"][CLOTH]["holder"] != PIP
        || world["items"]
            .as_object()?
            .iter()
            .any(|(id, item)| (item["holder"] == PIP && id != CLOTH) || item["holder"] == CLOTH)
        || lamp["holder"] != VALE
        || lamp["lit"] != false
        || lamp["fuelPlace"] != STATION
        || forest["people"][KEEPER]["home"] != STATION
        || world["actors"][KEEPER]["want"]["step"]["verb"] != "call"
        || !world["defeats"][KEEPER].is_null()
        || world["items"]["bell"]["holder"] != STATION
        || world["items"]["bell"]["ringing"] != 0
        || geo.base_exits(POND)? != [json!(STATION)]
        || !geo.entity_active(world, STATION)?
        || !geo.entity_active(world, PIP)?
        || !geo.entity_active(world, CLOTH)?
        || !geo.entity_active(world, "lamp")?
        || entries(&geo.files()["v2/card-game/world-life.json"]["guardable"])
            .any(|way| way["from"] == POND && way["to"] == STATION)
        || geo.packs().any(|pack| {
            [PIP, KEEPER]
                .iter()
                .any(|id| pack["avatars"].get(*id).is_some())
                || ["lamp", CLOTH, "oil", "bell"]
                    .iter()
                    .any(|id| pack["items"].get(*id).is_some())
                || entries(&pack["choices"]).any(|choice| {
                    choice["at"] == STATION
                        && matches!(choice["on"].as_str(), Some("wait" | "meet"))
                })
                || pack["transports"].as_object().is_some_and(|ships| {
                    ships
                        .values()
                        .any(|ship| ship["place"] == STATION || ship["place"] == POND)
                })
        })
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        let other = (actor["place"] == STATION && ![VALE, KEEPER].contains(&id.as_str()))
            || (actor["place"] == POND && id != PIP);
        if other && geo.entity_active(world, id)? {
            return None;
        }
    }
    opening_hub_residents::at_home(world, geo, KEEPER, "oil")
}

pub(super) fn settle(
    world: &mut Value,
    geo: &Geography,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<()> {
    let turn = after_vale(world)?;
    quiet_residents(world, geo, turn)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let name = forest["people"][PIP]["name"].as_str()?;
    let station = forest["places"][STATION]["name"].as_str()?;
    let mut witnesses = vec![PIP];
    witnesses.extend(opening_full_wait::visible_items(
        world, geo, authored, POND,
    )?);
    let pip = world["actors"][PIP].as_object_mut()?;
    let dwell = turn + 24 + u64::from(seed::hash(&format!("{PIP}@{turn}")) % 6);
    pip.insert("place".into(), json!(STATION));
    pip.insert("dwellUntil".into(), json!(dwell));
    let cloth = world["items"][CLOTH]["history"].as_array_mut()?;
    cloth.push(json!(format!(
        "Turn {turn}: {name} carried it to {station}."
    )));
    cloth.drain(..cloth.len().saturating_sub(12));
    opening_crossings::no_crossing_unlocks(world, geo)?;
    let cast = opening_roster::known_actors(world, geo, order, Some(STATION))?;
    let items = opening_full_wait::visible_items(world, geo, authored, STATION)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":PIP,
        "locationId":STATION, "fromLocationId":POND, "targetId":STATION, "itemId":null,
        "witnesses":witnesses, "text":format!("{name} goes to {station}."),
    });
    evidence.record(world, &cast, &items, detail, true)?;
    world["actors"][PIP]["visited"]
        .as_array_mut()?
        .push(json!(STATION));
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let order = opening_roster::actor_order(request, saved)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = saved.clone();
    settle(&mut world, &geo, &authored, &order, &evidence)?;
    Some(json!({"ok":true,"world":world}))
}
