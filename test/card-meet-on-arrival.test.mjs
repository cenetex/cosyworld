// Rules 101 (#2248): a resident who walks in at dawn or dusk is met on
// arrival, so the player can Talk with them on that same turn.
import { describe, expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { knownActors } from "../v2/card-game/want.mjs";
import { DAY_TURNS } from "../v2/card-game/resident-home.mjs";
import { speechOccasions } from "../v2/card-game/narrative.mjs";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import { act, reload, wait } from "./helpers/world-life.mjs";

const ELDER = "greek-elder",
  BAKER = "greek-baker",
  COURT = "greek-courtyard";

// A local save past the opening on its second day: Vale in the courtyard
// has met the baker there but never the elder, who wants the courtyard.
function courtyard() {
  const s = createWorld({
    opening: true,
    seed: 7,
    packScopes: { "greek-drama": "full" },
  });
  s.turn = s.revision = DAY_TURNS + 20;
  s.actors.vale.place = COURT;
  s.opening.crossed = true;
  s.locations.attic.anchored = true;
  for (const id of [BAKER, "moth", "keeper"]) s.opening.met[id] = 0;
  s.packs["greek-drama"].met[BAKER] = 0;
  s.actors[ELDER].want = {
    kind: "place",
    target: COURT,
    since: s.turn,
    refusals: 0,
  };
  return reload(s);
}
const talkTo = (s, id) =>
  legalActions(s).some((a) => a.kind === "talk" && a.target === id);

describe("meeting a resident who arrives (rules 101)", () => {
  for (const [name, step] of [
    ["only Waits", (s) => act(s, "wait")],
    ["Talks with another", (s) => act(s, "talk", { target: BAKER })],
  ])
    it(`offers Talk the turn the elder arrives at dusk, after ${name}`, () => {
      let s = courtyard();
      expect(knownActors(s)).not.toContain(ELDER);
      while (s.actors[ELDER].place !== COURT) {
        expect(s.turn).toBeLessThan(DAY_TURNS + 24);
        s = step(s);
      }
      expect(s.turn).toBe(DAY_TURNS + 24); // dusk
      expect(availableCards(s)).toContain(ELDER);
      expect(knownActors(s)).toContain(ELDER);
      expect(s.opening.met[ELDER]).toBe(s.turn);
      expect(s.packs["greek-drama"].met[ELDER]).toBe(s.turn);
      expect(talkTo(s, ELDER)).toBe(true);
      expect(talkTo(reload(s), ELDER)).toBe(true);
      // The arrival is a first meeting, so the newcomer may speak.
      expect(speechOccasions(s, dialogueCast(s)).speakers).toContain(ELDER);
      s = act(s, "talk", { target: ELDER });
      expect(s.opening.met[ELDER]).toBe(DAY_TURNS + 24);
    });

  it("meets no one who arrives where the player is not", () => {
    let s = courtyard();
    s.actors.vale.place = "greek-harbor";
    s = wait(reload(s), 4);
    expect(s.actors[ELDER].place).toBe(COURT);
    expect(s.opening.met[ELDER]).toBeUndefined();
  });
});
