use super::{
    create, create_geography::Geography, opening, opening_content, opening_play,
    opening_resident_sleep, opening_station_read, opening_visitor_routes, pack_state::Catalog,
    seed,
};
use serde_json::{json, Value};
use std::collections::{btree_map::Entry, BTreeMap, BTreeSet, VecDeque};

const BARD: &str = "greek-rhapsode";
const GREEK: &str = "greek-drama";
type Edge<'a> = (&'a str, &'a str);

fn remember_visible<'a>(
    known: &mut Vec<Edge<'a>>,
    authored: &BTreeMap<Edge<'a>, bool>,
    place: &str,
) {
    known.extend(
        authored
            .iter()
            .filter_map(|(&edge, &retired)| (!retired && edge.0 == place).then_some(edge)),
    );
    known.sort_by_cached_key(|(from, to)| format!("{from}>{to}"));
    known.dedup();
}

fn saved_edges<'a>(world: &'a Value, authored: &BTreeMap<Edge<'_>, bool>) -> Option<Vec<Edge<'a>>> {
    world["routeKnowledge"][BARD]
        .as_array()?
        .iter()
        .map(|edge| {
            let edge = (edge.get(0)?.as_str()?, edge.get(1)?.as_str()?);
            authored.contains_key(&edge).then_some(edge)
        })
        .collect()
}

fn first_step<'a>(
    edges: &[Edge<'a>],
    from: &'a str,
    target: &str,
    mut allowed: impl FnMut(&'a str, &'a str) -> Option<bool>,
) -> Option<Option<&'a str>> {
    let mut seen = BTreeSet::from([from]);
    let mut queue = VecDeque::from([(from, None)]);
    while let Some((here, step)) = queue.pop_front() {
        if here == target {
            return Some(step);
        }
        for &(start, to) in edges {
            if start == here && !seen.contains(to) && allowed(here, to)? {
                seen.insert(to);
                queue.push_back((to, step.or(Some(to))));
            }
        }
    }
    Some(None)
}

struct Move {
    from: String,
    to: String,
    routes: Value,
    name: String,
    destination: String,
    sanctuary: bool,
}

fn chosen_move(world: &Value, geo: &Geography, turn: u64) -> Option<Move> {
    let pack = geo.packs().find(|pack| pack["id"] == GREEK)?;
    let person = &pack["avatars"][BARD];
    let actor = &world["actors"][BARD];
    let want = &actor["want"];
    let from = actor["place"].as_str()?;
    let target = match want["kind"].as_str()? {
        "person" => world["actors"][want["target"].as_str()?]["place"].as_str()?,
        _ => return None,
    };
    if person["roamingQuest"] != "latest-completion"
        || person["travels"] == false
        || person["levelAtHome"] == true
        || !person["journey"].is_null()
        || !geo.conditions_met(world, GREEK, &person["requires"], None)?
        || !geo.entity_active(world, BARD)?
        || !actor["metTurn"].is_null()
        || !actor["attend"].is_null()
        || actor["dwellUntil"].as_u64().unwrap_or(0) > turn
        || world["peaceUntil"][BARD].as_u64()? > turn
        || !actor["homeward"].is_null()
        || !want["step"].is_null()
        || target == from
        || !world["standoffs"].as_array()?.is_empty()
        || !world["packs"][GREEK]["recitals"].as_object()?.is_empty()
        || world["items"]
            .as_object()?
            .values()
            .any(|item| item["holder"] == BARD)
        || world["memories"][BARD]["learning"]
            .as_array()
            .is_some_and(|trials| !trials.is_empty())
        || world["controlledActors"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == BARD))
    {
        return None;
    }
    let forest = geo.files().get("v2/card-game/forest.json")?;
    let authored = create::authored_edges(forest, geo.packs())?;
    let mut known = saved_edges(world, &authored)?;
    remember_visible(&mut known, &authored, from);
    let mut exits = BTreeMap::new();
    let live = first_step(&known, from, target, |start, to| {
        let ways = match exits.entry(start) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                entry.insert(opening_visitor_routes::exits(world, geo, BARD, start)?)
            }
        };
        Some(ways.contains(to))
    })?;
    let to = if let Some(live) = live {
        live
    } else {
        first_step(&known, from, target, |_, _| Some(true))??
    };
    if !exits.get(from)?.contains(to)
        || !geo.base_exits(from)?.iter().any(|road| road == to)
        || pack["places"].get(from).is_none()
        || pack["places"].get(to).is_none()
        || geo.packs().any(|pack| {
            pack["crossings"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|edge| edge["from"] == from && edge["to"] == to)
        })
    {
        return None;
    }
    let life = &geo.files()["v2/card-game/world-life.json"];
    if life["guardable"].as_array()?.iter().any(|way| {
        (way["from"] == from && way["to"] == to) || (way["from"] == to && way["to"] == from)
    }) {
        return None;
    }
    remember_visible(&mut known, &authored, to);
    Some(Move {
        from: from.into(),
        to: to.into(),
        routes: json!(known),
        name: person["name"].as_str()?.into(),
        destination: pack["places"][to]["name"].as_str()?.into(),
        sanctuary: pack["places"][to]["sanctuary"] == true,
    })
}

