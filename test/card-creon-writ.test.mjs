import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  packGiveChoice,
} from "../v2/card-game/pack-registry.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

const writ = "greek-creon-writ",
  creon = "greek-creon",
  pack = "greek-drama";
const copy = "greek-courtyard-concession";
const old = (key) =>
  JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/greek-before-funeral/concession.json.gz",
          import.meta.url,
        ),
      ),
    ),
  )[key];
const act = (s, kind, fields = {}) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const walk = (s, ...places) =>
  places.reduce((s, target) => act(s, "move", { target }), s);

it("starts the writ with Creon and preserves an earned Ask and Give", () => {
  expect(createWorld().items[writ].holder).toBe(creon);
  let s = walk(
    openingFixture("concession").traded,
    "greek-courtyard",
    "greek-well",
    "greek-palace",
  );
  s = act(s, "give", { item: "greek-decree", target: creon });
  expect(s.actors[creon].trust.vale).toBeGreaterThan(0);
  s = act(s, "ask", { item: writ, target: creon });
  expect(s.items[writ].holder).toBe("vale");
  s = walk(s, "greek-well", "greek-courtyard", "greek-gate");
  s = act(s, "give", { item: writ, target: "greek-guard" });
  expect(s.items[writ].holder).toBe("greek-guard");
  expect(exits(s, "greek-gate")).toContain("greek-battlefield");
  expect(decodeSave(encodeSave(s)).items[writ]).toEqual(s.items[writ]);
});

it("records Dione's copy, returns the original, and keeps public passage", () => {
  let s = walk(
    openingFixture("concession").permission,
    "greek-well",
    "greek-courtyard",
  );
  const prior = [...s.items[writ].history];
  s = act(s, "give", { item: writ, target: "greek-baker" });
  expect(s.items[writ].holder).toBe(creon);
  expect(s.items[writ].history).toEqual([
    ...prior,
    packDefinition(pack).choices.find((c) => c.id === copy).text,
  ]);
  expect(s.packs[pack].flags["greek-concession-public"]).toBe(true);
  expect(s.packs[pack].receipts[copy]).toBe(s.turn);
  s = walk(s, "greek-gate", "greek-battlefield", "greek-cithaeron");
  expect(decodeSave(encodeSave(s))).toEqual(s);
});

it("repairs the old untouched palace writ and Dione's recorded deposit once", () => {
  const untouched = old("arrival");
  untouched.items[writ] = { holder: "greek-palace", history: [] };
  expect(decodeSave(JSON.stringify(untouched)).items[writ].holder).toBe(creon);
  const prior = old("permissionShared"),
    next = decodeSave(JSON.stringify(prior));
  expect(next.items[writ].holder).toBe(creon);
  expect(next.items[writ].history.slice(0, -1)).toEqual(
    prior.items[writ].history,
  );
  expect(next.packs[pack].receipts[copy]).toBe(
    prior.packs[pack].receipts[copy],
  );
  expect(exits(next, "greek-gate")).toContain("greek-battlefield");
  expect(decodeSave(encodeSave(next))).toEqual(next);
});

it("keeps later custody and a player's later courtyard drop", () => {
  for (const key of ["permission", "opened", "closed"]) {
    const prior = old(key);
    expect(decodeSave(JSON.stringify(prior)).items[writ]).toEqual(
      prior.items[writ],
    );
  }
  const prior = old("permissionShared");
  prior.items[writ].history.push(
    "Turn 30: Vale takes the Creon's Writ.",
    "Turn 31: Vale sets down the Creon's Writ.",
  );
  expect(decodeSave(JSON.stringify(prior)).items[writ]).toEqual(
    prior.items[writ],
  );
});

it("requires the authored recipient to be active with room for the original", () => {
  const s = walk(
    openingFixture("concession").permission,
    "greek-well",
    "greek-courtyard",
  );
  const action = { actor: "vale", target: "greek-baker", item: writ };
  expect(packGiveChoice(s, action)?.choiceId).toBe(copy);
  const effect = packDefinition(pack).choices.find((c) => c.id === copy)
    .effects[0];
  effect.actor = "greek-helen-egypt";
  try {
    expect(packGiveChoice(s, action)).toBeNull();
  } finally {
    effect.actor = creon;
  }
  for (const item of ["greek-bread", "greek-water-jar"])
    s.items[item].holder = creon;
  expect(packGiveChoice(s, action)).toBeNull();
});
