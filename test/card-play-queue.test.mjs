import { describe, expect, it, vi } from "vitest";
import { createExchange, createPlayQueue } from "../v2/card-game/dialogue.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";

describe("plays queued during dialogue", () => {
  it("runs one chosen play after the last speaker finishes", () => {
    let world = createWorld();
    let busy = false;
    const perform = vi.fn((action, revision) => {
      world = play(world, action, revision).state;
    });
    const queue = createPlayQueue({ ready: () => !busy, play: perform });
    const exchange = createExchange({
      show: () => {},
      busy: (value) => {
        busy = value;
        if (!value) queue.flush();
      },
      setTimer: () => 1,
      clearTimer: () => {},
    });
    exchange.begin();
    exchange.load([
      { seq: 1, text: "Vale speaks." },
      { seq: 2, text: "Pip replies." },
    ]);
    const action = legalActions(world).find((a) => a.kind === "wait");
    queue.submit(action, world.revision);
    expect(world.turn).toBe(0);
    exchange.revealed(1, "Vale speaks.");
    exchange.advance();
    expect(perform).not.toHaveBeenCalled();
    exchange.revealed(2, "Pip replies.");
    exchange.advance();
    expect(world.turn).toBe(1);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(queue.flush()).toBe(false);
  });

  it("allows a queued play to be replaced or cleared as a pairing changes", () => {
    let ready = false;
    const perform = vi.fn();
    const queue = createPlayQueue({ ready: () => ready, play: perform });
    queue.submit({ key: "first" }, 4);
    queue.submit({ key: "second" }, 4);
    ready = true;
    queue.flush();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ key: "second" }, 4);
    ready = false;
    queue.submit({ key: "third" }, 5);
    queue.clear();
    ready = true;
    queue.flush();
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected revision so a changed world rejects a stale play", () => {
    let ready = false;
    let world = createWorld();
    const action = legalActions(world).find((a) => a.kind === "wait");
    const results = [];
    const queue = createPlayQueue({
      ready: () => ready,
      play: (a, revision) => results.push(play(world, a, revision)),
    });
    queue.submit(action, world.revision);
    world = play(world, action).state;
    ready = true;
    queue.flush();
    expect(results[0].ok).toBe(false);
    expect(results[0].state.turn).toBe(1);
  });

  it("holds a next play behind the last play's late words, never dropping them", () => {
    // Local play: the app's ready() waits while the committed play's words
    // are still pending, as the shared seat does. A quest choice takes no
    // turn and never waits.
    let words = "pending";
    const log = [];
    const queue = createPlayQueue({
      ready: (action) => action.kind === "focus" || words !== "pending",
      play: (action) => log.push(`play ${action.key}`),
    });
    queue.submit({ key: "focus", kind: "focus" }, 1);
    expect(log).toEqual(["play focus"]);
    queue.submit({ key: "Q", kind: "wait" }, 1);
    expect(log).toEqual(["play focus"]);
    expect(queue.pending.action.key).toBe("Q");
    // P's late line lands first, then the waiting play runs.
    log.push("P's line");
    words = "ready";
    expect(queue.flush()).toBe(true);
    expect(log).toEqual(["play focus", "P's line", "play Q"]);
    // Words that failed are "…" at once and free the next play too.
    words = "pending";
    queue.submit({ key: "R", kind: "wait" }, 2);
    log.push("P's …");
    words = "ready";
    queue.flush();
    expect(log.slice(-2)).toEqual(["P's …", "play R"]);
  });
});
