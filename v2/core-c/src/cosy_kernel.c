#include "cosy_kernel.h"

#include <string.h>

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

static cw_exit *find_exit(cw_world *world, cw_id from_location_id, cw_id to_location_id) {
  for (size_t i = 0; i < world->exit_count; ++i) {
    cw_exit *exit = &world->exits[i];
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

static void remove_item(cw_world *world, cw_id item_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].id != item_id) continue;
    if (i + 1 < world->item_count) {
      memmove(
          &world->items[i],
          &world->items[i + 1],
          (world->item_count - i - 1) * sizeof(world->items[0]));
    }
    world->item_count--;
    memset(&world->items[world->item_count], 0, sizeof(world->items[0]));
    return;
  }
}

static const cw_item *find_item_const(const cw_world *world, cw_id item_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].id == item_id) return &world->items[i];
  }
  return 0;
}

static cw_gate *find_gate(cw_world *world, cw_id gate_id) {
  for (size_t i = 0; i < world->gate_count; ++i) {
    if (world->gates[i].id == gate_id) return &world->gates[i];
  }
  return 0;
}

static const cw_gate *find_gate_const(const cw_world *world, cw_id gate_id) {
  for (size_t i = 0; i < world->gate_count; ++i) {
    if (world->gates[i].id == gate_id) return &world->gates[i];
  }
  return 0;
}

static const cw_gate *find_exit_gate_const(
    const cw_world *world,
    cw_id from_location_id,
    cw_id to_location_id) {
  for (size_t i = 0; i < world->gate_count; ++i) {
    const cw_gate *gate = &world->gates[i];
    if (gate->target_kind == CW_GATE_TARGET_EXIT
        && gate->from_location_id == from_location_id
        && gate->to_location_id == to_location_id) {
      return gate;
    }
  }
  return 0;
}

static cw_gate_actor_state *find_gate_actor_state(
    cw_world *world,
    cw_id gate_id,
    cw_id actor_id) {
  for (size_t i = 0; i < world->gate_actor_state_count; ++i) {
    cw_gate_actor_state *state = &world->gate_actor_states[i];
    if (state->gate_id == gate_id && state->actor_id == actor_id) return state;
  }
  return 0;
}

static const cw_gate_actor_state *find_gate_actor_state_const(
    const cw_world *world,
    cw_id gate_id,
    cw_id actor_id) {
  for (size_t i = 0; i < world->gate_actor_state_count; ++i) {
    const cw_gate_actor_state *state = &world->gate_actor_states[i];
    if (state->gate_id == gate_id && state->actor_id == actor_id) return state;
  }
  return 0;
}

static const cw_gate_claim *find_gate_claim_const(const cw_world *world, cw_id claim_id) {
  for (size_t i = 0; i < world->gate_claim_count; ++i) {
    if (world->gate_claims[i].id == claim_id) return &world->gate_claims[i];
  }
  return 0;
}

static uint64_t gate_digest_mix(uint64_t digest, uint64_t value) {
  digest ^= value;
  digest *= 1099511628211ull;
  return digest;
}

static const cw_gate_fact *find_gate_fact(
    const cw_gate_fact *facts,
    size_t fact_count,
    cw_id subject_id,
    cw_id fact_id) {
  for (size_t i = 0; i < fact_count; ++i) {
    if (facts[i].subject_id == subject_id && facts[i].fact_id == fact_id) return &facts[i];
  }
  return 0;
}

static uint8_t effective_gate_state(
    const cw_world *world,
    const cw_gate *gate,
    cw_id actor_id) {
  if (gate->scope == CW_GATE_SCOPE_ACTOR || gate->scope == CW_GATE_SCOPE_HOLDER) {
    const cw_gate_actor_state *state =
        find_gate_actor_state_const(world, gate->id, actor_id);
    if (state) return state->state;
  }
  return gate->state;
}

static int gate_predicate_holds(
    const cw_world *world,
    const cw_gate_predicate *predicate,
    cw_id actor_id,
    const cw_gate_fact *facts,
    size_t fact_count,
    uint64_t *digest) {
  int holds = 0;
  uint64_t observed = 0;
  const cw_item *item = 0;
  const cw_gate_fact *fact = 0;
  switch (predicate->kind) {
    case CW_GATE_PREDICATE_HELD_ITEM:
      item = find_item_const(world, predicate->subject_id);
      holds = item && item->holder_actor_id == actor_id
          && !(item->reserved & CW_ITEM_FLAG_INERT);
      observed = item ? item->holder_actor_id : 0;
      break;
    case CW_GATE_PREDICATE_HELD_ITEM_CAPABILITY:
      for (size_t i = 0; i < world->item_count; ++i) {
        const cw_item *candidate = &world->items[i];
        if (candidate->holder_actor_id != actor_id
            || (candidate->reserved & CW_ITEM_FLAG_INERT)) continue;
        fact = find_gate_fact(
            facts,
            fact_count,
            candidate->id,
            predicate->fact_id);
        if (fact && fact->value == predicate->expected_value) {
          holds = 1;
          observed = gate_digest_mix(candidate->id, fact->source_version);
          break;
        }
      }
      break;
    case CW_GATE_PREDICATE_INSTALLED_ITEM:
      item = find_item_const(world, predicate->subject_id);
      holds = item && item->holder_actor_id == 0
          && item->zone == CW_CARD_ZONE_INSTALLED
          && item->location_id == predicate->target_id
          && !(item->reserved & CW_ITEM_FLAG_INERT);
      observed = item
          ? gate_digest_mix(item->location_id, gate_digest_mix(item->zone, item->reserved))
          : 0;
      break;
    case CW_GATE_PREDICATE_MINIMUM_CHARGES:
      item = find_item_const(world, predicate->subject_id);
      holds = item && item->charges >= predicate->amount
          && !(item->reserved & CW_ITEM_FLAG_INERT);
      observed = item ? item->charges : 0;
      break;
    case CW_GATE_PREDICATE_ACTOR_FACT:
      fact = find_gate_fact(facts, fact_count, actor_id, predicate->fact_id);
      holds = fact && fact->value == predicate->expected_value;
      observed = fact
          ? gate_digest_mix(fact->value, fact->source_version)
          : 0;
      break;
    case CW_GATE_PREDICATE_WORLD_FACT:
      fact = find_gate_fact(facts, fact_count, predicate->subject_id, predicate->fact_id);
      holds = fact && fact->value == predicate->expected_value;
      observed = fact
          ? gate_digest_mix(fact->value, fact->source_version)
          : 0;
      break;
    default:
      holds = 0;
      observed = UINT64_MAX;
      break;
  }
  *digest = gate_digest_mix(*digest, predicate->kind);
  *digest = gate_digest_mix(*digest, predicate->subject_id);
  *digest = gate_digest_mix(*digest, predicate->target_id);
  *digest = gate_digest_mix(*digest, predicate->fact_id);
  *digest = gate_digest_mix(*digest, predicate->expected_value);
  *digest = gate_digest_mix(*digest, observed);
  *digest = gate_digest_mix(*digest, (uint64_t)holds);
  return holds;
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

static void decorate_gate_event(
    cw_event *event,
    const cw_gate_decision *decision,
    const cw_threshold_input *input) {
  if (!event || !decision) return;
  event->gate_id = decision->gate_id;
  event->gate_method_id = decision->method_id;
  event->gate_version = decision->gate_version;
  event->access_revision = decision->access_revision;
  event->gate_evidence_digest = decision->evidence_digest;
  event->gate_evidence_mask = decision->evidence_mask;
  if (input) {
    event->gate_claim_id = input->claim_id;
    event->gate_transition = input->transition;
  }
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
      event->gate_id = action->threshold.gate_id;
      event->gate_method_id = action->threshold.method_id;
      event->gate_claim_id = action->threshold.claim_id;
      event->gate_version = action->threshold.expected_gate_version;
      event->access_revision = action->threshold.expected_access_revision;
      event->gate_evidence_digest = action->threshold.expected_evidence_digest;
      event->gate_transition = action->threshold.transition;
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

static int valid_item_placement(
    uint8_t zone,
    cw_id holder_actor_id,
    cw_id location_id,
    cw_id container_item_id) {
  switch (zone) {
    case CW_CARD_ZONE_HIDDEN:
      return !holder_actor_id && !location_id && !container_item_id;
    case CW_CARD_ZONE_WORLD:
    case CW_CARD_ZONE_INSTALLED:
      return !holder_actor_id && location_id && !container_item_id;
    case CW_CARD_ZONE_CARRIED:
    case CW_CARD_ZONE_EQUIPPED:
    case CW_CARD_ZONE_SPELL_DECK:
    case CW_CARD_ZONE_ESCROW:
      return holder_actor_id && !location_id && !container_item_id;
    case CW_CARD_ZONE_CONTAINED:
      return holder_actor_id && !location_id && container_item_id;
    case CW_CARD_ZONE_EXHAUSTED:
      return (!!holder_actor_id != !!location_id) && !container_item_id;
    default:
      return 0;
  }
}

/* Placement is one transition so callers cannot leave holder, room, zone, and
 * container references out of sync between assignments. */
static cw_status place_item(
    cw_item *item,
    uint8_t zone,
    cw_id holder_actor_id,
    cw_id location_id,
    cw_id container_item_id,
    uint64_t held_since_tick) {
  if (!item || !valid_item_placement(
      zone, holder_actor_id, location_id, container_item_id)) return CW_ERR_RULE;
  item->zone = zone;
  item->holder_actor_id = holder_actor_id;
  item->location_id = location_id;
  item->container_item_id = container_item_id;
  item->held_since_tick = held_since_tick;
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
  item->max_charges = charges;
  item->weight_tenths = CW_ITEM_DEFAULT_WEIGHT_TENTHS;
  item->size_class = CW_ITEM_SIZE_SMALL;
  item->role = kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC;
  item->policy_flags = CW_ITEM_POLICY_CONFIGURED | CW_ITEM_POLICY_TRANSFERABLE;
  return place_item(
      item,
      location_id ? CW_CARD_ZONE_WORLD : CW_CARD_ZONE_HIDDEN,
      0,
      location_id,
      0,
      0);
}

static cw_status create_item(cw_world *world, cw_id item_id, uint8_t kind, uint8_t charges, uint8_t target_kind, cw_id target_id) {
  if (!item_id || !kind || !charges || !target_id || find_item(world, item_id)) return CW_ERR_INVALID;
  if (world->item_count >= CW_MAX_ITEMS) return CW_ERR_FULL;
  cw_item *item = &world->items[world->item_count++];
  memset(item, 0, sizeof(*item));
  item->id = item_id;
  item->kind = kind;
  item->charges = charges;
  item->max_charges = charges;
  item->weight_tenths = CW_ITEM_DEFAULT_WEIGHT_TENTHS;
  item->size_class = CW_ITEM_SIZE_SMALL;
  item->role = kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC;
  item->policy_flags = CW_ITEM_POLICY_CONFIGURED | CW_ITEM_POLICY_TRANSFERABLE;
  switch (target_kind) {
    case CW_PLACEMENT_ACTOR_HAND:
      (void)place_item(item, CW_CARD_ZONE_CARRIED, target_id, 0, 0, world->tick);
      break;
    case CW_PLACEMENT_LOCATION_FLOOR:
      (void)place_item(item, CW_CARD_ZONE_WORLD, 0, target_id, 0, 0);
      break;
    case CW_PLACEMENT_LOCATION_FIXTURE:
      (void)place_item(item, CW_CARD_ZONE_INSTALLED, 0, target_id, 0, 0);
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

static int item_policy_is_configured(const cw_item *item) {
  return item && (item->policy_flags & CW_ITEM_POLICY_CONFIGURED);
}

static int item_is_transferable(const cw_item *item) {
  return item && (!item_policy_is_configured(item)
      || (item->policy_flags & CW_ITEM_POLICY_TRANSFERABLE));
}

static int item_is_directly_held(const cw_item *item) {
  return item && item->holder_actor_id && !item->location_id
      && !item->container_item_id && item->zone != CW_CARD_ZONE_CONTAINED
      && item->zone != CW_CARD_ZONE_ESCROW && item->zone != CW_CARD_ZONE_INSTALLED;
}

static int item_is_theft_eligible(const cw_item *item) {
  if (!item || !item_is_directly_held(item)
      || (item->zone != CW_CARD_ZONE_CARRIED
          && item->zone != CW_CARD_ZONE_EQUIPPED
          && item->zone != CW_CARD_ZONE_WORLD
          && item->zone != CW_CARD_ZONE_HIDDEN)) return 0;
  return !item_policy_is_configured(item)
      || (item->policy_flags & CW_ITEM_POLICY_THEFT_WHEN_CARRIED);
}

static uint32_t item_weight_tenths(const cw_item *item) {
  return item && item->weight_tenths ? item->weight_tenths : CW_ITEM_DEFAULT_WEIGHT_TENTHS;
}

static int item_has_contents(const cw_world *world, cw_id item_id) {
  if (!world || !item_id) return 0;
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].container_item_id == item_id) return 1;
  }
  return 0;
}

static uint32_t container_contents_weight_tenths(
    const cw_world *world,
    cw_id container_item_id,
    cw_id excluded_item_id) {
  uint32_t weight = 0;
  if (!world || !container_item_id) return 0;
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *item = &world->items[i];
    if (item->id != excluded_item_id
        && item->container_item_id == container_item_id) {
      weight += item_weight_tenths(item);
    }
  }
  return weight;
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
  world->access_revision = 1;
}

