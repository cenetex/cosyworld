use super::{
    create, initial_wants, opening_attic_rest, opening_content, opening_full_move,
    opening_held_items, opening_mirror_move, opening_quiet_life, opening_resident_sleep,
    opening_roaming, opening_second_attic_lamp, opening_settlement, opening_station_move,
    opening_station_read, opening_station_view, opening_wait_response, opening_wants,
    pack_state::Catalog, Geography,
};
use serde_json::{json, Value};

const STATION: &str = "station";
const WAYFINDER: &str = "elysium-wayfinder";
const POND: &str = "pond";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";

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
        arrived_scene(world)?;
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
        arrived_scene(world)?;
    }
    verify_wayfinder_placement(world, geo)
}

pub(super) fn verify_wayfinder_placement(world: &Value, geo: &Geography) -> Option<()> {
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
        && solo(world)
        && (world["playerActorId"].is_null() || world["playerActorId"] == "vale"))
        .then_some(())
}

fn solo(world: &Value) -> bool {
    ["heldActors", "presentActors", "controlledActors"]
        .iter()
        .all(|key| {
            world[*key]
                .as_array()
                .is_some_and(|ids| ids.len() == 1 && ids[0] == "vale")
        })
}

fn arrived_scene(world: &Value) -> Option<&'static str> {
    if world["actors"]["vale"]["place"] == STATION {
        opening_station_move::arrival(world)
            .or_else(|| opening_station_move::abandoned_train_arrival(world))
            .or_else(|| opening_station_read::after_first_log(world))
            .or_else(|| opening_station_view::keeper_abandon_head(world))?;
        (solo(world) && world["playerActorId"] == "vale").then_some(STATION)
    } else {
        opening_mirror_move::second_arrival(world)?;
        Some(POND)
    }
}

fn second_scene(world: &Value) -> Option<&'static str> {
    if world["actors"]["vale"]["place"] == "attic" {
        second_attic(world)?;
        Some("attic")
    } else {
        arrived_scene(world)
    }
}

