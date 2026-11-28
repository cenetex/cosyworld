use super::{
    initial_wants::root_in,
    lamp_state, opening, opening_content,
    opening_evidence::keeper_call_goal,
    opening_pond_view::{actions, pond_paths, pond_response},
    opening_station_move::{move_event, quiet_opening},
    opening_station_view::{abandon_offer, keeper_want_from_read},
    opening_view,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const STATION: &str = "station";
const KEY: &str = "ratiradio-station-key";
const WAYFINDER: &str = "elysium-wayfinder";

pub(super) fn arrival(world: &Value) -> Option<(u64, u64)> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let vale = &world["actors"][VALE];
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["turn"] != 4
        || world.get("began").is_some()
        || !quiet_opening(world)
        || world["opening"]
            != json!({"version":1,"crossed":true,"met":{"vale":0,"moth":1,"keeper":2}})
        || world["locations"]["attic"]["anchored"] != true
        || vale["place"] != POND
        || vale["visited"] != json!(["attic", POND, STATION])
        || vale["crossed"] != 1
        || world["arrival"] != json!({"seq":seq,"fromLocationId":STATION,"locationId":POND})
    {
        return None;
    }
    let log = world["log"].as_array()?;
    let moves: Vec<_> = log.iter().filter(|event| vale_action(event)).collect();
    let [pond, station, read, back] = moves.as_slice() else {
        return None;
    };
    let station_seq = station["seq"].as_u64()?;
    let read_seq = read["seq"].as_u64()?;
    let wait_seq = read_seq.checked_add(1)?;
    let wait = log.iter().find(|event| event["seq"] == wait_seq)?;
    let follow_seq = station_seq.checked_add(1)?;
    let follow = log.iter().find(|event| event["seq"] == follow_seq)?;
    (move_event(pond, 1, "attic", POND)
        && pond["seq"].as_u64()? < station_seq
        && move_event(station, 2, POND, STATION)
        && follow["actorId"] == "moth"
        && follow["kind"] == "action"
        && follow["generated"] != true
        && follow["itemId"].is_null()
        && move_event(follow, 2, POND, STATION)
        && follow_seq < read_seq
        && read["turn"] == 3
        && read["locationId"] == STATION
        && read["verb"] == "read"
        && read["itemId"] == "keeper-log"
        && read["text"] == "Vale reads The keeper’s log."
        && read["witnesses"]
            .as_array()?
            .iter()
            .any(|id| id == "keeper-log")
        && wait["turn"] == 3
        && wait["kind"] == "action"
        && wait["actorId"] == "moth"
        && wait["generated"] != true
        && wait["verb"] == "wait"
        && wait["locationId"] == STATION
        && wait["cast"] == read["cast"]
        && wait["witnesses"] == read["witnesses"]
        && back["seq"] == seq
        && wait_seq.checked_add(1)? == seq
        && move_event(back, 4, STATION, POND))
    .then_some((seq, read_seq))
}

fn event(world: &Value, seq: u64, allow_speech: bool) -> Option<&Value> {
    let log = world["log"].as_array()?;
    let start = log.iter().position(|event| event["seq"] == seq)?;
    let (primary, speech) = log[start..].split_first()?;
    if primary["cast"] != json!([VALE])
        || primary["light"] != false
        || (!allow_speech && !speech.is_empty())
        || log.last()?["seq"] != world["eventSeq"]
    {
        return None;
    }
    for (i, line) in speech.iter().enumerate() {
        let voice = match line["kind"].as_str()? {
            "dialogue" => line["actorId"] == VALE && line["entityId"] == VALE,
            "narration" => line["actorId"].is_null() && line["entityId"] == POND,
            _ => false,
        };
        if !voice
            || line["generated"] != true
            || line["turn"] != 4
            || line["locationId"] != POND
            || line["seq"].as_u64()? != seq.checked_add(i as u64 + 1)?
            || line["cast"] != json!([VALE])
            || line.get("elysiumName").is_some()
        {
            return None;
        }
    }
    Some(primary)
}

