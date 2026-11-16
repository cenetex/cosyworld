import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  nameOf,
  wantText,
} from "../v2/card-game/world.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import { goalsOf, stepGoal } from "../v2/card-game/world/lock-goals.mjs";
import { questCaption, questCards } from "../v2/card-game/quest-card.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";

const finishing = Object.entries(packPeople).flatMap(([id, person]) =>
  [person.want, ...(person.wants || []).map((entry) => entry.want)]
    .filter((want) => want?.step?.verb === "lay" && want.step.finish)
    .map((want) => [id, person.packId, want]),
);

describe("a lay step that waits on a flag", () => {
  it("is worded as the play that sets the flag, everywhere", () => {
    expect(finishing.length).toBeGreaterThan(0);
    for (const [id, packId, want] of finishing) {
      const s = createWorld();
      const [goal] = goalsOf(
        s,
        packId,
        [{ kind: "flag", key: want.step.finish, value: true }],
        "vale",
      );
      expect(goal?.step?.verb).not.toBe("lay");
      expect(stepGoal(s, want, "vale")).toEqual(goal);
      s.actors.vale.want = { ...want, since: 0, refusals: 0 };
      const words = wantText(goal);
      const [card] = questCards(s);
      expect(questCaption(card).toLowerCase()).toBe(words.toLowerCase());
      expect(
        legalActions(s).find((a) => a.kind === "drop" && a.quest === 0).text,
      ).toBe(`Vale abandons their quest to ${words}.`);
      s.actors[id].want = { ...want, since: 0, refusals: 0 };
      expect(wantFact(s, id, nameOf)).toContain(nameOf(goal.target));
      expect(wantFact(s, id, nameOf)).not.toContain(" laid in ");
      s.packs[packId].flags[want.step.finish] = true;
      expect(stepGoal(s, want, "vale")).toBe(want);
    }
  });

  it("leaves every other want as it is", () => {
    const s = createWorld();
    for (const person of Object.values(packPeople)) {
      const want = person.want ?? person.wants?.[0]?.want;
      if (want && !want.step?.finish)
        expect(stepGoal(s, want, "vale")).toBe(want);
    }
  });
});
