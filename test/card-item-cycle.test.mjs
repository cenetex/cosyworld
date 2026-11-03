import { describe, expect, it, vi } from "vitest";

// Rules 95: things used up and coming back, on a test copy of the Greek pack.
// The fixture adds a homed loop (bread, figs and wine regrow; Myrto makes the
// provisions from them; the Piraeus voyage spends them) and a two-thing kit.
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const { itemCycleFixture } = await import("./helpers/item-cycle-fixture.mjs");
  return { default: itemCycleFixture((await importOriginal()).default) };
});

import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  entityActive,
  packDefinition,
  packDefinitions,
  hub,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { usedUp } from "../v2/card-game/item-use.mjs";
import { itemEvents } from "../v2/card-game/pack-items.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { nameOf, seedRun } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  availableCards,
  cardActions,
  sealedReason,
} from "../v2/card-game/cards.mjs";
import { exits } from "../v2/card-game/world.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";

const LOOP = ["greek-bread", "greek-test-figs", "greek-test-wine"];
const reload = (s) => decodeSave(encodeSave(s));
function act(s, kind, fields = {}, actor = "vale") {
  const action = legalActions(s, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return reload(result.state);
}
const wait = (s) => act(s, "wait", { sleep: undefined });
// A world at the Wine-Dark Harbor, with the bread already baked.
function harbor() {
  let s = enableMotives(createWorld());
  s.actors.vale.place = "greek-courtyard";
  s.crossings["pond-greek-harbor"].discovered = true;
  for (const id of ["lamp", "cloth"]) s.items[id].holder = "pond";
  s.items["greek-water-jar"].holder = "vale";
  s = act(reload(s), "give", {
    item: "greek-water-jar",
    target: "greek-baker",
  });
  s.actors.vale.place = "greek-harbor";
  return reload(s);
}
// Each thing is one record: in play exactly when it is not used up, and a
// used-up thing waits unseen and blank at its authored holder.
function unique(s) {
  const pack = packDefinition("greek-drama");
  for (const id of [...LOOP, "greek-provisions"]) {
    expect(Object.keys(s.items).filter((k) => k === id)).toHaveLength(1);
    if (usedUp(s, id)) {
      expect(entityActive(s, id)).toBe(false);
      expect(s.items[id].holder).toBe(pack.items[id].holder);
      expect(s.items[id].history).toEqual([]);
    }
  }
  expect(new Set(s.usedUp).size).toBe(s.usedUp.length);
}
const toTurn = (s, turn) => {
  s.turn = turn;
  s.revision = Math.max(s.revision, turn);
  return reload(s);
};
const gather = (s) => {
  for (const id of LOOP) s.items[id].holder = "vale";
  return reload(s);
};

describe("rules 95 item cycle", () => {
  it("accepts the loop and rejects data that could strand it", () => {
    const pack = packDefinition("greek-drama");
    const places = packDefinitions.flatMap((p) => Object.keys(p.places));
    expect(packProblems(pack, hub, places)).toEqual([]);
    const broken = (edit) => {
      const copy = structuredClone(pack);
      edit(copy);
      return packProblems(copy, hub, places).join("; ");
    };
    expect(broken((p) => delete p.items["greek-test-figs"].home)).toMatch(
      /regrow need|must renew/u,
    );
    expect(broken((p) => delete p.items["greek-test-wine"].regrow)).toMatch(
      /greek-test-wine must renew/u,
    );
    expect(
      broken((p) => {
        const lanes = p.transports["greek-ship"].lanes;
        lanes.splice(
          lanes.findIndex(
            (l) => l.from === "greek-piraeus" && l.to === "greek-harbor",
          ),
          1,
        );
      }),
    ).toMatch(/free way back/u);
    expect(broken((p) => (p.kits[0].items = ["greek-decree"]))).toMatch(
      /kit greek-test-kit/u,
    );
    // A thing used up by one choice and needed by another must renew.
    expect(
      broken((p) => {
        p.choices.find((c) => c.id === "greek-return-water-jar").effects[0] = {
          kind: "retire_item",
          item: "greek-water-jar",
        };
        p.choices.push({
          ...p.choices.find((c) => c.id === "greek-return-water-jar"),
          id: "greek-test-jar-again",
          effects: [
            { kind: "set_flag", key: "greek-water-returned", value: true },
          ],
        });
      }),
    ).toMatch(/greek-water-jar is used up/u);
  });

  it("starts the made thing used up and folds an older save once", () => {
    const s = harbor();
    expect(s.usedUp).toEqual(["greek-provisions"]);
    expect(entityActive(s, "greek-provisions")).toBe(false);
    // A save from before rules 95 has no list: the untouched provisions
    // leave play, and a carried copy would have stayed.
    const old = JSON.parse(encodeSave(s));
    delete old.usedUp;
    expect(decodeSave(JSON.stringify(old)).usedUp).toEqual([
      "greek-provisions",
    ]);
    old.items["greek-provisions"] = { holder: "vale", history: ["Turn 1: x"] };
    expect(decodeSave(JSON.stringify(old)).usedUp).toEqual([]);
  });

  it("makes the provisions from the set and again only once they are used up", () => {
    let s = gather(harbor());
    s.actors["greek-shipmaster"].want = {
      kind: "item",
      target: "greek-provisions",
      since: 0,
      refusals: 0,
    };
    expect(wantFact(s, "greek-shipmaster", nameOf)).toBe(
      "I want the Travel Provisions: the Courtyard Bread, the Test Figs and the Test Wine or the Test Water.",
    );
    s = act(s, "give", { item: "greek-test-figs", target: "greek-shipmaster" });
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
    expect(s.usedUp).toEqual([...LOOP].sort());
    unique(s);
    // Myrto leaves what she makes on the landing.
    s = wait(wait(s));
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
    // With the provisions in play, the same set is an ordinary gift.
    s.usedUp = [];
    s = gather(s);
    s = act(s, "give", { item: "greek-test-figs", target: "greek-shipmaster" });
    expect(usedUp(s, "greek-bread")).toBe(false);
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
    unique(s);
  });

  it("regrows each thing at home on its own event and never while in play", () => {
    let s = gather(harbor());
    s = act(s, "give", { item: "greek-bread", target: "greek-shipmaster" });
    s = toTurn(s, DAYLIGHT_TURNS * 2 - 1);
    s = wait(s);
    expect(itemEvents(s)).toEqual(["dawn"]);
    expect(s.items["greek-bread"].holder).toBe("greek-courtyard");
    expect(usedUp(s, "greek-test-wine")).toBe(true);
    expect(usedUp(s, "greek-test-figs")).toBe(true);
    expect(
      s.log.some(
        (e) => e.text === "The Theban Courtyard has the Courtyard Bread again.",
      ),
    ).toBe(true);
    s = toTurn(s, DAYLIGHT_TURNS * 3 - 1);
    s = wait(s);
    expect(itemEvents(s)).toEqual(["dusk"]);
    expect(s.items["greek-test-wine"].holder).toBe("greek-gate");
    expect(usedUp(s, "greek-test-figs")).toBe(true);
    // A long rest at the sanctuary brings the figs back.
    s.actors.vale.place = "greek-sanctuary";
    s = reload(s);
    s = act(s, "wait", { sleep: true });
    expect(s.actors.vale.sleeping).toBeUndefined();
    expect(s.items["greek-test-figs"].holder).toBe("greek-sanctuary");
    expect(s.usedUp).toEqual([]);
    unique(s);
  });

  it("spends the provisions on the voyage and keeps the free way home", () => {
    let s = gather(harbor());
    s = act(s, "give", { item: "greek-test-wine", target: "greek-shipmaster" });
    s = act(s, "take", { item: "greek-provisions" });
    s = act(s, "move", { target: "greek-ship" });
    s = act(s, "course", { target: "greek-piraeus" });
    s = wait(s);
    expect(usedUp(s, "greek-provisions")).toBe(true);
    expect(
      s.log.some((e) => e.text === "The voyage uses up the Travel Provisions."),
    ).toBe(true);
    // The ship can still sail home, and loose homed things on deck stay on
    // the quay it leaves.
    s.items["greek-bread"].holder = "greek-ship";
    s.usedUp = s.usedUp.filter((id) => id !== "greek-bread");
    s = reload(s);
    s = act(s, "course", { target: "greek-harbor" });
    expect(s.items["greek-bread"].holder).toBe("greek-piraeus");
    unique(s);
  });

  it("sends home at dawn a thing held by an absent traveler or lying astray", () => {
    const players = ["vale", "mara"];
    let s = dispatchShared({ op: "create", save: encodeSave(harbor()) }).world;
    for (const id of players) s.actors[id].place = "greek-harbor";
    s.items["greek-test-figs"].holder = "mara";
    s.items["greek-test-water"].holder = "mara";
    s.items["greek-test-wine"].holder = "greek-harbor";
    s.items["greek-bread"].holder = "vale";
    s = toTurn(s, DAYLIGHT_TURNS * 2 - 1);
    const ask = (world, op, extra = {}) =>
      dispatchShared({
        world,
        actor: "vale",
        op,
        claimed: players,
        present: ["vale"],
        ...extra,
      });
    const dawn = (world) =>
      ask(world, "play", {
        action: ask(world, "view").actions.find((a) => a.kind === "wait"),
      }).world;
    s = dawn(s);
    // Only a thing marked absentReturn leaves an absent traveler's hands.
    expect(s.items["greek-test-figs"].holder).toBe("greek-sanctuary");
    expect(s.items["greek-test-water"].holder).toBe("mara");
    // A thing laid down is first only seen astray, so a rite can use it.
    expect(s.items["greek-test-wine"].holder).toBe("greek-harbor");
    expect(s.astray).toEqual({ "greek-test-wine": "greek-harbor" });
    // A present traveler keeps what they hold.
    expect(s.items["greek-bread"].holder).toBe("vale");
    // Still there at the next dawn, it goes home.
    s = dawn(toTurn(s, DAYLIGHT_TURNS * 4 - 1));
    expect(s.items["greek-test-wine"].holder).toBe("greek-gate");
    expect(s.astray).toBeUndefined();
  });

  it("scatters a kit once it is home, the same way on every replay", () => {
    let s = harbor();
    s = toTurn(s, DAYLIGHT_TURNS * 2 - 1);
    const a = wait(s),
      b = wait(s);
    const at = (w) =>
      ["greek-test-shell", "greek-test-stone"].map((id) => w.items[id].holder);
    expect(at(a)).toEqual(at(b));
    expect(new Set(at(a)).size).toBe(2);
    for (const place of at(a))
      expect(["greek-courtyard", "greek-palace", "forest-cottage"]).toContain(
        place,
      );
    expect(a.scatters).toEqual({ "greek-test-kit": 1 });
    // Away from home, a kit thing waits to be brought back: no dawn undoes it.
    const later = wait(toTurn(a, DAYLIGHT_TURNS * 4 - 1));
    expect(at(later)).toEqual(at(a));
    // A different run seed scatters differently somewhere in a few dawns.
    const seeds = new Set();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = seedRun(structuredClone(s), seed);
      seeds.add(at(wait(reload(w))).join());
    }
    expect(seeds.size).toBeGreaterThan(1);
  });

  it("clears a grievance's link to a thing that is used up", () => {
    let s = gather(harbor());
    s.motives.grievances["greek-shipmaster"].push({
      other: "vale",
      kind: "threat",
      reason: "Vale took the bread.",
      incident: "event:1",
      lastTouched: 1,
      repaired: false,
      item: "greek-bread",
      weight: 1,
      turn: 1,
    });
    s = act(s, "give", { item: "greek-bread", target: "greek-shipmaster" });
    expect(
      s.motives.grievances["greek-shipmaster"].at(-1).item,
    ).toBeUndefined();
  });

  it("shows a sealed gate card that gives the quest to open it", () => {
    let s = harbor();
    s.actors.vale.place = "greek-gate";
    s.items["greek-decree"].holder = "vale";
    s = reload(s);
    expect(exits(s, "greek-gate", "vale")).not.toContain("greek-battlefield");
    expect(availableCards(s)).toContain("greek-battlefield");
    expect(sealedReason(s, "greek-battlefield")).toMatch(/holds an order/u);
    const row = cardActions(s, ["greek-battlefield"]).actions;
    expect(row.map((a) => a.kind)).toEqual(["gate"]);
    const turn = s.turn;
    s = act(s, "gate", { target: "greek-battlefield" });
    expect(s.turn).toBe(turn);
    expect(s.actors.vale.want).toMatchObject({
      kind: "item",
      target: "greek-decree",
      step: { verb: "give", to: "greek-guard" },
      story: true,
    });
    expect(s.log.at(-1).text).toBe(
      "Vale takes up a quest: give the Burial Decree to the Gate Guard.",
    );
    // The quest is on top, so the card only says why.
    expect(cardActions(s, ["greek-battlefield"]).actions).toEqual([]);
    const xp = s.actors.vale.xp;
    s = act(s, "give", { item: "greek-decree", target: "greek-guard" });
    expect(s.actors.vale.xp).toBe(xp + 1);
    expect(sealedReason(s, "greek-battlefield")).toBe(null);
    expect(exits(s, "greek-gate", "vale")).toContain("greek-battlefield");
  });

  it("keeps one of everything over three laps of the loop", () => {
    let s = harbor();
    for (let lap = 1; lap <= 3; lap++) {
      // Each lap waits for the next dawn, dusk and a long rest to regrow
      // the set, gathers it, and spends the provisions on the voyage.
      if (lap > 1) {
        for (const light of [0, 1]) {
          let t = (Math.floor(s.turn / DAYLIGHT_TURNS) + 1) * DAYLIGHT_TURNS;
          if ((t / DAYLIGHT_TURNS) % 2 !== light) t += DAYLIGHT_TURNS;
          s = wait(toTurn(s, t - 1));
        }
        s.actors.vale.place = "greek-sanctuary";
        s = act(reload(s), "wait", { sleep: true });
        unique(s);
        expect(s.usedUp).toEqual(["greek-provisions"]);
        for (const id of LOOP) s.items[id].holder = "vale";
        s.actors.vale.place = "greek-harbor";
        // The roaming Bard may have taken the ship; call it back.
        summonTransport(s, "greek-ship", "greek-harbor");
        s = reload(s);
      } else s = gather(s);
      s = act(s, "give", { item: "greek-bread", target: "greek-shipmaster" });
      unique(s);
      s = act(s, "take", { item: "greek-provisions" });
      s = act(s, "move", { target: "greek-ship" });
      s = act(s, "course", { target: "greek-piraeus" });
      s = wait(s);
      unique(s);
      expect(s.usedUp).toEqual([...LOOP, "greek-provisions"].sort());
      s = act(s, "course", { target: "greek-harbor" });
      s = wait(s);
      s = act(s, "move", { target: "greek-harbor" });
    }
  });

  it("takes either alternative for a set slot and uses up only the one given", () => {
    let s = harbor();
    for (const id of ["greek-bread", "greek-test-figs", "greek-test-water"])
      s.items[id].holder = "vale";
    s = act(reload(s), "give", {
      item: "greek-test-water",
      target: "greek-shipmaster",
    });
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
    expect(usedUp(s, "greek-test-water")).toBe(true);
    expect(s.items["greek-test-wine"].holder).toBe("greek-gate");
    expect(usedUp(s, "greek-test-wine")).toBe(false);
    s.actors["greek-shipmaster"].want = {
      kind: "item",
      target: "greek-provisions",
      since: 0,
      refusals: 0,
    };
    expect(wantFact(s, "greek-shipmaster", nameOf)).toBe(
      "I want the Travel Provisions: the Courtyard Bread, the Test Figs and the Test Wine or the Test Water.",
    );
  });
});
