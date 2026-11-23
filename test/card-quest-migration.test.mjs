import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { questOwners } from "../v2/card-game/quest-learn.mjs";
import { toldWant } from "../v2/card-game/talk-quest.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const heard = { moth: "item:lamp", keeper: "item:oil" };
const spread = (base) => [
  { card: "arcanum-2", face: "up", base: { heard: base } },
];
function before(base) {
  const s = createWorld();
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  s.actors.moth.want = newWant("item", "lamp", s.turn);
  s.actors.keeper.want = newWant("item", "bell", s.turn);
  const old = JSON.parse(encodeSave(s));
  old.actors.vale.heard = heard;
  old.actors.vale.arcana = {
    proved: ["arcanum-0"],
    did: [],
    level: 1,
    spread: spread(base),
  };
  return old;
}
const migrated = (s, base) => {
  expect(s.actors.vale.heard).toBeUndefined();
  expect(s.knowledge.known.vale["quest:moth:lamp"]).toMatchObject({
    kind: "heard",
    teller: "moth",
  });
  expect(s.knowledge.facts["quest:keeper:oil"].text).toBe(
    "The keeper wants the Oil flask.",
  );
  expect(toldWant(s, "vale", "moth")).toBe(true);
  expect(toldWant(s, "vale", "keeper")).toBe(false);
  expect(questOwners(s, "vale").sort()).toEqual(["keeper", "moth"]);
  expect(s.actors.vale.arcana.spread).toEqual(spread(base));
};
const engine = (version) => {
  const dir = new URL(
    "../v2/orchestrator-rust/src/card_shared/",
    import.meta.url,
  );
  const cardContent = JSON.parse(
    readFileSync(new URL("content.json", dir), "utf8"),
  );
  for (const pack of cardContent.files["v2/card-game/packs.json"].packs)
    for (const item of Object.values(pack.items || {})) delete item.pages;
  const runtime = vm.createContext({ structuredClone, cardContent });
  const source = readFileSync(new URL(`engine-v${version}.js`, dir), "utf8");
  vm.runInContext(
    source.replace(
      "globalThis.cardShared =",
      "globalThis.rules = { createWorld, legalActions, play }; $&",
    ),
    runtime,
  );
  return runtime;
};
const ask = (runtime, request) =>
  JSON.parse(runtime.cardShared(JSON.stringify(request)));

describe("saves that kept a heard map", () => {
  it.each([0, 1, 2])(
    "load every entry as a quest fact, and II at base %i keeps its progress",
    (base) => {
      const s = decodeSave(JSON.stringify(before(base)));
      migrated(s, base);
      expect(decodeSave(encodeSave(s))).toEqual(s);
      expect(decodeSave(JSON.stringify(before(base)))).toEqual(s);
    },
  );

  it("load without one", () => {
    const old = before(1);
    delete old.actors.vale.heard;
    const s = decodeSave(JSON.stringify(old));
    expect(questOwners(s, "vale")).toEqual([]);
    expect(s.actors.vale.arcana.spread).toEqual(spread(1));
  });

  it("move a rules 189 shared world onto these rules through upgrade", () => {
    const old = engine(189);
    const { createWorld: create, legalActions, play } = old.rules;
    let w = create();
    for (const id of ["vale", "moth", "keeper"]) w.actors[id].place = "station";
    w.items.lamp.holder = "vale";
    w.actors.moth.want = newWant("item", "lamp", w.turn);
    const talk = legalActions(w).find(
      (a) => a.kind === "talk" && a.target === "moth",
    );
    w = play(w, talk).state;
    w.actors.keeper.want = newWant("item", "bell", w.turn);
    w.actors.vale.arcana = {
      proved: ["arcanum-0"],
      did: [],
      level: 1,
      spread: spread(0),
    };
    const world = ask(old, { op: "create", save: JSON.stringify(w) }).world;
    expect(world.actors.vale.heard).toEqual({ moth: heard.moth });
    world.actors.vale.heard.keeper = heard.keeper;
    const seats = { claimed: humanAvatarIds, present: humanAvatarIds };
    const up = ask(currentSharedEngine(), {
      world,
      op: "upgrade",
      actor: "vale",
      ...seats,
    });
    expect(up.ok).toBe(true);
    migrated(up.world, 0);
  });
});
