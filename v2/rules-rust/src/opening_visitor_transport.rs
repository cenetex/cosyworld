use super::{opening, opening_content, opening_visitor_routes, pack_state::Catalog, Geography};
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

struct Ship<'a> {
    id: &'a str,
    pack: &'a str,
    data: &'a Value,
}

impl<'a> Ship<'a> {
    fn find(geo: &Geography<'a>, mut matches: impl FnMut(&str, &Value) -> bool) -> Option<Self> {
        for pack in geo.packs() {
            for (id, data) in pack["transports"].as_object().into_iter().flatten() {
                if matches(id, data) {
                    return Some(Self {
                        id,
                        pack: pack["id"].as_str()?,
                        data,
                    });
                }
            }
        }
        None
    }

    fn lanes(&self, dock: &str) -> Option<Vec<(&'a str, &'a Value)>> {
        let mut seen = BTreeSet::new();
        let mut lanes = Vec::new();
        for lane in self.data["lanes"].as_array()? {
            let from = lane["from"].as_str()?;
            let to = lane["to"].as_str()?;
            if from == dock && seen.insert(to) {
                lanes.push((to, lane));
            } else if to == dock && lane["oneWay"] != true && seen.insert(from) {
                lanes.push((from, lane));
            }
        }
        Some(lanes)
    }

    fn open_lanes(
        &self,
        world: &Value,
        geo: &Geography<'a>,
        actor: &str,
        dock: &str,
    ) -> Option<Vec<&'a str>> {
        let mut open = Vec::new();
        for (to, lane) in self.lanes(dock)? {
            if !geo.entity_active(world, to)? {
                continue;
            }
            let allowed = if let Some(gate) = lane.get("opensWith") {
                geo.conditions_met(world, self.pack, gate, None)?
            } else {
                knows_lane(world, geo, actor, dock, to)?
            };
            if allowed {
                open.push(to);
            }
        }
        Some(open)
    }

    fn reachable(
        &self,
        world: &Value,
        geo: &Geography<'a>,
        actor: &str,
        dock: &str,
    ) -> Option<Vec<&'a str>> {
        let mut seen = BTreeSet::from([dock]);
        let mut queue = VecDeque::from([dock]);
        let mut reached = Vec::new();
        while let Some(dock) = queue.pop_front() {
            for to in self.open_lanes(world, geo, actor, dock)? {
                if seen.insert(to) {
                    reached.push(to);
                    queue.push_back(to);
                }
            }
        }
        Some(reached)
    }
}

fn knows_lane(world: &Value, geo: &Geography, actor: &str, from: &str, to: &str) -> Option<bool> {
    let authored = |dock| geo.packs().find_map(|pack| pack["places"].get(dock));
    let hub_shore = authored(from).is_none() || authored(to).is_none();
    if hub_shore
        || Ship::find(geo, |_, ship| ship["shipmaster"] == actor).is_some()
        || entries(&world["routeKnowledge"][actor])
            .any(|edge| edge[0] == format!("sea:{from}") && edge[1] == format!("sea:{to}"))
    {
        return Some(true);
    }
    for dock in [from, to] {
        if authored(dock).is_some_and(|place| entries(&place["requires"]).next().is_some())
            && geo.entity_active(world, dock)?
        {
            return Some(true);
        }
    }
    Some(false)
}

pub(super) fn board<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    transport: &str,
    dock: &str,
) -> Option<Option<&'a str>> {
    if !opening::is_seat(actor) {
        return None;
    }
    let ship = Ship::find(geo, |id, _| id == transport)?;
    for (to, _) in ship.lanes(dock)? {
        if geo.entity_active(world, to)? && knows_lane(world, geo, actor, dock, to)? {
            return Some(Some(ship.data["place"].as_str()?));
        }
    }
    Some(None)
}

pub(super) fn exits<'a>(
    world: &Value,
    geo: &Geography<'a>,
    actor: &str,
    place: &str,
    previous: Option<&str>,
) -> Option<Vec<&'a str>> {
    let Some(ship) = Ship::find(geo, |_, ship| ship["place"] == place) else {
        return Some(Vec::new());
    };
    if !geo.visiting_resident(world, actor) {
        return None;
    }
    let state = &world["transports"][ship.id];
    let phase = state["phase"].as_str()?;
    if state["version"] != 3 || !matches!(phase, "docked" | "arrived" | "sea" | "course") {
        return None;
    }
    let at_berth = matches!(phase, "docked" | "arrived");
    let aboard = world["actors"][actor]["place"] == place;
    let can_disembark = at_berth && aboard && entries(&state["riders"]).any(|id| id == actor);
    let docks = ship.data["docks"].as_array()?;
    let dock = |id: &str| {
        docks
            .iter()
            .filter_map(Value::as_str)
            .find(|&port| port == id)
    };
    if previous.is_some() || !aboard {
        if let Some(previous_dock) = previous.and_then(dock) {
            return ship.reachable(world, geo, actor, previous_dock);
        }
        let from = if at_berth {
            &state["dock"]
        } else {
            &state["destination"]
        };
        let from = dock(from.as_str()?)?;
        let mut result = ship.reachable(world, geo, actor, from)?;
        if !at_berth || can_disembark {
            result.insert(0, from);
        }
        return Some(result);
    }
    if !at_berth {
        return Some(Vec::new());
    }
    let dock = dock(state["dock"].as_str()?)?;
    let mut result = Vec::new();
    if can_disembark {
        result.push(dock);
    }
    let occupied = world["actors"].as_object()?.iter().any(|(id, body)| {
        body["place"] == place
            && world["controlledActors"]
                .as_array()
                .map_or(id == "vale", |seats| seats.iter().any(|seat| seat == id))
    });
    if !occupied {
        result.extend(ship.open_lanes(world, geo, actor, dock)?);
    }
    Some(result)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let world = request.get("world")?;
    let actor = request["actor"].as_str()?;
    let place = request["place"].as_str()?;
    if !geo.visiting_resident(world, actor) {
        return None;
    }
    let mut boards = Vec::new();
    for pack in geo.packs() {
        let id = pack["id"].as_str()?;
        for crossing in entries(&pack["crossings"]).filter(|c| c["from"] == place) {
            if let Some(ship) = crossing["transport"].as_str() {
                if opening_visitor_routes::crossing_open(world, &geo, actor, id, crossing)? {
                    boards.extend(board(world, &geo, actor, ship, place)?);
                }
            }
        }
    }
    let aboard = exits(world, &geo, actor, place, request["previous"].as_str())?;
    Some(json!({"ok":true, "boards":boards, "aboard":aboard}))
}
