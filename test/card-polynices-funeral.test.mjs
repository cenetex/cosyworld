import { expect, it } from "vitest";
import { openGreekGate } from "./helpers/greek-gate.mjs";
import { questCard, questCards, questVisible, questVerb } from "../v2/card-game/quest-card.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  itemPlace,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

const pack = "greek-drama";
const hollow = "greek-polynices-hollow";
const antigone = "greek-antigone";
const oil = "greek-oil-flask";
const cloth = "greek-funeral-cloth";
const shovel = "greek-shovel";
const rites = [
  "greek-anoint-polynices",
  "greek-shroud-polynices",
  "greek-bury-polynices",
];

it.each([false, true])("shows each rite with its remaining kit in the Hollow (shared: %s)", (shared) => {
  const states = funeralJourney();
  for (const [phase, verb, used] of [
    ["beforeAnoint", "Anoint", []],
    ["anointed", "Veil", [oil]],
    ["veiled", "Bury", [oil, cloth]],
  ]) {
    const world = decodeSave(encodeSave(states[phase]));
    if (shared) {
      world.sharedVersion = 1;
      world.controlledActors = ["vale"];
      world.presentActors = ["vale"];
    }
    const quest = questCard(world);
    expect(questVerb(world, quest)).toBe(verb);
    expect(questVisible(world, quest)).toBe(true);
    for (const item of used) expect(itemPlace(world, item)).not.toBe(hollow);
    const saved = encodeSave(world);
    world.actors.vale.place = "greek-courtyard";
    expect(questVisible(world, quest)).toBe(false);
    world.actors.vale.place = hollow;
    world.actors[antigone].place = "greek-battlefield";
    expect(questVisible(world, quest)).toBe(false);
    world.actors[antigone].place = hollow;
    for (const item of quest.remaining) {
      const holder = world.items[item].holder;
      world.items[item].holder = "greek-courtyard";
      expect(questVisible(world, quest)).toBe(false);
      for (const present of ["vale", antigone, hollow]) {
        world.items[item].holder = present;
        expect(questVisible(world, quest)).toBe(true);
      }
      world.items[item].holder = holder;
    }
    expect(encodeSave(world)).toBe(saved);
    expect(questVisible(decodeSave(saved), quest)).toBe(true);
    expect(questCards(world).map((card) => card.index)).toEqual(
      questCards(world).map((_, index) => index),
    );
  }
});

it.each(["opening", "full"])(
  "plays one burial quest through the three ordered rites in %s",
  (scope) => {
    let world = createWorld({ packScopes: { [pack]: scope } });
    const actions = () => legalActions(world);
    const act = (match) => {
      const action = actions().find((a) =>
        Object.entries(match).every(([key, value]) => a[key] === value),
      );
      expect(action, JSON.stringify(match)).toBeTruthy();
      const result = play(world, action);
      expect(result.ok, result.error).toBe(true);
      world = result.state;
    };
    world.turn = world.revision = 20;
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-gate";
    world.actors.vale.visited.push("pond", "greek-gate");
    openGreekGate(world);
    act({ kind: "talk", target: antigone });
    expect(questCard(world)?.art).toContain("polynices-fallen");
    act({ kind: "move", target: "greek-battlefield" });
    world.turn = world.revision = 36;
    act({ kind: "talk", target: "greek-polynices-shade" });
    act({ kind: "move", target: hollow });
    expect(world.actors[antigone].place).toBe(hollow);
    expect(actions().filter((a) => a.kind === "choose")).toEqual([]);
    // Old saves can have the whole kit laid out on the floor.
    for (const item of [oil, cloth, shovel]) world.items[item].holder = hollow;
    act({ kind: "take", item: shovel });
    act({ kind: "give", item: shovel, target: antigone });
    expect(world.items[shovel].holder).toBe("vale");
    expect(world.packs[pack].receipts[rites[2]]).toBeUndefined();
    for (const [i, [item, art]] of [
      [oil, "anointed"],
      [cloth, "veiled"],
      [shovel, null],
    ].entries()) {
      if (world.items[item].holder === hollow) act({ kind: "take", item });
      act({ kind: "give", item, target: antigone });
      expect(world.packs[pack].receipts[rites[i]]).toBe(world.turn);
      if (art) expect(questCard(world)?.art).toContain(`polynices-${art}`);
    }
    expect(questCard(world)?.target).not.toBe(hollow);
    expect(world.items[oil].holder).toBe("greek-colonus");
    expect(world.items[cloth].holder).toBe("greek-eleusis");
    expect(world.items[shovel].holder).toBe(hollow);
    expect(decodeSave(encodeSave(world)).packs[pack].flags).toMatchObject({
      "greek-burial-performed": true,
      "greek-open-door-open": true,
    });
  },
);

it("keeps a meeting with the shade after dawn", () => {
  const world = createWorld();
  const shade = "greek-polynices-shade";
  const battlefield = "greek-battlefield";
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = battlefield;
  world.actors.vale.visited.push("pond", battlefield);
  openGreekGate(world);
  const talk = (state) =>
    legalActions(state).find((a) => a.kind === "talk" && a.target === shade);
  world.turn = world.revision = 35;
  expect(talk(world)).toBeUndefined();
  world.turn = world.revision = 36;
  const result = play(world, talk(world));
  expect(result.ok, result.error).toBe(true);
  result.state.turn = result.state.revision = 48;
  const dawn = decodeSave(encodeSave(result.state));
  expect(talk(dawn)).toBeUndefined();
  expect(questCard(dawn)?.target).toBe(hollow);
});
