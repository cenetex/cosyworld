import { expect, it } from "vitest";
import { act, lifeWorld, reload } from "./helpers/world-life.mjs";
import {
  encodeSave,
  decodeSave,
  legalActions,
  plan,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  noteRoomArrival,
  residentCourtesy,
} from "../v2/card-game/resident-home.mjs";
import { newWant } from "../v2/card-game/want.mjs";
const resident = "mara",
  room = "greek-courtyard",
  away = "greek-gate";
function fixture() {
  const s = lifeWorld({ place: room });
  s.sharedVersion = 1;
  s.controlledActors = s.presentActors = ["vale"];
  s.actors[resident].place = room;
  s.actors[resident].want = newWant("place", away, s.turn);
  return s;
}
it("keeps a resident for three rounds, then releases without a permanent lock", () => {
  let s = fixture();
  for (let i = 0; i < 3; i++) {
    s = act(s, "wait");
    expect(s.actors[resident].place).toBe(room);
    s = reload(s);
  }
  s = act(s, "wait");
  expect(s.actors[resident].place).toBe(away);
});
it("holds arrivals through two follow-up plays and an interaction through two more", () => {
  let s = fixture();
  s.actors.vale.place = away;
  s = act(s, "move", { target: room });
  expect(s.actors.vale.roomArrival).toEqual({ place: room, turn: s.turn });
  for (let i = 0; i < 2; i++) s = act(s, "wait");
  s = act(s, "talk", { target: resident });
  const talked = s.turn;
  expect(s.actors[resident].roomAttention.turn).toBe(talked);
  for (let i = 0; i < 2; i++) {
    s = act(s, "wait");
    expect(s.actors[resident].place).toBe(room);
  }
  s = act(s, "wait");
  expect(s.actors[resident].place).toBe(away);
});
it("replays the same actions and retains grace through reload", () => {
  let s = fixture();
  const initial = encodeSave(s),
    journal = [];
  for (let i = 0; i < 4; i++) {
    const a = legalActions(s).find(
      (a) => a.kind === "wait" && !a.sleep && !a.guards,
    );
    journal.push(a);
    s = reload(play(s, a).state);
  }
  const replay = journal.reduce(
    (state, a) => play(state, a).state,
    decodeSave(initial),
  );
  expect(encodeSave(replay)).toBe(encodeSave(s));
});
it("counts every present human, releases when they leave or sleep, never controls humans", () => {
  const s = fixture();
  s.controlledActors = s.presentActors = ["vale", "rue"];
  s.actors.vale.place = away;
  s.actors.rue.place = room;
  noteRoomArrival(s, "rue");
  expect(plan(s, resident).action.kind).toBe("wait");
  expect(residentCourtesy(s, "rue")).toBe(false);
  s.presentActors = ["vale"];
  expect(plan(s, resident).action.kind).toBe("move");
  s.presentActors = ["vale", "rue"];
  s.actors.rue.sleeping = { since: s.turn, place: room, present: [] };
  expect(plan(s, resident).action.kind).toBe("move");
  delete s.actors.rue.sleeping;
  s.actors.rue.place = away;
  expect(plan(s, resident).action.kind).toBe("move");
});
it("also gives a resident arriving beside a human a short grace, but not offstage", () => {
  const s = fixture();
  noteRoomArrival(s, resident);
  expect(plan(s, resident).action.kind).toBe("wait");
  s.turn += 4;
  expect(plan(s, resident).action.kind).toBe("move");
  noteRoomArrival(s, resident);
  s.actors.vale.place = away;
  expect(plan(s, resident).action.kind).toBe("move");
});
it("rejects malformed persisted courtesy instead of accepting indefinite holds", () => {
  for (const stamp of [
    { place: room, turn: Infinity },
    { place: room, turn: 9999 },
    { place: "missing", turn: 1 },
    { place: room, turn: -1 },
  ]) {
    const s = fixture();
    s.actors.vale.roomArrival = stamp;
    expect(() => validateWorld(s)).toThrow();
  }
});
it("does not replace a combat response or explicit accepted accompaniment", () => {
  let s = lifeWorld({ place: "greek-palace" });
  s = act(s, "threaten", { target: "greek-creon" });
  s = act(s, "attack", { target: "greek-creon" });
  expect(
    s.log.some(
      (e) =>
        e.turn === s.turn &&
        e.actorId === "greek-creon" &&
        ["attack", "guard", "retreat"].includes(e.verb),
    ),
  ).toBe(true);
  s = fixture();
  s.actors[resident].trust.vale = 3;
  const a = legalActions(s).find(
    (a) =>
      a.kind === "accompany" && a.target === resident && a.destination === away,
  );
  expect(a).toBeDefined();
  s = play(s, a).state;
  expect(s.actors.vale.place).toBe(away);
  expect(s.actors[resident].place).toBe(away);
});
