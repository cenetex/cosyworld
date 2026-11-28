use super::{
    authored_order::Order,
    lamp_state,
    opening::{self, MAX_REVISION},
    opening_content, opening_crossings,
    opening_full_wait::visible_items,
    opening_held_items,
    opening_pickups::item_as_named,
    opening_pond_view, opening_roster, opening_second_attic_tail,
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
    let before = request.get("world")?;
    let action = &request["action"];
    let carry = match action.as_str().or_else(|| action["key"].as_str())? {
        "move:vale::station" => false,
        "move:vale:lamp:station" => true,
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

fn quiet_source(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    if !quiet_opening(world)
        || world.get("began").is_some_and(|began| began != 480)
        || world["actors"][VALE]["crossed"] != 1
        || forest["homeGates"][POND]["opening"] == true
        || world["actors"][KEEPER]["place"] != STATION
        || !geo.entity_active(world, KEEPER)?
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

fn pond_witnesses<'a>(
    world: &Value,
    geo: &Geography<'_>,
    authored: &'a Order,
) -> Option<Vec<&'a str>> {
    let mut witnesses = Vec::new();
    for id in &authored.actors {
        if world["actors"][id]["place"] == POND && geo.entity_active(world, id)? {
            witnesses.push(id.as_str());
        }
    }
    witnesses.extend(visible_items(world, geo, authored, POND)?);
    Some(witnesses)
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
    quiet_source(before, geo)?;
    let turn = before["turn"].as_u64()?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    let vale = forest["people"][VALE]["name"].as_str()?;
    let station = forest["places"][STATION]["name"].as_str()?;
    let text = if carry {
        let lamp = item_as_named(forest["things"][LAMP]["name"].as_str()?);
        format!("{vale} carries {lamp} to {station}.")
    } else {
        format!("{vale} goes to {station}.")
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
    let witnesses = pond_witnesses(&world, geo, authored)?;
    world["actors"][VALE]["place"] = json!(STATION);
    let history = world["items"][LAMP]["history"].as_array_mut()?;
    history.push(json!(format!(
        "Turn {turn}: {vale} carried it to {station}."
    )));
    history.drain(..history.len().saturating_sub(12));
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    let held = world["actors"][VALE]["heldItem"] == LAMP;
    let lamp = &mut world["items"][LAMP];
    lamp_state(lamp)
        .ok()?
        .settle(LampPosition {
            place: STATION.into(),
            held,
            grounded: false,
        })
        .write(lamp);
    opening_crossings::no_crossing_unlocks(&world, geo)?;
    let met = world["opening"]["met"].as_object_mut()?;
    for id in [VALE, KEEPER] {
        met.entry(id).or_insert_with(|| json!(turn));
    }
    let cast = opening_roster::known_actors(&world, geo, order, Some(STATION))?;
    let items = visible_items(&world, geo, authored, STATION)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":VALE, "text":text,
        "locationId":STATION, "fromLocationId":POND, "witnesses":witnesses,
        "itemId":carry.then_some(LAMP), "targetId":STATION,
    });
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] =
        json!({"seq":world["eventSeq"], "locationId":STATION, "fromLocationId":POND});
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
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
