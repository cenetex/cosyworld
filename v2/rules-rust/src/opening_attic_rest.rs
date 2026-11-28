use super::opening_wait;
use serde_json::{json, Value};

const VALE: &str = "vale";
const ATTIC: &str = "attic";
const VISIT_LIMIT: usize = 64;

fn attic_sanctuary(files: &Value) -> Option<bool> {
    let attic = files["v2/card-game/forest.json"]["places"][ATTIC].as_object()?;
    Some(attic.get("sanctuary") == Some(&Value::Bool(true)))
}

pub(super) fn rest_vale(world: &mut Value, files: &Value) -> Option<()> {
    if !world["standoffs"].as_array()?.is_empty() {
        return None;
    }
    let actor = world["actors"].get_mut(VALE)?.as_object_mut()?;
    if actor.get("place")?.as_str()? != ATTIC || actor.contains_key("sleeping") {
        return None;
    }
    actor.remove("guarding");
    let home = &files["v2/card-game/forest.json"]["people"][VALE]["home"];
    if attic_sanctuary(files)? || home == ATTIC {
        if let Some(defeats) = world.get_mut("defeats") {
            defeats.as_object_mut()?.remove(VALE);
        }
    }
    Some(())
}

fn unmet_want(world: &Value, want: &Value) -> Option<bool> {
    if want.is_null() {
        return Some(true);
    }
    if !want["step"].is_null() {
        return None;
    }
    match want["kind"].as_str()? {
        "person" | "connect" => Some(true),
        "place" => Some(want["target"].as_str()? != ATTIC),
        "item" => {
            let target = want["target"].as_str()?;
            let wants_lit = want["lit"].as_bool()?;
            let items = world["items"].as_object()?;
            let item = items.get(target)?;
            Some(
                item["holder"] != VALE
                    || (item["lit"] == true) != wants_lit
                    || items.values().any(|item| item["holder"] == target),
            )
        }
        _ => None,
    }
}

pub(super) fn settle_vale_wants(world: &mut Value, files: &Value) -> Option<()> {
    let vale = &world["actors"][VALE];
    let knowledge = &world["knowledge"];
    let facts = knowledge["facts"].as_object()?;
    let heard_quest = knowledge["known"][VALE].as_object().is_some_and(|known| {
        known
            .keys()
            .any(|key| key.starts_with("quest:") && facts.contains_key(key))
    });
    if vale["place"] != ATTIC
        || !vale["under"].is_null()
        || heard_quest
        || !unmet_want(world, vale.get("want")?)?
    {
        return None;
    }
    let actor = world["actors"].get_mut(VALE)?.as_object_mut()?;
    let visited = actor.get_mut("visited")?.as_array_mut()?;
    if !visited.iter().any(|place| place == ATTIC) {
        visited.push(json!(ATTIC));
        visited.drain(..visited.len().saturating_sub(VISIT_LIMIT));
    }
    if attic_sanctuary(files)? {
        actor.insert("sanctuary".into(), json!(ATTIC));
    }
    Some(())
}

fn moved(entry: &Value, id: &str) -> bool {
    entry["generated"] != true
        && entry["fromLocationId"]
            .as_str()
            .is_some_and(|from| !from.is_empty() && entry["locationId"] != from)
        && (entry["actorId"] == id
            || (entry["verb"] == "accompany"
                && entry["accepted"] == true
                && entry["targetId"] == id))
}

fn waited_at(entry: &Value, id: &str, place: &str) -> bool {
    entry["actorId"] == id
        && entry["locationId"] == place
        && entry["generated"] != true
        && (entry["kind"] == "wait" || entry["verb"] == "wait")
        && entry["sleep"] != true
        && entry["guards"].as_str().is_none_or(str::is_empty)
}

