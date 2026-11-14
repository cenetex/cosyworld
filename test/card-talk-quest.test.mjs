// Talk tells a want (#2196, rules 99; rules 133): a player's Talk that reveals
// a want records it as heard and hands the player nothing. The quest that
// would meet it is read with `questFor`, and a tap (a later package) takes it.
import { describe, expect, it } from "vitest";
import { questing } from "./helpers/first-quest.mjs";
import { heldFrom } from "./helpers/accept-quest.mjs";
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
import { newWant, questsOf } from "../v2/card-game/want.mjs";
import {
  pruneTalkQuests,
  questFor,
  talkQuest,
  talkQuestFrom,
  toldWant,
} from "../v2/card-game/talk-quest.mjs";

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
// Vale holds. Vale holds no quest.
function station() {
  const s = enableMotives(questing(createWorld()));
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  s.items.lamp.holder = "vale";
  s.actors.vale.want = null;
  return s;
}

describe("Talk tells a want", () => {
  it("records what was told, and holds the quest it gives", () => {
    let s = talk(station(), "moth");
    expect(heldFrom(s, "moth").actors.vale.want.from).toBe("quest:from:moth");
    expect(s.actors.vale.heard).toEqual({ moth: "item:lamp" });
    expect(toldWant(s, "vale", "moth")).toBe(true);
    // Saved and loaded exactly; the same plays make the same world.
    expect(reload(s)).toEqual(s);
    expect(talk(talk(station(), "moth"), "moth").actors.vale.heard).toEqual(
      s.actors.vale.heard,
    );
    expect(validateWorld(reload(s))).toBeTruthy();
    heldFrom(s, "moth");
    expect(s.actors.vale.want).toMatchObject({
      kind: "item",
      target: "lamp",
      step: { verb: "give", to: "moth" },
    });
    expect(wantText(s.actors.vale.want)).toBe(
      `give ${nameOf("lamp")} to ${nameOf("moth")}`,
    );
    s = reload(s);
    expect(validateWorld(s)).toBeTruthy();
  });

  it("stops being offered once their want changes", () => {
    let s = talk(station(), "moth");
    expect(toldWant(s, "vale", "moth")).toBe(true);
    s.actors.moth.want = newWant("place", "pond", s.turn);
    expect(toldWant(s, "vale", "moth")).toBe(false);
  });

  it("reads the quest that meets a place or a person they want", () => {
    const s = station();
    const bring = questFor(s, "moth", newWant("place", "pond", 0));
    expect(bring).toMatchObject({
      kind: "person",
      target: "moth",
      step: { verb: "bring", at: "pond" },
    });
    expect(wantText(bring)).toBe(`bring ${nameOf("moth")} to ${nameOf("pond")}`);
    const introduce = questFor(s, "moth", newWant("person", "keeper", 0));
    expect(introduce).toMatchObject({
      kind: "person",
      target: "moth",
      step: { verb: "bring", to: "keeper" },
    });
    expect(talkQuestFrom(bring)).toBe("moth");
    expect(talkQuestFrom(introduce)).toBe("moth");
    // A want Talk gives no quest for.
    expect(questFor(s, "moth", { kind: "connect", target: "humans" })).toBeNull();
  });

  it("meets the taken quest for both: the helper's trust, and Pip's own XP", () => {
    let s = talk(station(), "moth");
    heldFrom(s, "moth");
    const [vale, pip] = [s.actors.vale.xp, s.actors.moth.xp];
    s = act(
      s,
      (a) => a.kind === "give" && a.target === "moth" && a.item === "lamp",
    );
    expect(s.actors.vale.want).toBeNull();
    expect(s.actors.vale.closed["quest:from:moth"][1]).toContain("lamp");
    expect(s.actors.vale.xp).toBe(vale);
    expect(s.actors.moth.xp).toBe(pip + 1);
    expect(s.actors.moth.trust.vale).toBe(1);
    expect(s.actors.vale.questRewards).toBeUndefined();
  });

  it("leaves a held Talk quest when their want changes first, without a refusal", () => {
    let s = talk(station(), "moth");
    heldFrom(s, "moth");
    const xp = s.actors.vale.xp;
    s.actors.moth.want = newWant("place", "pond", s.turn);
    s = wait(s);
    expect(s.actors.vale.want).toBeNull();
    expect(s.actors.vale.closed).toBeUndefined();
    expect(s.actors.vale.xp).toBe(xp);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("prunes only a player's Talk quest", () => {
    const s = station();
    s.actors.vale.want = {
      ...newWant("item", "lamp", 0),
      step: { verb: "give", to: "moth" },
    };
    s.actors.moth.want = newWant("place", "pond", 0);
    pruneTalkQuests(s, wantAPI(s));
    expect(questsOf(s, "vale")).toEqual([]);
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
    bad.actors.vale.want = {
      ...newWant("person", "moth", 0),
      step: { verb: "bring", at: "pond", to: "keeper" },
    };
    expect(() => decodeSave(JSON.stringify(bad))).toThrow();
  });
});
