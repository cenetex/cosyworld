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
  CW_REASON_EXIT_LOCKED = 13
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
  switch (target_kind) {
    case CW_PLACEMENT_ACTOR_HAND:
      item->holder_actor_id = target_id;
      item->location_id = 0;
      item->held_since_tick = world->tick;
      break;
    case CW_PLACEMENT_LOCATION_FLOOR:
      item->holder_actor_id = 0;
      item->location_id = target_id;
      item->held_since_tick = 0;
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

static int actor_hand_empty(const cw_world *world, cw_id actor_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].holder_actor_id == actor_id) return 0;
  }
  return 1;
}

static int location_floor_empty(const cw_world *world, cw_id location_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *item = &world->items[i];
    if (item->holder_actor_id == 0 && item->location_id == location_id) return 0;
  }
  return 1;
}

static cw_item *oldest_held_item(cw_world *world, cw_id actor_id) {
  cw_item *oldest = 0;
  for (size_t i = 0; i < world->item_count; ++i) {
    cw_item *item = &world->items[i];
    if (item->holder_actor_id != actor_id) continue;
    if (!oldest
        || item->held_since_tick < oldest->held_since_tick
        || (item->held_since_tick == oldest->held_since_tick && item->id < oldest->id)) {
      oldest = item;
    }
  }
  return oldest;
}

static void maybe_evolve_after_placement(cw_world *world, cw_id source_actor_id, cw_id trigger_item_id, cw_event_buffer *out_events);

int16_t cw_actor_current_hp(const cw_actor *actor) {
  if (!actor) return 0;
  int16_t hp = (int16_t)(actor->stats.hp_base - actor->damage);
  return hp > 0 ? hp : 0;
}

void cw_world_init(cw_world *world) {
  if (!world) return;
  memset(world, 0, sizeof(*world));
  world->version = CW_KERNEL_VERSION;
  world->tick = 1;
  world->next_event_seq = 1;
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

  int16_t raw = roll_die(seed, 1, 20);
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

  cw_item *evicted = oldest_held_item(world, actor->id);
  if (evicted) {
    evicted->holder_actor_id = 0;
    evicted->location_id = actor->location_id;
    evicted->held_since_tick = 0;

    append_event(world, out_events, CW_EVENT_ITEM_DROPPED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->item_id = evicted->id;
    }
  }

  item->holder_actor_id = actor->id;
  item->location_id = 0;
  item->held_since_tick = world->tick;

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
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *loose = &world->items[i];
    if (loose->holder_actor_id == 0 && loose->location_id == actor->location_id) {
      return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
    }
  }

  item->holder_actor_id = 0;
  item->location_id = actor->location_id;
  item->held_since_tick = 0;

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
  if (!actor_hand_empty(world, target->id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  item->holder_actor_id = target->id;
  item->location_id = 0;
  item->held_since_tick = world->tick;

  append_event(world, out_events, CW_EVENT_ITEM_GIVEN);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
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

  offered->holder_actor_id = target->id;
  offered->location_id = 0;
  offered->held_since_tick = world->tick;
  requested->holder_actor_id = actor->id;
  requested->location_id = 0;
  requested->held_since_tick = world->tick;

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
  if (!location_floor_empty(world, location_id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != 0 || item->location_id != 0 || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  item->holder_actor_id = 0;
  item->location_id = location_id;
  item->held_since_tick = 0;

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
      if (!actor_hand_empty(world, target->id)) return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
      return CW_OK;
    }
    case CW_PLACEMENT_LOCATION_FLOOR:
      if (!find_location(world, action->output_target_id)) return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
      if (!location_floor_empty(world, action->output_target_id)) {
        return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
      }
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

  if (action->actor_id == action->target_actor_id) return reject(world, out_events, action, CW_REASON_SELF_TARGET);
  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  const cw_location *location = find_location_const(world, actor->location_id);
  if (!location || !(location->flags & CW_LOCATION_ALLOW_COMBAT)) {
    return reject(world, out_events, action, CW_REASON_COMBAT_NOT_ALLOWED);
  }

  int16_t raw = roll_die(seed, 1, 20);
  int16_t attack_mod = ability_modifier(actor->stats.strength);
  int16_t attack_total = (int16_t)(raw + attack_mod);
  int16_t ac = (int16_t)(10 + ability_modifier(target->stats.dexterity));
  if (target->conditions & CW_CONDITION_DEFENDING) ac += 2;

  append_event(world, out_events, CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = attack_total >= ac ? 1 : 0;
    event->actor_id = actor->id;
    event->target_actor_id = target->id;
    event->location_id = actor->location_id;
    event->raw_roll = raw;
    event->modifier = attack_mod;
    event->total = attack_total;
    event->dc = ac;
  }

  if (attack_total < ac) {
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
  target->damage = (int16_t)(target->damage + damage);
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

  if (cw_actor_current_hp(target) <= 0) {
    target->status = CW_ACTOR_KNOCKED_OUT;
    target->conditions |= CW_CONDITION_UNCONSCIOUS;
    append_event(world, out_events, CW_EVENT_COMBAT_KNOCKOUT);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->target_actor_id = target->id;
      event->location_id = actor->location_id;
      event->damage = damage;
      event->current_hp = 0;
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

cw_status cw_world_apply(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  if (!world || !action) return CW_ERR_INVALID;
  if (out_events) memset(out_events, 0, sizeof(*out_events));
  world->tick++;

  switch (action->kind) {
    case CW_ACTION_CREATE_ACTOR:
      return apply_create_actor(world, action, seed, out_events);
    case CW_ACTION_SAY:
      return apply_say(world, action, out_events);
    case CW_ACTION_MOVE:
      return apply_move(world, action, out_events);
    case CW_ACTION_ABILITY_CHECK:
      return apply_ability_check(world, action, seed, out_events);
    case CW_ACTION_PICK_UP_ITEM:
      return apply_pick_up_item(world, action, out_events);
    case CW_ACTION_DROP_ITEM:
      return apply_drop_item(world, action, out_events);
    case CW_ACTION_USE_ITEM:
      return apply_use_item(world, action, out_events);
    case CW_ACTION_ATTACK:
      return apply_attack(world, action, seed, out_events);
    case CW_ACTION_DEFEND:
      return apply_defend(world, action, out_events);
    case CW_ACTION_GIVE_ITEM:
      return apply_give_item(world, action, out_events);
    case CW_ACTION_TRADE_ITEM:
      return apply_trade_item(world, action, out_events);
    case CW_ACTION_SEARCH:
      return apply_search(world, action, out_events);
    case CW_ACTION_CRAFT:
      return apply_craft(world, action, out_events);
    case CW_ACTION_FLEE:
      return apply_flee(world, action, out_events);
    default:
      return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
}

cw_status cw_get_action_offers(const cw_world *world, cw_id actor_id, cw_action_offers *out_offers) {
  if (!world || !out_offers) return CW_ERR_INVALID;
  memset(out_offers, 0, sizeof(*out_offers));
  const cw_actor *actor = find_actor_const(world, actor_id);
  if (!actor) return CW_ERR_NOT_FOUND;
  if (!actor_is_active(actor)) return CW_OK;

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
      out_offers->option_flags |= CW_OFFER_PICK_UP;
    }
    if (!item->holder_actor_id && item->location_id == 0 && item->charges > 0) {
      hidden_search_item_available = 1;
    }
    if (item->holder_actor_id == actor->id && item->kind == CW_ITEM_POTION && item->charges > 0) {
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
    default: return "unknown";
  }
}
