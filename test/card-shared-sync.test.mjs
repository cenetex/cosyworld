import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createSharedSync } from "../v2/card-game/shared-sync.mjs";

const stream = "test-stream";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const state = {
  actor: "vale",
  now: 1,
  world: { revision: 1 },
  history: [{ play: "old" }],
  queue: [],
};
const head = { stream, sequence: 0, hash: hash("seed") };
const snapshot = (value = state, position = head) => ({
  sync: { kind: "snapshot", head: position },
  state: structuredClone(value),
});
const cursor = (h) => `${h.stream}:${h.sequence}:${h.hash}`;
function event(previous, patches) {
  const payload = JSON.stringify(patches);
  const sequence = previous.sequence + 1;
  return {
    sequence,
    previous: previous.hash,
    payload,
    hash: hash(`${stream}\n${sequence}\n${previous.hash}\n${payload}`),
  };
}
const position = (e) => ({ stream, sequence: e.sequence, hash: e.hash });
const delta = (events, h = position(events.at(-1)), now = 2) => ({
  sync: { kind: "events", head: h },
  events,
  now,
});
const patches = (revision) => [
  { op: "set", path: ["world", "revision"], value: revision },
];

async function session() {
  const request = vi.fn().mockResolvedValueOnce(snapshot());
  const sync = createSharedSync(request);
  await sync();
  return { request, sync };
}
describe("shared event sync", () => {
  it("sends its last verified cursor and catches up through missed replies", async () => {
    const { request, sync } = await session();
    const a = event(head, patches(2));
    const b = event(position(a), [
      {
        op: "splice",
        path: ["history"],
        start: 0,
        delete: 0,
        items: [{ play: "new" }],
      },
    ]);
    request.mockResolvedValueOnce(delta([a, b]));
    const next = await sync();
    expect(request.mock.calls[1][1]).toEqual({
      "x-cosyworld-sync": cursor(head),
    });
    expect(next.world.revision).toBe(2);
    expect(next.history.map((scene) => scene.play)).toEqual(["new", "old"]);
    request.mockResolvedValueOnce(delta([], position(b), 3));
    expect((await sync()).now).toBe(3);
    expect(request.mock.calls[2][1]["x-cosyworld-sync"]).toBe(
      cursor(position(b)),
    );
    expect(state.world.revision).toBe(1);
  });
  it("requests a missing link from the last verified cursor", async () => {
    const { request, sync } = await session();
    const a = event(head, patches(2));
    const b = event(position(a), patches(3));
    request
      .mockResolvedValueOnce(delta([b]))
      .mockResolvedValueOnce(delta([a, b]));
    expect((await sync()).world.revision).toBe(3);
    expect(request.mock.calls[2]).toEqual([
      undefined,
      { "x-cosyworld-sync": cursor(head) },
    ]);
  });
  it("checks hashes and fetches a snapshot after a damaged chain", async () => {
    const { request, sync } = await session();
    const a = event(head, patches(2));
    const damaged = { ...a, payload: JSON.stringify(patches(99)) };
    request
      .mockResolvedValueOnce(delta([damaged]))
      .mockResolvedValueOnce(delta([damaged]))
      .mockResolvedValueOnce(
        snapshot({ ...state, now: 3, world: { revision: 2 } }, position(a)),
      );
    expect((await sync()).world.revision).toBe(2);
    expect(request.mock.calls[3]).toEqual([
      undefined,
      { "x-cosyworld-sync": "snapshot" },
    ]);
  });
  it("keeps command results when an older poll arrives afterwards", async () => {
    const { request, sync } = await session();
    let finish;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const poll = sync();
    const a = event(head, patches(2));
    request.mockResolvedValueOnce(delta([a]));
    await sync({ op: "play", key: "one-play" });
    finish(delta([], head, 1));
    expect((await poll).world.revision).toBe(2);
    const b = event(position(a), patches(3));
    request.mockResolvedValueOnce(delta([a, b], position(b), 3));
    expect((await sync()).world.revision).toBe(3);
  });
  it("recovers a command reply with reads and keeps the play key", async () => {
    const { request, sync } = await session();
    const a = event(head, patches(2));
    request
      .mockResolvedValueOnce(delta([{ ...a, previous: "broken" }]))
      .mockResolvedValueOnce(delta([a]));
    expect((await sync({ op: "play", key: "one-play" })).world.revision).toBe(
      2,
    );
    expect(request.mock.calls.filter(([body]) => body).length).toBe(1);
  });
  it("accepts a fresh stream and keeps legacy responses working", async () => {
    const { request, sync } = await session();
    const fresh = { ...head, stream: "after-upgrade" };
    request.mockResolvedValueOnce(snapshot({ ...state, now: 2 }, fresh));
    await sync();
    request.mockResolvedValueOnce({ ...state, now: 3 });
    expect((await sync()).now).toBe(3);
    request.mockResolvedValueOnce({ ...state, now: 4 });
    await sync();
    expect(request.mock.calls.at(-1)[1]["x-cosyworld-sync"]).toBe("snapshot");
  });
});
