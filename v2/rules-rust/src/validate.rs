use super::opening::{is_seat, seats};
use serde_json::{json, Value};

const LEGACY_SAVE: &str = "This save needs a fresh start.";
const BROKEN_SAVE: &str =
    "This save needs a fresh start. Your previous save is kept until you choose New game.";
const INVALID_SEATS: &str = "Choose valid human avatars.";

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let world = &request["world"];
    if !(world.is_object() || world.is_array()) {
        return refused("Load a saved world first.");
    }
    if let Err(error) = validate_context(request, world) {
        return refused(error);
    }
    load_header(request, world)?.err().and_then(refused)
}

pub(super) fn import_refusal(request: &Value) -> Option<Value> {
    let save = request.get("save").filter(|save| !save.is_null())?;
    let mut world = match save {
        Value::String(text) => serde_json::from_str(text).ok()?,
        other => other.clone(),
    };
    let Some(fields) = world.as_object_mut() else {
        return refused("Choose a saved world.");
    };
    for field in [
        "sharedMigration",
        "playerActorId",
        "controlledActors",
        "presentActors",
        "heldActors",
        "claimed",
        "present",
    ] {
        fields.remove(field);
    }
    load_header(request, &world)?.err().and_then(refused)
}

fn load_header(request: &Value, world: &Value) -> Option<Result<(), &'static str>> {
    if !valid_lamp(request, &world["items"]["lamp"])? {
        return Some(Err("Invalid saved lamp room fuel."));
    }
    if integer(&world["schema"]) != Some(8) {
        return Some(Err(LEGACY_SAVE));
    }
    if world.as_object()?.keys().all(|field| {
        matches!(
            field.as_str(),
            "schema"
                | "turn"
                | "revision"
                | "playerActorId"
                | "controlledActors"
                | "presentActors"
                | "heldActors"
        )
    }) {
        return Some(Err(BROKEN_SAVE));
    }
    Some(Ok(()))
}

fn refused(error: &str) -> Option<Value> {
    Some(json!({"ok": false, "error": error}))
}

fn validate_context(request: &Value, world: &Value) -> Result<(), &'static str> {
    let actor = &request["actor"];
    if truthy(actor) && !actor.as_str().is_some_and(is_seat) {
        return Err("Choose a human avatar.");
    }
    let saved_seats = |field: &str| world.get(field).filter(|value| truthy(value));
    let claimed = match request
        .get("claimed")
        .or_else(|| saved_seats("controlledActors"))
    {
        Some(value) => seats(value).ok_or(INVALID_SEATS)?,
        None => vec!["vale"],
    };
    let present = match request
        .get("present")
        .or_else(|| saved_seats("presentActors"))
    {
        Some(value) => seats(value).ok_or(INVALID_SEATS)?,
        None => claimed.clone(),
    };
    if present.iter().any(|id| !claimed.contains(id)) {
        return Err("A present avatar needs a claim.");
    }
    Ok(())
}

fn integer(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| {
        let decimal = value.as_number()?.to_string();
        if decimal == "-0.0" {
            return Some(0);
        }
        decimal.strip_suffix(".0")?.parse().ok()
    })
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(value) => !value.is_empty(),
        Value::Number(_) => integer(value) != Some(0),
        _ => true,
    }
}

fn valid_lamp(request: &Value, lamp: &Value) -> Option<bool> {
    let Some(fields) = lamp.as_object() else {
        return Some(true);
    };
    let room_fuel = ["fuelRooms", "fuelPlace", "fuelVisit"]
        .iter()
        .any(|field| fields.contains_key(*field));
    if (room_fuel || fields.contains_key("lit")) && !lamp["lit"].is_boolean() {
        return Some(false);
    }
    if !room_fuel {
        return Some(true);
    }
    let Some(rooms) = integer(&lamp["fuelRooms"]).filter(|rooms| *rooms <= 3) else {
        return Some(false);
    };
    let Some(place) = lamp["fuelPlace"].as_str().filter(|place| !place.is_empty()) else {
        return Some(false);
    };
    if !lamp["fuelVisit"].is_boolean() || integer(&lamp["fuel"]) != Some(rooms * 4) {
        return Some(false);
    }
    known_place(request, place)
}

fn known_place(request: &Value, place: &str) -> Option<bool> {
    let content = super::opening_content::files(request)?;
    let files = content.as_object()?;
    let forest = files.get("v2/card-game/forest.json")?["places"].as_object()?;
    let boardy = files.get("v2/card-game/boardyai.json")?["places"].as_object()?;
    let packs = files.get("v2/card-game/packs.json")?["packs"].as_array()?;
    let cast = files.get("v2/card-game/shared-cast.json")?["avatars"].as_array()?;
    let mut known = forest.contains_key(place) || boardy.contains_key(place);
    for pack in packs {
        known |= pack["places"].as_object()?.contains_key(place);
    }
    Some(
        known
            || cast
                .iter()
                .any(|avatar| avatar["id"] != "vale" && avatar["home"]["id"] == place),
    )
}