void cw_world_access_changed(cw_world *world) {
  if (!world) return;
  world->access_revision = world->access_revision == UINT64_MAX
      ? UINT64_MAX
      : world->access_revision + 1;
}

cw_status cw_world_set_gate(
    cw_world *world,
    const cw_gate *gate,
    const cw_gate_method_definition *methods,
    size_t method_count) {
  if (!world || !gate || !gate->id || !gate->descriptor_version
      || gate->version == 0
      || gate->target_kind < CW_GATE_TARGET_EXIT
      || gate->target_kind > CW_GATE_TARGET_CONTAINER
      || gate->scope < CW_GATE_SCOPE_WORLD
      || gate->scope > CW_GATE_SCOPE_HOLDER
      || gate->state < CW_GATE_STATE_CLOSED
      || gate->state > CW_GATE_STATE_INERT
      || gate->compatibility > CW_GATE_COMPAT_RECORDED_LOCK
      || !methods || method_count == 0
      || method_count > CW_MAX_GATE_METHODS) {
    return CW_ERR_INVALID;
  }
  if (gate->target_kind == CW_GATE_TARGET_EXIT) {
    const cw_exit *exit =
        find_exit_const(world, gate->from_location_id, gate->to_location_id);
    if (!exit || gate->target_item_id) return CW_ERR_NOT_FOUND;
    if (gate->compatibility == CW_GATE_COMPAT_RECORDED_LOCK
        && !(exit->flags & CW_EXIT_LOCKED)) {
      return CW_ERR_RULE;
    }
  } else {
    if (!gate->target_item_id || !find_item_const(world, gate->target_item_id)
        || gate->from_location_id || gate->to_location_id
        || gate->compatibility != CW_GATE_COMPAT_NONE) {
      return CW_ERR_NOT_FOUND;
    }
  }
  size_t predicate_count = 0;
  for (size_t method_index = 0; method_index < method_count; ++method_index) {
    const cw_gate_method_definition *method = &methods[method_index];
    if (!method->id || method->predicate_count > CW_MAX_GATE_PREDICATES) {
      return CW_ERR_INVALID;
    }
    predicate_count += method->predicate_count;
    for (size_t predicate_index = 0;
         predicate_index < method->predicate_count;
         ++predicate_index) {
      const cw_gate_predicate *predicate = &method->predicates[predicate_index];
      if (predicate->kind < CW_GATE_PREDICATE_HELD_ITEM
          || predicate->kind > CW_GATE_PREDICATE_WORLD_FACT
          || ((predicate->kind == CW_GATE_PREDICATE_HELD_ITEM
                  || predicate->kind == CW_GATE_PREDICATE_INSTALLED_ITEM
                  || predicate->kind == CW_GATE_PREDICATE_MINIMUM_CHARGES)
              && !predicate->subject_id)
          || (predicate->kind == CW_GATE_PREDICATE_MINIMUM_CHARGES
              && !predicate->amount)
          || ((predicate->kind == CW_GATE_PREDICATE_HELD_ITEM_CAPABILITY
                  || predicate->kind == CW_GATE_PREDICATE_ACTOR_FACT
                  || predicate->kind == CW_GATE_PREDICATE_WORLD_FACT)
              && !predicate->fact_id)) {
        return CW_ERR_INVALID;
      }
    }
  }
  if (world->gate_method_count + method_count > CW_MAX_GATE_METHOD_RECORDS
      || world->gate_predicate_count + predicate_count > CW_MAX_GATE_PREDICATE_RECORDS) {
    return CW_ERR_FULL;
  }
  cw_gate *target = find_gate(world, gate->id);
  if (!target) {
    if (world->gate_count >= CW_MAX_GATES) return CW_ERR_FULL;
    target = &world->gates[world->gate_count++];
  } else if (target->version > gate->version) {
    return CW_ERR_RULE;
  }
  *target = *gate;
  target->method_start = world->gate_method_count;
  target->method_count = method_count;
  for (size_t method_index = 0; method_index < method_count; ++method_index) {
    const cw_gate_method_definition *definition = &methods[method_index];
    cw_gate_method *method = &world->gate_methods[world->gate_method_count++];
    memset(method, 0, sizeof(*method));
    method->id = definition->id;
    method->predicate_start = world->gate_predicate_count;
    method->predicate_count = definition->predicate_count;
    for (size_t predicate_index = 0;
         predicate_index < definition->predicate_count;
         ++predicate_index) {
      world->gate_predicates[world->gate_predicate_count++] =
          definition->predicates[predicate_index];
    }
  }
  world->access_revision = world->access_revision == UINT64_MAX
      ? UINT64_MAX
      : world->access_revision + 1;
  return CW_OK;
}

