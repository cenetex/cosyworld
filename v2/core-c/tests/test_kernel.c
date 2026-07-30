#include "cosy_kernel.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static cw_item *test_find_item(cw_world *world, cw_id item_id) {
  for (size_t i = 0; i < world->item_count; ++i) {
    if (world->items[i].id == item_id) return &world->items[i];
  }
  return 0;
}

static cw_actor *test_find_actor(cw_world *world, cw_id actor_id) {
  for (size_t i = 0; i < world->actor_count; ++i) {
    if (world->actors[i].id == actor_id) return &world->actors[i];
  }
  return 0;
}

static cw_exit *test_find_exit(cw_world *world, cw_id from_location_id, cw_id to_location_id) {
  for (size_t i = 0; i < world->exit_count; ++i) {
    cw_exit *exit = &world->exits[i];
    if (exit->from_location_id == from_location_id
        && exit->to_location_id == to_location_id) {
      return exit;
    }
  }
  return 0;
}

static cw_gate *test_find_gate(cw_world *world, cw_id gate_id) {
  for (size_t i = 0; i < world->gate_count; ++i) {
    if (world->gates[i].id == gate_id) return &world->gates[i];
  }
  return 0;
}

static void test_kernel_capacities_are_runtime_sized(void) {
  assert(CW_MAX_ACTORS >= 512u);
  assert(CW_MAX_ITEMS >= 1024u);
  assert(CW_MAX_LOCATIONS >= 256u);
  assert(CW_MAX_EXITS >= 1024u);
  assert(CW_MAX_EVENTS >= 128u);
  assert(CW_MAX_EVOLUTION_TRACKS >= 128u);
  assert(CW_MAX_GATES >= 32u);
  assert(CW_MAX_GATE_CLAIMS >= 128u);
  assert(sizeof(cw_world) <= 170000u);
}

static void test_seed_and_chat(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);

  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  assert(world.location_count == 10);
  assert(world.exit_count == 24);
  assert(world.actor_count == 5);
  assert(world.item_count == 7);
  assert(world.evolution_track_count == 3);
  assert(world.evolution_tracks[0].actor_id == 1001);
  assert(world.evolution_tracks[0].requirement_count == 2);
  assert(world.evolution_tracks[0].requirements[0].item_id == 2004);
  assert(world.evolution_tracks[0].requirements[0].target_kind == CW_PLACEMENT_ACTOR_HAND);
  assert(world.evolution_tracks[0].requirements[0].target_id == 1001);
  assert(world.evolution_tracks[0].requirements[1].item_id == 2005);
  assert(world.evolution_tracks[0].requirements[1].target_kind == CW_PLACEMENT_LOCATION_FLOOR);
  assert(world.evolution_tracks[0].requirements[1].target_id == 1);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_WORLD_BOOTSTRAPPED);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 42, &events) == CW_OK);
  assert(world.actor_count == 6);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ACTOR_CREATED);
  assert(events.events[1].type == CW_EVENT_ACTOR_ENTERED_LOCATION);

  cw_action say = {0};
  say.kind = CW_ACTION_SAY;
  say.actor_id = 5001;
  say.content_id = 9001;
  assert(cw_world_apply(&world, &say, 42, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_MESSAGE_CREATED);
  assert(events.events[0].content_id == 9001);
}

