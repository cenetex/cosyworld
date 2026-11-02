// A transport names the Wait played aboard while under way (waitVerb and
// waitSentence): the Greek ship's reads Sail. Packs without the pair keep Wait.
import { describe, expect, it } from "vitest";
import {
  cardActions,
  playLabel,
  playText,
  restPlays,
} from "../v2/card-game/cards.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import {
  hub,
  packDefinition,
  packDefinitions,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems, waitWordsOk } from "../v2/card-game/pack-schema.mjs";

const mounted = packDefinitions.flatMap((p) => Object.keys(p.places));
const problems = (pack) => packProblems(pack, hub, mounted);

describe("transport wait words in the pack schema", () => {
  it("accepts the Greek ship's pair and a pack without one", () => {
    const pack = structuredClone(packDefinition("greek-drama"));
    expect(pack.transports["greek-ship"]).toMatchObject({
      waitVerb: "Sail",
      waitSentence: "{actor} sails on.",
    });
    expect(problems(pack)).toEqual([]);
    delete pack.transports["greek-ship"].waitVerb;
    delete pack.transports["greek-ship"].waitSentence;
    expect(problems(pack)).toEqual([]);
  });
  it("rejects a half pair, markup, long words and a missing actor", () => {
    for (const bad of [
      { waitVerb: "Sail" },
      { waitSentence: "{actor} sails on." },
      { waitVerb: "<b>Sail</b>", waitSentence: "{actor} sails on." },
      { waitVerb: "sail", waitSentence: "{actor} sails on." },
      { waitVerb: "S".repeat(25), waitSentence: "{actor} sails on." },
      { waitVerb: "Sail", waitSentence: "{actor} <i>sails</i> on." },
      { waitVerb: "Sail", waitSentence: "The ship sails on." },
      { waitVerb: "Sail", waitSentence: "{actor} and {actor} sail." },
      { waitVerb: "Sail", waitSentence: "{actor} sails to {place}." },
      { waitVerb: "Sail", waitSentence: `{actor} ${"x".repeat(80)}` },
      { waitVerb: 3, waitSentence: "{actor} sails on." },
    ]) {
      expect(waitWordsOk(bad)).toBe(false);
      const pack = structuredClone(packDefinition("greek-drama"));
      const ship = pack.transports["greek-ship"];
      delete ship.waitVerb;
      delete ship.waitSentence;
      Object.assign(ship, bad);
      expect(problems(pack).join(" ")).toContain("waitVerb");
    }
  });
});

describe("the table reads the transport's wait words", () => {
  const shown = (world, cards) =>
    restPlays(world, cardActions(world, cards).actions, false);
  function voyage() {
    let world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-harbor";
    const step = (pick) =>
      (world = play(world, legalActions(world).find(pick)).state);
    step((a) => a.kind === "move" && a.target === "greek-ship");
    const docked = world;
    step((a) => a.target === "pond" && a.kind !== "wait");
    return { docked, atSea: world };
  }
  it("shows Sail at sea from the data and Wait while docked", () => {
    const { docked, atSea } = voyage();
    expect(shown(docked, ["greek-ship"]).map(playLabel)).toEqual(["Wait"]);
    const [sail] = shown(atSea, ["greek-ship"]);
    expect([playLabel(sail), playText(sail), sail.kind]).toEqual([
      "Sail",
      "Vale sails on.",
      "wait",
    ]);
  });
  it("keeps Wait aboard a transport without wait words", () => {
    const { atSea } = voyage();
    const ship = transports["greek-ship"];
    const saved = { ...ship };
    delete ship.waitVerb;
    delete ship.waitSentence;
    try {
      const [wait] = shown(atSea, ["greek-ship"]);
      expect([playLabel(wait), playText(wait)]).toEqual(["Wait", wait.text]);
    } finally {
      Object.assign(ship, saved);
    }
  });
});
