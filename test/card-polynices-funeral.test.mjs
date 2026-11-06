import { expect, it } from "vitest";
import { questCard } from "../v2/card-game/quest-card.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
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
    world.items["greek-creon-writ"].holder = "greek-guard";
    act({ kind: "talk", target: antigone });
    expect(questCard(world)?.art).toContain("polynices-fallen");
    act({ kind: "move", target: "greek-battlefield" });
    act({ kind: "move", target: hollow });
    expect(world.actors[antigone].place).toBe(hollow);
    const available = () =>
      actions().flatMap((a) =>
        rites.includes(a.choiceId) ? [a.choiceId] : [],
      );
    expect(available()).toEqual([]);
    for (const item of [oil, cloth, shovel]) world.items[item].holder = hollow;
    for (const [i, art] of ["anointed", "veiled", null].entries()) {
      expect(available()).toEqual([rites[i]]);
      act({ kind: "choose", choiceId: rites[i] });
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
  world.items["greek-creon-writ"].holder = "greek-guard";
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
