use super::{
    authored_order::Order,
    opening_content, opening_crossings, opening_full_wait, opening_mirror_move,
    opening_pickups::{self, Custody},
    opening_pond_call_view::{cloth_arrival, completion_owners},
    opening_roster, opening_station_move, opening_station_read, opening_station_view,
    opening_visitor_routes,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    seed, Geography,
};
use serde_json::{json, Value};

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn quiet_turn(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    if !matches!(turn, 2..=7)
        || world.get("began").is_some_and(|began| began != 0)
        || world["playerActorId"] != "vale"
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || !["heldActors", "controlledActors", "presentActors"]
            .iter()
            .all(|field| {
                world[*field]
                    .as_array()
                    .is_some_and(|actors| actors.len() == 1 && actors[0] == "vale")
            })
    {
        return None;
    }
    match (turn, world["actors"]["vale"]["place"].as_str()?) {
        (2, "attic") => entries(&world["log"])
            .any(|event| {
                event["turn"] == 2
                    && event["actorId"] == "vale"
                    && event["kind"] == "action"
                    && event["locationId"] == "attic"
                    && matches!(event["verb"].as_str(), Some("take" | "wait"))
                    && event["sleep"].is_null()
                    && event["guards"].is_null()
            })
            .then_some(()),
        (2, "pond") => opening_mirror_move::second_arrival(world),
        (3, "behind-station") | (4 | 6, "pond") => {
            opening_station_move::departure_turn(world).map(|_| ())
        }
        (5, "station") => opening_station_view::keeper_return::gift_head(world).map(|_| ()),
        (7, "pond") => pond_drop_scene(world),
        (_, "station") => opening_station_move::arrival(world)
            .or_else(|| opening_station_move::abandoned_train_arrival(world))
            .or_else(|| opening_station_read::after_first_log(world))
            .or_else(|| opening_station_view::keeper_abandon_head(world))
            .map(|_| ()),
        _ => None,
    }?;
    Some(turn)
}

fn pond_drop_route(actor: &str, from: &str, to: &str) -> bool {
    matches!(
        (actor, from, to),
        ("tavi", "hill", "forest-oak") | ("ada", "loft", "greek-ship")
    )
}

fn pond_drop_scene(world: &Value) -> Option<()> {
    let seq = cloth_arrival(world, true)?.0.checked_add(1)?;
    let lamp = &world["items"]["lamp"];
    let lit = lamp["lit"].as_bool()?;
    let crossing = if lit {
        json!({"discovered":true,"method":"pond-lamp"})
    } else {
        json!({"discovered":false})
    };
    let log = world["log"].as_array()?;
    let start = log.iter().position(|event| event["seq"] == seq)?;
    let [drop, rest @ ..] = log.get(start..)? else {
        return None;
    };
    let owners = if lit { completion_owners(world) } else { &[] };
    let (calls, moves) = rest.split_at_checked(owners.len())?;
    if lamp["holder"] != "pond"
        || drop["light"] != lit
        || world["actors"]["vale"]["heldItem"] != "cloth"
        || world["items"]["cloth"]["holder"] != "vale"
        || world["crossings"]["pond-greek-harbor"] != crossing
        || log.last()?["seq"] != world["eventSeq"]
        || moves.len() > 2
        || (!lit && !moves.is_empty())
        || rest.iter().enumerate().any(|(index, event)| {
            event["turn"] != 7
                || event["seq"].as_u64() != seq.checked_add(index as u64 + 1)
                || event["generated"] == true
        })
        || calls.iter().zip(owners).any(|(event, owner)| {
            event["kind"] != "narration"
                || event["actorId"] != "vale"
                || event["verb"] != "want_met"
                || event["ownerId"] != *owner
                || event["locationId"] != "pond"
        })
    {
        return None;
    }
    let mut first = None;
    for event in moves {
        let actor = event["actorId"].as_str()?;
        let from = event["fromLocationId"].as_str()?;
        let to = event["locationId"].as_str()?;
        if Some(actor) == first
            || !pond_drop_route(actor, from, to)
            || event["kind"] != "action"
            || event["verb"] != "move"
            || event["itemId"] != Value::Null
            || event["targetId"] != to
            || world["actors"][actor]["place"] != to
        {
            return None;
        }
        first = Some(actor);
    }
    Some(())
}

