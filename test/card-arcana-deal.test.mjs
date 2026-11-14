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
  dealtCard,
  deck,
  deckOrder,
  dreamCard,
  nextCard,
  recordOf,
  settleArcana,
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
  it("deals the Fool first once the opening is crossed, and not during it", () => {
    const s = createWorld({ opening: true, seed: 5 });
    expect(s.opening.crossed).toBe(false);
    settleArcana(s, "vale");
    expect(s.actors.vale.arcana).toBeUndefined();
    s.opening.crossed = true;
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").dealt).toBe(FOOL);
    const t = createWorld({ seed: 5 });
    const wait = legalActions(t, "vale").find((a) => a.kind === "wait");
    const next = play(t, wait, t.revision, "vale").state;
    expect(recordOf(next, "vale").dealt).toBe(FOOL);
    expect(dealtCard(next, "vale").card.id).toBe(FOOL);
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

  it("deals the World only when nothing else can be dealt", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [
      card(0, [here(s)]),
      card(2, [here(s)], UNBOUND),
      card(3, [{ kind: "count", of: "heard", min: 999 }]),
      card(21, [here(s)]),
    ];
    expect(nextCard(s, "vale")).toBe(FOOL);
    s.actors.vale.arcana = { proved: [FOOL], did: [] };
    expect(nextCard(s, "vale")).toBe(WORLD);
    deck.cards.push(card(4, [here(s)]));
    expect(nextCard(s, "vale")).toBe("arcanum-4");
  });

  it("skips a card whose roles cannot be bound", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(0, [here(s)], UNBOUND), card(1, [here(s)])];
    expect(dealable(s, deck.cards[0], "vale")).toBe(false);
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").dealt).toBe("arcanum-1");
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

  it("moves a dealt card's place out of a pack switched off", () => {
    const s = createWorld({ seed: 3 });
    deck.cards = data.cards.filter((c) => c.id === "arcanum-4");
    s.actors.vale.arcana = { proved: [], did: [], dealt: "arcanum-4" };
    const before = dealtCard(s, "vale").binding.place;
    s.disabledPacks = [packGroupOf(before)];
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").dealt).toBe("arcanum-4");
    const after = dealtCard(s, "vale").binding.place;
    expect(after).not.toBe(before);
    expect(packOn(s, packIdOf(after))).toBe(true);
  });

  it("drops a dealt card that can no longer come true and deals the next", () => {
    const s = createWorld({ seed: 3 });
    deck.cards = [
      card(0, [{ kind: "count", of: "heard", min: 10 }]),
      card(1, [{ kind: "actor_at", place: "nowhere-near" }]),
    ];
    settleArcana(s, "vale");
    expect(recordOf(s, "vale")).toMatchObject({
      dealt: FOOL,
      base: { heard: 0 },
    });
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").dealt).toBe(FOOL);
    s.disabledPacks = ["hoppy", "radio", "sea"];
    settleArcana(s, "vale");
    expect(recordOf(s, "vale")).toMatchObject({
      dealt: "arcanum-1",
      proved: [],
    });
    delete s.disabledPacks;
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").dealt).toBe("arcanum-1");
  });

  it("proves a card true when dealt only on a later settle", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(0, [here(s)])];
    settleArcana(s, "vale");
    expect(recordOf(s, "vale")).toMatchObject({ dealt: FOOL, proved: [] });
    settleArcana(s, "vale");
    expect(recordOf(s, "vale")).toMatchObject({ dealt: null, proved: [FOOL] });
  });

  it("counts a min from the deal", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(0, [{ kind: "count", of: "visited", min: 1 }])];
    s.actors.vale.visited = ["attic", "station"];
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").base).toEqual({ visited: 2 });
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toEqual([]);
    s.actors.vale.visited.push("pond");
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toEqual([FOOL]);
  });

  it("proves at most one card each settle", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(0, [here(s)]), card(1, [here(s)])];
    s.actors.vale.arcana = { proved: [], did: [], dealt: FOOL };
    settleArcana(s, "vale");
    expect(s.actors.vale.arcana).toEqual({
      proved: [FOOL],
      did: [],
      dealt: "arcanum-1",
    });
    settleArcana(s, "vale");
    expect(s.actors.vale.arcana).toEqual({
      proved: [FOOL, "arcanum-1"],
      did: [],
    });
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toHaveLength(2);
  });

  it("deals the next card on a proof and clears its deeds", () => {
    const s = createWorld({ seed: 5 });
    deck.cards = [card(0, [here(s)]), card(1, [waited]), card(2, [waited])];
    s.actors.vale.arcana = { proved: [], did: ["kept", "waited"], dealt: FOOL };
    expect(dreamCard(s, "vale")).toBe(nextCard(s, "vale", FOOL));
    expect(dreamCard(s, "vale")).not.toBe(FOOL);
    settleArcana(s, "vale");
    const record = recordOf(s, "vale");
    expect(record.proved).toEqual([FOOL]);
    expect(record.dealt).not.toBeNull();
    expect(record.did).toEqual(["kept"]);
  });

  it("keeps a second traveler's deal apart", () => {
    const s = createWorld({ seed: 5 });
    s.sharedVersion = 1;
    s.controlledActors = ["vale", other];
    s.presentActors = ["vale", other];
    s.heldActors = ["vale", other];
    deck.cards = [card(0, [here(s)]), card(1, [here(s)])];
    s.actors[other].place = "nowhere-near";
    settleArcana(s, "vale");
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toEqual([FOOL]);
    expect(recordOf(s, other)).toMatchObject({ proved: [], dealt: FOOL });
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
  it("loses the cards, keeps what was proved and deals again", () => {
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
    });
    expect(validateWorld(loaded)).toBe(loaded);
    settleArcana(loaded, "vale");
    expect(recordOf(loaded, "vale").dealt).not.toBe(FOOL);
    expect(recordOf(loaded, "vale").dealt).not.toBeNull();
  });

  it("drops a deal the content no longer has", () => {
    const s = createWorld({ seed: 5 });
    s.actors.vale.arcana = { proved: [FOOL], did: [], dealt: FOOL };
    expect(() => validateWorld(s)).toThrow();
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.actors.vale.arcana).toEqual({ proved: [FOOL], did: [] });
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
