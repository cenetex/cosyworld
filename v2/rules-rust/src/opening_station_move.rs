use super::{
    authored_order::Order,
    lamp_state,
    opening::{self, MAX_REVISION},
    opening_content, opening_crossings,
    opening_full_wait::visible_items,
    opening_held_items,
    opening_pickups::item_as_named,
    opening_pond_call_view, opening_pond_return_view, opening_pond_view, opening_roster,
    opening_second_attic_tail, opening_station_read, opening_station_view, opening_visitor_routes,
    opening_wait_response::{ordinary_attic_wait, vale_action},
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography, LampPosition,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const STATION: &str = "station";
const BEHIND: &str = "behind-station";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const LAMP: &str = "lamp";
const CLOTH: &str = "cloth";

pub(super) fn move_world(request: &Value) -> Option<(&Value, bool)> {
    move_world_to(request, STATION)
}

pub(super) fn quest_return_world(request: &Value) -> Option<(&Value, bool)> {
    let (world, carry) = move_world(request)?;
    (world["turn"] == 4 && world["actors"][VALE]["place"] == POND).then_some((world, carry))
}

pub(super) fn return_world(request: &Value) -> Option<(&Value, bool)> {
    move_world_to(request, POND)
}

pub(super) fn cloth_return_world(request: &Value) -> Option<(&Value, Option<CarriedItem>)> {
    let (world, key) = move_request(request)?;
    let item = match key {
        "move:vale::pond" => None,
        "move:vale:lamp:pond" => Some(CarriedItem::Lamp),
        "move:vale:cloth:pond" => Some(CarriedItem::Cloth),
        _ => return None,
    };
    (world["turn"] == 5 && world["actors"][VALE]["place"] == STATION).then_some((world, item))
}

pub(super) fn behind_world(request: &Value) -> Option<(&Value, bool)> {
    move_world_to(request, BEHIND)
}

fn move_world_to<'a>(request: &'a Value, to: &str) -> Option<(&'a Value, bool)> {
    let (before, key) = move_request(request)?;
    let carry = match (to, key) {
        (STATION, "move:vale::station")
        | (POND, "move:vale::pond")
        | (BEHIND, "move:vale::behind-station") => false,
        (STATION, "move:vale:lamp:station")
        | (POND, "move:vale:lamp:pond")
        | (BEHIND, "move:vale:lamp:behind-station") => true,
        _ => return None,
    };
    Some((before, carry))
}

pub(super) fn move_request(request: &Value) -> Option<(&Value, &str)> {
    let before = request.get("world")?;
    let action = &request["action"];
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
    Some((before, action.as_str().or_else(|| action["key"].as_str())?))
}

