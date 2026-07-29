#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

use std::os::raw::c_char;

use serde::{Deserialize, Serialize};

mod rejections;
pub(crate) use rejections::*;

pub const CW_MAX_ACTORS: usize = 512;
pub const CW_MAX_ITEMS: usize = 1024;
pub const CW_MAX_LOCATIONS: usize = 512;
pub const CW_MAX_EXITS: usize = 1024;
pub const CW_MAX_EVENTS: usize = 256;
pub const CW_MAX_EVOLUTION_TRACKS: usize = 128;
pub const CW_MAX_EVOLUTION_REQUIREMENTS: usize = 4;
pub const CW_MAX_COMBAT_ENCOUNTERS: usize = 32;
pub const CW_MAX_COMBAT_PARTICIPANTS: usize = 16;
pub const CW_ITEM_DEFAULT_WEIGHT_TENTHS: u16 = 10;

// Kernel version 9 is reserved by #411 for project-push ABI state.
pub const CW_KERNEL_VERSION: u32 = 11;

pub const CW_OK: u32 = 0;
pub const CW_ERR_INVALID: u32 = 1;
pub const CW_ERR_FULL: u32 = 2;
pub const CW_ERR_NOT_FOUND: u32 = 3;
pub const CW_ERR_RULE: u32 = 4;

pub const CW_ACTOR_HUMAN: u8 = 1;
pub const CW_ACTOR_NPC: u8 = 2;

pub const CW_ACTOR_ACTIVE: u8 = 1;
pub const CW_ACTOR_KNOCKED_OUT: u8 = 2;
pub const CW_ACTOR_DEAD: u8 = 3;

pub const CW_COMBAT_ENCOUNTER_ACTIVE: u8 = 1;
pub const CW_COMBAT_ENCOUNTER_RESOLVED: u8 = 2;

pub const CW_COMBAT_PARTICIPANT_ESCAPED: u8 = 1 << 0;

pub const CW_CONDITION_UNCONSCIOUS: u32 = 1 << 2;
pub const CW_CONDITION_DODGING: u32 = 1 << 3;

pub const CW_LOCATION_ALLOW_COMBAT: u32 = 1 << 0;

pub const CW_EXIT_LOCKED: u32 = 1 << 0;

pub const CW_PLACEMENT_ACTOR_HAND: u8 = 1;
pub const CW_PLACEMENT_LOCATION_FLOOR: u8 = 2;
pub const CW_PLACEMENT_LOCATION_FIXTURE: u8 = 3;

pub const CW_ITEM_POTION: u8 = 1;
pub const CW_ITEM_EVOLUTION: u8 = 2;
pub const CW_ITEM_KEEPSAKE: u8 = 3;

pub const CW_ITEM_SIZE_TINY: u8 = 1;
pub const CW_ITEM_SIZE_SMALL: u8 = 2;
pub const CW_ITEM_SIZE_MEDIUM: u8 = 3;
pub const CW_ITEM_SIZE_LARGE: u8 = 4;

pub const CW_ITEM_ROLE_GENERIC: u8 = 0;
pub const CW_ITEM_ROLE_CONSUMABLE: u8 = 1;
pub const CW_ITEM_ROLE_WEAPON: u8 = 2;
pub const CW_ITEM_ROLE_SKILL_CHARM: u8 = 3;
pub const CW_ITEM_ROLE_SPELL: u8 = 4;
pub const CW_ITEM_ROLE_CONTAINER: u8 = 5;
pub const CW_ITEM_ROLE_TOOL: u8 = 6;
pub const CW_ITEM_ROLE_RELIC: u8 = 7;

pub const CW_CARD_ZONE_WORLD: u8 = 1;
pub const CW_CARD_ZONE_CARRIED: u8 = 2;
pub const CW_CARD_ZONE_EQUIPPED: u8 = 3;
pub const CW_CARD_ZONE_SPELL_DECK: u8 = 4;
pub const CW_CARD_ZONE_EXHAUSTED: u8 = 5;
pub const CW_CARD_ZONE_CONTAINED: u8 = 6;
pub const CW_CARD_ZONE_ESCROW: u8 = 7;
pub const CW_CARD_ZONE_INSTALLED: u8 = 8;

