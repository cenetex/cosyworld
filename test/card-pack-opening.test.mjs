import { describe, expect, it } from "vitest";
import {
  PACK_DONE,
  PACK_FINISH,
  PACK_KINDS,
  PACK_MIN,
  PACK_REVEAL_ALL,
  PACK_TEXT,
  PACK_TIERS,
  createPackOpening,
  packMembers,
  packOrder,
  revealAnnouncement,
  runOrder,
  settleDelays,
  tellGlow,
  turnPlan,
} from "../v2/card-game/pack-opening.mjs";
import { tapPrompt } from "../v2/card-game/presentation.mjs";
import { createSfx } from "../v2/card-game/sfx.mjs";

// Made-up cards: the kind is the first letter of the id.
const KINDS = { p: "place", a: "avatar", i: "item", w: "way", b: "box", o: "offer" };
const kindOf = (id) => KINDS[id[0]];
const TIER = { "i-gem": "rare", "i-crown": "legendary", "a-fox": "uncommon", "w-lane": "epic" };
const tierOf = (id) => TIER[id] ?? "common";

// A table of cards that are face down until `turned` says otherwise.
function table(cards, down = cards) {
  const covered = new Set(down);
  return {
    cards,
    covered,
    unturned: (id) => covered.has(id),
    turn: (id) => covered.delete(id),
  };
}
function fakeTimers() {
  const waiting = new Map();
  let next = 1,
    now = 0;
  return {
    set: (fn, ms) => {
      waiting.set(next, { fn, at: now + ms });
      return next++;
    },
    clear: (handle) => waiting.delete(handle),
    // Runs everything due by `ms` from now, in time order.
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...waiting].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        waiting.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get pending() {
      return waiting.size;
    },
  };
}
const make = (opts) => {
  const timers = fakeTimers();
  return { timers, pack: createPackOpening({ timers, ...opts }) };
};

describe("which cards form a pack", () => {
  const cards = ["w-lane", "i-gem", "b-gate", "a-fox", "p-here", "o-deal", "i-pin"];

  it("takes the unturned cards, the place first and the offers last", () => {
    const { unturned } = table(cards);
    expect(packMembers(cards, { unturned, kindOf })).toEqual([
      "p-here", "a-fox", "i-gem", "i-pin", "w-lane", "b-gate", "o-deal",
    ]);
    expect(PACK_KINDS).toEqual(["place", "avatar", "item", "way", "box", "offer"]);
  });

  it("leaves out cards already turned", () => {
    const { unturned } = table(cards, ["i-gem", "a-fox", "w-lane"]);
    expect(packMembers(cards, { unturned, kindOf })).toEqual(["a-fox", "i-gem", "w-lane"]);
  });

  it("needs three: one or two cards simply turn in place", () => {
    expect(PACK_MIN).toBe(3);
    for (const down of [[], ["a-fox"], ["a-fox", "i-gem"]]) {
      const { unturned } = table(cards, down);
      expect(packMembers(cards, { unturned, kindOf })).toEqual([]);
    }
    const { unturned } = table(cards, ["a-fox", "i-gem", "i-pin"]);
    expect(packMembers(cards, { unturned, kindOf })).toHaveLength(3);
  });

  it("keeps the hand's order among cards of one kind and counts a card once", () => {
    const hand = ["i-b", "i-a", "i-b", "i-c"];
    const { unturned } = table(hand);
    expect(packMembers(hand, { unturned, kindOf })).toEqual(["i-b", "i-a", "i-c"]);
  });

  it("treats a locked box like any other face-down card", () => {
    const hand = ["b-gate", "i-a", "i-b"];
    const { unturned } = table(hand);
    expect(packMembers(hand, { unturned, kindOf })).toContain("b-gate");
  });
});

