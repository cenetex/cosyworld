use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnTracker {
    rooms: BTreeMap<u64, u64>,
}

impl TurnTracker {
    pub fn is_current(&self, room_id: u64, occupants: &[u64], actor_id: u64) -> bool {
        self.current(room_id, occupants) == Some(actor_id)
    }

    pub fn current(&self, room_id: u64, occupants: &[u64]) -> Option<u64> {
        let mut sorted = occupants.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        if sorted.is_empty() {
            return None;
        }
        let index = (self.rooms.get(&room_id).copied().unwrap_or(0) as usize) % sorted.len();
        Some(sorted[index])
    }

    pub fn advance(&mut self, room_id: u64, occupant_count: usize) {
        if occupant_count == 0 {
            return;
        }
        let index = self.rooms.entry(room_id).or_insert(0);
        *index = (*index + 1) % occupant_count as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_is_fair_and_serializable() {
        let mut turns = TurnTracker::default();
        let occupants = [2, 1];
        assert!(turns.is_current(10, &occupants, 1), "lowest id holds first");
        turns.advance(10, occupants.len());
        assert!(turns.is_current(10, &occupants, 2));
        assert!(!turns.is_current(10, &occupants, 1));
        turns.advance(10, occupants.len());
        assert_eq!(turns.current(10, &occupants), Some(1));

        let data = serde_json::to_value(&turns).unwrap();
        let restored: TurnTracker = serde_json::from_value(data).unwrap();
        assert_eq!(restored.current(10, &occupants), Some(1));
    }

    #[test]
    fn departure_wraps_the_rotation() {
        let mut turns = TurnTracker::default();
        turns.advance(10, 2);
        assert_eq!(turns.current(10, &[7]), Some(7));
    }
}
