use super::{
    authored_order::Order,
    opening_crossings,
    opening_full_wait::visible_items,
    opening_pond_ask::lamp_trial,
    opening_roster::known_actors,
    opening_station_read::{after_first_log, PROTECTED_FACT_LIMIT},
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const STATION: &str = "station";
const POND: &str = "pond";
const LAMP: &str = "lamp";
const CLOTH: &str = "cloth";
const WAYFINDER: &str = "elysium-wayfinder";

fn quiet_plan(world: &Value, geo: &Geography<'_>, seq: u64) -> Option<()> {
    let pip = &world["actors"][PIP];
    let vale = &world["actors"][VALE];
    let forest = &geo.files()["v2/card-game/forest.json"];
    let expected = json!({"kind":"item","target":LAMP,"since":0,"refusals":1,"lit":true});
    if world["eventSeq"] != seq
        || world["log"].as_array()?.last()?["seq"] != seq
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || !world["disabledPacks"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || !world["pondLampLoan"].is_null()
        || pip["place"] != STATION
        || pip["want"] != expected
        || pip["heldItem"] != CLOTH
        || pip["visited"] != json!([POND, STATION])
        || pip["lastTalk"] != 1
        || pip["dwellUntil"].as_u64()? <= 3
        || world["peaceUntil"][PIP] != 0
        || !world["defeats"][PIP].is_null()
        || !vale["want"].is_null()
        || world["items"][LAMP]["holder"] != VALE
        || world["items"][LAMP]["lit"] != false
        || world["items"][LAMP]["fuelPlace"] != STATION
        || world["items"][CLOTH]["holder"] != PIP
        || world["items"].as_object()?.iter().any(|(id, item)| {
            (item["holder"] == PIP && id != CLOTH)
                || (item["holder"] == VALE && id != LAMP)
                || item["holder"] == LAMP
                || item["holder"] == CLOTH
        })
        || world["motives"]["version"] != 1
        || pip["trust"][VALE] != 0
        || vale["trust"][PIP] != 0
        || [VALE, PIP].iter().any(|id| {
            let actor = &world["actors"][*id];
            actor["xp"] != 0
                || ["sleeping", "level", "under", "homeward"]
                    .iter()
                    .any(|key| !actor[*key].is_null())
                || world["motives"]["grievances"][*id] != json!([])
        })
        || forest["people"][PIP]["want"] != json!({"kind":"item","target":LAMP,"lit":true})
        || forest["people"][PIP]["levelAtHome"] == true
        || ["claims", "records", "teachesQuest"]
            .iter()
            .any(|field| !forest["things"][CLOTH][*field].is_null())
        || geo.packs().any(|pack| {
            pack["avatars"].get(PIP).is_some()
                || pack["items"].get(LAMP).is_some()
                || pack["items"].get(CLOTH).is_some()
        })
    {
        return None;
    }
    let [trial] = world["memories"][PIP]["learning"].as_array()?.as_slice() else {
        return None;
    };
    let prior = world["log"]
        .as_array()?
        .iter()
        .find(|event| event["seq"] == trial["seq"])?;
    (prior["kind"] == "action"
        && prior["generated"] != true
        && prior["turn"] == 1
        && prior["actorId"] == PIP
        && prior["verb"] == "ask"
        && prior["locationId"] == POND
        && prior["itemId"] == LAMP
        && prior["targetId"] == VALE
        && prior["accepted"] == false
        && trial["version"] == 2
        && trial["turn"] == 1
        && trial["goal"] == json!({"kind":"ask","target":VALE,"item":LAMP,"destination":null})
        && trial["intent"] == r#"["item","lamp"]"#
        && trial["action"]["kind"] == "ask"
        && trial["after"]["met"] == false
        && trial["reward"] == -1
        && trial["conditions"].as_str()?.starts_with("[\"pond\","))
    .then_some(())
}

pub(super) fn observe_place(world: &mut Value, geo: &Geography<'_>, seq: u64) -> Option<()> {
    let card = &world["placeCard"][STATION];
    let holder = world["items"][WAYFINDER]["holder"].as_str()?;
    if card.is_null() {
        return (holder == STATION).then_some(());
    }
    let thing = geo.packs().find_map(|pack| pack["items"].get(WAYFINDER))?;
    if card != WAYFINDER
        || thing["holder"] != STATION
        || holder == STATION
        || !geo.entity_active(world, WAYFINDER)?
    {
        return None;
    }
    let place = geo.files()["v2/card-game/forest.json"]["places"][STATION]["name"].as_str()?;
    let item = thing["name"].as_str()?;
    let id = format!("quest:{STATION}:{WAYFINDER}");
    let turn = world["turn"].as_u64()?;
    let knowledge = &mut world["knowledge"];
    if knowledge["version"] != 1 || knowledge["pending"] != json!([]) {
        return None;
    }
    let fact = json!({
        "id": id, "text": format!("{place} wants {item} back."), "source": {
            "kind":"quest","eventSeq":seq,"turn":turn,"actorId":STATION,"locationId":STATION,
            "witnesses":[VALE],"topic":null,
        }
    });
    let witnessed = json!({"kind":"witnessed","teller":null,"eventSeq":seq,"learnedTurn":turn});
    if let Some(existing) = knowledge["facts"].get(&id) {
        return (*existing == fact && knowledge["known"][VALE][&id] == witnessed).then_some(());
    }
    if knowledge["facts"].as_object()?.len() >= PROTECTED_FACT_LIMIT
        || knowledge["known"][VALE].get(&id).is_some()
    {
        return None;
    }
    knowledge["facts"][&id] = fact;
    knowledge["known"][VALE][&id] = witnessed;
    Some(())
}

pub(super) fn record_wait_learning(world: &mut Value, text: &str) -> Option<()> {
    let trial = lamp_trial(world, world["turn"].as_u64()?, "wait", text)?;
    world["memories"][PIP]["learning"]
        .as_array_mut()?
        .push(trial);
    Some(())
}

pub fn settle_station_read_wait(
    world: &mut Value,
    geo: &Geography<'_>,
    authored: &Order,
    actor_order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<()> {
    let seq = after_first_log(world)?;
    quiet_plan(world, geo, seq)?;
    opening_crossings::no_crossing_unlocks(world, geo)?;
    let cast = known_actors(world, geo, actor_order, Some(STATION))?;
    if cast.len() != 3 || ![VALE, PIP, KEEPER].iter().all(|id| cast.contains(id)) {
        return None;
    }
    let items = visible_items(world, geo, authored, STATION)?;
    let witnesses = authored
        .actors
        .iter()
        .map(String::as_str)
        .filter(|id| cast.contains(id))
        .chain(items.iter().copied())
        .collect::<Vec<_>>();
    let pip = geo.files()["v2/card-game/forest.json"]["people"][PIP]["name"].as_str()?;
    let text = format!("{pip} waits one turn.");
    observe_place(world, geo, seq)?;
    evidence.record(
        world,
        &cast,
        &items,
        json!({
            "speaker":"World","text":text,"kind":"action","actorId":PIP,
            "locationId":STATION,"verb":"wait","witnesses":witnesses,
        }),
        true,
    )?;
    record_wait_learning(world, &text)
}
