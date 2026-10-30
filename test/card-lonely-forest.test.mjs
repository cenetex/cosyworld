import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Exercise the authored source before the release build mounts its art.
// The same compiler joins this pack and bridge for the shipping registry.
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
        ...original.packs.filter((p) => p.id !== source.id),
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
} from "../v2/card-game/world.mjs";
import { availableCards, cardChoices } from "../v2/card-game/cards.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  forestDefinitions,
  FOREST_QUEST_CARDS,
} from "../v2/card-game/forest-quests.mjs";
import { questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import { hub, packDefinition } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  currentScene,
  sceneCast,
  sceneStaging,
} from "../v2/card-game/scene.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const PACK = "lonely-forest";
const COTTAGE = "forest-cottage",
  GARDEN = "forest-garden",
  TRAIL = "forest-trail",
  OAK = "forest-oak";
const state = (world) => world.packs[PACK];
const reload = (world) => decodeSave(encodeSave(world));
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const move = (world, target) => act(world, "move", { target });
const take = (world, item) => act(world, "take", { item });
const choose = (world, choiceId) => act(world, "choose", { choiceId });
function attic() {
  const world = enableMotives(createWorld(), {
    questPrograms: true,
    personalQuests: true,
  });
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "vale";
  world.items.lamp.holder = "station";
  world.items.lamp.lit = false;
  world.items.lamp.fuel = 0;
  return world;
}
function welcome() {
  let world = move(attic(), COTTAGE);
  world = act(world, "talk", { target: "rati" });
  return choose(world, "forest-stay-for-tea");
}
function chapter({
  path = "forest-clear-drain",
  watch = "forest-mark-pawprints",
  account = "forest-tell-hearth",
  ending = "forest-leave-charm",
} = {}) {
  let world = move(welcome(), GARDEN);
  world = choose(world, path);
  world = move(world, TRAIL);
  world = choose(world, watch);
  world = take(world, "forest-wolfprint-charm");
  world = move(world, GARDEN);
  world = move(world, OAK);
  world = choose(world, account);
  world = reload(world);
  world = move(world, GARDEN);
  world = move(world, COTTAGE);
  return choose(world, ending);
}

