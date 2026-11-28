use super::{
    create, initial_wants, opening_content, opening_mirror_move, opening_wait_response,
    pack_state::Catalog, Geography,
};
use serde_json::{json, Value};

const STATION: &str = "station";
const WAYFINDER: &str = "elysium-wayfinder";
const POND: &str = "pond";
const PIP: &str = "moth";

fn fresh_attic(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    (matches!(turn, 1 | 2)
        && !world.get("began").is_some_and(|began| began != 0)
        && world["sharedVersion"] == 1
        && world["actors"]["vale"]["place"] == "attic")
        .then_some(turn)
}

pub(super) fn verify_station(world: &Value, geo: &Geography) -> Option<()> {
    if fresh_attic(world).is_none() {
        opening_mirror_move::second_arrival(world)?;
    }
    verify_station_order(world, geo)
}

pub(super) fn verify_station_order(world: &Value, geo: &Geography) -> Option<()> {
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
    if fresh_attic(world) != Some(2) {
        opening_mirror_move::second_arrival(world)?;
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

fn second_attic(world: &Value) -> Option<()> {
    (fresh_attic(world)? == 2
        && ["heldActors", "presentActors", "controlledActors"]
            .iter()
            .all(|key| {
                world[*key]
                    .as_array()
                    .is_some_and(|ids| ids.len() == 1 && ids[0] == "vale")
            })
        && (world["playerActorId"].is_null() || world["playerActorId"] == "vale"))
        .then_some(())
}

fn second_scene(world: &Value) -> Option<&'static str> {
    if world["actors"]["vale"]["place"] == POND {
        opening_mirror_move::second_arrival(world)?;
        Some(POND)
    } else {
        second_attic(world)?;
        Some("attic")
    }
}

fn no_arcana(world: &Value, geo: &Geography) -> Option<()> {
    let authored = &geo.files()["v2/card-game/arcana.json"];
    (authored["calls"].as_u64()? > 0
        && world["actors"]
            .as_object()?
            .values()
            .all(|actor| actor["arcana"].is_null()))
    .then_some(())
}

pub(super) fn verify_stops(world: &Value, geo: &Geography) -> Option<()> {
    let scene = second_scene(world)?;
    no_arcana(world, geo)?;
    let pond = scene == POND;
    if pond && (world["actors"][PIP]["place"] != POND || !geo.entity_active(world, PIP)?) {
        return None;
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    (forest["people"]["vale"]["stops"].is_null()
        && geo.packs().all(|pack| {
            pack["avatars"].get("vale").is_none() && (!pond || pack["avatars"].get(PIP).is_none())
        })
        && world["actors"].as_object()?.iter().all(|(id, actor)| {
            id == "vale"
                || actor["place"] != scene
                || (pond && (id == PIP || geo.entity_active(world, id) == Some(false)))
        }))
    .then_some(())
}

pub(super) fn verify_wake(world: &Value) -> Option<()> {
    second_scene(world)?;
    world["actors"]
        .as_object()?
        .values()
        .all(|actor| actor["sleeping"].is_null())
        .then_some(())
}

fn sealed_at_rest(world: &Value, geo: &Geography) -> Option<()> {
    let spent = world["usedUp"].as_array()?;
    for pack in geo.packs() {
        for (id, item) in pack["items"].as_object().into_iter().flatten() {
            if item["sealed"].is_null() || spent.iter().any(|used| used == id) {
                continue;
            }
            let rest = item["home"].as_str().or_else(|| item["holder"].as_str())?;
            if world["items"][id]["holder"] != rest {
                return None;
            }
        }
    }
    Some(())
}

fn guards_stable(world: &Value, geo: &Geography) -> Option<()> {
    if !world["standoffs"].as_array()?.is_empty() {
        return None;
    }
    let files = geo.files();
    for avatar in files["v2/card-game/shared-cast.json"]["avatars"].as_array()? {
        if world["actors"][avatar["id"].as_str()?]
            .get("guarding")
            .is_some()
        {
            return None;
        }
    }
    let life = &files["v2/card-game/world-life.json"];
    for (id, record) in life["residents"].as_object()? {
        let (Some(beyond), Some(pack), Some(actor)) = (
            record["guards"].as_str(),
            geo.resident_pack(id),
            world["actors"].get(id),
        ) else {
            continue;
        };
        let definition = &pack["avatars"][id];
        let home = definition["home"]
            .as_str()
            .or_else(|| definition["place"].as_str())?;
        let on_post = actor["place"] == home
            && geo.entity_active(world, id)?
            && !geo.pack_route_open(world, home, beyond)?;
        if (on_post && actor["guarding"] != beyond) || (!on_post && actor.get("guarding").is_some())
        {
            return None;
        }
    }
    Some(())
}

pub(super) fn no_box_release(world: &Value) -> Option<()> {
    for actor in world["actors"].as_object()?.values() {
        let wants =
            std::iter::once(&actor["want"]).chain(actor["under"].as_array().into_iter().flatten());
        if wants.into_iter().any(|want| {
            want["from"]
                .as_str()
                .is_some_and(|from| from.starts_with("quest:box:"))
        }) {
            return None;
        }
    }
    Some(())
}

fn no_new_rumours(before: &Value, world: &Value) -> Option<()> {
    let since = before["eventSeq"].as_u64()?;
    if before["turn"] != 1
        || ["usedUp", "gone", "opened"]
            .iter()
            .any(|key| before[*key] != world[*key])
        || world["log"].as_array()?.iter().any(|entry| {
            entry["seq"]
                .as_u64()
                .is_none_or(|seq| seq > since && entry["verb"] == "want_met")
        })
    {
        return None;
    }
    let old_packs = before["packs"].as_object()?;
    let packs = world["packs"].as_object()?;
    if old_packs.len() != packs.len()
        || packs.iter().any(|(id, pack)| {
            old_packs
                .get(id)
                .is_none_or(|previous| previous["receipts"] != pack["receipts"])
        })
    {
        return None;
    }
    let old_items = before["items"].as_object()?;
    let items = world["items"].as_object()?;
    let actors = world["actors"].as_object()?;
    if old_items.len() != items.len() {
        return None;
    }
    for (id, item) in items {
        let holder = item["holder"].as_str()?;
        if item["holder"] == old_items.get(id)?["holder"] && !items.contains_key(holder) {
            continue;
        }
        let to = initial_wants::root(world, id)?;
        if to != "vale" && actors.contains_key(to) && initial_wants::root(before, id)? != to {
            return None;
        }
    }
    Some(())
}

pub(super) fn verify_final(before: &Value, world: &Value, geo: &Geography) -> Option<()> {
    let scene = second_scene(world)?;
    if scene == POND
        && (opening_wait_response::settled_first_wait(before) != Some(1)
            || before["eventSeq"].as_u64()?.checked_add(1) != world["arrival"]["seq"].as_u64())
    {
        return None;
    }
    no_arcana(world, geo)?;
    sealed_at_rest(world, geo)?;
    guards_stable(world, geo)?;
    if !before["actors"]["vale"]["arcana"].is_null()
        || world["conversations"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|entry| entry.get("company").is_some())
    {
        return None;
    }
    no_box_release(world)?;
    no_new_rumours(before, world)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let world = request.get("world")?;
    match request["phase"].as_str()? {
        "station" => verify_station(world, &geo)?,
        "wayfinder" => verify_wayfinder(world, &geo)?,
        "stops" => verify_stops(world, &geo)?,
        "wake" => verify_wake(world)?,
        "quiet" => verify_final(request.get("before")?, world, &geo)?,
        _ => return None,
    }
    Some(json!({"ok":true,"world":world}))
}
