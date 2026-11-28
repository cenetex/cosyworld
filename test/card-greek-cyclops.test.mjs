import { expect, it } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { entityActive, packGiveChoice } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const pack = "greek-drama";
const cave = "greek-sicily";
const stem = "greek-story-euripides-cyclops";
const silenus = `${stem}-first`;
const polyphemus = `${stem}-second`;
const vesselWine = `${stem}-object`;
const wine = "greek-wine-skin";
const cheese = "greek-cyclops-silenus-cheese";
const milk = "greek-cyclops-chorus-milk";

it("trades the Gate Wine for a public respite before any opener and leaves the real milk", () => {
  const t = traveler(greekStart()).move("gate").take(wine);
  t.s.actors.vale.place = cave;
  expect(entityActive(t.s, polyphemus)).toBe(true);
  expect(t.s.packs[pack].receipts[`${stem}-hear`]).toBeUndefined();
  expect(t.s.packs[pack].choices[`${stem}-outcome`]).toBeUndefined();
  expect(entityActive(t.s, milk)).toBe(false);
  const action = cardPlay(t.s, [wine, polyphemus]).action;
  expect(action).toMatchObject({ kind: "give", item: wine, target: polyphemus });
  expect(packGiveChoice(t.s, action)?.choiceId).toBe(`${stem}-second-answer`);
  const originalVessel = structuredClone(t.s.items[vesselWine]);

  t.act("give", { item: wine, target: polyphemus });
  expect(t.s.packs[pack].receipts[`${stem}-hear`]).toBeUndefined();
  expect(t.s.packs[pack].receipts[`${stem}-second-answer`]).toBe(t.s.turn);
  expect(t.s.items[wine].holder).toBe("greek-gate");
  expect(t.s.items[vesselWine]).toEqual(originalVessel);
  expect(t.s.gone ?? []).not.toContain(wine);
  expect(entityActive(t.s, cheese)).toBe(false);

  const shared = dispatchShared({ op: "create", save: encodeSave(t.s) });
  expect(shared.ok, shared.error).toBe(true);
  let world = shared.world;
  const scylla = "greek-scylla";
  world.actors.mara.place = scylla;
  Object.assign(world.transports[scylla], {
    dock: cave,
    phase: "arrived",
    riders: ["mara"],
    since: world.turn,
  });
  const playAsMara = (kind, fields) => {
    const state = { world, actor: "mara", claimed: ["vale", "mara"], present: ["vale", "mara"] };
    const action = dispatchShared({ ...state, op: "view" }).actions.find((action) =>
      action.kind === kind && Object.entries(fields).every(([key, value]) => action[key] === value),
    );
    expect(action).toBeDefined();
    const result = dispatchShared({ ...state, op: "play", action });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
  };
  playAsMara("move", { target: cave });
  playAsMara("take", { item: milk });
  expect(world.items[milk].holder).toBe("mara");
  expect(world.packs[pack].receipts[`${stem}-second-answer`]).toBe(t.s.turn);
});

it("still buys Silenus’s cheese with the ship’s distinct wineskin", () => {
  const world = greekStart();
  world.actors.vale.place = cave;
  const t = traveler(world).talk(silenus).take(vesselWine);
  t.act("give", { item: vesselWine, target: silenus });
  expect(t.s.packs[pack].receipts[`${stem}-first-answer`]).toBe(t.s.turn);
  expect(t.s.gone).toContain(vesselWine);
  expect(t.s.items[wine].holder).toBe("greek-gate");
  expect(entityActive(t.s, milk)).toBe(false);
  expect(legalActions(t.s).some((action) => action.kind === "take" && action.item === cheese)).toBe(true);
});