describe("Tea beneath the oak", () => {
  it("paints a backdrop resident once while keeping its card and dialogue", () => {
    let world = welcome();
    world = move(world, GARDEN);
    world = move(world, OAK);
    world = act(world, "talk", { target: "oak" });
    const context = narrativeContext(world);
    world = applyGeneratedText(world, context, {
      revision: world.revision,
      model: "forest-presentation-test",
      entries: context.entities.map(({ id }) => ({
        id,
        text:
          id === "oak"
            ? "Root counts the footsteps beside the garden."
            : "I can see the path from here.",
      })),
    });
    const scene = currentScene(world);
    expect(sceneCast(world)).toContain("oak");
    expect(sceneStaging(world).actors.map((a) => a.id)).toEqual(["vale"]);
    expect(scene.background).toBe("./assets/lonely-forest/oak.png");
    expect(scene.lines.some((line) => line.actorId === "oak")).toBe(true);
    expect(availableCards(world)).toContain("oak");
    expect(
      legalActions(world).some((a) => a.kind === "talk" && a.target === "oak"),
    ).toBe(true);
    const pack = structuredClone(packDefinition(PACK));
    pack.avatars.oak.presentation = "unknown";
    expect(packProblems(pack, hub).join(" ")).toMatch(/presentation/);
    pack.avatars.oak.presentation = "backdrop";
    delete pack.avatars.oak.travels;
    expect(packProblems(pack, hub).join(" ")).toMatch(/fixed backdrop/);
  });

  it("validates the source cast, routes, choices and mirror crossing", () => {
    const pack = packDefinition(PACK);
    expect(packProblems(pack, hub)).toEqual([]);
    expect(Object.keys(pack.places)).toEqual([COTTAGE, GARDEN, TRAIL, OAK]);
    expect(
      Object.fromEntries(
        Object.entries(pack.avatars).map(([id, a]) => [id, a.expression]),
      ),
    ).toEqual({
      rati: "speech",
      skull: "movement",
      whiskerwind: "emoji",
      oak: "speech",
    });
    const map = JSON.parse(
      readFileSync(
        new URL(
          "../v2/content/lonely-forest/classic-to-card.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(map.avatars["1002"]).toBe("whiskerwind");
    expect(new Set(Object.values(map.places))).toEqual(
      new Set(Object.keys(pack.places)),
    );
    for (const item of Object.values(map.items))
      expect(Object.keys(pack.items)).toContain(item);
  });

  it("opens with the cloth in the attic and keeps the cottage return after the cloth moves", () => {
    let world = attic();
    expect(exits(world, "attic", "vale")).toContain(COTTAGE);
    expect(availableCards(world)).toContain(COTTAGE);
    world = move(world, COTTAGE);
    expect(world.items.cloth.holder).toBe("vale");
    expect(exits(world, "attic", "vale")).not.toContain(COTTAGE);
    expect(exits(world, COTTAGE, "vale")).toContain("attic");
    world = reload(world);
    world = move(world, "attic");
    expect(world.items.cloth.holder).toBe("vale");
    expect(exits(world, "attic", "vale")).toContain(COTTAGE);
    world.items.cloth.holder = "pond";
    expect(exits(world, "attic", "vale")).not.toContain(COTTAGE);
  });

  it("keeps all choices grounded in work, custody and the resident's place", () => {
    let world = move(attic(), COTTAGE);
    // Vale's button is somewhere else, so RATi cannot sew it yet.
    expect(world.items["forest-button-vale"].holder).not.toBe(COTTAGE);
    expect(
      legalActions(world).some((a) => a.choiceId === "forest-sew-scarf-vale"),
    ).toBe(false);
    world = act(world, "talk", { target: "rati" });
    world = choose(world, "forest-stay-for-tea");
    world = move(world, GARDEN);
    expect(exits(world, GARDEN, "vale")).not.toContain(TRAIL);
    world = choose(world, "forest-clear-drain");
    expect(exits(world, GARDEN, "vale")).toContain(TRAIL);
    expect(
      legalActions(world).some((a) => a.choiceId === "forest-set-stones"),
    ).toBe(false);
    world = move(world, TRAIL);
    expect(
      cardChoices(world, "skull").some(
        (a) => a.choiceId === "forest-mark-pawprints",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "forest-clear-drain",
      "forest-mark-pawprints",
      "forest-tell-hearth",
      "forest-leave-charm",
      "drain",
      "tracks",
      "hearth",
      "hearth",
    ],
    [
      "forest-set-stones",
      "forest-mark-pawprints",
      "forest-tell-path",
      "forest-keep-charm",
      "stones",
      "tracks",
      "path",
      "traveler",
    ],
  ])(
    "saves the chapter's chosen work and homecoming: %s",
    (
      path,
      watch,
      account,
      ending,
      gardenCare,
      watchStyle,
      oakStory,
      homecoming,
    ) => {
      let world = chapter({ path, watch, account, ending });
      expect(state(world).choices).toMatchObject({
        "forest-garden-care": gardenCare,
        "forest-watch-style": watchStyle,
        "forest-oak-story": oakStory,
        "forest-homecoming": homecoming,
      });
      expect(state(world).flags["forest-homecoming-shared"]).toBe(true);
      expect(world.items["forest-wolfprint-charm"].holder).toBe(
        homecoming === "hearth" ? COTTAGE : "vale",
      );
      expect(forestDefinitions(world).map((q) => q.id)).toEqual(
        FOREST_QUEST_CARDS,
      );
      expect(forestDefinitions(world).every((q) => q.resolved)).toBe(true);
      const chapterCard = (q) =>
        FOREST_QUEST_CARDS.some((id) => q.key === `${PACK}:${id}`);
      const history = questHistoryCards(world).filter(chapterCard);
      expect(history).toHaveLength(FOREST_QUEST_CARDS.length);
      expect(
        history.every(
          (q) => q.status === "fulfilled" && q.participants.includes("vale"),
        ),
      ).toBe(true);
      world.log = [];
      world = reload(world);
      expect(state(world).choices["forest-homecoming"]).toBe(homecoming);
      expect(
        questHistoryCards(world)
          .filter(chapterCard)
          .map((q) => q.status),
      ).toEqual(FOREST_QUEST_CARDS.map(() => "fulfilled"));
      expect(legalActions(world).some((a) => a.choiceId === ending)).toBe(
        false,
      );
      expect(exits(world, COTTAGE, "vale")).toContain("attic");
    },
  );

  it("preserves a second human's choice author and keeps shared results through reload", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(welcome()),
    }).world;
    world.actors.vale.place = GARDEN;
    world.actors.mara.place = GARDEN;
    let response = dispatchShared({
      op: "view",
      world,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    });
    const action = response.actions.find(
      (a) => a.choiceId === "forest-set-stones",
    );
    expect(action).toBeTruthy();
    response = dispatchShared({
      op: "play",
      world: response.world,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      action,
    });
    expect(response.ok, response.error).toBe(true);
    world = reload(response.world);
    expect(state(world).choices["forest-garden-care"]).toBe("stones");
    const record =
      world.quests.records["lonely-forest:story-quest-forest-path"];
    expect(record.participants).toContain("mara");
    expect(
      world.log.find((e) => e.choiceId === "forest-set-stones")?.actorId,
    ).toBe("mara");
    const current = dispatchShared({
      op: "view",
      world,
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    });
    expect(
      current.actions.some((a) => a.choiceId === "forest-clear-drain"),
    ).toBe(false);
  });
});

// The three walkers: a Talk middle with two independent speakers.
function hear(world, speaker, fact) {
  world = act(world, "talk", { target: speaker });
  const context = narrativeContext(world);
  const disclosure = context.disclosures?.[0];
  expect(disclosure?.factId).toBe(fact);
  return applyGeneratedText(world, context, {
    revision: context.revision,
    model: "forest-walkers-test",
    entries: context.entities.map(({ id }) => ({
      id,
      text: id === speaker ? disclosure.text : "I will remember that.",
    })),
  });
}
const walkers = (world) =>
  world.quests.records["lonely-forest:story-quest-forest-walkers"];

describe("Three walkers, one old root", () => {
  it.each([
    ["rati", "forest-walkers-rati", [], [GARDEN, TRAIL]],
    ["oak", "forest-walkers-oak", [GARDEN, OAK], [GARDEN, TRAIL]],
  ])(
    "learns the walkers from %s before the watch with Skull",
    (speaker, fact, road, trail) => {
      let world = chapter();
      expect(walkers(world).completedTurn).toBeNull();
      for (const target of road) world = move(world, target);
      world = hear(world, speaker, fact);
      expect(state(world).flags["forest-walkers-heard"]).toBe(true);
      world = reload(world);
      for (const target of trail) world = move(world, target);
      expect(cardChoices(world, "skull").map((a) => a.choiceId)).toContain(
        "forest-sit-watch",
      );
      world = choose(world, "forest-sit-watch");
      expect(state(world).choices["forest-evening-watch"]).toBe("kept");
      expect(walkers(world).completedTurn).toBe(
        state(world).receipts["forest-sit-watch"],
      );
      expect(walkers(world).participants).toContain("vale");
    },
  );

  it("keeps the watch closed until someone has told the walkers' story", () => {
    const world = move(move(chapter(), GARDEN), TRAIL);
    expect(
      legalActions(world).some((a) => a.choiceId === "forest-sit-watch"),
    ).toBe(false);
    expect(
      cardChoices(move(world, GARDEN), "whiskerwind").some((a) =>
        a.choiceId?.startsWith("forest-hear-walkers"),
      ),
    ).toBe(false);
  });
});