pub const CW_ITEM_RECOVERY_NONE: u8 = 0;
pub const CW_ITEM_RECOVERY_REST: u8 = 1;

pub const CW_REST_GRADE_NONE: u8 = 0;
pub const CW_REST_GRADE_CAMP: u8 = 1;
pub const CW_REST_GRADE_LODGED: u8 = 2;
pub const CW_REST_GRADE_HEARTH: u8 = 3;

pub const CW_ABILITY_STRENGTH: u8 = 0;
pub const CW_ABILITY_DEXTERITY: u8 = 1;
pub const CW_ABILITY_CONSTITUTION: u8 = 2;
pub const CW_ABILITY_INTELLIGENCE: u8 = 3;
pub const CW_ABILITY_WISDOM: u8 = 4;
pub const CW_ABILITY_CHARISMA: u8 = 5;

pub const CW_ROLL_NORMAL: u8 = 0;
pub const CW_ROLL_ADVANTAGE: u8 = 1;
pub const CW_ROLL_DISADVANTAGE: u8 = 2;

pub const CW_ACTION_NONE: u8 = 0;
pub const CW_ACTION_CREATE_ACTOR: u8 = 1;
pub const CW_ACTION_SAY: u8 = 2;
pub const CW_ACTION_MOVE: u8 = 3;
pub const CW_ACTION_ABILITY_CHECK: u8 = 4;
pub const CW_ACTION_PICK_UP_ITEM: u8 = 5;
pub const CW_ACTION_USE_ITEM: u8 = 6;
pub const CW_ACTION_ATTACK: u8 = 7;
pub const CW_ACTION_DEFEND: u8 = 8;
pub const CW_ACTION_GIVE_ITEM: u8 = 9;
pub const CW_ACTION_FLEE: u8 = 10;
pub const CW_ACTION_DROP_ITEM: u8 = 11;
pub const CW_ACTION_TRADE_ITEM: u8 = 12;
pub const CW_ACTION_SEARCH: u8 = 13;
pub const CW_ACTION_CRAFT: u8 = 14;
pub const CW_ACTION_COMBAT_START: u8 = 15;
pub const CW_ACTION_COMBAT_JOIN: u8 = 16;
pub const CW_ACTION_COMBAT_ATTACK: u8 = 17;
pub const CW_ACTION_COMBAT_DODGE: u8 = 18;
pub const CW_ACTION_COMBAT_ESCAPE: u8 = 19;
pub const CW_ACTION_COMBAT_FINESSE_ATTACK: u8 = 20;
pub const CW_ACTION_RULES_SEARCH: u8 = 21;
pub const CW_ACTION_RULES_STUDY: u8 = 22;
pub const CW_ACTION_RULES_MAGIC: u8 = 23;
pub const CW_ACTION_RULES_INFLUENCE: u8 = 24;
pub const CW_ACTION_THEFT: u8 = 25;
pub const CW_ACTION_COMBAT_PASS: u8 = 26;
pub const CW_ACTION_COMBAT_NEED_TIME: u8 = 27;
pub const CW_ACTION_UNLOCK_EXIT: u8 = 28;
pub const CW_ACTION_REVEAL_ITEM: u8 = 29;
pub const CW_ACTION_RULES_UTILIZE_ITEM: u8 = 30;
pub const CW_ACTION_PROJECT_PUSH: u8 = 31;
// Action 31 is reserved by #411 for CW_ACTION_PROJECT_PUSH.
pub const CW_ACTION_REST: u8 = 32;
// Terminal closure for an encounter that can never advance again. Committed
// only by the focused-encounter scheduler after bounded deterministic recovery
// failures; see `combat::start_focused_encounter_scheduler`.
pub const CW_ACTION_COMBAT_ABANDON: u8 = 33;

