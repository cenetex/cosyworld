#include "cosy_kernel.h"

#include <string.h>

enum {
  CW_REASON_NONE = 0,
  CW_REASON_INVALID_ACTION = 1,
  CW_REASON_ACTOR_NOT_FOUND = 2,
  CW_REASON_ACTOR_INACTIVE = 3,
  CW_REASON_LOCATION_NOT_FOUND = 4,
  CW_REASON_ITEM_NOT_FOUND = 5,
  CW_REASON_ITEM_NOT_AVAILABLE = 6,
  CW_REASON_TARGET_NOT_FOUND = 7,
  CW_REASON_TARGET_UNAVAILABLE = 8,
  CW_REASON_NOT_SAME_LOCATION = 9,
  CW_REASON_COMBAT_NOT_ALLOWED = 10,
  CW_REASON_SELF_TARGET = 11,
  CW_REASON_NO_EXIT = 12,
  CW_REASON_EXIT_LOCKED = 13,
  CW_REASON_ENCOUNTER_NOT_FOUND = 14,
  CW_REASON_ENCOUNTER_FULL = 15,
  CW_REASON_NOT_PARTICIPANT = 16,
  CW_REASON_NOT_CURRENT_TURN = 17,
  CW_REASON_NOT_HOSTILE = 18,
  CW_REASON_ENCOUNTER_ACTIVE = 19,
  CW_REASON_COMBAT_ACTION_REQUIRED = 20,
  CW_REASON_CAPACITY_EXCEEDED = 21
};

static uint64_t splitmix64(uint64_t *state) {
  uint64_t z = (*state += 0x9E3779B97F4A7C15ull);
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
  return z ^ (z >> 31);
}

static int16_t roll_die(uint64_t seed, uint64_t salt, int16_t sides) {
  uint64_t state = seed ^ (salt * 0xD6E8FEB86659FD93ull);
  return (int16_t)((splitmix64(&state) % (uint64_t)sides) + 1u);
}

static int valid_roll_mode(uint8_t roll_mode) {
  return roll_mode <= CW_ROLL_DISADVANTAGE;
}

static int16_t roll_d20(uint64_t seed, uint64_t salt, uint8_t roll_mode) {
  int16_t first = roll_die(seed, salt, 20);
  if (roll_mode == CW_ROLL_NORMAL) return first;
  int16_t second = roll_die(seed, salt ^ 0xA5A5A5A5A5A5A5A5ull, 20);
  if (roll_mode == CW_ROLL_ADVANTAGE) return first > second ? first : second;
  return first < second ? first : second;
}

static int16_t ability_modifier(int8_t score) {
  int16_t diff = (int16_t)score - 10;
  if (diff >= 0) return diff / 2;
  return (int16_t)-(((-diff) + 1) / 2);
}

static int16_t stat_value(const cw_stat_block *stats, uint8_t ability) {
  switch (ability) {
    case CW_ABILITY_STRENGTH: return stats->strength;
    case CW_ABILITY_DEXTERITY: return stats->dexterity;
    case CW_ABILITY_CONSTITUTION: return stats->constitution;
    case CW_ABILITY_INTELLIGENCE: return stats->intelligence;
    case CW_ABILITY_WISDOM: return stats->wisdom;
    case CW_ABILITY_CHARISMA: return stats->charisma;
    default: return 10;
  }
}

static cw_stat_block generated_stats(uint64_t seed) {
  cw_stat_block stats;
  uint64_t state = seed;
  stats.strength = (int8_t)(8 + (splitmix64(&state) % 9u));
  stats.dexterity = (int8_t)(8 + (splitmix64(&state) % 9u));
  stats.constitution = (int8_t)(8 + (splitmix64(&state) % 9u));
  stats.intelligence = (int8_t)(8 + (splitmix64(&state) % 9u));
  stats.wisdom = (int8_t)(8 + (splitmix64(&state) % 9u));
  stats.charisma = (int8_t)(8 + (splitmix64(&state) % 9u));
  stats.hp_base = (int16_t)(10 + ability_modifier(stats.constitution));
  if (stats.hp_base < 1) stats.hp_base = 1;
  stats.level = 1;
  return stats;
}

static cw_actor *find_actor(cw_world *world, cw_id actor_id) {
  for (size_t i = 0; i < world->actor_count; ++i) {
    if (world->actors[i].id == actor_id) return &world->actors[i];
  }
  return 0;
}

static const cw_actor *find_actor_const(const cw_world *world, cw_id actor_id) {
  for (size_t i = 0; i < world->actor_count; ++i) {
    if (world->actors[i].id == actor_id) return &world->actors[i];
  }
  return 0;
}

static cw_location *find_location(cw_world *world, cw_id location_id) {
  for (size_t i = 0; i < world->location_count; ++i) {
    if (world->locations[i].id == location_id) return &world->locations[i];
  }
  return 0;
}

static const cw_location *find_location_const(const cw_world *world, cw_id location_id) {
  for (size_t i = 0; i < world->location_count; ++i) {
    if (world->locations[i].id == location_id) return &world->locations[i];
  }
  return 0;
}

static const cw_exit *find_exit_const(const cw_world *world, cw_id from_location_id, cw_id to_location_id) {
  for (size_t i = 0; i < world->exit_count; ++i) {
    const cw_exit *exit = &world->exits[i];
    if (exit->from_location_id == from_location_id && exit->to_location_id == to_location_id) return exit;
  }
  return 0;
}

static cw_item *find_item(cw_world *world, cw_id item_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].id == item_id) return &world->items[i];
  }
  return 0;
}

static const cw_item *find_item_const(const cw_world *world, cw_id item_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].id == item_id) return &world->items[i];
  }
  return 0;
}

static cw_evolution_track *find_evolution_track(cw_world *world, cw_id actor_id) {
  for (size_t i = 0; i < world->evolution_track_count; ++i) {
    if (world->evolution_tracks[i].actor_id == actor_id) return &world->evolution_tracks[i];
  }
  return 0;
}

static cw_combat_encounter *find_combat_encounter(cw_world *world, cw_id encounter_id) {
  for (size_t i = 0; i < world->combat_encounter_count; ++i) {
    if (world->combat_encounters[i].id == encounter_id) return &world->combat_encounters[i];
  }
  return 0;
}

static cw_combat_encounter *find_active_combat_encounter_for_actor(cw_world *world, cw_id actor_id) {
  for (size_t i = 0; i < world->combat_encounter_count; ++i) {
    cw_combat_encounter *encounter = &world->combat_encounters[i];
    if (encounter->status != CW_COMBAT_ENCOUNTER_ACTIVE) continue;
    for (size_t j = 0; j < encounter->participant_count; ++j) {
      if (encounter->participants[j].actor_id == actor_id
          && !(encounter->participants[j].flags & CW_COMBAT_PARTICIPANT_ESCAPED)) {
        return encounter;
      }
    }
  }
  return 0;
}

static cw_combat_participant *find_combat_participant(cw_combat_encounter *encounter, cw_id actor_id) {
  if (!encounter) return 0;
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    if (encounter->participants[i].actor_id == actor_id) return &encounter->participants[i];
  }
  return 0;
}

static const cw_combat_participant *find_combat_participant_const(const cw_combat_encounter *encounter, cw_id actor_id) {
  if (!encounter) return 0;
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    if (encounter->participants[i].actor_id == actor_id) return &encounter->participants[i];
  }
  return 0;
}

static int append_event(cw_world *world, cw_event_buffer *buffer, uint8_t type) {
  if (!buffer || buffer->count >= CW_MAX_EVENTS) return 0;
  cw_event *event = &buffer->events[buffer->count++];
  memset(event, 0, sizeof(*event));
  event->seq = world->next_event_seq++;
  event->type = type;
  return 1;
}

static cw_status reject(cw_world *world, cw_event_buffer *buffer, const cw_action *action, uint16_t reason) {
  append_event(world, buffer, CW_EVENT_RULE_REJECTED);
  if (buffer && buffer->count > 0) {
    cw_event *event = &buffer->events[buffer->count - 1];
    event->success = 0;
    event->reason = reason;
    if (action) {
      event->actor_id = action->actor_id;
      event->target_actor_id = action->target_actor_id;
      event->location_id = action->location_id;
      event->destination_location_id = action->destination_location_id;
      event->content_id = action->content_id;
      event->item_id = action->item_id;
    }
  }
  return CW_ERR_RULE;
}

static cw_status add_location(cw_world *world, cw_id location_id, uint32_t flags) {
  if (find_location(world, location_id)) return CW_OK;
  if (world->location_count >= CW_MAX_LOCATIONS) return CW_ERR_FULL;
  cw_location *location = &world->locations[world->location_count++];
  memset(location, 0, sizeof(*location));
  location->id = location_id;
  location->flags = flags;
  return CW_OK;
}

