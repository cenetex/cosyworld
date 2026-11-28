use super::{opening, profiles};
use serde_json::{json, Value};

const ACCEPT_POND: &str = "accept:vale::box:pond";

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let world = opening::supported_world(request)?;
    let actor = request["actor"].as_str()?;
    if !request["present"]
        .as_array()?
        .iter()
        .any(|seat| seat == actor)
    {
        return refusal(world, "Enter this world with your avatar first.");
    }
    if !request["selectedIds"].is_null() {
        return None;
    }
    if !request["revision"].is_null() && request["revision"] != world["revision"] {
        return refusal(world, "The world changed. Choose a current play.");
    }
    let action = &request["action"];
    if action["kind"] == "pack" {
        return None;
    }
    let key = action.as_str().or_else(|| action["key"].as_str());
    match key {
        None => refusal(
            world,
            "That play has changed. Check the cards and choose again.",
        ),
        Some(ACCEPT_POND) if actor == "vale" => accept_pond(world, request),
        Some(_) => None,
    }
}

fn refusal(world: &Value, error: &str) -> Option<Value> {
    let mut response = opening::stored_response(world.clone())?;
    response["ok"] = json!(false);
    response["error"] = json!(error);
    Some(response)
}

fn accept_pond(world: &Value, request: &Value) -> Option<Value> {
    let vale = world["actors"]["vale"].as_object()?;
    if world["items"]["lamp"]["lit"] != true
        || world["items"]["lamp"]["holder"] != "vale"
        || vale.get("want") != Some(&Value::Null)
        || ["arcana", "closed", "sleeping", "under"]
            .iter()
            .any(|field| vale.contains_key(*field))
        || vale
            .get("upgrades")
            .and_then(Value::as_array)
            .is_some_and(|upgrades| upgrades.iter().any(|upgrade| upgrade == "scarf"))
        || !world["elysiumEncounters"].is_null()
        || world["doors"]
            .as_object()?
            .values()
            .any(|place| place == "attic")
        || !world["standoffs"].as_array().is_some_and(Vec::is_empty)
        || world["log"].as_array()?.iter().any(|entry| {
            entry["kind"] == "action" && entry["actorId"] == "vale" && entry["generated"] != true
        })
        || world["actors"]
            .as_object()?
            .iter()
            .any(|(id, actor)| id != "vale" && actor["place"] == "attic")
        || world["items"].as_object()?.iter().any(|(id, item)| {
            id != "lamp"
                && item["holder"]
                    .as_str()
                    .is_some_and(|id| matches!(id, "attic" | "vale" | "lamp"))
        })
        || world["usedUp"].as_array()?.iter().any(|id| id == "lamp")
    {
        return None;
    }
    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let files = &content["files"];
    let forest = &files["v2/card-game/forest.json"];
    let mut reflections = forest["reflectionRoutes"]
        .as_array()?
        .iter()
        .filter(|route| route["from"] == "attic");
    let route = reflections.next()?;
    if route["to"] != "pond"
        || route["sealed"] != json!({})
        || reflections.next().is_some()
        || route["requires"]
            != json!([{"kind":"not", "condition":{"kind":"light","item":"lamp","at":["attic"],"uncovered":true}}])
        || !forest["places"]["attic"]["exits"]
            .as_array()
            .is_some_and(Vec::is_empty)
        || packs_add_attic_actions(files)?
    {
        return None;
    }
    let revision = world["revision"].as_u64()?.checked_add(1)?;
    if revision > opening::MAX_REVISION {
        return None;
    }
    let mut next = world.clone();
    next["actors"]["vale"]["want"] = json!({
        "kind":"item", "target":"lamp", "since":world["turn"], "refusals":0,
        "story":true, "lit":false, "from":"quest:box:pond"
    });
    next["actors"]["vale"].as_object_mut()?.remove("content");
    let voices = next
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}));
    voices
        .as_object_mut()?
        .insert("vale".into(), json!(["vale"]));
    next["revision"] = json!(revision);
    let mut response = opening::stored_response(next)?;
    response["events"] = json!([]);
    response["actor"] = json!("vale");
    response["room"] = json!("attic");
    response["actions"] = actions(forest)?;
    response["exits"] = json!([]);
    response["profiles"] = profiles::project(files)?;
    Some(response)
}

fn packs_add_attic_actions(files: &Value) -> Option<bool> {
    let packs = files["v2/card-game/packs.json"]["packs"].as_array()?;
    let boardy = files.get("v2/card-game/boardyai.json")?;
    let cottage_conditions = json!([
        {"kind":"light", "item":"lamp", "at":["attic"], "uncovered":true},
        {"kind":"any", "conditions":[
            {"kind":"item_present", "item":"cloth", "place":"attic"},
            {"kind":"tag_held", "tag":"scarf", "place":"attic"}
        ]}
    ]);
    Some(packs.iter().chain([boardy]).any(|pack| {
        ["routes", "crossings"].iter().any(|kind| {
            pack[*kind].as_array().is_some_and(|routes| {
                routes.iter().any(|route| {
                    route["from"] == "attic"
                        && (*kind != "crossings"
                            || route["to"] != "forest-cottage"
                            || route["requires"] != cottage_conditions
                            || route.get("sealed").is_some())
                })
            })
        }) || pack["fixtures"]
            .as_object()
            .is_some_and(|fixtures| fixtures.values().any(|fixture| fixture["at"] == "attic"))
    }))
}

fn actions(forest: &Value) -> Option<Value> {
    let name = forest["people"]["vale"]["name"].as_str()?;
    let lamp = forest["things"]["lamp"]["name"].as_str()?;
    let attic = forest["places"]["attic"]["name"].as_str()?;
    Some(json!([
        {"kind":"wait","actor":"vale","item":null,"target":null,
            "text":format!("{name} waits one turn."),"cards":[],"key":"wait:vale::"},
        {"kind":"drop","actor":"vale","item":"lamp","target":"attic",
            "text":format!("{name} puts the {lamp} in {attic}."),"cards":["lamp"],"key":"drop:vale:lamp:attic"},
        {"kind":"drop","actor":"vale","item":null,"target":null,
            "text":format!("{name} abandons their quest to hold the dark {lamp}."),
            "cards":[],"key":"drop:vale:::0","quest":0}
    ]))
}
