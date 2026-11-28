use super::{
    authored_order::Order, lamp_state, opening, opening_content, opening_crossings,
    opening_drop::ground_lamp, opening_full_wait::visible_items, opening_held_items,
    opening_pickups::item_as_named, opening_pond_call_view::cloth_arrival,
    opening_pond_view::pond_paths, opening_station_view::keeper_want_from_read,
    pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const LAMP: &str = "lamp";
const CLOTH: &str = "cloth";
const KEY: &str = "ratiradio-station-key";
const SIGNAL: &str = "pond-greek-harbor";

fn drop_world(request: &Value) -> Option<&Value> {
    let world = request.get("world")?;
    let action = &request["action"];
    (request["actor"] == VALE
        && request["claimed"] == json!([VALE])
        && request["present"] == json!([VALE])
        && request["selectedIds"].is_null()
        && (request["revision"].is_null() || request["revision"] == world["revision"])
        && (request["elysiumPortraits"].is_null() || request["elysiumPortraits"] == json!([]))
        && action["kind"] != "pack"
        && action.as_str().or_else(|| action["key"].as_str()) == Some("drop:vale:lamp:pond"))
    .then_some(world)
}

fn drop_text(geo: &Geography<'_>) -> Option<String> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    let vale = forest["people"][VALE]["name"].as_str()?;
    let lamp = item_as_named(forest["things"][LAMP]["name"].as_str()?);
    let pond = forest["places"][POND]["name"].as_str()?;
    Some(format!("{vale} puts {lamp} in {pond}."))
}

fn quiet_cloth(world: &Value, geo: &Geography<'_>, arrival: u64) -> Option<()> {
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    if world["eventSeq"] != arrival
        || world["log"].as_array()?.last()?["seq"] != arrival
        || vale["place"] != POND
        || vale["heldItem"] != CLOTH
        || !vale["under"].is_null()
        || !vale["sleeping"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["disabledPacks"].is_null()
        || !world["pondLampLoan"].is_null()
        || world["items"][CLOTH]["holder"] != VALE
        || world["items"][KEY]["holder"] != POND
        || world["life"]["actors"][VALE]["attachments"][CLOTH] != json!({"from":"moth","turn":5})
        || actors.get("moth")?["place"] != "station"
        || actors.get("keeper")?["place"] != "station"
        || !geo.entity_active(world, CLOTH)?
        || !geo.entity_active(world, LAMP)?
    {
        return None;
    }
    for (id, actor) in actors {
        if id != VALE && actor["place"] == POND && geo.entity_active(world, id)? {
            return None;
        }
    }
    Some(())
}

fn quiet_items<'a>(
    world: &Value,
    geo: &Geography<'_>,
    authored: &'a Order,
) -> Option<Vec<&'a str>> {
    let items = visible_items(world, geo, authored, POND)?;
    ([CLOTH, LAMP, KEY].iter().all(|item| items.contains(item))
        && items
            .iter()
            .all(|id| matches!(*id, CLOTH | LAMP | KEY | "elysium-wayfinder")))
    .then_some(items)
}

pub(super) fn ground(before: &Value, geo: &Geography<'_>, authored: &Order) -> Option<Value> {
    let (arrival, read) = cloth_arrival(before, false)?;
    let lamp = &before["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    if before["turn"] != 6
        || before["actors"][VALE]["want"] != keeper_want_from_read(before, geo, read)?
        || lamp["holder"] != VALE
        || lamp["lit"] != false
        || fuel.fuel_place != POND
        || fuel.fuel_visit
        || !matches!(fuel.fuel_rooms, 0 | 3)
        || lamp["fuel"] != fuel.fuel_rooms * 4
    {
        return None;
    }
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > opening::MAX_REVISION {
        return None;
    }
    quiet_cloth(before, geo, arrival)?;
    quiet_items(before, geo, authored)?;
    pond_paths(before, geo)?;
    opening_crossings::no_crossing_unlocks(before, geo)?;
    let hands = opening_held_items::snapshot(before, geo)?;
    let mut world = before.clone();
    world["turn"] = json!(7);
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let actor = world["actors"][VALE].as_object_mut()?;
    actor.remove("guarding");
    actor.remove("offered");
    ground_lamp(&mut world, POND, &drop_text(geo)?)?;
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    Some(world)
}

pub(super) fn record(
    world: &mut Value,
    geo: &Geography<'_>,
    authored: &Order,
    evidence: &ResidentEvidence,
) -> Option<()> {
    let (arrival, read) = cloth_arrival(world, false)?;
    quiet_cloth(world, geo, arrival)?;
    let lamp = &world["items"][LAMP];
    let lit = lamp["lit"].as_bool()?;
    let room_fuel = if lit { 2 } else { 0 };
    if world["turn"] != 7
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|field| world[*field] != json!([VALE]))
        || lamp["holder"] != POND
        || lamp["fuelPlace"] != POND
        || lamp["fuelVisit"] != lit
        || lamp["fuelRooms"] != room_fuel
        || lamp["fuel"] != room_fuel * 4
        || world["crossings"][SIGNAL]["discovered"] != lit
    {
        return None;
    }
    if lit {
        let done = &world["actors"]["keeper"]["completedQuest"];
        if !world["actors"][VALE]["want"].is_null()
            || done["by"] != VALE
            || done["turn"] != 7
            || done["want"]["step"]["crossing"] != SIGNAL
            || world["transports"]["greek-ship"]["dock"] != POND
        {
            return None;
        }
    } else if world["actors"][VALE]["want"] != keeper_want_from_read(world, geo, read)? {
        return None;
    }
    let items = quiet_items(world, geo, authored)?;
    let witnesses: Vec<_> = std::iter::once(VALE).chain(items.iter().copied()).collect();
    let detail = json!({
        "speaker":"World","text":drop_text(geo)?,"kind":"action","actorId":VALE,"verb":"drop",
        "locationId":POND,"fromLocationId":POND,"itemId":LAMP,"targetId":POND,"witnesses":witnesses,
    });
    evidence.record(world, &[VALE], &items, detail, true)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let world = match request["phase"].as_str()? {
        "ground" => ground(drop_world(request)?, &geo, &authored)?,
        "record" => {
            let mut world = request.get("world")?.clone();
            let evidence = ResidentEvidence::new(&files)?;
            record(&mut world, &geo, &authored, &evidence)?;
            world
        }
        _ => return None,
    };
    Some(json!({"ok":true,"world":world}))
}