static void test_movement_and_check(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action move = {0};
  move.kind = CW_ACTION_MOVE;
  move.actor_id = 1001;
  move.destination_location_id = 3;
  assert(cw_world_apply(&world, &move, 99, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_MOVE_BLOCKED);

  move.destination_location_id = 2;
  assert(cw_world_apply(&world, &move, 100, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ACTOR_MOVED);
  assert(events.events[0].location_id == 1);
  assert(events.events[0].destination_location_id == 2);
  assert(world.actors[0].location_id == 2);

  cw_action check = {0};
  check.kind = CW_ACTION_ABILITY_CHECK;
  check.actor_id = 1001;
  check.ability = CW_ABILITY_WISDOM;
  check.dc = 12;
  assert(cw_world_apply(&world, &check, 1234, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ABILITY_CHECK_ROLLED);
  assert(events.events[0].raw_roll >= 1);
  assert(events.events[0].raw_roll <= 20);

  check.dc = UINT16_MAX;
  assert(cw_world_apply(&world, &check, 1234, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
}

static void test_explicit_tick_control_and_rejected_action_rollback(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  const uint64_t starting_tick = world.tick;

  cw_action say = {0};
  say.kind = CW_ACTION_SAY;
  say.actor_id = 1001;
  say.content_id = 9001;
  assert(cw_world_apply_with_tick(&world, &say, 201, 0, &events) == CW_OK);
  assert(world.tick == starting_tick);
  assert(cw_world_apply(&world, &say, 201, &events) == CW_OK);
  assert(world.tick == starting_tick);

  cw_action blocked_move = {0};
  blocked_move.kind = CW_ACTION_MOVE;
  blocked_move.actor_id = 1001;
  blocked_move.destination_location_id = 3;
  assert(cw_world_apply_with_tick(&world, &blocked_move, 202, 1, &events) == CW_ERR_RULE);
  assert(world.tick == starting_tick);

  blocked_move.destination_location_id = 2;
  assert(cw_world_apply_with_tick(&world, &blocked_move, 203, 1, &events) == CW_OK);
  assert(world.tick == starting_tick + 1);
}

static void test_d20_roll_modes_bloodied_and_nonlethal_knockout(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action check = {0};
  check.kind = CW_ACTION_ABILITY_CHECK;
  check.actor_id = 1001;
  check.ability = CW_ABILITY_WISDOM;
  check.dc = 12;
  assert(cw_world_apply(&world, &check, 1234, &events) == CW_OK);
  int16_t normal_roll = events.events[0].raw_roll;

  check.roll_mode = CW_ROLL_ADVANTAGE;
  assert(cw_world_apply(&world, &check, 1234, &events) == CW_OK);
  int16_t advantage_roll = events.events[0].raw_roll;
  assert(advantage_roll >= normal_roll);

  check.roll_mode = CW_ROLL_DISADVANTAGE;
  assert(cw_world_apply(&world, &check, 1234, &events) == CW_OK);
  int16_t disadvantage_roll = events.events[0].raw_roll;
  assert(disadvantage_roll <= normal_roll);
  assert(advantage_roll >= disadvantage_roll);

  check.roll_mode = 99;
  assert(cw_world_apply(&world, &check, 1234, &events) == CW_ERR_RULE);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  check.roll_mode = CW_ROLL_NORMAL;
  uint64_t natural_one_seed = 0;
  uint64_t natural_twenty_seed = 0;
  for (uint64_t seed = 1; seed <= 10000 && (!natural_one_seed || !natural_twenty_seed); ++seed) {
    assert(cw_world_apply(&world, &check, seed, &events) == CW_OK);
    if (events.events[0].raw_roll == 1) natural_one_seed = seed;
    if (events.events[0].raw_roll == 20) natural_twenty_seed = seed;
  }
  assert(natural_one_seed);
  assert(natural_twenty_seed);

  cw_actor *attacker = &world.actors[2];
  cw_actor *target = &world.actors[3];
  attacker->location_id = 3;
  attacker->stats.strength = 30;
  target->stats.dexterity = 1;
  target->stats.hp_base = 100;
  target->damage = 0;

  cw_action attack = {0};
  attack.kind = CW_ACTION_ATTACK;
  attack.actor_id = attacker->id;
  attack.target_actor_id = target->id;
  assert(cw_world_apply(&world, &attack, natural_one_seed, &events) == CW_OK);
  assert(events.events[0].raw_roll == 1);
  assert(!events.events[0].success);
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_MISS);

  attacker->stats.strength = 1;
  target->stats.dexterity = 30;
  assert(cw_world_apply(&world, &attack, natural_twenty_seed, &events) == CW_OK);
  assert(events.events[0].raw_roll == 20);
  assert(events.events[0].success);
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_HIT);

  attacker->stats.strength = 30;
  target->stats.dexterity = 1;
  target->stats.hp_base = 2;
  target->damage = 0;
  assert(!cw_actor_is_bloodied(target));

  attack.roll_mode = CW_ROLL_ADVANTAGE;
  assert(cw_world_apply(&world, &attack, 55, &events) == CW_OK);
  assert(events.count == 3);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_HIT);
  assert(events.events[2].type == CW_EVENT_COMBAT_KNOCKOUT);
  assert(events.events[2].current_hp == 1);
  assert(target->status == CW_ACTOR_KNOCKED_OUT);
  assert(target->conditions & CW_CONDITION_UNCONSCIOUS);
  assert(cw_actor_current_hp(target) == 1);
  assert(cw_actor_is_bloodied(target));

  world.items[0].holder_actor_id = attacker->id;
  world.items[0].location_id = 0;
  world.items[0].charges = 1;
  cw_action use = {0};
  use.kind = CW_ACTION_USE_ITEM;
  use.actor_id = attacker->id;
  use.target_actor_id = target->id;
  use.item_id = world.items[0].id;
  assert(cw_world_apply(&world, &use, 56, &events) == CW_OK);
  assert(target->status == CW_ACTOR_ACTIVE);
  assert(!(target->conditions & CW_CONDITION_UNCONSCIOUS));
  assert(cw_actor_current_hp(target) == target->stats.hp_base);
  assert(!cw_actor_is_bloodied(target));
}

static void test_items_and_combat_gate(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 1001;
  pickup.item_id = 2001;
  assert(cw_world_apply(&world, &pickup, 55, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);
  assert(world.items[0].holder_actor_id == 1001);
  assert(world.items[0].location_id == 0);

  cw_action drop = {0};
  drop.kind = CW_ACTION_DROP_ITEM;
  drop.actor_id = 1001;
  drop.item_id = 2001;
  assert(cw_world_apply(&world, &drop, 55, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_DROPPED);
  assert(events.events[0].location_id == 1);
  assert(world.items[0].holder_actor_id == 0);
  assert(world.items[0].location_id == 1);

  assert(cw_world_apply(&world, &drop, 55, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  assert(cw_world_apply(&world, &pickup, 55, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);
  cw_action_offers cottage_offers = {0};
  assert(cw_get_action_offers(&world, 1001, &cottage_offers) == CW_OK);
  assert(cottage_offers.option_flags & CW_OFFER_GIVE_ITEM);
  cw_action give_tonic = {0};
  give_tonic.kind = CW_ACTION_GIVE_ITEM;
  give_tonic.actor_id = 1001;
  give_tonic.target_actor_id = 1002;
  give_tonic.item_id = 2001;
  assert(cw_world_apply(&world, &give_tonic, 55, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(events.events[0].item_id == 2001);
  assert(world.items[0].holder_actor_id == 1002);
  pickup.actor_id = 1002;
  assert(cw_world_apply(&world, &pickup, 55, &events) == CW_ERR_RULE);
  world.items[0].holder_actor_id = 1001;
  pickup.actor_id = 1001;

  cw_action use = {0};
  use.kind = CW_ACTION_USE_ITEM;
  use.actor_id = 1001;
  use.target_actor_id = 1001;
  use.item_id = 2001;
  assert(cw_world_apply(&world, &use, 55, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  world.actors[0].damage = 5;
  assert(cw_world_apply(&world, &use, 55, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_USED);
  assert(events.events[0].current_hp == world.actors[0].stats.hp_base);

  cw_action attack = {0};
  attack.kind = CW_ACTION_ATTACK;
  attack.actor_id = 1003;
  attack.target_actor_id = 1001;
  assert(cw_world_apply(&world, &attack, 55, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_action move = {0};
  move.kind = CW_ACTION_MOVE;
  move.actor_id = 1003;
  move.destination_location_id = 2;
  assert(cw_world_apply(&world, &move, 56, &events) == CW_OK);
  move.destination_location_id = 3;
  assert(cw_world_apply(&world, &move, 57, &events) == CW_OK);

  cw_action_offers offers = {0};
  assert(cw_get_action_offers(&world, 1003, &offers) == CW_OK);
  assert(offers.option_flags & CW_OFFER_ATTACK);
  assert(offers.option_flags & CW_OFFER_DEFEND);
  assert(offers.option_flags & CW_OFFER_FLEE);

  attack.target_actor_id = 1004;
  assert(cw_world_apply(&world, &attack, 55, &events) == CW_OK);
  assert(events.count >= 2);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  assert(events.events[0].target_actor_id == 1004);
  if (world.actors[3].status == CW_ACTOR_KNOCKED_OUT) {
    assert(cw_get_action_offers(&world, 1003, &offers) == CW_OK);
    assert(!(offers.option_flags & CW_OFFER_ATTACK));
    assert(!(offers.option_flags & CW_OFFER_DEFEND));
    assert(!(offers.option_flags & CW_OFFER_FLEE));
    world.actors[3].status = CW_ACTOR_ACTIVE;
    world.actors[3].damage = 0;
  }

  cw_action flee = {0};
  flee.kind = CW_ACTION_FLEE;
  flee.actor_id = 1003;
  flee.destination_location_id = 2;
  assert(cw_world_apply(&world, &flee, 58, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_COMBAT_FLEE_SUCCESS);
  assert(events.events[0].location_id == 3);
  assert(events.events[0].destination_location_id == 2);
  assert(world.actors[2].location_id == 2);

  assert(cw_world_apply(&world, &flee, 59, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
}

static void test_rules_utilize_item_records_project_use_without_consuming(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_item *item = &world.items[2];
  assert(item->kind != CW_ITEM_POTION);
  item->holder_actor_id = 1001;
  item->location_id = 0;
  item->zone = CW_CARD_ZONE_CARRIED;
  item->charges = 3;

  cw_action utilize = {0};
  utilize.kind = CW_ACTION_RULES_UTILIZE_ITEM;
  utilize.actor_id = 1001;
  utilize.item_id = item->id;

  assert(cw_world_apply(&world, &utilize, 56, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_USED);
  assert(events.events[0].success);
  assert(events.events[0].actor_id == 1001);
  assert(events.events[0].item_id == item->id);
  assert(events.events[0].target_actor_id == 0);
  assert(item->charges == 3);

  item->holder_actor_id = 1002;
  assert(cw_world_apply(&world, &utilize, 57, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(item->charges == 3);
}

static void test_combat_abandon_closes_a_stuck_encounter(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5101;
  create.location_id = 3;
  assert(cw_world_apply(&world, &create, 401, &events) == CW_OK);

  cw_actor *human = &world.actors[5];
  cw_actor *echo = &world.actors[3];
  human->stats.hp_base = 100;
  echo->stats.hp_base = 100;

  cw_action start = {0};
  start.kind = CW_ACTION_COMBAT_START;
  start.actor_id = human->id;
  start.target_actor_id = echo->id;
  start.content_id = 9101;
  assert(cw_world_apply(&world, &start, 501, &events) == CW_OK);
  cw_combat_encounter *encounter = &world.combat_encounters[0];
  assert(encounter->status == CW_COMBAT_ENCOUNTER_ACTIVE);

  /* An unknown encounter is rejected rather than closing anything. */
  cw_action missing = {0};
  missing.kind = CW_ACTION_COMBAT_ABANDON;
  missing.actor_id = human->id;
  missing.content_id = encounter->id + 7777;
  assert(cw_world_apply(&world, &missing, 502, &events) == CW_ERR_RULE);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(encounter->status == CW_COMBAT_ENCOUNTER_ACTIVE);

  /* An abandon without an encounter id is an invalid action. */
  cw_action untargeted = {0};
  untargeted.kind = CW_ACTION_COMBAT_ABANDON;
  untargeted.actor_id = human->id;
  assert(cw_world_apply(&world, &untargeted, 503, &events) == CW_ERR_RULE);
  assert(encounter->status == CW_COMBAT_ENCOUNTER_ACTIVE);

  /* An unrelated actor cannot use the system recovery action to close
     somebody else's encounter. */
  cw_action unrelated = {0};
  unrelated.kind = CW_ACTION_COMBAT_ABANDON;
  unrelated.actor_id = world.actors[0].id;
  unrelated.content_id = encounter->id;
  assert(cw_world_apply(&world, &unrelated, 504, &events) == CW_ERR_RULE);
  assert(events.events[0].reason == CW_REASON_NOT_PARTICIPANT);
  assert(encounter->status == CW_COMBAT_ENCOUNTER_ACTIVE);

  /* Abandon closes the encounter with no winning side, from any participant
     and regardless of whose turn it currently is. */
  cw_id waiting_id = encounter->participants[encounter->current_index].actor_id == human->id
      ? echo->id
      : human->id;
  cw_action abandon = {0};
  abandon.kind = CW_ACTION_COMBAT_ABANDON;
  abandon.actor_id = waiting_id;
  abandon.content_id = encounter->id;
  assert(cw_world_apply(&world, &abandon, 505, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_COMBAT_ENCOUNTER_RESOLVED);
  assert(events.events[0].success == 1);
  assert(events.events[0].content_id == encounter->id);
  assert(events.events[0].total == 0);
  assert(encounter->status == CW_COMBAT_ENCOUNTER_RESOLVED);

  /* Participants are released: ordinary play is legal again for both. */
  cw_action move = {0};
  move.kind = CW_ACTION_MOVE;
  move.actor_id = human->id;
  move.destination_location_id = 2;
  assert(cw_world_apply(&world, &move, 506, &events) == CW_OK);

  /* Abandoning an already-resolved encounter is rejected, so a repeated
     closure can never double-resolve on replay. */
  assert(cw_world_apply(&world, &abandon, 507, &events) == CW_ERR_RULE);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
}

static void test_combat_v2_encounter_turns_dodge_targeting_and_escape(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 3;
  assert(cw_world_apply(&world, &create, 401, &events) == CW_OK);
  create.actor_id = 5002;
  assert(cw_world_apply(&world, &create, 402, &events) == CW_OK);

  cw_actor *human = &world.actors[5];
  cw_actor *outsider = &world.actors[6];
  cw_actor *echo = &world.actors[3];
  human->stats.hp_base = 100;
  echo->stats.hp_base = 100;

  cw_action start = {0};
  start.kind = CW_ACTION_COMBAT_START;
  start.actor_id = human->id;
  start.target_actor_id = echo->id;
  start.content_id = 9001;
  assert(cw_world_apply(&world, &start, 403, &events) == CW_OK);
  assert(world.combat_encounter_count == 1);
  assert(events.count == 4);
  assert(events.events[0].type == CW_EVENT_COMBAT_ENCOUNTER_STARTED);
  assert(events.events[1].type == CW_EVENT_COMBAT_INITIATIVE_ROLLED);
  assert(events.events[2].type == CW_EVENT_COMBAT_INITIATIVE_ROLLED);
  assert(events.events[3].type == CW_EVENT_COMBAT_TURN_STARTED);

  cw_combat_encounter *encounter = &world.combat_encounters[0];
  assert(encounter->status == CW_COMBAT_ENCOUNTER_ACTIVE);
  assert(encounter->round == 1);
  assert(encounter->participant_count == 2);
  cw_id current_id = encounter->participants[encounter->current_index].actor_id;
  cw_id other_id = current_id == human->id ? echo->id : human->id;

  cw_action_offers current_offers;
  cw_action_offers waiting_offers;
  assert(cw_get_action_offers(&world, current_id, &current_offers) == CW_OK);
  assert(current_offers.option_flags & CW_OFFER_ATTACK);
  assert(current_offers.option_flags & CW_OFFER_DEFEND);
  assert(current_offers.option_flags & CW_OFFER_FLEE);
  assert(cw_get_action_offers(&world, other_id, &waiting_offers) == CW_OK);
  assert(waiting_offers.option_flags == 0);

  uint64_t tick_before_blocked_move = world.tick;
  cw_action blocked_move = {0};
  blocked_move.kind = CW_ACTION_MOVE;
  blocked_move.actor_id = human->id;
  blocked_move.destination_location_id = 2;
  assert(cw_world_apply_with_tick(&world, &blocked_move, 404, 1, &events) == CW_ERR_RULE);
  assert(world.tick == tick_before_blocked_move);
  assert(human->location_id == 3);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(events.events[0].reason == 20);
  assert(events.events[0].content_id == encounter->id);

  cw_action say = {0};
  say.kind = CW_ACTION_SAY;
  say.actor_id = other_id;
  assert(cw_world_apply_with_tick(&world, &say, 404, 0, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_MESSAGE_CREATED);
  assert(encounter->participants[encounter->current_index].actor_id == current_id);

  cw_action need_time = {0};
  need_time.kind = CW_ACTION_COMBAT_NEED_TIME;
  need_time.actor_id = current_id;
  need_time.content_id = encounter->id;
  assert(cw_world_apply_with_tick(&world, &need_time, 404, 0, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_COMBAT_NEED_TIME);
  assert(encounter->participants[encounter->current_index].actor_id == current_id);

  cw_action pass = {0};
  pass.kind = CW_ACTION_COMBAT_PASS;
  pass.actor_id = current_id;
  pass.content_id = encounter->id;
  assert(cw_world_apply(&world, &pass, 404, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_COMBAT_PASS);
  assert(events.events[1].type == CW_EVENT_COMBAT_TURN_ENDED);
  assert(events.events[2].type == CW_EVENT_COMBAT_TURN_STARTED);
  current_id = encounter->participants[encounter->current_index].actor_id;
  other_id = current_id == human->id ? echo->id : human->id;

  cw_action wrong_turn = {0};
  wrong_turn.kind = CW_ACTION_COMBAT_DODGE;
  wrong_turn.actor_id = other_id;
  wrong_turn.content_id = encounter->id;
  assert(cw_world_apply(&world, &wrong_turn, 404, &events) == CW_ERR_RULE);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_action outsider_attack = {0};
  outsider_attack.kind = CW_ACTION_COMBAT_ATTACK;
  outsider_attack.actor_id = current_id;
  outsider_attack.target_actor_id = outsider->id;
  outsider_attack.content_id = encounter->id;
  assert(cw_world_apply(&world, &outsider_attack, 405, &events) == CW_ERR_RULE);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_action dodge = {0};
  dodge.kind = CW_ACTION_COMBAT_DODGE;
  dodge.actor_id = current_id;
  dodge.content_id = encounter->id;
  assert(cw_world_apply(&world, &dodge, 406, &events) == CW_OK);
  cw_actor *dodger = current_id == human->id ? human : echo;
  assert(dodger->conditions & CW_CONDITION_DODGING);
  assert(events.events[0].type == CW_EVENT_COMBAT_DODGE);
  assert(events.events[1].type == CW_EVENT_COMBAT_TURN_ENDED);
  assert(events.events[2].type == CW_EVENT_COMBAT_TURN_STARTED);

  cw_action attack = {0};
  attack.kind = CW_ACTION_COMBAT_ATTACK;
  attack.actor_id = other_id;
  attack.target_actor_id = current_id;
  attack.content_id = encounter->id;
  attack.roll_mode = CW_ROLL_ADVANTAGE;
  assert(cw_world_apply(&world, &attack, 407, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  cw_actor *attacker = other_id == human->id ? human : echo;
  assert(events.events[0].modifier
      == (int16_t)(((attacker->stats.strength - 10) / 2) + 2)
      || events.events[0].modifier
          == (int16_t)(-(((10 - attacker->stats.strength) + 1) / 2) + 2));
  assert(!(dodger->conditions & CW_CONDITION_DODGING));

  current_id = encounter->participants[encounter->current_index].actor_id;
  other_id = current_id == human->id ? echo->id : human->id;
  attacker = current_id == human->id ? human : echo;
  cw_actor *target = other_id == human->id ? human : echo;
  attacker->stats.strength = 30;
  target->stats.dexterity = 1;
  target->stats.hp_base = 2;
  target->damage = 0;
  attack.actor_id = current_id;
  attack.target_actor_id = other_id;
  assert(cw_world_apply(&world, &attack, 408, &events) == CW_OK);
  assert(target->status == CW_ACTOR_KNOCKED_OUT);
  assert(target->conditions & CW_CONDITION_UNCONSCIOUS);
  assert(cw_actor_current_hp(target) == 1);
  assert(encounter->status == CW_COMBAT_ENCOUNTER_RESOLVED);
  assert(events.events[events.count - 1].type == CW_EVENT_COMBAT_ENCOUNTER_RESOLVED);

  human->status = CW_ACTOR_ACTIVE;
  human->damage = 0;
  human->conditions = CW_CONDITION_NONE;
  human->location_id = 3;
  echo->status = CW_ACTOR_ACTIVE;
  echo->damage = 0;
  echo->conditions = CW_CONDITION_NONE;
  echo->location_id = 3;
  start.content_id = 9002;
  assert(cw_world_apply(&world, &start, 409, &events) == CW_OK);
  assert(world.combat_encounter_count == 1);
  encounter = &world.combat_encounters[0];
  assert(encounter->id == 9002);
  if (encounter->participants[encounter->current_index].actor_id == echo->id) {
    cw_action npc_dodge = {0};
    npc_dodge.kind = CW_ACTION_COMBAT_DODGE;
    npc_dodge.actor_id = echo->id;
    npc_dodge.content_id = encounter->id;
    assert(cw_world_apply(&world, &npc_dodge, 410, &events) == CW_OK);
  }
  assert(encounter->participants[encounter->current_index].actor_id == human->id);
  cw_action escape = {0};
  escape.kind = CW_ACTION_COMBAT_ESCAPE;
  escape.actor_id = human->id;
  escape.destination_location_id = 2;
  escape.content_id = encounter->id;
  assert(cw_world_apply(&world, &escape, 411, &events) == CW_OK);
  assert(human->location_id == 2);
  assert(encounter->status == CW_COMBAT_ENCOUNTER_RESOLVED);
  assert(events.events[0].type == CW_EVENT_COMBAT_FLEE_SUCCESS);
  assert(events.events[events.count - 1].type == CW_EVENT_COMBAT_ENCOUNTER_RESOLVED);
  assert(events.events[events.count - 1].total == 2);
}

static void test_combat_v4_weapon_profile_and_legacy_replay(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 3;
  assert(cw_world_apply(&world, &create, 412, &events) == CW_OK);

  cw_actor *human = &world.actors[5];
  cw_actor *echo = &world.actors[3];
  human->stats.strength = 6;
  human->stats.dexterity = 18;
  human->stats.level = 1;
  human->stats.hp_base = 100;
  echo->stats.dexterity = 1;
  echo->stats.hp_base = 100;
  echo->damage = 0;

  cw_action start = {0};
  start.kind = CW_ACTION_COMBAT_START;
  start.actor_id = human->id;
  start.target_actor_id = echo->id;
  start.content_id = 9003;
  assert(cw_world_apply(&world, &start, 413, &events) == CW_OK);

  cw_combat_encounter *encounter = &world.combat_encounters[0];
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    if (encounter->participants[i].actor_id == human->id) {
      encounter->current_index = (uint8_t)i;
      break;
    }
  }

  cw_world before_attack = world;
  cw_action attack = {0};
  attack.kind = CW_ACTION_COMBAT_FINESSE_ATTACK;
  attack.actor_id = human->id;
  attack.target_actor_id = echo->id;
  attack.content_id = encounter->id;
  assert(cw_world_apply(&world, &attack, 415, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  assert(events.events[0].modifier == 6);
  assert(events.events[0].ability == CW_ABILITY_DEXTERITY);
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_HIT);
  assert(events.events[1].damage >= 5);
  assert(events.events[1].damage <= 12);

  cw_world legacy_replay = before_attack;
  attack.kind = CW_ACTION_COMBAT_ATTACK;
  assert(cw_world_apply(&legacy_replay, &attack, 415, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  assert(events.events[0].modifier == 0);
  assert(events.events[0].ability == CW_ABILITY_STRENGTH);
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_HIT);
  assert(events.events[1].damage <= 6);

  cw_world weapon_replay = before_attack;
  cw_item *weapon = test_find_item(&weapon_replay, 2003);
  assert(weapon);
  assert(cw_world_set_item_profile(&weapon_replay, 2003, 30, CW_ITEM_SIZE_MEDIUM, CW_ITEM_ROLE_WEAPON, 0) == CW_OK);
  weapon->holder_actor_id = human->id;
  weapon->location_id = 0;
  weapon->zone = CW_CARD_ZONE_EQUIPPED;
  weapon->reserved = 4;
  attack.kind = CW_ACTION_COMBAT_ATTACK;
  attack.item_id = weapon->id;
  assert(cw_world_apply(&weapon_replay, &attack, 415, &events) == CW_OK);
  assert(events.events[0].item_id == weapon->id);
  assert(events.events[0].ability == CW_ABILITY_STRENGTH);
  assert(events.events[1].item_id == weapon->id);
  assert(events.events[1].damage <= 6);

  cw_world unequipped_replay = before_attack;
  weapon = test_find_item(&unequipped_replay, 2003);
  assert(weapon);
  assert(cw_world_set_item_profile(&unequipped_replay, 2003, 30, CW_ITEM_SIZE_MEDIUM, CW_ITEM_ROLE_WEAPON, 0) == CW_OK);
  weapon->holder_actor_id = human->id;
  weapon->location_id = 0;
  weapon->zone = CW_CARD_ZONE_CARRIED;
  attack.item_id = weapon->id;
  assert(cw_world_apply(&unequipped_replay, &attack, 415, &events) == CW_ERR_RULE);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_world authored_dexterity_replay = before_attack;
  attack.kind = CW_ACTION_COMBAT_FINESSE_ATTACK;
  attack.item_id = 0;
  attack.ability = CW_ABILITY_DEXTERITY;
  human = test_find_actor(&authored_dexterity_replay, 5001);
  assert(human);
  human->stats.strength = 20;
  human->stats.dexterity = 12;
  assert(cw_world_apply(&authored_dexterity_replay, &attack, 415, &events) == CW_OK);
  assert(events.events[0].ability == CW_ABILITY_DEXTERITY);
  assert(events.events[0].modifier == 3);
}

static void test_card_zones_spell_exhaustion_and_theft_atomicity(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 420, &events) == CW_OK);

  cw_item *container = test_find_item(&world, 2005);
  cw_item *content = test_find_item(&world, 2006);
  assert(container && content);
  assert(cw_world_set_item_profile(&world, 2005, 20, CW_ITEM_SIZE_MEDIUM, CW_ITEM_ROLE_CONTAINER, 100) == CW_OK);
  assert(cw_world_set_item_profile(&world, 2006, 5, CW_ITEM_SIZE_SMALL, CW_ITEM_ROLE_TOOL, 0) == CW_OK);
  container->holder_actor_id = 5001;
  container->location_id = 0;
  container->zone = CW_CARD_ZONE_CARRIED;
  content->holder_actor_id = 5001;
  content->location_id = 0;
  content->zone = CW_CARD_ZONE_CARRIED;
  assert(cw_world_set_item_zone(&world, 2005, CW_CARD_ZONE_EQUIPPED, 0) == CW_OK);
  assert(cw_world_set_item_zone(&world, 2006, CW_CARD_ZONE_CONTAINED, 2005) == CW_OK);
  assert(content->container_item_id == 2005);
  assert(cw_world_set_item_zone(&world, 2005, CW_CARD_ZONE_CONTAINED, 2006) == CW_ERR_RULE);
  assert(cw_world_set_item_zone(&world, 2006, CW_CARD_ZONE_EQUIPPED, 0) == CW_OK);
  assert(content->zone == CW_CARD_ZONE_EQUIPPED);
  assert(cw_world_set_item_zone(&world, 2006, CW_CARD_ZONE_CARRIED, 0) == CW_OK);

  cw_item *outer = test_find_item(&world, 2004);
  assert(outer);
  assert(cw_world_set_item_profile(&world, 2004, 30, CW_ITEM_SIZE_LARGE, CW_ITEM_ROLE_CONTAINER, 200) == CW_OK);
  outer->holder_actor_id = 5001;
  outer->location_id = 0;
  outer->zone = CW_CARD_ZONE_EQUIPPED;
  assert(cw_world_set_item_zone(&world, 2005, CW_CARD_ZONE_CONTAINED, 2004) == CW_OK);
  assert(container->container_item_id == 2004);
  assert(container->zone == CW_CARD_ZONE_CONTAINED);
  assert(cw_world_set_item_zone(&world, 2006, CW_CARD_ZONE_CONTAINED, 2005) == CW_ERR_RULE);
  assert(cw_world_set_item_zone(&world, 2005, CW_CARD_ZONE_CARRIED, 0) == CW_OK);

  assert(cw_world_set_item_profile(&world, 2006, 1, CW_ITEM_SIZE_TINY, CW_ITEM_ROLE_SPELL, 0) == CW_OK);
  content->charges = 1;
  cw_action magic = {0};
  magic.kind = CW_ACTION_RULES_MAGIC;
  magic.actor_id = 5001;
  magic.target_actor_id = 5001;
  magic.item_id = 2006;
  assert(cw_world_apply(&world, &magic, 421, &events) == CW_ERR_RULE);
  assert(content->charges == 1);
  assert(cw_world_set_item_zone(&world, 2006, CW_CARD_ZONE_SPELL_DECK, 0) == CW_OK);
  assert(cw_world_set_item_recovery_profile(
      &world,
      2006,
      1,
      CW_ITEM_RECOVERY_REST,
      CW_CARD_ZONE_SPELL_DECK) == CW_OK);
  assert(cw_world_apply(&world, &magic, 421, &events) == CW_OK);
  assert(events.count == 1 && events.events[0].type == CW_EVENT_SPELL_CAST);
  assert(content->charges == 0 && content->zone == CW_CARD_ZONE_EXHAUSTED);
  assert(cw_world_apply(&world, &magic, 421, &events) == CW_ERR_RULE);

  cw_action rest = {0};
  rest.kind = CW_ACTION_REST;
  rest.actor_id = 5001;
  rest.rest.requested_grade = CW_REST_GRADE_HEARTH;
  rest.rest.entitled_grade = CW_REST_GRADE_HEARTH;
  assert(cw_world_apply(&world, &rest, 421, &events) == CW_OK);
  assert(events.count == 1 && events.events[0].type == CW_EVENT_ITEM_REFRESHED);
  assert(events.events[0].item_id == content->id);
  assert(content->charges == 1 && content->zone == CW_CARD_ZONE_SPELL_DECK);
  assert(cw_world_apply(&world, &magic, 421, &events) == CW_OK);
  assert(events.count == 1 && events.events[0].type == CW_EVENT_SPELL_CAST);
  assert(content->charges == 0 && content->zone == CW_CARD_ZONE_EXHAUSTED);

  cw_item *stolen = test_find_item(&world, 2004);
  assert(stolen);
  stolen->holder_actor_id = 1001;
  stolen->location_id = 0;
  stolen->zone = CW_CARD_ZONE_CARRIED;
  cw_action theft = {0};
  theft.kind = CW_ACTION_THEFT;
  theft.actor_id = 5001;
  theft.target_actor_id = 1001;
  theft.item_id = 2004;
  theft.dc = 100;
  assert(cw_world_apply(&world, &theft, 422, &events) == CW_OK);
  assert(events.count == 1 && events.events[0].type == CW_EVENT_ITEM_THEFT_ATTEMPT);
  assert(events.events[0].success == 0);
  assert(stolen->holder_actor_id == 1001);
  theft.dc = 1;
  assert(cw_world_apply(&world, &theft, 422, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_THEFT_ATTEMPT);
  assert(events.events[1].type == CW_EVENT_ITEM_STOLEN);
  assert(stolen->holder_actor_id == 5001);
  assert(stolen->zone == CW_CARD_ZONE_CARRIED);
}

static void configure_exhausted_rest_card(
    cw_world *world,
    cw_id item_id,
    cw_id actor_id,
    uint8_t role,
    uint8_t recovery,
    uint8_t recovery_zone) {
  cw_item *item = test_find_item(world, item_id);
  assert(item);
  assert(cw_world_set_item_profile(
      world,
      item_id,
      1,
      CW_ITEM_SIZE_TINY,
      role,
      0) == CW_OK);
  item->holder_actor_id = actor_id;
  item->location_id = 0;
  item->container_item_id = 0;
  item->charges = 0;
  item->zone = CW_CARD_ZONE_EXHAUSTED;
  item->recovery_zone = CW_CARD_ZONE_NONE;
  assert(cw_world_set_item_recovery_profile(
      world,
      item_id,
      2,
      recovery,
      recovery_zone) == CW_OK);
}

static void setup_rest_matrix(cw_world *world, cw_event_buffer *events) {
  cw_world_init(world);
  assert(cw_seed_cosy_cottage(world, events) == CW_OK);
  configure_exhausted_rest_card(
      world, 2001, 1001, CW_ITEM_ROLE_SPELL, CW_ITEM_RECOVERY_REST, CW_CARD_ZONE_SPELL_DECK);
  configure_exhausted_rest_card(
      world, 2002, 1001, CW_ITEM_ROLE_SPELL, CW_ITEM_RECOVERY_REST, CW_CARD_ZONE_SPELL_DECK);
  configure_exhausted_rest_card(
      world, 2003, 1001, CW_ITEM_ROLE_SKILL_CHARM, CW_ITEM_RECOVERY_REST, CW_CARD_ZONE_EQUIPPED);
  configure_exhausted_rest_card(
      world, 2004, 1001, CW_ITEM_ROLE_RELIC, CW_ITEM_RECOVERY_REST, CW_CARD_ZONE_CARRIED);
  configure_exhausted_rest_card(
      world, 2005, 1001, CW_ITEM_ROLE_SPELL, CW_ITEM_RECOVERY_NONE, CW_CARD_ZONE_SPELL_DECK);
  cw_item *legacy_charm = test_find_item(world, 2003);
  assert(legacy_charm);
  legacy_charm->recovery_zone = CW_CARD_ZONE_NONE;
}

static cw_action rest_action(cw_id actor_id, uint8_t requested_grade, uint8_t entitled_grade) {
  cw_action action = {0};
  action.kind = CW_ACTION_REST;
  action.actor_id = actor_id;
  action.rest.requested_grade = requested_grade;
  action.rest.entitled_grade = entitled_grade;
  return action;
}

static void test_rest_grade_refresh_matrix_and_atomic_validation(void) {
  cw_world world;
  cw_event_buffer events;
  setup_rest_matrix(&world, &events);

  cw_action camp = rest_action(1001, CW_REST_GRADE_CAMP, CW_REST_GRADE_HEARTH);
  assert(cw_world_apply(&world, &camp, 430, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_REFRESHED);
  assert(events.events[0].item_id == 2001);
  assert(test_find_item(&world, 2001)->charges == 2);
  assert(test_find_item(&world, 2001)->zone == CW_CARD_ZONE_SPELL_DECK);
  assert(test_find_item(&world, 2002)->charges == 0);
  assert(test_find_item(&world, 2003)->charges == 0);
  assert(test_find_item(&world, 2004)->charges == 0);
  assert(test_find_item(&world, 2005)->charges == 0);

  setup_rest_matrix(&world, &events);
  cw_action lodged = rest_action(1001, CW_REST_GRADE_LODGED, CW_REST_GRADE_LODGED);
  assert(cw_world_apply(&world, &lodged, 431, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].item_id == 2001);
  assert(events.events[1].item_id == 2002);
  assert(test_find_item(&world, 2001)->charges == 2);
  assert(test_find_item(&world, 2002)->charges == 2);
  assert(test_find_item(&world, 2003)->charges == 0);
  assert(test_find_item(&world, 2004)->charges == 0);
  assert(test_find_item(&world, 2005)->charges == 0);

  setup_rest_matrix(&world, &events);
  cw_action hearth = rest_action(1001, CW_REST_GRADE_HEARTH, CW_REST_GRADE_HEARTH);
  assert(cw_world_apply(&world, &hearth, 432, &events) == CW_OK);
  assert(events.count == 4);
  for (size_t i = 0; i < events.count; ++i) {
    assert(events.events[i].type == CW_EVENT_ITEM_REFRESHED);
    assert(events.events[i].item_id == 2001 + i);
  }
  assert(test_find_item(&world, 2001)->zone == CW_CARD_ZONE_SPELL_DECK);
  assert(test_find_item(&world, 2002)->zone == CW_CARD_ZONE_SPELL_DECK);
  assert(test_find_item(&world, 2003)->zone == CW_CARD_ZONE_EQUIPPED);
  assert(test_find_item(&world, 2003)->recovery_zone == CW_CARD_ZONE_EQUIPPED);
  assert(test_find_item(&world, 2004)->zone == CW_CARD_ZONE_CARRIED);
  assert(test_find_item(&world, 2005)->charges == 0);
  assert(test_find_item(&world, 2005)->zone == CW_CARD_ZONE_EXHAUSTED);

  setup_rest_matrix(&world, &events);
  cw_action overclaim = rest_action(1001, CW_REST_GRADE_HEARTH, CW_REST_GRADE_CAMP);
  assert(cw_world_apply(&world, &overclaim, 433, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(events.events[0].reason == 22);
  for (cw_id item_id = 2001; item_id <= 2005; ++item_id) {
    assert(test_find_item(&world, item_id)->charges == 0);
    assert(test_find_item(&world, item_id)->zone == CW_CARD_ZONE_EXHAUSTED);
  }
  overclaim.rest.requested_grade = CW_REST_GRADE_NONE;
  overclaim.rest.entitled_grade = CW_REST_GRADE_HEARTH;
  assert(cw_world_apply(&world, &overclaim, 434, &events) == CW_ERR_RULE);
  assert(events.count == 1 && events.events[0].reason == 22);

  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  cw_action empty = rest_action(1001, CW_REST_GRADE_HEARTH, CW_REST_GRADE_HEARTH);
  assert(cw_world_apply(&world, &empty, 435, &events) == CW_OK);
  assert(events.count == 0);
}

static void test_rest_event_capacity_preflight_is_atomic(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  world.item_count = CW_MAX_EVENTS + 1;
  for (size_t i = 0; i < world.item_count; ++i) {
    cw_item *item = &world.items[i];
    memset(item, 0, sizeof(*item));
    item->id = 5000 + i;
    item->holder_actor_id = 1001;
    item->role = CW_ITEM_ROLE_SPELL;
    item->zone = CW_CARD_ZONE_EXHAUSTED;
    item->max_charges = 1;
    item->recovery = CW_ITEM_RECOVERY_REST;
    item->recovery_zone = CW_CARD_ZONE_SPELL_DECK;
  }
  cw_action hearth = rest_action(1001, CW_REST_GRADE_HEARTH, CW_REST_GRADE_HEARTH);
  assert(cw_world_apply(&world, &hearth, 436, &events) == CW_ERR_FULL);
  assert(events.count == 0);
  for (size_t i = 0; i < world.item_count; ++i) {
    assert(world.items[i].charges == 0);
    assert(world.items[i].zone == CW_CARD_ZONE_EXHAUSTED);
  }
}

static void test_give_items_and_evolution(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 42, &events) == CW_OK);

  cw_action move = {0};
  move.kind = CW_ACTION_MOVE;
  move.actor_id = 5001;
  move.destination_location_id = 2;
  assert(cw_world_apply(&world, &move, 43, &events) == CW_OK);

  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 5001;
  pickup.item_id = 2002;
  assert(cw_world_apply(&world, &pickup, 44, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);

  move.destination_location_id = 1;
  assert(cw_world_apply(&world, &move, 45, &events) == CW_OK);

  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 5001;
  give.target_actor_id = 1002;
  give.item_id = 2002;
  assert(cw_world_apply(&world, &give, 46, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(events.events[1].type == CW_EVENT_AVATAR_EVOLVED);
  assert(events.events[1].target_actor_id == 1002);
  assert(events.events[1].total == 2);
  assert(world.actors[1].stats.level == 2);
  assert(test_find_item(&world, 2002)->holder_actor_id == 1002);
  assert(test_find_item(&world, 2003)->holder_actor_id == 0);
  assert(test_find_item(&world, 2003)->location_id == 3);
}

static void test_maximum_evolution_burst_fits_event_buffer(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  assert(CW_MAX_EVENTS >= CW_MAX_EVOLUTION_TRACKS + 2u);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 47, &events) == CW_OK);

  cw_item *shared_requirement = test_find_item(&world, 2005);
  cw_item *gift = test_find_item(&world, 2001);
  assert(shared_requirement);
  assert(gift);
  shared_requirement->holder_actor_id = 0;
  shared_requirement->location_id = 1;
  gift->holder_actor_id = 5001;
  gift->location_id = 0;

  const cw_evolution_requirement requirement = {
    2005, CW_PLACEMENT_LOCATION_FLOOR, {0}, 1
  };
  for (size_t i = 0; i < CW_MAX_EVOLUTION_TRACKS; ++i) {
    cw_id actor_id = i < 3 ? (cw_id)(1001 + i) : (cw_id)(10000 + i);
    if (i >= 3) {
      assert(world.actor_count < CW_MAX_ACTORS);
      cw_actor *actor = &world.actors[world.actor_count++];
      memset(actor, 0, sizeof(*actor));
      actor->id = actor_id;
      actor->kind = CW_ACTOR_NPC;
      actor->status = CW_ACTOR_ACTIVE;
      actor->location_id = 1;
      actor->stats.level = 1;
      actor->stats.hp_base = 8;
    }
    assert(cw_world_set_evolution_track(&world, actor_id, &requirement, 1) == CW_OK);
  }
  assert(world.evolution_track_count == CW_MAX_EVOLUTION_TRACKS);

  uint64_t first_event_seq = world.next_event_seq;
  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 5001;
  give.target_actor_id = 10003;
  give.item_id = 2001;
  assert(cw_world_apply(&world, &give, 48, &events) == CW_OK);
  assert(events.count == CW_MAX_EVOLUTION_TRACKS + 1u);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  for (size_t i = 1; i < events.count; ++i) {
    assert(events.events[i].type == CW_EVENT_AVATAR_EVOLVED);
    assert(events.events[i].seq == first_event_seq + i);
  }
  assert(world.next_event_seq == first_event_seq + events.count);
}

static void test_npc_trade_items(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_item *dewbright = test_find_item(&world, 2002);
  cw_item *moonlit = test_find_item(&world, 2003);
  cw_item *story = test_find_item(&world, 2005);
  assert(dewbright);
  assert(moonlit);
  assert(story);
  dewbright->holder_actor_id = 1001;
  dewbright->location_id = 0;
  dewbright->held_since_tick = 10;
  moonlit->holder_actor_id = 1002;
  moonlit->location_id = 0;
  moonlit->held_since_tick = 9;
  story->holder_actor_id = 1002;
  story->location_id = 0;
  story->held_since_tick = 11;
  moonlit->holder_actor_id = 0;
  moonlit->location_id = 3;
  moonlit->held_since_tick = 0;

  cw_action_offers offers = {0};
  assert(cw_get_action_offers(&world, 1001, &offers) == CW_OK);
  assert(offers.option_flags & CW_OFFER_TRADE_ITEM);

  cw_action trade = {0};
  trade.kind = CW_ACTION_TRADE_ITEM;
  trade.actor_id = 1001;
  trade.target_actor_id = 1002;
  trade.item_id = 2002;
  trade.target_item_id = 2005;
  assert(cw_world_apply(&world, &trade, 53, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_TRADED);
  assert(events.events[0].actor_id == 1001);
  assert(events.events[0].target_actor_id == 1002);
  assert(events.events[0].item_id == 2002);
  assert(events.events[0].target_item_id == 2005);
  assert(events.events[1].type == CW_EVENT_AVATAR_EVOLVED);
  assert(events.events[1].actor_id == 1001);
  assert(events.events[1].target_actor_id == 1002);
  assert(events.events[1].item_id == 2002);
  assert(events.events[1].total == 2);
  assert(dewbright->holder_actor_id == 1002);
  assert(moonlit->holder_actor_id == 0);
  assert(moonlit->location_id == 3);
  assert(story->holder_actor_id == 1001);
  assert(world.actors[1].stats.level == 2);
}

static void test_npc_give_items(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_item *dewbright = test_find_item(&world, 2002);
  cw_item *moonlit = test_find_item(&world, 2003);
  assert(dewbright);
  assert(moonlit);
  dewbright->holder_actor_id = 1001;
  dewbright->location_id = 0;
  dewbright->held_since_tick = 10;
  moonlit->holder_actor_id = 0;
  moonlit->location_id = 3;
  moonlit->held_since_tick = 0;

  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 1001;
  give.target_actor_id = 1002;
  give.item_id = 2002;
  assert(cw_world_apply(&world, &give, 54, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(events.events[0].actor_id == 1001);
  assert(events.events[0].target_actor_id == 1002);
  assert(events.events[0].item_id == 2002);
  assert(events.events[1].type == CW_EVENT_AVATAR_EVOLVED);
  assert(events.events[1].target_actor_id == 1002);
  assert(events.events[1].item_id == 2002);
  assert(dewbright->holder_actor_id == 1002);
  assert(moonlit->holder_actor_id == 0);
  assert(moonlit->location_id == 3);
  assert(world.actors[1].stats.level == 2);
}

static void test_actor_affordances_do_not_depend_on_controller_provenance(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.location_id = 1;
  create.actor_id = 5001;
  assert(cw_world_apply(&world, &create, 801, &events) == CW_OK);
  create.actor_id = 5002;
  assert(cw_world_apply(&world, &create, 802, &events) == CW_OK);

  cw_item *tonic = test_find_item(&world, 2001);
  cw_item *button = test_find_item(&world, 2005);
  assert(tonic);
  assert(button);
  tonic->holder_actor_id = 5001;
  tonic->location_id = 0;
  button->holder_actor_id = 5002;
  button->location_id = 0;

  cw_action_offers offers = {0};
  assert(cw_get_action_offers(&world, 5001, &offers) == CW_OK);
  assert(offers.option_flags & CW_OFFER_GIVE_ITEM);
  assert(offers.option_flags & CW_OFFER_TRADE_ITEM);

  cw_action trade = {0};
  trade.kind = CW_ACTION_TRADE_ITEM;
  trade.actor_id = 5001;
  trade.target_actor_id = 5002;
  trade.item_id = tonic->id;
  trade.target_item_id = button->id;
  assert(cw_world_apply(&world, &trade, 803, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_ITEM_TRADED);
  assert(tonic->holder_actor_id == 5002);
  assert(button->holder_actor_id == 5001);

  const cw_evolution_requirement human_requirement = {
    2005, CW_PLACEMENT_ACTOR_HAND, {0}, 5002
  };
  assert(cw_world_set_evolution_track(&world, 5002, &human_requirement, 1) == CW_OK);
  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 5001;
  give.target_actor_id = 5002;
  give.item_id = button->id;
  assert(cw_world_apply(&world, &give, 804, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(events.events[1].type == CW_EVENT_AVATAR_EVOLVED);
  assert(events.events[1].target_actor_id == 5002);

  cw_actor *thief = 0;
  for (size_t i = 0; i < world.actor_count; ++i) {
    if (world.actors[i].id == 5001) thief = &world.actors[i];
  }
  assert(thief);
  thief->stats.dexterity = 20;
  cw_action theft = {0};
  theft.kind = CW_ACTION_THEFT;
  theft.actor_id = 5001;
  theft.target_actor_id = 5002;
  theft.item_id = button->id;
  theft.dc = 1;
  assert(cw_world_apply(&world, &theft, 805, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_THEFT_ATTEMPT);
  assert(events.events[1].type == CW_EVENT_ITEM_STOLEN);
  assert(button->holder_actor_id == 5001);

  cw_actor *combat_target = 0;
  for (size_t i = 0; i < world.actor_count; ++i) {
    if (world.actors[i].id == 5002) combat_target = &world.actors[i];
  }
  assert(combat_target);
  thief->location_id = 3;
  combat_target->location_id = 3;
  cw_action combat = {0};
  combat.kind = CW_ACTION_COMBAT_START;
  combat.actor_id = 5001;
  combat.target_actor_id = 5002;
  combat.content_id = 9801;
  assert(cw_world_apply(&world, &combat, 806, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_COMBAT_ENCOUNTER_STARTED);
  assert(world.combat_encounters[0].participant_count == 2);
}

static void test_give_can_exchange_an_item_to_make_weight_capacity(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 61, &events) == CW_OK);

  cw_item *offered = test_find_item(&world, 2002);
  cw_item *returned = test_find_item(&world, 2005);
  assert(offered);
  assert(returned);
  offered->holder_actor_id = 5001;
  offered->location_id = 0;
  returned->holder_actor_id = 1001;
  returned->location_id = 0;
  world.actors[0].stats.strength = 1;
  assert(cw_world_set_item_profile(&world, 2002, 100, CW_ITEM_SIZE_SMALL, CW_ITEM_ROLE_GENERIC, 0) == CW_OK);
  assert(cw_world_set_item_profile(&world, 2005, 100, CW_ITEM_SIZE_SMALL, CW_ITEM_ROLE_GENERIC, 0) == CW_OK);

  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 5001;
  give.target_actor_id = 1001;
  give.item_id = 2002;
  assert(cw_world_apply(&world, &give, 62, &events) == CW_ERR_RULE);

  give.target_item_id = 2005;
  assert(cw_world_apply(&world, &give, 63, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(events.events[0].item_id == 2002);
  assert(events.events[0].target_item_id == 2005);
  assert(offered->holder_actor_id == 1001);
  assert(returned->holder_actor_id == 5001);
}

static void test_npc_pickup_can_evolve_self(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_item *dewbright = test_find_item(&world, 2002);
  cw_item *moonlit = test_find_item(&world, 2003);
  assert(dewbright);
  assert(moonlit);
  world.actors[1].location_id = 2;
  dewbright->holder_actor_id = 0;
  dewbright->location_id = 2;
  dewbright->held_since_tick = 0;
  moonlit->holder_actor_id = 0;
  moonlit->location_id = 3;
  moonlit->held_since_tick = 0;

  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 1002;
  pickup.item_id = 2002;
  assert(cw_world_apply(&world, &pickup, 54, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);
  assert(events.events[0].actor_id == 1002);
  assert(events.events[0].item_id == 2002);
  assert(events.events[1].type == CW_EVENT_AVATAR_EVOLVED);
  assert(events.events[1].actor_id == 1002);
  assert(events.events[1].target_actor_id == 1002);
  assert(events.events[1].item_id == 2002);
  assert(events.events[1].total == 2);
  assert(dewbright->holder_actor_id == 1002);
  assert(moonlit->location_id == 3);
  assert(world.actors[1].stats.level == 2);
}

static void test_inventory_uses_weight_and_container_capacity(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 60, &events) == CW_OK);

  cw_item *held_a = test_find_item(&world, 2001);
  cw_item *new_item = test_find_item(&world, 2005);
  cw_item *bag = test_find_item(&world, 2006);
  assert(held_a && new_item && bag);

  cw_actor *actor = &world.actors[world.actor_count - 1];
  assert(actor->id == 5001);
  actor->stats.strength = 1;
  assert(cw_world_set_item_profile(&world, 2001, 90, CW_ITEM_SIZE_SMALL, CW_ITEM_ROLE_CONSUMABLE, 0) == CW_OK);
  assert(cw_world_set_item_profile(&world, 2005, 40, CW_ITEM_SIZE_SMALL, CW_ITEM_ROLE_GENERIC, 0) == CW_OK);
  assert(cw_world_set_item_profile(&world, 2006, 20, CW_ITEM_SIZE_MEDIUM, CW_ITEM_ROLE_CONTAINER, 100) == CW_OK);

  held_a->holder_actor_id = 5001;
  held_a->location_id = 0;
  held_a->held_since_tick = 10;
  new_item->holder_actor_id = 0;
  new_item->location_id = 1;
  new_item->held_since_tick = 0;
  bag->holder_actor_id = 0;
  bag->location_id = 1;
  bag->held_since_tick = 0;

  world.tick = 100;
  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 5001;
  pickup.item_id = 2005;
  assert(cw_world_apply(&world, &pickup, 61, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);
  assert(events.events[0].item_id == 2005);
  assert(held_a->holder_actor_id == 5001);
  assert(held_a->location_id == 0);
  assert(new_item->holder_actor_id == 5001);
  assert(new_item->location_id == 0);
  assert(new_item->held_since_tick > held_a->held_since_tick);

  pickup.item_id = 2006;
  assert(cw_world_apply(&world, &pickup, 62, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);
  assert(bag->holder_actor_id == 5001);

  assert(cw_world_set_item_profile(&world, 2002, 100, CW_ITEM_SIZE_SMALL, CW_ITEM_ROLE_GENERIC, 0) == CW_OK);
  cw_item *too_heavy = test_find_item(&world, 2002);
  too_heavy->holder_actor_id = 0;
  too_heavy->location_id = 1;
  cw_action_offers offers = {0};
  assert(cw_get_action_offers(&world, 5001, &offers) == CW_OK);
  assert((offers.option_flags & CW_OFFER_PICK_UP) == 0);
  pickup.item_id = 2002;
  assert(cw_world_apply(&world, &pickup, 63, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(events.events[0].reason == 21);
  assert(too_heavy->holder_actor_id == 0);

  assert(cw_world_set_item_zone(&world, 2006, CW_CARD_ZONE_EQUIPPED, 0) == CW_OK);
  assert(bag->zone == CW_CARD_ZONE_EQUIPPED);
  assert(cw_get_action_offers(&world, 5001, &offers) == CW_OK);
  assert((offers.option_flags & CW_OFFER_PICK_UP) != 0);
  assert(cw_world_apply(&world, &pickup, 64, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_PICKED_UP);
  assert(events.events[0].item_id == 2002);
  assert(held_a->holder_actor_id == 5001);
  assert(too_heavy->holder_actor_id == 5001);

  cw_action drop = {0};
  drop.kind = CW_ACTION_DROP_ITEM;
  drop.actor_id = 5001;
  drop.item_id = 2005;
  assert(cw_world_apply(&world, &drop, 65, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_DROPPED);
  assert(held_a->holder_actor_id == 5001 && held_a->location_id == 0);
  assert(new_item->holder_actor_id == 0 && new_item->location_id == 1);
}

static void test_search_and_craft_create_without_consuming_inputs(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 70, &events) == CW_OK);

  cw_action search = {0};
  search.kind = CW_ACTION_SEARCH;
  search.actor_id = 5001;
  search.location_id = 1;
  search.content_id = 9001;
  search.item_id = 2005;
  assert(cw_world_apply(&world, &search, 71, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_FOUND);
  assert(events.events[0].item_id == 2005);
  assert(test_find_item(&world, 2001)->location_id == 1);
  assert(test_find_item(&world, 2005)->location_id == 1);

  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 5001;
  pickup.item_id = 2001;
  assert(cw_world_apply(&world, &pickup, 72, &events) == CW_OK);

  assert(cw_world_apply(&world, &search, 73, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(test_find_item(&world, 2005)->location_id == 1);

  cw_action care = {0};
  care.kind = CW_ACTION_CRAFT;
  care.actor_id = 5001;
  care.content_id = 3002;
  care.item_id = 2001;
  care.target_item_id = 2005;
  assert(cw_world_apply(&world, &care, 74, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(events.events[0].actor_id == 5001);
  assert(events.events[0].content_id == 3002);
  assert(events.events[0].item_id == 2001);
  assert(events.events[0].target_item_id == 2005);
  assert(cw_world_apply(&world, &care, 75, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(test_find_item(&world, 2001)->holder_actor_id == 5001);
  assert(test_find_item(&world, 2005)->location_id == 1);

  cw_action craft = care;
  craft.content_id = 3001;
  craft.output_item_id = 2011;
  craft.output_target_kind = CW_PLACEMENT_LOCATION_FLOOR;
  craft.output_target_id = 11;
  craft.output_item_kind = CW_ITEM_KEEPSAKE;
  craft.output_item_charges = 1;
  assert(cw_world_apply(&world, &craft, 76, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(events.events[0].item_id == 2001);
  assert(events.events[0].target_item_id == 2005);
  assert(events.events[1].type == CW_EVENT_ITEM_CREATED);
  assert(events.events[1].item_id == 2011);
  assert(test_find_item(&world, 2001)->holder_actor_id == 5001);
  assert(test_find_item(&world, 2005)->location_id == 1);
  assert(test_find_item(&world, 2011)->location_id == 11);

  assert(cw_world_apply(&world, &craft, 77, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_item *ore = test_find_item(&world, 2002);
  assert(ore);
  ore->holder_actor_id = 5001;
  ore->location_id = 0;
  ore->zone = CW_CARD_ZONE_CARRIED;
  cw_action refine = {0};
  refine.kind = CW_ACTION_CRAFT;
  refine.actor_id = 5001;
  refine.content_id = 3101;
  refine.item_id = 2002;
  refine.item_disposition = CW_CRAFT_INPUT_TRANSFORMED;
  refine.output_item_id = 9201;
  refine.output_target_kind = CW_PLACEMENT_LOCATION_FLOOR;
  refine.output_target_id = 1;
  refine.output_item_kind = CW_ITEM_KEEPSAKE;
  refine.output_item_charges = 1;
  refine.output_item_weight_tenths = 14;
  refine.output_item_size_class = CW_ITEM_SIZE_SMALL;
  refine.output_item_role = CW_ITEM_ROLE_GENERIC;
  const size_t before_refine_count = world.item_count;
  assert(cw_world_apply(&world, &refine, 78, &events) == CW_OK);
  assert(events.count == 3);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(events.events[1].type == CW_EVENT_ITEM_TRANSFORMED);
  assert(events.events[2].type == CW_EVENT_ITEM_CREATED);
  assert(events.events[1].item_id == 2002);
  assert(events.events[1].target_item_id == 9201);
  assert(test_find_item(&world, 2002) == 0);
  assert(test_find_item(&world, 9201)->location_id == 1);
  assert(test_find_item(&world, 9201)->weight_tenths == 14);
  assert(world.item_count == before_refine_count);
  assert(cw_world_apply(&world, &refine, 79, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(world.item_count == before_refine_count);

  cw_action provision = {0};
  provision.kind = CW_ACTION_CRAFT;
  provision.actor_id = 5001;
  provision.content_id = 3105;
  provision.output_item_id = 9301;
  provision.output_target_kind = CW_PLACEMENT_ACTOR_HAND;
  provision.output_target_id = 5001;
  provision.output_item_kind = CW_ITEM_POTION;
  provision.output_item_charges = 1;
  provision.output_item_weight_tenths = 5;
  provision.output_item_size_class = CW_ITEM_SIZE_SMALL;
  provision.output_item_role = CW_ITEM_ROLE_CONSUMABLE;
  cw_action undeclared_provision = provision;
  undeclared_provision.content_id = 9999;
  assert(cw_world_apply(&world, &undeclared_provision, 80, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(cw_world_apply(&world, &provision, 80, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(events.events[0].item_id == 0);
  assert(events.events[1].type == CW_EVENT_ITEM_CREATED);
  assert(events.events[1].item_id == 9301);
  assert(test_find_item(&world, 9301)->holder_actor_id == 5001);
  assert(test_find_item(&world, 9301)->charges == 1);
  assert(cw_world_apply(&world, &provision, 81, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_action install = refine;
  install.content_id = 3103;
  install.item_id = 9201;
  install.output_item_id = 9202;
  install.output_target_kind = CW_PLACEMENT_LOCATION_FIXTURE;
  assert(cw_world_apply(&world, &install, 82, &events) == CW_OK);
  assert(events.count == 3);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(events.events[1].type == CW_EVENT_ITEM_TRANSFORMED);
  assert(events.events[2].type == CW_EVENT_ITEM_CREATED);
  assert(test_find_item(&world, 9201) == 0);
  assert(test_find_item(&world, 9202)->location_id == 1);
  assert(test_find_item(&world, 9202)->zone == CW_CARD_ZONE_INSTALLED);

  cw_action pickup_fixture = {0};
  pickup_fixture.kind = CW_ACTION_PICK_UP_ITEM;
  pickup_fixture.actor_id = 5001;
  pickup_fixture.item_id = 9202;
  assert(cw_world_apply(&world, &pickup_fixture, 83, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(test_find_item(&world, 9202)->zone == CW_CARD_ZONE_INSTALLED);
}

static void test_authoritative_world_effect_actions(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_exit *exit = test_find_exit(&world, 1, 2);
  assert(exit);
  exit->flags |= CW_EXIT_LOCKED;

  cw_action unlock = {0};
  unlock.kind = CW_ACTION_UNLOCK_EXIT;
  unlock.actor_id = 1001;
  unlock.location_id = 1;
  unlock.destination_location_id = 2;
  assert(cw_world_apply(&world, &unlock, 80, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_EXIT_UNLOCKED);
  assert(events.events[0].location_id == 1);
  assert(events.events[0].destination_location_id == 2);
  assert((exit->flags & CW_EXIT_LOCKED) == 0);
  assert(cw_world_apply(&world, &unlock, 81, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_action reveal = {0};
  reveal.kind = CW_ACTION_REVEAL_ITEM;
  reveal.actor_id = 1001;
  reveal.location_id = 1;
  reveal.item_id = 2005;
  assert(cw_world_apply(&world, &reveal, 82, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].reason == 21);
  assert(test_find_item(&world, 2005)->location_id == 0);

  test_find_item(&world, 2001)->location_id = 0;
  assert(cw_world_apply(&world, &reveal, 83, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_REVEALED);
  assert(events.events[0].item_id == 2005);
  assert(test_find_item(&world, 2005)->location_id == 1);
  assert(cw_world_apply(&world, &reveal, 84, &events) == CW_ERR_RULE);
}

static cw_gate_decision bind_gate_action(
    const cw_world *world,
    cw_action *action,
    cw_id gate_id,
    cw_id method_id,
    uint8_t transition,
    cw_id claim_id) {
  cw_gate_decision decision = {0};
  assert(cw_gate_evaluate(
      world,
      gate_id,
      action->actor_id,
      action->threshold.facts,
      action->threshold.fact_count,
      method_id,
      &decision) == CW_OK);
  action->threshold.gate_id = gate_id;
  action->threshold.method_id = method_id;
  action->threshold.claim_id = claim_id;
  action->threshold.expected_gate_version = decision.gate_version;
  action->threshold.expected_access_revision = decision.access_revision;
  action->threshold.expected_evidence_digest = decision.evidence_digest;
  action->threshold.transition = transition;
  return decision;
}

static void test_kernel_gate_authority_stale_offers_and_claims(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 90, &events) == CW_OK);

  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 1001;
  pickup.item_id = 2001;
  assert(cw_world_apply(&world, &pickup, 91, &events) == CW_OK);

  cw_exit *historical_exit = test_find_exit(&world, 1, 2);
  assert(historical_exit);
  historical_exit->flags |= CW_EXIT_LOCKED;
  cw_gate holder_gate = {0};
  holder_gate.id = 7001;
  holder_gate.version = 1;
  holder_gate.descriptor_version = 1;
  holder_gate.target_kind = CW_GATE_TARGET_EXIT;
  holder_gate.scope = CW_GATE_SCOPE_HOLDER;
  holder_gate.state = CW_GATE_STATE_CLOSED;
  holder_gate.compatibility = CW_GATE_COMPAT_RECORDED_LOCK;
  holder_gate.from_location_id = 1;
  holder_gate.to_location_id = 2;
  cw_gate_method_definition holder_methods[1] = {0};
  holder_methods[0].id = 7101;
  holder_methods[0].predicate_count = 1;
  holder_methods[0].predicates[0].kind = CW_GATE_PREDICATE_HELD_ITEM;
  holder_methods[0].predicates[0].subject_id = 2001;
  assert(cw_world_set_gate(&world, &holder_gate, holder_methods, 1) == CW_OK);

  cw_action legacy_unlock = {0};
  legacy_unlock.kind = CW_ACTION_UNLOCK_EXIT;
  legacy_unlock.actor_id = 1001;
  legacy_unlock.location_id = 1;
  legacy_unlock.destination_location_id = 2;
  assert(cw_world_apply(&world, &legacy_unlock, 91, &events) == CW_ERR_RULE);
  assert(events.events[0].reason == CW_REASON_STALE_GATE_OFFER);
  assert(historical_exit->flags & CW_EXIT_LOCKED);

  cw_gate_decision holder_decision = {0};
  assert(cw_gate_evaluate(&world, 7001, 1001, 0, 0, 7101, &holder_decision) == CW_OK);
  assert(holder_decision.allowed);
  cw_gate_decision companion_decision = {0};
  assert(cw_gate_evaluate(&world, 7001, 5001, 0, 0, 7101, &companion_decision) == CW_OK);
  assert(!companion_decision.allowed);
  assert(companion_decision.reason == CW_REASON_GATE_CLOSED);

  cw_action holder_move = {0};
  holder_move.kind = CW_ACTION_MOVE;
  holder_move.actor_id = 1001;
  holder_move.destination_location_id = 2;
  bind_gate_action(&world, &holder_move, 7001, 7101, CW_GATE_TRANSITION_NONE, 0);
  assert(cw_world_apply(&world, &holder_move, 92, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ACTOR_MOVED);
  assert(events.events[0].gate_id == 7001);
  assert(historical_exit->flags & CW_EXIT_LOCKED);

  cw_action denied_move = {0};
  denied_move.kind = CW_ACTION_MOVE;
  denied_move.actor_id = 5001;
  denied_move.destination_location_id = 2;
  bind_gate_action(&world, &denied_move, 7001, 7101, CW_GATE_TRANSITION_NONE, 0);
  assert(cw_world_apply(&world, &denied_move, 93, &events) == CW_ERR_RULE);
  assert(events.events[0].reason == CW_REASON_GATE_CLOSED);

  cw_action return_move = {0};
  return_move.kind = CW_ACTION_MOVE;
  return_move.actor_id = 1001;
  return_move.destination_location_id = 1;
  assert(cw_world_apply(&world, &return_move, 94, &events) == CW_OK);

  cw_action stale_holder_move = {0};
  stale_holder_move.kind = CW_ACTION_MOVE;
  stale_holder_move.actor_id = 1001;
  stale_holder_move.destination_location_id = 2;
  bind_gate_action(
      &world,
      &stale_holder_move,
      7001,
      7101,
      CW_GATE_TRANSITION_NONE,
      0);

  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 1001;
  give.target_actor_id = 5001;
  give.item_id = 2001;
  assert(cw_world_apply(&world, &give, 95, &events) == CW_OK);
  assert(cw_world_apply(&world, &stale_holder_move, 96, &events) == CW_ERR_RULE);
  assert(events.events[0].reason == CW_REASON_STALE_GATE_OFFER);

  cw_gate installed_gate = {0};
  installed_gate.id = 7002;
  installed_gate.version = 1;
  installed_gate.descriptor_version = 1;
  installed_gate.target_kind = CW_GATE_TARGET_EXIT;
  installed_gate.scope = CW_GATE_SCOPE_WORLD;
  installed_gate.state = CW_GATE_STATE_CLOSED;
  installed_gate.from_location_id = 1;
  installed_gate.to_location_id = 11;
  cw_gate_method_definition installed_methods[2] = {0};
  installed_methods[0].id = 7201;
  installed_methods[0].predicate_count = 1;
  installed_methods[0].predicates[0].kind = CW_GATE_PREDICATE_HELD_ITEM;
  installed_methods[0].predicates[0].subject_id = 2001;
  installed_methods[1].id = 7202;
  installed_methods[1].predicate_count = 1;
  installed_methods[1].predicates[0].kind = CW_GATE_PREDICATE_INSTALLED_ITEM;
  installed_methods[1].predicates[0].subject_id = 2001;
  installed_methods[1].predicates[0].target_id = 1;
  assert(cw_world_set_gate(&world, &installed_gate, installed_methods, 2) == CW_OK);

  cw_action install = {0};
  install.kind = CW_ACTION_GATE_TRANSITION;
  install.actor_id = 5001;
  install.item_id = 2001;
  bind_gate_action(
      &world,
      &install,
      7002,
      7201,
      CW_GATE_TRANSITION_INSTALL,
      7301);
  assert(cw_world_apply(&world, &install, 97, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_GATE_TRANSITION_APPLIED);
  assert(events.events[1].type == CW_EVENT_ITEM_INSTALLED);
  assert(test_find_item(&world, 2001)->zone == CW_CARD_ZONE_INSTALLED);

  cw_action installed_move = {0};
  installed_move.kind = CW_ACTION_MOVE;
  installed_move.actor_id = 1001;
  installed_move.destination_location_id = 11;
  bind_gate_action(
      &world,
      &installed_move,
      7002,
      7202,
      CW_GATE_TRANSITION_NONE,
      0);

  cw_action remove = {0};
  remove.kind = CW_ACTION_GATE_TRANSITION;
  remove.actor_id = 5001;
  remove.item_id = 2001;
  bind_gate_action(
      &world,
      &remove,
      7002,
      7202,
      CW_GATE_TRANSITION_REMOVE,
      7302);
  assert(cw_world_apply(&world, &remove, 98, &events) == CW_OK);
  assert(test_find_actor(&world, 1001)->location_id == 1);
  assert(test_find_item(&world, 2001)->holder_actor_id == 5001);
  assert(cw_world_apply(&world, &installed_move, 99, &events) == CW_ERR_RULE);
  assert(events.events[0].reason == CW_REASON_STALE_GATE_OFFER);
  bind_gate_action(
      &world,
      &installed_move,
      7002,
      7202,
      CW_GATE_TRANSITION_NONE,
      0);
  assert(cw_world_apply(&world, &installed_move, 100, &events) == CW_ERR_RULE);
  assert(events.events[0].reason == CW_REASON_GATE_CLOSED);

  cw_action gate_state = {0};
  gate_state.kind = CW_ACTION_GATE_TRANSITION;
  gate_state.actor_id = 5001;
  bind_gate_action(
      &world,
      &gate_state,
      7002,
      7201,
      CW_GATE_TRANSITION_OPEN,
      7401);
  assert(cw_world_apply(&world, &gate_state, 100, &events) == CW_OK);
  assert(test_find_gate(&world, 7002)->state == CW_GATE_STATE_OPEN);
  bind_gate_action(
      &world,
      &gate_state,
      7002,
      0,
      CW_GATE_TRANSITION_CLOSE,
      7402);
  assert(cw_world_apply(&world, &gate_state, 100, &events) == CW_OK);
  assert(test_find_gate(&world, 7002)->state == CW_GATE_STATE_CLOSED);
  bind_gate_action(
      &world,
      &gate_state,
      7002,
      7201,
      CW_GATE_TRANSITION_OPEN,
      7403);
  assert(cw_world_apply(&world, &gate_state, 100, &events) == CW_OK);
  bind_gate_action(
      &world,
      &gate_state,
      7002,
      0,
      CW_GATE_TRANSITION_RELOCK,
      7404);
  assert(cw_world_apply(&world, &gate_state, 100, &events) == CW_OK);
  assert(test_find_gate(&world, 7002)->state == CW_GATE_STATE_CLOSED);
  bind_gate_action(
      &world,
      &gate_state,
      7002,
      7201,
      CW_GATE_TRANSITION_BREAK,
      7405);
  assert(cw_world_apply(&world, &gate_state, 100, &events) == CW_OK);
  assert(test_find_gate(&world, 7002)->state == CW_GATE_STATE_BROKEN);
  bind_gate_action(
      &world,
      &gate_state,
      7002,
      0,
      CW_GATE_TRANSITION_CLOSE,
      7406);
  assert(cw_world_apply(&world, &gate_state, 100, &events) == CW_OK);

  cw_item *inert_item = test_find_item(&world, 2002);
  assert(inert_item);
  inert_item->holder_actor_id = 5001;
  inert_item->location_id = 0;
  inert_item->zone = CW_CARD_ZONE_CARRIED;
  cw_action render_inert = {0};
  render_inert.kind = CW_ACTION_GATE_TRANSITION;
  render_inert.actor_id = 5001;
  render_inert.item_id = 2002;
  bind_gate_action(
      &world,
      &render_inert,
      7002,
      7201,
      CW_GATE_TRANSITION_RENDER_INERT,
      7501);
  assert(cw_world_apply(&world, &render_inert, 100, &events) == CW_OK);
  assert(events.events[1].type == CW_EVENT_ITEM_RENDERED_INERT);
  assert(inert_item->reserved & CW_ITEM_FLAG_INERT);

  cw_action exhaust = {0};
  exhaust.kind = CW_ACTION_GATE_TRANSITION;
  exhaust.actor_id = 5001;
  exhaust.item_id = 2001;
  bind_gate_action(
      &world,
      &exhaust,
      7002,
      7201,
      CW_GATE_TRANSITION_EXHAUST,
      7303);
  assert(cw_world_apply(&world, &exhaust, 101, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[1].type == CW_EVENT_ITEM_EXHAUSTED);
  assert(test_find_item(&world, 2001)->charges == 0);
  uint64_t revision_after_exhaust = world.access_revision;
  uint64_t sequence_after_exhaust = world.next_event_seq;
  uint64_t tick_after_exhaust = world.tick;
  assert(cw_world_apply_with_tick(&world, &exhaust, 102, 1, &events) == CW_OK);
  assert(events.count == 0);
  assert(world.access_revision == revision_after_exhaust);
  assert(world.next_event_seq == sequence_after_exhaust);
  assert(world.tick == tick_after_exhaust);
  assert(world.gate_claim_count == 10);
}

static uint8_t test_combat_side(const cw_combat_encounter *encounter, cw_id actor_id) {
  for (size_t i = 0; i < encounter->participant_count; ++i) {
    if (encounter->participants[i].actor_id == actor_id) {
      return encounter->participants[i].side;
    }
  }
  return 0;
}

static void test_combat_join_preserves_legacy_sides_and_accepts_explicit_sides(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.location_id = 3;
  create.actor_id = 5001;
  assert(cw_world_apply(&world, &create, 901, &events) == CW_OK);
  create.actor_id = 5002;
  assert(cw_world_apply(&world, &create, 902, &events) == CW_OK);

  cw_actor *initiator = test_find_actor(&world, 5001);
  cw_actor *legacy_human = test_find_actor(&world, 5002);
  cw_actor *legacy_npc = test_find_actor(&world, 1001);
  cw_actor *explicit_npc = test_find_actor(&world, 1002);
  cw_actor *target = test_find_actor(&world, 1004);
  assert(initiator && legacy_human && legacy_npc && explicit_npc && target);
  legacy_npc->location_id = 3;
  explicit_npc->location_id = 3;

  cw_action start = {0};
  start.kind = CW_ACTION_COMBAT_START;
  start.actor_id = initiator->id;
  start.target_actor_id = target->id;
  start.content_id = 9901;
  assert(cw_world_apply(&world, &start, 903, &events) == CW_OK);

  cw_action join = {0};
  join.kind = CW_ACTION_COMBAT_JOIN;
  join.content_id = start.content_id;
  join.actor_id = legacy_human->id;
  assert(cw_world_apply(&world, &join, 904, &events) == CW_OK);
  join.actor_id = legacy_npc->id;
  assert(cw_world_apply(&world, &join, 905, &events) == CW_OK);
  join.actor_id = explicit_npc->id;
  join.modifier = 1;
  assert(cw_world_apply(&world, &join, 906, &events) == CW_OK);

  const cw_combat_encounter *encounter = &world.combat_encounters[0];
  assert(test_combat_side(encounter, legacy_human->id) == 1);
  assert(test_combat_side(encounter, legacy_npc->id) == 2);
  assert(test_combat_side(encounter, explicit_npc->id) == 1);
}

static void test_project_push_resolution_matrix_and_action_event(void) {
  const struct {
    uint8_t prepared;
    uint8_t evidence_count;
    uint8_t location_count;
    uint8_t expected;
  } cases[] = {
    {0, 0, 1, 2},
    {1, 0, 1, 3},
    {1, 1, 1, 4},
    {0, 1, 3, 2},
    {1, 1, 3, 4},
    {1, 3, 3, 5},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
    cw_project_push_input input = {
      .base_progress = 2,
      .prepared_bonus_progress = 1,
      .prepared = cases[i].prepared,
      .evidence_count = cases[i].evidence_count,
      .location_count = cases[i].location_count,
      .remaining_progress = 6,
    };
    uint8_t progress = 0;
    assert(cw_resolve_project_push(&input, &progress) == CW_OK);
    assert(progress == cases[i].expected);
  }

  cw_project_push_input near_complete = {
    .base_progress = 2,
    .prepared_bonus_progress = 1,
    .prepared = 1,
    .evidence_count = 3,
    .location_count = 3,
    .remaining_progress = 1,
  };
  uint8_t progress = 0;
  assert(cw_resolve_project_push(&near_complete, &progress) == CW_OK);
  assert(progress == 1);

  cw_project_push_input malformed = near_complete;
  malformed.evidence_count = 4;
  assert(cw_resolve_project_push(&malformed, &progress) == CW_ERR_RULE);
  malformed = near_complete;
  malformed.prepared = 2;
  assert(cw_resolve_project_push(&malformed, &progress) == CW_ERR_RULE);
  malformed = near_complete;
  malformed.remaining_progress = 0;
  assert(cw_resolve_project_push(&malformed, &progress) == CW_ERR_RULE);

  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);
  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  cw_action push = {0};
  push.kind = CW_ACTION_PROJECT_PUSH;
  push.actor_id = 1001;
  push.content_id = 411;
  push.project_push = (cw_project_push_input) {
    .base_progress = 2,
    .prepared_bonus_progress = 1,
    .prepared = 1,
    .evidence_count = 1,
    .location_count = 3,
    .remaining_progress = 6,
  };
  assert(cw_world_apply(&world, &push, 411, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_PROJECT_PUSH_RESOLVED);
  assert(events.events[0].actor_id == 1001);
  assert(events.events[0].total == 4);
  assert(strcmp(cw_event_type_name(events.events[0].type), "project.push.resolved") == 0);

  push.project_push.evidence_count = 4;
  assert(cw_world_apply(&world, &push, 412, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
}

static void apply_replay_sequence(cw_world *world, cw_event *events, size_t *event_count) {
  cw_event_buffer buffer;
  *event_count = 0;
  cw_world_init(world);
  assert(cw_seed_cosy_cottage(world, &buffer) == CW_OK);
  for (size_t i = 0; i < buffer.count; ++i) events[(*event_count)++] = buffer.events[i];

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(world, &create, 777, &buffer) == CW_OK);
  for (size_t i = 0; i < buffer.count; ++i) events[(*event_count)++] = buffer.events[i];

  cw_action check = {0};
  check.kind = CW_ACTION_ABILITY_CHECK;
  check.actor_id = 5001;
  check.ability = CW_ABILITY_CHARISMA;
  check.dc = 13;
  assert(cw_world_apply(world, &check, 778, &buffer) == CW_OK);
  for (size_t i = 0; i < buffer.count; ++i) events[(*event_count)++] = buffer.events[i];

  cw_action move = {0};
  move.kind = CW_ACTION_MOVE;
  move.actor_id = 5001;
  move.destination_location_id = 2;
  assert(cw_world_apply(world, &move, 779, &buffer) == CW_OK);
  for (size_t i = 0; i < buffer.count; ++i) events[(*event_count)++] = buffer.events[i];
}

static void test_deterministic_replay(void) {
  cw_world left;
  cw_world right;
  cw_event left_events[16];
  cw_event right_events[16];
  size_t left_count = 0;
  size_t right_count = 0;

  apply_replay_sequence(&left, left_events, &left_count);
  apply_replay_sequence(&right, right_events, &right_count);

  assert(left_count == right_count);
  for (size_t i = 0; i < left_count; ++i) {
    assert(memcmp(&left_events[i], &right_events[i], sizeof(cw_event)) == 0);
  }

  assert(left.actor_count == right.actor_count);
  assert(left.item_count == right.item_count);
  assert(left.location_count == right.location_count);
  assert(left.next_event_seq == right.next_event_seq);
  assert(memcmp(left.actors, right.actors, left.actor_count * sizeof(cw_actor)) == 0);
  assert(memcmp(left.items, right.items, left.item_count * sizeof(cw_item)) == 0);
  assert(memcmp(left.locations, right.locations, left.location_count * sizeof(cw_location)) == 0);
}

int main(void) {
  test_kernel_capacities_are_runtime_sized();
  test_seed_and_chat();
  test_movement_and_check();
  test_explicit_tick_control_and_rejected_action_rollback();
  test_d20_roll_modes_bloodied_and_nonlethal_knockout();
  test_items_and_combat_gate();
  test_rules_utilize_item_records_project_use_without_consuming();
  test_combat_v2_encounter_turns_dodge_targeting_and_escape();
  test_combat_abandon_closes_a_stuck_encounter();
  test_combat_v4_weapon_profile_and_legacy_replay();
  test_card_zones_spell_exhaustion_and_theft_atomicity();
  test_rest_grade_refresh_matrix_and_atomic_validation();
  test_rest_event_capacity_preflight_is_atomic();
  test_give_items_and_evolution();
  test_maximum_evolution_burst_fits_event_buffer();
  test_npc_trade_items();
  test_npc_give_items();
  test_actor_affordances_do_not_depend_on_controller_provenance();
  test_give_can_exchange_an_item_to_make_weight_capacity();
  test_npc_pickup_can_evolve_self();
  test_inventory_uses_weight_and_container_capacity();
  test_search_and_craft_create_without_consuming_inputs();
  test_authoritative_world_effect_actions();
  test_kernel_gate_authority_stale_offers_and_claims();
  test_combat_join_preserves_legacy_sides_and_accepts_explicit_sides();
  test_project_push_resolution_matrix_and_action_event();
  test_deterministic_replay();
  puts("cosy kernel tests passed");
  return 0;
}
