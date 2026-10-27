import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSharedWorld } from "../v2/card-game/shared.mjs";

function snapshot(version, now = 1000) {
  return {
    actor: "vale",
    present: [1],
    version,
    now,
    world: { turn: version },
  };
}

async function session() {
  vi.stubGlobal("document", {
    getElementById: () => ({}),
  });
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.spyOn(globalThis, "setInterval").mockReturnValue(1);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const respond = (value) => ({ ok: true, json: async () => value });
  fetch.mockResolvedValueOnce(respond({ authenticated: true }));
  fetch.mockResolvedValueOnce(respond(snapshot(1)));
  fetch.mockResolvedValueOnce(respond(snapshot(1)));
  const connection = await connectSharedWorld("saved-world");
  return { connection, fetch, respond };
}

afterEach(() => vi.unstubAllGlobals());

describe("shared snapshot ordering", () => {
  it("keeps an accepted play when an older poll arrives in the same millisecond", async () => {
    const { connection, fetch, respond } = await session();
    const listener = vi.fn();
    connection.subscribe(listener, vi.fn());
    let finishPoll;
    fetch.mockImplementationOnce(
      () => new Promise((resolve) => (finishPoll = resolve)),
    );
    const poll = connection.sync();
    fetch.mockResolvedValueOnce(respond(snapshot(2)));
    await connection.command({ op: "play", key: "accepted-play", action: {} });
    finishPoll(respond(snapshot(1)));
    await poll;
    expect(connection.state.world.turn).toBe(2);
    expect(listener.mock.calls.map(([value]) => value.version)).toEqual([2]);
  });

  it("accepts queue and presence updates at the same world version", async () => {
    const { connection, fetch, respond } = await session();
    const next = {
      ...snapshot(1, 1001),
      queue: [{ id: "play", status: "working" }],
    };
    fetch.mockResolvedValueOnce(respond(next));
    await connection.sync();
    expect(connection.state).toEqual(next);
  });

  it("keeps the latest reply when an earlier server time arrives later", async () => {
    const { connection, fetch, respond } = await session();
    fetch.mockResolvedValueOnce(respond(snapshot(2, 1002)));
    await connection.command({ op: "enter" });
    fetch.mockResolvedValueOnce(respond(snapshot(2, 1001)));
    await connection.sync();
    expect(connection.state.now).toBe(1002);
  });
});
