import { describe, expect, it } from "vitest";
import { ROLE_KINDS, bind, holds, lockWords, proved } from "../v2/card-game/arcana/patterns.mjs";
import { ARCANA, JUSTICE, LOVER, STAR } from "../v2/card-game/arcana/cards.mjs";

const want = (target) => ({ kind: "item", target, since: 0, refusals: 0 });
function world(seed = 1) {
  return {
    run: { seed },
    locations: { yard: {}, mill: {}, well: {} },
    actors: {
      walker: { place: "yard" },
      ash: { place: "yard", want: want("coin"), trust: { walker: 1 } },
      bo: { place: "yard", want: want("coin"), trust: { walker: 1 } },
      cy: { place: "mill", want: want("cup"), trust: { walker: 1 } },
      dee: { place: "mill", want: null, trust: {} },
    },
    items: {
      coin: { holder: "walker" },
      cup: { holder: "dee" },
      rope: { holder: "mill" },
    },
    log: [],
  };
}
const fixed = { traveler: "walker" };
function commit(s, verb, actorId, detail = {}) {
  const locationId = detail.locationId ?? s.actors[actorId].place;
  s.log.push({
    seq: s.log.length + 1,
    verb,
    actorId,
    locationId,
    cast: Object.keys(s.actors).filter((id) => s.actors[id].place === locationId),
    ...detail,
  });
}
function hand(s, verb, actorId, targetId, itemId, detail = {}) {
  const to = verb === "give" ? targetId : actorId;
  commit(s, verb, actorId, { targetId, itemId, accepted: true, ...detail });
  s.items[itemId].holder = to;
  if (s.actors[to].want?.target === itemId) {
    commit(s, "want_met", to, { kind: "narration", itemId });
    s.actors[to].want = null;
  }
}
const check = (pattern, s, binding) => proved(pattern, binding, s);
describe("the Lover: two wants one item cannot both meet", () => {
  const bound = () => bind(LOVER, world(), 1, fixed);
  it("binds two residents to the one item both want", () => {
    const { binding, instances: found } = bound();
    expect(binding.item).toBe("coin");
    expect([binding.first, binding.second].sort()).toEqual(["ash", "bo"]);
    expect(found).toHaveLength(2);
  });
  it("stays false while both wants are open", () => {
    expect(check(LOVER, world(), bound().binding).proved).toBe(false);
  });
  it("comes true when the traveler gives it to either one", () => {
    for (const chosen of ["ash", "bo"]) {
      const s = world();
      hand(s, "give", "walker", chosen, "coin");
      expect(check(LOVER, s, bound().binding).proved).toBe(true);
    }
  });
  it("stays false when the item reached one of them by another hand", () => {
    const s = world();
    s.items.coin.holder = "dee";
    hand(s, "give", "dee", "ash", "coin");
    expect(check(LOVER, s, bound().binding).proved).toBe(false);
  });
  it("lapses when the chosen one no longer holds it or the other stops asking", () => {
    const s = world();
    hand(s, "give", "walker", "ash", "coin");
    const lost = structuredClone(s);
    lost.items.coin.holder = "bo";
    expect(check(LOVER, lost, bound().binding).proved).toBe(false);
    s.actors.bo.want = want("rope");
    expect(check(LOVER, s, bound().binding).proved).toBe(false);
  });
});

describe("Justice: custody follows a committed agreement", () => {
  const binding = { ...fixed, item: "cup", keeper: "dee", claimant: "cy" };
  it("binds the keeper and the one who wants what it keeps", () => {
    expect(bind(JUSTICE, world(), 1, fixed).instances).toEqual([binding]);
  });
  it("comes true when the claimant asks and the keeper agrees", () => {
    const s = world();
    expect(check(JUSTICE, s, binding).failed).toBe("the handover was agreed");
    hand(s, "ask", "cy", "dee", "cup");
    expect(check(JUSTICE, s, binding).proved).toBe(true);
    s.items.cup.holder = "bo";
    expect(check(JUSTICE, s, binding).failed).toBe("custody matches the agreement");
  });
  it("comes true when the traveler carries an agreed handover across", () => {
    const s = world();
    s.actors.walker.place = "mill";
    hand(s, "ask", "walker", "dee", "cup");
    hand(s, "give", "walker", "cy", "cup");
    expect(check(JUSTICE, s, binding).proved).toBe(true);
  });
  it("stays false for custody without an agreement", () => {
    const stolen = world();
    commit(stolen, "steal", "cy", { targetId: "dee", itemId: "cup" });
    stolen.items.cup.holder = "cy";
    expect(check(JUSTICE, stolen, binding).failed).toBe("the handover was agreed");
    const forced = world();
    hand(forced, "ask", "cy", "dee", "cup", { handover: { kind: "threat" } });
    expect(check(JUSTICE, forced, binding).proved).toBe(false);
    const refused = world();
    commit(refused, "ask", "cy", { targetId: "dee", itemId: "cup", accepted: false });
    expect(check(JUSTICE, refused, binding).proved).toBe(false);
  });
});

