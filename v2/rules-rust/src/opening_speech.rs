use super::{
    opening::stored_response,
    opening_evidence::{remember_moment, trim_log},
    opening_reflection::{opening_world, trim_text, valid_text},
};
use serde_json::{json, Value};

const ROOM: &str = "attic";
const ACTOR: &str = "vale";
const ITEM: &str = "lamp";
const LOG_LIMIT: usize = 100;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

fn sole_occupancy(world: &Value) -> Option<bool> {
    let actors = world["actors"].as_object()?;
    let items = world["items"].as_object()?;
    if actors
        .iter()
        .any(|(id, actor)| id != ACTOR && actor["place"] == ROOM)
    {
        return Some(false);
    }
    for (id, item) in items.iter().filter(|(id, _)| *id != ITEM) {
        let mut holder = item["holder"].as_str();
        for _ in 0..items.len() {
            if holder == Some(id) {
                return None;
            }
            let Some(parent) = holder.and_then(|holder| items.get(holder)) else {
                break;
            };
            holder = parent["holder"].as_str();
        }
        if holder.is_some_and(|holder| items.contains_key(holder)) {
            return None;
        }
        if matches!(holder, Some(ROOM | ACTOR)) {
            return Some(false);
        }
    }
    Some(true)
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let world = opening_world(request)?;
    if request["room"] != ROOM
        || !(request["entries"].is_null()
            || request["entries"].as_array().is_some_and(Vec::is_empty))
        || world["absent"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == ACTOR))
        || world["usedUp"].as_array()?.iter().any(|item| item == ITEM)
        || !sole_occupancy(world)?
    {
        return None;
    }

    let lines = request["lines"].as_array()?;
    if !(1..=2).contains(&lines.len()) {
        return None;
    }
    let voices = world["speechVoices"][ACTOR].as_array()?;
    let mut distinct = [false; 2];
    let mut draft = Vec::with_capacity(lines.len());
    for line in lines {
        if !line["disclosed"].is_null()
            || line.get("elysiumName").is_some()
            || !(line["actorId"].is_null() || line["actorId"].is_string())
        {
            return None;
        }
        let voice = line["actorId"].as_str().or(line["entityId"].as_str())?;
        let scenic = match voice {
            ROOM if line["actorId"].is_null() => true,
            ACTOR if voices.iter().any(|id| id == ACTOR) => false,
            _ => return None,
        };
        if std::mem::replace(&mut distinct[usize::from(scenic)], true) {
            return None;
        }
        let text = line["text"].as_str().filter(|text| valid_text(text, 600))?;
        draft.push((scenic, trim_text(text)));
    }

    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    let forest = &content["files"]["v2/card-game/forest.json"];
    let profile = &content["files"]["v2/card-game/entity-profiles.json"][ACTOR];
    let room_name = forest["places"][ROOM]["name"].as_str()?;
    let actor_name = forest["people"][ACTOR]["name"].as_str()?;
    if profile["kind"] != "avatar"
        || !(profile["expression"].is_null() || profile["expression"] == "speech")
        || [room_name, actor_name]
            .iter()
            .any(|name| !valid_text(name, 48))
        || forest["people"]
            .as_object()?
            .values()
            .any(|person| person["name"] == room_name)
    {
        return None;
    }

    let turn = world["turn"].as_u64()?;
    let mut sequence = world["eventSeq"].as_u64()?;
    let revision = world["revision"].as_u64()?;
    if sequence > MAX_SAFE_INTEGER - draft.len() as u64 || revision >= MAX_SAFE_INTEGER {
        return None;
    }
    let authoritative = world["log"]
        .as_array()?
        .iter()
        .filter(|entry| entry["generated"] != true)
        .count();
    if !(1..=LOG_LIMIT).contains(&authoritative) {
        return None;
    }
    let mut lamp = world["items"][ITEM].as_object()?.clone();
    lamp.remove("history");
    lamp.insert("id".into(), json!(ITEM));
    let light = lamp.get("lit")?.as_bool()?;
    let mut world = world.clone();
    let mut published = Vec::with_capacity(draft.len());
    for (scenic, text) in draft {
        sequence += 1;
        let (name, kind, actor, entity) = if scenic {
            (room_name, "narration", None, ROOM)
        } else {
            (actor_name, "dialogue", Some(ACTOR), ACTOR)
        };
        let line = json!({
            "seq":sequence, "turn":turn, "speaker":name, "text":text, "kind":kind,
            "actorId":actor, "entityId":entity, "locationId":ROOM, "cast":[ACTOR],
            "items":[lamp], "light":light, "generated":true
        });
        let memory = json!({
            "seq":sequence, "turn":turn, "kind":"expression", "text":format!("{name}: {text}")
        });
        for id in [ROOM, ACTOR, ITEM] {
            let events = world
                .get_mut("memories")?
                .get_mut(id)?
                .get_mut("events")?
                .as_array_mut()?;
            remember_moment(events, &memory);
        }
        world["log"].as_array_mut()?.push(line.clone());
        published.push(line);
    }
    trim_log(world["log"].as_array_mut()?);
    world["eventSeq"] = json!(sequence);
    world["revision"] = json!(revision + 1);
    let mut response = stored_response(world)?;
    response["lines"] = json!(published);
    Some(response)
}
