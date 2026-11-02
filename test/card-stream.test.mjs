import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  partialEntries,
  requestNarrative,
  createNarrator,
} from "../v2/card-game/narrative.mjs";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const event = (value) =>
  new TextEncoder().encode(`data: ${JSON.stringify(value)}\r\n\r\n`);
const complete = (context) => ({
  type: "complete",
  revision: context.revision,
  model: "fixture",
  entries: context.entities.map(({ id }) => ({
    id,
    text: "A remembered word.",
  })),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live story text", () => {
  it("shows complete characters and escapes as JSON arrives", () => {
    const text =
      '{"entries":[{"id":"vale","text":"Café \\"hello\\" \\uD83C\\uDF19"},{"id":"station","text":"Dust moves."}]}';
    for (let i = 0; i < text.length; i++) {
      const entries = partialEntries(text.slice(0, i));
      for (const entry of entries)
        expect(entry.text).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
    expect(partialEntries(text)).toEqual([
      { id: "vale", text: 'Café "hello" 🌙' },
      { id: "station", text: "Dust moves." },
    ]);
    expect(partialEntries('{"id":"unknown","text":"hello')).toEqual([]);
  });

  it("delivers speech before completion across every network byte boundary", async () => {
    const context = narrativeContext(createWorld()),
      progress = vi.fn();
    let source;
    const body = new ReadableStream({
      start(controller) {
        source = controller;
      },
    });
    const fetch = vi.fn(
      async () =>
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = requestNarrative(context, undefined, progress);
    const draft = event({
      type: "delta",
      text: '{"entries":[{"id":"vale","text":"Café 🌙"},{"id":"station","text":"Dust',
    });
    for (const byte of draft) source.enqueue(Uint8Array.of(byte));
    await tick();
    expect(progress).toHaveBeenLastCalledWith([
      { id: "vale", text: "Café 🌙" },
    ]);
    expect(fetch.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
    const full = complete(context);
    for (const byte of event(full)) source.enqueue(Uint8Array.of(byte));
    expect(await result).toEqual(full);
  });

  it("accepts a complete reply while stream cleanup is still waiting", async () => {
    const context = narrativeContext(createWorld());
    const full = complete(context);
    const cancel = vi.fn(() => new Promise(() => {}));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(event(full));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    expect(await requestNarrative(context)).toEqual(full);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("discards interrupted streams and keeps JSON compatibility", async () => {
    const context = narrativeContext(createWorld());
    for (const frame of [
      event({ type: "delta", text: '{"id":"vale","text":"Hello' }),
      event({ type: "error" }),
    ]) {
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(frame, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      );
      await expect(requestNarrative(context)).rejects.toThrow();
    }
    const full = complete(context);
    vi.stubGlobal("fetch", async () => Response.json(full));
    expect(await requestNarrative(context)).toEqual(full);
  });

  it("keeps partial words out of saves and cancels the old scene on a new play", async () => {
    vi.useFakeTimers();
    let world = createWorld();
    const preview = vi.fn(),
      status = vi.fn(),
      requests = [];
    const before = encodeSave(world);
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => (world = next),
      preview,
      status,
      request: (context, signal, progress) =>
        new Promise((resolve, reject) => {
          requests.push({ context, signal, progress, resolve, reject });
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    narrator.changed();
    requests[0].progress([{ id: "vale", text: "A growing line" }]);
    expect(preview.mock.lastCall[0].entries[0].text).toBe("A growing line");
    expect(encodeSave(world)).toBe(before);
    world = play(
      world,
      // A first arrival asks for the new place's caption.
      legalActions(world).find((a) => a.kind === "move"),
    ).state;
    narrator.changed();
    expect(requests[0].signal.aborted).toBe(true);
    expect(preview).toHaveBeenLastCalledWith(null);
    requests[0].progress([{ id: "vale", text: "Stale words" }]);
    expect(preview).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(2);
    requests[1].progress([{ id: "vale", text: "New words" }]);
    requests[1].resolve(complete(requests[1].context));
    await vi.advanceTimersByTimeAsync(0);
    expect(world.memories.vale.text).toBe("A remembered word.");
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(status).toHaveBeenLastCalledWith("ready");
    const saved = encodeSave(world);
    narrator.changed();
    requests[2].progress([{ id: "vale", text: "Interrupted words" }]);
    requests[2].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(encodeSave(world)).toBe(saved);
    await vi.advanceTimersByTimeAsync(750);
    requests[3].reject(new Error("offline again"));
    await vi.advanceTimersByTimeAsync(0);
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(status).toHaveBeenLastCalledWith(
      "retry",
      expect.objectContaining({ message: "offline again" }),
    );
  });
});
