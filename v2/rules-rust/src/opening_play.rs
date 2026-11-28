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
        Some("wait:vale::") if actor == "vale" => super::opening_full_wait::reduce(request),
        Some(super::opening_drop::DROP) if actor == "vale" => {
            super::opening_full_wait::reduce_drop(request)
        }
        Some("move:vale::pond" | "move:vale:lamp:pond") if actor == "vale" => {
            super::opening_full_move::reduce(request)
        }
        Some(_) => None,
    }
}

pub(super) fn second_attic_plays(world: &Value) -> Option<(&Value, &Value)> {
    if world["turn"] != 2
        || world.get("began").is_some_and(|began| began != 0)
        || world["sharedVersion"] != 1
        || world["actors"]["vale"]["place"] != "attic"
        || world["actors"]["vale"].get("want") != Some(&Value::Null)
        || world["heldActors"] != json!(["vale"])
        || world["controlledActors"] != json!(["vale"])
        || world["presentActors"] != json!(["vale"])
        || world["playerActorId"] != "vale"
        || !world["elysiumEncounters"].is_null()
        || !world["hidden"].is_null()
        || !world["absent"].is_null()
        || !world["gone"].is_null()
    {
        return None;
    }
    let mut plays = world["log"].as_array()?.iter().filter(|event| {
        event["actorId"] == "vale" && event["kind"] == "action" && event["generated"] != true
    });
    let first = plays.next()?;
    let second = plays.next()?;
    (first["turn"] == 1
        && second["turn"] == 2
        && first["locationId"] == "attic"
        && second["locationId"] == "attic"
        && matches!(
            (first["verb"].as_str(), second["verb"].as_str()),
            (Some("wait"), Some("wait")) | (Some("drop"), Some("take"))
        )
        && plays.next().is_none())
    .then_some((first, second))
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
    attic_content_files(request)
}

pub(super) fn attic_content_files(request: &Value) -> Option<Value> {
    let mut content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let files = content.as_object_mut()?.remove("files")?;
    attic_content(&files)?;
    Some(files)
}

pub(super) fn attic_state(world: &Value) -> Option<()> {
    quiet_attic(world)?;
    (!world["log"].as_array()?.iter().any(|entry| {
        entry["kind"] == "action" && entry["actorId"] == "vale" && entry["generated"] != true
    }))
    .then_some(())
}

pub(super) fn quiet_attic(world: &Value) -> Option<()> {
    if world["items"]["lamp"]["holder"] != "vale" {
        return None;
    }
    quiet_attic_scene(world)
}

pub(super) fn quiet_attic_scene(world: &Value) -> Option<()> {
    let vale = world["actors"]["vale"].as_object()?;
    if ["arcana", "closed", "sleeping", "under"]
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
    let grounded = response["world"]["items"]["lamp"]["holder"] == "attic";
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
    response["actions"] = actions(&files["v2/card-game/forest.json"], mirror, grounded)?;
    response["profiles"] = profiles::project(files)?;
    Some(response)
}

pub(super) fn after_wait_response(response: Value, files: &Value, mirror: Mirror) -> Option<Value> {
    let mut response = attic_response(response, files, mirror)?;
    let name = files["v2/card-game/forest.json"]["people"]["vale"]["name"].as_str()?;
    response["actions"].as_array_mut()?.insert(
        1,
        json!({
            "kind":"wait", "actor":"vale", "item":null, "target":null,
            "text":format!("{name} sleeps."), "cards":[],
            "key":"sleep:vale::", "label":"Sleep", "sleep":true
        }),
    );
    Some(response)
}

pub(super) fn attic_stairs_requirements() -> Value {
    json!([
        {"kind":"light", "item":"lamp", "at":["attic"], "uncovered":true},
        {"kind":"any", "conditions":[
            {"kind":"item_present", "item":"cloth", "place":"attic"},
            {"kind":"tag_held", "tag":"scarf", "place":"attic"}
        ]}
    ])
}

fn packs_add_attic_actions(files: &Value) -> Option<bool> {
    let packs = files["v2/card-game/packs.json"]["packs"].as_array()?;
    let boardy = files.get("v2/card-game/boardyai.json")?;
    let cottage_conditions = attic_stairs_requirements();
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

fn actions(forest: &Value, mirror: Mirror, grounded: bool) -> Option<Value> {
    let name = forest["people"]["vale"]["name"].as_str()?;
    let lamp = forest["things"]["lamp"]["name"].as_str()?;
    let attic = forest["places"]["attic"]["name"].as_str()?;
    let wait = json!({"kind":"wait","actor":"vale","item":null,"target":null,
        "text":format!("{name} waits one turn."),"cards":[],"key":"wait:vale::"});
    let lamp_action = if grounded {
        json!({"kind":"take","actor":"vale","item":"lamp","target":null,
            "text":format!("{name} takes the {lamp}."),"cards":["lamp"],"key":"take:vale:lamp:"})
    } else {
        json!({"kind":"drop","actor":"vale","item":"lamp","target":"attic",
            "text":format!("{name} puts the {lamp} in {attic}."),
            "cards":["lamp"],"key":"drop:vale:lamp:attic"})
    };
    let quest = match mirror {
        Mirror::Open {
            pond_available: true,
        } => {
            let pond = forest["places"]["pond"]["name"].as_str()?;
            let mut actions = vec![
                wait,
                json!({"kind":"move","actor":"vale","item":null,"target":"pond",
                    "text":format!("{name} goes to {pond} through the reflection."),
                    "cards":["pond"],"key":"move:vale::pond"}),
            ];
            if !grounded {
                actions.push(
                    json!({"kind":"move","actor":"vale","item":"lamp","target":"pond",
                    "text":format!("{name} carries the {lamp} to {pond} through the reflection."),
                    "cards":["lamp","pond"],"key":"move:vale:lamp:pond"}),
                );
            }
            actions.push(lamp_action);
            return Some(json!(actions));
        }
        Mirror::Open {
            pond_available: false,
        } => return Some(json!([wait, lamp_action])),
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
    Some(json!([wait, lamp_action, quest]))
}
