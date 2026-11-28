use super::{
    initial_wants::root_in, lamp_state, opening, opening_content, opening_pickups::item_as_named,
    opening_pond_view::offer, opening_view, opening_visitor_routes,
    opening_wait_response::vale_action, pack_state::Catalog, profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ROOM: &str = "behind-station";
const STATION: &str = "station";
const LAMP: &str = "lamp";
const WAYFINDER: &str = "elysium-wayfinder";
const PATH: [&str; 4] = ["attic", "pond", STATION, ROOM];

pub(super) fn arrival(world: &Value) -> Option<u64> {
    let vale = &world["actors"][VALE];
    let receipt = &world["arrival"];
    let seq = receipt["seq"].as_u64()?;
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["turn"] != 3
        || world.get("began").is_some()
        || world["opening"]["version"] != 1
        || world["opening"]["crossed"] != true
        || world["opening"]["met"] != json!({"vale":0,"moth":1,"keeper":2})
        || world["locations"]["attic"]["anchored"] != true
        || vale["place"] != ROOM
        || vale["crossed"] != 1
        || vale["visited"] != json!(PATH)
        || *receipt != json!({"seq":seq,"fromLocationId":STATION,"locationId":ROOM})
        || world["eventSeq"].as_u64()? < seq
    {
        return None;
    }
    let mut plays = world["log"]
        .as_array()?
        .iter()
        .filter(|entry| vale_action(entry));
    let mut last = 0;
    for (index, pair) in PATH.windows(2).enumerate() {
        let event = plays.next()?;
        let at = event["seq"].as_u64()?;
        if at <= last
            || event["turn"] != index as u64 + 1
            || event["verb"] != "move"
            || event["fromLocationId"] != pair[0]
            || event["locationId"] != pair[1]
            || event["targetId"] != pair[1]
            || !(event["itemId"].is_null() || event["itemId"] == LAMP)
        {
            return None;
        }
        last = at;
    }
    (last == seq && plays.next().is_none()).then_some(seq)
}

fn completed_event(world: &Value, seq: u64, allow_speech: bool) -> Option<&Value> {
    let log = world["log"].as_array()?;
    let start = log.iter().position(|entry| entry["seq"] == seq)?;
    let (event, speech) = log[start..].split_first()?;
    if !vale_action(event)
        || event["cast"] != json!([VALE])
        || event["light"] != false
        || (!allow_speech && !speech.is_empty())
        || log.last()?["seq"] != world["eventSeq"]
    {
        return None;
    }
    for (index, line) in speech.iter().enumerate() {
        let kind = match line["kind"].as_str()? {
            "dialogue" => line["actorId"] == VALE && line["entityId"] == VALE,
            "narration" => line["actorId"].is_null() && line["entityId"] == ROOM,
            _ => false,
        };
        if !kind
            || line["seq"].as_u64()? != seq.checked_add(index as u64 + 1)?
            || line["turn"] != 3
            || line["locationId"] != ROOM
            || line["cast"] != json!([VALE])
            || line["generated"] != true
            || line.get("elysiumName").is_some()
        {
            return None;
        }
    }
    Some(event)
}

fn quiet_scene(world: &Value, geo: &Geography<'_>) -> Option<bool> {
    let vale = &world["actors"][VALE];
    let lamp = &world["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    if !(3..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || [
            "disabledPacks",
            "hidden",
            "absent",
            "homecoming",
            "invitedPlaces",
            "sharedMigration",
        ]
        .iter()
        .any(|key| !world[*key].is_null())
        || !world["standoffs"].as_array()?.is_empty()
        || !world["defeats"][VALE].is_null()
        || !world["placeCard"][ROOM].is_null()
        || vale["waitSpeech"] != json!({"place":ROOM,"turn":null})
        || ["want", "closed", "sleeping", "under", "arcana"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || !vale["talked"].as_array()?.is_empty()
        || lamp["holder"] != VALE
        || lamp["lit"] != false
        || fuel.fuel_place != ROOM
        || fuel.fuel_visit
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0))
        || !geo.entity_active(world, LAMP)?
        || geo.base_exits(ROOM)? != [json!(STATION)]
        || opening_visitor_routes::exits(world, geo, VALE, ROOM)? != [STATION].into()
        || geo.packs().any(|pack| {
            pack["places"].get(ROOM).is_some()
                || pack["choices"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|choice| choice["at"] == ROOM)
                || pack["fixtures"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, fixture)| fixture["at"] == ROOM || fixture["place"] == ROOM)
        })
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && actor["place"] == ROOM && geo.entity_active(world, id)? {
            return None;
        }
    }
    let items = world["items"].as_object()?;
    let mut wayfinder = false;
    for (id, item) in items {
        if id == LAMP
            || !matches!(root_in(items, id)?, ROOM | VALE)
            || !geo.entity_active(world, id)?
        {
            continue;
        }
        if id != WAYFINDER || item["holder"] != ROOM {
            return None;
        }
        let authored = geo.packs().find_map(|pack| pack["items"].get(WAYFINDER))?;
        if authored["lifecycle"] == "fixed" || !authored["locked"].is_null() {
            return None;
        }
        wayfinder = true;
    }
    Some(wayfinder)
}

fn response(mut reply: Value, profiles: Value, wayfinder: bool) -> Option<Value> {
    let vale = profiles[VALE]["name"].as_str()?;
    let station = profiles[STATION]["name"].as_str()?;
    let room = profiles[ROOM]["name"].as_str()?;
    let lamp = item_as_named(profiles[LAMP]["name"].as_str()?);
    let mut actions = vec![
        offer("wait", None, None, format!("{vale} waits one turn."), &[]),
        offer(
            "move",
            None,
            Some(STATION),
            format!("{vale} goes to {station}."),
            &[STATION],
        ),
        offer(
            "move",
            Some(LAMP),
            Some(STATION),
            format!("{vale} carries {lamp} to {station}."),
            &[LAMP, STATION],
        ),
    ];
    if wayfinder {
        let item = item_as_named(profiles[WAYFINDER]["name"].as_str()?);
        actions.push(offer(
            "take",
            Some(WAYFINDER),
            None,
            format!("{vale} takes {item}."),
            &[WAYFINDER],
        ));
    }
    actions.push(offer(
        "drop",
        Some(LAMP),
        Some(ROOM),
        format!("{vale} puts {lamp} in {room}."),
        &[LAMP],
    ));
    reply["actor"] = json!(VALE);
    reply["room"] = json!(ROOM);
    reply["exits"] = json!([STATION]);
    reply["actions"] = json!(actions);
    reply["profiles"] = profiles;
    Some(reply)
}

pub(super) fn completed_response(
    mut world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    let arrival = arrival(&world)?;
    if before_seq.checked_add(1)? != arrival {
        return None;
    }
    let events = json!([completed_event(&world, arrival, false)?]);
    let wayfinder = quiet_scene(&world, geo)?;
    world
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(VALE.into(), json!([VALE]));
    let mut reply = opening::stored_response(world)?;
    reply["events"] = events;
    response(reply, profile_source()?, wayfinder)
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

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    let world = request.get("world")?;
    if request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || world["speechVoices"][VALE] != json!([VALE])
    {
        return None;
    }
    completed_event(world, arrival(world)?, true)?;
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let wayfinder = quiet_scene(world, &geo)?;
    let world = opening_view::private_world(world, request)?;
    response(
        json!({"ok":true,"world":world}),
        profiles::project(&files)?,
        wayfinder,
    )
}
