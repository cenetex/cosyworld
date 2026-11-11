import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import {
  createLandingWorld,
  landingPack,
} from "../v2/card-game/pack-landing.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const pack = packDefinition("hoppycat-archive");
const id = (name) => `hoppycat-${name}`;
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeDefined();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.state));
}
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

  it("starts a valid garden save from the host or pack link and offers the way home", () => {
    for (const url of [
      "https://hoppy.lonelyforest.com/",
      "https://hoppycat.lonelyforest.com/",
      "http://localhost/?pack=hoppycat-archive",
    ]) {
      const world = decodeSave(
        encodeSave(createLandingWorld(landingPack(url))),
      );
      expect(world.actors.vale.place).toBe(pack.entry);
      const returned = act(world, "move", { target: "pond" });
      expect(returned.actors.vale.place).toBe("pond");
      // The red thread from Black pond is retired; new games sail to the jetty.
      expect(
        legalActions(returned).some(
          (a) => a.kind === "move" && a.target === pack.entry,
        ),
      ).toBe(false);
    }
    expect(landingPack("https://example.com/?pack=unknown")).toBeNull();
    expect(createLandingWorld().opening).toBeDefined();
  });

  it("walks the guests to tea and keeps every deed through a save", () => {
    let world = createLandingWorld(pack, 7);
    const steps = [
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
      expect(world.actors[id(guest)].place).toBe(pack.entry);
    for (const flag of ["cup", "credit", "route-ready", "tomorrow", "signal"])
      expect(world.packs[pack.id].flags[id(`table-${flag}`)]).toBe(true);
    expect(world.items[id("return-path-checklist")].holder).toBe("vale");
    expect(world.items[id("evening-programme")].holder).toBe(pack.entry);
    const forged = structuredClone(world);
    delete forged.packs[pack.id].receipts[id("table-glim-agree")];
    expect(() => encodeSave(forged)).toThrow();
  });

  it("lets Mira offer a draft reading and keeps the chosen piece", () => {
    let world = visit(createLandingWorld(pack), id("meraki-atelier"));
    world = act(world, "talk", { target: id("mira-meraki") });
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
      start.actors.vale.place = pack.entry;

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

  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("moves earlier rooms and keeps held things, friendships and completed deeds", () => {
    const runtime = currentSharedEngine();
    for (const file of ["visit", "small", "completed"]) {
      const text = readFileSync(
        new URL(`./fixtures/hoppycat-v3/${file}.json`, import.meta.url),
        "utf8",
      );
      const request = { op: "create", save: text };
      expect(JSON.parse(runtime.cardShared(JSON.stringify(request)))).toEqual(
        dispatchShared(request),
      );
      const old = JSON.parse(text),
        world = decodeSave(text);
      expect(world.packs[pack.id].revision).toBe(4);
      expect(world.actors.vale.trust).toEqual({
        ...Object.fromEntries(
          Object.keys(createWorld().actors)
            .filter((id) => id !== "vale")
            .map((id) => [id, 0]),
        ),
        ...old.actors.vale.trust,
        "greek-polynices-shade": 0,
      });
      for (const [key, turn] of Object.entries(old.packs[pack.id].receipts))
        expect(world.packs[pack.id].receipts[key]).toBe(turn);
      for (const [key, item] of Object.entries(old.items).filter(
        ([, v]) => v.holder === "vale",
      ))
        expect(world.items[key]).toEqual(item);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    }
  });

  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("keeps browser and bundled shared play in agreement", () => {
    const runtime = currentSharedEngine();
    // Released rules saved version 2 ships; the current rules sail version 3.
    const v2 = (world) =>
      world && {
        ...world,
        transports: Object.fromEntries(
          Object.entries(world.transports).map(([id, t]) => [
            id,
            { version: 2, dock: t.dock, destination: null, recall: t.recall },
          ]),
        ),
      };
    const shipless = (out) =>
      out.world ? { ...out, world: { ...out.world, transports: null } } : out;
    const ask = (request) =>
      shipless(
        JSON.parse(
          runtime.cardShared(
            JSON.stringify({ ...request, world: v2(request.world) }),
          ),
        ),
      );
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createLandingWorld(pack)),
    }).world;
    const request = {
      op: "view",
      world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
    };
    const view = dispatchShared(request);
    expect(ask(request)).toEqual(shipless(view));
    // Taking the cup reveals the company at the table.
    const action = view.actions.find(
      (a) => a.kind === "take" && a.item === id("halfway-cup"),
    );
    expect(action).toBeDefined();
    const command = { ...request, op: "play", action };
    // Dialogue context is narration, built outside the rules (narrator bundle).
    expect(ask(command)).toEqual(shipless(dispatchShared(command)));
  });
});
