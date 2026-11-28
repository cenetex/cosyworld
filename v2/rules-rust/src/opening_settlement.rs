use super::{
    opening_crossings::{no_attic_crossing_narration, no_crossing_unlocks},
    opening_wait,
    pack_state::Catalog,
    Geography,
};
use serde_json::{json, Map, Value};

const ATTIC: &str = "attic";
const DAYLIGHT_TURNS: u64 = 24;

pub(super) fn decay_bell(world: &mut Value) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let fresh_ring = world["log"].as_array()?.iter().any(|event| {
        event["turn"] == turn
            && event["verb"] == "ring"
            && event["itemId"] == "bell"
            && event["generated"] != true
    });
    let ringing = world["items"].get_mut("bell")?.get_mut("ringing")?;
    let duration = ringing.as_u64().filter(|duration| *duration <= 3)?;
    if !fresh_ring {
        *ringing = json!(duration.saturating_sub(1));
    }
    Some(())
}

pub(super) fn sail_attic_transports(world: &mut Value, catalog: &Catalog) -> Option<Vec<Value>> {
    if world["actors"]["vale"]["place"] != ATTIC {
        return None;
    }
    sail_transports(world, catalog, Some(ATTIC))
}

pub(super) fn sail_transports(
    world: &mut Value,
    catalog: &Catalog,
    waited_at: Option<&str>,
) -> Option<Vec<Value>> {
    sail_with_step(world, catalog, waited_at, None)
}

pub(super) fn sail_course(world: &mut Value, catalog: &Catalog, ship: &str) -> Option<Vec<Value>> {
    sail_with_step(world, catalog, None, Some(VoyageStep::Course(ship)))
}

pub(super) fn sail_arrival(
    world: &mut Value,
    catalog: &Catalog,
    ship: &str,
    passengers: &[&str],
) -> Option<Vec<Value>> {
    sail_with_step(
        world,
        catalog,
        Some(ship),
        Some(VoyageStep::Arrive(ship, passengers)),
    )
}

