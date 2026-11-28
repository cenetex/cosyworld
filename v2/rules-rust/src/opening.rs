use super::{
    lamp_state, opening_content, opening_play, opening_second_attic_tail, opening_take_response,
    opening_wait_response, pack_state::Catalog, Geography, Lamp, LampPosition,
};
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

struct Opening {
    lamp: Lamp,
    held: bool,
    grounded: bool,
    revision: u64,
    station: Option<Vec<&'static str>>,
}

impl Opening {
    fn supported(request: &Value) -> Option<(&Value, Self)> {
        let world = &request["world"];
        let actor = request["actor"].as_str()?;
        let claimed = seats(&request["claimed"])?;
        let present = seats(&request["present"])?;
        Some((world, Self::with_seats(world, actor, &claimed, &present)?))
    }

    fn with_seats(world: &Value, actor: &str, claimed: &[&str], present: &[&str]) -> Option<Self> {
        Self::at_turn(
            world,
            actor,
            claimed,
            present,
            unplayed_turn(world)?,
            Some(station_order(world)?),
        )
    }

    fn after_quiet_play(request: &Value) -> Option<(&Value, Self)> {
        let world = request.get("world")?;
        let turn = world["turn"].as_u64()?;
        let claimed = seats(&request["claimed"])?;
        let present = seats(&request["present"])?;
        if request["actor"] != "vale"
            || claimed != ["vale"]
            || !present.iter().all(|id| claimed.contains(id))
            || ["disabledPacks", "gone", "hidden", "absent", "homecoming"]
                .iter()
                .any(|key| !world[*key].is_null())
            || world["actors"]
                .as_object()?
                .values()
                .any(|actor| !actor["sleeping"].is_null() && actor["sleeping"]["until"].is_null())
            || !(opening_wait_response::settled_first_wait(world) == Some(turn)
                || opening_wait_response::settled_second_wait(world).is_some()
                || opening_take_response::lamp_take_committed(world).is_some())
        {
            return None;
        }
        opening_second_attic_tail::no_box_release(world)?;
        let (files, _) = opening_content::wait_files(request)?;
        opening_play::attic_content(&files)?;
        let catalog = Catalog::from_files(&files)?;
        let geo = Geography::new(&files, catalog.packs())?;
        opening_second_attic_tail::verify_station_order(world, &geo)?;
        let opening = Self::at_turn(world, "vale", &claimed, &present, turn, None)?;
        Some((world, opening))
    }

    fn at_turn(
        world: &Value,
        actor: &str,
        claimed: &[&str],
        present: &[&str],
        turn: u64,
        station: Option<Vec<&'static str>>,
    ) -> Option<Self> {
        let actors = world["actors"].as_object()?;
        let items = world["items"].as_object()?;
        let vale = actors.get("vale")?;
        let saved_lamp = items.get("lamp")?;
        let lamp = lamp_state(saved_lamp).ok()?;
        let grounded = saved_lamp["holder"] == "attic";
        let revision = world["revision"].as_u64().filter(|n| *n <= MAX_REVISION)?;
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
            lamp,
            held,
            grounded,
            revision,
            station,
        })
    }

    fn settle(self, mut world: Value, held: bool) -> Value {
        self.lamp
            .settle(LampPosition {
                place: "attic".into(),
                held,
                grounded: self.grounded,
            })
            .write(&mut world["items"]["lamp"]);
        if let Some(station) = self.station {
            world["stationExitOrder"] = json!(station);
        }
        world
    }

    fn respond(self, world: Value, held: bool) -> Option<Value> {
        stored_response(self.settle(world, held))
    }
}

pub(super) fn station_order(world: &Value) -> Option<Vec<&'static str>> {
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

pub(super) fn stored_world(mut world: Value) -> Option<Value> {
    let fields = world.as_object_mut()?;
    for transient in [
        "playerActorId",
        "controlledActors",
        "presentActors",
        "heldActors",
    ] {
        fields.remove(transient);
    }
    Some(world)
}

pub(super) fn stored_response(world: Value) -> Option<Value> {
    let mut response = serde_json::Map::new();
    response.insert("ok".into(), Value::Bool(true));
    response.insert("world".into(), stored_world(world)?);
    Some(Value::Object(response))
}

pub(super) fn presence(request: &Value) -> Option<Value> {
    let (world, opening) =
        Opening::supported(request).or_else(|| Opening::after_quiet_play(request))?;
    let held = opening.held;
    opening.respond(world.clone(), held)
}

pub(super) fn join_state(request: &Value) -> Option<Value> {
    let (world, opening) = Opening::supported(request)?;
    let mut world = world.clone();
    super::join::apply(&mut world, request["actor"].as_str()?, &request["progress"])?;
    let held = opening.held;
    opening.respond(world, held)
}

pub(super) fn supported_world(request: &Value) -> Option<&Value> {
    Some(Opening::supported(request)?.0)
}

pub(super) fn supported_after_first_turn(request: &Value) -> Option<&Value> {
    let world = request.get("world")?;
    if world["turn"] != 1 || world.get("began").is_some_and(|began| began != 0) {
        return None;
    }
    Opening::at_turn(
        world,
        request["actor"].as_str()?,
        &seats(&request["claimed"])?,
        &seats(&request["present"])?,
        1,
        None,
    )?;
    Some(world)
}

pub(super) fn hold(request: &Value) -> Option<Value> {
    let actor = request["actor"].as_str()?;
    let present = request["present"].as_array()?;
    if !present.iter().any(|id| id == actor) {
        return None;
    }
    let choice = request["choice"].as_object()?;
    if choice.len() != 2
        || choice.get("revision")?.as_u64()? != request["world"]["revision"].as_u64()?
    {
        return None;
    }
    let item = choice.get("item")?;
    let (world, opening) =
        Opening::supported(request).or_else(|| Opening::after_quiet_play(request))?;
    let hold = Hold::planned(world, opening, actor, item)?;
    stored_response(hold.apply(world.clone(), actor, item))
}

pub(super) fn hold_solo_vale(world: Value, item: &Value) -> Option<Value> {
    let opening = Opening::with_seats(&world, "vale", &["vale"], &["vale"])?;
    let hold = Hold::planned(&world, opening, "vale", item)?;
    Some(hold.apply(world, "vale", item))
}

struct Hold {
    opening: Opening,
    held: bool,
    opens_pond: bool,
}

impl Hold {
    fn planned(world: &Value, opening: Opening, actor: &str, item: &Value) -> Option<Self> {
        if opening.revision == MAX_REVISION
            || world["actors"]["vale"]["visited"] != json!(["attic"])
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
        let held = if actor == "vale" && !opening.grounded {
            holds_lamp(item)?
        } else if item.is_null() && world["actors"][actor].get("heldItem") == Some(item) {
            opening.held
        } else {
            return None;
        };
        let opens_pond =
            opening.held && !held && opening.lamp.fuel_rooms > 0 && world.get("opened").is_none();
        Some(Self {
            opening,
            held,
            opens_pond,
        })
    }

    fn apply(self, mut world: Value, actor: &str, item: &Value) -> Value {
        if self.opens_pond {
            world["opened"] = json!({"pond": ["vale"]});
        }
        world["actors"][actor]["heldItem"] = item.clone();
        world["revision"] = json!(self.opening.revision + 1);
        self.opening.settle(world, self.held)
    }
}
