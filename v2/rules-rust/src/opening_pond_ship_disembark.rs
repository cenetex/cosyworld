use super::{
    authored_order::Order,
    initial_wants::root_in,
    opening::MAX_REVISION,
    opening_content, opening_crossings,
    opening_full_wait::visible_items,
    opening_held_items,
    opening_pickups::item_as_named,
    opening_pond_ship_view, opening_pond_ship_wait,
    opening_reflection::{trim_text, valid_text},
    opening_roster,
    opening_station_move::{self, departure_witnesses, quiet_opening},
    opening_visitor_routes,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const SHIP: &str = "greek-ship";
const HARBOR: &str = "greek-harbor";
const BERTH: &str = "greek-harbor-pond";
const MYRTO: &str = "greek-shipmaster";
const CLOTH: &str = "cloth";

pub(super) fn disembark_world(request: &Value) -> Option<(&Value, bool)> {
    let (world, key) = opening_station_move::move_request(request)?;
    let carried = match key {
        "move:vale::greek-harbor" => false,
        "move:vale:cloth:greek-harbor" => true,
        _ => return None,
    };
    Some((world, carried))
}

pub(super) fn arrival_event(world: &Value) -> Option<&Value> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let event = world["log"]
        .as_array()?
        .iter()
        .rfind(|event| event["seq"] == seq)?;
    (world["turn"] == 11
        && world["actors"][VALE]["place"] == HARBOR
        && world["actors"][VALE]["crossed"] == 3
        && world["arrival"] == json!({"seq":seq,"fromLocationId":SHIP,"locationId":HARBOR})
        && vale_action(event)
        && opening_station_move::move_between(event, 11, SHIP, HARBOR)
        && (event["itemId"].is_null() || event["itemId"] == CLOTH))
        .then_some(event)
}

fn authored_berth(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let (pack, crossing) = geo.packs().find_map(|pack| {
        let crossing = pack["crossings"]
            .as_array()?
            .iter()
            .find(|crossing| crossing["from"] == HARBOR && crossing["transport"] == SHIP)?;
        Some((pack, crossing))
    })?;
    (pack["id"] == "greek-drama"
        && pack["transports"][SHIP]["place"] == SHIP
        && pack["transports"][SHIP]["docks"]
            .as_array()?
            .iter()
            .any(|dock| dock == HARBOR)
        && crossing["id"] == BERTH
        && crossing["to"] == "pond"
        && crossing["requires"] == json!([])
        && crossing["retired"] != true
        && crossing["signal"].is_null()
        && crossing["unlockWhen"].is_null()
        && world["crossings"][BERTH] == json!({"discovered":false})
        && opening_visitor_routes::crossing_open(world, geo, VALE, "greek-drama", crossing)?
        && !geo.base_exits(SHIP)?.iter().any(|place| place == HARBOR)
        && geo.entity_active(world, SHIP)?)
    .then_some(())
}

fn quiet_harbor(world: &Value, geo: &Geography<'_>) -> Option<()> {
    for pack in geo.packs() {
        let id = pack["id"].as_str()?;
        if pack["places"][HARBOR]["sanctuary"] == true
            || world["packs"][id]["recitals"]
                .as_object()
                .into_iter()
                .flatten()
                .any(|(_, record)| record["actor"] == VALE && record["visit"].is_null())
            || pack["choices"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|choice| {
                    (choice["on"] == "meet" && (choice["at"].is_null() || choice["at"] == HARBOR))
                        || (choice["on"] == "depart" && choice["subject"] == VALE)
                        || (choice["on"] == "hold" && choice["subject"] == CLOTH)
                })
        {
            return None;
        }
    }
    Some(())
}

