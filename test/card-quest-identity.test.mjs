import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play, validateWorld, wantAPI } from "../v2/card-game/world.mjs";
import { allQuestsOf, newWant, pushQuest, questsOf, questRewardsOf, sameQuest, wantKey } from "../v2/card-game/want.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { questEntryKey } from "../v2/card-game/card-entry.mjs";
import { questCards } from "../v2/card-game/quest-card.mjs";
import { talkQuest } from "../v2/card-game/talk-quest.mjs";

const gift = (to) => ({ ...newWant("item", "lamp", 0), step: { verb: "give", to } });
const reload = (s) => decodeSave(encodeSave(s));
function start() {
  const s = questing(createWorld());
  s.actors.vale.want = newWant("item", "lamp", 0);
  s.actors.vale.under = [gift("moth"), gift("keeper")];
  s.actors.moth.want = s.actors.keeper.want = newWant("item", "lamp", 0);
  s.actors.moth.place = "pond";
  s.actors.vale.place = s.actors.keeper.place = "station";
  s.items.lamp.holder = "station";
  return s;
}
function act(s, kind, target = null) {
  const a = legalActions(s).find((a) => a.kind === kind && a.item === "lamp" &&
    (target === null || a.target === target));
  expect(a).toBeTruthy();
  const result = play(s, a);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

it("keeps hold and two recipient goals through save, pack changes and actual deeds", () => {
  let s = reload(start());
  const goals = structuredClone(allQuestsOf(s, "vale"));
  expect(new Set(goals.map((w) => wantKey("vale", w))).size).toBe(3);
  expect(new Set(questCards(s).map(questEntryKey)).size).toBe(2);
  for (const enable of [false, true]) {
    s = play(s, { kind: "pack", pack: "hoppy", enable }).state;
    expect(allQuestsOf(s, "vale")).toEqual(goals);
  }
  s = reload(act(s, "take"));
  expect(new Set(questCards(s).map(questEntryKey)).size).toBe(2);
  expect(questRewardsOf(s, "vale").map((r) => r.want.step ?? null)).toEqual([null]);
  expect(questsOf(s, "vale").map((w) => w.step.to)).toEqual(["moth", "keeper"]);
  s = reload(act(s, "give", "keeper"));
  expect(questRewardsOf(s, "vale").map((r) => r.want.step?.to ?? null)).toEqual([null, "keeper"]);
  expect(questsOf(s, "vale").map((w) => w.step?.to)).toContain("moth");
});

it("deduplicates canonical terms while preserving required light and recipient", () => {
  const s = start();
  const reverse = { ...gift("keeper"), step: { to: "keeper", verb: "give" } };
  expect(sameQuest(reverse, gift("keeper"))).toBe(true);
  expect(wantKey("vale", reverse)).toBe(wantKey("vale", gift("keeper")));
  pushQuest(s, "vale", reverse);
  expect(allQuestsOf(s, "vale")).toHaveLength(3);
  s.actors.vale.want = reverse;
  s.actors.vale.under = [reverse];
  expect(() => validateWorld(s)).toThrow();
  s.actors.vale.want = newWant("item", "lamp", 0);
  s.actors.vale.under = [{ ...s.actors.vale.want, lit: true }, { ...s.actors.vale.want, lit: false }];
  expect(reload(s)).toEqual(s);
  s.actors.vale.under = [{ ...s.actors.vale.want, quest: { level: 2, left: 2 } }];
  expect(new Set(questCards(reload(s)).map(questEntryKey)).size).toBe(2);
});

it("offers the Shade Talk quest beside a level quest to meet the Shade", () => {
  const s = questing(createWorld());
  s.turn = s.revision = 36;
  s.actors.vale.place = "greek-battlefield";
  s.actors.vale.want = { ...newWant("person", "greek-polynices-shade", 0),
    quest: { level: 2, left: 2 }, step: { verb: "meet" } };
  s.crossings["pond-greek-harbor"].discovered = true;
  s.packs["greek-drama"].met["greek-polynices-shade"] = 35;
  const gate = legalActions(s).find((a) => a.kind === "gate" && a.target === "greek-polynices-hollow");
  expect(gate).toBeTruthy();
  const next = play(s, gate).state;
  expect(questsOf(next, "vale")).toHaveLength(2);
  expect(legalActions(reload(next)).some((a) => a.key === gate.key)).toBe(false);
  delete s.actors.vale.want.step;
  expect(legalActions(s).some((a) => a.key === gate.key)).toBe(false);
  const talk = legalActions(s).find((a) => a.kind === "talk" && a.target === s.actors.vale.want.target);
  const talked = play(s, talk);
  expect(talked.ok, talked.error).toBe(true);
  expect(questRewardsOf(talked.state, "vale")).toHaveLength(1);
});

it("uses an existing level Give step when Talk repeats its terms in another order", () => {
  const s = start();
  s.actors.vale.want = { ...gift("keeper"), quest: { level: 2, left: 2 },
    step: { to: "keeper", verb: "give" } };
  delete s.actors.vale.under;
  expect(talkQuest(s, "vale", "keeper", wantAPI(s))).toBe(null);
  expect(questsOf(s, "vale")).toHaveLength(1);
});

it("upgrades an old shared stack and agrees on term-aware saves and plays", () => {
  const old = currentSharedEngine(116), engine = currentSharedEngine();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const before = JSON.parse(old.cardShared(JSON.stringify({ op: "create", save: start(), ...seats })));
  // Rules116 rejects terms it conflates; a historical valid single quest upgrades.
  expect(before.ok).toBe(false);
  const legacy = start();
  delete legacy.actors.vale.under;
  let s = JSON.parse(old.cardShared(JSON.stringify({ op: "create", save: legacy, ...seats }))).world;
  const both = (request) => {
    const result = dispatchShared(structuredClone(request));
    expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(result);
    return result;
  };
  s = both({ op: "upgrade", world: s, ...seats }).world;
  s.actors.vale.under = [gift("moth"), gift("keeper")];
  const request = { op: "play", world: s, ...seats,
    action: both({ op: "view", world: s, ...seats }).actions.find((a) => a.kind === "take" && a.item === "lamp") };
  expect(both(request)).toEqual(both(structuredClone(request)));
});
