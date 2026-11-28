use super::{create, initial_wants, opening_content, pack_state::Catalog, Geography};
use serde_json::{json, Value};

const STATION: &str = "station";
const WAYFINDER: &str = "elysium-wayfinder";

fn fresh_attic(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    (matches!(turn, 1 | 2)
        && !world.get("began").is_some_and(|began| began != 0)
        && world["sharedVersion"] == 1
        && world["actors"]["vale"]["place"] == "attic")
        .then_some(turn)
}

pub(super) fn verify_station(world: &Value, geo: &Geography) -> Option<()> {
    fresh_attic(world)?;
    if !geo.entity_active(world, STATION)?
        || geo.packs().any(|pack| {
            ["crossings", "routes"].iter().any(|key| {
                pack[*key].as_array().into_iter().flatten().any(|edge| {
                    edge["from"] == STATION && (*key == "routes" || pack["id"] != "shared-homes")
                })
            })
        })
    {
        return None;
    }
    let saved = world["stationExitOrder"].as_array()?;
    if saved
        .iter()
        .enumerate()
        .any(|(index, id)| saved[..index].contains(id))
    {
        return None;
    }
    let order = create::station_order(world, geo.files(), geo)?;
    (order == *saved).then_some(())
}

pub(super) fn verify_wayfinder(world: &Value, geo: &Geography) -> Option<()> {
    if fresh_attic(world)? != 2 {
        return None;
    }
    if !world["items"].as_object()?.contains_key(WAYFINDER) {
        return Some(());
    }
    let holder = initial_wants::root(world, WAYFINDER)?;
    let place = world["actors"][holder]["place"].as_str().unwrap_or(holder);
    geo.base_exits(place)?;
    let elysium = geo.packs().find(|pack| pack["id"] == "elysium")?;
    (!elysium["places"].as_object()?.contains_key(place)).then_some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let world = request.get("world")?;
    match request["phase"].as_str()? {
        "station" => verify_station(world, &geo)?,
        "wayfinder" => verify_wayfinder(world, &geo)?,
        _ => return None,
    }
    Some(json!({"ok":true,"world":world}))
}
