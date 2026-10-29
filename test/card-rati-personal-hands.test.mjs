import { describe, expect, it, vi } from "vitest";

// Read the authored source before the release compiler updates packs.json.
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const original = (await importOriginal()).default;
  const { readFileSync } = await import("node:fs");
  const read = (name) =>
    JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
  const source = read("../v2/content/lonely-forest/card-world.json");
  const joined = read("../v2/worlds/lonely-forest/card-bridge.json");
  const { schemaVersion, pack, id, description, ...bridge } = joined;
  return {
    default: {
      ...original,
      packs: [
        ...original.packs.filter((entry) => entry.id !== source.id),
        { ...source, bridge: { id, description }, ...bridge },
      ],
    },
  };
});

import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
  carried,
} from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  questCards,
  questHistoryCards,
  questHand,
  questCardId,
  questForCard,
} from "../v2/card-game/quest-cards.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { addQuestRecord, focusQuest } from "../v2/card-game/shared-quests.mjs";
import { questHandKeys } from "../v2/card-game/quest-hands.mjs";

const PACK = "lonely-forest",
  QUEST = "forest-rati-scarf",
  COTTAGE = "forest-cottage";
const definition = () =>
  packDefinition(PACK).personalQuests.find((row) => row.id === QUEST);
const personal = (world) => world.packs[PACK].personalQuests[QUEST];
const rowFor = (actor) =>
  definition().playerItems.find((row) => row.player === actor);
const reload = (world) => decodeSave(encodeSave(world));
const viewAs = (world, actor) => ({ ...world, playerActorId: actor });

function freshAtMirror(shared = false, greekFull = false) {
  // This fixture isolates the new forest task at the existing cloth crossing.
  let world = createWorld({
    opening: true,
    packScopes: greekFull ? { "greek-drama": "full" } : {},
  });
  world = act(world, "light");
  world = act(world, "move", { target: "pond" });
  world = act(world, "move", { target: "attic" });
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "attic";
  world.items.lamp.holder = "vale";
  world.items.lamp.lit = true;
  world.items.lamp.fuel = 12;
  if (shared) {
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.playerActorId = "vale";
    world.actors.mara.place = "attic";
    world.items.lamp.holder = "attic";
    world.items.lamp.fuel = 12;
    world.items.lamp.lit = true;
  }
  return reload(world);
}

function act(world, kind, fields = {}, actor = "vale") {
  const action = legalActions(world, actor).find(
    (candidate) =>
      candidate.kind === kind &&
      Object.entries(fields).every(([key, value]) => candidate[key] === value),
  );
  expect(
    action,
    `${actor}: ${kind} ${JSON.stringify(fields)} at ${world.actors[actor].place}`,
  ).toBeTruthy();
  const result = play(world, action, world.revision, actor);
  expect(result.ok, result.error).toBe(true);
  expect(play(reload(world), action, world.revision, actor)).toEqual(result);
  if (world.sharedVersion === 1) {
    const shared = dispatchShared({
      op: "play",
      world,
      actor,
      claimed: world.controlledActors || [actor],
      present: world.presentActors || [actor],
      revision: world.revision,
      action,
    });
    expect(shared.ok, shared.error).toBe(true);
    const stored = structuredClone(result.state);
    for (const key of ["playerActorId", "controlledActors", "presentActors"])
      delete stored[key];
    expect(shared.world).toEqual(stored);
  }
  return reload(result.state);
}