fn previous_wait_turn(actor: &Value, log: &[Value], id: &str, place: &str) -> Option<Value> {
    if let Some(saved) = actor.get("waitSpeech") {
        return if saved["place"] == place {
            Some(saved.get("turn")?.clone())
        } else {
            Some(Value::Null)
        };
    }
    let arrival = log
        .iter()
        .rfind(|entry| moved(entry, id))
        .map_or(Some(0), |entry| entry["seq"].as_u64())?;
    Some(
        log.iter()
            .find(|entry| {
                entry["seq"].as_u64().is_some_and(|seq| seq > arrival)
                    && waited_at(entry, id, place)
            })
            .map_or(Value::Null, |entry| entry["turn"].clone()),
    )
}

pub(super) fn settle_visit_speech(before: &Value, next: &mut Value, waited: bool) -> Option<()> {
    let before_seq = before["eventSeq"].as_u64()?;
    let turn = next["turn"].as_u64()?;
    let log_before = before["log"].as_array()?;
    let log_after = next["log"].as_array()?;
    let mut updates = Vec::new();
    for (id, actor) in next["actors"].as_object()? {
        if id != VALE && actor.get("waitSpeech").is_none() {
            continue;
        }
        let prior = before["actors"].get(id)?;
        let place = actor["place"].as_str()?;
        let left = prior["place"] != place
            || log_after.iter().any(|entry| {
                entry["seq"].as_u64().is_some_and(|seq| seq > before_seq) && moved(entry, id)
            });
        let mut last_wait = if left {
            Value::Null
        } else {
            previous_wait_turn(prior, log_before, id, place)?
        };
        if waited && id == VALE && !left && last_wait.is_null() {
            last_wait = json!(turn);
        }
        updates.push((id.clone(), json!({"place":place,"turn":last_wait})));
    }
    for (id, state) in updates {
        next["actors"]
            .get_mut(&id)?
            .as_object_mut()?
            .insert("waitSpeech".into(), state);
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let present = request["present"].as_array()?;
    if present.len() != 1 || present[0] != VALE {
        return None;
    }
    let before = &request["world"];
    let (mut next, _, files) = opening_wait::begin(request)?;
    rest_vale(&mut next, &files)?;
    settle_vale_wants(&mut next, &files)?;
    settle_visit_speech(before, &mut next, true)?;
    Some(json!({
        "ok":true,
        "vale":next["actors"][VALE],
        "defeats":next["defeats"],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_visits_keep_the_first_wait_since_arrival_and_clear_after_a_round_trip() {
        let before = json!({
            "turn":7,
            "eventSeq":8,
            "actors":{
                "vale":{"place":"attic"},
                "mara":{"place":"pond","waitSpeech":{"place":"pond","turn":3}},
            },
            "log":[
                {"seq":1,"actorId":"vale","locationId":"attic","verb":"wait","turn":1},
                {"seq":2,"actorId":"mara","fromLocationId":"pond","locationId":"attic",
                    "targetId":"vale","verb":"accompany","accepted":true,"turn":2},
                {"seq":4,"actorId":"vale","locationId":"attic","verb":"wait","sleep":true,"turn":3},
                {"seq":6,"actorId":"vale","locationId":"attic","verb":"wait","turn":5},
                {"seq":8,"actorId":"vale","locationId":"attic","verb":"wait","turn":7},
            ],
        });
        let mut next = before.clone();
        next["turn"] = json!(8);
        next["log"].as_array_mut().unwrap().extend([
            json!({"seq":9,"actorId":"mara","fromLocationId":"pond","locationId":"station"}),
            json!({"seq":10,"actorId":"mara","fromLocationId":"station","locationId":"pond"}),
        ]);
        assert_eq!(settle_visit_speech(&before, &mut next, true), Some(()));
        assert_eq!(
            next["actors"]["vale"]["waitSpeech"],
            json!({"place":"attic","turn":5})
        );
        assert_eq!(
            next["actors"]["mara"]["waitSpeech"],
            json!({"place":"pond","turn":null})
        );
    }
}
