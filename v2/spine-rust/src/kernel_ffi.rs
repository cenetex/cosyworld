//! `FfiKernel`: a `KernelPort` over the real C kernel (`v2/core-c`).
//!
//! The struct layouts below hand-mirror `cosy_kernel.h`, the same approach as
//! `v2/orchestrator-rust/src/kernel.rs`. Drift is guarded from both sides:
//! the header `static_assert`s `cw_item`, and the tests here assert every
//! mirrored size against `sizeof()` exported from the compiled C shim, plus
//! the kernel version constant.
//!
//! Authority stays in C. This module only translates the spine's action
//! vocabulary into `cw_action`, supplies the journaled seed, and translates
//! `cw_event` back out. The one exception is `Pass`, a projection-level verb
//! per the kernel-promotion policy: it advances played time directly, which
//! the ABI explicitly delegates to the caller ("Player-card callers own the
//! tick").

#![allow(non_camel_case_types)]
#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::kernel::{KernelOutcome, KernelPort};
use crate::types::{Action, ActionKind, KernelEvent, KernelStatus};

pub const CW_KERNEL_VERSION: u32 = 16;

pub const CW_MAX_ACTORS: usize = 2048;
pub const CW_MAX_ITEMS: usize = 2048;
pub const CW_MAX_LOCATIONS: usize = 2048;
pub const CW_MAX_EXITS: usize = 4096;
pub const CW_MAX_EVENTS: usize = 256;
pub const CW_MAX_EVOLUTION_TRACKS: usize = 128;
pub const CW_MAX_EVOLUTION_REQUIREMENTS: usize = 4;
pub const CW_MAX_COMBAT_ENCOUNTERS: usize = 32;
pub const CW_MAX_COMBAT_PARTICIPANTS: usize = 16;
pub const CW_MAX_GATES: usize = 32;
pub const CW_MAX_GATE_METHOD_RECORDS: usize = 64;
pub const CW_MAX_GATE_PREDICATE_RECORDS: usize = 256;
pub const CW_MAX_GATE_ACTOR_STATES: usize = 128;
pub const CW_MAX_GATE_CLAIMS: usize = 128;
pub const CW_MAX_GATE_FACTS: usize = 8;

pub const CW_OK: u32 = 0;
pub const CW_ERR_INVALID: u32 = 1;
pub const CW_ERR_FULL: u32 = 2;
pub const CW_ERR_NOT_FOUND: u32 = 3;
pub const CW_ERR_RULE: u32 = 4;

pub const CW_ACTOR_HUMAN: u8 = 1;
pub const CW_ACTOR_STATUS_ACTIVE: u8 = 1;

