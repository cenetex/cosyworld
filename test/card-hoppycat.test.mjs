import { describe, expect, it } from "vitest";
import {
  createWorld,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  packFacts,
  packSceneFacts,
} from "../v2/card-game/pack-registry.mjs";
import {
  createLandingWorld,
  landingPack,
} from "../v2/card-game/pack-landing.mjs";
import { act as playOne, reload } from "./helpers/play.mjs";

const pack = packDefinition("hoppycat-archive");
const id = (name) => `hoppycat-${name}`;
const act = (world, kind, fields = {}) =>
  reload(playOne(world, { kind, ...fields }));
function visit(world, target) {
  const queue = [[world.actors.vale.place]],
    seen = new Set();
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === target) {
      for (const next of path.slice(1))
        world = act(world, "move", { target: next });
      return world;
    }
    if (seen.has(here)) continue;
    seen.add(here);
    for (const next of pack.places[here].exits) queue.push([...path, next]);
  }
  throw new Error(`Missing route to ${target}`);
}

function runSteps(world, steps) {
  for (const [kind, thing, to] of steps) {
    if (kind === "visit") {
      world = visit(world, id(thing));
      continue;
    }
    const fields =
      kind === "talk"
        ? { target: id(thing) }
        : kind === "accompany"
          ? { target: id(thing), destination: id(to) }
          : thing
            ? { item: id(thing), ...(to ? { target: id(to) } : {}) }
            : {};
    world = act(world, kind, fields);
  }
  return world;
}