pub(super) fn no_arcana(world: &Value, geo: &Geography) -> Option<()> {
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
    let residents: &[&str] = match scene {
        POND => &[PIP],
        STATION => &[PIP, KEEPER],
        _ => &[],
    };
    for &resident in residents {
        if world["actors"][resident]["place"] != scene || !geo.entity_active(world, resident)? {
            return None;
        }
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    let rue = scene == STATION && opening_station_move::rue_arrived(world);
    (forest["people"]["vale"]["stops"].is_null()
        && geo.packs().all(|pack| {
            pack["avatars"].get("vale").is_none()
                && residents
                    .iter()
                    .all(|id| pack["avatars"].get(*id).is_none())
        })
        && world["actors"].as_object()?.iter().all(|(id, actor)| {
            id == "vale"
                || actor["place"] != scene
                || residents.contains(&id.as_str())
                || (rue && id == "rue")
                || (!residents.is_empty() && geo.entity_active(world, id) == Some(false))
        }))
    .then_some(())
}

pub(super) fn verify_wake(world: &Value) -> Option<()> {
    second_scene(world)?;
    no_sleepers(world)
}

pub(super) fn no_sleepers(world: &Value) -> Option<()> {
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
    if before["turn"].as_u64()?.checked_add(1) != world["turn"].as_u64()
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
    if scene == STATION
        && (before["actors"]["vale"]["place"] != POND
            || before["eventSeq"].as_u64()?.checked_add(1) != world["arrival"]["seq"].as_u64())
    {
        return None;
    }
    verify_quiet_facts(before, world, geo)
}

pub(super) fn verify_quiet_facts(before: &Value, world: &Value, geo: &Geography) -> Option<()> {
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

pub(super) fn settle_historic_station(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
) -> Option<()> {
    let arrival = opening_station_move::historic_arrival(world)?;
    if before["began"] != 480
        || before["turn"] != 481
        || before["actors"]["vale"]["place"] != POND
        || before["eventSeq"].as_u64()?.checked_add(1)? != arrival
        || !solo(world)
        || world["playerActorId"] != "vale"
    {
        return None;
    }
    if world["actors"][PIP]["place"] == STATION {
        let slept = json!({"since":481,"place":STATION,"until":482});
        if before["actors"][PIP]["place"] != POND
            || !before["actors"][PIP]["sleeping"].is_null()
            || before["actors"][KEEPER]["sleeping"] != slept
        {
            return None;
        }
        opening_wants::verify_awake_station(world, geo)?;
    } else {
        if world["eventSeq"] != arrival
            || before["actors"][PIP]["sleeping"] != world["actors"][PIP]["sleeping"]
        {
            return None;
        }
        opening_resident_sleep::sleeping_pip_at_pond(world, geo, arrival)?;
    }
    opening_quiet_life::verify_home_levels(world, geo)?;
    verify_quiet_facts(before, world, geo)?;
    opening_attic_rest::settle_visit_speech(before, world, false)?;
    verify_wayfinder_placement(world, geo)?;
    opening_held_items::settle(world, geo, Some(before))?;
    opening_second_attic_lamp::settle_station(world, geo)?;
    verify_station_order(world, geo)
}

fn station_read_round(before: &Value, world: &Value) -> Option<()> {
    let read = opening_station_read::after_first_log(world)?;
    let pip = read.checked_add(1)?;
    let wait = world["log"].as_array()?.last()?;
    (before["turn"] == 2
        && opening_station_move::arrival(before)? == world["arrival"]["seq"].as_u64()?
        && before["eventSeq"].as_u64()?.checked_add(1)? == read
        && world["revision"].as_u64()? == before["revision"].as_u64()?.checked_add(1)?
        && world["eventSeq"] == pip
        && wait["seq"] == pip
        && wait["turn"] == 3
        && wait["kind"] == "action"
        && wait["generated"] != true
        && wait["actorId"] == PIP
        && wait["verb"] == "wait"
        && wait["locationId"] == STATION
        && wait["sleep"].is_null()
        && wait["guards"].is_null()
        && solo(world)
        && world["playerActorId"] == "vale")
        .then_some(())
}

pub(super) fn settle_station_read_before_wants(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    catalog: &Catalog<'_>,
) -> Option<()> {
    station_read_round(before, world)?;
    settle_quiet_station_before_wants(before, world, geo, catalog)
}

pub(super) fn settle_quiet_station_before_wants(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    catalog: &Catalog<'_>,
) -> Option<()> {
    opening_settlement::decay_bell(world)?;
    opening_roaming::settle_dwell(world, geo)?;
    opening_quiet_life::verify_opening_day(world, geo)?;
    verify_stops(world, geo)?;
    if !opening_settlement::sail_transports(world, catalog, None)?.is_empty() {
        return None;
    }
    opening_held_items::settle(world, geo, Some(before))?;
    opening_second_attic_lamp::settle_station(world, geo)?;
    opening_full_move::quiet_ways(before, world, geo, false)?;
    verify_wake(world)?;
    opening_settlement::no_item_cycle(world)
}

pub(super) fn settle_station_read_after_wants(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
) -> Option<()> {
    station_read_round(before, world)?;
    settle_quiet_station_after_wants(before, world, geo)
}

pub(super) fn settle_quiet_station_after_wants(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
) -> Option<()> {
    opening_quiet_life::verify_home_levels(world, geo)?;
    verify_quiet_facts(before, world, geo)?;
    opening_attic_rest::settle_visit_speech(before, world, false)?;
    verify_wayfinder_placement(world, geo)?;
    opening_held_items::settle(world, geo, Some(before))?;
    opening_second_attic_lamp::settle_station(world, geo)?;
    verify_station_order(world, geo)
}

pub(super) fn settle_station_departure_after_wants(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
) -> Option<()> {
    opening_wants::station_departure_turn(before, world, geo)?;
    opening_quiet_life::verify_home_levels(world, geo)?;
    verify_quiet_facts(before, world, geo)?;
    opening_attic_rest::settle_visit_speech(before, world, false)?;
    verify_wayfinder_placement(world, geo)?;
    opening_held_items::settle(world, geo, Some(before))?;
    let room = world["actors"]["vale"]["place"].as_str()?.to_owned();
    opening_second_attic_lamp::settle_carried_at(world, geo, &room)?;
    verify_station_order(world, geo)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let world = request.get("world")?;
    let phase = request["phase"].as_str()?;
    match phase {
        "station" => verify_station(world, &geo)?,
        "station_order" => verify_station_order(world, &geo)?,
        "wayfinder" => verify_wayfinder(world, &geo)?,
        "stops" => verify_stops(world, &geo)?,
        "wake" => verify_wake(world)?,
        "quiet" => verify_final(request.get("before")?, world, &geo)?,
        "station_departure_after_wants" => {
            let mut next = world.clone();
            settle_station_departure_after_wants(request.get("before")?, &mut next, &geo)?;
            return Some(json!({"ok":true,"world":next}));
        }
        "historic_station" => {
            let mut world = world.clone();
            settle_historic_station(request.get("before")?, &mut world, &geo)?;
            return Some(json!({"ok":true,"world":world}));
        }
        "station_hands_lamp" => {
            let mut next = world.clone();
            opening_held_items::settle(&mut next, &geo, Some(request.get("before")?))?;
            opening_second_attic_lamp::settle_station(&mut next, &geo)?;
            return Some(json!({"ok":true,"world":next}));
        }
        "station_read_before_wants" | "station_read_after_wants" => {
            let before = request.get("before")?;
            let mut world = world.clone();
            if phase == "station_read_before_wants" {
                settle_station_read_before_wants(before, &mut world, &geo, &catalog)?;
            } else {
                settle_station_read_after_wants(before, &mut world, &geo)?;
            }
            return Some(json!({"ok":true,"world":world}));
        }
        _ => return None,
    }
    Some(json!({"ok":true,"world":world}))
}
