use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PossessionJourneyState {
    pub actor_id: u64,
    pub origin_location_id: u64,
    pub current_location_id: u64,
    pub acquisition_event_seq: u64,
    #[serde(default)]
    pub movement_event_seqs: Vec<u64>,
}

impl PossessionJourneyState {}
