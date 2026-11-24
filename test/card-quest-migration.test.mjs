import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions as actions,
  play as move,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import {
  KNOWLEDGE_FACT_LIMIT,
  witnessKnowledge,
} from "../v2/card-game/knowledge.mjs";
import { learnTold, questOwners } from "../v2/card-game/quest-learn.mjs";
import { toldWant } from "../v2/card-game/talk-quest.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";
import { recordOf } from "../v2/card-game/world/arcana-record.mjs";
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
    for (const item of Object.values(pack.items || {})) {
      delete item.pages;
      if (!item.claims) delete item.author;
    }
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

  it("count II from the quest facts of a save without told", () => {
    let s = createWorld();
    for (const id of ["vale", "moth"]) s.actors[id].place = "station";
    s.actors.moth.want = newWant("item", "lamp", s.turn);
    learnTold(s, "moth", "vale");
    const old = JSON.parse(encodeSave(s));
    delete old.actors.vale.told;
    s = decodeSave(JSON.stringify(old));
    expect(questOwners(s, "vale")).toEqual(["moth"]);
    for (const told of [["vale"], [], ["moth", "moth"], ["nobody"]]) {
      s.actors.vale.told = told;
      expect(() => validateWorld(s)).toThrow();
    }
  });

  it("keep an owner whose fact the heard map's facts evict", () => {
    const s = createWorld();
    for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
    s.actors.moth.want = newWant("item", "lamp", s.turn);
    learnTold(s, "moth", "vale");
    s.actors.moth.want = newWant("place", "pond", s.turn);
    const room = KNOWLEDGE_FACT_LIMIT - Object.keys(s.knowledge.facts).length;
    for (let n = 0; n < room; n++)
      witnessKnowledge(s, {
        seq: ++s.eventSeq,
        turn: s.turn,
        kind: "action",
        verb: "give",
        actorId: "keeper",
        locationId: "station",
        cast: ["keeper"],
        text: `The keeper carried shell number ${n} to the pond.`,
      });
    const old = JSON.parse(encodeSave(s));
    delete old.actors.vale.told;
    old.actors.vale.heard = { keeper: heard.keeper };
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.knowledge.facts["quest:moth:lamp"]).toBeUndefined();
    expect(questOwners(loaded, "vale")).toEqual(["keeper", "moth"]);
  });

  it("move a rules 194 shared world's told quests through upgrade", () => {
    const old = engine(194);
    const { createWorld: create, legalActions, play } = old.rules;
    let w = create();
    for (const id of ["vale", "moth"]) w.actors[id].place = "station";
    w.items.lamp.holder = "vale";
    w.actors.moth.want = newWant("item", "lamp", w.turn);
    const talk = legalActions(w).find(
      (a) => a.kind === "talk" && a.target === "moth",
    );
    w = play(w, talk).state;
    const world = ask(old, { op: "create", save: JSON.stringify(w) }).world;
    expect(world.actors.vale.told).toBeUndefined();
    const seats = { claimed: humanAvatarIds, present: humanAvatarIds };
    const up = ask(currentSharedEngine(), {
      world,
      op: "upgrade",
      actor: "vale",
      ...seats,
    });
    expect(up.ok).toBe(true);
    expect(questOwners(up.world, "vale")).toEqual(["moth"]);
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

describe("worlds from rules 195 keep a taken quest and complete it by owner", () => {
  const taken = (old) => {
    const { createWorld: create, legalActions, play } = old.rules;
    let w = create();
    for (const id of ["vale", "moth", "keeper"]) w.actors[id].place = "station";
    w.items.lamp.holder = w.items.bell.holder = "vale";
    w.actors.moth.want = newWant("item", "lamp", w.turn);
    w.actors.keeper.want = newWant("item", "bell", w.turn);
    for (const [kind, target, item] of [
      ["talk", "keeper"],
      ["accept", "keeper"],
      ["give", "keeper", "bell"],
      ["talk", "moth"],
      ["accept", "moth"],
    ]) {
      const action = legalActions(w).find(
        (a) => a.kind === kind && a.target === target && (!item || a.item === item),
      );
      w = play(w, action).state;
    }
    expect(w.log.some((e) => e.verb === "want_met" && !e.ownerId)).toBe(true);
    return w;
  };
  const gave = (s) => {
    expect(recordOf(s, "vale")).toMatchObject({ calls: 2, callers: ["keeper", "moth"] });
    expect(s.log.findLast((e) => e.verb === "want_met" && e.actorId === "vale")).toMatchObject({ ownerId: "moth" });
  };
  const lamp = (s) => actions(s).find((a) => a.kind === "give" && a.item === "lamp" && a.target === "moth");

  it("loads a saved one and counts the Listener's call from its owner", () => {
    const s = decodeSave(JSON.stringify(taken(engine(195))));
    expect(heldOf(s.actors.vale).map((w) => w.from)).toEqual(["quest:from:moth"]);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 1, callers: ["keeper"] });
    gave(move(s, lamp(s), s.revision).state);
  });

  it("moves a shared one through upgrade", () => {
    const old = engine(195);
    const world = ask(old, { op: "create", save: JSON.stringify(taken(old)) }).world;
    const seats = { claimed: humanAvatarIds, present: humanAvatarIds };
    const current = currentSharedEngine();
    const up = ask(current, { world, op: "upgrade", actor: "vale", ...seats });
    expect(up.ok).toBe(true);
    const done = ask(current, {
      world: up.world,
      op: "play",
      actor: "vale",
      action: lamp(decodeSave(JSON.stringify(up.world))).key,
      ...seats,
    });
    expect(done.ok).toBe(true);
    gave(done.world);
  });
});
