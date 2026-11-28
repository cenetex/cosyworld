use super::{opening_pond_ask::lamp_trial, Geography};
use serde_json::{json, Value};

const PIP: &str = "moth";
const VALE: &str = "vale";
const STATION: &str = "station";

pub(super) fn confirm_pip_wait(world: &Value, geo: &Geography) -> Option<()> {
    let pip = &world["actors"][PIP];
    let prior_turn = world["turn"].as_u64()?.checked_sub(1)?;
    if pip["place"] != STATION
        || !pip["homeward"].is_null()
        || !pip["level"].is_null()
        || pip["xp"] != 0
        || pip["heldItem"] != "cloth"
        || pip["lastTalk"] != prior_turn
        || pip["want"] != json!({"kind":"item","target":"lamp","lit":true,"refusals":1,"since":0})
        || world["items"]["lamp"]["holder"] != VALE
        || world["items"]["cloth"]["holder"] != PIP
        || world["actors"][VALE]["trust"][PIP] != 0
        || world["motives"]["version"] != 1
        || [VALE, PIP]
            .iter()
            .any(|id| world["motives"]["grievances"][*id] != json!([]))
        || !geo.entity_active(world, PIP)?
        || !geo.entity_active(world, "lamp")?
    {
        return None;
    }
    let [prior] = world["memories"][PIP]["learning"].as_array()?.as_slice() else {
        return None;
    };
    confirm_pond_ask_trial(world, prior, prior_turn)
}

pub(super) fn confirm_pond_ask_trial(world: &Value, prior: &Value, prior_turn: u64) -> Option<()> {
    let ask = world["log"].as_array()?.iter().find(|event| {
        event["seq"] == prior["seq"]
            && event["kind"] == "action"
            && event["generated"] != true
            && event["actorId"] == PIP
            && event["verb"] == "ask"
            && event["itemId"] == "lamp"
            && event["targetId"] == VALE
            && event["accepted"] == false
            && event["locationId"] == "pond"
            && event["turn"] == prior_turn
    })?;
    let mut expected = lamp_trial(world, prior_turn, "ask", ask["text"].as_str()?)?;
    let mut conditions: Value = serde_json::from_str(expected["conditions"].as_str()?).ok()?;
    conditions[0] = json!("pond");
    conditions[6] = json!("pond");
    expected["seq"] = ask["seq"].clone();
    expected["conditions"] = json!(conditions.to_string());
    expected["afterConditions"] = expected["conditions"].clone();
    (expected == *prior).then_some(())
}
