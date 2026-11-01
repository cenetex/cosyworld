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
  reflectionOpen,
  placeText,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { availableCards, cardChoices } from "../v2/card-game/cards.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { hub, packDefinition } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  currentScene,
  backdrop,
  portrait,
  locationVariant,
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
const CHARM = "forest-wolfprint-charm";
function attic() {
  const world = enableMotives(createWorld());
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "vale";
  world.items.lamp.holder = "attic";
  world.items.lamp.lit = true;
  world.items.lamp.fuel = 12;
  return world;
}
function welcome() {
  let world = move(attic(), COTTAGE);
  world = act(world, "talk", { target: "rati" });
  return choose(world, "forest-stay-for-tea");
}
function charmAtOak() {
  let world = move(welcome(), GARDEN);
  world = choose(world, "forest-clear-drain");
  world = move(world, TRAIL);
  world = take(world, CHARM);
  return move(world, OAK);
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
    expect(portrait("oak", null, world)).toBe(
      "./assets/lonely-forest/oakheart.webp",
    );
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

  it("opens Oak's shortcut with the charm nearby and keeps the trail's return free", () => {
    let world = move(move(welcome(), GARDEN), OAK);
    expect(exits(world, OAK, "vale")).not.toContain(TRAIL);
    expect(availableCards(world)).not.toContain(TRAIL);
    world = move(world, GARDEN);
    world = choose(world, "forest-clear-drain");
    world = move(world, TRAIL);
    world = take(world, CHARM);
    world = move(world, OAK);
    world = reload(world);
    expect(exits(world, OAK, "vale")).toContain(TRAIL);
    expect(availableCards(world)).toContain(TRAIL);
    const stale = legalActions(world).find(
      (a) => a.kind === "move" && a.target === TRAIL,
    );

    world = act(world, "drop", { item: CHARM });
    expect(world.items[CHARM].holder).toBe(OAK);
    world = move(world, TRAIL);
    world = move(world, OAK);
    world = take(world, CHARM);
    world = move(world, TRAIL);
    world = act(world, "drop", { item: CHARM });
    expect(world.items[CHARM].holder).toBe(TRAIL);
    world = move(world, OAK);
    expect(exits(world, OAK, "vale")).not.toContain(TRAIL);
    expect(play(world, stale).ok).toBe(false);

    // The original garden route still lets a traveler recover the charm.
    world = move(move(world, GARDEN), TRAIL);
    world = take(world, CHARM);
    world = move(world, OAK);
    world = act(world, "give", { item: CHARM, target: "oak" });
    expect(world.items[CHARM].holder).toBe("oak");
    world = reload(world);
    expect(exits(world, OAK, "vale")).toContain(TRAIL);
    world = move(move(world, TRAIL), OAK);
    expect(world.items[CHARM].holder).toBe("oak");
  });

  it("requires a shared charm holder to be present, but keeps a charm left at Oak", () => {
    let world = dispatchShared({ op: "create", save: encodeSave(charmAtOak()) }).world;
    world.actors.mara.place = OAK;
    const command = (actor, present, fields = {}) =>
      dispatchShared({
        op: "view",
        world,
        actor,
        claimed: ["vale", "mara"],
        present,
        ...fields,
      });
    expect(command("mara", ["mara"]).exits).not.toContain(TRAIL);
    expect(command("mara", ["vale", "mara"]).exits).toContain(TRAIL);
    const drop = command("vale", ["vale", "mara"]).actions.find(
      (a) => a.kind === "drop" && a.item === CHARM,
    );
    expect(drop).toBeDefined();
    const placed = command("vale", ["vale", "mara"], { op: "play", action: drop });
    expect(placed.ok, placed.error).toBe(true);
    world = reload(placed.world);
    expect(world.items[CHARM].holder).toBe(OAK);
    expect(command("mara", ["mara"]).exits).toContain(TRAIL);
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

  it("opens with light and cloth in the attic and keeps the cottage return after the cloth moves", () => {
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

  it.each(["attic", "vale", "moth", "bell"])(
    "uses the cloth held by %s in the lit attic without moving it",
    (holder) => {
      const world = attic();
      world.actors.moth.place = "attic";
      world.items.bell.holder = "attic";
      world.items.cloth.holder = holder;
      const restored = reload(world);
      expect(exits(restored, "attic", "vale")).toEqual([COTTAGE]);
      expect(availableCards(restored)).toContain(COTTAGE);
      expect(backdrop("attic", restored)).toBe(
        "./assets/shared/places/attic-stairs.webp",
      );
      expect(locationVariant(restored, "attic")).toBe("attic-forest-cottage");
      const next = move(restored, COTTAGE);
      expect(next.actors.vale.place).toBe(COTTAGE);
      expect(next.items.cloth.holder).toBe(holder);
    },
  );

  it.each(["unlit", "empty", "covered", "at the pond", "at the station"])(
    "closes the cottage stairs when the lamp is %s; only a dark lamp here opens the mirror",
    (condition) => {
      const world = attic();
      const stale = legalActions(world).find(
        (a) => a.kind === "move" && a.target === COTTAGE,
      );
      expect(stale).toBeDefined();
      if (condition === "unlit") world.items.lamp.lit = false;
      if (condition === "empty") {
        world.items.lamp.fuel = 0;
        world.items.lamp.lit = false;
      }
      if (condition === "covered") world.items.cloth.holder = "lamp";
      if (condition === "at the pond") world.items.lamp.holder = "pond";
      if (condition === "at the station") world.items.lamp.holder = "station";
      const before = encodeSave(world);
      const restored = reload(world);
      const dark = ["unlit", "empty", "covered"].includes(condition);
      expect(reflectionOpen(restored, "attic")).toBe(dark);
      expect(exits(restored, "attic", "vale")).not.toContain(COTTAGE);
      expect(availableCards(restored)).not.toContain(COTTAGE);
      expect(backdrop("attic", restored)).toBe(
        dark
          ? "./assets/attic/attic-doused.webp"
          : "./assets/shared/places/attic-dark.webp",
      );
      expect(locationVariant(restored, "attic")).toBe(
        dark ? "attic-doused" : "attic-dark",
      );
      expect(placeText(restored, "attic").includes("black shore")).toBe(dark);
      const result = play(world, stale);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(world);
      expect(encodeSave(world)).toBe(before);
    },
  );

  it("keeps the lit attic shut when the cloth leaves until the lamp is doused", () => {
    const world = attic();
    const stale = legalActions(world).find(
      (a) => a.kind === "move" && a.target === COTTAGE,
    );
    world.items.cloth.holder = "pond";
    const restored = reload(world);
    expect(exits(restored, "attic", "vale")).toEqual([]);
    expect(backdrop("attic", restored)).toBe("./assets/attic/attic-lit.webp");
    expect(locationVariant(restored, "attic")).toBe("attic-lit");
    expect(placeText(restored, "attic")).toContain("Dust gathers");
    expect(play(restored, stale).ok).toBe(false);
    const doused = act(restored, "snuff");
    expect(placeText(doused, "attic")).toContain("mirror opens onto a black shore");
    expect(move(doused, "pond").actors.vale.place).toBe("pond");
  });

  it("rejects a shared cottage crossing after another player puts out the lamp", () => {
    let world = dispatchShared({ op: "create", save: encodeSave(attic()) }).world;
    world.actors.mara.place = "attic";
    world.items.lamp.holder = "vale";
    const command = (actor, fields = {}) =>
      dispatchShared({
        op: "view",
        world,
        actor,
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        ...fields,
      });
    const stale = command("mara").actions.find(
      (a) => a.kind === "move" && a.target === COTTAGE,
    );
    expect(stale).toBeDefined();
    const snuff = command("vale").actions.find((a) => a.kind === "snuff");
    expect(snuff).toBeDefined();
    const dark = command("vale", { op: "play", action: snuff });
    expect(dark.ok, dark.error).toBe(true);
    world = reload(dark.world);
    expect(command("mara").exits).not.toContain(COTTAGE);
    const rejected = command("mara", { op: "play", action: stale });
    expect(rejected.ok).toBe(false);
    expect(rejected.world.actors.mara.place).toBe("attic");
    expect(rejected.world.items.cloth.holder).toBe("vale");
    expect(backdrop("attic", rejected.world)).toBe(
      "./assets/attic/attic-doused.webp",
    );
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
      world.log = [];
      world = reload(world);
      expect(state(world).choices["forest-homecoming"]).toBe(homecoming);
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

describe("Three walkers, one old root", () => {
  it.each([
    ["rati", "forest-walkers-rati", [], [GARDEN, TRAIL]],
    ["oak", "forest-walkers-oak", [GARDEN, OAK], [GARDEN, TRAIL]],
  ])(
    "learns the walkers from %s before the watch with Skull",
    (speaker, fact, road, trail) => {
      let world = chapter();
      expect(state(world).receipts["forest-sit-watch"]).toBeUndefined();
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
      expect(state(world).receipts["forest-sit-watch"]).toBe(world.turn);
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
