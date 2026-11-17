import "./helpers/no-dwell.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  wantAPI,
} from "../v2/card-game/world.mjs";
import {
  REFUSAL_LIMIT,
  STALL_TURNS,
  holdQuest,
  newWant,
  refuseWant,
  reviseStalledWants,
} from "../v2/card-game/want.mjs";
import { questFor } from "../v2/card-game/talk-quest.mjs";

function refused() {
  const s = createWorld();
  s.actors.moth.place = s.actors.vale.place = "station";
  s.items.lamp.holder = "vale";
  s.actors.moth.want = newWant("item", "lamp", 0);
  holdQuest(s, "vale", questFor(s, "moth", s.actors.moth.want), "quest:from:moth");
  for (let i = 0; i < 5; i++) refuseWant(s, "moth", "lamp", wantAPI(s));
  return s;
}
const find = (s, kind, fields = {}) =>
  legalActions(s).find(
    (a) => a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );

describe("a resident keeps what it wants", () => {
  it("holds a want refused five times, and the player keeps its quest", () => {
    let s = refused();
    expect(s.actors.moth.want).toMatchObject({ target: "lamp", refusals: REFUSAL_LIMIT });
    s = play(s, find(s, "wait")).state;
    expect(s.actors.moth.want?.target).toBe("lamp");
    expect(s.actors.moth.gaveUp).toBeUndefined();
    expect(s.actors.vale.want).toMatchObject({ target: "lamp", step: { to: "moth" } });
  });

  it("goes quiet after three refusals, holds on for 200 turns and takes a gift", () => {
    let s = refused(),
      seen = s.eventSeq;
    const pressed = [];
    while (s.turn < 200) {
      s = play(s, find(s, "wait")).state;
      pressed.push(
        ...s.log.filter(
          (e) =>
            e.seq > seen &&
            e.actorId === "moth" &&
            ["ask", "trade", "threaten"].includes(e.verb),
        ),
      );
      seen = s.eventSeq;
    }
    expect(pressed).toEqual([]);
    expect(s.actors.moth.want).toMatchObject({ target: "lamp", refusals: REFUSAL_LIMIT });
    expect(s.actors.vale.want?.target).toBe("lamp");
    s.actors.moth.place = s.actors.vale.place;
    delete s.actors.moth.sleeping;
    s = play(s, find(s, "give", { item: "lamp", target: "moth" })).state;
    expect(s.items.lamp.holder).toBe("moth");
    expect(s.actors.moth.want?.target).not.toBe("lamp");
    expect(s.log.some((e) => e.verb === "want_met" && e.actorId === "moth")).toBe(true);
  });

  it("sets aside a stalled want no player has accepted, and keeps an accepted one", () => {
    const stalled = () => {
      const s = createWorld();
      s.items.lamp.holder = "vale";
      s.actors.moth.want = newWant("item", "lamp", 0);
      s.turn = STALL_TURNS;
      return s;
    };
    const early = stalled();
    early.turn = STALL_TURNS - 1;
    reviseStalledWants(early, [], wantAPI(early));
    expect(early.actors.moth.want?.target).toBe("lamp");
    const free = stalled();
    reviseStalledWants(free, [], wantAPI(free));
    expect(free.actors.moth.gaveUp).toEqual({ target: "lamp", turn: STALL_TURNS });
    expect(free.actors.moth.want?.target).not.toBe("lamp");
    const held = stalled();
    holdQuest(held, "vale", questFor(held, "moth", held.actors.moth.want), "quest:from:moth");
    reviseStalledWants(held, [], wantAPI(held));
    expect(held.actors.moth.want?.target).toBe("lamp");
    expect(held.actors.moth.gaveUp).toBeUndefined();
  });

  it("counts refusals afresh when the wanted item changes holder", () => {
    const s = refused(),
      before = structuredClone(s);
    reviseStalledWants(s, [], wantAPI(s), before);
    expect(s.actors.moth.want.refusals).toBe(REFUSAL_LIMIT);
    s.items.lamp.holder = "keeper";
    reviseStalledWants(s, [], wantAPI(s), before);
    expect(s.actors.moth.want).toMatchObject({ target: "lamp", refusals: 0 });
    const late = refused();
    before.items.lamp.holder = "station";
    before.actors.moth.want.refusals = 1;
    reviseStalledWants(late, [], wantAPI(late), before);
    expect(late.actors.moth.want.refusals).toBe(REFUSAL_LIMIT - 1);
  });
});
