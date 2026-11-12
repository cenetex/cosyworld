import { describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import {
  bindingOf,
  candidates,
  holds,
  isArcanum,
  proves,
  recordOf,
  resolve,
} from "../v2/card-game/world/arcana.mjs";
import { createWorld } from "../v2/card-game/world.mjs";

function world(seed = 1) {
  return {
    run: { seed },
    turn: 10,
    locations: { yard: {}, mill: {} },
    actors: {
      walker: { place: "yard", visited: ["yard"] },
      ash: { place: "yard", trust: { walker: 2 } },
      bo: { place: "yard", trust: { walker: 2 } },
      cy: { place: "mill", trust: { walker: 1 } },
    },
    items: {
      coin: { holder: "cy" },
      cup: { holder: "mill" },
    },
    log: [],
  };
}
const me = { traveler: "walker" };
const count = (of, rest) => ({ kind: "count", of, ...rest });

describe("count conditions", () => {
  it("counts what the traveler carries, through any holder chain", () => {
    const s = world();
    expect(holds(s, count("carried", { max: 0 }), me)).toBe(true);
    s.items.bag = { holder: "walker" };
    s.items.coin.holder = "bag";
    expect(holds(s, count("carried", { max: 0 }), me)).toBe(false);
    expect(holds(s, count("carried", { min: 2, max: 2 }), me)).toBe(true);
    expect(holds(s, count("carried", { max: 1 }), me)).toBe(false);
    expect(holds(s, count("carried", { min: 3 }), me)).toBe(false);
  });
  it("counts places visited, wants heard and upgrades worn", () => {
    const s = world();
    expect(holds(s, count("visited", { min: 2 }), me)).toBe(false);
    s.actors.walker.visited.push("mill");
    expect(holds(s, count("visited", { min: 2 }), me)).toBe(true);
    expect(holds(s, count("heard", { min: 1 }), me)).toBe(false);
    s.actors.walker.heard = { ash: "item:coin" };
    expect(holds(s, count("heard", { min: 1 }), me)).toBe(true);
    expect(holds(s, count("upgrades", { min: 1 }), me)).toBe(false);
    s.actors.walker.upgrades = ["scarf"];
    expect(holds(s, count("upgrades", { min: 1 }), me)).toBe(true);
  });
  it("counts residents who trust the traveler at a level", () => {
    const s = world();
    expect(holds(s, count("trusting", { min: 3 }), me)).toBe(true);
    expect(holds(s, count("trusting", { level: 2, min: 2 }), me)).toBe(true);
    expect(holds(s, count("trusting", { level: 2, min: 3 }), me)).toBe(false);
    expect(holds(s, count("trusting", { level: 3, min: 1 }), me)).toBe(false);
    s.motives = { grievances: { bo: [{ other: "walker", turn: 9 }] } };
    expect(holds(s, count("trusting", { level: 2, min: 2 }), me)).toBe(false);
    s.motives.grievances.bo[0].repaired = true;
    expect(holds(s, count("trusting", { level: 2, min: 2 }), me)).toBe(true);
  });
  it("counts a companion and the arcana held", () => {
    const s = world();
    expect(holds(s, count("company", { min: 1 }), me)).toBe(false);
    s.actors.walker.companion = "ash";
    expect(holds(s, count("company", { min: 1 }), me)).toBe(true);
    expect(holds(s, count("arcana", { min: 1 }), me)).toBe(false);
    s.actors.walker.arcana = { proved: ["a", "b"], held: ["a"], did: [] };
    expect(holds(s, count("arcana", { min: 1 }), me)).toBe(true);
    expect(holds(s, count("arcana", { min: 2 }), me)).toBe(false);
  });
});

describe("joined conditions", () => {
  const yes = count("visited", { min: 1 }),
    no = count("visited", { min: 9 });
  it("nests not, any and all", () => {
    const s = world();
    const not = (condition) => ({ kind: "not", condition });
    const join = (kind, ...conditions) => ({ kind, conditions });
    expect(holds(s, not(no), me)).toBe(true);
    expect(holds(s, join("any", no, yes), me)).toBe(true);
    expect(holds(s, join("all", no, yes), me)).toBe(false);
    expect(holds(s, join("all", yes, join("any", no, not(no))), me)).toBe(true);
    expect(holds(s, not(join("any", no, not(yes))), me)).toBe(true);
  });
  it("sends any other kind to the shared reader with the traveler as actor", () => {
    const s = world();
    const at = { kind: "actor_at", place: "$home" };
    expect(holds(s, at, { ...me, home: "yard" })).toBe(true);
    expect(holds(s, at, { ...me, home: "mill" })).toBe(false);
    s.playerActorId = "cy";
    expect(holds(s, at, { ...me, home: "mill" })).toBe(false);
  });
});

describe("did conditions", () => {
  const did = { kind: "did", key: "walked", match: { verb: "move" } };
  it("reads only the traveler's latch, never the journal", () => {
    const s = world();
    s.log.push({ seq: 1, verb: "move", actorId: "walker" });
    expect(holds(s, did, me)).toBe(false);
    s.actors.walker.arcana = { proved: [], held: [], did: ["walked"] };
    s.log = [];
    expect(holds(s, did, me)).toBe(true);
    expect(holds(s, did, { traveler: "ash" })).toBe(false);
  });
  it("reads an absent record as empty and does not write one", () => {
    const s = world();
    expect(recordOf(s, "walker")).toEqual({ proved: [], held: [], did: [] });
    expect(s.actors.walker.arcana).toBeUndefined();
  });
});

describe("roles", () => {
  const card = {
    id: "card",
    roles: [
      { name: "someone", kind: "resident" },
      { name: "other", kind: "resident" },
      { name: "thing", kind: "item", is: "food" },
    ],
    proof: [
      { kind: "did", key: "k", match: { targetId: "$someone", itemId: "$thing" } },
    ],
    desire: [{ kind: "person", target: "$other" }],
  };
  const pool = (s, kind, is) =>
    kind === "item" ? (is === "food" ? ["pie", "bun"] : []) : ["cy", "bo", "ash"];
  it("fills each role from the seed, the same every time", () => {
    const first = bindingOf(world(3), card, "walker", pool);
    expect(bindingOf(world(3), card, "walker", pool)).toEqual(first);
    expect(first.traveler).toBe("walker");
    expect(["ash", "bo", "cy"]).toContain(first.someone);
    expect(["bun", "pie"]).toContain(first.thing);
    const picks = new Set();
    for (let seed = 0; seed < 40; seed++)
      picks.add(bindingOf(world(seed), card, "walker", pool).someone);
    expect([...picks].sort()).toEqual(["ash", "bo", "cy"]);
  });
  it("never gives two roles of one card the same id", () => {
    for (let seed = 0; seed < 40; seed++) {
      const b = bindingOf(world(seed), card, "walker", pool);
      expect(b.someone).not.toBe(b.other);
    }
    const one = (s, kind) => (kind === "item" ? ["pie"] : ["ash"]);
    expect(bindingOf(world(), card, "walker", one)).toBeNull();
  });
  it("leaves the card out when a role has no candidate", () => {
    expect(bindingOf(world(), card, "walker", () => [])).toBeNull();
  });
  it("leaves the card out when a role or a home is not filled", () => {
    const stray = { id: "stray", proof: [{ kind: "actor_at", place: "$place" }] };
    expect(bindingOf(world(), stray, "walker", pool)).toBeNull();
    const homely = { id: "homely", proof: [{ kind: "actor_at", place: "$home" }] };
    expect(bindingOf(world(), homely, "walker", pool)).toBeNull();
    expect(bindingOf(world(), homely, "vale", pool).home).toBe("attic");
    expect(proves(world(), homely, "walker")).toBe(false);
  });
  it("resolves roles through lists and objects and keeps unknown ones", () => {
    expect(
      resolve({ a: ["$traveler", { b: "$thing" }], c: 2 }, { traveler: "w" }),
    ).toEqual({ a: ["w", { b: "$thing" }], c: 2 });
  });
});

describe("the cards in a real world", () => {
  const s = createWorld({ seed: 7 });
  it("binds every card and proves none at the start", () => {
    for (const card of data.cards) {
      expect(bindingOf(s, card, "vale"), card.id).not.toBeNull();
      expect(proves(s, card, "vale"), card.id).toBe(false);
    }
  });
  it("offers only plain candidates: no avatar, no arcanum, sorted", () => {
    for (const [kind, is] of [["resident"], ["item", "food"], ["place", "sanctuary"]]) {
      const ids = candidates(s, kind, is);
      expect(ids.length, kind).toBeGreaterThan(0);
      expect(ids).toEqual([...ids].sort());
      expect(ids).not.toContain("vale");
      expect(ids.some(isArcanum)).toBe(false);
    }
  });
});

describe("the data file", () => {
  const strings = (value) =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];
  const conditions = (list) =>
    list.flatMap((c) => [
      c,
      ...conditions(c.conditions || (c.condition ? [c.condition] : [])),
    ]);
  const all = data.cards.flatMap((card) => conditions(card.proof));
  it("names each card by its number, in order, once", () => {
    expect(data.schema).toBe(1);
    const numbers = data.cards.map((card) => card.number);
    expect(numbers).toEqual([...new Set(numbers)].sort((a, b) => a - b));
    for (const card of data.cards) {
      expect(card.id).toBe(`arcanum-${card.number}`);
      expect(card.number).toBeGreaterThanOrEqual(0);
      expect(card.number).toBeLessThanOrEqual(21);
      expect(card.name && card.text).toBeTruthy();
      expect(card.proof.length).toBeGreaterThan(0);
      expect(isArcanum(card.id)).toBe(true);
    }
    expect(isArcanum("coin")).toBe(false);
  });
  it("uses only roles the card declares", () => {
    for (const card of data.cards) {
      const roles = (card.roles || []).map((role) => role.name);
      expect(new Set(roles).size).toBe(roles.length);
      for (const role of card.roles || []) {
        expect(role.name).toMatch(/^[a-z]+$/);
        expect(["traveler", "home"]).not.toContain(role.name);
        expect(["resident", "item", "place"]).toContain(role.kind);
        expect([undefined, "food", "sanctuary"]).toContain(role.is);
      }
      const used = strings([card.proof, card.desire || []])
        .filter((text) => text.startsWith("$"))
        .map((text) => text.slice(1));
      for (const name of used)
        expect(["traveler", "home", ...roles], card.id).toContain(name);
    }
  });
  it("gives every count a known reader and a bound", () => {
    const readers = ["carried", "visited", "heard", "upgrades", "trusting", "company", "arcana"];
    for (const c of all.filter((c) => c.kind === "count")) {
      expect(readers).toContain(c.of);
      expect(c.min ?? c.max).toBeTypeOf("number");
    }
  });
  it("gives every did a key of its own and something to match", () => {
    const keys = all.filter((c) => c.kind === "did").map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
    for (const c of all.filter((c) => c.kind === "did"))
      expect(Object.keys(c.match).length).toBeGreaterThan(0);
  });
  it("gives every desire a kind and a target, three at most", () => {
    for (const card of data.cards) {
      expect((card.desire || []).length).toBeLessThanOrEqual(3);
      for (const want of card.desire || []) {
        expect(["item", "person", "place"]).toContain(want.kind);
        expect(want.target).toBeTypeOf("string");
      }
    }
  });
});