describe("where the pack lies in the hand", () => {
  const hand = ["a-me", "i-lamp", "a-fox", "p-room", "i-gem", "i-pin", "w-lane"];
  const holders = { "i-lamp": "a-me", "i-gem": "p-room", "i-pin": "p-room" };
  const holderOf = (id) => holders[id] ?? null;

  it("gathers its cards, in its order, where the first of them lay", () => {
    expect(packOrder(hand, ["w-lane", "a-fox", "i-pin"], holderOf)).toEqual([
      "a-me", "i-lamp", "w-lane", "a-fox", "i-pin", "p-room", "i-gem",
    ]);
    expect(packOrder(hand, [], holderOf)).toBe(hand);
    expect(packOrder(hand, ["i-gone"], holderOf)).toBe(hand);
  });

  it("keeps a thing given to a pack card behind that card", () => {
    const given = { ...holders, "i-lamp": "a-fox" };
    expect(
      packOrder(
        ["a-me", "a-fox", "i-lamp", "p-room", "i-gem", "i-pin", "w-lane"],
        ["w-lane", "a-fox", "i-pin"],
        (id) => given[id] ?? null,
      ),
    ).toEqual(["a-me", "w-lane", "a-fox", "i-lamp", "i-pin", "p-room", "i-gem"]);
  });

  it("leaves a thing taken from the pack with its new holder", () => {
    const taken = { ...holders, "i-pin": "a-me" };
    expect(
      packOrder(
        ["a-me", "i-pin", "i-lamp", "a-fox", "p-room", "i-gem", "w-lane"],
        ["w-lane", "a-fox"],
        (id) => taken[id] ?? null,
      ),
    ).toEqual(["a-me", "i-pin", "i-lamp", "w-lane", "a-fox", "p-room", "i-gem"]);
  });
});

