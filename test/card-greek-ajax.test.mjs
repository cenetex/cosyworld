import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
  packWaitChoice,
} from "../v2/card-game/pack-registry.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { greekStart, playGreek as playOpenDoor } from "./helpers/open-door.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { learnLane } from "../v2/card-game/pack-transport.mjs";
import {
  ajaxStart,
  ajaxCamp,
  ajaxShieldKeeper,
  ajaxPlea,
  ajaxGrave,
  ajaxAccount,
  ajaxBuried,
  ajaxJourney,
  ajaxChoice,
  ajaxTalk,
  ajaxMove,
  ajaxState,
} from "./helpers/greek-ajax.mjs";

const pack = packDefinition("greek-drama");
const reload = (world) => decodeSave(encodeSave(world));
const graveRite = (world) => packWaitChoice(world, "vale")?.choiceId;
// A deed is a committed pack choice: its receipt turn and its actor.
const deed = (world, choice) => ({
  turn: ajaxState(world).receipts[`greek-ajax-${choice}`],
  actorId: world.log.find((e) => e.choiceId === `greek-ajax-${choice}`)
    ?.actorId,
});
const buried = (world) => ajaxState(world).flags["greek-ajax-buried"];
const verses = (world) =>
  recitalPoem(world, pack).stanzas.filter((v) =>
    v.id.startsWith("greek-ajax-"),
  );

function shieldDelivered() {
  let world = ajaxShieldKeeper(ajaxCamp());
  world = playOpenDoor(world, "take", { item: "greek-ajax-shield" });
  world = ajaxMove(world, "greek-ajax-household");
  return ajaxMove(ajaxChoice(world, "deliver-shield"), "greek-greek-camp");
}