cw_status cw_gate_evaluate(
    const cw_world *world,
    cw_id gate_id,
    cw_id actor_id,
    const cw_gate_fact *facts,
    size_t fact_count,
    cw_id method_id,
    cw_gate_decision *out_decision) {
  if (!world || !gate_id || !actor_id || !out_decision
      || fact_count > CW_MAX_GATE_FACTS || (fact_count && !facts)) {
    return CW_ERR_INVALID;
  }
  memset(out_decision, 0, sizeof(*out_decision));
  const cw_gate *gate = find_gate_const(world, gate_id);
  if (!gate) return CW_ERR_NOT_FOUND;
  if (gate->method_start > world->gate_method_count
      || gate->method_count > world->gate_method_count - gate->method_start) {
    return CW_ERR_INVALID;
  }
  const cw_actor *actor = find_actor_const(world, actor_id);
  if (!actor) return CW_ERR_NOT_FOUND;

  uint8_t state = effective_gate_state(world, gate, actor_id);
  uint64_t digest = 1469598103934665603ull;
  digest = gate_digest_mix(digest, gate->id);
  digest = gate_digest_mix(digest, gate->version);
  digest = gate_digest_mix(digest, gate->descriptor_version);
  digest = gate_digest_mix(digest, world->access_revision);
  digest = gate_digest_mix(digest, actor_id);
  digest = gate_digest_mix(digest, actor->location_id);
  digest = gate_digest_mix(digest, state);

  out_decision->gate_id = gate->id;
  out_decision->gate_version = gate->version;
  out_decision->access_revision = world->access_revision;
  out_decision->state = state;
  if (state == CW_GATE_STATE_OPEN || state == CW_GATE_STATE_BROKEN) {
    out_decision->allowed = 1;
    out_decision->evidence_digest = gate_digest_mix(digest, 1);
    return CW_OK;
  }
  if (state == CW_GATE_STATE_INERT || !actor_is_active(actor)) {
    out_decision->reason = CW_REASON_GATE_CLOSED;
    out_decision->evidence_digest = gate_digest_mix(digest, 0);
    return CW_OK;
  }

  for (size_t method_index = 0; method_index < gate->method_count; ++method_index) {
    const cw_gate_method *method =
        &world->gate_methods[gate->method_start + method_index];
    if (method->predicate_start > world->gate_predicate_count
        || method->predicate_count
            > world->gate_predicate_count - method->predicate_start) {
      return CW_ERR_INVALID;
    }
    if (method_id && method->id != method_id) continue;
    uint64_t method_digest = gate_digest_mix(digest, method->id);
    uint32_t evidence_mask = 0;
    int allowed = 1;
    for (size_t predicate_index = 0;
         predicate_index < method->predicate_count;
         ++predicate_index) {
      int holds = gate_predicate_holds(
          world,
          &world->gate_predicates[method->predicate_start + predicate_index],
          actor_id,
          facts,
          fact_count,
          &method_digest);
      if (holds) evidence_mask |= (uint32_t)1u << predicate_index;
      else allowed = 0;
    }
    if (allowed) {
      out_decision->method_id = method->id;
      out_decision->evidence_mask = evidence_mask;
      out_decision->allowed = 1;
      out_decision->evidence_digest = gate_digest_mix(method_digest, 1);
      return CW_OK;
    }
    if (method_id) {
      out_decision->method_id = method->id;
      out_decision->evidence_mask = evidence_mask;
      out_decision->evidence_digest = gate_digest_mix(method_digest, 0);
      out_decision->reason = CW_REASON_GATE_CLOSED;
      return CW_OK;
    }
    digest = gate_digest_mix(digest, method_digest);
  }
  out_decision->reason = CW_REASON_GATE_CLOSED;
  out_decision->evidence_digest = gate_digest_mix(digest, 0);
  return CW_OK;
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

cw_status cw_world_set_item_recovery_profile(
    cw_world *world,
    cw_id item_id,
    uint8_t max_charges,
    uint8_t recovery,
    uint8_t ready_zone) {
  if (!world || !item_id || !max_charges
      || recovery > CW_ITEM_RECOVERY_REST
      || ready_zone < CW_CARD_ZONE_WORLD || ready_zone > CW_CARD_ZONE_INSTALLED
      || ready_zone == CW_CARD_ZONE_EXHAUSTED) {
    return CW_ERR_INVALID;
  }
  cw_item *item = find_item(world, item_id);
  if (!item) return CW_ERR_NOT_FOUND;
  if (item->charges > max_charges) return CW_ERR_INVALID;
  item->max_charges = max_charges;
  item->recovery = recovery;
  if (item->zone != CW_CARD_ZONE_EXHAUSTED || item->recovery_zone == CW_CARD_ZONE_NONE) {
    item->recovery_zone = ready_zone;
  }
  return CW_OK;
}

cw_status cw_world_set_item_policy(
    cw_world *world,
    cw_id item_id,
    uint8_t policy_flags) {
  const uint8_t allowed = CW_ITEM_POLICY_TRANSFERABLE
      | CW_ITEM_POLICY_THEFT_WHEN_CARRIED;
  if (!world || !item_id || (policy_flags & ~allowed)) return CW_ERR_INVALID;
  cw_item *item = find_item(world, item_id);
  if (!item) return CW_ERR_NOT_FOUND;
  item->policy_flags = CW_ITEM_POLICY_CONFIGURED | policy_flags;
  return CW_OK;
}

cw_status cw_world_set_item_zone(
    cw_world *world,
    cw_id item_id,
    uint8_t zone,
    cw_id container_item_id) {
  if (!world || !item_id || zone < CW_CARD_ZONE_WORLD || zone > CW_CARD_ZONE_HIDDEN) {
    return CW_ERR_INVALID;
  }
  cw_item *item = find_item(world, item_id);
  if (!item) return CW_ERR_NOT_FOUND;
  if (!valid_item_placement(
      zone, item->holder_actor_id, item->location_id, container_item_id)) return CW_ERR_RULE;
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
        || item->size_class > container->size_class
        || container_contents_weight_tenths(world, container->id, item->id)
            + item_weight_tenths(item) > container->container_capacity_tenths) {
      return CW_ERR_RULE;
    }
  } else if (container_item_id) {
    return CW_ERR_INVALID;
  }
  if (zone == CW_CARD_ZONE_EQUIPPED
      && item->role != CW_ITEM_ROLE_WEAPON
      && item->role != CW_ITEM_ROLE_SKILL_CHARM
      && item->role != CW_ITEM_ROLE_CONTAINER
      && item->role != CW_ITEM_ROLE_TOOL
      && item->role != CW_ITEM_ROLE_CONSUMABLE) {
    return CW_ERR_RULE;
  }
  if (zone == CW_CARD_ZONE_SPELL_DECK && item->role != CW_ITEM_ROLE_SPELL) {
    return CW_ERR_RULE;
  }
  return place_item(
      item,
      zone,
      item->holder_actor_id,
      item->location_id,
      container_item_id,
      item->held_since_tick);
}

static void exhaust_item(cw_item *item) {
  if (!item) return;
  if (item->zone != CW_CARD_ZONE_NONE
      && item->zone != CW_CARD_ZONE_EXHAUSTED
      && item->zone != CW_CARD_ZONE_HIDDEN) {
    item->recovery_zone = item->zone;
  }
  item->zone = CW_CARD_ZONE_EXHAUSTED;
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
  /* Character-creation schema v2 deliberately begins before a class is
     chosen. The orchestrator marks that path with modifier -1; legacy create
     records retain their level-one semantics. */
  if (action->modifier == -1) stats.level = 0;
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

static cw_status apply_complete_avatar_rescue(
    cw_world *world,
    const cw_action *action,
    cw_event_buffer *out_events) {
  cw_actor *rescuer = find_actor(world, action->actor_id);
  cw_actor *downed = find_actor(world, action->target_actor_id);
  cw_item *draught = find_item(world, action->item_id);
  if (!rescuer) return reject(world, out_events, action, CW_REASON_ACTOR_NOT_FOUND);
  if (!actor_is_active(rescuer)) {
    return reject(world, out_events, action, CW_REASON_ACTOR_INACTIVE);
  }
  if (!downed) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (downed->status != CW_ACTOR_KNOCKED_OUT) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }
  if (downed->location_id != rescuer->location_id) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  if (!draught) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (draught->role != CW_ITEM_ROLE_CONSUMABLE
      || draught->holder_actor_id != rescuer->id
      || draught->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (action->content_id != rescuer->id && action->content_id != downed->id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  cw_actor *inhabited = action->content_id == rescuer->id ? rescuer : downed;
  cw_actor *released = action->content_id == rescuer->id ? downed : rescuer;
  downed->damage = 0;
  downed->status = CW_ACTOR_ACTIVE;
  downed->conditions &= ~CW_CONDITION_UNCONSCIOUS;
  inhabited->kind = CW_ACTOR_HUMAN;
  released->kind = CW_ACTOR_NPC;
  draught->charges--;
  if (draught->charges == 0) exhaust_item(draught);

  append_event(world, out_events, CW_EVENT_ITEM_USED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = rescuer->id;
    event->target_actor_id = downed->id;
    event->location_id = rescuer->location_id;
    event->item_id = draught->id;
    event->current_hp = cw_actor_current_hp(downed);
  }
  append_event(world, out_events, CW_EVENT_AVATAR_RESCUE_COMPLETED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = rescuer->id;
    event->target_actor_id = downed->id;
    event->location_id = rescuer->location_id;
    event->content_id = inhabited->id;
    event->item_id = draught->id;
    event->current_hp = cw_actor_current_hp(downed);
  }
  append_event(world, out_events, CW_EVENT_AVATAR_RELEASED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = released->id;
    event->target_actor_id = inhabited->id;
    event->location_id = released->location_id;
  }
  return CW_OK;
}

static cw_status apply_replace_avatar_rescuer(
    cw_world *world,
    const cw_action *action,
    uint64_t seed,
    cw_event_buffer *out_events) {
  cw_id location_id = action->location_id ? action->location_id : 1;
  cw_actor *oldest = find_actor(world, action->target_actor_id);
  cw_actor *fallen_rescuer = find_actor(world, action->content_id);
  cw_item *retired_draught = find_item(world, action->item_id);
  if (!find_location(world, location_id)) {
    return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
  }
  if (find_actor(world, action->actor_id)) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  if (!oldest || !fallen_rescuer) {
    return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  }
  if (!retired_draught) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  }
  if (retired_draught->role != CW_ITEM_ROLE_CONSUMABLE) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (oldest->status != CW_ACTOR_KNOCKED_OUT
      || fallen_rescuer->status != CW_ACTOR_KNOCKED_OUT
      || oldest->id == fallen_rescuer->id) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }

  cw_stat_block stats = generated_stats(seed ^ action->actor_id);
  if (action->modifier == -1) stats.level = 0;
  cw_status status = add_actor(world, action->actor_id, CW_ACTOR_HUMAN, location_id, stats);
  if (status == CW_ERR_RULE) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  if (status != CW_OK) return status;
  oldest->status = CW_ACTOR_DEAD;
  oldest->kind = CW_ACTOR_NPC;
  if (retired_draught) {
    retired_draught->charges = 0;
    exhaust_item(retired_draught);
  }

  append_event(world, out_events, CW_EVENT_COMBAT_DEATH);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = fallen_rescuer->id;
    event->target_actor_id = oldest->id;
    event->location_id = oldest->location_id;
  }
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

cw_status cw_resolve_project_push(const cw_project_push_input *input, uint8_t *out_progress) {
  if (!input || !out_progress) return CW_ERR_INVALID;
  if (!input->base_progress
      || !input->location_count
      || !input->remaining_progress
      || input->prepared > 1
      || input->evidence_count > input->location_count) {
    return CW_ERR_RULE;
  }

  uint16_t progress = input->base_progress;
  if (input->prepared) {
    progress += input->prepared_bonus_progress
      ? input->prepared_bonus_progress
      : 1u;
    if (input->evidence_count) {
      progress += input->location_count > 1
          && input->evidence_count == input->location_count
        ? 2u
        : 1u;
    }
  }
  if (progress > input->remaining_progress) progress = input->remaining_progress;
  *out_progress = (uint8_t)progress;
  return CW_OK;
}

