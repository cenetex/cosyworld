use super::{initial_wants, lamp_state, opening_content, opening_crossings, pack_state::Catalog};
use crate::{Geography, LampPosition};
use serde_json::{json, Value};

const ATTIC: &str = "attic";
const VALE: &str = "vale";
const LAMP: &str = "lamp";

fn no_refuel(world: &Value, geo: &Geography) -> Option<()> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    for (item, definition) in forest["things"].as_object()? {
        let Some(target) = definition["refuels"].as_str() else {
            continue;
        };
        let owner = initial_wants::root(world, item)?;
        if world["actors"].get(owner).is_some()
            && initial_wants::root(world, target)? == owner
            && world["items"][target]["fuel"] == 0
            && geo.entity_active(world, item)?
            && geo.entity_active(world, target)?
        {
            return None;
        }
    }
    Some(())
}

pub(super) fn settle(before: &Value, world: &mut Value, geo: &Geography) -> Option<()> {
    let vale = &world["actors"][VALE];
    if before["turn"] != 1
        || world["turn"] != 2
        || world.get("began").is_some_and(|began| began != 0)
        || before["actors"][VALE]["place"] != ATTIC
        || vale["place"] != ATTIC
        || world["items"][LAMP]["holder"] != VALE
        || world["crossings"]
            .as_object()?
            .values()
            .any(|state| !(state["phase"].is_null() || state["phase"] == 0))
    {
        return None;
    }
    let held = match vale.get("heldItem")? {
        Value::Null => false,
        item if item == LAMP => true,
        _ => return None,
    };
    let lamp = &mut world["items"][LAMP];
    lamp_state(lamp)
        .ok()?
        .settle(LampPosition {
            place: ATTIC.into(),
            held,
            grounded: false,
        })
        .write(lamp);
    no_refuel(world, geo)?;
    opening_crossings::no_crossing_unlocks(world, geo)?;
    opening_crossings::no_attic_crossing_narration(before, world, geo)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let mut mirrors = forest["reflectionRoutes"]
        .as_array()?
        .iter()
        .filter(|edge| edge["from"] == ATTIC);
    let mirror = mirrors.next()?;
    (mirror["to"] == "pond"
        && mirrors.next().is_none()
        && geo.reflection_open(before, mirror)? == geo.reflection_open(world, mirror)?)
    .then_some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    settle(request.get("before")?, &mut world, &geo)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