pub(super) fn bard_move(world: &mut Value, geo: &Geography) -> Option<Value> {
    let turn = world["turn"].as_u64()?;
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    let place = world["actors"]["vale"]["place"].as_str()?;
    if began.checked_add(1)? != turn || !matches!(place, "attic" | "pond") {
        return None;
    }
    let chosen = chosen_move(world, geo, turn)?;
    let dwell = dwell_after(turn)?;
    let actor = &mut world["actors"][BARD];
    let visited = actor["visited"].as_array_mut()?;
    if !visited.iter().any(|place| place == &chosen.to) {
        visited.push(json!(chosen.to));
        visited.drain(..visited.len().saturating_sub(64));
    }
    actor["dwellUntil"] = json!(dwell);
    actor["place"] = json!(chosen.to);
    if chosen.sanctuary {
        actor["sanctuary"] = json!(chosen.to);
    }
    world["routeKnowledge"][BARD] = chosen.routes;
    Some(json!({
        "speaker":"World", "text":format!("{} goes to {}.", chosen.name, chosen.destination),
        "kind":"action", "verb":"move", "actorId":BARD, "targetId":chosen.to,
        "itemId":null, "locationId":chosen.to, "fromLocationId":chosen.from,
    }))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let world = opening::supported_world(request)?;
    let action = &request["action"];
    if request["actor"] != "vale"
        || !opening::seats(&request["present"])?.contains(&"vale")
        || action["kind"] == "pack"
        || action.as_str().or_else(|| action["key"].as_str()) != Some("wait:vale::")
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || !request["selectedIds"].is_null()
    {
        return None;
    }
    let turn = opening::unplayed_turn(world)?.checked_add(1)?;
    let files = opening_play::attic_files(world, request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut next = world.clone();
    next["turn"] = json!(turn);
    let event = bard_move(&mut next, &geo)?;
    Some(
        json!({"ok":true,"event":event,"actor":next["actors"][BARD],"routes":next["routeKnowledge"][BARD]}),
    )
}

fn dwell_after(turn: u64) -> Option<u64> {
    turn.checked_add(24 + u64::from(seed::hash(&format!("{BARD}@{turn}")) % 6))
}

fn only_bard_roams(world: &Value, geo: &Geography<'_>) -> Option<()> {
    for pack in geo.packs() {
        let region = pack["id"].as_str()?;
        for (id, person) in pack["avatars"].as_object().into_iter().flatten() {
            if id != BARD
                && person["roamingQuest"] == "latest-completion"
                && geo.conditions_met(world, region, &person["requires"], None)?
            {
                return None;
            }
        }
    }
    Some(())
}

pub(super) fn settle_dwell(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let historic = world.get("began").is_some_and(|began| began != 0);
    let prior = match (historic, turn, world["actors"]["vale"]["place"].as_str()?) {
        (true, 482, "station") => {
            opening_resident_sleep::historic_station(world, geo)?;
            only_bard_roams(world, geo)?;
            turn.checked_sub(1)?
        }
        (false, 2..=4, "station") => {
            if super::opening_station_move::arrival(world)
                .or_else(|| super::opening_station_move::abandoned_train_arrival(world))
                .is_none()
            {
                opening_station_read::after_first_log(world)?;
                only_bard_roams(world, geo)?;
            }
            1
        }
        (false, 2, "pond") => {
            super::opening_mirror_move::second_arrival(world)?;
            1
        }
        (false, 2, _) => 1,
        _ => return None,
    };
    let actor = world["actors"].get(BARD)?;
    let here = actor["place"].as_str()?;
    let pack = geo.packs().find(|pack| pack["id"] == GREEK)?;
    let person = pack["avatars"].get(BARD)?;
    let want = &actor["want"];
    let target = world["actors"].get(want["target"].as_str()?)?;
    let arrival = world["arrival"]["seq"].as_u64().unwrap_or(0);
    let prior_move = world["log"].as_array()?.iter().any(|entry| {
        entry["actorId"] == BARD
            && entry["turn"] == prior
            && entry["verb"] == "move"
            && entry["locationId"] == here
            && entry["generated"] != true
            && (!historic
                || (entry["kind"] == "action"
                    && entry["targetId"] == here
                    && entry["seq"].as_u64().is_some_and(|seq| seq < arrival)))
    });
    if world["sharedVersion"] != 1
        || world["controlledActors"] != json!(["vale"])
        || actor["dwellUntil"].as_u64()? <= turn
        || (historic && actor["dwellUntil"] != dwell_after(prior)?)
        || want["kind"] != "person"
        || !want["step"].is_null()
        || target["place"].as_str()? == here
        || !prior_move
        || person["roamingQuest"] != "latest-completion"
        || person["levelAtHome"] == true
        || pack["places"].get(here).is_none()
        || !geo.entity_active(world, BARD)?
        || !geo.conditions_met(world, GREEK, &person["requires"], None)?
        || !actor["sleeping"].is_null()
        || !world["defeats"][BARD].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || world["memories"][BARD]["learning"]
            .as_array()
            .is_some_and(|trials| !trials.is_empty())
        || world["items"]["lamp"]["holder"] == BARD
        || geo.packs().any(|pack| {
            pack["transports"]
                .as_object()
                .is_some_and(|ships| ships.values().any(|ship| ship["place"] == here))
        })
    {
        return None;
    }
    let forest = geo.files().get("v2/card-game/forest.json")?;
    let authored = create::authored_edges(forest, geo.packs())?;
    let mut known = saved_edges(world, &authored)?;
    remember_visible(&mut known, &authored, here);
    world["routeKnowledge"][BARD] = json!(known);
    Some(())
}

pub(super) fn dwell_projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    settle_dwell(&mut world, &geo)?;
    Some(json!({"ok":true, "world":world}))
}