static cw_status add_exit(cw_world *world, cw_id from_location_id, cw_id to_location_id, uint32_t flags) {
  if (find_exit_const(world, from_location_id, to_location_id)) return CW_OK;
  if (world->exit_count >= CW_MAX_EXITS) return CW_ERR_FULL;
  if (!find_location(world, from_location_id) || !find_location(world, to_location_id)) return CW_ERR_NOT_FOUND;
  cw_exit *exit = &world->exits[world->exit_count++];
  memset(exit, 0, sizeof(*exit));
  exit->from_location_id = from_location_id;
  exit->to_location_id = to_location_id;
  exit->flags = flags;
  return CW_OK;
}

static cw_status add_actor(cw_world *world, cw_id actor_id, uint8_t kind, cw_id location_id, cw_stat_block stats) {
  if (find_actor(world, actor_id)) return CW_ERR_RULE;
  if (world->actor_count >= CW_MAX_ACTORS) return CW_ERR_FULL;
  cw_actor *actor = &world->actors[world->actor_count++];
  memset(actor, 0, sizeof(*actor));
  actor->id = actor_id;
  actor->kind = kind;
  actor->status = CW_ACTOR_ACTIVE;
  actor->location_id = location_id;
  actor->stats = stats;
  actor->damage = 0;
  actor->conditions = CW_CONDITION_NONE;
  return CW_OK;
}

static cw_status add_item(cw_world *world, cw_id item_id, uint8_t kind, cw_id location_id, uint8_t charges) {
  if (find_item(world, item_id)) return CW_OK;
  if (world->item_count >= CW_MAX_ITEMS) return CW_ERR_FULL;
  cw_item *item = &world->items[world->item_count++];
  memset(item, 0, sizeof(*item));
  item->id = item_id;
  item->kind = kind;
  item->charges = charges;
  item->weight_tenths = CW_ITEM_DEFAULT_WEIGHT_TENTHS;
  item->size_class = CW_ITEM_SIZE_SMALL;
  item->role = kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC;
  item->zone = CW_CARD_ZONE_WORLD;
  item->location_id = location_id;
  item->holder_actor_id = 0;
  return CW_OK;
}

static cw_status create_item(cw_world *world, cw_id item_id, uint8_t kind, uint8_t charges, uint8_t target_kind, cw_id target_id) {
  if (!item_id || !kind || !charges || find_item(world, item_id)) return CW_ERR_INVALID;
  if (world->item_count >= CW_MAX_ITEMS) return CW_ERR_FULL;
  cw_item *item = &world->items[world->item_count++];
  memset(item, 0, sizeof(*item));
  item->id = item_id;
  item->kind = kind;
  item->charges = charges;
  item->weight_tenths = CW_ITEM_DEFAULT_WEIGHT_TENTHS;
  item->size_class = CW_ITEM_SIZE_SMALL;
  item->role = kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC;
  switch (target_kind) {
    case CW_PLACEMENT_ACTOR_HAND:
      item->holder_actor_id = target_id;
      item->location_id = 0;
      item->held_since_tick = world->tick;
      item->zone = CW_CARD_ZONE_CARRIED;
      break;
    case CW_PLACEMENT_LOCATION_FLOOR:
      item->holder_actor_id = 0;
      item->location_id = target_id;
      item->held_since_tick = 0;
      item->zone = CW_CARD_ZONE_WORLD;
      break;
    default:
      world->item_count--;
      return CW_ERR_INVALID;
  }
  return CW_OK;
}

static int actor_is_active(const cw_actor *actor) {
  return actor && actor->status == CW_ACTOR_ACTIVE;
}

static uint32_t item_weight_tenths(const cw_item *item) {
  return item && item->weight_tenths ? item->weight_tenths : CW_ITEM_DEFAULT_WEIGHT_TENTHS;
}

static uint32_t item_container_capacity_tenths(const cw_item *item) {
  if (!item || item->role != CW_ITEM_ROLE_CONTAINER
      || item->zone != CW_CARD_ZONE_EQUIPPED || item->container_item_id) return 0;
  return item->container_capacity_tenths;
}

static uint32_t actor_base_capacity_tenths(const cw_actor *actor) {
  int16_t strength = actor ? actor->stats.strength : 0;
  if (strength < 1) strength = 1;
  return (uint32_t)strength * 150u;
}

static int actor_can_exchange(
    const cw_world *world,
    const cw_actor *actor,
    const cw_item *removed_item,
    const cw_item *added_item) {
  uint32_t weight = 0;
  uint32_t capacity = actor_base_capacity_tenths(actor);
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *item = &world->items[i];
    if (item->holder_actor_id != actor->id || item == removed_item) continue;
    weight += item_weight_tenths(item);
    capacity += item_container_capacity_tenths(item);
  }
  if (added_item && added_item != removed_item) {
    weight += item_weight_tenths(added_item);
    capacity += item_container_capacity_tenths(added_item);
  }
  return weight <= capacity;
}

static int actor_can_pick_up(
    const cw_world *world,
    const cw_actor *actor,
    const cw_item *incoming_item) {
  if (actor_can_exchange(world, actor, 0, incoming_item)) return 1;
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *outgoing_item = &world->items[i];
    if (outgoing_item->holder_actor_id == actor->id
        && actor_can_exchange(world, actor, outgoing_item, incoming_item)) {
      return 1;
    }
  }
  return 0;
}

static void maybe_evolve_after_placement(cw_world *world, cw_id source_actor_id, cw_id trigger_item_id, cw_event_buffer *out_events);

int16_t cw_actor_current_hp(const cw_actor *actor) {
  if (!actor) return 0;
  int16_t hp = (int16_t)(actor->stats.hp_base - actor->damage);
  return hp > 0 ? hp : 0;
}

int cw_actor_is_bloodied(const cw_actor *actor) {
  if (!actor || actor->stats.hp_base < 1) return 0;
  int16_t hp = cw_actor_current_hp(actor);
  return hp > 0 && hp <= actor->stats.hp_base / 2;
}

void cw_world_init(cw_world *world) {
  if (!world) return;
  memset(world, 0, sizeof(*world));
  world->version = CW_KERNEL_VERSION;
  world->tick = 1;
  world->next_event_seq = 1;
}

cw_status cw_world_set_item_profile(
    cw_world *world,
    cw_id item_id,
    uint16_t weight_tenths,
    uint8_t size_class,
    uint8_t role,
    uint16_t container_capacity_tenths) {
  if (!world || !item_id || !weight_tenths
      || size_class < CW_ITEM_SIZE_TINY || size_class > CW_ITEM_SIZE_LARGE
      || role > CW_ITEM_ROLE_RELIC
      || (container_capacity_tenths && role != CW_ITEM_ROLE_CONTAINER)) {
    return CW_ERR_INVALID;
  }
  cw_item *item = find_item(world, item_id);
  if (!item) return CW_ERR_NOT_FOUND;
  item->weight_tenths = weight_tenths;
  item->size_class = size_class;
  item->role = role;
  item->container_capacity_tenths = container_capacity_tenths;
  return CW_OK;
}

cw_status cw_world_set_item_zone(
    cw_world *world,
    cw_id item_id,
    uint8_t zone,
    cw_id container_item_id) {
  if (!world || !item_id || zone < CW_CARD_ZONE_WORLD || zone > CW_CARD_ZONE_ESCROW) {
    return CW_ERR_INVALID;
  }
  cw_item *item = find_item(world, item_id);
  if (!item) return CW_ERR_NOT_FOUND;
  if (zone == CW_CARD_ZONE_WORLD) {
    if (item->holder_actor_id || !item->location_id || container_item_id) return CW_ERR_RULE;
  } else {
    if (!item->holder_actor_id || item->location_id) return CW_ERR_RULE;
  }
  if (zone == CW_CARD_ZONE_CONTAINED) {
    cw_item *container = find_item(world, container_item_id);
    int item_contains_cards = 0;
    if (item->role == CW_ITEM_ROLE_CONTAINER) {
      for (size_t i = 0; i < world->item_count; ++i) {
        if (world->items[i].container_item_id == item->id) {
          item_contains_cards = 1;
          break;
        }
      }
    }
    if (!container || container == item || item_contains_cards
        || container->role != CW_ITEM_ROLE_CONTAINER
        || container->holder_actor_id != item->holder_actor_id
        || container->zone == CW_CARD_ZONE_CONTAINED
        || item->size_class > container->size_class) {
      return CW_ERR_RULE;
    }
  } else if (container_item_id) {
    return CW_ERR_INVALID;
  }
  if (zone == CW_CARD_ZONE_EQUIPPED
      && item->role != CW_ITEM_ROLE_WEAPON
      && item->role != CW_ITEM_ROLE_SKILL_CHARM
      && item->role != CW_ITEM_ROLE_CONTAINER) {
    return CW_ERR_RULE;
  }
  if (zone == CW_CARD_ZONE_SPELL_DECK && item->role != CW_ITEM_ROLE_SPELL) {
    return CW_ERR_RULE;
  }
  item->zone = zone;
  item->container_item_id = container_item_id;
  return CW_OK;
}

