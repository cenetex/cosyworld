use super::{
    authored_order::Order,
    opening::{self, MAX_REVISION},
    opening_content, opening_crossings,
    opening_full_wait::visible_items,
    opening_held_items,
    opening_pickups::item_as_named,
    opening_pond_call_view, opening_roster,
    opening_station_move::departure_witnesses,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const SHIP: &str = "greek-ship";
const CLOTH: &str = "cloth";

pub(super) fn boarding_world(request: &Value) -> Option<(&Value, bool)> {
    let world = request.get("world")?;
    let action = &request["action"];
    let carry = match action.as_str().or_else(|| action["key"].as_str())? {
        "move:vale::greek-ship" => false,
        "move:vale:cloth:greek-ship" => true,
        _ => return None,
    };
    (request["actor"] == VALE
        && opening::seats(&request["claimed"])? == [VALE]
        && opening::seats(&request["present"])? == [VALE]
        && request["selectedIds"].is_null()
        && (request["revision"].is_null() || request["revision"] == world["revision"])
        && (request["elysiumPortraits"].is_null() || request["elysiumPortraits"] == json!([]))
        && action["kind"] != "pack")
        .then_some((world, carry))
}

pub(super) fn arrival_event(world: &Value) -> Option<&Value> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let event = world["log"]
        .as_array()?
        .iter()
        .find(|event| event["seq"] == seq)?;
    let vale = &world["actors"][VALE];
    (world["turn"] == 8
        && world["arrival"] == json!({"seq":seq,"fromLocationId":POND,"locationId":SHIP})
        && event["turn"] == 8
        && vale_action(event)
        && event["verb"] == "move"
        && event["fromLocationId"] == POND
        && event["locationId"] == SHIP
        && event["targetId"] == SHIP
        && (event["itemId"].is_null() || event["itemId"] == CLOTH)
        && vale["place"] == SHIP
        && vale["crossed"] == 2
        && vale["visited"] == json!(["attic", POND, "station", SHIP])
        && world["transports"][SHIP]["since"] == 8)
        .then_some(event)
}

pub(super) fn arrival(world: &Value) -> Option<u64> {
    let seq = arrival_event(world)?["seq"].as_u64()?;
    (world["eventSeq"] == seq && world["log"].as_array()?.last()?["seq"] == seq).then_some(seq)
}

fn ada_aboard(world: &Value, geo: &Geography<'_>) -> Option<bool> {
    let actors = world["actors"].as_object()?;
    for (id, actor) in actors {
        if id != "ada" && actor["place"] == SHIP && geo.entity_active(world, id)? {
            return None;
        }
    }
    let ada = actors.get("ada")?;
    if ada["place"] != SHIP {
        return Some(false);
    }
    let walked = world["log"].as_array()?.iter().rev().find(|event| {
        event["actorId"] == "ada" && event["kind"] == "action" && event["generated"] != true
    })?;
    (geo.entity_active(world, "ada")?
        && geo.visiting_resident(world, "ada")
        && ada["crossed"] == 1
        && ada["visited"] == json!(["loft", SHIP])
        && ada["heldItem"].is_null()
        && ada["sleeping"].is_null()
        && world["items"]["shears"]["holder"] == "loft"
        && world["doors"]["loft"] == SHIP
        && world["opening"]["met"].get("ada").is_none()
        && world["packs"]["shared-homes"]["met"].get("ada").is_none()
        && walked["turn"] == 7
        && walked["verb"] == "move"
        && walked["fromLocationId"] == "loft"
        && walked["locationId"] == SHIP
        && walked["targetId"] == SHIP
        && walked["itemId"].is_null()
        && walked["witnesses"] == json!(["ada", "shears"]))
    .then_some(true)
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
    opening_pond_call_view::settled_speech(before, geo)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let pack = geo.packs().find(|pack| pack["id"] == "greek-drama")?;
    if before["turn"] != 7
        || before["life"]["actors"][VALE]["attachments"]
            != json!({"cloth":{"from":"moth","turn":5}})
        || !before["conversations"].as_array()?.is_empty()
        || forest["homeGates"][POND]["opening"] == true
        || geo.base_exits(POND)?.iter().any(|exit| exit == SHIP)
        || pack["transports"][SHIP]["place"] != SHIP
        || pack["places"][SHIP]["sanctuary"] == true
        || geo.packs().any(|pack| {
            pack["choices"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|choice| {
                    choice["on"] == "meet" && (choice["at"].is_null() || choice["at"] == SHIP)
                })
        })
        || !visible_items(before, geo, authored, SHIP)?.is_empty()
    {
        return None;
    }
    let ada = ada_aboard(before, geo)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let vale = evidence.profile(VALE)?["name"].as_str()?;
    let ship = evidence.profile(SHIP)?["name"].as_str()?;
    let text = if carry {
        let cloth = item_as_named(evidence.profile(CLOTH)?["name"].as_str()?);
        format!("{vale} carries {cloth} aboard {ship}.")
    } else {
        format!("{vale} boards {ship}.")
    };
    let mut world = before.clone();
    world["turn"] = json!(8);
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let actor = world["actors"][VALE].as_object_mut()?;
    actor.remove("offered");
    actor.remove("guarding");
    let prepared = prepare(&world)?;
    let hands = opening_held_items::snapshot(&world, geo)?;
    let witnesses = departure_witnesses(&world, geo, authored, POND)?;
    world["actors"][VALE]["place"] = json!(SHIP);
    world["actors"][VALE]["crossed"] = json!(2);
    world["transports"][SHIP]["since"] = json!(8);
    let history = world["items"][CLOTH]["history"].as_array_mut()?;
    history.push(json!(format!("Turn 8: {vale} carried it to {ship}.")));
    history.drain(..history.len().saturating_sub(12));
    if ada {
        world["opening"]["met"]
            .as_object_mut()?
            .insert("ada".into(), json!(8));
        world["packs"]["shared-homes"]["met"]
            .as_object_mut()?
            .insert("ada".into(), json!(8));
    }
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    opening_crossings::no_crossing_unlocks(&world, geo)?;
    let cast = opening_roster::known_actors(&world, geo, order, Some(SHIP))?;
    let items = visible_items(&world, geo, authored, SHIP)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":VALE, "text":text,
        "locationId":SHIP, "fromLocationId":POND, "witnesses":witnesses,
        "itemId":carry.then_some(CLOTH), "targetId":SHIP,
    });
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] = json!({"seq":world["eventSeq"],"locationId":SHIP,"fromLocationId":POND});
    world["actors"][VALE]["visited"]
        .as_array_mut()?
        .push(json!(SHIP));
    arrival(&world)?;
    Some((world, prepared))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, carry) = boarding_world(request)?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (world, ()) = begin_with(before, &geo, &authored, &order, &evidence, carry, |_| {
        Some(())
    })?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
