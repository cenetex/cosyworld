import { expect, it, vi } from "vitest";

vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const real = await importOriginal();
  const { companyPacks } = await import("./helpers/company-world.mjs");
  return {
    default: { ...real.default, packs: [...real.default.packs, ...companyPacks] },
  };
});

const { createWorld, decodeSave, encodeSave, exits, legalActions, play } =
  await import("../v2/card-game/world.mjs");
const { packRouteOpen } = await import("../v2/card-game/pack-registry.mjs");

const YARD = "co-yard",
  OUT = "co-b",
  KEY = "co-key";
const shutIn = () => {
  const s = createWorld({ seed: 5 });
  s.turn = s.revision = 60;
  s.actors.vale.place = YARD;
  s.items[KEY].holder = YARD;
  return s;
};
const wayOut = (s) =>
  legalActions(s, "vale").find((a) => a.kind === "move" && a.target === OUT);
const wait = (s) => {
  const action = legalActions(s, "vale").find(
    (a) => a.kind === "wait" && !a.sleep && !a.guards,
  );
  const done = play(s, action, s.revision, "vale");
  expect(done.ok, done.error).toBe(true);
  return done.state;
};

it("opens a way only while its condition holds and leaves a traveller shut in", () => {
  let s = wait(shutIn());
  expect(packRouteOpen(s, YARD, OUT)).toBe(true);
  expect(wayOut(s)).toBeTruthy();
  s.items[KEY].holder = "co-pit";
  expect(exits(s, YARD, "vale")).not.toContain(OUT);
  for (let round = 0; round < 6; round++) {
    s = decodeSave(encodeSave(wait(s)));
    expect(s.actors.vale.place).toBe(YARD);
    expect(legalActions(s, "vale").some((a) => a.kind === "move")).toBe(false);
  }
  expect(packRouteOpen(s, YARD, OUT)).toBe(false);
  s.items[KEY].holder = YARD;
  const done = play(s, wayOut(s), s.revision, "vale");
  expect(done.ok, done.error).toBe(true);
  expect(done.state.actors.vale.place).toBe(OUT);
  done.state.items[KEY].holder = "co-pit";
  expect(packRouteOpen(done.state, YARD, OUT)).toBe(false);
});
