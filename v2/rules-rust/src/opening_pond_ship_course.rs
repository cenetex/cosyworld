use super::{
    authored_order::Order,
    opening::{self, MAX_REVISION},
    opening_content,
    opening_full_wait::visible_items,
    opening_pond_ship_board, opening_roster, opening_settlement,
    opening_station_move::departure_witnesses,
    opening_visitor_transport,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const SHIP: &str = "greek-ship";
const HARBOR: &str = "greek-harbor";

fn transport(phase: &str, since: u64, destination: Option<&str>) -> Value {
    json!({
        "version":3, "phase":phase, "dock":"pond", "destination":destination,
        "riders":[], "since":since, "recall":null,
    })
}

pub(super) fn course_world(request: &Value) -> Option<&Value> {
    let world = request.get("world")?;
    let action = &request["action"];
    (action.as_str().or_else(|| action["key"].as_str())? == "course:vale::greek-harbor"
        && action["kind"] != "pack"
        && request["actor"] == VALE
        && opening::seats(&request["claimed"])? == [VALE]
        && opening::seats(&request["present"])? == [VALE]
        && request["selectedIds"].is_null()
        && (request["revision"].is_null() || request["revision"] == world["revision"])
        && (request["elysiumPortraits"].is_null() || request["elysiumPortraits"] == json!([])))
    .then_some(world)
}

pub(super) fn event(world: &Value) -> Option<&Value> {
    let seq = world["arrival"]["seq"].as_u64()?.checked_add(1)?;
    let event = world["log"]
        .as_array()?
        .iter()
        .find(|event| event["seq"] == seq)?;
    (world["turn"] == 9
        && world["actors"][VALE]["place"] == SHIP
        && world["arrival"]["locationId"] == SHIP
        && world["arrival"]["fromLocationId"] == "pond"
        && world["transports"][SHIP]["since"] == 9
        && world["transports"][SHIP]["destination"] == HARBOR
        && matches!(
            world["transports"][SHIP]["phase"].as_str(),
            Some("course" | "sea")
        )
        && vale_action(event)
        && event["turn"] == 9
        && event["verb"] == "course"
        && event["fromLocationId"] == SHIP
        && event["locationId"] == SHIP
        && event["targetId"] == HARBOR
        && event["itemId"].is_null())
    .then_some(event)
}

pub(super) fn begin_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    let boarded = opening_pond_ship_board::arrival_event(before)?;
    let actor = &before["actors"][VALE];
    if boarded["seq"] != before["eventSeq"]
        || before["log"].as_array()?.last()? != boarded
        || before["sharedVersion"] != 1
        || before.get("began").is_some_and(|turn| turn != 0)
        || before["transports"][SHIP] != transport("docked", 8, None)
        || !before["standoffs"].as_array()?.is_empty()
        || !before["conversations"].as_array()?.is_empty()
        || !actor["sleeping"].is_null()
        || actor["waitSpeech"] != json!({"place":SHIP,"turn":null})
        || actor["heldItem"] != "cloth"
        || before["items"]["cloth"]["holder"] != VALE
        || before["items"]["lamp"]["holder"] != "pond"
        || before["items"]["lamp"]["lit"] != true
    {
        return None;
    }
    opening_visitor_transport::permits_course(before, geo, VALE, SHIP, HARBOR)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let mut world = before.clone();
    world["turn"] = json!(9);
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let actor = world["actors"][VALE].as_object_mut()?;
    actor.remove("offered");
    actor.remove("guarding");
    let prepared = prepare(&world)?;
    let cast = opening_roster::known_actors(&world, geo, order, Some(SHIP))?;
    let items = visible_items(&world, geo, authored, SHIP)?;
    let witnesses = departure_witnesses(&world, geo, authored, SHIP)?;
    if items != ["cloth"]
        || !matches!(
            witnesses.as_slice(),
            [VALE, "cloth"] | [VALE, "ada", "cloth"]
        )
        || cast.len().checked_add(items.len())? != witnesses.len()
        || cast.iter().any(|actor| !witnesses.contains(actor))
        || (witnesses.contains(&"ada") && world["opening"]["met"]["ada"] != 8)
    {
        return None;
    }
    world["transports"][SHIP] = transport("course", 9, Some(HARBOR));
    let vale = evidence.profile(VALE)?["name"].as_str()?;
    let harbor = evidence.profile(HARBOR)?["name"].as_str()?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"course", "actorId":VALE,
        "text":format!("{vale} sets the ship's course for {harbor}."),
        "locationId":SHIP,"fromLocationId":SHIP,"witnesses":witnesses,"itemId":null,"targetId":HARBOR,
    });
    evidence.record(&mut world, &cast, &items, detail, true)?;
    event(&world)?;
    Some((world, prepared))
}

pub(super) fn sail(
    world: &mut Value,
    geo: &Geography<'_>,
    catalog: &Catalog,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<()> {
    if event(world)?["seq"] != world["eventSeq"]
        || world["transports"][SHIP] != transport("course", 9, Some(HARBOR))
        || !geo.entity_active(world, VALE)?
        || opening_settlement::sail_course(world, catalog, SHIP)?
            != [json!({"id":SHIP,"kind":"sail","from":"pond","to":HARBOR})]
    {
        return None;
    }
    let cast = opening_roster::known_actors(world, geo, order, Some(SHIP))?;
    let items = visible_items(world, geo, authored, SHIP)?;
    let ship = evidence.profile(SHIP)?["name"].as_str()?;
    let harbor = evidence.profile(HARBOR)?["name"].as_str()?;
    evidence.narrate(
        world,
        &cast,
        &items,
        SHIP,
        &format!("{ship} casts off for {harbor}."),
    )
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let world = request.get("world")?;
    let order = opening_roster::actor_order(request, world)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let world = match request["op"].as_str()? {
        "opening_pond_ship_course" => {
            let before = course_world(request)?;
            begin_with(before, &geo, &authored, &order, &evidence, |_| Some(()))?.0
        }
        "opening_pond_ship_course_depart" => {
            let mut world = world.clone();
            sail(&mut world, &geo, &catalog, &authored, &order, &evidence)?;
            world
        }
        _ => return None,
    };
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
