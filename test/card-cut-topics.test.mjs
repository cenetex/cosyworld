import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { newest } from "../v2/scripts/rules-pins.mjs";

const base = "825d83db3e70da8530a90ddfc018ac442fcc4dd1";
const dir = "v2/orchestrator-rust/src/card_shared/";
const prior = (name) =>
  execFileSync("git", ["show", `${base}:${dir}${name}`], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
const now = (name) =>
  readFileSync(new URL(`../${dir}${name}`, import.meta.url), "utf8");
const rules = (bundle, content) => {
  const context = vm.createContext({ structuredClone, cardContent: content });
  vm.runInContext(
    bundle.replace(
      "globalThis.cardShared = (json) => {",
      "globalThis.fixture = {createWorld, legalActions, play}; globalThis.cardShared = (json) => {",
    ),
    context,
  );
  return context;
};
const old = rules(prior("engine-v200.js"), JSON.parse(prior("content.json")));
const version = newest(now("rules.json"));
const current = rules(
  now(`engine-v${version}.js`),
  JSON.parse(now("content.json")),
);
const ask = (context, request) =>
  JSON.parse(context.cardShared(JSON.stringify(request)));

it("forgets a topic told under rules 200 that content has cut, locally and in a shared upgrade", () => {
  const { createWorld, legalActions, play } = old.fixture;
  let world = createWorld({ seed: 7, packScopes: { "greek-drama": "full" } });
  world.actors.vale.place = "greek-gate";
  world.actors.vale.visited.push("greek-gate");
  world.crossings["pond-greek-harbor"].discovered = true;
  world.items.lamp.lit = false;
  const talk = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === "greek-guard",
  );
  world = play(world, talk, world.revision).state;
  const cut = "greek-hear-decree";
  expect(world.knowledge.facts[cut].source.kind).toBe("topic");
  expect(world.knowledge.known.vale[cut].kind).toBe("heard");

  const loaded = decodeSave(JSON.stringify(world));
  expect(loaded.turn).toBe(world.turn);
  expect(loaded.knowledge.facts[cut]).toBeUndefined();
  expect(loaded.knowledge.known.vale?.[cut]).toBeUndefined();
  const text = encodeSave(loaded);
  expect(encodeSave(decodeSave(text))).toBe(text);

  const shared = ask(old, { op: "create", save: world, seed: 7 });
  expect(shared.error).toBeUndefined();
  expect(shared.world.knowledge.facts[cut]).toBeTruthy();
  const upgraded = ask(current, {
    op: "upgrade",
    world: shared.world,
    from: "full-card-world/200",
    to: `full-card-world/${version}`,
  });
  expect(upgraded.error).toBeUndefined();
  expect(upgraded.world.knowledge.facts[cut]).toBeUndefined();
  expect(
    Object.values(upgraded.world.knowledge.known).some((k) => k[cut]),
  ).toBe(false);
  expect(
    ask(current, { op: "validate", world: upgraded.world }).error,
  ).toBeUndefined();
});
