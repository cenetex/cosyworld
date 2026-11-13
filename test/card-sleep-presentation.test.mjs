import { describe, expect, it } from "vitest";
import { createWorld, homeOf, legalActions, play } from "../v2/card-game/world.mjs";
import { DAYLIGHT_TURNS, isNight } from "../v2/card-game/daylight.mjs";
import { questsOf, sleepQuest } from "../v2/card-game/want.mjs";
import {
  CONFIRM_MS,
  DREAM_WAIT_MS,
  beatMs,
  createSleepSequence,
  dreamText,
  sleepPlan,
  sleepWake,
} from "../v2/card-game/sleep-presentation.mjs";
import {
  DREAMING_LABEL,
  DREAM_LABEL,
  DREAM_TIER,
  dreamBeat,
  withDream,
} from "../v2/card-game/dream-card.mjs";
import {
  UNPAINTED_NIGHT_TINT,
  gradeStrength,
  gradedNight,
  hourOf,
  lightAt,
  tintShade,
} from "../v2/card-game/stage-light.mjs";

// Vale sleeps in the attic (a sanctuary) from `from` until the light changes.
function sleepFrom(from, { xp = 6, dream = false } = {}) {
  let w = createWorld();
  w.actors.vale.place = "attic";
  w.turn = from;
  w.revision = Math.max(w.revision, from);
  w.actors.vale.xp = xp;
  w.actors.vale.level = 1;
  if (dream) sleepQuest(w, "vale", { home: homeOf });
  w.actors.moth.want = null;
  w.actors.keeper.want = null;
  w = play(
    w,
    legalActions(w, "vale").find((a) => a.kind === "wait"),
    w.revision,
    "vale",
  ).state;
  const before = w.turn;
  w = play(
    w,
    legalActions(w, "vale").find((a) => a.sleep),
    w.revision,
    "vale",
  ).state;
  return { world: w, before };
}

