use super::{
    authored_order::Order,
    initial_wants::root_in,
    opening::MAX_REVISION,
    opening_content, opening_crossings,
    opening_full_wait::visible_items,
    opening_greek_harbor_view, opening_held_items,
    opening_pickups::item_as_named,
    opening_roster,
    opening_station_move::{departure_witnesses, move_between, move_request},
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const HARBOR: &str = "greek-harbor";
const ROAD: &str = "greek-argolid-road";
const CLOTH: &str = "cloth";
const RECORD: &str = "greek-atreid-record";

pub(super) fn move_world(request: &Value) -> Option<(&Value, bool)> {
    let (world, key) = move_request(request)?;
    let carry = match key {
        "move:vale::greek-argolid-road" => false,
        "move:vale:cloth:greek-argolid-road" => true,
        _ => return None,
    };
    Some((world, carry))
}

pub(super) fn arrival_event(world: &Value) -> Option<&Value> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let event = world["log"]
        .as_array()?
        .iter()
        .rfind(|entry| entry["seq"] == seq)?;
    (world["turn"] == 12
        && world["actors"][VALE]["place"] == ROAD
        && world["actors"][VALE]["crossed"] == 3
        && world["arrival"] == json!({"seq":seq,"fromLocationId":HARBOR,"locationId":ROAD})
        && vale_action(event)
        && move_between(event, 12, HARBOR, ROAD)
        && (event["itemId"].is_null() || event["itemId"] == CLOTH))
        .then_some(event)
}

pub(super) fn departure_head(
    world: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    evidence: &ResidentEvidence,
) -> Option<u64> {
    opening_greek_harbor_view::settled_speech(world, geo, authored, |id| {
        evidence.profile(id)?["name"].as_str()
    })?;
    let lamp = &world["items"]["lamp"];
    if !geo.entity_active(world, ROAD)?
        || !geo.base_exits(HARBOR)?.iter().any(|exit| exit == ROAD)
        || geo.files()["v2/card-game/forest.json"]["homeGates"][HARBOR]["opening"] == true
        || world["opening"]["crossed"] != true
        || world["stationExitOrder"]
            != json!(super::create::station_order(world, geo.files(), geo)?)
        || world["memories"][VALE]["learning"]
            .as_array()
            .is_some_and(|trials| !trials.is_empty())
        || lamp["holder"] != "pond"
        || lamp["fuelPlace"] != "pond"
        || lamp["fuel"] != 8
        || lamp["fuelRooms"] != 2
        || lamp["fuelVisit"] != true
        || lamp["lit"] != true
    {
        return None;
    }
    for pack in geo.packs() {
        let id = pack["id"].as_str()?;
        if pack["places"][ROAD]["sanctuary"] == true
            || pack["crossings"]
                .as_array()?
                .iter()
                .any(|edge| edge["from"] == HARBOR && edge["to"] == ROAD)
            || pack["choices"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|choice| {
                    (choice["on"] == "meet" && (choice["at"].is_null() || choice["at"] == ROAD))
                        || (choice["on"] == "hold" && choice["subject"] == CLOTH)
                })
            || world["packs"][id]["recitals"]
                .as_object()
                .into_iter()
                .flatten()
                .any(|(_, record)| record["actor"] == VALE && record["visit"].is_null())
        {
            return None;
        }
    }
    let items = world["items"].as_object()?;
    for id in items.keys().filter(|id| id.as_str() != CLOTH) {
        if root_in(items, id)? == VALE {
            return None;
        }
    }
    world["eventSeq"].as_u64()
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
    let previous = departure_head(before, geo, authored, evidence)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let vale = evidence.profile(VALE)?["name"].as_str()?;
    let road = evidence.profile(ROAD)?["name"].as_str()?;
    let text = if carry {
        let cloth = item_as_named(evidence.profile(CLOTH)?["name"].as_str()?);
        format!("{vale} carries {cloth} to {road}.")
    } else {
        format!("{vale} goes to {road}.")
    };
    let mut world = before.clone();
    world["turn"] = json!(12);
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let prepared = prepare(&world)?;
    let witnesses = departure_witnesses(&world, geo, authored, HARBOR)?;
    let hands = opening_held_items::snapshot(&world, geo)?;
    world["actors"][VALE]["place"] = json!(ROAD);
    world["actors"][VALE]["visited"]
        .as_array_mut()?
        .push(json!(ROAD));
    let history = world["items"][CLOTH]["history"].as_array_mut()?;
    history.push(json!(format!("Turn 12: {vale} carried it to {road}.")));
    history.drain(..history.len().saturating_sub(12));
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    opening_crossings::no_crossing_unlocks(&world, geo)?;
    let cast = opening_roster::known_actors(&world, geo, order, Some(ROAD))?;
    let items = visible_items(&world, geo, authored, ROAD)?;
    if cast != [VALE] || items != [RECORD, CLOTH] || world["items"][RECORD]["holder"] != ROAD {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && actor["place"] == ROAD && geo.entity_active(&world, id)? {
            return None;
        }
    }
    let detail = json!({"speaker":"World","kind":"action","verb":"move","actorId":VALE,"text":text,
        "locationId":ROAD,"fromLocationId":HARBOR,"witnesses":witnesses,
        "itemId":carry.then_some(CLOTH),"targetId":ROAD});
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] = json!({"seq":world["eventSeq"],"fromLocationId":HARBOR,"locationId":ROAD});
    if arrival_event(&world)?["seq"] != previous.checked_add(1)? {
        return None;
    }
    Some((world, prepared))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, carry) = move_world(request)?;
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
