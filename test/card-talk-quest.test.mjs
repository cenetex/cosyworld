import { collectRewards } from "./helpers/claim-rewards.mjs";
// Talk gives a quest (#2196, rules 99): a player's Talk that reveals a want
// new to them gives give(item, them), bring(them, place) or
// introduce(them, person).
import { describe, expect, it } from "vitest";
import { questing } from "./helpers/first-quest.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
  validateWorld,
  wantAPI,
  wantText,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  halfwayXp,
  allQuestsOf,
  newWant,
  questsOf,
  questXp,
} from "../v2/card-game/want.mjs";
import { talkQuest, talkQuestFrom } from "../v2/card-game/talk-quest.mjs";

const act = (s, pick, actor = "vale") => {
  const action = legalActions(s, actor).find(pick);
  expect(action, "a legal play").toBeTruthy();
  const done = play(s, action, s.revision, actor);
  expect(done.ok).toBe(true);
  return done.state;
};
const talk = (s, target) =>
  act(s, (a) => a.kind === "talk" && a.target === target);
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep);
const reload = (s) => decodeSave(encodeSave(s));
// Vale, Pip and the keeper at the station; Pip wants the lit lamp, which
// Vale holds. Vale's own quest is to go to the pond.
function station() {
  const s = enableMotives(questing(createWorld()));
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  s.items.lamp.holder = "vale";
  s.actors.vale.want = newWant("place", "pond", 0);
  return s;
}
const given = (s) => questsOf(s, "vale").filter((w) => talkQuestFrom(w));

