//! Room-scoped turn rotation.
//!
//! Membership is *not* stored here: turn eligibility derives from kernel
//! presence (which is journaled and replayable), and this tracker holds only
//! a per-room rotation index. That keeps turn state a pure function of the
//! journal — a rejected out-of-turn attempt changes nothing, and replay
//! reproduces the rotation exactly. Only turn-consuming actions consult or
//! advance the tracker.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnTracker {
    /// room_id → rotation index into the room's sorted occupant list.
    rooms: BTreeMap<u64, u64>,
}

impl TurnTracker {
    /// Is `actor_id` the current turn-holder among `occupants` (kernel
    /// presence)? The occupant list is canonicalized (sorted, deduped) so the
    /// rotation is deterministic regardless of kernel iteration order.
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

    /// Advance the rotation after a committed turn-consuming action.
    /// `occupant_count` is the post-commit kernel presence in the room.
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
        let occupants = [2, 1]; // unsorted on purpose
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
        // An occupant leaves; index must stay valid for the remaining room.
        turns.advance(10, 2);
        assert_eq!(turns.current(10, &[7]), Some(7));
    }
}