static cw_status apply_project_push(
    cw_world *world,
    const cw_action *action,
    cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  uint8_t progress = 0;
  status = cw_resolve_project_push(&action->project_push, &progress);
  if (status != CW_OK) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  append_event(world, out_events, CW_EVENT_PROJECT_PUSH_RESOLVED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->content_id = action->content_id;
    event->raw_roll = action->project_push.evidence_count;
    event->modifier = action->project_push.prepared_bonus_progress;
    event->total = progress;
    event->dc = action->project_push.location_count;
    event->damage = action->project_push.base_progress;
  }
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

  cw_gate_decision gate_decision = {0};
  const cw_gate *gate =
      find_exit_gate_const(world, actor->location_id, destination_id);
  if (gate) {
    if (action->threshold.gate_id != gate->id
        || cw_gate_evaluate(
               world,
               gate->id,
               actor->id,
               action->threshold.facts,
               action->threshold.fact_count,
               action->threshold.method_id,
               &gate_decision) != CW_OK
        || action->threshold.expected_gate_version != gate_decision.gate_version
        || action->threshold.expected_access_revision != gate_decision.access_revision
        || action->threshold.expected_evidence_digest != gate_decision.evidence_digest) {
      append_event(world, out_events, CW_EVENT_MOVE_BLOCKED);
      if (out_events && out_events->count > 0) {
        cw_event *event = &out_events->events[out_events->count - 1];
        event->success = 0;
        event->reason = CW_REASON_STALE_GATE_OFFER;
        event->actor_id = actor->id;
        event->location_id = actor->location_id;
        event->destination_location_id = destination_id;
        decorate_gate_event(event, &gate_decision, &action->threshold);
      }
      return CW_ERR_RULE;
    }
    if (!gate_decision.allowed
        || ((exit->flags & CW_EXIT_LOCKED)
            && gate->compatibility != CW_GATE_COMPAT_RECORDED_LOCK)) {
      append_event(world, out_events, CW_EVENT_MOVE_BLOCKED);
      if (out_events && out_events->count > 0) {
        cw_event *event = &out_events->events[out_events->count - 1];
        event->success = 0;
        event->reason = gate_decision.allowed
            ? CW_REASON_EXIT_LOCKED
            : CW_REASON_GATE_CLOSED;
        event->actor_id = actor->id;
        event->location_id = actor->location_id;
        event->destination_location_id = destination_id;
        decorate_gate_event(event, &gate_decision, &action->threshold);
      }
      return CW_ERR_RULE;
    }
  } else if (exit->flags & CW_EXIT_LOCKED) {
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
    decorate_gate_event(event, gate ? &gate_decision : 0, &action->threshold);
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
    /* Record which ability the check resolved against. The field already
       existed but was left at zero, so every projected check looked like a
       Strength check. Reporting it is what lets a client name the attribute
       without guessing. See issue #464. */
    event->ability = action->ability;
  }
  return CW_OK;
}

static cw_status apply_discovery_procedure(
    cw_world *world,
    const cw_action *action,
    uint64_t seed,
    uint8_t event_type,
    cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  if (!action->location_id
      || action->location_id != actor->location_id
      || !find_location_const(world, action->location_id)) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  /* Under pressure, the check only decides whether the separately frozen
     event consequence fires. It never decides whether authored truth exists
     or whether the procedure reveals it. */
  if (action->dc) {
    status = apply_ability_check(world, action, seed, out_events);
    if (status != CW_OK) return status;
  }
  append_event(world, out_events, event_type);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
  }
  return CW_OK;
}

