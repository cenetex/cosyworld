import test from "node:test";
import assert from "node:assert/strict";
import { avatarUrl, residentIdentity } from "../src/identity.mjs";
import { commandDefinitions, dispatch } from "../src/commands.mjs";
import { channelLines, ensureWorld, fetchCast } from "../src/orchestrator.mjs";
import { castOf, createRoom, requestBody } from "../src/room.mjs";
import { next } from "../src/turns.mjs";
import { payload } from "../src/coordinator.mjs";
import { readConfig } from "../src/config.mjs";

const deps = {
  cast: () => [
    { id: "rati", name: "RATi", portrait: "/card-game/assets/lonely-forest/rati.png" },
    { id: "skull", name: "Skull", portrait: null },
  ],
  pack: "lonely-forest",
  assetBase: "https://cosyworld.example",
};

test("identity builds a webhook face", () => {
  const base = "https://cosyworld.example/";
  assert.equal(
    avatarUrl(base, "/card-game/assets/lonely-forest/rati.png"),
    "https://cosyworld.example/card-game/assets/lonely-forest/rati.png",
  );
  assert.equal(avatarUrl(base, null), null);
  const resident = {
    name: "RATi",
    portrait: "/card-game/assets/lonely-forest/rati.png",
    avatar: "/card-game/assets/faces/lonely-forest-rati.webp",
  };
  assert.equal(
    residentIdentity(resident, base).avatarUrl,
    "https://cosyworld.example/card-game/assets/faces/lonely-forest-rati.webp",
  );
  assert.equal(
    residentIdentity({ ...resident, avatar: undefined }, base).avatarUrl,
    "https://cosyworld.example/card-game/assets/lonely-forest/rati.png",
  );
  assert.equal(residentIdentity({ name: "discordVale" }, base).username, "Vale");
  assert.equal(residentIdentity({ name: "x".repeat(100) }, base).username.length, 80);
  assert.equal(residentIdentity({ name: "Pip", portrait: null }, base).avatarUrl, null);
});

test("only who and privacy are commands", () => {
  assert.deepEqual(
    commandDefinitions().map((command) => command.name),
    ["who", "privacy"],
  );
  assert.match(dispatch("who", deps).content, /RATi, Skull/);
  assert.equal(dispatch("nope", deps).content, "Unknown command.");
});

