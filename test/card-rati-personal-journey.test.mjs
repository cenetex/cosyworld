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
import { storyDefinitions } from "../v2/card-game/story-quests.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { questCards, questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

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
    expect(
      steps,
      `${actor} can reach ${goal}: ${JSON.stringify({
        place: world.actors[actor].place,
        turn: world.turn,
        lamp: world.items.lamp,
        cloth: world.items.cloth,
        moves: legalActions(world, actor).filter(
          (action) => action.kind === "move",
        ),
      })}`,
    ).toBeTruthy();
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

describe("RATi's personal scarf in the real world model", () => {
  it("discovers Vale's reachable button at the first meeting and keeps the sewn reward through reload", () => {
    let world = freshAtMirror();
    expect(personal(world).records).toEqual({});
    expect(personal(world).legacy).toBe(false);
    for (const row of definition().playerItems) {
      expect(entityActive(world, row.button)).toBe(false);
      expect(entityActive(world, row.reward)).toBe(false);
      expect(availableCards(world)).not.toContain(row.button);
      expect(availableCards(world)).not.toContain(row.reward);
    }
    expect(entityActive(world, "forest-story-button")).toBe(false);
    world = act(world, "move", { target: COTTAGE });
    const row = rowFor("vale"),
      record = structuredClone(personal(world).records.vale);
    expect(Object.keys(personal(world).records)).toEqual(["vale"]);
    expect(record.meeting).toMatchObject({ turn: world.turn, place: COTTAGE });
    expect(record.eligiblePlaces).toContain(record.button.placedAt);
    expect(definition().locations).toContain(record.button.placedAt);
    expect(route(world, "vale", record.button.placedAt)).toBeTruthy();
    expect(world.items[row.button].holder).toBe(record.button.placedAt);
    expect(entityActive(world, row.button)).toBe(true);
    expect(entityActive(world, row.reward)).toBe(false);
    expect(
      legalActions(world).some(
        (action) => action.choiceId === definition().sharedCompletion,
      ),
    ).toBe(false);
    expect(personal(reload(world)).records.vale).toEqual(record);
    const questKey = `${PACK}:${QUEST}:vale`;
    const foundCard = storyDefinitions(world, true).find(
      (card) => card.key === questKey,
    );
    expect(foundCard).toMatchObject({
      title: "Vale's White Scarf",
      stage: "find",
      personalOwner: "vale",
      holder: { kind: "avatar", id: "vale" },
    });
    expect(foundCard.displayPurpose).toContain("Vale's Story Button");
    expect(foundCard.displayPurpose).toBe(
      "Find Vale's Story Button. It is hidden beyond the cottage.",
    );
    const fixedProgram = structuredClone(
      world.quests.records[questKey].program,
    );
    world = complete(world, "vale", "vale", (carriedWorld) => {
      const card = storyDefinitions(carriedWorld, true).find(
        (entry) => entry.key === questKey,
      );
      expect(card.stage).toBe("return");
      expect(card.displayPurpose).toContain(
        "Bring Vale's Story Button back to RATi.",
      );
      expect(carriedWorld.quests.records[questKey].program).toEqual(
        fixedProgram,
      );
    });
    const done = personal(world).records.vale;
    expect(done.button.delivery).toMatchObject({ giver: "vale" });
    expect(done.button.consumedTurn).toBe(world.turn);
    expect(done.reward.awardedTurn).toBe(world.turn);
    expect(world.items[row.button].holder).toBe(row.reward);
    expect(world.items[row.reward].holder).toBe("vale");
    expect(entityActive(world, row.button)).toBe(false);
    expect(availableCards(world)).not.toContain(row.button);
    expect(availableCards(world)).toContain(row.reward);
    expect(carried(world, "vale")).toContain(row.reward);
    expect(carried(world, "vale")).not.toContain(row.button);
    expect(world.packs[PACK].flags["forest-scarf-mended"]).toBe(true);
    expect(world.packs[PACK].receipts[definition().sharedCompletion]).toBe(
      world.turn,
    );
    expect(
      storyDefinitions(world, true).find((card) => card.key === questKey),
    ).toMatchObject({
      title: "Vale's White Scarf",
      stage: "completed",
      status: "fulfilled",
    });
    expect(world.quests.records[questKey].program).toEqual(fixedProgram);
    const completedCard = structuredClone(world.quests.records[questKey]);
    expect(reload(world)).toEqual(world);
    const receipt = world.packs[PACK].receipts[definition().sharedCompletion];
    world = act(world, "wait");
    expect(world.packs[PACK].receipts[definition().sharedCompletion]).toBe(
      receipt,
    );
    expect(personal(world).records.vale.reward.awardedTurn).toBe(
      done.reward.awardedTurn,
    );
    world.log = [];
    world = reload(world);
    expect(world.quests.records[questKey]).toEqual(completedCard);
  }, 15_000);

  it.each(["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"])(
    "takes %s from their own first meeting through their own physical scarf",
    (owner) => {
      let world = freshAtMirror();
      world.sharedVersion = 1;
      world.controlledActors = [owner];
      world.presentActors = [owner];
      world.playerActorId = owner;
      world.actors[owner].place = "attic";
      world.items.lamp.holder = owner;
      world.items.lamp.lit = true;
      world.items.lamp.fuel = 12;
      world = reload(world);
      const row = rowFor(owner),
        questKey = `${PACK}:${QUEST}:${owner}`;
      expect(personal(world).records).toEqual({});
      expect(entityActive(world, row.button)).toBe(false);
      expect(entityActive(world, row.reward)).toBe(false);
      world = act(world, "move", { target: COTTAGE }, owner);
      expect(Object.keys(personal(world).records)).toEqual([owner]);
      const record = personal(world).records[owner];
      expect(record.meeting.place).toBe(COTTAGE);
      expect(record.eligiblePlaces).toContain(record.button.placedAt);
      expect(route(world, owner, record.button.placedAt)).toBeTruthy();
      const pending = questCards(world, owner).find(
        (card) => card.key === questKey,
      );
      expect(pending).toBeTruthy();
      expect(pending.title).toBe(packDefinition(PACK).items[row.reward].name);
      expect(pending.personalOwner).toBe(owner);
      const fixedProgram = structuredClone(
        world.quests.records[questKey].program,
      );
      world = complete(world, owner);
      const done = personal(world).records[owner];
      expect(done.button.delivery.giver).toBe(owner);
      expect(done.button.consumedTurn).toBe(world.turn);
      expect(done.reward.awardedTurn).toBe(world.turn);
      expect(world.items[row.button].holder).toBe(row.reward);
      expect(world.items[row.reward].holder).toBe(owner);
      expect(entityActive(world, row.button)).toBe(false);
      expect(entityActive(world, row.reward)).toBe(true);
      expect(carried(world, owner)).toContain(row.reward);
      expect(carried(world, owner)).not.toContain(row.button);
      expect(world.quests.records[questKey].program).toEqual(fixedProgram);
      expect(world.quests.records[questKey].completion).toMatchObject({
        actorId: owner,
        locationId: COTTAGE,
        participants: [owner],
      });
      expect(world.packs[PACK].flags["forest-scarf-mended"]).toBe(true);
      expect(reload(world)).toEqual(world);
    },
    15_000,
  );

  it("keeps a helper's delivery and gives Mara an independent scarf", () => {
    let world = act(freshAtMirror(true), "move", { target: COTTAGE });
    expect(personal(world).records.mara).toBeUndefined();
    world = complete(world, "vale", "mara");
    const vale = rowFor("vale"),
      mara = rowFor("mara");
    expect(personal(world).records.vale.button.delivery.giver).toBe("mara");
    expect(
      world.quests.records[`${PACK}:${QUEST}:vale`].completion.participants,
    ).toEqual(["mara", "vale"]);
    expect(world.items[vale.reward].holder).toBe("vale");
    expect(world.items[vale.button].holder).toBe(vale.reward);
    expect(personal(world).records.mara.button.id).toBe(mara.button);
    expect(personal(world).records.mara.reward.awardedTurn).toBeNull();
    expect(entityActive(world, mara.reward)).toBe(false);
    const firstReceipt =
      world.packs[PACK].receipts[definition().sharedCompletion];
    world = complete(world, "mara");
    expect(world.items[mara.reward].holder).toBe("mara");
    expect(world.items[mara.button].holder).toBe(mara.reward);
    expect(world.items[vale.reward].holder).toBe("vale");
    expect(world.packs[PACK].receipts[definition().sharedCompletion]).toBe(
      firstReceipt,
    );
    expect(personal(world).records.mara.reward.awardedTurn).toBeGreaterThan(
      firstReceipt,
    );
    expect(reload(world)).toEqual(world);
  }, 15_000);

  it("places a button at an active reachable candidate with the full Greek scope open", () => {
    let world = freshAtMirror(false, true);
    expect(world.packs["greek-drama"].scope).toBe("full");
    world = act(world, "move", { target: COTTAGE });
    const record = personal(world).records.vale;
    expect(record.eligiblePlaces.length).toBeGreaterThan(0);
    expect(record.eligiblePlaces.length).toBeLessThanOrEqual(
      definition().locations.length,
    );
    for (const place of record.eligiblePlaces) {
      expect(place).not.toBe(COTTAGE);
      expect(definition().locations).toContain(place);
      expect(entityActive(world, place)).toBe(true);
      expect(route(world, "vale", place)).toBeTruthy();
    }
    expect(record.eligiblePlaces).toContain(record.button.placedAt);
    expect(world.items[rowFor("vale").button].holder).toBe(
      record.button.placedAt,
    );
    expect(reload(world)).toEqual(world);
  }, 15_000);

  it.each([false, true])(
    "preserves a released legacy scarf record (completed=%s) and its new search policy",
    (completed) => {
      const released = releasedCardEngine(21);
      let old = released.dispatch({ op: "create" }).world;
      delete old.opening;
      old.actors.vale.place = "attic";
      old.items.cloth.holder = "attic";
      const request = (op, extra = {}) =>
        released.dispatch({
          op,
          world: old,
          actor: "vale",
          claimed: ["vale"],
          present: ["vale"],
          ...extra,
        });
      const oldAct = (kind, fields) => {
        const action = request("view").actions.find(
          (candidate) =>
            candidate.kind === kind &&
            Object.entries(fields).every(
              ([key, value]) => candidate[key] === value,
            ),
        );
        expect(action).toBeTruthy();
        const result = request("play", { action });
        expect(result.ok, result.error).toBe(true);
        old = result.world;
      };
      oldAct("move", { target: COTTAGE });
      oldAct("choose", { choiceId: "forest-stay-for-tea" });
      if (completed) {
        oldAct("take", { item: "forest-story-button" });
        oldAct("give", { item: "forest-story-button", target: "rati" });
        oldAct("choose", { choiceId: "forest-mend-scarf" });
      }
      expect(old.packs[PACK].revision).toBe(1);
      const hearth = `${PACK}:story-quest-forest-hearth`;
      expect(old.quests.records[hearth].completedTurn !== null).toBe(completed);
      let after = decodeSave(JSON.stringify(old));
      expect(after.packs[PACK].revision).toBe(2);
      expect(personal(after).legacy).toBe(true);
      expect(personal(after).records).toEqual({});
      for (const key of ["choices", "flags", "receipts", "met"])
        expect(after.packs[PACK][key]).toEqual(old.packs[PACK][key]);
      for (const [id, item] of Object.entries(old.items))
        expect(after.items[id]).toEqual(item);
      expect(after.quests.records[hearth]).toEqual(old.quests.records[hearth]);
      expect(after.log).toEqual(old.log);
      expect(after.actors.vale.place).toBe(old.actors.vale.place);
      expect(entityActive(after, "forest-story-button")).toBe(!completed);
      for (const row of definition().playerItems) {
        expect(entityActive(after, row.button)).toBe(false);
        expect(entityActive(after, row.reward)).toBe(false);
      }
      expect(reload(after)).toEqual(after);
      if (!completed) {
        after = act(after, "talk", { target: "rati" });
        expect(personal(after).records.vale).toBeTruthy();
        expect(entityActive(after, "forest-story-button")).toBe(false);
        expect(
          legalActions(after).some(
            (action) => action.choiceId === "forest-mend-scarf",
          ),
        ).toBe(false);
        expect(
          questCards(after, "rati").some((quest) => quest.key === hearth),
        ).toBe(false);
        expect(
          questCards(after, "vale").some(
            (quest) => quest.key === `${PACK}:${QUEST}:vale`,
          ),
        ).toBe(true);
        expect(after.packs[PACK].receipts["forest-mend-scarf"]).toBeUndefined();
        expect(reload(after)).toEqual(after);
      }
    },
    15_000,
  );
});
