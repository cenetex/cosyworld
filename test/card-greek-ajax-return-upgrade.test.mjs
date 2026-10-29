import { beforeAll, describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { emptyPoemReadings } from "../v2/card-game/poem-readings.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import {
  questCarried,
  questHolderActor,
} from "../v2/card-game/quest-hands.mjs";
import { openDoorSteps } from "./helpers/open-door.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

const GREEK = "greek-drama";
const KEY = `${GREEK}:story-quest-greek-ajax-return`;
const HUMANS = ["vale", "mara"];

// Earn both checkpoints through the published rules, including the earlier
// invitation, burial, signed speech, handover and final return.
function releasedAccounts() {
  const old = releasedCardEngine(20);
  let world = old.dispatch({ op: "create" }).world;
  delete world.opening;
  world.actors.mara.place = "pond";
  world.items.cloth.holder = "vale";
  const request = (op, actor, fields = {}) => {
    const result = old.dispatch({
      op,
      actor,
      world,
      claimed: HUMANS,
      present: HUMANS,
      ...fields,
    });
    expect(result.ok, result.error).toBe(true);
    if (op !== "view") world = result.world;
    return result;
  };
  const act = (actor, kind, fields = {}) => {
    const find = () =>
      request("view", actor).actions.find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([k, v]) => a[k] === v),
      );
    if (kind === "move" && fields.target === "greek-ship")
      for (let i = 0; i < 32 && !find(); i++) act(actor, "wait");
    const action = find();
    expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeDefined();
    return request("play", actor, { action, revision: world.revision });
  };
  const talk = (actor, topic) => {
    const { context } = act(actor, "talk", { target: "greek-ajax-teucer" });
    expect(context.disclosures[0].factId).toBe(topic);
    request("speech", actor, {
      room: "greek-greek-camp",
      disclosures: context.disclosures,
      lines: [
        { actorId: actor, text: "Please read your account for Dione." },
        { actorId: "greek-ajax-teucer", text: context.disclosures[0].text },
      ],
    });
  };
  request("validate", "vale");
  act("vale", "light", { item: "lamp" });
  for (let flash = 0; flash < 2; flash++) {
    act("vale", "cover", { item: "cloth", target: "lamp" });
    act("vale", "take", { item: "cloth" });
  }
  expect(world.crossings["pond-greek-harbor"].discovered).toBe(true);
  for (const actor of HUMANS) {
    for (const target of ["greek-ship", "greek-harbor", "greek-courtyard"])
      act(actor, "move", { target });
    if (actor === "vale") {
      act(actor, "drop", { item: "lamp" });
      act(actor, "drop", { item: "cloth" });
    }
  }
  for (const [kind, fields] of [
    ["move", { target: "greek-gate" }],
    ["choose", { choiceId: "greek-hear-decree" }],
    ["choose", { choiceId: "greek-decline-burial" }],
    ["move", { target: "greek-courtyard" }],
    ["choose", { choiceId: "greek-courtyard-refusal" }],
    ["choose", { choiceId: "greek-open-door-invite-refusal" }],
  ])
    act("vale", kind, fields);
  for (const { kind, ...fields } of openDoorSteps()) act("vale", kind, fields);
  for (const [kind, fields] of [
    ["move", { target: "greek-harbor" }],
    ["choose", { choiceId: "greek-ajax-invitation" }],
    ["move", { target: "greek-ship" }],
    ["move", { target: "greek-ajax-landing" }],
    ["move", { target: "greek-greek-camp" }],
    ["take", { item: "greek-ajax-shield" }],
    ["move", { target: "greek-ajax-household" }],
    ["choose", { choiceId: "greek-ajax-deliver-shield" }],
    ["move", { target: "greek-greek-camp" }],
  ])
    act("vale", kind, fields);
  talk("vale", "greek-ajax-plea");
  for (const [kind, fields] of [
    ["take", { item: "greek-ajax-plea" }],
    ["choose", { choiceId: "greek-ajax-deliver-plea" }],
    ["choose", { choiceId: "greek-ajax-choose-public" }],
    ["take", { item: "greek-ajax-tools" }],
    ["take", { item: "greek-ajax-cloth" }],
    ["move", { target: "greek-ajax-grave" }],
    ["choose", { choiceId: "greek-ajax-prepare-grave" }],
    ["choose", { choiceId: "greek-ajax-lay-cloth" }],
    ["choose", { choiceId: "greek-ajax-bury-public" }],
    ["move", { target: "greek-greek-camp" }],
    ["take", { item: "greek-ajax-plea" }],
  ])
    act("vale", kind, fields);
  talk("vale", "greek-ajax-account-public");
  for (const target of [
    "greek-harbor",
    "greek-ship",
    "greek-ajax-landing",
    "greek-greek-camp",
  ])
    act("mara", "move", { target });
  for (const action of request("view", "mara").actions.filter(
    (a) => a.kind === "drop-quest",
  ))
    request("play", "mara", { action });
  act("vale", "give", { item: "greek-ajax-plea", target: "mara" });
  talk("mara", "greek-ajax-plea");
  talk("mara", "greek-ajax-account-public");
  const pending = structuredClone(world);
  for (const target of [
    "greek-ajax-landing",
    "greek-ship",
    "greek-harbor",
    "greek-courtyard",
  ])
    act("mara", "move", { target });
  act("mara", "choose", { choiceId: "greek-ajax-return-public" });
  return { pending, completed: world };
}

