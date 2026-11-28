use super::{opening, profiles};
use serde_json::{json, Value};

const ACCEPT_POND: &str = "accept:vale::box:pond";

pub(super) enum Mirror {
    Shut { quest_accepted: bool },
    Open { pond_available: bool },
}

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
    let key = action
        .as_str()
        .filter(|key| key.splitn(4, ':').count() == 4)
        .or_else(|| action["key"].as_str());
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
    if world["items"]["lamp"]["lit"] != true
        || world["actors"]["vale"].get("want") != Some(&Value::Null)
    {
        return None;
    }
    let files = attic_files(world, request)?;
    let revision = world["revision"].as_u64()?.checked_add(1)?;
    if revision > opening::MAX_REVISION {
        return None;
    }
    let mut next = world.clone();
    next["actors"]["vale"]["want"] = pond_quest(world);
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
    attic_response(
        response,
        &files,
        Mirror::Shut {
            quest_accepted: true,
        },
    )
}

pub(super) fn pond_quest(world: &Value) -> Value {
    json!({
        "kind":"item", "target":"lamp", "since":world["turn"], "refusals":0,
        "story":true, "lit":false, "from":"quest:box:pond"
    })
}

pub(super) fn attic_files(world: &Value, request: &Value) -> Option<Value> {
    attic_state(world)?;
    let mut content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let files = content.as_object_mut()?.remove("files")?;
    attic_content(&files)?;
    Some(files)
}

pub(super) fn attic_state(world: &Value) -> Option<()> {
    let vale = world["actors"]["vale"].as_object()?;
    if world["items"]["lamp"]["holder"] != "vale"
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
    Some(())
}

pub(super) fn attic_content(files: &Value) -> Option<()> {
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
    Some(())
}

pub(super) fn attic_response(mut response: Value, files: &Value, mirror: Mirror) -> Option<Value> {
    response["actor"] = json!("vale");
    response["room"] = json!("attic");
    response["exits"] = if matches!(
        mirror,
        Mirror::Open {
            pond_available: true
        }
    ) {
        json!(["pond"])
    } else {
        json!([])
    };
    response["actions"] = actions(&files["v2/card-game/forest.json"], mirror)?;
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

fn actions(forest: &Value, mirror: Mirror) -> Option<Value> {
    let name = forest["people"]["vale"]["name"].as_str()?;
    let lamp = forest["things"]["lamp"]["name"].as_str()?;
    let attic = forest["places"]["attic"]["name"].as_str()?;
    let wait = json!({"kind":"wait","actor":"vale","item":null,"target":null,
        "text":format!("{name} waits one turn."),"cards":[],"key":"wait:vale::"});
    let drop = json!({"kind":"drop","actor":"vale","item":"lamp","target":"attic",
        "text":format!("{name} puts the {lamp} in {attic}."),
        "cards":["lamp"],"key":"drop:vale:lamp:attic"});
    let quest = match mirror {
        Mirror::Open {
            pond_available: true,
        } => {
            let pond = forest["places"]["pond"]["name"].as_str()?;
            return Some(json!([
                wait,
                {"kind":"move","actor":"vale","item":null,"target":"pond",
                    "text":format!("{name} goes to {pond} through the reflection."),
                    "cards":["pond"],"key":"move:vale::pond"},
                {"kind":"move","actor":"vale","item":"lamp","target":"pond",
                    "text":format!("{name} carries the {lamp} to {pond} through the reflection."),
                    "cards":["lamp","pond"],"key":"move:vale:lamp:pond"},
                drop
            ]));
        }
        Mirror::Open {
            pond_available: false,
        } => return Some(json!([wait, drop])),
        Mirror::Shut {
            quest_accepted: true,
        } => {
            json!({"kind":"drop","actor":"vale","item":null,"target":null,
                "text":format!("{name} abandons their quest to hold the dark {lamp}."),
                "cards":[],"key":"drop:vale:::0","quest":0})
        }
        Mirror::Shut {
            quest_accepted: false,
        } => {
            json!({"kind":"accept","actor":"vale","item":null,"target":null,
                "text":format!("{name} accepts the closed box's quest."),
                "cards":[],"key":ACCEPT_POND,"box":"pond"})
        }
    };
    Some(json!([wait, drop, quest]))
}
