use super::{
    opening::{self, MAX_REVISION},
    opening_evidence::{remember, trim_log},
    opening_play,
};
use serde_json::{json, Map, Value};

const ACTOR: &str = "vale";
const ROOM: &str = "attic";
const LAMP: &str = "lamp";
const WAIT: &str = "wait:vale::";

fn next_integer(value: &Value) -> Option<u64> {
    Some(value.as_u64()?.checked_add(1)?).filter(|next| *next <= MAX_REVISION)
}

fn wait_sign_in_attic(files: &Value) -> Option<bool> {
    let packs = files["v2/card-game/packs.json"]["packs"].as_array()?;
    let boardy = files.get("v2/card-game/boardyai.json")?;
    Some(packs.iter().chain([boardy]).any(|pack| {
        pack["choices"].as_array().is_some_and(|choices| {
            choices
                .iter()
                .any(|choice| choice["at"] == ROOM && choice["on"] == "wait")
        })
    }))
}

fn begin_wait(world: &mut Value, files: &Value) -> Option<Value> {
    let profiles = files["v2/card-game/entity-profiles.json"].as_object()?;
    let memories = world["memories"].as_object()?;
    for (id, kind) in [(ACTOR, "avatar"), (ROOM, "location"), (LAMP, "item")] {
        if profiles.get(id)?["kind"] != kind || !memories.get(id)?["events"].is_array() {
            return None;
        }
    }
    let player = &memories[ACTOR];
    if player["subjects"].as_object()?.len() > 62
        || !player["seen"].is_object()
        || player["learning"]
            .as_array()
            .is_some_and(|trials| !trials.is_empty())
        || wait_sign_in_attic(files)?
    {
        return None;
    }

    let turn = next_integer(&world["turn"])?;
    let revision = next_integer(&world["revision"])?;
    let seq = next_integer(&world["eventSeq"])?;
    let log = world["log"].as_array()?;
    if log.is_empty()
        || log
            .iter()
            .any(|entry| entry["seq"].as_u64().is_none_or(|previous| previous >= seq))
    {
        return None;
    }

    let name = files["v2/card-game/forest.json"]["people"][ACTOR]["name"].as_str()?;
    let mut lamp = world["items"][LAMP].as_object()?.clone();
    let light = lamp.get("lit")?.as_bool()?;
    lamp.remove("history");
    lamp.entry("id").or_insert_with(|| json!(LAMP));
    let event = json!({
        "seq":seq, "turn":turn, "speaker":"World", "text":format!("{name} waits one turn."),
        "kind":"action", "actorId":ACTOR, "locationId":ROOM, "cast":[ACTOR],
        "items":[lamp], "light":light, "verb":"wait", "witnesses":[ACTOR,LAMP],
    });
    remember(world["memories"].as_object_mut()?, profiles, &event)?;
    let log = world["log"].as_array_mut()?;
    log.push(event.clone());
    trim_log(log);
    world["turn"] = turn.into();
    world["revision"] = revision.into();
    world["eventSeq"] = seq.into();
    Some(event)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let world = opening::supported_world(request)?;
    let action = &request["action"];
    if request["actor"] != ACTOR
        || !opening::seats(&request["present"])?.contains(&ACTOR)
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || world["absent"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == ACTOR))
        || action["kind"] == "pack"
        || action.as_str().or_else(|| action["key"].as_str()) != Some(WAIT)
    {
        return None;
    }
    let files = opening_play::attic_files(world, request)?;
    let mut next = world.clone();
    let event = begin_wait(&mut next, &files)?;
    let mut memories = Map::new();
    for id in [ACTOR, ROOM, LAMP] {
        memories.insert(id.into(), next["memories"].as_object_mut()?.remove(id)?);
    }
    Some(json!({
        "ok":true,
        "event":event,
        "turn":next["turn"],
        "revision":next["revision"],
        "eventSeq":next["eventSeq"],
        "log":next["log"],
        "memories":memories,
    }))
}