static cw_status apply_pick_up_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id
      || item->location_id != actor->location_id
      || item->zone != CW_CARD_ZONE_WORLD
      || !item_is_transferable(item)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  cw_item *exchanged = 0;
  if (!actor_can_exchange(world, actor, 0, item)) {
    if (action->target_item_id) {
      exchanged = find_item(world, action->target_item_id);
    }
    if (!exchanged || exchanged->holder_actor_id != actor->id
        || !item_is_directly_held(exchanged)
        || !item_is_transferable(exchanged)
        || item_has_contents(world, exchanged->id)
        || !actor_can_exchange(world, actor, exchanged, item)) {
      return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
    }
  }

  if (exchanged) {
    (void)place_item(exchanged, CW_CARD_ZONE_WORLD, 0, actor->location_id, 0, 0);
    append_event(world, out_events, CW_EVENT_ITEM_DROPPED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->item_id = exchanged->id;
    }
  }

  (void)place_item(item, CW_CARD_ZONE_CARRIED, actor->id, 0, 0, world->tick);

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
  if (item->holder_actor_id != actor->id
      || !item_is_directly_held(item)
      || !item_is_transferable(item)
      || item_has_contents(world, item->id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (!actor_can_exchange(world, actor, item, 0)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }
  (void)place_item(item, CW_CARD_ZONE_WORLD, 0, actor->location_id, 0, 0);

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
  if (item->holder_actor_id != actor->id
      || !item_is_directly_held(item)
      || item->zone == CW_CARD_ZONE_EXHAUSTED
      || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  cw_actor *target = find_actor(world, action->target_actor_id ? action->target_actor_id : actor->id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  int16_t healed = 0;
  if (item->role == CW_ITEM_ROLE_CONSUMABLE) {
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
    if (item->charges == 0) exhaust_item(item);
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

static cw_status apply_rules_utilize_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != actor->id || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  append_event(world, out_events, CW_EVENT_ITEM_USED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
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
  if (spell->charges == 0) exhaust_item(spell);
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

static int item_is_rest_refreshable(
    const cw_item *item,
    cw_id actor_id,
    uint8_t requested_grade) {
  if (!item || item->holder_actor_id != actor_id
      || item->zone != CW_CARD_ZONE_EXHAUSTED || item->charges != 0
      || item->max_charges == 0 || item->recovery != CW_ITEM_RECOVERY_REST) {
    return 0;
  }
  if (requested_grade == CW_REST_GRADE_CAMP
      || requested_grade == CW_REST_GRADE_LODGED) {
    return item->role == CW_ITEM_ROLE_SPELL;
  }
  return requested_grade == CW_REST_GRADE_HEARTH
      && (item->role == CW_ITEM_ROLE_SPELL
          || item->role == CW_ITEM_ROLE_SKILL_CHARM
          || item->role == CW_ITEM_ROLE_RELIC);
}

static uint8_t item_rest_restore_zone(const cw_item *item) {
  if (item->recovery_zone >= CW_CARD_ZONE_WORLD
      && item->recovery_zone <= CW_CARD_ZONE_INSTALLED
      && item->recovery_zone != CW_CARD_ZONE_EXHAUSTED) {
    return item->recovery_zone;
  }
  /* Legacy snapshots predate captured recovery zones. The role fallback is
     deterministic and applies only when that historical field is absent. */
  if (item->role == CW_ITEM_ROLE_SPELL) return CW_CARD_ZONE_SPELL_DECK;
  if (item->role == CW_ITEM_ROLE_SKILL_CHARM) return CW_CARD_ZONE_EQUIPPED;
  return CW_CARD_ZONE_CARRIED;
}

static cw_item *next_rest_refreshable_item(
    cw_world *world,
    cw_id actor_id,
    uint8_t requested_grade,
    cw_id after_item_id) {
  cw_item *selected = 0;
  for (size_t i = 0; i < world->item_count; ++i) {
    cw_item *item = &world->items[i];
    if (!item_is_rest_refreshable(item, actor_id, requested_grade)
        || item->id <= after_item_id
        || (selected && selected->id < item->id)) {
      continue;
    }
    selected = item;
  }
  return selected;
}

static cw_status apply_rest(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;

  const uint8_t requested_grade = action->rest.requested_grade;
  const uint8_t entitled_grade = action->rest.entitled_grade;
  if (requested_grade < CW_REST_GRADE_CAMP || requested_grade > CW_REST_GRADE_HEARTH
      || entitled_grade < CW_REST_GRADE_CAMP || entitled_grade > CW_REST_GRADE_HEARTH
      || requested_grade > entitled_grade) {
    return reject(world, out_events, action, CW_REASON_REST_GRADE_OVERCLAIMED);
  }

  size_t refresh_count = 0;
  for (size_t i = 0; i < world->item_count; ++i) {
    if (item_is_rest_refreshable(&world->items[i], actor->id, requested_grade)) {
      refresh_count++;
    }
  }
  if (requested_grade == CW_REST_GRADE_CAMP && refresh_count > 1) {
    refresh_count = 1;
  }
  if (refresh_count > CW_MAX_EVENTS || (refresh_count > 0 && !out_events)) {
    return CW_ERR_FULL;
  }

  cw_item *refresh_items[CW_MAX_EVENTS];
  cw_id last_item_id = 0;
  for (size_t i = 0; i < refresh_count; ++i) {
    refresh_items[i] =
        next_rest_refreshable_item(world, actor->id, requested_grade, last_item_id);
    if (!refresh_items[i]) return CW_ERR_INVALID;
    last_item_id = refresh_items[i]->id;
  }
  for (size_t i = 0; i < refresh_count; ++i) {
    cw_item *item = refresh_items[i];
    const uint8_t restored_zone = item_rest_restore_zone(item);
    item->charges = item->max_charges;
    item->zone = restored_zone;
    if (item->recovery_zone == 0) item->recovery_zone = restored_zone;
    append_event(world, out_events, CW_EVENT_ITEM_REFRESHED);
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->item_id = item->id;
  }
  return CW_OK;
}

static cw_status apply_theft(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  cw_actor *target = find_actor(world, action->target_actor_id);
  cw_item *item = find_item(world, action->item_id);
  if (!target || !actor_is_active(target) || target->id == actor->id) {
    return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  }
  if (target->location_id != actor->location_id) {
    return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);
  }
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != target->id
      || !item_is_theft_eligible(item)
      || item_has_contents(world, item->id)) {
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
  (void)place_item(item, CW_CARD_ZONE_CARRIED, actor->id, 0, 0, world->tick);
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
    if (!target || !actor_is_active(target) || target->stats.level >= 2) continue;
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
  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->id == actor->id) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != actor->id
      || !item_is_directly_held(item)
      || !item_is_transferable(item)
      || item_has_contents(world, item->id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  cw_item *returned_item = 0;
  if (action->target_item_id) {
    returned_item = find_item(world, action->target_item_id);
    if (!returned_item || returned_item->holder_actor_id != target->id
        || !item_is_directly_held(returned_item)
        || !item_is_transferable(returned_item)
        || item_has_contents(world, returned_item->id)) {
      return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
    }
  }
  if (!actor_can_exchange(world, actor, item, returned_item)
      || !actor_can_exchange(world, target, returned_item, item)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }

  (void)place_item(item, CW_CARD_ZONE_CARRIED, target->id, 0, 0, world->tick);
  if (returned_item) {
    (void)place_item(
        returned_item, CW_CARD_ZONE_CARRIED, actor->id, 0, 0, world->tick);
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
  if (!action->item_id || !action->target_item_id || action->item_id == action->target_item_id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->id == actor->id) return reject(world, out_events, action, CW_REASON_TARGET_UNAVAILABLE);
  if (target->location_id != actor->location_id) return reject(world, out_events, action, CW_REASON_NOT_SAME_LOCATION);

  cw_item *offered = find_item(world, action->item_id);
  cw_item *requested = find_item(world, action->target_item_id);
  if (!offered || !requested) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (offered->holder_actor_id != actor->id
      || requested->holder_actor_id != target->id
      || !item_is_directly_held(offered)
      || !item_is_directly_held(requested)
      || !item_is_transferable(offered)
      || !item_is_transferable(requested)
      || item_has_contents(world, offered->id)
      || item_has_contents(world, requested->id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (!actor_can_exchange(world, actor, offered, requested)
      || !actor_can_exchange(world, target, requested, offered)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }

  (void)place_item(offered, CW_CARD_ZONE_CARRIED, target->id, 0, 0, world->tick);
  (void)place_item(requested, CW_CARD_ZONE_CARRIED, actor->id, 0, 0, world->tick);

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
  if (item->holder_actor_id != 0
      || item->location_id != 0
      || item->zone != CW_CARD_ZONE_HIDDEN
      || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  (void)place_item(item, CW_CARD_ZONE_WORLD, 0, location_id, 0, 0);

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

static cw_status apply_unlock_exit(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  if (!find_location(world, action->location_id)
      || !find_location(world, action->destination_location_id)) {
    return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
  }
  cw_exit *exit = find_exit(world, action->location_id, action->destination_location_id);
  if (!exit) return reject(world, out_events, action, CW_REASON_NO_EXIT);
  if (find_exit_gate_const(
          world,
          action->location_id,
          action->destination_location_id)) {
    return reject(world, out_events, action, CW_REASON_STALE_GATE_OFFER);
  }
  if (!(exit->flags & CW_EXIT_LOCKED)) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  exit->flags &= ~CW_EXIT_LOCKED;
  append_event(world, out_events, CW_EVENT_EXIT_UNLOCKED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = action->actor_id;
    event->location_id = action->location_id;
    event->destination_location_id = action->destination_location_id;
  }
  return CW_OK;
}

static int gate_transition_requires_method(uint8_t transition) {
  return transition == CW_GATE_TRANSITION_OPEN
      || transition == CW_GATE_TRANSITION_BREAK
      || transition == CW_GATE_TRANSITION_INSTALL
      || transition == CW_GATE_TRANSITION_EXHAUST
      || transition == CW_GATE_TRANSITION_RENDER_INERT;
}

static uint8_t gate_transition_state(uint8_t transition) {
  switch (transition) {
    case CW_GATE_TRANSITION_OPEN: return CW_GATE_STATE_OPEN;
    case CW_GATE_TRANSITION_CLOSE:
    case CW_GATE_TRANSITION_RELOCK: return CW_GATE_STATE_CLOSED;
    case CW_GATE_TRANSITION_BREAK: return CW_GATE_STATE_BROKEN;
    default: return CW_GATE_STATE_NONE;
  }
}

static cw_status set_effective_gate_state(
    cw_world *world,
    cw_gate *gate,
    cw_id actor_id,
    uint8_t state) {
  if (!state) return CW_OK;
  if (gate->scope == CW_GATE_SCOPE_ACTOR || gate->scope == CW_GATE_SCOPE_HOLDER) {
    cw_gate_actor_state *actor_state =
        find_gate_actor_state(world, gate->id, actor_id);
    if (!actor_state) {
      if (world->gate_actor_state_count >= CW_MAX_GATE_ACTOR_STATES) return CW_ERR_FULL;
      actor_state = &world->gate_actor_states[world->gate_actor_state_count++];
      memset(actor_state, 0, sizeof(*actor_state));
      actor_state->gate_id = gate->id;
      actor_state->actor_id = actor_id;
      actor_state->version = 1;
    } else {
      actor_state->version = actor_state->version == UINT64_MAX
          ? UINT64_MAX
          : actor_state->version + 1;
    }
    actor_state->state = state;
  } else {
    gate->state = state;
  }
  gate->version = gate->version == UINT64_MAX ? UINT64_MAX : gate->version + 1;
  return CW_OK;
}

static cw_status apply_gate_transition(
    cw_world *world,
    const cw_action *action,
    uint64_t seed,
    cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  const cw_threshold_input *input = &action->threshold;
  if (!input->gate_id || !input->claim_id
      || input->transition < CW_GATE_TRANSITION_OPEN
      || input->transition > CW_GATE_TRANSITION_RENDER_INERT
      || input->fact_count > CW_MAX_GATE_FACTS) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  cw_gate *gate = find_gate(world, input->gate_id);
  if (!gate) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);

  const cw_gate_claim *existing = find_gate_claim_const(world, input->claim_id);
  if (existing) {
    if (existing->gate_id == gate->id
        && existing->actor_id == actor->id
        && existing->item_id == action->item_id
        && existing->method_id == input->method_id
        && existing->transition == input->transition) {
      return CW_OK;
    }
    return reject(world, out_events, action, CW_REASON_GATE_CLAIM_CONFLICT);
  }

  cw_gate_decision decision = {0};
  if (cw_gate_evaluate(
          world,
          gate->id,
          actor->id,
          input->facts,
          input->fact_count,
          input->method_id,
          &decision) != CW_OK
      || input->expected_gate_version != decision.gate_version
      || input->expected_access_revision != decision.access_revision
      || input->expected_evidence_digest != decision.evidence_digest) {
    return reject(world, out_events, action, CW_REASON_STALE_GATE_OFFER);
  }
  if (gate_transition_requires_method(input->transition)
      && (!decision.allowed || !input->method_id
          || decision.method_id != input->method_id)) {
    return reject(world, out_events, action, CW_REASON_GATE_CLOSED);
  }

  uint8_t resolution = input->reserved[0];
  int checked_resolution =
      resolution == CW_GATE_METHOD_RESOLUTION_SRD_CHECK
      || resolution == CW_GATE_METHOD_RESOLUTION_CONSEQUENCE_AVOIDANCE_CHECK;
  if (resolution > CW_GATE_METHOD_RESOLUTION_CONSEQUENCE_AVOIDANCE_CHECK
      || (checked_resolution
          && (!action->dc || action->dc > INT16_MAX
              || action->ability > CW_ABILITY_CHARISMA
              || !valid_roll_mode(action->roll_mode)))
      || (!checked_resolution && action->dc)
      || (resolution == CW_GATE_METHOD_RESOLUTION_SRD_CHECK
          && world->gate_claim_count >= CW_MAX_GATE_CLAIMS)) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  if (checked_resolution) {
    int16_t raw = roll_d20(seed, 1, action->roll_mode);
    int16_t modifier =
        (int16_t)(ability_modifier((int8_t)stat_value(&actor->stats, action->ability))
            + action->modifier);
    int16_t total = (int16_t)(raw + modifier);
    int passed = total >= (int16_t)action->dc;
    append_event(world, out_events, CW_EVENT_ABILITY_CHECK_ROLLED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = passed ? 1 : 0;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->raw_roll = raw;
      event->modifier = modifier;
      event->total = total;
      event->dc = (int16_t)action->dc;
      event->ability = action->ability;
      decorate_gate_event(event, &decision, input);
    }
    if (!passed && resolution == CW_GATE_METHOD_RESOLUTION_SRD_CHECK) {
      cw_gate_claim *failed_claim =
          &world->gate_claims[world->gate_claim_count++];
      memset(failed_claim, 0, sizeof(*failed_claim));
      failed_claim->id = input->claim_id;
      failed_claim->gate_id = gate->id;
      failed_claim->actor_id = actor->id;
      failed_claim->item_id = action->item_id;
      failed_claim->method_id = input->method_id;
      failed_claim->transition = input->transition;
      failed_claim->reserved[0] = CW_GATE_CLAIM_OUTCOME_FAILED_METHOD;
      world->access_revision = world->access_revision == UINT64_MAX
          ? UINT64_MAX
          : world->access_revision + 1;
      return CW_OK;
    }
  }

  uint8_t resulting_state = gate_transition_state(input->transition);
  uint8_t current_state = effective_gate_state(world, gate, actor->id);
  if (resulting_state && current_state == resulting_state) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  cw_item *item = action->item_id ? find_item(world, action->item_id) : 0;
  switch (input->transition) {
    case CW_GATE_TRANSITION_INSTALL:
      if (!item || item->holder_actor_id != actor->id
          || (item->reserved & CW_ITEM_FLAG_INERT)) {
        return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
      }
      break;
    case CW_GATE_TRANSITION_REMOVE:
      if (!item || item->holder_actor_id != 0
          || item->zone != CW_CARD_ZONE_INSTALLED
          || item->location_id != actor->location_id
          || !actor_can_exchange(world, actor, 0, item)) {
        return reject(
            world,
            out_events,
            action,
            item && item->location_id == actor->location_id
                ? CW_REASON_CAPACITY_EXCEEDED
                : CW_REASON_ITEM_NOT_AVAILABLE);
      }
      break;
    case CW_GATE_TRANSITION_EXHAUST:
    case CW_GATE_TRANSITION_RENDER_INERT:
      if (!item || item->charges == 0
          || (item->holder_actor_id != actor->id
              && !(item->holder_actor_id == 0
                  && item->location_id == actor->location_id
                  && item->zone == CW_CARD_ZONE_INSTALLED))) {
        return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
      }
      break;
    default:
      if (action->item_id) {
        return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
      }
      break;
  }
  if (world->gate_claim_count >= CW_MAX_GATE_CLAIMS
      || ((gate->scope == CW_GATE_SCOPE_ACTOR || gate->scope == CW_GATE_SCOPE_HOLDER)
          && resulting_state
          && !find_gate_actor_state(world, gate->id, actor->id)
          && world->gate_actor_state_count >= CW_MAX_GATE_ACTOR_STATES)) {
    return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
  }

  cw_gate_claim *claim = &world->gate_claims[world->gate_claim_count++];
  memset(claim, 0, sizeof(*claim));
  claim->id = input->claim_id;
  claim->gate_id = gate->id;
  claim->actor_id = actor->id;
  claim->item_id = action->item_id;
  claim->method_id = input->method_id;
  claim->transition = input->transition;

  status = set_effective_gate_state(
      world,
      gate,
      actor->id,
      resulting_state);
  if (status != CW_OK) return status;

  uint8_t item_event_type = CW_EVENT_NONE;
  switch (input->transition) {
    case CW_GATE_TRANSITION_INSTALL:
      (void)place_item(item, CW_CARD_ZONE_INSTALLED, 0, actor->location_id, 0, 0);
      item_event_type = CW_EVENT_ITEM_INSTALLED;
      break;
    case CW_GATE_TRANSITION_REMOVE:
      (void)place_item(item, CW_CARD_ZONE_CARRIED, actor->id, 0, 0, world->tick);
      item_event_type = CW_EVENT_ITEM_REMOVED;
      break;
    case CW_GATE_TRANSITION_EXHAUST:
      item->charges = 0;
      exhaust_item(item);
      item_event_type = CW_EVENT_ITEM_EXHAUSTED;
      break;
    case CW_GATE_TRANSITION_RENDER_INERT:
      item->charges = 0;
      item->reserved |= CW_ITEM_FLAG_INERT;
      item_event_type = CW_EVENT_ITEM_RENDERED_INERT;
      break;
    default:
      break;
  }

  append_event(world, out_events, CW_EVENT_GATE_TRANSITION_APPLIED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->destination_location_id = gate->to_location_id;
    event->item_id = action->item_id;
    decorate_gate_event(event, &decision, input);
  }
  if (item_event_type != CW_EVENT_NONE) {
    append_event(world, out_events, item_event_type);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->location_id = actor->location_id;
      event->item_id = action->item_id;
      decorate_gate_event(event, &decision, input);
    }
  }
  world->access_revision = world->access_revision == UINT64_MAX
      ? UINT64_MAX
      : world->access_revision + 1;
  return CW_OK;
}

static cw_status apply_reveal_item(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  if (!find_location(world, action->location_id)) {
    return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
  }
  cw_item *item = find_item(world, action->item_id);
  if (!item) return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  if (item->holder_actor_id != 0
      || item->location_id != 0
      || item->zone != CW_CARD_ZONE_HIDDEN
      || item->charges == 0) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  (void)place_item(item, CW_CARD_ZONE_WORLD, 0, action->location_id, 0, 0);
  append_event(world, out_events, CW_EVENT_ITEM_REVEALED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = action->actor_id;
    event->location_id = action->location_id;
    event->item_id = action->item_id;
  }
  return CW_OK;
}

static int craft_disposition_removes_item(uint8_t disposition) {
  return disposition == CW_CRAFT_INPUT_CONSUMED
      || disposition == CW_CRAFT_INPUT_TRANSFORMED;
}

static int actor_can_accept_craft_output(
    const cw_world *world,
    const cw_actor *actor,
    const cw_action *action,
    const cw_item *output) {
  uint32_t weight = 0;
  uint32_t capacity = actor_base_capacity_tenths(actor);
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *item = &world->items[i];
    if (item->holder_actor_id != actor->id) continue;
    if ((item->id == action->item_id
            && craft_disposition_removes_item(action->item_disposition))
        || (item->id == action->target_item_id
            && craft_disposition_removes_item(action->target_item_disposition))) {
      continue;
    }
    weight += item_weight_tenths(item);
    capacity += item_container_capacity_tenths(item);
  }
  weight += item_weight_tenths(output);
  capacity += item_container_capacity_tenths(output);
  return weight <= capacity;
}

static size_t craft_removed_item_count(const cw_world *world, const cw_action *action) {
  size_t count = 0;
  if (craft_disposition_removes_item(action->item_disposition)
      && find_item_const(world, action->item_id)) {
    count++;
  }
  if (action->target_item_id
      && craft_disposition_removes_item(action->target_item_disposition)
      && find_item_const(world, action->target_item_id)) {
    count++;
  }
  return count;
}

static cw_status validate_output_slot(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  if (!action->output_item_id) return CW_OK;
  if (!action->output_target_id || !action->output_target_kind || !action->output_item_kind || !action->output_item_charges) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  const uint16_t output_weight = action->output_item_weight_tenths
      ? action->output_item_weight_tenths : CW_ITEM_DEFAULT_WEIGHT_TENTHS;
  const uint8_t output_size = action->output_item_size_class
      ? action->output_item_size_class : CW_ITEM_SIZE_SMALL;
  const uint8_t output_role = action->output_item_role
      ? action->output_item_role
      : (action->output_item_kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC);
  if (!output_weight
      || output_size < CW_ITEM_SIZE_TINY
      || output_size > CW_ITEM_SIZE_LARGE
      || output_role > CW_ITEM_ROLE_RELIC
      || (action->output_container_capacity_tenths && output_role != CW_ITEM_ROLE_CONTAINER)) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  if (find_item(world, action->output_item_id)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }
  if (world->item_count - craft_removed_item_count(world, action) >= CW_MAX_ITEMS) {
    return CW_ERR_FULL;
  }
  switch (action->output_target_kind) {
    case CW_PLACEMENT_ACTOR_HAND: {
      cw_actor *target = find_actor(world, action->output_target_id);
      if (!target || !actor_is_active(target)) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
      cw_item output;
      memset(&output, 0, sizeof(output));
      output.weight_tenths = output_weight;
      output.container_capacity_tenths = action->output_container_capacity_tenths;
      output.size_class = output_size;
      output.role = output_role;
      const int capacity_ok = target->id == action->actor_id
          ? actor_can_accept_craft_output(world, target, action, &output)
          : actor_can_exchange(world, target, 0, &output);
      if (!capacity_ok) {
        return reject(world, out_events, action, CW_REASON_CAPACITY_EXCEEDED);
      }
      return CW_OK;
    }
    case CW_PLACEMENT_LOCATION_FLOOR:
    case CW_PLACEMENT_LOCATION_FIXTURE:
      if (!find_location(world, action->output_target_id)) return reject(world, out_events, action, CW_REASON_LOCATION_NOT_FOUND);
      return CW_OK;
    default:
      return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
}

static int valid_craft_input_disposition(uint8_t disposition) {
  return disposition == CW_CRAFT_INPUT_PERSISTS
      || disposition == CW_CRAFT_INPUT_EXHAUSTED
      || disposition == CW_CRAFT_INPUT_TRANSFORMED;
}

static int craft_input_is_local(const cw_item *item, const cw_actor *actor) {
  return item && actor
      && ((item->holder_actor_id == actor->id
              && item->location_id == 0
              && item->zone == CW_CARD_ZONE_CARRIED)
          || (item->holder_actor_id == 0
              && item->location_id == actor->location_id
              && item->zone == CW_CARD_ZONE_WORLD));
}

static void append_craft_input_transition(
    cw_world *world,
    cw_event_buffer *out_events,
    const cw_action *action,
    const cw_actor *actor,
    cw_id item_id,
    uint8_t disposition) {
  uint8_t event_type = CW_EVENT_NONE;
  switch (disposition) {
    case CW_CRAFT_INPUT_CONSUMED: event_type = CW_EVENT_ITEM_CONSUMED; break;
    case CW_CRAFT_INPUT_EXHAUSTED: event_type = CW_EVENT_ITEM_EXHAUSTED; break;
    case CW_CRAFT_INPUT_TRANSFORMED: event_type = CW_EVENT_ITEM_TRANSFORMED; break;
    default: return;
  }
  append_event(world, out_events, event_type);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->content_id = action->content_id;
    event->item_id = item_id;
    event->target_item_id = action->output_item_id;
  }
}

static void apply_craft_input_disposition(
    cw_world *world,
    cw_event_buffer *out_events,
    const cw_action *action,
    const cw_actor *actor,
    cw_id item_id,
    uint8_t disposition) {
  if (disposition == CW_CRAFT_INPUT_PERSISTS) return;
  append_craft_input_transition(world, out_events, action, actor, item_id, disposition);
  if (disposition == CW_CRAFT_INPUT_EXHAUSTED) {
    cw_item *item = find_item(world, item_id);
    if (!item) return;
    item->charges = 0;
    if (item->holder_actor_id == actor->id) exhaust_item(item);
    return;
  }
  remove_item(world, item_id);
}

static cw_status apply_craft(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_actor *actor = 0;
  cw_status status = require_active_actor(world, action, out_events, &actor);
  if (status != CW_OK) return status;
  const int inputless_supply = action->content_id == 3105
      && !action->item_id
      && !action->target_item_id
      && action->output_item_id
      && action->item_disposition == CW_CRAFT_INPUT_PERSISTS
      && action->target_item_disposition == CW_CRAFT_INPUT_PERSISTS;
  if (!action->content_id || (!action->item_id && !inputless_supply)
      || (action->target_item_id && action->item_id == action->target_item_id)
      || !valid_craft_input_disposition(action->item_disposition)
      || !valid_craft_input_disposition(action->target_item_disposition)
      || (!action->target_item_id && action->target_item_disposition != CW_CRAFT_INPUT_PERSISTS)) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }

  cw_item *first = action->item_id ? find_item(world, action->item_id) : 0;
  cw_item *second = action->target_item_id ? find_item(world, action->target_item_id) : 0;
  if ((action->item_id && !first) || (action->target_item_id && !second)) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_FOUND);
  }
  const int legacy_two_input = action->target_item_id
      && action->item_disposition == CW_CRAFT_INPUT_PERSISTS
      && action->target_item_disposition == CW_CRAFT_INPUT_PERSISTS;
  if ((legacy_two_input
          && (first->holder_actor_id != actor->id
              || second->holder_actor_id != 0
              || second->location_id != actor->location_id))
      || (!legacy_two_input && !inputless_supply
          && (!craft_input_is_local(first, actor)
              || (second && !craft_input_is_local(second, actor))))) {
    return reject(world, out_events, action, CW_REASON_ITEM_NOT_AVAILABLE);
  }

  status = validate_output_slot(world, action, out_events);
  if (status != CW_OK) return status;

  const cw_id first_id = first ? first->id : 0;
  const cw_id second_id = second ? second->id : 0;
  append_event(world, out_events, CW_EVENT_ITEM_CRAFTED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = actor->location_id;
    event->content_id = action->content_id;
    event->item_id = first_id;
    event->target_item_id = second_id;
    event->destination_location_id =
        action->output_target_kind == CW_PLACEMENT_ACTOR_HAND ? 0 : action->output_target_id;
    event->target_actor_id =
        action->output_target_kind == CW_PLACEMENT_ACTOR_HAND ? action->output_target_id : 0;
  }

  if (first_id) {
    apply_craft_input_disposition(
        world, out_events, action, actor, first_id, action->item_disposition);
  }
  if (second_id) {
    apply_craft_input_disposition(
        world, out_events, action, actor, second_id, action->target_item_disposition);
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
    cw_item *output = find_item(world, action->output_item_id);
    if (output) {
      output->weight_tenths = action->output_item_weight_tenths
          ? action->output_item_weight_tenths : CW_ITEM_DEFAULT_WEIGHT_TENTHS;
      output->container_capacity_tenths = action->output_container_capacity_tenths;
      output->size_class = action->output_item_size_class
          ? action->output_item_size_class : CW_ITEM_SIZE_SMALL;
      output->role = action->output_item_role
          ? action->output_item_role
          : (action->output_item_kind == CW_ITEM_POTION ? CW_ITEM_ROLE_CONSUMABLE : CW_ITEM_ROLE_GENERIC);
    }

    append_event(world, out_events, CW_EVENT_ITEM_CREATED);
    if (out_events && out_events->count > 0) {
      cw_event *event = &out_events->events[out_events->count - 1];
      event->success = 1;
      event->actor_id = actor->id;
      event->location_id =
          action->output_target_kind == CW_PLACEMENT_ACTOR_HAND
              ? actor->location_id
              : action->output_target_id;
      event->target_actor_id =
          action->output_target_kind == CW_PLACEMENT_ACTOR_HAND ? action->output_target_id : 0;
      event->destination_location_id =
          action->output_target_kind == CW_PLACEMENT_ACTOR_HAND
              ? 0
              : action->output_target_id;
      event->content_id = action->content_id;
      event->item_id = action->output_item_id;
      event->target_item_id = second_id;
    }
    maybe_evolve_after_placement(world, actor->id, action->output_item_id, out_events);
  } else {
    maybe_evolve_after_placement(world, actor->id, first_id, out_events);
    if (second_id) maybe_evolve_after_placement(world, actor->id, second_id, out_events);
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
  cw_gate_decision gate_decision = {0};
  const cw_gate *gate =
      find_exit_gate_const(world, actor->location_id, destination_id);
  if (gate) {
    if (action->threshold.gate_id != gate->id
        || cw_gate_evaluate(
               world,
               gate->id,
               actor->id,
               action->threshold.facts,
               action->threshold.fact_count,
               action->threshold.method_id,
               &gate_decision) != CW_OK
        || action->threshold.expected_gate_version != gate_decision.gate_version
        || action->threshold.expected_access_revision != gate_decision.access_revision
        || action->threshold.expected_evidence_digest != gate_decision.evidence_digest) {
      return reject(world, out_events, action, CW_REASON_STALE_GATE_OFFER);
    }
    if (!gate_decision.allowed) {
      return reject(world, out_events, action, CW_REASON_GATE_CLOSED);
    }
    if ((exit->flags & CW_EXIT_LOCKED)
        && gate->compatibility != CW_GATE_COMPAT_RECORDED_LOCK) {
      return reject(world, out_events, action, CW_REASON_EXIT_LOCKED);
    }
  } else if (exit->flags & CW_EXIT_LOCKED) {
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
    decorate_gate_event(event, gate ? &gate_decision : 0, &action->threshold);
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
  if (action->actor_id == action->target_actor_id) {
    return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  }
  cw_actor *target = find_actor(world, action->target_actor_id);
  if (!target) return reject(world, out_events, action, CW_REASON_TARGET_NOT_FOUND);
  if (!actor_is_active(target)) {
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
  /* A zero modifier is the historical journal shape and must retain the
     original kind-based replay rule. New callers write side 1 or 2
     explicitly so controller provenance is not used as a faction. */
  participant->side = action->modifier == 1 || action->modifier == 2
      ? (uint8_t)action->modifier
      : (actor->kind == CW_ACTOR_HUMAN ? 1 : 2);
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
  uint8_t attack_ability = CW_ABILITY_STRENGTH;
  int16_t attack_ability_mod = strength_mod;
  if (finesse && action->ability != CW_ABILITY_STRENGTH
      && action->ability <= CW_ABILITY_CHARISMA) {
    attack_ability = action->ability;
    attack_ability_mod = ability_modifier((int8_t)stat_value(&actor->stats, attack_ability));
  } else if (finesse && dexterity_mod > strength_mod) {
    /* An ability-free finesse action is a legacy journal entry. Preserve its
       historical best-of-Strength-or-Dexterity replay semantics. */
    attack_ability = CW_ABILITY_DEXTERITY;
    attack_ability_mod = dexterity_mod;
  }
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
    event->ability = attack_ability;
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
      event->ability = attack_ability;
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
    event->ability = attack_ability;
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
      event->ability = attack_ability;
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

static cw_status apply_combat_pass(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_combat_encounter *encounter = 0;
  cw_actor *actor = 0;
  cw_status status = require_active_combat_turn(world, action, out_events, &encounter, &actor);
  if (status != CW_OK) return status;
  append_event(world, out_events, CW_EVENT_COMBAT_PASS);
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

/* Close an encounter that can never advance again. Unlike every other combat
   action this does not require the caller to hold the current turn: a stuck
   encounter is precisely one whose current turn can never be completed. It
   resolves with no winning side (total 0) and releases the participants. */
static cw_status apply_combat_abandon(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  if (!action->content_id) return reject(world, out_events, action, CW_REASON_INVALID_ACTION);
  cw_combat_encounter *encounter = find_combat_encounter(world, action->content_id);
  if (!encounter || encounter->status != CW_COMBAT_ENCOUNTER_ACTIVE) {
    return reject(world, out_events, action, CW_REASON_ENCOUNTER_NOT_FOUND);
  }
  if (!find_combat_participant_const(encounter, action->actor_id)) {
    return reject(world, out_events, action, CW_REASON_NOT_PARTICIPANT);
  }
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    cw_actor *participant = find_actor(world, encounter->participants[i].actor_id);
    if (participant) participant->conditions &= ~CW_CONDITION_DODGING;
  }
  encounter->status = CW_COMBAT_ENCOUNTER_RESOLVED;
  append_event(world, out_events, CW_EVENT_COMBAT_ENCOUNTER_RESOLVED);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = action->actor_id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
    event->total = 0;
  }
  return CW_OK;
}

static cw_status apply_combat_need_time(cw_world *world, const cw_action *action, cw_event_buffer *out_events) {
  cw_combat_encounter *encounter = 0;
  cw_actor *actor = 0;
  cw_status status = require_active_combat_turn(world, action, out_events, &encounter, &actor);
  if (status != CW_OK) return status;
  append_event(world, out_events, CW_EVENT_COMBAT_NEED_TIME);
  if (out_events && out_events->count > 0) {
    cw_event *event = &out_events->events[out_events->count - 1];
    event->success = 1;
    event->actor_id = actor->id;
    event->location_id = encounter->location_id;
    event->content_id = encounter->id;
  }
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
  cw_gate_decision gate_decision = {0};
  const cw_gate *gate =
      find_exit_gate_const(world, actor->location_id, destination_id);
  if (gate) {
    if (action->threshold.gate_id != gate->id
        || cw_gate_evaluate(
               world,
               gate->id,
               actor->id,
               action->threshold.facts,
               action->threshold.fact_count,
               action->threshold.method_id,
               &gate_decision) != CW_OK
        || action->threshold.expected_gate_version != gate_decision.gate_version
        || action->threshold.expected_access_revision != gate_decision.access_revision
        || action->threshold.expected_evidence_digest != gate_decision.evidence_digest) {
      return reject(world, out_events, action, CW_REASON_STALE_GATE_OFFER);
    }
    if (!gate_decision.allowed) {
      return reject(world, out_events, action, CW_REASON_GATE_CLOSED);
    }
    if ((exit->flags & CW_EXIT_LOCKED)
        && gate->compatibility != CW_GATE_COMPAT_RECORDED_LOCK) {
      return reject(world, out_events, action, CW_REASON_EXIT_LOCKED);
    }
  } else if (exit->flags & CW_EXIT_LOCKED) {
    return reject(world, out_events, action, CW_REASON_EXIT_LOCKED);
  }

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
    decorate_gate_event(event, gate ? &gate_decision : 0, &action->threshold);
  }
  finish_or_advance_combat_turn(world, encounter, action, out_events);
  return CW_OK;
}

cw_status cw_world_apply_with_tick(cw_world *world, const cw_action *action, uint64_t seed, uint8_t advance_tick, cw_event_buffer *out_events) {
  if (!world || !action) return CW_ERR_INVALID;
  if (out_events) memset(out_events, 0, sizeof(*out_events));
  if (action->kind == CW_ACTION_GATE_TRANSITION
      && action->threshold.claim_id) {
    const cw_gate_claim *existing =
        find_gate_claim_const(world, action->threshold.claim_id);
    if (existing) {
      if (existing->gate_id == action->threshold.gate_id
          && existing->actor_id == action->actor_id
          && existing->item_id == action->item_id
          && existing->method_id == action->threshold.method_id
          && existing->transition == action->threshold.transition) {
        return CW_OK;
      }
      return reject(
          world,
          out_events,
          action,
          CW_REASON_GATE_CLAIM_CONFLICT);
    }
  }
  cw_combat_encounter *active_encounter = find_active_combat_encounter_for_actor(world, action->actor_id);
  if (active_encounter
      && action->kind != CW_ACTION_SAY
      && action->kind != CW_ACTION_UNLOCK_EXIT
      && action->kind != CW_ACTION_REVEAL_ITEM
      && action->kind != CW_ACTION_COMBAT_ATTACK
      && action->kind != CW_ACTION_COMBAT_FINESSE_ATTACK
      && action->kind != CW_ACTION_COMBAT_DODGE
      && action->kind != CW_ACTION_COMBAT_ESCAPE
      && action->kind != CW_ACTION_COMBAT_PASS
      && action->kind != CW_ACTION_COMBAT_ABANDON
      && action->kind != CW_ACTION_COMBAT_NEED_TIME) {
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
    case CW_ACTION_COMPLETE_AVATAR_RESCUE:
      status = apply_complete_avatar_rescue(world, action, out_events);
      break;
    case CW_ACTION_REPLACE_AVATAR_RESCUER:
      status = apply_replace_avatar_rescuer(world, action, seed, out_events);
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
    case CW_ACTION_RULES_UTILIZE_ITEM:
      status = apply_rules_utilize_item(world, action, out_events);
      break;
    case CW_ACTION_PROJECT_PUSH:
      status = apply_project_push(world, action, out_events);
      break;
    case CW_ACTION_REST:
      status = apply_rest(world, action, out_events);
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
    case CW_ACTION_COMBAT_PASS:
      status = apply_combat_pass(world, action, out_events);
      break;
    case CW_ACTION_COMBAT_NEED_TIME:
      status = apply_combat_need_time(world, action, out_events);
      break;
    case CW_ACTION_COMBAT_ABANDON:
      status = apply_combat_abandon(world, action, out_events);
      break;
    case CW_ACTION_UNLOCK_EXIT:
      status = apply_unlock_exit(world, action, out_events);
      break;
    case CW_ACTION_REVEAL_ITEM:
      status = apply_reveal_item(world, action, out_events);
      break;
    case CW_ACTION_GATE_TRANSITION:
      status = apply_gate_transition(world, action, seed, out_events);
      break;
    case CW_ACTION_FOCUSED_NOTICE_V2:
      status = apply_discovery_procedure(
          world, action, seed, CW_EVENT_FOCUSED_NOTICE_COMMITTED, out_events);
      break;
    case CW_ACTION_SEARCH_V2:
      status = apply_discovery_procedure(
          world, action, seed, CW_EVENT_SEARCH_COMMITTED, out_events);
      break;
    case CW_ACTION_STUDY_V2:
      status = apply_discovery_procedure(
          world, action, seed, CW_EVENT_STUDY_COMMITTED, out_events);
      break;
    case CW_ACTION_SCOUT_V2:
      status = apply_discovery_procedure(
          world, action, seed, CW_EVENT_SCOUT_COMMITTED, out_events);
      break;
    default:
      status = reject(world, out_events, action, CW_REASON_INVALID_ACTION);
      break;
  }
  if (status != CW_OK && advance_tick) world->tick = previous_tick;
  if (status == CW_OK && action->kind != CW_ACTION_GATE_TRANSITION) {
    world->access_revision = world->access_revision == UINT64_MAX
        ? UINT64_MAX
        : world->access_revision + 1;
  }
  return status;
}

cw_status cw_world_apply(cw_world *world, const cw_action *action, uint64_t seed, cw_event_buffer *out_events) {
  return cw_world_apply_with_tick(world, action, seed, 0, out_events);
}

static int actor_can_cross_exit_without_external_facts(
    const cw_world *world,
    const cw_actor *actor,
    const cw_exit *exit) {
  const cw_gate *gate =
      find_exit_gate_const(world, exit->from_location_id, exit->to_location_id);
  if (!gate) return !(exit->flags & CW_EXIT_LOCKED);
  if ((exit->flags & CW_EXIT_LOCKED)
      && gate->compatibility != CW_GATE_COMPAT_RECORDED_LOCK) {
    return 0;
  }
  cw_gate_decision decision = {0};
  return cw_gate_evaluate(
             world,
             gate->id,
             actor->id,
             0,
             0,
             0,
             &decision) == CW_OK
      && decision.allowed;
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
        if (exit->from_location_id == actor->location_id
            && actor_can_cross_exit_without_external_facts(world, actor, exit)) {
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
        if (exit->from_location_id == actor->location_id
            && actor_can_cross_exit_without_external_facts(world, actor, exit)) {
          out_offers->option_flags |= CW_OFFER_FLEE;
          break;
        }
      }
    }
  }

  for (size_t i = 0; i < world->exit_count; ++i) {
    const cw_exit *exit = &world->exits[i];
    if (exit->from_location_id == actor->location_id
        && actor_can_cross_exit_without_external_facts(world, actor, exit)) {
      out_offers->option_flags |= CW_OFFER_MOVE;
      break;
    }
  }

  int actor_has_transferable_item = 0;
  int room_actor_has_transferable_item = 0;
  int room_has_active_actor = 0;
  int room_has_loose_item = 0;
  int hidden_search_item_available = 0;
  for (size_t i = 0; i < world->actor_count; ++i) {
    const cw_actor *other = &world->actors[i];
    if (other->id != actor->id && actor_is_active(other) && other->location_id == actor->location_id) {
      room_has_active_actor = 1;
      break;
    }
  }
  for (size_t i = 0; i < world->item_count; ++i) {
    const cw_item *item = &world->items[i];
    if (!item->holder_actor_id
        && item->location_id == actor->location_id
        && item->zone == CW_CARD_ZONE_WORLD
        && item_is_transferable(item)) {
      room_has_loose_item = 1;
      if (actor_can_pick_up(world, actor, item)) {
        out_offers->option_flags |= CW_OFFER_PICK_UP;
      }
    }
    if (!item->holder_actor_id
        && item->location_id == 0
        && item->zone == CW_CARD_ZONE_HIDDEN
        && item->charges > 0) {
      hidden_search_item_available = 1;
    }
    if (item->holder_actor_id == actor->id
        && item_is_directly_held(item)
        && item->zone != CW_CARD_ZONE_EXHAUSTED
        && (item->role == CW_ITEM_ROLE_CONSUMABLE || item->role == CW_ITEM_ROLE_SPELL)
        && item->charges > 0) {
      out_offers->option_flags |= CW_OFFER_USE_ITEM;
    }
    if (item->holder_actor_id == actor->id
        && item_is_directly_held(item)
        && item_is_transferable(item)
        && !item_has_contents(world, item->id)) {
      actor_has_transferable_item = 1;
    }
    if (item->holder_actor_id && item->holder_actor_id != actor->id) {
      const cw_actor *holder = find_actor_const(world, item->holder_actor_id);
      if (holder && actor_is_active(holder)
          && holder->location_id == actor->location_id
          && item_is_directly_held(item)
          && item_is_transferable(item)
          && !item_has_contents(world, item->id)) {
        room_actor_has_transferable_item = 1;
      }
    }
  }
  if (actor_has_transferable_item && room_has_active_actor) {
    out_offers->option_flags |= CW_OFFER_GIVE_ITEM;
  }
  if (actor_has_transferable_item) {
    out_offers->option_flags |= CW_OFFER_DROP_ITEM;
  }
  if (hidden_search_item_available) {
    out_offers->option_flags |= CW_OFFER_SEARCH;
  }
  if (actor_has_transferable_item && room_has_loose_item) {
    out_offers->option_flags |= CW_OFFER_CRAFT;
  }
  if (actor_has_transferable_item && room_actor_has_transferable_item) {
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
    case CW_EVENT_COMBAT_PASS: return "combat.pass";
    case CW_EVENT_COMBAT_NEED_TIME: return "combat.need_time";
    case CW_EVENT_ITEM_CONSUMED: return "item.consumed";
    case CW_EVENT_ITEM_EXHAUSTED: return "item.exhausted";
    case CW_EVENT_ITEM_TRANSFORMED: return "item.transformed";
    case CW_EVENT_EXIT_UNLOCKED: return "exit.unlocked";
    case CW_EVENT_ITEM_REVEALED: return "item.revealed";
    case CW_EVENT_PROJECT_PUSH_RESOLVED: return "project.push.resolved";
    case CW_EVENT_ITEM_REFRESHED: return "item.refreshed";
    case CW_EVENT_GATE_TRANSITION_APPLIED: return "gate.transition.applied";
    case CW_EVENT_ITEM_INSTALLED: return "item.installed";
    case CW_EVENT_ITEM_REMOVED: return "item.removed";
    case CW_EVENT_ITEM_RENDERED_INERT: return "item.rendered_inert";
    case CW_EVENT_FOCUSED_NOTICE_COMMITTED: return "discovery.notice.committed";
    case CW_EVENT_SEARCH_COMMITTED: return "discovery.search.committed";
    case CW_EVENT_STUDY_COMMITTED: return "discovery.study.committed";
    case CW_EVENT_SCOUT_COMMITTED: return "discovery.scout.committed";
    case CW_EVENT_AVATAR_RESCUE_COMPLETED: return "avatar.rescue.completed";
    case CW_EVENT_AVATAR_RELEASED: return "avatar.released";
    case CW_EVENT_COMBAT_DEATH: return "combat.death";
    default: return "unknown";
  }
}

uint16_t cw_rejection_reason_max(void) {
  return (uint16_t)(CW_REASON_COUNT - 1);
}
