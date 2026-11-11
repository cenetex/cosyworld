import { describe, expect, it } from "vitest";
import { journeys } from "./journeys/index.mjs";
import { playJourney } from "./helpers/journey.mjs";
import { ashore } from "./journeys/greek-before-funeral.mjs";

describe("test journeys", () => {
  it.each(journeys.map((j) => [j.name, j]))(
    "plays %s on the current rules, the same every time",
    (_, journey) => {
      const named = journey.steps.filter((s) => s.at).map((s) => s.at);
      const first = playJourney(journey);
      expect(Object.keys(first)).toEqual(named);
      expect(playJourney(journey)).toEqual(first);
    },
  );

  it("stops at an illegal step with the checkpoint and the legal plays", () => {
    const journey = {
      name: "broken",
      start: ashore,
      steps: [
        { walk: "courtyard" },
        { kind: "take", item: "greek-bread" },
        { at: "bread" },
      ],
    };
    expect(() => playJourney(journey)).toThrow(
      /Journey broken, step 1 .*"take".*checkpoint "bread".*not legal.*greek-courtyard.*legal plays: .*wait/,
    );
  });
});
