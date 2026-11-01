import { readFileSync } from "node:fs";
import vm from "node:vm";
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
} from "../v2/card-game/pack-registry.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { courseToward } from "../v2/card-game/pack-transport.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import {
  openDoorStart,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";
import {
  ajaxStart,
  ajaxCamp,
  ajaxShieldKeeper,
  ajaxPlea,
  ajaxGrave,
  ajaxAccount,
  ajaxJourney,
  ajaxChoice,
  ajaxMove,
  ajaxState,
} from "./helpers/greek-ajax.mjs";

const pack = packDefinition("greek-drama");
const reload = (world) => decodeSave(encodeSave(world));
const offered = (world, choice) =>
  legalActions(world).some((a) => a.choiceId === `greek-ajax-${choice}`);
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
  it("offers the lasting ship invitation after the four local endings and return", () => {
    const early = openDoorWalk(openDoorStart(), "harbor");
    expect(offered(early, "invitation")).toBe(false);
    expect(entityActive(early, "greek-ajax-landing")).toBe(false);
    expect(entityActive(early, "greek-ajax-teucer")).toBe(false);
    expect(exits(early, "greek-ship")).not.toContain("greek-ajax-landing");
    let world = ajaxMove(ajaxStart(), "greek-harbor");
    expect(offered(world, "invitation")).toBe(true);
    world = ajaxChoice(world, "invitation");
    expect(ajaxState(world).choices["greek-ajax-frame"]).toBe(
      "trojan-after-ajax",
    );
    expect(entityActive(reload(world), "greek-ajax-landing")).toBe(true);
    expect(offered(reload(world), "invitation")).toBe(false);
    expect(world.transports["greek-ship"].dock).toBeTruthy();
  });

  it.each(["public", "household", "appeal"])(
    "brings the %s burial home through the ship and source conversations",
    (route) => {
      const world = ajaxJourney(route);
      expect(world.actors.vale.place).toBe("greek-courtyard");
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
      expect(offered(world, `return-${route}`)).toBe(false);
      expect(verses(playOpenDoor(world, "wait"))).toEqual(verses(world));
    },
  );

  it("keeps the appeal open through a saved vigil, witness, and prepared grave", () => {
    let world = ajaxGrave("appeal", false);
    expect(buried(world)).toBeUndefined();
    expect(offered(world, "bury-appeal")).toBe(false);
    const before = encodeSave(world);
    world = reload(world);
    expect(encodeSave(world)).toBe(before);
    world = ajaxMove(world, "greek-greek-camp");
    world = ajaxChoice(world, "witness-appeal");
    expect(buried(world)).toBeUndefined();
    expect(ajaxState(world).flags["greek-ajax-buried"]).toBeUndefined();
    world = ajaxMove(reload(world), "greek-ajax-grave");
    expect(offered(world, "bury-appeal")).toBe(true);
    world = ajaxChoice(world, "bury-appeal");
    expect(deed(world, "bury-appeal").turn).toBe(world.turn);
    expect(verses(world).at(-1).id).toBe("greek-ajax-bury-appeal");
  });

  it("requires the actual cloth and tools when the burial is performed", () => {
    let world = ajaxGrave();
    const burial = legalActions(world).find(
      (a) => a.choiceId === "greek-ajax-bury-public",
    );
    world = playOpenDoor(world, "take", { item: "greek-ajax-cloth" });
    expect(offered(world, "bury-public")).toBe(false);
    expect(play(world, burial, world.revision).ok).toBe(false);
    expect(buried(world)).toBeUndefined();
    world = playOpenDoor(world, "drop", {
      item: "greek-ajax-cloth",
      target: "greek-ajax-grave",
    });
    world = playOpenDoor(world, "take", { item: "greek-ajax-tools" });
    expect(offered(world, "bury-public")).toBe(false);
    world = playOpenDoor(world, "drop", {
      item: "greek-ajax-tools",
      target: "greek-ajax-grave",
    });
    expect(offered(world, "bury-public")).toBe(true);
  });

  it("records the plea only after Teucer's words are published", () => {
    let world = shieldDelivered();
    const talk = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === "greek-ajax-teucer",
    );
    world = play(world, talk).state;
    const context = narrativeContext(world, talk);
    expect(context.disclosures[0].factId).toBe("greek-ajax-plea");
    expect(ajaxState(world).receipts["greek-ajax-hear-plea"]).toBeUndefined();
    expect(entityActive(world, "greek-ajax-plea")).toBe(false);
    const response = (text) => ({
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: id === "greek-ajax-teucer" ? text : "I am here.",
      })),
    });
    const missed = applyGeneratedText(
      world,
      context,
      response("The tide is turning."),
    );
    expect(ajaxState(missed).receipts["greek-ajax-hear-plea"]).toBeUndefined();
    world = applyGeneratedText(
      reload(world),
      context,
      response(context.disclosures[0].text),
    );
    expect(knowsFact(world, "vale", "greek-ajax-plea")).toBe(true);
    expect(entityActive(world, "greek-ajax-plea")).toBe(true);
    expect(ajaxState(world).receipts["greek-ajax-hear-plea"]).toBe(world.turn);
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

