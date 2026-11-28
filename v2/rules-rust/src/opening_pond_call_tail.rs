use super::{
    authored_order::Order,
    opening_attic_rest, opening_content, opening_crossings, opening_full_move, opening_held_items,
    opening_pond_call_view::{cloth_arrival, completion_owners, drop_receipt},
    opening_pond_lamp_drop::quiet_items,
    opening_quiet_life, opening_roaming, opening_second_attic_tail as tail, opening_settlement,
    opening_wants,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const POND: &str = "pond";
const SHIP: &str = "greek-ship";
const SIGNAL: &str = "pond-greek-harbor";

fn receipt(before: &Value, world: &Value) -> Option<bool> {
    let lit = world["items"]["lamp"]["lit"].as_bool()?;
    let discovered = json!({"discovered":true,"method":"pond-lamp"});
    if before["turn"] != 6
        || world["turn"] != 7
        || world["revision"].as_u64()? != before["revision"].as_u64()?.checked_add(1)?
        || cloth_arrival(before, false)? != cloth_arrival(world, true)?
        || before["eventSeq"].as_u64()?.checked_add(1)? != drop_receipt(world)?
        || [before, world]
            .iter()
            .any(|save| save["actors"][VALE]["place"] != POND)
        || world["items"]["lamp"]["holder"] != POND
        || &world["crossings"][SIGNAL]
            != if lit {
                &discovered
            } else {
                &before["crossings"][SIGNAL]
            }
        || world["transports"][SHIP]["dock"] != if lit { POND } else { "greek-harbor" }
        || world["actors"][VALE]["visited"] != json!(["attic", POND, "station"])
        || world["playerActorId"] != VALE
        || ["heldActors", "presentActors", "controlledActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
    {
        return None;
    }
    Some(lit)
}

pub(super) fn credit(before: &Value, world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let lit = receipt(before, world)?;
    if before["opened"] != world["opened"]
        || (lit && (before["opened"] != json!({POND:[VALE]}) || !geo.entity_active(world, SHIP)?))
    {
        return None;
    }
    if lit {
        world["opened"][SHIP] = json!([VALE]);
    }
    Some(())
}

fn reflection(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    authored: &Order,
    evidence: &ResidentEvidence,
    lit: bool,
) -> Option<()> {
    let mut routes = geo.files()["v2/card-game/forest.json"]["reflectionRoutes"]
        .as_array()?
        .iter()
        .filter(|route| route["from"] == POND);
    let route = routes.next()?;
    if route["to"] != "attic"
        || routes.next().is_some()
        || geo.reflection_open(before, route)?
        || geo.reflection_open(world, route)? != lit
    {
        return None;
    }
    if lit {
        let items = quiet_items(world, geo, authored)?;
        evidence.narrate(
            world,
            &[VALE],
            &items,
            POND,
            "The pond's reflection opens a path to the attic.",
        )?;
    }
    Some(())
}

fn rumours(before: &Value, world: &mut Value, lit: bool) -> Option<()> {
    let items = world["items"].as_object()?;
    let actors = world["actors"].as_object()?;
    if ["gone", "usedUp", "packs"]
        .iter()
        .any(|key| world[*key] != before[*key])
        || items.len() != before["items"].as_object()?.len()
        || !actors.get(VALE)?["rumours"].is_null()
        || world["opened"]
            != if lit {
                json!({POND:[VALE],SHIP:[VALE]})
            } else {
                before["opened"].clone()
            }
    {
        return None;
    }
    for id in items.keys() {
        let to = super::initial_wants::root(world, id)?;
        if to != VALE && actors.contains_key(to) && super::initial_wants::root(before, id)? != to {
            return None;
        }
    }
    let since = before["eventSeq"].as_u64()?;
    let mut calls = world["log"].as_array()?.iter().filter(|event| {
        event["seq"].as_u64().is_some_and(|seq| seq > since) && event["verb"] == "want_met"
    });
    for owner in if lit { completion_owners(world) } else { &[] } {
        let call = calls.next()?;
        if call["actorId"] != VALE
            || call["ownerId"] != *owner
            || call["wantMet"] != json!({"kind":"place","target":POND})
        {
            return None;
        }
    }
    if calls.next().is_some() {
        return None;
    }
    if lit {
        world["actors"][VALE]["rumours"] = json!([
            {"subject":SHIP,"kind":"place","at":POND,"holder":null,"teller":null,"hops":0,"day":0}
        ]);
    }
    Some(())
}

pub(super) fn finish(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    catalog: &Catalog,
    authored: &Order,
    evidence: &ResidentEvidence,
) -> Option<()> {
    let lit = receipt(before, world)?;
    opening_settlement::decay_bell(world)?;
    opening_roaming::settle_dwell(world, geo)?;
    opening_quiet_life::verify_quiet_residents(world, geo, POND, &[VALE])?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    if !forest["people"][VALE]["stops"].is_null()
        || geo.packs().any(|pack| pack["avatars"].get(VALE).is_some())
        || !opening_settlement::sail_transports(world, catalog, None)?.is_empty()
    {
        return None;
    }
    opening_held_items::settle(world, geo, Some(before))?;
    opening_crossings::no_crossing_unlocks(world, geo)?;
    opening_full_move::quiet_discoveries(before, world, geo, Some(SIGNAL))?;
    opening_full_move::no_crossing_narration(before, world, geo)?;
    reflection(before, world, geo, authored, evidence, lit)?;
    tail::no_sleepers(world)?;
    opening_settlement::no_item_cycle(world)?;
    opening_wants::settle_pond_drop(before, world, geo)?;
    opening_quiet_life::verify_home_levels(world, geo)?;
    let arcana = json!({"proved":[],"did":[],"callers":["keeper"],"calls":1});
    if geo.files()["v2/card-game/arcana.json"]["calls"].as_u64()? <= 1
        || world["actors"].as_object()?.iter().any(|(id, actor)| {
            &actor["arcana"]
                != if lit && id == VALE {
                    &arcana
                } else {
                    &Value::Null
                }
        })
    {
        return None;
    }
    tail::sealed_at_rest(world, geo)?;
    tail::guards_stable(world, geo)?;
    opening_attic_rest::settle_visit_speech(before, world, false)?;
    tail::verify_wayfinder_placement(world, geo)?;
    tail::verify_station_order(world, geo)?;
    tail::no_box_release(world)?;
    rumours(before, world, lit)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = request.get("before")?;
    let mut world = request.get("world")?.clone();
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    match request["phase"].as_str()? {
        "credit" => credit(before, &mut world, &geo)?,
        "finish" => finish(
            before,
            &mut world,
            &geo,
            &catalog,
            &authored,
            &ResidentEvidence::new(&files)?,
        )?,
        _ => return None,
    }
    Some(json!({"ok":true,"world":world}))
}
