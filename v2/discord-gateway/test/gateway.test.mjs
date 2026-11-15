import test from "node:test";
import assert from "node:assert/strict";
import { avatarUrl, residentIdentity } from "../src/identity.mjs";
import { commandDefinitions, dispatch } from "../src/commands.mjs";
import { channelLines, fetchCast } from "../src/orchestrator.mjs";

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
    json: async () => ({ pack: "lonely-forest", residents: [{ id: "rati", name: "RATi", portrait: "/p.png" }] }),
  });
  assert.deepEqual(await fetchCast(cast.fetch, "https://x", "t", "lonely-forest"), [
    { id: "rati", name: "RATi", portrait: "/p.png" },
  ]);
  assert.equal(cast.calls[0].url, "https://x/discord/cast?pack=lonely-forest");
  assert.deepEqual(cast.calls[0].options.headers, { authorization: "Bearer t" });

  const lines = recorder({ status: 200, json: async () => ({ lines: [{ id: "rati", name: "RATi", text: "Hi." }] }) });
  const body = { pack: "lonely-forest", addressed: null, messages: [{ author: "Mara", text: "Hello?" }] };
  assert.deepEqual(await channelLines(lines.fetch, "https://x", "t", body), [{ id: "rati", name: "RATi", text: "Hi." }]);
  assert.equal(lines.calls[0].url, "https://x/discord/lines");
  assert.equal(lines.calls[0].options.method, "POST");
  assert.deepEqual(lines.calls[0].options.headers, {
    authorization: "Bearer t",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(lines.calls[0].options.body), body);
});

test("orchestrator errors become silence", async () => {
  const body = { pack: "lonely-forest", messages: [] };
  assert.deepEqual(await channelLines(recorder({ status: 500, json: async () => ({}) }).fetch, "https://x", "t", body), []);
  assert.deepEqual(await channelLines(recorder({ status: 429, json: async () => ({}) }).fetch, "https://x", "t", body), []);
  assert.deepEqual(
    await channelLines(recorder({ status: 200, json: async () => { throw new SyntaxError("bad"); } }).fetch, "https://x", "t", body),
    [],
  );
  assert.deepEqual(await channelLines(recorder(new Error("offline")).fetch, "https://x", "t", body), []);
  assert.equal(await fetchCast(recorder({ status: 404, json: async () => ({}) }).fetch, "https://x", "t", "nope"), null);
  assert.equal(await fetchCast(recorder(new Error("offline")).fetch, "https://x", "t", "p"), null);
  assert.equal(
    await fetchCast(recorder({ status: 200, json: async () => ({ residents: [] }) }).fetch, "https://x", "t", "p"),
    null,
  );
});