pub(super) fn quiet_opening(world: &Value) -> bool {
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

pub(super) fn move_event(event: &Value, turn: u64, from: &str, to: &str) -> bool {
    move_between(event, turn, from, to) && (event["itemId"].is_null() || event["itemId"] == LAMP)
}

pub(super) fn cloth_return_event(event: &Value) -> bool {
    move_between(event, 6, STATION, POND)
        && (event["itemId"].is_null() || event["itemId"] == LAMP || event["itemId"] == CLOTH)
}

pub(super) fn move_between(event: &Value, turn: u64, from: &str, to: &str) -> bool {
    event["turn"] == turn
        && event["verb"] == "move"
        && event["fromLocationId"] == from
        && event["locationId"] == to
        && event["targetId"] == to
}

pub(super) fn departure_turn(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    let vale = &world["actors"][VALE];
    let to = vale["place"].as_str()?;
    let event = world["log"].as_array()?.last()?;
    let matches_move = match (turn, to) {
        (3, BEHIND) | (4, POND) => move_event(event, turn, STATION, to),
        (6, POND) => {
            vale["heldItem"] == CLOTH
                && vale["want"]["from"] == "quest:from:keeper"
                && cloth_return_event(event)
        }
        _ => false,
    };
    (matches_move
        && world["arrival"]["fromLocationId"] == STATION
        && world["arrival"]["locationId"] == to
        && world["arrival"]["seq"] == world["eventSeq"]
        && event["seq"] == world["eventSeq"]
        && vale_action(event))
    .then_some(turn)
}

pub(super) fn quest_return_arrival(world: &Value) -> Option<u64> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let event = world["log"].as_array()?.last()?;
    (world["turn"] == 5
        && world.get("began").is_none()
        && world["eventSeq"] == seq
        && world["arrival"] == json!({"seq":seq,"fromLocationId":POND,"locationId":STATION})
        && event["seq"] == seq
        && vale_action(event)
        && move_event(event, 5, POND, STATION)
        && world["actors"][VALE]["place"] == STATION
        && world["actors"][VALE]["want"]["from"] == "quest:from:keeper"
        && world["actors"][PIP]["place"] == STATION
        && world["items"]["cloth"]["holder"] == PIP)
        .then_some(seq)
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
    let visitor = world["log"]
        .as_array()?
        .iter()
        .find(|event| event["seq"] == after && event["kind"] == "action");
    let Some(visitor) = visitor else {
        return Some(follow);
    };
    if opening_station_view::historic_ada_move(world, visitor) {
        let ship = &world["transports"]["greek-ship"];
        return (ship["phase"] == "docked"
            && ship["dock"] == "greek-harbor"
            && ship["since"] == world["turn"]
            && ship["riders"].as_array()?.is_empty())
        .then_some(after);
    }
    let actor = &world["actors"]["orin"];
    (actor["place"] == "willows-bank"
        && actor["visited"] == json!(["pavilion", "willows-bank"])
        && actor["heldItem"].is_null()
        && world["items"]["board"]["holder"] == "pavilion"
        && visitor["actorId"] == "orin"
        && visitor["generated"] != true
        && visitor["itemId"].is_null()
        && visitor["witnesses"] == json!(["orin", "board"])
        && move_event(visitor, 482, "pavilion", "willows-bank"))
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

fn quiet_departure(world: &Value, with_cloth: bool) -> Option<()> {
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
            .iter()
            .any(|(id, resident)| {
                let attachments = &resident["attachments"];
                if with_cloth && id == VALE {
                    *attachments != json!({"cloth":{"from":PIP,"turn":5}})
                } else {
                    attachments.as_object().is_none_or(|map| !map.is_empty())
                }
            })
        || (with_cloth && world["life"]["actors"].get(VALE).is_none())
    {
        return None;
    }
    Some(())
}

fn quiet_source(world: &Value, geo: &Geography<'_>) -> Option<()> {
    quiet_departure(world, false)?;
    if world.get("began").is_some_and(|began| began != 480) {
        return None;
    }
    opening_pond_view::quiet_pond(world, geo)?;
    opening_pond_view::pond_paths(world, geo)?;
    quiet_station_destination(world, geo, &[KEEPER])
}

fn quiet_quest_station_return(world: &Value, geo: &Geography<'_>) -> Option<()> {
    quiet_departure(world, false)?;
    opening_pond_return_view::verify_arrival(world, geo)?;
    if !world["conversations"].as_array()?.is_empty()
        || [PIP, KEEPER]
            .iter()
            .any(|id| !world["actors"][*id]["sleeping"].is_null())
        || !geo.entity_active(world, PIP)?
        || world["actors"][PIP]["heldItem"] != "cloth"
        || geo.files()["v2/card-game/forest.json"]["places"][STATION]["sanctuary"] == true
    {
        return None;
    }
    quiet_station_destination(world, geo, &[KEEPER, PIP])
}

fn quiet_station_destination(world: &Value, geo: &Geography<'_>, residents: &[&str]) -> Option<()> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    if forest["homeGates"][POND]["opening"] == true
        || world["actors"][KEEPER]["place"] != STATION
        || !geo.entity_active(world, KEEPER)?
    {
        return None;
    }
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
        if !residents.contains(&id.as_str())
            && actor["place"] == STATION
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

fn quiet_return_source(world: &Value, geo: &Geography<'_>) -> Option<()> {
    if world["actors"][VALE]["want"] != opening_station_read::keeper_want(world, geo)?
        || world["speechVoices"][VALE] != json!([])
    {
        return None;
    }
    opening_pond_view::pond_paths(world, geo)?;
    quiet_station_departure(world, geo, POND, false)
}

fn quiet_cloth_return_source(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let read = opening_pond_call_view::station_cloth_gift(world)?;
    let vale = &world["actors"][VALE];
    if vale["want"] != opening_station_read::keeper_want_from_read(world, geo, read)?
        || world["speechVoices"][VALE] != json!([VALE])
        || !vale["under"].is_null()
        || !vale["arcana"].is_null()
        || !world["pondLampLoan"].is_null()
        || world["items"][CLOTH]["holder"] != VALE
        || !geo.entity_active(world, CLOTH)?
    {
        return None;
    }
    opening_pond_view::pond_paths(world, geo)?;
    quiet_station_departure(world, geo, POND, true)
}

fn quiet_behind_source(world: &Value, geo: &Geography<'_>, order: &[&str]) -> Option<()> {
    if (!world["began"].is_null() && world["began"] != 0)
        || !world["actors"][VALE]["want"].is_null()
        || world["speechVoices"][VALE] != json!([VALE, KEEPER])
    {
        return None;
    }
    opening_station_view::settled_first_arrival(world, geo, order)?;
    quiet_station_departure(world, geo, BEHIND, false)
}

fn quiet_station_departure(
    world: &Value,
    geo: &Geography<'_>,
    to: &str,
    with_cloth: bool,
) -> Option<()> {
    quiet_departure(world, with_cloth)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    let lamp = &world["items"][LAMP];
    let ordinary_hand =
        vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && lamp["fuelRooms"] == 0);
    let valid_hand = if with_cloth {
        vale["heldItem"] == CLOTH
    } else {
        ordinary_hand
    };
    if vale["visited"] != json!(["attic", POND, STATION])
        || !world["disabledPacks"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || lamp["holder"] != VALE
        || lamp["fuelPlace"] != STATION
        || lamp["lit"] != false
        || !valid_hand
        || world["items"].as_object()?.iter().any(|(id, item)| {
            (item["holder"] == VALE && id != LAMP && !(with_cloth && id == CLOTH))
                || item["holder"] == LAMP
                || (with_cloth && item["holder"] == CLOTH)
        })
        || forest["homeGates"][STATION]["opening"] == true
        || forest["places"][to]["sanctuary"] == true
        || !geo.entity_active(world, LAMP)?
        || !geo.base_exits(STATION)?.iter().any(|place| place == to)
        || geo.packs().any(|pack| {
            pack["crossings"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|edge| edge["from"] == STATION && edge["to"] == to)
        })
        || forest["reflectionRoutes"]
            .as_array()?
            .iter()
            .any(|edge| edge["from"] == STATION && edge["to"] == to)
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
        if (actor["place"] == to
            || (actor["place"] == STATION && ![VALE, "moth", KEEPER].contains(&id.as_str())))
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    if !opening_visitor_routes::exits(world, geo, VALE, STATION)?.contains(&to) {
        return None;
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

pub(super) fn departure_witnesses<'a>(
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

#[derive(Clone, Copy)]
pub(super) enum CarriedItem {
    Lamp,
    Cloth,
}

impl CarriedItem {
    fn id(self) -> &'static str {
        match self {
            Self::Lamp => LAMP,
            Self::Cloth => CLOTH,
        }
    }
}

enum Passage {
    Station(bool),
    QuestStation(bool),
    Pond(bool),
    ClothPond(Option<CarriedItem>),
    Behind(bool),
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

pub(super) fn begin_cloth_return_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    item: Option<CarriedItem>,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    begin_passage(
        before,
        geo,
        authored,
        order,
        evidence,
        Passage::ClothPond(item),
        prepare,
    )
}

pub(super) fn begin_quest_return_with<T>(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    carry: bool,
    prepare: impl FnOnce(&Value) -> Option<T>,
) -> Option<(Value, T)> {
    let (world, prepared) = begin_passage(
        before,
        geo,
        authored,
        order,
        evidence,
        Passage::QuestStation(carry),
        prepare,
    )?;
    quest_return_arrival(&world)?;
    Some((world, prepared))
}

pub(super) fn begin_behind_with<T>(
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
        Passage::Behind(carry),
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
    let (from, to, item) = match passage {
        Passage::Station(carry) => {
            quiet_source(before, geo)?;
            (POND, STATION, carry.then_some(CarriedItem::Lamp))
        }
        Passage::QuestStation(carry) => {
            quiet_quest_station_return(before, geo)?;
            (POND, STATION, carry.then_some(CarriedItem::Lamp))
        }
        Passage::Pond(carry) => {
            quiet_return_source(before, geo)?;
            (STATION, POND, carry.then_some(CarriedItem::Lamp))
        }
        Passage::ClothPond(item) => {
            quiet_cloth_return_source(before, geo)?;
            (STATION, POND, item)
        }
        Passage::Behind(carry) => {
            quiet_behind_source(before, geo, order)?;
            (STATION, BEHIND, carry.then_some(CarriedItem::Lamp))
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
    let item_id = item.map(CarriedItem::id);
    let text = if let Some(id) = item_id {
        let carried = item_as_named(forest["things"][id]["name"].as_str()?);
        format!("{vale} carries {carried} to {destination}.")
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
    for id in [LAMP, CLOTH] {
        if world["items"][id]["holder"] == VALE {
            let history = world["items"][id]["history"].as_array_mut()?;
            history.push(json!(format!(
                "Turn {turn}: {vale} carried it to {destination}."
            )));
            history.drain(..history.len().saturating_sub(12));
        }
    }
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
        "itemId":item_id, "targetId":to,
    });
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] = json!({"seq":world["eventSeq"], "locationId":to, "fromLocationId":from});
    Some((world, prepared))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, passage) = quest_return_world(request)
        .map(|(world, carry)| (world, Passage::QuestStation(carry)))
        .or_else(|| move_world(request).map(|(world, carry)| (world, Passage::Station(carry))))
        .or_else(|| {
            cloth_return_world(request).map(|(world, item)| (world, Passage::ClothPond(item)))
        })
        .or_else(|| return_world(request).map(|(world, carry)| (world, Passage::Pond(carry))))
        .or_else(|| behind_world(request).map(|(world, carry)| (world, Passage::Behind(carry))))?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let prepare = |_: &Value| Some(());
    let (world, ()) = match passage {
        Passage::Station(carry) => {
            begin_with(before, &geo, &authored, &order, &evidence, carry, prepare)
        }
        Passage::QuestStation(carry) => {
            begin_quest_return_with(before, &geo, &authored, &order, &evidence, carry, prepare)
        }
        Passage::Pond(carry) => {
            begin_return_with(before, &geo, &authored, &order, &evidence, carry, prepare)
        }
        Passage::ClothPond(item) => {
            begin_cloth_return_with(before, &geo, &authored, &order, &evidence, item, prepare)
        }
        Passage::Behind(carry) => {
            begin_behind_with(before, &geo, &authored, &order, &evidence, carry, prepare)
        }
    }?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
