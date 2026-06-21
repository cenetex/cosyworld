#include "cosy_kernel.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_seed_and_chat(void) {
  cw_world world;
  cw_event_buffer events;
  cw_world_init(&world);

  assert(cw_seed_cosy_cottage(&world, &events) == CW_OK);
  assert(world.location_count == 9);
  assert(world.exit_count == 16);
  assert(world.actor_count == 4);
  assert(world.item_count == 7);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_WORLD_BOOTSTRAPPED);

  cw_action create = {0};
  create.kind = CW_ACTION_CREATE_ACTOR;
  create.actor_id = 5001;
  create.location_id = 1;
  assert(cw_world_apply(&world, &create, 42, &events) == CW_OK);
  assert(world.actor_count == 5);
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
  attack.target_actor_id = 1004;
  assert(cw_world_apply(&world, &attack, 55, &events) == CW_OK);
  assert(events.count >= 2);
  assert(events.events[0].type == CW_EVENT_COMBAT_ATTACK_ATTEMPT);
  assert(events.events[0].target_actor_id == 1004);

  cw_action_offers offers = {0};
  assert(cw_get_action_offers(&world, 1003, &offers) == CW_OK);
  assert(offers.option_flags & CW_OFFER_FLEE);

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

  move.destination_location_id = 3;
  assert(cw_world_apply(&world, &move, 45, &events) == CW_OK);
  pickup.item_id = 2003;
  assert(cw_world_apply(&world, &pickup, 46, &events) == CW_OK);

  move.destination_location_id = 2;
  assert(cw_world_apply(&world, &move, 47, &events) == CW_OK);
  move.destination_location_id = 1;
  assert(cw_world_apply(&world, &move, 48, &events) == CW_OK);

  cw_action give = {0};
  give.kind = CW_ACTION_GIVE_ITEM;
  give.actor_id = 5001;
  give.target_actor_id = 1001;
  give.item_id = 2002;
  assert(cw_world_apply(&world, &give, 49, &events) == CW_ERR_RULE);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_RULE_REJECTED);
  assert(world.items[1].holder_actor_id == 5001);
  assert(world.actors[0].stats.level == 1);

  give.target_actor_id = 1002;
  give.item_id = 2002;
  assert(cw_world_apply(&world, &give, 49, &events) == CW_OK);
  assert(events.count == 1);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(world.actors[1].stats.level == 1);

  give.item_id = 2003;
  assert(cw_world_apply(&world, &give, 50, &events) == CW_OK);
  assert(events.count == 2);
  assert(events.events[0].type == CW_EVENT_ITEM_GIVEN);
  assert(events.events[1].type == CW_EVENT_AVATAR_EVOLVED);
  assert(events.events[1].target_actor_id == 1002);
  assert(events.events[1].total == 2);
  assert(world.actors[1].stats.level == 2);
  assert(world.items[1].holder_actor_id == 1002);
  assert(world.items[2].holder_actor_id == 1002);
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
  test_seed_and_chat();
  test_movement_and_check();
  test_items_and_combat_gate();
  test_give_items_and_evolution();
  test_deterministic_replay();
  puts("cosy kernel tests passed");
  return 0;
}
