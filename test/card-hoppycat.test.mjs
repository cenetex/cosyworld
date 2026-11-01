import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
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

describe("Hoppy Cat refresh", () => {
  it("reuses every authored card identity and image", () => {
    const old = JSON.parse(
      readFileSync(
        new URL("../v2/content/hoppycat-archive/cards.json", import.meta.url),
      ),
    );
    expect(Object.keys(pack.places)).toHaveLength(10);
    expect(Object.keys(pack.avatars)).toHaveLength(16);
    expect(Object.keys(pack.items)).toHaveLength(10);
    for (const card of old) {
      const collection =
        card.subject_kind === "location"
          ? pack.places
          : card.subject_kind === "actor"
            ? pack.avatars
            : pack.items;
      expect(collection[card.card_id]).toBeDefined();
      const oldArt = readFileSync(
        new URL(
          `../v2/content/hoppycat-archive/assets/cards/${card.card_id}.webp`,
          import.meta.url,
        ),
      );
      const art = readFileSync(
        new URL(
          `../v2/card-game/assets/hoppycat-archive/${card.card_id}.webp`,
          import.meta.url,
        ),
      );
      expect(art.equals(oldArt)).toBe(true);
    }
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

  it("plays all three stories through legal actions and saves each completed step", () => {
    let world = createLandingWorld(pack);
    world = visit(world, id("red-thread-belfry"));
    world = act(world, "wait", { actor: "vale" });
    expect(world.packs[pack.id].receipts[id("pause")]).toBeUndefined();
    // No story buttons: each deed follows a meeting, a Wait or a Give.
    expect(legalActions(world).some((a) => a.kind === "choose")).toBe(false);
    for (const choice of pack.choices) {
      for (const requirement of choice.requires.filter(
        (r) => r.kind === "holding",
      )) {
        const item = requirement.item;
        world = visit(world, world.items[item].holder);
        world = act(world, "take", { item });
      }
      world = visit(world, choice.at);
      const held = choice.requires.find((r) => r.kind === "holding")?.item;
      if (choice.on === "give")
        world = act(world, "give", { item: held, target: choice.subject });
      else if (!world.packs[pack.id].receipts[choice.id])
        world = act(world, "wait", { actor: "vale" });
      expect(world.packs[pack.id].receipts[choice.id]).toBeTypeOf("number");
      for (const item of Object.keys(pack.items).filter(
        (i) => world.items[i].holder === "vale",
      ))
        world = act(world, "drop", { item });
    }
    expect(world.packs[pack.id].flags[id("signal")]).toBe(true);
    expect(world.items[id("fermata-clapper")].holder).toBe(
      id("red-thread-belfry"),
    );
    const forged = structuredClone(world);
    delete forged.packs[pack.id].receipts[id("record")];
    expect(() => encodeSave(forged)).toThrow();
  });

  it("requires the acting avatar to carry the tool", () => {
    let world = createLandingWorld(pack);
    world.items[id("halfway-cup")].holder = "mara";
    world = act(world, "wait", { actor: "vale" });
    expect(world.packs[pack.id].receipts[id("welcome")]).toBeUndefined();
    world.items[id("halfway-cup")].holder = "vale";
    world = act(world, "wait", { actor: "vale" });
    expect(world.packs[pack.id].flags[id("welcome")]).toBe(true);
  });

  it("keeps browser and bundled shared play in agreement", () => {
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
    // Taking the cup beside Hoppy Cat is the welcome.
    const action = view.actions.find(
      (a) => a.kind === "take" && a.item === id("halfway-cup"),
    );
    expect(action).toBeDefined();
    const command = { ...request, op: "play", action };
    expect(
      dispatchShared(command).world.packs[pack.id].flags[id("welcome")],
    ).toBe(true);
    // Dialogue context is narration, built outside the rules (narrator bundle).
    expect(ask(command)).toEqual(shipless(dispatchShared(command)));
  });
});
