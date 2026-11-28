import "./helpers/no-dwell.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWorld as baseCreateWorld,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  actorCanVisit,
  entityActive,
  isPackActor,
  neverBack,
  packDefinitions,
  packThings,
} from "../v2/card-game/pack-registry.mjs";
import { usedUp } from "../v2/card-game/item-use.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { revealed } from "../v2/card-game/want-talk.mjs";
import {
  heldOf,
  holdQuest,
  levelFor,
  installWants,
  newWant,
  travels,
} from "../v2/card-game/want.mjs";
import { act, reload } from "./helpers/play.mjs";

const createWorld = (...args) => questing(baseCreateWorld(...args));
const COTTAGE = "forest-cottage";
const BUTTON = "forest-button-vale";
function atRati() {
  const world = enableMotives(createWorld());
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "vale";
  world.items.lamp.holder = "attic";
  world.items.lamp.lit = true;
  world.items.lamp.fuel = 12;
  return act(world, { kind: "move", target: COTTAGE });
}
function holdingButton(world = atRati()) {
  world.actors.vale.place = world.items[BUTTON].holder;
  world = act(world, { kind: "take", item: BUTTON });
  world.actors.vale.place = COTTAGE;
  return world;
}
const sew = (world) => act(world, { kind: "give", item: BUTTON, target: "rati" });
const keptHome = (world, at = null) =>
  Object.keys(world.actors)
    .sort()
    .find(
      (id) =>
        id !== "rati" &&
        isPackActor(id) &&
        !travels(id, world) &&
        entityActive(world, id) &&
        (!at || actorCanVisit(id, at, world)),
    );
const unseen = (world, id, text) => {
  const context = narrativeContext(world);
  return (
    !context.events.includes(text) &&
    !JSON.stringify(context.entities.filter((e) => e.id !== id)).includes(text)
  );
};
const losses = (world, id) =>
  world.log.filter((e) => e.consequence && e.actorId === id);

