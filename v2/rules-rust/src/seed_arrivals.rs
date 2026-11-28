use super::{opening::unplayed_turn, pack_state::Catalog, seed};
use serde_json::{json, Value};
use std::collections::BTreeSet;

fn hiding_places<'a>(world: &Value, catalog: &'a Catalog<'_>) -> Option<Vec<&'a str>> {
    let mut places = Vec::new();
    for pack in catalog.packs() {
        if world["packs"].get(pack["id"].as_str()?).is_none() {
            continue;
        }
        if let Some(hiding) = pack.get("hiding") {
            for entry in hiding["pool"].as_array()? {
                places.push(entry["id"].as_str()?);
            }
        }
    }
    Some(places)
}

fn pick<'a>(choices: &[&'a str], key: &str) -> Option<&'a str> {
    if choices.is_empty() {
        return None;
    }
    Some(choices[seed::hash(key) as usize % choices.len()])
}

pub(super) fn arrivals(
    world: &mut Value,
    files: &Value,
    hidden: Option<&str>,
    absent: &[&str],
    homecoming: Option<&str>,
) -> Option<()> {
    let turn = unplayed_turn(world)?;
    if world["sharedVersion"] != 1
        || world["revision"] != turn
        || world.get("hidden").is_some()
        || world.get("absent").is_some()
    {
        return None;
    }
    if hidden.is_none() && absent.is_empty() && homecoming.is_none() {
        return Some(());
    }
    let cast = files.get("v2/card-game/shared-cast.json")?;
    let avatars = cast["avatars"].as_array()?;
    let avatar = |id| avatars.iter().find(|avatar| avatar["id"] == id);
    let omitted: BTreeSet<_> = absent.iter().copied().collect();
    if absent.len() > 8
        || absent.len() != omitted.len()
        || absent
            .iter()
            .copied()
            .chain(hidden)
            .chain(homecoming)
            .any(|id| id == "vale" || avatar(id).is_none())
        || hidden.is_some_and(|id| omitted.contains(id) || Some(id) == homecoming)
    {
        return None;
    }
    let run = seed::run_seed(world)?;
    let catalog = Catalog::from_files(files)?;
    let hiding = hiding_places(world, &catalog)?;
    let mut arrived = world.clone();
    if !omitted.is_empty() {
        arrived["absent"] = json!(omitted);
    }
    if let Some(id) = hidden {
        let actor = arrived["actors"].get_mut(id)?;
        let place = json!(
            pick(&hiding, &format!("{run}:hidden:{id}")).or_else(|| actor["place"].as_str())?
        );
        *actor.get_mut("place")? = place.clone();
        arrived["hidden"] = json!({"actor": id, "place": place, "met": []});
    }
    if let Some(id) = homecoming {
        let item = avatar(id)?["item"]["id"].as_str()?;
        let lampless = cast["lampless"].as_array()?;
        let hub = files["v2/card-game/packs.json"]["hub"]["places"].as_array()?;
        let mut spots = hiding;
        for place in hub {
            spots.push(place.as_str()?);
        }
        spots.retain(|place| *place != "pond" && lampless.iter().any(|id| id == *place));
        let place = pick(&spots, &format!("{run}:item:{id}"))?;
        arrived["doors"] = seed::place_doors(files, run, Some(id))?;
        *arrived["actors"].get_mut(id)?.get_mut("place")? = json!("pond");
        *arrived["items"].get_mut(item)?.get_mut("holder")? = json!(place);
    }
    *world = arrived;
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let optional = |name| match request.get(name) {
        None | Some(Value::Null) => Some(None),
        Some(value) => Some(Some(value.as_str()?)),
    };
    let absent = match request.get("absent") {
        None | Some(Value::Null) => Vec::new(),
        Some(value) => value
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<_>>()?,
    };
    let mut world = request.get("world")?.clone();
    arrivals(
        &mut world,
        content.get("files")?,
        optional("hidden")?,
        &absent,
        optional("homecoming")?,
    )?;
    Some(json!({"ok": true, "world": world}))
}
