import {
  createWorld,
  validateWorld,
  places,
  things,
} from "../../v2/card-game/world.mjs";
import { enableMotives } from "../../v2/card-game/motives.mjs";
import {
  installQuestCollection,
  generateProgram,
  hand,
  at,
  withAvatars,
  hold,
  condition,
} from "../../v2/card-game/quests.mjs";
import { registerPersonalQuest } from "../../v2/card-game/shared-quests.mjs";
import { lifeOf } from "../../v2/card-game/life.mjs";
import { humanAvatarIds } from "../../v2/card-game/human-cast.mjs";

export function offerWorld() {
  const world = enableMotives(createWorld(), { personalQuests: true });
  world.sharedVersion = 1;
  world.controlledActors = [...humanAvatarIds];
  world.presentActors = [...humanAvatarIds];
  world.actors.vale.place = "station";
  world.items.lamp.holder = "vale";
  world.items.lamp.fuel = 3;
  world.items.lamp.lit = true;
  installQuestCollection(world, "vale");
  const life = lifeOf(world, "vale");
  for (const key of life.collection.cards) delete world.quests.records[key];
  life.collection.cards = [];
  life.collection.active = null;
  delete world.quests.focus.vale;
  life.collection.authoredThrough = 2;
  life.hope.steps = life.hope.steps.map(() => ["gathering"]);
  life.milestones = [];
  life.phase = "seeking";
  world.actors.vale.progress.step = 0;
  delete world.actors.vale.progress.current;
  return world;
}
export function addOffer(
  world,
  companions,
  { family = "gathering", createdTurn = world.turn } = {},
) {
  const collection = lifeOf(world, "vale").collection;
  const program = generateProgram(world, "vale", places, things);
  // Keep the generator's real metadata while setting a reproducible meeting.
  program.generated.situation = family;
  program.generated.turn = createdTurn;
  program.steps = [
    hand(
      hold("lamp"),
      at("station"),
      withAvatars(...companions),
      condition("lit", "lamp"),
    ),
    {
      ...hand(
        at("station"),
        withAvatars(companions[0]),
        condition("heldBy", "lamp", { avatar: companions[0] }),
      ),
      consequence: { kind: "trust", avatar: companions[0] },
    },
  ];
  const record = registerPersonalQuest(world, "vale", {
    key: `vale:quest:${collection.next++}`,
    program,
    step: 0,
    origin: {
      kind: "talk",
      turn: createdTurn,
      other: companions[0],
      item: null,
      place: "station",
    },
    createdTurn,
    completedTurn: null,
  });
  collection.cards.push(record.key);
  return record;
}
export function threeGatherings({
  protect = false,
  twoProtected = false,
} = {}) {
  const world = offerWorld();
  world.turn = world.revision = 3;
  const records = [
    addOffer(world, ["mara", "ash"], { createdTurn: 1 }),
    addOffer(world, ["mara", "nell"], { createdTurn: 2 }),
    addOffer(world, ["ash", "nell"], { createdTurn: 3 }),
  ];
  if (protect) {
    const collection = lifeOf(world, "vale").collection;
    collection.active = records[0].key;
    world.quests.focus.vale = records[0].key;
    records[0].step = 1;
    records[0].lastProgressTurn = 2;
    collection.earned = 1;
    world.actors.vale.progress.step = 1;
    world.actors.vale.progress.marks = [2];
    lifeOf(world, "vale").phase = "active";
  }
  if (twoProtected) records[1].participants = ["mara", "vale"];
  return validateWorld(world);
}
