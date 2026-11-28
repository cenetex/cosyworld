#![forbid(unsafe_code)]
#![deny(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::float_arithmetic
)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub mod authored_order;
mod create;
mod create_geography;
mod elysium;
mod initial_wants;
mod join;
mod opening;
mod opening_attic_rest;
mod opening_behind_station_view;
mod opening_candidates;
mod opening_company;
mod opening_content;
mod opening_crossings;
mod opening_drop;
pub mod opening_evidence;
mod opening_full_move;
mod opening_full_station_move;
mod opening_full_station_read;
mod opening_full_wait;
mod opening_grounded_lamp;
mod opening_held_items;
pub mod opening_history;
mod opening_history_walkers;
mod opening_hub_residents;
mod opening_mirror_move;
mod opening_pickups;
mod opening_place_cards;
mod opening_play;
mod opening_pond_ask;
mod opening_pond_place_returns;
mod opening_pond_return_view;
mod opening_pond_rumours;
mod opening_pond_view;
mod opening_quiet_life;
mod opening_reflection;
mod opening_resident_sleep;
mod opening_roaming;
mod opening_room_speech;
mod opening_roster;
pub mod opening_rumours;
mod opening_second_attic_lamp;
mod opening_second_attic_tail;
mod opening_second_round;
mod opening_settlement;
mod opening_speech;
mod opening_stale_wants;
mod opening_station_departure_residents;
mod opening_station_keeper_gift;
mod opening_station_move;
mod opening_station_quest_drop_learning;
mod opening_station_read;
mod opening_station_read_wait;
mod opening_station_residents;
mod opening_station_view;
mod opening_take;
mod opening_take_response;
mod opening_view;
mod opening_visitor_play;
mod opening_visitor_routes;
mod opening_visitor_transport;
mod opening_wait;
mod opening_wait_response;
mod opening_wants;
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
pub use opening_pond_view::completed_move_response;
pub use opening_station_keeper_gift::settle_keeper_abandon_gift;
pub use opening_station_read::begin_station_log_read;
pub use opening_station_read_wait::settle_station_read_wait;
pub use opening_station_view::{
    begin_keeper_abandon, completed_keeper_abandon, completed_station_response,
};
pub use opening_take_response::completed_take_response;
pub use opening_view::create_response;
pub use opening_wait_response::{completed_second_wait_response, completed_wait_response};

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
        Some("visitor_person_step") => {
            opening_visitor_routes::person_step_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_visitor_play") => {
            opening_visitor_play::projection(request).unwrap_or(Value::Null)
        }
        Some("visitor_transport") => {
            opening_visitor_transport::projection(request).unwrap_or(Value::Null)
        }
        Some("play") => opening_play::reduce(request).unwrap_or(Value::Null),
        Some("opening_wait_step") => opening_wait::projection(request).unwrap_or(Value::Null),
        Some("opening_second_wait_step") => {
            opening_wait::second_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_second_resident_round") => {
            opening_second_round::round(request).unwrap_or(Value::Null)
        }
        Some("opening_drop_step") => opening_drop::projection(request).unwrap_or(Value::Null),
        Some("opening_take_step") => opening_take::projection(request).unwrap_or(Value::Null),
        Some("opening_drop_reflection") => {
            opening_grounded_lamp::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_attic_rest") => {
            opening_attic_rest::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_wait_roster") => opening_roster::projection(request).unwrap_or(Value::Null),
        Some("opening_bard_move") => opening_roaming::projection(request).unwrap_or(Value::Null),
        Some("opening_bard_dwell") => {
            opening_roaming::dwell_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_wait_settlement") => {
            opening_settlement::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_mirror_move") => {
            opening_mirror_move::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_station_move") => {
            opening_station_move::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_station_departure_residents") => {
            opening_station_departure_residents::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_behind_station_view") => {
            opening_behind_station_view::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_pond_return_view") => {
            opening_pond_return_view::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_historic_awake_station_view") => {
            opening_station_view::historic_awake_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_keeper_abandon") => {
            opening_station_view::keeper_abandon_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_keeper_abandon_gift") => {
            opening_station_keeper_gift::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_keeper_abandon_reply") => {
            opening_station_view::keeper_abandon_reply(request).unwrap_or(Value::Null)
        }
        Some("opening_station_train_quest") => {
            opening_station_view::accept_train(request).unwrap_or(Value::Null)
        }
        Some("opening_pond_rumours") => {
            opening_pond_rumours::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_full_move") => opening_full_move::projection(request).unwrap_or(Value::Null),
        Some("opening_pond_ask") => opening_pond_ask::projection(request).unwrap_or(Value::Null),
        Some("opening_station_residents") => {
            opening_station_residents::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_pond_place_returns") => {
            opening_pond_place_returns::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_pickups") => opening_pickups::projection(request).unwrap_or(Value::Null),
        Some("opening_place_cards") => {
            opening_place_cards::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_place_return") => {
            opening_place_cards::returned_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_wait_wants") => opening_wants::projection(request).unwrap_or(Value::Null),
        Some("opening_history_wants") => {
            opening_wants::history_projection(request).unwrap_or(Value::Null)
        }
        Some(
            "opening_second_attic_wants"
            | "opening_second_pond_wants"
            | "opening_station_wants"
            | "opening_station_read_wants"
            | "opening_station_departure_wants",
        ) => opening_wants::round_projection(request).unwrap_or(Value::Null),
        Some(
            "opening_second_attic_life"
            | "opening_second_pond_life"
            | "opening_station_life"
            | "opening_station_departure_life",
        ) => opening_quiet_life::opening_day_projection(request).unwrap_or(Value::Null),
        Some("opening_history_walkers") => {
            opening_history_walkers::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_fade_trust") => opening_company::projection(request).unwrap_or(Value::Null),
        Some("opening_resident_sleep") => {
            opening_resident_sleep::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_pond_resident_sleep") => {
            opening_resident_sleep::pond_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_station_resident_sleep") => {
            opening_resident_sleep::station_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_station_wake") => {
            opening_resident_sleep::station_wake_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_hub_idle") => {
            opening_hub_residents::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_second_hub_idle") => {
            opening_hub_residents::second_projection(request).unwrap_or(Value::Null)
        }
        Some("opening_final_hands") => {
            opening_held_items::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_second_attic_lamp") => {
            opening_second_attic_lamp::projection(request).unwrap_or(Value::Null)
        }
        Some("opening_second_attic_tail") => {
            opening_second_attic_tail::projection(request).unwrap_or(Value::Null)
        }
        Some("view") => opening_view::reduce(request).unwrap_or(Value::Null),
        Some("reset") => reset::reset(request).unwrap_or(Value::Null),
        Some("reflect") => opening_reflection::reduce(request).unwrap_or(Value::Null),
        Some("join_state") => opening::join_state(request).unwrap_or(Value::Null),
        Some("mount_packs") => pack_state::reduce(request).unwrap_or(Value::Null),
        Some("speech") => opening_speech::reduce(request).unwrap_or(Value::Null),
        Some("validate") => validate::reduce(request).unwrap_or(Value::Null),
        Some("upgrade") => validate::upgrade(request).unwrap_or(Value::Null),
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