fn ready(
    world: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    evidence: &ResidentEvidence,
) -> Option<Vec<&'static str>> {
    let docking = opening_pond_ship_wait::docking_event(world)?;
    let log = world["log"].as_array()?;
    let head = log.last()?;
    let vale = &world["actors"][VALE];
    let lamp = &world["items"]["lamp"];
    let ship = &world["transports"][SHIP];
    let riders = opening_pond_ship_wait::riders(world, geo)?;
    let sea_edges = json!([
        ["sea:greek-harbor", "sea:pond"],
        ["sea:pond", "sea:greek-harbor"]
    ]);
    if head["seq"] != world["eventSeq"]
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || !quiet_opening(world)
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || world["stationExitOrder"]
            != json!(super::create::station_order(world, geo.files(), geo)?)
        || world["opening"]["crossed"] != true
        || world["opening"]["met"][VALE] != 0
        || world["opening"]["met"].get(MYRTO).is_some()
        || world["packs"]["greek-drama"]["met"].get(MYRTO).is_some()
        || world["actors"][MYRTO]["place"] != HARBOR
        || world["items"][CLOTH]["holder"] != VALE
        || vale["heldItem"] != CLOTH
        || vale["crossed"] != 2
        || vale["visited"] != json!(["attic", "pond", "station", SHIP])
        || !vale["want"].is_null()
        || !vale["sleeping"].is_null()
        || !vale["under"].is_null()
        || vale["waitSpeech"] != json!({"place":SHIP,"turn":10})
        || world["memories"][VALE]["learning"]
            .as_array()
            .is_some_and(|trials| !trials.is_empty())
        || !super::opening_pond_lamp_drop::grounded_fuel(lamp)?
        || ship["version"] != 3
        || !ship["destination"].is_null()
        || !ship["recall"].is_null()
        || ship["riders"] != json!(riders)
        || riders
            .iter()
            .any(|id| world["routeKnowledge"][id] != sea_edges)
        || visible_items(world, geo, authored, SHIP)? != [CLOTH]
    {
        return None;
    }
    if head != docking {
        opening_pond_ship_view::settled_speakers(world, geo, |id| {
            evidence.profile(id)?["name"].as_str()
        })?;
        let offset = log.iter().rposition(|line| line == docking)?;
        if log.get(offset + 1..)?.iter().any(|line| {
            !line["text"]
                .as_str()
                .is_some_and(|text| valid_text(text, 600) && trim_text(text) == text)
                || line.get("witnesses").is_some()
                || line.get("verb").is_some()
        }) {
            return None;
        }
    }
    let items = world["items"].as_object()?;
    for id in items.keys().filter(|id| id.as_str() != CLOTH) {
        if root_in(items, id)? == VALE {
            return None;
        }
    }
    authored_berth(world, geo)?;
    quiet_harbor(world, geo)?;
    Some(riders)
}

pub(super) fn begin_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    carry: bool,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    let mut remaining = ready(before, geo, authored, evidence)?;
    remaining.retain(|&id| id != VALE);
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let vale = evidence.profile(VALE)?["name"].as_str()?;
    let harbor = evidence.profile(HARBOR)?["name"].as_str()?;
    let text = if carry {
        let cloth = item_as_named(evidence.profile(CLOTH)?["name"].as_str()?);
        format!("{vale} carries {cloth} ashore at {harbor}.")
    } else {
        format!("{vale} disembarks at {harbor}.")
    };
    let mut world = before.clone();
    world["turn"] = json!(11);
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let actor = world["actors"][VALE].as_object_mut()?;
    actor.remove("offered");
    actor.remove("guarding");
    let prepared = prepare(&world)?;
    let witnesses = departure_witnesses(&world, geo, authored, SHIP)?;
    let hands = opening_held_items::snapshot(&world, geo)?;
    world["actors"][VALE]["place"] = json!(HARBOR);
    world["actors"][VALE]["crossed"] = json!(3);
    world["actors"][VALE]["visited"]
        .as_array_mut()?
        .push(json!(HARBOR));
    world["crossings"][BERTH]["discovered"] = json!(true);
    world["transports"][SHIP]["riders"] = json!(remaining);
    if remaining.is_empty() {
        world["transports"][SHIP]["phase"] = json!("docked");
        world["transports"][SHIP]["since"] = json!(11);
    }
    let history = world["items"][CLOTH]["history"].as_array_mut()?;
    history.push(json!(format!("Turn 11: {vale} carried it to {harbor}.")));
    history.drain(..history.len().saturating_sub(12));
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    opening_crossings::no_crossing_unlocks(&world, geo)?;
    world["opening"]["met"]
        .as_object_mut()?
        .insert(MYRTO.into(), json!(11));
    world["packs"]["greek-drama"]["met"]
        .as_object_mut()?
        .insert(MYRTO.into(), json!(11));
    let cast = opening_roster::known_actors(&world, geo, order, Some(HARBOR))?;
    let items = visible_items(&world, geo, authored, HARBOR)?;
    if cast.len() != 2 || !cast.contains(&VALE) || !cast.contains(&MYRTO) || items.contains(&"lamp")
    {
        return None;
    }
    let detail = json!({"speaker":"World","kind":"action","verb":"move","actorId":VALE,"text":text,
        "locationId":HARBOR,"fromLocationId":SHIP,"witnesses":witnesses,
        "itemId":carry.then_some(CLOTH),"targetId":HARBOR});
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] = json!({"seq":world["eventSeq"],"fromLocationId":SHIP,"locationId":HARBOR});
    arrival_event(&world)?;
    Some((world, prepared))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, carry) = disembark_world(request)?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (world, ()) = begin_with(before, &geo, &authored, &order, &evidence, carry, |_| {
        Some(())
    })?;
    Some(json!({"ok":true,"world":world}))
}
