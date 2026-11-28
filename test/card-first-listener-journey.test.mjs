import { expect, it } from "vitest";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import {
  arcanaLevel,
  listenerDeal,
  listenerOffer,
  recordOf,
} from "../v2/card-game/world/arcana.mjs";
import { firstFoolProgress } from "../v2/card-game/world/arcana-record.mjs";
import {
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  placeText,
  play,
} from "../v2/card-game/world.mjs";

const VALE = "vale";
const FOOL = "arcanum-0";
const context = { actor: VALE, claimed: [VALE], present: [VALE] };

function travelTable(shared) {
  let world = shared
    ? dispatchShared({ op: "create", seed: 1 }).world
    : createLandingWorld(null, 1);
  const request = (op, fields) =>
    dispatchShared({ world, op, ...context, ...fields });
  const actions = () =>
    shared ? request("view").actions : legalActions(world, VALE);
  const act = (kind, fields) => {
    const action = actions().find(
      (candidate) =>
        candidate.kind === kind &&
        Object.entries(fields).every(
          ([key, value]) => candidate[key] === value,
        ),
    );
    expect(
      action,
      `${world.actors.vale.place} turn ${world.turn}: ${kind} ${JSON.stringify(fields)}`,
    ).toBeDefined();
    const result = shared
      ? request("play", { action })
      : play(world, action, world.revision, VALE);
    expect(result.ok, result.error).toBe(true);
    world = shared ? result.world : result.state;
  };
  return {
    get world() {
      return world;
    },
    actions,
    act,
    move: (target) => act("move", { target, item: null }),
    take: (item) => act("take", { item }),
    talk: (target) => act("talk", { target }),
    drop: (item, target) => act("drop", { item, target }),
    hold(item) {
      const choice = { item, revision: world.revision };
      if (shared) world = request("hold", { choice }).world;
      else holdChoice(world, VALE, choice);
    },
    reload() {
      world = decodeSave(encodeSave(world));
    },
  };
}

it.each(["solo", "shared"])(
  "earns the first Listener reading from a fresh %s attic",
  (mode) => {
    const table = travelTable(mode === "shared");
    const { actions, act, move, take, talk, drop, hold, reload } = table;
    const progress = () => firstFoolProgress(table.world, VALE);
    const record = () => recordOf(table.world, VALE);
    const mayCollect = () =>
      actions().some((action) => action.label === "Collect");

    expect(table.world.actors.vale.place).toBe("attic");
    expect(progress()).toEqual({ count: 0, target: 3, phase: "help" });
    hold(null);
    act("move", { item: "lamp", target: "pond" });
    talk("moth");
    hold("lamp");
    act("give", { item: "lamp", target: "moth" });
    expect(record().callers).toEqual(["moth"]);
    expect(progress()).toEqual({ count: 1, target: 3, phase: "help" });

    const wayfinder = "elysium-wayfinder";
    const { holder } = table.world.items[wayfinder];
    if (holder === "behind-station") move("station");
    if (holder !== table.world.actors.vale.place) move(holder);
    take(wayfinder);
    while (table.world.turn < DAYLIGHT_TURNS) act("wait", { label: undefined });
    hold(wayfinder);
    move("elysium-void-001");
    talk("elysium-resident");
    move("elysium-keystone-ledge");
    take("elysium-keystone");
    move("elysium-void-001");
    drop("elysium-keystone", "elysium-void-001");
    reload();
    expect(record().callers).toEqual(["elysium-resident", "moth"]);
    expect(progress()).toEqual({ count: 2, target: 3, phase: "help" });

    drop(wayfinder, "elysium-void-001");
    move("elysium-void-002");
    move("station");
    take("ratiradio-red-beanie");
    move("pond");
    take("ratiradio-station-key");
    move("station");
    move("behind-station");
    move("ratiradio-staff-kitchen");
    expect(placeText(table.world, "ratiradio-staff-kitchen")).toMatch(/Leave the Station Key inside/u);
    act("read", { item: "ratiradio-station-key" });
    expect(knowsFact(table.world, VALE, "claim:ratiradio:ratiradio-station-key:leave-key-inside")).toBe(true);
    drop("ratiradio-station-key", "ratiradio-staff-kitchen");
    move("behind-station");
    move("station");
    take("bell");
    move("pond");
    act("ring", { item: "bell" });
    act("ring", { item: "bell" });
    move("clearing");
    take("ratiradio-thermos");
    act("ring", { item: "bell" });
    move("pond");
    move("station");
    move("behind-station");
    move("ratiradio-staff-kitchen");
    move("ratiradio-dispatch-window");
    drop("ratiradio-thermos", "ratiradio-dispatch-window");
    move("ratiradio-listening-room");
    talk("ratiradio-rati");
    drop("ratiradio-red-beanie", "ratiradio-listening-room");
    expect(record().callers).toEqual([
      "elysium-resident",
      "moth",
      "ratiradio-rati",
    ]);
    expect(progress()).toEqual({ count: 3, target: 3, phase: "called" });

    move("ratiradio-dispatch-window");
    move("ratiradio-staff-kitchen");
    move("behind-station");
    move("station");
    move("pond");
    expect(mayCollect()).toBe(false);
    expect(listenerOffer(table.world, VALE)).toBeFalsy();
    talk("listener");
    expect(listenerDeal(table.world, VALE)).toMatchObject({
      actorId: "listener",
      consequence: true,
    });
    expect(narrativeContext(table.world).speakers).toEqual([VALE, "listener"]);
    expect(progress()).toEqual({ count: 3, target: 3, phase: "offered" });
    expect(record().spread).toEqual([]);
    expect(table.world.actors.vale.upgrades ?? []).not.toContain(FOOL);
    expect(actions().some((action) => action.label === "Turn over")).toBe(
      false,
    );
    expect(mayCollect()).toBe(false);

    reload();
    const readingTurn = table.world.turn;
    expect(listenerOffer(table.world, VALE)).toMatchObject({
      actorId: "listener",
      locationId: "pond",
      kind: "fool",
      ready: true,
    });
    act("accept", { tarot: "offer", target: "listener", label: "Accept card" });
    expect(table.world.turn).toBe(readingTurn);
    expect(listenerOffer(table.world, VALE)).toBeFalsy();
    expect(progress()).toEqual({ count: 3, target: 3, phase: "dealt" });
    expect(record().spread).toMatchObject([{ card: FOOL, face: "down" }]);
    expect(mayCollect()).toBe(false);

    reload();
    act("accept", { tarot: 0, label: "Turn over" });
    expect(table.world.turn).toBe(readingTurn);
    expect(record().spread).toMatchObject([{ card: FOOL, face: "reward" }]);
    expect(progress()).toEqual({ count: 3, target: 3, phase: "revealed" });
    expect(arcanaLevel(table.world, VALE)).toBe(0);

    reload();
    act("accept", { tarot: 0, label: "Collect" });
    reload();
    expect(table.world.turn).toBe(readingTurn);
    expect(arcanaLevel(table.world, VALE)).toBe(1);
    expect(table.world.actors.vale.upgrades).toContain(FOOL);
    expect(progress()).toBe(null);
    expect(mayCollect()).toBe(false);
  },
);
