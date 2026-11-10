use super::super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuityState {
    pub(crate) resident_id: u64,
    pub(crate) stable_identity: String,
    pub(crate) relationship_notes_by_actor: BTreeMap<u64, String>,
    pub(crate) memory_atoms: Vec<ResidentContinuityAtom>,
    #[serde(default)]
    pub(crate) beliefs: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) desires: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) promises: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) refusals: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) pending_action: Option<AvatarProposedAction>,
    #[serde(default)]
    pub(crate) pending_planning: Option<ResidentPlanningTrace>,
    #[serde(default)]
    pub(crate) last_planning_disposition: Option<ResidentPlanningDisposition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) recent_voice_shingle_hashes: Vec<u64>,
    #[serde(default)]
    pub(crate) voice_beat_count: u64,
    pub(crate) open_obligations: Vec<String>,
    pub(crate) current_intent: Option<String>,
    pub(crate) last_observed_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuityAtom {
    pub(crate) kind: String,
    pub(crate) subject_id: u64,
    pub(crate) text: String,
    pub(crate) confidence: u8,
    pub(crate) salience: u8,
    pub(crate) observed_tick: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuityNote {
    pub(crate) text: String,
    pub(crate) source: String,
    pub(crate) source_event_seq: Option<u64>,
    pub(crate) confidence: u8,
}

impl ResidentContinuityState {}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuitySnapshot {
    version: u32,
    #[serde(default)]
    worldpack_bundle_hash: String,
    world_tick: u64,
    latest_event_seq: u64,
    residents: BTreeMap<u64, ResidentContinuityState>,
}

impl ResidentContinuitySnapshot {}

impl RuntimeWorld {}

impl RuntimeWorld {}

#[cfg(test)]
mod tests {}
