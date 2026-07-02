#ifndef COSY_KERNEL_H
#define COSY_KERNEL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CW_KERNEL_VERSION 1u

#define CW_MAX_ACTORS 512u
#define CW_MAX_ITEMS 1024u
#define CW_MAX_LOCATIONS 256u
#define CW_MAX_EXITS 1024u
#define CW_MAX_EVENTS 128u
#define CW_MAX_EVOLUTION_TRACKS 128u
#define CW_EVOLUTION_TRACK_ITEM_COUNT 2u
#define CW_INVENTORY_BASE_SLOTS 3u

typedef uint64_t cw_id;

typedef enum {
  CW_OK = 0,
  CW_ERR_INVALID = 1,
  CW_ERR_FULL = 2,
  CW_ERR_NOT_FOUND = 3,
  CW_ERR_RULE = 4
} cw_status;

typedef enum {
  CW_ACTOR_NONE = 0,
  CW_ACTOR_HUMAN = 1,
  CW_ACTOR_NPC = 2
} cw_actor_kind;

typedef enum {
  CW_ACTOR_STATUS_NONE = 0,
  CW_ACTOR_ACTIVE = 1,
  CW_ACTOR_KNOCKED_OUT = 2,
  CW_ACTOR_DEAD = 3
} cw_actor_status;

typedef enum {
  CW_LOCATION_NONE = 0,
  CW_LOCATION_ALLOW_COMBAT = 1u << 0
} cw_location_flags;

typedef enum {
  CW_EXIT_NONE = 0,
  CW_EXIT_LOCKED = 1u << 0
} cw_exit_flags;

typedef enum {
  CW_ITEM_NONE = 0,
  CW_ITEM_POTION = 1,
  CW_ITEM_EVOLUTION = 2,
  CW_ITEM_KEEPSAKE = 3
} cw_item_kind;

typedef enum {
  CW_ABILITY_STRENGTH = 0,
  CW_ABILITY_DEXTERITY = 1,
  CW_ABILITY_CONSTITUTION = 2,
  CW_ABILITY_INTELLIGENCE = 3,
  CW_ABILITY_WISDOM = 4,
  CW_ABILITY_CHARISMA = 5
} cw_ability;

typedef enum {
  CW_CONDITION_NONE = 0,
  CW_CONDITION_HIDDEN = 1u << 0,
  CW_CONDITION_DEFENDING = 1u << 1,
  CW_CONDITION_UNCONSCIOUS = 1u << 2
} cw_condition_flags;

typedef enum {
  CW_ACTION_NONE = 0,
  CW_ACTION_CREATE_ACTOR = 1,
  CW_ACTION_SAY = 2,
  CW_ACTION_MOVE = 3,
  CW_ACTION_ABILITY_CHECK = 4,
  CW_ACTION_PICK_UP_ITEM = 5,
  CW_ACTION_USE_ITEM = 6,
  CW_ACTION_ATTACK = 7,
  CW_ACTION_DEFEND = 8,
  CW_ACTION_GIVE_ITEM = 9,
  CW_ACTION_FLEE = 10,
  CW_ACTION_DROP_ITEM = 11,
  CW_ACTION_TRADE_ITEM = 12
} cw_action_kind;

typedef enum {
  CW_EVENT_NONE = 0,
  CW_EVENT_WORLD_BOOTSTRAPPED = 1,
  CW_EVENT_ACTOR_CREATED = 2,
  CW_EVENT_ACTOR_ENTERED_LOCATION = 3,
  CW_EVENT_MESSAGE_CREATED = 4,
  CW_EVENT_MOVE_BLOCKED = 5,
  CW_EVENT_ABILITY_CHECK_ROLLED = 6,
  CW_EVENT_ITEM_PICKED_UP = 7,
  CW_EVENT_ITEM_USED = 8,
  CW_EVENT_COMBAT_DEFEND = 9,
  CW_EVENT_COMBAT_ATTACK_ATTEMPT = 10,
  CW_EVENT_COMBAT_ATTACK_HIT = 11,
  CW_EVENT_COMBAT_ATTACK_MISS = 12,
  CW_EVENT_COMBAT_KNOCKOUT = 13,
  CW_EVENT_RULE_REJECTED = 14,
  CW_EVENT_ACTOR_MOVED = 15,
  CW_EVENT_ITEM_GIVEN = 16,
  CW_EVENT_AVATAR_EVOLVED = 17,
  CW_EVENT_COMBAT_FLEE_SUCCESS = 18,
  CW_EVENT_ITEM_DROPPED = 19,
  CW_EVENT_ITEM_TRADED = 20
} cw_event_type;