describe("the Star: it is used after the traveler has left", () => {
  const binding = { ...fixed, user: "cy", source: "cup", basin: "well" };
  const left = () => {
    const s = world();
    s.items.cup.holder = "walker";
    s.actors.walker.place = "well";
    commit(s, "drop", "walker", { itemId: "cup" });
    s.items.cup.holder = "well";
    return s;
  };
  const take = (s) => {
    s.actors.cy.place = "well";
    commit(s, "take", "cy", { itemId: "cup" });
    s.items.cup.holder = "cy";
  };
  it("binds a wanted thing to every place it does not rest", () => {
    const found = bind(STAR, world(), 1, fixed).instances;
    expect(found).toContainEqual(binding);
    expect(found.some((b) => b.source === "cup" && b.basin === "mill")).toBe(false);
  });
  it("comes true when the resident takes it with the traveler elsewhere", () => {
    const s = left();
    expect(check(STAR, s, binding).failed).toBe("someone used it after you left");
    s.actors.walker.place = "yard";
    take(s);
    expect(check(STAR, s, binding).proved).toBe(true);
  });
  it("stays false when the traveler is still there, took it, or it was taken first", () => {
    const seen = left();
    take(seen);
    expect(check(STAR, seen, binding).proved).toBe(false);
    const early = world();
    early.items.cup.holder = "well";
    take(early);
    expect(check(STAR, early, binding).proved).toBe(false);
    const own = left();
    commit(own, "take", "walker", { itemId: "cup" });
    expect(check(STAR, own, binding).proved).toBe(false);
  });
});

describe("the binder", () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);
  it("gives the same binding for the same world and seed", () => {
    for (const card of ARCANA)
      expect(bind(card, world(9), undefined, fixed)).toEqual(bind(card, world(1), 9, fixed));
  });
  it("can pick different instances under different seeds", () => {
    const picks = new Set(
      seeds.map((seed) => JSON.stringify(bind(STAR, world(), seed, fixed).binding)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
  it("says so when a world has no instance", () => {
    const s = world();
    for (const a of Object.values(s.actors)) a.want = null;
    for (const card of ARCANA) {
      const none = bind(card, s, 1, fixed);
      expect(none).toEqual({ bound: false, binding: null, instances: [], reason: "no instance in this world" });
      expect(proved(card, none.binding, s)).toEqual({ proved: false, failed: "unbound" });
    }
  });
  it("returns only bindings that satisfy every role constraint", () => {
    for (const seed of seeds)
      for (const card of ARCANA) {
        const s = world(seed);
        const result = bind(card, s, seed, fixed);
        for (const binding of result.instances) {
          expect(new Set(Object.values(binding)).size).toBe(card.roles.length + 1);
          for (const role of card.roles) {
            expect(Object.keys(s[ROLE_KINDS[role.kind]])).toContain(binding[role.name]);
            for (const c of role.where || []) expect(holds(s, c, binding)).toBe(true);
          }
        }
      }
  });
});

describe("the lock in words", () => {
  const KINDS = { ash: "person", bo: "person", cy: "person", well: "place" };
  const cards = {
    name: (id) => id[0].toUpperCase() + id.slice(1),
    kind: (id) => KINDS[id] ?? "item",
  };
  it("states the desire in the want wording and hides undiscovered cards", () => {
    const lover = { first: "ash", item: "coin", second: "bo" };
    expect(lockWords(LOVER, lover, () => true, cards)).toBe(
      "Give Coin to Ash and give Coin to Bo",
    );
    expect(lockWords(STAR, { source: "cup", basin: "well" }, () => true, cards)).toBe(
      "Bring Cup to Well",
    );
    expect(lockWords(JUSTICE, { item: "cup", claimant: "cy" }, () => false, cards)).toBe(
      "Give something undiscovered to someone you have not met",
    );
  });
});
