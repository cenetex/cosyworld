use super::{
    authored_order::Order,
    lamp_state,
    opening::{self, MAX_REVISION},
    opening_content, opening_crossings,
    opening_full_wait::visible_items,
    opening_held_items,
    opening_pickups::item_as_named,
    opening_pond_view, opening_roster, opening_second_attic_tail, opening_station_view,
    opening_visitor_routes,
    opening_wait_response::{ordinary_attic_wait, vale_action},
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography, LampPosition,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const STATION: &str = "station";
const KEEPER: &str = "keeper";
const LAMP: &str = "lamp";

pub(super) fn move_world(request: &Value) -> Option<(&Value, bool)> {
    move_world_to(request, STATION)
}

pub(super) fn return_world(request: &Value) -> Option<(&Value, bool)> {
    move_world_to(request, POND)
}

fn move_world_to<'a>(request: &'a Value, to: &str) -> Option<(&'a Value, bool)> {
    let before = request.get("world")?;
    let action = &request["action"];
    let carry = match (to, action.as_str().or_else(|| action["key"].as_str())?) {
        (STATION, "move:vale::station") | (POND, "move:vale::pond") => false,
        (STATION, "move:vale:lamp:station") | (POND, "move:vale:lamp:pond") => true,
        _ => return None,
    };
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != before["revision"])
        || !(request["elysiumPortraits"].is_null()
            || request["elysiumPortraits"]
                .as_array()
                .is_some_and(Vec::is_empty))
        || action["kind"] == "pack"
    {
        return None;
    }
    Some((before, carry))
}

fn quiet_opening(world: &Value) -> bool {
    [
        "hidden",
        "absent",
        "homecoming",
        "gone",
        "invitedPlaces",
        "sharedMigration",
    ]
    .iter()
    .all(|field| world[*field].is_null())
}

fn move_event(event: &Value, turn: u64, from: &str, to: &str) -> bool {
    event["turn"] == turn
        && event["verb"] == "move"
        && event["fromLocationId"] == from
        && event["locationId"] == to
        && event["targetId"] == to
        && (event["itemId"].is_null() || event["itemId"] == LAMP)
}

pub(super) fn arrival(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    (matches!(turn, 2 | 3) && world.get("began").is_none()).then_some(())?;
    arrived_from_pond(world, turn, turn == 3, false)
}

pub(super) fn historic_arrival(world: &Value) -> Option<u64> {
    (world["began"] == 480 && world["turn"] == 482).then_some(())?;
    arrived_from_pond(world, 482, false, false)
}

pub(super) fn historic_follow(world: &Value) -> Option<u64> {
    let seq = historic_arrival(world)?.checked_add(1)?;
    let pip = &world["actors"]["moth"];
    let follow = world["log"]
        .as_array()?
        .iter()
        .find(|entry| entry["seq"] == seq)?;
    (pip["place"] == STATION
        && pip["sleeping"].is_null()
        && follow["kind"] == "action"
        && follow["actorId"] == "moth"
        && follow["generated"] != true
        && follow["itemId"].is_null()
        && move_event(follow, 482, POND, STATION))
    .then_some(seq)
}

pub(super) fn historic_resident_moves(world: &Value) -> Option<u64> {
    let follow = historic_follow(world)?;
    let after = follow.checked_add(1)?;
    let cass = world["log"]
        .as_array()?
        .iter()
        .find(|event| event["seq"] == after && event["actorId"] == "orin");
    let Some(cass) = cass else {
        return Some(follow);
    };
    let actor = &world["actors"]["orin"];
    (actor["place"] == "willows-bank"
        && actor["visited"] == json!(["pavilion", "willows-bank"])
        && actor["heldItem"].is_null()
        && world["items"]["board"]["holder"] == "pavilion"
        && cass["kind"] == "action"
        && cass["generated"] != true
        && cass["itemId"].is_null()
        && cass["witnesses"] == json!(["orin", "board"])
        && move_event(cass, 482, "pavilion", "willows-bank"))
    .then_some(after)
}

pub(super) fn abandoned_train_arrival(world: &Value) -> Option<u64> {
    let prior = world["turn"].as_u64()?.checked_sub(1)?;
    (matches!(prior, 2 | 3)
        && world.get("began").is_none()
        && world["actors"][VALE]["closed"]["quest:box:train"][0] == world["turn"]
        && world["actors"][VALE]["gaveUp"]["target"] == "routes")
        .then_some(())?;
    arrived_from_pond(world, prior, prior == 3, true)
}

