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

impl PossessionJourneyState {
    pub(crate) fn new(actor_id: u64, origin_location_id: u64, acquisition_event_seq: u64) -> Self {
        Self {
            actor_id,
            origin_location_id,
            current_location_id: origin_location_id,
            acquisition_event_seq,
            movement_event_seqs: Vec::new(),
        }
    }

    pub(crate) fn record_movement(
        &mut self,
        actor_id: u64,
        source_location_id: u64,
        destination_location_id: u64,
        event_seq: u64,
    ) -> bool {
        if self.actor_id != actor_id || self.current_location_id != source_location_id {
            return false;
        }
        self.current_location_id = destination_location_id;
        self.movement_event_seqs.push(event_seq);
        true
    }

    pub(crate) fn delivery_evidence(
        &self,
        item_id: u64,
        actor_id: u64,
        destination_location_id: u64,
        delivery_event_seq: u64,
    ) -> Option<DeliveryEvidence> {
        if self.actor_id != actor_id
            || self.current_location_id != destination_location_id
            || self.origin_location_id == destination_location_id
            || self.movement_event_seqs.is_empty()
        {
            return None;
        }
        Some(DeliveryEvidence {
            actor_id,
            item_id,
            origin_location_id: self.origin_location_id,
            destination_location_id,
            acquisition_event_seq: self.acquisition_event_seq,
            movement_event_seqs: self.movement_event_seqs.clone(),
            delivery_event_seq,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DeliveryEvidence {
    pub actor_id: u64,
    pub item_id: u64,
    pub origin_location_id: u64,
    pub destination_location_id: u64,
    pub acquisition_event_seq: u64,
    pub movement_event_seqs: Vec<u64>,
    pub delivery_event_seq: u64,
}

impl DeliveryEvidence {
    pub(crate) fn causal_event_seqs(&self) -> Vec<u64> {
        let mut sequences = Vec::with_capacity(self.movement_event_seqs.len() + 2);
        sequences.push(self.acquisition_event_seq);
        sequences.extend(self.movement_event_seqs.iter().copied());
        sequences.push(self.delivery_event_seq);
        sequences
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journey_requires_real_contiguous_movement_before_delivery() {
        let mut journey = PossessionJourneyState::new(7, 10, 100);
        assert!(journey.delivery_evidence(4, 7, 10, 101).is_none());
        assert!(!journey.record_movement(7, 11, 12, 102));
        assert!(journey.record_movement(7, 10, 11, 103));
        let evidence = journey
            .delivery_evidence(4, 7, 11, 104)
            .expect("cross-location delivery has causal evidence");
        assert_eq!(evidence.causal_event_seqs(), vec![100, 103, 104]);
    }

    #[test]
    fn journey_rejects_another_actors_delivery() {
        let mut journey = PossessionJourneyState::new(7, 10, 100);
        assert!(journey.record_movement(7, 10, 11, 101));
        assert!(journey.delivery_evidence(4, 8, 11, 102).is_none());
    }
}