cw_status cw_world_set_evolution_track(cw_world *world, cw_id actor_id, const cw_evolution_requirement *requirements, size_t requirement_count) {
  if (!world || !actor_id || !requirements || requirement_count == 0 || requirement_count > CW_MAX_EVOLUTION_REQUIREMENTS) {
    return CW_ERR_INVALID;
  }
  for (size_t i = 0; i < requirement_count; ++i) {
    const cw_evolution_requirement *requirement = &requirements[i];
    if (!requirement->item_id || !requirement->target_id) return CW_ERR_INVALID;
    if (requirement->target_kind != CW_PLACEMENT_ACTOR_HAND
        && requirement->target_kind != CW_PLACEMENT_LOCATION_FLOOR) {
      return CW_ERR_INVALID;
    }
  }

  cw_evolution_track *track = find_evolution_track(world, actor_id);
  if (!track) {
    if (world->evolution_track_count >= CW_MAX_EVOLUTION_TRACKS) return CW_ERR_FULL;
    track = &world->evolution_tracks[world->evolution_track_count++];
    memset(track, 0, sizeof(*track));
    track->actor_id = actor_id;
  }
  track->requirement_count = requirement_count;
  for (size_t i = 0; i < CW_MAX_EVOLUTION_REQUIREMENTS; ++i) {
    if (i < requirement_count) {
      track->requirements[i] = requirements[i];
    } else {
      memset(&track->requirements[i], 0, sizeof(track->requirements[i]));
    }
  }
  return CW_OK;
}

cw_status cw_seed_cosy_cottage(cw_world *world, cw_event_buffer *out_events) {
  if (!world) return CW_ERR_INVALID;
  if (out_events) memset(out_events, 0, sizeof(*out_events));
  if (world->version != CW_KERNEL_VERSION) cw_world_init(world);

  cw_status status = add_location(world, 1, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 2, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 3, CW_LOCATION_ALLOW_COMBAT);
  if (status != CW_OK) return status;
  status = add_location(world, 10, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 11, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 12, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 13, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 14, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 15, 0);
  if (status != CW_OK) return status;
  status = add_location(world, 40, 0);
  if (status != CW_OK) return status;

  const cw_id seed_exits[][2] = {
    {1, 2},   {2, 1},   {1, 11},  {11, 1},
    {2, 3},   {3, 2},   {2, 40},  {40, 2},
    {10, 11}, {11, 10}, {11, 12}, {12, 11},
    {11, 13}, {13, 11}, {11, 15}, {15, 11},
    {10, 14}, {14, 10}, {10, 15}, {15, 10},
    {13, 15}, {15, 13}, {14, 15}, {15, 14},
  };
  for (size_t i = 0; i < sizeof(seed_exits) / sizeof(seed_exits[0]); ++i) {
    status = add_exit(world, seed_exits[i][0], seed_exits[i][1], 0);
    if (status != CW_OK) return status;
  }

  cw_stat_block rati = {8, 14, 11, 13, 15, 16, 10, 1};
  cw_stat_block whiskerwind = {8, 16, 10, 12, 14, 12, 10, 1};
  cw_stat_block skull = {14, 13, 13, 8, 12, 9, 11, 1};
  cw_stat_block moonlit_echo = {10, 12, 10, 8, 10, 8, 6, 1};
  cw_stat_block old_oak = {16, 6, 18, 14, 18, 13, 16, 1};

  add_actor(world, 1001, CW_ACTOR_NPC, 1, rati);
  add_actor(world, 1002, CW_ACTOR_NPC, 1, whiskerwind);
  add_actor(world, 1003, CW_ACTOR_NPC, 1, skull);
  add_actor(world, 1004, CW_ACTOR_NPC, 3, moonlit_echo);
  add_actor(world, 1005, CW_ACTOR_NPC, 40, old_oak);
  add_item(world, 2001, CW_ITEM_POTION, 1, 1);
  add_item(world, 2002, CW_ITEM_EVOLUTION, 2, 1);
  add_item(world, 2003, CW_ITEM_EVOLUTION, 3, 1);
  add_item(world, 2004, CW_ITEM_EVOLUTION, 10, 1);
  add_item(world, 2005, CW_ITEM_EVOLUTION, 0, 1);
  add_item(world, 2006, CW_ITEM_EVOLUTION, 0, 1);
  add_item(world, 2007, CW_ITEM_EVOLUTION, 0, 1);

  const cw_evolution_requirement rati_requirements[] = {
    {2004, CW_PLACEMENT_ACTOR_HAND, {0}, 1001},
    {2005, CW_PLACEMENT_LOCATION_FLOOR, {0}, 1},
  };
  const cw_evolution_requirement whiskerwind_requirements[] = {
    {2002, CW_PLACEMENT_ACTOR_HAND, {0}, 1002},
    {2003, CW_PLACEMENT_LOCATION_FLOOR, {0}, 3},
  };
  const cw_evolution_requirement skull_requirements[] = {
    {2007, CW_PLACEMENT_ACTOR_HAND, {0}, 1003},
    {2006, CW_PLACEMENT_LOCATION_FLOOR, {0}, 1},
  };
  status = cw_world_set_evolution_track(world, 1001, rati_requirements, sizeof(rati_requirements) / sizeof(rati_requirements[0]));
  if (status != CW_OK) return status;
  status = cw_world_set_evolution_track(world, 1002, whiskerwind_requirements, sizeof(whiskerwind_requirements) / sizeof(whiskerwind_requirements[0]));
  if (status != CW_OK) return status;
  status = cw_world_set_evolution_track(world, 1003, skull_requirements, sizeof(skull_requirements) / sizeof(skull_requirements[0]));
  if (status != CW_OK) return status;

  append_event(world, out_events, CW_EVENT_WORLD_BOOTSTRAPPED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->location_id = 1;
  }
  return CW_OK;
}

static cw_status apply_create_actor(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  cw_id location_id = action->location_id ? action->location_id : 1;
  if (!find_location(world, location_id)) return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);

  cw_stat_block stats = generated_stats(seed ^ action->actor_id);
  cw_status status = add_actor(world, action->actor_id, CW_ACTOR_HUMAN, location_id, stats);
  if (status == CW_ERR_RULE) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  if (status != CW_OK) return status;

  append_event(world, out_events, CW_EVENT_ACTOR_CREATED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = action->actor_id;
    event->location_id = location_id;
    event->current_hp = stats.hp_base;
  }

  append_event(world, out_events, CW_EVENT_ACTOR_ENTERED_LOCATION);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = action->actor_id;
    event->location_id = location_id;
  }

  return CW_OK;
}

static cw_status require_active_actor(cw_world *world, const cw_action *action, cw_event_buffer *out_events, cw_actor **out_actor) {
  cw_actor *actor = find_actor(world, action->actor_id);
  if (!actor) return reject(world, out_events, action, CW_REASON_ACTOR_NOT_FOUND);
  if (!actor_is_active(actor)) return reject(world, out_events, action, CW_REASON_ACTOR_INACTIVE);
  *out_actor = actor;
  return CW_OK;
}

static cw_status apply_say(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  append_event(world, out_events, CW_EVENT_MESSAGE_CREATED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->content_id = action->content_id;
  }
  return CW_OK;
}

static cw_status apply_move(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_id destination_id = action->destination_location_id;
  if (!destination_id || !find_location(world, destination_id)) {
    append_event(world, out_events, CW_EVENT_MOVE_BLOCKED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 0;
      event->reason = CW_REASON_LOCATION_NOT_FOUND;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->destination_location_id = destination_id;
    }
    return CW_ERR_RULE;
  }

  if (destination_id == actor->location_id) {
    append_event(world, out_events, CW_EVENT_MOVE_BLOCKED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 0;
      event->reason = CW_REASON_INVALID_ACTION;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->destination_location_id = destination_id;
    }
    return CW_ERR_RULE;
  }

  const cw_exit *exit = find_exit_const(world, actor->location_id, destination_id);
  if (!exit) {
    append_event(world, out_events, CW_EVENT_MOVE_BLOCKED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 0;
      event->reason = CW_REASON_NO_EXIT;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->destination_location_id = destination_id;
    }
    return CW_ERR_RULE;
  }

  if (exit->flags & CW_EXIT_LOCKED) {
    append_event(world, out_events, CW_EVENT_MOVE_BLOCKED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 0;
      event->reason = CW_REASON_EXIT_LOCKED;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->destination_location_id = destination_id;
    }
    return CW_ERR_RULE;
  }

  cw_id from_location_id = actor->location_id;
  actor->location_id = destination_id;

  append_event(world, out_events, CW_EVENT_ACTOR_MOVED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = from_location_id;
    event->destination_location_id = destination_id;
  }
  return CW_OK;
}

static cw_status apply_ability_check(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (!valid_roll_mode(action->roll_mode)) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  if (action->dc > INT16_MAX) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);

  int16_t raw = roll_d20(seed, 1, action->roll_mode);
  int16_t modifier = (int16_t)(ability_modifier((int8_t)stat_value(&actor->stats, action->ability)) + action->modifier);
  int16_t total = (int16_t)(raw + modifier);
  int16_t dc = (int16_t)(action->dc ? action->dc : 10);

  append_event(world, out_events, CW_EVENT_ABILITY_CHECK_ROLLED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = total >= dc ? 1 : 0;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->raw_roll = raw;
    event->modifier = modifier;
    event->total = total;
    event->dc = dc;
  }
  return CW_OK;
}