fn historic_visitor_turn(
    world: &Value,
    geo: &Geography<'_>,
    actor: &str,
    home: &str,
    item: &str,
) -> Option<(u64, &'static str)> {
    let (target, to) = match (actor, home, item) {
        ("orin", "pavilion", "board")
            if world["actors"]["willows-swede"]["place"] == "willows-camp"
                && geo.entity_active(world, "willows-swede")? =>
        {
            ("willows-swede", "willows-bank")
        }
        ("ada", "loft", "shears") if world["run"]["seed"] == 99 => ("vale", "greek-ship"),
        _ => return None,
    };
    let follow = opening_station_move::historic_follow(world)?;
    let turn = world["turn"].as_u64()?;
    let log = world["log"].as_array()?;
    let visitor = &world["actors"][actor];
    if world["playerActorId"] != "vale"
        || ["heldActors", "presentActors", "controlledActors"]
            .iter()
            .any(|key| world[*key] != json!(["vale"]))
        || geo.files()["v2/card-game/world-history.json"]["turns"] != world["began"]
        || !world["standoffs"].as_array()?.is_empty()
        || world["conversations"]
            .as_array()?
            .iter()
            .any(|record| record["turn"].as_u64().is_none_or(|at| at >= turn))
        || world["eventSeq"] != follow
        || log.last()?["seq"] != follow
        || visitor["place"] != home
        || visitor["visited"] != json!([home])
        || visitor["want"] != json!({"kind":"person","target":target,"since":480,"refusals":0})
        || !geo.visiting_resident(world, actor)
    {
        return None;
    }
    let take = log.iter().rev().find(|event| {
        event["actorId"] == actor && event["kind"] == "action" && event["generated"] != true
    })?;
    (take["turn"] == 481
        && take["seq"].as_u64()?.checked_add(1)? < follow
        && take["verb"] == "take"
        && take["itemId"] == item
        && take["locationId"] == home)
        .then_some((turn, to))
}

fn board_docked_ship(world: &mut Value, geo: &Geography<'_>, turn: u64) -> Option<()> {
    let ship = geo
        .packs()
        .find_map(|pack| pack["transports"].get("greek-ship"))?;
    let state = world.get_mut("transports")?.get_mut("greek-ship")?;
    let since = state["since"].as_u64()?;
    let berth = if turn == 7 {
        state["dock"] == "pond" && since == turn
    } else {
        state["dock"] == ship["at"] && since < turn
    };
    if ship["place"] != "greek-ship"
        || ship["at"] != "greek-harbor"
        || state["version"] != 3
        || state["phase"] != "docked"
        || !berth
        || !state["destination"].is_null()
        || !state["recall"].is_null()
        || !state["riders"].as_array()?.is_empty()
    {
        return None;
    }
    state["since"] = json!(turn);
    Some(())
}

fn room<'a>(geo: &Geography<'a>, id: &str) -> Option<&'a Value> {
    geo.packs()
        .find_map(|pack| pack["places"].get(id))
        .or_else(|| geo.files()["v2/card-game/forest.json"]["places"].get(id))
}

fn dwell_until(actor: &str, turn: u64) -> u64 {
    turn + 24 + u64::from(seed::hash(&format!("{actor}@{turn}")) % 6)
}

