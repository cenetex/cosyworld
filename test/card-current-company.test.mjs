import "./helpers/still-cast.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  currentCompany,
  talkedDirectly,
} from "../v2/card-game/conversation.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
const fable = "hoppycat-fable";
function start(other = fable) {
  const s = createWorld({ seed: 7 });
  s.actors.vale.place = s.actors[other].place;
  if (other === "moth")
    s.actors.moth.want = {
      kind: "place",
      target: s.actors.moth.place,
      since: 0,
      refusals: 0,
    };
  if (packPeople[other]) s.packs[packPeople[other].packId].met[other] = 0;
  return s;
}
function act(s, fields, actor = "vale") {
  const action = legalActions(s, actor).find((a) =>
    Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, JSON.stringify(fields)).toBeDefined();
  const done = play(s, action, s.revision, actor);
  expect(done.ok, done.error).toBe(true);
  return done.state;
}
const pair = (s) =>
  s.conversations.find(
    (c) => c.actors.includes(fable) && c.actors.includes("vale"),
  );
describe("current company from a real Talk", () => {
  it("records fixed residents without a life record and keeps first-Talk evidence", () => {
    let s = act(start(), { kind: "talk", target: fable });
    expect(currentCompany(s, "vale", fable)).toBe(true);
    expect(s.life.actors[fable]).toBeUndefined();
    const first = structuredClone(pair(s));
    s = act(s, { kind: "talk", target: fable });
    expect(pair(s)).toMatchObject({ seq: first.seq, turn: first.turn });
    expect(pair(s).company).toBeGreaterThan(first.company);
    s.log = [];
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("clears current company on separation and keeps the lasting conversation", () => {
    let s = act(start(), { kind: "talk", target: fable });
    const move = legalActions(s).find((a) => a.kind === "move");
    s = act(s, { key: move.key });
    expect(currentCompany(s, "vale", fable)).toBe(false);
    expect(pair(s).company).toBeUndefined();
    expect(talkedDirectly(s, "vale", fable)).toBe(true);
  });
  it("keeps an encounter through another room's turn and ends it on host Sleep", () => {
    let s = start();
    s.sharedVersion = 1;
    s.controlledActors = s.presentActors = ["vale", "rue"];
    s = act(s, { kind: "talk", target: fable });
    s = act(s, { kind: "wait" }, "rue");
    expect(currentCompany(s, "vale", fable)).toBe(true);
    s = act(s, { kind: "wait" });
    s = act(s, { kind: "wait", sleep: true });
    expect(currentCompany(s, "vale", fable)).toBe(false);
    expect(pair(s).company).toBeUndefined();
  });
  it("ends company through a real threat and a pack switch", () => {
    let s = act(start("moth"), { kind: "talk", target: "moth" });
    expect(currentCompany(s, "vale", "moth")).toBe(true);
    s = act(s, { kind: "threaten", target: "moth" });
    expect(currentCompany(s, "vale", "moth")).toBe(false);
    s = act(start(), { kind: "talk", target: fable });
    const switched = play(s, { kind: "pack", pack: "hoppy", enable: false });
    expect(switched.ok, switched.error).toBe(true);
    expect(pair(switched.state).company).toBeUndefined();
    expect(talkedDirectly(switched.state, "vale", fable)).toBe(true);
  });
  it("validates the current event while earlier saves keep only first-Talk evidence", () => {
    const s = act(start(), { kind: "talk", target: fable });
    for (const company of [-1, s.eventSeq + 1, pair(s).seq - 1, "2"]) {
      const bad = structuredClone(s);
      pair(bad).company = company;
      expect(() => encodeSave(bad)).toThrow();
    }
    const old = structuredClone(s);
    delete old.conversations;
    const loaded = decodeSave(JSON.stringify(old));
    expect(talkedDirectly(loaded, "vale", fable)).toBe(true);
    expect(currentCompany(loaded, "vale", fable)).toBe(false);
  });
});