fn arrived_from_pond(world: &Value, turn: u64, waited: bool, abandoned: bool) -> Option<u64> {
    let receipt = &world["arrival"];
    let seq = receipt["seq"].as_u64()?;
    let vale = &world["actors"][VALE];
    if !quiet_opening(world)
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["opening"]["version"] != 1
        || world["opening"]["crossed"] != true
        || world["locations"]["attic"]["anchored"] != true
        || world["opening"]["met"]["moth"] != turn - 1
        || world["opening"]["met"][KEEPER] != turn
        || vale["place"] != STATION
        || vale["crossed"] != 1
        || receipt["fromLocationId"] != POND
        || receipt["locationId"] != STATION
        || world["eventSeq"].as_u64()? < seq
    {
        return None;
    }
    let mut actions = world["log"]
        .as_array()?
        .iter()
        .filter(|event| vale_action(event));
    let first = actions.next()?;
    let pond = if waited {
        if !ordinary_attic_wait(first) || first["turn"] != 1 {
            return None;
        }
        let pond = actions.next()?;
        if first["seq"].as_u64()? >= pond["seq"].as_u64()? {
            return None;
        }
        pond
    } else {
        first
    };
    let station = actions.next()?;
    if abandoned {
        let drop = actions.next()?;
        if drop["turn"] != turn + 1
            || drop["verb"] != "drop"
            || drop["locationId"] != STATION
            || !drop["itemId"].is_null()
            || !drop["targetId"].is_null()
            || drop["seq"].as_u64()? <= seq
        {
            return None;
        }
    }
    (move_event(pond, turn - 1, "attic", POND)
        && pond["seq"].as_u64()? < seq
        && move_event(station, turn, POND, STATION)
        && station["seq"] == seq
        && actions.next().is_none())
    .then_some(seq)
}

pub(super) fn rue_arrived(world: &Value) -> bool {
    world["turn"] == 2
        && world["actors"]["rue"]["place"] == STATION
        && world["opening"]["met"]["rue"] == 2
        && world["packs"]["shared-homes"]["met"]["rue"] == 2
}

fn quiet_departure(world: &Value) -> Option<()> {
    if !quiet_opening(world)
        || world["actors"][VALE]["crossed"] != 1
        || world["packs"].as_object()?.values().any(|pack| {
            pack["recitals"]
                .as_object()
                .into_iter()
                .flat_map(|map| map.values())
                .any(|recital| recital["actor"] == VALE && recital["visit"].is_null())
        })
        || world["life"]["actors"]
            .as_object()?
            .values()
            .any(|resident| {
                resident["attachments"]
                    .as_object()
                    .is_none_or(|map| !map.is_empty())
            })
    {
        return None;
    }
    Some(())
}