pub(super) fn home_destination<'a>(
    world: &mut Value,
    geo: &Geography<'a>,
    actor: &str,
    home: &str,
) -> Option<Option<&'a str>> {
    let target = world["actors"][actor]["want"]["target"].as_str()?;
    let place = world["actors"][target]["place"].as_str()?.to_owned();
    let routes = opening_visitor_routes::home_person_routes(world, geo, actor)?;
    if routes.direct.is_some() {
        return Some(routes.direct);
    }
    if place == "attic" {
        return Some(routes.pond);
    }
    let interior = geo.attic_interior()?;
    if interior.contains(home)
        && routes.attic.is_some()
        && opening_visitor_routes::reaches_from(world, geo, actor, "pond", &place)?
    {
        Some(routes.attic)
    } else if !interior.contains(home) && interior.contains(place.as_str()) {
        Some(routes.attic.or(routes.pond))
    } else {
        Some(None)
    }
}

fn quiet_departure_wait(
    world: &Value,
    geo: &Geography,
    order: &[&str],
    custody: &Custody,
    actor: &str,
    home: &str,
    item: &str,
) -> Option<()> {
    let resident = world["actors"].get(actor)?;
    let here = resident["place"].as_str()?;
    let want = &resident["want"];
    let read = opening_station_read::after_first_log(world)
        .or_else(|| opening_station_view::keeper_abandon_head(world)?.checked_sub(3))
        .or_else(|| opening_station_view::keeper_return::gift_head(world)?.checked_sub(4));
    let same_room =
        opening_station_move::abandoned_train_arrival(world).is_some() || read.is_some();
    let round = world["turn"].as_u64()?;
    let station_departure = round == 7 || opening_station_move::departure_turn(world).is_some();
    if (!same_room && !station_departure && round != 3)
        || (!station_departure && world["actors"]["vale"]["place"] != "station")
        || here == "station"
        || resident["crossed"] != 1
        || resident["dwellUntil"].as_u64()? <= round
        || resident["visited"] != json!([home, here])
        || !resident["heldItem"].is_null()
        || !custody.empty(actor)
        || world["items"][item]["holder"] != home
        || world["doors"][home] != here
        || !world["placeCard"][here].is_null()
        || want["kind"] != "person"
        || !want["step"].is_null()
        || !geo.visiting_resident(world, actor)
        || !geo.entity_active(world, here)?
        || (room(geo, here)?["sanctuary"] == true && resident["sanctuary"] != here)
        || geo.packs().any(|pack| {
            pack["transports"]
                .as_object()
                .is_some_and(|ships| ships.values().any(|ship| ship["place"] == here))
        })
    {
        return None;
    }
    let target = want["target"].as_str()?;
    if world["actors"].get(target)?["place"].as_str()? == here
        && opening_roster::known_actors(world, geo, order, Some(here))?.contains(&target)
    {
        return None;
    }
    let homes = geo.packs().find(|pack| pack["id"] == "shared-homes")?;
    let crossing =
        entries(&homes["crossings"]).find(|edge| edge["from"] == home && edge["to"] == here)?;
    if world["crossings"][crossing["id"].as_str()?]["discovered"] != true {
        return None;
    }
    let mut plays = entries(&world["log"]).filter(|event| {
        event["kind"] == "action" && event["actorId"] == actor && event["generated"] != true
    });
    let take = plays.next()?;
    let depart = plays.next()?;
    let departed = depart["turn"].as_u64()?;
    let turn_two = entries(&world["log"]).find(|event| vale_action(event) && event["turn"] == 2)?;
    let seq = turn_two["seq"].as_u64()?;
    let departure_seq = depart["seq"].as_u64()?;
    if take["turn"] != 1
        || take["verb"] != "take"
        || take["itemId"] != item
        || take["locationId"] != home
        || resident["dwellUntil"] != dwell_until(actor, departed)
        || (same_room
            && (!(2..round).contains(&departed)
                || take["seq"].as_u64()? >= departure_seq
                || read.is_some_and(|read_seq| departure_seq >= read_seq)))
        || (!same_room
            && (departed != 2
                || take["seq"].as_u64()? >= seq
                || departure_seq <= seq
                || departure_seq >= world["arrival"]["seq"].as_u64()?))
        || depart["verb"] != "move"
        || depart["fromLocationId"] != home
        || depart["locationId"] != here
        || depart["targetId"] != here
        || !depart["itemId"].is_null()
        || plays.next().is_some()
    {
        return None;
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

fn record_station_meeting(world: &mut Value, geo: &Geography, actor: &str) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let incumbents = ["vale", "moth", "keeper"];
    if turn != 2
        || incumbents.iter().any(|id| {
            world["actors"][id]["place"] != "station"
                || world["opening"]["met"][id]
                    .as_u64()
                    .is_none_or(|met| met > turn)
        })
        || world["opening"]["met"].get(actor).is_some()
        || !world["packs"]["shared-homes"]["met"][actor].is_null()
        || geo.packs().any(|pack| {
            entries(&pack["choices"]).any(|choice| {
                choice["on"] == "meet" && (choice["at"].is_null() || choice["at"] == "station")
            })
        })
        || world["packs"].as_object()?.values().any(|pack| {
            pack["recitals"]
                .as_object()
                .into_iter()
                .flat_map(|map| map.values())
                .any(|recital| recital["actor"] == actor && recital["visit"].is_null())
        })
    {
        return None;
    }
    for &id in &incumbents {
        if !geo.entity_active(world, id)? {
            return None;
        }
    }
    for (id, person) in world["actors"].as_object()? {
        if person["place"] == "station"
            && id != actor
            && !incumbents.contains(&id.as_str())
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    world["opening"]["met"]
        .as_object_mut()?
        .insert(actor.to_owned(), json!(turn));
    world["packs"]["shared-homes"]["met"]
        .as_object_mut()?
        .insert(actor.to_owned(), json!(turn));
    Some(())
}

struct Visitor<'a> {
    actor: &'a str,
    station_meeting: bool,
}

pub(super) fn perform(
    world: &mut Value,
    geo: &Geography,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    custody: &mut Custody,
    actor: &str,
) -> Option<()> {
    let station_meeting = actor == "rue"
        && world["turn"] == 2
        && super::opening_station_move::arrival(world).is_some();
    perform_visitor(
        world,
        geo,
        authored,
        order,
        evidence,
        custody,
        Visitor {
            actor,
            station_meeting,
        },
    )
}

fn perform_visitor(
    world: &mut Value,
    geo: &Geography,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    custody: &mut Custody,
    visitor: Visitor<'_>,
) -> Option<()> {
    let actor = visitor.actor;
    let avatar = entries(&geo.files()["v2/card-game/shared-cast.json"]["avatars"])
        .find(|avatar| avatar["id"] == actor)?;
    let home = avatar["home"]["id"].as_str()?;
    let item = avatar["item"]["id"].as_str()?;
    let (turn, historic_to) = if let Some(turn) = quiet_turn(world) {
        (turn, None)
    } else {
        let (turn, to) = historic_visitor_turn(world, geo, actor, home, item)?;
        (turn, Some(to))
    };
    let a = world["actors"].get(actor)?;
    if !entries(&a["visited"]).any(|place| place == home)
        || ["sleeping", "homeward", "attend", "guarding", "under"]
            .iter()
            .any(|field| !a[*field].is_null())
        || opening_pickups::resting(a, turn)
        || world["peaceUntil"][actor].as_u64()? > turn
        || !world["defeats"][actor].is_null()
        || entries(&world["memories"][actor]["learning"])
            .next()
            .is_some()
        || !geo.entity_active(world, actor)?
    {
        return None;
    }
    if a["place"] != home {
        return quiet_departure_wait(world, geo, order, custody, actor, home, item);
    }
    if a["heldItem"] != item
        || a["dwellUntil"].as_u64().is_some_and(|until| until > turn)
        || !world["placeCard"][home].is_null()
        || !custody.can_transfer_one(actor, home)
        || !geo.entity_active(world, item)?
        || opening_pickups::another_way(geo, home)?
        || world["actors"]
            .as_object()?
            .iter()
            .any(|(id, other)| id != actor && other["place"] == home)
    {
        return None;
    }
    let destination = home_destination(world, geo, actor, home)?;
    if (historic_to.is_some() && destination != historic_to)
        || (destination.is_some() && opening_station_move::departure_turn(world).is_some())
        || (turn == 7
            && destination.is_some_and(|to| {
                world["items"]["lamp"]["lit"] != true || !pond_drop_route(actor, home, to)
            }))
    {
        return None;
    }
    let Some(to) = destination else {
        if geo.packs().any(|pack| {
            entries(&pack["choices"]).any(|choice| choice["at"] == home && choice["on"] == "wait")
        }) {
            return None;
        }
        return Some(());
    };
    let homes = geo.packs().find(|pack| pack["id"] == "shared-homes")?;
    let crossing = entries(&homes["crossings"])
        .find(|crossing| crossing["from"] == home && crossing["to"] == to)?;
    let id = crossing["id"].as_str()?;
    let meeting = to == "station" && world["actors"]["vale"]["place"] == to;
    let boarding = to == "greek-ship" && (historic_to.is_some() || turn == 7);
    if (meeting && !visitor.station_meeting)
        || world["doors"][home] != to
        || crossing["retired"] == true
        || !crossing["signal"].is_null()
        || !crossing["transport"].is_null()
        || world["actors"][actor]["crossed"] != 0
        || entries(&homes["choices"]).next().is_some()
        || (!boarding
            && geo.packs().any(|pack| {
                pack["transports"]
                    .as_object()
                    .is_some_and(|ships| ships.values().any(|ship| ship["place"] == to))
            }))
    {
        return None;
    }
    let first = world["actors"]
        .as_object()?
        .values()
        .all(|a| a["crossed"] == 0);
    let room = room(geo, to)?;
    let name = avatar["name"].as_str()?;
    let place = room["name"].as_str()?;
    let travel = crossing["travel"].as_str()?;
    let ending = if first {
        " Something on the far shore turns its head."
    } else {
        ""
    };
    let dwell = dwell_until(actor, turn);
    custody.transfer_one(actor, home)?;
    world["items"][item]["holder"] = json!(home);
    world["crossings"]
        .get_mut(id)?
        .as_object_mut()?
        .insert("discovered".into(), json!(true));
    let a = &mut world["actors"][actor];
    a["heldItem"] = Value::Null;
    a["place"] = json!(to);
    a["crossed"] = json!(1);
    if boarding {
        board_docked_ship(world, geo, turn)?;
    } else {
        a["dwellUntil"] = json!(dwell);
    }
    opening_crossings::no_crossing_unlocks(world, geo)?;
    if meeting {
        record_station_meeting(world, geo, actor)?;
    }
    let cast = opening_roster::known_actors(world, geo, order, Some(to))?;
    let items = opening_full_wait::visible_items(world, geo, authored, to)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":actor,
        "locationId":to, "fromLocationId":home, "targetId":to, "itemId":null,
        "witnesses":[actor,item], "text":format!("{name} goes to {place} {travel}.{ending}"),
    });
    evidence.record(world, &cast, &items, detail, true)?;
    let a = &mut world["actors"][actor];
    let visited = a["visited"].as_array_mut()?;
    if !visited.iter().any(|place| place == to) {
        visited.push(json!(to));
        visited.drain(..visited.len().saturating_sub(64));
    }
    if room["sanctuary"] == true {
        a["sanctuary"] = json!(to);
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let order = opening_roster::actor_order(request, saved)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut custody = Custody::new(saved)?;
    let mut world = saved.clone();
    perform_visitor(
        &mut world,
        &geo,
        &authored,
        &order,
        &evidence,
        &mut custody,
        Visitor {
            actor: request["actor"].as_str()?,
            station_meeting: true,
        },
    )?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
