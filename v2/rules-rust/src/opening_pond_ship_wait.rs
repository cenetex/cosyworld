use super::{
    authored_order::Order,
    opening::{self, MAX_REVISION},
    opening_content,
    opening_full_wait::visible_items,
    opening_pond_ship_board::boarding_event,
    opening_pond_ship_view::{caption_voice, room_cast, settled_speakers},
    opening_roster, opening_settlement,
    opening_station_move::departure_witnesses,
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

pub(super) fn riders(world: &Value, geo: &Geography<'_>) -> Option<Vec<&'static str>> {
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

pub(super) fn departure_head<'name>(
    world: &Value,
    geo: &Geography<'_>,
    name: impl Fn(&str) -> Option<&'name str>,
) -> Option<u64> {
    if world["turn"] != 9 {
        return None;
    }
    settled_speakers(world, geo, name)?;
    world["eventSeq"].as_u64()
}

pub(super) fn begin_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    let previous = departure_head(before, geo, |id| evidence.profile(id)?["name"].as_str())?;
    let actor = &before["actors"][VALE];
    if before["memories"][VALE]["learning"]
        .as_array()
        .is_some_and(|trials| !trials.is_empty())
        || before["stationExitOrder"]
            != json!(super::create::station_order(before, geo.files(), geo)?)
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
    if wait_event(&world)?["seq"] != previous.checked_add(1)? {
        return None;
    }
    Some((world, prepared))
}

pub(super) fn wait_event(world: &Value) -> Option<&Value> {
    if world["turn"] != 10 {
        return None;
    }
    let board = boarding_event(world)?;
    let boarded = board["seq"].as_u64()?;
    let ada = board["cast"].as_array()?.iter().any(|actor| actor == ADA);
    let log = world["log"].as_array()?;
    let after_board = log
        .iter()
        .position(|event| event["seq"] == boarded)?
        .checked_add(1)?;
    let suffix = log.get(after_board..)?;
    let end = suffix.iter().position(|event| event["turn"] == 10)?;
    let (voyage, after_voyage) = suffix.split_at(end);
    let wait = after_voyage.first()?;
    let boarding_caps = voyage.iter().take_while(|entry| entry["turn"] == 8).count();
    let (boarding_captions, at_sea) = voyage.split_at(boarding_caps);
    let [course, departed, sea_captions @ ..] = at_sea else {
        return None;
    };
    room_cast(&board["cast"], ada)?;
    room_cast(&course["cast"], ada)?;
    room_cast(&wait["cast"], ada)?;
    let items = &board["items"];
    if voyage
        .iter()
        .chain([wait])
        .enumerate()
        .any(|(index, entry)| entry["seq"].as_u64() != boarded.checked_add(index as u64 + 1))
        || course["turn"] != 9
        || !vale_action(course)
        || course["verb"] != "course"
        || course["fromLocationId"] != SHIP
        || course["locationId"] != SHIP
        || course["targetId"] != HARBOR
        || !course["itemId"].is_null()
        || course["items"] != *items
        || departed["turn"] != 9
        || departed["kind"] != "narration"
        || departed["locationId"] != SHIP
        || !departed["actorId"].is_null()
        || departed["generated"] == true
        || departed["speaker"] != "World"
        || !departed["verb"].is_null()
        || !departed["witnesses"].is_null()
        || departed["cast"] != course["cast"]
        || departed["items"] != *items
        || departed["light"] != false
        || !vale_action(wait)
        || wait["verb"] != "wait"
        || wait["locationId"] != SHIP
        || wait["items"] != *items
        || wait["light"] != false
        || !wait["sleep"].is_null()
        || !wait["guards"].is_null()
    {
        return None;
    }
    for line in boarding_captions {
        caption_voice(line, ada, true, items)?;
    }
    for line in sea_captions {
        if line["turn"] != 9 {
            return None;
        }
        caption_voice(line, ada, false, items)?;
    }
    Some(wait)
}

pub(super) fn docking_event(world: &Value) -> Option<&Value> {
    let seq = wait_event(world)?["seq"].as_u64()?.checked_add(1)?;
    let event = world["log"]
        .as_array()?
        .iter()
        .rfind(|event| event["seq"] == seq)?;
    let state = &world["transports"][SHIP];
    (event["turn"] == 10
        && event["kind"] == "narration"
        && event["locationId"] == SHIP
        && event["actorId"].is_null()
        && event["generated"] != true
        && state["phase"] == "arrived"
        && state["dock"] == HARBOR
        && state["since"] == 10)
        .then_some(event)
}

pub(super) fn before_docking(world: &Value) -> Option<u64> {
    let wait = wait_event(world)?;
    let seq = wait["seq"].as_u64()?;
    (world["eventSeq"] == seq
        && world["log"].as_array()?.last()? == wait
        && world["transports"][SHIP] == sailing())
    .then_some(seq)
}

pub(super) fn dock(
    world: &mut Value,
    geo: &Geography<'_>,
    catalog: &Catalog,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<()> {
    before_docking(world)?;
    let transport = geo.packs().find_map(|pack| pack["transports"].get(SHIP))?;
    let lane = json!({"from":"pond","to":HARBOR});
    if transport["place"] != SHIP
        || !transport["lanes"].as_array()?.contains(&lane)
        || !geo.entity_active(world, HARBOR)?
    {
        return None;
    }
    let aboard = riders(world, geo)?;
    let knowledge = world["routeKnowledge"].as_object_mut()?;
    let edges = json!([
        ["sea:greek-harbor", "sea:pond"],
        ["sea:pond", "sea:greek-harbor"]
    ]);
    for id in &aboard {
        if knowledge.get(*id).is_some_and(|known| known != &json!([])) {
            return None;
        }
        knowledge.insert((*id).into(), edges.clone());
    }
    if opening_settlement::sail_arrival(world, catalog, SHIP, &aboard)?
        != [json!({"id":SHIP,"kind":"arrive","from":"pond","dock":HARBOR,"riders":aboard})]
        || riders(world, geo)? != aboard
    {
        return None;
    }
    let cast = room(world, geo, authored, order)?;
    let ship = evidence.profile(SHIP)?["name"].as_str()?;
    let harbor = evidence.profile(HARBOR)?["name"].as_str()?;
    evidence.narrate(
        world,
        &cast,
        &[CLOTH],
        SHIP,
        &format!("{ship} docks at {harbor}."),
    )?;
    docking_event(world)?;
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = request.get("world")?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let world = if request["op"] == "opening_pond_ship_wait" {
        begin_with(
            wait_world(request)?,
            &geo,
            &authored,
            &order,
            &evidence,
            |_| Some(()),
        )?
        .0
    } else {
        let mut world = before.clone();
        dock(&mut world, &geo, &catalog, &authored, &order, &evidence)?;
        world
    };
    Some(json!({"ok":true,"world":world}))
}