typedef enum {
  CW_OFFER_NONE = 0,
  CW_OFFER_CHAT = 1u << 0,
  CW_OFFER_CHECK = 1u << 1,
  CW_OFFER_PICK_UP = 1u << 2,
  CW_OFFER_USE_ITEM = 1u << 3,
  CW_OFFER_DEFEND = 1u << 4,
  CW_OFFER_ATTACK = 1u << 5,
  CW_OFFER_MOVE = 1u << 6,
  CW_OFFER_GIVE_ITEM = 1u << 7,
  CW_OFFER_FLEE = 1u << 8,
  CW_OFFER_DROP_ITEM = 1u << 9,
  CW_OFFER_TRADE_ITEM = 1u << 10
} cw_offer_flags;

typedef struct {
  int8_t strength;
  int8_t dexterity;
  int8_t constitution;
  int8_t intelligence;
  int8_t wisdom;
  int8_t charisma;
  int16_t hp_base;
  uint8_t level;
} cw_stat_block;

typedef struct {
  cw_id id;
  uint8_t kind;
  uint8_t status;
  uint16_t reserved;
  cw_id location_id;
  cw_stat_block stats;
  int16_t damage;
  uint32_t conditions;
} cw_actor;

typedef struct {
  cw_id id;
  uint32_t flags;
} cw_location;

typedef struct {
  cw_id from_location_id;
  cw_id to_location_id;
  uint32_t flags;
} cw_exit;

typedef struct {
  cw_id id;
  uint8_t kind;
  uint8_t charges;
  uint16_t reserved;
  cw_id location_id;
  cw_id holder_actor_id;
  uint64_t held_since_tick;
  uint64_t recharge_at_tick;
} cw_item;

typedef struct {
  uint8_t kind;
  uint8_t ability;
  uint16_t dc;
  cw_id actor_id;
  cw_id target_actor_id;
  cw_id location_id;
  cw_id destination_location_id;
  cw_id content_id;
  cw_id item_id;
  cw_id target_item_id;
  int16_t modifier;
} cw_action;

typedef struct {
  uint64_t seq;
  uint8_t type;
  uint8_t success;
  uint16_t reason;
  cw_id actor_id;
  cw_id target_actor_id;
  cw_id location_id;
  cw_id destination_location_id;
  cw_id content_id;
  cw_id item_id;
  cw_id target_item_id;
  int16_t raw_roll;
  int16_t modifier;
  int16_t total;
  int16_t dc;
  int16_t damage;
  int16_t current_hp;
} cw_event;

typedef struct {
  size_t count;
  cw_event events[CW_MAX_EVENTS];
} cw_event_buffer;

typedef struct {
  uint32_t option_flags;
} cw_action_offers;

typedef struct {
  cw_id actor_id;
  cw_id item_ids[CW_EVOLUTION_TRACK_ITEM_COUNT];
} cw_evolution_track;

typedef struct {
  uint32_t version;
  uint64_t tick;
  uint64_t next_event_seq;
  size_t actor_count;
  size_t item_count;
  size_t location_count;
  size_t exit_count;
  size_t evolution_track_count;
  cw_actor actors[CW_MAX_ACTORS];
  cw_item items[CW_MAX_ITEMS];
  cw_location locations[CW_MAX_LOCATIONS];
  cw_exit exits[CW_MAX_EXITS];
  cw_evolution_track evolution_tracks[CW_MAX_EVOLUTION_TRACKS];
} cw_world;

void cw_world_init(cw_world *world);
cw_status cw_seed_cosy_cottage(cw_world *world, cw_event_buffer *out_events);
cw_status cw_world_set_evolution_track(cw_world *world, cw_id actor_id, const cw_id *item_ids, size_t item_count);
cw_status cw_world_apply(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events);
cw_status cw_get_action_offers(const cw_world *world, cw_id actor_id, cw_action_offers *out_offers);
const char *cw_event_type_name(uint8_t type);
int16_t cw_actor_current_hp(const cw_actor *actor);

#ifdef __cplusplus
}
#endif

#endif
