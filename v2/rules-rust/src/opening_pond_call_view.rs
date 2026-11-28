use super::{
    initial_wants::root_in,
    opening, opening_content,
    opening_pickups::item_as_named,
    opening_pond_view::offer,
    opening_station_move::{move_event, quiet_opening},
    opening_view, opening_visitor_routes,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const STATION: &str = "station";
const SHIP: &str = "greek-ship";
const SIGNAL: &str = "pond-greek-harbor";
const KEY: &str = "ratiradio-station-key";
const WAYFINDER: &str = "elysium-wayfinder";
const EXITS: [&str; 3] = [STATION, "attic", SHIP];

fn drop_receipt(world: &Value) -> Option<u64> {
    let vale = &world["actors"][VALE];
    let log = world["log"].as_array()?;
    let moves: Vec<_> = log.iter().filter(|entry| vale_action(entry)).collect();
    let [pond, station, read, first_return, reentry, second_return, drop] = moves.as_slice() else {
        return None;
    };
    let returned = second_return["seq"].as_u64()?;
    let seq = drop["seq"].as_u64()?;
    let gift = reentry["seq"].as_u64()?.checked_add(1)?;
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["turn"] != 7
        || world.get("began").is_some()
        || !quiet_opening(world)
        || !(8..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["opening"]["met"] != json!({"vale":0,"moth":1,"keeper":2})
        || vale["visited"] != json!(["attic", POND, STATION])
        || vale["crossed"] != 1
        || world["opening"]["crossed"] != true
        || world["arrival"] != json!({"seq":returned,"fromLocationId":STATION,"locationId":POND})
        || !move_event(pond, 1, "attic", POND)
        || !move_event(station, 2, POND, STATION)
        || read["turn"] != 3
        || read["verb"] != "read"
        || read["locationId"] != STATION
        || read["itemId"] != "keeper-log"
        || world["knowledge"]["known"][VALE]["quest:keeper:pond"]
            != json!({
                "kind":"read","teller":null,"eventSeq":read["seq"],"learnedTurn":3,"book":"keeper-log",
            })
        || !move_event(first_return, 4, STATION, POND)
        || !move_event(reentry, 5, POND, STATION)
        || !move_event(second_return, 6, STATION, POND)
        || gift >= returned
        || returned.checked_add(1)? != seq
        || drop["turn"] != 7
        || drop["verb"] != "drop"
        || drop["itemId"] != "lamp"
        || drop["locationId"] != POND
        || drop["targetId"] != POND
    {
        return None;
    }
    log.iter()
        .any(|event| {
            event["seq"] == gift
                && event["turn"] == 5
                && event["kind"] == "action"
                && event["generated"] != true
                && event["locationId"] == STATION
                && event["actorId"] == "moth"
                && event["verb"] == "give"
                && event["itemId"] == "cloth"
                && event["targetId"] == VALE
                && event["accepted"] == true
        })
        .then_some(seq)
}

fn signal_events(world: &Value, seq: u64, allow_speech: bool) -> Option<&[Value]> {
    let log = world["log"].as_array()?;
    let start = log.iter().position(|entry| entry["seq"] == seq)?;
    let events = &log[start..];
    let first_line = events
        .iter()
        .position(|event| event["generated"] == true)
        .unwrap_or(events.len());
    let (committed, speech) = events.split_at(first_line);
    let [drop, middle @ .., reflection] = committed else {
        return None;
    };
    let owners: &[&str] = if world["actors"][VALE]["completedQuest"].is_null() {
        &["keeper"]
    } else {
        &[VALE, "keeper"]
    };
    let (calls, offstage) = middle.split_at_checked(owners.len())?;
    if (!allow_speech && !speech.is_empty())
        || drop["light"] != true
        || log.last()?["seq"] != world["eventSeq"]
        || events.iter().enumerate().any(|(i, event)| {
            event["turn"] != 7 || event["seq"].as_u64() != seq.checked_add(i as u64)
        })
        || offstage
            .iter()
            .any(|event| event["locationId"] == POND || event["fromLocationId"] == POND)
        || reflection["kind"] != "narration"
        || !reflection["actorId"].is_null()
        || reflection["text"] != "The pond's reflection opens a path to the attic."
    {
        return None;
    }
    for (event, &owner) in calls.iter().zip(owners) {
        if event["actorId"] != VALE
            || event["kind"] != "narration"
            || event["verb"] != "want_met"
            || event["ownerId"] != owner
            || event["wantMet"] != json!({"kind":"place","target":POND})
        {
            return None;
        }
    }
    if [drop, reflection]
        .into_iter()
        .chain(calls)
        .chain(speech)
        .any(|event| event["cast"] != json!([VALE]) || event["locationId"] != POND)
        || speech.iter().any(|line| {
            line["generated"] != true
                || line.get("elysiumName").is_some()
                || match line["kind"].as_str() {
                    Some("dialogue") => line["actorId"] != VALE || line["entityId"] != VALE,
                    Some("narration") => !line["actorId"].is_null() || line["entityId"] != POND,
                    _ => true,
                }
        })
    {
        return None;
    }
    Some(committed)
}

fn called_scene(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let vale = &world["actors"][VALE];
    let lamp = &world["items"]["lamp"];
    if vale["place"] != POND
        || vale["heldItem"] != "cloth"
        || vale["waitSpeech"] != json!({"place":POND,"turn":null})
        || !vale["want"].is_null()
        || !vale["under"].is_null()
        || !vale["sleeping"].is_null()
        || vale["arcana"] != json!({"proved":[],"did":[],"callers":["keeper"],"calls":1})
        || vale["closed"]["quest:from:keeper"]
            != json!([
                7,
                r#"["place","pond",[["crossing","pond-greek-harbor"],["verb","call"]],null]"#
            ])
        || !world["defeats"][VALE].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["disabledPacks"].is_null()
        || !world["placeCard"][POND].is_null()
        || !world["pondLampLoan"].is_null()
        || world["actors"]["moth"]["place"] != STATION
        || world["actors"]["keeper"]["place"] != STATION
        || world["items"]["cloth"]["holder"] != VALE
        || world["items"][KEY]["holder"] != POND
        || !geo.entity_active(world, "cloth")?
        || !geo.entity_active(world, "lamp")?
        || !geo.entity_active(world, KEY)?
        || lamp["holder"] != POND
        || lamp["lit"] != true
        || lamp["fuel"] != 8
        || lamp["fuelRooms"] != 2
        || lamp["fuelPlace"] != POND
        || lamp["fuelVisit"] != true
        || world["opened"][SHIP] != json!([VALE])
        || world["crossings"][SIGNAL] != json!({"discovered":true,"method":"pond-lamp"})
        || world["transports"][SHIP]
            != json!({
                "version":3,"phase":"docked","dock":POND,"destination":null,"riders":[],"since":7,"recall":null,
            })
        || opening_visitor_routes::exits(world, geo, VALE, POND)? != EXITS.into()
    {
        return None;
    }
    for id in [VALE, "keeper"] {
        let quest = &world["actors"][id]["completedQuest"];
        if id == VALE && quest.is_null() {
            continue;
        }
        if quest["by"] != VALE
            || quest["turn"] != 7
            || quest["want"]["step"]["verb"] != "call"
            || quest["want"]["step"]["crossing"] != SIGNAL
            || quest["want"]["target"] != POND
            || (id == VALE && quest["want"]["from"] != "quest:from:keeper")
        {
            return None;
        }
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && actor["place"] == POND && geo.entity_active(world, id)? {
            return None;
        }
    }
    let items = world["items"].as_object()?;
    for id in items.keys() {
        if matches!(root_in(items, id)?, POND | VALE)
            && geo.entity_active(world, id)?
            && !matches!(id.as_str(), "cloth" | "lamp" | KEY | WAYFINDER)
        {
            return None;
        }
    }
    Some(())
}

fn reply(
    mut response: Value,
    world: &Value,
    geo: &Geography<'_>,
    profiles: Value,
) -> Option<Value> {
    let name = |id: &str| profiles[id]["name"].as_str();
    let vale = name(VALE)?;
    let cloth = item_as_named(name("cloth")?);
    let pond = name(POND)?;
    let mut plans = vec![offer(
        "wait",
        None,
        None,
        format!("{vale} waits one turn."),
        &[],
    )];
    for to in EXITS {
        let place = name(to)?;
        let (walk, carry) = match to {
            "attic" => (
                format!("{vale} goes to {place} through the reflection."),
                format!("{vale} carries {cloth} to {place} through the reflection."),
            ),
            SHIP => (
                format!("{vale} boards {place}."),
                format!("{vale} carries {cloth} aboard {place}."),
            ),
            _ => (
                format!("{vale} goes to {place}."),
                format!("{vale} carries {cloth} to {place}."),
            ),
        };
        let mut bare = offer("move", None, Some(to), walk, &[to]);
        let mut with_cloth = offer("move", Some("cloth"), Some(to), carry, &["cloth", to]);
        if to == SHIP {
            bare["label"] = json!("Board");
            with_cloth["label"] = json!("Board");
        }
        plans.extend([bare, with_cloth]);
    }
    for item in [KEY, WAYFINDER, "lamp"] {
        if world["items"][item]["holder"] == POND && geo.entity_active(world, item)? {
            let thing = item_as_named(name(item)?);
            plans.push(offer(
                "take",
                Some(item),
                None,
                format!("{vale} takes {thing}."),
                &[item],
            ));
        }
    }
    plans.push(offer(
        "drop",
        Some("cloth"),
        Some(POND),
        format!("{vale} puts {cloth} in {pond}."),
        &["cloth"],
    ));
    response["actor"] = json!(VALE);
    response["room"] = json!(POND);
    response["exits"] = json!(EXITS);
    response["profiles"] = profiles;
    response["actions"] = json!(plans);
    Some(response)
}

pub(super) fn completed_response(
    world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    let seq = drop_receipt(&world)?;
    if before_seq.checked_add(1)? != seq || world["speechVoices"][VALE] != json!([VALE]) {
        return None;
    }
    called_scene(&world, geo)?;
    let events = json!(signal_events(&world, seq, false)?);
    let mut response = reply(
        json!({"ok":true,"events":events}),
        &world,
        geo,
        profile_source()?,
    )?;
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
    if world["speechVoices"][VALE] != json!([VALE]) {
        return None;
    }
    signal_events(world, drop_receipt(world)?, true)?;
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    called_scene(world, &geo)?;
    reply(
        json!({"ok":true,"world":opening_view::private_world(world, request)?}),
        world,
        &geo,
        profiles::project(&files)?,
    )
}
