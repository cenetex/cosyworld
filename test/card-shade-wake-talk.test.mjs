import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const FIELD = "greek-battlefield",
  SHADE = "greek-polynices-shade";

function asleepOnTheField() {
  const world = createWorld({ opening: true });
  Object.assign(world.opening, { crossed: true });
  world.opening.met.moth ??= 0;
  world.locations.attic.anchored = true;
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = FIELD;
  world.turn = world.revision = 30;
  return decodeSave(encodeSave(world));
}
const step = (world, pick) => {
  const result = play(world, legalActions(world).find(pick));
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

it("offers Talk to the Shade on the turn he wakes a sleeper", () => {
  let world = step(asleepOnTheField(), (a) => a.kind === "wait" && !a.sleep);
  world = step(world, (a) => a.sleep);
  expect(world.log.findLast((e) => e.woke)).toMatchObject({ woke: "arrival" });
  expect(world.opening.met[SHADE]).toBe(world.turn);
  expect(world.packs["greek-drama"].met[SHADE]).toBe(world.turn);
  const talk = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === SHADE,
  );
  expect(talk).toBeTruthy();
  expect(cardPlay(world, [SHADE]).action?.key).toBe(talk.key);
  expect(cardPlay(world, [FIELD, SHADE]).action?.key).toBe(talk.key);
});

it("meets the Shade in a shared world on the turn he wakes a sleeper", () => {
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  let { world } = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  });
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = FIELD;
  world.turn = world.revision = 33;
  world = dispatchShared({ op: "join", world, ...seats }).world;
  for (const key of ["wait:vale::", "sleep:vale::", "sleep:vale::"]) {
    const result = dispatchShared({ op: "play", world, action: { key }, ...seats });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
  }
  expect(world.log.findLast((e) => e.woke)).toMatchObject({ woke: "arrival" });
  expect(world.packs["greek-drama"].met[SHADE]).toBe(world.turn);
  expect(legalActions(world, "vale").map((a) => a.key)).toContain(
    `talk:vale::${SHADE}`,
  );
});
