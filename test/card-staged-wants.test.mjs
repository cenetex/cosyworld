import { afterEach, describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  wantAPI,
} from "../v2/card-game/world.mjs";
import {
  installWants,
  refuseWant,
  settleWants,
  stagedNext,
  stagedOrder,
} from "../v2/card-game/want.mjs";
import { revealed, stagedWants } from "../v2/card-game/want-talk.mjs";
import {
  packDefinition,
  packDefinitions,
  packPeople,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems, packWarnings } from "../v2/card-game/pack-schema.mjs";
import { authoredWant } from "../v2/card-game/want-talk.mjs";

// Staged wants (rules 133), made from Ismene in memory: a resident carries a
// short list of wants, each with a condition, read fresh and never saved.
const R = "greek-ismene",
  gate = "greek-gate";
const saved = { want: packPeople[R].want, wants: packPeople[R].wants };
const restore = () => {
  packPeople[R].want = saved.want;
  if (saved.wants === undefined) delete packPeople[R].wants;
  else packPeople[R].wants = saved.wants;
};
afterEach(restore);
const item = (target, extra = {}, when) => ({
  want: { kind: "item", target, ...extra },
  ...(when ? { when } : {}),
});
const place = (target, when) => ({
  want: { kind: "place", target },
  ...(when ? { when } : {}),
});
const flag = (key) => [{ kind: "flag", key, value: true }];
const stage = (...wants) => {
  delete packPeople[R].want;
  packPeople[R].wants = wants;
};
const world = (seed = 7, turn = 0) => {
  const s = createWorld({ seed, packScopes: { "greek-drama": "full" } });
  s.turn = turn;
  return s;
};
const setFlag = (s, key) => (s.packs["greek-drama"].flags[key] = true);
const termsOf = (w) => w && [w.kind, w.target];

describe("schema", () => {
  const attempt = (patch) => {
    const p = structuredClone(packDefinition("greek-drama"));
    patch(p.avatars[R]);
    return validatePackDefinition(p);
  };
  it("accepts one to three staged wants and the single want as before", () => {
    expect(() => attempt(() => {})).not.toThrow();
    for (const n of [1, 2, 3])
      expect(() =>
        attempt((a) => {
          delete a.want;
          a.wants = Array.from({ length: n }, (_, i) =>
            place(i ? "greek-courtyard" : "greek-sanctuary", flag(`f${i}`)),
          );
        }),
      ).not.toThrow();
  });
  it("rejects four, none, both forms, and unknown fields", () => {
    const wants = (n) =>
      Array.from({ length: n }, () => place("greek-sanctuary"));
    expect(() =>
      attempt((a) => {
        delete a.want;
        a.wants = wants(4);
      }),
    ).toThrow(/wants needs one to three/u);
    expect(() =>
      attempt((a) => {
        delete a.want;
        a.wants = [];
      }),
    ).toThrow();
    expect(() => attempt((a) => (a.wants = wants(1)))).toThrow(
      /want or wants, not both/u,
    );
    expect(() =>
      attempt((a) => {
        delete a.want;
        a.wants = [{ ...place("greek-sanctuary"), order: 1 }];
      }),
    ).toThrow();
  });
  it("checks each want like a single want, minTrust included", () => {
    const one = (entry) =>
      attempt((a) => {
        delete a.want;
        a.wants = [entry];
      });
    expect(() => one(item("greek-figs", { minTrust: 3 }))).not.toThrow();
    expect(() => one(item("greek-figs", { minTrust: 4 }))).toThrow();
    expect(() => one(item("greek-nowhere"))).toThrow();
  });
  it("reads when from saved world facts, never a traveler", () => {
    const when = (conditions) =>
      attempt((a) => {
        delete a.want;
        a.wants = [place("greek-sanctuary", conditions)];
      });
    expect(() => when(flag("opened"))).not.toThrow();
    expect(() =>
      when([{ kind: "holding", item: "greek-figs", actor: "greek-baker" }]),
    ).not.toThrow();
    for (const kind of [
      { kind: "trusted", actor: R, min: 1 },
      { kind: "talked", person: "greek-guard" },
      { kind: "holding", item: "greek-figs", role: "actor" },
      { kind: "not", condition: { kind: "trusted", actor: R, min: 1 } },
    ])
      expect(() => when([kind])).toThrow(/has no traveler/u);
    expect(() => when([])).toThrow();
  });
  it("warns, without failing, when a give choice takes a staged gift", () => {
    const p = structuredClone(packDefinition("greek-drama"));
    delete p.avatars[R].want;
    p.avatars[R].wants = [item("greek-figs")];
    p.choices.push({
      id: "test-give-figs",
      on: "give",
      subject: R,
      at: gate,
      label: "Give",
      text: "Thanks.",
      requires: [{ kind: "holding", item: "greek-figs", role: "actor" }],
      effects: [{ kind: "set_flag", key: "t", value: true }],
    });
    expect(packProblems(p, {})).not.toContain(expect.stringMatching(/staged/u));
    expect(packWarnings(p)).toEqual([
      expect.stringMatching(
        /test-give-figs intercepts the Give of greek-figs/u,
      ),
    ]);
    expect(packWarnings(packDefinition("greek-drama"))).toEqual([]);
  });
});