fn quiet_source(world: &Value, geo: &Geography<'_>) -> Option<()> {
    quiet_departure(world)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    if world.get("began").is_some_and(|began| began != 480)
        || forest["homeGates"][POND]["opening"] == true
        || world["actors"][KEEPER]["place"] != STATION
        || !geo.entity_active(world, KEEPER)?
    {
        return None;
    }
    opening_pond_view::quiet_pond(world, geo)?;
    opening_pond_view::pond_paths(world, geo)?;
    opening_second_attic_tail::verify_station_order(world, geo)?;
    if geo.packs().any(|pack| {
        pack["avatars"].get(KEEPER).is_some()
            || pack["choices"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|choice| {
                    choice["on"] == "meet" && (choice["at"].is_null() || choice["at"] == STATION)
                })
            || pack["crossings"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|edge| edge["from"] == POND && edge["to"] == STATION)
            || pack["transports"]
                .as_object()
                .into_iter()
                .flatten()
                .any(|(_, ship)| ship["place"] == STATION)
    }) {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != KEEPER && actor["place"] == STATION && geo.entity_active(world, id)? {
            return None;
        }
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

fn quiet_return_source(world: &Value, geo: &Geography<'_>) -> Option<()> {
    quiet_departure(world)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    let lamp = &world["items"][LAMP];
    if vale["want"] != opening_station_view::keeper_want(world, geo)?
        || vale["visited"] != json!(["attic", POND, STATION])
        || world["speechVoices"][VALE] != json!([])
        || !world["disabledPacks"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || lamp["holder"] != VALE
        || lamp["fuelPlace"] != STATION
        || lamp["lit"] != false
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && lamp["fuelRooms"] == 0))
        || world["items"]
            .as_object()?
            .iter()
            .any(|(id, item)| (item["holder"] == VALE && id != LAMP) || item["holder"] == LAMP)
        || forest["homeGates"][STATION]["opening"] == true
        || forest["places"][POND]["sanctuary"] == true
        || !geo.entity_active(world, LAMP)?
        || !geo.base_exits(STATION)?.iter().any(|place| place == POND)
        || geo.packs().any(|pack| {
            pack["crossings"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|edge| edge["from"] == STATION && edge["to"] == POND)
        })
        || forest["reflectionRoutes"]
            .as_array()?
            .iter()
            .any(|edge| edge["from"] == STATION && edge["to"] == POND)
    {
        return None;
    }
    for id in [VALE, "moth", KEEPER] {
        let actor = actors.get(id)?;
        if actor["place"] != STATION
            || !actor["sleeping"].is_null()
            || !geo.entity_active(world, id)?
        {
            return None;
        }
    }
    for (id, actor) in actors {
        if (actor["place"] == POND
            || (actor["place"] == STATION && ![VALE, "moth", KEEPER].contains(&id.as_str())))
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    opening_pond_view::pond_paths(world, geo)?;
    if !opening_visitor_routes::exits(world, geo, VALE, STATION)?.contains(&POND) {
        return None;
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

fn departure_witnesses<'a>(
    world: &Value,
    geo: &Geography<'_>,
    authored: &'a Order,
    from: &str,
) -> Option<Vec<&'a str>> {
    let mut witnesses = Vec::new();
    for id in &authored.actors {
        if world["actors"][id]["place"] == from && geo.entity_active(world, id)? {
            witnesses.push(id.as_str());
        }
    }
    witnesses.extend(visible_items(world, geo, authored, from)?);
    Some(witnesses)
}

enum Passage {
    Station(bool),
    Pond(bool),
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
    begin_passage(
        before,
        geo,
        authored,
        order,
        evidence,
        Passage::Station(carry),
        prepare,
    )
}

pub(super) fn begin_return_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    carry: bool,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    begin_passage(
        before,
        geo,
        authored,
        order,
        evidence,
        Passage::Pond(carry),
        prepare,
    )
}

fn begin_passage<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    passage: Passage,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    let (from, to, carry) = match passage {
        Passage::Station(carry) => {
            quiet_source(before, geo)?;
            (POND, STATION, carry)
        }
        Passage::Pond(carry) => {
            quiet_return_source(before, geo)?;
            (STATION, POND, carry)
        }
    };
    let turn = before["turn"].as_u64()?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    let vale = forest["people"][VALE]["name"].as_str()?;
    let destination = forest["places"][to]["name"].as_str()?;
    let text = if carry {
        let lamp = item_as_named(forest["things"][LAMP]["name"].as_str()?);
        format!("{vale} carries {lamp} to {destination}.")
    } else {
        format!("{vale} goes to {destination}.")
    };

    let mut world = before.clone();
    world["turn"] = turn.into();
    world["revision"] = revision.into();
    world["playerActorId"] = json!(VALE);
    for key in ["heldActors", "controlledActors", "presentActors"] {
        world[key] = json!([VALE]);
    }
    let actor = world["actors"][VALE].as_object_mut()?;
    actor.remove("offered");
    actor.remove("guarding");
    let prepared = prepare(&world)?;
    let hands = opening_held_items::snapshot(&world, geo)?;
    let witnesses = departure_witnesses(&world, geo, authored, from)?;
    world["actors"][VALE]["place"] = json!(to);
    let history = world["items"][LAMP]["history"].as_array_mut()?;
    history.push(json!(format!(
        "Turn {turn}: {vale} carried it to {destination}."
    )));
    history.drain(..history.len().saturating_sub(12));
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    let held = world["actors"][VALE]["heldItem"] == LAMP;
    let lamp = &mut world["items"][LAMP];
    lamp_state(lamp)
        .ok()?
        .settle(LampPosition {
            place: to.into(),
            held,
            grounded: false,
        })
        .write(lamp);
    opening_crossings::no_crossing_unlocks(&world, geo)?;
    if to == STATION {
        let met = world["opening"]["met"].as_object_mut()?;
        for id in [VALE, KEEPER] {
            met.entry(id).or_insert_with(|| json!(turn));
        }
    }
    let cast = opening_roster::known_actors(&world, geo, order, Some(to))?;
    let items = visible_items(&world, geo, authored, to)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":VALE, "text":text,
        "locationId":to, "fromLocationId":from, "witnesses":witnesses,
        "itemId":carry.then_some(LAMP), "targetId":to,
    });
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] = json!({"seq":world["eventSeq"], "locationId":to, "fromLocationId":from});
    Some((world, prepared))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let to_station = move_world(request);
    let (before, carry) = to_station.or_else(|| return_world(request))?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (world, ()) = if to_station.is_some() {
        begin_with(before, &geo, &authored, &order, &evidence, carry, |_| {
            Some(())
        })?
    } else {
        begin_return_with(before, &geo, &authored, &order, &evidence, carry, |_| {
            Some(())
        })?
    };
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