describe("released Ajax return card saves", () => {
  let saved;
  beforeAll(() => {
    saved = releasedAccounts();
  }, 120000);

  it.each(["pending", "completed"])(
    "upgrades the %s account while keeping deeds and authors",
    (state) => {
      const before = saved[state];
      expect(before.packs[GREEK].revision).toBe(7);
      expect(before.quests.records[KEY].holder).toEqual({
        kind: "avatar",
        id: "greek-ajax-teucer",
      });
      expect(before.packs[GREEK].recitals["greek-ajax-bury-public"].actor).toBe(
        "vale",
      );
      const after = decodeSave(JSON.stringify(before));
      const record = after.quests.records[KEY];
      expect(record.holder).toEqual({ kind: "item", id: "greek-ajax-plea" });
      expect(after.packs[GREEK]).toEqual({
        ...before.packs[GREEK],
        revision: 8,
        flags: { ...before.packs[GREEK].flags, "greek-camp-road-open": true },
        poemReadings: emptyPoemReadings(),
      });
      for (const [key, original] of Object.entries(before.quests.records))
        expect(after.quests.records[key]).toEqual(
          key === KEY ? { ...original, holder: record.holder } : original,
        );
      for (const [id, item] of Object.entries(before.items))
        expect(after.items[id]).toEqual(item);
      for (const field of ["log", "knowledge"])
        expect(after[field]).toEqual(before[field]);
      if (state === "pending") {
        expect(record.completedTurn).toBeNull();
        expect(questHolderActor(after, record)).toBe("mara");
        expect(questCarried(after, "mara", KEY)).toBe(true);
        expect(
          questHistoryCards(after, "mara").find((q) => q.key === KEY),
        ).toMatchObject({ completedTurn: null });
      } else {
        expect(record.completion.actorId).toBe("mara");
        expect(
          after.packs[GREEK].recitals["greek-ajax-return-public"].actor,
        ).toBe("mara");
        expect(after.items["greek-ajax-plea"].holder).toBe("greek-courtyard");
      }
      expect(decodeSave(encodeSave(after))).toEqual(after);
      const upgraded = dispatchShared({
        op: "upgrade",
        from: "full-card-world/20",
        to: "full-card-world/22",
        world: before,
        actor: "mara",
        claimed: HUMANS,
        present: HUMANS,
      });
      expect(upgraded.ok, upgraded.error).toBe(true);
      expect(upgraded.world.quests.records[KEY]).toEqual(record);
      expect(upgraded.world.packs[GREEK]).toEqual(after.packs[GREEK]);
      expect(decodeSave(encodeSave(upgraded.world))).toEqual(upgraded.world);
    },
  );
});
