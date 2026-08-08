//! The kernel boundary.
//!
//! `KernelPort` mirrors the semantics of `cw_world_apply` in
//! `v2/core-c`: action + caller-supplied seed in, status + events out. The
//! kernel owns all rule authority; the spine never decides whether an action
//! succeeds. A production adapter wraps the real FFI; `FakeKernel` is a small
//! deterministic world used to prove replay, snapshot, and pipeline behavior.

use serde::{Deserialize, Serialize};

use crate::types::{Action, ActionKind, KernelEvent, KernelStatus};

pub struct KernelOutcome {
    pub status: KernelStatus,
    pub events: Vec<KernelEvent>,
}

pub trait KernelPort: Send {
    /// Apply one action deterministically. `seed` is supplied by the caller
    /// and journaled, so replay reproduces identical outcomes. `advance_tick`
    /// mirrors `cw_world_apply_with_tick`: the caller owns played-time.
    fn apply(&mut self, action: &Action, seed: u64, advance_tick: bool) -> KernelOutcome;
    fn tick(&self) -> u64;
    /// Kernel presence for a room. Turn rotation derives from this, never
    /// from separately stored membership, so replay reproduces it exactly.
    fn room_occupants(&self, room_id: u64) -> Vec<u64>;
    /// Serializable full state for snapshots. Must round-trip via `restore`.
    fn snapshot(&self) -> serde_json::Value;
    fn restore(&mut self, snapshot: &serde_json::Value) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Holder {
    Actor(u64),
    Location(u64),
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct ActorState {
    location_id: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ItemState {
    holder: Holder,
}

/// A minimal deterministic world: actors in locations, items held by actors
/// or resting on location floors. Rule outcomes depend only on state, the
/// action, and the seed — never on wall-clock time or ambient randomness.
#[derive(Default)]
pub struct FakeKernel {
    tick: u64,
    locations: Vec<u64>,
    actors: std::collections::BTreeMap<u64, ActorState>,
    items: std::collections::BTreeMap<u64, ItemState>,
}

#[derive(Serialize, Deserialize)]
struct FakeKernelSnapshot {
    tick: u64,
    locations: Vec<u64>,
    actors: std::collections::BTreeMap<u64, ActorState>,
    items: std::collections::BTreeMap<u64, ItemState>,
}

impl FakeKernel {
    pub fn new(locations: &[u64]) -> Self {
        Self {
            locations: locations.to_vec(),
            ..Self::default()
        }
    }

    pub fn add_actor(&mut self, actor_id: u64, location_id: u64) {
        assert!(self.locations.contains(&location_id), "unknown location");
        self.actors.insert(actor_id, ActorState { location_id });
    }

    pub fn add_item(&mut self, item_id: u64, holder: Holder) {
        self.items.insert(item_id, ItemState { holder });
    }

    pub fn actor_location(&self, actor_id: u64) -> Option<u64> {
        self.actors.get(&actor_id).map(|a| a.location_id)
    }

    pub fn item_holder(&self, item_id: u64) -> Option<Holder> {
        self.items.get(&item_id).map(|i| i.holder)
    }

    fn actor_loc(&self, action: &Action) -> Result<u64, KernelStatus> {
        self.actors
            .get(&action.actor_id)
            .map(|a| a.location_id)
            .ok_or(KernelStatus::NotFound)
    }
}

impl KernelPort for FakeKernel {
    fn apply(&mut self, action: &Action, seed: u64, advance_tick: bool) -> KernelOutcome {
        let location_id = match self.actor_loc(action) {
            Ok(loc) => loc,
            Err(status) => {
                return KernelOutcome {
                    status,
                    events: Vec::new(),
                }
            }
        };
        let actor_id = action.actor_id;
        let (status, kind, content) = match &action.kind {
            ActionKind::Say { text } => (
                KernelStatus::Ok,
                "speech",
                serde_json::json!({ "text": text }),
            ),
            ActionKind::Move { destination } => {
                if !self.locations.contains(destination) {
                    (
                        KernelStatus::NotFound,
                        "move_rejected",
                        serde_json::json!({}),
                    )
                } else {
                    self.actors
                        .get_mut(&actor_id)
                        .expect("actor checked above")
                        .location_id = *destination;
                    (
                        KernelStatus::Ok,
                        "move",
                        serde_json::json!({ "from": location_id, "to": destination }),
                    )
                }
            }
            ActionKind::PickUp { item } => match self.items.get(item).map(|i| i.holder) {
                None => (
                    KernelStatus::NotFound,
                    "item_missing",
                    serde_json::json!({}),
                ),
                Some(Holder::Location(loc)) if loc == location_id => {
                    self.items.get_mut(item).expect("item checked above").holder =
                        Holder::Actor(actor_id);
                    (
                        KernelStatus::Ok,
                        "item_taken",
                        serde_json::json!({ "item": item }),
                    )
                }
                Some(_) => (
                    KernelStatus::Rule,
                    "item_out_of_reach",
                    serde_json::json!({}),
                ),
            },
            ActionKind::Drop { item } => match self.items.get(item).map(|i| i.holder) {
                Some(Holder::Actor(holder)) if holder == actor_id => {
                    self.items.get_mut(item).expect("item checked above").holder =
                        Holder::Location(location_id);
                    (
                        KernelStatus::Ok,
                        "item_dropped",
                        serde_json::json!({ "item": item }),
                    )
                }
                Some(_) => (KernelStatus::Rule, "item_not_held", serde_json::json!({})),
                None => (
                    KernelStatus::NotFound,
                    "item_missing",
                    serde_json::json!({}),
                ),
            },
            ActionKind::Search { item } => {
                // The seed is the only source of randomness; journaling it
                // makes the outcome replayable bit-for-bit.
                let found = seed.is_multiple_of(2);
                (
                    KernelStatus::Ok,
                    "search",
                    serde_json::json!({ "found": found, "item": item }),
                )
            }
            ActionKind::Pass => (KernelStatus::Ok, "pass", serde_json::json!({})),
        };
        if !status.is_ok() {
            // Mirror the C kernel's reject(): a rule violation produces a
            // public rejection event (the append-only rejection contract);
            // played time does not advance.
            return KernelOutcome {
                status,
                events: vec![KernelEvent {
                    kind: "rule.rejected".to_string(),
                    actor_id,
                    location_id,
                    content: serde_json::json!({ "reason": kind }),
                }],
            };
        }
        if advance_tick {
            self.tick = self.tick.saturating_add(1);
        }
        let location_id = self
            .actors
            .get(&actor_id)
            .map(|a| a.location_id)
            .unwrap_or(location_id);
        KernelOutcome {
            status,
            events: vec![KernelEvent {
                kind: kind.to_string(),
                actor_id,
                location_id,
                content,
            }],
        }
    }

    fn tick(&self) -> u64 {
        self.tick
    }

    fn room_occupants(&self, room_id: u64) -> Vec<u64> {
        self.actors
            .iter()
            .filter(|(_, actor)| actor.location_id == room_id)
            .map(|(id, _)| *id)
            .collect()
    }

    fn snapshot(&self) -> serde_json::Value {
        serde_json::to_value(FakeKernelSnapshot {
            tick: self.tick,
            locations: self.locations.clone(),
            actors: self.actors.clone(),
            items: self
                .items
                .iter()
                .map(|(id, item)| {
                    (
                        *id,
                        ItemState {
                            holder: item.holder,
                        },
                    )
                })
                .collect(),
        })
        .expect("fake kernel snapshot serializes")
    }

    fn restore(&mut self, snapshot: &serde_json::Value) -> Result<(), String> {
        let snap: FakeKernelSnapshot =
            serde_json::from_value(snapshot.clone()).map_err(|e| e.to_string())?;
        self.tick = snap.tick;
        self.locations = snap.locations;
        self.actors = snap.actors;
        self.items = snap.items;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kernel() -> FakeKernel {
        let mut k = FakeKernel::new(&[1, 2]);
        k.add_actor(7, 1);
        k.add_item(50, Holder::Location(1));
        k
    }

    #[test]
    fn pickup_then_drop_round_trips_holder() {
        let mut k = kernel();
        let take = k.apply(
            &Action {
                actor_id: 7,
                kind: ActionKind::PickUp { item: 50 },
            },
            1,
            true,
        );
        assert!(take.status.is_ok());
        assert_eq!(k.item_holder(50), Some(Holder::Actor(7)));
        let drop = k.apply(
            &Action {
                actor_id: 7,
                kind: ActionKind::Drop { item: 50 },
            },
            2,
            true,
        );
        assert!(drop.status.is_ok());
        assert_eq!(k.item_holder(50), Some(Holder::Location(1)));
        assert_eq!(k.tick(), 2);
    }

    #[test]
    fn out_of_reach_pickup_is_public_rule_rejection() {
        let mut k = kernel();
        let out = k.apply(
            &Action {
                actor_id: 7,
                kind: ActionKind::PickUp { item: 999 },
            },
            1,
            true,
        );
        assert_eq!(out.status, KernelStatus::NotFound);
        assert_eq!(out.events.len(), 1);
        assert_eq!(out.events[0].kind, "rule.rejected");
        assert_eq!(k.tick(), 0, "rejected actions never advance played time");
    }

    #[test]
    fn unknown_actor_is_invalid_class_without_events() {
        let mut k = kernel();
        let out = k.apply(
            &Action {
                actor_id: 999,
                kind: ActionKind::Pass,
            },
            1,
            true,
        );
        assert_eq!(out.status, KernelStatus::NotFound);
        assert!(
            out.events.is_empty(),
            "invalid input produces no public event"
        );
    }

    #[test]
    fn search_outcome_is_a_pure_function_of_seed() {
        let mut a = kernel();
        let mut b = kernel();
        let act = Action {
            actor_id: 7,
            kind: ActionKind::Search { item: 60 },
        };
        let ra = a.apply(&act, 41, true);
        let rb = b.apply(&act, 41, true);
        assert_eq!(ra.events, rb.events);
        assert_eq!(ra.events[0].content["found"], serde_json::json!(false));
    }
}