pub const CW_EVENT_ACTOR_CREATED: u8 = 2;
pub const CW_EVENT_ITEM_PICKED_UP: u8 = 7;
pub const CW_EVENT_ITEM_USED: u8 = 8;
pub const CW_EVENT_COMBAT_ATTACK_ATTEMPT: u8 = 10;
pub const CW_EVENT_COMBAT_ATTACK_HIT: u8 = 11;
pub const CW_EVENT_COMBAT_ATTACK_MISS: u8 = 12;
pub const CW_EVENT_COMBAT_KNOCKOUT: u8 = 13;
pub const CW_EVENT_RULE_REJECTED: u8 = 14;
pub const CW_EVENT_ACTOR_MOVED: u8 = 15;
pub const CW_EVENT_ITEM_GIVEN: u8 = 16;
pub const CW_EVENT_AVATAR_EVOLVED: u8 = 17;
pub const CW_EVENT_ITEM_DROPPED: u8 = 19;
pub const CW_EVENT_ITEM_TRADED: u8 = 20;
pub const CW_EVENT_ITEM_FOUND: u8 = 21;
pub const CW_EVENT_ITEM_CRAFTED: u8 = 22;
pub const CW_EVENT_ITEM_CREATED: u8 = 23;
pub const CW_EVENT_COMBAT_ENCOUNTER_STARTED: u8 = 24;
pub const CW_EVENT_COMBAT_PARTICIPANT_JOINED: u8 = 25;
pub const CW_EVENT_COMBAT_INITIATIVE_ROLLED: u8 = 26;
pub const CW_EVENT_COMBAT_TURN_STARTED: u8 = 27;
pub const CW_EVENT_COMBAT_TURN_ENDED: u8 = 28;
pub const CW_EVENT_COMBAT_DODGE: u8 = 29;
pub const CW_EVENT_COMBAT_ENCOUNTER_RESOLVED: u8 = 30;
pub const CW_EVENT_SPELL_CAST: u8 = 31;
pub const CW_EVENT_ITEM_THEFT_ATTEMPT: u8 = 32;
pub const CW_EVENT_ITEM_STOLEN: u8 = 33;
pub const CW_EVENT_COMBAT_PASS: u8 = 34;
pub const CW_EVENT_COMBAT_NEED_TIME: u8 = 35;
pub const CW_EVENT_ITEM_CONSUMED: u8 = 36;
pub const CW_EVENT_ITEM_EXHAUSTED: u8 = 37;
pub const CW_EVENT_ITEM_TRANSFORMED: u8 = 38;
pub const CW_EVENT_EXIT_UNLOCKED: u8 = 39;
pub const CW_EVENT_ITEM_REVEALED: u8 = 40;
pub const CW_EVENT_PROJECT_PUSH_RESOLVED: u8 = 41;
// Event 41 is reserved by #411 for CW_EVENT_PROJECT_PUSH_RESOLVED.
pub const CW_EVENT_ITEM_REFRESHED: u8 = 42;

