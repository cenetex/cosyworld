use super::{
    authored_order::Order,
    opening_content, opening_crossings, opening_full_wait, opening_hub_residents,
    opening_pickups::{self, Custody},
    opening_resident_sleep, opening_roster, opening_station_move, opening_visitor_play,
    opening_wait_response,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    seed, Geography,
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

fn after_vale(world: &Value) -> Option<u64> {
    let seq = opening_station_move::arrival(world)?;
    let turn = world["turn"].as_u64()?;
    let log = world["log"].as_array()?;
    let primary = log.last()?;
    if world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || world["actors"][VALE]["visited"] != json!(["attic", POND, STATION])
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || !world["disabledPacks"].is_null()
        || world["eventSeq"] != seq
        || primary["seq"] != seq
        || !opening_wait_response::vale_action(primary)
        || world["arrival"] != json!({"seq":seq,"fromLocationId":POND,"locationId":STATION})
    {
        return None;
    }
    let landing_seq = log
        .iter()
        .find(|entry| opening_wait_response::vale_action(entry) && entry["verb"] == "move")?["seq"]
        .as_u64()?;
    log.iter()
        .any(|entry| {
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
        .then_some(turn)
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

fn scheduled_sleep(actor: &Value, place: &str) -> Option<bool> {
    let sleep = &actor["sleeping"];
    if sleep.is_null() {
        return Some(false);
    }
    (sleep["since"] == 481 && sleep["place"] == place && sleep["until"].as_u64()? >= 482)
        .then_some(true)
}

fn confirm_historic_visitor(
    world: &mut Value,
    geo: &Geography<'_>,
    avatar: &Value,
    custody: &Custody,
) -> Option<()> {
    let actor = avatar["id"].as_str()?;
    if actor == VALE || !geo.entity_active(world, actor)? {
        return Some(());
    }
    let person = world["actors"].get(actor)?;
    let home = avatar["home"]["id"].as_str()?;
    let item = avatar["item"]["id"].as_str()?;
    if !geo.visiting_resident(world, actor) || person["place"] != home {
        return None;
    }
    if scheduled_sleep(person, home)? {
        return Some(());
    }
    let home_is_empty = !world["actors"]
        .as_object()?
        .iter()
        .any(|(id, person)| id != actor && person["place"] == home);
    if person["heldItem"] != item
        || world["items"][item]["holder"] != actor
        || !custody.can_transfer_one(actor, home)
        || !geo.entity_active(world, item)?
        || !world["placeCard"][home].is_null()
        || !world["defeats"][actor].is_null()
        || !world["memories"][actor]["learning"].is_null()
        || ["homeward", "attend", "guarding", "under"]
            .iter()
            .any(|field| !person[*field].is_null())
        || opening_pickups::resting(person, 482)
        || person["dwellUntil"]
            .as_u64()
            .is_some_and(|until| until > 482)
        || world["peaceUntil"][actor].as_u64()? > 482
        || opening_pickups::another_way(geo, home)?
        || !home_is_empty
    {
        return None;
    }
    opening_visitor_play::home_destination(world, geo, actor, home)?
        .is_none()
        .then_some(())
}

pub(super) fn confirm_historic_idle(
    world: &mut Value,
    geo: &Geography<'_>,
    order: &[&str],
) -> Option<()> {
    let arrival = opening_station_move::historic_arrival(world)?;
    let primary = world["log"].as_array()?.last()?;
    if world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || world["actors"][VALE]["visited"] != json!(["attic", POND, STATION])
        || geo.files()["v2/card-game/world-history.json"]["turns"] != world["began"]
        || !world["standoffs"].as_array()?.is_empty()
        || world["conversations"]
            .as_array()?
            .iter()
            .any(|record| record["turn"].as_u64().is_none_or(|turn| turn >= 482))
        || !world["disabledPacks"].is_null()
        || world["eventSeq"] != arrival
        || primary["seq"] != arrival
        || !opening_wait_response::vale_action(primary)
        || ![VALE, PIP, CLOTH]
            .iter()
            .all(|id| entries(&primary["witnesses"]).any(|witness| witness == *id))
        || world["items"]["lamp"]["holder"] != VALE
        || world["items"]["lamp"]["lit"] != false
        || world["items"]["lamp"]["fuelPlace"] != STATION
        || world["items"]["bell"]["holder"] != STATION
        || world["items"]["bell"]["ringing"] != 0
        || world["actors"][KEEPER]["place"] != STATION
        || world["actors"][KEEPER]["want"]["step"]["verb"] != "call"
        || geo.entity_active(world, "boardyai")?
    {
        return None;
    }
    opening_resident_sleep::sleeping_pip_at_pond(world, geo, arrival)?;
    let cast = opening_roster::known_actors(world, geo, order, Some(STATION))?;
    if cast.len() != 2 || !cast.contains(&VALE) || !cast.contains(&KEEPER) {
        return None;
    }
    if !scheduled_sleep(&world["actors"][KEEPER], STATION)? {
        opening_hub_residents::at_home(world, geo, KEEPER, "oil")?;
    }
    opening_crossings::no_crossing_unlocks(world, geo)?;
    let custody = Custody::new(world)?;
    for avatar in geo.files()["v2/card-game/shared-cast.json"]["avatars"].as_array()? {
        confirm_historic_visitor(world, geo, avatar, &custody)?;
    }
    Some(())
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
    let mut world = saved.clone();
    if world.get("began").is_some() {
        confirm_historic_idle(&mut world, &geo, &order)?;
    } else {
        let evidence = ResidentEvidence::new(&files)?;
        settle(&mut world, &geo, &authored, &order, &evidence)?;
    }
    Some(json!({"ok":true,"world":world}))
}
