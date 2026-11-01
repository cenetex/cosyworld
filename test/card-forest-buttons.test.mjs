import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  createWorld as baseCreateWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  places,
  validateWorld,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import {
  LOCAL_UPGRADES_KEY,
  avatarImage,
  rememberLocalUpgrades,
  wearLocalUpgrades,
} from "../v2/card-game/scarves.mjs";

const PACK = "lonely-forest";
const COTTAGE = "forest-cottage";
const BUTTON = "forest-button-vale",
  SCARF = "forest-scarf-vale";
const RETIRED = [
  "forest-story-button",
  "forest-dewbright-button",
  "forest-watch-bell",
];
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
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("a button in each traveler's own colour", () => {
  it("authors eight buttons and their complementary scarves", () => {
    const pack = packDefinition(PACK);
    expect(pack.revision).toBe(3);
    const cast = JSON.parse(
      readFileSync(
        new URL("../v2/card-game/shared-cast.json", import.meta.url),
        "utf8",
      ),
    ).avatars.map((a) => a.id);
    for (const id of cast) {
      expect(pack.items[`forest-button-${id}`]).toBeTruthy();
      expect(pack.items[`forest-scarf-${id}`]).toBeTruthy();
    }
    expect(pack.items["forest-button-mara"].name).toBe("Mara's Red Button");
    expect(pack.items["forest-scarf-mara"].name).toBe("Mara's Green Scarf");
    for (const id of RETIRED) expect(pack.items[id]).toBeUndefined();
    const choices = pack.choices.map((c) => c.id);
    for (const id of [
      "forest-mend-scarf",
      "forest-share-symbols",
      "forest-set-watch-bell",
    ])
      expect(choices).not.toContain(id);
    expect(JSON.stringify(pack)).not.toMatch(
      /forest-(story|dewbright)-button|forest-watch-bell/,
    );
  });

  it("hides the button somewhere else in the world when the traveler meets RATi", () => {
    const before = attic();
    expect(entityActive(before, BUTTON)).toBe(false);
    const world = meetRati();
    const state = world.packs[PACK];
    expect(state.flags["forest-button-vale-hidden"]).toBe(true);
    expect(state.receipts["forest-hide-button-vale"]).toBe(world.turn);
    const spot = world.items[BUTTON].holder;
    expect(Object.hasOwn(places, spot)).toBe(true);
    expect(spot).not.toBe(COTTAGE);
    expect(entityActive(world, BUTTON)).toBe(true);
    expect(entityActive(world, SCARF)).toBe(false);
    // The meeting is never a card, and replay picks the same spot.
    expect(
      legalActions(world).some((a) => a.choiceId?.startsWith("forest-hide-")),
    ).toBe(false);
    expect(meetRati().items[BUTTON].holder).toBe(spot);
    expect(reload(world).items[BUTTON].holder).toBe(spot);
    // Only Vale is here, so only Vale's button is hidden.
    expect(world.items["forest-button-mara"].holder).toBe(COTTAGE);
    expect(entityActive(world, "forest-button-mara")).toBe(false);
  });

  it("makes finding the hidden button the traveler's quest", () => {
    let world = meetRati();
    const spot = world.items[BUTTON].holder;
    expect(world.actors.vale.want).toEqual({
      kind: "item",
      target: BUTTON,
      since: world.turn,
      refusals: 0,
      story: true,
    });
    validateWorld(reload(world));
    const xp = world.actors.vale.xp;
    // The button is an ordinary thing where it rests: anyone there can take it.
    world.actors.vale.place = spot;
    world = act(world, "take", { item: BUTTON });
    expect(world.actors.vale.xp).toBe(xp + 1);
    expect(
      world.log.some((e) => e.verb === "want_met" && e.itemId === BUTTON),
    ).toBe(true);
    expect(world.actors.vale.want?.target).not.toBe(BUTTON);
  });

  it("puts the button quest on top without wiping an open level quest (#1831)", () => {
    const start = attic();
    start.actors.vale.want = {
      kind: "person",
      target: "keeper",
      since: 0,
      refusals: 0,
      quest: { level: 2, left: 2 },
    };
    const world = act(start, "move", { target: COTTAGE });
    expect(world.actors.vale.want).toMatchObject({
      target: BUTTON,
      story: true,
    });
    expect(world.actors.vale.under).toEqual([
      expect.objectContaining({ quest: { level: 2, left: 2 } }),
    ]);
    validateWorld(reload(world));
  });

  it("lets RATi say she would sew it into a scarf", () => {
    let world = meetRati();
    world = act(world, "talk", { target: "rati" });
    const text = JSON.stringify(narrativeContext(world));
    expect(text).toContain(
      "RATi says she would sew Vale's black button into a white scarf",
    );
  });

  it("sews the found button into Vale's white scarf", () => {
    let world = meetRati();
    const spot = world.items[BUTTON].holder;
    expect(
      legalActions(world).some((a) => a.choiceId === "forest-sew-scarf-vale"),
    ).toBe(false);
    // Bring the button home from wherever it rests.
    world.actors.vale.place = spot;
    world = act(world, "take", { item: BUTTON });
    world.actors.vale.place = COTTAGE;
    validateWorld(world);
    expect(
      legalActions(world).some((a) => a.choiceId === "forest-sew-scarf-mara"),
    ).toBe(false);
    // The sewing is never a card. It is what giving RATi the button does.
    expect(
      legalActions(world).some((a) => a.choiceId?.startsWith("forest-sew-")),
    ).toBe(false);
    world = act(world, "give", { item: BUTTON, target: "rati" });
    const gift = world.log.findLast((e) => e.verb === "give");
    expect(gift).toMatchObject({ accepted: true, itemId: BUTTON });
    expect(gift.text).toContain("white scarf");
    expect(world.packs[PACK].receipts["forest-sew-scarf-vale"]).toBe(
      world.turn,
    );
    expect(world.items[SCARF].holder).toBe("vale");
    expect(entityActive(world, SCARF)).toBe(true);
    expect(entityActive(world, BUTTON)).toBe(false);
    expect(world.items[BUTTON]).toEqual({ holder: COTTAGE, history: [] });
    expect(world.packs[PACK].flags["forest-scarf-vale-sewn"]).toBe(true);
    world = reload(world);
    expect(world.items[SCARF].holder).toBe("vale");
    // Meeting RATi again hides nothing more.
    world = act(world, "talk", { target: "rati" });
    expect(world.items[BUTTON].holder).toBe(COTTAGE);
  });

  it("hides each shared traveler's own button when they meet RATi", () => {
    const people = { claimed: ["vale", "mara"], present: ["vale", "mara"] };
    let world = dispatchShared({
      op: "create",
      save: encodeSave(attic()),
    }).world;
    world.actors.vale.place = "forest-garden";
    world.actors.mara.place = "forest-garden";
    const walk = (world, actor) => {
      const view = dispatchShared({ op: "view", world, actor, ...people });
      const action = view.actions.find(
        (a) => a.kind === "move" && a.target === COTTAGE,
      );
      expect(action, actor).toBeTruthy();
      const response = dispatchShared({
        op: "play",
        world: view.world,
        actor,
        action,
        ...people,
      });
      expect(response.ok, response.error).toBe(true);
      return response.world;
    };
    world = walk(world, "mara");
    const state = () => world.packs[PACK];
    expect(state().receipts["forest-hide-button-mara"]).toBe(world.turn);
    expect(state().receipts["forest-hide-button-vale"]).toBeUndefined();
    world = walk(world, "vale");
    expect(state().receipts["forest-hide-button-vale"]).toBe(world.turn);
    for (const id of ["vale", "mara"]) {
      const spot = world.items[`forest-button-${id}`].holder;
      expect(spot).not.toBe(COTTAGE);
      expect(entityActive(world, `forest-button-${id}`)).toBe(true);
    }
    // RATi sews only a traveler's own button.
    world.items["forest-button-mara"].holder = "vale";
    const view = dispatchShared({
      op: "view",
      world,
      actor: "vale",
      ...people,
    });
    const give = view.actions.find(
      (a) =>
        a.kind === "give" &&
        a.item === "forest-button-mara" &&
        a.target === "rati",
    );
    expect(give).toBeTruthy();
    const refused = dispatchShared({
      op: "play",
      world: view.world,
      actor: "vale",
      action: give,
      ...people,
    });
    expect(refused.ok, refused.error).toBe(true);
    world = reload(refused.world);
    expect(world.log.findLast((e) => e.verb === "give")).toMatchObject({
      accepted: false,
      itemId: "forest-button-mara",
    });
    expect(world.items["forest-button-mara"].holder).toBe("vale");
    expect(world.packs[PACK].receipts["forest-sew-scarf-mara"]).toBeUndefined();
  });

  it("upgrades a finished revision 1 chapter", () => {
    const world = decodeSave(fixture("forest-revision-1-chapter.json"));
    const state = world.packs[PACK];
    expect(state.revision).toBe(3);
    for (const id of RETIRED) expect(world.items[id]).toBeUndefined();
    expect(state.receipts["forest-set-watch-bell"]).toBeUndefined();
    expect(state.receipts["forest-mark-pawprints"]).toBeGreaterThan(0);
    // Revision 3 drops the retired fork keys.
    expect(state.choices).toEqual({});
    expect(state.receipts["forest-mend-scarf"]).toBeUndefined();
    expect(state.flags["forest-scarf-mended"]).toBeUndefined();
    expect(state.flags["forest-homecoming-shared"]).toBe(true);
    expect(JSON.stringify(world.log)).not.toMatch(
      /forest-(story|dewbright)-button|forest-watch-bell/,
    );
    // Vale met RATi before buttons existed; the next visit hides one.
    expect(world.items[BUTTON].holder).toBe(COTTAGE);
    let next = act(world, "move", { target: COTTAGE });
    expect(next.items[BUTTON].holder).not.toBe(COTTAGE);
    expect(entityActive(next, BUTTON)).toBe(true);
    next = reload(next);
    expect(next.packs[PACK].revision).toBe(3);
  });

  it("upgrades a revision 1 save with the old things in hand", () => {
    const world = decodeSave(fixture("forest-revision-1-garden.json"));
    for (const id of RETIRED) expect(world.items[id]).toBeUndefined();
    expect(world.packs[PACK].receipts["forest-clear-drain"]).toBeGreaterThan(0);
    expect(reload(world).packs[PACK].revision).toBe(3);
  });

  // A retired fork's deed passes to the step that took it in (2026-11-01:
  // a shared world that had set the stones could not open on revision 3).
  it("moves a save holding a retired fork onto the step that replaced it", () => {
    const text = fixture("forest-revision-1-garden.json")
      .replaceAll("forest-clear-drain", "forest-set-stones")
      .replace('"forest-garden-care":"drain"', '"forest-garden-care":"stones"');
    const turn = JSON.parse(text).packs[PACK].receipts["forest-set-stones"];
    const world = decodeSave(text);
    const state = world.packs[PACK];
    expect(state.receipts["forest-set-stones"]).toBeUndefined();
    expect(state.receipts["forest-clear-drain"]).toBe(turn);
    expect(state.flags["forest-path-cleared"]).toBe(true);
    expect(JSON.stringify(world.log)).not.toContain("forest-set-stones");
    expect(reload(world).packs[PACK].revision).toBe(3);
  });
});

// Cosmetic upgrades are one-way, per passkey, and follow the traveler into
// every world (#1873). RATi's scarf is the first.
const SCARF_ART = "assets/shared/characters/vale-scarf.png";
// Meet RATi, find the button, and give it back for the scarf.
function sewn() {
  let world = meetRati();
  world.actors.vale.place = world.items[BUTTON].holder;
  world = act(world, "take", { item: BUTTON });
  world.actors.vale.place = COTTAGE;
  return act(world, "give", { item: BUTTON, target: "rati" });
}
const memory = (data = new Map()) => ({
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => data.set(k, String(v)),
});

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
    const join = (progress) =>
      dispatchShared({ op: "join", world, actor: "mara", progress, ...people });
    for (const upgrades of ["scarf", ["Scarf"], [1]])
      expect(() => join({ upgrades })).toThrow("Choose the avatar's upgrades.");
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