// These append-only values mirror the authoritative `CW_REASON_*` enum in
// core-c. The numeric value remains the replay contract; player-facing copy is
// derived by the orchestrator and is never written back into a kernel action.
pub const CW_REASON_INVALID_ACTION: u16 = 1;
pub const CW_REASON_ACTOR_NOT_FOUND: u16 = 2;
pub const CW_REASON_ACTOR_INACTIVE: u16 = 3;
pub const CW_REASON_LOCATION_NOT_FOUND: u16 = 4;
pub const CW_REASON_ITEM_NOT_FOUND: u16 = 5;
pub const CW_REASON_ITEM_NOT_AVAILABLE: u16 = 6;
pub const CW_REASON_TARGET_NOT_FOUND: u16 = 7;
pub const CW_REASON_TARGET_UNAVAILABLE: u16 = 8;
pub const CW_REASON_NOT_SAME_LOCATION: u16 = 9;
pub const CW_REASON_COMBAT_NOT_ALLOWED: u16 = 10;
pub const CW_REASON_SELF_TARGET: u16 = 11;
pub const CW_REASON_NO_EXIT: u16 = 12;
pub const CW_REASON_EXIT_LOCKED: u16 = 13;
pub const CW_REASON_ENCOUNTER_NOT_FOUND: u16 = 14;
pub const CW_REASON_ENCOUNTER_FULL: u16 = 15;
pub const CW_REASON_NOT_PARTICIPANT: u16 = 16;
pub const CW_REASON_NOT_CURRENT_TURN: u16 = 17;
pub const CW_REASON_NOT_HOSTILE: u16 = 18;
pub const CW_REASON_ENCOUNTER_ACTIVE: u16 = 19;
pub const CW_REASON_COMBAT_ACTION_REQUIRED: u16 = 20;
pub const CW_REASON_CAPACITY_EXCEEDED: u16 = 21;
pub const CW_REASON_REST_GRADE_OVERCLAIMED: u16 = 22;
pub const CW_REASON_MAX_KNOWN: u16 = CW_REASON_REST_GRADE_OVERCLAIMED;

pub const CW_CRAFT_INPUT_PERSISTS: u8 = 0;
pub const CW_CRAFT_INPUT_CONSUMED: u8 = 1;
pub const CW_CRAFT_INPUT_EXHAUSTED: u8 = 2;
pub const CW_CRAFT_INPUT_TRANSFORMED: u8 = 3;

pub const CW_OFFER_CHAT: u32 = 1 << 0;
pub const CW_OFFER_CHECK: u32 = 1 << 1;
pub const CW_OFFER_PICK_UP: u32 = 1 << 2;
pub const CW_OFFER_USE_ITEM: u32 = 1 << 3;
pub const CW_OFFER_DEFEND: u32 = 1 << 4;
pub const CW_OFFER_ATTACK: u32 = 1 << 5;
pub const CW_OFFER_MOVE: u32 = 1 << 6;
pub const CW_OFFER_GIVE_ITEM: u32 = 1 << 7;
pub const CW_OFFER_FLEE: u32 = 1 << 8;
pub const CW_OFFER_DROP_ITEM: u32 = 1 << 9;
pub const CW_OFFER_TRADE_ITEM: u32 = 1 << 10;
pub const CW_OFFER_SEARCH: u32 = 1 << 11;
pub const CW_OFFER_CRAFT: u32 = 1 << 12;

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
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
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
    #[serde(default = "default_item_weight_tenths")]
    pub weight_tenths: u16,
    #[serde(default)]
    pub container_capacity_tenths: u16,
    #[serde(default = "default_item_size_class")]
    pub size_class: u8,
    #[serde(default)]
    pub role: u8,
    #[serde(default)]
    pub zone: u8,
    #[serde(default)]
    pub reserved: u8,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub max_charges: u8,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub recovery: u8,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub recovery_zone: u8,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub reserved2: u8,
    pub location_id: u64,
    pub holder_actor_id: u64,
    #[serde(default)]
    pub container_item_id: u64,
    #[serde(default)]
    pub held_since_tick: u64,
    pub recharge_at_tick: u64,
}

fn default_item_weight_tenths() -> u16 {
    CW_ITEM_DEFAULT_WEIGHT_TENTHS
}

fn default_item_size_class() -> u8 {
    CW_ITEM_SIZE_SMALL
}

