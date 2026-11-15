import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import {
  latchingRoute,
  packDefinitions,
  packIdOf,
  packOn,
} from "../v2/card-game/pack-registry.mjs";
import {
  candidates,
  dealable,
  deck,
  deckOrder,
  dreamCard,
  nextSpread,
  recordOf,
  settleArcana,
  spreadOf,
} from "../v2/card-game/world/arcana.mjs";
import { boxDefs, boxesAt } from "../v2/card-game/world/boxes.mjs";
import {
  createWorld,
  decodeSave,
  humanAvatarIds,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";

const FOOL = "arcanum-0";
const packGroupOf = (place) =>
  ["sea", "hoppy", "radio", "cottage", "shore"].find(
    (g) => !packOn({ disabledPacks: [g] }, packIdOf(place)),
  );
const WORLD = "arcanum-21";
const other = humanAvatarIds.find((id) => id !== "vale");
const here = (s) => ({ kind: "actor_at", place: s.actors.vale.place });
const card = (number, proof, extra = {}) => ({
  id: `arcanum-${number}`,
  number,
  proof,
  ...extra,
});
const UNBOUND = {
  roles: [{ name: "place", kind: "place", is: "food" }],
  desire: [{ kind: "place", target: "$place" }],
};
const waited = {
  kind: "did",
  key: "waited",
  match: { verb: "wait", actorId: "$traveler" },
};

afterEach(() => {
  deck.cards = data.cards;
});

describe("the deal", () => {
  it("deals nothing on its own, during the opening or after it", () => {
    const s = createWorld({ opening: true, seed: 5 });
    settleArcana(s, "vale");
    expect(s.actors.vale.arcana).toBeUndefined();
    s.opening.crossed = true;
    settleArcana(s, "vale");
    expect(s.actors.vale.arcana).toBeUndefined();
    const t = createWorld({ seed: 5 });
    const wait = legalActions(t, "vale").find((a) => a.kind === "wait");
    const next = play(t, wait, t.revision, "vale").state;
    expect(next.actors.vale.arcana).toBeUndefined();
    expect(() => validateWorld(next)).not.toThrow();
  });

  it("keeps one order per seed and traveler, Fool first and World last", () => {
    const orders = new Set();
    for (const seed of [1, 2, 3, 4])
      for (const who of ["vale", other]) {
        const order = deckOrder(createWorld({ seed }), who);
        expect(deckOrder(createWorld({ seed }), who)).toEqual(order);
        expect(order[0]).toBe(FOOL);
        expect(order.at(-1)).toBe(WORLD);
        expect([...order].sort()).toEqual(data.cards.map((c) => c.id).sort());
        orders.add(order.join());
      }
    expect(orders.size).toBeGreaterThan(1);
    const s = createWorld({ seed: 1 });
    const seeds = [2, 3, 4, 5, 6].map((seed) =>
      deckOrder(createWorld({ seed }), "vale").join(),
    );
    expect(seeds.some((order) => order !== deckOrder(s, "vale").join())).toBe(
      true,
    );
    const travelers = humanAvatarIds.map((who) => deckOrder(s, who).join());
    expect(new Set(travelers).size).toBeGreaterThan(1);
  });

  it("skips a card whose roles cannot be bound", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(1, [here(s)], UNBOUND), card(2, [here(s)])];
    expect(dealable(s, deck.cards[0], "vale")).toBe(false);
    expect(nextSpread(s, "vale")).toEqual([
      { card: "arcanum-2", face: "locked" },
    ]);
  });

  it("skips a card whose count cannot rise that far in this world", () => {
    const s = createWorld({ seed: 5 });
    const heard = (min) => card(1, [{ kind: "count", of: "heard", min }]);
    expect(dealable(s, heard(3), "vale")).toBe(true);
    expect(dealable(s, heard(999), "vale")).toBe(false);
    const opened = card(1, [{ kind: "count", of: "opened", min: 1 }]);
    expect(dealable(s, opened, "vale")).toBe(true);
    s.opened = Object.fromEntries(boxDefs().map((def) => [def.id, ["vale"]]));
    expect(dealable(s, opened, "vale")).toBe(false);
  });

  it("binds and counts nothing in a pack switched off", () => {
    const s = createWorld({ seed: 3 });
    const emperor = data.cards.find((c) => c.id === "arcanum-4");
    const heard = card(1, [{ kind: "count", of: "heard", min: 10 }]);
    expect(dealable(s, heard, "vale")).toBe(true);
    s.disabledPacks = ["hoppy", "radio", "sea"];
    for (const kind of ["place", "resident", "item"])
      for (const id of candidates(s, kind))
        expect(packOn(s, packIdOf(id)), id).toBe(true);
    expect(candidates(s, "place", "sanctuary").length).toBeGreaterThan(0);
    expect(dealable(s, emperor, "vale")).toBe(true);
    expect(dealable(s, heard, "vale")).toBe(false);
    const opened = card(1, [{ kind: "count", of: "opened", min: 1 }]);
    s.opened = Object.fromEntries(
      boxDefs()
        .filter((def) => packOn(s, packIdOf(def.at)))
        .map((def) => [def.id, ["vale"]]),
    );
    expect(dealable(s, opened, "vale")).toBe(false);
  });

  it("keeps a held card's place in a pack switched off", () => {
    const s = createWorld({ seed: 3 });
    deck.cards = data.cards.filter((c) => c.id === "arcanum-4");
    s.actors.vale.arcana = {
      proved: [],
      did: [],
      spread: [{ card: "arcanum-4", face: "up" }],
    };
    settleArcana(s, "vale");
    const before = spreadOf(s, "vale")[0].binding.place;
    s.disabledPacks = [packGroupOf(before)];
    settleArcana(s, "vale");
    expect(spreadOf(s, "vale")[0].binding.place).toBe(before);
  });

  it("dreams of a middle card not unlocked and not held", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(0, [here(s)]), card(1, [waited]), card(2, [waited])];
    s.actors.vale.upgrades = ["arcanum-1"];
    expect(dreamCard(s, "vale")).toBe("arcanum-2");
    s.actors.vale.arcana = {
      proved: [],
      did: [],
      spread: [{ card: "arcanum-2", face: "locked" }],
    };
    expect(dreamCard(s, "vale")).toBeNull();
  });

  it("keeps a second traveler's spread apart", () => {
    const s = createWorld({ seed: 5 });
    s.sharedVersion = 1;
    s.controlledActors = ["vale", other];
    s.presentActors = ["vale", other];
    s.heldActors = ["vale", other];
    deck.cards = [card(1, [here(s)])];
    for (const who of ["vale", other])
      s.actors[who].arcana = {
        proved: [],
        did: [],
        spread: [{ card: "arcanum-1", face: "up" }],
      };
    s.actors[other].place = "nowhere-near";
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toEqual(["arcanum-1"]);
    expect(recordOf(s, other)).toMatchObject({
      proved: [],
      spread: [{ card: "arcanum-1", face: "up" }],
    });
  });

  it("lays no card in the world and opens no box for one", () => {
    const s = createWorld({ seed: 5 });
    for (const { id } of data.cards) {
      expect(s.items[id]).toBeUndefined();
      expect(s.memories[id]).toBeUndefined();
    }
    const places = Object.keys(s.locations);
    for (const place of places)
      expect(
        boxesAt(s, place, "vale").filter((box) => box.id.startsWith("arcanum")),
      ).toEqual([]);
  });
});