describe("the pack's state machine", () => {
  it("runs closed, open, running, turned, done", () => {
    const { pack, timers } = make();
    const t = table(["p-here", "a-fox", "i-gem", "i-pin"]);
    expect(pack.state).toBe("none");
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("closed");
    expect(pack.ids).toEqual(["p-here", "a-fox", "i-gem", "i-pin"]);
    expect(pack.prompt(t.unturned)).toBeNull();

    expect(pack.open()).toBe(true);
    expect(pack.state).toBe("open");
    expect(pack.open()).toBe(false);
    expect(pack.prompt(t.unturned)).toEqual({ kind: "reveal", label: PACK_REVEAL_ALL, text: PACK_TEXT.reveal });

    const done = [];
    pack.revealAll({
      unturned: t.unturned,
      tierOf,
      turn: (id) => {
        t.turn(id);
        done.push(id);
      },
      done: () => done.push("done"),
    });
    expect(pack.state).toBe("running");
    expect(pack.prompt(t.unturned)).toEqual({ kind: "finish", label: PACK_FINISH, text: PACK_TEXT.finish });
    timers.advance(20000);
    // Commons first, the rarest last, then the run is over.
    expect(done).toEqual(["p-here", "i-pin", "a-fox", "i-gem", "done"]);
    expect(pack.state).toBe("turned");
    expect(pack.prompt(t.unturned)).toEqual({ kind: "done", label: PACK_DONE, text: PACK_TEXT.done });

    expect(pack.finish({ tierOf })).toBe(true);
    expect(pack.state).toBe("done");
    expect(pack.ids).toEqual([]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("none");
  });

  it("turns one card at once in an open pack and moves to turned when all are", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.turnOne("a-fox", { unturned: t.unturned, turn: t.turn })).toBe(false);
    pack.open();
    expect(pack.turnOne("a-fox", { unturned: t.unturned, turn: t.turn })).toBe(true);
    expect(pack.turnOne("a-fox", { unturned: t.unturned, turn: t.turn })).toBe(false);
    expect(pack.turnOne("zzz", { unturned: t.unturned, turn: t.turn })).toBe(false);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("open");
    expect(pack.prompt(t.unturned).kind).toBe("reveal");
    for (const id of ["i-gem", "i-pin"]) pack.turnOne(id, { unturned: t.unturned, turn: t.turn });
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("turned");
    expect(pack.prompt(t.unturned).label).toBe(PACK_DONE);
  });

  it("skips: every card still face down turns now and the run ends, none half turned", () => {
    const { pack, timers } = make();
    const t = table(["p-here", "a-fox", "i-gem", "i-pin", "w-lane"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    const log = [];
    pack.revealAll({
      unturned: t.unturned,
      tierOf,
      turn: (id) => {
        t.turn(id);
        log.push(`turn:${id}`);
      },
      done: () => log.push("done"),
    });
    expect(log).toEqual(["turn:p-here"]);
    expect(pack.skip({ unturned: t.unturned, turnNow: (id) => { t.turn(id); log.push(`now:${id}`); } })).toBe(true);
    expect(log).toEqual(["turn:p-here", "now:a-fox", "now:i-gem", "now:i-pin", "now:w-lane", "done"]);
    expect(pack.state).toBe("turned");
    expect([...t.covered]).toEqual([]);
    // The cancelled run leaves no timer behind and cannot turn anything later.
    expect(timers.pending).toBe(0);
    expect(pack.skip({ unturned: t.unturned, turnNow: () => log.push("again") })).toBe(false);
  });

  it("tolerates a card turned from outside the run (a speaker's own line)", () => {
    const { pack, timers } = make();
    const t = table(["p-here", "a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    const turned = [];
    pack.revealAll({
      unturned: t.unturned,
      tierOf,
      turn: (id) => {
        t.turn(id);
        turned.push(id);
      },
    });
    t.turn("a-fox"); // the fox speaks and turns itself
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("running");
    timers.advance(20000);
    expect(turned).toEqual(["p-here", "i-pin", "i-gem"]);
    expect(pack.state).toBe("turned");
  });

  it("tolerates every card being turned from outside while the pack is closed or open", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    t.turn("a-fox");
    // Closed: two left, so the pack dissolves and they turn in place.
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("none");
    const open = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(open.cards, { unturned: open.unturned, kindOf });
    pack.open();
    for (const id of open.cards) open.turn(id);
    pack.sync(open.cards, { unturned: open.unturned, kindOf });
    expect(pack.state).toBe("turned");
  });

  it("a card arriving while a pack is open forms the next pack, not part of this one", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    const later = [...t.cards, "w-lane", "w-pier", "b-gate"];
    const down = new Set([...t.covered, "w-lane", "w-pier", "b-gate"]);
    pack.sync(later, { unturned: (id) => down.has(id), kindOf });
    expect(pack.ids).toEqual(["a-fox", "i-gem", "i-pin"]);
    expect(pack.state).toBe("open");
    // Done for the first pack: the late three form the next pack at once.
    for (const id of ["a-fox", "i-gem", "i-pin"]) down.delete(id);
    pack.sync(later, { unturned: (id) => down.has(id), kindOf });
    expect(pack.state).toBe("turned");
    expect(pack.finish({ tierOf })).toBe(true);
    pack.sync(later, { unturned: (id) => down.has(id), kindOf });
    expect(pack.state).toBe("closed");
    expect(pack.ids).toEqual(["w-lane", "w-pier", "b-gate"]);
  });

  it("a closed pack takes late arrivals into itself", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    const more = [...t.cards, "w-lane"];
    pack.sync(more, { unturned: () => true, kindOf });
    expect(pack.ids).toEqual(["a-fox", "i-gem", "i-pin", "w-lane"]);
  });

  it("drops cards that left the hand, and the pack with them if none remain", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    pack.sync(["a-fox", "i-gem"], { unturned: t.unturned, kindOf });
    expect(pack.ids).toEqual(["a-fox", "i-gem"]);
    pack.sync([], { unturned: t.unturned, kindOf });
    expect(pack.state).toBe("none");
  });

  it("lets go of a card that changed hands, turned or not, and keeps the rest", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin", "w-lane"]);
    const held = { "i-gem": "p-room", "i-pin": "p-room" };
    const sync = () =>
      pack.sync(t.cards, {
        unturned: t.unturned,
        kindOf,
        holderOf: (id) => held[id] ?? null,
      });
    sync();
    pack.open();
    t.turn("i-gem");
    sync();
    expect(pack.ids).toEqual(["a-fox", "i-gem", "i-pin", "w-lane"]);
    held["i-gem"] = "a-me";
    expect(sync()).toBe(true);
    expect(pack.ids).toEqual(["a-fox", "i-pin", "w-lane"]);
    expect(pack.frameFor("i-gem")).toBeNull();
    expect(pack.state).toBe("open");
    held["i-pin"] = "a-fox";
    sync();
    expect(pack.ids).toEqual(["a-fox", "w-lane"]);
    held["i-gem"] = "p-room";
    sync();
    expect(pack.ids).toEqual(["a-fox", "w-lane"]);
  });

  it("ends an open pack whose last face-down card was taken away", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    const held = { "i-pin": "p-room" };
    const sync = () =>
      pack.sync(t.cards, {
        unturned: t.unturned,
        kindOf,
        holderOf: (id) => held[id] ?? null,
      });
    sync();
    pack.open();
    t.turn("a-fox");
    t.turn("i-gem");
    held["i-pin"] = "a-fox";
    sync();
    expect(pack.ids).toEqual(["a-fox", "i-gem"]);
    expect(pack.state).toBe("turned");
  });

  it("dissolves while something else owns the table", () => {
    const { pack, timers } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    pack.revealAll({ unturned: t.unturned, tierOf, turn: t.turn });
    pack.sync(t.cards, { unturned: t.unturned, kindOf, allowed: false });
    expect(pack.state).toBe("none");
    expect(timers.pending).toBe(0);
  });

  it("dismissing a run finishes it first; dismissing an open pack leaves the rest face down", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    pack.revealAll({ unturned: t.unturned, tierOf, turn: t.turn });
    pack.dismiss({ unturned: t.unturned, turnNow: t.turn, tierOf });
    expect([...t.covered]).toEqual([]);
    expect(pack.state).toBe("done");

    const open = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(open.cards, { unturned: open.unturned, kindOf });
    pack.open();
    pack.turnOne("a-fox", { unturned: open.unturned, turn: open.turn });
    pack.dismiss({ unturned: open.unturned, turnNow: open.turn, tierOf });
    expect([...open.covered].sort()).toEqual(["i-gem", "i-pin"]);
    // Two left face down: no new pack, they turn in place.
    pack.sync(open.cards, { unturned: open.unturned, kindOf });
    expect(pack.state).toBe("none");
  });

  it("shows the closed pack as one stack with a top and an edge count", () => {
    const { pack } = make();
    const t = table(["p-here", "a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.frameFor("p-here")).toEqual({ shown: true, top: true, under: 3 });
    expect(pack.frameFor("a-fox")).toEqual({ shown: false, top: false, under: 0 });
    expect(pack.frameFor("outside")).toBeNull();
    pack.open();
    expect(pack.frameFor("a-fox")).toEqual({ shown: true, top: false, under: 0 });
  });

  it("uses only three sentences and their tap cues", () => {
    expect(PACK_TEXT).toEqual({
      reveal: "New cards unlocked",
      finish: "Turning the cards",
      done: "All cards revealed",
    });
    expect(
      [PACK_REVEAL_ALL, PACK_FINISH, PACK_DONE].map((verb) => tapPrompt(verb, true).hint),
    ).toEqual(["Tap to reveal all", "Tap to finish", "Tap to continue"]);
    // A confirm that already says how to tap is the cue as it stands.
    expect(tapPrompt("Tap again to sign out", true).hint).toBe("Tap again to sign out");
  });
});

