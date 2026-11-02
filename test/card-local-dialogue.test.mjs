import { describe, it, expect, vi, afterEach } from "vitest";
import { rest } from "./fixtures/card-rest.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  createNarrator,
  applyGeneratedText,
  applyGeneratedReflections,
} from "../v2/card-game/narrative.mjs";
import { createExchange } from "../v2/card-game/dialogue.mjs";

afterEach(() => vi.useRealTimers());
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const fixture = (context) => ({
  revision: context.revision,
  model: "fixture",
  entries: [{ id: "vale", text: "I will keep the lamp near." }],
  omitted: context.entities
    .filter(({ id }) => id !== "vale")
    .map(({ id }) => id),
});
const update = (context) => ({
  revision: context.revision,
  reflections: [
    {
      id: "vale",
      reflection: {
        thought: "Someone trusted me with their light.",
        persona: "I am learning to share.",
      },
    },
  ],
});

describe("local dialogue arrives before private thoughts", () => {
  it("publishes each complete line once while the rest of the scene is pending", async () => {
    let world = createWorld({ opening: true }),
      resolve,
      progress;
    const phases = [];
    const narrator = createNarrator({
      early: true,
      getWorld: () => world,
      apply: (next, phase) => {
        world = next;
        phases.push(phase);
      },
      status: () => {},
      request: (context, signal, preview) => {
        progress = preview;
        return new Promise((done) => {
          resolve = () => done(fixture(context));
        });
      },
    });
    narrator.changed();
    await flush();
    progress([{ id: "vale", text: "I will keep the lamp near." }]);
    progress([{ id: "vale", text: "I will keep the lamp near." }]);
    expect(phases.at(-1)).toEqual({ pending: true });
    expect(
      world.log.filter((x) => x.generated && x.actorId === "vale"),
    ).toHaveLength(1);
    const seq = world.log.at(-1).seq;
    resolve();
    await flush();
    expect(
      world.log.filter((x) => x.generated && x.actorId === "vale"),
    ).toHaveLength(1);
    expect(world.log.at(-1).seq).toBe(seq);
    expect(world.memories.vale.model).toBe("fixture");
  });

  it("saves late private updates against their scene and preserves spoken history", () => {
    const original = createWorld();
    const world = rest(
      play(
        original,
        legalActions(original).find(
          (x) => x.kind === "take" && x.item === "lamp",
        ),
      ).state,
      { dream: true },
    );
    const context = narrativeContext(world);
    const spoken = applyGeneratedText(world, context, fixture(context));
    const next = applyGeneratedReflections(spoken, context, update(context));
    expect(next.log).toEqual(spoken.log);
    expect(next.memories.vale.reflections.at(-1)).toMatchObject({
      turn: world.turn,
      thought: "Someone trusted me with their light.",
      persona: "I am learning to share.",
      models: {
        thought: "local-reflection",
        persona: "local-reflection",
        dream: "rules",
      },
    });
    expect(decodeSave(encodeSave(next)).memories.vale.innerLife.persona).toBe(
      "I am learning to share.",
    );
    expect(
      applyGeneratedReflections(
        { ...spoken, revision: spoken.revision + 1 },
        context,
        update(context),
      ),
    ).toBeNull();
    expect(() =>
      applyGeneratedReflections(next, context, update(context)),
    ).toThrow();
  });

  it("cancels old private work on the next card and ignores a late response", async () => {
    let world = createWorld({ opening: true }),
      privateSignal,
      finish;
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => {
        world = next;
      },
      status: () => {},
      request: async (context) => fixture(context),
      reflect: (context, signal) => {
        privateSignal = signal;
        return new Promise((resolve) => {
          finish = () => resolve(update(context));
        });
      },
    });
    narrator.changed();
    await flush();
    const old = privateSignal;
    world = play(
      world,
      legalActions(world).find((x) => x.kind === "light"),
    ).state;
    narrator.changed();
    expect(old.aborted).toBe(true);
    finish();
    await flush();
    expect(world.memories.vale.innerLife?.persona).not.toBe(
      "I am learning to share.",
    );
    narrator.invalidate();
  });

  it("keeps the first line in place as later lines arrive", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const exchange = createExchange({ show });
    const first = { seq: 1, text: "Hello." },
      second = { seq: 2, text: "Come sit." };
    exchange.begin();
    exchange.load([first], { pending: true });
    exchange.revealed(1, "Hello.", true);
    vi.advanceTimersByTime(3000);
    expect(exchange.active).toBe(true);
    exchange.load([first, second], { pending: true });
    expect(show.mock.calls.map(([line]) => line.seq)).toEqual([1, 2]);
    exchange.load([first, second]);
    expect(show).toHaveBeenCalledTimes(2);
    exchange.revealed(2, "Come sit.", true);
    vi.runAllTimers();
    expect(exchange.active).toBe(false);
  });
});
