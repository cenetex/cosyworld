use super::{opening, opening_wait, pack_state::Catalog, Geography};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

fn includes(list: &Value, id: &str) -> bool {
    list.as_array()
        .is_some_and(|entries| entries.iter().any(|entry| entry == id))
}

pub(super) fn settle(world: &mut Value, geo: &Geography, observing: Option<&str>) -> Option<()> {
    let items = world["items"].as_object()?;
    let actors = world["actors"].as_object()?;
    let mut cards = match world.get("placeCard") {
        Some(cards) => cards.as_object()?.clone(),
        None => Map::new(),
    };
    for (place, item) in cards.clone() {
        let id = item.as_str()?;
        let item = items.get(id)?;
        let discarded = includes(&world["gone"], id) || includes(&world["usedUp"], id);
        if discarded || (item["holder"] == place && includes(&world["placeMet"][&place], id)) {
            cards.remove(&place);
        } else if item["holder"] == place {
            return None;
        }
    }

    let forest = &geo.files()["v2/card-game/forest.json"];
    let mut places: BTreeSet<_> = forest["places"]
        .as_object()?
        .keys()
        .map(String::as_str)
        .collect();
    let mut ships = BTreeSet::new();
    let mut things = BTreeMap::new();
    for pack in geo.packs() {
        places.extend(pack["places"].as_object()?.keys().map(String::as_str));
        if let Some(transports) = pack["transports"].as_object() {
            for transport in transports.values() {
                ships.insert(transport["place"].as_str()?);
            }
        }
        if let Some(items) = pack["items"].as_object() {
            things.extend(items);
        }
    }
    things.extend(forest["things"].as_object()?);
    let mut wanted = BTreeSet::new();
    for (id, actor) in actors {
        if opening::is_seat(id) {
            continue;
        }
        let want = &actor["want"];
        wanted.extend(want["target"].as_str());
        if let Some(items) = want["step"]["items"].as_array() {
            wanted.extend(items.iter().filter_map(Value::as_str));
        }
    }
    let mut sorted: Vec<_> = items.iter().collect();
    sorted.sort_unstable_by_key(|(id, _)| *id);
    for (id, item) in sorted {
        let definition = things.get(id)?;
        let Some(home) = definition["holder"].as_str() else {
            continue;
        };
        let current = item["holder"].as_str()?;
        if cards.contains_key(home)
            || !places.contains(home)
            || current == home
            || items.contains_key(current)
            || actors.contains_key(current)
            || ships.contains(current)
            || !definition["locked"].is_null()
            || !definition["sealed"].is_null()
            || wanted.contains(id.as_str())
            || includes(&world["placeMet"][home], id)
            || includes(&world["gone"], id)
            || includes(&world["usedUp"], id)
        {
            continue;
        }
        if geo.entity_active(world, id)? {
            cards.insert(home.to_owned(), json!(id));
        }
    }
    if observing.is_some_and(|place| cards.contains_key(place)) {
        return None;
    }
    let world = world.as_object_mut()?;
    if cards.is_empty() {
        world.remove("placeCard");
    } else {
        world.insert("placeCard".to_owned(), Value::Object(cards));
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (mut world, _, files) = opening_wait::begin(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    for field in ["presentActors", "controlledActors"] {
        world[field] = request["present"].clone();
    }
    settle(&mut world, &geo, Some("attic"))?;
    Some(json!({"ok":true,"placeCard":world["placeCard"]}))
}