describe("the tell", () => {
  it("shows only from Rare up, only in an open pack, only while face down", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-crown"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    expect(pack.tellFor("i-gem", "rare", true)).toBeNull(); // closed
    pack.open();
    expect(pack.tellFor("i-gem", "rare", true)).toBe("rare");
    expect(pack.tellFor("i-crown", "legendary", true)).toBe("legendary");
    expect(pack.tellFor("a-fox", "uncommon", true)).toBeNull();
    expect(pack.tellFor("a-fox", "common", true)).toBeNull();
    expect(pack.tellFor("i-gem", "rare", false)).toBeNull(); // turned
    expect(pack.tellFor("outside", "epic", true)).toBeNull();
  });

  it("glows brighter with the tier", () => {
    expect(tellGlow("common")).toBeNull();
    expect(tellGlow("uncommon")).toBeNull();
    const rims = ["rare", "epic", "legendary", "mythic"].map(tellGlow);
    expect(rims).toEqual([...rims].sort((a, b) => a - b));
    expect(new Set(rims).size).toBe(4);
  });
});

describe("tier timing and sound", () => {
  const plans = PACK_TIERS.map((tier) => turnPlan(tier));

  it("climbs with the tier: hold, spacing, tone pitch, length and level", () => {
    expect(plans[0].hold).toBe(0);
    expect(plans[0].tone).toBeNull();
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].hold).toBeGreaterThan(plans[i - 1].hold);
      expect(plans[i].spacing).toBeGreaterThan(plans[i - 1].spacing);
      expect(plans[i].tick).toBeGreaterThan(plans[i - 1].tick);
      expect(plans[i].tone).not.toBeNull();
      if (i > 1) {
        expect(plans[i].tone.hz).toBeGreaterThan(plans[i - 1].tone.hz);
        expect(plans[i].tone.ms).toBeGreaterThan(plans[i - 1].tone.ms);
        expect(plans[i].tone.level).toBeGreaterThan(plans[i - 1].tone.level);
        expect(plans[i].tone.partials).toBeGreaterThanOrEqual(plans[i - 1].tone.partials);
      }
    }
  });

  it("keeps the wait short: anticipation under two seconds, a common one has none", () => {
    expect(turnPlan("common").hold).toBe(0);
    expect(plans.at(-1).hold).toBeLessThanOrEqual(1200);
  });

  it("the tone is as long as the hold and a short tail", () => {
    for (const plan of plans.filter((p) => p.tone)) expect(plan.tone.ms).toBe(plan.hold + 200);
  });

  it("holds no breath under reduced motion; the tier lives in colour and sound", () => {
    for (const tier of PACK_TIERS) {
      const reduced = turnPlan(tier, { reduced: true });
      expect(reduced.hold).toBe(0);
      expect(reduced.spacing).toBe(320);
    }
    expect(turnPlan("legendary", { reduced: true }).tone).not.toBeNull();
    expect(turnPlan("legendary", { reduced: true }).tone.ms).toBe(200);
  });

  it("reads an unknown tier as common", () => {
    expect(turnPlan("bogus")).toEqual({ ...turnPlan("common"), tier: "common" });
  });
});

