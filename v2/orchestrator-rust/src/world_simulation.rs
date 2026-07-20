use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const WORLD_PULSE_INTERVAL_TICKS: u64 = 6;
const MAX_TRADE_STOCK: i16 = 24;
const MIN_TRADE_PRESSURE: i8 = -6;
const MAX_TRADE_PRESSURE: i8 = 6;
const MAX_CONFLICT_PRESSURE: u8 = 4;
const MAX_FACTION_INFLUENCE: u8 = 4;
const MAX_FACTION_MOMENTUM: i16 = 12;
const HOME_FACTION_INFLUENCE: u8 = 3;

#[derive(Clone, Debug)]
pub(crate) struct WorldSimulationSeed {
    pub locations: Vec<SimulationLocationSeed>,
    pub factions: Vec<SimulationFactionSeed>,
    pub routes: Vec<SimulationRoute>,
}

#[derive(Clone, Debug)]
pub(crate) struct SimulationLocationSeed {
    pub id: u64,
    pub zone: String,
    pub safety: String,
    pub biome: String,
    pub resources: BTreeMap<String, i16>,
    pub front_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct SimulationFactionSeed {
    pub id: String,
    pub name: String,
    pub opposes: Vec<String>,
    pub home_location_ids: Vec<u64>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SimulationRoute {
    pub from_location_id: u64,
    pub to_location_id: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PulseEffectClass {
    Ambient,
    Opportunity,
    Stakes,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WorldStakesConsent {
    pub location_id: u64,
}

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorldPulse {
    pub pulse_index: u64,
    pub source_world_tick: u64,
    pub weather: WeatherShift,
    pub trade: TradeOutcome,
    pub faction: Option<FactionAction>,
    pub conflict: ConflictOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WeatherShift {
    pub class: PulseEffectClass,
    pub location_id: u64,
    pub before: String,
    pub after: String,
    pub intensity: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TradeOutcome {
    pub class: PulseEffectClass,
    pub from_location_id: u64,
    pub to_location_id: u64,
    pub resource: String,
    pub moved: bool,
    pub amount: u8,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FactionAction {
    pub class: PulseEffectClass,
    pub faction_id: String,
    pub faction_name: String,
    pub from_location_id: u64,
    pub to_location_id: u64,
    pub influence_before: u8,
    pub influence_after: u8,
    pub opposed_faction_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ConflictOutcome {
    pub class: PulseEffectClass,
    pub location_id: u64,
    pub before: u8,
    pub after: u8,
    pub escalated: bool,
    pub front_ids: Vec<String>,
    pub faction_ids: Vec<String>,
    pub reason: String,
}

impl WorldSimulationState {
    pub(crate) fn ensure_seed(&mut self, seed: &WorldSimulationSeed) {
        let active_locations = seed
            .locations
            .iter()
            .map(|location| location.id)
            .collect::<BTreeSet<_>>();
        self.locations
            .retain(|location_id, _| active_locations.contains(location_id));

        for location in &seed.locations {
            let starting_stock = location
                .resources
                .values()
                .copied()
                .filter(|amount| *amount > 0)
                .sum::<i16>()
                .clamp(0, MAX_TRADE_STOCK);
            let state = self.locations.entry(location.id).or_default();
            if state.trade_stock == 0 && state.last_pulse_tick == 0 {
                state.trade_stock = starting_stock;
            }
            if state.weather.trim().is_empty() {
                state.weather = default_weather();
            }
            state.trade_stock = state.trade_stock.clamp(0, MAX_TRADE_STOCK);
            state.trade_pressure = state
                .trade_pressure
                .clamp(MIN_TRADE_PRESSURE, MAX_TRADE_PRESSURE);
            state.conflict_pressure = state.conflict_pressure.min(MAX_CONFLICT_PRESSURE - 1);
            for influence in state.faction_influence.values_mut() {
                *influence = (*influence).min(MAX_FACTION_INFLUENCE);
            }
        }

        let active_factions = seed
            .factions
            .iter()
            .map(|faction| faction.id.clone())
            .collect::<BTreeSet<_>>();
        self.factions
            .retain(|faction_id, _| active_factions.contains(faction_id));
        for faction in &seed.factions {
            let state = self.factions.entry(faction.id.clone()).or_default();
            state.momentum = state
                .momentum
                .clamp(-MAX_FACTION_MOMENTUM, MAX_FACTION_MOMENTUM);
            for location_id in &faction.home_location_ids {
                if let Some(location) = self.locations.get_mut(location_id) {
                    let influence = location
                        .faction_influence
                        .entry(faction.id.clone())
                        .or_default();
                    *influence = (*influence).max(HOME_FACTION_INFLUENCE);
                }
            }
        }
    }

    pub(crate) fn advance_if_due(
        &mut self,
        seed: &WorldSimulationSeed,
        world_tick: u64,
        entropy: u64,
        source_location_id: Option<u64>,
        stakes_consent: Option<WorldStakesConsent>,
    ) -> Option<WorldPulse> {
        self.ensure_seed(seed);
        if world_tick == 0
            || world_tick <= self.last_advanced_tick
            || world_tick % WORLD_PULSE_INTERVAL_TICKS != 0
        {
            return None;
        }

        let route = self.select_trade_route(seed, entropy, source_location_id)?;
        self.pulse_index = self.pulse_index.saturating_add(1);
        self.last_advanced_tick = world_tick;

        let weather = self.advance_weather(seed, route.from_location_id, entropy, world_tick);
        let trade = self.advance_trade(seed, route, &weather, entropy, world_tick);
        let faction =
            self.advance_faction(seed, entropy, source_location_id, trade.moved, world_tick);
        let conflict = self.advance_conflict(
            seed,
            &trade,
            faction.as_ref(),
            &weather,
            stakes_consent,
            world_tick,
        );

        Some(WorldPulse {
            pulse_index: self.pulse_index,
            source_world_tick: world_tick,
            weather,
            trade,
            faction,
            conflict,
        })
    }

    fn select_trade_route(
        &self,
        seed: &WorldSimulationSeed,
        entropy: u64,
        source_location_id: Option<u64>,
    ) -> Option<SimulationRoute> {
        let zone_by_location = seed
            .locations
            .iter()
            .map(|location| (location.id, location.zone.as_str()))
            .collect::<BTreeMap<_, _>>();
        let mut remote_routes = seed
            .routes
            .iter()
            .copied()
            .filter(|route| route.from_location_id != route.to_location_id)
            .filter(|route| zone_by_location.get(&route.from_location_id) == Some(&"frontier"))
            .filter(|route| zone_by_location.get(&route.to_location_id) == Some(&"frontier"))
            .filter(|route| {
                source_location_id.is_none_or(|source| {
                    route.from_location_id != source && route.to_location_id != source
                })
            })
            .collect::<Vec<_>>();
        remote_routes.sort_by_key(|route| (route.from_location_id, route.to_location_id));

        let routes = if remote_routes.is_empty() {
            let mut fallback = seed
                .routes
                .iter()
                .copied()
                .filter(|route| route.from_location_id != route.to_location_id)
                .filter(|route| zone_by_location.get(&route.from_location_id) == Some(&"frontier"))
                .filter(|route| zone_by_location.get(&route.to_location_id) == Some(&"frontier"))
                .collect::<Vec<_>>();
            fallback.sort_by_key(|route| (route.from_location_id, route.to_location_id));
            fallback
        } else {
            remote_routes
        };
        choose(&routes, entropy, self.pulse_index.wrapping_add(11)).copied()
    }

    fn advance_weather(
        &mut self,
        seed: &WorldSimulationSeed,
        location_id: u64,
        entropy: u64,
        world_tick: u64,
    ) -> WeatherShift {
        let biome = seed
            .locations
            .iter()
            .find(|location| location.id == location_id)
            .map(|location| location.biome.as_str())
            .unwrap_or("");
        let palette = weather_palette(biome);
        let location = self.locations.entry(location_id).or_default();
        let before = location.weather.clone();
        let mut index = deterministic_index(entropy, self.pulse_index ^ location_id, palette.len());
        if palette[index].0 == before && palette.len() > 1 {
            index = (index + 1) % palette.len();
        }
        let (after, intensity) = palette[index];
        location.weather = after.to_string();
        location.weather_intensity = intensity;
        location.last_pulse_tick = world_tick;
        WeatherShift {
            class: PulseEffectClass::Ambient,
            location_id,
            before,
            after: after.to_string(),
            intensity,
        }
    }

    fn advance_trade(
        &mut self,
        seed: &WorldSimulationSeed,
        route: SimulationRoute,
        weather: &WeatherShift,
        entropy: u64,
        world_tick: u64,
    ) -> TradeOutcome {
        let resource_names = seed
            .locations
            .iter()
            .find(|location| location.id == route.from_location_id)
            .map(|location| location.resources.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let resource = choose(
            &resource_names,
            entropy.rotate_left(17),
            self.pulse_index ^ route.to_location_id,
        )
        .cloned()
        .unwrap_or_else(|| "provisions".to_string());

        let origin_stock = self
            .locations
            .get(&route.from_location_id)
            .map(|location| location.trade_stock)
            .unwrap_or_default();
        let blocked_reason = if weather.intensity >= 3 {
            Some(format!("{} makes the route unsafe", weather.after))
        } else if origin_stock <= 0 {
            Some("the source market has nothing left to send".to_string())
        } else {
            None
        };

        if let Some(reason) = blocked_reason {
            if let Some(origin) = self.locations.get_mut(&route.from_location_id) {
                origin.trade_pressure = origin
                    .trade_pressure
                    .saturating_add(1)
                    .min(MAX_TRADE_PRESSURE);
                origin.last_pulse_tick = world_tick;
            }
            if let Some(destination) = self.locations.get_mut(&route.to_location_id) {
                destination.trade_pressure = destination
                    .trade_pressure
                    .saturating_add(1)
                    .min(MAX_TRADE_PRESSURE);
                destination.last_pulse_tick = world_tick;
            }
            return TradeOutcome {
                class: PulseEffectClass::Opportunity,
                from_location_id: route.from_location_id,
                to_location_id: route.to_location_id,
                resource,
                moved: false,
                amount: 0,
                reason,
            };
        }

        if let Some(origin) = self.locations.get_mut(&route.from_location_id) {
            origin.trade_stock = origin.trade_stock.saturating_sub(1).max(0);
            origin.trade_pressure = origin
                .trade_pressure
                .saturating_sub(1)
                .max(MIN_TRADE_PRESSURE);
            origin.last_pulse_tick = world_tick;
        }
        if let Some(destination) = self.locations.get_mut(&route.to_location_id) {
            destination.trade_stock = destination
                .trade_stock
                .saturating_add(1)
                .min(MAX_TRADE_STOCK);
            destination.trade_pressure = destination
                .trade_pressure
                .saturating_sub(1)
                .max(MIN_TRADE_PRESSURE);
            let imports = destination.imports.entry(resource.clone()).or_default();
            *imports = imports.saturating_add(1);
            destination.last_pulse_tick = world_tick;
        }
        TradeOutcome {
            class: PulseEffectClass::Opportunity,
            from_location_id: route.from_location_id,
            to_location_id: route.to_location_id,
            resource,
            moved: true,
            amount: 1,
            reason: "the route held through the weather".to_string(),
        }
    }

    fn advance_faction(
        &mut self,
        seed: &WorldSimulationSeed,
        entropy: u64,
        source_location_id: Option<u64>,
        trade_moved: bool,
        world_tick: u64,
    ) -> Option<FactionAction> {
        let zone_by_location = seed
            .locations
            .iter()
            .map(|location| (location.id, location.zone.as_str()))
            .collect::<BTreeMap<_, _>>();
        let mut routes = seed
            .routes
            .iter()
            .copied()
            .filter(|route| route.from_location_id != route.to_location_id)
            .filter(|route| zone_by_location.get(&route.to_location_id) == Some(&"frontier"))
            .filter(|route| {
                source_location_id.is_none_or(|source| {
                    route.from_location_id != source && route.to_location_id != source
                })
            })
            .filter(|route| {
                self.locations
                    .get(&route.from_location_id)
                    .is_some_and(|location| {
                        location
                            .faction_influence
                            .values()
                            .any(|influence| *influence > 0)
                    })
            })
            .collect::<Vec<_>>();
        routes.sort_by_key(|route| (route.from_location_id, route.to_location_id));
        let route = choose(&routes, entropy.rotate_left(29), self.pulse_index ^ 0xface)?.to_owned();

        let origin = self.locations.get(&route.from_location_id)?;
        let mut faction_ids = origin
            .faction_influence
            .iter()
            .filter(|(_, influence)| **influence > 0)
            .map(|(faction_id, _)| faction_id.clone())
            .collect::<Vec<_>>();
        faction_ids.sort();
        let faction_id = choose(
            &faction_ids,
            entropy.rotate_left(41),
            route.from_location_id ^ self.pulse_index,
        )?
        .clone();
        let faction_seed = seed
            .factions
            .iter()
            .find(|faction| faction.id == faction_id)?;
        let destination = self.locations.get_mut(&route.to_location_id)?;
        let influence = destination
            .faction_influence
            .entry(faction_id.clone())
            .or_default();
        let influence_before = *influence;
        *influence = influence.saturating_add(1).min(MAX_FACTION_INFLUENCE);
        let influence_after = *influence;
        let opposed_faction_ids = faction_seed
            .opposes
            .iter()
            .filter(|opposed_id| {
                destination
                    .faction_influence
                    .get(*opposed_id)
                    .is_some_and(|value| *value > 0)
            })
            .cloned()
            .collect::<Vec<_>>();

        let faction = self.factions.entry(faction_id.clone()).or_default();
        faction.momentum = if trade_moved {
            faction.momentum.saturating_add(1)
        } else {
            faction.momentum.saturating_sub(1)
        }
        .clamp(-MAX_FACTION_MOMENTUM, MAX_FACTION_MOMENTUM);
        faction.last_action_tick = world_tick;

        Some(FactionAction {
            class: PulseEffectClass::Opportunity,
            faction_id,
            faction_name: faction_seed.name.clone(),
            from_location_id: route.from_location_id,
            to_location_id: route.to_location_id,
            influence_before,
            influence_after,
            opposed_faction_ids,
        })
    }

    fn advance_conflict(
        &mut self,
        seed: &WorldSimulationSeed,
        trade: &TradeOutcome,
        faction: Option<&FactionAction>,
        weather: &WeatherShift,
        stakes_consent: Option<WorldStakesConsent>,
        world_tick: u64,
    ) -> ConflictOutcome {
        let opportunity_location_id = faction
            .map(|action| action.to_location_id)
            .unwrap_or(trade.from_location_id);
        let consent_location_id =
            stakes_consent
                .map(|consent| consent.location_id)
                .filter(|location_id| {
                    seed.locations.iter().any(|location| {
                        location.id == *location_id
                            && location.zone == "frontier"
                            && !location.front_ids.is_empty()
                    })
                });
        let location_id = consent_location_id.unwrap_or(opportunity_location_id);
        let location_seed = seed
            .locations
            .iter()
            .find(|location| location.id == location_id);
        let zone = location_seed
            .map(|location| location.zone.as_str())
            .unwrap_or("");
        let safety = location_seed
            .map(|location| location.safety.as_str())
            .unwrap_or("safe");
        let front_ids = location_seed
            .map(|location| location.front_ids.clone())
            .unwrap_or_default();
        let state = self.locations.entry(location_id).or_default();
        let before = state.conflict_pressure;
        let mut faction_ids = faction
            .filter(|action| action.to_location_id == location_id)
            .map(|action| {
                let mut ids = vec![action.faction_id.clone()];
                ids.extend(action.opposed_faction_ids.clone());
                ids.sort();
                ids.dedup();
                ids
            })
            .unwrap_or_default();

        let (delta, reason) = if consent_location_id.is_some() {
            (
                1,
                "a recorded frontier action brings local pressure to a head",
            )
        } else if zone != "frontier" {
            (
                -i8::from(before > 0),
                "sanctuary turns rivalry into negotiation",
            )
        } else if faction_ids.len() > 1 {
            (2, "opposed factions now claim the same frontier")
        } else if (!front_ids.is_empty() || safety == "dangerous")
            && (!trade.moved || weather.intensity >= 3)
        {
            (1, "weather and scarcity feed an active front")
        } else if trade.moved {
            (-1, "open trade lowers the immediate stakes")
        } else {
            (1, "scarcity leaves the frontier brittle")
        };

        let mut after = if delta >= 0 {
            before
                .saturating_add(delta as u8)
                .min(MAX_CONFLICT_PRESSURE)
        } else {
            before.saturating_sub(delta.unsigned_abs())
        };
        let escalated = consent_location_id.is_some()
            && before < MAX_CONFLICT_PRESSURE
            && after >= MAX_CONFLICT_PRESSURE;
        if escalated {
            // Leave tension behind after the public consequence so a front can flare again,
            // but never emit the same escalation every subsequent pulse.
            after = 1;
        } else {
            // Background opportunity pulses may make tension visible, but only a
            // causally relevant frontier action may cross into stakes.
            after = after.min(MAX_CONFLICT_PRESSURE - 1);
        }
        state.conflict_pressure = after;
        state.last_pulse_tick = world_tick;
        if faction_ids.is_empty() {
            faction_ids = state
                .faction_influence
                .iter()
                .filter(|(_, influence)| **influence > 0)
                .map(|(faction_id, _)| faction_id.clone())
                .collect();
        }

        ConflictOutcome {
            class: if escalated {
                PulseEffectClass::Stakes
            } else {
                PulseEffectClass::Opportunity
            },
            location_id,
            before,
            after,
            escalated,
            front_ids,
            faction_ids,
            reason: reason.to_string(),
        }
    }
}

fn default_weather() -> String {
    "settled".to_string()
}

fn choose<'a, T>(values: &'a [T], entropy: u64, salt: u64) -> Option<&'a T> {
    (!values.is_empty()).then(|| &values[deterministic_index(entropy, salt, values.len())])
}

fn deterministic_index(entropy: u64, salt: u64, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    (mix64(entropy ^ salt.rotate_left(23)) % len as u64) as usize
}

fn mix64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn weather_palette(biome: &str) -> Vec<(&'static str, u8)> {
    let biome = biome.to_lowercase();
    if biome.contains("ocean") || biome.contains("river") || biome.contains("shore") {
        vec![
            ("a clear tide", 0),
            ("salt wind", 1),
            ("deep fog", 2),
            ("hard rain", 3),
        ]
    } else if biome.contains("mountain")
        || biome.contains("peak")
        || biome.contains("alpine")
        || biome.contains("hill")
    {
        vec![
            ("bright cold", 0),
            ("a high crosswind", 2),
            ("snow flurries", 2),
            ("a ridge storm", 3),
        ]
    } else if biome.contains("swamp") || biome.contains("moor") || biome.contains("jungle") {
        vec![
            ("still heat", 1),
            ("warm rain", 1),
            ("heavy mist", 2),
            ("a blackwater storm", 3),
        ]
    } else if biome.contains("digital") {
        vec![
            ("a clear channel", 0),
            ("signal rain", 1),
            ("packet fog", 2),
            ("a static storm", 3),
        ]
    } else if biome.contains("forest") || biome.contains("wood") || biome.contains("garden") {
        vec![
            ("leaf-filtered sun", 0),
            ("soft rain", 1),
            ("root mist", 2),
            ("a branch-breaking storm", 3),
        ]
    } else {
        vec![
            ("clear weather", 0),
            ("a mild wind", 1),
            ("wandering mist", 2),
            ("a sudden storm", 3),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_seed() -> WorldSimulationSeed {
        WorldSimulationSeed {
            locations: vec![
                SimulationLocationSeed {
                    id: 1,
                    zone: "sanctuary".to_string(),
                    safety: "safe".to_string(),
                    biome: "cottage".to_string(),
                    resources: BTreeMap::from([("tea".to_string(), 3)]),
                    front_ids: Vec::new(),
                },
                SimulationLocationSeed {
                    id: 2,
                    zone: "frontier".to_string(),
                    safety: "risky".to_string(),
                    biome: "alpine mountain".to_string(),
                    resources: BTreeMap::from([("ore".to_string(), 3)]),
                    front_ids: vec!["ridge-front".to_string()],
                },
                SimulationLocationSeed {
                    id: 3,
                    zone: "frontier".to_string(),
                    safety: "dangerous".to_string(),
                    biome: "dark forest".to_string(),
                    resources: BTreeMap::from([("herbs".to_string(), 2)]),
                    front_ids: Vec::new(),
                },
            ],
            factions: vec![
                SimulationFactionSeed {
                    id: "ridge".to_string(),
                    name: "Ridge Keepers".to_string(),
                    opposes: vec!["wood".to_string()],
                    home_location_ids: vec![2],
                },
                SimulationFactionSeed {
                    id: "wood".to_string(),
                    name: "Wood Court".to_string(),
                    opposes: vec!["ridge".to_string()],
                    home_location_ids: vec![3],
                },
            ],
            routes: vec![
                SimulationRoute {
                    from_location_id: 2,
                    to_location_id: 1,
                },
                SimulationRoute {
                    from_location_id: 1,
                    to_location_id: 2,
                },
                SimulationRoute {
                    from_location_id: 1,
                    to_location_id: 3,
                },
                SimulationRoute {
                    from_location_id: 3,
                    to_location_id: 1,
                },
                SimulationRoute {
                    from_location_id: 2,
                    to_location_id: 3,
                },
                SimulationRoute {
                    from_location_id: 3,
                    to_location_id: 2,
                },
            ],
        }
    }

    #[test]
    fn pulses_only_advance_on_interval_and_avoid_the_source_room() {
        let seed = test_seed();
        let mut state = WorldSimulationState::default();
        assert!(state.advance_if_due(&seed, 5, 10, Some(1), None).is_none());
        let pulse = state
            .advance_if_due(&seed, 6, 10, Some(1), None)
            .expect("sixth played tick advances the world");
        assert_ne!(pulse.trade.from_location_id, 1);
        assert_ne!(pulse.trade.to_location_id, 1);
        assert_eq!(pulse.source_world_tick, 6);
        assert_eq!(pulse.weather.class, PulseEffectClass::Ambient);
        assert_eq!(pulse.trade.class, PulseEffectClass::Opportunity);
        assert_eq!(pulse.conflict.class, PulseEffectClass::Opportunity);
        assert!(!pulse.conflict.escalated);
        assert!(state.advance_if_due(&seed, 6, 10, Some(2), None).is_none());
    }

    #[test]
    fn the_same_seed_replays_the_same_history() {
        let seed = test_seed();
        let mut left = WorldSimulationState::default();
        let mut right = WorldSimulationState::default();
        for tick in [6, 12, 18, 24] {
            let left_pulse = left.advance_if_due(&seed, tick, 700 + tick, Some(1), None);
            let right_pulse = right.advance_if_due(&seed, tick, 700 + tick, Some(1), None);
            assert_eq!(left_pulse, right_pulse);
        }
        assert_eq!(left, right);
    }

    #[test]
    fn different_committed_seeds_can_create_different_history() {
        let seed = test_seed();
        let mut baseline_state = WorldSimulationState::default();
        let baseline = baseline_state
            .advance_if_due(&seed, WORLD_PULSE_INTERVAL_TICKS, 1, None, None)
            .expect("baseline pulse");
        let diverged = (2_u64..=128).any(|entropy| {
            let mut candidate = WorldSimulationState::default();
            candidate
                .advance_if_due(&seed, WORLD_PULSE_INTERVAL_TICKS, entropy, None, None)
                .is_some_and(|pulse| pulse != baseline)
        });
        assert!(
            diverged,
            "committed entropy should vary the resulting history"
        );
    }

    #[test]
    fn sanctuary_conflict_cannot_accumulate() {
        let seed = test_seed();
        let mut state = WorldSimulationState::default();
        state.ensure_seed(&seed);
        let sanctuary = state.locations.get_mut(&1).expect("sanctuary state");
        sanctuary.conflict_pressure = 3;
        sanctuary.faction_influence.insert("ridge".to_string(), 2);
        sanctuary.faction_influence.insert("wood".to_string(), 2);
        let trade = TradeOutcome {
            class: PulseEffectClass::Opportunity,
            from_location_id: 2,
            to_location_id: 1,
            resource: "ore".to_string(),
            moved: false,
            amount: 0,
            reason: "blocked".to_string(),
        };
        let faction = FactionAction {
            class: PulseEffectClass::Opportunity,
            faction_id: "ridge".to_string(),
            faction_name: "Ridge Keepers".to_string(),
            from_location_id: 2,
            to_location_id: 1,
            influence_before: 1,
            influence_after: 2,
            opposed_faction_ids: vec!["wood".to_string()],
        };
        let weather = WeatherShift {
            class: PulseEffectClass::Ambient,
            location_id: 2,
            before: "settled".to_string(),
            after: "a ridge storm".to_string(),
            intensity: 3,
        };
        let conflict = state.advance_conflict(&seed, &trade, Some(&faction), &weather, None, 6);
        assert!(!conflict.escalated);
        assert_eq!(conflict.class, PulseEffectClass::Opportunity);
        assert_eq!(conflict.after, 2);
    }

    #[test]
    fn automatic_pulses_never_mutate_sanctuary_state() {
        let seed = test_seed();
        let mut state = WorldSimulationState::default();
        state.ensure_seed(&seed);
        let sanctuary_before = state.locations.get(&1).cloned().expect("sanctuary state");

        for pulse_number in 1_u64..=24 {
            state
                .advance_if_due(
                    &seed,
                    pulse_number * WORLD_PULSE_INTERVAL_TICKS,
                    4_000 + pulse_number,
                    None,
                    None,
                )
                .expect("pulse advances");
        }

        assert_eq!(state.locations.get(&1), Some(&sanctuary_before));
    }

    #[test]
    fn long_play_couples_every_system_across_multiple_rooms() {
        let seed = test_seed();
        let mut state = WorldSimulationState::default();
        let mut weather_locations = BTreeSet::new();
        let mut faction_ids = BTreeSet::new();
        let mut saw_trade = false;
        let mut saw_disruption = false;
        let mut saw_conflict_change = false;
        let mut saw_stakes = false;

        for pulse_number in 1_u64..=48 {
            let tick = pulse_number * WORLD_PULSE_INTERVAL_TICKS;
            let entropy = 9_000_u64.wrapping_add(pulse_number.wrapping_mul(7_919));
            let pulse = state
                .advance_if_due(&seed, tick, entropy, None, None)
                .expect("each interval produces a pulse");
            weather_locations.insert(pulse.weather.location_id);
            saw_trade |= pulse.trade.moved;
            saw_disruption |= !pulse.trade.moved;
            if let Some(faction) = pulse.faction {
                faction_ids.insert(faction.faction_id);
            }
            saw_conflict_change |= pulse.conflict.after != pulse.conflict.before;
            saw_stakes |= pulse.conflict.class == PulseEffectClass::Stakes;
        }

        assert!(
            weather_locations.len() >= 2,
            "weather should roam between rooms"
        );
        assert!(saw_trade, "clear routes should move real stock");
        assert!(saw_disruption, "storms or scarcity should interrupt trade");
        assert!(faction_ids.len() >= 2, "multiple factions should propagate");
        assert!(
            saw_conflict_change,
            "trade, weather, and factions should alter conflict"
        );
        assert!(!saw_stakes, "background opportunity cannot become stakes");
        assert!(state
            .locations
            .values()
            .any(|location| !location.imports.is_empty()));
    }

    #[test]
    fn recorded_frontier_consent_is_the_only_path_to_stakes() {
        let seed = test_seed();
        let mut without_consent = WorldSimulationState::default();
        without_consent.ensure_seed(&seed);
        without_consent
            .locations
            .get_mut(&2)
            .expect("frontier state")
            .conflict_pressure = MAX_CONFLICT_PRESSURE - 1;
        let opportunity = without_consent
            .advance_if_due(&seed, 6, 77, Some(1), None)
            .expect("opportunity pulse");
        assert!(!opportunity.conflict.escalated);
        assert_eq!(opportunity.conflict.class, PulseEffectClass::Opportunity);
        assert!(without_consent
            .locations
            .values()
            .all(|location| location.conflict_pressure < MAX_CONFLICT_PRESSURE));

        let mut consented = WorldSimulationState::default();
        consented.ensure_seed(&seed);
        consented
            .locations
            .get_mut(&2)
            .expect("frontier state")
            .conflict_pressure = MAX_CONFLICT_PRESSURE - 1;
        let stakes = consented
            .advance_if_due(
                &seed,
                6,
                77,
                Some(2),
                Some(WorldStakesConsent { location_id: 2 }),
            )
            .expect("consented pulse");
        assert!(stakes.conflict.escalated);
        assert_eq!(stakes.conflict.class, PulseEffectClass::Stakes);
        assert_eq!(stakes.conflict.location_id, 2);

        let mut sanctuary = WorldSimulationState::default();
        sanctuary.ensure_seed(&seed);
        sanctuary
            .locations
            .get_mut(&1)
            .expect("sanctuary state")
            .conflict_pressure = MAX_CONFLICT_PRESSURE - 1;
        let ignored = sanctuary
            .advance_if_due(
                &seed,
                6,
                77,
                Some(1),
                Some(WorldStakesConsent { location_id: 1 }),
            )
            .expect("sanctuary consent is ignored");
        assert!(!ignored.conflict.escalated);
        assert_eq!(ignored.conflict.class, PulseEffectClass::Opportunity);
    }

    #[test]
    fn long_run_state_and_route_selection_stay_bounded() {
        let seed = test_seed();
        let zone_by_location = seed
            .locations
            .iter()
            .map(|location| (location.id, location.zone.as_str()))
            .collect::<BTreeMap<_, _>>();
        let mut state = WorldSimulationState::default();

        for pulse_number in 1_u64..=256 {
            let pulse = state
                .advance_if_due(
                    &seed,
                    pulse_number * WORLD_PULSE_INTERVAL_TICKS,
                    50_000 + pulse_number * 3571,
                    None,
                    None,
                )
                .expect("bounded pulse");
            assert_eq!(
                zone_by_location.get(&pulse.trade.from_location_id),
                Some(&"frontier")
            );
            assert_eq!(
                zone_by_location.get(&pulse.trade.to_location_id),
                Some(&"frontier")
            );
        }

        for location in state.locations.values() {
            assert!((0..=MAX_TRADE_STOCK).contains(&location.trade_stock));
            assert!((MIN_TRADE_PRESSURE..=MAX_TRADE_PRESSURE).contains(&location.trade_pressure));
            assert!(location.conflict_pressure < MAX_CONFLICT_PRESSURE);
            assert!(location
                .faction_influence
                .values()
                .all(|influence| *influence <= MAX_FACTION_INFLUENCE));
        }
        assert!(state.factions.values().all(|faction| {
            (-MAX_FACTION_MOMENTUM..=MAX_FACTION_MOMENTUM).contains(&faction.momentum)
        }));
    }
}
