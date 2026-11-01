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
const wait = (world) => act(world, "wait", { actor: "vale" });
const CHARM = "forest-wolfprint-charm";
const talk = (world, target) => act(world, "talk", { target });
function attic() {
  const world = enableMotives(createWorld());
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "vale";
  world.items.lamp.holder = "attic";
  world.items.lamp.lit = true;
  world.items.lamp.fuel = 12;
  return world;
}
// Talk with RATi after arriving is the welcome; the arrival itself hides
// Vale's button.
function welcome() {
  const world = move(attic(), COTTAGE);
  return act(world, "talk", { target: "rati" });
}
function charmAtOak() {
  let world = move(welcome(), GARDEN);
  world = wait(world);
  world = talk(move(world, TRAIL), "skull");
  world = take(world, CHARM);
  return talk(move(world, OAK), "oak");
}
// Carry the charm past Oak and home to RATi's hearth.
function homeWithCharm() {
  let world = move(welcome(), GARDEN);
  world = wait(world);
  world = talk(move(world, TRAIL), "skull");
  world = take(world, "forest-wolfprint-charm");
  world = move(world, GARDEN);
  world = talk(move(world, OAK), "oak");
  world = reload(world);
  world = move(world, GARDEN);
  return move(world, COTTAGE);
}
function chapter() {
  return act(homeWithCharm(), "give", {
    item: "forest-wolfprint-charm",
    target: "rati",
  });
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
    world = wait(world);
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
    let world = dispatchShared({
      op: "create",
      save: encodeSave(charmAtOak()),
    }).world;
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
    const placed = command("vale", ["vale", "mara"], {
      op: "play",
      action: drop,
    });
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
      // Lit with the cloth: only the cottage; the mirror shows only the room.
      expect(exits(restored, "attic", "vale")).toEqual([COTTAGE]);
      expect(reflectionOpen(restored, "attic")).toBe(false);
      expect(availableCards(restored)).toContain(COTTAGE);
      expect(availableCards(restored)).not.toContain("pond");
      expect(backdrop("attic", restored)).toBe(
        "./assets/shared/places/attic-lit-cottage.webp",
      );
      expect(locationVariant(restored, "attic")).toBe("attic-forest-cottage");
      const next = move(restored, COTTAGE);
      expect(next.actors.vale.place).toBe(COTTAGE);
      expect(next.items.cloth.holder).toBe(holder);
    },
  );

  // A sewn scarf is active once its flag is set; the world is not reloaded
  // because the sewing receipt is skipped here.
  const scarfed = (scarf, holder) => {
    const world = attic();
    world.items.cloth.holder = "pond";
    world.packs["lonely-forest"].flags[`${scarf}-sewn`] = true;
    world.items[scarf].holder = holder;
    return world;
  };
  it.each([
    ["Vale's own scarf", "forest-scarf-vale", "vale"],
    ["another traveler's scarf", "forest-scarf-mara", "vale"],
    ["a companion's scarf", "forest-scarf-ash", "moth"],
  ])(
    "opens only the cottage from the lit attic with %s",
    (_, scarf, holder) => {
      const world = scarfed(scarf, holder);
      world.actors.moth.place = "attic";
      expect(backdrop("attic", world)).toBe(
        "./assets/shared/places/attic-lit-cottage.webp",
      );
      expect(exits(world, "attic", "vale")).toEqual([COTTAGE]);
      expect(availableCards(world)).not.toContain("pond");
      expect(
        legalActions(world).some(
          (a) => a.kind === "move" && a.target === COTTAGE,
        ),
      ).toBe(true);
      world.items.lamp.lit = false;
      expect(backdrop("attic", world)).toBe("./assets/attic/attic-doused.webp");
      expect(exits(world, "attic", "vale")).toEqual(["pond"]);
    },
  );

  it("keeps the stairs shut for a scarf left on the floor or still unsewn", () => {
    expect(
      exits(scarfed("forest-scarf-vale", "attic"), "attic", "vale"),
    ).toEqual([]);
    const unsewn = scarfed("forest-scarf-vale", "vale");
    delete unsewn.packs["lonely-forest"].flags["forest-scarf-vale-sewn"];
    expect(exits(unsewn, "attic", "vale")).toEqual([]);
  });

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
      // Dark (doused here, or the lamp gone): only the pond.
      expect(exits(restored, "attic", "vale")).toEqual(["pond"]);
      expect(availableCards(restored)).not.toContain(COTTAGE);
      expect(availableCards(restored)).toContain("pond");
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
    // Lit without the cloth: neither way.
    expect(exits(restored, "attic", "vale")).toEqual([]);
    expect(availableCards(restored)).not.toContain(COTTAGE);
    expect(availableCards(restored)).not.toContain("pond");
    expect(backdrop("attic", restored)).toBe("./assets/attic/attic-lit.webp");
    expect(locationVariant(restored, "attic")).toBe("attic-lit");
    expect(placeText(restored, "attic")).toContain("Dust gathers");
    expect(play(restored, stale).ok).toBe(false);
    const doused = act(restored, "snuff");
    expect(placeText(doused, "attic")).toContain(
      "mirror opens onto a black shore",
    );
    expect(move(doused, "pond").actors.vale.place).toBe("pond");
  });

  it("rejects a shared cottage crossing after another player puts out the lamp", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(attic()),
    }).world;
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

  it("offers no story buttons and follows ordinary plays", () => {
    const pack = packDefinition(PACK);
    expect(
      pack.choices.filter((c) => c.on === undefined).map((c) => c.id),
    ).toEqual(["forest-hear-walkers-rati", "forest-hear-walkers-oak"]);
    let world = move(attic(), COTTAGE);
    // Vale's button is somewhere else, so RATi cannot sew it yet.
    expect(world.items["forest-button-vale"].holder).not.toBe(COTTAGE);
    expect(state(world).flags["forest-welcomed"]).toBeUndefined();
    world = act(world, "talk", { target: "rati" });
    expect(state(world).flags["forest-welcomed"]).toBe(true);
    expect(state(world).receipts["forest-stay-for-tea"]).toBe(world.turn);
    world = move(world, GARDEN);
    expect(exits(world, GARDEN, "vale")).not.toContain(TRAIL);
    world = wait(world);
    expect(exits(world, GARDEN, "vale")).toContain(TRAIL);
    world = move(world, TRAIL);
    expect(state(world).flags["forest-watch-shared"]).toBeUndefined();
    world = talk(world, "skull");
    expect(state(world).flags["forest-watch-shared"]).toBe(true);
    // Oak hears the account only from a traveler carrying the charm.
    world = talk(move(move(world, GARDEN), OAK), "oak");
    expect(state(world).flags["forest-oak-heard"]).toBeUndefined();
    expect(legalActions(world).some((a) => a.kind === "choose")).toBe(false);
  });

  it("saves the chapter's deeds and gives the charm to the hearth", () => {
    let world = chapter();
    expect(state(world).flags).toMatchObject({
      "forest-welcomed": true,
      "forest-path-cleared": true,
      "forest-watch-shared": true,
      "forest-oak-heard": true,
      "forest-homecoming-shared": true,
    });
    expect(state(world).choices).toEqual({});
    expect(world.items["forest-wolfprint-charm"].holder).toBe(COTTAGE);
    world.log = [];
    world = reload(world);
    expect(state(world).receipts["forest-leave-charm"]).toBeGreaterThan(0);
    expect(exits(world, COTTAGE, "vale")).toContain("attic");
  });

  it("closes Oak's way once RATi keeps the charm by the hearth", () => {
    let world = charmAtOak();
    expect(exits(world, OAK, "vale")).toContain(TRAIL);
    world = move(move(world, GARDEN), COTTAGE);
    world = act(world, "give", { item: CHARM, target: "rati" });
    expect(state(world).receipts["forest-leave-charm"]).toBe(world.turn);
    expect(world.items[CHARM].holder).toBe(COTTAGE);
    world = reload(move(move(world, GARDEN), OAK));
    expect(exits(world, OAK, "vale")).not.toContain(TRAIL);
    // The garden route to the trail stays open.
    world = move(move(world, GARDEN), TRAIL);
    expect(world.actors.vale.place).toBe(TRAIL);
    // Taking the charm back and Waiting at the hearth ends nothing more.
    world = take(move(move(world, GARDEN), COTTAGE), CHARM);
    world = wait(world);
    expect(state(world).receipts["forest-keep-charm"]).toBeUndefined();
  });

  it("lets Vale keep the charm by Waiting at the hearth with it", () => {
    let world = homeWithCharm();
    expect(state(world).receipts["forest-keep-charm"]).toBeUndefined();
    // Waiting at the hearth is a long rest, so the clock moves on after it.
    world = wait(world);
    const kept = state(world).receipts["forest-keep-charm"];
    expect(kept).toBeGreaterThan(0);
    expect(state(world).flags["forest-homecoming-shared"]).toBe(true);
    expect(world.items[CHARM].holder).toBe("vale");
    expect(
      world.log.find(
        (e) => e.verb === "wait" && e.actorId === "vale" && e.turn === kept,
      )?.text,
    ).toBe("Vale kept the Wolfprint Charm for the next journey.");
    // The visit has ended: a later gift to RATi is no second ending.
    world = reload(world);
    const given = act(world, "give", { item: CHARM, target: "rati" });
    expect(state(given).receipts["forest-leave-charm"]).toBeUndefined();
    // The kept charm still opens Oak's way when carried there.
    world = move(move(world, GARDEN), OAK);
    expect(exits(world, OAK, "vale")).toContain(TRAIL);
  });

  it("keeps a second human's deed author through reload", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(welcome()),
    }).world;
    world.actors.vale.place = GARDEN;
    world.actors.mara.place = GARDEN;
    const people = {
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    };
    let response = dispatchShared({ op: "view", world, ...people });
    const action = response.actions.find(
      (a) => a.kind === "wait" && a.actor === "mara",
    );
    expect(action).toBeTruthy();
    response = dispatchShared({
      op: "play",
      world: response.world,
      ...people,
      action,
    });
    expect(response.ok, response.error).toBe(true);
    world = reload(response.world);
    expect(state(world).flags["forest-path-cleared"]).toBe(true);
    expect(world.log.findLast((e) => e.verb === "wait")).toMatchObject({
      actorId: "mara",
      text: "Mara cleared the garden drain.",
    });
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
      world = wait(world);
      expect(state(world).flags["forest-watch-kept"]).toBe(true);
      expect(state(world).receipts["forest-sit-watch"]).toBe(world.turn);
    },
  );

  it("keeps the watch closed until someone has told the walkers' story", () => {
    const world = wait(move(move(chapter(), GARDEN), TRAIL));
    expect(state(world).receipts["forest-sit-watch"]).toBeUndefined();
    expect(
      cardChoices(move(world, GARDEN), "whiskerwind").some((a) =>
        a.choiceId?.startsWith("forest-hear-walkers"),
      ),
    ).toBe(false);
  });
});