static cw_status apply_pick_up_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id || item->location_id != actor->location_id) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  cw_item *exchanged = 0;
  if (!actor_can_exchange(world, actor, 0, item)) {
    if (action->target_item_id) {
      exchanged = find_item(world, action->target_item_id);
    }
    if (!exchanged || exchanged->holder_actor_id != actor->id
        || !actor_can_exchange(world, actor, exchanged, item)) {
      return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
    }
  }

  if (exchanged) {
    exchanged->holder_actor_id = 0;
    exchanged->location_id = actor->location_id;
    exchanged->held_since_tick = 0;
    exchanged->zone = CW_CARD_ZONE_WORLD;
    exchanged->container_item_id = 0;
    append_event(world, out_events, CW_EVENT_ITEM_DROPPED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->item_id = exchanged->id;
    }
  }

  item->holder_actor_id = actor->id;
  item->location_id = 0;
  item->held_since_tick = world->tick;
  item->zone = CW_CARD_ZONE_CARRIED;
  item->container_item_id = 0;

  append_event(world, out_events, CW_EVENT_ITEM_PICKED_UP);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
  }
  maybe_evolve_after_placement(world, actor->id, item->id, out_events);
  return CW_OK;
}

static cw_status apply_drop_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != actor->id) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (!actor_can_exchange(world, actor, item, 0)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }
  item->holder_actor_id = 0;
  item->location_id = actor->location_id;
  item->held_since_tick = 0;
  item->zone = CW_CARD_ZONE_WORLD;
  item->container_item_id = 0;

  append_event(world, out_events, CW_EVENT_ITEM_DROPPED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
  }
  maybe_evolve_after_placement(world, actor->id, item->id, out_events);
  return CW_OK;
}

static cw_status apply_use_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != actor->id || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  cw_actor *target = find_actor(world, action->target_actor_id ? action->target_actor_id : actor->id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  int16_t healed = 0;
  if (item->kind == CW_ITEM_POTION) {
    if (target->status == CW_ACTOR_ACTIVE && target->damage <= 0) {
      return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
    }
    int16_t before = target->damage;
    target->damage = (int16_t)(target->damage > 10 ? target->damage - 10 : 0);
    healed = (int16_t)(before - target->damage);
    if (target->status == CW_ACTOR_KNOCKED_OUT && cw_actor_current_hp(target) > 0) {
      target->status = CW_ACTOR_ACTIVE;
      target->conditions &= ~CW_CONDITION_UNCONSCIOUS;
    }
    item->charges--;
    if (item->charges == 0) item->zone = CW_CARD_ZONE_EXHAUSTED;
  } else {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  append_event(world, out_events, CW_EVENT_ITEM_USED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
    event->damage = (int16_t)-healed;
    event->current_hp = cw_actor_current_hp(target);
  }
  return CW_OK;
}

static cw_status apply_rules_magic(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  cw_item *spell = find_item(world, action->item_id);
  if (!spell || spell->holder_actor_id != actor->id || spell->role != CW_ITEM_ROLE_SPELL
      || spell->zone != CW_CARD_ZONE_SPELL_DECK || spell->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  cw_actor *target = find_actor(world, action->target_actor_id ? action->target_actor_id : actor->id);
  if (!target || target->status != CW_ACTOR_ACTIVE) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }
  if (target->location_id != actor->location_id) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  spell->charges--;
  if (spell->charges == 0) spell->zone = CW_CARD_ZONE_EXHAUSTED;
  append_event(world, out_events, CW_EVENT_SPELL_CAST);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = spell->id;
  }
  return CW_OK;
}

static cw_status apply_theft(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  cw_actor *target = find_actor(world, action->target_actor_id);
  cw_item *item = find_item(world, action->item_id);
  if (!target || !actor_is_active(target) || target->kind != CW_ACTOR_NPC
      || target->id == actor->id) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }
  if (target->location_id != actor->location_id) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != target->id || item->zone == CW_CARD_ZONE_ESCROW) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (!actor_can_exchange(world, actor, 0, item)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }
  int16_t raw = roll_d20(seed, 1, CW_ROLL_NORMAL);
  int16_t modifier = ability_modifier(actor->stats.dexterity);
  int16_t total = (int16_t)(raw + modifier);
  int16_t dc = (int16_t)(action->dc ? action->dc : 12);
  int succeeded = total >= dc;
  append_event(world, out_events, CW_EVENT_ITEM_THEFT_ATTEMPT);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = succeeded ? 1 : 0;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
    event->raw_roll = raw;
    event->modifier = modifier;
    event->total = total;
    event->dc = dc;
  }
  if (!succeeded) return CW_OK;
  item->holder_actor_id = actor->id;
  item->location_id = 0;
  item->zone = CW_CARD_ZONE_CARRIED;
  item->container_item_id = 0;
  item->held_since_tick = world->tick;
  append_event(world, out_events, CW_EVENT_ITEM_STOLEN);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
  }
  return CW_OK;
}

static int evolution_requirement_satisfied(const cw_world *world, const cw_evolution_requirement *requirement) {
  const cw_item *item = find_item_const(world, requirement->item_id);
  if (!item) return 0;
  switch (requirement->target_kind) {
    case CW_PLACEMENT_ACTOR_HAND:
      return item->holder_actor_id == requirement->target_id && item->location_id == 0;
    case CW_PLACEMENT_LOCATION_FLOOR:
      return item->holder_actor_id == 0 && item->location_id == requirement->target_id;
    default:
      return 0;
  }
}

static int evolution_track_satisfied(const cw_world *world, const cw_evolution_track *track) {
  if (!track || track->requirement_count == 0) return 0;
  for (size_t i = 0; i < track->requirement_count; ++i) {
    if (!evolution_requirement_satisfied(world, &track->requirements[i])) return 0;
  }
  return 1;
}

static void maybe_evolve_after_placement(cw_world *world, cw_id source_actor_id, cw_id trigger_item_id, cw_event_buffer *out_events) {
  for (size_t i = 0; i < world->evolution_track_count; ++i) {
    const cw_evolution_track *track = &world->evolution_tracks[i];
    cw_actor *target = find_actor(world, track->actor_id);
    if (!target || target->kind != CW_ACTOR_NPC || target->stats.level >= 2) continue;
    if (!evolution_track_satisfied(world, track)) continue;

    target->stats.level = 2;
    target->stats.hp_base = (int16_t)(target->stats.hp_base + 2);
    append_event(world, out_events, CW_EVENT_AVATAR_EVOLVED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = source_actor_id;
      event->target_actor_id = target->id;
      event->location_id = target->location_id;
      event->item_id = trigger_item_id;
      event->total = target->stats.level;
      event->current_hp = cw_actor_current_hp(target);
    }
  }
}

static cw_status apply_give_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (actor->kind != CW_ACTOR_HUMAN && actor->kind != CW_ACTOR_NPC) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->kind != CW_ACTOR_NPC) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != actor->id) return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);

  cw_item *returned_item = 0;
  if (action->target_item_id) {
    returned_item = find_item(world, action->target_item_id);
    if (!returned_item || returned_item->holder_actor_id != target->id) {
      return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
    }
  }
  if (!actor_can_exchange(world, actor, item, returned_item)
      || !actor_can_exchange(world, target, returned_item, item)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }

  item->holder_actor_id = target->id;
  item->location_id = 0;
  item->held_since_tick = world->tick;
  item->zone = CW_CARD_ZONE_CARRIED;
  item->container_item_id = 0;
  if (returned_item) {
    returned_item->holder_actor_id = actor->id;
    returned_item->location_id = 0;
    returned_item->held_since_tick = world->tick;
    returned_item->zone = CW_CARD_ZONE_CARRIED;
    returned_item->container_item_id = 0;
  }

  append_event(world, out_events, CW_EVENT_ITEM_GIVEN);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
    event->target_item_id = returned_item ? returned_item->id : 0;
  }

  maybe_evolve_after_placement(world, actor->id, item->id, out_events);
  return CW_OK;
}

static cw_status apply_trade_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (actor->kind != CW_ACTOR_HUMAN && actor->kind != CW_ACTOR_NPC) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  if (!action->item_id || !action->target_item_id || action->item_id == action->target_item_id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->kind != CW_ACTOR_NPC) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->id == actor->id) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  cw_item *offered = find_item(world, action->item_id);
  cw_item *requested = find_item(world, action->target_item_id);
  if (!offered || !requested) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (offered->holder_actor_id != actor->id || requested->holder_actor_id != target->id) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (!actor_can_exchange(world, actor, offered, requested)
      || !actor_can_exchange(world, target, requested, offered)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }

  offered->holder_actor_id = target->id;
  offered->location_id = 0;
  offered->held_since_tick = world->tick;
  offered->zone = CW_CARD_ZONE_CARRIED;
  offered->container_item_id = 0;
  requested->holder_actor_id = actor->id;
  requested->location_id = 0;
  requested->held_since_tick = world->tick;
  requested->zone = CW_CARD_ZONE_CARRIED;
  requested->container_item_id = 0;

  append_event(world, out_events, CW_EVENT_ITEM_TRADED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = offered->id;
    event->target_item_id = requested->id;
  }
  maybe_evolve_after_placement(world, actor->id, offered->id, out_events);
  maybe_evolve_after_placement(world, target->id, requested->id, out_events);
  return CW_OK;
}

