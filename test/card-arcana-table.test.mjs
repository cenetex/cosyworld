import { describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { availableCards, shutBoxes } from "../v2/card-game/cards.mjs";
import {
  entityActive,
  packEntity,
  packGroup,
} from "../v2/card-game/pack-registry.mjs";
import {
  candidates,
  recordOf,
  spreadCards,
} from "../v2/card-game/world/arcana.mjs";
import {
  createWorld,
  decodeSave,
  humanAvatarIds,
  legalActions,
  play,
  rootHolder,
  seedRun,
  validateWorld,
} from "../v2/card-game/world.mjs";

const cards = data.cards.map((card) => card.id);
const CARD = cards[0];
const lying = (s) =>
  Object.fromEntries(cards.map((id) => [id, s.items[id]?.holder]));
const regionOf = (place) => packEntity(place)?.packId ?? "hub";
const first = () => 0;
const spots = (regions, each) =>
  regions.flatMap((region) =>
    Array.from({ length: each }, (_, i) => ({
      place: `${region}-${i}`,
      region,
    })),
  );
const takes = (s, who, id) =>
  legalActions(s, who).filter((a) => a.kind === "take" && a.item === id);
const carried = (s, who) =>
  Object.keys(s.items).filter((id) => rootHolder(s, id) === who).length;

function proved(seed = 5, who = "vale") {
  const s = createWorld({ seed });
  s.items[CARD].holder = s.actors[who].place;
  s.actors[who].arcana = { proved: [CARD], held: [], did: [] };
  return s;
}

function shared(s, other) {
  s.sharedVersion = 1;
  s.controlledActors = ["vale", other];
  s.presentActors = ["vale", other];
  s.heldActors = ["vale", other];
  s.actors[other].place = s.actors.vale.place;
  return s;
}

describe("spreading the cards", () => {
  it("gives each card its own region while regions allow", () => {
    const out = spreadCards(["a", "b", "c"], spots(["x", "y", "z"], 2), first);
    expect(new Set(Object.values(out).map((p) => p.slice(0, 1))).size).toBe(3);
  });

  it("starts a second round only when every region holds one", () => {
    const out = spreadCards(
      ["a", "b", "c", "d"],
      spots(["x", "y", "z"], 2),
      first,
    );
    const regions = Object.values(out).map((p) => p.slice(0, 1));
    expect(new Set(regions.slice(0, 3)).size).toBe(3);
    expect(new Set(Object.values(out)).size).toBe(4);
  });

  it("uses a free spot before a spot that holds a card", () => {
    const out = spreadCards(["a", "b", "c"], spots(["x"], 3), first);
    expect(new Set(Object.values(out)).size).toBe(3);
  });

  it("counts the cards that already lie", () => {
    const out = spreadCards(["a", "b"], spots(["x", "y"], 2), first, {
      a: "x-0",
    });
    expect(out).toEqual({ b: "y-0" });
  });

  it("follows the pick", () => {
    const last = (key, n) => n - 1;
    expect(spreadCards(["a"], spots(["x", "y"], 2), last)).toEqual({
      a: "y-1",
    });
  });
});

describe("the cards in a world", () => {
  it("lie at the same plain places for the same seed", () => {
    const s = createWorld({ seed: 11 });
    const places = candidates(s, "place");
    expect(lying(s)).toEqual(lying(createWorld({ seed: 11 })));
    for (const id of cards) expect(places).toContain(s.items[id].holder);
    expect(validateWorld(s)).toBe(s);
  });

  it("use as many regions as the cards and regions allow", () => {
    const s = createWorld({ seed: 11 });
    const regions = new Set(candidates(s, "place").map(regionOf));
    const used = new Set(Object.values(lying(s)).map(regionOf));
    expect(used.size).toBe(Math.min(cards.length, regions.size));
  });

  it("move to the seed's places when a world is seeded later", () => {
    const s = seedRun(createWorld(), 11);
    expect(lying(s)).toEqual(lying(createWorld({ seed: 11 })));
  });

  it("join an older world at the same places", () => {
    const s = createWorld({ seed: 11 });
    const before = lying(s);
    for (const id of cards) {
      delete s.items[id];
      delete s.memories[id];
    }
    const loaded = decodeSave(JSON.stringify(s));
    expect(lying(loaded)).toEqual(before);
    for (const id of cards) expect(loaded.memories[id]).toBeTruthy();
    expect(validateWorld(loaded)).toBe(loaded);
  });
});

describe("a shut card", () => {
  it("is not in play and cannot be taken", () => {
    const s = createWorld({ seed: 5 });
    s.items[CARD].holder = s.actors.vale.place;
    expect(entityActive(s, CARD)).toBe(false);
    expect(takes(s, "vale", CARD)).toEqual([]);
  });
});

describe("a proved card", () => {
  it("can be taken by its traveler with a full hand", () => {
    const s = proved();
    for (const id of ["lamp", "oil", "bell"]) s.items[id].holder = "vale";
    expect(entityActive(s, CARD)).toBe(true);
    expect(availableCards(s)).toContain(CARD);
    expect(takes(s, "vale", CARD)).toHaveLength(1);
  });

  it("is shut for a second traveler and for a resident", () => {
    const other = humanAvatarIds.find((id) => id !== "vale");
    const s = shared(proved(), other);
    const resident = Object.keys(s.actors).find(
      (id) => !humanAvatarIds.includes(id),
    );
    s.actors[resident].place = s.actors.vale.place;
    expect(takes(s, other, CARD)).toEqual([]);
    expect(takes(s, resident, CARD)).toEqual([]);
    s.playerActorId = other;
    expect(entityActive(s, CARD)).toBe(false);
  });

  it("is recorded when taken and stays where it lies", () => {
    const s = proved();
    const place = s.items[CARD].holder;
    const hand = carried(s, "vale");
    const xp = s.actors.vale.xp;
    const result = play(s, takes(s, "vale", CARD)[0], s.revision, "vale");
    expect(result.ok).toBe(true);
    const next = result.state;
    expect(recordOf(next, "vale").held).toEqual([CARD]);
    expect(next.items[CARD].holder).toBe(place);
    expect(entityActive(next, CARD)).toBe(false);
    expect(takes(next, "vale", CARD)).toEqual([]);
    expect(carried(next, "vale")).toBe(hand);
    expect(next.actors.vale.xp).toBe(xp);
    expect(validateWorld(next)).toBe(next);
  });

  it("is shut while its place is asleep", () => {
    const s = createWorld({ seed: 5 });
    const id = cards.find((card) => packGroup(regionOf(s.items[card].holder)));
    s.actors.vale.arcana = { proved: [id], held: [], did: [] };
    expect(entityActive(s, id)).toBe(true);
    s.disabledPacks = [packGroup(regionOf(s.items[id].holder))];
    expect(entityActive(s, id)).toBe(false);
  });
});
