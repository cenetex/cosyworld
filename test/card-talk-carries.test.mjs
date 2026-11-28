import "./helpers/still-cast.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  residentOffer,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { actionCaption } from "../v2/card-game/beats.mjs";
import { questFor, toldWant } from "../v2/card-game/talk-quest.mjs";
import { revealed, wantFact } from "../v2/card-game/want-talk.mjs";
import { CONTENT_TURNS, newWant } from "../v2/card-game/want.mjs";
import { entityActive, packPeople } from "../v2/card-game/pack-registry.mjs";
import { nameOf } from "../v2/card-game/world/catalog.mjs";
import { act as actOn } from "./helpers/play.mjs";

const act = (s, kind, fields = {}) =>
  actOn(
    s,
    (a) =>
      a.kind === kind &&
      !a.sleep &&
      !a.guards &&
      Object.entries(fields).every(([k, v]) => a[k] === v),
  );
const view = (s, id) =>
  narrativeContext(s).entities.find((e) => e.id === id).facts.filter(Boolean);
const played = (s) =>
  s.log.findLast((e) => e.kind === "action" && e.actorId === "vale");
const caption = (s) =>
  actionCaption(played(s), { viewer: "vale", here: s.actors.vale.place }).text;

function beside(id, seed) {
  const s = createWorld({ seed });
  const pack = packPeople[id]?.packId;
  if (pack && s.packs[pack].met) s.packs[pack].met[id] = 0;
  s.actors.vale.place = s.actors[id].place;
  return s;
}
function bellTable() {
  const s = createWorld();
  s.actors.moth.place = "station";
  s.items.bell.holder = "vale";
  s.items.lamp.holder = "vale";
  s.actors.moth.want = newWant("item", "lamp", 0);
  return s;
}

describe("a Talk tells the want the resident ends the round with", () => {
  it("offers a want drawn in the same round as the Talk", () => {
    let offered = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = beside("moth", seed);
      s.turn = s.revision = CONTENT_TURNS;
      Object.assign(s.actors.moth, { want: null, content: true, metTurn: 1 });
      const n = act(s, "talk", { target: "moth" });
      const want = n.actors.moth.want;
      expect(want, `seed ${seed}`).toBeTruthy();
      if (
        n.actors.moth.place !== n.actors.vale.place ||
        !revealed(n, "moth", want, "vale") ||
        !questFor(n, "moth", want)
      )
        continue;
      offered++;
      expect(toldWant(n, "vale", "moth")).toBe(true);
      expect(residentOffer(n, "vale", "moth")?.source).toBe("moth");
      expect(view(n, "moth")[0].startsWith("I want ")).toBe(true);
    }
    expect(offered).toBeGreaterThan(0);
  });

  it("puts the want first in the view of every resident who can say it", () => {
    const start = createWorld({ seed: 3 });
    const cast = Object.keys(start.actors).filter(
      (id) =>
        id !== "vale" &&
        entityActive(start, id) &&
        start.actors[id].want &&
        !id.startsWith("hoppycat-"),
    );
    const said = { hub: 0, pack: 0, staged: 0 };
    for (const id of cast) {
      const s = beside(id, 3);
      const talk = legalActions(s).find(
        (a) => a.kind === "talk" && a.target === id,
      );
      if (!talk) continue;
      const n = play(s, talk, s.revision).state;
      const fact = wantFact(n, id, nameOf, "vale");
      if (!fact) continue;
      expect(view(n, id)[0].startsWith("I want "), id).toBe(true);
      said[packPeople[id] ? "pack" : "hub"]++;
      if (packPeople[id]?.wants) said.staged++;
    }
    expect(said.hub).toBeGreaterThan(0);
    expect(said.pack).toBeGreaterThan(0);
    expect(said.staged).toBeGreaterThan(0);
  });
});

describe("a refusal says why", () => {
  it("keeps an untold want out of the reason", () => {
    const n = act(bellTable(), "give", { item: "bell", target: "moth" });
    expect(played(n)).toMatchObject({
      accepted: false,
      reason: "wants-something-else",
    });
    expect(played(n).wantId).toBeUndefined();
    expect(caption(n)).toMatch(/Pip wants something else\.$/u);
    expect(view(n, "moth")[0]).toContain("Pip wants something else.");
  });

  it("names the want the player was told", () => {
    const told = act(bellTable(), "talk", { target: "moth" });
    expect(toldWant(told, "vale", "moth")).toBe(true);
    const n = act(told, "give", { item: "bell", target: "moth" });
    expect(played(n).wantId).toBe("lamp");
    expect(caption(n)).toMatch(/Pip wants the Lamp\.$/u);
    expect(view(n, "moth")[0]).toContain("Pip wants the Lamp.");
    expect(() => validateWorld(n)).not.toThrow();
    played(n).reason = "needs-it";
    expect(() => validateWorld(n)).toThrow();
  });

  it("words each reason on the beat", () => {
    const refused = (fields) =>
      actionCaption(
        {
          seq: 1,
          kind: "action",
          actorId: "vale",
          targetId: "keeper",
          accepted: false,
          fromLocationId: "station",
          locationId: "station",
          ...fields,
        },
        { viewer: "vale", here: "station" },
      ).text;
    expect(refused({ verb: "ask", itemId: "bell", reason: "grudge" })).toBe(
      "Vale asked the keeper for the Bell, but was refused. The keeper holds a grudge.",
    );
    expect(
      refused({
        verb: "accompany",
        destinationId: "pond",
        reason: "wants-something-else",
        wantId: "moth",
      }),
    ).toBe("The keeper wouldn't go with Vale. The keeper wants to see Pip.");
    expect(
      refused({
        verb: "trade",
        itemId: "cloth",
        receiveId: "oil",
        reason: "wants-something-else",
        wantId: "pond",
      }),
    ).toBe(
      "Vale offered the Black cloth for the Oil flask, but the keeper refused. The keeper wants to be at Black pond.",
    );
    expect(refused({ verb: "ask", itemId: "bell", reason: "needs-it" })).toBe(
      "Vale asked the keeper for the Bell, but was refused. The keeper needs it.",
    );
    expect(refused({ verb: "give", itemId: "cloth" })).toBe(
      "Vale offered the Black cloth to the keeper, but the keeper refused.",
    );
  });
});
