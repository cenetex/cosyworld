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

static void test_kernel_capacities_are_runtime_sized(void) {
  assert(CW_MAX_ACTORS >= 512u);
  assert(CW_MAX_ITEMS >= 1024u);
  assert(CW_MAX_LOCATIONS >= 256u);
  assert(CW_MAX_EXITS >= 1024u);
  assert(CW_MAX_EVENTS >= 128u);
  assert(CW_MAX_EVOLUTION_TRACKS >= 128u);
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

static void test_combat_v3_finesse_and_v2_attack_replay_compatibility(void) {
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
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_HIT);
  assert(events.events[1].damage >= 5);
  assert(events.events[1].damage <= 12);

  cw_world legacy_replay = before_attack;
  attack.kind = CW_ACTION_COMBAT_ATTACK;
  assert(cw_world_apply(&legacy_replay, &attack, 415, &events) == CW_OK);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  assert(events.events[0].modifier == 0);
  assert(events.events[1].type == CW_EVENT_COMBAT_ATTACK_HIT);
  assert(events.events[1].damage <= 6);
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

static void test_give_can_return_an_expendable_item_to_make_room(void) {
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

static void test_inventory_capacity_evicts_oldest_item(void) {
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
  assert(held_a && new_item);

  held_a->holder_actor_id = 5001;
  held_a->location_id = 0;
  held_a->held_since_tick = 10;
  new_item->holder_actor_id = 0;
  new_item->location_id = 1;
  new_item->held_since_tick = 0;

  world.tick = 100;
  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 5001;
  pickup.item_id = 2005;
  assert(cw_world_apply(&world, &pickup, 61, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_DROPPED);
  assert(events.events[0].item_id == 2001);
  assert(events.events[1].type == CW_EVENT_ITEM_PICKED_UP);
  assert(events.events[1].item_id == 2005);
  assert(held_a->holder_actor_id == 0);
  assert(held_a->location_id == 1);
  assert(new_item->holder_actor_id == 5001);
  assert(new_item->location_id == 0);
  assert(new_item->held_since_tick > held_a->held_since_tick);
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
  assert(cw_world_apply(&world, &search, 71, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);

  cw_action pickup = {0};
  pickup.kind = CW_ACTION_PICK_UP_ITEM;
  pickup.actor_id = 5001;
  pickup.item_id = 2001;
  assert(cw_world_apply(&world, &pickup, 72, &events) == CW_OK);

  assert(cw_world_apply(&world, &search, 73, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_FOUND);
  assert(events.events[0].item_id == 2005);
  assert(test_find_item(&world, 2005)->location_id == 1);

  cw_action craft = {0};
  craft.kind = CW_ACTION_CRAFT;
  craft.actor_id = 5001;
  craft.content_id = 3001;
  craft.item_id = 2001;
  craft.target_item_id = 2005;
  craft.output_item_id = 2011;
  craft.output_target_kind = CW_PLACEMENT_LOCATION_FLOOR;
  craft.output_target_id = 11;
  craft.output_item_kind = CW_ITEM_KEEPSAKE;
  craft.output_item_charges = 1;
  assert(cw_world_apply(&world, &craft, 74, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_CRAFTED);
  assert(events.events[0].item_id == 2001);
  assert(events.events[0].target_item_id == 2005);
  assert(events.events[1].type == CW_EVENT_ITEM_CREATED);
  assert(events.events[1].item_id == 2011);
  assert(test_find_item(&world, 2001)->holder_actor_id == 5001);
  assert(test_find_item(&world, 2005)->location_id == 1);
  assert(test_find_item(&world, 2011)->location_id == 11);

  assert(cw_world_apply(&world, &craft, 75, &events) == CW_ERR_RULE);
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
  test_combat_v2_encounter_turns_dodge_targeting_and_escape();
  test_combat_v3_finesse_and_v2_attack_replay_compatibility();
  test_give_items_and_evolution();
  test_maximum_evolution_burst_fits_event_buffer();
  test_npc_trade_items();
  test_npc_give_items();
  test_give_can_return_an_expendable_item_to_make_room();
  test_npc_pickup_can_evolve_self();
  test_inventory_capacity_evicts_oldest_item();
  test_search_and_craft_create_without_consuming_inputs();
  test_deterministic_replay();
  puts("cosy kernel tests passed");
  return 0;
}
