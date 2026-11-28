use super::{
    authored_order::Order,
    opening::MAX_REVISION,
    opening_content,
    opening_crossings::no_crossing_unlocks_except,
    opening_pond_call_view::{before_drop, cloth_arrival, completion_owners, drop_receipt},
    opening_pond_lamp_drop::{quiet_cloth, quiet_items},
    opening_roster::actor_order,
    opening_station_read::keeper_want_from_read,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
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
    let (head, read) = before_drop(world)?;
    quiet_cloth(world, geo, head)?;
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

fn completion_line(
    world: &Value,
    evidence: &ResidentEvidence,
    queued: &Value,
    owner: &str,
) -> Option<Value> {
    let receipt = &world["actors"][owner]["completedQuest"];
    let want = receipt.get("want")?;
    let since = if owner == VALE { 3 } else { 0 };
    let source = if owner == VALE {
        Some("quest:from:keeper")
    } else {
        None
    };
    if receipt["by"] != VALE
        || receipt["turn"] != 7
        || want["kind"] != "place"
        || want["target"] != POND
        || want["since"] != since
        || want["from"].as_str() != source
        || want["refusals"] != 0
        || want["step"] != json!({"verb":"call","crossing":SIGNAL})
        || *queued != json!([VALE, want, owner])
    {
        return None;
    }
    let caller = evidence.profile(VALE)?["name"].as_str()?;
    let recipient = evidence.profile(owner)?["name"].as_str()?;
    Some(json!({
        "speaker":"World", "text":format!("{caller} calls the ship for {recipient}."),
        "kind":"narration", "actorId":VALE, "verb":"want_met", "locationId":POND,
        "ownerId":owner, "wantMet":{"kind":"place","target":POND},
        "wantKey":format!("{VALE}:place:{POND}:{since}::{TERMS}"),
    }))
}

pub(super) fn narrate(
    world: &mut Value,
    geo: &Geography<'_>,
    authored: &Order,
    evidence: &ResidentEvidence,
    pending: &[Value],
) -> Option<()> {
    let (_, read) = cloth_arrival(world, true)?;
    let drop_seq = drop_receipt(world)?;
    let drop = world["log"].as_array()?.last()?;
    let lamp = &world["items"]["lamp"];
    let lit = lamp["lit"].as_bool()?;
    let gate = if lit {
        json!({"discovered":true,"method":"pond-lamp"})
    } else {
        json!({"discovered":false})
    };
    let items = quiet_items(world, geo, authored)?;
    let witnesses: Vec<_> = std::iter::once(VALE).chain(items.iter().copied()).collect();
    if drop["seq"] != drop_seq
        || world["eventSeq"] != drop_seq
        || drop["fromLocationId"] != POND
        || drop["cast"] != json!([VALE])
        || drop["light"] != lit
        || drop["witnesses"] != json!(witnesses)
        || world["actors"][VALE]["place"] != POND
        || world["actors"][VALE]["heldItem"] != "cloth"
        || world["items"]["cloth"]["holder"] != VALE
        || lamp["holder"] != POND
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || world["crossings"][SIGNAL] != gate
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && actor["place"] == POND && geo.entity_active(world, id)? {
            return None;
        }
    }
    if !lit {
        return (pending.is_empty()
            && world["actors"][VALE]["want"] == keeper_want_from_read(world, geo, read)?)
        .then_some(());
    }
    let owners = completion_owners(world);
    if owners.len() != pending.len()
        || drop_seq.checked_add(pending.len() as u64)? > MAX_REVISION
        || world["transports"][SHIP]["dock"] != POND
        || world["actors"][VALE]["closed"]["quest:from:keeper"] != json!([7, TERMS])
    {
        return None;
    }
    let lines = pending
        .iter()
        .zip(owners)
        .map(|(record, owner)| completion_line(world, evidence, record, owner))
        .collect::<Option<Vec<_>>>()?;
    for line in lines {
        evidence.record(world, &[VALE], &items, line, true)?;
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = saved.clone();
    if request["phase"] == "narrate" {
        let pending = request["pending"].as_array()?;
        let evidence = ResidentEvidence::new(&files)?;
        narrate(&mut world, &geo, &authored, &evidence, pending)?;
        return Some(json!({"ok":true,"world":world}));
    }
    let order = actor_order(request, saved)?;
    let pending = settle(&mut world, &geo, &order)?;
    Some(json!({"ok":true,"world":world,"pending":pending}))
}
