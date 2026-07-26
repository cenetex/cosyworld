use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub(super) enum JobReward {
    Label(String),
    Details {
        #[serde(default)]
        label: String,
        #[serde(default)]
        orbs: i32,
    },
}

impl JobReward {
    pub(super) fn label(&self) -> &str {
        match self {
            JobReward::Label(label) => label,
            JobReward::Details { label, .. } => label,
        }
    }

    pub(super) fn orbs(&self) -> i32 {
        match self {
            JobReward::Label(_) => 0,
            JobReward::Details { orbs, .. } => *orbs,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct JobState {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) stakes: String,
    pub(super) location_ids: Vec<u64>,
    pub(super) participant_ids: Vec<u64>,
    pub(super) progress_clock_id: String,
    pub(super) danger_clock_id: String,
    #[serde(default)]
    pub(super) status: String,
    pub(super) reward: JobReward,
    pub(super) consequence: String,
    #[serde(default)]
    pub(super) memory_summary: String,
    #[serde(default)]
    pub(super) action_copy: JobActionCopy,
    #[serde(default)]
    pub(super) contribution_schema_version: u8,
    #[serde(default)]
    pub(super) contribution_strategies: Vec<JobContributionStrategy>,
    #[serde(default)]
    pub(super) narrated_thresholds: Vec<JobNarratedThreshold>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) delivery: Option<DeliveryJobSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) loot: Option<JobLootSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) focused_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) focused_encounter: Option<FocusedJobEncounterState>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct DeliveryJobSpec {
    pub(super) resource: String,
    pub(super) origin_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) created_world_tick: u64,
    pub(super) updated_world_tick: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct JobActionCopy {
    #[serde(default)]
    pub(super) label: String,
    #[serde(default)]
    pub(super) summary: String,
}
