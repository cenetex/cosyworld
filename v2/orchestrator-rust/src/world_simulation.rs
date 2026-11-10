use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct WorldSimulationState {
    #[serde(default)]
    pub pulse_index: u64,
    #[serde(default)]
    pub last_advanced_tick: u64,
    #[serde(default)]
    pub locations: BTreeMap<u64, LocationSimulationState>,
    #[serde(default)]
    pub factions: BTreeMap<String, FactionSimulationState>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct LocationSimulationState {
    #[serde(default = "default_weather")]
    pub weather: String,
    #[serde(default)]
    pub weather_intensity: u8,
    #[serde(default)]
    pub trade_stock: i16,
    #[serde(default)]
    pub trade_pressure: i8,
    #[serde(default)]
    pub imports: BTreeMap<String, u8>,
    #[serde(default)]
    pub conflict_pressure: u8,
    #[serde(default)]
    pub faction_influence: BTreeMap<String, u8>,
    #[serde(default)]
    pub last_pulse_tick: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct FactionSimulationState {
    #[serde(default)]
    pub momentum: i16,
    #[serde(default)]
    pub last_action_tick: u64,
}

impl WorldSimulationState {}

fn default_weather() -> String {
    "settled".to_string()
}
