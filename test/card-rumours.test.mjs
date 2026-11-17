import { describe, expect, it } from "vitest";
import {
  HEARD_FROM,
  dailyRumours,
  dayOf,
  hear,
  heardWant,
  noteRumours,
  restless,
  rumourWords,
  talkRumours,
  validRumours,
} from "../v2/card-game/world/rumours.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";

const DAY = 48;
const rumour = (subject, extra = {}) => ({
  subject,
  kind: "item",
  at: "glade",
  holder: "x",
  teller: null,
  hops: 0,
  day: 0,
  ...extra,
});
const resident = (extra = {}) => ({ place: "glade", trust: {}, xp: 0, want: null, ...extra });
function world(actors, items = { cup: { holder: "x" }, bell: { holder: "x" } }) {
  return { turn: 0, run: { seed: 7 }, log: [], items, actors };
}
const api = (gone = [], worlds = {}, inactive = []) => ({
  player: (id) => id === "p",
  active: (id) => !inactive.includes(id),
  gone: (id) => gone.includes(id),
  worldOf: (id) => worlds[id] ?? "w1",
  kindOf: (id) => (["cup", "bell"].includes(id) ? "item" : id === "hill" ? "place" : "person"),
  valueOf: () => 2,
  thick: () => null,
});
const calm = (s, id) => {
  while (restless(s, id)) s.turn += DAY;
  return s;
};

describe("rumours", () => {
  it("spreads a rumour only to a listener it matters to, the same way each time", () => {
    const build = () => {
      const s = world({
        x: resident(),
        a: resident({ rumours: [rumour("cup")] }),
        b: resident({ want: { kind: "item", target: "cup", since: 0, refusals: 0 } }),
        c: resident(),
      });
      s.turn = DAY;
      dailyRumours(s, api());
      return s;
    };
    const s = build();
    expect(s.actors.b.rumours).toEqual([rumour("cup", { teller: "a", hops: 1, day: 1 })]);
    expect(s.actors.c.rumours).toBeUndefined();
    expect(JSON.stringify(build())).toBe(JSON.stringify(s));
    expect(rumourWords(s, s.actors.b.rumours[0], { name: (id) => id, world: () => null, legend: () => null })).toBe(
      "a told me: cup is at glade.",
    );
  });

  it("stops telling after two failed tellings", () => {
    const s = world({
      a: resident({ rumours: [rumour("cup")] }),
      b: resident({ rumours: [rumour("cup")] }),
      c: resident({ rumours: [rumour("cup")] }),
    });
    s.turn = DAY;
    dailyRumours(s, api());
    expect(s.actors.a.rumours[0].fails).toBe(2);
    s.turn = 2 * DAY;
    dailyRumours(s, api());
    expect(s.actors.a.rumours[0].fails).toBe(2);
    for (const id of ["a", "b", "c"]) expect(validRumours(s, id)).toBe(true);
  });

  it("drops a rumour nobody retells for five days unless it is the holder's want", () => {
    const s = world({
      a: resident({ rumours: [rumour("cup")] }),
      b: resident({ rumours: [rumour("cup")], want: { kind: "item", target: "cup", since: 0, refusals: 0 } }),
    }, { cup: { holder: "glade" } });
    s.actors.a.place = "hill";
    s.turn = 5 * DAY;
    dailyRumours(s, api());
    expect(s.actors.a.rumours).toBeUndefined();
    expect(s.actors.b.rumours).toHaveLength(1);
  });

  it("keeps at most three rumours, ranked", () => {
    const s = world({ a: resident() });
    for (const [i, id] of ["w", "x", "y", "z"].entries()) hear(s, "a", rumour(id, { day: i, holder: null }));
    expect(s.actors.a.rumours.map((r) => r.subject)).toEqual(["z", "y", "x"]);
  });

  it("makes rumours from a resident taking an item, for those who value it", () => {
    const was = world({ a: resident(), b: resident(), p: resident() }, { cup: { holder: "glade" } });
    const s = structuredClone(was);
    s.items.cup.holder = "a";
    noteRumours(was, s, api(), api());
    expect(s.actors.b.rumours).toEqual([rumour("cup", { holder: "a" })]);
    expect(s.actors.p.rumours).toHaveLength(1);
    expect(s.actors.a.rumours).toBeUndefined();
  });

  it("scores a trusted model's want above hearsay and breaks ties the same way", () => {
    const s = calm(world({
      x: resident(),
      a: resident({ trust: { m: 3 }, rumours: [rumour("bell")] }),
      m: resident({ want: { kind: "item", target: "cup", since: 0, refusals: 0 } }),
    }), "a");
    const again = structuredClone(s);
    expect(heardWant(s, "a", api())).toMatchObject({ kind: "item", target: "cup", from: HEARD_FROM });
    const twin = structuredClone(again);
    expect(heardWant(again, "a", api())).toEqual(heardWant(twin, "a", api()));
    expect(heardWant(s, "a", api())).toBeNull();
  });

  it("caps thin wants on one subject and never draws on a restless day", () => {
    const thin = { kind: "item", target: "cup", since: 0, refusals: 0, from: HEARD_FROM };
    const s = calm(world({
      x: resident(),
      a: resident({ trust: { t: 1 }, rumours: [rumour("cup", { teller: "t", hops: 1 })] }),
      b: resident({ want: thin }),
    }), "a");
    expect(heardWant(s, "a", api())).toBeNull();
    s.actors.b.want = null;
    expect(heardWant(structuredClone(s), "a", api())).toMatchObject({ target: "cup" });
    while (!restless(s, "a")) s.turn += DAY;
    expect(heardWant(s, "a", api())).toBeNull();
  });

  it("never wants a lost, inactive or gone thing", () => {
    const s = calm(world({
      x: resident(),
      a: resident({
        trust: { t: 1 },
        rumours: ["cup", "bell", "hill"].map((id) => rumour(id, { teller: "t", kind: id === "hill" ? "gone" : "item" })),
      }),
    }), "a");
    expect(heardWant(structuredClone(s), "a", api())).toMatchObject({ kind: "item" });
    expect(heardWant(s, "a", api(["cup"], {}, ["bell"]))).toBeNull();
  });

  it("passes the player's best-fitting rumour through Talk", () => {
    const s = world({
      x: resident(),
      p: resident({ rumours: [rumour("bell"), rumour("cup", { day: 0 })] }),
      a: resident({ want: { kind: "item", target: "cup", since: 0, refusals: 0 }, rumours: [rumour("hill", { kind: "place", holder: null })] }),
    });
    talkRumours(s, "p", "a");
    expect(s.actors.a.rumours.map((r) => r.subject)).toEqual(["cup", "hill"]);
    expect(s.actors.p.rumours.some((r) => r.subject === "hill" && r.teller === "a")).toBe(true);
  });

  it("seeds authored bonds and rebuilds the same rumours on replay", () => {
    const run = () => {
      let s = createWorld();
      for (let i = 0; i < 60; i++) {
        const a = legalActions(s).find((x) => x.kind === "wait" && !x.sleep);
        if (!a) break;
        s = play(s, a).state;
      }
      return s;
    };
    const s = run();
    expect(s.actors["greek-antigone"].trust["greek-ismene"]).toBe(3);
    expect(dayOf(s)).toBeGreaterThan(0);
    const rumours = (w) => JSON.stringify(Object.values(w.actors).map((a) => [a.rumours, a.heardOn]));
    expect(rumours(run())).toBe(rumours(s));
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });
});
