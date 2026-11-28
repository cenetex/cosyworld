use super::{
    authored_order::Order,
    opening::{self, MAX_REVISION},
    opening_content,
    opening_full_wait::visible_items,
    opening_pond_ship_course, opening_roster,
    opening_station_move::{departure_witnesses, quiet_opening},
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ADA: &str = "ada";
const SHIP: &str = "greek-ship";
const HARBOR: &str = "greek-harbor";
const CLOTH: &str = "cloth";

fn sailing() -> Value {
    json!({"version":3,"phase":"sea","dock":"pond","destination":HARBOR,
           "riders":[],"since":9,"recall":null})
}

pub(super) fn wait_world(request: &Value) -> Option<&Value> {
    let world = request.get("world")?;
    let action = &request["action"];
    (action.as_str().or_else(|| action["key"].as_str())? == "wait:vale::"
        && action["kind"] != "pack"
        && request["actor"] == VALE
        && opening::seats(&request["claimed"])? == [VALE]
        && opening::seats(&request["present"])? == [VALE]
        && request["selectedIds"].is_null()
        && (request["revision"].is_null() || request["revision"] == world["revision"])
        && (request["elysiumPortraits"].is_null() || request["elysiumPortraits"] == json!([])))
    .then_some(world)
}

fn riders(world: &Value, geo: &Geography<'_>) -> Option<Vec<&'static str>> {
    let mut riders = Vec::new();
    for (id, actor) in world["actors"].as_object()? {
        if actor["place"] != SHIP || !geo.entity_active(world, id)? {
            continue;
        }
        match id.as_str() {
            VALE => riders.push(VALE),
            ADA if geo.visiting_resident(world, ADA)
                && world["opening"]["met"][ADA] == 8
                && actor["visited"] == json!(["loft", SHIP])
                && actor["sleeping"].is_null() =>
            {
                riders.push(ADA)
            }
            _ => return None,
        }
    }
    riders.sort_unstable();
    matches!(riders.as_slice(), [VALE] | [ADA, VALE]).then_some(riders)
}

fn room<'a>(
    world: &Value,
    geo: &Geography<'_>,
    authored: &'a Order,
    order: &[&'a str],
) -> Option<Vec<&'a str>> {
    let cast = opening_roster::known_actors(world, geo, order, Some(SHIP))?;
    let riders = riders(world, geo)?;
    (visible_items(world, geo, authored, SHIP)? == [CLOTH]
        && cast.len() == riders.len()
        && cast.iter().all(|id| riders.contains(id)))
    .then_some(cast)
}

pub(super) fn begin_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    let course = opening_pond_ship_course::event(before)?;
    let departed = before["log"].as_array()?.last()?;
    let actor = &before["actors"][VALE];
    let ship = evidence.profile(SHIP)?["name"].as_str()?;
    let harbor = evidence.profile(HARBOR)?["name"].as_str()?;
    if departed["seq"] != before["eventSeq"]
        || departed["seq"] != course["seq"].as_u64()?.checked_add(1)?
        || departed["turn"] != 9
        || departed["kind"] != "narration"
        || !departed["actorId"].is_null()
        || departed["generated"] == true
        || departed["locationId"] != SHIP
        || departed["text"] != format!("{ship} casts off for {harbor}.")
        || before["transports"][SHIP] != sailing()
        || before["schema"] != 8
        || before["sharedVersion"] != 1
        || !quiet_opening(before)
        || !before["standoffs"].as_array()?.is_empty()
        || !before["conversations"].as_array()?.is_empty()
        || !actor["sleeping"].is_null()
        || actor["heldItem"] != CLOTH
        || before["items"][CLOTH]["holder"] != VALE
        || actor["waitSpeech"] != json!({"place":SHIP,"turn":null})
        || geo.files()["v2/card-game/forest.json"]["people"][VALE]["home"] == SHIP
        || geo.packs().any(|pack| {
            pack["places"][SHIP]["sanctuary"] == true
                || pack["choices"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|choice| {
                        choice["on"] == "wait" && (choice["at"].is_null() || choice["at"] == SHIP)
                    })
        })
    {
        return None;
    }
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let mut world = before.clone();
    world["turn"] = json!(10);
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let actor = world["actors"][VALE].as_object_mut()?;
    actor.remove("offered");
    actor.remove("guarding");
    let prepared = prepare(&world)?;
    let cast = room(&world, geo, authored, order)?;
    let witnesses = departure_witnesses(&world, geo, authored, SHIP)?;
    let vale = evidence.profile(VALE)?["name"].as_str()?;
    let detail = json!({"speaker":"World","kind":"action","verb":"wait","actorId":VALE,
        "text":format!("{vale} waits one turn."),"locationId":SHIP,"witnesses":witnesses});
    evidence.record(&mut world, &cast, &[CLOTH], detail, true)?;
    wait_event(&world)?;
    Some((world, prepared))
}

pub(super) fn wait_event(world: &Value) -> Option<&Value> {
    let seq = opening_pond_ship_course::retained_event(world)?["seq"]
        .as_u64()?
        .checked_add(2)?;
    let log = world["log"].as_array()?;
    let offset = log.iter().rposition(|event| event["seq"] == seq)?;
    let event = &log[offset];
    let departed = &log[offset.checked_sub(1)?];
    (world["turn"] == 10
        && world["actors"][VALE]["place"] == SHIP
        && departed["seq"] == seq - 1
        && departed["turn"] == 9
        && departed["kind"] == "narration"
        && departed["locationId"] == SHIP
        && departed["actorId"].is_null()
        && departed["generated"] != true
        && event["turn"] == 10
        && vale_action(event)
        && event["verb"] == "wait"
        && event["locationId"] == SHIP
        && event["sleep"].is_null()
        && event["guards"].is_null())
    .then_some(event)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = request.get("world")?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (world, ()) = begin_with(
        wait_world(request)?,
        &geo,
        &authored,
        &order,
        &evidence,
        |_| Some(()),
    )?;
    Some(json!({"ok":true,"world":world}))
}