describe("order of a run and of the settle", () => {
  const ids = ["a-fox", "i-crown", "i-pin", "i-gem", "w-lane", "i-bud"];

  it("runs commons first and the rarest last, keeping pack order within a tier", () => {
    expect(runOrder(ids, tierOf)).toEqual(["i-pin", "i-bud", "a-fox", "i-gem", "w-lane", "i-crown"]);
  });

  it("settles the rarest last, a beat apart, all at once under reduced motion", () => {
    const delays = settleDelays(ids, tierOf);
    const order = runOrder(ids, tierOf);
    const values = order.map((id) => delays.get(id));
    expect(values[0]).toBe(0);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.max(...values)).toBeLessThanOrEqual(420);
    expect([...settleDelays(ids, tierOf, { reduced: true }).values()].every((d) => d === 0)).toBe(true);
  });

  it("hands over the settle delays once", () => {
    const { pack } = make();
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    for (const id of t.cards) t.turn(id);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.finish({ tierOf });
    expect(pack.takeSettle().get("i-gem")).toBeGreaterThan(0);
    expect(pack.takeSettle().size).toBe(0);
  });

  it("uses a short fixed beat under reduced motion", () => {
    const { pack, timers } = make({ reduced: () => true });
    const t = table(["a-fox", "i-gem", "i-pin"]);
    pack.sync(t.cards, { unturned: t.unturned, kindOf });
    pack.open();
    const turned = [];
    pack.revealAll({ unturned: t.unturned, tierOf, turn: (id) => { t.turn(id); turned.push(id); } });
    expect(turned).toHaveLength(1);
    timers.advance(320);
    expect(turned).toHaveLength(2);
    timers.advance(320);
    expect(turned).toHaveLength(3);
  });
});

describe("one batched announcement", () => {
  it("says how many turned and the rarest", () => {
    expect(revealAnnouncement(5, "rare", (t) => t.toUpperCase())).toBe("5 cards turned. Rarest: RARE.");
  });
});

describe("card sounds", () => {
  function context() {
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const made = { oscillators: 0, buffers: 0 };
    return {
      made,
      state: "running",
      currentTime: 2,
      sampleRate: 8000,
      destination: {},
      createGain: () => ({ gain: param(), connect() {} }),
      createOscillator: () => {
        made.oscillators += 1;
        return { frequency: param(), connect() {}, start() {}, stop() {} };
      },
      createBiquadFilter: () => ({ frequency: param(), Q: {}, connect() {} }),
      createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
      createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
      resume: async () => {},
    };
  }

  it("waits for a gesture, follows the Voices switch and the volume", () => {
    const ctx = context();
    const sfx = createSfx({ makeContext: () => ctx });
    const plan = turnPlan("rare");
    expect(sfx.cardTurn(plan)).toBe(false);
    sfx.unlock();
    expect(sfx.cardTurn(plan)).toBe(true);
    expect(sfx.card("slide")).toBe(true);
    expect(sfx.card("settle")).toBe(true);
    expect(sfx.card("nonsense")).toBe(false);
    sfx.setVoices(false);
    expect(sfx.cardTurn(plan)).toBe(false);
    sfx.setVoices(true);
    sfx.setVolume(0);
    expect(sfx.cardTurn(plan)).toBe(false);
    sfx.setVolume(0.3);
    sfx.setHidden(true);
    expect(sfx.cardTurn(plan)).toBe(false);
  });

  it("gives a rarer card more voices than a common one", () => {
    const voices = (tier) => {
      const ctx = context();
      const sfx = createSfx({ makeContext: () => ctx });
      sfx.unlock();
      sfx.cardTurn(turnPlan(tier));
      return ctx.made.oscillators;
    };
    const counts = PACK_TIERS.map(voices);
    expect(counts[0]).toBeGreaterThan(0); // a common card still ticks
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts.at(-1)).toBeGreaterThan(counts[0]);
  });
});