describe("a want on a thing that can never come back", () => {
  it("counts RATi's button as met when she sews it", () => {
    let world = holdingButton();
    expect(world.actors.rati.want).toMatchObject({
      kind: "item",
      target: BUTTON,
    });
    const xp = world.actors.rati.xp,
      trust = world.actors.rati.trust.vale;
    world = sew(world);
    expect(neverBack(world, BUTTON)).toBe(true);
    expect(world.actors.rati.want?.target).not.toBe(BUTTON);
    expect(
      world.log.some(
        (e) =>
          e.verb === "want_met" &&
          e.actorId === "rati" &&
          e.wantMet.target === BUTTON,
      ),
    ).toBe(true);
    expect(levelFor(world.actors.rati.xp)).toBe(levelFor(xp) + 1);
    expect(world.actors.rati.trust.vale).toBeGreaterThanOrEqual(trust);
    expect(losses(world, "rati")).toEqual([]);
    validateWorld(reload(world));
  });

  it("ends a kept-home resident's want and remembers who lost it", () => {
    let world = holdingButton();
    const id = keptHome(world, COTTAGE);
    world.actors[id].place = COTTAGE;
    world.actors[id].want = newWant("item", BUTTON, world.turn);
    world.actors[id].trust.vale = 2;
    world.actors[id].lastTalk = world.turn + 1;
    world = sew(world);
    expect(world.actors[id].want?.target).not.toBe(BUTTON);
    expect(world.actors[id].trust.vale).toBe(1);
    const [loss] = losses(world, id);
    expect(loss).toMatchObject({ entityId: BUTTON, witnesses: [id] });
    expect(loss.text).toContain("Vale lost it");
    expect(unseen(world, id, loss.text)).toBe(true);
    expect(knowsFact(world, id, `event:${loss.seq}`)).toBe(true);
    expect(knowsFact(world, "vale", `event:${loss.seq}`)).toBe(false);
    validateWorld(reload(world));
    world.actors.vale.place = world.actors[id].place;
    world = act(world, { kind: "talk", target: id });
    expect(JSON.stringify(narrativeContext(world))).toContain(loss.text);
  });

  it("ends the want without blame when the resident did not see it", () => {
    let world = holdingButton();
    const id = keptHome(world);
    expect(world.actors[id].place).not.toBe(COTTAGE);
    world.actors[id].want = newWant("item", BUTTON, world.turn);
    world.actors[id].trust.vale = 2;
    world = sew(world);
    expect(world.actors[id].want?.target).not.toBe(BUTTON);
    expect(world.actors[id].trust.vale).toBe(2);
    const [loss] = losses(world, id);
    expect(loss.text).toContain("gone for good");
  });

  it("lets a buried quest on the lost thing leave quietly", () => {
    let world = holdingButton();
    const buried = {
      ...newWant("item", BUTTON, world.turn),
      story: true,
      step: { verb: "bring", at: "attic" },
    };
    holdQuest(world, "vale", buried, "quest:box:lost-test");
    holdQuest(
      world,
      "vale",
      newWant("place", "forest-garden", world.turn),
      "quest:box:top-test",
    );
    validateWorld(world);
    const xp = world.actors.vale.xp;
    expect(world.actors.vale.under.some((w) => w.target === BUTTON)).toBe(
      true,
    );
    world = sew(world);
    expect(heldOf(world.actors.vale).some((w) => w.target === BUTTON)).toBe(
      false,
    );
    expect(world.actors.vale.want.from).toBe("quest:box:top-test");
    expect(world.actors.vale.xp).toBe(xp);
    expect(world.actors.vale.closed?.["quest:box:lost-test"]).toBeUndefined();
    validateWorld(reload(world));
  });

  describe("a made thing whose maker is gone for good", () => {
    const leaving = packDefinitions
      .flatMap((pack) => pack.choices || [])
      .find((c) => c.on === "depart");
    const makers = Object.fromEntries(
      Object.keys(packThings)
        .filter((id) => packThings[id].locked)
        .map((id) => [id, packThings[id].locked]),
    );
    afterEach(() => {
      for (const [id, locked] of Object.entries(makers))
        packThings[id].locked = locked;
    });

    it("is no longer offered and the want on it ends", () => {
      let world = enableMotives(createWorld());
      const id = Object.keys(world.actors)
        .sort()
        .find(
          (id) =>
            entityActive(world, id) &&
            Object.hasOwn(makers, world.actors[id].want?.target ?? ""),
        );
      expect(id).toBeTruthy();
      const made = world.actors[id].want.target;
      packThings[made].locked = { ...makers[made], by: leaving.subject };
      expect(usedUp(world, made)).toBe(true);
      expect(revealed(world, id, world.actors[id].want, "vale")).toBe(true);
      world = act(world, "wait");
      const pack = packDefinitions.find((p) =>
        p.choices?.includes(leaving),
      ).id;
      for (const e of leaving.effects)
        if (e.kind === "set_flag") world.packs[pack].flags[e.key] = e.value;
      world.packs[pack].receipts[leaving.id] = world.turn;
      for (const item of Object.values(world.items))
        if (item.holder === leaving.subject)
          item.holder = world.actors[leaving.subject].place;
      validateWorld(world);
      expect(neverBack(world, leaving.subject)).toBe(true);
      expect(neverBack(world, made)).toBe(true);
      expect(revealed(world, id, world.actors[id].want, "vale")).toBe(false);
      const fresh = structuredClone(world);
      delete fresh.actors[id].want;
      installWants(fresh);
      expect(fresh.actors[id].want?.target).not.toBe(made);
      world.actors.vale.place = world.actors[id].place;
      world = act(world, "wait");
      expect(world.actors[id].want?.target).not.toBe(made);
      const [loss] = losses(world, id);
      expect(loss).toMatchObject({ entityId: made });
      expect(loss.text).toContain("gone for good");
      expect(unseen(world, id, loss.text)).toBe(true);
      validateWorld(reload(world));
      world = act(world, { kind: "talk", target: id });
      expect(JSON.stringify(narrativeContext(world))).toContain(loss.text);
    });
  });
});
