use super::opening::{self, is_seat, seats};
use super::opening_content;
use serde_json::{json, Value};
use std::cell::OnceCell;

const LEGACY_SAVE: &str = "This save needs a fresh start.";
const BROKEN_SAVE: &str =
    "This save needs a fresh start. Your previous save is kept until you choose New game.";
const INVALID_SEATS: &str = "Choose valid human avatars.";

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let world = &request["world"];
    if !(world.is_object() || world.is_array()) {
        return refused("Load a saved world first.");
    }
    let solo_vale = match validate_context(request, world) {
        Ok(solo_vale) => solo_vale,
        Err(error) => return refused(error),
    };
    let files = OnceCell::new();
    let files = || {
        files
            .get_or_init(|| opening_content::files(request))
            .as_ref()
    };
    if let Err(error) = load_header(world, files)? {
        return refused(error);
    }
    if !solo_vale {
        return None;
    }
    opening::stored_response(verified_opening(world, files()?)?)
}

pub(super) fn import(request: &Value) -> Option<Value> {
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
    let files = OnceCell::new();
    let files = || {
        files
            .get_or_init(|| opening_content::files(request))
            .as_ref()
    };
    if let Err(error) = load_header(&world, files)? {
        return refused(error);
    }
    let actor = &request["actor"];
    if (truthy(actor) && actor != "vale")
        || (world.get("run").is_none() && !request["seed"].is_null())
        || world["revision"].as_u64() != Some(opening::unplayed_turn(&world)?)
    {
        return None;
    }
    for actor in world["actors"].as_object_mut()?.values_mut() {
        actor.as_object_mut()?.remove("upgrades");
    }
    let files = files()?;
    let world = verified_opening(&world, files)?;
    if !super::elysium::import_preserves_state(&world)? {
        return None;
    }
    super::opening_view::create_response(world, files, "vale")
}

fn load_header<'a>(
    world: &Value,
    files: impl FnOnce() -> Option<&'a Value>,
) -> Option<Result<(), &'static str>> {
    if !valid_lamp(&world["items"]["lamp"], files)? {
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

fn validate_context(request: &Value, world: &Value) -> Result<bool, &'static str> {
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
    Ok((!truthy(actor) || actor == "vale") && claimed == ["vale"] && present == ["vale"])
}

fn verified_opening(saved: &Value, files: &Value) -> Option<Value> {
    opening::unplayed_turn(saved)?;
    let seed = if saved.get("run").is_some() {
        Some(super::seed::run_seed(saved)?)
    } else {
        None
    };
    let created = super::create::fresh(files, seed, saved.get("began").is_some())?;
    let initial = opening::stored_world(created)?;
    let steps = saved["revision"]
        .as_u64()?
        .checked_sub(initial["revision"].as_u64()?)?;
    let held = &saved["actors"]["vale"]["heldItem"];
    let rebuilt = match steps {
        0 => initial,
        1 => opening::hold_solo_vale(initial, held)?,
        2 if initial["actors"]["vale"]["heldItem"] == "lamp" => {
            // Stowing the lit lamp can add this marker, and a quiet hold never removes it.
            let first = if initial.get("opened") == saved.get("opened") {
                json!("lamp")
            } else {
                Value::Null
            };
            opening::hold_solo_vale(opening::hold_solo_vale(initial, &first)?, held)?
        }
        _ => return None,
    };
    (rebuilt == *saved).then_some(rebuilt)
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

fn valid_lamp<'a>(lamp: &Value, files: impl FnOnce() -> Option<&'a Value>) -> Option<bool> {
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
    known_place(files()?, place)
}

fn known_place(files: &Value, place: &str) -> Option<bool> {
    let files = files.as_object()?;
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