describe("Earth Beside the Ships", () => {
  it.each([
    ["opening", greekStart],
    ["full", ajaxStart],
  ])(
    "opens the landing with a lasting ship invitation in %s scope",
    (scope, start) => {
      const harbor = ajaxMove(start(), "greek-harbor");
      expect(ajaxState(harbor).scope).toBe(scope);
      expect(
        ajaxState(harbor).receipts["greek-ajax-invitation"],
      ).toBeUndefined();
      expect(entityActive(harbor, "greek-ajax-landing")).toBe(false);
      expect(entityActive(harbor, "greek-ajax-teucer")).toBe(false);
      expect(exits(harbor, "greek-ship")).not.toContain("greek-ajax-landing");
      expect(exits(harbor, "greek-scylla")).not.toContain("greek-ajax-landing");
      expect(legalActions(harbor).filter((a) => a.kind === "choose")).toEqual(
        [],
      );
      const world = ajaxChoice(harbor, "invitation");
      expect(ajaxState(world).choices["greek-ajax-frame"]).toBe(
        "trojan-after-ajax",
      );
      expect(entityActive(reload(world), "greek-ajax-landing")).toBe(true);
      expect(exits(world, "greek-harbor")).not.toContain("greek-road-north");
      expect(exits(world, "greek-ship")).not.toContain("greek-ajax-landing");
      expect(exits(world, "greek-scylla")).toContain("greek-ajax-landing");
      const talkedAgain = playOpenDoor(world, "talk", {
        target: "greek-shipmaster",
      });
      expect(ajaxState(talkedAgain).receipts["greek-ajax-invitation"]).toBe(
        world.turn,
      );
      expect(world.transports["greek-scylla"].dock).toBe("greek-pagasae");
    },
  );
  it.each(["public", "household", "appeal"])(
    "brings the %s burial home through the ship and source conversations",
    (route) => {
      const world = ajaxJourney(route);
      expect(world.actors.vale.place).toBe("greek-courtyard");
      expect(world.transports["greek-scylla"].dock).toBe("greek-pagasae");
      expect(ajaxState(world).flags).toMatchObject({
        "greek-ajax-open": true,
        "greek-ajax-buried": true,
        "greek-ajax-returned": true,
      });
      expect(ajaxState(world).choices).toMatchObject({
        "greek-ajax-route": route,
        "greek-ajax-ending": route,
        "greek-ajax-return": route,
      });
      for (const [item, holder] of Object.entries({
        shield: "greek-ajax-household",
        cloth: "greek-ajax-grave",
        tools: "greek-ajax-grave",
        plea: "greek-courtyard",
      }))
        expect(world.items[`greek-ajax-${item}`].holder).toBe(holder);
      for (const choice of [
        "deliver-shield",
        "deliver-plea",
        `bury-${route}`,
        `return-${route}`,
      ])
        expect(Number.isSafeInteger(deed(world, choice).turn)).toBe(true);
      expect(knowsFact(world, "vale", "greek-ajax-plea")).toBe(true);
      expect(knowsFact(world, "vale", `greek-ajax-account-${route}`)).toBe(
        true,
      );
      expect(verses(world).map((v) => v.id)).toEqual([
        "greek-ajax-deliver-shield",
        "greek-ajax-deliver-plea",
        `greek-ajax-bury-${route}`,
        `greek-ajax-return-${route}`,
      ]);
      expect(reload(world)).toEqual(world);
      expect(legalActions(world).filter((a) => a.kind === "choose")).toEqual(
        [],
      );
      expect(verses(playOpenDoor(world, "wait"))).toEqual(verses(world));
    },
  );
  it("lets Tecmessa welcome the traveler after the household burial", () => {
    const home = ajaxMove(ajaxBuried("household"), "greek-ajax-household");
    const welcomed = ajaxChoice(home, "household-receives-traveler");
    expect(welcomed.actors["greek-ajax-tecmessa"].trust.vale).toBe(2);
    expect(welcomed.items["greek-ajax-tecmessa-water"]).toBeUndefined();
    expect(reload(welcomed)).toEqual(welcomed);
  });

  it("keeps the appeal open through a saved vigil, witness, and prepared grave", () => {
    let world = ajaxGrave("appeal", false);
    expect(buried(world)).toBeUndefined();
    expect(graveRite(world)).toBeUndefined();
    const before = encodeSave(world);
    world = reload(world);
    expect(encodeSave(world)).toBe(before);
    world = ajaxMove(world, "greek-greek-camp");
    world = ajaxChoice(world, "witness-appeal");
    expect(buried(world)).toBeUndefined();
    expect(ajaxState(world).flags["greek-ajax-buried"]).toBeUndefined();
    world = ajaxMove(reload(world), "greek-ajax-grave");
    expect(graveRite(world)).toBe("greek-ajax-bury-appeal");
    world = ajaxChoice(world, "bury-appeal");
    expect(deed(world, "bury-appeal").turn).toBe(world.turn);
    expect(verses(world).at(-1).id).toBe("greek-ajax-bury-appeal");
  });

  it("commits each of the seven testimony and record choices after its speaker's line", () => {
    const talkIds = [
      "learn-shield-teucer",
      "learn-shield-odysseus",
      "learn-shield-tecmessa",
      "hear-plea",
      "record-public",
      "record-household",
      "record-appeal",
    ].map((id) => `greek-ajax-${id}`);
    for (const id of talkIds)
      expect(pack.choices.find((c) => c.id === id).on).toBe("talk");
    expect(
      pack.choices.filter(
        (c) => c.workId === "sophocles-ajax" && !c.archived && c.on === undefined,
      ),
    ).toEqual([]);
    const chooses = (w) => legalActions(w).filter((a) => a.kind === "choose");
    const talkTo = (world, target, topic) => {
      expect(chooses(world)).toEqual([]);
      const next = ajaxTalk(world, `greek-ajax-${topic}`, { target });
      expect(chooses(next)).toEqual([]);
      return next;
    };
    const camp = ajaxCamp();
    for (const [speaker, place] of [
      ["teucer", "greek-greek-camp"],
      ["odysseus", "greek-greek-camp"],
      ["tecmessa", "greek-ajax-household"],
    ]) {
      const world = talkTo(
        ajaxMove(camp, place),
        `greek-ajax-${speaker}`,
        `shield-${speaker}`,
      );
      expect(
        ajaxState(world).receipts[`greek-ajax-learn-shield-${speaker}`],
      ).toBe(world.turn);
      expect(ajaxState(world).flags["greek-ajax-shield-keeper-heard"]).toBe(
        true,
      );
    }
    // Teucer's Talk commits the plea, then the signed record for each route.
    let world = ajaxMove(shieldDelivered(), "greek-greek-camp");
    world = talkTo(world, "greek-ajax-teucer", "plea");
    expect(ajaxState(world).receipts["greek-ajax-hear-plea"]).toBe(world.turn);
    expect(ajaxState(world).flags["greek-ajax-plea-heard"]).toBe(true);
    for (const route of ["public", "household", "appeal"]) {
      let signed = ajaxMove(ajaxBuried(route), "greek-greek-camp");
      if (signed.items["greek-ajax-plea"].holder !== "vale")
        signed = playOpenDoor(signed, "take", { item: "greek-ajax-plea" });
      signed = talkTo(signed, "greek-ajax-teucer", `account-${route}`);
      expect(ajaxState(signed).receipts[`greek-ajax-record-${route}`]).toBe(
        signed.turn,
      );
      expect(ajaxState(signed).flags["greek-ajax-account-ready"]).toBe(true);
    }
  });
  it("requires the actual cloth and tools when the burial is performed", () => {
    let world = ajaxGrave();
    world = playOpenDoor(world, "take", { item: "greek-ajax-cloth" });
    expect(graveRite(world)).toBeUndefined();
    world = playOpenDoor(world, "wait");
    expect(buried(world)).toBeUndefined();
    world = playOpenDoor(world, "drop", {
      item: "greek-ajax-cloth",
      target: "greek-ajax-grave",
    });
    world = playOpenDoor(world, "take", { item: "greek-ajax-tools" });
    expect(graveRite(world)).toBeUndefined();
    world = playOpenDoor(world, "drop", {
      item: "greek-ajax-tools",
      target: "greek-ajax-grave",
    });
    expect(graveRite(world)).toBe("greek-ajax-bury-public");
  });
  it("records the exact plea on Talk before any optional narration", () => {
    let world = shieldDelivered();
    const topic = pack.topics.find(({ id }) => id === "greek-ajax-plea");
    expect(entityActive(world, "greek-ajax-plea")).toBe(false);
    const talk = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === "greek-ajax-teucer",
    );
    world = play(world, talk).state;
    const line = world.log.findLast((e) => e.disclosedFactId === topic.id);
    expect(line).toMatchObject({
      text: topic.text,
      actorId: topic.speaker,
      targetId: "vale",
      locationId: topic.at,
      witnesses: [topic.speaker, "vale"],
    });
    expect(line.generated).toBeUndefined();
    expect(world.log.find(({ seq }) => seq === line.sourceSeq)).toMatchObject({
      verb: "talk", actorId: "vale", targetId: topic.speaker,
    });
    expect(world.knowledge.known.vale[topic.id]).toMatchObject({
      kind: "heard", teller: topic.speaker, eventSeq: line.sourceSeq,
    });
    expect(entityActive(world, "greek-ajax-plea")).toBe(true);
    expect(reload(world).packs[pack.id].receipts[topic.choiceId]).toBe(world.turn);

    const context = narrativeContext(world, talk);
    expect(context.disclosures?.some(({ factId }) => factId === topic.id)).toBeFalsy();
    expect(context.outcome.card).toMatchObject({
      kind: "talk",
      target: "greek-ajax-teucer",
    });
    const response = {
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: id === topic.speaker ? "The tide is turning." : "I am here.",
      })),
    };
    const narrated = applyGeneratedText(world, context, response);
    expect(knowsFact(narrated, "vale", topic.id)).toBe(true);
    expect(narrated.knowledge).toEqual(world.knowledge);
    expect(ajaxState(narrated).receipts[topic.choiceId]).toBe(world.turn);
    expect(knowsFact(narrated, "vale", "greek-ajax-plea")).toBe(true);
    expect(entityActive(narrated, "greek-ajax-plea")).toBe(true);
  });
  it("uses local paths inside the camp and a ship stop between its shores", () => {
    const world = ajaxPlea();
    for (const id of [
      "greek-ajax-landing",
      "greek-ajax-household",
      "greek-ajax-grave",
    ])
      expect(exits(world, "greek-greek-camp")).toContain(id);
    expect(exits(world, "greek-ajax-landing")).toContain("greek-greek-camp");
    expect(pack.places["greek-ajax-household"].name).toContain("Household");
  });
});

