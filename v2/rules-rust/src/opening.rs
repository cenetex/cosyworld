use super::{lamp_state, Lamp, LampPosition};
use serde_json::{json, Value};

pub(super) const MAX_REVISION: u64 = 9_007_199_254_740_991;
const SEATS: [&str; 8] = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];

pub(super) fn is_seat(id: &str) -> bool {
    SEATS.contains(&id)
}

pub(super) fn seats(value: &Value) -> Option<Vec<&str>> {
    let ids = value.as_array()?;
    let mut valid = Vec::with_capacity(SEATS.len());
    for id in ids {
        let id = id.as_str()?;
        if !is_seat(id) || valid.contains(&id) {
            return None;
        }
        valid.push(id);
    }
    Some(valid)
}

pub(super) fn unplayed_turn(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    (turn == began).then_some(turn)
}

struct Opening<'a> {
    world: &'a Value,
    lamp: Lamp,
    held: bool,
    grounded: bool,
    revision: u64,
    station: Vec<&'static str>,
}

impl<'a> Opening<'a> {
    fn supported(request: &'a Value) -> Option<Self> {
        let world = &request["world"];
        let actor = request["actor"].as_str()?;
        let claimed = seats(&request["claimed"])?;
        let present = seats(&request["present"])?;
        let actors = world["actors"].as_object()?;
        let items = world["items"].as_object()?;
        let vale = actors.get("vale")?;
        let saved_lamp = items.get("lamp")?;
        let lamp = lamp_state(saved_lamp).ok()?;
        let grounded = saved_lamp["holder"] == "attic";
        let revision = world["revision"].as_u64().filter(|n| *n <= MAX_REVISION)?;
        let turn = unplayed_turn(world)?;
        let held = holds_lamp(vale.get("heldItem")?)?;
        let away_from_station = |id: &str| {
            actors
                .get(id)
                .and_then(|actor| actor["place"].as_str())
                .is_some_and(|place| place != "station")
        };
        if world["schema"] != 8
            || world["sharedVersion"] != 1
            || revision < turn
            || (turn == 0 && world["eventSeq"] != 2)
            || world["opening"]["crossed"] != false
            || !matches!(
                items.get("elysium-wayfinder")?["holder"].as_str(),
                Some("pond" | "station" | "behind-station" | "clearing")
            )
            || (!grounded && saved_lamp["holder"] != "vale")
            || (grounded && held)
            || vale["place"] != "attic"
            || lamp.fuel_place != "attic"
            || !lamp.fuel_visit
            || saved_lamp["fuel"] != lamp.fuel_rooms * 4
            || saved_lamp["lit"] != ((held || grounded) && lamp.fuel_rooms > 0)
            || !is_seat(actor)
            || !away_from_station(actor)
            || !claimed.iter().all(|id| away_from_station(id))
            || !present.iter().all(|id| claimed.contains(id))
        {
            return None;
        }
        Some(Self {
            world,
            lamp,
            held,
            grounded,
            revision,
            station: station_order(world)?,
        })
    }

    fn respond(self, mut world: Value, held: bool) -> Option<Value> {
        self.lamp
            .settle(LampPosition {
                place: "attic".into(),
                held,
                grounded: self.grounded,
            })
            .write(&mut world["items"]["lamp"]);
        world["stationExitOrder"] = json!(self.station);
        stored_response(world)
    }
}

fn station_order(world: &Value) -> Option<Vec<&'static str>> {
    let saved = world["stationExitOrder"].as_array()?;
    let used_up = world["usedUp"].as_array()?;
    let steps = [
        ("routes", "train", "behind-station"),
        ("board", "pavilion", "clearing"),
    ];
    let mut eligible = Vec::new();
    for (item, destination, alternate) in steps {
        match world["items"][item]["holder"].as_str()? {
            "station" => {
                if world["doors"][destination] == "station" && !used_up.iter().any(|id| id == item)
                {
                    eligible.push(destination);
                }
            }
            place if place == destination || place == alternate => {}
            _ => return None,
        }
    }
    let mut settled = Vec::new();
    for (index, id) in saved.iter().enumerate() {
        if saved[..index].contains(id) {
            return None;
        }
        let named = steps.iter().find(|(_, place, _)| id == *place)?.1;
        if eligible.contains(&named) {
            settled.push(named);
        }
    }
    for place in eligible {
        if !settled.contains(&place) {
            settled.push(place);
        }
    }
    Some(settled)
}

fn holds_lamp(item: &Value) -> Option<bool> {
    match item {
        Value::Null => Some(false),
        value if value == "lamp" => Some(true),
        _ => None,
    }
}

pub(super) fn stored_response(mut world: Value) -> Option<Value> {
    let world = world.as_object_mut()?;
    for transient in [
        "playerActorId",
        "controlledActors",
        "presentActors",
        "heldActors",
    ] {
        world.remove(transient);
    }
    Some(json!({"ok": true, "world": world}))
}

pub(super) fn presence(request: &Value) -> Option<Value> {
    let opening = Opening::supported(request)?;
    let held = opening.held;
    let world = opening.world.clone();
    opening.respond(world, held)
}

pub(super) fn join_state(request: &Value) -> Option<Value> {
    let opening = Opening::supported(request)?;
    let mut world = opening.world.clone();
    super::join::apply(&mut world, request["actor"].as_str()?, &request["progress"])?;
    let held = opening.held;
    opening.respond(world, held)
}

pub(super) fn supported_world(request: &Value) -> Option<&Value> {
    Some(Opening::supported(request)?.world)
}

pub(super) fn hold(request: &Value) -> Option<Value> {
    let present = request["present"].as_array()?;
    if request["actor"] != "vale" || !present.iter().any(|id| id == "vale") {
        return None;
    }
    let opening = Opening::supported(request)?;
    let choice = request["choice"].as_object()?;
    if opening.grounded
        || choice.len() != 2
        || choice.get("revision")?.as_u64()? != opening.revision
        || opening.revision == MAX_REVISION
    {
        return None;
    }
    let item = choice.get("item")?;
    let held = holds_lamp(item)?;
    let world = opening.world;
    if world["actors"]["vale"]["visited"] != json!(["attic"])
        || world["items"]["oil"]["holder"] != "keeper"
        || world["items"]
            .as_object()?
            .values()
            .any(|item| item["holder"] == "lamp")
        || world["actors"]
            .as_object()?
            .values()
            .any(|actor| actor.get("arcana").is_some())
        || world
            .get("opened")
            .is_some_and(|opened| *opened != json!({"pond": ["vale"]}))
    {
        return None;
    }
    let mut next = world.clone();
    if opening.held && !held && opening.lamp.fuel_rooms > 0 && world.get("opened").is_none() {
        next["opened"] = json!({"pond": ["vale"]});
    }
    next["actors"]["vale"]["heldItem"] = item.clone();
    next["revision"] = json!(opening.revision + 1);
    opening.respond(next, held)
}