static cw_status apply_search(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_id location_id = action->location_id ? action->location_id : actor->location_id;
  if (location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  if (!find_location(world, location_id)) return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != 0 || item->location_id != 0 || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  item->holder_actor_id = 0;
  item->location_id = location_id;
  item->held_since_tick = 0;
  item->zone = CW_CARD_ZONE_WORLD;
  item->container_item_id = 0;

  append_event(world, out_events, CW_EVENT_ITEM_FOUND);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = location_id;
    event->content_id = action->content_id;
    event->item_id = item->id;
  }
  maybe_evolve_after_placement(world, actor->id, item->id, out_events);
  return CW_OK;
}

static cw_status validate_output_slot(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  if (!action->output_item_id) return CW_OK;
  if (!action->output_target_id || !action->output_target_kind || !action->output_item_kind || !action->output_item_charges) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  if (find_item(world, action->output_item_id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (world->item_count >= CW_MAX_ITEMS) return CW_ERR_FULL;
  switch (action->output_target_kind) {
    case CW_PLACEMENT_ACTOR_HAND: {
      cw_actor *target = find_actor(world, action->output_target_id);
      if (!target || !actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
      cw_item output;
      memset(&output, 0, sizeof(output));
      output.weight_tenths = CW_ITEM_DEFAULT_WEIGHT_TENTHS;
      output.size_class = CW_ITEM_SIZE_SMALL;
      output.role = action->output_item_kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC;
      if (!actor_can_exchange(world, target, 0, &output)) {
        return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
      }
      return CW_OK;
    }
    case CW_PLACEMENT_LOCATION_FLOOR:
      if (!find_location(world, action->output_target_id)) return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
      return CW_OK;
    default:
      return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
}

static cw_status apply_craft(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (!action->content_id || !action->item_id || !action->target_item_id || action->item_id == action->target_item_id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  cw_item *held = find_item(world, action->item_id);
  cw_item *floor = find_item(world, action->target_item_id);
  if (!held || !floor) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (held->holder_actor_id != actor->id || floor->holder_actor_id != 0 || floor->location_id != actor->location_id) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  status = validate_output_slot(world, action, out_events);
  if (status != CW_OK) return status;

  append_event(world, out_events, CW_EVENT_ITEM_CRAFTED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->content_id = action->content_id;
    event->item_id = held->id;
    event->target_item_id = floor->id;
    event->destination_location_id =
        action->output_target_kind == CW_PLACEMENT_LOCATION_FLOOR ? action->output_target_id : 0;
    event->target_actor_id =
        action->output_target_kind == CW_PLACEMENT_ACTOR_HAND ? action->output_target_id : 0;
  }

  if (action->output_item_id) {
    status = create_item(
        world,
        action->output_item_id,
        action->output_item_kind,
        action->output_item_charges,
        action->output_target_kind,
        action->output_target_id);
    if (status != CW_OK) return status;

    append_event(world, out_events, CW_EVENT_ITEM_CREATED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->location_id =
          action->output_target_kind == CW_PLACEMENT_LOCATION_FLOOR ? action->output_target_id : actor->location_id;
      event->target_actor_id =
          action->output_target_kind == CW_PLACEMENT_ACTOR_HAND ? action->output_target_id : 0;
      event->destination_location_id =
          action->output_target_kind == CW_PLACEMENT_LOCATION_FLOOR ? action->output_target_id : 0;
      event->content_id = action->content_id;
      event->item_id = action->output_item_id;
      event->target_item_id = floor->id;
    }
    maybe_evolve_after_placement(world, actor->id, action->output_item_id, out_events);
  } else {
    maybe_evolve_after_placement(world, actor->id, held->id, out_events);
    maybe_evolve_after_placement(world, actor->id, floor->id, out_events);
  }
  return CW_OK;
}

static cw_status apply_defend(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  actor->conditions |= CW_CONDITION_DEFENDING;
  append_event(world, out_events, CW_EVENT_COMBAT_DEFEND);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
  }
  return CW_OK;
}

static cw_status apply_attack(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (!valid_roll_mode(action->roll_mode)) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);

  if (action->actor_id == action->target_actor_id) return reject(world, out_events, action, CW_REASON_SELF_TARGET);
  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  const cw_location *location = find_location_const(world, actor->location_id);
  if (!location || !(location->flags & CW_LOCATION_ALLOW_COMBAT)) {
    return reject(world, out_events, action, CW_REASON_COMBAT_NOT_ALLOWED);
  }

  int16_t raw = roll_d20(seed, 1, action->roll_mode);
  int16_t attack_mod = ability_modifier(actor->stats.strength);
  int16_t attack_total = (int16_t)(raw + attack_mod);
  int16_t ac = (int16_t)(10 + ability_modifier(target->stats.dexterity));
  if (target->conditions & CW_CONDITION_DEFENDING) ac += 2;
  int attack_hit = raw == 20 || (raw != 1 && attack_total >= ac);

  append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = attack_hit ? 1 : 0;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->raw_roll = raw;
    event->modifier = attack_mod;
    event->total = attack_total;
    event->dc = ac;
  }

  if (!attack_hit) {
    target->conditions &= ~CW_CONDITION_DEFENDING;
    append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_MISS);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 0;
      event->actor_id = actor->id;
      event->target_actor_id = target->id;
      event->location_id = actor->location_id;
      event->raw_roll = raw;
      event->modifier = attack_mod;
      event->total = attack_total;
      event->dc = ac;
    }
    return CW_OK;
  }

  int16_t damage_die = roll_die(seed, 2, 8);
  if (raw == 20) damage_die = (int16_t)(damage_die + roll_die(seed, 3, 8));
  int16_t damage = (int16_t)(damage_die + ability_modifier(actor->stats.strength));
  if (damage < 1) damage = 1;
  int knocks_out = damage >= cw_actor_current_hp(target);
  if (knocks_out) {
    target->damage = target->stats.hp_base > 1 ? (int16_t)(target->stats.hp_base - 1) : 0;
    target->status = CW_ACTOR_KNOCKED_OUT;
    target->conditions |= CW_CONDITION_UNCONSCIOUS;
  } else {
    target->damage = (int16_t)(target->damage + damage);
  }
  target->conditions &= ~CW_CONDITION_DEFENDING;

  append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_HIT);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->raw_roll = raw;
    event->modifier = attack_mod;
    event->total = attack_total;
    event->dc = ac;
    event->damage = damage;
    event->current_hp = cw_actor_current_hp(target);
  }

  if (knocks_out) {
    append_event(world, out_events, CW_EVENT_COMBAT_KNOCKOUT);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->target_actor_id = target->id;
      event->location_id = actor->location_id;
      event->damage = damage;
      event->current_hp = cw_actor_current_hp(target);
    }
  }

  return CW_OK;
}

static cw_status apply_flee(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  const cw_location *location = find_location_const(world, actor->location_id);
  if (!location || !(location->flags & CW_LOCATION_ALLOW_COMBAT)) {
    return reject(world, out_events, action, CW_REASON_COMBAT_NOT_ALLOWED);
  }

  cw_id destination_id = action->destination_location_id;
  if (!destination_id || !find_location(world, destination_id)) {
    return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
  }
  if (destination_id == actor->location_id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  const cw_exit *exit = find_exit_const(world, actor->location_id, destination_id);
  if (!exit) {
    return reject(world, out_events, action, CW_REASON_NO_EXIT);
  }
  if (exit->flags & CW_EXIT_LOCKED) {
    return reject(world, out_events, action, CW_REASON_EXIT_LOCKED);
  }

  cw_id from_location_id = actor->location_id;
  actor->location_id = destination_id;
  actor->conditions &= ~(CW_CONDITION_DEFENDING | CW_CONDITION_HIDDEN);

  append_event(world, out_events, CW_EVENT_COMBAT_FLEE_SUCCESS);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = from_location_id;
    event->destination_location_id = destination_id;
  }
  return CW_OK;
}

static int16_t proficiency_bonus(const cw_actor *actor) {
  int16_t level = actor && actor->stats.level > 0 ? actor->stats.level : 1;
  int16_t bonus = (int16_t)(2 + ((level - 1) / 4));
  return bonus > 6 ? 6 : bonus;
}

static int combat_participant_can_act(const cw_world *world, const cw_combat_participant *participant) {
  if (!participant || (participant->flags & CW_COMBAT_PARTICIPANT_ESCAPED)) return 0;
  const cw_actor *actor = find_actor_const(world, participant->actor_id);
  return actor_is_active(actor);
}

