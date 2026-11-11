import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadBindings, saveBindings, bind, unbind, bindingFor, DEFAULT_PACK } from "../src/bindings.mjs";
import { avatarUrl, residentIdentity } from "../src/identity.mjs";
import { dispatch } from "../src/commands.mjs";

function makeDeps() {
  const bindings = new Map();
  const file = join(tmpdir(), `cw-bindings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  return {
    deps: {
      bindings,
      save: () => saveBindings(file, bindings),
      assetBase: "https://lonelyforest.com/assets",
      residentsFor: () => [
        { id: "vale", name: "Vale", portraitPath: "forest/vale.png" },
        { id: "moth", name: "Pip", portraitPath: null },
      ],
    },
    file,
  };
}

test("bindings round-trip through a file", () => {
  const { deps, file } = makeDeps();
  bind(deps.bindings, "c1", { guildId: "g1", mode: "room", pack: DEFAULT_PACK });
  deps.save();
  const loaded = loadBindings(file);
  assert.equal(bindingFor(loaded, "c1").pack, DEFAULT_PACK);
  assert.equal(bindingFor(loaded, "c1").mode, "room");
  rmSync(file, { force: true });
});

test("identity builds a webhook face", () => {
  const base = "https://lonelyforest.com/assets/";
  assert.equal(avatarUrl(base, "forest/vale.png"), "https://lonelyforest.com/assets/forest/vale.png");
  assert.equal(avatarUrl(base, null), null);
  assert.equal(residentIdentity({ name: "discordVale" }, base).username, "Vale");
  assert.equal(residentIdentity({ name: "x".repeat(100) }, base).username.length, 80);
  assert.equal(residentIdentity({ name: "Pip", portraitPath: null }, base).avatarUrl, null);
});

test("setup, who, unbind, privacy, unknown", () => {
  const { deps } = makeDeps();
  const ctx = { channelId: "c1", guildId: "g1", options: {} };
  assert.match(dispatch("setup", ctx, deps).content, /Bound this channel/);
  assert.match(dispatch("who", ctx, deps).content, /Vale, Pip/);
  dispatch("unbind", ctx, deps);
  assert.equal(bindingFor(deps.bindings, "c1"), null);
  assert.match(dispatch("privacy", ctx, deps).content, /never asks for attention/);
  assert.equal(dispatch("nope", ctx, deps).content, "Unknown command.");
});

test("privacy discloses journaled acts for planned anonymous play", () => {
  const { deps } = makeDeps();
  const content = dispatch("privacy", { options: {} }, deps).content;
  assert.match(content, /Anonymous Discord play is planned, not available yet/);
  assert.match(content, /committed game acts will be recorded even without linking an account/);
});
