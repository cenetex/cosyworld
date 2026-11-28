use super::{opening, opening_play};
use serde_json::{json, Value};

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let world = opening::supported_world(request)?;
    if request["actor"] != "vale"
        || !request["claimed"].as_array()?.iter().any(|id| id == "vale")
        || world["absent"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == "vale"))
        || !world["placeCard"]["attic"].is_null()
    {
        return None;
    }
    let quest = world["actors"]["vale"].get("want")?;
    let quest_accepted = if quest.is_null() {
        false
    } else if *quest == opening_play::pond_quest(world) {
        true
    } else {
        return None;
    };
    let files = opening_play::attic_files(world, request)?;
    if other_attic_content(&files)? {
        return None;
    }
    let projected = private_world(world, request)?;
    opening_play::attic_response(json!({"ok":true,"world":projected}), &files, quest_accepted)
}

fn private_world(world: &Value, request: &Value) -> Option<Value> {
    let mut world = world.clone();
    let memories = world["memories"].as_object_mut()?;
    if !memories.get("vale")?.get("subjects")?.is_object() {
        return None;
    }
    for (id, memory) in memories {
        if id == "vale" {
            continue;
        }
        let memory = memory.as_object_mut()?;
        for field in ["innerLife", "reflections", "learning", "subjects"] {
            memory.remove(field);
        }
    }
    world["playerActorId"] = request["actor"].clone();
    world["heldActors"] = request["claimed"].clone();
    world["controlledActors"] = request["present"].clone();
    world["presentActors"] = request["present"].clone();
    Some(world)
}

fn other_attic_content(files: &Value) -> Option<bool> {
    let forest = &files["v2/card-game/forest.json"];
    let packs = files["v2/card-game/packs.json"]["packs"].as_array()?;
    let specials = files.get("v2/card-game/boardyai.json")?;
    let guardable = files["v2/card-game/world-life.json"]["guardable"].as_array()?;
    Some(
        forest["things"]["lamp"]["name"] != "Lamp"
            || forest["things"]
                .as_object()?
                .values()
                .any(|item| item["holder"] == "attic")
            || guardable
                .iter()
                .any(|way| way["from"] == "attic" || way["to"] == "attic")
            || packs.iter().chain([specials]).any(pack_adds_attic_cards),
    )
}

fn pack_adds_attic_cards(pack: &Value) -> bool {
    pack["places"].get("attic").is_some()
        || pack["avatars"].get("vale").is_some()
        || pack["items"].get("lamp").is_some()
        || pack["avatars"]
            .as_object()
            .is_some_and(|avatars| avatars.values().any(|a| a["sealed"]["at"] == "attic"))
        || pack["items"].as_object().is_some_and(|items| {
            items.values().any(|item| {
                item["holder"] == "attic" || (item["home"] == "attic" && item["locked"].is_object())
            })
        })
        || pack["transports"].as_object().is_some_and(|transports| {
            transports.values().any(|transport| {
                transport["docks"]
                    .as_array()
                    .is_some_and(|docks| docks.iter().any(|dock| dock == "attic"))
            })
        })
}
