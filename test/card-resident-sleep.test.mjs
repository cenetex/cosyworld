// Rules 100, world life: residents sleep on schedules scattered by the seed,
// at home, and wake for a Talk, a threat or a ring.
import { describe, expect, it } from "vitest";
import { legalActions } from "../v2/card-game/world.mjs";
import { DAY_TURNS, lifeHome } from "../v2/card-game/resident-home.mjs";
import { sleepSchedule, sleepWindow } from "../v2/card-game/resident-sleep.mjs";
import { asleepReason } from "../v2/card-game/cards.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import {
  act,
  lifeWorld,
  reload,
  wait,
  waitUntil,
} from "./helpers/world-life.mjs";

describe("resident sleep", () => {
  it("keeps Pip and Nix nocturnal and scatters bedtimes by the seed", () => {
    expect(sleepSchedule("moth")).toEqual({ from: 0, to: 20 });
    expect(sleepSchedule("hoppycat-nix-fermata")).toEqual({ from: 46, to: 22 });
    expect(sleepSchedule("keeper")).toEqual({ from: 35, to: 2 });
    expect(sleepSchedule("greek-creon")).toEqual({ from: 30, to: 47 });
    expect(sleepSchedule("greek-shipmaster")).toEqual({ from: 30, to: 45 });
    expect(sleepSchedule("badger")).toEqual({ from: 28, to: 46 });
    expect(sleepSchedule("greek-rhapsode")).toBe(null);
    expect(sleepSchedule("mara")).toEqual({ from: 32, to: 0 });
    const s = lifeWorld();
    const starts = new Set();
    for (const id of Object.keys(packPeople).filter((id) => sleepSchedule(id)))
      for (const day of [1, 2, 3]) {
        const w = sleepWindow(s, id, day);
        const z = sleepSchedule(id);
        expect(sleepWindow(structuredClone(s), id, day)).toEqual(w);
        expect(Math.abs(w.start - (day * DAY_TURNS + z.from))).toBeLessThan(4);
        starts.add(w.start % DAY_TURNS);
      }
    // The world never drops asleep at once.
    expect(starts.size).toBeGreaterThan(5);
    const other = lifeWorld({ seed: 8 });
    expect(
      Object.keys(packPeople).some(
        (id) =>
          sleepSchedule(id) &&
          sleepWindow(other, id, 2).start !== sleepWindow(s, id, 2).start,
      ),
    ).toBe(true);
    // Nocturnal Pip sleeps through the day and wakes for the night.
    const pip = sleepWindow(s, "moth", 2);
    expect(pip.start).toBeLessThan(2 * DAY_TURNS + 4);
    expect(pip.end).toBeGreaterThan(2 * DAY_TURNS + 16);
  });

  it("sleeps no one on the first day, then each at home on its schedule", () => {
    let s = lifeWorld({ turn: 0, place: "greek-harbor" });
    s = wait(s, DAY_TURNS - 1);
    expect(Object.values(s.actors).some((a) => a.sleeping)).toBe(false);
    // Day two, 04:00: the diurnal cast sleeps, nocturnal Pip is awake.
    s = waitUntil(s, DAY_TURNS + 44);
    for (const id of ["greek-creon", "greek-ismene", "greek-baker"]) {
      expect(s.actors[id].sleeping, id).toMatchObject({ place: lifeHome(id) });
      expect(s.actors[id].sleeping.until).toBe(sleepWindow(s, id, 1).end);
    }
    expect(s.actors.moth.sleeping).toBeUndefined();
    // The keeper has no errand to wake Pip with Talk during this schedule check.
    Object.assign(s.actors.keeper, { want: null, content: true, metTurn: s.turn });
    // Day three, 11:00: Pip sleeps at the pond, the Greek cast is up.
    s = waitUntil(s, 2 * DAY_TURNS + 10);
    expect(s.actors.moth.sleeping).toMatchObject({ place: "pond" });
    expect(s.actors["greek-creon"].sleeping).toBeUndefined();
    const reloaded = reload(s);
    expect(reloaded).toEqual(s);
  });

  it("wakes for Talk, a threat or a ring, and keeps Ask, Trade and Invite for waking", () => {
    // The keeper at the station after midnight, holding the bell.
    let s = lifeWorld({ turn: DAY_TURNS + 38, place: "station" });
    s.actors.keeper.place = "station";
    s.items.bell.holder = "keeper";
    s.items.cloth.holder = "vale";
    s = reload(s);
    s = wait(s, 2);
    expect(s.actors.keeper.sleeping?.until).toBeGreaterThan(s.turn);
    const plays = legalActions(s);
    for (const kind of ["ask", "trade", "accompany"])
      expect(plays.some((a) => a.kind === kind && a.target === "keeper")).toBe(
        false,
      );
    expect(asleepReason(s, ["bell"])).toBe("The keeper is asleep");
    expect(asleepReason(s, ["keeper", "pond"])).toBe("The keeper is asleep");
    // No planner turn while asleep: the keeper asks nothing of anyone.
    const asked = s.log.filter((e) => e.actorId === "keeper").length;
    s = wait(s);
    expect(s.log.filter((e) => e.actorId === "keeper").length).toBe(asked);
    // A Give is kept for waking.
    const gave = act(s, "give", { item: "cloth", target: "keeper" });
    expect(gave.items.cloth.holder).toBe("keeper");
    expect(gave.actors.keeper.sleeping).toBeDefined();
    // Talk wakes it, and it stays awake until its next bedtime.
    let talked = act(s, "talk", { target: "keeper" });
    expect(talked.actors.keeper.sleeping).toBeUndefined();
    expect(
      talked.log.findLast((e) => e.verb === "talk" && e.actorId === "vale")
        .text,
    ).toMatch(/The keeper wakes\./u);
    talked = wait(talked, 3);
    expect(talked.actors.keeper.sleeping).toBeUndefined();
    // A ring where it sleeps wakes it too.
    const s2 = structuredClone(s);
    s2.items.bell.holder = "vale";
    const rung = act(reload(s2), "ring", { item: "bell" });
    expect(rung.actors.keeper.sleeping).toBeUndefined();
  });

  it("wakes a resident threatened in its sleep", () => {
    let s = lifeWorld({ turn: DAY_TURNS + 40, place: "greek-palace" });
    s = wait(s);
    expect(s.actors["greek-creon"].sleeping).toBeDefined();
    s = act(s, "threaten", { target: "greek-creon" });
    expect(s.actors["greek-creon"].sleeping).toBeUndefined();
    expect(s.standoffs).toHaveLength(1);
  });
});
