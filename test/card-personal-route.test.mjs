import { afterEach, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { talkedDirectly } from "../v2/card-game/conversation.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import {
  packDefinitions,
  personalRouteOpen,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const field = "greek-battlefield",
  hollow = "greek-polynices-hollow",
  shade = "greek-polynices-shade",
  antigone = "greek-antigone";
const pack = packDefinitions.find((p) => p.id === "greek-drama");
const route = pack.routes.find((r) => r.from === field && r.to === hollow);
afterEach(() => {
  delete route.travelerRequires;
});
function start() {
  const s = createWorld();
  s.turn = s.revision = 36;
  s.actors.vale.place = s.actors[antigone].place = field;
  s.crossings["pond-greek-harbor"].discovered = true;
  s.packs[pack.id].met[shade] = 35;
  return s;
}
function talk(s, actor, target) {
  const action = legalActions(s, actor).find(
    (a) => a.kind === "talk" && a.target === target,
  );
  expect(action).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
it("remembers direct participants after quest history clears, log trimming and reload", () => {
  let s = talk(start(), "vale", shade);
  const record = s.conversations.find(
    (c) => c.actors.includes(shade) && c.actors.includes("vale"),
  );
  expect(record.seq).toBe(
    s.log.find((e) => e.verb === "talk" && e.actorId === "vale").seq,
  );
  expect(talkedDirectly(s, shade, "vale")).toBe(true);
  expect(talkedDirectly(s, antigone, shade)).toBe(false);
  s.actors.vale.talked = [];
  s.log = s.log.slice(-1);
  s = decodeSave(encodeSave(s));
  expect(s.conversations).toContainEqual(record);
  expect(
    conditionMet(s, { kind: "talked", person: shade }, null, pack.id, "vale"),
  ).toBe(true);
  expect(
    conditionMet(s, { kind: "talked", person: shade }, null, pack.id, antigone),
  ).toBe(false);
});
it("migrates retained direct Talk events and keeps an old latch separate from personal access", () => {
  let s = start();
  s.openedRoutes = [`${field}>${hollow}`];
  s.actors.vale.talked = [shade];
  delete s.conversations;
  s = decodeSave(encodeSave(s));
  expect(talkedDirectly(s, "vale", shade)).toBe(false);
  s = talk(s, "vale", shade);
  const records = structuredClone(s.conversations);
  delete s.conversations;
  expect(decodeSave(encodeSave(s)).conversations).toEqual(records);
});
it("checks each traveller even after the shared gate opens", () => {
  route.travelerRequires = [{ kind: "talked", person: shade }];
  expect(() => validatePackDefinition(pack)).not.toThrow();
  let s = talk(start(), "vale", shade);
  expect(exits(s, field, "vale")).toContain(hollow);
  expect(exits(s, field, antigone)).not.toContain(hollow);
  expect(personalRouteOpen(s, field, hollow, antigone)).toBe(false);
  s.actors[shade].want = {
    kind: "person",
    target: antigone,
    since: s.turn,
    refusals: 0,
  };
  s.actors[shade].lastTalk = -9;
  const wait = (world) =>
    play(
      world,
      legalActions(world).find(
        (a) => a.kind === "wait" && !a.sleep && !a.guards,
      ),
    ).state;
  s = wait(s);
  expect(
    s.log.some(
      (e) =>
        e.verb === "talk" && e.actorId === shade && e.targetId === antigone,
    ),
  ).toBe(true);
  expect(exits(s, field, antigone)).toContain(hollow);
  expect(legalActions(s, antigone)).toContainEqual(
    expect.objectContaining({ kind: "move", target: hollow }),
  );
});
it("validates personal route conditions and saved event identity", () => {
  route.travelerRequires = [{ kind: "talked", person: "missing" }];
  expect(() => validatePackDefinition(pack)).toThrow();
  const s = talk(start(), "vale", shade);
  for (const patch of [
    { seq: s.eventSeq + 1 },
    { turn: -1 },
    { actors: ["vale", "vale"] },
    { actors: ["missing", "vale"] },
  ]) {
    const broken = structuredClone(s);
    Object.assign(broken.conversations[0], patch);
    expect(() => validateWorld(broken)).toThrow();
  }
  s.conversations.push(structuredClone(s.conversations[0]));
  expect(() => validateWorld(s)).toThrow();
});
it("replays shared direct evidence and clears a reset avatar's conversations", () => {
  const engine = currentSharedEngine(),
    seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const both = (request) => {
    const result = dispatchShared({ ...request, ...seats });
    expect(
      JSON.parse(engine.cardShared(JSON.stringify({ ...request, ...seats }))),
    ).toEqual(result);
    return result;
  };
  let s = both({ op: "create", save: encodeSave(start()) }).world;
  const action = both({ op: "view", world: s }).actions.find(
    (a) => a.kind === "talk" && a.target === shade,
  );
  const request = { op: "play", world: s, action, revision: s.revision };
  const result = both(request);
  expect(both(request)).toEqual(result);
  s = result.world;
  expect(talkedDirectly(s, "vale", shade)).toBe(true);
  const reset = both({ op: "reset", world: s }).world;
  expect(talkedDirectly(decodeSave(encodeSave(reset)), "vale", shade)).toBe(
    false,
  );
});
