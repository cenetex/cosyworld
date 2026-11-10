use serde::{Deserialize, Serialize};

pub(super) const ENVIRONMENT_PROFILE_VERSION: u8 = 1;

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
