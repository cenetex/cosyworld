import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";

function act(s, kind, target = null, item = null) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      !a.sleep &&
      (!target || a.target === target) &&
      (!item || a.item === item),
  );
  expect(a).toBeTruthy();
  const result = play(s, a);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function meeting() {
  const s = createWorld({ seed: 7 });
  s.actors.moth.place = "station";
  s.actors.keeper.place = "pond";
  s.items.lamp.holder = "vale";
  s.items.cloth.holder = "attic";
  s.actors.moth.want = { ...newWant("item", "lamp", 0), refusals: 1 };
  s.actors.keeper.want = null;
  delete s.actors.moth.metTurn;
  return s;
}
const demand = () => act(act(meeting(), "wait"), "wait");
const reload = (s) => decodeSave(encodeSave(s));
it("records a wanted handover from the actual threat without gift affection", () => {
  let s = reload(demand());
  const threat = s.log.findLast((e) => e.verb === "threaten");
  expect(s.standoffs[0].sourceSeq).toBe(threat.seq);
  const life = structuredClone(s.life.actors.moth);
  s = act(s, "give", "moth", "lamp");
  const event = s.log.findLast((e) => e.verb === "give");
  expect(event).toMatchObject({
    accepted: true,
    handover: {
      kind: "pressure",
      sourceSeq: threat.seq,
      openedTurn: threat.turn,
    },
  });
  expect(event.text).toBe("Vale hands the Lamp to Pip under pressure.");
  expect(s.actors.moth.trust.vale).toBe(0);
  expect(s.life.actors.moth).toEqual(life);
  expect(s.standoffs).toEqual([]);
  expect(s.items.lamp.holder).toBe("moth");
  expect(s.log.some((e) => e.verb === "attack")).toBe(false);
  expect(reload(s).log.find((e) => e.seq === event.seq)).toEqual(event);
});
