// Rules 100 and #2238: what the voices at the Theban gate are told about it
// follows the Guard, from both sides. Guarded, it is shut; with the guard
// away from his post, or the bar lifted by the decree or writ, it is open.
// The narrator bundle Rust runs tells the same as the browser narrative.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { encodeSave, exits } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { lifeWorld, reload, settleGate } from "./helpers/world-life.mjs";

const GUARD = "greek-guard",
  GATE = "greek-gate",
  FIELD = "greek-battlefield";
const sandbox = {};
runInNewContext(
  readFileSync("v2/orchestrator-rust/src/card_shared/narrator.js", "utf8"),
  sandbox,
);
const narrate = (request) =>
  JSON.parse(sandbox.cardNarrator(JSON.stringify(request)));

// Vale on one side of the gate, the guard at his post, away, or lifted.
function scene(state, place) {
  let s = lifeWorld({ place });
  if (state === "away") {
    s.actors[GUARD].place = "greek-courtyard";
    s.actors[GUARD].homeward = true;
  }
  if (state === "lifted") s.items["greek-decree"].holder = "greek-creon";
  return settleGate(reload(s));
}
// Every fact told to someone in the scene, but the room listings.
const told = (context) =>
  context.entities
    .flatMap((e) => e.facts)
    .filter((f) => !/^(Paths visible|At the dialogue scene)/u.test(f))
    .join(" ");
const SIDES = [
  [GATE, FIELD, "The way to The Exposed Battlefield is"],
  [FIELD, GATE, "The way to Theban City Gate is"],
];
const OPEN = { guarded: false, away: true, lifted: true };

describe("the voices at the Theban gate", () => {
  for (const [state, open] of Object.entries(OPEN))
    for (const [place, beyond, line] of SIDES)
      it(`hear it ${open ? "open" : "shut"} at ${place} when ${state}`, () => {
        const s = scene(state, place);
        expect(exits(s, place, "vale").includes(beyond)).toBe(open);
        const browser = narrativeContext(s);
        expect(told(browser)).toContain(`${line} ${open ? "open" : "shut"}.`);
        expect(told(browser)).not.toContain(
          `${line} ${open ? "shut" : "open"}.`,
        );
        // The bundle Rust runs tells the same scene the same way.
        const seats = { claimed: ["vale"], present: ["vale"] };
        const world = dispatchShared({
          op: "create",
          seed: 7,
          save: encodeSave(s),
        }).world;
        const shared = narrate({ world, actor: "vale", ...seats });
        expect(shared.ok, shared.error).toBe(true);
        expect(told(shared.context)).toContain(
          `${line} ${open ? "open" : "shut"}.`,
        );
        expect(shared.context).toEqual(
          narrativeContext({
            ...world,
            playerActorId: "vale",
            controlledActors: ["vale"],
            presentActors: ["vale"],
          }),
        );
      });
});