fn is_zero_u8(value: &u8) -> bool {
    *value == 0
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CwRestInput {
    pub requested_grade: u8,
    pub entitled_grade: u8,
}

impl CwRestInput {
    fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestActionRequest {
    pub requested_grade: u8,
}

pub fn rest_action_from_server_entitlement(
    actor_id: u64,
    request: RestActionRequest,
    entitled_grade: u8,
) -> Option<CwAction> {
    if actor_id == 0
        || !(CW_REST_GRADE_CAMP..=CW_REST_GRADE_HEARTH).contains(&request.requested_grade)
        || !(CW_REST_GRADE_CAMP..=CW_REST_GRADE_HEARTH).contains(&entitled_grade)
    {
        return None;
    }
    Some(CwAction {
        kind: CW_ACTION_REST,
        actor_id,
        rest: CwRestInput {
            requested_grade: request.requested_grade,
            entitled_grade,
        },
        ..CwAction::default()
    })
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CwProjectPushInput {
    pub base_progress: u8,
    pub prepared_bonus_progress: u8,
    pub prepared: u8,
    pub evidence_count: u8,
    pub location_count: u8,
    pub remaining_progress: u8,
}

impl CwProjectPushInput {
    fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
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
    #[serde(default)]
    pub target_item_id: u64,
    #[serde(default)]
    pub output_item_id: u64,
    #[serde(default)]
    pub output_target_id: u64,
    #[serde(default)]
    pub modifier: i16,
    #[serde(default)]
    pub output_target_kind: u8,
    #[serde(default)]
    pub output_item_kind: u8,
    #[serde(default)]
    pub output_item_charges: u8,
    #[serde(default)]
    pub roll_mode: u8,
    #[serde(default)]
    pub item_disposition: u8,
    #[serde(default)]
    pub target_item_disposition: u8,
    #[serde(default)]
    pub reserved: u16,
    #[serde(default)]
    pub output_item_weight_tenths: u16,
    #[serde(default)]
    pub output_container_capacity_tenths: u16,
    #[serde(default)]
    pub output_item_size_class: u8,
    #[serde(default)]
    pub output_item_role: u8,
    #[serde(default)]
    pub reserved2: u16,
    #[serde(default, skip_serializing_if = "CwProjectPushInput::is_empty")]
    pub project_push: CwProjectPushInput,
    #[serde(default, skip_serializing_if = "CwRestInput::is_empty")]
    pub rest: CwRestInput,
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
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CwEventBuffer {
    pub count: usize,
    pub events: [CwEvent; CW_MAX_EVENTS],
}

impl Default for CwEventBuffer {
    fn default() -> Self {
        Self {
            count: 0,
            events: [CwEvent::default(); CW_MAX_EVENTS],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct CwActionOffers {
    pub option_flags: u32,
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
}

impl Default for CwWorld {
    fn default() -> Self {
        Self {
            version: 0,
            tick: 0,
            next_event_seq: 0,
            actor_count: 0,
            item_count: 0,
            location_count: 0,
            exit_count: 0,
            evolution_track_count: 0,
            actors: [CwActor::default(); CW_MAX_ACTORS],
            items: [CwItem::default(); CW_MAX_ITEMS],
            locations: [CwLocation::default(); CW_MAX_LOCATIONS],
            exits: [CwExit::default(); CW_MAX_EXITS],
            evolution_tracks: [CwEvolutionTrack::default(); CW_MAX_EVOLUTION_TRACKS],
            combat_encounter_count: 0,
            combat_encounters: [CwCombatEncounter::default(); CW_MAX_COMBAT_ENCOUNTERS],
        }
    }
}

extern "C" {
    pub fn cw_world_init(world: *mut CwWorld);
    pub fn cw_seed_cosy_cottage(world: *mut CwWorld, out_events: *mut CwEventBuffer) -> u32;
    pub fn cw_world_set_item_profile(
        world: *mut CwWorld,
        item_id: u64,
        weight_tenths: u16,
        size_class: u8,
        role: u8,
        container_capacity_tenths: u16,
    ) -> u32;
    pub fn cw_world_set_item_recovery_profile(
        world: *mut CwWorld,
        item_id: u64,
        max_charges: u8,
        recovery: u8,
        ready_zone: u8,
    ) -> u32;
    pub fn cw_world_set_item_zone(
        world: *mut CwWorld,
        item_id: u64,
        zone: u8,
        container_item_id: u64,
    ) -> u32;
    pub fn cw_world_set_evolution_track(
        world: *mut CwWorld,
        actor_id: u64,
        requirements: *const CwEvolutionRequirement,
        requirement_count: usize,
    ) -> u32;
    pub fn cw_world_apply(
        world: *mut CwWorld,
        action: *const CwAction,
        seed: u64,
        out_events: *mut CwEventBuffer,
    ) -> u32;
    pub fn cw_world_apply_with_tick(
        world: *mut CwWorld,
        action: *const CwAction,
        seed: u64,
        advance_tick: u8,
        out_events: *mut CwEventBuffer,
    ) -> u32;
    pub fn cw_get_action_offers(
        world: *const CwWorld,
        actor_id: u64,
        out_offers: *mut CwActionOffers,
    ) -> u32;
    pub fn cw_rejection_reason_max() -> u16;
    pub fn cw_resolve_project_push(input: *const CwProjectPushInput, out_progress: *mut u8) -> u32;
    pub fn cw_event_type_name(type_: u8) -> *const c_char;
    pub fn cw_actor_current_hp(actor: *const CwActor) -> i16;
    pub fn cw_actor_is_bloodied(actor: *const CwActor) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_push_ffi_matches_single_and_multi_location_matrix() {
        for (prepared, evidence_count, location_count, expected) in [
            (0, 0, 1, 2),
            (1, 0, 1, 3),
            (1, 1, 1, 4),
            (0, 1, 3, 2),
            (1, 1, 3, 4),
            (1, 3, 3, 5),
        ] {
            let input = CwProjectPushInput {
                base_progress: 2,
                prepared_bonus_progress: 1,
                prepared,
                evidence_count,
                location_count,
                remaining_progress: 6,
            };
            let mut progress = 0;
            assert_eq!(
                unsafe { cw_resolve_project_push(&input, &mut progress) },
                CW_OK
            );
            assert_eq!(progress, expected);
        }
    }

    #[test]
    fn project_push_ffi_clamps_only_remaining_and_rejects_over_claims() {
        let mut input = CwProjectPushInput {
            base_progress: 2,
            prepared_bonus_progress: 1,
            prepared: 1,
            evidence_count: 3,
            location_count: 3,
            remaining_progress: 1,
        };
        let mut progress = 0;
        assert_eq!(
            unsafe { cw_resolve_project_push(&input, &mut progress) },
            CW_OK
        );
        assert_eq!(progress, 1);

        input.evidence_count = 4;
        assert_eq!(
            unsafe { cw_resolve_project_push(&input, &mut progress) },
            CW_ERR_RULE
        );
        input.evidence_count = 3;
        input.prepared = 2;
        assert_eq!(
            unsafe { cw_resolve_project_push(&input, &mut progress) },
            CW_ERR_RULE
        );
    }

    #[test]
    fn rest_adapter_never_accepts_client_entitlement_as_authority() {
        assert_eq!(std::mem::size_of::<CwItem>(), 64);
        assert_eq!(std::mem::offset_of!(CwItem, max_charges), 18);
        assert_eq!(std::mem::offset_of!(CwItem, location_id), 24);
        let tampered = serde_json::json!({
            "requested_grade": CW_REST_GRADE_CAMP,
            "entitled_grade": CW_REST_GRADE_HEARTH
        });
        assert!(serde_json::from_value::<RestActionRequest>(tampered).is_err());

        let request: RestActionRequest = serde_json::from_value(serde_json::json!({
            "requested_grade": CW_REST_GRADE_HEARTH
        }))
        .expect("bounded client Rest choice");
        let action = rest_action_from_server_entitlement(5000, request, CW_REST_GRADE_CAMP)
            .expect("server entitlement constructs the kernel action");
        assert_eq!(action.kind, CW_ACTION_REST);
        assert_eq!(action.rest.requested_grade, CW_REST_GRADE_HEARTH);
        assert_eq!(action.rest.entitled_grade, CW_REST_GRADE_CAMP);
    }
}