describe("a quest from Talk", () => {
  it("gives the quest for a want new to the player, once, and saves it", () => {
    let s = talk(station(), "moth");
    expect(questsOf(s, "vale")[1]).toMatchObject({
      kind: "item",
      target: "lamp",
      step: { verb: "give", to: "moth" },
    });
    expect(wantText(questsOf(s, "vale")[1])).toBe(
      `give ${nameOf("lamp")} to ${nameOf("moth")}`,
    );
    expect(s.actors.vale.heard).toEqual({ moth: "item:lamp" });
    // Re-hearing a want already known adds nothing.
    const held = questsOf(s, "vale");
    s = talk(s, "moth");
    expect(questsOf(s, "vale")).toEqual(held);
    // Saved and loaded exactly; the same plays give the same world.
    expect(reload(s)).toEqual(s);
    expect(talk(talk(station(), "moth"), "moth")).toEqual(s);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("asks to bring them to the place they want, or to the person", () => {
    // Pip would walk to the pond alone within the play's round, meeting the
    // want first, so the quest is given straight from the rules here.
    let s = station();
    s.actors.vale.want = newWant("person", "keeper", 0);
    s.actors.moth.want = newWant("place", "pond", 0);
    expect(talkQuest(s, "vale", "moth", wantAPI(s))).toBeTruthy();
    const bring = given(s)[0];
    expect(bring).toMatchObject({
      kind: "person",
      target: "moth",
      step: { verb: "bring", at: "pond" },
    });
    expect(wantText(bring)).toBe(
      `bring ${nameOf("moth")} to ${nameOf("pond")}`,
    );
    expect(validateWorld(reload(s))).toBeTruthy();
    // Met when they are at the place in Vale's company.
    let xp = s.actors.vale.xp;
    s.actors.moth.place = s.actors.vale.place = "pond";
    s = wait(s);
    expect(given(s)).toEqual([]);
    s = collectRewards(s);
    expect(s.actors.vale.xp).toBe(xp + 1);
    s = station();
    s.actors.keeper.place = "pond";
    s.actors.moth.want = newWant("person", "keeper", 0);
    expect(talkQuest(s, "vale", "moth", wantAPI(s))).toBeTruthy();
    expect(given(s)[0]).toMatchObject({
      kind: "person",
      target: "moth",
      step: { verb: "bring", to: "keeper" },
    });
    expect(wantText(given(s)[0])).toBe(
      `bring ${nameOf("moth")} to ${nameOf("keeper")}`,
    );
    expect(validateWorld(reload(s))).toBeTruthy();
    // Met when they are with the person they want to see.
    xp = s.actors.vale.xp;
    s.actors.moth.place = "pond";
    s = wait(s);
    expect(given(s)).toEqual([]);
    s = collectRewards(s);
    expect(s.actors.vale.xp).toBe(xp + 1);
  });

  it("waits behind both current quests, including level and story quests", () => {
    for (const top of [
      { ...newWant("person", "keeper", 0), quest: { level: 2, left: 2 } },
      {
        ...newWant("item", "bell", 0),
        story: true,
        step: { verb: "give", to: "keeper" },
      },
    ]) {
      let s = station();
      s.actors.vale.want = null;
      if (top.quest) s.actors.vale.xp = questXp(2);
      s.actors.vale.want = top;
      s.actors.vale.under = [newWant("place", "pond", 0)];
      s = talk(s, "moth");
      const list = questsOf(s, "vale");
      expect(list[0].quest ?? list[0].story).toBeTruthy();
      expect(list[1].target).toBe("pond");
      expect(talkQuestFrom(allQuestsOf(s, "vale")[2])).toBe("moth");
    }
  });

  it("keeps holding and giving the same item as separate goals", () => {
    let s = station();
    // Pip cannot take the lit lamp and finish its want during this Talk.
    s.items.lamp.holder = "attic";
    s.actors.vale.want = newWant("place", "pond", 0);
    s.actors.vale.under = [newWant("item", "lamp", 0)];
    s = talk(s, "moth");
    const list = questsOf(s, "vale");
    expect(list.filter((w) => w.target === "lamp")).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "place", target: "pond" });
    expect(allQuestsOf(s, "vale")[2].step).toEqual({ verb: "give", to: "moth" });
  });

  it("leaves when their want changes first, without a refusal", () => {
    let s = talk(station(), "moth");
    const xp = s.actors.vale.xp;
    s.actors.moth.want = newWant("place", "pond", s.turn);
    s = wait(s);
    expect(given(s)).toEqual([]);
    expect(s.actors.vale.xp).toBe(xp);
    expect(s.actors.vale.want).not.toBeNull();
    expect(questsOf(s, "vale").every((w) => w.refusals === 0)).toBe(true);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("gives experience to both when met", () => {
    let s = talk(station(), "moth");
    const [vale, pip] = [s.actors.vale.xp, s.actors.moth.xp];
    s = act(
      s,
      (a) => a.kind === "give" && a.target === "moth" && a.item === "lamp",
    );
    expect(given(s)).toEqual([]);
    expect(s.actors.vale.xp).toBe(vale);
    s = collectRewards(s);
    expect(s.actors.vale.xp).toBe(vale + 1);
    expect(s.actors.moth.xp).toBe(pip + 1);
  });

  it("is for players only", () => {
    const s = station();
    s.actors.keeper.want = newWant("item", "bell", 0);
    expect(talkQuest(s, "keeper", "moth", wantAPI(s))).toBeNull();
    expect(s.actors.keeper.heard).toBeUndefined();
    // A want Talk gives no quest for records nothing.
    s.actors.moth.want = null;
    expect(talkQuest(s, "vale", "moth", wantAPI(s))).toBeNull();
    expect(s.actors.vale.heard).toBeUndefined();
  });

  it("counts toward the ordinary wants between level quests (option A)", () => {
    let s = station();
    // Level X: one want short of halfway, with nothing else to meet.
    Object.assign(s.actors.vale, { level: 10, xp: halfwayXp(10) - 1 });
    s.turn = s.revision = 96;
    s.actors.moth.want.since = s.turn;
    s = talk(s, "moth");
    expect(s.actors.vale.halfwayIssued).toBeUndefined();
    s = act(
      s,
      (a) => a.kind === "give" && a.target === "moth" && a.item === "lamp",
    );
    s = collectRewards(s);
    expect(s.actors.vale.xp).toBe(halfwayXp(10));
    expect(s.actors.vale.halfwayIssued).toBe(11);
    expect(
      questsOf(s, "vale").some((w) => w.step?.verb === "rest" && !w.quest),
    ).toBe(false);
  });

  it("refuses a malformed saved record", () => {
    const s = talk(station(), "moth");
    for (const heard of [
      { vale: "item:lamp" },
      { nobody: "item:lamp" },
      { moth: "connect:humans" },
      [],
    ]) {
      const bad = JSON.parse(encodeSave(s));
      bad.actors.vale.heard = heard;
      expect(
        () => decodeSave(JSON.stringify(bad)),
        JSON.stringify(heard),
      ).toThrow();
    }
    // A Talk quest with both a place and a person is no quest.
    const bad = JSON.parse(encodeSave(s));
    bad.actors.vale.under = [
      {
        ...newWant("person", "moth", 0),
        step: { verb: "bring", at: "pond", to: "keeper" },
      },
    ];
    expect(() => decodeSave(JSON.stringify(bad))).toThrow();
  });
});