const STAGED = { "greek-antigone": 2, "ratiradio-rati": 3 };
describe("selection", () => {
  it("installs an eligible entry, and none whose when does not hold", () => {
    stage(item("greek-figs", {}, flag("a")), item("greek-shovel"));
    const s = world();
    expect(termsOf(s.actors[R].want)).toEqual(["item", "greek-shovel"]);
    // The held want has only a kind, target and its bookkeeping.
    expect(Object.keys(s.actors[R].want).sort()).toEqual([
      "kind",
      "refusals",
      "since",
      "target",
    ]);
    setFlag(s, "a");
    delete s.actors[R].want;
    expect(stagedNext(s, R)).not.toBeNull();
    installWants(s);
    expect(s.actors[R].want).toBeTruthy();
  });
  it("is unordered: the pick varies with the seed and the day, and is stable within them", () => {
    stage(item("greek-figs"), item("greek-shovel"));
    const pick = (seed, turn) => {
      const s = world(seed, turn);
      return stagedNext(s, R)?.target;
    };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const bySeed = seeds.map((seed) => pick(seed, 0));
    expect(new Set(bySeed).size).toBe(2);
    expect(seeds.map((seed) => pick(seed, 0))).toEqual(bySeed);
    // Same day (48 turns): the same pick. Another day can change it.
    expect(seeds.map((seed) => pick(seed, 47))).toEqual(bySeed);
    const days = Array.from({ length: 8 }, (_, d) => pick(3, d * 48));
    expect(new Set(days).size).toBe(2);
    expect(days).toEqual(
      Array.from({ length: 8 }, (_, d) => pick(3, d * 48 + 5)),
    );
  });
  it("lets authored order break a tie", () => {
    const a = { index: 0, rank: 9 },
      b = { index: 1, rank: 9 },
      c = { index: 2, rank: 3 };
    expect([b, a, c].sort(stagedOrder)).toEqual([c, a, b]);
  });
  it("takes the next eligible staged want when one is met, not a drawn one or contentment", () => {
    stage(item("greek-figs"), item("greek-shovel"), item("greek-wine-skin"));
    const s = world();
    const first = s.actors[R].want;
    // Meet it: the thing is in her hands.
    s.items[first.target].holder = R;
    settleWants(s, [R], wantAPI(s));
    const next = s.actors[R].want;
    expect(next).toBeTruthy();
    expect(termsOf(next)).not.toEqual(termsOf(first));
    expect(stagedWants(s, R).some((e) => e.want.target === next.target)).toBe(
      true,
    );
    expect(s.actors[R].content).toBeUndefined();
    expect(s.actors[R].xp).toBeGreaterThan(0);
    // The want just met is never retaken at once, and a want already met
    // (the thing in her hands) is skipped.
    expect(stagedNext(s, R, next)?.target).not.toBe(next.target);
    expect(stagedNext(s, R)?.target).not.toBe(first.target);
  });
  it("falls back to content and a drawn want once no staged entry is eligible", () => {
    stage(item("greek-shovel"));
    const s = world();
    expect(s.actors[R].want.target).toBe("greek-shovel");
    s.items["greek-shovel"].holder = R;
    settleWants(s, [R], wantAPI(s));
    expect(s.actors[R].want).toBeNull();
    expect(s.actors[R].content).toBe(true);
  });
  it("replaces a given-up want with another staged one", () => {
    stage(item("greek-figs"), item("greek-shovel"));
    const s = world();
    const held = s.actors[R].want.target;
    // Refused three times, she sets it aside for the other staged want.
    refuseWant(s, R, held, wantAPI(s));
    refuseWant(s, R, held, wantAPI(s));
    refuseWant(s, R, held, wantAPI(s));
    expect(s.actors[R].gaveUp.target).toBe(held);
    expect(s.actors[R].want.target).not.toBe(held);
    expect(stagedWants(s, R).map((e) => e.want.target)).toContain(
      s.actors[R].want.target,
    );
  });
  it("saves nothing new: only the want, and a reload agrees", () => {
    stage(item("greek-figs"), item("greek-shovel"), item("greek-wine-skin"));
    const s = world();
    const legacy = world().actors["greek-guard"];
    // The same record as any resident's: staging adds no field.
    const extra = Object.keys(s.actors[R]).filter(
      (key) => !Object.hasOwn(legacy, key),
    );
    expect(extra).toEqual([]);
    expect(Object.keys(s.actors[R])).not.toContain("wants");
    expect(JSON.stringify(s)).not.toMatch(/"(staged\w*|wants)":/u);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("leaves a resident with one want exactly as before", () => {
    for (const pack of packDefinitions) {
      for (const [id, person] of Object.entries(pack.avatars)) {
        // Two shipped residents carry staged wants (rules 133): Antigone's
        // burial and RATi's keepsakes. Everyone else has one want or none.
        if (STAGED[id]) {
          expect(person.want, id).toBeUndefined();
          expect(person.wants.length, id).toBe(STAGED[id]);
          continue;
        }
        expect(person.wants, id).toBeUndefined();
        expect(stagedWants(world(), id).length, id).toBe(person.want ? 1 : 0);
      }
    }
    const s = world();
    expect(termsOf(s.actors[R].want)).toEqual(termsOf(authoredWant(R)));
    s.actors[R].place = authoredWant(R).target;
    if (authoredWant(R).kind === "place") {
      settleWants(s, [R], wantAPI(s));
      expect(s.actors[R].content).toBe(true);
    }
  });
});

describe("a bond through staged gifts", () => {
  it("raises trust by a plain Give at each stage, and withholds a want below its minTrust", () => {
    stage(
      item("greek-wine-skin"),
      item("greek-shovel", { minTrust: 2 }),
      item("greek-figs", { minTrust: 3 }),
    );
    let s = world();
    s.actors.vale.place = gate;
    s.actors[R].place = gate;
    s.packs["greek-drama"].met[R] = 0;
    const trusts = [];
    for (let stageNo = 0; stageNo < 3; stageNo++) {
      const want = s.actors[R].want;
      expect(want, `stage ${stageNo}`).toBeTruthy();
      const entry = stagedWants(s, R).find(
        (e) => e.want.target === want.target,
      );
      const trust = s.actors[R].trust.vale;
      // Told only to a listener who trusts her enough.
      expect(revealed(s, R, want, "vale")).toBe(
        trust >= (entry.want.minTrust ?? 0),
      );
      s.items[want.target].holder = "vale";
      const give = legalActions(s).find(
        (a) => a.kind === "give" && a.item === want.target && a.target === R,
      );
      expect(give, `give ${want.target}`).toBeTruthy();
      const done = play(s, give, s.revision);
      expect(done.ok, done.error).toBe(true);
      s = done.state;
      trusts.push(s.actors[R].trust.vale);
      expect(s.actors[R].want?.target).not.toBe(want.target);
    }
    expect(trusts).toEqual([1, 2, 3]);
  });
});