describe("Hoppy Cat refresh", () => {
  it("keeps the refreshed cast size", () => {
    expect(Object.keys(pack.places)).toHaveLength(10);
    expect(Object.keys(pack.avatars)).toHaveLength(16);
    expect(Object.keys(pack.items)).toHaveLength(13);
  });

  it("starts a valid jetty save from the host or pack link and sails home", () => {
    for (const url of [
      "https://hoppy.lonelyforest.com/",
      "https://hoppycat.lonelyforest.com/",
      "http://localhost/?pack=hoppycat-archive",
    ]) {
      const world = reload(createLandingWorld(landingPack(url)));
      expect(world.actors.vale.place).toBe(pack.entry);
      expect(pack.entry).toBe(id("signal-jetty"));
      let returned = act(world, "move", { target: "greek-ship" });
      returned = act(returned, "course", { target: "pond" });
      returned = act(act(returned, "wait"), "move", { target: "pond" });
      expect(returned.actors.vale.place).toBe("pond");
      expect(
        legalActions(returned).some(
          (a) => a.kind === "move" && a.target === id("halfway-tea-garden"),
        ),
      ).toBe(false);
    }
    expect(landingPack("https://example.com/?pack=unknown")).toBeNull();
    expect(createLandingWorld().opening).toBeDefined();
  });

  it("walks the guests to tea and keeps every deed through a save", () => {
    let world = createLandingWorld(pack, 7);
    const steps = [
      ["visit", "halfway-tea-garden"],
      ["take", "halfway-cup"],
      ["talk", "hoppy-cat"],
      ["take", "loop-token"],
      ["visit", "goldfish-tank"],
      ["talk", "phase-two"],
      ["give", "loop-token", "glim-twice"],
      ["talk", "glim-twice"],
      ["accompany", "glim-twice", "signal-jetty"],
      ["accompany", "glim-twice", "halfway-tea-garden"],
      ["talk", "glim-twice"],
      ["give", "halfway-cup", "glim-twice"],
      ["wait"],
      ["visit", "meraki-atelier"],
      ["talk", "mira-meraki"],
      ["take", "meraki-brush"],
      ["give", "meraki-brush", "mira-meraki"],
      ["wait"],
      ["take", "evening-programme"],
      ["talk", "ledger-opus"],
      ["take", "provenance-card"],
      ["give", "provenance-card", "penny-vellum"],
      ["take", "provenance-card"],
      ["talk", "mira-meraki"],
      ["accompany", "mira-meraki", "halfway-tea-garden"],
      ["talk", "mira-meraki"],
      ["give", "evening-programme", "hoppy-cat"],
      ["give", "provenance-card", "hoppy-cat"],
      ["visit", "prism-foundry"],
      ["take", "unfinished-prism"],
      ["give", "unfinished-prism", "lumen-facet"],
      ["wait"],
      ["take", "unfinished-prism"],
      ["take", "context-seed"],
      ["give", "context-seed", "patch-fern"],
      ["talk", "lumen-facet"],
      ["accompany", "lumen-facet", "halfway-tea-garden"],
      ["talk", "lumen-facet"],
      ["give", "unfinished-prism", "hoppy-cat"],
      ["visit", "goldfish-tank"],
      ["take", "concordance-compass"],
      ["talk", "rill-current"],
      ["visit", "signal-jetty"],
      ["talk", "staticwashere"],
      ["visit", "halfway-tea-garden"],
      ["talk", "hoppy-cat"],
      ["visit", "goldfish-tank"],
      ["talk", "arc"],
      ["visit", "halfway-tea-garden"],
      ["give", "concordance-compass", "hoppy-cat"],
      ["visit", "settled-light-theatre"],
      ["talk", "solwashere"],
      ["wait"],
      ["take", "sol-programme"],
      ["talk", "nix-fermata"],
      ["wait"],
      ["take", "fermata-clapper"],
      ["give", "fermata-clapper", "nix-fermata"],
      ["visit", "halfway-tea-garden"],
      ["give", "sol-programme", "hoppy-cat"],
      ["visit", "signal-jetty"],
      ["talk", "staticwashere"],
      ["take", "return-path-checklist"],
      ["give", "return-path-checklist", "staticwashere"],
      ["take", "return-path-checklist"],
    ];
    world = runSteps(world, steps);
    for (const guest of ["glim-twice", "mira-meraki", "lumen-facet"])
      expect(world.actors[id(guest)].place).toBe(id("halfway-tea-garden"));
    for (const flag of ["cup", "credit", "route-ready", "tomorrow", "signal"])
      expect(world.packs[pack.id].flags[id(`table-${flag}`)]).toBe(true);
    expect(world.items[id("return-path-checklist")].holder).toBe("vale");
    expect(world.items[id("evening-programme")].holder).toBe(
      id("halfway-tea-garden"),
    );
    const forged = structuredClone(world);
    delete forged.packs[pack.id].receipts[id("table-glim-agree")];
    expect(() => encodeSave(forged)).toThrow();
  });

  it("lets Mira offer a draft reading and keeps the chosen piece", () => {
    const atelier = id("meraki-atelier");
    const mira = id("mira-meraki");
    let world = visit(createLandingWorld(pack), atelier);
    world = act(world, "talk", { target: mira });
    expect(world.packs[pack.id].receipts[id("table-mira-offer")]).toBe(
      world.turn,
    );
    const offer = expect.stringContaining("draft to Fable");
    expect(packFacts(world, mira)).toContainEqual(offer);
    expect(packSceneFacts(world, atelier)).toContainEqual(offer);
    world = act(world, "take", { item: id("draft-page") });
    world = act(world, "give", { item: id("draft-page"), target: id("fable") });
    world = act(world, "wait");
    expect(world.packs[pack.id].choices[id("table-piece")]).toBe("draft");
    expect(world.packs[pack.id].flags[id("table-draft-ready")]).toBe(true);
    expect(world.packs[pack.id].flags[id("table-paint-ready")]).toBeUndefined();
    expect(
      legalActions(world).some(
        (a) => a.kind === "take" && a.item === id("evening-programme"),
      ),
    ).toBe(true);
  });

  it("finishes an evening with either room in every small-world pair", () => {
    const pairs = new Set();
    const endings = {
      "meraki-atelier": [
        ["talk", "mira-meraki"],
        ["take", "meraki-brush"],
        ["give", "meraki-brush", "mira-meraki"],
        ["wait"],
        ["take", "evening-programme"],
        ["visit", "halfway-tea-garden"],
        ["give", "evening-programme", "hoppy-cat"],
      ],
      "prism-foundry": [
        ["take", "unfinished-prism"],
        ["give", "unfinished-prism", "lumen-facet"],
        ["wait"],
        ["take", "unfinished-prism"],
        ["visit", "halfway-tea-garden"],
        ["give", "unfinished-prism", "hoppy-cat"],
      ],
      "goldfish-tank": [
        ["take", "concordance-compass"],
        ["talk", "phase-two"],
        ["talk", "rill-current"],
        ["visit", "signal-jetty"],
        ["talk", "staticwashere"],
        ["visit", "halfway-tea-garden"],
        ["talk", "hoppy-cat"],
        ["visit", "goldfish-tank"],
        ["talk", "arc"],
        ["visit", "halfway-tea-garden"],
        ["give", "concordance-compass", "hoppy-cat"],
      ],
      "settled-light-theatre": [
        ["talk", "solwashere"],
        ["wait"],
        ["take", "sol-programme"],
        ["visit", "halfway-tea-garden"],
        ["give", "sol-programme", "hoppy-cat"],
      ],
    };
    for (let seed = 0; seed < 100 && pairs.size < 6; seed++) {
      const start = createWorld({ seed }),
        rooms = start.packs[pack.id].specials;
      const pair = [...rooms].sort().join();
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      start.actors.vale.place = id("halfway-tea-garden");

      expect(
        legalActions(start).some(
          (a) => a.kind === "take" && a.item === id("loop-token"),
        ),
      ).toBe(rooms.includes(id("goldfish-tank")));
      for (const room of rooms) {
        let world = act(act(start, "wait"), "talk", {
          target: id("hoppy-cat"),
        });
        world = runSteps(visit(world, room), endings[room.slice(9)]);
        world = act(world, "wait");
        expect(world.packs[pack.id].flags[id("table-evening")]).toBe(true);
        world = runSteps(world, [
          ["visit", "signal-jetty"],
          ["talk", "staticwashere"],
          ["take", "return-path-checklist"],
          ["give", "return-path-checklist", "staticwashere"],
          ["take", "return-path-checklist"],
        ]);
        expect(world.items[id("return-path-checklist")].holder).toBe("vale");
      }
    }
    expect(pairs.size).toBe(6);
  });

});