describe("shared Ajax testimony", () => {
  it("lets a second carrier learn the signed account and bring its paper to Dione", () => {
    const original = ajaxAccount("public");
    let world = dispatchShared({
      op: "create",
      save: encodeSave(original),
    }).world;
    world.actors.mara.place = "greek-ajax-landing";
    // Mara sailed in before the fixture starts; her port chart reflects that trip.
    learnLane(world, "mara", "greek-pagasae", "greek-lemnos");
    const claimed = ["vale", "mara"];
    const request = (op, actor, fields = {}) => {
      const result = dispatchShared({
        op,
        world,
        actor,
        claimed,
        present: claimed,
        ...fields,
      });
      expect(result.ok, result.error).toBe(true);
      world = result.world;
      return result;
    };
    const act = (actor, kind, fields = {}) => {
      const action = request("view", actor).actions.find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeTruthy();
      return request("play", actor, { action });
    };
    act("mara", "move", { target: "greek-greek-camp" });
    act("vale", "give", { item: "greek-ajax-plea", target: "mara" });
    expect(knowsFact(world, "mara", "greek-ajax-account-public")).toBe(false);
    const receipt = ajaxState(world).receipts["greek-ajax-record-public"];
    // The signed record survives loss of the facts from the shared cache.
    delete world.knowledge.facts["greek-ajax-account-public"];
    for (const known of Object.values(world.knowledge.known))
      delete known["greek-ajax-account-public"];
    for (const topic of ["greek-ajax-plea", "greek-ajax-account-public"]) {
      const { events } = act("mara", "talk", { target: "greek-ajax-teucer" });
      const line = events.find((e) => e.disclosedFactId);
      expect(line).toMatchObject({
        actorId: "greek-ajax-teucer",
        targetId: "mara",
        witnesses: ["greek-ajax-teucer", "mara"],
        disclosedFactId: topic,
      });
      expect(line.generated).toBeUndefined();
    }
    expect(knowsFact(world, "mara", "greek-ajax-account-public")).toBe(true);
    expect(ajaxState(world).receipts["greek-ajax-record-public"]).toBe(receipt);
    act("mara", "move", { target: "greek-ajax-landing" });
    act("mara", "move", { target: "greek-scylla" });
    for (const target of ["greek-lemnos", "greek-pagasae"]) {
      act("mara", "course", { target });
      act("mara", "wait");
    }
    act("mara", "move", { target: "greek-pagasae" });
    for (const target of greekTravelTargets("greek-pagasae", "greek-courtyard"))
      act("mara", "move", { target });
    act("mara", "give", { item: "greek-ajax-plea", target: "greek-baker" });
    expect(world.items["greek-ajax-plea"].holder).toBe("greek-courtyard");
    expect(ajaxState(world).receipts["greek-ajax-return-public"]).toBe(
      world.turn,
    );
    expect(reload(world).knowledge).toEqual(world.knowledge);
  });
});