static void sort_combat_participants(cw_combat_encounter *encounter) {
  for (size_t i = 1; i < encounter->participant_count; ++i) {
    cw_combat_participant value = encounter->participants[i];
    size_t j = i;
    while (j > 0) {
      const cw_combat_participant *left = &encounter->participants[j - 1];
      int value_before_left = value.initiative > left->initiative
          || (value.initiative == left->initiative && value.actor_id < left->actor_id);
      if (!value_before_left) break;
      encounter->participants[j] = encounter->participants[j - 1];
      --j;
    }
    encounter->participants[j] = value;
  }
}

static void append_combat_turn_started(cw_world *world, cw_combat_encounter *encounter, cw_event_buffer *out_events) {
  if (!encounter || encounter->participant_count == 0) return;
  cw_combat_participant *participant = &encounter->participants[encounter->current_index];
  cw_actor *actor = find_actor(world, participant->actor_id);
  if (actor) actor->conditions &= ~CW_CONDITION_DODGING;
  append_event(world, out_events, CW_EVENT_COMBAT_TURN_STARTED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = participant->actor_id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
    event->total = (int16_t)encounter->round;
  }
}

static int combat_side_can_act(const cw_world *world, const cw_combat_encounter *encounter, uint8_t side) {
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    if (encounter->participants[i].side == side
        && combat_participant_can_act(world, &encounter->participants[i])) {
      return 1;
    }
  }
  return 0;
}

static void finish_or_advance_combat_turn(
    cw_world *world,
    cw_combat_encounter *encounter,
    const cw_action *action,
    cw_event_buffer *out_events) {
  append_event(world, out_events, CW_EVENT_COMBAT_TURN_ENDED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = action->actor_id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
    event->total = (int16_t)encounter->round;
  }

  int side_one_active = combat_side_can_act(world, encounter, 1);
  int side_two_active = combat_side_can_act(world, encounter, 2);
  if (!side_one_active || !side_two_active) {
    encounter->status = CW_COMBAT_ENCOUNTER_RESOLVED;
    append_event(world, out_events, CW_EVENT_COMBAT_ENCOUNTER_RESOLVED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = action->actor_id;
      event->target_actor_id = action->target_actor_id;
      event->location_id = encounter->location_id;
      event->content_id = encounter->id;
      event->total = side_one_active ? 1 : (side_two_active ? 2 : 0);
    }
    return;
  }

  size_t previous_index = encounter->current_index;
  for (size_t step = 1; step <= encounter->participant_count; ++step) {
    size_t next_index = (previous_index + step) % encounter->participant_count;
    if (!combat_participant_can_act(world, &encounter->participants[next_index])) continue;
    if (next_index <= previous_index && encounter->round < UINT16_MAX) encounter->round++;
    encounter->current_index = (uint8_t)next_index;
    append_combat_turn_started(world, encounter, out_events);
    return;
  }
}

static cw_status require_active_combat_turn(
    cw_world *world,
    const cw_action *action,
    cw_event_buffer *out_events,
    cw_combat_encounter **out_encounter,
    cw_actor **out_actor) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  cw_combat_encounter *encounter = action->content_id
      ? find_combat_encounter(world, action->content_id)
      : find_active_combat_encounter_for_actor(world, action->actor_id);
  if (!encounter || encounter->status != CW_COMBAT_ENCOUNTER_ACTIVE) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_NOT_FOUND);
  }
  const cw_combat_participant *participant = find_combat_participant_const(encounter, action->actor_id);
  if (!participant || !combat_participant_can_act(world, participant)) {
    return reject(world, out_events, action, CW_REASON_NOT_PARTICIPANT);
  }
  if (encounter->participants[encounter->current_index].actor_id != action->actor_id) {
    return reject(world, out_events, action, CW_REASON_NOT_CURRENT_TURN);
  }
  *out_encounter = encounter;
  *out_actor = actor;
  return CW_OK;
}

static cw_status apply_combat_start(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  if (!action->content_id) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (actor->kind != CW_ACTOR_HUMAN || action->actor_id == action->target_actor_id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target) || target->kind != CW_ACTOR_NPC) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }
  if (target->location_id != actor->location_id) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  const cw_location *location = find_location_const(world, actor->location_id);
  if (!location || !(location->flags & CW_LOCATION_ALLOW_COMBAT)) {
    return reject(world, out_events, action, CW_REASON_COMBAT_NOT_ALLOWED);
  }
  if (find_active_combat_encounter_for_actor(world, actor->id)
      || find_active_combat_encounter_for_actor(world, target->id)) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_ACTIVE);
  }

  cw_combat_encounter *encounter = find_combat_encounter(world, action->content_id);
  if (encounter && encounter->status == CW_COMBAT_ENCOUNTER_ACTIVE) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_ACTIVE);
  }
  if (!encounter) {
    for (size_t i = 0; i < world->combat_encounter_count; ++i) {
      if (world->combat_encounters[i].status == CW_COMBAT_ENCOUNTER_RESOLVED) {
        encounter = &world->combat_encounters[i];
        break;
      }
    }
    if (!encounter) {
      if (world->combat_encounter_count >= CW_MAX_COMBAT_ENCOUNTERS) {
        return reject(world, out_events, action, CW_REASON_ENCOUNTER_FULL);
      }
      encounter = &world->combat_encounters[world->combat_encounter_count++];
    }
  }
  memset(encounter, 0, sizeof(*encounter));
  encounter->id = action->content_id;
  encounter->location_id = actor->location_id;
  encounter->status = CW_COMBAT_ENCOUNTER_ACTIVE;
  encounter->round = 1;
  encounter->participant_count = 2;

  int16_t actor_raw = roll_d20(seed, 101, CW_ROLL_NORMAL);
  int16_t target_raw = roll_d20(seed, 102, CW_ROLL_NORMAL);
  encounter->participants[0].actor_id = actor->id;
  encounter->participants[0].side = 1;
  encounter->participants[0].initiative = (int16_t)(actor_raw + ability_modifier(actor->stats.dexterity));
  encounter->participants[1].actor_id = target->id;
  encounter->participants[1].side = 2;
  encounter->participants[1].initiative = (int16_t)(target_raw + ability_modifier(target->stats.dexterity));
  sort_combat_participants(encounter);

  append_event(world, out_events, CW_EVENT_COMBAT_ENCOUNTER_STARTED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->content_id = encounter->id;
  }
  cw_actor *initiative_actors[2] = {actor, target};
  int16_t initiative_raw[2] = {actor_raw, target_raw};
  for (size_t i = 0; i < 2; ++i) {
    const cw_combat_participant *participant = find_combat_participant_const(encounter, initiative_actors[i]->id);
    append_event(world, out_events, CW_EVENT_COMBAT_INITIATIVE_ROLLED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = initiative_actors[i]->id;
      event->location_id = actor->location_id;
      event->content_id = encounter->id;
      event->raw_roll = initiative_raw[i];
      event->modifier = ability_modifier(initiative_actors[i]->stats.dexterity);
      event->total = participant ? participant->initiative : 0;
    }
  }
  append_combat_turn_started(world, encounter, out_events);
  return CW_OK;
}

static cw_status apply_combat_join(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  if (!action->content_id) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  cw_combat_encounter *encounter = find_combat_encounter(world, action->content_id);
  if (!encounter || encounter->status != CW_COMBAT_ENCOUNTER_ACTIVE) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_NOT_FOUND);
  }
  if (actor->location_id != encounter->location_id) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  if (find_combat_participant(encounter, actor->id)) return CW_OK;
  if (find_active_combat_encounter_for_actor(world, actor->id)) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_ACTIVE);
  }
  if (encounter->participant_count >= CW_MAX_COMBAT_PARTICIPANTS) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_FULL);
  }

  cw_id current_actor_id = encounter->participants[encounter->current_index].actor_id;
  int16_t raw = roll_d20(seed, 103, CW_ROLL_NORMAL);
  cw_combat_participant *participant = &encounter->participants[encounter->participant_count++];
  memset(participant, 0, sizeof(*participant));
  participant->actor_id = actor->id;
  participant->side = actor->kind == CW_ACTOR_HUMAN ? 1 : 2;
  participant->initiative = (int16_t)(raw + ability_modifier(actor->stats.dexterity));
  sort_combat_participants(encounter);
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    if (encounter->participants[i].actor_id == current_actor_id) {
      encounter->current_index = (uint8_t)i;
      break;
    }
  }

  append_event(world, out_events, CW_EVENT_COMBAT_PARTICIPANT_JOINED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
  }
  append_event(world, out_events, CW_EVENT_COMBAT_INITIATIVE_ROLLED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
    event->raw_roll = raw;
    event->modifier = ability_modifier(actor->stats.dexterity);
    event->total = find_combat_participant_const(encounter, actor->id)->initiative;
  }
  return CW_OK;
}

