import { expect, it } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { pondSignalBeat } from "../v2/card-game/pond-signal-view.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

const vale = "vale",
  rue = "rue",
  seed = 17;
const crossing = "pond-greek-harbor",
  fact = "quest:keeper:pond";
const wick = "station-lantern-wick",
  lantern = "station-lantern",
  log = "keeper-log";

function table(shared = false) {
  let world = shared
    ? dispatchShared({ op: "create", seed }).world
    : createLandingWorld(null, seed);
  const request = (actor, op, fields) =>
    dispatchShared({
      world,
      op,
      actor,
      claimed: [vale, rue],
      present: [vale, rue],
      ...fields,
    });
  const actions = (actor) =>
    shared ? request(actor, "view").actions : legalActions(world, actor);
  const find = (actor, fields) => {
    const action = actions(actor).find((candidate) =>
      Object.entries(fields).every(([key, value]) => candidate[key] === value),
    );
    expect(
      action,
      `${actor} at ${world.actors[actor].place}, turn ${world.turn}: ${JSON.stringify(fields)}`,
    ).toBeDefined();
    return action;
  };
  const act = (actor, fields, cards) => {
    const action = find(actor, fields);
    if (cards) {
      const view = shared ? request(actor, "view").world : world;
      expect(cardPlay(view, cards).action?.key, cards.join(" + ")).toBe(
        action.key,
      );
    }
    const result = shared
      ? request(actor, "play", { action })
      : play(world, action, world.revision, actor);
    expect(result.ok, result.error).toBe(true);
    world = shared ? result.world : result.state;
  };
  return {
    get world() {
      return world;
    },
    get signal() {
      return world.crossings[crossing];
    },
    actions,
    find,
    act,
    request,
    join() {
      world = request(rue, "join").world;
    },
    hold(item) {
      const choice = { item, revision: world.revision };
      if (shared) world = request(vale, "hold", { choice }).world;
      else holdChoice(world, vale, choice);
    },
    reload() {
      world = decodeSave(encodeSave(world));
    },
  };
}

const move = (t, actor, target, item = null) =>
  t.act(actor, { kind: "move", target, item });
const take = (t, actor, item) => t.act(actor, { kind: "take", item });
const drop = (t, actor, item, target) =>
  t.act(actor, { kind: "drop", item, target });
const give = (t, item) => t.act(vale, { kind: "give", item, target: "moth" });
const ask = (t, item) => t.act(vale, { kind: "ask", item, target: "moth" });
const enterPond = (t) => {
  t.hold(null);
  move(t, vale, "pond", "lamp");
};
function preparePipSignal(t) {
  enterPond(t);
  t.act(vale, { kind: "talk", target: "moth" });
  expect(t.world.knowledge.known.vale[fact]).toMatchObject({
    kind: "heard",
    teller: "moth",
  });
  t.hold("lamp");
  give(t, "lamp");
  ask(t, "cloth");
  t.act(vale, { label: "Borrow Lamp" }, ["lamp", "moth"]);
  t.hold("cloth");
  expect(t.world.items.lamp.holder).toBe(vale);
  expect(t.world.pondLampLoan).toEqual({
    borrower: vale,
    borrowedTurn: t.world.turn,
  });
  expect(t.signal.discovered).toBe(false);
}

function repairLantern(t, actor) {
  expect(knowsFact(t.world, actor, fact)).toBe(false);
  t.act(actor, { kind: "read", item: log }, [log]);
  expect(t.world.knowledge.known[actor][fact]).toMatchObject({
    kind: "read",
    book: log,
  });
  t.act(actor, { label: "Repair lantern" }, [wick, lantern]);
  expect(t.signal.discovered).toBe(false);
}

function checkReturn(t, method, consequence) {
  const receipt = t.world.actors.keeper.completedQuest;
  move(t, vale, "elysium-void-001");
  t.reload();
  move(t, vale, "pond");
  expect(t.signal).toMatchObject({ discovered: true, method });
  expect(t.world.actors.keeper.completedQuest).toEqual(receipt);
  expect(t.actions(vale)).toContainEqual(
    expect.objectContaining({ kind: "move", target: "greek-ship" }),
  );
  const beat = { turn: t.world.turn, actions: [] };
  const aftermath = pondSignalBeat(t.world, beat, () => true);
  if (consequence) {
    expect(aftermath.actions).toContainEqual(
      expect.objectContaining({ text: consequence }),
    );
  } else expect(aftermath).toBe(beat);
}

it("borrows Pip's Lamp and calls the ship by the original signal", () => {
  const t = table();
  preparePipSignal(t);
  t.reload();
  drop(t, vale, "lamp", "pond");
  expect(t.signal.method).toBe("pond-lamp");
  take(t, vale, "lamp");
  t.act(vale, { label: "Return Lamp" }, ["lamp", "moth"]);
  expect(t.world.items.lamp.holder).toBe("moth");
  expect(t.world.pondLampLoan.returnedTurn).toBe(t.world.turn);
  expect(t.world.actors.keeper.completedQuest.by).toBe(vale);
  checkReturn(t, "pond-lamp", "Pip has the Lamp back.");
});

it("uses the Keeper's log and restores the lantern after Pip leaves the Pond", () => {
  const t = table();
  enterPond(t);
  take(t, vale, wick);
  move(t, vale, "station", "lamp");
  expect(t.world.actors.moth.place).not.toBe("pond");
  drop(t, vale, "lamp", "station");
  expect(t.world.items.lamp.holder).toBe("moth");
  repairLantern(t, vale);
  t.reload();
  t.act(vale, { label: "Light lantern" }, [lantern]);
  expect(t.world.items[lantern]).toMatchObject({
    holder: "station",
    repaired: true,
    lit: true,
  });
  expect(t.world.actors.keeper.completedQuest.by).toBe(vale);
  move(t, vale, "pond");
  checkReturn(t, "station-lantern", "The station lantern called the ship.");
});

it("retains the first signal when another traveler prepared the original signal", () => {
  const t = table(true);
  t.join();
  preparePipSignal(t);
  take(t, rue, "routes");
  move(t, rue, "station");
  move(t, rue, "pond");
  take(t, rue, wick);
  move(t, rue, "station");
  repairLantern(t, rue);
  const revision = t.world.revision;
  const dropLamp = { kind: "drop", item: "lamp", target: "pond" };
  const action = t.find(vale, dropLamp);
  t.act(rue, { label: "Light lantern" }, [lantern]);
  const stale = t.request(vale, "play", { action, revision });
  expect(stale.ok).toBe(false);
  t.act(vale, dropLamp);
  expect(t.world.actors.keeper.completedQuest.by).toBe(rue);
  checkReturn(t, "station-lantern");
  expect(
    t.world.log.filter(
      (entry) => entry.verb === "want_met" && entry.ownerId === "keeper",
    ),
  ).toHaveLength(1);
});