#[derive(Clone, Copy)]
enum VoyageStep<'a> {
    Course(&'a str),
    Arrive(&'a str, &'a [&'a str]),
}

fn sail_with_step(
    world: &mut Value,
    catalog: &Catalog,
    waited_at: Option<&str>,
    step: Option<VoyageStep<'_>>,
) -> Option<Vec<Value>> {
    let actors = world.get("actors")?.as_object()?;
    let states = world.get("transports")?.as_object()?;
    let mut changes = Vec::new();
    let mut voyages = Vec::new();
    for pack in catalog.packs() {
        for (id, transport) in pack["transports"].as_object().into_iter().flatten() {
            let place = transport["place"].as_str()?;
            let docks = transport["docks"].as_array()?;
            let state = states.get(id)?;
            let riders = state["riders"].as_array()?;
            if waited_at.is_some_and(|room| docks.iter().any(|dock| dock == room))
                || state["version"] != 3
                || !docks.contains(&state["dock"])
                || (!state["recall"].is_null() && !docks.contains(&state["recall"]))
                || riders.iter().any(|rider| {
                    rider
                        .as_str()
                        .and_then(|rider| actors.get(rider))
                        .is_none_or(|actor| actor["place"] == place)
                })
            {
                return None;
            }
            match state["phase"].as_str()? {
                "docked" if riders.is_empty() && state["destination"].is_null() => {}
                "course"
                    if matches!(step, Some(VoyageStep::Course(ship)) if ship == id)
                        && riders.is_empty()
                        && state["recall"].is_null()
                        && docks.contains(&state["destination"])
                        && state["destination"] != state["dock"]
                        && actors.values().any(|actor| actor["place"] == place) =>
                {
                    let mut next = state.clone();
                    next["phase"] = json!("sea");
                    next["since"] = world["turn"].clone();
                    changes.push((id, next));
                    voyages.push(json!({
                        "id":id,"kind":"sail","from":state["dock"],"to":state["destination"],
                    }));
                }
                "arrived" if state["destination"].is_null() && state["recall"].is_null() => {
                    let mut next = state.clone();
                    next["riders"] = json!([]);
                    next["phase"] = json!("docked");
                    changes.push((id, next));
                }
                "sea"
                    if riders.is_empty()
                        && actors.values().all(|actor| actor["place"] != place) =>
                {
                    let (next, voyage) =
                        arrival_from_sea(id, transport, state, world["turn"].as_u64()?, &[])?;
                    changes.push((id, next));
                    voyages.push(voyage);
                }
                "sea" if riders.is_empty() && state["recall"].is_null() => {
                    let Some(VoyageStep::Arrive(ship, passengers)) = step else {
                        return None;
                    };
                    if ship != id || passengers.is_empty() {
                        return None;
                    }
                    let (next, voyage) = arrival_from_sea(
                        id,
                        transport,
                        state,
                        world["turn"].as_u64()?,
                        passengers,
                    )?;
                    changes.push((id, next));
                    voyages.push(voyage);
                }
                _ => return None,
            }
        }
    }
    let states = world.get_mut("transports")?.as_object_mut()?;
    for (id, state) in changes {
        states.insert(id.clone(), state);
    }
    Some(voyages)
}

fn arrival_from_sea(
    id: &str,
    transport: &Value,
    state: &Value,
    turn: u64,
    passengers: &[&str],
) -> Option<(Value, Value)> {
    let from = state["dock"].as_str()?;
    let destination = state["destination"].as_str()?;
    let dock = state["recall"].as_str().unwrap_or(destination);
    let lanes = transport["lanes"].as_array()?;
    let lane_between = |dock: &str| {
        lanes.iter().find(|lane| {
            (lane["from"] == from && lane["to"] == dock)
                || (lane["oneWay"] != true && lane["from"] == dock && lane["to"] == from)
        })
    };
    lane_between(destination)?;
    if lane_between(dock).is_some_and(|lane| lane["spends"] == true) {
        return None;
    }
    let phase = if passengers.is_empty() {
        "docked"
    } else {
        "arrived"
    };
    Some((
        json!({
            "version":3, "phase":phase, "dock":dock, "destination":null,
            "riders":passengers, "since":turn, "recall":null,
        }),
        json!({"id":id, "kind":"arrive", "from":from, "dock":dock, "riders":passengers}),
    ))
}

pub(super) fn reset_away_signals(world: &mut Value, catalog: &Catalog) -> Option<()> {
    if world["actors"]["vale"]["place"] != ATTIC {
        return None;
    }
    let crossings = world.get_mut("crossings")?.as_object_mut()?;
    for pack in catalog.packs() {
        for def in pack["crossings"].as_array()? {
            if def["signal"].is_null() {
                continue;
            }
            let state = crossings.get_mut(def["id"].as_str()?)?;
            let phase = state.get_mut("phase")?;
            if phase.as_u64()? > 0 {
                if def["from"] == ATTIC {
                    return None;
                }
                *phase = json!(0);
            }
        }
    }
    Some(())
}

pub(super) fn no_item_cycle(world: &Value) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let light_change = turn > 0 && turn % DAYLIGHT_TURNS == 0;
    let long_rest = world["log"]
        .as_array()?
        .iter()
        .any(|event| event["turn"] == turn && event["rest"] == "long");
    (!light_change && !long_rest).then_some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (mut world, _, files) = opening_wait::begin(request)?;
    let catalog = Catalog::from_files(&files)?;
    decay_bell(&mut world)?;
    let voyages = sail_attic_transports(&mut world, &catalog)?;
    let geography = Geography::new(&files, catalog.packs())?;
    no_crossing_unlocks(&world, &geography)?;
    reset_away_signals(&mut world, &catalog)?;
    no_attic_crossing_narration(&request["world"], &world, &geography)?;
    no_item_cycle(&world)?;
    let signals: Map<_, _> = world["crossings"]
        .as_object()?
        .iter()
        .filter(|(_, state)| state["phase"].is_number())
        .map(|(id, state)| (id.clone(), state.clone()))
        .collect();
    Some(json!({
        "ok":true,
        "ringing":world["items"]["bell"]["ringing"],
        "transports":world["transports"],
        "voyages":voyages,
        "signals":signals,
    }))
}