function route(world, actor, goal) {
  const start = world.actors[actor].place,
    seen = new Set([start]),
    queue = [[start]];
  while (queue.length) {
    const path = queue.shift(),
      at = path.at(-1);
    if (at === goal) return path.slice(1);
    const view = {
      ...viewAs(world, actor),
      actors: {
        ...world.actors,
        [actor]: { ...world.actors[actor], place: at },
      },
    };
    for (const next of exits(view, at, actor))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
  }
  return null;
}
function travel(world, goal, actor = "vale") {
  for (
    let count = 0;
    world.actors[actor].place !== goal && count < 32;
    count++
  ) {
    const steps = route(world, actor, goal);
    expect(steps, `${actor} can reach ${goal}`).toBeTruthy();
    world = act(world, "move", { target: steps[0] }, actor);
  }
  expect(world.actors[actor].place).toBe(goal);
  return world;
}
function complete(world, owner = "vale", carrier = owner, onCarry = null) {
  const row = rowFor(owner),
    record = personal(world).records[owner];
  world = travel(world, record.button.placedAt, carrier);
  world = act(world, "take", { item: row.button }, carrier);
  onCarry?.(world);
  world = travel(world, COTTAGE, carrier);
  return act(world, "give", { item: row.button, target: "rati" }, carrier);
}

function fullHand(world) {
  let extra;
  while (questHandKeys(world, "vale").length < 2) {
    extra = addQuestRecord(world, {
      holder: { kind: "avatar", id: "vale" },
      participants: ["vale"],
      program: {
        id: `keep-the-current-plan-${questHandKeys(world, "vale").length}`,
        name: "Keep the current plan",
        purpose: "Meet Mara at the theatre with her mask.",
        steps: [{ items: ["mask"], location: "theatre", avatars: ["mara"] }],
      },
    });
    expect(extra).toBeTruthy();
  }
  expect(focusQuest(world, "vale", questHandKeys(world, "vale")[0])).toBe(true);
  world = reload(world);
  const hand = [...questHandKeys(world, "vale")];
  expect(hand).toHaveLength(2);
  return { world, hand, focus: world.quests.focus.vale, extraKey: extra.key };
}

describe("a personal scarf request beside a full quest hand", () => {
  it("keeps two live carried quests and focus while the extra request stays playable through completion", () => {
    const before = fullHand(freshAtMirror());
    let world = act(before.world, "move", { target: COTTAGE });
    const key = `${PACK}:${QUEST}:vale`;
    expect(questHandKeys(world, "vale")).toEqual(before.hand);
    expect(world.quests.focus.vale).toBe(before.focus);
    const card = questCards(world, "vale").find((entry) => entry.key === key);
    expect(card).toMatchObject({
      availableOffer: true,
      personalOwner: "vale",
      status: "pending",
    });
    expect(questCards(world, "vale")).toHaveLength(3);
    const id = questCardId(world, card);
    expect(questHand(world)).toContain(id);
    expect(questForCard(world, id)?.key).toBe(key);
    world = complete(world, "vale", "vale");
    expect(questHandKeys(world, "vale")).toEqual(before.hand);
    expect(world.quests.focus.vale).toBe(before.focus);
    for (const oldKey of before.hand)
      expect(world.quests.records[oldKey].completedTurn).toBeNull();
    expect(
      questCards(world, "vale").find((entry) => entry.key === key),
    ).toMatchObject({ status: "fulfilled" });
    expect(
      questHistoryCards(world, "vale").find((entry) => entry.key === key)
        ?.status,
    ).toBe("fulfilled");
    expect(world.items[rowFor("vale").reward].holder).toBe("vale");
    expect(reload(world)).toEqual(world);
  }, 15_000);

  it("carries an existing request when the player explicitly sets another quest aside", () => {
    const before = fullHand(freshAtMirror());
    let world = act(before.world, "move", { target: COTTAGE });
    const key = `${PACK}:${QUEST}:vale`;
    expect(
      questCards(world, "vale").find((entry) => entry.key === key)
        ?.availableOffer,
    ).toBe(true);
    world = act(world, "drop-quest", { questKey: before.extraKey });
    expect(questHandKeys(world, "vale")).toEqual([before.hand[0], key]);
    expect(world.quests.focus.vale).toBe(before.focus);
    expect(world.quests.records[before.extraKey].completedTurn).toBeNull();
    expect(world.quests.records[before.extraKey].droppedBy.vale).toBe(
      world.turn,
    );
    expect(
      questCards(world, "vale").find((entry) => entry.key === key)
        ?.availableOffer,
    ).toBeUndefined();
    expect(reload(world)).toEqual(world);
  }, 15_000);
});
