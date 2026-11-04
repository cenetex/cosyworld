// Rules 100 on the server: the current rules bundle, as the shared host runs
// it with its content, and the browser's own modules must commit the same
// worlds through world life: residents falling asleep and rising across
// dusk and dawn, walking home off-stage, the Gate Guard knocked through and
// barring the way again, and a player's own guard. The same plays replay
// to the same world.
import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave } from "../v2/card-game/world.mjs";
import { DAY_TURNS } from "../v2/card-game/resident-home.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { lifeWorld } from "./helpers/world-life.mjs";

const seats = { claimed: ["vale"], present: ["vale"] };
const GUARD = "greek-guard";

function playLife(server) {
  const both = (request) => {
    const local = dispatchShared(structuredClone(request));
    if (server) expect(server(structuredClone(request))).toEqual(local);
    return local;
  };
  const save = encodeSave(
    lifeWorld({ seed: 9, turn: 2 * DAY_TURNS + 20, place: "greek-gate" }),
  );
  let world = both({ op: "create", seed: 9, save, actor: "vale" }).world;
  const seen = { asleep: new Set(), homeward: new Set() };
  const run = (pick) => {
    const { actions } = both({ op: "view", world, actor: "vale", ...seats });
    const action = actions.find(pick);
    expect(action, String(pick)).toBeTruthy();
    const done = both({ op: "play", world, actor: "vale", action, ...seats });
    expect(done.ok, done.error).toBe(true);
    world = done.world;
    for (const [id, a] of Object.entries(world.actors)) {
      if (a.sleeping?.until !== undefined) seen.asleep.add(id);
      if (a.homeward) seen.homeward.add(id);
    }
  };
  const wait = () => run((a) => a.kind === "wait" && !a.sleep && !a.guards);
  // Through dusk and into the night at the gate.
  for (let i = 0; i < 14; i++) wait();
  const night = structuredClone(world);
  // Beat the guard at his post: he is knocked onto the battlefield.
  run((a) => a.kind === "threaten" && a.target === GUARD);
  const strike = (a) => a.kind === "attack" && a.target === GUARD;
  for (let i = 0; i < 24 && world.actors[GUARD].place === "greek-gate"; i++) {
    const { actions } = both({ op: "view", world, actor: "vale", ...seats });
    if (actions.some(strike)) run(strike);
    else wait();
  }
  for (let i = 0; i < 6 && world.standoffs.length; i++) wait();
  const knocked = structuredClone(world);
  // While he is away the way is open: Vale stands guard over it.
  run((a) => a.guards === "greek-battlefield");
  const guarded = structuredClone(world);
  // He walks home, and Vale's next play ends her guard.
  for (let i = 0; i < 8 && world.actors[GUARD].place !== "greek-gate"; i++)
    wait();
  return { night, knocked, guarded, world, seen };
}

describe("rules 100 world life on the server", () => {
  it("commits the same worlds as the browser rules, and replays", () => {
    const engine = currentSharedEngine();
    const life = playLife((request) =>
      JSON.parse(engine.cardShared(JSON.stringify(request))),
    );
    // Residents slept on their schedules, at night.
    expect(life.seen.asleep.size).toBeGreaterThan(5);
    expect(life.night.actors["greek-creon"].sleeping).toMatchObject({
      place: "greek-palace",
    });
    expect(life.night.actors["greek-creon"].slept).toBeDefined();
    // The guard was knocked through and walked home to bar the way again.
    expect(life.knocked.actors[GUARD].place).toBe("greek-battlefield");
    expect(life.knocked.actors[GUARD].guarding).toBeUndefined();
    expect(life.seen.homeward.has(GUARD)).toBe(true);
    expect(life.guarded.actors.vale.guarding).toBe("greek-battlefield");
    expect(life.world.actors[GUARD]).toMatchObject({
      place: "greek-gate",
      guarding: "greek-battlefield",
    });
    expect(life.world.actors.vale.guarding).toBeUndefined();
    // The same plays from the same start replay to the same world.
    expect(playLife(null).world).toEqual(life.world);
  }, 120_000);
});
