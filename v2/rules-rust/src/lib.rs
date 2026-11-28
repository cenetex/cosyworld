#![forbid(unsafe_code)]
#![deny(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::float_arithmetic
)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod create;
mod create_geography;
mod elysium;
mod initial_wants;
mod join;
mod opening;
mod opening_candidates;
mod opening_content;
pub mod opening_evidence;
pub mod opening_history;
mod opening_pickups;
mod opening_play;
mod opening_reflection;
mod opening_roaming;
mod opening_roster;
pub mod opening_rumours;
mod opening_settlement;
mod opening_speech;
mod opening_view;
mod opening_visitor_routes;
mod opening_wait;
mod opening_wait_response;
mod pack_state;
mod profiles;
mod reset;
pub mod resident_evidence;
mod seed;
mod seed_arrivals;
mod seed_packs;
mod seed_scatter;
mod seed_wayfinder;
mod validate;

pub use create_geography::Geography;
pub use opening_view::create_response;
pub use opening_wait_response::completed_wait_response;

pub const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_WIRE_BYTES: usize = 3 * MAX_JSON_BYTES + 64;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Lamp {
    fuel_rooms: u8,
    fuel_place: String,
    fuel_visit: bool,
    #[serde(skip_deserializing)]
    lit: bool,
}

#[derive(Deserialize)]
struct LampPosition {
    place: String,
    #[serde(default)]
    held: bool,
    #[serde(default)]
    grounded: bool,
}

impl Lamp {
    fn settle(self, position: LampPosition) -> Self {
        let burns = position.held || position.grounded;
        let counted = self.fuel_place == position.place && self.fuel_visit;
        let spent = burns && !counted && self.fuel_rooms > 0;
        let fuel_rooms = self.fuel_rooms - u8::from(spent);
        Self {
            fuel_rooms,
            fuel_place: position.place,
            fuel_visit: counted || spent,
            lit: burns && fuel_rooms > 0,
        }
    }

    fn write(self, lamp: &mut Value) {
        lamp["fuel"] = json!(self.fuel_rooms * 4);
        lamp["fuelRooms"] = json!(self.fuel_rooms);
        lamp["fuelPlace"] = json!(self.fuel_place);
        lamp["fuelVisit"] = json!(self.fuel_visit);
        lamp["lit"] = json!(self.lit);
    }
}

fn lamp_state(value: &Value) -> Result<Lamp, &'static str> {
    let lamp = Lamp::deserialize(value).map_err(|_| "Invalid lamp room fuel.")?;
    if lamp.fuel_rooms > 3 || lamp.fuel_place.is_empty() {
        return Err("Invalid lamp room fuel.");
    }
    Ok(lamp)
}

fn settle_lamp(request: &Value) -> Result<Lamp, &'static str> {
    let lamp = lamp_state(&request["lamp"])?;
    if request["position"]["place"]
        .as_str()
        .is_none_or(str::is_empty)
    {
        return Err("Choose a lamp location.");
    }
    let position = LampPosition::deserialize(&request["position"])
        .map_err(|_| "Choose one physical lamp position.")?;
    if position.held && position.grounded {
        return Err("Choose one physical lamp position.");
    }
    Ok(lamp.settle(position))
}

pub fn reduce(request: &Value) -> Value {
    match request["op"].as_str() {
        Some("settle_lamp") => match settle_lamp(request) {
            Ok(lamp) => json!({"ok": true, "lamp": lamp}),
            Err(error) => json!({"ok": false, "error": error}),
        },
        Some("presence") => opening::presence(request).unwrap_or(Value::Null),
        Some("hold") => opening::hold(request).unwrap_or(Value::Null),
        Some("seed_doors") => seed::door_projection(request).unwrap_or(Value::Null),
        Some("seed_specials") => seed::specials_projection(request).unwrap_or(Value::Null),
        Some("seed_opening") => seed::opening_projection(request).unwrap_or(Value::Null),
        Some("seed_arrivals") => seed_arrivals::projection(request).unwrap_or(Value::Null),
        Some("visitor_reach") => opening_visitor_routes::projection(request).unwrap_or(Value::Null),
        Some("play") => opening_play::reduce(request).unwrap_or(Value::Null),
        Some("opening_wait_step") => opening_wait::projection(request).unwrap_or(Value::Null),
        Some("opening_wait_roster") => opening_roster::projection(request).unwrap_or(Value::Null),
        Some("opening_bard_move") => opening_roaming::projection(request).unwrap_or(Value::Null),
        Some("opening_wait_settlement") => {
            opening_settlement::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_pickups") => opening_pickups::projection(request).unwrap_or(Value::Null),
        Some("view") => opening_view::reduce(request).unwrap_or(Value::Null),
        Some("reset") => reset::reset(request).unwrap_or(Value::Null),
        Some("reflect") => opening_reflection::reduce(request).unwrap_or(Value::Null),
        Some("join_state") => opening::join_state(request).unwrap_or(Value::Null),
        Some("mount_packs") => pack_state::reduce(request).unwrap_or(Value::Null),
        Some("speech") => opening_speech::reduce(request).unwrap_or(Value::Null),
        Some("validate") => validate::reduce(request).unwrap_or(Value::Null),
        Some("create") => create::reduce(request).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_arrival_is_charged_only_when_lit_and_only_once() {
        let lamp = json!({"fuelRooms": 3, "fuelPlace": "attic", "fuelVisit": true});
        let settle = |lamp: Value, held: bool| {
            reduce(&json!({"op": "settle_lamp", "lamp": lamp, "position": {"place": "pond", "held": held}}))["lamp"].clone()
        };
        let dark = settle(lamp, false);
        assert_eq!(
            dark,
            json!({"fuelRooms": 3, "fuelPlace": "pond", "fuelVisit": false, "lit": false})
        );
        let lit = settle(dark, true);
        assert_eq!(
            lit,
            json!({"fuelRooms": 2, "fuelPlace": "pond", "fuelVisit": true, "lit": true})
        );
        assert_eq!(settle(lit.clone(), true), lit);
    }

    #[test]
    fn unported_operations_are_explicitly_unsupported() {
        assert_eq!(reduce(&json!({"op": "play"})), Value::Null);
        assert_eq!(
            reduce(&json!({"op": "presence", "world": {"revision": 1}})),
            Value::Null
        );
    }
}
