import { beforeAll, describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { learnTold } from "../v2/card-game/quest-learn.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { recordOf } from "../v2/card-game/world/arcana-record.mjs";
import { openDoorStart, traveler } from "./helpers/open-door.mjs";

let start;
beforeAll(() => {
  start = openDoorStart();
});
const met = (s) => s.log.filter((e) => e.verb === "want_met" && e.turn === s.turn);
const byVale = (s) => met(s).filter((e) => e.actorId === "vale").map((e) => e.ownerId);
function knowing(owner, { at, with: other, want }) {
  const s = structuredClone(start);
  for (const id of [owner, other].filter(Boolean)) s.packs["greek-drama"].met[id] ??= s.turn;
  if (want) s.actors[owner].want = newWant(want.kind, want.target, s.turn);
  s.actors.vale.place = at;
  if (other) Object.assign(s.actors[other], { place: at, trust: { ...s.actors[other].trust, vale: 3 } });
  learnTold(s, owner, "vale");
  return traveler(decodeSave(encodeSave(s)));
}

describe("a known card that asks for someone else completes without a taken copy", () => {
  it.each([
    ["greek-aethra", { at: "greek-road-athens-eleusis", with: "greek-theseus" }, "eleusis"],
    ["greek-quay-host", { at: "greek-road-athens-piraeus", with: "greek-household-witness" }, "piraeus"],
    [
      "greek-colonus-keeper",
      { at: "greek-eleusis", with: "greek-ismene", want: { kind: "person", target: "greek-ismene" } },
      "colonus",
    ],
  ])("%s's, when the one it asks for is brought", (owner, setup, to) => {
    const t = knowing(owner, setup);
    const before = recordOf(t.s, "vale").calls ?? 0;
    t.walkWith(setup.with, to);
    expect(byVale(t.s)).toEqual([owner]);
    expect(recordOf(t.s, "vale")).toMatchObject({ calls: before + 1 });
    t.act("wait");
    expect(byVale(t.s)).toEqual([]);
  });

  it("the shipmaster's, when the provisions are eaten at Piraeus", () => {
    const t = knowing("greek-shipmaster", { at: "greek-piraeus" });
    t.s.items["greek-provisions"].holder = "vale";
    t.s.usedUp = t.s.usedUp.filter((id) => id !== "greek-provisions");
    t.act("eat", { item: "greek-provisions" });
    expect(byVale(t.s)).toEqual(["greek-shipmaster"]);
  });

  it("pays nobody for a card already met before the play", () => {
    const t = knowing("greek-aethra", { at: "greek-eleusis", with: "greek-theseus" });
    t.act("wait");
    expect(byVale(t.s)).toEqual([]);
  });
});