pub const CW_ACTION_CREATE_ACTOR: u8 = 1;
pub const CW_ACTION_SAY: u8 = 2;
pub const CW_ACTION_MOVE: u8 = 3;
pub const CW_ACTION_PICK_UP_ITEM: u8 = 5;
pub const CW_ACTION_DROP_ITEM: u8 = 11;
pub const CW_ACTION_SEARCH: u8 = 13;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwStatBlock {
    pub strength: i8,
    pub dexterity: i8,
    pub constitution: i8,
    pub intelligence: i8,
    pub wisdom: i8,
    pub charisma: i8,
    pub hp_base: i16,
    pub level: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwActor {
    pub id: u64,
    pub kind: u8,
    pub status: u8,
    pub reserved: u16,
    pub location_id: u64,
    pub stats: CwStatBlock,
    pub damage: i16,
    pub conditions: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwLocation {
    pub id: u64,
    pub flags: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwExit {
    pub from_location_id: u64,
    pub to_location_id: u64,
    pub flags: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwItem {
    pub id: u64,
    pub kind: u8,
    pub charges: u8,
    pub weight_tenths: u16,
    pub container_capacity_tenths: u16,
    pub size_class: u8,
    pub role: u8,
    pub zone: u8,
    pub reserved: u8,
    pub max_charges: u8,
    pub recovery: u8,
    pub recovery_zone: u8,
    #[serde(default, alias = "reserved2")]
    pub policy_flags: u8,
    pub location_id: u64,
    pub holder_actor_id: u64,
    pub container_item_id: u64,
    pub held_since_tick: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwGateFact {
    pub subject_id: u64,
    pub fact_id: u64,
    pub value: u64,
    pub source_version: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwGatePredicate {
    pub kind: u8,
    pub amount: u8,
    pub reserved: u16,
    pub reserved2: u32,
    pub subject_id: u64,
    pub target_id: u64,
    pub fact_id: u64,
    pub expected_value: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwGateMethod {
    pub id: u64,
    pub predicate_start: usize,
    pub predicate_count: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwGate {
    pub id: u64,
    pub version: u64,
    pub descriptor_version: u32,
    pub target_kind: u8,
    pub scope: u8,
    pub state: u8,
    pub compatibility: u8,
    pub from_location_id: u64,
    pub to_location_id: u64,
    pub target_item_id: u64,
    pub method_start: usize,
    pub method_count: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwGateActorState {
    pub gate_id: u64,
    pub actor_id: u64,
    pub version: u64,
    pub state: u8,
    pub reserved: [u8; 7],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwGateClaim {
    pub id: u64,
    pub gate_id: u64,
    pub actor_id: u64,
    pub item_id: u64,
    pub method_id: u64,
    pub transition: u8,
    pub reserved: [u8; 7],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwProjectPushInput {
    pub base_progress: u8,
    pub prepared_bonus_progress: u8,
    pub prepared: u8,
    pub evidence_count: u8,
    pub location_count: u8,
    pub remaining_progress: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwRestInput {
    pub requested_grade: u8,
    pub entitled_grade: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CwThresholdInput {
    pub gate_id: u64,
    pub method_id: u64,
    pub claim_id: u64,
    pub expected_gate_version: u64,
    pub expected_access_revision: u64,
    pub expected_evidence_digest: u64,
    pub fact_count: usize,
    pub facts: [CwGateFact; CW_MAX_GATE_FACTS],
    pub transition: u8,
    pub reserved: [u8; 7],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CwAction {
    pub kind: u8,
    pub ability: u8,
    pub dc: u16,
    pub actor_id: u64,
    pub target_actor_id: u64,
    pub location_id: u64,
    pub destination_location_id: u64,
    pub content_id: u64,
    pub item_id: u64,
    pub target_item_id: u64,
    pub output_item_id: u64,
    pub output_target_id: u64,
    pub modifier: i16,
    pub output_target_kind: u8,
    pub output_item_kind: u8,
    pub output_item_charges: u8,
    pub roll_mode: u8,
    pub item_disposition: u8,
    pub target_item_disposition: u8,
    pub reserved: u16,
    pub output_item_weight_tenths: u16,
    pub output_container_capacity_tenths: u16,
    pub output_item_size_class: u8,
    pub output_item_role: u8,
    pub reserved2: u16,
    pub project_push: CwProjectPushInput,
    pub rest: CwRestInput,
    pub threshold: CwThresholdInput,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwEvent {
    pub seq: u64,
    pub type_: u8,
    pub success: u8,
    pub reason: u16,
    pub actor_id: u64,
    pub target_actor_id: u64,
    pub location_id: u64,
    pub destination_location_id: u64,
    pub content_id: u64,
    pub item_id: u64,
    pub target_item_id: u64,
    pub raw_roll: i16,
    pub modifier: i16,
    pub total: i16,
    pub dc: i16,
    pub damage: i16,
    pub current_hp: i16,
    pub ability: u8,
    pub gate_transition: u8,
    pub reserved: u16,
    pub gate_evidence_mask: u32,
    pub gate_id: u64,
    pub gate_method_id: u64,
    pub gate_claim_id: u64,
    pub gate_version: u64,
    pub access_revision: u64,
    pub gate_evidence_digest: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CwEventBuffer {
    pub count: usize,
    pub events: [CwEvent; CW_MAX_EVENTS],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwEvolutionRequirement {
    pub item_id: u64,
    pub target_kind: u8,
    pub reserved: [u8; 7],
    pub target_id: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwEvolutionTrack {
    pub actor_id: u64,
    pub requirement_count: usize,
    pub requirements: [CwEvolutionRequirement; CW_MAX_EVOLUTION_REQUIREMENTS],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwCombatParticipant {
    pub actor_id: u64,
    pub side: u8,
    pub flags: u8,
    pub reserved: u16,
    pub initiative: i16,
    pub reserved2: u16,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwCombatEncounter {
    pub id: u64,
    pub location_id: u64,
    pub status: u8,
    pub current_index: u8,
    pub round: u16,
    pub reserved: u32,
    pub participant_count: usize,
    pub participants: [CwCombatParticipant; CW_MAX_COMBAT_PARTICIPANTS],
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CwWorld {
    pub version: u32,
    pub tick: u64,
    pub next_event_seq: u64,
    pub actor_count: usize,
    pub item_count: usize,
    pub location_count: usize,
    pub exit_count: usize,
    pub evolution_track_count: usize,
    pub actors: [CwActor; CW_MAX_ACTORS],
    pub items: [CwItem; CW_MAX_ITEMS],
    pub locations: [CwLocation; CW_MAX_LOCATIONS],
    pub exits: [CwExit; CW_MAX_EXITS],
    pub evolution_tracks: [CwEvolutionTrack; CW_MAX_EVOLUTION_TRACKS],
    pub combat_encounter_count: usize,
    pub combat_encounters: [CwCombatEncounter; CW_MAX_COMBAT_ENCOUNTERS],
    pub access_revision: u64,
    pub gate_count: usize,
    pub gates: [CwGate; CW_MAX_GATES],
    pub gate_method_count: usize,
    pub gate_methods: [CwGateMethod; CW_MAX_GATE_METHOD_RECORDS],
    pub gate_predicate_count: usize,
    pub gate_predicates: [CwGatePredicate; CW_MAX_GATE_PREDICATE_RECORDS],
    pub gate_actor_state_count: usize,
    pub gate_actor_states: [CwGateActorState; CW_MAX_GATE_ACTOR_STATES],
    pub gate_claim_count: usize,
    pub gate_claims: [CwGateClaim; CW_MAX_GATE_CLAIMS],
}

extern "C" {
    fn cw_world_init(world: *mut CwWorld);
    fn cw_seed_cosy_cottage(world: *mut CwWorld, out_events: *mut CwEventBuffer) -> u32;
    fn cw_world_apply_with_tick(
        world: *mut CwWorld,
        action: *const CwAction,
        seed: u64,
        advance_tick: u8,
        out_events: *mut CwEventBuffer,
    ) -> u32;
    fn cw_event_type_name(type_: u8) -> *const std::os::raw::c_char;

    fn cw_spine_kernel_version() -> u32;
    fn cw_spine_sizeof_world() -> usize;
    fn cw_spine_sizeof_action() -> usize;
    fn cw_spine_sizeof_event() -> usize;
    fn cw_spine_sizeof_event_buffer() -> usize;
    fn cw_spine_sizeof_actor() -> usize;
    fn cw_spine_sizeof_item() -> usize;
    fn cw_spine_sizeof_location() -> usize;
    fn cw_spine_sizeof_exit() -> usize;
    fn cw_spine_sizeof_gate() -> usize;
    fn cw_spine_sizeof_evolution_track() -> usize;
    fn cw_spine_sizeof_combat_encounter() -> usize;
}

/// Allocate a zeroed `T` directly on the heap. `CwWorld` is far too large to
/// build on the stack first (the live orchestrator overflowed the main-thread
/// stack exactly this way before boxing).
fn alloc_zeroed_box<T>() -> Box<T> {
    let layout = std::alloc::Layout::new::<T>();
    assert!(layout.size() > 0);
    let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
    assert!(
        !ptr.is_null(),
        "allocation failed for {} bytes",
        layout.size()
    );
    unsafe { Box::from_raw(ptr.cast::<T>()) }
}

fn map_status(status: u32) -> KernelStatus {
    match status {
        CW_OK => KernelStatus::Ok,
        CW_ERR_FULL => KernelStatus::Full,
        CW_ERR_NOT_FOUND => KernelStatus::NotFound,
        CW_ERR_RULE => KernelStatus::Rule,
        _ => KernelStatus::Invalid,
    }
}

fn event_kind_name(type_: u8) -> String {
    unsafe {
        let ptr = cw_event_type_name(type_);
        if ptr.is_null() {
            return format!("event_{type_}");
        }
        std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

#[derive(Serialize, Deserialize)]
struct FfiKernelSnapshot {
    tick: u64,
    next_event_seq: u64,
    actors: Vec<CwActor>,
    items: Vec<CwItem>,
    locations: Vec<CwLocation>,
    exits: Vec<CwExit>,
    evolution_tracks: Vec<CwEvolutionTrack>,
    combat_encounters: Vec<CwCombatEncounter>,
    access_revision: u64,
    gates: Vec<CwGate>,
    gate_methods: Vec<CwGateMethod>,
    gate_predicates: Vec<CwGatePredicate>,
    gate_actor_states: Vec<CwGateActorState>,
    gate_claims: Vec<CwGateClaim>,
    /// The SAY content table is adapter state, not kernel state; it snapshots
    /// alongside so replay interns identical content ids.
    content: BTreeMap<u64, String>,
    next_content_id: u64,
}

/// A `KernelPort` driving the production C kernel.
pub struct FfiKernel {
    world: Box<CwWorld>,
    content: BTreeMap<u64, String>,
    next_content_id: u64,
}

impl FfiKernel {
    /// An initialized, empty world (`cw_world_init`).
    pub fn new() -> Self {
        let mut world: Box<CwWorld> = alloc_zeroed_box();
        unsafe { cw_world_init(world.as_mut()) };
        Self {
            world,
            content: BTreeMap::new(),
            next_content_id: 1,
        }
    }

    /// The C demo world (`cw_seed_cosy_cottage`): 10 locations, 5 residents,
    /// 7 items, 24 exits. Boot path for adapter tests until content-load
    /// parity arrives.
    pub fn seed_cosy_cottage() -> Self {
        let mut kernel = Self::new();
        let mut events: Box<CwEventBuffer> = alloc_zeroed_box();
        let status = unsafe { cw_seed_cosy_cottage(kernel.world.as_mut(), events.as_mut()) };
        assert_eq!(status, CW_OK, "cw_seed_cosy_cottage failed: {status}");
        kernel
    }

    /// Create a human actor through the kernel's own action path
    /// (`CW_ACTION_CREATE_ACTOR`); stats are kernel-generated from the seed.
    /// This is the sanctioned content-load/character-creation entry point.
    pub fn create_player(&mut self, actor_id: u64, location_id: u64, seed: u64) -> KernelStatus {
        let action = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id,
            location_id,
            ..CwAction::default()
        };
        let mut events: Box<CwEventBuffer> = alloc_zeroed_box();
        let status = unsafe {
            cw_world_apply_with_tick(self.world.as_mut(), &action, seed, 0, events.as_mut())
        };
        map_status(status)
    }

    pub fn actor_count(&self) -> usize {
        self.world.actor_count
    }

    fn actor_location(&self, actor_id: u64) -> Option<u64> {
        self.world.actors[..self.world.actor_count]
            .iter()
            .find(|a| a.id == actor_id)
            .map(|a| a.location_id)
    }

    fn intern_content(&mut self, text: &str) -> u64 {
        if let Some((id, _)) = self.content.iter().find(|(_, t)| t.as_str() == text) {
            return *id;
        }
        let id = self.next_content_id;
        self.next_content_id += 1;
        self.content.insert(id, text.to_string());
        id
    }

    fn translate(&mut self, action: &Action) -> Option<CwAction> {
        let base = CwAction {
            actor_id: action.actor_id,
            location_id: self.actor_location(action.actor_id).unwrap_or(0),
            ..CwAction::default()
        };
        match &action.kind {
            ActionKind::Say { text } => {
                let content_id = self.intern_content(text);
                Some(CwAction {
                    kind: CW_ACTION_SAY,
                    content_id,
                    ..base
                })
            }
            ActionKind::Move { destination } => Some(CwAction {
                kind: CW_ACTION_MOVE,
                destination_location_id: *destination,
                ..base
            }),
            ActionKind::PickUp { item } => Some(CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                item_id: *item,
                ..base
            }),
            ActionKind::Drop { item } => Some(CwAction {
                kind: CW_ACTION_DROP_ITEM,
                item_id: *item,
                ..base
            }),
            ActionKind::Search { item } => Some(CwAction {
                kind: CW_ACTION_SEARCH,
                item_id: *item,
                ..base
            }),
            ActionKind::Pass => None, // projection-level verb; no kernel action
        }
    }

    fn translate_events(&self, buffer: &CwEventBuffer) -> Vec<KernelEvent> {
        buffer.events[..buffer.count]
            .iter()
            .map(|event| KernelEvent {
                kind: event_kind_name(event.type_),
                actor_id: event.actor_id,
                location_id: event.location_id,
                // Full-fidelity event content: every roll carries die, roll,
                // modifier, total, and DC by construction.
                content: serde_json::to_value(event).expect("cw_event serializes"),
            })
            .collect()
    }
}

impl Default for FfiKernel {
    fn default() -> Self {
        Self::new()
    }
}

impl KernelPort for FfiKernel {
    fn apply(&mut self, action: &Action, seed: u64, advance_tick: bool) -> KernelOutcome {
        let Some(cw_action) = self.translate(action) else {
            // Pass: the caller owns the tick, per the ABI contract.
            if advance_tick {
                self.world.tick = self.world.tick.saturating_add(1);
            }
            return KernelOutcome {
                status: KernelStatus::Ok,
                events: vec![KernelEvent {
                    kind: "pass".to_string(),
                    actor_id: action.actor_id,
                    location_id: self.actor_location(action.actor_id).unwrap_or(0),
                    content: serde_json::json!({}),
                }],
            };
        };
        let mut buffer: Box<CwEventBuffer> = alloc_zeroed_box();
        let status = unsafe {
            cw_world_apply_with_tick(
                self.world.as_mut(),
                &cw_action,
                seed,
                u8::from(advance_tick),
                buffer.as_mut(),
            )
        };
        // Rejections carry the kernel's public rule.rejected event; surface
        // it on non-OK status exactly like accepted events.
        KernelOutcome {
            status: map_status(status),
            events: self.translate_events(&buffer),
        }
    }

    fn tick(&self) -> u64 {
        self.world.tick
    }

    fn room_occupants(&self, room_id: u64) -> Vec<u64> {
        // Turn rotation covers players; residents are present but never hold
        // a room turn, matching the live ping/pong eligibility rules.
        self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|a| {
                a.kind == CW_ACTOR_HUMAN
                    && a.status == CW_ACTOR_STATUS_ACTIVE
                    && a.location_id == room_id
            })
            .map(|a| a.id)
            .collect()
    }

    fn snapshot(&self) -> serde_json::Value {
        let world = &*self.world;
        serde_json::to_value(FfiKernelSnapshot {
            tick: world.tick,
            next_event_seq: world.next_event_seq,
            actors: world.actors[..world.actor_count].to_vec(),
            items: world.items[..world.item_count].to_vec(),
            locations: world.locations[..world.location_count].to_vec(),
            exits: world.exits[..world.exit_count].to_vec(),
            evolution_tracks: world.evolution_tracks[..world.evolution_track_count].to_vec(),
            combat_encounters: world.combat_encounters[..world.combat_encounter_count].to_vec(),
            access_revision: world.access_revision,
            gates: world.gates[..world.gate_count].to_vec(),
            gate_methods: world.gate_methods[..world.gate_method_count].to_vec(),
            gate_predicates: world.gate_predicates[..world.gate_predicate_count].to_vec(),
            gate_actor_states: world.gate_actor_states[..world.gate_actor_state_count].to_vec(),
            gate_claims: world.gate_claims[..world.gate_claim_count].to_vec(),
            content: self.content.clone(),
            next_content_id: self.next_content_id,
        })
        .expect("ffi kernel snapshot serializes")
    }

    fn restore(&mut self, snapshot: &serde_json::Value) -> Result<(), String> {
        let snap: FfiKernelSnapshot =
            serde_json::from_value(snapshot.clone()).map_err(|e| e.to_string())?;
        // Fail closed on capacity drift rather than truncating state.
        let checks = [
            (snap.actors.len(), CW_MAX_ACTORS, "actors"),
            (snap.items.len(), CW_MAX_ITEMS, "items"),
            (snap.locations.len(), CW_MAX_LOCATIONS, "locations"),
            (snap.exits.len(), CW_MAX_EXITS, "exits"),
            (
                snap.evolution_tracks.len(),
                CW_MAX_EVOLUTION_TRACKS,
                "evolution_tracks",
            ),
            (
                snap.combat_encounters.len(),
                CW_MAX_COMBAT_ENCOUNTERS,
                "combat_encounters",
            ),
            (snap.gates.len(), CW_MAX_GATES, "gates"),
            (
                snap.gate_methods.len(),
                CW_MAX_GATE_METHOD_RECORDS,
                "gate_methods",
            ),
            (
                snap.gate_predicates.len(),
                CW_MAX_GATE_PREDICATE_RECORDS,
                "gate_predicates",
            ),
            (
                snap.gate_actor_states.len(),
                CW_MAX_GATE_ACTOR_STATES,
                "gate_actor_states",
            ),
            (snap.gate_claims.len(), CW_MAX_GATE_CLAIMS, "gate_claims"),
        ];
        for (len, cap, name) in checks {
            if len > cap {
                return Err(format!(
                    "snapshot {name} count {len} exceeds capacity {cap}"
                ));
            }
        }
        let mut world: Box<CwWorld> = alloc_zeroed_box();
        unsafe { cw_world_init(world.as_mut()) };
        world.tick = snap.tick;
        world.next_event_seq = snap.next_event_seq;
        world.access_revision = snap.access_revision;
        macro_rules! restore_slice {
            ($field:ident, $count:ident, $data:expr) => {
                world.$count = $data.len();
                world.$field[..$data.len()].copy_from_slice(&$data);
            };
        }
        restore_slice!(actors, actor_count, snap.actors);
        restore_slice!(items, item_count, snap.items);
        restore_slice!(locations, location_count, snap.locations);
        restore_slice!(exits, exit_count, snap.exits);
        restore_slice!(
            evolution_tracks,
            evolution_track_count,
            snap.evolution_tracks
        );
        restore_slice!(
            combat_encounters,
            combat_encounter_count,
            snap.combat_encounters
        );
        restore_slice!(gates, gate_count, snap.gates);
        restore_slice!(gate_methods, gate_method_count, snap.gate_methods);
        restore_slice!(gate_predicates, gate_predicate_count, snap.gate_predicates);
        restore_slice!(
            gate_actor_states,
            gate_actor_state_count,
            snap.gate_actor_states
        );
        restore_slice!(gate_claims, gate_claim_count, snap.gate_claims);
        self.world = world;
        self.content = snap.content;
        self.next_content_id = snap.next_content_id;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::{Journal, SqliteJournal};
    use crate::pipeline::Pipeline;
    use crate::projection::{LedgerProjection, ProjectionRegistry};
    use crate::types::{AuthContext, CommitEnvelope, CommitOutcome, KernelStatus, TurnContext};

    #[test]
    fn mirrored_layouts_match_c() {
        unsafe {
            assert_eq!(
                cw_spine_kernel_version(),
                CW_KERNEL_VERSION,
                "kernel version drifted"
            );
            assert_eq!(cw_spine_sizeof_world(), std::mem::size_of::<CwWorld>());
            assert_eq!(cw_spine_sizeof_action(), std::mem::size_of::<CwAction>());
            assert_eq!(cw_spine_sizeof_event(), std::mem::size_of::<CwEvent>());
            assert_eq!(
                cw_spine_sizeof_event_buffer(),
                std::mem::size_of::<CwEventBuffer>()
            );
            assert_eq!(cw_spine_sizeof_actor(), std::mem::size_of::<CwActor>());
            assert_eq!(cw_spine_sizeof_item(), std::mem::size_of::<CwItem>());
            assert_eq!(
                cw_spine_sizeof_location(),
                std::mem::size_of::<CwLocation>()
            );
            assert_eq!(cw_spine_sizeof_exit(), std::mem::size_of::<CwExit>());
            assert_eq!(cw_spine_sizeof_gate(), std::mem::size_of::<CwGate>());
            assert_eq!(
                cw_spine_sizeof_evolution_track(),
                std::mem::size_of::<CwEvolutionTrack>()
            );
            assert_eq!(
                cw_spine_sizeof_combat_encounter(),
                std::mem::size_of::<CwCombatEncounter>()
            );
        }
    }

    /// Boot a seeded world with two players in the cottage (location 1).
    fn boot() -> FfiKernel {
        let mut kernel = FfiKernel::seed_cosy_cottage();
        assert_eq!(kernel.create_player(7, 1, 101), KernelStatus::Ok);
        assert_eq!(kernel.create_player(8, 1, 102), KernelStatus::Ok);
        kernel
    }

    /// `cw_world_init` starts played time at tick 1.
    fn boot_tick() -> u64 {
        1
    }

    #[test]
    fn seeded_world_applies_real_rules() {
        let mut kernel = boot();
        // Item 2001 (potion) rests on the cottage floor; actor 7 picks it up.
        let take = kernel.apply(
            &Action {
                actor_id: 7,
                kind: ActionKind::PickUp { item: 2001 },
            },
            1,
            true,
        );
        assert!(take.status.is_ok(), "kernel rejected a legal pickup");
        assert_eq!(take.events[0].kind, "item.picked_up");

        // A second pickup of the held item is a public rule rejection, and
        // played time does not advance for it.
        let tick_before = kernel.tick();
        let again = kernel.apply(
            &Action {
                actor_id: 8,
                kind: ActionKind::PickUp { item: 2001 },
            },
            2,
            true,
        );
        assert!(!again.status.is_ok());
        assert_eq!(again.events.len(), 1);
        assert_eq!(again.events[0].kind, "rule.rejected");
        assert_eq!(kernel.tick(), tick_before);

        // Room turns see human players, not the NPC residents.
        let occupants = kernel.room_occupants(1);
        assert_eq!(occupants, vec![7, 8]);
    }

    #[test]
    fn determinism_two_kernels_identical_snapshots() {
        let actions = [
            Action {
                actor_id: 7,
                kind: ActionKind::PickUp { item: 2001 },
            },
            Action {
                actor_id: 8,
                kind: ActionKind::Say {
                    text: "the kettle is on".to_string(),
                },
            },
            Action {
                actor_id: 7,
                kind: ActionKind::Move { destination: 2 },
            },
            Action {
                actor_id: 8,
                kind: ActionKind::Search { item: 2005 },
            },
        ];
        let mut a = boot();
        let mut b = boot();
        for (i, action) in actions.iter().enumerate() {
            let seed = 1000 + i as u64;
            let ra = a.apply(action, seed, true);
            let rb = b.apply(action, seed, true);
            assert_eq!(ra.status, rb.status);
            assert_eq!(ra.events, rb.events);
        }
        assert_eq!(a.snapshot(), b.snapshot());
    }

    fn pipeline_with_ffi() -> Pipeline<FfiKernel, SqliteJournal> {
        let mut registry = ProjectionRegistry::default();
        registry.register(Box::new(LedgerProjection::default()));
        Pipeline::new(boot(), SqliteJournal::in_memory().unwrap(), registry)
    }

    fn envelope(actor_id: u64, kind: ActionKind) -> CommitEnvelope {
        let mut env = CommitEnvelope::new(
            Action { actor_id, kind },
            AuthContext {
                actor_id,
                session_verified: true,
                suspended: false,
            },
        );
        env.turn = Some(TurnContext { room_id: 1 });
        env
    }

    /// The golden replay, through the production kernel: journal alone
    /// rebuilds identical C world state.
    #[test]
    fn golden_replay_through_real_kernel() {
        let mut p = pipeline_with_ffi();
        let mut say = envelope(
            7,
            ActionKind::Say {
                text: "first line".to_string(),
            },
        );
        say.turn = None; // speech is turn-exempt
        let commits = vec![
            say,
            envelope(7, ActionKind::PickUp { item: 2001 }),
            envelope(8, ActionKind::Search { item: 2005 }),
            envelope(7, ActionKind::Move { destination: 2 }),
            envelope(8, ActionKind::Pass),
        ];
        for env in commits {
            let outcome = p.commit(env);
            assert!(outcome.is_committed(), "commit failed: {outcome:?}");
        }
        let golden = p.snapshot();
        let records = p.journal().read_from(0, 1000).unwrap();
        assert_eq!(records.len(), 5);

        let mut replayed = pipeline_with_ffi();
        replayed.replay(&records).unwrap();
        assert_eq!(replayed.kernel().snapshot(), golden.kernel);
        assert_eq!(replayed.snapshot().turns, golden.turns);
        assert_eq!(replayed.kernel().tick(), p.kernel().tick());
    }

    #[test]
    fn kernel_rule_rejection_journals_public_rejection() {
        let mut p = pipeline_with_ffi();
        // Item 9999 does not exist: the C kernel rejects with CW_ERR_RULE and
        // a public rule.rejected event (reason: item not found). The
        // rejection journals; played time and the room turn do not advance.
        let outcome = p.commit(envelope(7, ActionKind::PickUp { item: 9999 }));
        match outcome {
            CommitOutcome::Committed {
                kernel_status,
                events,
                ..
            } => {
                assert_eq!(kernel_status, KernelStatus::Rule);
                assert_eq!(events[0].kind, "rule.rejected");
                assert_eq!(events[0].content["reason"], serde_json::json!(5));
            }
            other => panic!("expected journaled rejection, got {other:?}"),
        }
        assert_eq!(p.journal().latest_seq().unwrap(), 1);
        assert_eq!(
            p.kernel().tick(),
            boot_tick(),
            "a rule rejection never advances played time"
        );
        // The turn was not consumed: actor 7 can still play.
        assert!(p.commit(envelope(7, ActionKind::Pass)).is_committed());
    }
}