// A hand-driven clock for the sequence's timers.
function clock() {
  let now = 0,
    id = 0;
  const timers = new Map();
  return {
    schedule: (fn, ms) => (timers.set(++id, { fn, at: now + ms }), id),
    cancel: (t) => timers.delete(t),
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}
function sequence(plan) {
  const c = clock();
  const beats = [];
  let finished = 0;
  const s = createSleepSequence({
    plan,
    schedule: c.schedule,
    cancel: c.cancel,
    changed: (state) => {
      if (beats.at(-1) !== state.beat) beats.push(state.beat);
    },
    finishReveal: () => finished++,
  });
  return { s, c, beats, finished: () => finished };
}
const DREAM_PLAN = sleepPlan({ dream: true, crossed: true });

describe("waking from a sleep", () => {
  it("deals no quest in a long rest, however much experience is held", () => {
    const { world, before } = sleepFrom(30);
    expect(world.turn).toBe(2 * DAYLIGHT_TURNS);
    const wake = sleepWake(world, "vale", before);
    expect(wake).toMatchObject({
      id: "vale",
      woke: "dawn",
      long: true,
      crossed: true,
      night: false,
      dream: false,
    });
    expect(questsOf(world, "vale")).toEqual([]);
    expect(sleepPlan(wake)).toEqual(["fade", "held", "light", "done"]);
  });

  it("shows the dream card for the long rest that meets the sleep quest", () => {
    const { world, before } = sleepFrom(30, { dream: true });
    const wake = sleepWake(world, "vale", before);
    expect(wake).toMatchObject({ woke: "dawn", long: true, dream: true });
    expect(wake.glimpse).toMatchObject({ kind: "arcanum" });
    expect(questsOf(world, "vale")).toEqual([]);
    expect(sleepPlan(wake)).toEqual(DREAM_PLAN);
  });

  it("shows no dream card for an ordinary long rest, only the dusk or dawn", () => {
    const { world, before } = sleepFrom(6, { xp: 0 });
    expect(world.turn).toBe(DAYLIGHT_TURNS);
    const wake = sleepWake(world, "vale", before);
    expect(wake).toMatchObject({ woke: "dusk", long: true, night: true });
    expect(wake.dream).toBe(false);
    expect(sleepPlan(wake)).toEqual(["fade", "held", "light", "done"]);
  });

  it("only dims and lifts a sleep that crosses no light", () => {
    expect(sleepPlan({ dream: false, crossed: false })).toEqual([
      "dim",
      "lift",
      "done",
    ]);
  });

  it("ignores an earlier wake and a wake that moved the sleeper", () => {
    const { world } = sleepFrom(30);
    expect(sleepWake({ ...world, turn: world.turn + 1 }, "vale")).toBeNull();
    const moved = structuredClone(world);
    moved.log.at(-1).woke = "moved";
    expect(sleepWake(moved, "vale")).toBeNull();
  });

  it("reads the dream from the saved inner life", () => {
    const w = {
      memories: {
        vale: { innerLife: { dreams: [{ turn: 48, text: "A box." }] } },
      },
    };
    expect(dreamText(w, "vale", 48)).toBe("A box.");
    expect(dreamText(w, "vale", 24)).toBeNull();
  });
});

describe("the dream sequence", () => {
  it("plays dark, the DREAM card, its words, then the light", () => {
    const { s, c, beats } = sequence(DREAM_PLAN);
    s.start();
    c.tick(beatMs("fade") + beatMs("held") + beatMs("enter"));
    expect(s.beat).toBe("dreaming");
    // Dreaming waits on the words, however long they take.
    c.tick(10_000);
    expect(s.beat).toBe("dreaming");
    s.dreamed("I dreamt of the cottage.");
    expect(s.state()).toMatchObject({
      beat: "dream",
      text: "I dreamt of the cottage.",
    });
    s.revealed();
    c.tick(10_000);
    expect(s.beat).toBe("dream");
    expect(s.tap()).toBe("next");
    expect(s.beat).toBe("light");
    c.tick(beatMs("light"));
    expect(beats).toEqual(DREAM_PLAN);
    // No quest is dealt on waking: the plan has no such beat.
    expect(DREAM_PLAN).not.toContain("quest");
  });

  it("lets a tap finish each beat, the dream's writing first", () => {
    const { s, finished } = sequence(DREAM_PLAN);
    s.start();
    s.dreamed("A carved box.");
    // A tap finishes each beat: fade, held, then the card's entrance.
    expect(s.tap()).toBe("next");
    expect(s.beat).toBe("held");
    s.tap();
    s.tap();
    // Words that came in the dark need no "Dreaming…".
    expect(s.beat).toBe("dream");
    // A tap while the dream is written finishes writing it.
    expect(s.tap()).toBe("finished");
    expect(finished()).toBe(1);
    s.revealed();
    expect(s.tap()).toBe("next");
    expect(s.beat).toBe("light");
    s.tap();
    expect(s.beat).toBe("done");
  });

  it("cancels Dreaming… in two taps, and the dream reads …", () => {
    const { s, c } = sequence(DREAM_PLAN);
    s.start();
    s.tap();
    s.tap();
    s.tap();
    expect(s.beat).toBe("dreaming");
    expect(s.tap()).toBe("armed");
    expect(s.state()).toMatchObject({ beat: "dreaming", armed: true });
    expect(s.tap()).toBe("cancelled");
    expect(s.state()).toMatchObject({ beat: "dream", text: "…" });
    // Words arriving after the cancel change nothing.
    s.dreamed("Too late.");
    expect(s.state().text).toBe("…");
    c.tick(0);
  });

  it("puts an asked cancel back after a pause", () => {
    const { s, c } = sequence(DREAM_PLAN);
    s.start();
    c.tick(beatMs("fade") + beatMs("held") + beatMs("enter"));
    s.tap();
    expect(s.state().armed).toBe(true);
    c.tick(CONFIRM_MS);
    expect(s.state()).toMatchObject({ beat: "dreaming", armed: false });
    expect(s.tap()).toBe("armed");
  });

  it("shows … when the words fail or never come, with no retry", () => {
    const failed = sequence(DREAM_PLAN);
    failed.s.start();
    failed.c.tick(3000);
    failed.s.failed();
    expect(failed.s.state()).toMatchObject({ beat: "dream", text: "…" });
    const lost = sequence(DREAM_PLAN);
    lost.s.start();
    lost.c.tick(DREAM_WAIT_MS + 3000);
    expect(lost.s.state()).toMatchObject({ beat: "dream", text: "…" });
  });

  it("crossfades each light change under reduced motion", () => {
    expect(beatMs("fade", true)).toBeLessThan(beatMs("fade"));
    expect(beatMs("light", true)).toBeLessThan(beatMs("light"));
    // The held black keeps its time.
    expect(beatMs("held", true)).toBe(beatMs("held"));
  });
});

describe("the DREAM card", () => {
  it("is a beat labelled DREAM in the Common colour, Dreaming… until written", () => {
    expect(DREAM_LABEL.toUpperCase()).toBe("DREAM");
    expect(DREAM_TIER.label).toBe("Common");
    const pending = dreamBeat({
      key: "dream:9",
      dreamerId: "vale",
      turn: 48,
      anchor: 9.5,
    });
    expect(pending).toMatchObject({ pending: true, line: null, dream: true });
    expect(DREAMING_LABEL).toBe("Dreaming…");
    const read = dreamBeat({
      key: "dream:9",
      dreamerId: "vale",
      turn: 48,
      anchor: 9.5,
      text: "A box.",
      companion: { id: "lamp", revealed: 0.4 },
    });
    expect(read.line).toMatchObject({
      speaker: "Dream",
      text: "A box.",
      silent: true,
    });
    expect(read.companion).toEqual({ id: "lamp", revealed: 0.4 });
  });

  it("stays in the beat stack after the wake", () => {
    const beats = [
      { key: "a", anchor: 9 },
      { key: "b", anchor: 12 },
    ];
    const dream = dreamBeat({
      key: "dream:9",
      dreamerId: "vale",
      turn: 48,
      anchor: 9.5,
      text: "…",
    });
    const placed = withDream(beats, dream, { front: true });
    expect(placed.beats.map((b) => b.key)).toEqual(["a", "dream:9", "b"]);
    expect(placed.front).toBe(1);
    expect(withDream(placed.beats, dream).beats).toHaveLength(3);
    expect(withDream(beats, null).beats).toBe(beats);
  });
});

describe("dawn opens in daylight, dusk opens into night", () => {
  it("grades turns 0, 24, 48 and 72 as the rules' light", () => {
    for (const turn of [0, 24, 48, 72])
      expect(gradedNight(lightAt(hourOf(turn)))).toBe(isNight({ turn }));
    // A dawn wake lands on full daylight.
    expect(lightAt(hourOf(48)).shade).toEqual([1, 1, 1]);
  });

  it("gives a place with no night painting the full night grade, cooled", () => {
    expect(gradeStrength({ grade: 0.4, night: true })).toBe(1);
    expect(gradeStrength({ grade: 0.4, night: false })).toBe(0.4);
    expect(gradeStrength({ painted: true, night: true })).toBe(0.25);
    const night = lightAt(0);
    const cooled = tintShade(night, UNPAINTED_NIGHT_TINT, 0);
    expect(cooled.shade[0]).toBeLessThan(night.shade[0]);
    expect(cooled.shade[2]).toBeCloseTo(night.shade[2]);
    expect(tintShade(lightAt(12), UNPAINTED_NIGHT_TINT, 12).shade).toEqual([
      1, 1, 1,
    ]);
  });
});
