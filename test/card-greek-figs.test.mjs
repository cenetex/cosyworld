import { describe, expect, it } from "vitest";
import { entityActive, itemCopies } from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { greekStart, seaRoad, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const FIGS = "greek-figs";
const FORMER = "greek-io-trail-figs";
const SUPPLY = `${FORMER}-supply`;
const SANCTUARY = "greek-sanctuary";
const PALACE = "greek-palace";
const CRAG = "greek-scythian-crag";
const PROMETHEUS = "greek-story-aeschylus-prometheus-bound";
const PROVISIONS = "greek-provisions";
const seats = ["vale", "mara"];

function arrive(world, actor, place) {
  const traveler = world.actors[actor];
  traveler.place = place;
  if (!traveler.visited.includes(place)) traveler.visited.push(place);
}

function beforeDawn(world) {
  const cycle = 2 * DAYLIGHT_TURNS;
  world.turn = (Math.floor(world.turn / cycle) + 1) * cycle - 1;
  world.revision = Math.max(world.revision, world.turn);
  return world;
}

function shared(world, actor, op, fields = {}) {
  return dispatchShared({
    world,
    op,
    actor,
    claimed: seats,
    present: seats,
    ...fields,
  });
}

const actionFor = (world, actor, kind, fields) =>
  shared(world, actor, "view").actions.find(
    (action) =>
      action.kind === kind &&
      Object.entries(fields).every(([key, value]) => action[key] === value),
  );

function play(world, actor, kind, fields) {
  const action = actionFor(world, actor, kind, fields);
  expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeDefined();
  const result = shared(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return result.world;
}

const claim = (world, actor) =>
  actionFor(world, actor, "choose", { choiceId: SUPPLY });

const followIo = (t) =>
  t
    .talk(`${PROMETHEUS}-first`)
    .act("choose", { choiceId: `${PROMETHEUS}-first-answer` });

describe("Greek Dried Figs", () => {
  it.each([false, true])(
    "keeps one stock across two seats with full scope = %s",
    (full) => {
      const local = traveler(greekStart({ full })).move(
        "well",
        "palace",
        SANCTUARY,
      );
      expect(local.s.items[FIGS].holder).toBe(SANCTUARY);
      expect(itemCopies(FIGS)).toEqual([FIGS]);
      let world = dispatchShared({
        op: "create",
        save: encodeSave(local.take(FIGS).s),
      }).world;
      expect(world.packs[PACK].scope).toBe(full ? "full" : "opening");
      arrive(world, "mara", CRAG);

      expect(claim(world, "mara")).toBeUndefined();
      world = play(world, "mara", "talk", { target: `${PROMETHEUS}-first` });
      world = play(world, "mara", "choose", {
        choiceId: `${PROMETHEUS}-first-answer`,
      });
      expect(world.packs[PACK].choices[`${PROMETHEUS}-outcome`]).toBe("first");
      expect(claim(world, "mara")).toBeUndefined();

      world = play(world, "vale", "move", { target: PALACE });
      world = play(world, "vale", "drop", { item: FIGS, target: PALACE });
      expect(claim(world, "mara")).toBeUndefined();
      world = play(beforeDawn(world), "mara", "wait", {
        sleep: undefined,
        guards: undefined,
      });
      expect(world.items[FIGS].holder).toBe(PALACE);
      world = play(world, "vale", "take", { item: FIGS });
      world = play(world, "vale", "eat", { item: FIGS, target: null });
      expect(world.usedUp).toContain(FIGS);
      expect(world.items[FIGS].holder).toBe(SANCTUARY);

      arrive(world, "vale", CRAG);
      const valeClaim = claim(world, "vale"),
        maraClaim = claim(world, "mara");
      expect(valeClaim?.label).toBe("Set out Dried Figs");
      expect(maraClaim?.label).toBe("Set out Dried Figs");
      const claimed = shared(world, "mara", "play", { action: maraClaim });
      expect(claimed.ok, claimed.error).toBe(true);
      expect(claimed.world.items[FIGS].holder).toBe(CRAG);
      expect(claimed.world.usedUp).not.toContain(FIGS);
      const stale = shared(claimed.world, "vale", "play", {
        action: valeClaim,
        revision: world.revision,
      });
      expect(stale.ok).toBe(false);
      expect(stale.error).toMatch(/world changed/i);
      expect(stale.world.items[FIGS]).toEqual(claimed.world.items[FIGS]);
      expect(claim(claimed.world, "vale")).toBeUndefined();

      world = play(claimed.world, "mara", "take", { item: FIGS });
      world = play(world, "mara", "eat", { item: FIGS, target: null });
      expect(world.usedUp).toContain(FIGS);
      expect(claim(world, "mara")).toBeUndefined();
      expect(decodeSave(encodeSave(world)).packs[PACK].receipts[SUPPLY]).toBe(
        claimed.world.turn,
      );
    },
  );

  it("uses the Sanctuary Figs to pack Myrto’s provisions and renews them at dawn", () => {
    const t = seaRoad(traveler(greekStart()));
    const craft = t.s.log.findLast(({ verb }) => verb === "craft");
    expect(craft).toMatchObject({
      itemId: PROVISIONS,
      consumedIds: ["greek-bread", FIGS, "greek-wine-skin"],
    });
    expect(t.s.actors.vale.place).toBe("greek-piraeus");
    expect(t.s.usedUp).toContain(FIGS);
    expect(t.s.usedUp).not.toContain("greek-wine-skin");
    expect(entityActive(decodeSave(encodeSave(t.s)), FIGS)).toBe(false);
    const atCrag = t.fork();
    arrive(atCrag.s, "vale", CRAG);
    expect(legalActions(atCrag.s).some((a) => a.choiceId === SUPPLY)).toBe(
      false,
    );
    followIo(atCrag).act("choose", { choiceId: SUPPLY });
    expect(atCrag.s.items[FIGS].holder).toBe(CRAG);
    expect(atCrag.s.usedUp).not.toContain(FIGS);
    beforeDawn(t.s);
    t.act("wait");
    expect(entityActive(t.s, FIGS)).toBe(true);
    expect(t.s.items[FIGS].holder).toBe(SANCTUARY);
  });

  it("upgrades a revision 41 Crag stock without taking live Sanctuary Figs", () => {
    const t = traveler(greekStart());
    arrive(t.s, "vale", CRAG);
    followIo(t);
    const old = structuredClone(t.s);
    old.packs[PACK].revision = 41;
    old.items[FORMER] = { holder: "vale", history: [] };
    old.actors.vale.heldItem = FORMER;

    const live = decodeSave(JSON.stringify(old));
    expect(live.items[FIGS]).toEqual(old.items[FIGS]);
    expect(live.items[FORMER]).toBeUndefined();
    expect(live.actors.vale.heldItem).not.toBe(FIGS);

    old.usedUp.push(FIGS);
    const promoted = decodeSave(JSON.stringify(old));
    expect(promoted.items[FIGS].holder).toBe("vale");
    expect(promoted.items[FORMER]).toBeUndefined();
    expect(promoted.actors.vale.heldItem).toBe(FIGS);
    expect(promoted.usedUp).not.toContain(FIGS);
    expect(decodeSave(encodeSave(promoted)).items[FIGS]).toEqual(
      promoted.items[FIGS],
    );
  });
});
