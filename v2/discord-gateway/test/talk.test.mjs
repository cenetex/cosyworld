import test from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, buildTalkRequest, residentLines, talkTo } from "../src/talk.mjs";

const residents = [
  { id: "moth", name: "Pip" },
  { id: "keeper", name: "The keeper" },
];

test("resolveTarget finds a resident by name and misses otherwise", () => {
  assert.equal(resolveTarget("hello Pip", residents), "moth");
  assert.equal(resolveTarget("talk to the keeper", residents), "keeper");
  assert.equal(resolveTarget("nothing here", residents), null);
  assert.equal(resolveTarget("", residents), null);
});

test("buildTalkRequest builds the body", () => {
  assert.deepEqual(buildTalkRequest({ worldId: "w", avatarId: "vale", target: "moth", text: "hi" }), {
    url: "/card-game/shared/worlds/w/talk",
    body: { avatar: "vale", target: "moth", text: "hi" },
  });
  assert.deepEqual(buildTalkRequest({ worldId: "w", target: "moth" }), {
    url: "/card-game/shared/worlds/w/talk",
    body: { target: "moth" },
  });
});

test("residentLines tolerates several response shapes", () => {
  assert.deepEqual(residentLines({ lines: [{ actorId: "moth", text: "hi" }] }), [
    { id: "moth", text: "hi" },
  ]);
  assert.deepEqual(residentLines({ speech: { lines: [{ entityId: "keeper", text: "..." }] } }), [
    { id: "keeper", text: "..." },
  ]);
  assert.deepEqual(
    residentLines({ events: [{ op: "speech", lines: [{ actorId: "moth", text: "a" }] }] }),
    [{ id: "moth", text: "a" }],
  );
  assert.deepEqual(residentLines({}), []);
});

test("talkTo posts with bot headers and parses the reply", async () => {
  let called;
  const fetch = async (url, opts) => {
    called = { url, opts };
    return { ok: true, json: async () => ({ lines: [{ actorId: "moth", text: "Welcome." }] }) };
  };
  const lines = await talkTo(fetch, "https://x", {
    worldId: "w",
    avatarId: "vale",
    target: "moth",
    token: "t",
    discordUserId: "du",
  });
  assert.equal(called.url, "https://x/card-game/shared/worlds/w/talk");
  assert.equal(called.opts.headers.authorization, "Bearer t");
  assert.equal(called.opts.headers["x-cosyworld-discord-user"], "du");
  assert.deepEqual(JSON.parse(called.opts.body), { avatar: "vale", target: "moth" });
  assert.deepEqual(lines, [{ id: "moth", text: "Welcome." }]);
});