static cw_status apply_combat_attack(cw_world *world, const cw_action *action, uint64_t seed, int finesse, cw_event_buffer *out_events) {
  cw_combat_encounter *encounter = 0;
  cw_actor *actor = 0;
  cw_status status = require_active_combat_turn(world, action, out_events, &encounter, &actor);
  if (status != CW_OK) return status;
  if (action->actor_id == action->target_actor_id) {
    return reject(world, out_events, action, CW_REASON_SELF_TARGET);
  }
  cw_actor *target = find_actor(world, action->target_actor_id);
  const cw_combat_participant *actor_participant = find_combat_participant_const(encounter, actor->id);
  const cw_combat_participant *target_participant = find_combat_participant_const(encounter, action->target_actor_id);
  if (!target || !target_participant) return reject(world, out_events, action, CW_REASON_NOT_PARTICIPANT);
  if (!combat_participant_can_act(world, target_participant)) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }
  if (!actor_participant || actor_participant->side == target_participant->side) {
    return reject(world, out_events, action, CW_REASON_NOT_HOSTILE);
  }
  const cw_item *weapon = 0;
  if (action->item_id) {
    weapon = find_item_const(world, action->item_id);
    if (!weapon || weapon->holder_actor_id != actor->id
        || weapon->role != CW_ITEM_ROLE_WEAPON
        || weapon->zone != CW_CARD_ZONE_EQUIPPED) {
      return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
    }
  }

  uint8_t roll_mode = (target->conditions & CW_CONDITION_DODGING)
      ? CW_ROLL_DISADVANTAGE
      : CW_ROLL_NORMAL;
  int16_t raw = roll_d20(seed, 1, roll_mode);
  int16_t strength_mod = ability_modifier(actor->stats.strength);
  int16_t dexterity_mod = ability_modifier(actor->stats.dexterity);
  int16_t attack_ability_mod = finesse && dexterity_mod > strength_mod
      ? dexterity_mod
      : strength_mod;
  int16_t attack_mod = (int16_t)(attack_ability_mod + proficiency_bonus(actor));
  int16_t attack_total = (int16_t)(raw + attack_mod);
  int16_t ac = (int16_t)(10 + ability_modifier(target->stats.dexterity));
  int attack_hit = raw == 20 || (raw != 1 && attack_total >= ac);

  append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = attack_hit ? 1 : 0;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
    event->raw_roll = raw;
    event->modifier = attack_mod;
    event->total = attack_total;
    event->dc = ac;
    event->item_id = weapon ? weapon->id : 0;
  }

  if (!attack_hit) {
    append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_MISS);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 0;
      event->actor_id = actor->id;
      event->target_actor_id = target->id;
      event->location_id = encounter->location_id;
      event->content_id = encounter->id;
      event->raw_roll = raw;
      event->modifier = attack_mod;
      event->total = attack_total;
      event->dc = ac;
      event->item_id = weapon ? weapon->id : 0;
    }
    finish_or_advance_combat_turn(world, encounter, action, out_events);
    return CW_OK;
  }

  uint8_t damage_die = weapon && weapon->reserved >= 2 ? weapon->reserved : 8;
  int16_t damage_dice = roll_die(seed, 2, damage_die);
  if (raw == 20) damage_dice = (int16_t)(damage_dice + roll_die(seed, 3, damage_die));
  int16_t damage = (int16_t)(damage_dice + attack_ability_mod);
  if (damage < 0) damage = 0;
  int knocks_out = damage >= cw_actor_current_hp(target) && damage > 0;
  if (knocks_out) {
    target->damage = target->stats.hp_base > 1 ? (int16_t)(target->stats.hp_base - 1) : 0;
    target->status = CW_ACTOR_KNOCKED_OUT;
    target->conditions |= CW_CONDITION_UNCONSCIOUS;
  } else {
    target->damage = (int16_t)(target->damage + damage);
  }

  append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_HIT);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
    event->raw_roll = raw;
    event->modifier = attack_mod;
    event->total = attack_total;
    event->dc = ac;
    event->damage = damage;
    event->current_hp = cw_actor_current_hp(target);
    event->item_id = weapon ? weapon->id : 0;
  }
  if (knocks_out) {
    append_event(world, out_events, CW_EVENT_COMBAT_KNOCKOUT);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->target_actor_id = target->id;
      event->location_id = encounter->location_id;
      event->content_id = encounter->id;
      event->damage = damage;
      event->current_hp = cw_actor_current_hp(target);
      event->item_id = weapon ? weapon->id : 0;
    }
  }
  finish_or_advance_combat_turn(world, encounter, action, out_events);
  return CW_OK;
}

static cw_status apply_combat_dodge(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_combat_encounter *encounter = 0;
  cw_actor *actor = 0;
  cw_status status = require_active_combat_turn(world, action, out_events, &encounter, &actor);
  if (status != CW_OK) return status;
  actor->conditions |= CW_CONDITION_DODGING;
  append_event(world, out_events, CW_EVENT_COMBAT_DODGE);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
  }
  finish_or_advance_combat_turn(world, encounter, action, out_events);
  return CW_OK;
}

static cw_status apply_combat_escape(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_combat_encounter *encounter = 0;
  cw_actor *actor = 0;
  cw_status status = require_active_combat_turn(world, action, out_events, &encounter, &actor);
  if (status != CW_OK) return status;
  cw_id destination_id = action->destination_location_id;
  if (!destination_id || !find_location(world, destination_id)) {
    return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
  }
  const cw_exit *exit = find_exit_const(world, actor->location_id, destination_id);
  if (!exit) return reject(world, out_events, action, CW_REASON_NO_EXIT);
  if (exit->flags & CW_EXIT_LOCKED) return reject(world, out_events, action, CW_REASON_EXIT_LOCKED);

  cw_id from_location_id = actor->location_id;
  actor->location_id = destination_id;
  actor->conditions &= ~(CW_CONDITION_DODGING | CW_CONDITION_DEFENDING | CW_CONDITION_HIDDEN);
  cw_combat_participant *participant = find_combat_participant(encounter, actor->id);
  participant->flags |= CW_COMBAT_PARTICIPANT_ESCAPED;
  append_event(world, out_events, CW_EVENT_COMBAT_FLEE_SUCCESS);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = from_location_id;
    event->destination_location_id = destination_id;
    event->content_id = encounter->id;
  }
  finish_or_advance_combat_turn(world, encounter, action, out_events);
  return CW_OK;
}

cw_status cw_world_apply_with_tick(cw_world *world, const cw_action *action, uint64_t seed, uint8_t advance_tick, cw_event_buffer *out_events) {
  if (!world || !action) return CW_ERR_INVALID;
  if (out_events) memset(out_events, 0, sizeof(*out_events));
  cw_combat_encounter *active_encounter = find_active_combat_encounter_for_actor(world, action->actor_id);
  if (active_encounter
      && action->kind != CW_ACTION_SAY
      && action->kind != CW_ACTION_COMBAT_ATTACK
      && action->kind != CW_ACTION_COMBAT_FINESSE_ATTACK
      && action->kind != CW_ACTION_COMBAT_DODGE
      && action->kind != CW_ACTION_COMBAT_ESCAPE) {
    cw_status status = reject(world, out_events, action, CW_REASON_COMBAT_ACTION_REQUIRED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->location_id = active_encounter->location_id;
      event->content_id = active_encounter->id;
    }
    return status;
  }
  uint64_t previous_tick = world->tick;
  if (advance_tick) world->tick++;

  cw_status status = CW_ERR_INVALID;
  switch (action->kind) {
    case CW_ACTION_CREATE_ACTOR:
      status = apply_create_actor(world, action, seed, out_events);
      break;
    case CW_ACTION_SAY:
      status = apply_say(world, action, out_events);
      break;
    case CW_ACTION_MOVE:
      status = apply_move(world, action, out_events);
      break;
    case CW_ACTION_ABILITY_CHECK:
      status = apply_ability_check(world, action, seed, out_events);
      break;
    case CW_ACTION_RULES_SEARCH:
    case CW_ACTION_RULES_STUDY:
    case CW_ACTION_RULES_INFLUENCE:
      status = apply_ability_check(world, action, seed, out_events);
      break;
    case CW_ACTION_RULES_MAGIC:
      status = apply_rules_magic(world, action, out_events);
      break;
    case CW_ACTION_THEFT:
      status = apply_theft(world, action, seed, out_events);
      break;
    case CW_ACTION_PICK_UP_ITEM:
      status = apply_pick_up_item(world, action, out_events);
      break;
    case CW_ACTION_DROP_ITEM:
      status = apply_drop_item(world, action, out_events);
      break;
    case CW_ACTION_USE_ITEM:
      status = apply_use_item(world, action, out_events);
      break;
    case CW_ACTION_ATTACK:
      status = apply_attack(world, action, seed, out_events);
      break;
    case CW_ACTION_DEFEND:
      status = apply_defend(world, action, out_events);
      break;
    case CW_ACTION_GIVE_ITEM:
      status = apply_give_item(world, action, out_events);
      break;
    case CW_ACTION_TRADE_ITEM:
      status = apply_trade_item(world, action, out_events);
      break;
    case CW_ACTION_SEARCH:
      status = apply_search(world, action, out_events);
      break;
    case CW_ACTION_CRAFT:
      status = apply_craft(world, action, out_events);
      break;
    case CW_ACTION_FLEE:
      status = apply_flee(world, action, out_events);
      break;
    case CW_ACTION_COMBAT_START:
      status = apply_combat_start(world, action, seed, out_events);
      break;
    case CW_ACTION_COMBAT_JOIN:
      status = apply_combat_join(world, action, seed, out_events);
      break;
    case CW_ACTION_COMBAT_ATTACK:
      status = apply_combat_attack(world, action, seed, 0, out_events);
      break;
    case CW_ACTION_COMBAT_FINESSE_ATTACK:
      status = apply_combat_attack(world, action, seed, 1, out_events);
      break;
    case CW_ACTION_COMBAT_DODGE:
      status = apply_combat_dodge(world, action, out_events);
      break;
    case CW_ACTION_COMBAT_ESCAPE:
      status = apply_combat_escape(world, action, out_events);
      break;
    default:
      status = reject(world, out_events, action, CW_REASON_INVALID_ACTION);
      break;
  }
  if (status != CW_OK && advance_tick) world->tick = previous_tick;
  return status;
}

