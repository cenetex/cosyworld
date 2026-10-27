import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { connectSharedWorld } from "../v2/card-game/shared.mjs";

// Rust full_store::snapshot keeps World.version as the rules label and
// projects the actual game revision inside world (full_world.rs).
const created = dispatchShared({
  op: "create",
  save: encodeSave(createWorld()),
});
const claimed = ["vale"];
const present = ["vale"];
const before = dispatchShared({
  op: "view",
  world: created.world,
  actor: "vale",
  claimed,
  present,
});
const played = dispatchShared({
  op: "play",
  world: created.world,
  actor: "vale",
  claimed,
  present,
  action: before.actions.find((action) => action.kind === "wait"),
});
const after = dispatchShared({
  op: "view",
  world: played.world,
  actor: "vale",
  claimed,
  present,
});
function snapshot(which, now = 1000) {
  return {
    ...structuredClone(which === 1 ? before : after),
    version: "full-card-world/9",
    claimed: [1, 0, 0, 0, 0, 0, 0, 0],
    present: [1, 0, 0, 0, 0, 0, 0, 0],
    now,
    queue: [],
    history: [],
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
    expect(after.world.revision).toBeGreaterThan(before.world.revision);
    expect(connection.state.world).toEqual(after.world);
    expect(listener.mock.calls.map(([value]) => value.world.revision)).toEqual([
      after.world.revision,
    ]);
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