describe("Ajax save continuity", () => {
  it.each([17, 18, 19])(
    "adds the new cast and brings a version-%s uninvited camp visitor home",
    (version) => {
      const context = vm.createContext({});
      vm.runInContext(
        readFileSync(
          new URL(
            `../v2/orchestrator-rust/src/card_shared/engine-v${version}.js`,
            import.meta.url,
          ),
          "utf8",
        ),
        context,
      );
      const before = JSON.parse(
        context.cardShared(JSON.stringify({ op: "create" })),
      ).world;
      delete before.opening;
      before.packs["greek-drama"].scope = "full";
      before.actors.vale.place = "greek-greek-camp";
      before.items.lamp.holder = "vale";
      const after = decodeSave(JSON.stringify(before));
      expect(after.packs["greek-drama"].revision).toBe(
        packDefinition("greek-drama").revision,
      );
      // Without the Trojan invitation the ship does not call at the camp, so the
      // visitor goes back to Aulis, the way they came.
      expect(after.actors.vale.place).toBe("greek-aulis");
      expect(after.items.lamp).toEqual(before.items.lamp);
      expect(after.log).toEqual(before.log);
      expect(after.packs["greek-drama"].receipts).toEqual(
        before.packs["greek-drama"].receipts,
      );
      expect(entityActive(after, "greek-ajax-teucer")).toBe(false);
      expect(exits(after, "greek-aulis")).toContain("greek-gate");
      expect(reload(after)).toEqual(after);
    },
  );
});

describe("shared Ajax testimony", () => {
  it("lets a second carrier learn the signed account and bring its paper to Dione", () => {
    const original = ajaxAccount("public");
    let world = dispatchShared({
      op: "create",
      save: encodeSave(original),
    }).world;
    world.actors.mara.place = "greek-ajax-landing";
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
      const result = request("play", actor, { action });
      const scene = { world, actor, claimed, present: claimed, action };
      return { ...result, context: sharedContext(scene) };
    };
    act("mara", "move", { target: "greek-greek-camp" });
    act("vale", "give", { item: "greek-ajax-plea", target: "mara" });
    expect(knowsFact(world, "mara", "greek-ajax-account-public")).toBe(false);
    const receipt = ajaxState(world).receipts["greek-ajax-record-public"];
    for (const topic of ["greek-ajax-plea", "greek-ajax-account-public"]) {
      const { context } = act("mara", "talk", { target: "greek-ajax-teucer" });
      expect(context.disclosures[0].factId).toBe(topic);
      request("speech", "mara", {
        room: "greek-greek-camp",
        disclosures: context.disclosures,
        lines: [
          { actorId: "mara", text: "Tell me your account for Dione." },
          { actorId: "greek-ajax-teucer", text: context.disclosures[0].text },
        ],
      });
    }
    expect(knowsFact(world, "mara", "greek-ajax-account-public")).toBe(true);
    expect(ajaxState(world).receipts["greek-ajax-record-public"]).toBe(receipt);
    for (const target of [
      "greek-ajax-landing",
      "greek-ship",
      "greek-harbor",
      "greek-road-thebes",
      "greek-courtyard",
    ]) {
      if (target === "greek-ship") {
        for (
          let i = 0;
          i < 32 &&
          !request("view", "mara").actions.some(
            (a) => a.kind === "move" && a.target === target,
          );
          i++
        )
          act("mara", "wait");
      }
      // Home from the landing: by Marathon Bay and Piraeus, one lane at a
      // time, each a course card and a round at sea.
      for (
        let i = 0;
        i < 24 &&
        target === "greek-harbor" &&
        !request("view", "mara").actions.some(
          (a) => a.kind === "move" && a.target === target,
        );
        i++
      ) {
        const lane = courseToward(world, "greek-ship", target, "mara");
        const course = request("view", "mara").actions.some(
          (a) => a.kind === "course" && a.target === lane,
        );
        if (course) act("mara", "course", { target: lane });
        else act("mara", "wait");
      }
      act("mara", "move", { target });
    }
    act("mara", "choose", { choiceId: "greek-ajax-return-public" });
    expect(world.items["greek-ajax-plea"].holder).toBe("greek-courtyard");
    expect(ajaxState(world).receipts["greek-ajax-return-public"]).toBe(
      world.turn,
    );
    expect(reload(world).knowledge).toEqual(world.knowledge);
  });
});