cw_status cw_world_apply(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  return cw_world_apply_with_tick(world, action, seed, 0, out_events);
}

cw_status cw_get_action_offers(const cw_world *world, cw_id actor_id, cw_action_offers *out_offers) {
  if (!world || !out_offers) return CW_ERR_INVALID;
  memset(out_offers, 0, sizeof(*out_offers));
  const cw_actor *actor = find_actor_const(world, actor_id);
  if (!actor) return CW_ERR_NOT_FOUND;
  if (!actor_is_active(actor)) return CW_OK;

  for (size_t i = 0; i < world->combat_encounter_count; ++i) {
    const cw_combat_encounter *encounter = &world->combat_encounters[i];
    if (encounter->status != CW_COMBAT_ENCOUNTER_ACTIVE) continue;
    const cw_combat_participant *participant = find_combat_participant_const(encounter, actor_id);
    if (!participant || !combat_participant_can_act(world, participant)) continue;
    if (encounter->participants[encounter->current_index].actor_id == actor_id) {
      out_offers->option_flags = CW_OFFER_ATTACK | CW_OFFER_DEFEND;
      for (size_t exit_index = 0; exit_index < world->exit_count; ++exit_index) {
        const cw_exit *exit = &world->exits[exit_index];
        if (exit->from_location_id == actor->location_id && !(exit->flags & CW_EXIT_LOCKED)) {
          out_offers->option_flags |= CW_OFFER_FLEE;
          break;
        }
      }
    }
    return CW_OK;
  }

  out_offers->option_flags |= CW_OFFER_CHAT | CW_OFFER_CHECK;

  const cw_location *location = find_location_const(world, actor->location_id);
  if (location && (location->flags & CW_LOCATION_ALLOW_COMBAT)) {
    int has_active_combat_target = 0;
    for (size_t i = 0; i < world->actor_count; ++i) {
      const cw_actor *other = &world->actors[i];
      if (other->id != actor->id && other->location_id == actor->location_id && actor_is_active(other)) {
        has_active_combat_target = 1;
        break;
      }
    }
    if (has_active_combat_target) {
      out_offers->option_flags |= CW_OFFER_ATTACK | CW_OFFER_DEFEND;
      for (size_t i = 0; i < world->exit_count; ++i) {
        const cw_exit *exit = &world->exits[i];
        if (exit->from_location_id == actor->location_id && !(exit->flags & CW_EXIT_LOCKED)) {
          out_offers->option_flags |= CW_OFFER_FLEE;
          break;
        }
      }
    }
  }

  for (size_t i = 0; i < world->exit_count; ++i) {
    const cw_exit *exit = &world->exits[i];
    if (exit->from_location_id == actor->location_id && !(exit->flags & CW_EXIT_LOCKED)) {
      out_offers->option_flags |= CW_OFFER_MOVE;
      break;
    }
  }

  int actor_has_held_item = 0;
  int room_npc_has_held_item = 0;
  int room_has_active_npc = 0;
  int room_has_loose_item = 0;
  int hidden_search_item_available = 0;
  for (size_t i = 0; i < world->actor_count; ++i) {
    const cw_actor *other = &world->actors[i];
    if (other->id != actor->id && other->kind == CW_ACTOR_NPC && actor_is_active(other) && other->location_id == actor->location_id) {
      room_has_active_npc = 1;
      break;
    }
  }
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *item = &world->items[i];
    if (!item->holder_actor_id && item->location_id == actor->location_id) {
      room_has_loose_item = 1;
      if (actor_can_pick_up(world, actor, item)) {
        out_offers->option_flags |= CW_OFFER_PICK_UP;
      }
    }
    if (!item->holder_actor_id && item->location_id == 0 && item->charges > 0) {
      hidden_search_item_available = 1;
    }
    if (item->holder_actor_id == actor->id
        && (item->kind == CW_ITEM_POTION || item->role == CW_ITEM_ROLE_SPELL)
        && item->charges > 0) {
      out_offers->option_flags |= CW_OFFER_USE_ITEM;
    }
    if (item->holder_actor_id == actor->id) {
      actor_has_held_item = 1;
    }
    if (item->holder_actor_id && item->holder_actor_id != actor->id) {
      const cw_actor *holder = find_actor_const(world, item->holder_actor_id);
      if (holder && holder->kind == CW_ACTOR_NPC && actor_is_active(holder) && holder->location_id == actor->location_id) {
        room_npc_has_held_item = 1;
      }
    }
  }
  if (actor_has_held_item && room_has_active_npc) {
    out_offers->option_flags |= CW_OFFER_GIVE_ITEM;
  }
  if (actor_has_held_item && !room_has_loose_item) {
    out_offers->option_flags |= CW_OFFER_DROP_ITEM;
  }
  if (!room_has_loose_item && hidden_search_item_available) {
    out_offers->option_flags |= CW_OFFER_SEARCH;
  }
  if (actor_has_held_item && room_has_loose_item) {
    out_offers->option_flags |= CW_OFFER_CRAFT;
  }
  if ((actor->kind == CW_ACTOR_HUMAN || actor->kind == CW_ACTOR_NPC)
      && actor_has_held_item
      && room_npc_has_held_item) {
    out_offers->option_flags |= CW_OFFER_TRADE_ITEM;
  }

  return CW_OK;
}

const char *cw_event_type_name(uint8_t type) {
  switch (type) {
    case CW_EVENT_WORLD_BOOTSTRAPPED: return "world.bootstrapped";
    case CW_EVENT_ACTOR_CREATED: return "actor.created";
    case CW_EVENT_ACTOR_ENTERED_LOCATION: return "actor.entered_location";
    case CW_EVENT_MESSAGE_CREATED: return "message.created";
    case CW_EVENT_MOVE_BLOCKED: return "move.blocked";
    case CW_EVENT_ABILITY_CHECK_ROLLED: return "ability_check.rolled";
    case CW_EVENT_ITEM_PICKED_UP: return "item.picked_up";
    case CW_EVENT_ITEM_USED: return "item.used";
    case CW_EVENT_COMBAT_DEFEND: return "combat.defend";
    case CW_EVENT_COMBAT_ATTACK_ATTEMPT: return "combat.attack.attempt";
    case CW_EVENT_COMBAT_ATTACK_HIT: return "combat.attack.hit";
    case CW_EVENT_COMBAT_ATTACK_MISS: return "combat.attack.miss";
    case CW_EVENT_COMBAT_KNOCKOUT: return "combat.knockout";
    case CW_EVENT_RULE_REJECTED: return "rule.rejected";
    case CW_EVENT_ACTOR_MOVED: return "actor.moved";
    case CW_EVENT_ITEM_GIVEN: return "item.given";
    case CW_EVENT_AVATAR_EVOLVED: return "avatar.evolved";
    case CW_EVENT_COMBAT_FLEE_SUCCESS: return "combat.flee.success";
    case CW_EVENT_ITEM_DROPPED: return "item.dropped";
    case CW_EVENT_ITEM_TRADED: return "item.traded";
    case CW_EVENT_ITEM_FOUND: return "item.found";
    case CW_EVENT_ITEM_CRAFTED: return "item.crafted";
    case CW_EVENT_ITEM_CREATED: return "item.created";
    case CW_EVENT_COMBAT_ENCOUNTER_STARTED: return "combat.encounter.started";
    case CW_EVENT_COMBAT_PARTICIPANT_JOINED: return "combat.participant.joined";
    case CW_EVENT_COMBAT_INITIATIVE_ROLLED: return "combat.initiative.rolled";
    case CW_EVENT_COMBAT_TURN_STARTED: return "combat.turn.started";
    case CW_EVENT_COMBAT_TURN_ENDED: return "combat.turn.ended";
    case CW_EVENT_COMBAT_DODGE: return "combat.dodge";
    case CW_EVENT_COMBAT_ENCOUNTER_RESOLVED: return "combat.encounter.resolved";
    case CW_EVENT_SPELL_CAST: return "magic.spell_cast";
    case CW_EVENT_ITEM_THEFT_ATTEMPT: return "item.theft_attempt";
    case CW_EVENT_ITEM_STOLEN: return "item.stolen";
    default: return "unknown";
  }
}
