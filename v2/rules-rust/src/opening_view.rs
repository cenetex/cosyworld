use super::{opening, opening_play, opening_play::Mirror, opening_wait_response};
use serde_json::{json, Value};

pub fn create_response(world: Value, files: &Value, actor: &str) -> Option<Value> {
    let vale = world["actors"].get("vale")?;
    if actor != "vale"
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["revision"].as_u64() != Some(opening::unplayed_turn(&world)?)
        || vale["place"] != "attic"
        || vale["heldItem"] != "lamp"
        || vale.get("want") != Some(&Value::Null)
        || world["items"]["lamp"]["lit"] != true
        || !world["placeCard"]["attic"].is_null()
    {
        return None;
    }
    opening_play::attic_state(&world)?;
    opening_play::attic_content(files)?;
    if other_attic_content(files)? {
        return None;
    }
    opening_play::attic_response(
        opening::stored_response(world)?,
        files,
        Mirror::Shut {
            quest_accepted: false,
        },
    )
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let claimed = opening::seats(&request["claimed"])?;
    let present = opening::seats(&request["present"])?;
    if request["actor"] != "vale"
        || !claimed.contains(&"vale")
        || !present.iter().all(|id| claimed.contains(id))
    {
        return None;
    }
    let (world, can_sleep) = match opening::supported_world(request) {
        Some(world) => (world, false),
        None => (after_wait_world(request, &claimed)?, true),
    };
    if world["absent"]
        .as_array()
        .is_some_and(|ids| ids.iter().any(|id| id == "vale"))
        || !world["placeCard"]["attic"].is_null()
    {
        return None;
    }
    let mirror = attic_mirror(world, &present)?;
    let files = if can_sleep {
        opening_play::attic_content_files(request)?
    } else {
        opening_play::attic_files(world, request)?
    };
    if other_attic_content(&files)? {
        return None;
    }
    let projected = private_world(world, request)?;
    let response = json!({"ok":true,"world":projected});
    if can_sleep {
        opening_play::after_wait_response(response, &files, mirror)
    } else {
        opening_play::attic_response(response, &files, mirror)
    }
}

fn after_wait_world<'a>(request: &'a Value, claimed: &[&str]) -> Option<&'a Value> {
    let world = request.get("world")?;
    let turn = opening_wait_response::settled_first_wait(world)?;
    let revision = world["revision"].as_u64()?;
    let lamp = &world["items"]["lamp"];
    let fuel = super::lamp_state(lamp).ok()?;
    let held = world["actors"]["vale"].get("heldItem")?;
    let lit = held == "lamp" && fuel.fuel_rooms > 0;
    if !(turn..=opening::MAX_REVISION).contains(&revision)
        || world["opening"]["crossed"] != false
        || world["speechVoices"]["vale"] != json!(["vale"])
        || !claimed
            .iter()
            .all(|id| world["actors"][*id]["place"].is_string())
        || (held != "lamp" && !held.is_null())
        || fuel.fuel_place != "attic"
        || !fuel.fuel_visit
        || lamp["lit"] != lit
        || lamp["fuel"] != fuel.fuel_rooms * 4
    {
        return None;
    }
    Some(world)
}

pub(super) fn attic_mirror(world: &Value, present: &[&str]) -> Option<Mirror> {
    let quest = world["actors"]["vale"].get("want")?;
    if world["items"]["lamp"]["lit"] == true {
        let quest_accepted = *quest == opening_play::pond_quest(world);
        if !quest.is_null() && !quest_accepted {
            return None;
        }
        Some(Mirror::Shut { quest_accepted })
    } else {
        if !quest.is_null()
            || world["actors"]["vale"].get("heldItem") != Some(&Value::Null)
            || world["opened"]["pond"] != json!(["vale"])
        {
            return None;
        }
        Some(Mirror::Open {
            pond_available: !pond_at_capacity(world, present),
        })
    }
}

fn pond_at_capacity(world: &Value, present: &[&str]) -> bool {
    present.contains(&"vale")
        && present
            .iter()
            .filter(|&&id| world["actors"][id]["place"] == "pond")
            .count()
            >= 4
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

pub(super) fn other_attic_content(files: &Value) -> Option<bool> {
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
        || pack["places"].get("pond").is_some()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_response_keeps_saved_memories_and_drops_only_seat_context() {
        let content: Value = serde_json::from_str(include_str!(
            "../../orchestrator-rust/src/card_shared/content.json"
        ))
        .unwrap();
        let files = &content["files"];
        let mut saved_world = json!({
            "schema": 8, "sharedVersion": 1, "revision": 0, "turn": 0,
            "actors": {
                "vale": {"place": "attic", "heldItem": "lamp", "want": null},
                "mara": {"place": "station", "heldItem": null, "want": null}
            },
            "items": {"lamp": {"holder": "vale", "lit": true}},
            "doors": {}, "standoffs": [], "log": [], "usedUp": [],
            "memories": {"mara": {
                "events": [], "reflections": [], "learning": [],
                "subjects": {}, "innerLife": {"thoughts": ["A fresh memory."]}
            }}
        });
        let mut world = saved_world.clone();
        world["playerActorId"] = json!("vale");
        for field in ["heldActors", "controlledActors", "presentActors"] {
            world[field] = json!(["vale"]);
        }
        assert!(create_response(world.clone(), files, "mara").is_none());
        let response = create_response(world, files, "vale").unwrap();
        assert_eq!(response["world"], saved_world);
        assert_eq!(response["actor"], "vale");
        assert_eq!(response["room"], "attic");
        assert_eq!(response["exits"], json!([]));
        assert_eq!(
            response["actions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|action| action["key"].as_str().unwrap())
                .collect::<Vec<_>>(),
            [
                "wait:vale::",
                "drop:vale:lamp:attic",
                "accept:vale::box:pond"
            ]
        );
        saved_world["revision"] = json!(1);
        assert!(create_response(saved_world, files, "vale").is_none());
    }
}
