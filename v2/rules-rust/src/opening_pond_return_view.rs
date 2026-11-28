use super::{
    initial_wants::root_in,
    lamp_state, opening, opening_content,
    opening_evidence::keeper_call_goal,
    opening_pickups::item_as_named,
    opening_pond_call_view::cloth_arrival,
    opening_pond_view::{actions, pond_paths, pond_response},
    opening_station_move::{move_event, quiet_opening},
    opening_station_read::keeper_want_from_read,
    opening_station_view::abandon_offer,
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
const CLOTH: &str = "cloth";
const LAMP: &str = "lamp";

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
    let (departure, read) = keeper_read_departure(world, None)?;
    (departure == seq).then_some((seq, read))
}

pub(super) fn keeper_read_departure(world: &Value, returned: Option<&Value>) -> Option<(u64, u64)> {
    let log = world["log"].as_array()?;
    let mut moves = log.iter().filter(|event| vale_action(event));
    let (pond, station, read, back) = (moves.next()?, moves.next()?, moves.next()?, moves.next()?);
    if moves.next() != returned || moves.next().is_some() {
        return None;
    }
    let seq = back["seq"].as_u64()?;
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
            || line["turn"] != world["turn"]
            || line["locationId"] != POND
            || line["seq"].as_u64()? != seq.checked_add(i as u64 + 1)?
            || line["cast"] != json!([VALE])
            || line.get("elysiumName").is_some()
            || (world["turn"] == 6 && (line["light"] != false || line["items"] != primary["items"]))
        {
            return None;
        }
    }
    Some(primary)
}

pub(super) fn verify_arrival(world: &Value, geo: &Geography<'_>) -> Option<()> {
    if world["turn"] != 4 || world["speechVoices"][VALE] != json!([VALE]) {
        return None;
    }
    settled_move(world, geo, true).map(|_| ())
}

pub(super) fn verify_cloth_arrival(world: &Value, geo: &Geography<'_>) -> Option<()> {
    if world["turn"] != 6 || world["speechVoices"][VALE] != json!([VALE]) {
        return None;
    }
    settled_move(world, geo, true).map(|_| ())
}

fn settled_move<'a>(world: &'a Value, geo: &Geography<'_>, speech: bool) -> Option<&'a Value> {
    let with_cloth = world["turn"] == 6;
    let (seq, read) = if with_cloth {
        cloth_arrival(world, false)?
    } else {
        arrival(world)?
    };
    let primary = event(world, seq, speech)?;
    quiet_return(world, geo, read, with_cloth)?;
    if with_cloth {
        cloth_evidence(world, geo, primary)?;
    }
    Some(primary)
}

fn quiet_return(world: &Value, geo: &Geography<'_>, read_seq: u64, with_cloth: bool) -> Option<()> {
    let vale = &world["actors"][VALE];
    let lamp = &world["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    let (cloth_owner, hand) = if with_cloth {
        (VALE, vale["heldItem"] == CLOTH)
    } else {
        (
            "moth",
            vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0),
        )
    };
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
        || world["items"][CLOTH]["holder"] != cloth_owner
        || world["items"][KEY]["holder"] != POND
        || !geo.entity_active(world, KEY)?
        || !geo.entity_active(world, LAMP)?
        || lamp["holder"] != VALE
        || lamp["lit"] != false
        || fuel.fuel_place != POND
        || fuel.fuel_visit
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !hand
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
            && !matches!(id.as_str(), LAMP | KEY)
            && !(with_cloth && id == CLOTH)
            && !(id == WAYFINDER && item["holder"] == POND)
        {
            return None;
        }
    }
    pond_paths(world, geo)
}

fn cloth_evidence(world: &Value, geo: &Geography<'_>, primary: &Value) -> Option<()> {
    let gift = world["log"].as_array()?.iter().rfind(|event| {
        event["turn"] == 5 && event["actorId"] == "moth" && event["verb"] == "give"
    })?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let vale = forest["people"][VALE]["name"].as_str()?;
    let pond = forest["places"][POND]["name"].as_str()?;
    let text = match primary["itemId"].as_str() {
        None if primary["itemId"].is_null() => format!("{vale} goes to {pond}."),
        Some(id @ (LAMP | CLOTH)) => {
            let item = item_as_named(forest["things"][id]["name"].as_str()?);
            format!("{vale} carries {item} to {pond}.")
        }
        _ => return None,
    };
    let items = &world["items"];
    let mut visible = vec![KEY];
    if items[WAYFINDER]["holder"] == POND && geo.entity_active(world, WAYFINDER)? {
        visible.push(WAYFINDER);
    }
    visible.extend([LAMP, CLOTH]);
    let snapshots = primary["items"].as_array()?;
    let history = format!("Turn 6: {vale} carried it to {pond}.");
    let witnesses = gift["witnesses"].as_array()?;
    (primary["kind"] == "action"
        && primary["speaker"] == "World"
        && primary["actorId"] == VALE
        && primary["generated"] != true
        && primary["text"] == text
        && primary["witnesses"] == gift["witnesses"]
        && [VALE, "moth", "keeper", CLOTH, LAMP]
            .iter()
            .all(|id| witnesses.iter().any(|witness| witness == *id))
        && world["life"]["actors"][VALE]["attachments"][CLOTH] == json!({"from":"moth","turn":5})
        && geo.entity_active(world, CLOTH)?
        && [LAMP, CLOTH].iter().all(|id| {
            items[*id]["history"]
                .as_array()
                .and_then(|log| log.last()?.as_str())
                == Some(history.as_str())
        })
        && snapshots.len() == visible.len()
        && snapshots
            .iter()
            .zip(visible)
            .all(|(item, id)| item["id"] == id && item["holder"] == items[id]["holder"])
        && snapshots.iter().any(|item| {
            item["id"] == LAMP
                && ["fuel", "fuelRooms", "fuelPlace", "fuelVisit", "lit"]
                    .iter()
                    .all(|key| item[*key] == items[LAMP][*key])
        }))
    .then_some(())
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
    let primary = settled_move(&world, geo, false)?;
    if primary["seq"] != before_seq.checked_add(1)? {
        return None;
    }
    let events = json!([primary]);
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
    if world["turn"] == 6 {
        verify_cloth_arrival(world, &geo)?;
    } else {
        verify_arrival(world, &geo)?;
    }
    reply(
        json!({"ok":true,"world":opening_view::private_world(world, request)?}),
        world,
        &geo,
        profiles::project(&files)?,
    )
}
