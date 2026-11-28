use super::{
    authored_order::Order,
    opening_content, opening_crossings, opening_full_wait, opening_mirror_move,
    opening_pickups::{self, Custody},
    opening_roster, opening_visitor_routes,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    seed, Geography,
};
use serde_json::{json, Value};

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn quiet_turn(world: &Value) -> Option<()> {
    if world["turn"] != 2
        || world.get("began").is_some_and(|began| began != 0)
        || world["playerActorId"] != "vale"
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || !["heldActors", "controlledActors", "presentActors"]
            .iter()
            .all(|field| {
                world[*field]
                    .as_array()
                    .is_some_and(|actors| actors.len() == 1 && actors[0] == "vale")
            })
    {
        return None;
    }
    match world["actors"]["vale"]["place"].as_str()? {
        "attic" => entries(&world["log"])
            .any(|event| {
                event["turn"] == 2
                    && event["actorId"] == "vale"
                    && event["kind"] == "action"
                    && event["locationId"] == "attic"
                    && matches!(event["verb"].as_str(), Some("take" | "wait"))
                    && event["sleep"].is_null()
                    && event["guards"].is_null()
            })
            .then_some(()),
        "pond" => opening_mirror_move::second_arrival(world),
        _ => None,
    }
}

fn room<'a>(geo: &Geography<'a>, id: &str) -> Option<&'a Value> {
    geo.packs()
        .find_map(|pack| pack["places"].get(id))
        .or_else(|| geo.files()["v2/card-game/forest.json"]["places"].get(id))
}

pub(super) fn perform(
    world: &mut Value,
    geo: &Geography,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    custody: &mut Custody,
    actor: &str,
) -> Option<()> {
    quiet_turn(world)?;
    let avatar = entries(&geo.files()["v2/card-game/shared-cast.json"]["avatars"])
        .find(|avatar| avatar["id"] == actor)?;
    let home = avatar["home"]["id"].as_str()?;
    let item = avatar["item"]["id"].as_str()?;
    let a = world["actors"].get(actor)?;
    if a["heldItem"] != item
        || !entries(&a["visited"]).any(|place| place == home)
        || ["sleeping", "homeward", "attend", "guarding", "under"]
            .iter()
            .any(|field| !a[*field].is_null())
        || a["dwellUntil"].as_u64().is_some_and(|until| until > 2)
        || opening_pickups::resting(a, 2)
        || world["peaceUntil"][actor].as_u64()? > 2
        || !world["defeats"][actor].is_null()
        || !world["placeCard"][home].is_null()
        || entries(&world["memories"][actor]["learning"])
            .next()
            .is_some()
        || !custody.can_transfer_one(actor, home)
        || !geo.entity_active(world, actor)?
        || !geo.entity_active(world, item)?
        || opening_pickups::another_way(geo, home)?
        || world["actors"]
            .as_object()?
            .iter()
            .any(|(id, other)| id != actor && other["place"] == home)
    {
        return None;
    }
    let target = a["want"]["target"].as_str()?;
    let place = world["actors"][target]["place"].as_str()?.to_owned();
    let routes = opening_visitor_routes::person_routes(world, geo, actor)?;
    let to = if routes.direct.is_some() {
        routes.direct
    } else if place == "attic" {
        routes.pond
    } else {
        let interior = geo.attic_interior()?;
        if interior.contains(home) {
            if routes.attic.is_some()
                && opening_visitor_routes::reaches_from(world, geo, actor, "pond", &place)?
            {
                routes.attic
            } else {
                None
            }
        } else if interior.contains(place.as_str()) {
            routes.attic.or(routes.pond)
        } else {
            None
        }
    };
    let Some(to) = to else {
        if geo.packs().any(|pack| {
            entries(&pack["choices"]).any(|choice| choice["at"] == home && choice["on"] == "wait")
        }) {
            return None;
        }
        return Some(());
    };
    let homes = geo.packs().find(|pack| pack["id"] == "shared-homes")?;
    let crossing = entries(&homes["crossings"])
        .find(|crossing| crossing["from"] == home && crossing["to"] == to)?;
    let id = crossing["id"].as_str()?;
    if world["doors"][home] != to
        || crossing["retired"] == true
        || !crossing["signal"].is_null()
        || !crossing["transport"].is_null()
        || world["actors"][actor]["crossed"] != 0
        || entries(&homes["choices"]).next().is_some()
        || geo.packs().any(|pack| {
            pack["transports"]
                .as_object()
                .is_some_and(|ships| ships.values().any(|ship| ship["place"] == to))
        })
    {
        return None;
    }
    let first = world["actors"]
        .as_object()?
        .values()
        .all(|a| a["crossed"] == 0);
    let room = room(geo, to)?;
    let name = avatar["name"].as_str()?;
    let place = room["name"].as_str()?;
    let travel = crossing["travel"].as_str()?;
    let ending = if first {
        " Something on the far shore turns its head."
    } else {
        ""
    };
    let dwell = 2 + 24 + seed::hash(&format!("{actor}@2")) % 6;
    custody.transfer_one(actor, home)?;
    world["items"][item]["holder"] = json!(home);
    world["crossings"]
        .get_mut(id)?
        .as_object_mut()?
        .insert("discovered".into(), json!(true));
    let a = &mut world["actors"][actor];
    a["heldItem"] = Value::Null;
    a["place"] = json!(to);
    a["crossed"] = json!(1);
    a["dwellUntil"] = json!(dwell);
    opening_crossings::no_crossing_unlocks(world, geo)?;
    let cast = opening_roster::known_actors(world, geo, order, Some(to))?;
    let items = opening_full_wait::visible_items(world, geo, authored, to)?;
    let detail = json!({
        "speaker":"World", "kind":"action", "verb":"move", "actorId":actor,
        "locationId":to, "fromLocationId":home, "targetId":to, "itemId":null,
        "witnesses":[actor,item], "text":format!("{name} goes to {place} {travel}.{ending}"),
    });
    evidence.record(world, &cast, &items, detail, true)?;
    let a = &mut world["actors"][actor];
    let visited = a["visited"].as_array_mut()?;
    if !visited.iter().any(|place| place == to) {
        visited.push(json!(to));
        visited.drain(..visited.len().saturating_sub(64));
    }
    if room["sanctuary"] == true {
        a["sanctuary"] = json!(to);
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let order = opening_roster::actor_order(request, saved)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut custody = Custody::new(saved)?;
    let mut world = saved.clone();
    perform(
        &mut world,
        &geo,
        &authored,
        &order,
        &evidence,
        &mut custody,
        request["actor"].as_str()?,
    )?;
    Some(json!({"ok":true,"world":world}))
}
