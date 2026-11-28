import { expect, it } from "vitest";
import { playLabel } from "../v2/card-game/cards.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave } from "../v2/card-game/world.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const ALTAR = "greek-argos-sanctuary";
const BREAD = "greek-bread";
const WATER = "greek-water-jar";
const WELL = "greek-well";
const BAKE = "greek-danaids-bake-for-road";
const STEM = "greek-story-aeschylus-suppliant-women";
const LEADER = `${STEM}-second`;

it("feeds a traveler bound for Corinth before the Danaids' civic decision", () => {
  const vale = traveler(greekStart()).move(WELL).take(WATER).move(ALTAR);
  const created = dispatchShared({ op: "create", save: encodeSave(vale.s) });
  expect(created.ok, created.error).toBe(true);
  let world = created.world;
  const harbor = "greek-harbor";
  world.actors.mara.place = harbor;
  world.actors.mara.visited.push(harbor);
  const seats = ["vale", "mara"];
  const request = (actor, data) =>
    dispatchShared({ world, actor, claimed: seats, present: seats, ...data });
  const actions = (actor) => request(actor, { op: "view" }).actions;
  const act = (actor, kind, fields) => {
    const action = actions(actor).find(
      (entry) =>
        entry.kind === kind &&
        Object.entries(fields).every(([key, value]) => entry[key] === value),
    );
    expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeDefined();
    const result = request(actor, { op: "play", action });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
  };
  const walk = (actor, destination) => {
    for (const target of greekTravelTargets(world.actors[actor].place, destination))
      act(actor, "move", { target });
  };
  const bakeOffer = () =>
    actions("vale").find(
      (action) =>
        action.kind === "give" &&
        action.item === WATER &&
        action.target === LEADER &&
        playLabel(action) === "Bring Water for Altar Bread",
    );
  const expectOpenDecision = () => {
    const { choices, flags, receipts } = world.packs[PACK];
    expect(choices[`${STEM}-outcome`]).toBeUndefined();
    expect(flags[`${STEM}-heard`]).toBeUndefined();
    expect(receipts["greek-danaids-altar-bread-supply"]).toBeUndefined();
    expect(entityActive(world, "greek-danaids-vote-writ")).toBe(false);
    expect(world.items[`${STEM}-object`].holder).toBe(ALTAR);
  };

  expectOpenDecision();
  expect(bakeOffer()).toBeDefined();
  act("vale", "give", { item: WATER, target: LEADER });
  const firstBaking = world.packs[PACK].receipts[BAKE];
  expect(firstBaking).toBe(world.turn);
  expect(world.items[WATER].holder).toBe(WELL);
  expect(world.items[BREAD].holder).toBe(ALTAR);

  walk("mara", ALTAR);
  act("mara", "take", { item: BREAD });
  walk("mara", "greek-corinth");
  walk("vale", WELL);
  act("vale", "take", { item: WATER });
  walk("vale", ALTAR);
  expect(world.items[BREAD].holder).toBe("mara");
  expect(bakeOffer()).toBeUndefined();
  expectOpenDecision();

  act("mara", "eat", { item: BREAD, target: null });
  expect(bakeOffer()).toBeDefined();
  act("vale", "give", { item: WATER, target: LEADER });
  expect(world.packs[PACK].receipts[BAKE]).toBeGreaterThan(firstBaking);
  expect(world.items[BREAD].holder).toBe(ALTAR);
  expectOpenDecision();
}, 30_000);
