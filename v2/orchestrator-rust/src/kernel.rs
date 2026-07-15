#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

use std::os::raw::c_char;

use serde::{Deserialize, Serialize};

pub const CW_MAX_ACTORS: usize = 512;
pub const CW_MAX_ITEMS: usize = 1024;
pub const CW_MAX_LOCATIONS: usize = 256;
pub const CW_MAX_EXITS: usize = 1024;
pub const CW_MAX_EVENTS: usize = 256;
pub const CW_MAX_EVOLUTION_TRACKS: usize = 128;
pub const CW_MAX_EVOLUTION_REQUIREMENTS: usize = 4;
pub const CW_MAX_COMBAT_ENCOUNTERS: usize = 32;
pub const CW_MAX_COMBAT_PARTICIPANTS: usize = 16;
pub const CW_INVENTORY_BASE_SLOTS: usize = 1;

pub const CW_KERNEL_VERSION: u32 = 2;

pub const CW_OK: u32 = 0;

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

pub const CW_ITEM_POTION: u8 = 1;
pub const CW_ITEM_EVOLUTION: u8 = 2;
pub const CW_ITEM_KEEPSAKE: u8 = 3;

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

pub const CW_EVENT_ACTOR_CREATED: u8 = 2;
pub const CW_EVENT_ITEM_PICKED_UP: u8 = 7;
pub const CW_EVENT_ITEM_USED: u8 = 8;
pub const CW_EVENT_COMBAT_ATTACK_HIT: u8 = 11;
pub const CW_EVENT_COMBAT_KNOCKOUT: u8 = 13;
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
    pub reserved: u16,
    pub location_id: u64,
    pub holder_actor_id: u64,
    #[serde(default)]
    pub held_since_tick: u64,
    pub recharge_at_tick: u64,
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
    pub fn cw_event_type_name(type_: u8) -> *const c_char;
    pub fn cw_actor_current_hp(actor: *const CwActor) -> i16;
    pub fn cw_actor_is_bloodied(actor: *const CwActor) -> i32;
}
