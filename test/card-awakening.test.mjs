import { describe, expect, it } from "vitest";
import {
  createAwakening,
  playAwakening,
  decodeAwakening,
  badgerImage,
  awakeningCards,
  chooseOpening,
  saveKey,
} from "../v2/card-game/awakening-world.mjs";

describe("Badger at the Steam Clock", () => {
  it("keeps card inspection free and wakes a separate character", () => {
    const asleep = createAwakening();
    const snapshot = JSON.stringify(asleep);
    expect(awakeningCards(asleep)[0].action).toBe("wake");
    expect(badgerImage(asleep)).toContain("sleeping");
    const awake = playAwakening(asleep, "wake");
    expect(JSON.stringify(asleep)).toBe(snapshot);
    expect(awake.badger).toEqual({
      awake: true,
      irritation: 1,
      wakeCause: "voice",
    });
    expect(awake.events.slice(-2).map((event) => event.actor)).toEqual([
      "player",
      "badger",
    ]);
    expect(badgerImage(awake)).toContain("grumpy");
    expect(awakeningCards(awake)[0].action).toBe("talk");
    expect(playAwakening(awake, "wake")).toBe(awake);
  });

  it("remembers a noisy wake and lets quiet ease the irritation", () => {
    let world = playAwakening(createAwakening(), "tap");
    expect(world.badger.wakeCause).toBe("clock");
    expect(world.badger.irritation).toBe(2);
    expect(playAwakening(world, "talk").events.at(-1).text).toContain(
      "ringing",
    );
    world = playAwakening(playAwakening(world, "wait"), "wait");
    expect(world.badger.irritation).toBe(0);
    expect(playAwakening(world, "talk").events.at(-1).text).toContain(
      "sit there",
    );
    expect(decodeAwakening(JSON.stringify(world))).toEqual(world);
    expect(world.badger.wakeCause).toBe("clock");
  });

  it("lets Badger sleep through waiting and bounds a long visit", () => {
    let world = createAwakening();
    for (let turn = 0; turn < 100; turn++) world = playAwakening(world, "wait");
    expect(world.badger.awake).toBe(false);
    expect(world.turn).toBe(100);
    expect(world.events).toHaveLength(80);
    expect(decodeAwakening(JSON.stringify(world))).toEqual(world);
    expect(playAwakening(world, "invented")).toBe(world);
  });

  it("rejects broken saves before they can replace playable state", () => {
    for (const mutate of [
      (s) => (s.schema = 2),
      (s) => (s.turn = -1),
      (s) => (s.badger.awake = true),
      (s) => (s.badger.irritation = 20),
      (s) => (s.events = []),
      (s) => (s.events[0].actor = "vale"),
    ]) {
      const world = createAwakening();
      mutate(world);
      expect(() => decodeAwakening(JSON.stringify(world))).toThrow();
    }
  });

  it("starts fresh tables in the clearing and keeps existing shore saves reachable", () => {
    const entries = new Map();
    const storage = { getItem: (key) => entries.get(key) };
    expect(chooseOpening("", storage)).toBe("forest");
    entries.set("cosyworld.reflected-shore.v1", "saved shore");
    expect(chooseOpening("", storage)).toBe("shore");
    expect(chooseOpening("?world=forest", storage)).toBe("forest");
    entries.set(saveKey(""), "saved clearing");
    expect(chooseOpening("", storage)).toBe("forest");
    expect(chooseOpening("?world=shore", storage)).toBe("shore");
    expect(chooseOpening("?table=new-table", storage)).toBe("forest");
    expect(saveKey("?table=new-table")).toBe(
      "cosyworld.steam-clock.v1.new-table",
    );
    expect(saveKey("?table=../unsafe")).toBe("cosyworld.steam-clock.v1");
    expect(
      chooseOpening("", {
        getItem() {
          throw new Error("blocked");
        },
      }),
    ).toBe("forest");
  });
});
