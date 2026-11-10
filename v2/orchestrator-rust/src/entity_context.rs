use super::*;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorldEntityKind {
    #[default]
    Avatar,
    Item,
    Location,
}

impl WorldEntityKind {}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub(crate) struct WorldEntityRef {
    pub(crate) kind: WorldEntityKind,
    pub(crate) id: u64,
}

impl WorldEntityRef {}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct WorldEntityMemoryAtom {
    pub(crate) source_event_seq: u64,
    pub(crate) kind: String,
    pub(crate) text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) location_id: Option<u64>,
    #[serde(default)]
    pub(crate) salience: u8,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct AvatarLevelIdentity {
    #[serde(default)]
    pub(crate) persona: String,
    #[serde(default)]
    pub(crate) appearance: String,
    #[serde(default)]
    pub(crate) continuity: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct WorldEntityMemoryState {
    #[serde(default)]
    pub(crate) use_count: u32,
    #[serde(default)]
    pub(crate) meaningful_event_count: u32,
    #[serde(default)]
    pub(crate) visited_location_ids: BTreeSet<u64>,
    #[serde(default)]
    pub(crate) memories: Vec<WorldEntityMemoryAtom>,
    #[serde(default)]
    pub(crate) descriptions_by_level: BTreeMap<u8, String>,
    #[serde(default)]
    pub(crate) identity_by_level: BTreeMap<u8, AvatarLevelIdentity>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EntityGoalKind {
    #[default]
    AvatarPossessesItem,
    LocationPossessesItem,
    ItemCollectsLocationHistory,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EntityGoalStatus {
    #[default]
    Active,
    Completed,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct EntityGoalState {
    pub(crate) id: String,
    pub(crate) owner: WorldEntityRef,
    pub(crate) kind: EntityGoalKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) avatar_id: Option<u64>,
    pub(crate) item_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) target_distinct_locations: Option<u8>,
    pub(crate) motivation: String,
    pub(crate) status: EntityGoalStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_event_seq: Option<u64>,
}

impl RuntimeWorld {}