test("who gives the link to the server's world once there is one", () => {
  assert.doesNotMatch(dispatch("who", deps).content, /world/);
  const content = dispatch("who", { ...deps, world: "https://x/?world=abc" }).content;
  assert.match(content, /RATi, Skull\nJoin this server's world: https:\/\/x\/\?world=abc$/);
  assert.match(dispatch("privacy", deps).content, /sends the server's id/);
});

test("privacy says messages go to AI models", () => {
  const content = dispatch("privacy", deps).content;
  assert.match(content, /sent to AI models to write residents' replies/);
  assert.match(content, /links no accounts/);
  assert.doesNotMatch(content, /Anonymous Discord play/);
});

function recorder(response) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetch };
}

test("the orchestrator calls send only the Bearer token", async () => {
  const cast = recorder({
    status: 200,
    json: async () => ({
      pack: "lonely-forest",
      residents: [
        { id: "rati", name: "RATi", portrait: "/p.png", avatar: "/f.webp" },
        { id: "oak", name: "Oak", portrait: "/o.png" },
      ],
    }),
  });
  assert.deepEqual(await fetchCast(cast.fetch, "https://x", "t", "lonely-forest"), [
    { id: "rati", name: "RATi", portrait: "/p.png", avatar: "/f.webp" },
    { id: "oak", name: "Oak", portrait: "/o.png", avatar: null },
  ]);
  assert.equal(cast.calls[0].url, "https://x/discord/cast?pack=lonely-forest");
  assert.deepEqual(cast.calls[0].options.headers, { authorization: "Bearer t" });

  const lines = recorder({ status: 200, json: async () => ({ lines: [{ id: "rati", name: "RATi", text: "Hi." }] }) });
  const body = { pack: "lonely-forest", addressed: null, messages: [{ author: "Mara", text: "Hello?" }] };
  assert.deepEqual(await channelLines(lines.fetch, "https://x", "t", body), {
    lines: [{ id: "rati", name: "RATi", text: "Hi." }],
    reason: null,
  });
  assert.equal(lines.calls[0].url, "https://x/discord/lines");
  assert.equal(lines.calls[0].options.method, "POST");
  assert.deepEqual(lines.calls[0].options.headers, {
    authorization: "Bearer t",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(lines.calls[0].options.body), body);
});

test("the gateway asks for its server's world and names the server only then", async () => {
  const id = "ab".repeat(24);
  const made = recorder({ status: 200, json: async () => ({ id, path: `/?world=${id}` }) });
  assert.equal(await ensureWorld(made.fetch, "https://x", "t", "100000000000000001"), `https://x/?world=${id}`);
  assert.equal(made.calls[0].url, "https://x/discord/world");
  assert.equal(made.calls[0].options.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(made.calls[0].options.body), { guild: "100000000000000001" });
  for (const reply of [{ status: 404, json: async () => ({}) }, { status: 200, json: async () => ({ id: "x" }) }, new Error("offline")]) {
    assert.equal(await ensureWorld(recorder(reply).fetch, "https://x", "t", "100000000000000001"), null);
  }
  const config = readConfig({});
  const room = createRoom("100000000000000001", "c1");
  room.messages.push({ id: "a", at: 0, text: "Hello?", author: "Mara" });
  assert.equal("guild" in requestBody(room, config, "rati", 10), false);
  assert.equal("guild" in payload(room, config, deps.cast(), 10), false);
  room.world = `https://x/?world=${id}`;
  assert.equal(requestBody(room, config, "rati", 10).guild, "100000000000000001");
  assert.equal(payload(room, config, deps.cast(), 10).guild, "100000000000000001");
});

test("orchestrator errors become silence with a reason", async () => {
  const body = { pack: "lonely-forest", messages: [] };
  const ask = (reply) => channelLines(recorder(reply).fetch, "https://x", "t", body);
  assert.deepEqual(await ask({ status: 500, json: async () => ({}) }), { lines: [], reason: "http-500" });
  assert.deepEqual(await ask({ status: 429, json: async () => ({}) }), { lines: [], reason: "http-429" });
  assert.deepEqual(await ask({ status: 200, json: async () => { throw new SyntaxError("bad"); } }), {
    lines: [],
    reason: "error",
  });
  assert.deepEqual(await ask(new Error("offline")), { lines: [], reason: "error" });
  const timeout = new Error("slow");
  timeout.name = "TimeoutError";
  assert.deepEqual(await ask(timeout), { lines: [], reason: "timeout" });
  assert.deepEqual(await ask({ status: 200, json: async () => ({ lines: [], reason: "busy" }) }), {
    lines: [],
    reason: "busy",
  });
  assert.deepEqual(await ask({ status: 200, json: async () => ({ lines: [] }) }), { lines: [], reason: "empty" });
  assert.equal(await fetchCast(recorder({ status: 404, json: async () => ({}) }).fetch, "https://x", "t", "nope"), null);
  assert.equal(await fetchCast(recorder(new Error("offline")).fetch, "https://x", "t", "p"), null);
  assert.equal(
    await fetchCast(recorder({ status: 200, json: async () => ({ residents: [] }) }).fetch, "https://x", "t", "p"),
    null,
  );
});

test("a server's world brings its own cast, and an old server gives the global one", async () => {
  const antigone = { id: "greek-antigone", name: "Antigone", portrait: "/a.png", avatar: "/fa.webp" };
  const served = recorder({ status: 200, json: async () => ({ residents: [antigone] }) });
  assert.deepEqual(await fetchCast(served.fetch, "https://x", "t", "lonely-forest", "100000000000000001"), [antigone]);
  assert.equal(served.calls[0].url, "https://x/discord/cast?pack=lonely-forest&guild=100000000000000001");
  const replies = [{ status: 400, json: async () => ({}) }, { status: 200, json: async () => ({ residents: deps.cast() }) }];
  const old = { calls: [], fetch: async (url) => (old.calls.push(url), replies.shift()) };
  assert.deepEqual((await fetchCast(old.fetch, "https://x", "t", "lonely-forest", "1")).map((r) => r.id), ["rati", "skull"]);
  assert.deepEqual(old.calls, ["https://x/discord/cast?pack=lonely-forest&guild=1", "https://x/discord/cast?pack=lonely-forest"]);
  assert.equal(await fetchCast(recorder({ status: 400, json: async () => ({}) }).fetch, "https://x", "t", "p"), null);
});

test("the coordinator, next and /who use the room's cast", async () => {
  const config = readConfig({});
  const room = createRoom("100000000000000001", "c1");
  room.world = "https://x/?world=w";
  room.messages.push({ id: "a", at: Date.now(), text: "Hello?", author: "Mara" });
  const global = deps.cast();
  assert.equal(castOf(room, global), global);
  assert.equal(castOf(undefined, global), global);
  room.cast = [{ id: "greek-antigone", name: "Antigone", portrait: "/a.png", avatar: "/fa.webp" }];
  const cast = castOf(room, deps.cast());
  assert.deepEqual(payload(room, config, cast).residents, ["greek-antigone"]);
  const sent = [];
  const coordinate = async (body) => {
    sent.push(body);
    return { answers: { next: { choice: "greek-antigone", confidence: 0.9, probabilities: { "greek-antigone": 0.9, rati: 0.05 } } } };
  };
  const who = await next(room, { config, cast, coordinate, stats: { coordinator: {} }, log: () => {} });
  assert.equal(who, "greek-antigone");
  assert.deepEqual(sent[0].residents, ["greek-antigone"]);
  const listed = dispatch("who", { ...deps, cast: () => castOf(room, deps.cast()) }).content;
  assert.match(listed, /1 resident: Antigone/);
  assert.doesNotMatch(listed, /RATi/);
  assert.equal(residentIdentity(cast[0], "https://x").avatarUrl, "https://x/fa.webp");
});
