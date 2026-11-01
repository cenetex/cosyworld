import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  places,
  play,
  sanctuaries,
  standoffFor,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { packDefinitions, packOf } from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/daylight.mjs";
import { reflectionDue } from "../v2/card-game/reflections.mjs";

const wait = (s, actor = "vale") =>
  play(s, legalActions(s, actor).find((a) => a.kind === "wait"), s.revision, actor)
    .state;

describe("rest and sanctuary", () => {
  it("gives each world exactly one sanctuary, and the Willows none", () => {
    // Badger's glade is a hidden part of the Lonely Forest, which shares
    // the Cosy Cottage as its one sanctuary.
    const partOf = { "badger-forest": "lonely-forest" };
    const worldOf = (id) => {
      const pack = packOf(id)?.id ?? "hub";
      return partOf[pack] ?? pack;
    };
    const count = (world) =>
      sanctuaries.filter((id) => worldOf(id) === world).length;
    expect(count("hub")).toBe(1);
    for (const id of ["greek-drama", "hoppycat-archive", "lonely-forest"])
      expect(count(id)).toBe(1);
    expect(count("willows")).toBe(0);
    expect(sanctuaries.some((id) => packOf(id)?.id === "badger-forest")).toBe(
      false,
    );
    expect(packDefinitions.every((pack) => count(pack.id) <= 1)).toBe(true);
    expect(sanctuaries).not.toContain("greek-ship");
    expect(sanctuaries.every((id) => places[id])).toBe(true);
  });

  it("leaves a player's losses as they are on a Wait away from a sanctuary", () => {
    let s = createWorld();
    s.defeats = { vale: 2 };
    s = wait(s);
    expect(s.defeats).toEqual({ vale: 2 });
    expect(s.actors.vale.sleepUntil).toBeUndefined();
    s = wait(s);
    expect(s.defeats).toEqual({ vale: 2 });
  });

  it("sleeps until the light changes at a sanctuary, then clears every loss", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.defeats = { vale: 2 };
    s = wait(s);
    // Alone, the world runs on until the sleeper wakes at the light change.
    expect(s.turn).toBe(DAYLIGHT_TURNS);
    expect(s.actors.vale.sleepUntil).toBeUndefined();
    expect(s.defeats).toEqual({});
    expect(
      s.log.findLast((e) => e.verb === "wait" && e.actorId === "vale"),
    ).toMatchObject({
      actorId: "vale",
      rest: "long",
    });
    expect(s.actors.vale.xp).toBe(0);
    expect(validateWorld(s)).toBe(s);
  });

  it("clears a resident's losses when it waits at a sanctuary, and only there", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.actors.keeper.place = "attic";
    s.actors.moth.place = "pond";
    // Neither resident is after anything, so each waits where it is.
    s.actors.keeper.want = s.actors.moth.want = null;
    s.actors.keeper.metTurn = s.actors.moth.metTurn = 0;
    s.defeats = { keeper: 2, moth: 2 };
    s = wait(s);
    expect(s.actors.keeper.place).toBe("attic");
    expect(s.defeats).toEqual({ moth: 2 });
    expect(validateWorld(s)).toBe(s);
  });

  it("keeps a shared sleeper to Wait until the light changes", () => {
    let s = createWorld();
    s.sharedVersion = 1;
    s.actors.vale.place = "attic";
    s.defeats = { vale: 1 };
    s = wait(s);
    expect(s.turn).toBe(1);
    expect(s.actors.vale.sleepUntil).toBe(DAYLIGHT_TURNS);
    expect(legalActions(s, "vale").map((a) => a.kind)).toEqual(["wait"]);
    // Others move the one clock; the sleeper wakes on its first Wait after.
    s.turn = s.revision = DAYLIGHT_TURNS;
    s = wait(s);
    expect(s.actors.vale.sleepUntil).toBeUndefined();
    expect(s.defeats).toEqual({});
    expect(
      s.log.findLast((e) => e.verb === "wait" && e.actorId === "vale"),
    ).toMatchObject({
      actorId: "vale",
      rest: "long",
    });
  });

  it("brings a thought and a dream on waking from a long rest", () => {
    const context = { turn: 24, resting: "vale", rest: "long", entities: [] };
    expect(reflectionDue(context, "vale", null)).toEqual({
      thought: true,
      dream: true,
    });
    expect(reflectionDue({ ...context, resting: null }, "vale", null)).toEqual({
      thought: false,
      dream: false,
    });
  });

  it("never offers an attack at a sanctuary and wakes every sleeper at a light change through a long run", () => {
    let s = createWorld();
    let longRests = 0,
      seen = 0;
    for (let step = 0; step < 300; step++) {
      // Now and then the player is home in the attic, the hub's sanctuary.
      if (step % 50 === 0) s.actors.vale.place = "attic";
      const actions = legalActions(s);
      const here = s.actors.vale.place;
      if (sanctuaries.includes(here))
        expect(actions.some((a) => a.kind === "attack")).toBe(false);
      if (standoffFor(s, "vale") && !sanctuaries.includes(here))
        expect(actions.some((a) => a.kind === "attack")).toBe(true);
      s = play(s, actions[(step * 7919) % actions.length]).state;
      expect(s.actors.vale.sleepUntil).toBeUndefined();
      for (const e of s.log.filter((e) => e.seq > seen && e.rest === "long")) {
        expect(e.turn % DAYLIGHT_TURNS).toBe(0);
        longRests++;
      }
      seen = s.log.at(-1).seq;
    }
    expect(validateWorld(s)).toBe(s);
    expect(longRests).toBeGreaterThan(0);
  });
});
