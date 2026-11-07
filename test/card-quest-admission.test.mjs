import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play, wantAPI } from "../v2/card-game/world.mjs";
import { allQuestsOf, newWant, offerLevelQuest, pushQuest, questRewardsOf, questsOf, questXp } from "../v2/card-game/want.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sleepWake } from "../v2/card-game/sleep-presentation.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { questing } from "./helpers/first-quest.mjs";

const reload = (s) => decodeSave(encodeSave(s));
const item = (target) => newWant("item", target, 0);
function act(s, test) {
  const action = legalActions(s).find(test);
  expect(action).toBeTruthy();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep);
function full() {
  const s = questing(createWorld({ seed: 7 }));
  s.actors.vale.want = newWant("place", "pond", 0);
  s.actors.vale.under = [item("oil"), { ...item("bell"), story: true }];
  s.items.bell.holder = "station";
  return s;
}
it("preserves old third quests on local/shared import and admits after discard", () => {
  let s = reload(full());
  const goals = structuredClone(allQuestsOf(s, "vale"));
  const shared = dispatchShared({ op: "create", save: encodeSave(s) }).world;
  expect(allQuestsOf(shared, "vale")).toEqual(goals);
  expect(questsOf(shared, "vale")).toHaveLength(2);
  s = act(s, (a) => a.kind === "take" && a.item === "bell");
  expect(questRewardsOf(s, "vale")).toHaveLength(0);
  s = reload(act(s, (a) => a.kind === "drop" && a.quest === 0));
  expect(questsOf(s, "vale")).toEqual(goals.slice(1));
  expect(questRewardsOf(s, "vale")).toHaveLength(0);
  s = wait(s);
  expect(questRewardsOf(s, "vale")[0].want).toEqual(goals[2]);
  pushQuest(s, "vale", item("cloth"));
  expect(questsOf(s, "vale")).toHaveLength(2);
  expect(questRewardsOf(reload(s), "vale")).toHaveLength(1);
});
function sleeping(final = false, fullSlots = true) {
  const s = full(), a = s.actors.vale;
  s.turn = s.revision = 24;
  Object.assign(a, { place: "attic", level: 1, xp: questXp(2),
    sleeping: { since: 12, place: "attic", present: [] } });
  s.items.bell.holder = "attic";
  a.want = final ? { ...newWant("place", "attic", 0),
    quest: { level: 2, left: 1 }, step: { verb: "rest" } } : item("cloth");
  a.under = final ? [item("oil"), item("bell")] : fullSlots ? [item("oil")] : [];
  if (!a.under.length) delete a.under;
  return s;
}
it("waits through the play that wakes and completes a level quest", () => {
  let s = act(sleeping(true), (a) => a.kind === "take" && a.item === "bell");
  expect(questRewardsOf(s, "vale").map((r) => r.level)).toEqual([2]);
  expect(questsOf(s, "vale").map((w) => w.target)).toEqual(["oil", "bell"]);
  s = wait(reload(s));
  expect(questRewardsOf(s, "vale").map((r) => r.want.target)).toEqual(["attic", "bell"]);
});
it.each([false, true])("dreams only when the new level quest is active (full %s)", (fullSlots) => {
  const s = act(sleeping(false, fullSlots), (a) => a.kind === "take" && a.item === "bell");
  expect(allQuestsOf(s, "vale").filter((w) => w.quest)).toHaveLength(1);
  expect(offerLevelQuest(s, "vale", wantAPI(s))).toBe(null);
  expect(sleepWake(s, "vale").dream).toBe(!fullSlots);
  expect(narrativeContext(s).dream ?? null).toBe(fullSlots ? null : "quest");
  expect(questsOf(reload(s), "vale")).toHaveLength(2);
});
it("keeps three named NPC goals and two offline human-avatar goals", () => {
  const s = full();
  s.actors.keeper.want = item("bell"); s.actors.keeper.under = [item("lamp"), item("cloth")];
  s.actors.mara.want = item("lamp"); s.actors.mara.under = [item("cloth"), item("bell")];
  expect(questsOf(reload(s), "keeper")).toHaveLength(3);
  expect(questsOf(reload(s), "mara")).toHaveLength(2);
  expect(allQuestsOf(reload(s), "mara")).toHaveLength(3);
});