describe("a world saved with the cards on the table", () => {
  it("loses the cards and keeps what was proved", () => {
    const s = createWorld({ seed: 5 });
    const at = s.actors.vale.place;
    s.items[FOOL] = { holder: at, history: [] };
    s.items["arcanum-4"] = { holder: "pond", history: [] };
    s.memories[FOOL] = structuredClone(s.memories.lamp);
    s.actors.vale.arcana = { proved: [FOOL], held: [FOOL], did: ["long-rest"] };
    const seq = s.log.at(-1).seq + 1;
    s.log.push({
      ...structuredClone(s.log.at(-1)),
      seq,
      kind: "action",
      verb: "take",
      actorId: "vale",
      locationId: at,
      itemId: FOOL,
      text: "Vale takes the The Fool.",
    });
    s.eventSeq = seq;
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.items[FOOL]).toBeUndefined();
    expect(loaded.items["arcanum-4"]).toBeUndefined();
    expect(loaded.memories[FOOL]).toBeUndefined();
    expect(loaded.log.some((entry) => entry.itemId === FOOL)).toBe(false);
    expect(loaded.actors.vale.arcana).toEqual({
      proved: [FOOL],
      did: ["long-rest"],
      level: 1,
    });
    expect(loaded.actors.vale.upgrades).toContain(FOOL);
    expect(validateWorld(loaded)).toBe(loaded);
  });

  it("puts a dealt card back in the deck", () => {
    const s = createWorld({ seed: 5 });
    s.actors.vale.arcana = { proved: [FOOL], did: [], dealt: FOOL };
    expect(() => validateWorld(s)).toThrow();
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.actors.vale.arcana).toEqual({
      proved: [FOOL],
      did: [],
      level: 1,
    });
  });
});

describe("a world that opened something the content no longer has", () => {
  const route = packDefinitions
    .flatMap((pack) => pack.routes || [])
    .map((r) => `${r.from}>${r.to}`)
    .filter(latchingRoute)
    .sort()[0];
  const box = boxDefs()[0].id;

  it("drops the gone latches on load and keeps the real ones", () => {
    const s = createWorld({ seed: 5 });
    s.openedRoutes = [route, "item:gone-thing"].sort();
    s.opened = { [box]: ["vale"], "gone-thing": ["vale"] };
    expect(() => validateWorld(s)).toThrow();
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.openedRoutes).toEqual([route]);
    expect(loaded.opened).toEqual({ [box]: ["vale"] });
  });

  it("removes a list that ends empty", () => {
    const s = createWorld({ seed: 5 });
    s.openedRoutes = ["item:gone-thing"];
    s.opened = { "gone-thing": ["vale"] };
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.openedRoutes).toBeUndefined();
    expect(loaded.opened).toBeUndefined();
  });
});

describe("the packs", () => {
  it("author no arcanum of their own", () => {
    const ids = packDefinitions.flatMap((pack) =>
      Object.keys(pack.items || {}),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.includes("arcanum"))).toEqual([]);
  });
});
