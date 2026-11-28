use super::{
    authored_order::Order,
    initial_wants, lamp_state,
    opening::{self, MAX_REVISION},
    opening_content, opening_crossings, opening_play, opening_roster,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography, LampPosition,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ATTIC: &str = "attic";
const POND: &str = "pond";
const LAMP: &str = "lamp";

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

pub(super) fn move_world(request: &Value) -> Option<(&Value, bool)> {
    let before = opening::supported_world(request)?;
    let action = &request["action"];
    let carry = match action.as_str().or_else(|| action["key"].as_str())? {
        "move:vale::pond" => false,
        "move:vale:lamp:pond" => true,
        _ => return None,
    };
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != before["revision"])
        || !(request["elysiumPortraits"].is_null()
            || request["elysiumPortraits"]
                .as_array()
                .is_some_and(Vec::is_empty))
        || action["kind"] == "pack"
    {
        return None;
    }
    Some((before, carry))
}

fn quiet_route(before: &Value, geo: &Geography<'_>) -> Option<()> {
    let files = geo.files();
    let forest = &files["v2/card-game/forest.json"];
    opening_play::attic_state(before)?;
    opening_play::attic_content(files)?;
    let route = entries(&forest["reflectionRoutes"]).find(|route| route["from"] == ATTIC)?;
    let is_at_route = |place: &Value| place == ATTIC || place == POND;
    let match_route = |route: &Value| {
        (route["from"] == ATTIC && route["to"] == POND)
            || (route["from"] == POND && route["to"] == ATTIC)
    };
    if !geo.reflection_open(before, route)?
        || !geo.entity_active(before, POND)?
        || !geo.entity_active(before, LAMP)?
        || forest["homeGates"][ATTIC]["opening"] != true
        || before["locations"][ATTIC]["anchored"] != false
        || entries(&files["v2/card-game/world-life.json"]["guardable"]).any(match_route)
        || geo.packs().any(|pack| {
            entries(&pack["crossings"]).any(match_route)
                || entries(&pack["choices"])
                    .any(|choice| choice["at"] == POND && choice["on"] == "meet")
                || pack["transports"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, transport)| is_at_route(&transport["place"]))
        })
    {
        return None;
    }
    opening_crossings::no_crossing_unlocks(before, geo)
}

fn fresh_traveler(before: &Value, geo: &Geography<'_>) -> Option<()> {
    let began = opening::unplayed_turn(before)?;
    if (began != 0 && geo.files()["v2/card-game/world-history.json"]["turns"] != began)
        || before["log"].as_array()?.len() != 2
        || before["opening"]["version"] != 1
        || !before["arrival"].is_null()
        || !before["hidden"].is_null()
        || !before["absent"].is_null()
        || !before["homecoming"].is_null()
        || !before["actors"][VALE]["want"].is_null()
        || !opening::station_order(before)?.is_empty()
        || !before["stationExitOrder"].as_array()?.is_empty()
        || before["actors"]
            .as_object()?
            .values()
            .any(|actor| actor["crossed"] != 0)
        || before["packs"].as_object()?.values().any(|pack| {
            pack["recitals"]
                .as_object()
                .into_iter()
                .flat_map(|map| map.values())
                .any(|recital| recital["actor"] == VALE && recital["visit"].is_null())
        })
        || before["life"]["actors"]
            .as_object()?
            .values()
            .any(|resident| {
                resident["attachments"]
                    .as_object()
                    .is_none_or(|map| !map.is_empty())
            })
    {
        return None;
    }
    Some(())
}

pub(super) fn pond_items<'a>(
    world: &Value,
    geo: &Geography<'_>,
    authored: &'a Order,
) -> Option<Vec<&'a str>> {
    let mut items = Vec::new();
    for id in &authored.items {
        let owner = initial_wants::root(world, id)?;
        let place = world["actors"][owner]["place"].as_str().unwrap_or(owner);
        if place == POND && geo.entity_active(world, id)? {
            items.push(id.as_str());
        }
    }
    Some(items)
}

pub(super) fn begin(
    before: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    carry: bool,
) -> Option<Value> {
    fresh_traveler(before, geo)?;
    quiet_route(before, geo)?;
    let turn = before["turn"].as_u64()?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    if turn > MAX_REVISION || revision > MAX_REVISION {
        return None;
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    let name = forest["people"][VALE]["name"].as_str()?;
    let pond = forest["places"][POND]["name"].as_str()?;
    let approach = if carry {
        let lamp = forest["things"][LAMP]["name"].as_str()?;
        format!("{name} carries the {lamp} to {pond}")
    } else {
        format!("{name} goes to {pond}")
    };

    let mut world = before.clone();
    world["turn"] = json!(turn);
    world["revision"] = json!(revision);
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    world["locations"][ATTIC]
        .as_object_mut()?
        .insert("anchored".into(), json!(true));
    let vale = world["actors"][VALE].as_object_mut()?;
    vale.remove("offered");
    vale.remove("guarding");
    vale.insert("place".into(), json!(POND));
    vale.insert("crossed".into(), json!(1));

    let held = vale.get("heldItem")? == LAMP;
    let lamp = world.get_mut("items")?.get_mut(LAMP)?;
    let history = lamp["history"].as_array_mut()?;
    history.push(json!(format!("Turn {turn}: {name} carried it to {pond}.")));
    history.drain(..history.len().saturating_sub(12));
    lamp_state(lamp)
        .ok()?
        .settle(LampPosition {
            place: POND.into(),
            held,
            grounded: false,
        })
        .write(lamp);
    opening_crossings::no_crossing_unlocks(&world, geo)?;

    for (id, actor) in world["actors"].as_object()? {
        if actor["place"] == POND && id != VALE && id != "moth" && geo.entity_active(&world, id)? {
            return None;
        }
    }
    if world["actors"]["moth"]["place"] != POND || !geo.entity_active(&world, "moth")? {
        return None;
    }
    world["opening"]["crossed"] = json!(true);
    let met = world["opening"]["met"].as_object_mut()?;
    for id in [VALE, "moth"] {
        met.entry(id).or_insert_with(|| json!(turn));
    }
    let cast = opening_roster::known_actors(&world, geo, order, Some(POND))?;
    let items = pond_items(&world, geo, authored)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":VALE,
        "text":format!("{approach} through the reflection. Something on the far shore turns its head."),
        "locationId":POND, "fromLocationId":ATTIC, "witnesses":[VALE,LAMP],
        "itemId":carry.then_some(LAMP), "targetId":POND,
    });
    evidence.record(&mut world, &cast, &items, detail, true)?;
    world["arrival"] = json!({
        "seq":world["eventSeq"], "locationId":POND, "fromLocationId":ATTIC,
    });
    Some(world)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, carry) = move_world(request)?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut response = json!({"ok":true});
    response["world"] = begin(before, &geo, &authored, &order, &evidence, carry)?;
    Some(response)
}
