use super::{opening, opening_content, opening_wait, pack_state::Catalog, Geography};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn actor_order<'a>(request: &'a Value, world: &'a Value) -> Option<Vec<&'a str>> {
    let actors = world["actors"].as_object()?;
    let Some(order) = request.get("actorOrder") else {
        return Some(actors.keys().map(String::as_str).collect());
    };
    let order = order.as_array()?;
    if order.len() != actors.len() {
        return None;
    }
    let mut seen = BTreeSet::new();
    order
        .iter()
        .map(|id| {
            let id = id.as_str()?;
            (actors.contains_key(id) && seen.insert(id)).then_some(id)
        })
        .collect()
}

fn discovered(world: &Value, geo: &Geography, pack: &Value) -> Option<bool> {
    let id = pack["id"].as_str()?;
    let visited_elysium = id == "elysium"
        && world["actors"].as_object()?.iter().any(|(id, actor)| {
            opening::is_seat(id)
                && actor["visited"]
                    .as_array()
                    .is_some_and(|places| places.iter().any(|place| place == "elysium-void-001"))
        });
    if visited_elysium {
        return Some(true);
    }
    for crossing in pack["crossings"].as_array()? {
        if world["crossings"][crossing["id"].as_str()?]["discovered"] == true {
            let destination = crossing["to"].as_str()?;
            if geo
                .packs()
                .any(|pack| pack["places"].get(destination).is_some())
            {
                return Some(true);
            }
        }
    }
    Some(false)
}

pub(super) fn known_actors<'a>(
    world: &Value,
    geo: &Geography,
    order: &[&'a str],
    place: Option<&str>,
) -> Option<Vec<&'a str>> {
    let mut discovery = BTreeMap::new();
    let mut known = Vec::new();
    for &id in order {
        if place.is_some_and(|place| world["actors"][id]["place"] != place) {
            continue;
        }
        if let Some(pack) = geo.resident_pack(id).filter(|_| id != "boardyai") {
            let pack_id = pack["id"].as_str()?;
            let discovered = match discovery.entry(pack_id) {
                std::collections::btree_map::Entry::Occupied(entry) => *entry.get(),
                std::collections::btree_map::Entry::Vacant(entry) => {
                    *entry.insert(discovered(world, geo, pack)?)
                }
            };
            if !discovered && world["packs"][pack_id]["met"].get(id).is_none() {
                continue;
            }
        }
        if geo.entity_active(world, id)? {
            known.push(id);
        }
    }
    Some(known)
}

pub(super) fn residents<'a>(
    world: &Value,
    geo: &Geography,
    known: &[&'a str],
    actor: &str,
) -> Option<Vec<&'a str>> {
    let place = world["actors"][actor]["place"].as_str()?;
    let mut residents = vec!["moth", "keeper"];
    if known.contains(&"boardyai") {
        residents.push("boardyai");
    }
    for &id in known {
        let same_place = world["actors"][id]["place"] == place;
        if geo.visiting_resident(world, id) && (same_place || world["hidden"]["actor"] != id) {
            residents.push(id);
        }
    }
    for &id in known {
        if world["actors"][id]["place"] == place
            && geo
                .resident_pack(id)
                .is_some_and(|pack| pack["avatars"][id]["roamingQuest"] != "latest-completion")
            && !residents.contains(&id)
        {
            residents.push(id);
        }
    }
    Some(residents)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = opening_wait::wait_world(request)?;
    let order = actor_order(request, saved)?;
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = saved.clone();
    let fields = world.as_object_mut()?;
    fields.insert("playerActorId".to_owned(), json!("vale"));
    fields.insert("heldActors".to_owned(), request["claimed"].clone());
    for field in ["controlledActors", "presentActors"] {
        fields.insert(field.to_owned(), request["present"].clone());
    }
    let turn = saved["turn"].as_u64()?.checked_add(1)?;
    if turn > opening::MAX_REVISION {
        return None;
    }
    world["turn"] = turn.into();
    let known = known_actors(&world, &geo, &order, None)?;
    let residents = residents(&world, &geo, &known, "vale")?;
    Some(json!({"ok":true,"known":known,"residents":residents}))
}
