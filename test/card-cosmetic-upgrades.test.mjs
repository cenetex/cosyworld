import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import {
  LOCAL_UPGRADES_KEY,
  avatarImage,
  rememberLocalUpgrades,
  wearLocalUpgrades,
} from "../v2/card-game/scarves.mjs";

// Cosmetic upgrades are one-way, per passkey, and follow the traveler into
// every world (#1873). RATi's scarf is the first.
const PACK = "lonely-forest",
  COTTAGE = "forest-cottage",
  BUTTON = "forest-button-vale",
  SCARF = "forest-scarf-vale",
  SCARF_ART = "assets/shared/characters/vale-scarf.png";
const createWorld = (...args) => questing(baseCreateWorld(...args));
const reload = (world) => decodeSave(encodeSave(world));
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function attic() {
  const world = enableMotives(createWorld());
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "vale";
  world.items.lamp.holder = "attic";
  world.items.lamp.lit = true;
  world.items.lamp.fuel = 12;
  return world;
}
const meetRati = (world = attic()) => act(world, "move", { target: COTTAGE });
// Meet RATi, find the button, and give it back for the scarf.
function sewn() {
  let world = meetRati();
  world.actors.vale.place = world.items[BUTTON].holder;
  world = act(world, "take", { item: BUTTON });
  world.actors.vale.place = COTTAGE;
  return act(world, "give", { item: BUTTON, target: "rati" });
}
const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
};

describe("cosmetic upgrades travel with the traveler (#1873)", () => {
  it("records the scarf upgrade when RATi sews the traveler's own button", () => {
    const world = sewn();
    expect(world.actors.vale.upgrades).toEqual(["scarf"]);
    expect(world.items[SCARF].holder).toBe("vale");
    expect(reload(world).actors.vale.upgrades).toEqual(["scarf"]);
    validateWorld(reload(world));
    // The portrait reads the set, so it stays after the scarf is given away.
    world.items[SCARF].holder = "mara";
    expect(avatarImage(world, "vale")).toBe(SCARF_ART);
    expect(portrait("vale", null, world)).toBe(`./${SCARF_ART}`);
    expect(avatarImage(world, "mara")).toBe(
      "assets/shared/characters/mara.png",
    );
  });

  it("hides no button for a traveler who already wears the scarf", () => {
    const start = attic();
    start.actors.vale.upgrades = ["scarf"];
    const world = meetRati(start);
    const state = world.packs[PACK];
    expect(state.flags["forest-button-vale-hidden"]).toBeUndefined();
    expect(state.receipts["forest-hide-button-vale"]).toBeUndefined();
    expect(world.items[BUTTON].holder).toBe(COTTAGE);
    expect(world.actors.vale.want?.target).not.toBe(BUTTON);
    expect(world.items[SCARF].holder).toBe(COTTAGE);
    expect(avatarImage(world, "vale")).toBe(SCARF_ART);
  });

  it("joins a shared world wearing its upgrades, without a scarf item", () => {
    const world = dispatchShared({ op: "create" }).world;
    const people = { claimed: ["vale", "mara"], present: ["vale", "mara"] };
    const joined = dispatchShared({
      op: "join",
      world,
      actor: "mara",
      progress: { upgrades: ["scarf"] },
      ...people,
    }).world;
    expect(joined.actors.mara.upgrades).toEqual(["scarf"]);
    expect(joined.actors.mara.xp).toBe(world.actors.mara.xp);
    expect(joined.items["forest-scarf-mara"].holder).not.toBe("mara");
    expect(avatarImage(joined, "mara")).toBe(
      "assets/shared/characters/mara-scarf.png",
    );
    // Upgrades only grow, and a level may come with them.
    const again = dispatchShared({
      op: "join",
      world: joined,
      actor: "mara",
      progress: { level: 2, xp: 3, upgrades: [] },
      ...people,
    }).world;
    expect(again.actors.mara.upgrades).toEqual(["scarf"]);
    expect(again.actors.mara.xp).toBe(3);
    for (const upgrades of ["scarf", ["Scarf"], [1]])
      expect(() =>
        dispatchShared({
          op: "join",
          world,
          actor: "mara",
          progress: { upgrades },
          ...people,
        }),
      ).toThrow("Choose the avatar's upgrades.");
    // A freed seat starts over for its next holder.
    const reset = dispatchShared({
      op: "reset",
      world: joined,
      actor: "mara",
      ...people,
    }).world;
    expect(reset.actors.mara.upgrades).toBeUndefined();
  });

  it("keeps the local passkey's upgrades between local worlds", () => {
    const storage = memory();
    rememberLocalUpgrades(sewn(), storage);
    expect(JSON.parse(storage.getItem(LOCAL_UPGRADES_KEY))).toEqual({
      vale: ["scarf"],
    });
    const next = wearLocalUpgrades(attic(), storage);
    expect(next.actors.vale.upgrades).toEqual(["scarf"]);
    expect(next.actors.mara.upgrades).toBeUndefined();
    expect(meetRati(next).items[BUTTON].holder).toBe(COTTAGE);
    // A broken store reads as no upgrades.
    storage.setItem(LOCAL_UPGRADES_KEY, "{not json");
    expect(wearLocalUpgrades(attic(), storage).actors.vale.upgrades).toBe(
      undefined,
    );
  });

  it("does not carry local upgrades into a passkey's shared world", () => {
    const local = sewn();
    const shared = dispatchShared({ op: "create", save: encodeSave(local) });
    expect(shared.world.actors.vale.upgrades).toBeUndefined();
    // The shared world keeps its own things; only the passkey set is dropped.
    expect(shared.world.items[SCARF].holder).toBe("vale");
  });
});
