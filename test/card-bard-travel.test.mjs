import { openingFixture } from "./helpers/greek-opening.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import {
  recitalContext,
  validRecitals,
} from "../v2/card-game/pack-recital.mjs";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
  exits,
} from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { needsVoyage, sailTo } from "./helpers/voyage.mjs";
const singer = "greek-rhapsode";
// A voyage takes a world round, so a sea crossing takes a few plays.
function untilSinger(s, place, limit = 8) {
  for (let turn = 0; turn < limit && s.actors[singer].place !== place; turn++)
    s = act(s);
  return s;
}
// The Bard wants to be somewhere; its own want, not a quest record, sends it.
function wants(s, place) {
  s.actors[singer].want = newWant("place", place, s.turn);
  delete s.actors[singer].metTurn;
  return s;
}
function act(s, kind = "wait", fields = {}, actor = "vale") {
  if (
    kind === "move" &&
    Object.keys(fields).join() === "target" &&
    needsVoyage(s, actor, fields.target)
  )
    return sailTo(s, fields.target, { actor });
  const action = legalActions(s, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action).toBeDefined();
  const result = play(s, action, s.revision, actor);
  expect(result.ok).toBe(true);
  expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
  return result.state;
}
describe("ordinary bard travel", () => {
  it("starts at the active harbor and preserves an introduced bard's saved place", () => {
    const fresh = createWorld();
    expect(fresh.actors[singer].place).toBe("greek-harbor");
    const old = createWorld();
    old.packs["greek-drama"].scope = "full";
    old.actors[singer].place = "greek-argolid-road";
    old.actors[singer].lastTalk = 0;
    delete old.routeKnowledge;
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.actors[singer].place).toBe("greek-argolid-road");
    expect(loaded.actors[singer].lastTalk).toBe(0);
  });
  it("keeps an untouched old spawn through migration and explores its authored exit", () => {
    const old = createWorld();
    old.actors[singer].place = "greek-argolid-road";
    delete old.routeKnowledge;
    wants(old, "station");
    let s = decodeSave(JSON.stringify(old));
    expect(s.actors[singer].place).toBe("greek-argolid-road");
    s = act(s);
    expect(s.actors[singer].place).toBe("greek-harbor");
    expect(s.actors[singer].want).toMatchObject({ kind: "place", target: "station" });
  });
  it("takes one legal offscreen step each turn and stays at the place it wants", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.actors[singer].place = "greek-argolid-road";
    wants(s, "greek-well");
    s.actors.keeper.place = "station";
    const trace = [];
    for (let i = 0; i < 5; i++) {
      const before = s.actors[singer].place;
      const legal = exits(s, before, singer);
      s = act(s);
      const after = s.actors[singer].place;
      if (before !== after) expect(legal).toContain(after);
      trace.push(after);
      expect(
        s.log.filter(
          (e) =>
            e.turn === s.turn && e.kind === "action" && e.actorId === singer,
        ),
      ).toHaveLength(before === after ? 0 : 1);
    }
    expect(trace.slice(0, 4)).toEqual([
      "greek-harbor",
      "greek-road-thebes",
      "greek-courtyard",
      "greek-well",
    ]);
    const met = s.log.find((e) => e.verb === "want_met" && e.actorId === singer);
    expect(met).toMatchObject({ turn: 4, wantMet: { kind: "place", target: "greek-well" } });
  });
  it("calls the actual ship, sails it, and preserves destination through reload", () => {
    let s = createWorld();
    // Vale waits away from the ship, so the Bard may call it.
    s.actors.vale.place = "station";
    s.actors[singer].place = "greek-harbor";
    wants(s, "pond");
    s.transports["greek-ship"].dock = "pond";
    s.crossings["pond-greek-harbor"].discovered = true;
    // Waiting at the harbor, the Bard calls the ship one lane closer.
    s = act(s);
    expect(s.actors[singer].place).toBe("greek-harbor");
    expect(s.transports["greek-ship"]).toMatchObject({
      phase: "docked",
      dock: "greek-harbor",
    });
    s = act(s);
    expect(s.actors[singer].place).toBe("greek-ship");
    s = decodeSave(encodeSave(s));
    // Alone aboard, the Bard sets the course and lands after a round at sea.
    s = act(s);
    expect(s.transports["greek-ship"]).toMatchObject({
      phase: "sea",
      destination: "pond",
    });
    s = untilSinger(s, "pond", 3);
    expect(s.actors[singer].place).toBe("pond");
    expect(s.transports["greek-ship"].dock).toBe("pond");
  });
  it("keeps a player-only home door subject to the real item gate", () => {
    let s = createWorld();
    s.sharedVersion = 1;
    s.controlledActors = [...humanAvatarIds];
    s.presentActors = [...humanAvatarIds];
    s.actors.vale.place = "station";
    s.actors[singer].place = "theatre";
    s.items.mask.holder = "theatre";
    s.actors.mara.place = "theatre";
    wants(s, "pond");
    s = act(s);
    expect(s.actors[singer].place).toBe("theatre");
    expect(exits(s, "theatre", singer)).not.toContain("pond");
    // Once Mara carries her mask, the door opens for the Bard as well.
    s = act(s, "take", { item: "mask" }, "mara");
    expect(s.actors[singer].place).toBe("pond");
    const stale = legalActions(s, "mara").find(
      (a) => a.kind === "move" && a.target === "pond",
    );
    s = act(s, "drop", { item: "mask" }, "mara");
    expect(play(s, stale, s.revision, "mara").ok).toBe(false);
  });
  it("keeps a known AI verse author through save reload and uses truthful song facts", () => {
    const s = openingFixture("exposure").closed;
    const pack = packDefinition("greek-drama");
    const record = s.packs[pack.id].recitals["greek-report-plan"];
    record.actor = "keeper";
    record.visit = s.turn;
    expect(validRecitals(s, pack)).toBe(true);
    const loaded = decodeSave(encodeSave(s));
    expect(
      recitalContext(loaded, [pack], singer).stanzas.find(
        (v) => v.id === "greek-report-plan",
      ),
    ).toMatchObject({ authorId: "keeper", authorName: "The keeper" });
    record.actor = null;
    expect(
      recitalContext(s, [pack], singer).stanzas.find(
        (v) => v.id === "greek-report-plan",
      ),
    ).toMatchObject({ authorId: null, authorName: "an earlier traveler" });
  });
});
