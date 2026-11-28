use super::{
    opening_content, opening_crossings::no_crossing_unlocks_except,
    opening_pond_call_view::cloth_arrival, opening_pond_lamp_drop::quiet_cloth,
    opening_roster::actor_order, opening_station_read::keeper_want_from_read, pack_state::Catalog,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const KEEPER: &str = "keeper";
const PIP: &str = "moth";
const POND: &str = "pond";
const PACK: &str = "greek-drama";
const SIGNAL: &str = "pond-greek-harbor";
const SHIP: &str = "greek-ship";
const QUEST: &str = "quest:keeper:pond";
const TERMS: &str = r#"["place","pond",[["crossing","pond-greek-harbor"],["verb","call"]],null]"#;

fn can_call(world: &Value, geo: &Geography<'_>) -> Option<bool> {
    let pack = geo.packs().find(|pack| pack["id"] == PACK)?;
    let ship = &pack["transports"][SHIP];
    let gate = pack["crossings"]
        .as_array()?
        .iter()
        .find(|entry| entry["id"] == SIGNAL)?;
    let lamp = &world["items"]["lamp"];
    let lit = lamp["lit"].as_bool()?;
    let rooms = if lit { 2 } else { 0 };
    let light = json!({"kind":"light","item":"lamp","at":[POND]});
    if gate["from"] != POND
        || gate["to"] != "greek-harbor"
        || gate["transport"] != SHIP
        || gate["unlockMethod"] != "pond-lamp"
        || gate["unlockWhen"]
            != json!([
                {"kind":"grounded","item":"lamp"}, light,
                {"kind":"in_hand","item":"cloth"}, {"kind":"actor_at","place":POND},
            ])
        || ship["place"] != SHIP
        || !ship["docks"].as_array()?.iter().any(|dock| dock == POND)
        || lamp["holder"] != POND
        || lamp["fuelPlace"] != POND
        || lamp["fuelVisit"] != lit
        || lamp["fuelRooms"] != rooms
        || lamp["fuel"] != rooms * 4
        || !geo.entity_active(world, VALE)?
        || world["crossings"][SIGNAL] != json!({"discovered":false})
        || world["transports"][SHIP]
            != json!({
                "version":3,"phase":"docked","dock":"greek-harbor","destination":null,
                "riders":[],"since":0,"recall":null,
            })
        || geo.crossing_conditions(world, PACK, &json!([light]), Some(VALE))? != lit
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if actor["place"] == SHIP && geo.entity_active(world, id)? {
            return None;
        }
    }
    no_crossing_unlocks_except(world, geo, Some(SIGNAL))?;
    Some(lit)
}

fn ready_wants(world: &Value, geo: &Geography<'_>, read: u64) -> Option<()> {
    let actors = world["actors"].as_object()?;
    let vale = actors.get(VALE)?;
    let keeper = actors.get(KEEPER)?;
    let known = world["knowledge"]["known"].as_object()?;
    if vale["want"] != keeper_want_from_read(world, geo, read)?
        || vale["xp"] != 0
        || ["under", "closed", "metTurn", "completedQuest", "arcana"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || keeper["xp"] != 0
        || keeper["trust"][VALE] != 0
        || keeper["trust"][PIP] != 0
        || [
            "level",
            "content",
            "under",
            "contact",
            "completedQuest",
            "metTurn",
        ]
        .iter()
        .any(|key| !keeper[*key].is_null())
        || world["knowledge"]["known"][PIP][QUEST]
            != json!({"kind":"heard","teller":KEEPER,"eventSeq":2,"learnedTurn":0})
        || known.iter().any(|(id, facts)| {
            !matches!(id.as_str(), VALE | PIP | KEEPER) && facts.get(QUEST).is_some()
        })
        || actors.iter().any(|(id, actor)| {
            !matches!(id.as_str(), VALE | KEEPER) && actor["want"]["step"]["crossing"] == SIGNAL
        })
        || geo
            .packs()
            .any(|pack| pack["avatars"].get(KEEPER).is_some())
    {
        return None;
    }
    Some(())
}

pub(super) fn settle(world: &mut Value, geo: &Geography<'_>, order: &[&str]) -> Option<Vec<Value>> {
    let (arrival, read) = cloth_arrival(world, false)?;
    quiet_cloth(world, geo, arrival)?;
    if world["turn"] != 7
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
    {
        return None;
    }
    if !can_call(world, geo)? {
        return Some(Vec::new());
    }
    ready_wants(world, geo, read)?;

    let vale_first =
        order.iter().position(|id| *id == VALE)? < order.iter().position(|id| *id == KEEPER)?;
    let vale = world["actors"][VALE].as_object_mut()?;
    let want = vale.insert("want".into(), Value::Null)?;
    let mut pending = Vec::with_capacity(2);
    if vale_first {
        vale.insert(
            "completedQuest".into(),
            json!({"want":want,"by":VALE,"turn":7}),
        );
        pending.push(json!([VALE, want, VALE]));
    }
    vale.insert("metTurn".into(), json!(7));
    vale.insert(
        "arcana".into(),
        json!({"proved":[],"did":[],"callers":[KEEPER],"calls":1}),
    );
    vale.insert("closed".into(), json!({"quest:from:keeper":[7,TERMS]}));

    let keeper = world["actors"][KEEPER].as_object_mut()?;
    let want = keeper.insert("want".into(), Value::Null)?;
    keeper.insert(
        "completedQuest".into(),
        json!({"want":want,"by":VALE,"turn":7}),
    );
    pending.push(json!([VALE, want, KEEPER]));
    keeper.insert("metTurn".into(), json!(7));
    keeper.insert("xp".into(), json!(1));
    keeper.insert("level".into(), json!(2));
    keeper.insert("content".into(), json!(true));
    let trust = keeper.get_mut("trust")?.as_object_mut()?;
    for id in [VALE, PIP] {
        trust.insert(id.into(), json!(1));
    }
    keeper.insert("contact".into(), json!({VALE:[7,0],PIP:[7,0]}));

    world["crossings"][SIGNAL] = json!({"discovered":true,"method":"pond-lamp"});
    world["transports"][SHIP]["dock"] = json!(POND);
    world["transports"][SHIP]["since"] = json!(7);
    Some(pending)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let order = actor_order(request, saved)?;
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = saved.clone();
    let pending = settle(&mut world, &geo, &order)?;
    Some(json!({"ok":true,"world":world,"pending":pending}))
}
