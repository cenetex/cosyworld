import { describe, expect, it } from "vitest";
import {
  entityEnabled,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { attemptPlay } from "../v2/card-game/save-guard.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

const codec = { encode: encodeSave, read: decodeSave };
const reload = (world) => decodeSave(encodeSave(world));
const BRANCH = "greek-olive-branch";
const playOf = (world, test) => legalActions(world, "vale").find(test);
const waitOf = (world) => playOf(world, (a) => a.kind === "wait" && !a.sleep);
const tryPlay = (world, action) =>
  attemptPlay(() => play(world, action, world.revision, "vale"), codec);

function act(world, test) {
  const result = play(world, playOf(world, test), world.revision, "vale");
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const talk = (world) =>
  act(world, (a) => a.kind === "talk" && a.target === "listener");

function states(seed) {
  let world = createWorld({ seed });
  world.actors.vale.arcana = { proved: [], did: [], calls: 3 };
  world.actors.vale.place = world.actors.listener.place;
  const out = { called: (world = reload(world)) };
  out.fool = world = talk(world);
  for (const item of Object.values(world.items))
    if (item.holder === "vale") item.holder = world.actors.vale.place;
  world.actors.vale.arcana.spread[0].done = true;
  world.actors.vale.arcana.calls = 3;
  out.selling = world = talk(reload(world));
  out.sellingReloaded = reload(world);
  world = structuredClone(world);
  world.items["willows-pipe"].holder = "vale";
  out.bought = world = act(
    reload(world),
    (a) => a.kind === "give" && a.item === "willows-pipe",
  );
  out.boughtReloaded = reload(world);
  return out;
}

function astray(world, id = BRANCH, spot = "greek-athens") {
  world = structuredClone(world);
  const dawn = 2 * DAYLIGHT_TURNS;
  world.turn = Math.ceil((world.turn + 1) / dawn) * dawn - 1;
  world.revision = Math.max(world.revision, world.turn);
  for (const crossing of Object.values(world.crossings))
    crossing.discovered = true;
  world.items[id].holder = spot;
  world.items[id].history = ["Turn 3: It is left here."];
  world.astray = { [id]: spot };
  return reload(world);
}

describe("every play beside the Listener", () => {
  it("is made or refused before sending, never after", () => {
    for (const seed of [3, 5, 8])
      for (const [name, world] of Object.entries(states(seed)))
        for (const action of legalActions(world, "vale")) {
          const result = tryPlay(world, action);
          expect(
            result.fault?.cause?.check ?? result.fault?.cause,
            `${seed} ${name} ${action.key}`,
          ).toBeUndefined();
          expect(result.ok, `${name} ${action.key}: ${result.error}`).toBe(
            true,
          );
        }
  });
});

describe("a thing sent home where it sleeps", () => {
  it("lets every play go on beside the selling Listener", () => {
    const world = astray(states(5).selling);
    expect(entityEnabled(world, BRANCH, true)).toBe(true);
    for (const action of legalActions(world, "vale"))
      expect(tryPlay(world, action).ok, action.key).toBe(true);
  });

  it("rests at its home asleep, and a reload keeps it there", () => {
    const world = astray(createWorld({ seed: 5 }));
    const result = play(world, waitOf(world), world.revision, "vale");
    expect(result.ok, result.error).toBe(true);
    expect(entityEnabled(result.state, BRANCH, true)).toBe(false);
    expect(reload(result.state).items[BRANCH].holder).toBe("greek-courtyard");
  });

  it("never stops the world for any thing that comes home at dawn", () => {
    const base = createWorld({ seed: 5 });
    for (const pack of packDefinitions)
      for (const [id, item] of Object.entries(pack.items || {}))
        for (const spot of item.home
          ? [...Object.keys(pack.places), "pond"]
          : []) {
          let world;
          try {
            world = astray(base, id, spot);
          } catch {
            continue;
          }
          expect(
            tryPlay(world, waitOf(world)).fault?.cause?.check,
            `${id} at ${spot}`,
          ).toBeUndefined();
        }
  });
});
