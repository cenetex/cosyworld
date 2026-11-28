use super::{
    lamp_state,
    opening::{seats, stored_response, unplayed_turn, MAX_REVISION},
    LampPosition,
};
use serde_json::{json, Map, Value};

const ACTOR: &str = "vale";
const HOME: &str = "attic";
const OPENING: &str = "Vale stands alone in Mirror attic, holding a lamp. Its light fills the room; the tall mirror shows only the attic.";

fn starting_memory() -> Value {
    let sight = |holder| json!({ "sight": { "seq": 1, "turn": 0, "place": HOME, "holder": holder, "company": [], "things": [] } });
    json!({
        "events": [{ "seq": 1, "turn": 0, "kind": "event", "text": format!("World: {OPENING}") }],
        "landmarks": [], "text": null, "turn": null, "seen": {},
        "subjects": { "attic": sight(None), "lamp": sight(Some(ACTOR)) }
    })
}

pub(super) fn reset(request: &Value) -> Option<Value> {
    let world = &request["world"];
    let actor = &world["actors"][ACTOR];
    let lamp = &world["items"]["lamp"];
    let turn = unplayed_turn(world)?;
    if request["actor"] != ACTOR
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["opening"]["crossed"] != false
        || !world["stationExitOrder"]
            .as_array()
            .is_some_and(Vec::is_empty)
        || !matches!(
            world["items"]["elysium-wayfinder"]["holder"].as_str(),
            Some("behind-station" | "pond" | "station" | "clearing")
        )
        || actor["place"] != HOME
        || world["log"][0]["text"] != OPENING
        || !matches!(lamp["holder"].as_str(), Some(ACTOR | HOME))
        || (actor["heldItem"] != "lamp" && !actor["heldItem"].is_null())
        || world["items"]
            .as_object()?
            .iter()
            .any(|(id, item)| id != "lamp" && item["holder"] == ACTOR)
    {
        return None;
    }
    let claimed = seats(&request["claimed"])?;
    let present = seats(&request["present"])?;
    if claimed.iter().any(|id| {
        world["actors"][id]["place"]
            .as_str()
            .is_none_or(|place| place == "station")
    }) || present.iter().any(|id| !claimed.contains(id))
    {
        return None;
    }
    let revision = world["revision"].as_u64()?;
    if revision < turn || revision >= MAX_REVISION {
        return None;
    }

    let trust: Map<_, _> = world["actors"]
        .as_object()?
        .keys()
        .filter(|id| id.as_str() != ACTOR)
        .map(|id| (id.clone(), json!(0)))
        .collect();
    let fuel = lamp_state(lamp).ok()?.settle(LampPosition {
        place: HOME.into(),
        held: false,
        grounded: true,
    });
    let mut world = world.clone();
    world["actors"][ACTOR] = json!({
        "place": HOME, "crossed": 0, "lastTalk": -9, "trust": trust, "want": null,
        "xp": 0, "visited": [HOME], "talked": [], "heldItem": null
    });
    for other in world["actors"].as_object_mut()?.values_mut() {
        if let Some(score) = other
            .get_mut("trust")
            .and_then(|trust| trust.get_mut(ACTOR))
        {
            *score = json!(0);
        }
    }
    let lamp = &mut world["items"]["lamp"];
    lamp["holder"] = json!(HOME);
    fuel.write(lamp);
    world["memories"]
        .as_object_mut()?
        .insert(ACTOR.into(), starting_memory());
    if let Some(life) = world
        .pointer_mut("/life/actors")
        .and_then(Value::as_object_mut)
    {
        life.insert(
            ACTOR.into(),
            json!({ "experiences": [], "attachments": {}, "company": {} }),
        );
    }
    if let Some(known) = world
        .pointer_mut("/knowledge/known")
        .and_then(Value::as_object_mut)
    {
        known.remove(ACTOR);
    }
    if let Some(pending) = world
        .pointer_mut("/knowledge/pending")
        .and_then(Value::as_array_mut)
    {
        pending.retain(|entry| entry["speaker"] != ACTOR && entry["listener"] != ACTOR);
    }
    if let Some(met) = world
        .pointer_mut("/hidden/met")
        .and_then(Value::as_array_mut)
    {
        met.retain(|id| id != ACTOR);
    }
    if let Some(grievances) = world.pointer_mut("/motives/grievances/vale") {
        *grievances = json!([]);
    }
    for field in ["routeKnowledge", "invitedPlaces", "defeats"] {
        if let Some(entries) = world.get_mut(field).and_then(Value::as_object_mut) {
            entries.remove(ACTOR);
        }
    }
    world["conversations"].as_array_mut()?.retain(|entry| {
        entry["actors"]
            .as_array()
            .is_none_or(|actors| !actors.iter().any(|id| id == ACTOR))
    });
    world["standoffs"]
        .as_array_mut()?
        .retain(|entry| entry["challenger"] != ACTOR && entry["defender"] != ACTOR);
    world["peaceUntil"]
        .as_object_mut()?
        .insert(ACTOR.into(), json!(0));
    world["revision"] = json!(revision + 1);

    stored_response(world)
}