pub(super) fn verify_arrival(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let (seq, read) = arrival(world)?;
    if world["speechVoices"][VALE] != json!([VALE]) {
        return None;
    }
    event(world, seq, true)?;
    quiet_return(world, geo, read)
}

fn quiet_return(world: &Value, geo: &Geography<'_>, read_seq: u64) -> Option<()> {
    let vale = &world["actors"][VALE];
    let lamp = &world["items"]["lamp"];
    let fuel = lamp_state(lamp).ok()?;
    if !(5..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || vale["want"] != keeper_want_from_read(world, geo, read_seq)?
        || vale["waitSpeech"] != json!({"place":POND,"turn":null})
        || ["under", "arcana", "closed", "sleeping"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || ["disabledPacks", "pondLampLoan"]
            .iter()
            .any(|key| !world[*key].is_null())
        || !world["standoffs"].as_array()?.is_empty()
        || !world["defeats"][VALE].is_null()
        || !world["placeCard"][POND].is_null()
        || !world["placeMet"][POND].is_null()
        || world["items"]["keeper-log"]["holder"] != STATION
        || world["actors"]["keeper"]["place"] != STATION
        || world["actors"]["moth"]["place"] != STATION
        || world["items"]["cloth"]["holder"] != "moth"
        || world["items"][KEY]["holder"] != POND
        || !geo.entity_active(world, KEY)?
        || !geo.entity_active(world, "lamp")?
        || lamp["holder"] != VALE
        || lamp["lit"] != false
        || fuel.fuel_place != POND
        || fuel.fuel_visit
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == "lamp" && fuel.fuel_rooms == 0))
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && actor["place"] == POND && geo.entity_active(world, id)? {
            return None;
        }
    }
    let items = world["items"].as_object()?;
    for (id, item) in items {
        if matches!(root_in(items, id)?, POND | VALE)
            && geo.entity_active(world, id)?
            && !matches!(id.as_str(), "lamp" | KEY)
            && !(id == WAYFINDER && item["holder"] == POND)
        {
            return None;
        }
    }
    pond_paths(world, geo)
}

fn reply(reply: Value, world: &Value, geo: &Geography<'_>, profiles: Value) -> Option<Value> {
    let mut plans = actions(world, geo, &profiles, None)?;
    let name = |id: &str| profiles[id]["name"].as_str();
    let goal = keeper_call_goal(name("cloth")?, name(POND)?, name("lamp")?);
    plans.push(abandon_offer(format!(
        "{} abandons their quest to {goal}.",
        name(VALE)?
    )));
    Some(pond_response(reply, plans, profiles))
}

pub(super) fn completed_response(
    mut world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    let (seq, read) = arrival(&world)?;
    if before_seq.checked_add(1)? != seq {
        return None;
    }
    quiet_return(&world, geo, read)?;
    let events = json!([event(&world, seq, false)?]);
    let profiles = profile_source()?;
    let mut response = reply(json!({"ok":true,"events":events}), &world, geo, profiles)?;
    world["speechVoices"]
        .as_object_mut()?
        .insert(VALE.into(), json!([VALE]));
    response["world"] = opening::stored_world(world)?;
    Some(response)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    if request["actor"] != VALE
        || request["claimed"] != json!([VALE])
        || request["present"] != json!([VALE])
    {
        return None;
    }
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    completed_response(
        request.get("world")?.clone(),
        &geo,
        request["beforeSeq"].as_u64()?,
        || profiles::project(&files),
    )
}

pub(super) fn private_view(request: &Value) -> Option<Value> {
    let world = request.get("world")?;
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    verify_arrival(world, &geo)?;
    reply(
        json!({"ok":true,"world":opening_view::private_world(world, request)?}),
        world,
        &geo,
        profiles::project(&files)?,
    )
}
