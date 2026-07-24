use serde::{Deserialize, Serialize};

pub(super) const ENVIRONMENT_PROFILE_VERSION: u8 = 1;
pub(super) const NATURAL_AFFORDANCE_SCHEMA_VERSION: u8 = 1;
pub(super) const NATURAL_INVESTIGATION_SEGMENTS: u8 = 4;
pub(super) const NATURAL_GENERATION_ALGORITHM: &str = "natural-affordance/fnv1a-weighted-v1";

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum EnvironmentClimate {
    #[default]
    Temperate,
    CoolTemperate,
    Alpine,
    Tropical,
    Arid,
    Subterranean,
    Marine,
    Supernatural,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum EnvironmentLandform {
    Garden,
    Riverbank,
    Woodland,
    Trail,
    Meadow,
    Upland,
    Mountain,
    Cave,
    Wetland,
    Coast,
    Ruins,
    Interior,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum EnvironmentGeology {
    Alluvial,
    ClayBearing,
    Sedimentary,
    Igneous,
    Metamorphic,
    Peat,
    Constructed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum EnvironmentHydrology {
    FlowingRiver,
    SeasonalStream,
    StillWater,
    Spring,
    WetGround,
    Dry,
    Tidal,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum EnvironmentAnomaly {
    MoonTouched,
    Ancient,
    Geothermal,
    Arcane,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EnvironmentProfile {
    #[serde(default = "environment_profile_version")]
    pub(super) version: u8,
    #[serde(default)]
    pub(super) climate: EnvironmentClimate,
    #[serde(default)]
    pub(super) landforms: Vec<EnvironmentLandform>,
    #[serde(default)]
    pub(super) geology: Vec<EnvironmentGeology>,
    #[serde(default)]
    pub(super) hydrology: Vec<EnvironmentHydrology>,
    #[serde(default)]
    pub(super) anomalies: Vec<EnvironmentAnomaly>,
}

impl Default for EnvironmentProfile {
    fn default() -> Self {
        Self {
            version: ENVIRONMENT_PROFILE_VERSION,
            climate: EnvironmentClimate::default(),
            landforms: Vec::new(),
            geology: Vec::new(),
            hydrology: Vec::new(),
            anomalies: Vec::new(),
        }
    }
}

fn environment_profile_version() -> u8 {
    ENVIRONMENT_PROFILE_VERSION
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum NaturalResourceKind {
    FishRichWater,
    OreSeam,
    ClayBank,
    AncientWoodland,
    FastRiver,
    ReliableUplandWind,
    HotSpring,
    RichSoil,
    RareHerbHabitat,
    OldRuins,
}

impl NaturalResourceKind {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::FishRichWater => "fish-rich water",
            Self::OreSeam => "ore seam",
            Self::ClayBank => "clay bank",
            Self::AncientWoodland => "ancient woodland",
            Self::FastRiver => "fast river",
            Self::ReliableUplandWind => "reliable upland wind",
            Self::HotSpring => "hot spring",
            Self::RichSoil => "rich soil",
            Self::RareHerbHabitat => "rare herb habitat",
            Self::OldRuins => "old ruins",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum NaturalPotentialPolicy {
    Guaranteed,
    Impossible,
    Weighted,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum NaturalRichness {
    Modest,
    #[default]
    Rich,
    Exceptional,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum NaturalCharacter {
    #[default]
    Renewable,
    Finite,
    Seasonal,
    Enduring,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum BuildingArchetype {
    Fishery,
    Smokehouse,
    Boathouse,
    ShallowMine,
    ProspectorsLodge,
    Kiln,
    Pottery,
    CarpentersLodge,
    Herbalist,
    Watermill,
    RiversideWorkshop,
    Windmill,
    SignalTower,
    Bathhouse,
    HealingHouse,
    Orchard,
    MarketGarden,
    Apothecary,
    Conservatory,
    Archive,
    Museum,
    ExpeditionLodge,
}

impl BuildingArchetype {
    pub(super) fn key(self) -> &'static str {
        match self {
            Self::Fishery => "fishery",
            Self::Smokehouse => "smokehouse",
            Self::Boathouse => "boathouse",
            Self::ShallowMine => "shallow_mine",
            Self::ProspectorsLodge => "prospectors_lodge",
            Self::Kiln => "kiln",
            Self::Pottery => "pottery",
            Self::CarpentersLodge => "carpenters_lodge",
            Self::Herbalist => "herbalist",
            Self::Watermill => "watermill",
            Self::RiversideWorkshop => "riverside_workshop",
            Self::Windmill => "windmill",
            Self::SignalTower => "signal_tower",
            Self::Bathhouse => "bathhouse",
            Self::HealingHouse => "healing_house",
            Self::Orchard => "orchard",
            Self::MarketGarden => "market_garden",
            Self::Apothecary => "apothecary",
            Self::Conservatory => "conservatory",
            Self::Archive => "archive",
            Self::Museum => "museum",
            Self::ExpeditionLodge => "expedition_lodge",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NaturalPotentialRule {
    pub(super) resource_kind: NaturalResourceKind,
    pub(super) policy: NaturalPotentialPolicy,
    #[serde(default)]
    pub(super) weight: u16,
    #[serde(default)]
    pub(super) richness: NaturalRichness,
    #[serde(default)]
    pub(super) character: NaturalCharacter,
    #[serde(default)]
    pub(super) building_archetypes: Vec<BuildingArchetype>,
    #[serde(default)]
    pub(super) presentation_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct NaturalGenerationProvenance {
    pub(super) source: String,
    pub(super) algorithm: String,
    pub(super) world_seed: String,
    pub(super) environment_profile_version: u8,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) provider: String,
    pub(super) model: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct LatentNaturalPotential {
    pub(super) resource_kind: NaturalResourceKind,
    pub(super) richness: NaturalRichness,
    pub(super) character: NaturalCharacter,
    pub(super) building_archetypes: Vec<BuildingArchetype>,
    pub(super) presentation_key: String,
    pub(super) selection_hash: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct NaturalFeatureState {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) resource_kind: NaturalResourceKind,
    pub(super) richness: NaturalRichness,
    pub(super) character: NaturalCharacter,
    pub(super) building_archetypes: Vec<BuildingArchetype>,
    pub(super) presentation_key: String,
    pub(super) environment_profile_version: u8,
    pub(super) revealed_by_actor_id: u64,
    pub(super) revealed_event_seq: u64,
    pub(super) causal_action_event_seqs: Vec<u64>,
    pub(super) generation: NaturalGenerationProvenance,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct NaturalAffordanceState {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) environment: EnvironmentProfile,
    pub(super) latent_potential: Option<LatentNaturalPotential>,
    pub(super) generation: NaturalGenerationProvenance,
    pub(super) investigation_job_id: String,
    pub(super) investigation_clock_id: String,
    #[serde(default)]
    pub(super) causal_action_event_seqs: Vec<u64>,
    #[serde(default)]
    pub(super) revealed_feature: Option<NaturalFeatureState>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct NaturalFeatureRevealEvidence {
    pub(super) schema_version: u8,
    pub(super) feature: NaturalFeatureState,
    pub(super) environment: EnvironmentProfile,
    pub(super) investigation_job_id: String,
    pub(super) investigation_clock_id: String,
}

pub(super) fn natural_investigation_job_id(location_id: u64) -> String {
    format!("natural-investigation:{location_id}")
}

pub(super) fn natural_investigation_clock_id(location_id: u64) -> String {
    format!("natural-investigation:{location_id}:survey")
}

pub(super) fn natural_investigation_danger_clock_id(location_id: u64) -> String {
    format!("natural-investigation:{location_id}:signs-fade")
}

pub(super) fn stable_natural_hash(value: &str) -> u64 {
    value.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x1000_0000_01b3)
    })
}

pub(super) fn approved_buildings(kind: NaturalResourceKind) -> Vec<BuildingArchetype> {
    match kind {
        NaturalResourceKind::FishRichWater => vec![
            BuildingArchetype::Fishery,
            BuildingArchetype::Smokehouse,
            BuildingArchetype::Boathouse,
        ],
        NaturalResourceKind::OreSeam => vec![
            BuildingArchetype::ShallowMine,
            BuildingArchetype::ProspectorsLodge,
        ],
        NaturalResourceKind::ClayBank => {
            vec![BuildingArchetype::Kiln, BuildingArchetype::Pottery]
        }
        NaturalResourceKind::AncientWoodland => vec![
            BuildingArchetype::CarpentersLodge,
            BuildingArchetype::Herbalist,
        ],
        NaturalResourceKind::FastRiver => vec![
            BuildingArchetype::Watermill,
            BuildingArchetype::RiversideWorkshop,
        ],
        NaturalResourceKind::ReliableUplandWind => {
            vec![BuildingArchetype::Windmill, BuildingArchetype::SignalTower]
        }
        NaturalResourceKind::HotSpring => vec![
            BuildingArchetype::Bathhouse,
            BuildingArchetype::HealingHouse,
        ],
        NaturalResourceKind::RichSoil => {
            vec![BuildingArchetype::Orchard, BuildingArchetype::MarketGarden]
        }
        NaturalResourceKind::RareHerbHabitat => vec![
            BuildingArchetype::Apothecary,
            BuildingArchetype::Conservatory,
        ],
        NaturalResourceKind::OldRuins => vec![
            BuildingArchetype::Archive,
            BuildingArchetype::Museum,
            BuildingArchetype::ExpeditionLodge,
        ],
    }
}

pub(super) fn generated_potential_rules(
    environment: &EnvironmentProfile,
) -> Vec<NaturalPotentialRule> {
    if environment
        .hydrology
        .contains(&EnvironmentHydrology::FlowingRiver)
    {
        return vec![NaturalPotentialRule {
            resource_kind: NaturalResourceKind::FishRichWater,
            policy: NaturalPotentialPolicy::Guaranteed,
            weight: 0,
            richness: NaturalRichness::Rich,
            character: NaturalCharacter::Renewable,
            building_archetypes: approved_buildings(NaturalResourceKind::FishRichWater),
            presentation_key: "natural.fish_rich_water.riverside".to_string(),
        }];
    }
    if environment.landforms.contains(&EnvironmentLandform::Upland) {
        return vec![NaturalPotentialRule {
            resource_kind: NaturalResourceKind::ReliableUplandWind,
            policy: NaturalPotentialPolicy::Weighted,
            weight: 6,
            richness: NaturalRichness::Rich,
            character: NaturalCharacter::Enduring,
            building_archetypes: approved_buildings(NaturalResourceKind::ReliableUplandWind),
            presentation_key: "natural.reliable_upland_wind.exposed".to_string(),
        }];
    }
    if environment
        .landforms
        .contains(&EnvironmentLandform::Woodland)
    {
        return vec![NaturalPotentialRule {
            resource_kind: NaturalResourceKind::AncientWoodland,
            policy: NaturalPotentialPolicy::Weighted,
            weight: 5,
            richness: NaturalRichness::Modest,
            character: NaturalCharacter::Renewable,
            building_archetypes: approved_buildings(NaturalResourceKind::AncientWoodland),
            presentation_key: "natural.ancient_woodland.old_growth".to_string(),
        }];
    }
    Vec::new()
}

pub(super) fn interpolated_environment_profile(
    origin: &EnvironmentProfile,
    destination: &EnvironmentProfile,
    index: usize,
    count: usize,
) -> EnvironmentProfile {
    let mut profile = EnvironmentProfile {
        version: origin.version.max(destination.version),
        climate: if (index + 1) * 2 <= count + 1 {
            origin.climate
        } else {
            destination.climate
        },
        landforms: origin
            .landforms
            .iter()
            .chain(destination.landforms.iter())
            .copied()
            .collect(),
        geology: origin
            .geology
            .iter()
            .chain(destination.geology.iter())
            .copied()
            .collect(),
        hydrology: origin
            .hydrology
            .iter()
            .chain(destination.hydrology.iter())
            .copied()
            .collect(),
        anomalies: origin
            .anomalies
            .iter()
            .chain(destination.anomalies.iter())
            .copied()
            .collect(),
    };
    profile.landforms.sort();
    profile.landforms.dedup();
    profile.geology.sort();
    profile.geology.dedup();
    profile.hydrology.sort();
    profile.hydrology.dedup();
    profile.anomalies.sort();
    profile.anomalies.dedup();
    profile
}

pub(super) fn freeze_natural_affordance(
    world_seed: &str,
    location_id: u64,
    environment: EnvironmentProfile,
    rules: Vec<NaturalPotentialRule>,
    source: &str,
    pack_id: &str,
    pack_version: &str,
) -> NaturalAffordanceState {
    let selection_hash = stable_natural_hash(&format!(
        "{world_seed}:{location_id}:{}:{NATURAL_GENERATION_ALGORITHM}",
        environment.version
    ));
    let impossible = rules
        .iter()
        .filter(|rule| rule.policy == NaturalPotentialPolicy::Impossible)
        .map(|rule| rule.resource_kind)
        .collect::<Vec<_>>();
    let mut guaranteed = rules
        .iter()
        .filter(|rule| {
            rule.policy == NaturalPotentialPolicy::Guaranteed
                && !impossible.contains(&rule.resource_kind)
        })
        .collect::<Vec<_>>();
    guaranteed.sort_by_key(|rule| rule.resource_kind);
    let selected_rule = guaranteed.first().copied().or_else(|| {
        let mut weighted = rules
            .iter()
            .filter(|rule| {
                rule.policy == NaturalPotentialPolicy::Weighted
                    && rule.weight > 0
                    && !impossible.contains(&rule.resource_kind)
            })
            .collect::<Vec<_>>();
        weighted.sort_by_key(|rule| rule.resource_kind);
        let total = weighted
            .iter()
            .map(|rule| u64::from(rule.weight))
            .sum::<u64>();
        if total == 0 {
            return None;
        }
        let mut cursor = selection_hash % total;
        weighted.into_iter().find(|rule| {
            if cursor < u64::from(rule.weight) {
                true
            } else {
                cursor -= u64::from(rule.weight);
                false
            }
        })
    });
    let latent_potential = selected_rule.map(|rule| LatentNaturalPotential {
        resource_kind: rule.resource_kind,
        richness: rule.richness,
        character: rule.character,
        building_archetypes: rule.building_archetypes.clone(),
        presentation_key: rule.presentation_key.clone(),
        selection_hash,
    });
    NaturalAffordanceState {
        schema_version: NATURAL_AFFORDANCE_SCHEMA_VERSION,
        location_id,
        environment: environment.clone(),
        latent_potential,
        generation: NaturalGenerationProvenance {
            source: source.to_string(),
            algorithm: NATURAL_GENERATION_ALGORITHM.to_string(),
            world_seed: world_seed.to_string(),
            environment_profile_version: environment.version,
            pack_id: pack_id.to_string(),
            pack_version: pack_version.to_string(),
            provider: "none".to_string(),
            model: "none".to_string(),
        },
        investigation_job_id: natural_investigation_job_id(location_id),
        investigation_clock_id: natural_investigation_clock_id(location_id),
        causal_action_event_seqs: Vec::new(),
        revealed_feature: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;

    fn riverside_profile() -> EnvironmentProfile {
        EnvironmentProfile {
            version: ENVIRONMENT_PROFILE_VERSION,
            climate: EnvironmentClimate::Temperate,
            landforms: vec![EnvironmentLandform::Riverbank],
            geology: vec![EnvironmentGeology::Alluvial],
            hydrology: vec![EnvironmentHydrology::FlowingRiver],
            anomalies: Vec::new(),
        }
    }

    #[test]
    fn generated_riverside_selection_is_typed_deterministic_and_provider_free() {
        let environment = riverside_profile();
        let rules = generated_potential_rules(&environment);
        let first = freeze_natural_affordance(
            "cosyworld.official",
            123_456,
            environment.clone(),
            rules.clone(),
            "generated_environment",
            "cosyworld.core",
            "1.0.0",
        );
        let second = freeze_natural_affordance(
            "cosyworld.official",
            123_456,
            environment,
            rules,
            "generated_environment",
            "cosyworld.core",
            "1.0.0",
        );
        assert_eq!(first, second);
        assert_eq!(
            first.latent_potential.unwrap().resource_kind,
            NaturalResourceKind::FishRichWater
        );
        assert_eq!(first.generation.provider, "none");
    }

    #[test]
    fn impossible_rules_remove_weighted_candidates_without_rerolling() {
        let environment = riverside_profile();
        let rules = vec![
            NaturalPotentialRule {
                resource_kind: NaturalResourceKind::ClayBank,
                policy: NaturalPotentialPolicy::Weighted,
                weight: 10,
                richness: NaturalRichness::Rich,
                character: NaturalCharacter::Finite,
                building_archetypes: approved_buildings(NaturalResourceKind::ClayBank),
                presentation_key: "natural.clay_bank.alluvial".to_string(),
            },
            NaturalPotentialRule {
                resource_kind: NaturalResourceKind::ClayBank,
                policy: NaturalPotentialPolicy::Impossible,
                weight: 0,
                richness: NaturalRichness::default(),
                character: NaturalCharacter::default(),
                building_archetypes: Vec::new(),
                presentation_key: String::new(),
            },
        ];
        let frozen = freeze_natural_affordance(
            "cosyworld.official",
            99,
            environment,
            rules,
            "authored_constraints",
            "fixture",
            "1.0.0",
        );
        assert!(frozen.latent_potential.is_none());
    }

    fn add_test_avatar(runtime: &mut RuntimeWorld, actor_id: u64, kind: u8, location_id: u64) {
        runtime.actors.insert(
            actor_id,
            ActorMeta {
                name: format!("Surveyor {actor_id}"),
                speech_mode: "inference".to_string(),
                title: String::new(),
                description: "A careful surveyor.".to_string(),
            },
        );
        runtime.ensure_actor(
            actor_id,
            kind,
            location_id,
            CwStatBlock {
                strength: 10,
                dexterity: 10,
                constitution: 10,
                intelligence: 14,
                wisdom: 14,
                charisma: 10,
                hp_base: 10,
                level: 1,
            },
        );
    }

    fn committed_check_event(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
        location_id: u64,
        success: bool,
    ) -> EventView {
        let event = EventView {
            seq: runtime.world.next_event_seq,
            type_name: "ability_check.rolled".to_string(),
            success,
            actor_id: Some(actor_id),
            location_id: Some(location_id),
            total: Some(if success { LISTEN_DC as i16 + 4 } else { 1 }),
            dc: Some(LISTEN_DC as i16),
            ..EventView::default()
        };
        runtime.world.next_event_seq += 1;
        runtime.push_projected_event(event.clone());
        event
    }

    fn resolve_investigation_strategy(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
        job_id: &str,
        action_kind: &str,
        strategy_id: &str,
        success: bool,
    ) -> Vec<EventView> {
        let location_id = runtime.actor_by_id(actor_id).unwrap().location_id;
        let intent = runtime
            .job_contribution_intent(actor_id, action_kind, Some(job_id), Some(strategy_id), None)
            .expect("authored natural investigation strategy");
        let check = committed_check_event(runtime, actor_id, location_id, success);
        runtime.resolve_job_contribution(
            &CwAction {
                kind: if action_kind == "study" {
                    CW_ACTION_RULES_STUDY
                } else {
                    CW_ACTION_RULES_SEARCH
                },
                actor_id,
                ability: if action_kind == "study" {
                    3
                } else {
                    LISTEN_ABILITY
                },
                dc: LISTEN_DC,
                ..CwAction::default()
            },
            &[check],
            &intent,
        )
    }

    #[test]
    fn generated_riverside_feature_is_hidden_then_cooperatively_revealed_and_restored() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = runtime.generated_pathway(
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
            2,
        );
        let waypoint_id = pathway.waypoints[0].id;
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_edge(&pathway, RAIN_SOFT_GARDEN_LOCATION_ID, waypoint_id);

        let state = runtime
            .natural_affordances
            .get(&waypoint_id)
            .expect("generated waypoint has one frozen natural affordance");
        assert_eq!(
            state.latent_potential.as_ref().unwrap().resource_kind,
            NaturalResourceKind::FishRichWater
        );
        assert_eq!(state.generation.source, "generated_environment");
        assert_eq!(state.generation.provider, "none");
        let job_id = state.investigation_job_id.clone();
        let clock_id = state.investigation_clock_id.clone();
        let latent_before = state.latent_potential.clone();

        let room_before = serde_json::to_string(&runtime.room_sheet_view(waypoint_id)).unwrap();
        let questions_before =
            serde_json::to_string(&runtime.shared_question_views(waypoint_id, None)).unwrap();
        assert!(!room_before.contains("fish_rich_water"));
        assert!(!room_before.contains("fishery"));
        assert!(!questions_before.contains("fish-rich water"));
        assert!(!questions_before.contains("fishery"));
        assert_eq!(
            runtime.jobs[&job_id].narrated_thresholds.len(),
            3,
            "three increasing knowledge thresholds precede the typed feature"
        );

        add_test_avatar(&mut runtime, 5000, CW_ACTOR_HUMAN, waypoint_id);
        add_test_avatar(&mut runtime, 5001, CW_ACTOR_NPC, waypoint_id);
        add_test_avatar(&mut runtime, 5002, CW_ACTOR_HUMAN, waypoint_id);
        runtime.callings.insert(
            5000,
            CallingState {
                actor_id: 5000,
                statement: EXPLORER_CALLING_STATEMENT.to_string(),
                source_event_seq: None,
            },
        );
        runtime.actors.get_mut(&5000).unwrap().title = "River Reader".to_string();

        let failed = resolve_investigation_strategy(
            &mut runtime,
            5002,
            &job_id,
            "check",
            "natural-investigation-check",
            false,
        );
        assert!(!failed
            .iter()
            .any(|event| event.type_name == "natural_feature.revealed"));
        assert_eq!(runtime.clocks[&clock_id].filled, 0);
        assert_eq!(
            runtime.natural_affordances[&waypoint_id].latent_potential,
            latent_before
        );
        assert!(
            runtime
                .job_contribution_intent(
                    5002,
                    "check",
                    Some(&job_id),
                    Some("natural-investigation-check"),
                    None,
                )
                .is_none(),
            "the failed once-scoped action cannot reroll"
        );

        let item_count_before = runtime.world.item_count;
        let first = resolve_investigation_strategy(
            &mut runtime,
            5000,
            &job_id,
            "check",
            "natural-investigation-check",
            true,
        );
        assert_eq!(runtime.clocks[&clock_id].filled, 2);
        assert_eq!(
            first
                .iter()
                .filter(|event| event.type_name == "clock.threshold")
                .count(),
            2
        );
        let second = resolve_investigation_strategy(
            &mut runtime,
            5001,
            &job_id,
            "study",
            "natural-investigation-study",
            true,
        );
        assert_eq!(
            runtime.clocks[&clock_id].filled,
            NATURAL_INVESTIGATION_SEGMENTS
        );
        assert_eq!(runtime.job_status(&runtime.jobs[&job_id]), "completed");
        assert_eq!(runtime.world.item_count, item_count_before);

        let reveal = second
            .iter()
            .find(|event| event.type_name == "natural_feature.revealed")
            .expect("clock completion emits typed natural-feature evidence");
        let evidence: serde_json::Value =
            serde_json::from_str(reveal.content.as_deref().unwrap()).unwrap();
        assert_eq!(
            evidence["feature"]["resource_kind"],
            serde_json::Value::String("fish_rich_water".to_string())
        );
        assert_eq!(evidence["environment"]["version"], 1);
        assert_eq!(evidence["feature"]["generation"]["provider"], "none");
        assert_eq!(
            evidence["feature"]["causal_action_event_seqs"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            reveal.caused_by_event_seq,
            runtime.clocks[&clock_id].updated_event_seq
        );
        assert_eq!(
            runtime.eligible_natural_building_archetypes(waypoint_id),
            vec![
                "boathouse".to_string(),
                "fishery".to_string(),
                "smokehouse".to_string()
            ]
        );

        let room_after = serde_json::to_string(&runtime.room_sheet_view(waypoint_id)).unwrap();
        assert!(room_after.contains("fish_rich_water"));
        assert!(room_after.contains("fishery"));
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("natural projection survives snapshot restore");
        assert_eq!(
            restored.natural_affordances[&waypoint_id],
            runtime.natural_affordances[&waypoint_id]
        );
        assert_eq!(
            restored.eligible_natural_building_archetypes(waypoint_id),
            runtime.eligible_natural_building_archetypes(waypoint_id)
        );
    }

    #[test]
    fn authored_natural_investigation_replays_from_the_action_journal() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-natural-affordance-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();

        let mut move_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_MOVE,
                actor_id: RATI_ACTOR_ID,
                destination_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                ..CwAction::default()
            },
            100,
        )
        .into_player_card();
        move_record.bind_offer_kind("move");
        assert_eq!(runtime.apply_journal_record(&move_record).0, CW_OK);

        let job_id = natural_investigation_job_id(RAIN_SOFT_GARDEN_LOCATION_ID);
        let check_intent = runtime
            .job_contribution_intent(
                RATI_ACTOR_ID,
                "check",
                Some(&job_id),
                Some("natural-investigation-check"),
                None,
            )
            .expect("authored check strategy");
        let mut check_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_SEARCH,
                actor_id: RATI_ACTOR_ID,
                ability: LISTEN_ABILITY,
                dc: LISTEN_DC,
                ..CwAction::default()
            },
            1,
        )
        .into_player_card();
        check_record.bind_offer_kind("check");
        check_record
            .projection_mutations
            .push(ProjectionMutation::ResolveJobContribution {
                intent: check_intent,
            });
        assert_eq!(runtime.apply_journal_record(&check_record).0, CW_OK);

        let study_intent = runtime
            .job_contribution_intent(
                RATI_ACTOR_ID,
                "study",
                Some(&job_id),
                Some("natural-investigation-study"),
                None,
            )
            .expect("authored study strategy");
        let mut study_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_STUDY,
                actor_id: RATI_ACTOR_ID,
                ability: 3,
                dc: LISTEN_DC,
                ..CwAction::default()
            },
            2,
        )
        .into_player_card();
        study_record.bind_offer_kind("study");
        study_record
            .projection_mutations
            .push(ProjectionMutation::ResolveJobContribution {
                intent: study_intent,
            });
        assert_eq!(runtime.apply_journal_record(&study_record).0, CW_OK);

        append_action_journal(&path, &move_record).unwrap();
        append_action_journal(&path, &check_record).unwrap();
        append_action_journal(&path, &study_record).unwrap();
        let replayed =
            RuntimeWorld::from_action_journal(&path).expect("natural investigation journal replay");
        assert_eq!(
            replayed.natural_affordances[&RAIN_SOFT_GARDEN_LOCATION_ID],
            runtime.natural_affordances[&RAIN_SOFT_GARDEN_LOCATION_ID]
        );
        assert_eq!(
            replayed.clocks[&natural_investigation_clock_id(RAIN_SOFT_GARDEN_LOCATION_ID)].filled,
            NATURAL_INVESTIGATION_SEGMENTS
        );
        assert!(replayed.event_log.iter().any(|event| {
            event.type_name == "natural_feature.revealed"
                && event.location_id == Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        }));
        let _ = fs::remove_file(path);
    }
}
